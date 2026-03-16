import { LogLevel, TrackerEvent, TrackerEventType } from "@tracker/types";
import { fetchEvents } from "./api";

export interface TimePoint { bucket: string; value: number }
export interface RankedItem { label: string; count: number }
export interface ErrorItem { message: string; count: number; lastSeen: string }
export interface FunnelStep { from: string; to: string; count: number }

export interface MetricsResult {
	activeSessions: number
	errorRateTimeline: TimePoint[]
	eventVolume: TimePoint[]
	topPages: RankedItem[]
	topErrors: ErrorItem[]
	navigationFunnel: FunnelStep[]
}

export interface StatsResult {
	totalEvents: number
	totalSessions: number
	totalUsers: number
	errorRate: number
	avgHttpDuration?: number
	topRoutes: Array<{ route: string; count: number }>
	topUsers: Array<{ userId: string; count: number }>
	timeline: Array<{ bucket: string; count: number }>
}

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

	// INFO Top pages (by navigation → .to)
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

	return {
		activeSessions,
		eventVolume,
		errorRateTimeline,
		topPages,
		topErrors,
		navigationFunnel
	}
}

export function computeStats(events: TrackerEvent[], since: string, until: string): StatsResult {
	const ranged = events.filter(e => e.timestamp >= since && e.timestamp <= until);

	const sessions = new Set(ranged.map(e => e.sessionId));
	const users = new Set(ranged.map(e => e.userId));

	const byType = {} as Record<TrackerEventType, number>;
	const byLevel = {} as Record<LogLevel, number>;
	let httpDurationSum = 0, httpCount = 0;

	for (const e of ranged) {
		byType[e.type] = (byType[e.type] ?? 0) + 1;
		byLevel[e.level] = (byLevel[e.level] ?? 0) + 1;
		if (e.type === 'http' && (e.payload as any).duration) {
			httpDurationSum += (e.payload as any).duration;
			httpCount++;
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

	return {
		totalEvents: ranged.length,
		totalSessions: sessions.size,
		totalUsers: users.size,
		errorRate: ranged.length > 0 ? (byLevel['error'] ?? 0) / ranged.length : 0,
		avgHttpDuration: httpCount > 0 ? httpDurationSum / httpCount : undefined,
		topRoutes,
		topUsers,
		timeline,
	}
}

const FETCH_PAGE_SIZE = 500  // max per request: keep memory reasonable

/**
 * Fetch all events in the given time range by following the cursor
 * until the backend signals there are no more results.
 *
 * @remarks
 * Uses cursor-based pagination (`after`) to avoid result shifting between
 * requests. Each page uses `limit: FETCH_PAGE_SIZE` to minimize the number
 * of round trips.
 *
 * **Memory consideration:** all fetched events are held in memory for
 * client-side aggregation. For very large time ranges this can be
 * significant: the caller should constrain `since`/`until` accordingly.
 *
 * @param since - Start of the time range. ISO 8601 UTC string.
 * @param until - End of the time range. ISO 8601 UTC string.
 * @returns All matching events, ordered oldest-first for aggregation.
 */
export async function fetchAllEvents(since: string, until: string): Promise<TrackerEvent[]> {
	const all: TrackerEvent[] = [];
	let page = 1;
	let hasMore = true;

	while (hasMore) {
		const response = await fetchEvents({
			since,
			until,
			limit: FETCH_PAGE_SIZE,
			page
		});

		if (!response.events.length) {
			hasMore = false;
			break;
		}

		all.push(...response.events);

		if (response.events.length < FETCH_PAGE_SIZE) {
			hasMore = false;
		} else {
			page++;
		}
	}

	return all.reverse();
}
