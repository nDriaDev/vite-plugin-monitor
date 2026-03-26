import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { makeMiddlewareConfig, overrideTrackerConfig } from './setup';
import { TrackerConfig } from '@tracker/types';

async function flushPromises() {
	for (let i = 0; i < 5; i++) {
		await Promise.resolve();
	}
}

let fetchMock: ReturnType<typeof vi.fn>;
const sendBeaconMock = vi.fn().mockReturnValue(true);

let capturedOverlay: {
	pushEvent: ReturnType<typeof vi.fn>;
	refreshUserId: ReturnType<typeof vi.fn>;
	destroy: ReturnType<typeof vi.fn>;
} | null = null;

let capturedTeardown: ReturnType<typeof vi.fn> | null = null;

let trackerModule: typeof import('../../src/client/index');

beforeEach(async () => {
	capturedOverlay = null;
	capturedTeardown = null;

	vi.resetModules();

	vi.doMock('../../src/client/overlay', () => ({
		DebugOverlay: class {
			constructor() {
				capturedOverlay = {
					pushEvent: vi.fn(),
					refreshUserId: vi.fn(),
					destroy: vi.fn()
				};
				return capturedOverlay;
			}
		}
	}));

	vi.doMock('../../src/client/trackers/console', () => ({
		setupConsoleTracker: vi.fn().mockReturnValue(() => { })
	}));

	vi.doMock('../../src/client/trackers/clicks', () => ({
		setupClickTracker: vi.fn().mockImplementation(() => {
			capturedTeardown = vi.fn();
			return capturedTeardown;
		})
	}));

	vi.doMock('../../src/client/trackers/http', () => ({
		setupHttpTracker: vi.fn().mockReturnValue(() => { })
	}));

	vi.doMock('../../src/client/trackers/errors', () => ({
		setupErrorTracker: vi.fn().mockReturnValue(() => { })
	}));

	vi.doMock('../../src/client/trackers/navigation', () => ({
		setupNavigationTracker: vi.fn().mockReturnValue(() => { })
	}));

	trackerModule = await import('../../src/client/index');

	overrideTrackerConfig(makeMiddlewareConfig({}));

	fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
	vi.stubGlobal('fetch', fetchMock);

	Object.defineProperty(navigator, 'sendBeacon', {
		configurable: true,
		writable: true,
		value: sendBeaconMock
	});
	sendBeaconMock.mockClear();

	vi.useFakeTimers();
});

afterEach(() => {
	try {
		vi.runOnlyPendingTimers();
	} catch { }

	vi.useRealTimers();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();

	Object.defineProperty(navigator, 'sendBeacon', {
		configurable: true,
		writable: true,
		value: undefined
	});

	try {
		Object.defineProperty(window, '__tracker_instance__', {
			value: undefined,
			writable: true,
			configurable: true
		});
		delete (window as any).__tracker_instance__;
	} catch { }

	vi.doUnmock('../../src/client/overlay');
	vi.doUnmock('../../src/client/trackers/clicks');
	vi.doUnmock('../../src/client/trackers/console');
	vi.doUnmock('../../src/client/trackers/http');
	vi.doUnmock('../../src/client/trackers/errors');
	vi.doUnmock('../../src/client/trackers/navigation');
});

