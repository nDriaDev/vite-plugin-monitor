import fs from 'node:fs';
import readline from 'node:readline';
import path from 'node:path';
import type { Logger, LoggingOptions, LogLevel, LogTransport, TrackerEvent } from '../types';

const LEVELS: Record<LogLevel, number> = {
	debug: 0,
	info: 1,
	warn: 2,
	error: 3,
}

/**
* logger.ts - Plugin-side logger.
*
* @remarks
* All file I/O (fs.WriteStream, rotation, cleanup) using Node's non-blocking stream APIs.
*
* ## Write serialization via async generator queue
*
* StreamTransport uses an internal AsyncGenerator-based write queue
* (`writeLoop`) to serialize every operation — writes, rotations, and the
* final destroy flush — through a single `for await` loop. This eliminates
* the race conditions that arise when concurrent `async write()` calls each
* independently await a rotation or closeStream and then race to reopen the
* stream. With the queue, all operations are strictly ordered: a rotation
* triggered by one event fully completes before the next event is processed.
*
* The queue is fed via `enqueue(item)` which pushes items into a shared
* buffer and resolves a pending "notify" promise so the loop wakes up
* immediately without polling.
*
* The sentinel value `null` is used to signal graceful shutdown: when
* `destroy()` enqueues `null`, the loop drains all preceding lines, then
* terminates, flushing the underlying stream before resolving.
*
* ## Backpressure
*
* `streamWrite(line)` wraps `fs.WriteStream.write()` in a Promise that
* resolves on `drain` when the internal buffer is full. The write loop
* `await`s it, so backpressure naturally pauses the queue without
* additional buffering.
*
* ## Hydration
*
* Replaying JSONL log files into the ring buffer on startup uses
* readline + createReadStream, which is fully async and does not block the
* Vite event loop. The outer `hydrateFromLogsIterator` async generator
* composes per-file generators (`readLogFile`) using `yield*`, keeping
* each concern isolated and the control flow linear.
*
* The console logger (debug/info/warn/error) is also on the main thread and
* is used for Vite plugin messages, not event data.
*/

function formatJson(event: TrackerEvent): string {
	return JSON.stringify(event) + '\n';
}

function formatPretty(event: TrackerEvent): string {
	const level = event.level.toUpperCase().padEnd(5);
	const type = event.type.padEnd(12);
	const user = `user:${event.userId}`.padEnd(20);
	const session = `sess:${event.sessionId.slice(0, 8)}`;
	const payload = JSON.stringify(event.payload);
	return `[${event.timestamp}] ${level} | ${type} | ${user} | ${session} | ${payload}\n`;
}

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

/** Resolves when the stream drains or immediately if write succeeded. */
function streamWrite(stream: fs.WriteStream, line: string): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		const ok = stream.write(line, 'utf8');
		if (ok) {
			resolve();
			return;
		}
		const onDrain = () => {
			stream.off('error', onError);
			resolve();
		};
		const onError = (e: Error) => {
			stream.off('drain', onDrain);
			reject(e);
		};
		stream.once('drain', onDrain);
		stream.once('error', onError);
	});
}

function utcDateStamp(now: Date): string {
	const yyyy = now.getUTCFullYear();
	const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
	const dd = String(now.getUTCDate()).padStart(2, '0');
	return `${yyyy}_${mm}_${dd}`;
}

function utcTimestamp(now: Date): string {
	const HH = String(now.getUTCHours()).padStart(2, '0');
	const MM = String(now.getUTCMinutes()).padStart(2, '0');
	const SS = String(now.getUTCSeconds()).padStart(2, '0');
	return `${utcDateStamp(now)}_${HH}_${MM}_${SS}`;
}

/**
 * StreamTransport — owns a single fs.WriteStream for one LogTransport config.
 *
 * Streams are opened eagerly on construction (createLogger is called from
 * configureServer, after configResolved has set the CWD).
 *
 * All mutations to the stream (writes, rotation, close) are serialized
 * through an internal async-generator write queue so that concurrent
 * `writeEvent` calls can never race on rotation or stream lifecycle.
 */
class StreamTransport {
	private stream: fs.WriteStream | null = null;
	private currentPath!: string;
	private currentDate!: string;
	private readonly bytesLimit: number;
	private readonly transport: LogTransport;
	private readonly formatter: (e: TrackerEvent) => string;

	// INFO Queue internals — a shared buffer plus a "notify" promise so the loop wakes immediately when a new item arrives without polling.
	private readonly buffer: (string | null)[] = [];
	private notify!: () => void;
	private notifyPromise!: Promise<void>;
	private readonly loopDone: Promise<void>;

