import type { ChartBucket, HttpStats, MetricsAllResult, MetricsResult, StatsResult, TimePoint, TrackerEvent } from "@tracker/types";

/**
 * Returns an ISO string truncated to the requested bucket boundary.
 * Used to group events into time buckets for chart time series.
 */
export function toBucket(ts: string, bucket: ChartBucket): string {
	const d = new Date(ts);
	const y = d.getUTCFullYear();
	const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
	const day = String(d.getUTCDate()).padStart(2, '0');
	const h = d.getUTCHours();
	const m = d.getUTCMinutes();

	switch (bucket) {
		case '30m': {
			const slot = m < 30 ? '00' : '30';
			return `${y}-${mo}-${day}T${String(h).padStart(2, '0')}:${slot}`;
		}
		case '1h':
			return `${y}-${mo}-${day}T${String(h).padStart(2, '0')}:00`;
		case '6h': {
			const slot = Math.floor(h / 6) * 6;
			return `${y}-${mo}-${day}T${String(slot).padStart(2, '0')}:00`;
		}
		case '12h': {
			const slot = h < 12 ? '00' : '12';
			return `${y}-${mo}-${day}T${slot}:00`;
		}
		case '1d':
			return `${y}-${mo}-${day}`;
		case '7d': {
			// Round down to nearest Monday (ISO week start)
			const dayOfWeek = d.getUTCDay(); // 0=Sun
			const diff = (dayOfWeek === 0 ? 6 : dayOfWeek - 1); // days since Monday
			const monday = new Date(d.getTime() - diff * 86_400_000);
			const my = monday.getUTCFullYear();
			const mmo = String(monday.getUTCMonth() + 1).padStart(2, '0');
			const mday = String(monday.getUTCDate()).padStart(2, '0');
			return `${my}-${mmo}-${mday}`;
		}
	}
}

/** Converts a raw bucket-count Map into a sorted TimePoint array. */
function bucketMapToTimeline(volumeMap: Map<string, number>): TimePoint[] {
	return Array.from(volumeMap.keys())
		.sort()
		.map(b => ({ bucket: b, value: volumeMap.get(b)! }));
}

/** Converts a raw bucket-error Map into a sorted error-rate TimePoint array. */
function errorMapToTimeline(errorMap: Map<string, { total: number; errors: number }>): TimePoint[] {
	return Array.from(errorMap.keys())
		.sort()
		.map(b => {
			const em = errorMap.get(b) ?? { total: 1, errors: 0 };
			return {
				bucket: b,
				value: parseFloat(((em.errors / em.total) * 100).toFixed(2))
			};
		});
}

/**
 * Single-pass unified aggregation over the time-windowed event set.
 *
 * @remarks
 * `computeAll` does a single `.filter()` for the time range, then one loop
 * that accumulates every counter simultaneously, including bucket maps for
 * the `volumeBucket` and `errorBucket` chart granularities selected in the UI.
 *
 * When `chartBucket === volumeBucket` or `chartBucket === errorBucket`, the
 * shared map is reused directly so no extra work is done.
 *
 * @param events       - Full raw event list (already fetched from backend).
 * @param since        - ISO 8601 lower bound (inclusive).
 * @param until        - ISO 8601 upper bound (inclusive).
 * @param chartBucket  - Bucket granularity for MetricsResult.eventVolume / errorRateTimeline.
 * @param volumeBucket - Bucket granularity for the Event Volume chart.
 * @param errorBucket  - Bucket granularity for the Error Rate chart.
 */