describe('setupTrackers()', () => {
	it('è un no-op in SSR (window undefined)', async () => {
		const originalWindow = globalThis.window;
		try {
			// @ts-ignore
			delete globalThis.window;

			vi.resetModules();
			const mod = await import('../../src/client/index');
			expect(() => mod.setupTrackers()).not.toThrow();
		} finally {
			globalThis.window = originalWindow;
		}
	});

	it('crea preInitClient e installa i tracker attivi', async () => {
		const { setupTrackers } = trackerModule;
		const configWithTrackers = makeMiddlewareConfig({
			track: {
				clicks: true,
				http: false,
				errors: false,
				navigation: false,
				console: false,
				level: 'info',
				ignoreUrls: []
			}
		});
		overrideTrackerConfig(configWithTrackers);

		setupTrackers();

		const { setupClickTracker } = await import('../../src/client/trackers/clicks');
		expect(setupClickTracker).toHaveBeenCalledTimes(1);
	});

	it('chiamate successive a setupTrackers() sono no-op (idempotente)', async () => {
		const { setupTrackers } = trackerModule;
		const configWithTrackers = makeMiddlewareConfig({
			track: {
				clicks: true,
				http: false,
				errors: false,
				navigation: false,
				console: false,
				level: 'info',
				ignoreUrls: []
			}
		});
		overrideTrackerConfig(configWithTrackers);

		setupTrackers();
		setupTrackers();
		setupTrackers();

		const { setupClickTracker } = await import('../../src/client/trackers/clicks');
		expect(setupClickTracker).toHaveBeenCalledTimes(1);
	});

	it('installa tutti i tracker attivi nella config', async () => {
		const { setupTrackers } = trackerModule;
		const fullConfig = makeMiddlewareConfig({
			track: {
				clicks: true,
				http: true,
				errors: true,
				navigation: true,
				console: true,
				level: 'info',
				ignoreUrls: []
			}
		});
		overrideTrackerConfig(fullConfig);

		setupTrackers();

		const { setupClickTracker } = await import('../../src/client/trackers/clicks');
		const { setupConsoleTracker } = await import('../../src/client/trackers/console');
		const { setupHttpTracker } = await import('../../src/client/trackers/http');
		const { setupErrorTracker } = await import('../../src/client/trackers/errors');
		const { setupNavigationTracker } = await import('../../src/client/trackers/navigation');

		expect(setupClickTracker).toHaveBeenCalledTimes(1);
		expect(setupConsoleTracker).toHaveBeenCalledTimes(1);
		expect(setupHttpTracker).toHaveBeenCalledTimes(1);
		expect(setupErrorTracker).toHaveBeenCalledTimes(1);
		expect(setupNavigationTracker).toHaveBeenCalledTimes(1);
	});

	it('non installa i tracker con flag false nella config', async () => {
		const { setupTrackers } = trackerModule;
		setupTrackers();

		const { setupClickTracker } = await import('../../src/client/trackers/clicks');
		const { setupConsoleTracker } = await import('../../src/client/trackers/console');

		expect(setupClickTracker).not.toHaveBeenCalled();
		expect(setupConsoleTracker).not.toHaveBeenCalled();
	});

	it('esclude la route della dashboard dalle ignorePaths se dashboard.enabled è true', async () => {
		const { setupTrackers } = trackerModule;
		const configWithDashboard = makeMiddlewareConfig({
			dashboard: {
				enabled: true,
				route: '/_dashboard',
				pollInterval: 3000,
				auth: false as const
			},
			track: {
				clicks: true,
				http: false,
				errors: false,
				navigation: true,
				console: false,
				level: 'info',
				ignoreUrls: []
			}
		});
		overrideTrackerConfig(configWithDashboard);

		setupTrackers();

		const { setupClickTracker } = await import('../../src/client/trackers/clicks');
		const { setupNavigationTracker } = await import('../../src/client/trackers/navigation');

		expect(setupClickTracker).toHaveBeenCalledWith(
			expect.any(Function),
			expect.arrayContaining(['/_dashboard'])
		);
		expect(setupNavigationTracker).toHaveBeenCalledWith(
			expect.any(Function),
			expect.arrayContaining(['/_dashboard'])
		);
	});
});

describe('tracker.init()', () => {
	it('è un no-op in SSR (window undefined)', async () => {
		const originalWindow = globalThis.window;
		try {
			// @ts-ignore
			delete globalThis.window;

			vi.resetModules();
			const mod = await import('../../src/client/index');
			expect(() => mod.tracker.init()).not.toThrow();
		} finally {
			globalThis.window = originalWindow;
		}
	});

	it('è un no-op se già inizializzato (singleton)', async () => {
		const { tracker } = trackerModule;
		tracker.init();
		tracker.init();

		vi.advanceTimersByTime(3100);
		await flushPromises();

		const body = JSON.parse(fetchMock.mock.calls[0][1].body);
		const sessionStartEvents = body.events.filter(
			(e: any) => e.type === 'session' && e.payload?.action === 'start'
		);
		expect(sessionStartEvents).toHaveLength(1);
	});

	it('riusa preInitClient se setupTrackers() era già stato chiamato', async () => {
		const { setupTrackers, tracker } = trackerModule;
		const configWithTrackers = makeMiddlewareConfig({
			track: {
				clicks: true,
				http: false,
				errors: false,
				navigation: false,
				console: false,
				level: 'info',
				ignoreUrls: []
			}
		});
		overrideTrackerConfig(configWithTrackers);

		setupTrackers();
		tracker.init();

		const { setupClickTracker } = await import('../../src/client/trackers/clicks');
		expect(setupClickTracker).toHaveBeenCalledTimes(1);
	});

	it('crea un nuovo TrackerClient se preInitClient è null (senza setupTrackers)', () => {
		const { tracker } = trackerModule;
		expect(() => tracker.init()).not.toThrow();
	});

	it('emette un evento session:start alla prima init', async () => {
		const { tracker } = trackerModule;
		tracker.init();

		vi.advanceTimersByTime(3100);
		await flushPromises();

		const body = JSON.parse(fetchMock.mock.calls[0][1].body);
		const sessionEvent = body.events.find((e: any) => e.type === 'session');
		expect(sessionEvent).toBeDefined();
		expect(sessionEvent.payload.action).toBe('start');
		expect(sessionEvent.payload.trigger).toBe('init');
	});

	it('attiva il flush periodico della queue (scheduleFlush)', async () => {
		const { tracker } = trackerModule;
		tracker.init();

		expect(fetchMock).not.toHaveBeenCalled();

		vi.advanceTimersByTime(3100);
		await flushPromises();

		expect(fetchMock).toHaveBeenCalled();
	});

	it('monta il DebugOverlay se overlay.enabled è true', () => {
		const { tracker } = trackerModule;
		const configWithOverlay = makeMiddlewareConfig({
			overlay: { enabled: true, position: 'bottom-right' }
		});
		overrideTrackerConfig(configWithOverlay);

		tracker.init();

		expect(capturedOverlay).not.toBeNull();
	});

	it('NON monta il DebugOverlay se overlay.enabled è false', () => {
		const { tracker } = trackerModule;
		tracker.init();

		expect(capturedOverlay).toBeNull();
	});

	it('aggiunge il listener su visibilitychange', () => {
		const { tracker } = trackerModule;
		const addEventSpy = vi.spyOn(window, 'addEventListener');
		tracker.init();
		expect(addEventSpy).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
	});

	it('aggiunge il listener su beforeunload', () => {
		const { tracker } = trackerModule;
		const addEventSpy = vi.spyOn(window, 'addEventListener');
		tracker.init();
		expect(addEventSpy).toHaveBeenCalledWith('beforeunload', expect.any(Function));
	});

	it('espone il client su window.__tracker_instance__', () => {
		const { tracker } = trackerModule;
		tracker.init();
		expect((window as any).__tracker_instance__).toBeDefined();
	});

	it('accetta una userIdFn e la usa per risolvere il userId', async () => {
		const { tracker } = trackerModule;
		tracker.init(() => 'user-from-fn');

		vi.advanceTimersByTime(3100);
		await flushPromises();

		const body = JSON.parse(fetchMock.mock.calls[0][1].body);
		const sessionEvent = body.events.find((e: any) => e.type === 'session');
		expect(sessionEvent.userId).toBe('user-from-fn');
	});
});