	constructor(transport: LogTransport, onError: (msg: string) => void) {
		this.transport = transport;
		this.formatter = transport.format === 'pretty' ? formatPretty : formatJson;
		this.bytesLimit = parseSize(transport.rotation?.maxSize ?? '10mb');
		this.resetNotify();
		this.ensureDir();
		this.loopDone = this.openStream(this.resolveTargetPath(), onError)
			.then(() => this.writeLoop(onError))
			.catch(err => {
				onError(`Failed to open initial stream: ${err}`);
			});
	}

	/** Enqueue a formatted line (or the null sentinel to shut down). */
	private enqueue(item: string | null): void {
		this.buffer.push(item);
		this.notify();
		this.resetNotify();
	}

	private resetNotify(): void {
		this.notifyPromise = new Promise<void>(res => { this.notify = res; });
	}

	/**
	 * The write loop — the single point of truth for all stream mutations.
	 *
	 * It is an async generator internally (uses `yield*` to compose with the
	 * line source) but exposed as a plain async function so the constructor
	 * can retain the `Promise<void>` without needing to drive an external
	 * `for await`.
	 *
	 * Serialization guarantee: every `await` inside the loop (backpressure,
	 * rotation, close) suspends the loop itself, so the next item in the
	 * buffer is only processed after the current one fully completes.
	 */
	private async writeLoop(onError: (msg: string) => void): Promise<void> {
		// INFO Consume items from the shared buffer via an async generator so the loop body stays clean and item-at-a-time.
		for await (const line of this.lineSource()) {
			/* v8 ignore start */
			if (!this.stream) {
				continue;
			}
			/* v8 ignore stop */

			// INFO Rotation check — runs synchronously inside the loop
			if (this.transport.rotation?.strategy === 'daily') {
				const today = utcDateStamp(new Date());
				if (today !== this.currentDate) {
					await this.closeStream();
					await this.openStream(this.resolveTargetPath(), onError);
				}
			} else if (this.transport.rotation?.strategy === 'size') {
				if (this.stream!.bytesWritten >= this.bytesLimit) {
					await this.rotate(onError);
				}
			}

			/* v8 ignore start */
			if (!this.stream) {
				continue;
			}
			/* v8 ignore stop */

			// INFO Await backpressure: if the kernel buffer is full, the loop suspends here until drain — no secondary pending[] array needed.
			await streamWrite(this.stream, line).catch(err => {
				onError(`Write error on ${this.currentPath}: ${String(err)}`);
			});
		}
		// INFO Sentinel consumed — close the stream and let loopDone resolve.
		await this.closeStream();
	}

	/**
	 * Async generator that yields lines from the shared buffer.
	 *
	 * Waits on `notifyPromise` when the buffer is empty, wakes when
	 * `enqueue()` resolves the current notify. Terminates when it
	 * dequeues the `null` sentinel, leaving any remaining items unprocessed
	 * (there should be none: destroy() enqueues null only after all writes).
	 */
	private async *lineSource(): AsyncGenerator<string> {
		while (true) {
			while (this.buffer.length > 0) {
				const item = this.buffer.shift()!;
				if (item === null) {
					return; // INFO sentinel — shut down
				}
				yield item;
			}
			await this.notifyPromise; // INFO sleep until next enqueue()
		}
	}

	/** Public write API — formats the event and pushes it onto the queue. */
	write(event: TrackerEvent, _onError: (msg: string) => void): void {
		this.enqueue(this.formatter(event));
	}

	/**
	 * Graceful shutdown — enqueue the sentinel and wait for the loop to
	 * drain all preceding lines and close the stream.
	 *
	 * Because the sentinel is pushed *after* all previously enqueued lines,
	 * the loop processes every pending write before terminating. No lines
	 * are lost.
	 */
	async destroy(): Promise<void> {
		this.enqueue(null);
		await this.loopDone;
	}

	private resolveTargetPath(): string {
		if (this.transport.rotation?.strategy === 'daily') {
			this.currentDate = utcDateStamp(new Date());
			const ext = path.extname(this.transport.path);
			const base = this.transport.path.slice(0, -ext.length);
			return `${base}-${this.currentDate}${ext}`;
		}
		return this.transport.path;
	}

