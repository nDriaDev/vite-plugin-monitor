/* eslint-disable @typescript-eslint/no-floating-promises */
/* eslint-disable @typescript-eslint/no-misused-promises */
/* eslint-disable no-undef */
import type { PollHandle, PollOptions } from "@tracker/types";

/**
* setTimeout-based polling engine.
*
* Polls at a fixed interval. The next tick is scheduled only after the
* previous `onTick` promise resolves, so ticks never pile up on slow backends.
*
* `onTick` receives a cursor (always `null` in current usage) and may return
* a non-null string to advance it for future incremental fetches : this path
* is unused by the built-in dashboard, which always fetches the full time
* window from the backend and returns `null`. The cursor mechanism is retained
* for extensibility.
*
* `resetCursor()` resets the cursor to `null` without triggering an immediate
* tick. Use it when the active time range changes and the next tick should
* perform a full reload.
*/
export function createPoller(opts: PollOptions): PollHandle {
	let cursor: string | null = null;
	let timerId: ReturnType<typeof setTimeout> | null = null;
	let running = true;
	let inFlight = false;

	async function tick() {
		if (!running || inFlight) {
			return;
		}
		inFlight = true;
		try {
			const newCursor = await opts.onTick(cursor);
			if (newCursor) {
				cursor = newCursor;
			}
		} catch (err) {
			opts.onError?.(err);
		} finally {
			inFlight = false;
			if (running) {
				schedule();
			}
		}
	}

	function schedule() {
		timerId = setTimeout(tick, opts.intervalMs);
	}

	function refresh() {
		if (timerId) {
			clearTimeout(timerId);
			timerId = null;
		}
		tick();
	}

	function resetCursor() {
		cursor = null;
	}

	function stop() {
		running = false;
		if (timerId) {
			clearTimeout(timerId);
			timerId = null;
		}
	}

	tick();

	return { refresh, resetCursor, stop }
}
