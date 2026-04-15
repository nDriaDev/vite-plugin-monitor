import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { ErrorPayload, TrackerEvent } from '@tracker/types';

function makeEvent(overrides: Partial<TrackerEvent> = {}): TrackerEvent {
	return {
		id: 'evt-1',
		appId: 'test-app',
		sessionId: 'sess-1',
		userId: 'user-1',
		timestamp: new Date().toISOString(),
		type: 'click',
		level: 'info',
		payload: { tag: 'BUTTON', id: '', text: 'OK' },
		meta: { route: '/home', viewport: '1280x800', language: 'it' },
		groupId: undefined,
		...overrides,
	} as TrackerEvent;
}

function makePermissiveRange() {
	const now = Date.now();
	return {
		preset: '24h' as const,
		from: new Date(now - 24 * 60 * 60_000).toISOString(),
		to: new Date(now + 60_000).toISOString(), // +1 min di margine
	};
}

describe('presetToRange', async () => {
	it('returns from and to as ISO strings', async () => {
		const { presetToRange } = await import('../../src/dashboard/state');
		const range = presetToRange('1h');
		expect(typeof range.from).toBe('string');
		expect(typeof range.to).toBe('string');
		expect(() => new Date(range.from)).not.toThrow();
	});

	it('from is approximately X minutes before to for each preset', async () => {
		const { PRESETS, presetToRange } = await import('../../src/dashboard/state');
		for (const preset of PRESETS) {
			const { from, to } = presetToRange(preset.value);
			const diffMinutes = (new Date(to).getTime() - new Date(from).getTime()) / 60_000;
			expect(Math.abs(diffMinutes - preset.minutes)).toBeLessThan(1);
		}
	});
});

describe('effectiveTimeRange', async () => {

	it('returns from/to unchanged for non-live preset', async () => {
		const { effectiveTimeRange } = await import('../../src/dashboard/state');
		const range = { preset: '24h' as const, from: '2026-01-01T00:00:00.000Z', to: '2026-01-02T00:00:00.000Z' };
		expect(effectiveTimeRange(range)).toEqual({ from: range.from, to: range.to });
	});

	it('in live mode: to is approximately now', async () => {
		const { effectiveTimeRange } = await import('../../src/dashboard/state');
		const from = new Date(Date.now() - 5 * 60_000).toISOString();
		const range = { preset: 'live' as const, from, to: new Date().toISOString() };
		const result = effectiveTimeRange(range);
		const diff = Math.abs(new Date(result.to).getTime() - Date.now());
		expect(diff).toBeLessThan(500);
	});

	it('in live mode: from cannot be older than LIVE_MAX_WINDOW_MS', async () => {
		const { effectiveTimeRange, LIVE_MAX_WINDOW_MS } = await import('../../src/dashboard/state');
		const veryOldFrom = new Date(Date.now() - LIVE_MAX_WINDOW_MS - 60_000).toISOString();
		const range = { preset: 'live' as const, from: veryOldFrom, to: new Date().toISOString() };
		const result = effectiveTimeRange(range);
		const windowMs = new Date(result.to).getTime() - new Date(result.from).getTime();
		expect(windowMs).toBeLessThanOrEqual(LIVE_MAX_WINDOW_MS + 500);
	});
});

