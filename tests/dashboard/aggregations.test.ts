import { describe, it, expect } from 'vitest';
import { computeMetrics, computeStats } from '../../src/dashboard/aggregations';
import type { EventPayload, TrackerEvent } from '../../src/types';

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

const SINCE = '2026-01-01T00:00:00.000Z';
const UNTIL = '2026-12-31T23:59:59.000Z';
const TS = '2026-06-15T12:00:00.000Z';

describe('computeMetrics', () => {
	it('restituisce activeSessions=0 per array vuoto', () => {
		const result = computeMetrics([], SINCE, UNTIL);
		expect(result.activeSessions).toBe(0);
	});

	it('conta le sessioni attive negli ultimi 5 minuti', () => {
		const recent = new Date(Date.now() - 2 * 60_000).toISOString();
		const old = new Date(Date.now() - 10 * 60_000).toISOString();
		const events = [
			makeEvent({ sessionId: 'sess-recent', timestamp: recent }),
			makeEvent({ sessionId: 'sess-old', timestamp: old }),
		];
		const result = computeMetrics(events, old, new Date().toISOString());
		expect(result.activeSessions).toBe(1);
	});

	it('raggruppa per bucket orario se diffHours <= 48', () => {
		const events = [
			makeEvent({ timestamp: '2026-06-15T12:00:00.000Z' }),
			makeEvent({ timestamp: '2026-06-15T12:30:00.000Z' }),
			makeEvent({ timestamp: '2026-06-15T13:00:00.000Z' }),
		];
		const result = computeMetrics(events, '2026-06-15T00:00:00.000Z', '2026-06-15T23:59:59.000Z');
		expect(result.eventVolume.length).toBeGreaterThan(0);

		const bucket12 = result.eventVolume.find((b: any) => b.bucket.includes('T12:00'));
		expect(bucket12).toBeDefined();
		expect(bucket12!.value).toBe(2);
	});

	it('raggruppa per bucket giornaliero se diffHours > 48', () => {
		const events = [
			makeEvent({ timestamp: '2026-06-15T12:00:00.000Z' }),
			makeEvent({ timestamp: '2026-06-16T12:00:00.000Z' }),
			makeEvent({ timestamp: '2026-06-16T18:00:00.000Z' }),
		];
		const result = computeMetrics(events, '2026-06-01T00:00:00.000Z', '2026-06-30T23:59:59.000Z');
		const bucketDay16 = result.eventVolume.find((b: any) => b.bucket === '2026-06-16');
		expect(bucketDay16).toBeDefined();
		expect(bucketDay16!.value).toBe(2);
	});

	it('calcola errorRateTimeline correttamente', () => {
		const events = [
			makeEvent({ timestamp: TS, level: 'info' }),
			makeEvent({ timestamp: TS, level: 'error' }),
		];
		const result = computeMetrics(events, SINCE, UNTIL);
		const bucket = result.errorRateTimeline[0];
		expect(bucket.value).toBe(50);
	});

	it('calcola topPages da eventi navigation', () => {
		const events = [
			makeEvent({ timestamp: TS, type: 'navigation', payload: { from: '/home', to: '/about' } as unknown as EventPayload }),
			makeEvent({ timestamp: TS, type: 'navigation', payload: { from: '/home', to: '/about' } as unknown as EventPayload }),
			makeEvent({ timestamp: TS, type: 'navigation', payload: { from: '/home', to: '/contact' } as unknown as EventPayload }),
		];
		const result = computeMetrics(events, SINCE, UNTIL);
		expect(result.topPages[0]).toEqual({ label: '/about', count: 2 });
		expect(result.topPages[1]).toEqual({ label: '/contact', count: 1 });
	});

	it('ignora navigation con to vuoto', () => {
		const events = [
			makeEvent({ timestamp: TS, type: 'navigation', payload: { from: '/home', to: '' } as unknown as EventPayload }),
		];
		const result = computeMetrics(events, SINCE, UNTIL);
		expect(result.topPages).toHaveLength(0);
	});

	it('calcola topErrors da eventi error', () => {
		const events = [
			makeEvent({ timestamp: TS, type: 'error', payload: { message: 'TypeError: foo' } as unknown as EventPayload }),
			makeEvent({ timestamp: TS, type: 'error', payload: { message: 'TypeError: foo' } as unknown as EventPayload }),
			makeEvent({ timestamp: TS, type: 'error', payload: { message: 'ReferenceError' } as unknown as EventPayload }),
		];
		const result = computeMetrics(events, SINCE, UNTIL);
		expect(result.topErrors[0].message).toBe('TypeError: foo');
		expect(result.topErrors[0].count).toBe(2);
	});

	it('topErrors: lastSeen viene aggiornato con il timestamp più recente', () => {
		const ts1 = '2026-06-15T10:00:00.000Z';
		const ts2 = '2026-06-15T12:00:00.000Z';
		const events = [
			makeEvent({ timestamp: ts1, type: 'error', payload: { message: 'Err' } as unknown as EventPayload }),
			makeEvent({ timestamp: ts2, type: 'error', payload: { message: 'Err' } as unknown as EventPayload }),
		];
		const result = computeMetrics(events, SINCE, UNTIL);
		expect(result.topErrors[0].lastSeen).toBe(ts2);
	});

	it('calcola navigationFunnel', () => {
		const events = [
			makeEvent({ timestamp: TS, type: 'navigation', payload: { from: '/home', to: '/about' } as unknown as EventPayload }),
			makeEvent({ timestamp: TS, type: 'navigation', payload: { from: '/home', to: '/about' } as unknown as EventPayload }),
		];
		const result = computeMetrics(events, SINCE, UNTIL);
		expect(result.navigationFunnel[0]).toEqual({ from: '/home', to: '/about', count: 2 });
	});

	it('ignora navigation con from === to nel funnel', () => {
		const events = [
			makeEvent({ timestamp: TS, type: 'navigation', payload: { from: '/home', to: '/home' } as unknown as EventPayload }),
		];
		const result = computeMetrics(events, SINCE, UNTIL);
		expect(result.navigationFunnel).toHaveLength(0);
	});

	it('calcola topEndpoints da eventi http', () => {
		const events = [
			makeEvent({ timestamp: TS, type: 'http', payload: { method: 'GET', url: '/api/users', status: 200 } as unknown as EventPayload }),
			makeEvent({ timestamp: TS, type: 'http', payload: { method: 'GET', url: '/api/users', status: 200 } }),
			makeEvent({ timestamp: TS, type: 'http', payload: { method: 'POST', url: '/api/orders', status: 201 } }),
		];
		const result = computeMetrics(events, SINCE, UNTIL);
		expect(result.topEndpoints[0]).toEqual({ label: '/api/users', count: 2 });
	});

	it('esclude eventi fuori dalla finestra temporale', () => {
		const events = [
			makeEvent({ timestamp: '2025-01-01T00:00:00.000Z' }),
		];
		const result = computeMetrics(events, SINCE, UNTIL);

		expect(result.eventVolume).toHaveLength(0);
	});
});

