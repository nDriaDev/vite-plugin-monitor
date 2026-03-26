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
	it('restituisce from e to come stringhe ISO', async () => {
		const { presetToRange } = await import('../../src/dashboard/state');
		const range = presetToRange('1h');
		expect(typeof range.from).toBe('string');
		expect(typeof range.to).toBe('string');
		expect(() => new Date(range.from)).not.toThrow();
	});

	it('from è circa X minuti prima di to per ogni preset', async () => {
		const { PRESETS, presetToRange } = await import('../../src/dashboard/state');
		for (const preset of PRESETS) {
			const { from, to } = presetToRange(preset.value);
			const diffMinutes = (new Date(to).getTime() - new Date(from).getTime()) / 60_000;
			expect(Math.abs(diffMinutes - preset.minutes)).toBeLessThan(1);
		}
	});
});

describe('effectiveTimeRange', async () => {

	it('ritorna from/to invariati per preset non-live', async () => {
		const { effectiveTimeRange } = await import('../../src/dashboard/state');
		const range = { preset: '24h' as const, from: '2026-01-01T00:00:00.000Z', to: '2026-01-02T00:00:00.000Z' };
		expect(effectiveTimeRange(range)).toEqual({ from: range.from, to: range.to });
	});

	it('in live mode: to è circa now', async () => {
		const { effectiveTimeRange } = await import('../../src/dashboard/state');
		const from = new Date(Date.now() - 5 * 60_000).toISOString();
		const range = { preset: 'live' as const, from, to: new Date().toISOString() };
		const result = effectiveTimeRange(range);
		const diff = Math.abs(new Date(result.to).getTime() - Date.now());
		expect(diff).toBeLessThan(500);
	});

	it('in live mode: from non può essere più vecchio di LIVE_MAX_WINDOW_MS', async () => {
		const { effectiveTimeRange, LIVE_MAX_WINDOW_MS } = await import('../../src/dashboard/state');
		const veryOldFrom = new Date(Date.now() - LIVE_MAX_WINDOW_MS - 60_000).toISOString();
		const range = { preset: 'live' as const, from: veryOldFrom, to: new Date().toISOString() };
		const result = effectiveTimeRange(range);
		const windowMs = new Date(result.to).getTime() - new Date(result.from).getTime();
		expect(windowMs).toBeLessThanOrEqual(LIVE_MAX_WINDOW_MS + 500);
	});
});

