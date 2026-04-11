import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createLogger } from '../../src/plugin/logger';
import type { TrackerEvent } from '../../src/types';

vi.mock('node:worker_threads', () => {
	return {
		Worker: MockWorkerCtor,
	}
});

type EventHandler = (...args: unknown[]) => void;

class MockWorker {
	static instances: MockWorker[] = [];

	workerData: unknown;
	private listeners = new Map<string, EventHandler[]>();
	postMessage = vi.fn();

	constructor(_path: string, opts: { workerData: unknown }) {
		this.workerData = opts.workerData;
		MockWorker.instances.push(this);
	}

	on(event: string, handler: EventHandler) {
		if (!this.listeners.has(event)) {
			this.listeners.set(event, []);
		}
		this.listeners.get(event)!.push(handler);
	}

	once(event: string, handler: EventHandler) {
		const wrapper: EventHandler = (...args) => {
			this.off(event, wrapper);
			handler(...args);
		}
		this.on(event, wrapper);
	}

	off(event: string, handler: EventHandler) {
		const list = this.listeners.get(event) ?? [];
		this.listeners.set(event, list.filter(h => h !== handler));
	}

	emit(event: string, ...args: unknown[]) {
		for (const h of this.listeners.get(event) ?? []) {
			h(...args);
		}
	}

	simulateReady() {
		this.emit('message', { type: 'ready' });
	}

	simulateError(msg: string) {
		this.emit('message', { type: 'error', message: msg });
	}

	simulateCrash(err: Error) {
		this.emit('error', err);
	}

	simulateExit(code: number) {
		this.emit('exit', code);
	}

	static latest() {
		return MockWorker.instances.at(-1);
	}
	static reset() {
		MockWorker.instances = [];
	}
}

function MockWorkerCtor(path: string, opts: { workerData: unknown }) {
	return new MockWorker(path, opts);
}
MockWorkerCtor.prototype = MockWorker.prototype;
(MockWorkerCtor as any).instances = MockWorker.instances;

function makeEvent(overrides: Partial<TrackerEvent> = {}): TrackerEvent {
	return {
		type: 'console',
		level: 'info',
		timestamp: new Date().toISOString(),
		appId: 'test-app',
		sessionId: 'sess_test',
		userId: null,
		payload: { message: 'hello' },
		...overrides,
	} as TrackerEvent;
}

