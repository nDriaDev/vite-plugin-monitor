import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const HOOKS_KEY = '__tracker_shutdown_hooks__';
const HANDLER_KEY = '__tracker_shutdown_installed__';
const SHUTTING_DOWN_KEY = '__tracker_shutting_down__';

function clearGlobals() {
	delete (globalThis as any)[HOOKS_KEY];
	delete (globalThis as any)[HANDLER_KEY];
	delete (process as any)[SHUTTING_DOWN_KEY];
}

let registerShutdownHook: typeof import('../../src/plugin/shutdown').registerShutdownHook;

beforeEach(async () => {
	clearGlobals();
	vi.resetModules();
	const mod = await import('../../src/plugin/shutdown');
	registerShutdownHook = mod.registerShutdownHook;
});

afterEach(() => {
	clearGlobals();
	vi.restoreAllMocks();
	process.removeAllListeners('SIGTERM');
	process.removeAllListeners('SIGINT');
	process.removeAllListeners('SIGHUP');
	process.removeAllListeners('uncaughtException');
});

describe('registerShutdownHook()', () => {
	it('restituisce una funzione unregister', () => {
		const unregister = registerShutdownHook(vi.fn());
		expect(typeof unregister).toBe('function');
	});

	it('aggiunge il hook alla lista globale', () => {
		const fn = vi.fn();
		registerShutdownHook(fn);
		const hooks = (globalThis as any)[HOOKS_KEY] as unknown[];
		expect(hooks).toContain(fn);
	});

	it('installa HANDLER_KEY dopo la prima registrazione', () => {
		registerShutdownHook(vi.fn());
		expect((globalThis as any)[HANDLER_KEY]).toBe(true);
	});

	it('non duplica lo stesso hook se registrato due volte', () => {
		const fn = vi.fn();
		registerShutdownHook(fn);
		registerShutdownHook(fn);
		const hooks = (globalThis as any)[HOOKS_KEY] as unknown[];
		expect(hooks.filter(h => h === fn)).toHaveLength(1);
	});

	it('può registrare più hook diversi', () => {
		const fn1 = vi.fn();
		const fn2 = vi.fn();
		registerShutdownHook(fn1);
		registerShutdownHook(fn2);
		const hooks = (globalThis as any)[HOOKS_KEY] as unknown[];
		expect(hooks).toContain(fn1);
		expect(hooks).toContain(fn2);
	});

	describe('unregister()', () => {
		it('rimuove il hook dalla lista', () => {
			const fn = vi.fn();
			const unregister = registerShutdownHook(fn);
			unregister();
			const hooks = (globalThis as any)[HOOKS_KEY] as unknown[];
			expect(hooks).not.toContain(fn);
		});

		it('chiamata a unregister() su hook già rimosso è no-op', () => {
			const fn = vi.fn();
			const unregister = registerShutdownHook(fn);
			unregister();
			expect(() => unregister()).not.toThrow();
		});

		it('rimuove solo il hook corretto e lascia gli altri intatti', () => {
			const fn1 = vi.fn();
			const fn2 = vi.fn();
			const unregister1 = registerShutdownHook(fn1);
			registerShutdownHook(fn2);
			unregister1();
			const hooks = (globalThis as any)[HOOKS_KEY] as unknown[];
			expect(hooks).not.toContain(fn1);
			expect(hooks).toContain(fn2);
		});

		it('ignora il secondo segnale se è già in corso lo shutdown', () => {
			const fn = vi.fn();
			registerShutdownHook(fn);
			const sigtermHandler = process.listeners('SIGTERM')[0] as (sig: string) => void;
			(process as any).__tracker_shutting_down__ = true;
			const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
			sigtermHandler('SIGTERM');

			expect(exitSpy).not.toHaveBeenCalled();
			expect(fn).not.toHaveBeenCalled();
			exitSpy.mockRestore();
		});

		it('runShutdown esegue tutti gli hook e poi rilancia il segnale', async () => {
			vi.useFakeTimers();
			const fn1 = vi.fn().mockResolvedValue(undefined);
			const fn2 = vi.fn(() => { throw new Error('boom'); });
			registerShutdownHook(fn1);
			registerShutdownHook(fn2);
			const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true as any);
			const removeSpy = vi.spyOn(process, 'removeAllListeners');
			const sigintHandler = process.listeners('SIGINT')[0] as (sig: string) => void;
			sigintHandler('SIGINT');

			await vi.runAllTimersAsync();
			await Promise.resolve();

			expect(fn1).toHaveBeenCalled();
			expect(fn2).toHaveBeenCalled();
			expect(removeSpy).toHaveBeenCalledWith('SIGINT');
			expect(killSpy).toHaveBeenCalledWith(process.pid, 'SIGINT');

			killSpy.mockRestore();
			removeSpy.mockRestore();
			vi.useRealTimers();
		});

		it('su uncaughtException logga, esegue gli hook e rilancia l\'errore', async () => {
			const hook = vi.fn().mockResolvedValue(undefined);
			registerShutdownHook(hook);
			const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => { });
			const handler = process.listeners('uncaughtException')[0] as (err: Error) => Promise<void>;
			const err = new Error('boom');
			let caught: unknown;
			try {
				await handler(err);
			} catch (e) {
				caught = e;
			}

			expect(consoleSpy).toHaveBeenCalledWith(
				'[vite-plugin-monitor] Uncaught exception - flushing logs before crash:',
				err
			);
			expect(hook).toHaveBeenCalled();
			expect(caught).toBe(err);
			consoleSpy.mockRestore();
		});

		it('se gli hook non risolvono entro la deadline logga un warning e completa lo shutdown', async () => {
			vi.useFakeTimers();
			registerShutdownHook(() => new Promise(() => { }));
			const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => { });
			const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true as any);
			const sigintHandler = process.listeners('SIGINT')[0] as (sig: string) => void;
			sigintHandler('SIGINT');

			await vi.advanceTimersByTimeAsync(5000);
			await Promise.resolve();

			expect(warnSpy).toHaveBeenCalledWith(
				'[vite-plugin-monitor] Shutdown deadline exceeded - forcing exit'
			);
			expect(killSpy).toHaveBeenCalled();
			warnSpy.mockRestore();
			killSpy.mockRestore();
			vi.useRealTimers();
		});

		it('copre il ramo catch dentro allSettled quando un hook lancia in modo sincrono', async () => {
			const syncThrowingHook = () => {
				throw new Error('sync boom');
			};
			registerShutdownHook(syncThrowingHook);
			const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => { });
			const handler = process.listeners('uncaughtException')[0] as (err: Error) => Promise<void>;
			const err = new Error('test');
			let caught: unknown;
			try {
				await handler(err);
			} catch (e) {
				caught = e;
			}

			expect(caught).toBe(err);
			consoleSpy.mockRestore();
		});

	});

	describe('installHandlers() — idempotenza', () => {
		it('HANDLER_KEY non viene impostato due volte (idempotente)', () => {
			const spy = vi.spyOn(process, 'on');
			registerShutdownHook(vi.fn());
			const countAfterFirst = spy.mock.calls.filter(([ev]) =>
				['SIGTERM', 'SIGINT', 'SIGHUP', 'uncaughtException'].includes(ev as string)
			).length;

			registerShutdownHook(vi.fn());
			const countAfterSecond = spy.mock.calls.filter(([ev]) =>
				['SIGTERM', 'SIGINT', 'SIGHUP', 'uncaughtException'].includes(ev as string)
			).length;

			expect(countAfterFirst).toBe(countAfterSecond);
		});

		it('registra listener per SIGTERM, SIGINT, SIGHUP e uncaughtException', () => {
			const spy = vi.spyOn(process, 'on');
			registerShutdownHook(vi.fn());
			const signals = spy.mock.calls.map(([ev]) => ev);
			expect(signals).toContain('SIGTERM');
			expect(signals).toContain('SIGINT');
			expect(signals).toContain('SIGHUP');
			expect(signals).toContain('uncaughtException');
		});
	});
});
