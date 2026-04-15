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
	it('returns activeSessions=0 for empty array', () => {
		const result = computeMetrics([], SINCE, UNTIL);
		expect(result.activeSessions).toBe(0);
	});

	it('counts active sessions in the last 5 minutes', () => {
		const recent = new Date(Date.now() - 2 * 60_000).toISOString();
		const old = new Date(Date.now() - 10 * 60_000).toISOString();
		const events = [
			makeEvent({ sessionId: 'sess-recent', timestamp: recent }),
			makeEvent({ sessionId: 'sess-old', timestamp: old }),
		];
		const result = computeMetrics(events, old, new Date().toISOString());
		expect(result.activeSessions).toBe(1);
	});

	it('groups by hourly bucket when diffHours <= 48', () => {
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

	it('groups by daily bucket when diffHours > 48', () => {
		const events = [
			makeEvent({ timestamp: '2026-06-15T12:00:00.000Z' }),
			makeEvent({ timestamp: '2026-06-16T12:00:00.000Z' }),
			makeEvent({ timestamp: '2026-06-16T18:00:00.000Z' }),
		];
		const result = computeMetrics(events, '2026-06-01T00:00:00.000Z', '2026-06-30T23:59:59.000Z');
		const bucketDay16 = result.eventVolume.find((b: any) => b.bucket === '2026-06-16');
		expect(bucketDay16).not.toBeDefined();
	});

	it('calculates errorRateTimeline correctly', () => {
		const events = [
			makeEvent({ timestamp: TS, level: 'info' }),
			makeEvent({ timestamp: TS, level: 'error' }),
		];
		const result = computeMetrics(events, SINCE, UNTIL);
		const bucket = result.errorRateTimeline[0];
		expect(bucket.value).toBe(50);
	});

	it('calculates topPages from navigation events', () => {
		const events = [
			makeEvent({ timestamp: TS, type: 'navigation', payload: { from: '/home', to: '/about' } as unknown as EventPayload }),
			makeEvent({ timestamp: TS, type: 'navigation', payload: { from: '/home', to: '/about' } as unknown as EventPayload }),
			makeEvent({ timestamp: TS, type: 'navigation', payload: { from: '/home', to: '/contact' } as unknown as EventPayload }),
		];
		const result = computeMetrics(events, SINCE, UNTIL);
		expect(result.topPages[0]).toEqual({ label: '/about', count: 2 });
		expect(result.topPages[1]).toEqual({ label: '/contact', count: 1 });
	});

	it('ignores navigation with empty to', () => {
		const events = [
			makeEvent({ timestamp: TS, type: 'navigation', payload: { from: '/home', to: '' } as unknown as EventPayload }),
		];
		const result = computeMetrics(events, SINCE, UNTIL);
		expect(result.topPages).toHaveLength(0);
	});

	it('calculates topErrors from error events', () => {
		const events = [
			makeEvent({ timestamp: TS, type: 'error', payload: { message: 'TypeError: foo' } as unknown as EventPayload }),
			makeEvent({ timestamp: TS, type: 'error', payload: { message: 'TypeError: foo' } as unknown as EventPayload }),
			makeEvent({ timestamp: TS, type: 'error', payload: { message: 'ReferenceError' } as unknown as EventPayload }),
		];
		const result = computeMetrics(events, SINCE, UNTIL);
		expect(result.topErrors[0].message).toBe('TypeError: foo');
		expect(result.topErrors[0].count).toBe(2);
	});

	it('topErrors: lastSeen is updated with the most recent timestamp', () => {
		const ts1 = '2026-06-15T10:00:00.000Z';
		const ts2 = '2026-06-15T12:00:00.000Z';
		const events = [
			makeEvent({ timestamp: ts1, type: 'error', payload: { message: 'Err' } as unknown as EventPayload }),
			makeEvent({ timestamp: ts2, type: 'error', payload: { message: 'Err' } as unknown as EventPayload }),
		];
		const result = computeMetrics(events, SINCE, UNTIL);
		expect(result.topErrors[0].lastSeen).toBe(ts2);
	});

	it('calculates navigationFunnel', () => {
		const events = [
			makeEvent({ timestamp: TS, type: 'navigation', payload: { from: '/home', to: '/about' } as unknown as EventPayload }),
			makeEvent({ timestamp: TS, type: 'navigation', payload: { from: '/home', to: '/about' } as unknown as EventPayload }),
		];
		const result = computeMetrics(events, SINCE, UNTIL);
		expect(result.navigationFunnel[0]).toEqual({ from: '/home', to: '/about', count: 2 });
	});

	it('ignores navigation with from === to in the funnel', () => {
		const events = [
			makeEvent({ timestamp: TS, type: 'navigation', payload: { from: '/home', to: '/home' } as unknown as EventPayload }),
		];
		const result = computeMetrics(events, SINCE, UNTIL);
		expect(result.navigationFunnel).toHaveLength(0);
	});

	it('calculates topEndpoints from http events', () => {
		const events = [
			makeEvent({ timestamp: TS, type: 'http', payload: { method: 'GET', url: '/api/users', status: 200 } as unknown as EventPayload }),
			makeEvent({ timestamp: TS, type: 'http', payload: { method: 'GET', url: '/api/users', status: 200 } }),
			makeEvent({ timestamp: TS, type: 'http', payload: { method: 'POST', url: '/api/orders', status: 201 } }),
		];
		const result = computeMetrics(events, SINCE, UNTIL);
		expect(result.topEndpoints[0]).toEqual({ label: '/api/users', count: 2 });
	});

	it('excludes events outside the time window', () => {
		const events = [
			makeEvent({ timestamp: '2025-01-01T00:00:00.000Z' }),
		];
		const result = computeMetrics(events, SINCE, UNTIL);

		expect(result.eventVolume).toHaveLength(0);
	});

	// ── toBucket coverage: tutti i bucket oltre '1h' ──────────────────────────

	describe('toBucket — bucket 30m', () => {
		it('minuti < 30 → slot :00', () => {
			const events = [
				makeEvent({ timestamp: '2026-06-15T14:10:00.000Z' }),
				makeEvent({ timestamp: '2026-06-15T14:20:00.000Z' }),
			];
			const result = computeMetrics(events, SINCE, UNTIL, '30m');
			const b = result.eventVolume.find(x => x.bucket === '2026-06-15T14:00');
			expect(b).toBeDefined();
			expect(b!.value).toBe(2);
		});

		it('minuti >= 30 → slot :30', () => {
			const events = [
				makeEvent({ timestamp: '2026-06-15T14:30:00.000Z' }),
				makeEvent({ timestamp: '2026-06-15T14:55:00.000Z' }),
			];
			const result = computeMetrics(events, SINCE, UNTIL, '30m');
			const b = result.eventVolume.find(x => x.bucket === '2026-06-15T14:30');
			expect(b).toBeDefined();
			expect(b!.value).toBe(2);
		});
	});

	describe('toBucket — bucket 6h', () => {
		it('ore 0-5 → bucket 00:00', () => {
			const events = [makeEvent({ timestamp: '2026-06-15T03:00:00.000Z' })];
			const result = computeMetrics(events, SINCE, UNTIL, '6h');
			expect(result.eventVolume[0].bucket).toBe('2026-06-15T00:00');
		});

		it('ore 6-11 → bucket 06:00', () => {
			const events = [makeEvent({ timestamp: '2026-06-15T09:00:00.000Z' })];
			const result = computeMetrics(events, SINCE, UNTIL, '6h');
			expect(result.eventVolume[0].bucket).toBe('2026-06-15T06:00');
		});

		it('ore 18-23 → bucket 18:00', () => {
			const events = [makeEvent({ timestamp: '2026-06-15T20:00:00.000Z' })];
			const result = computeMetrics(events, SINCE, UNTIL, '6h');
			expect(result.eventVolume[0].bucket).toBe('2026-06-15T18:00');
		});
	});

	describe('toBucket — bucket 12h', () => {
		it('ore < 12 → slot 00', () => {
			const events = [makeEvent({ timestamp: '2026-06-15T08:00:00.000Z' })];
			const result = computeMetrics(events, SINCE, UNTIL, '12h');
			expect(result.eventVolume[0].bucket).toBe('2026-06-15T00:00');
		});

		it('ore >= 12 → slot 12', () => {
			const events = [makeEvent({ timestamp: '2026-06-15T15:00:00.000Z' })];
			const result = computeMetrics(events, SINCE, UNTIL, '12h');
			expect(result.eventVolume[0].bucket).toBe('2026-06-15T12:00');
		});
	});

	describe('toBucket — bucket 1d', () => {
		it('collassa tutta la giornata in un singolo bucket data', () => {
			const events = [
				makeEvent({ timestamp: '2026-06-15T00:30:00.000Z' }),
				makeEvent({ timestamp: '2026-06-15T23:59:00.000Z' }),
			];
			const result = computeMetrics(events, SINCE, UNTIL, '1d');
			expect(result.eventVolume).toHaveLength(1);
			expect(result.eventVolume[0].bucket).toBe('2026-06-15');
			expect(result.eventVolume[0].value).toBe(2);
		});
	});

	describe('toBucket — bucket 7d', () => {
		it('lunedì (dayOfWeek=1): diff=0, rimane se stesso', () => {
			// 2026-06-15 è un lunedì
			const events = [makeEvent({ timestamp: '2026-06-15T10:00:00.000Z' })];
			const result = computeMetrics(events, SINCE, UNTIL, '7d');
			expect(result.eventVolume[0].bucket).toBe('2026-06-15');
		});

		it('domenica (dayOfWeek=0): diff=6, arretra al lunedì precedente', () => {
			// 2026-06-21 è domenica → lunedì = 2026-06-15
			const events = [makeEvent({ timestamp: '2026-06-21T10:00:00.000Z' })];
			const result = computeMetrics(events, SINCE, UNTIL, '7d');
			expect(result.eventVolume[0].bucket).toBe('2026-06-15');
		});

		it('mercoledì (dayOfWeek=3): diff=2, arretra di 2 giorni', () => {
			// 2026-06-17 è mercoledì → lunedì = 2026-06-15
			const events = [makeEvent({ timestamp: '2026-06-17T10:00:00.000Z' })];
			const result = computeMetrics(events, SINCE, UNTIL, '7d');
			expect(result.eventVolume[0].bucket).toBe('2026-06-15');
		});
	});
});

