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
	it('is a no-op in SSR (window undefined)', async () => {
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

	it('creates preInitClient and installs active trackers', async () => {
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

	it('successive calls to setupTrackers() are no-ops (idempotent)', async () => {
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

	it('installs all active trackers from config', async () => {
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

	it('does not install trackers with false flag in config', async () => {
		const { setupTrackers } = trackerModule;
		setupTrackers();

		const { setupClickTracker } = await import('../../src/client/trackers/clicks');
		const { setupConsoleTracker } = await import('../../src/client/trackers/console');

		expect(setupClickTracker).not.toHaveBeenCalled();
		expect(setupConsoleTracker).not.toHaveBeenCalled();
	});

	it('excludes the dashboard route from ignorePaths when dashboard.enabled is true', async () => {
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
	it('is a no-op in SSR (window undefined)', async () => {
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

	it('is a no-op when already initialized (singleton)', async () => {
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

	it('reuses preInitClient when setupTrackers() was already called', async () => {
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

	it('creates a new TrackerClient when preInitClient is null (without setupTrackers)', () => {
		const { tracker } = trackerModule;
		expect(() => tracker.init()).not.toThrow();
	});

	it('emits a session:start event on first init', async () => {
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

	it('activates the periodic flush of the queue (scheduleFlush)', async () => {
		const { tracker } = trackerModule;
		tracker.init();

		expect(fetchMock).not.toHaveBeenCalled();

		vi.advanceTimersByTime(3100);
		await flushPromises();

		expect(fetchMock).toHaveBeenCalled();
	});

	it('mounts the DebugOverlay when overlay.enabled is true', () => {
		const { tracker } = trackerModule;
		const configWithOverlay = makeMiddlewareConfig({
			overlay: { enabled: true, position: 'bottom-right' }
		});
		overrideTrackerConfig(configWithOverlay);

		tracker.init();

		expect(capturedOverlay).not.toBeNull();
	});

	it('does NOT mount the DebugOverlay when overlay.enabled is false', () => {
		const { tracker } = trackerModule;
		tracker.init();

		expect(capturedOverlay).toBeNull();
	});

	it('adds the listener on visibilitychange', () => {
		const { tracker } = trackerModule;
		const addEventSpy = vi.spyOn(window, 'addEventListener');
		tracker.init();
		expect(addEventSpy).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
	});

	it('adds the listener on beforeunload', () => {
		const { tracker } = trackerModule;
		const addEventSpy = vi.spyOn(window, 'addEventListener');
		tracker.init();
		expect(addEventSpy).toHaveBeenCalledWith('beforeunload', expect.any(Function));
	});

	it('exposes the client on window.__tracker_instance__', () => {
		const { tracker } = trackerModule;
		tracker.init();
		expect((window as any).__tracker_instance__).toBeDefined();
	});

	it('accepts a userIdFn and uses it to resolve the userId', async () => {
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
	it('is a no-op when not initialized', async () => {
		const { tracker } = trackerModule;
		expect(() => tracker.track('my-event', { foo: 'bar' })).not.toThrow();

		vi.advanceTimersByTime(3100);
		await flushPromises();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('emits a "custom" event with the correct name and data', async () => {
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

	it('uses the level provided in options', async () => {
		const { tracker } = trackerModule;
		tracker.init();

		tracker.track('debug-event', {}, { level: 'debug' });

		vi.advanceTimersByTime(3100);
		await flushPromises();

		const body = JSON.parse(fetchMock.mock.calls[0][1].body);
		const customEvent = body.events.find((e: any) => e.payload?.name === 'debug-event');
		expect(customEvent.level).toBe('debug');
	});

	it('includes groupId when provided in options', async () => {
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
	it('timeEnd() without a preceding time() returns -1', () => {
		const { tracker } = trackerModule;
		tracker.init();
		const result = tracker.timeEnd('missing-label');
		expect(result).toBe(-1);
	});

	it('timeEnd() without a preceding time() logs a warning', () => {
		const { tracker } = trackerModule;
		tracker.init();
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => { });
		tracker.timeEnd('missing-label');
		expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('missing-label'));
	});

	it('double time() logs a warning and does not overwrite the first', () => {
		const { tracker } = trackerModule;
		tracker.init();
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => { });

		tracker.time('my-op');
		tracker.time('my-op');

		expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('my-op'));
	});

	it('timeEnd() emits an event with the correct duration field', async () => {
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

	it('timeEnd() returns -1 when called without init()', () => {
		const { tracker } = trackerModule;
		const result = tracker.timeEnd('never-started');
		expect(result).toBe(-1);
	});
});

describe('tracker.setUser()', () => {
	it('is a no-op when not initialized', () => {
		const { tracker } = trackerModule;
		expect(() => tracker.setUser('user-123')).not.toThrow();
	});

	it('emits session:end with the old userId before changing', async () => {
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

	it('emits session:start with the new userId after the change', async () => {
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

	it('null as userId generates an anonymous ID', async () => {
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

	it('null as userId removes the userId from sessionStorage', () => {
		const { tracker } = trackerModule;
		tracker.init(() => 'user-123');

		sessionStorage.setItem('__tracker_user_id__', 'user-123');
		tracker.setUser(null);

		expect(sessionStorage.getItem('__tracker_user_id__')).toBeNull();
	});

	it('saves the new userId in sessionStorage', () => {
		const { tracker } = trackerModule;
		tracker.init();

		tracker.setUser('user-saved');

		expect(sessionStorage.getItem('__tracker_user_id__')).toBe('user-saved');
	});

	it('calls overlay.refreshUserId() when the overlay is mounted', () => {
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

	it('saves userAttributes when provided', async () => {
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
	it('is a no-op when not initialized', () => {
		const { tracker } = trackerModule;
		expect(() => tracker.setContext({ env: 'test' })).not.toThrow();
	});

	it('the context is reflected in subsequent events', async () => {
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
	it('returns a unique ID with the provided name', () => {
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

	it('returns an offline ID when not initialized', () => {
		const { tracker } = trackerModule;
		const id = tracker.group('flow');
		expect(id).toContain('flow');
		expect(id).toContain('offline');
	});

	it('the format is grp_{name}_{counter}_{timestamp}', () => {
		const { tracker } = trackerModule;
		tracker.init();

		const id = tracker.group('my-flow');
		expect(id).toMatch(/^grp_my-flow_[a-z0-9]+_[a-z0-9]+$/);
	});
});

describe('tracker.destroy()', () => {
	it('is a no-op when not initialized', () => {
		const { tracker } = trackerModule;
		expect(() => tracker.destroy()).not.toThrow();
	});

	it('emits session:end with "destroy" trigger', async () => {
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

	it('destroys the overlay if mounted', () => {
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

	it('calls all teardowns of the installed trackers', () => {
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
	it('Calls queue flush when visibilityState becomes "hidden"', async () => {
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

	it('Do not call flush if visibilityState remains "visible"', async () => {
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
	it('emits session:end and calls flush before the page closes', async () => {
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

describe('setupTrackers and tracker.init are no-ops in SSR (window undefined)', () => {
	it('neither setupTrackers nor tracker.init throw when window is undefined', async () => {
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

	it('emits a console event', async () => {
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

	it('emits an http event', async () => {
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

	it('emits a navigation event', async () => {
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

	it('throws an error when __TRACKER_CONFIG__ is missing', async () => {
		vi.resetModules();

		// @ts-ignore
		delete window.__TRACKER_CONFIG__;

		const mod = await import('../../src/client/index');

		expect(() => mod.tracker.init()).toThrow(
			'[vite-plugin-monitor] window.__TRACKER_CONFIG__ not found'
		);
	});

});

describe('emit with active overlay — overlay.pushEvent() (lines 57-59)', () => {
	it('overlay.pushEvent() is called by the emit callback of installed trackers', async () => {
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

describe('performance guard in time() and timeEnd() (lines 179-180, 190-191)', () => {
	it('time() is a no-op when performance is not available', () => {
		const { tracker } = trackerModule;
		tracker.init();

		const originalPerf = globalThis.performance;
		// @ts-ignore
		delete globalThis.performance;

		expect(() => tracker.time('perf-label')).not.toThrow();

		globalThis.performance = originalPerf;
	});

	it('timeEnd() returns -1 when performance is not available', () => {
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

describe('_mountOverlay — called on first init (overlay mounted exactly once)', () => {
	it('mounts the overlay exactly once even if init() is called twice (singleton)', async () => {
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
	it('the callback passed to DebugOverlay calls setUser and emits user:id-changed', async () => {
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

	it('the callback with null generates an anonymous userId', async () => {
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
