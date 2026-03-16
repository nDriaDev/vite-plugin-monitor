import { Worker } from 'node:worker_threads';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Logger, LoggingOptions, LogLevel, TrackerEvent } from '../types';

const LEVELS: Record<LogLevel, number> = {
	debug: 0,
	info:  1,
	warn:  2,
	error: 3,
}

/**
* INFO Worker path resolution
* Works for both CJS (__dirname) and ESM (import.meta.url)
* tsdown compiles to both targets, so we try ESM first.
*/
function workerScriptPath(): string {
	try {
		const __filename = fileURLToPath(import.meta.url);
		return path.join(path.dirname(__filename), 'plugin', 'logger-worker.js');
	} catch {
		// eslint-disable-next-line @typescript-eslint/no-var-requires, no-undef
		return path.join(__dirname, 'plugin', 'logger-worker.js');
	}
}

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
export function createLogger(loggingOpts?: LoggingOptions): Logger {
	const minLevel = LEVELS[loggingOpts?.level ?? 'info'];

	const transports = loggingOpts?.transports ?? [
		{
			format:   'json' as const,
			path:     './logs/tracker.log',
			rotation: { strategy: 'daily' as const, maxFiles: 30, compress: false },
		}
	];

	let worker: Worker | null = null;
	let workerReady = false;
	let pendingEvents: TrackerEvent[] = [];  // INFO buffered while worker is starting

	/**
	 * INFO Worker lifecycle
	 * Spawned lazily on first writeEvent() call to avoid creating it during
	 * module evaluation (before Vite's configResolved has set the CWD).
	 */
	function spawnWorker(): Worker {
		if (worker) {
			return worker;
		}

		worker = new Worker(workerScriptPath(), {
			workerData: { transports, minLevel },
		});

		worker.on('message', (msg: { type: string; message?: string }) => {
			if (msg.type === 'ready') {
				workerReady = true;
				// INFO Drain any events that arrived before the worker was ready
				for (const event of pendingEvents) {
					worker!.postMessage({ type: 'write', event });
				}
				pendingEvents = [];
			}
			if (msg.type === 'error') {
				console.error('[vite-plugin-monitor] Logger worker error:', msg.message);
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
			// INFO Worker thread is starting — buffer until 'ready' is received
			pendingEvents.push(event);
			return;
		}

		// INFO postMessage is async and zero-copy for plain JSON objects. The structured-clone algorithm runs in the background — no blocking here.
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
			setTimeout(resolve, 3000);  // INFO safety — don't hang Vite shutdown
		})

		worker = null;
		workerReady = false;
	}

	// INFO Console logger (plugin messages, not event data)
	const prefix = '\x1b[36m[vite-plugin-monitor]\x1b[0m'
	return {
		debug: (msg: string) => minLevel <= LEVELS.debug && console.debug(`${prefix} ${msg}`),
		info: (msg: string) => minLevel <= LEVELS.info && console.info(`${prefix} ${msg}`),
		warn: (msg: string) => minLevel <= LEVELS.warn && console.warn(`${prefix} ${msg}`),
		error: (msg: string) => minLevel <= LEVELS.error && console.error(`${prefix} ${msg}`),
		writeEvent,
		destroy,
	}
}