describe('computeStats', () => {
	it('restituisce zeri per array vuoto', () => {
		const result = computeStats([], SINCE, UNTIL);
		expect(result.totalEvents).toBe(0);
		expect(result.totalSessions).toBe(0);
		expect(result.totalUsers).toBe(0);
		expect(result.errorRate).toBe(0);
	});

	it('conta totalEvents, totalSessions e totalUsers correttamente', () => {
		const events = [
			makeEvent({ sessionId: 'sess-1', userId: 'user-1', timestamp: TS }),
			makeEvent({ sessionId: 'sess-1', userId: 'user-1', timestamp: TS }),
			makeEvent({ sessionId: 'sess-2', userId: 'user-2', timestamp: TS }),
		];
		const result = computeStats(events, SINCE, UNTIL);
		expect(result.totalEvents).toBe(3);
		expect(result.totalSessions).toBe(2);
		expect(result.totalUsers).toBe(2);
	});

	it('calcola errorRate come rapporto eventi "error" su totale', () => {
		const events = [
			makeEvent({ type: 'error', level: 'error', timestamp: TS }),
			makeEvent({ type: 'click', level: 'info', timestamp: TS }),
		];
		const result = computeStats(events, SINCE, UNTIL);
		expect(result.errorRate).toBeCloseTo(0.5);
	});

	it('calcola avgHttpDuration correttamente', () => {
		const events = [
			makeEvent({ type: 'http', timestamp: TS, payload: { method: 'GET', url: '/a', duration: 100 } }),
			makeEvent({ type: 'http', timestamp: TS, payload: { method: 'GET', url: '/b', duration: 300 } }),
		];
		const result = computeStats(events, SINCE, UNTIL);
		expect(result.avgHttpDuration).toBe(200);
	});

	it('avgHttpDuration è undefined se non ci sono http con duration', () => {
		const events = [makeEvent({ timestamp: TS })];
		const result = computeStats(events, SINCE, UNTIL);
		expect(result.avgHttpDuration).toBeUndefined();
	});

	it('calcola httpStats: total, count2xx, count4xx, count5xx', () => {
		const events = [
			makeEvent({ type: 'http', timestamp: TS, payload: { method: 'GET', url: '/a', status: 200 } }),
			makeEvent({ type: 'http', timestamp: TS, payload: { method: 'GET', url: '/b', status: 404 } }),
			makeEvent({ type: 'http', timestamp: TS, payload: { method: 'GET', url: '/c', status: 500 } }),
		];
		const result = computeStats(events, SINCE, UNTIL);
		expect(result.httpStats.total).toBe(3);
		expect(result.httpStats.count2xx).toBe(1);
		expect(result.httpStats.count4xx).toBe(1);
		expect(result.httpStats.count5xx).toBe(1);
	});

	it('calcola pct2xx/pct4xx/pct5xx', () => {
		const events = [
			makeEvent({ type: 'http', timestamp: TS, payload: { method: 'GET', url: '/a', status: 200 } }),
			makeEvent({ type: 'http', timestamp: TS, payload: { method: 'GET', url: '/b', status: 404 } }),
		];
		const result = computeStats(events, SINCE, UNTIL);
		expect(result.httpStats.pct2xx).toBe(50);
		expect(result.httpStats.pct4xx).toBe(50);
	});

	it('mostCalledEndpoint è l\'endpoint con più chiamate', () => {
		const events = [
			makeEvent({ type: 'http', timestamp: TS, payload: { method: 'GET', url: '/api/users', status: 200 } }),
			makeEvent({ type: 'http', timestamp: TS, payload: { method: 'GET', url: '/api/users', status: 200 } }),
			makeEvent({ type: 'http', timestamp: TS, payload: { method: 'POST', url: '/api/orders', status: 201 } }),
		];
		const result = computeStats(events, SINCE, UNTIL);
		expect(result.httpStats.mostCalledEndpoint?.url).toBe('/api/users');
		expect(result.httpStats.mostCalledEndpoint?.count).toBe(2);
	});

	it('slowestEndpoint è l\'endpoint con avg duration maggiore', () => {
		const events = [
			makeEvent({ type: 'http', timestamp: TS, payload: { method: 'GET', url: '/fast', status: 200, duration: 50 } }),
			makeEvent({ type: 'http', timestamp: TS, payload: { method: 'GET', url: '/slow', status: 200, duration: 2000 } }),
		];
		const result = computeStats(events, SINCE, UNTIL);
		expect(result.httpStats.slowestEndpoint?.url).toBe('/slow');
		expect(result.httpStats.slowestEndpoint?.avgDuration).toBe(2000);
	});

	it('calcola topRoutes', () => {
		const events = [
			makeEvent({ timestamp: TS, meta: { route: '/home', viewport: '', language: '', userAgent: '' } }),
			makeEvent({ timestamp: TS, meta: { route: '/home', viewport: '', language: '', userAgent: '' } }),
			makeEvent({ timestamp: TS, meta: { route: '/about', viewport: '', language: '', userAgent: '' } }),
		];
		const result = computeStats(events, SINCE, UNTIL);
		expect(result.topRoutes[0]).toEqual({ route: '/home', count: 2 });
	});

	it('calcola topUsers', () => {
		const events = [
			makeEvent({ timestamp: TS, userId: 'alice' }),
			makeEvent({ timestamp: TS, userId: 'alice' }),
			makeEvent({ timestamp: TS, userId: 'bob' }),
		];
		const result = computeStats(events, SINCE, UNTIL);
		expect(result.topUsers[0]).toEqual({ userId: 'alice', count: 2 });
	});

	it('calcola timeline per bucket orario', () => {
		const events = [
			makeEvent({ timestamp: '2026-06-15T12:30:00.000Z' }),
			makeEvent({ timestamp: '2026-06-15T12:45:00.000Z' }),
		];
		const result = computeStats(events, SINCE, UNTIL);
		const bucket = result.timeline.find((t: any) => t.bucket === '2026-06-15T12:00');
		expect(bucket).toBeDefined();
		expect(bucket!.count).toBe(2);
	});

	it('httpStats.total=0: pct sono 0 e mostCalled/slowest sono undefined', () => {
		const result = computeStats([], SINCE, UNTIL);
		expect(result.httpStats.pct2xx).toBe(0);
		expect(result.httpStats.mostCalledEndpoint).toBeUndefined();
		expect(result.httpStats.slowestEndpoint).toBeUndefined();
	});
});
