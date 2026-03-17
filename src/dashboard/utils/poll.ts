import { PollHandle, PollOptions } from "@tracker/types";

/**
* Cursor-based polling engine.
*
* Polls an endpoint every `intervalMs` milliseconds.
* Uses a timestamp cursor (?after=ISO) so each response contains
* only events newer than the last received one: no re-fetching.
*
* The cursor is reset when the time range changes (full reload).
*
* Handles OpenShift's 30s connection timeout by keeping intervals
* at 3s (well under the limit) and using standard fetch (not SSE).
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
