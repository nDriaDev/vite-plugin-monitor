import type { AppState, AppTab, ChartType, EventsFilter, Listener, MetricsResult, SearchOperator, StateEvents, StatsResult, TimePreset, TimeRange, TrackerEvent } from "@tracker/types";
import { getEventDetail } from "./utils/format";

export const PRESETS: { label: string; value: TimePreset; minutes: number }[] = [
	{ label: '1h', value: '1h', minutes: 60 },
	{ label: '6h', value: '6h', minutes: 360 },
	{ label: '24h', value: '24h', minutes: 1440 },
	{ label: '7d', value: '7d', minutes: 10080 },
	{ label: '30d', value: '30d', minutes: 43200 },
];

/**
 * INFO Initial live window width in milliseconds: the `from` is set to (now - 5min)
 * when the user clicks "Live", and then stays fixed as the window grows forward.
 */
export const LIVE_WINDOW_MS = 5 * 60_000;

/**
 * INFO Maximum duration a live session window can span before `from` is capped.
 * Once (to - from) exceeds this threshold, `from` is advanced to keep the window
 * at most this wide, preventing unbounded growth and excessive backend payload.
 */
export const LIVE_MAX_WINDOW_MS = 30 * 60_000;

export function presetToRange(preset: TimePreset): { from: string; to: string } {
	const to = new Date();
	const from = new Date(to.getTime() - PRESETS.find(p => p.value === preset)!.minutes * 60_000);
	return {
		from: from.toISOString(),
		to: to.toISOString()
	}
}

/**
* Returns the actual time range to use in queries.
*
* @remarks
* **Live mode** uses a growing window anchored to when the user pressed "Live":
* - `from` stays fixed at the original click time, so the user always sees
*   everything that happened since they started the live session.
* - `to` always advances to the current moment on every call.
* - If the session has been open long enough that `(to - from)` exceeds
*   {@link LIVE_MAX_WINDOW_MS} (30 minutes), `from` is capped to `to - 30min`
*   so the backend payload stays bounded and the dashboard remains responsive.
*
* **All other presets** return the fixed `from`/`to` values stored in the state.
*/
export function effectiveTimeRange(range: TimeRange): { from: string; to: string } {
	if (range.preset === 'live') {
		const to = new Date();
		const originalFrom = new Date(range.from).getTime();
		const cappedFrom = to.getTime() - LIVE_MAX_WINDOW_MS;
		const from = new Date(Math.max(originalFrom, cappedFrom));
		return { from: from.toISOString(), to: to.toISOString() };
	}
	return { from: range.from, to: range.to };
}

