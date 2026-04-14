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
});

describe('registerShutdownHook()', () => {
	it('returns an unregister function', () => {
		const unregister = registerShutdownHook(vi.fn());
		expect(typeof unregister).toBe('function');
	});

	it('adds the hook to the global list', () => {
		const fn = vi.fn();
		registerShutdownHook(fn);
		const hooks = (globalThis as any)[HOOKS_KEY] as unknown[];
		expect(hooks).toContain(fn);
	});

	it('installs HANDLER_KEY after the first registration', () => {
		registerShutdownHook(vi.fn());
		expect((globalThis as any)[HANDLER_KEY]).toBe(true);
	});

	it('does not duplicate the same hook when registered twice', () => {
		const fn = vi.fn();
		registerShutdownHook(fn);
		registerShutdownHook(fn);
		const hooks = (globalThis as any)[HOOKS_KEY] as unknown[];
		expect(hooks.filter(h => h === fn)).toHaveLength(1);
	});

	it('can register multiple different hooks', () => {
		const fn1 = vi.fn();
		const fn2 = vi.fn();
		registerShutdownHook(fn1);
		registerShutdownHook(fn2);
		const hooks = (globalThis as any)[HOOKS_KEY] as unknown[];
		expect(hooks).toContain(fn1);
		expect(hooks).toContain(fn2);
	});

	describe('unregister()', () => {
		it('removes the hook from the list', () => {
			const fn = vi.fn();
			const unregister = registerShutdownHook(fn);
			unregister();
			const hooks = (globalThis as any)[HOOKS_KEY] as unknown[];
			expect(hooks).not.toContain(fn);
		});

		it('calling unregister() on an already removed hook is a no-op', () => {
			const fn = vi.fn();
			const unregister = registerShutdownHook(fn);
			unregister();
			expect(() => unregister()).not.toThrow();
		});

		it('removes only the correct hook and leaves the others intact', () => {
			const fn1 = vi.fn();
			const fn2 = vi.fn();
			const unregister1 = registerShutdownHook(fn1);
			registerShutdownHook(fn2);
			unregister1();
			const hooks = (globalThis as any)[HOOKS_KEY] as unknown[];
			expect(hooks).not.toContain(fn1);
			expect(hooks).toContain(fn2);
		});

		it('ignores the second signal when shutdown is already in progress', () => {
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

		it('runShutdown executes all hooks and then re-emits the signal', async () => {
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

		it('when hooks do not resolve within the deadline logs a warning and completes shutdown', async () => {
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

		it('covers the catch branch inside allSettled when a hook throws synchronously', async () => {
			vi.useFakeTimers();
			const syncThrowingHook = () => { throw new Error('sync boom'); };
			registerShutdownHook(syncThrowingHook);
			const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true as any);
			const sigintHandler = process.listeners('SIGINT')[0] as (sig: string) => void;
			sigintHandler('SIGINT');

			await vi.runAllTimersAsync();
			await Promise.resolve();

			expect(killSpy).toHaveBeenCalled();
			killSpy.mockRestore();
			vi.useRealTimers();
		});
	});

	describe('installHandlers() — idempotency', () => {
		it('HANDLER_KEY is not set twice (idempotent)', () => {
			const spy = vi.spyOn(process, 'on');
			registerShutdownHook(vi.fn());
			const countAfterFirst = spy.mock.calls.filter(([ev]) =>
				['SIGTERM', 'SIGINT'].includes(ev as string)
			).length;

			registerShutdownHook(vi.fn());
			const countAfterSecond = spy.mock.calls.filter(([ev]) =>
				['SIGTERM', 'SIGINT'].includes(ev as string)
			).length;

			expect(countAfterFirst).toBe(countAfterSecond);
		});

		it('registers listeners for SIGTERM and SIGINT only (no uncaughtException)', () => {
			const spy = vi.spyOn(process, 'on');
			registerShutdownHook(vi.fn());
			const signals = spy.mock.calls.map(([ev]) => ev);
			expect(signals).toContain('SIGTERM');
			expect(signals).toContain('SIGINT');
			expect(signals).not.toContain('uncaughtException');
		});
	});
});