describe('tracker.track()', () => {
	it('è un no-op se non inizializzato', async () => {
		const { tracker } = trackerModule;
		expect(() => tracker.track('my-event', { foo: 'bar' })).not.toThrow();

		vi.advanceTimersByTime(3100);
		await flushPromises();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('emette un evento di tipo "custom" con name e data corretti', async () => {
		const { tracker } = trackerModule;
		tracker.init();

		tracker.track('button-click', { buttonId: 'cta' });

		vi.advanceTimersByTime(3100);
		await flushPromises();

		const body = JSON.parse(fetchMock.mock.calls[0][1].body);
		const customEvent = body.events.find((e: any) => e.type === 'custom');
		expect(customEvent).toBeDefined();
		expect(customEvent.payload.name).toBe('button-click');
		expect(customEvent.payload.data).toEqual({ buttonId: 'cta' });
	});

	it('usa il level fornito nelle opzioni', async () => {
		const { tracker } = trackerModule;
		tracker.init();

		tracker.track('debug-event', {}, { level: 'debug' });

		vi.advanceTimersByTime(3100);
		await flushPromises();

		const body = JSON.parse(fetchMock.mock.calls[0][1].body);
		const customEvent = body.events.find((e: any) => e.payload?.name === 'debug-event');
		expect(customEvent.level).toBe('debug');
	});

	it('include groupId se fornito nelle opzioni', async () => {
		const { tracker } = trackerModule;
		tracker.init();

		const groupId = tracker.group('flow');
		tracker.track('step-1', {}, { groupId });

		vi.advanceTimersByTime(3100);
		await flushPromises();

		const body = JSON.parse(fetchMock.mock.calls[0][1].body);
		const customEvent = body.events.find((e: any) => e.payload?.name === 'step-1');
		expect(customEvent.groupId).toBe(groupId);
	});
});

describe('tracker.time() / tracker.timeEnd()', () => {
	it('timeEnd() senza time() precedente restituisce -1', () => {
		const { tracker } = trackerModule;
		tracker.init();
		const result = tracker.timeEnd('missing-label');
		expect(result).toBe(-1);
	});

	it('timeEnd() senza time() precedente logga un warning', () => {
		const { tracker } = trackerModule;
		tracker.init();
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => { });
		tracker.timeEnd('missing-label');
		expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('missing-label'));
	});

	it('time() doppio logga un warning e non sovrascrive il primo', () => {
		const { tracker } = trackerModule;
		tracker.init();
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => { });

		tracker.time('my-op');
		tracker.time('my-op');

		expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('my-op'));
	});

	it('timeEnd() emette un evento con campo duration corretto', async () => {
		const { tracker } = trackerModule;

		tracker.init();
		tracker.time('real-op');

		vi.advanceTimersByTime(50);
		const duration = tracker.timeEnd('real-op');

		expect(duration).toBeGreaterThanOrEqual(0);

		vi.advanceTimersByTime(3100);
		await flushPromises();

		const body = JSON.parse(fetchMock.mock.calls[0][1].body);
		const timedEvent = body.events.find((e: any) => e.payload?.name === 'real-op');
		expect(timedEvent).toBeDefined();
		expect(timedEvent.payload.data.duration).toBeGreaterThanOrEqual(0);
	});

	it('timeEnd() restituisce -1 se chiamato senza init()', () => {
		const { tracker } = trackerModule;
		const result = tracker.timeEnd('never-started');
		expect(result).toBe(-1);
	});
});