	private openStream(targetPath: string, onError: (msg: string) => void): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			this.currentPath = targetPath;
			const s = fs.createWriteStream(targetPath, {
				flags: 'a',
				encoding: 'utf8',
				highWaterMark: 64 * 1024,
			});
			s.once('open', () => {
				this.stream = s;
				s.on('error', (err) => {
					onError(`Stream error on ${targetPath}: ${err.message}`);
				});
				resolve();
			});
			s.once('error', (err) => {
				onError(`Stream error on ${targetPath}: ${err.message}`);
				reject(err);
			});
		});
	}

	private closeStream(): Promise<void> {
		return new Promise<void>(res => {
			const s = this.stream;
			this.stream = null;
			/* v8 ignore start */
			if (!s) {
				res();
				return;
			}
			/* v8 ignore stop */

			s.once('finish', res);
			s.once('error', () => res());
			s.end();
		});
	}

	private async rotate(onError: (msg: string) => void): Promise<void> {
		await this.closeStream();
		const ts = utcTimestamp(new Date());
		const archived = this.transport.path.replace(/(\.[^.]+)$/, `-${ts}$1`);
		try {
			fs.renameSync(this.currentPath, archived);
		} catch { /* ignore */ }
		this.cleanupOldFiles();
		await this.openStream(this.transport.path, onError);
	}

	private cleanupOldFiles(): void {
		const maxFiles = this.transport.rotation?.maxFiles ?? 30;
		const dir = path.dirname(this.transport.path);
		const baseName = path.basename(this.transport.path);
		const ext = path.extname(baseName);
		const stem = baseName.slice(0, -ext.length);
		try {
			/**
			 * The rotation logic embeds a UTC timestamp in the archived filename
			 * (e.g. appId-2024_03_15_10_30_00.log). Lexicographic order on these
			 * names is identical to chronological order, so we sort by name.
			 *
			 * Only rotated (archived) files are considered; the live file (whose
			 * name equals baseName exactly) is excluded and never deleted.
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

/**
 * Minimal structural guard — mirrors isValidEvent in standalone-server.ts.
 */
function isValidEvent(value: unknown): value is TrackerEvent {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		return false;
	}
	const e = value as Record<string, unknown>;
	return (
		typeof e['timestamp'] === 'string' && e['timestamp'].length > 0 &&
		typeof e['type'] === 'string' && e['type'].length > 0 &&
		['debug', 'info', 'warn', 'error'].includes(e['level'] as string) &&
		typeof e['appId'] === 'string' && e['appId'].length > 0 &&
		typeof e['sessionId'] === 'string' &&
		typeof e['userId'] === 'string' &&
		typeof e['payload'] === 'object' && e['payload'] !== null &&
		typeof e['meta'] === 'object' && e['meta'] !== null
	);
}

type HydrateBatch = { type: 'batch'; events: TrackerEvent[] };
type HydrateDone = { type: 'done'; stats: { loaded: number; skippedMalformed: number; skippedInvalid: number; limitReached: boolean } };

/**
 * Top-level hydration generator.
 *
 * Iterates over transports and delegates to `readTransportFiles` via
 * `yield*`. Accumulates global stats across all transports and emits a
 * single `done` chunk at the end, so the caller always gets exactly one
 * summary regardless of how many transports are configured.
 */
async function* hydrateFromLogsIterator(transportConfigs: LogTransport[], maxBytesPerTransport: number, batchSize: number): AsyncGenerator<HydrateBatch | HydrateDone> {
	let totalLoaded = 0;
	let totalMalformed = 0;
	let totalInvalid = 0;
	let limitReached = false;

	for (const transport of transportConfigs) {
		if (transport.format !== 'json') {
			continue;
		}

		for await (const chunk of readTransportFiles(transport, maxBytesPerTransport, batchSize)) {
			if (chunk.type === 'batch') {
				totalLoaded += chunk.events.length;
				yield chunk;
			} else {
				totalMalformed += chunk.stats.skippedMalformed;
				totalInvalid += chunk.stats.skippedInvalid;
				if (chunk.stats.limitReached) {
					limitReached = true;
				}
			}
		}

		if (limitReached) {
			break;
		}
	}

	yield {
		type: 'done',
		stats: {
			loaded: totalLoaded,
			skippedMalformed: totalMalformed,
			skippedInvalid: totalInvalid,
			limitReached,
		}
	};
}

/**
 * Per-transport generator.
 *
 * Lists all log files for the transport (live + rotated), then delegates
 * to `readLogFile` via `yield*` for each one. Emits an intermediate
 * `done`-like stats chunk per transport so `hydrateFromLogsIterator` can
 * accumulate totals cleanly without threading mutable counters across
 * generator boundaries.
 */
async function* readTransportFiles(transport: LogTransport, maxBytesPerTransport: number, batchSize: number): AsyncGenerator<HydrateBatch | { type: 'done'; stats: { skippedMalformed: number; skippedInvalid: number; limitReached: boolean } }> {
	const dir = path.dirname(transport.path);
	if (!fs.existsSync(dir)) {
		return;
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
		console.error(`[vite-plugin-monitor] hydrate: cannot list ${dir}: ${err}`);
		return;
	}

	let bytesRead = 0;
	let skippedMalformed = 0;
	let skippedInvalid = 0;
	let limitReached = false;

	for (const file of files) {
		const filePath = path.join(dir, file);

		for await (const chunk of readLogFile(filePath, batchSize, bytesRead, maxBytesPerTransport)) {
			if (chunk.type === 'batch') {
				yield chunk;
			} else {
				// INFO Accumulate stats from this file before moving to the next.
				bytesRead = chunk.bytesRead;
				skippedMalformed += chunk.skippedMalformed;
				skippedInvalid += chunk.skippedInvalid;
				limitReached = chunk.limitReached;
			}
		}

		if (limitReached) {
			break;
		}
	}

	yield { type: 'done', stats: { skippedMalformed, skippedInvalid, limitReached } };
}

/**
 * Per-file generator.
 *
 * Opens a readline interface over a read stream, parses each JSONL line,
 * validates it, and yields `batch` chunks when `batchSize` is reached.
 * Emits a final stats chunk so the parent generator can thread the
 * `bytesRead` cursor across files without exposing mutable state.
 *
 * `startBytes` lets the caller pass the running byte total so the
 * `maxBytesPerTransport` limit is enforced across the entire transport, not
 * per-file.
 */
async function* readLogFile(filePath: string, batchSize: number, startBytes: number, maxBytes: number): AsyncGenerator<HydrateBatch | { type: 'stats'; bytesRead: number; skippedMalformed: number; skippedInvalid: number; limitReached: boolean }> {
	let batch: TrackerEvent[] = [];
	let bytesRead = startBytes;
	let skippedMalformed = 0;
	let skippedInvalid = 0;
	let limitReached = false;

	const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
	const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

	try {
		for await (const line of rl) {
			if (!line.trim()) {
				continue;
			}

			bytesRead += Buffer.byteLength(line, 'utf8') + 1;
			if (bytesRead >= maxBytes) {
				limitReached = true;
				break;
			}

			let parsed: unknown;
			try {
				parsed = JSON.parse(line);
			} catch {
				skippedMalformed++;
				continue;
			}

			if (!isValidEvent(parsed)) {
				skippedInvalid++;
				continue;
			}

			batch.push(parsed);

			if (batch.length >= batchSize) {
				yield { type: 'batch', events: batch };
				batch = [];
			}
		}

		if (batch.length > 0) {
			yield { type: 'batch', events: batch };
		}
	} catch (err) {
		console.error(`[vite-plugin-monitor] hydrate: cannot read ${filePath}: ${err}`);
	} finally {
		rl.close();
		stream.destroy();
	}

	yield { type: 'stats', bytesRead, skippedMalformed, skippedInvalid, limitReached };
}

export function createLogger(appId: string, loggingOpts?: LoggingOptions): Logger {
	const minLevel = LEVELS[loggingOpts?.level ?? 'info'];

	const transportConfigs = loggingOpts?.transports ?? [
		{
			format: 'json' as const,
			path: `./logs/${appId}.log`,
			rotation: { strategy: 'daily' as const, maxFiles: 30, compress: false },
		}
	];

	const prefix = '\x1b[36m[vite-plugin-monitor]\x1b[0m';

	function onStreamError(msg: string): void {
		console.error(`${prefix} ${msg}`);
	}

	// INFO Transports are opened eagerly — createLogger is called from configureServer, after configResolved has already set the CWD.
	const transports = transportConfigs.map(t => new StreamTransport(t, onStreamError));

	function writeEvent(event: TrackerEvent): void {
		if (LEVELS[event.level] < minLevel) {
			return;
		}
		for (const t of transports) {
			t.write(event, onStreamError);
		}
	}

	async function destroy(): Promise<void> {
		await Promise.all(transports.map(t => t.destroy()));
	}

	/**
	 * Read all JSON log files for every transport, stream parsed events back
	 * to the caller in batches, then report summary statistics.
	 *
	 * Uses readline + createReadStream so the main thread event loop is never
	 * blocked while reading large log directories.
	 *
	 * `hydrateFromLogsIterator` composes per-transport generators with
	 * `yield*` so the control flow remains linear and each layer of
	 * abstraction handles a single concern.
	 */
	async function startHydration(onBatch: (events: TrackerEvent[]) => void, onDone: (stats: { loaded: number; skippedMalformed: number; skippedInvalid: number; limitReached: boolean }) => void, maxBytesPerTransport = 50 * 1024 * 1024, batchSize = 200): Promise<void> {
		for await (const chunk of hydrateFromLogsIterator(transportConfigs, maxBytesPerTransport, batchSize)) {
			if (chunk.type === 'batch') {
				onBatch(chunk.events);
			} else {
				onDone(chunk.stats);
			}
		}
	}

	return {
		debug: (msg: string) => minLevel <= LEVELS.debug && console.debug(`${prefix} ${msg}`),
		info: (msg: string) => minLevel <= LEVELS.info && console.info(`${prefix} ${msg}`),
		warn: (msg: string) => minLevel <= LEVELS.warn && console.warn(`${prefix} ${msg}`),
		error: (msg: string) => minLevel <= LEVELS.error && console.error(`${prefix} ${msg}`),
		writeEvent,
		destroy,
		startHydration
	}
}