describe('store', () => {
	describe('stato iniziale', () => {
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
	});

	describe('setAuth', () => {
		it('aggiorna authenticated e emette auth:change', async () => {
			const { store } = await import('../../src/dashboard/state');
			const listener = vi.fn();
			store.on('auth:change', listener);
			store.setAuth(true);
			expect(store.get().authenticated).toBe(true);
			expect(listener).toHaveBeenCalledWith(true);
		});
	});

	describe('setTab', () => {
		it('aggiorna tab e emette tab:change', async () => {
			const { store } = await import('../../src/dashboard/state');
			const listener = vi.fn();
			store.on('tab:change', listener);
			store.setTab('events');
			expect(store.get().tab).toBe('events');
			expect(listener).toHaveBeenCalledWith('events');
		});

		it('azzera selectedEvent se era selezionato e emette events:select null', async () => {
			const { store } = await import('../../src/dashboard/state');
			const selectListener = vi.fn();
			store.on('events:select', selectListener);
			const event = makeEvent();
			store.selectEvent(event);
			store.setTab('events');
			expect(store.get().selectedEvent).toBeNull();
			expect(selectListener).toHaveBeenLastCalledWith(null);
		});

		it('non emette events:select se selectedEvent era già null', async () => {
			const { store } = await import('../../src/dashboard/state');
			const selectListener = vi.fn();
			store.on('events:select', selectListener);
			store.setTab('events');
			expect(selectListener).not.toHaveBeenCalled();
		});
	});

	describe('setTimeRange', () => {
		it('aggiorna timeRange e emette timeRange:change', async () => {
			const { store, presetToRange } = await import('../../src/dashboard/state');
			const listener = vi.fn();
			store.on('timeRange:change', listener);
			const range = { preset: '1h' as const, ...presetToRange('1h') };
			store.setTimeRange(range);
			expect(store.get().timeRange).toEqual(range);
			expect(listener).toHaveBeenCalledWith(range);
		});

		it('azzera selectedEvent', async () => {
			const { store, presetToRange } = await import('../../src/dashboard/state');
			store.selectEvent(makeEvent());
			store.setTimeRange({ preset: '1h' as const, ...presetToRange('1h') });
			expect(store.get().selectedEvent).toBeNull();
		});

		it('riesegue il filtro sugli eventi esistenti', async () => {
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
		it('aggiorna chartType e emette chartType:change', async () => {
			const { store } = await import('../../src/dashboard/state');
			const listener = vi.fn();
			store.on('chartType:change', listener);
			store.setChartType('bar');
			expect(store.get().chartType).toBe('bar');
			expect(listener).toHaveBeenCalledWith('bar');
		});
	});

	describe('setMetrics', () => {
		it('aggiorna metrics, stats, metricsLoading=false, metricsError=null e emette metrics:update', async () => {
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
		it('aggiorna metricsLoading e emette metrics:loading', async () => {
			const { store } = await import('../../src/dashboard/state');
			const listener = vi.fn();
			store.on('metrics:loading', listener);
			store.setMetricsLoading(true);
			expect(store.get().metricsLoading).toBe(true);
			expect(listener).toHaveBeenCalledWith(true);
		});
	});

	describe('setMetricsError', () => {
		it('imposta metricsError, metricsLoading=false, e emette metrics:error', async () => {
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
		it('aggiorna gli eventi e applica il filtro corrente', async () => {
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
		it('aggiorna eventsFilter e riesegue il filtro', async () => {
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

		it('azzera selectedEvent', async () => {
			const { store } = await import('../../src/dashboard/state');
			store.selectEvent(makeEvent());
			store.setEventsFilter({});
			expect(store.get().selectedEvent).toBeNull();
		});
	});

	describe('setEventsLoading', () => {
		it('aggiorna eventsLoading e emette events:loading', async () => {
			const { store } = await import('../../src/dashboard/state');
			const listener = vi.fn();
			store.on('events:loading', listener);
			store.setEventsLoading(true);
			expect(store.get().eventsLoading).toBe(true);
			expect(listener).toHaveBeenCalledWith(true);
		});
	});

	describe('setEventsError', () => {
		it('imposta eventsError, eventsLoading=false, e emette events:error', async () => {
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
		it('imposta selectedEvent e emette events:select', async () => {
			const { store } = await import('../../src/dashboard/state');
			const listener = vi.fn();
			store.on('events:select', listener);
			const event = makeEvent();
			store.selectEvent(event);
			expect(store.get().selectedEvent).toEqual(event);
			expect(listener).toHaveBeenCalledWith(event);
		});

		it('accetta null per deselezionare', async () => {
			const { store } = await import('../../src/dashboard/state');
			const event = makeEvent();
			store.selectEvent(event);
			store.selectEvent(null);
			expect(store.get().selectedEvent).toBeNull();
		});
	});

	describe('resetSelectEvent', () => {
		it('azzera selectedEvent e emette events:select null', async () => {
			const { store } = await import('../../src/dashboard/state');
			const listener = vi.fn();
			store.on('events:select', listener);
			store.selectEvent(makeEvent());
			store.resetSelectEvent();
			expect(store.get().selectedEvent).toBeNull();
			expect(listener).toHaveBeenLastCalledWith(null);
		});

		it('è no-op se selectedEvent è già null', async () => {
			const { store } = await import('../../src/dashboard/state');
			const listener = vi.fn();
			store.on('events:select', listener);
			store.resetSelectEvent();
			expect(listener).not.toHaveBeenCalled();
		});
	});

	describe('setBackendStatus', () => {
		it('aggiorna backendOnline e emette backend:status', async () => {
			const { store } = await import('../../src/dashboard/state');
			const listener = vi.fn();
			store.on('backend:status', listener);
			store.setBackendStatus(false);
			expect(store.get().backendOnline).toBe(false);
			expect(listener).toHaveBeenCalledWith(false);
		});
	});

	describe('clearListeners', () => {
		it('rimuove tutti i listener registrati', async () => {
			const { store } = await import('../../src/dashboard/state');
			const listener = vi.fn();
			store.on('auth:change', listener);
			store.clearListeners();
			store.setAuth(true);
			expect(listener).not.toHaveBeenCalled();
		});
	});

	describe('getUniqueUserIds', () => {
		it('restituisce gli userId univoci ordinati', async () => {
			const { store } = await import('../../src/dashboard/state');
			store.setEvents([
				makeEvent({ userId: 'charlie' }),
				makeEvent({ userId: 'alice' }),
				makeEvent({ userId: 'alice' }),
				makeEvent({ userId: 'bob' }),
			], 4);
			expect(store.getUniqueUserIds()).toEqual(['alice', 'bob', 'charlie']);
		});

		it('restituisce array vuoto se non ci sono eventi', async () => {
			const { store } = await import('../../src/dashboard/state');
			expect(store.getUniqueUserIds()).toEqual([]);
		});
	});

	describe('applyFilter', () => {
		it('filtra per type', async () => {
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

		it('filtra per level (array)', async () => {
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

		it('filtra per userId (case-insensitive substring)', async () => {
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

		it('filtra per search con operatore "contains" (default)', async () => {
			const { store } = await import('../../src/dashboard/state');
			store.setTimeRange(makePermissiveRange());
			store.setEvents([
				makeEvent({ type: 'error', payload: { message: 'TypeError: foo' } as ErrorPayload }),
				makeEvent({ type: 'error', payload: { message: 'ReferenceError: bar' } as ErrorPayload }),
			], 2);
			store.setEventsFilter({ search: 'TypeError' });
			expect(store.get().events).toHaveLength(1);
		});

		it('filtra per search con operatore "not-contains"', async () => {
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

		it('filtra per search con operatore "equals"', async () => {
			const { store } = await import('../../src/dashboard/state');
			store.setTimeRange(makePermissiveRange());
			store.setEvents([
				makeEvent({ type: 'error', payload: { message: 'TypeError: foo' } as ErrorPayload }),
				makeEvent({ type: 'error', payload: { message: 'ReferenceError: bar' } as ErrorPayload }),
			], 2);

			store.setEventsFilter({ search: 'TypeError: foo', searchOperator: 'equals' });
			expect(store.get().events).toHaveLength(1);
		});

		it('filtra per search con operatore "starts-with"', async () => {
			const { store } = await import('../../src/dashboard/state');
			store.setTimeRange(makePermissiveRange());
			store.setEvents([
				makeEvent({ type: 'error', payload: { message: 'TypeError: foo' } as ErrorPayload }),
				makeEvent({ type: 'error', payload: { message: 'ReferenceError: bar' } as ErrorPayload }),
			], 2);
			store.setEventsFilter({ search: 'TypeError', searchOperator: 'starts-with' });
			expect(store.get().events).toHaveLength(1);
		});

		it('filtra per search con operatore "ends-with"', async () => {
			const { store } = await import('../../src/dashboard/state');
			store.setTimeRange(makePermissiveRange());
			store.setEvents([
				makeEvent({ type: 'error', payload: { message: 'TypeError: foo' } as ErrorPayload }),
				makeEvent({ type: 'error', payload: { message: 'TypeError: bar' } as ErrorPayload }),
			], 2);
			store.setEventsFilter({ search: ': foo', searchOperator: 'ends-with' });
			expect(store.get().events).toHaveLength(1);
		});

		it('filtra per search con operatore "regex"', async () => {
			const { store } = await import('../../src/dashboard/state');
			store.setTimeRange(makePermissiveRange());
			store.setEvents([
				makeEvent({ type: 'error', payload: { message: 'TypeError: foo123' } as ErrorPayload }),
				makeEvent({ type: 'error', payload: { message: 'just text' } as ErrorPayload }),
			], 2);
			store.setEventsFilter({ search: 'foo\\d+', searchOperator: 'regex' });
			expect(store.get().events).toHaveLength(1);
		});

		it('regex non valida: fallback a "contains"', async () => {
			const { store } = await import('../../src/dashboard/state');
			store.setTimeRange(makePermissiveRange());
			store.setEvents([
				makeEvent({ type: 'error', payload: { message: 'TypeError: foo' } as ErrorPayload }),
				makeEvent({ type: 'error', payload: { message: 'other' } as ErrorPayload }),
			], 2);

			store.setEventsFilter({ search: '[invalid', searchOperator: 'regex' });
			expect(store.get().events).toHaveLength(0);
		});

		it('filtra per route', async () => {
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

		it('aggiorna eventsTotal dopo il filtro', async () => {
			const { store } = await import('../../src/dashboard/state');
			store.setTimeRange(makePermissiveRange());
			store.setEvents([makeEvent({ type: 'click' }), makeEvent({ type: 'http' })], 2);
			store.setEventsFilter({ type: 'click' });
			expect(store.get().eventsTotal).toBe(1);
		});
	});
});
