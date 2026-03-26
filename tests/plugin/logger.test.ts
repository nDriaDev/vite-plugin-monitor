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
		it('debug() scrive su console.debug quando minLevel è debug', () => {
			const spy = vi.spyOn(console, 'debug').mockImplementation(() => { });
			const logger = createLogger({ level: 'debug' });
			logger.debug('test debug');
			expect(spy).toHaveBeenCalledOnce();
			expect(spy.mock.calls[0][0]).toContain('test debug');
		});

		it('debug() non scrive quando minLevel è info', () => {
			const spy = vi.spyOn(console, 'debug').mockImplementation(() => { });
			const logger = createLogger({ level: 'info' });
			logger.debug('silent');
			expect(spy).not.toHaveBeenCalled();
		});

		it('info() scrive su console.info', () => {
			const spy = vi.spyOn(console, 'info').mockImplementation(() => { });
			const logger = createLogger({ level: 'info' });
			logger.info('test info');
			expect(spy).toHaveBeenCalledOnce();
		});

		it('warn() scrive su console.warn', () => {
			const spy = vi.spyOn(console, 'warn').mockImplementation(() => { });
			const logger = createLogger({ level: 'info' });
			logger.warn('test warn');
			expect(spy).toHaveBeenCalledOnce();
		});

		it('error() scrive su console.error', () => {
			const spy = vi.spyOn(console, 'error').mockImplementation(() => { });
			const logger = createLogger({ level: 'info' });
			logger.error('test error');
			expect(spy).toHaveBeenCalledOnce();
		});

		it('warn() non scrive se minLevel è error', () => {
			const spy = vi.spyOn(console, 'warn').mockImplementation(() => { });
			const logger = createLogger({ level: 'error' });
			logger.warn('silent warn');
			expect(spy).not.toHaveBeenCalled();
		});

		it('il messaggio include il prefix [vite-plugin-monitor]', () => {
			const spy = vi.spyOn(console, 'info').mockImplementation(() => { });
			const logger = createLogger({ level: 'info' });
			logger.info('ciao');
			expect(spy.mock.calls[0][0]).toContain('[vite-plugin-monitor]');
		});
	});

	describe('writeEvent() — lazy worker spawn', () => {
		it('non spawna il worker finché non viene chiamato writeEvent()', () => {
			createLogger({ level: 'info' });
			expect(MockWorker.instances).toHaveLength(0);
		});

		it('spawna il worker alla prima chiamata writeEvent()', () => {
			const logger = createLogger({ level: 'info' });
			logger.writeEvent(makeEvent());
			expect(MockWorker.instances).toHaveLength(1);
		});

		it('non spawna un secondo worker alla seconda chiamata', () => {
			const logger = createLogger({ level: 'info' });
			logger.writeEvent(makeEvent());
			logger.writeEvent(makeEvent());
			expect(MockWorker.instances).toHaveLength(1);
		});

		it('buffering: event scritto prima del "ready" viene bufferizzato', () => {
			const logger = createLogger({ level: 'info' });
			const ev = makeEvent();
			logger.writeEvent(ev);
			const worker = MockWorker.latest()!;
			expect(worker.postMessage).not.toHaveBeenCalled();
		});

		it('dopo il "ready" vengono drainati gli eventi bufferizzati', () => {
			const logger = createLogger({ level: 'info' });
			const ev = makeEvent();
			logger.writeEvent(ev);

			const worker = MockWorker.latest()!;
			worker.simulateReady();

			expect(worker.postMessage).toHaveBeenCalledWith({ type: 'write', event: ev });
		});

		it('dopo il "ready" writeEvent invia direttamente postMessage', () => {
			const logger = createLogger({ level: 'info' });
			logger.writeEvent(makeEvent());
			const worker = MockWorker.latest()!;
			worker.simulateReady();
			worker.postMessage.mockClear();

			const ev2 = makeEvent({ level: 'warn' });
			logger.writeEvent(ev2);
			expect(worker.postMessage).toHaveBeenCalledWith({ type: 'write', event: ev2 });
		});

		it('evento sotto minLevel viene ignorato (nessun spawn)', () => {
			const logger = createLogger({ level: 'error' });
			logger.writeEvent(makeEvent({ level: 'info' }));
			expect(MockWorker.instances).toHaveLength(0);
		});

		it('evento al livello minLevel viene scritto', () => {
			const logger = createLogger({ level: 'warn' });
			const ev = makeEvent({ level: 'warn' });
			logger.writeEvent(ev);
			const worker = MockWorker.latest()!;
			worker.simulateReady();
			expect(worker.postMessage).toHaveBeenCalledWith({ type: 'write', event: ev });
		});
	});

	describe('worker lifecycle', () => {
		it('messaggio "error" dal worker scrive su console.error', () => {
			const spy = vi.spyOn(console, 'error').mockImplementation(() => { });
			const logger = createLogger({ level: 'info' });
			logger.writeEvent(makeEvent());
			const worker = MockWorker.latest()!;
			worker.simulateError('disk full');
			expect(spy).toHaveBeenCalledWith(
				expect.stringContaining('[vite-plugin-monitor]'),
				'disk full'
			);
		});

		it('crash del worker (evento "error") logga e resetta il riferimento interno', () => {
			const spy = vi.spyOn(console, 'error').mockImplementation(() => { });
			const logger = createLogger({ level: 'info' });
			logger.writeEvent(makeEvent());
			const worker = MockWorker.latest()!;
			worker.simulateCrash(new Error('crashed'));
			expect(spy).toHaveBeenCalled();
			logger.writeEvent(makeEvent());
			expect(MockWorker.instances).toHaveLength(2);
		});

		it('exit con code !== 0 scrive su console.warn', () => {
			const spy = vi.spyOn(console, 'warn').mockImplementation(() => { });
			const logger = createLogger({ level: 'info' });
			logger.writeEvent(makeEvent());
			const worker = MockWorker.latest()!;
			worker.simulateExit(1);
			expect(spy).toHaveBeenCalledWith(expect.stringContaining('code 1'));
		});

		it('exit con code 0 non scrive su console.warn', () => {
			const spy = vi.spyOn(console, 'warn').mockImplementation(() => { });
			const logger = createLogger({ level: 'info' });
			logger.writeEvent(makeEvent());
			const worker = MockWorker.latest()!;
			worker.simulateExit(0);
			expect(spy).not.toHaveBeenCalled();
		});
	});

	describe('destroy()', () => {
		it('se il worker non è mai stato spawnato, destroy() risolve subito', async () => {
			const logger = createLogger({ level: 'info' });
			await expect(logger.destroy()).resolves.toBeUndefined();
		});

		it('invia { type: "destroy" } al worker', async () => {
			const logger = createLogger({ level: 'info' });
			logger.writeEvent(makeEvent());
			const worker = MockWorker.latest()!;
			worker.simulateReady();

			const destroyPromise = logger.destroy();
			worker.simulateExit(0);
			await destroyPromise;

			expect(worker.postMessage).toHaveBeenCalledWith({ type: 'destroy' });
		});

		it('draina eventi pendenti prima di inviare destroy', async () => {
			const logger = createLogger({ level: 'info' });
			const ev = makeEvent();
			logger.writeEvent(ev);

			const worker = MockWorker.latest()!;
			const destroyPromise = logger.destroy();
			worker.simulateExit(0);
			await destroyPromise;

			expect(worker.postMessage).toHaveBeenCalledWith({ type: 'write', event: ev });
		});

		it('destroy() risolve entro il timeout di sicurezza (3s) anche senza exit', async () => {
			vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
			const logger = createLogger({ level: 'info' });
			logger.writeEvent(makeEvent());
			const worker = MockWorker.latest()!;
			worker.simulateReady();

			const destroyPromise = logger.destroy();
			vi.advanceTimersByTime(3000);
			await destroyPromise;

			vi.useRealTimers();
		});
	});

	describe('workerData passato al costruttore Worker', () => {
		it('passa i transports corretti al worker', () => {
			const transport = {
				format: 'json' as const,
				path: './logs/test.log',
				rotation: { strategy: 'daily' as const, maxFiles: 10, compress: false },
			}
			const logger = createLogger({ level: 'info', transports: [transport] });
			logger.writeEvent(makeEvent());

			const worker = MockWorker.latest()!;
			const workerData = worker.workerData as { transports: unknown[]; minLevel: number };
			expect(workerData.transports).toEqual([transport]);
		});

		it('passa minLevel numerico corretto (info = 1)', () => {
			const logger = createLogger({ level: 'info' });
			logger.writeEvent(makeEvent());
			const worker = MockWorker.latest()!;
			const workerData = worker.workerData as { transports: unknown[]; minLevel: number };
			expect(workerData.minLevel).toBe(1);
		});

		it('passa minLevel numerico corretto (debug = 0)', () => {
			const logger = createLogger({ level: 'debug' });
			logger.writeEvent(makeEvent());
			const worker = MockWorker.latest()!;
			const workerData = worker.workerData as { transports: unknown[]; minLevel: number }
			expect(workerData.minLevel).toBe(0);
		});

		it('usa i transports di default se loggingOpts è undefined', () => {
			const logger = createLogger();
			logger.writeEvent(makeEvent());
			const worker = MockWorker.latest()!;
			const workerData = worker.workerData as { transports: { path: string }[]; minLevel: number };
			expect(workerData.transports[0].path).toContain('tracker.log');
		});
	});
});