describe('computeStats', () => {
	it('returns zeros for empty array', () => {
		const result = computeStats([], SINCE, UNTIL);
		expect(result.totalEvents).toBe(0);
		expect(result.totalSessions).toBe(0);
		expect(result.totalUsers).toBe(0);
		expect(result.errorRate).toBe(0);
	});

	it('counts totalEvents, totalSessions and totalUsers correctly', () => {
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

	it('Calculate errorRate as the ratio of "error" events to total', () => {
		const events = [
			makeEvent({ type: 'error', level: 'error', timestamp: TS }),
			makeEvent({ type: 'click', level: 'info', timestamp: TS }),
		];
		const result = computeStats(events, SINCE, UNTIL);
		expect(result.errorRate).toBeCloseTo(0.5);
	});

	it('calculates avgHttpDuration correctly', () => {
		const events = [
			makeEvent({ type: 'http', timestamp: TS, payload: { method: 'GET', url: '/a', duration: 100 } }),
			makeEvent({ type: 'http', timestamp: TS, payload: { method: 'GET', url: '/b', duration: 300 } }),
		];
		const result = computeStats(events, SINCE, UNTIL);
		expect(result.avgHttpDuration).toBe(200);
	});

	it('avgHttpDuration is undefined when there are no http events with duration', () => {
		const events = [makeEvent({ timestamp: TS })];
		const result = computeStats(events, SINCE, UNTIL);
		expect(result.avgHttpDuration).toBeUndefined();
	});

	it('calculates httpStats: total, count2xx, count4xx, count5xx', () => {
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

	it('calculates pct2xx/pct4xx/pct5xx', () => {
		const events = [
			makeEvent({ type: 'http', timestamp: TS, payload: { method: 'GET', url: '/a', status: 200 } }),
			makeEvent({ type: 'http', timestamp: TS, payload: { method: 'GET', url: '/b', status: 404 } }),
		];
		const result = computeStats(events, SINCE, UNTIL);
		expect(result.httpStats.pct2xx).toBe(50);
		expect(result.httpStats.pct4xx).toBe(50);
	});

	it('mostCalledEndpoint is the endpoint with the most calls', () => {
		const events = [
			makeEvent({ type: 'http', timestamp: TS, payload: { method: 'GET', url: '/api/users', status: 200 } }),
			makeEvent({ type: 'http', timestamp: TS, payload: { method: 'GET', url: '/api/users', status: 200 } }),
			makeEvent({ type: 'http', timestamp: TS, payload: { method: 'POST', url: '/api/orders', status: 201 } }),
		];
		const result = computeStats(events, SINCE, UNTIL);
		expect(result.httpStats.mostCalledEndpoint?.url).toBe('/api/users');
		expect(result.httpStats.mostCalledEndpoint?.count).toBe(2);
	});

	it('slowestEndpoint is the endpoint with the highest avg duration', () => {
		const events = [
			makeEvent({ type: 'http', timestamp: TS, payload: { method: 'GET', url: '/fast', status: 200, duration: 50 } }),
			makeEvent({ type: 'http', timestamp: TS, payload: { method: 'GET', url: '/slow', status: 200, duration: 2000 } }),
		];
		const result = computeStats(events, SINCE, UNTIL);
		expect(result.httpStats.slowestEndpoint?.url).toBe('/slow');
		expect(result.httpStats.slowestEndpoint?.avgDuration).toBe(2000);
	});

	it('calculates topRoutes', () => {
		const events = [
			makeEvent({ timestamp: TS, meta: { route: '/home', viewport: '', language: '', userAgent: '' } }),
			makeEvent({ timestamp: TS, meta: { route: '/home', viewport: '', language: '', userAgent: '' } }),
			makeEvent({ timestamp: TS, meta: { route: '/about', viewport: '', language: '', userAgent: '' } }),
		];
		const result = computeStats(events, SINCE, UNTIL);
		expect(result.topRoutes[0]).toEqual({ route: '/home', count: 2 });
	});

	it('calculates topUsers', () => {
		const events = [
			makeEvent({ timestamp: TS, userId: 'alice' }),
			makeEvent({ timestamp: TS, userId: 'alice' }),
			makeEvent({ timestamp: TS, userId: 'bob' }),
		];
		const result = computeStats(events, SINCE, UNTIL);
		expect(result.topUsers[0]).toEqual({ userId: 'alice', count: 2 });
	});

	it('calculates timeline by hourly bucket', () => {
		const events = [
			makeEvent({ timestamp: '2026-06-15T12:30:00.000Z' }),
			makeEvent({ timestamp: '2026-06-15T12:45:00.000Z' }),
		];
		const result = computeStats(events, SINCE, UNTIL);
		const bucket = result.timeline.find((t: any) => t.bucket === '2026-06-15T12:00');
		expect(bucket).toBeDefined();
		expect(bucket!.count).toBe(2);
	});

	it('httpStats.total=0: pct are 0 and mostCalled/slowest are undefined', () => {
		const result = computeStats([], SINCE, UNTIL);
		expect(result.httpStats.pct2xx).toBe(0);
		expect(result.httpStats.mostCalledEndpoint).toBeUndefined();
		expect(result.httpStats.slowestEndpoint).toBeUndefined();
	});
});