export function computeAll(events: TrackerEvent[], since: string, until: string, chartBucket: ChartBucket = '1h', volumeBucket: ChartBucket = '1h', errorBucket: ChartBucket = '1h'): MetricsAllResult {
	const ranged = events.filter(e => e.timestamp >= since && e.timestamp <= until);
	const now = new Date();
	const fiveMinAgo = new Date(now.getTime() - 5 * 60 * 1000).toISOString();

	const activeSessionSet = new Set<string>();

	// INFO Three sets of bucket maps; when granularities match we reuse the same map
	const chartVolumeMap = new Map<string, number>();
	const chartErrorMap = new Map<string, { total: number; errors: number }>();

	// INFO Only allocate separate maps when the bucket differs
	const needSeparateVolume = volumeBucket !== chartBucket;
	const needSeparateError = errorBucket !== chartBucket;
	const volumeMapSep = needSeparateVolume ? new Map<string, number>() : null;
	const volumeErrorMapSep = needSeparateVolume ? new Map<string, { total: number; errors: number }>() : null;
	const errorMapSep = needSeparateError ? new Map<string, { total: number; errors: number }>() : null;
	const errorVolumeMapSep = needSeparateError ? new Map<string, number>() : null;

	// INFO Top-list accumulators
	const pageCount = new Map<string, number>();
	const appErrorCount = new Map<string, { count: number; lastSeen: string }>();
	const funnelCount = new Map<string, number>();
	const endpointCount = new Map<string, number>();

	// INFO Stats accumulators
	const sessions = new Set<string>();
	const users = new Set<string>();
	let httpDurationSum = 0, httpCount = 0;
	let httpTotal = 0, http2xx = 0, http4xx = 0, http5xx = 0;
	const endpointCallCount = new Map<string, number>();
	const endpointDurationSum = new Map<string, number>();
	const endpointDurationCount = new Map<string, number>();
	const endpointMethod = new Map<string, string>();
	const endpointStatusCount = new Map<string, Map<number, number>>();
	let appErrors = 0;
	const routeCount = new Map<string, number>();
	const userCount = new Map<string, number>();
	const timelineMap = new Map<string, number>();

	for (const e of ranged) {
		if (e.timestamp >= fiveMinAgo) {
			activeSessionSet.add(e.sessionId);
		}

		const cb = toBucket(e.timestamp, chartBucket);
		chartVolumeMap.set(cb, (chartVolumeMap.get(cb) ?? 0) + 1);
		const cem = chartErrorMap.get(cb) ?? { total: 0, errors: 0 };
		cem.total++;
		if (e.level === 'error') {
			cem.errors++;
		}
		chartErrorMap.set(cb, cem);

		if (needSeparateVolume) {
			const vb = toBucket(e.timestamp, volumeBucket);
			volumeMapSep!.set(vb, (volumeMapSep!.get(vb) ?? 0) + 1);
			const vem = volumeErrorMapSep!.get(vb) ?? { total: 0, errors: 0 };
			vem.total++;
			if (e.level === 'error') {
				vem.errors++;
			}
			volumeErrorMapSep!.set(vb, vem);
		}

		if (needSeparateError) {
			const eb = toBucket(e.timestamp, errorBucket);
			errorVolumeMapSep!.set(eb, (errorVolumeMapSep!.get(eb) ?? 0) + 1);
			const eem = errorMapSep!.get(eb) ?? { total: 0, errors: 0 };
			eem.total++;
			if (e.level === 'error') {
				eem.errors++;
			}
			errorMapSep!.set(eb, eem);
		}

		if (e.type === 'navigation') {
			const to = (e.payload as any).to ?? '';
			if (to) {
				pageCount.set(to, (pageCount.get(to) ?? 0) + 1);
			}
			const from = (e.payload as any).from ?? '';
			if (from && to && from !== to) {
				const key = `${from}|||${to}`;
				funnelCount.set(key, (funnelCount.get(key) ?? 0) + 1);
			}
		}

		if (e.type === 'error') {
			const msg = (e.payload as any).message ?? 'Unknown error';
			const existing = appErrorCount.get(msg) ?? { count: 0, lastSeen: e.timestamp };
			existing.count++;
			if (e.timestamp > existing.lastSeen) {
				existing.lastSeen = e.timestamp;
			}
			appErrorCount.set(msg, existing);
			appErrors++;
		}

		if (e.type === 'http') {
			const p = e.payload as any;
			const url: string = p.url ?? '';
			if (url) {
				endpointCount.set(url, (endpointCount.get(url) ?? 0) + 1);
			}

			const duration = p.duration as number | undefined;
			const status = p.status as number | undefined;
			if (duration) {
				httpDurationSum += duration;
				httpCount++;
			}
			httpTotal++;
			if (status !== undefined) {
				if (status >= 200 && status < 300) {
					http2xx++;
				} else if (status >= 400 && status < 500) {
					http4xx++;
				} else if (status >= 500) {
					http5xx++;
				}
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

		sessions.add(e.sessionId);
		users.add(e.userId);
		routeCount.set(e.meta.route, (routeCount.get(e.meta.route) ?? 0) + 1);
		userCount.set(e.userId, (userCount.get(e.userId) ?? 0) + 1);
		const tb = e.timestamp.slice(0, 13) + ':00';
		timelineMap.set(tb, (timelineMap.get(tb) ?? 0) + 1);
	}

	const chartEventVolume = bucketMapToTimeline(chartVolumeMap);
	const chartErrorRateTimeline = errorMapToTimeline(chartErrorMap);

	const volumeTimeline = needSeparateVolume
		? bucketMapToTimeline(volumeMapSep!)
		: chartEventVolume;

	const errorTimeline = needSeparateError
		? errorMapToTimeline(errorMapSep!)
		: chartErrorRateTimeline;

	const topPages = Array.from(pageCount.entries())
		.sort((a, b) => b[1] - a[1]).slice(0, 10)
		.map(([label, count]) => ({ label, count }));

	const topErrors = Array.from(appErrorCount.entries())
		.sort((a, b) => b[1].count - a[1].count).slice(0, 10)
		.map(([message, { count, lastSeen }]) => ({ message, count, lastSeen }));

	const navigationFunnel = Array.from(funnelCount.entries())
		.sort((a, b) => b[1] - a[1]).slice(0, 10)
		.map(([key, count]) => {
			const [from, to] = key.split('|||');
			return { from, to, count };
		});

	const topEndpoints = Array.from(endpointCount.entries())
		.sort((a, b) => b[1] - a[1]).slice(0, 10)
		.map(([label, count]) => ({ label, count }));

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
				topStatus: topStatusFor(url)
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
				topStatus: topStatusFor(url)
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
		slowestEndpoint,
	};

	const topRoutes = Array.from(routeCount.entries())
		.sort((a, b) => b[1] - a[1]).slice(0, 10)
		.map(([route, count]) => ({ route, count }));

	const topUsers = Array.from(userCount.entries())
		.sort((a, b) => b[1] - a[1]).slice(0, 10)
		.map(([userId, count]) => ({ userId, count }));

	const timeline = Array.from(timelineMap.entries())
		.sort()
		.map(([bucket, count]) => ({ bucket, count }));

	const metrics: MetricsResult = {
		activeSessions: activeSessionSet.size,
		eventVolume: chartEventVolume,
		errorRateTimeline: chartErrorRateTimeline,
		topPages,
		topErrors,
		navigationFunnel,
		topEndpoints,
	};

	const stats: StatsResult = {
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
	};

	return {
		metrics,
		stats,
		volumeTimeline,
		errorTimeline
	};
}