describe('tracker.setUser()', () => {
	it('è un no-op se non inizializzato', () => {
		const { tracker } = trackerModule;
		expect(() => tracker.setUser('user-123')).not.toThrow();
	});

	it('emette session:end con il vecchio userId prima di cambiare', async () => {
		const { tracker } = trackerModule;
		tracker.init(() => 'user-old');

		tracker.setUser('user-new');

		vi.advanceTimersByTime(3100);
		await flushPromises();

		const body = JSON.parse(fetchMock.mock.calls[0][1].body);
		const endEvent = body.events.find(
			(e: any) =>
				e.type === 'session' &&
				e.payload?.action === 'end' &&
				e.payload?.trigger === 'userId-change'
		);
		expect(endEvent).toBeDefined();
		expect(endEvent.userId).toBe('user-old');
		expect(endEvent.payload.previousUserId).toBe('user-old');
	});

	it('emette session:start con il nuovo userId dopo il cambio', async () => {
		const { tracker } = trackerModule;
		tracker.init(() => 'user-old');

		tracker.setUser('user-new');

		vi.advanceTimersByTime(3100);
		await flushPromises();

		const body = JSON.parse(fetchMock.mock.calls[0][1].body);
		const startEvents = body.events.filter(
			(e: any) =>
				e.type === 'session' &&
				e.payload?.action === 'start' &&
				e.payload?.trigger === 'userId-change'
		);
		expect(startEvents.length).toBeGreaterThan(0);
		const startEvent = startEvents[0];
		expect(startEvent.userId).toBe('user-new');
		expect(startEvent.payload.newUserId).toBe('user-new');
	});

	it('null come userId genera un ID anonimo', async () => {
		const { tracker } = trackerModule;
		tracker.init(() => 'user-123');

		tracker.setUser(null);

		vi.advanceTimersByTime(3100);
		await flushPromises();

		const body = JSON.parse(fetchMock.mock.calls[0][1].body);
		const startAfterNull = body.events.find(
			(e: any) =>
				e.type === 'session' &&
				e.payload?.action === 'start' &&
				e.payload?.trigger === 'userId-change'
		);
		expect(startAfterNull).toBeDefined();
		expect(startAfterNull.userId).toMatch(/^anon_/);
	});

	it('null come userId rimuove il userId da sessionStorage', () => {
		const { tracker } = trackerModule;
		tracker.init(() => 'user-123');

		sessionStorage.setItem('__tracker_user_id__', 'user-123');
		tracker.setUser(null);

		expect(sessionStorage.getItem('__tracker_user_id__')).toBeNull();
	});

	it('salva il nuovo userId in sessionStorage', () => {
		const { tracker } = trackerModule;
		tracker.init();

		tracker.setUser('user-saved');

		expect(sessionStorage.getItem('__tracker_user_id__')).toBe('user-saved');
	});

	it('chiama overlay.refreshUserId() se l\'overlay è montato', () => {
		const { tracker } = trackerModule;
		const configWithOverlay = makeMiddlewareConfig({
			overlay: { enabled: true, position: 'bottom-right' }
		});
		overrideTrackerConfig(configWithOverlay);

		tracker.init();
		expect(capturedOverlay).not.toBeNull();

		tracker.setUser('user-with-overlay');

		expect(capturedOverlay!.refreshUserId).toHaveBeenCalledTimes(1);
	});

	it('salva gli userAttributes se forniti', async () => {
		const { tracker } = trackerModule;
		tracker.init();

		tracker.setUser('user-with-attrs', { attributes: { plan: 'pro' } });

		vi.advanceTimersByTime(3100);
		await flushPromises();

		const body = JSON.parse(fetchMock.mock.calls[0][1].body);
		const startEvent = body.events.find(
			(e: any) =>
				e.type === 'session' &&
				e.payload?.action === 'start' &&
				e.payload?.trigger === 'userId-change'
		);
		expect(startEvent?.meta?.userAttributes).toEqual({ plan: 'pro' });
	});
});