function createStore() {
	const state: AppState = {
		authenticated: false,
		tab: 'metrics',
		timeRange: { preset: '24h', ...presetToRange('24h') },
		chartType: 'line',
		metrics: null,
		stats: null,
		metricsLoading: false,
		metricsError: null,
		events: [],
		eventsFilter: {},
		eventsLoading: false,
		eventsError: null,
		eventsTotal: 0,
		selectedEvent: null,
		backendOnline: true,
	}
	// INFO Full unfiltered event buffer fetched from the backend.
	let rawEvents: TrackerEvent[] = [];

	const listeners = new Map<keyof StateEvents, Set<Listener<any>>>();

	/**
	 * Apply the current `eventsFilter` to `rawEvents` and emit the result.
	 * Called whenever the filter changes or new raw events arrive.
	 *
	 * @remarks
	 * All filtering is client-side:
	 * - `type` - exact match on `event.type`
	 * - `level` - exact match on `event.level`
	 * - `userId` - case-insensitive substring match on `event.userId`
	 * - `search` - case-insensitive substring match on `JSON.stringify(event.payload)`
	 * - `route` - exact match on `event.meta.route`
	 * - time range - events outside `state.timeRange.from/to` are excluded
	 */
	function applyFilter(): void {
		const f = state.eventsFilter;
		const { from, to } = effectiveTimeRange(state.timeRange);

		let result = rawEvents.filter(e => e.timestamp >= from && e.timestamp <= to);

		if (f.type) {
			result = result.filter(e => e.type === f.type);
		}
		if (f.level && f.level.length > 0) {
			result = result.filter(e => f.level!.includes(e.level));
		}
		if (f.userId) {
			const lower = f.userId.toLowerCase();
			result = result.filter(e => e.userId.toLowerCase().includes(lower));
		}
		if (f.search) {
			const term = f.search;
			const op: SearchOperator = f.searchOperator ?? 'contains';
			const lower = term.toLowerCase();

			result = result.filter(e => {
				// INFO apply search to detail column table text
				const detail = getEventDetail(e, false).toLowerCase();
				switch (op) {
					case 'contains':
						return detail.includes(lower);
					case 'not-contains':
						return !detail.includes(lower);
					case 'equals':
						return detail === lower;
					case 'starts-with':
						return detail.startsWith(lower);
					case 'ends-with':
						return detail.endsWith(lower);
					case 'regex': {
						try {
							return new RegExp(term, 'i').test(detail);
						} catch {
							// INFO invalid regex: fallback to contains
							return detail.includes(lower);
						}
					}
					default:
						/* v8 ignore start */
						return detail.includes(lower);
						/* v8 ignore stop */
				}
			});
		}
		if (f.route) {
			result = result.filter(e => e.meta.route === f.route);
		}

		state.events = result;
		state.eventsTotal = result.length;
		emit('events:update', state.events);
	}

	function on<K extends keyof StateEvents>(event: K, fn: Listener<StateEvents[K]>): () => void {
		if (!listeners.has(event)) {
			listeners.set(event, new Set());
		}
		listeners.get(event)!.add(fn);
		return () => listeners.get(event)?.delete(fn);
	}

	function emit<K extends keyof StateEvents>(event: K, payload: StateEvents[K]): void {
		listeners.get(event)?.forEach(fn => fn(payload));
	}

	function setAuth(value: boolean) {
		state.authenticated = value;
		emit('auth:change', value);
	}

	function setTab(tab: AppTab) {
		state.tab = tab;
		if (state.selectedEvent !== null) {
			state.selectedEvent = null;
			emit('events:select', null);
		}
		emit('tab:change', tab);
	}

	/**
	 * Update the selected time range.
	 * Re-applies the client-side filter so the event list immediately
	 * reflects the new window without waiting for a new backend fetch.
	 * The poller will then fetch fresh data for the new range.
	 *
	 * @param range - New time range with `from`, `to`, and `preset`.
	 */
	function setTimeRange(range: TimeRange) {
		state.timeRange = range;
		state.selectedEvent = null;
		emit('timeRange:change', range);
		applyFilter();
	}

	function setChartType(type: ChartType) {
		state.chartType = type;
		emit('chartType:change', type);
	}

	function setMetrics(metrics: MetricsResult, stats: StatsResult) {
		state.metrics = metrics;
		state.stats = stats;
		state.metricsLoading = false;
		state.metricsError = null;
		emit('metrics:update', { metrics, stats });
	}

	function setMetricsLoading(loading: boolean) {
		state.metricsLoading = loading;
		emit('metrics:loading', loading);
	}

	function setMetricsError(err: string | null) {
		state.metricsError = err;
		state.metricsLoading = false;
		emit('metrics:error', err);
	}

	/**
	 * Store a full batch of raw events from the backend and apply
	 * the current client-side filter immediately.
	 *
	 * @param events - Full unfiltered event list returned by the backend.
	 * @param _total - Ignored (total is now computed after client-side filtering).
	 */
	// eslint-disable-next-line no-unused-vars
	function setEvents(events: TrackerEvent[], _total: number) {
		rawEvents = events;
		state.eventsLoading = false;
		state.eventsError = null;
		applyFilter();
	}

	/**
	 * Update the active filter and re-apply it immediately against `rawEvents`.
	 * Does NOT trigger a backend re-fetch: filtering is entirely client-side.
	 *
	 * @param filter - New filter state. Replaces the previous filter entirely.
	 */
	function setEventsFilter(filter: EventsFilter) {
		state.eventsFilter = filter;
		state.selectedEvent = null;
		emit('events:filter', filter);
		applyFilter();
	}

	function setEventsLoading(loading: boolean) {
		state.eventsLoading = loading;
		emit('events:loading', loading);
	}

	function setEventsError(err: string | null) {
		state.eventsError = err;
		state.eventsLoading = false;
		emit('events:error', err);
	}

	function selectEvent(event: TrackerEvent | null) {
		state.selectedEvent = event;
		emit('events:select', event);
	}

	function resetSelectEvent() {
		if (state.selectedEvent !== null) {
			state.selectedEvent = null;
			emit('events:select', null);
		}
	}

	function setBackendStatus(online: boolean) {
		state.backendOnline = online;
		emit('backend:status', online);
	}

	function clearListeners() {
		listeners.clear();
	}

	return {
		emit,
		get: () => state as Readonly<AppState>,
		getUniqueUserIds(): string[] {
			const ids = new Set(rawEvents.map(e => e.userId));
			return Array.from(ids).sort();
		},
		on,
		clearListeners,
		resetSelectEvent,
		setAuth,
		setTab,
		setTimeRange,
		setChartType,
		setMetrics,
		setMetricsLoading,
		setMetricsError,
		setEvents,
		setEventsFilter,
		setEventsLoading,
		setEventsError,
		selectEvent,
		setBackendStatus,
	}
}

export const store = createStore();

/**
 * Type of the `store` singleton returned by `createStore()`.
 *
 * @remarks
 * Derived via `ReturnType` so it stays automatically in sync with the
 * store implementation: no manual interface maintenance required.
 *
 * Used by dashboard components to type the store reference when it is
 * passed as a parameter or stored in a variable.
 *
 * @example
 * ```ts
 * import { store, type Store } from '../state'
 *
 * function renderHeader(s: Store) {
 *   s.on('auth:change', (auth) => updateAuthUI(auth))
 * }
 * ```
 */
export type Store = ReturnType<typeof createStore>;
