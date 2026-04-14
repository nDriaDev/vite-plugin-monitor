import type { CleanupFn } from "@tracker/types";

const HOOKS_KEY = '__tracker_shutdown_hooks__';
const HANDLER_KEY = '__tracker_shutdown_installed__';

function getHooks(): Array<CleanupFn> {
	if (!globalThis[HOOKS_KEY]) {
		globalThis[HOOKS_KEY] = [];
	}
	return globalThis[HOOKS_KEY]!;
}

function installHandlers(): void {
	if (globalThis[HANDLER_KEY]) {
		return;
	}
	globalThis[HANDLER_KEY] = true;

	for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) {
		process.on(signal, () => {
			// INFO Prevent the handler from firing twice if both SIGINT and SIGTERM arrive in quick succession (e.g. double Ctrl+C).
			if ((process as any).__tracker_shutting_down__) {
				return;
			}
			(process as any).__tracker_shutting_down__ = true;
			runShutdown(signal).catch(() => process.exit(1));
		});
	}
}

/**
 * Process-level singleton
 *
 * @remarks
 * We store state on `process` itself so it survives across HMR re-evaluations
 * of this module (Vite may re-import the plugin on config changes).
 */
async function runShutdown(signal: string): Promise<void> {
	const hooks = getHooks();

	/* v8 ignore start */
	if (hooks.length === 0) {
		process.exit(0);
	}
	/* v8 ignore stop */

	/**
	 * INFO
	 * Each hook gets its own 4-second per-hook deadline so that a single slow
	 * cleanup (e.g. a logger flush on a slow disk) cannot exhaust the entire
	 * process budget and cause every other hook to be silently skipped.
	 * The outer 5-second process-level deadline remains as a final safety net.
	 */
	const PER_HOOK_TIMEOUT_MS = 4000;
	const OVERALL_DEADLINE_MS = 5000;

	function runWithTimeout(fn: CleanupFn): Promise<void> {
		return new Promise<void>((resolve) => {
			const t = setTimeout(() => {
				console.warn('[vite-plugin-monitor] A shutdown hook timed out and was skipped');
				resolve();
			}, PER_HOOK_TIMEOUT_MS);
			// INFO .unref() so the timer does not keep Node alive on its own
			if (typeof t.unref === 'function') {
				t.unref();
			}
			try {
				Promise.resolve(fn()).then(resolve, resolve);
			} catch {
				resolve();
			}
		});
	}

	const deadline = new Promise<void>((resolve) => {
		setTimeout(() => {
			console.warn('[vite-plugin-monitor] Shutdown deadline exceeded - forcing exit');
			resolve();
		}, OVERALL_DEADLINE_MS).unref();
	});

	await Promise.race([
		Promise.allSettled(hooks.map(runWithTimeout)),
		deadline,
	]);

	/**
	 * INFO
	 * Re-raise the signal with the default handler so the process exits
	 * with the correct signal code.
	 */
	process.removeAllListeners(signal);
	process.kill(process.pid, signal);
}

/**
* shutdown.ts - Graceful process termination for plugin.
*
* Problem: When the user kills the Vite process
* (Ctrl+C, `kill <pid>`, systemd stopping the service, etc.) the normal cleanup path
* is never taken, which means:
*
*   1. The logger worker thread is killed mid-write - the last batch of
*      events may be half-written (corrupted JSONL line) or lost entirely.
*
*   2. The standalone HTTP server's socket remains open until the OS reclaims
*      it, causing "EADDRINUSE" on the next `vite dev` if the port lingers.
*
*   3. Active HTTP keep-alive connections to the standalone server are
*      dropped without a response, which can confuse the browser client.
*
* Solution: register ONE shared signal handler per process (not per plugin
* instance) that runs all registered cleanup callbacks in order and then
* exits with the correct code/signal.
*
* Signals handled:
*   SIGTERM - `kill <pid>`, systemd, Docker stop, Kubernetes pod termination
*   SIGINT  - Ctrl+C (Vite also handles this, but we register after it so
*             we run first via the listeners stack)
*   SIGHUP  - terminal closed, nohup restart
*
* SIGKILL cannot be caught - that is by design in POSIX.
*
* @remarks
* Register a cleanup callback that will be called when the process receives
* SIGTERM, SIGINT, or SIGHUP.
*
* Returns an `unregister` function - call it when the plugin is destroyed
* (e.g. on HMR re-evaluation) to avoid accumulating stale closures.
*
* @example
* const unregister = registerShutdownHook(async () => {
*   standalone?.stop()
*   await logger.destroy()
* })
*
* // on HMR:
* import.meta.hot?.dispose(unregister)
*/
export function registerShutdownHook(fn: CleanupFn): () => void {
	installHandlers();

	const hooks = getHooks();

	if (!hooks.includes(fn)) {
		hooks.push(fn);
	}

	return function unregister() {
		const idx = hooks.indexOf(fn);
		if (idx !== -1) {
			hooks.splice(idx, 1);
		}
	}
}