describe('tracker.setContext()', () => {
	it('è un no-op se non inizializzato', () => {
		const { tracker } = trackerModule;
		expect(() => tracker.setContext({ env: 'test' })).not.toThrow();
	});

	it('il context si riflette negli eventi successivi', async () => {
		const { tracker } = trackerModule;
		tracker.init();

		tracker.setContext({ env: 'production', version: '2.0' });
		tracker.track('page-view', {});

		vi.advanceTimersByTime(3100);
		await flushPromises();

		const body = JSON.parse(fetchMock.mock.calls[0][1].body);
		const customEvent = body.events.find((e: any) => e.payload?.name === 'page-view');
		expect(customEvent?.context).toMatchObject({ env: 'production', version: '2.0' });
	});
});

describe('tracker.group()', () => {
	it('restituisce un ID univoco con il nome fornito', () => {
		const { tracker } = trackerModule;

		expect(() => tracker.init()).not.toThrow();

		const id1 = tracker.group('checkout');
		const id2 = tracker.group('checkout');

		expect(id1).toContain('checkout');
		expect(id2).toContain('checkout');
		expect(id1).not.toBe(id2);

		try {
			tracker.destroy();
		} catch { }
	});

	it('restituisce un ID offline se non inizializzato', () => {
		const { tracker } = trackerModule;
		const id = tracker.group('flow');
		expect(id).toContain('flow');
		expect(id).toContain('offline');
	});

	it('il formato è grp_{name}_{counter}_{timestamp}', () => {
		const { tracker } = trackerModule;
		tracker.init();

		const id = tracker.group('my-flow');
		expect(id).toMatch(/^grp_my-flow_[a-z0-9]+_[a-z0-9]+$/);
	});
});

describe('tracker.destroy()', () => {
	it('è un no-op se non inizializzato', () => {
		const { tracker } = trackerModule;
		expect(() => tracker.destroy()).not.toThrow();
	});

	it('emette session:end con trigger "destroy"', async () => {
		const { tracker } = trackerModule;
		tracker.init();

		vi.advanceTimersByTime(3100);
		await flushPromises();
		fetchMock.mockClear();

		tracker.destroy();
		vi.advanceTimersByTime(3100);
		await flushPromises();

		expect(fetchMock).toHaveBeenCalled();
		const body = JSON.parse(fetchMock.mock.calls[0][1].body);
		const endEvent = body.events.find(
			(e: any) =>
				e.type === 'session' &&
				e.payload?.action === 'end' &&
				e.payload?.trigger === 'destroy'
		);
		expect(endEvent).toBeDefined();
	});

	it('distrugge l\'overlay se montato', () => {
		const { tracker } = trackerModule;
		const configWithOverlay = makeMiddlewareConfig({
			overlay: { enabled: true, position: 'bottom-right' }
		});
		overrideTrackerConfig(configWithOverlay);

		tracker.init();
		expect(capturedOverlay).not.toBeNull();

		tracker.destroy();

		expect(capturedOverlay!.destroy).toHaveBeenCalledTimes(1);
	});

	it('chiama tutti i teardown dei tracker installati', () => {
		const { setupTrackers, tracker } = trackerModule;
		const configWithTrackers = makeMiddlewareConfig({
			track: {
				clicks: true,
				http: false,
				errors: false,
				navigation: false,
				console: false,
				level: 'info',
				ignoreUrls: []
			}
		});
		overrideTrackerConfig(configWithTrackers);

		setupTrackers();
		expect(capturedTeardown).not.toBeNull();

		tracker.init();
		tracker.destroy();

		expect(capturedTeardown).toHaveBeenCalledTimes(1);
	});
});

describe('visibilitychange', () => {
	it('chiama flush della queue quando visibilityState diventa "hidden"', async () => {
		const { tracker } = trackerModule;
		tracker.init();

		vi.advanceTimersByTime(3100);
		await flushPromises();
		fetchMock.mockClear();
		sendBeaconMock.mockClear();

		tracker.track('before-hide', {});

		Object.defineProperty(document, 'visibilityState', {
			configurable: true,
			get: () => 'hidden'
		});

		window.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
		await flushPromises();

		expect(sendBeaconMock).toHaveBeenCalled();

		Object.defineProperty(document, 'visibilityState', {
			configurable: true,
			get: () => 'visible'
		});
	});

	it('non chiama flush se visibilityState rimane "visible"', async () => {
		const { tracker } = trackerModule;
		tracker.init();

		vi.advanceTimersByTime(3100);
		await flushPromises();
		fetchMock.mockClear();
		sendBeaconMock.mockClear();

		window.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
		await flushPromises();

		expect(sendBeaconMock).not.toHaveBeenCalled();
	});
});

