/**
* logger-worker.ts - Worker thread that owns all file I/O.
*
* The main thread sends messages via postMessage(); this worker receives them
* and does the actual fs.WriteStream work. This keeps every sync fs call
* (mkdirSync, renameSync, statSync, readdirSync, unlinkSync) off the Vite
* event loop entirely.
*
* Message protocol (main -> worker):
*   { type: 'write',   event: TrackerEvent, transportIdx?: number }
*   { type: 'hydrate', maxBytesPerTransport: number, batchSize: number }
*       Triggers a background read of all JSON log files. Events are streamed
*       back to the main thread in batches via 'hydrate:batch' messages so the
*       RingBuffer is populated progressively without waiting for all files.
*   { type: 'destroy' }
*       Flush + close all streams, then exit.
*
* Message protocol (worker -> main):
*   { type: 'ready' }
*   { type: 'hydrate:batch', events: TrackerEvent[] }
*   { type: 'hydrate:done',  loaded: number, skippedMalformed: number,
*                            skippedInvalid: number, limitReached: boolean }
*   { type: 'error', message: string }
*/

import { parentPort, workerData } from 'node:worker_threads';
import fs from 'node:fs';
import readline from 'node:readline';
import path from 'node:path';
import type { TrackerEvent, LogTransport } from '../types.js';

// INFO Types re-declared locally (worker has no access to the parent module graph)

interface WorkerInit {
	transports: LogTransport[];
	minLevel: number;  // INFO numeric threshold (0=debug,1=info,2=warn,3=error)
}

