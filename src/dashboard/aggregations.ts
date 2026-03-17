import { HttpStats, LogLevel, MetricsResult, StatsResult, TrackerEvent, TrackerEventType } from "@tracker/types";

/**
* Metrics computation pure, from buffer
*/
export function computeMetrics(events: TrackerEvent[], since: string, until: string): MetricsResult {
	const ranged = events.filter(e => e.timestamp >= since && e.timestamp <= until);
	const now = new Date();
	const fiveMinAgo = new Date(now.getTime() - 5 * 60 * 1000).toISOString();

	const activeSessions = new Set(events.filter(e => e.timestamp >= fiveMinAgo).map(e => e.sessionId)).size;

	const diffHours = (new Date(until).getTime() - new Date(since).getTime()) / 3600000;
	const bucket = (ts: string) => {
		const d = new Date(ts);
		if (diffHours <= 48) {
			return `${d.toISOString().slice(0, 13)}:00`;   // INFO YYYY-MM-DDTHH:00
		}
		return d.toISOString().slice(0, 10);              // INFO YYYY-MM-DD
	}

	const volumeMap = new Map<string, number>();
	const errorMap = new Map<string, { total: number; errors: number }>();
	for (const e of ranged) {
		const b = bucket(e.timestamp);
		volumeMap.set(b, (volumeMap.get(b) ?? 0) + 1);
		const em = errorMap.get(b) ?? { total: 0, errors: 0 };
		em.total++;
		if (e.level === 'error') {
			em.errors++;
		}
		errorMap.set(b, em);
	}
	const sortedBuckets = Array.from(volumeMap.keys()).sort();
	const eventVolume = sortedBuckets.map(b => ({ bucket: b, value: volumeMap.get(b)! }));
	const errorRateTimeline = sortedBuckets.map(b => {
		const em = errorMap.get(b) ?? { total: 1, errors: 0 };
		return {
			bucket: b,
			value: parseFloat(((em.errors / em.total) * 100).toFixed(2))
		}
	})

	// INFO Top pages (by navigation -> .to)
	const pageCount = new Map<string, number>();
	for (const e of ranged) {
		if (e.type === 'navigation') {
			const to = (e.payload as any).to ?? '';
			if (to) {
				pageCount.set(to, (pageCount.get(to) ?? 0) + 1);
			}
		}
	}
	const topPages = Array.from(pageCount.entries())
		.sort((a, b) => b[1] - a[1]).slice(0, 10)
		.map(([label, count]) => ({ label, count }));

	const errorCount = new Map<string, { count: number; lastSeen: string }>();
	for (const e of ranged) {
		if (e.type === 'error') {
			const msg = (e.payload as any).message ?? 'Unknown error';
			const existing = errorCount.get(msg) ?? { count: 0, lastSeen: e.timestamp };
			existing.count++;
			if (e.timestamp > existing.lastSeen) {
				existing.lastSeen = e.timestamp;
			}
			errorCount.set(msg, existing);
		}
	}
	const topErrors = Array.from(errorCount.entries())
		.sort((a, b) => b[1].count - a[1].count).slice(0, 10)
		.map(([message, { count, lastSeen }]) => ({ message, count, lastSeen }));

	const funnelCount = new Map<string, number>();
	for (const e of ranged) {
		if (e.type === 'navigation') {
			const from = (e.payload as any).from ?? '';
			const to = (e.payload as any).to ?? '';
			if (from && to && from !== to) {
				const key = `${from}|||${to}`;
				funnelCount.set(key, (funnelCount.get(key) ?? 0) + 1);
			}
		}
	}
	const navigationFunnel = Array.from(funnelCount.entries())
		.sort((a, b) => b[1] - a[1])
		.slice(0, 10)
		.map(([key, count]) => {
			const [from, to] = key.split('|||');
			return { from, to, count }
		});

	// INFO Top Endpoints by call count (HTTP events)
	const endpointCount = new Map<string, number>();
	for (const e of ranged) {
		if (e.type === 'http') {
			const url = (e.payload as any).url ?? '';
			if (url) {
				endpointCount.set(url, (endpointCount.get(url) ?? 0) + 1);
			}
		}
	}
	const topEndpoints = Array.from(endpointCount.entries())
		.sort((a, b) => b[1] - a[1]).slice(0, 10)
		.map(([label, count]) => ({ label, count }));

	return {
		activeSessions,
		eventVolume,
		errorRateTimeline,
		topPages,
		topErrors,
		navigationFunnel,
		topEndpoints
	}
}