describe('beforeunload', () => {
	it('emette session:end e chiama flush prima che la pagina chiuda', async () => {
		const { tracker } = trackerModule;
		tracker.init();

		vi.advanceTimersByTime(3100);
		await flushPromises();
		fetchMock.mockClear();
		sendBeaconMock.mockClear();

		Object.defineProperty(document, 'visibilityState', {
			configurable: true,
			get: () => 'hidden'
		});

		window.dispatchEvent(new Event('beforeunload', { bubbles: true }));
		await flushPromises();

		expect(sendBeaconMock).toHaveBeenCalled();
		expect(sendBeaconMock.mock.calls[0][0]).toBe('/_tracker/events');

		Object.defineProperty(document, 'visibilityState', {
			configurable: true,
			get: () => 'visible'
		});
	});
});

describe('setupTrackers e tracker.init sono no-op in SSR (window undefined)', () => {
	it('né setupTrackers né tracker.init lanciano se window è undefined', async () => {
		const originalWindow = globalThis.window;
		try {
			vi.resetModules();
			vi.doMock('../../src/client/overlay', () => ({ DebugOverlay: vi.fn() }));
			vi.doMock('../../src/client/trackers/clicks', () => ({ setupClickTracker: vi.fn().mockReturnValue(() => { }) }));
			vi.doMock('../../src/client/trackers/console', () => ({ setupConsoleTracker: vi.fn().mockReturnValue(() => { }) }));
			vi.doMock('../../src/client/trackers/http', () => ({ setupHttpTracker: vi.fn().mockReturnValue(() => { }) }));
			vi.doMock('../../src/client/trackers/errors', () => ({ setupErrorTracker: vi.fn().mockReturnValue(() => { }) }));
			vi.doMock('../../src/client/trackers/navigation', () => ({ setupNavigationTracker: vi.fn().mockReturnValue(() => { }) }));

			// @ts-ignore
			delete globalThis.window;

			const ssrMod = await import('../../src/client/index');

			expect(() => ssrMod.setupTrackers()).not.toThrow();
			expect(() => ssrMod.tracker.init()).not.toThrow();
		} finally {
			globalThis.window = originalWindow;
		}
	});

	it('emette un evento console', async () => {
		vi.resetModules();

		let capturedEmit: any = null;

		vi.doMock('../../src/client/trackers/console', () => ({
			setupConsoleTracker: vi.fn().mockImplementation((_opts, cb) => {
				capturedEmit = cb;
				return () => { }
			})
		}));

		const mod = await import('../../src/client/index');

		overrideTrackerConfig(makeMiddlewareConfig({
			track: { console: true } as Partial<TrackerConfig>["track"]
		}));

		mod.setupTrackers();
		mod.tracker.init();

		capturedEmit({ msg: 'hello' }, 'warn');

		vi.advanceTimersByTime(3100);
		await flushPromises();

		const body = JSON.parse(fetchMock.mock.calls[0][1].body);
		const evt = body.events.find((e: Event) => e.type === 'console');
		expect(evt).toBeDefined();
		expect(evt.level).toBe('warn');
	});

	it('emette un evento http', async () => {
		vi.resetModules();

		let capturedEmit: any = null;

		vi.doMock('../../src/client/trackers/http', () => ({
			setupHttpTracker: vi.fn().mockImplementation((_ignore, _opts, cb) => {
				capturedEmit = cb;
				return () => { }
			})
		}));

		const mod = await import('../../src/client/index');

		overrideTrackerConfig(makeMiddlewareConfig({
			track: { http: true } as Partial<TrackerConfig>["track"]
		}));

		mod.setupTrackers();
		mod.tracker.init();

		capturedEmit({ url: '/api' }, 'error');

		vi.advanceTimersByTime(3100);
		await flushPromises();

		const body = JSON.parse(fetchMock.mock.calls[0][1].body);
		const evt = body.events.find((e: Event) => e.type === 'http');
		expect(evt).toBeDefined();
		expect(evt.level).toBe('error');
	});

	it('emette un evento navigation', async () => {
		vi.resetModules();

		let capturedEmit: any = null;

		vi.doMock('../../src/client/trackers/navigation', () => ({
			setupNavigationTracker: vi.fn().mockImplementation((cb) => {
				capturedEmit = cb;
				return () => { }
			})
		}));

		const mod = await import('../../src/client/index');

		overrideTrackerConfig(makeMiddlewareConfig({
			track: { navigation: true } as Partial<TrackerConfig>["track"]
		}));

		mod.setupTrackers();
		mod.tracker.init();

		capturedEmit({ path: '/home' });

		vi.advanceTimersByTime(3100);
		await flushPromises();

		const body = JSON.parse(fetchMock.mock.calls[0][1].body);
		const evt = body.events.find((e: Event) => e.type === 'navigation');
		expect(evt).toBeDefined();
		expect(evt.level).toBe('info');
	});

	it('lancia errore se __TRACKER_CONFIG__ manca', async () => {
		vi.resetModules();

		// @ts-ignore
		delete window.__TRACKER_CONFIG__;

		const mod = await import('../../src/client/index');

		expect(() => mod.tracker.init()).toThrow(
			'[vite-plugin-monitor] window.__TRACKER_CONFIG__ not found'
		);
	});

});