beforeEach(() => {
	MockWorker.reset();
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('createLogger()', () => {
	describe('console methods (main thread)', () => {
		it('debug() writes to console.debug when minLevel is debug', () => {
			const spy = vi.spyOn(console, 'debug').mockImplementation(() => { });
			const logger = createLogger("test-app", { level: 'debug' });
			logger.debug('test debug');
			expect(spy).toHaveBeenCalledOnce();
			expect(spy.mock.calls[0][0]).toContain('test debug');
		});

		it('debug() does not write when minLevel is info', () => {
			const spy = vi.spyOn(console, 'debug').mockImplementation(() => { });
			const logger = createLogger("test-app", { level: 'info' });
			logger.debug('silent');
			expect(spy).not.toHaveBeenCalled();
		});

		it('info() writes to console.info', () => {
			const spy = vi.spyOn(console, 'info').mockImplementation(() => { });
			const logger = createLogger("test-app", { level: 'info' });
			logger.info('test info');
			expect(spy).toHaveBeenCalledOnce();
		});

		it('warn() writes to console.warn', () => {
			const spy = vi.spyOn(console, 'warn').mockImplementation(() => { });
			const logger = createLogger("test-app", { level: 'info' });
			logger.warn('test warn');
			expect(spy).toHaveBeenCalledOnce();
		});

		it('error() writes to console.error', () => {
			const spy = vi.spyOn(console, 'error').mockImplementation(() => { });
			const logger = createLogger("test-app", { level: 'info' });
			logger.error('test error');
			expect(spy).toHaveBeenCalledOnce();
		});

		it('warn() does not write when minLevel is error', () => {
			const spy = vi.spyOn(console, 'warn').mockImplementation(() => { });
			const logger = createLogger("test-app", { level: 'error' });
			logger.warn('silent warn');
			expect(spy).not.toHaveBeenCalled();
		});

		it('the message includes the prefix [vite-plugin-monitor]', () => {
			const spy = vi.spyOn(console, 'info').mockImplementation(() => { });
			const logger = createLogger("test-app", { level: 'info' });
			logger.info('ciao');
			expect(spy.mock.calls[0][0]).toContain('[vite-plugin-monitor]');
		});
	});

	describe('writeEvent() — lazy worker spawn', () => {
		it('does not spawn the worker until writeEvent() is called', () => {
			createLogger("test-app", { level: 'info' });
			expect(MockWorker.instances).toHaveLength(0);
		});

		it('spawns the worker on the first writeEvent() call', () => {
			const logger = createLogger("test-app", { level: 'info' });
			logger.writeEvent(makeEvent());
			expect(MockWorker.instances).toHaveLength(1);
		});

		it('does not spawn a second worker on the second call', () => {
			const logger = createLogger("test-app", { level: 'info' });
			logger.writeEvent(makeEvent());
			logger.writeEvent(makeEvent());
			expect(MockWorker.instances).toHaveLength(1);
		});

		it('buffering: event written before "ready" is buffered', () => {
			const logger = createLogger("test-app", { level: 'info' });
			const ev = makeEvent();
			logger.writeEvent(ev);
			const worker = MockWorker.latest()!;
			expect(worker.postMessage).not.toHaveBeenCalled();
		});

		it('after "ready" the buffered events are flushed', () => {
			const logger = createLogger("test-app", { level: 'info' });
			const ev = makeEvent();
			logger.writeEvent(ev);

			const worker = MockWorker.latest()!;
			worker.simulateReady();

			expect(worker.postMessage).toHaveBeenCalledWith({ type: 'write', event: ev });
		});

		it('After the "ready" writeEvent, send the postMessage directly.', () => {
			const logger = createLogger("test-app", { level: 'info' });
			logger.writeEvent(makeEvent());
			const worker = MockWorker.latest()!;
			worker.simulateReady();
			worker.postMessage.mockClear();

			const ev2 = makeEvent({ level: 'warn' });
			logger.writeEvent(ev2);
			expect(worker.postMessage).toHaveBeenCalledWith({ type: 'write', event: ev2 });
		});

		it('event below minLevel is ignored (no spawn)', () => {
			const logger = createLogger("test-app", { level: 'error' });
			logger.writeEvent(makeEvent({ level: 'info' }));
			expect(MockWorker.instances).toHaveLength(0);
		});

		it('event at minLevel is written', () => {
			const logger = createLogger("test-app", { level: 'warn' });
			const ev = makeEvent({ level: 'warn' });
			logger.writeEvent(ev);
			const worker = MockWorker.latest()!;
			worker.simulateReady();
			expect(worker.postMessage).toHaveBeenCalledWith({ type: 'write', event: ev });
		});
	});

	describe('worker lifecycle', () => {
		it('"error" message from worker writes to console.error', () => {
			const spy = vi.spyOn(console, 'error').mockImplementation(() => { });
			const logger = createLogger("test-app", { level: 'info' });
			logger.writeEvent(makeEvent());
			const worker = MockWorker.latest()!;
			worker.simulateError('disk full');
			expect(spy).toHaveBeenCalledWith(
				expect.stringContaining('[vite-plugin-monitor]'),
				'disk full'
			);
		});

		it('worker crash ("error" event) log and reset internal reference', () => {
			const spy = vi.spyOn(console, 'error').mockImplementation(() => { });
			const logger = createLogger("test-app", { level: 'info' });
			logger.writeEvent(makeEvent());
			const worker = MockWorker.latest()!;
			worker.simulateCrash(new Error('crashed'));
			expect(spy).toHaveBeenCalled();
			logger.writeEvent(makeEvent());
			expect(MockWorker.instances).toHaveLength(2);
		});

		it('exit with code !== 0 writes to console.warn', () => {
			const spy = vi.spyOn(console, 'warn').mockImplementation(() => { });
			const logger = createLogger("test-app", { level: 'info' });
			logger.writeEvent(makeEvent());
			const worker = MockWorker.latest()!;
			worker.simulateExit(1);
			expect(spy).toHaveBeenCalledWith(expect.stringContaining('code 1'));
		});

		it('exit with code 0 does not write to console.warn', () => {
			const spy = vi.spyOn(console, 'warn').mockImplementation(() => { });
			const logger = createLogger("test-app", { level: 'info' });
			logger.writeEvent(makeEvent());
			const worker = MockWorker.latest()!;
			worker.simulateExit(0);
			expect(spy).not.toHaveBeenCalled();
		});
	});

	describe('destroy()', () => {
		it('when the worker has never been spawned, destroy() resolves immediately', async () => {
			const logger = createLogger("test-app", { level: 'info' });
			await expect(logger.destroy()).resolves.toBeUndefined();
		});

		it('send { type: "destroy" } to the worker', async () => {
			const logger = createLogger("test-app", { level: 'info' });
			logger.writeEvent(makeEvent());
			const worker = MockWorker.latest()!;
			worker.simulateReady();

			const destroyPromise = logger.destroy();
			worker.simulateExit(0);
			await destroyPromise;

			expect(worker.postMessage).toHaveBeenCalledWith({ type: 'destroy' });
		});

		it('drains pending events before sending destroy', async () => {
			const logger = createLogger("test-app", { level: 'info' });
			const ev = makeEvent();
			logger.writeEvent(ev);

			const worker = MockWorker.latest()!;
			const destroyPromise = logger.destroy();
			worker.simulateExit(0);
			await destroyPromise;

			expect(worker.postMessage).toHaveBeenCalledWith({ type: 'write', event: ev });
		});

		it('destroy() resolves within the safety timeout (3s) even without exit', async () => {
			vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
			const logger = createLogger("test-app", { level: 'info' });
			logger.writeEvent(makeEvent());
			const worker = MockWorker.latest()!;
			worker.simulateReady();

			const destroyPromise = logger.destroy();
			vi.advanceTimersByTime(3000);
			await destroyPromise;

			vi.useRealTimers();
		});
	});

	describe('workerData passed to Worker constructor', () => {
		it('passes the correct transports to the worker', () => {
			const transport = {
				format: 'json' as const,
				path: './logs/test.log',
				rotation: { strategy: 'daily' as const, maxFiles: 10, compress: false },
			}
			const logger = createLogger("test-app", { level: 'info', transports: [transport] });
			logger.writeEvent(makeEvent());

			const worker = MockWorker.latest()!;
			const workerData = worker.workerData as { transports: unknown[]; minLevel: number };
			expect(workerData.transports).toEqual([transport]);
		});

		it('passes the correct numeric minLevel (info = 1)', () => {
			const logger = createLogger("test-app", { level: 'info' });
			logger.writeEvent(makeEvent());
			const worker = MockWorker.latest()!;
			const workerData = worker.workerData as { transports: unknown[]; minLevel: number };
			expect(workerData.minLevel).toBe(1);
		});

		it('passes the correct numeric minLevel (debug = 0)', () => {
			const logger = createLogger("test-app", { level: 'debug' });
			logger.writeEvent(makeEvent());
			const worker = MockWorker.latest()!;
			const workerData = worker.workerData as { transports: unknown[]; minLevel: number }
			expect(workerData.minLevel).toBe(0);
		});

		it('uses the default transports when loggingOpts is undefined', () => {
			const logger = createLogger("test-app");
			logger.writeEvent(makeEvent());
			const worker = MockWorker.latest()!;
			const workerData = worker.workerData as { transports: { path: string }[]; minLevel: number };
			expect(workerData.transports[0].path).toContain('test-app.log');
		});
	});

	describe('destroyForHmr()', () => {
		it('does nothing when no worker has been spawned', () => {
			const logger = createLogger("test-app", { level: 'info' });
			expect(() => logger.destroyForHmr()).not.toThrow();
			expect(MockWorker.instances).toHaveLength(0);
		});

		it('sends { type: "destroy" } to the worker and detaches references', () => {
			const logger = createLogger("test-app", { level: 'info' });
			logger.writeEvent(makeEvent());
			const worker = MockWorker.latest()!;
			worker.simulateReady();

			logger.destroyForHmr();

			expect(worker.postMessage).toHaveBeenCalledWith({ type: 'destroy' });
		});

		it('drains pending events before sending destroy', () => {
			const logger = createLogger("test-app", { level: 'info' });
			const ev = makeEvent();
			logger.writeEvent(ev);
			logger.destroyForHmr();
			const worker = MockWorker.latest()!;

			expect(worker.postMessage).toHaveBeenCalledWith({ type: 'write', event: ev });
			expect(worker.postMessage).toHaveBeenCalledWith({ type: 'destroy' });
		});

		it('after destroyForHmr, a new writeEvent spawns a fresh worker', () => {
			const logger = createLogger("test-app", { level: 'info' });
			logger.writeEvent(makeEvent());
			MockWorker.latest()!.simulateReady();

			logger.destroyForHmr();
			logger.writeEvent(makeEvent());

			expect(MockWorker.instances).toHaveLength(2);
		});
	});

	describe('startHydration()', () => {
		it('spawns the worker if not already running', () => {
			const logger = createLogger("test-app", { level: 'info' });
			logger.startHydration(vi.fn(), vi.fn());
			expect(MockWorker.instances).toHaveLength(1);
		});

		it('sends the hydrate message immediately when worker is ready', () => {
			const logger = createLogger("test-app", { level: 'info' });
			logger.writeEvent(makeEvent());
			const worker = MockWorker.latest()!;
			worker.simulateReady();
			worker.postMessage.mockClear();

			logger.startHydration(vi.fn(), vi.fn());

			expect(worker.postMessage).toHaveBeenCalledWith(
				expect.objectContaining({ type: 'hydrate' })
			);
		});

		it('calls onBatch when a hydrate:batch message is received', () => {
			const logger = createLogger("test-app", { level: 'info' });
			logger.writeEvent(makeEvent());
			const worker = MockWorker.latest()!;
			worker.simulateReady();

			const onBatch = vi.fn();
			logger.startHydration(onBatch, vi.fn());

			const events = [makeEvent()];
			worker.emit('message', { type: 'hydrate:batch', events });

			expect(onBatch).toHaveBeenCalledWith(events);
		});

		it('calls onDone with stats when hydrate:done is received', () => {
			const logger = createLogger("test-app", { level: 'info' });
			logger.writeEvent(makeEvent());
			const worker = MockWorker.latest()!;
			worker.simulateReady();

			const onDone = vi.fn();
			logger.startHydration(vi.fn(), onDone);

			worker.emit('message', {
				type: 'hydrate:done',
				loaded: 5,
				skippedMalformed: 1,
				skippedInvalid: 2,
				limitReached: false,
			});

			expect(onDone).toHaveBeenCalledWith({
				loaded: 5,
				skippedMalformed: 1,
				skippedInvalid: 2,
				limitReached: false,
			});
		});

		it('detaches callbacks after hydrate:done so subsequent messages are ignored', () => {
			const logger = createLogger("test-app", { level: 'info' });
			logger.writeEvent(makeEvent());
			const worker = MockWorker.latest()!;
			worker.simulateReady();

			const onBatch = vi.fn();
			logger.startHydration(onBatch, vi.fn());

			worker.emit('message', { type: 'hydrate:done', loaded: 0, skippedMalformed: 0, skippedInvalid: 0, limitReached: false });
			worker.emit('message', { type: 'hydrate:batch', events: [makeEvent()] });

			expect(onBatch).not.toHaveBeenCalled();
		});

		it('clears the polling interval and does not send hydrate if worker is destroyed before ready', async () => {
			vi.useFakeTimers();
			const logger = createLogger("test-app", { level: 'info' });
			logger.startHydration(vi.fn(), vi.fn());
			const worker = MockWorker.latest()!;
			logger.destroyForHmr();

			await vi.advanceTimersByTimeAsync(100);
			expect(worker.postMessage).not.toHaveBeenCalledWith(
				expect.objectContaining({ type: 'hydrate' })
			);

			vi.useRealTimers();
		});

		it('sends hydrate via interval when worker is not yet ready at startHydration time', async () => {
			vi.useFakeTimers();
			const logger = createLogger("test-app", { level: 'info' });
			logger.startHydration(vi.fn(), vi.fn());
			const worker = MockWorker.latest()!;
			worker.simulateReady();
			worker.postMessage.mockClear();
			await vi.advanceTimersByTimeAsync(16);

			expect(worker.postMessage).toHaveBeenCalledWith(
				expect.objectContaining({ type: 'hydrate' })
			);

			vi.useRealTimers();
		});
	});
});
