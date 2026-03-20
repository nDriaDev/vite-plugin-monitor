/**
* logger-worker.ts - Worker thread that owns all file I/O.
*
* The main thread sends messages via postMessage(); this worker receives them
* and does the actual fs.WriteStream work. This keeps every sync fs call
* (mkdirSync, renameSync, statSync, readdirSync, unlinkSync) off the Vite
* event loop entirely.
*
* Message protocol (main -> worker):
*   { type: 'write',   event: TrackerEvent,  transportIdx: number }
*   { type: 'destroy' }   - flush + close all streams, then exit
*
* Message protocol (worker -> main):
*   { type: 'error', message: string }
*   { type: 'ready' }
*/

import { parentPort, workerData } from 'node:worker_threads'
import fs from 'node:fs'
import path from 'node:path'
import type { TrackerEvent, LogTransport } from '../types.js'

// INFO Types re-declared locally (worker has no access to the parent module graph)

interface WorkerInit {
	transports: LogTransport[]
	minLevel:   number  // numeric threshold (0=debug,1=info,2=warn,3=error)
}

const LEVEL_NUM: Record<string, number> = {
	debug: 0, info: 1, warn: 2, error: 3,
}

// INFO Formatters

function formatJson(event: TrackerEvent): string {
	return JSON.stringify(event) + '\n'
}

function formatPretty(event: TrackerEvent): string {
	const level = event.level.toUpperCase().padEnd(5);
	const type = event.type.padEnd(12);
	const user = `user:${event.userId}`.padEnd(20);
	const session = `sess:${event.sessionId.slice(0, 8)}`;
	const payload = JSON.stringify(event.payload);
	return `[${event.timestamp}] ${level} | ${type} | ${user} | ${session} | ${payload}\n`;
}

// INFO Size parser

function parseSize(size: string): number {
	const match = size.match(/^(\d+(?:\.\d+)?)(kb|mb|gb|b)?$/i);
	if (!match) {
		return 10 * 1024 * 1024;
	}
	const value = parseFloat(match[1]);
	const unit = (match[2] ?? 'b').toLowerCase();
	const mult: Record<string, number> = { b: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3 };
	return Math.floor(value * (mult[unit] ?? 1));
}

/**
 * INFO StreamTransport (worker-local copy, without the lazy-open complexity)
 * Inside the worker we open streams eagerly - the worker is started after
 * configResolved so the CWD is already correct.
 */
class StreamTransport {
	private stream: fs.WriteStream | null = null;
	private currentPath!: string;
	private currentDate!: string;
	private bytesLimit: number;
	private readonly transport: LogTransport;
	private readonly formatter: (e: TrackerEvent) => string;
	private pending: string[] = [];  // INFO lines buffered while stream is draining

	constructor(transport: LogTransport) {
		this.transport = transport;
		this.formatter = transport.format === 'pretty' ? formatPretty : formatJson;
		this.bytesLimit = parseSize(transport.rotation?.maxSize ?? '10mb');
		this.ensureDir();
		this.openStream(this.resolveTargetPath());
	}

	write(event: TrackerEvent): void {
		if (!this.stream) {
			return;
		}
		const line = this.formatter(event);

		if (this.transport.rotation?.strategy === 'daily') {
			const today = new Date().toISOString().slice(0, 10);
			if (today !== this.currentDate) {
				this.closeStream();
				this.openStream(this.resolveTargetPath());
			}
		} else if (this.transport.rotation?.strategy === 'size') {
			if (this.stream.bytesWritten >= this.bytesLimit) {
				this.rotate();
			}
		}

		// INFO If there are pending lines, buffer this one too to preserve order
		if (this.pending.length > 0) {
			this.pending.push(line);
			return;
		}

		const ok = this.stream!.write(line, 'utf8');
		if (!ok) {
			// INFO Stream buffer is full - buffer subsequent lines until drain
			this.pending.push('');  // INFO placeholder so subsequent writes buffer too
			this.stream!.once('drain', () => {
				const queued = this.pending.splice(0);
				for (const l of queued) {
					if (l) {
						this.stream?.write(l, 'utf8');
					}
				}
			})
		}
	}

	destroy(): void {
		this.closeStream();
	}

	private resolveTargetPath(): string {
		if (this.transport.rotation?.strategy === 'daily') {
			this.currentDate = new Date().toISOString().slice(0, 10);
			const ext = path.extname(this.transport.path);
			const base = this.transport.path.slice(0, -ext.length);
			return `${base}-${this.currentDate}${ext}`;
		}
		return this.transport.path;
	}

	private openStream(targetPath: string): void {
		this.currentPath = targetPath;
		this.stream = fs.createWriteStream(
			targetPath,
			{
				flags: 'a',
				encoding: 'utf8',
				highWaterMark: 64 * 1024,
			}
		);
		this.stream.on('error', (err) => {
			parentPort?.postMessage({ type: 'error', message: `Stream error on ${targetPath}: ${err.message}` });
		});
	}

	private closeStream(): void {
		if (this.stream) {
			this.stream.end();
			this.stream = null;
		}
	}

	private rotate(): void {
		this.closeStream();
		const ts = Date.now();
		const archived = this.transport.path.replace(/(\.[^.]+)$/, `-${ts}$1`);
		try {
			fs.renameSync(this.currentPath, archived);
		} catch { /* ignore */ }
		this.cleanupOldFiles();
		this.openStream(this.transport.path);
	}

	private cleanupOldFiles(): void {
		const maxFiles = this.transport.rotation?.maxFiles ?? 30;
		const dir = path.dirname(this.transport.path);
		const baseName = path.basename(this.transport.path);
		const ext = path.extname(baseName);
		const stem = baseName.slice(0, -ext.length);
		try {
			fs.readdirSync(dir)
				.filter(f => f.startsWith(stem) && f.endsWith(ext) && f !== baseName)
				.map(f  => ({ name: f, mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
				.sort((a, b) => b.mtime - a.mtime)
				.slice(maxFiles)
				.forEach(({ name }) => {
					try {
						fs.unlinkSync(path.join(dir, name));
					} catch { /* ignore */ }
				});
		} catch { /* ignore */ }
	}

	private ensureDir(): void {
		const dir = path.dirname(this.transport.path);
		if (!fs.existsSync(dir)) {
			fs.mkdirSync(dir, { recursive: true });
		}
	}
}

// INFO Worker main

const init = workerData as WorkerInit;

const transports = init.transports.map(t => new StreamTransport(t));
const minLevel = init.minLevel;

parentPort?.postMessage({ type: 'ready' });

parentPort?.on('message', (msg: { type: string; event?: TrackerEvent; transportIdx?: number }) => {
	if (msg.type === 'write' && msg.event) {
		if (LEVEL_NUM[msg.event.level] < minLevel) {
			return;
		}

		// INFO If transportIdx provided, write only to that transport; otherwise write all
		if (msg.transportIdx !== undefined) {
			transports[msg.transportIdx]?.write(msg.event);
		} else {
			for (const t of transports) {
				try {
					t.write(msg.event);
				} catch (err: unknown) {
					parentPort?.postMessage({ type: 'error', message: String(err) });
				}
			}
		}
		return;
	}

	if (msg.type === 'destroy') {
		for (const t of transports) {
			t.destroy();
		}
		process.exit(0);
	}
});