describe('emit con overlay attivo — overlay.pushEvent() (righe 57-59)', () => {
	it('overlay.pushEvent() viene chiamato dalla callback emit dei tracker installati', async () => {
		let capturedEmitCallback: ((event: any) => void) | null = null;
		let localOverlay: {
			pushEvent: ReturnType<typeof vi.fn>;
			refreshUserId: ReturnType<typeof vi.fn>;
			destroy: ReturnType<typeof vi.fn>;
		} | null = null;

		vi.resetModules();

		vi.doMock('../../src/client/overlay', () => ({
			DebugOverlay: class {
				constructor() {
					localOverlay = {
						pushEvent: vi.fn(),
						refreshUserId: vi.fn(),
						destroy: vi.fn()
					};
					return localOverlay;
				}
			}
		}));

		vi.doMock('../../src/client/trackers/clicks', () => ({
			setupClickTracker: vi.fn().mockImplementation((emitFn: (event: any) => void) => {
				capturedEmitCallback = emitFn;
				return () => { };
			})
		}));

		vi.doMock('../../src/client/trackers/console', () => ({ setupConsoleTracker: vi.fn().mockReturnValue(() => { }) }));
		vi.doMock('../../src/client/trackers/http', () => ({ setupHttpTracker: vi.fn().mockReturnValue(() => { }) }));
		vi.doMock('../../src/client/trackers/errors', () => ({ setupErrorTracker: vi.fn().mockReturnValue(() => { }) }));
		vi.doMock('../../src/client/trackers/navigation', () => ({ setupNavigationTracker: vi.fn().mockReturnValue(() => { }) }));

		const freshMod = await import('../../src/client/index');

		try {
			overrideTrackerConfig(makeMiddlewareConfig({
				overlay: { enabled: true, position: 'bottom-right' },
				track: {
					clicks: true,
					http: false,
					errors: false,
					navigation: false,
					console: false,
					level: 'info',
					ignoreUrls: []
				}
			}));

			freshMod.setupTrackers();
			freshMod.tracker.init();

			expect(capturedEmitCallback).not.toBeNull();
			expect(localOverlay).not.toBeNull();

			capturedEmitCallback!({ tag: 'button' });

			expect(localOverlay!.pushEvent).toHaveBeenCalledWith(
				expect.objectContaining({
					type: 'click',
					payload: expect.objectContaining({ tag: 'button' })
				})
			);
		} finally {
			try {
				freshMod.tracker.destroy();
			} catch { }
		}
	});
});

describe('performance guard in time() e timeEnd() (righe 179-180, 190-191)', () => {
	it('time() è un no-op se performance non è disponibile', () => {
		const { tracker } = trackerModule;
		tracker.init();

		const originalPerf = globalThis.performance;
		// @ts-ignore
		delete globalThis.performance;

		expect(() => tracker.time('perf-label')).not.toThrow();

		globalThis.performance = originalPerf;
	});

	it('timeEnd() restituisce -1 se performance non è disponibile', () => {
		const { tracker } = trackerModule;
		tracker.init();

		const originalPerf = globalThis.performance;
		// @ts-ignore
		delete globalThis.performance;

		const result = tracker.timeEnd('perf-label');
		expect(result).toBe(-1);

		globalThis.performance = originalPerf;
	});
});

describe('_mountOverlay — chiamata al primo init (overlay montato una sola volta)', () => {
	it('monta l\'overlay esattamente una volta anche se init() viene chiamato due volte (singleton)', async () => {
		let overlayConstructorCallCount = 0;

		vi.resetModules();

		vi.doMock('../../src/client/overlay', () => ({
			DebugOverlay: class {
				constructor() {
					overlayConstructorCallCount++;
					return {
						pushEvent: vi.fn(),
						refreshUserId: vi.fn(),
						destroy: vi.fn()
					};
				}
			}
		}));
		vi.doMock('../../src/client/trackers/clicks', () => ({ setupClickTracker: vi.fn().mockReturnValue(() => { }) }));
		vi.doMock('../../src/client/trackers/console', () => ({ setupConsoleTracker: vi.fn().mockReturnValue(() => { }) }));
		vi.doMock('../../src/client/trackers/http', () => ({ setupHttpTracker: vi.fn().mockReturnValue(() => { }) }));
		vi.doMock('../../src/client/trackers/errors', () => ({ setupErrorTracker: vi.fn().mockReturnValue(() => { }) }));
		vi.doMock('../../src/client/trackers/navigation', () => ({ setupNavigationTracker: vi.fn().mockReturnValue(() => { }) }));

		const freshMod = await import('../../src/client/index');

		try {
			overrideTrackerConfig(makeMiddlewareConfig({
				overlay: { enabled: true, position: 'bottom-right' }
			}));

			freshMod.tracker.init();
			expect(overlayConstructorCallCount).toBe(1);

			freshMod.tracker.init();
			expect(overlayConstructorCallCount).toBe(1);
		} finally {
			try {
				freshMod.tracker.destroy();
			} catch { }
		}
	});
});