describe('store', () => {
	describe('initial state', () => {
		it('authenticated = false', async () => {
			const { store } = await import('../../src/dashboard/state');
			expect(store.get().authenticated).toBe(false);
		});

		it('tab = "metrics"', async () => {
			const { store } = await import('../../src/dashboard/state');
			expect(store.get().tab).toBe('metrics');
		});

		it('chartType = "line"', async () => {
			const { store } = await import('../../src/dashboard/state');
			expect(store.get().chartType).toBe('line');
		});

		it('backendOnline = true', async () => {
			const { store } = await import('../../src/dashboard/state');
			expect(store.get().backendOnline).toBe(true);
		});

		it('volumeBucket = "1h"', async () => {
			const { store } = await import('../../src/dashboard/state');
			expect(store.get().volumeBucket).toBe('1h');
		});

		it('errorBucket = "1h"', async () => {
			const { store } = await import('../../src/dashboard/state');
			expect(store.get().errorBucket).toBe('1h');
		});
	});

	describe('setAuth', () => {
		it('updates authenticated and emits auth:change', async () => {
			const { store } = await import('../../src/dashboard/state');
			const listener = vi.fn();
			store.on('auth:change', listener);
			store.setAuth(true);
			expect(store.get().authenticated).toBe(true);
			expect(listener).toHaveBeenCalledWith(true);
		});
	});

	describe('setTab', () => {
		it('updates tab and emits tab:change', async () => {
			const { store } = await import('../../src/dashboard/state');
			const listener = vi.fn();
			store.on('tab:change', listener);
			store.setTab('events');
			expect(store.get().tab).toBe('events');
			expect(listener).toHaveBeenCalledWith('events');
		});

		it('clears selectedEvent when it was selected and emits events:select null', async () => {
			const { store } = await import('../../src/dashboard/state');
			const selectListener = vi.fn();
			store.on('events:select', selectListener);
			const event = makeEvent();
			store.selectEvent(event);
			store.setTab('events');
			expect(store.get().selectedEvent).toBeNull();
			expect(selectListener).toHaveBeenLastCalledWith(null);
		});

		it('does not emit events:select when selectedEvent was already null', async () => {
			const { store } = await import('../../src/dashboard/state');
			const selectListener = vi.fn();
			store.on('events:select', selectListener);
			store.setTab('events');
			expect(selectListener).not.toHaveBeenCalled();
		});
	});

	describe('setTimeRange', () => {
		it('updates timeRange and emits timeRange:change', async () => {
			const { store, presetToRange } = await import('../../src/dashboard/state');
			const listener = vi.fn();
			store.on('timeRange:change', listener);
			const range = { preset: '1h' as const, ...presetToRange('1h') };
			store.setTimeRange(range);
			expect(store.get().timeRange).toEqual(range);
			expect(listener).toHaveBeenCalledWith(range);
		});

		it('clears selectedEvent', async () => {
			const { store, presetToRange } = await import('../../src/dashboard/state');
			store.selectEvent(makeEvent());
			store.setTimeRange({ preset: '1h' as const, ...presetToRange('1h') });
			expect(store.get().selectedEvent).toBeNull();
		});

		it('re-applies the filter on existing events', async () => {
			const { store, presetToRange } = await import('../../src/dashboard/state');
			const now = new Date();
			const old = new Date(now.getTime() - 90 * 60_000).toISOString();
			const recent = new Date(now.getTime() - 10 * 60_000).toISOString();
			store.setEvents([makeEvent({ timestamp: old }), makeEvent({ timestamp: recent })], 2);
			store.setTimeRange({ preset: '1h' as const, ...presetToRange('1h') });

			expect(store.get().events.length).toBe(1);
		});
	});

	describe('setChartType', () => {
		it('updates chartType and emits chartType:change', async () => {
			const { store } = await import('../../src/dashboard/state');
			const listener = vi.fn();
			store.on('chartType:change', listener);
			store.setChartType('bar');
			expect(store.get().chartType).toBe('bar');
			expect(listener).toHaveBeenCalledWith('bar');
		});
	});

	describe('setVolumeBucket', () => {
		it('updates volumeBucket and emits volumeBucket:change', async () => {
			const { store } = await import('../../src/dashboard/state');
			const listener = vi.fn();
			store.on('volumeBucket:change', listener);
			store.setVolumeBucket('6h');
			expect(store.get().volumeBucket).toBe('6h');
			expect(listener).toHaveBeenCalledWith('6h');
		});

		it('does not affect errorBucket', async () => {
			const { store } = await import('../../src/dashboard/state');
			const before = store.get().errorBucket;
			store.setVolumeBucket('7d');
			expect(store.get().errorBucket).toBe(before);
		});
	});

	describe('setErrorBucket', () => {
		it('updates errorBucket and emits errorBucket:change', async () => {
			const { store } = await import('../../src/dashboard/state');
			const listener = vi.fn();
			store.on('errorBucket:change', listener);
			store.setErrorBucket('12h');
			expect(store.get().errorBucket).toBe('12h');
			expect(listener).toHaveBeenCalledWith('12h');
		});

		it('does not affect volumeBucket', async () => {
			const { store } = await import('../../src/dashboard/state');
			const before = store.get().volumeBucket;
			store.setErrorBucket('30m');
			expect(store.get().volumeBucket).toBe(before);
		});
	});

	describe('setMetrics', () => {
		it('updates metrics, stats, metricsLoading=false, metricsError=null and emits metrics:update', async () => {
			const { store } = await import('../../src/dashboard/state');
			const listener = vi.fn();
			store.on('metrics:update', listener);
			const metrics = { activeSessions: 1, eventVolume: [], errorRateTimeline: [], topPages: [], topErrors: [], navigationFunnel: [], topEndpoints: [] };
			const stats = { totalEvents: 10, totalSessions: 2, totalUsers: 3, errorRate: 0, topRoutes: [], topUsers: [], timeline: [], httpStats: { total: 0, count2xx: 0, count4xx: 0, count5xx: 0, pct2xx: 0, pct4xx: 0, pct5xx: 0, httpErrorRate: 0 } };
			store.setMetrics(metrics as any, stats as any);
			const s = store.get();
			expect(s.metrics).toEqual(metrics);
			expect(s.stats).toEqual(stats);
			expect(s.metricsLoading).toBe(false);
			expect(s.metricsError).toBeNull();
			expect(listener).toHaveBeenCalled();
		});
	});

	describe('setMetricsLoading', () => {
		it('updates metricsLoading and emits metrics:loading', async () => {
			const { store } = await import('../../src/dashboard/state');
			const listener = vi.fn();
			store.on('metrics:loading', listener);
			store.setMetricsLoading(true);
			expect(store.get().metricsLoading).toBe(true);
			expect(listener).toHaveBeenCalledWith(true);
		});
	});

	describe('setMetricsError', () => {
		it('sets metricsError, metricsLoading=false, and emits metrics:error', async () => {
			const { store } = await import('../../src/dashboard/state');
			const listener = vi.fn();
			store.on('metrics:error', listener);
			store.setMetricsError('qualcosa è andato storto');
			const s = store.get();
			expect(s.metricsError).toBe('qualcosa è andato storto');
			expect(s.metricsLoading).toBe(false);
			expect(listener).toHaveBeenCalledWith('qualcosa è andato storto');
		});
	});

	describe('setEvents', () => {
		it('updates events and applies the current filter', async () => {
			const { store } = await import('../../src/dashboard/state');
			const listener = vi.fn();
			store.on('events:update', listener);
			const events = [makeEvent()];
			store.setEvents(events, 1);
			expect(store.get().eventsLoading).toBe(false);
			expect(store.get().eventsError).toBeNull();
			expect(listener).toHaveBeenCalled();
		});
	});

	describe('setEventsFilter', () => {
		it('updates eventsFilter and re-applies the filter', async () => {
			const { store } = await import('../../src/dashboard/state');
			const filterListener = vi.fn();
			const updateListener = vi.fn();
			store.on('events:filter', filterListener);
			store.on('events:update', updateListener);
			store.setEventsFilter({ type: 'click' });
			expect(store.get().eventsFilter).toEqual({ type: 'click' });
			expect(filterListener).toHaveBeenCalledWith({ type: 'click' });
			expect(updateListener).toHaveBeenCalled();
		});

		it('clears selectedEvent', async () => {
			const { store } = await import('../../src/dashboard/state');
			store.selectEvent(makeEvent());
			store.setEventsFilter({});
			expect(store.get().selectedEvent).toBeNull();
		});
	});

	describe('setEventsLoading', () => {
		it('updates eventsLoading and emits events:loading', async () => {
			const { store } = await import('../../src/dashboard/state');
			const listener = vi.fn();
			store.on('events:loading', listener);
			store.setEventsLoading(true);
			expect(store.get().eventsLoading).toBe(true);
			expect(listener).toHaveBeenCalledWith(true);
		});
	});

	describe('setEventsError', () => {
		it('sets eventsError, eventsLoading=false, and emits events:error', async () => {
			const { store } = await import('../../src/dashboard/state');
			const listener = vi.fn();
			store.on('events:error', listener);
			store.setEventsError('network error');
			const s = store.get();
			expect(s.eventsError).toBe('network error');
			expect(s.eventsLoading).toBe(false);
			expect(listener).toHaveBeenCalledWith('network error');
		});
	});

	describe('selectEvent', () => {
		it('sets selectedEvent and emits events:select', async () => {
			const { store } = await import('../../src/dashboard/state');
			const listener = vi.fn();
			store.on('events:select', listener);
			const event = makeEvent();
			store.selectEvent(event);
			expect(store.get().selectedEvent).toEqual(event);
			expect(listener).toHaveBeenCalledWith(event);
		});

		it('accepts null to deselect', async () => {
			const { store } = await import('../../src/dashboard/state');
			const event = makeEvent();
			store.selectEvent(event);
			store.selectEvent(null);
			expect(store.get().selectedEvent).toBeNull();
		});
	});

	describe('resetSelectEvent', () => {
		it('clears selectedEvent and emits events:select null', async () => {
			const { store } = await import('../../src/dashboard/state');
			const listener = vi.fn();
			store.on('events:select', listener);
			store.selectEvent(makeEvent());
			store.resetSelectEvent();
			expect(store.get().selectedEvent).toBeNull();
			expect(listener).toHaveBeenLastCalledWith(null);
		});

		it('is a no-op when selectedEvent is already null', async () => {
			const { store } = await import('../../src/dashboard/state');
			const listener = vi.fn();
			store.on('events:select', listener);
			store.resetSelectEvent();
			expect(listener).not.toHaveBeenCalled();
		});
	});

	describe('setBackendStatus', () => {
		it('updates backendOnline and emits backend:status', async () => {
			const { store } = await import('../../src/dashboard/state');
			const listener = vi.fn();
			store.on('backend:status', listener);
			store.setBackendStatus(false);
			expect(store.get().backendOnline).toBe(false);
			expect(listener).toHaveBeenCalledWith(false);
		});
	});

	describe('clearListeners', () => {
		it('removes all registered listeners', async () => {
			const { store } = await import('../../src/dashboard/state');
			const listener = vi.fn();
			store.on('auth:change', listener);
			store.clearListeners();
			store.setAuth(true);
			expect(listener).not.toHaveBeenCalled();
		});
	});

	describe('getUniqueUserIds', () => {
		it('returns the unique sorted userIds', async () => {
			const { store } = await import('../../src/dashboard/state');
			store.setEvents([
				makeEvent({ userId: 'charlie' }),
				makeEvent({ userId: 'alice' }),
				makeEvent({ userId: 'alice' }),
				makeEvent({ userId: 'bob' }),
			], 4);
			expect(store.getUniqueUserIds()).toEqual(['alice', 'bob', 'charlie']);
		});

		it('returns an empty array when there are no events', async () => {
			const { store } = await import('../../src/dashboard/state');
			expect(store.getUniqueUserIds()).toEqual([]);
		});
	});

	describe('applyFilter', () => {
		it('filters by type', async () => {
			const { store } = await import('../../src/dashboard/state');
			store.setTimeRange(makePermissiveRange());
			store.setEvents([
				makeEvent({ type: 'click' }),
				makeEvent({ type: 'http' }),
			], 2);
			store.setEventsFilter({ type: 'click' });
			expect(store.get().events).toHaveLength(1);
			expect(store.get().events[0].type).toBe('click');
		});

		it('filters by level (array)', async () => {
			const { store } = await import('../../src/dashboard/state');
			store.setTimeRange(makePermissiveRange());
			store.setEvents([
				makeEvent({ level: 'info' }),
				makeEvent({ level: 'error' }),
			], 2);
			store.setEventsFilter({ level: ['error'] });
			expect(store.get().events).toHaveLength(1);
			expect(store.get().events[0].level).toBe('error');
		});

		it('filters by userId (case-insensitive substring)', async () => {
			const { store } = await import('../../src/dashboard/state');
			store.setTimeRange(makePermissiveRange());
			store.setEvents([
				makeEvent({ userId: 'Alice' }),
				makeEvent({ userId: 'bob' }),
			], 2);
			store.setEventsFilter({ userId: 'ali' });
			expect(store.get().events).toHaveLength(1);
			expect(store.get().events[0].userId).toBe('Alice');
		});

		it('filter by search with "contains" operator (default)', async () => {
			const { store } = await import('../../src/dashboard/state');
			store.setTimeRange(makePermissiveRange());
			store.setEvents([
				makeEvent({ type: 'error', payload: { message: 'TypeError: foo' } as ErrorPayload }),
				makeEvent({ type: 'error', payload: { message: 'ReferenceError: bar' } as ErrorPayload }),
			], 2);
			store.setEventsFilter({ search: 'TypeError' });
			expect(store.get().events).toHaveLength(1);
		});

		it('filter by search with the "not-contains" operator', async () => {
			const { store } = await import('../../src/dashboard/state');
			store.setTimeRange(makePermissiveRange());
			store.setEvents([
				makeEvent({ type: 'error', payload: { message: 'TypeError: foo' } as ErrorPayload }),
				makeEvent({ type: 'error', payload: { message: 'ReferenceError: bar' } as ErrorPayload }),
			], 2);
			store.setEventsFilter({ search: 'TypeError', searchOperator: 'not-contains' });
			expect(store.get().events).toHaveLength(1);
			expect(store.get().events[0].payload).toMatchObject({ message: 'ReferenceError: bar' });
		});

		it('filter by search with the "equals" operator', async () => {
			const { store } = await import('../../src/dashboard/state');
			store.setTimeRange(makePermissiveRange());
			store.setEvents([
				makeEvent({ type: 'error', payload: { message: 'TypeError: foo' } as ErrorPayload }),
				makeEvent({ type: 'error', payload: { message: 'ReferenceError: bar' } as ErrorPayload }),
			], 2);

			store.setEventsFilter({ search: 'TypeError: foo', searchOperator: 'equals' });
			expect(store.get().events).toHaveLength(1);
		});

		it('filter by search with "starts-with" operator', async () => {
			const { store } = await import('../../src/dashboard/state');
			store.setTimeRange(makePermissiveRange());
			store.setEvents([
				makeEvent({ type: 'error', payload: { message: 'TypeError: foo' } as ErrorPayload }),
				makeEvent({ type: 'error', payload: { message: 'ReferenceError: bar' } as ErrorPayload }),
			], 2);
			store.setEventsFilter({ search: 'TypeError', searchOperator: 'starts-with' });
			expect(store.get().events).toHaveLength(1);
		});

		it('filter by search with "ends-with" operator', async () => {
			const { store } = await import('../../src/dashboard/state');
			store.setTimeRange(makePermissiveRange());
			store.setEvents([
				makeEvent({ type: 'error', payload: { message: 'TypeError: foo' } as ErrorPayload }),
				makeEvent({ type: 'error', payload: { message: 'TypeError: bar' } as ErrorPayload }),
			], 2);
			store.setEventsFilter({ search: ': foo', searchOperator: 'ends-with' });
			expect(store.get().events).toHaveLength(1);
		});

		it('filter by search with "regex" operator', async () => {
			const { store } = await import('../../src/dashboard/state');
			store.setTimeRange(makePermissiveRange());
			store.setEvents([
				makeEvent({ type: 'error', payload: { message: 'TypeError: foo123' } as ErrorPayload }),
				makeEvent({ type: 'error', payload: { message: 'just text' } as ErrorPayload }),
			], 2);
			store.setEventsFilter({ search: 'foo\\d+', searchOperator: 'regex' });
			expect(store.get().events).toHaveLength(1);
		});

		it('invalid regex: fallback to "contains"', async () => {
			const { store } = await import('../../src/dashboard/state');
			store.setTimeRange(makePermissiveRange());
			store.setEvents([
				makeEvent({ type: 'error', payload: { message: 'TypeError: foo' } as ErrorPayload }),
				makeEvent({ type: 'error', payload: { message: 'other' } as ErrorPayload }),
			], 2);

			store.setEventsFilter({ search: '[invalid', searchOperator: 'regex' });
			expect(store.get().events).toHaveLength(0);
		});

		it('filters by route', async () => {
			const { store } = await import('../../src/dashboard/state');
			store.setTimeRange(makePermissiveRange());
			store.setEvents([
				makeEvent({ meta: { route: '/home', viewport: '1280x800', language: 'it', userAgent: "test" } }),
				makeEvent({ meta: { route: '/about', viewport: '1280x800', language: 'it', userAgent: "test" } }),
			], 2);
			store.setEventsFilter({ route: '/home' });
			expect(store.get().events).toHaveLength(1);
			expect(store.get().events[0].meta.route).toBe('/home');
		});

		it('updates eventsTotal after filtering', async () => {
			const { store } = await import('../../src/dashboard/state');
			store.setTimeRange(makePermissiveRange());
			store.setEvents([makeEvent({ type: 'click' }), makeEvent({ type: 'http' })], 2);
			store.setEventsFilter({ type: 'click' });
			expect(store.get().eventsTotal).toBe(1);
		});
	});
});
