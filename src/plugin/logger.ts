/* eslint-disable no-unused-vars */
/* eslint-disable no-undef */
import { Worker } from 'node:worker_threads';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Logger, LoggingOptions, LogLevel, TrackerEvent } from '../types';

const LEVELS: Record<LogLevel, number> = {
	debug: 0,
	info: 1,
	warn: 2,
	error: 3,
}

/* v8 ignore start */
/**
* INFO Worker path resolution
* Works for both CJS (__dirname) and ESM (import.meta.url)
* tsdown compiles to both targets, so we try ESM first.
*/
const WORKER_SCRIPT_PATH: string = (() => {
	try {
		const __filename = fileURLToPath(import.meta.url);
		return path.join(path.dirname(__filename), 'plugin', 'logger-worker.js');
	} catch {
		return path.join(__dirname, 'plugin', 'logger-worker.cjs');
	}
})();
/* v8 ignore stop */

/**
* logger.ts - Plugin-side logger.
*
* @remarks
* All file I/O (fs.WriteStream, rotation, cleanup) is delegated to a
* dedicated Worker Thread (logger-worker.ts). The main thread only calls
* worker.postMessage() which is non-blocking and zero-copy for plain objects.
*
* This avoid stream backpressure and the synchronous fs calls of rotation.
* The worker receives events through the structured-clone algorithm,
* which is async and zero-cost for plain JSON objects.
*
* The console logger (debug/info/warn/error) stays on the main thread
* because it is used for Vite plugin messages, not event data.
*/
export function createLogger(appId: string, loggingOpts?: LoggingOptions): Logger {
	const minLevel = LEVELS[loggingOpts?.level ?? 'info'];

	const transports = loggingOpts?.transports ?? [
		{
			format: 'json' as const,
			path: `./logs/${appId}.log`,
			rotation: { strategy: 'daily' as const, maxFiles: 30, compress: false },
		}
	];

	let worker: Worker | null = null;
	let workerReady = false;
	let pendingEvents: TrackerEvent[] = [];

	let hydrationOnBatch: ((events: TrackerEvent[]) => void) | null = null;
	let hydrationOnDone: ((stats: { loaded: number; skippedMalformed: number; skippedInvalid: number; limitReached: boolean }) => void) | null = null;

	/**
	 * INFO Worker lifecycle
	 * Spawned lazily on first writeEvent() call to avoid creating it during
	 * module evaluation (before Vite's configResolved has set the CWD).
	 */
	function spawnWorker(): Worker {
		if (worker) {
			return worker;
		}

		worker = new Worker(WORKER_SCRIPT_PATH, {
			workerData: { transports, minLevel },
		});

		worker.on('message', (msg: { type: string, message?: string, events?: TrackerEvent[], loaded?: number, skippedMalformed?: number, skippedInvalid?: number, limitReached?: boolean }) => {
			if (msg.type === 'ready') {
				workerReady = true;
				for (const event of pendingEvents) {
					worker!.postMessage({ type: 'write', event });
				}
				pendingEvents = [];
			}
			if (msg.type === 'error') {
				console.error('[vite-plugin-monitor] Logger worker error:', msg.message);
			}
			if (msg.type === 'hydrate:batch' && msg.events && hydrationOnBatch) {
				hydrationOnBatch(msg.events);
			}
			if (msg.type === 'hydrate:done') {
				if (hydrationOnDone) {
					hydrationOnDone({
						loaded: msg.loaded ?? 0,
						skippedMalformed: msg.skippedMalformed ?? 0,
						skippedInvalid: msg.skippedInvalid ?? 0,
						limitReached: msg.limitReached ?? false,
					});
				}
				hydrationOnBatch = null;
				hydrationOnDone = null;
			}
		});

		worker.on('error', (err) => {
			console.error('[vite-plugin-monitor] Logger worker crashed:', err);
			worker = null;
			workerReady = false;
		});

		worker.on('exit', (code) => {
			if (code !== 0) {
				console.warn(`[vite-plugin-monitor] Logger worker exited with code ${code}`);
			}
			worker = null;
			workerReady = false;
		});

		return worker;
	}

	function writeEvent(event: TrackerEvent): void {
		if (LEVELS[event.level] < minLevel) {
			return;
		}

		const w = spawnWorker();

		if (!workerReady) {
			// INFO Worker thread is starting - buffer until 'ready' is received
			pendingEvents.push(event);
			return;
		}

		w.postMessage({ type: 'write', event });
	}

	/**
	 * Graceful shutdown
	 *
	 * @remarks
	 * Sends 'destroy' to the worker, which flushes + closes all streams and then calls process.exit(0).
	 * We await exit with a 3-second safety timeout. Called once from closeBundle() so blocking
	 * for up to 3s is acceptable.
	 */
	async function destroy(): Promise<void> {
		// INFO Flush any remaining buffered events before signalling destroy
		if (worker && pendingEvents.length > 0) {
			for (const event of pendingEvents) {
				worker.postMessage({ type: 'write', event });
			}
			pendingEvents = [];
		}

		if (!worker) {
			return;
		}

		worker.postMessage({ type: 'destroy' });

		await new Promise<void>((resolve) => {
			worker!.once('exit', resolve);
			setTimeout(resolve, 3000);  // INFO safety - don't hang Vite shutdown
		});

		worker = null;
		workerReady = false;
	}

	function destroyForHmr(): void {
		if (!worker) {
			return;
		}
		if (pendingEvents.length > 0) {
			for (const event of pendingEvents) {
				worker.postMessage({ type: 'write', event });
			}
			pendingEvents = [];
		}
		worker.postMessage({ type: 'destroy' });
		worker = null;
		workerReady = false;
	}

	function startHydration(
		onBatch: (events: TrackerEvent[]) => void,
		onDone: (stats: { loaded: number; skippedMalformed: number; skippedInvalid: number; limitReached: boolean }) => void,
		maxBytesPerTransport = 50 * 1024 * 1024,
		batchSize = 200
	): void {
		hydrationOnBatch = onBatch;
		hydrationOnDone = onDone;

		const w = spawnWorker();
		const send = () => w.postMessage({ type: 'hydrate', maxBytesPerTransport, batchSize });

		if (workerReady) {
			send();
		} else {
			const intervalId = setInterval(() => {
				// INFO Worker was destroyed before becoming ready (e.g. very fast HMR) — bail out cleanly.
				if (!worker) {
					clearInterval(intervalId);
					return;
				}
				if (workerReady) {
					clearInterval(intervalId);
					send();
				}
			}, 8);
		}
	}

	const prefix = '\x1b[36m[vite-plugin-monitor]\x1b[0m';
	return {
		debug: (msg: string) => minLevel <= LEVELS.debug && console.debug(`${prefix} ${msg}`),
		info: (msg: string) => minLevel <= LEVELS.info && console.info(`${prefix} ${msg}`),
		warn: (msg: string) => minLevel <= LEVELS.warn && console.warn(`${prefix} ${msg}`),
		error: (msg: string) => minLevel <= LEVELS.error && console.error(`${prefix} ${msg}`),
		writeEvent,
		destroy,
		destroyForHmr,
		startHydration,
	}
}
