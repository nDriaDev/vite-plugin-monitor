import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createPoller } from '../../../src/dashboard/utils/poll';

describe('createPoller', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('executes onTick immediately on creation', async () => {
		const onTick = vi.fn().mockResolvedValue(null);
		const poller = createPoller({ intervalMs: 1000, onTick });
		await Promise.resolve();
		expect(onTick).toHaveBeenCalledOnce();
		poller.stop();
	});

	it('refresh on tick running', async () => {
		const onTick = vi.fn().mockResolvedValue(null);
		const poller = createPoller({ intervalMs: 1000, onTick });
		poller.refresh();
		await Promise.resolve();
		expect(onTick).toHaveBeenCalledOnce();
		poller.stop();
	});

	it('run onTick again after the interval', async () => {
		const onTick = vi.fn().mockResolvedValue(null);
		const poller = createPoller({ intervalMs: 1000, onTick });
		await Promise.resolve();
		vi.advanceTimersByTime(1000);
		await Promise.resolve();
		expect(onTick).toHaveBeenCalledTimes(2);
		poller.stop();
	});

	it('stop() stops future ticks', async () => {
		const onTick = vi.fn().mockResolvedValue(null);
		const poller = createPoller({ intervalMs: 500, onTick });
		await Promise.resolve();
		poller.stop();
		vi.advanceTimersByTime(2000);
		await Promise.resolve();
		expect(onTick).toHaveBeenCalledOnce();
	});

	it('does not execute overlapping ticks when the previous is still in flight (inFlight)', async () => {
		let resolve!: (value: void | PromiseLike<void>) => void;
		const slowTick = vi.fn().mockImplementation(() => new Promise<void>(r => { resolve = r; }));
		const poller = createPoller({ intervalMs: 100, onTick: slowTick });
		vi.advanceTimersByTime(200);
		await Promise.resolve();
		expect(slowTick).toHaveBeenCalledOnce();
		resolve();
		await Promise.resolve();
		await Promise.resolve();
		poller.stop();
	});

	it('calls onError when onTick throws an error', async () => {
		const onError = vi.fn();
		const onTick = vi.fn().mockRejectedValue(new Error('fail'));
		const poller = createPoller({ intervalMs: 1000, onTick, onError });
		await Promise.resolve();
		await Promise.resolve();
		expect(onError).toHaveBeenCalledWith(expect.any(Error));
		poller.stop();
	});

	it('updates the cursor when onTick returns a non-empty string', async () => {
		const onTick = vi.fn()
			.mockResolvedValueOnce('cursor-1')
			.mockResolvedValue(null);
		const poller = createPoller({ intervalMs: 500, onTick });
		await Promise.resolve();
		vi.advanceTimersByTime(500);
		await Promise.resolve();
		await Promise.resolve();
		expect(onTick).toHaveBeenNthCalledWith(2, 'cursor-1');
		poller.stop();
	});

	it('resetCursor() resets the cursor on the next tick', async () => {
		const onTick = vi.fn()
			.mockResolvedValueOnce('cursor-abc')
			.mockResolvedValue(null);
		const poller = createPoller({ intervalMs: 500, onTick });
		await Promise.resolve();
		poller.resetCursor();
		vi.advanceTimersByTime(500);
		await Promise.resolve();
		await Promise.resolve();
		expect(onTick).toHaveBeenNthCalledWith(2, null);
		poller.stop();
	});

	it('refresh() cancels the pending timer and immediately starts a new tick', async () => {
		const onTick = vi.fn().mockResolvedValue(null);
		const poller = createPoller({ intervalMs: 5000, onTick });
		await Promise.resolve();
		const callsBefore = onTick.mock.calls.length;
		poller.refresh();
		await Promise.resolve();
		expect(onTick).toHaveBeenCalledTimes(callsBefore + 1);
		poller.stop();
	});
});