export function computeStats(events: TrackerEvent[], since: string, until: string): StatsResult {
	const ranged = events.filter(e => e.timestamp >= since && e.timestamp <= until);

	const sessions = new Set(ranged.map(e => e.sessionId));
	const users = new Set(ranged.map(e => e.userId));

	const byType = {} as Record<TrackerEventType, number>;
	const byLevel = {} as Record<LogLevel, number>;
	let httpDurationSum = 0, httpCount = 0;

	// INFO HTTP stats counters
	let httpTotal = 0, http2xx = 0, http4xx = 0, http5xx = 0;
	const endpointCallCount = new Map<string, number>();
	const endpointDurationSum = new Map<string, number>();
	const endpointDurationCount = new Map<string, number>();
	const endpointMethod = new Map<string, string>();
	const endpointStatusCount = new Map<string, Map<number, number>>();

	// INFO App error rate: only type === 'error' (JS errors), NOT http 4xx/5xx
	let appErrors = 0;

	for (const e of ranged) {
		byType[e.type] = (byType[e.type] ?? 0) + 1;
		byLevel[e.level] = (byLevel[e.level] ?? 0) + 1;

		if (e.type === 'http') {
			const p = e.payload as any;
			const duration = p.duration as number | undefined;
			const status = p.status as number | undefined;
			const url: string = p.url ?? '';

			if (duration) {
				httpDurationSum += duration;
				httpCount++;
			}

			httpTotal++;
			if (status !== undefined) {
				if (status >= 200 && status < 300) http2xx++;
				else if (status >= 400 && status < 500) http4xx++;
				else if (status >= 500) http5xx++;
			}

			if (url) {
				endpointCallCount.set(url, (endpointCallCount.get(url) ?? 0) + 1);
				if (duration) {
					endpointDurationSum.set(url, (endpointDurationSum.get(url) ?? 0) + duration);
					endpointDurationCount.set(url, (endpointDurationCount.get(url) ?? 0) + 1);
				}
				if (p.method) {
					endpointMethod.set(url, p.method);
				}
				if (status !== undefined) {
					const statusMap = endpointStatusCount.get(url) ?? new Map<number, number>();
					statusMap.set(status, (statusMap.get(status) ?? 0) + 1);
					endpointStatusCount.set(url, statusMap);
				}
			}
		}

		if (e.type === 'error') {
			appErrors++;
		}
	}

	const routeCount = new Map<string, number>();
	const userCount = new Map<string, number>();
	for (const e of ranged) {
		const r = e.meta.route;
		routeCount.set(r, (routeCount.get(r) ?? 0) + 1);
		userCount.set(e.userId, (userCount.get(e.userId) ?? 0) + 1);
	}

	const topRoutes = Array.from(routeCount.entries())
		.sort((a, b) => b[1] - a[1]).slice(0, 10)
		.map(([route, count]) => ({ route, count }));

	const topUsers = Array.from(userCount.entries())
		.sort((a, b) => b[1] - a[1]).slice(0, 10)
		.map(([userId, count]) => ({ userId, count }));

	const timelineMap = new Map<string, number>();
	for (const e of ranged) {
		const b = e.timestamp.slice(0, 13) + ':00';
		timelineMap.set(b, (timelineMap.get(b) ?? 0) + 1);
	}
	const timeline = Array.from(timelineMap.entries()).sort().map(([bucket, count]) => ({ bucket, count }));

	// INFO Build mostCalledEndpoint and slowestEndpoint
	function topStatusFor(url: string): number | undefined {
		const statusMap = endpointStatusCount.get(url);
		if (!statusMap) return undefined;
		let topStatus: number | undefined;
		let topCount = 0;
		for (const [status, count] of statusMap) {
			if (count > topCount) {
				topCount = count;
				topStatus = status;
			}
		}
		return topStatus;
	}

	let mostCalledEndpoint: HttpStats['mostCalledEndpoint'];
	let maxCalls = 0;
	for (const [url, count] of endpointCallCount) {
		if (count > maxCalls) {
			maxCalls = count;
			mostCalledEndpoint = {
				url,
				count,
				method: endpointMethod.get(url) ?? '',
				topStatus: topStatusFor(url),
			};
		}
	}

	let slowestEndpoint: HttpStats['slowestEndpoint'];
	let maxAvg = 0;
	for (const [url, sum] of endpointDurationSum) {
		const cnt = endpointDurationCount.get(url) ?? 1;
		const avg = sum / cnt;
		if (avg > maxAvg) {
			maxAvg = avg;
			slowestEndpoint = {
				url,
				avgDuration: Math.round(avg),
				method: endpointMethod.get(url) ?? '',
				topStatus: topStatusFor(url),
			};
		}
	}

	const httpStats: HttpStats = {
		total: httpTotal,
		count2xx: http2xx,
		count4xx: http4xx,
		count5xx: http5xx,
		pct2xx: httpTotal > 0 ? parseFloat(((http2xx / httpTotal) * 100).toFixed(1)) : 0,
		pct4xx: httpTotal > 0 ? parseFloat(((http4xx / httpTotal) * 100).toFixed(1)) : 0,
		pct5xx: httpTotal > 0 ? parseFloat(((http5xx / httpTotal) * 100).toFixed(1)) : 0,
		httpErrorRate: httpTotal > 0 ? (http4xx + http5xx) / httpTotal : 0,
		mostCalledEndpoint,
		slowestEndpoint
	}

	return {
		totalEvents: ranged.length,
		totalSessions: sessions.size,
		totalUsers: users.size,
		// INFO App error rate: only JS errors (type === 'error'), excludes HTTP
		errorRate: ranged.length > 0 ? appErrors / ranged.length : 0,
		avgHttpDuration: httpCount > 0 ? Math.round(httpDurationSum / httpCount) : undefined,
		topRoutes,
		topUsers,
		timeline,
		httpStats
	}
}