const LEVEL_NUM: Record<string, number> = {
	debug: 0,
	info: 1,
	warn: 2,
	error: 3,
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
	// eslint-disable-next-line no-unused-vars
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
		/* v8 ignore start */
		if (!this.stream) {
			return;
		}
		/* v8 ignore stop */
		const line = this.formatter(event);

		if (this.transport.rotation?.strategy === 'daily') {
			const now = new Date();
			const yyyy = now.getUTCFullYear();
			const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
			const dd = String(now.getUTCDate()).padStart(2, '0');
			const today = `${yyyy}_${mm}_${dd}`;
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
			const now = new Date();
			const yyyy = now.getUTCFullYear();
			const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
			const dd = String(now.getUTCDate()).padStart(2, '0');
			this.currentDate = `${yyyy}_${mm}_${dd}`;
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
		const now = new Date();
		const yyyy = now.getUTCFullYear();
		const mo = String(now.getUTCMonth() + 1).padStart(2, '0');
		const dd = String(now.getUTCDate()).padStart(2, '0');
		const HH = String(now.getUTCHours()).padStart(2, '0');
		const MM = String(now.getUTCMinutes()).padStart(2, '0');
		const SS = String(now.getUTCSeconds()).padStart(2, '0');
		const ts = `${yyyy}_${mo}_${dd}_${HH}_${MM}_${SS}`;
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
			/**
			 * FIX: the previous implementation called fs.statSync() on every
			 * rotated file to obtain mtime for sorting. With many archived files
			 * this caused O(n) blocking syscalls during a write, adding backpressure
			 * to the pending[] queue in the worker.
			 *
			 * The rotation logic already embeds a UTC timestamp in the archived
			 * filename (e.g. appId-2024_03_15_10_30_00.log). Lexicographic order on
			 * these names is identical to chronological order, so statSync is
			 * entirely unnecessary — we sort by name instead.
			 *
			 * Only rotated (archived) files are considered; the live file (whose
			 * name equals baseName exactly) is excluded from the count and never
			 * deleted.
			 */
			fs.readdirSync(dir)
				.filter(f => f.startsWith(stem) && f.endsWith(ext) && f !== baseName)
				.sort()           // INFO lexicographic = chronological for timestamped names
				.reverse()        // INFO newest first
				.slice(maxFiles)  // INFO keep the newest maxFiles, collect the rest
				.forEach(name => {
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

/**
 * Minimal structural guard — mirrors isValidEvent in standalone-server.ts.
 * Re-declared here because the worker has no access to the parent module graph.
 */
function isValidEvent(value: unknown): value is TrackerEvent {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		return false;
	}
	const e = value as Record<string, unknown>;
	return (
		typeof e['timestamp'] === 'string' && e['timestamp'].length > 0 &&
		typeof e['type'] === 'string' && e['type'].length > 0 &&
		typeof e['level'] === 'string' && e['level'].length > 0 &&
		typeof e['appId'] === 'string' && e['appId'].length > 0 &&
		typeof e['sessionId'] === 'string' &&
		typeof e['userId'] === 'string' &&
		typeof e['payload'] === 'object' && e['payload'] !== null &&
		typeof e['meta'] === 'object' && e['meta'] !== null
	);
}

/**
 * Read all JSON log files for every transport, stream parsed events back to
 * the main thread in batches, then report summary statistics.
 *
 * Design notes:
 *  - Uses readline + createReadStream so the worker's event loop is never
 *    blocked while reading (the worker also handles 'write' messages
 *    concurrently during hydration).
 *  - Events are batched (batchSize) before postMessage to avoid flooding the
 *    IPC channel with one message per line.
 *  - A per-transport byte cap (maxBytesPerTransport) prevents unbounded
 *    memory accumulation when log directories are very large.
 *  - Only JSON-format transports are read (pretty format is not machine-readable).
 */
async function hydrateFromLogs(maxBytesPerTransport: number, batchSize: number): Promise<void> {
	let totalLoaded = 0;
	let totalMalformed = 0;
	let totalInvalid = 0;
	let limitReached = false;

	for (const transport of init.transports) {
		if (transport.format !== 'json') {
			continue;
		}

		const dir = path.dirname(transport.path);
		if (!fs.existsSync(dir)) {
			continue;
		}

		const base = path.basename(transport.path);
		const ext = path.extname(base);
		const stem = base.slice(0, -ext.length);

		let files: string[];
		try {
			files = fs.readdirSync(dir)
				.filter(f => f.startsWith(stem) && f.endsWith(ext))
				.sort(); // INFO lexicographic = chronological for timestamped names
		} catch (err) {
			parentPort?.postMessage({ type: 'error', message: `hydrate: cannot list ${dir}: ${err}` });
			continue;
		}

		let bytesRead = 0;

		for (const file of files) {
			if (bytesRead >= maxBytesPerTransport) {
				limitReached = true;
				break;
			}

			const filePath = path.join(dir, file);
			let batch: TrackerEvent[] = [];

			try {
				await new Promise<void>((resolve, reject) => {
					const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
					const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

					rl.on('line', (line) => {
						bytesRead += Buffer.byteLength(line, 'utf8') + 1; // INFO +1 for '\n'

						if (!line.trim()) {
							return;
						}

						let parsed: unknown;
						try {
							parsed = JSON.parse(line);
						} catch {
							totalMalformed++;
							return;
						}

						if (!isValidEvent(parsed)) {
							totalInvalid++;
							return;
						}

						batch.push(parsed);
						totalLoaded++;

						// INFO Flush batch when it reaches the target size
						if (batch.length >= batchSize) {
							parentPort?.postMessage({ type: 'hydrate:batch', events: batch });
							batch = [];
						}
					});

					rl.on('close', () => {
						// INFO Flush any remaining events in the last partial batch
						if (batch.length > 0) {
							parentPort?.postMessage({ type: 'hydrate:batch', events: batch });
							batch = [];
						}
						resolve();
					});

					rl.on('error', reject);
					stream.on('error', reject);
				});
			} catch (err) {
				parentPort?.postMessage({ type: 'error', message: `hydrate: cannot read ${file}: ${err}` });
			}
		}
	}

	parentPort?.postMessage({
		type: 'hydrate:done',
		loaded: totalLoaded,
		skippedMalformed: totalMalformed,
		skippedInvalid: totalInvalid,
		limitReached,
	});
}

parentPort?.on('message', (msg: { type: string, event?: TrackerEvent, transportIdx?: number, maxBytesPerTransport?: number, batchSize?: number }) => {
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

	if (msg.type === 'hydrate') {
		/**
		 * Run asynchronously so write messages can still be processed while
		 * hydration is in progress (the worker event loop is not blocked).
		 */
		hydrateFromLogs(
			msg.maxBytesPerTransport ?? 50 * 1024 * 1024,
			msg.batchSize ?? 200,
		);
		return;
	}

	if (msg.type === 'destroy') {
		for (const t of transports) {
			t.destroy();
		}
		process.exit(0);
	}
});