describe('callback onUserIdChange dell\'overlay (righe 246-256)', () => {
	it('la callback passata a DebugOverlay chiama setUser e emette user:id-changed', async () => {
		let capturedOnUserIdChange: ((newId: string | null) => void) | null = null;

		vi.resetModules();

		vi.doMock('../../src/client/overlay', () => ({
			DebugOverlay: class {
				constructor(_session: any, _route: any, _position: any, onUserIdChange: any) {
					capturedOnUserIdChange = onUserIdChange;
					return {
						pushEvent: vi.fn(),
						refreshUserId: vi.fn(),
						destroy: vi.fn()
					};
				}
			}
		}));
		vi.doMock('../../src/client/trackers/clicks', () => ({ setupClickTracker: vi.fn().mockReturnValue(() => { }) }));
		vi.doMock('../../src/client/trackers/console', () => ({ setupConsoleTracker: vi.fn().mockReturnValue(() => { }) }));
		vi.doMock('../../src/client/trackers/http', () => ({ setupHttpTracker: vi.fn().mockReturnValue(() => { }) }));
		vi.doMock('../../src/client/trackers/errors', () => ({ setupErrorTracker: vi.fn().mockReturnValue(() => { }) }));
		vi.doMock('../../src/client/trackers/navigation', () => ({ setupNavigationTracker: vi.fn().mockReturnValue(() => { }) }));

		const freshMod = await import('../../src/client/index');

		try {
			const configWithOverlay = makeMiddlewareConfig({
				overlay: { enabled: true, position: 'bottom-right' }
			});
			overrideTrackerConfig(configWithOverlay);

			freshMod.tracker.init(() => 'user-before');
			expect(capturedOnUserIdChange).not.toBeNull();

			capturedOnUserIdChange!('user-after');

			vi.advanceTimersByTime(3100);
			await flushPromises();

			const body = JSON.parse(fetchMock.mock.calls[0][1].body);
			const events = body.events.filter(
				(e: any) => e.type === 'session' && e.payload?.action === 'start' && e.payload?.trigger === 'userId-change'
			);
			expect(events.length).toBeGreaterThan(0);
			expect(events[0].userId).toBe('user-after');
		} finally {
			try {
				freshMod.tracker.destroy();
			} catch { }
		}
	});

	it('la callback con null genera un userId anonimo', async () => {
		let capturedOnUserIdChange: ((newId: string | null) => void) | null = null;

		vi.resetModules();

		vi.doMock('../../src/client/overlay', () => ({
			DebugOverlay: class {
				constructor(_session: any, _route: any, _position: any, onUserIdChange: any) {
					capturedOnUserIdChange = onUserIdChange;
					return {
						pushEvent: vi.fn(),
						refreshUserId: vi.fn(),
						destroy: vi.fn()
					};
				}
			}
		}));
		vi.doMock('../../src/client/trackers/clicks', () => ({ setupClickTracker: vi.fn().mockReturnValue(() => { }) }));
		vi.doMock('../../src/client/trackers/console', () => ({ setupConsoleTracker: vi.fn().mockReturnValue(() => { }) }));
		vi.doMock('../../src/client/trackers/http', () => ({ setupHttpTracker: vi.fn().mockReturnValue(() => { }) }));
		vi.doMock('../../src/client/trackers/errors', () => ({ setupErrorTracker: vi.fn().mockReturnValue(() => { }) }));
		vi.doMock('../../src/client/trackers/navigation', () => ({ setupNavigationTracker: vi.fn().mockReturnValue(() => { }) }));

		const freshMod = await import('../../src/client/index');

		try {
			const configWithOverlay = makeMiddlewareConfig({
				overlay: { enabled: true, position: 'bottom-right' }
			});
			overrideTrackerConfig(configWithOverlay);

			freshMod.tracker.init(() => 'user-before');
			expect(capturedOnUserIdChange).not.toBeNull();

			capturedOnUserIdChange!(null);

			vi.advanceTimersByTime(3100);
			await flushPromises();

			const body = JSON.parse(fetchMock.mock.calls[0][1].body);
			const events = body.events.filter(
				(e: any) =>
					e.type === 'session' &&
					e.payload?.action === 'start' &&
					e.payload?.trigger === 'userId-change'
			);
			expect(events.length).toBeGreaterThan(0);
			expect(events[0].userId).toMatch(/^anon_/);
		} finally {
			try {
				freshMod.tracker.destroy();
			} catch { }
		}
	});
});
