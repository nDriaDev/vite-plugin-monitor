/**
* Configuration passed to `createPoller()` to start a polling loop.
*
* @remarks
* Uses `setTimeout` (not `setInterval`) so ticks never overlap: the next tick
* is scheduled only after `onTick` resolves. This prevents pileup on slow backends.
*
*/
interface PollOptions {
	/**
	* Time in milliseconds to wait between the end of one tick and the start of the next.
	*
	* @remarks
	* Effective interval = `intervalMs + onTick duration`. For fast backends the
	* difference is imperceptible; for slow ones, the poller self-throttles.
	*
	* @default 3000
	*/
	intervalMs: number

	/**
	* Async function executed on every tick.
	*
	* @remarks
	* Receives the current cursor (`null` on the first tick or after `resetCursor()`).
	* Must return the new cursor or `null` to request a full reload on the next tick.
	* Throwing is safe — errors are forwarded to `onError` and the loop continues.
	*
	* @param cursor - Timestamp cursor from the previous tick, or `null`.
	* @returns New cursor, or `null` to reset.
	*/
	onTick: (cursor: string | null) => Promise<string | null>

	/**
	* Called when `onTick` throws. The loop continues after an error.
	*
	* @param err - The thrown value (may not be an `Error` instance).
	*/
	onError?: (err: unknown) => void
}

/**
* Handle returned by `createPoller()` for controlling a running poll loop.
*
* @remarks
* All methods are safe to call from any context. `stop()` is idempotent.
*
*/
interface PollHandle {
	/**
	* Immediately trigger one tick outside the normal interval, then resume normally.
	*
	* @remarks
	* Useful after a user action known to have produced new backend data, to avoid
	* waiting for the next scheduled tick.
	*/
	refresh(): void

	/**
	* Reset the cursor to `null` so the next tick performs a full data reload.
	*
	* @remarks
	* Does not immediately trigger a tick. Use after a filter change that
	* invalidates the current event list.
	*/
	resetCursor(): void

	/**
	* Permanently stop the poll loop and cancel any pending timer.
	*
	* @remarks
	* The instance cannot be restarted after `stop()`. Create a new `createPoller()`
	* instance to resume. Safe to call multiple times — subsequent calls are no-ops.
	*/
	stop(): void
}

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
