import { LogLevel, TrackerEvent, TrackerEventType } from "@tracker/types";
import { MetricsResult, StatsResult } from "./aggregations";

/**
* Complete reactive state of the dashboard SPA.
*
* @remarks
* Owned by the `store` singleton in `state.ts`. Consumers subscribe via the
* {@link StateEvents} pub/sub bus. All mutations go through typed mutator methods.
*
*/
export interface AppState {
	/**
	* Whether the user has passed the login gate.
	*
	* @remarks
	* Set to `true` after credentials match and session is stored in `sessionStorage`.
	* Resets to `false` on tab close or logout.
	*/
	authenticated: boolean

	/** Currently visible dashboard tab. @see {@link AppTab} */
	tab: AppTab

	/** Selected time window, shared between Metrics and Events tabs. @see {@link TimeRange} */
	timeRange: TimeRange

	/** Current render mode for all time series charts. @see {@link ChartType} */
	chartType: ChartType

	/**
	* Latest metrics response. `null` before the first successful poll.
	*
	* @see {@link MetricsResult}
	*/
	metrics: MetricsResult | null

	/**
	* Latest stats (KPI) response. `null` before the first successful poll.
	*
	* @see {@link StatsResult}
	*/
	stats: StatsResult | null

	/**
	* `true` while the parallel metrics + stats requests are in-flight.
	*
	* @remarks
	* Used to show loading skeletons in KPI cards and chart areas.
	*/
	metricsLoading: boolean

	/**
	* Error message from the last failed metrics/stats request. `null` when healthy.
	*
	* @remarks
	* Cleared at the start of each new poll attempt.
	*/
	metricsError: string | null

	/**
	* Events displayed in the Events tab.
	*
	* @remarks
	* Replaced entirely on full reload (`events:update`). New events from cursor
	* polling are prepended (`events:append`).
	*/
	events: TrackerEvent[]

	/** Active filter applied to the Events tab list. @see {@link EventsFilter} */
	eventsFilter: EventsFilter

	/**
	* `true` while a full events reload (not a cursor append) is in-flight.
	*
	* @remarks
	* Does not activate for incremental cursor appends, to avoid flickering.
	*/
	eventsLoading: boolean

	/** Error message from the last failed events request. `null` when healthy. */
	eventsError: string | null

	/**
	* Total count of matching events for pagination display.
	*
	* @remarks
	* Sourced from {@link EventsResponse.total}. Drives page count in the table footer.
	*/
	eventsTotal: number

	/**
	* Event currently shown in the detail side panel. `null` when panel is closed.
	*
	* @remarks
	* Set when the user clicks a row. Cleared on re-click, Escape, or list reload.
	*/
	selectedEvent: TrackerEvent | null

	/**
	* Whether the backend responded successfully to the last `/ping` check.
	*
	* @remarks
	* Drives the status indicator badge in the dashboard header.
	*/
	backendOnline: boolean
}

/**
* Type map for the dashboard reactive pub/sub event bus.
*
* @remarks
* Keys are event names; values are the payload types passed to subscribers.
* Subscribe to a specific event:
* ```ts
* store.on('tab:change', (tab) => renderTab(tab))
* ```
* Listeners are called synchronously on the same tick as the state mutation.
*
*/
export interface StateEvents {
	/** Fired when the user logs in (`true`) or logs out (`false`). */
	'auth:change': boolean

	/** Fired when the active tab changes. Payload is the new {@link AppTab}. */
	'tab:change': AppTab

	/** Fired when the selected time range changes. Payload is the new {@link TimeRange}. */
	'timeRange:change': TimeRange

	/** Fired when the chart render mode is toggled. Payload is the new {@link ChartType}. */
	'chartType:change': ChartType

	/** Fired after a successful parallel metrics + stats fetch. */
	'metrics:update': { metrics: MetricsResult; stats: StatsResult }

	/** Fired when the metrics loading state changes (`true` = in-flight). */
	'metrics:loading': boolean

	/** Fired when a metrics fetch fails (error message) or clears (`null`). */
	'metrics:error': string | null

	/** Fired after a full events page reload — replaces the entire event list. */
	'events:update': TrackerEvent[]

	/** Fired after a cursor-based incremental fetch — new events prepended to the list. */
	'events:append': TrackerEvent[]

	/** Fired when the events filter changes, triggering a full reload. */
	'events:filter': EventsFilter

	/** Fired when the events loading state changes (`true` = full reload in-flight). */
	'events:loading': boolean

	/** Fired when an events fetch fails (error message) or clears (`null`). */
	'events:error': string | null

	/** Fired when the user selects or deselects a row in the events table. */
	'events:select': TrackerEvent | null

	/** Fired after each `/ping` check: `true` = backend online, `false` = offline. */
	'backend:status': boolean
}

/**
* Preset time window options available in the dashboard time range picker.
*
* @remarks
* | Value  | Window    |
* |--------|-----------|
* | `'1h'` | 60 min    |
* | `'6h'` | 360 min   |
* | `'24h'`| 1 440 min |
* | `'7d'` | 10 080 min|
* | `'30d'`| 43 200 min|
*
* Mapped to concrete ISO timestamps by `presetToRange()` in `state.ts`.
*
*/
export type TimePreset = '1h' | '6h' | '24h' | '7d' | '30d'

/**
* Render mode for time series charts in the Metrics tab.
*
* @remarks
* - `'line'` — line + area fill. Best for trends. Default.
* - `'bar'`  — vertical bars. Best for comparing discrete buckets.
*
* Stored in {@link AppState.chartType}; applied to all charts simultaneously.
*
*/
export type ChartType = 'line' | 'bar'

/**
* Identifier for the currently active tab in the dashboard SPA.
*
* @remarks
* | Value      | Content                                              |
* |------------|------------------------------------------------------|
* | `'metrics'`| KPI cards, time series charts, top lists, funnel     |
* | `'events'` | Paginated raw event list with filters + detail panel |
*
* Stored in {@link AppState.tab} and reflected in the URL hash.
*
*/
export type AppTab = 'metrics' | 'events'

/**
* Represents the currently selected time window for all dashboard queries.
*
* @remarks
* All API calls use `from` and `to` as `since` and `until` parameters.
* When `preset` is a {@link TimePreset}, `from`/`to` are recomputed on each
* poll tick so the window always ends at "now". When the user edits the
* datetime inputs, `preset` becomes `'custom'`.
*
*/
export interface TimeRange {
	/**
	* Active preset label, or `'custom'` when an explicit range is set.
	*
	* @remarks
	* Used to highlight the active button in the time range picker.
	*/
	preset: TimePreset | 'custom'

	/**
	* Start of the time window. ISO 8601 UTC string.
	*
	* @example `'2024-03-15T09:00:00.000Z'`
	*/
	from: string

	/**
	* End of the time window. ISO 8601 UTC string.
	*
	* @example `'2024-03-15T10:00:00.000Z'`
	*/
	to: string
}

/**
* Active filter state applied to the Events tab event list.
*
* @remarks
* All fields optional; multiple fields combine with AND.
* Stored in {@link AppState.eventsFilter} and serialized as {@link EventsQuery} params.
*
*/
export interface EventsFilter {
	/** Show only events of this type. */
	type?: TrackerEventType

	/** Show only events at or above this severity level. */
	level?: LogLevel

	/** Show only events attributed to this `userId`. */
	userId?: string

	/**
	* Full-text search term forwarded as-is to {@link EventsQuery.search}.
	*/
	search?: string
}

export const PRESETS: { label: string; value: TimePreset; minutes: number }[] = [
	{ label: '1h', value: '1h', minutes: 60 },
	{ label: '6h', value: '6h', minutes: 360 },
	{ label: '24h', value: '24h', minutes: 1440 },
	{ label: '7d', value: '7d', minutes: 10080 },
	{ label: '30d', value: '30d', minutes: 43200 },
];

export function presetToRange(preset: TimePreset): { from: string; to: string } {
	const to = new Date();
	const from = new Date(to.getTime() - PRESETS.find(p => p.value === preset)!.minutes * 60_000);
	return {
		from: from.toISOString(),
		to: to.toISOString()
	}
}

type Listener<T> = (payload: T) => void;

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

	const listeners = new Map<keyof StateEvents, Set<Listener<any>>>();

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
		emit('tab:change', tab);
	}

	function setTimeRange(range: TimeRange) {
		state.timeRange = range;
		state.events = [];
		state.selectedEvent = null;
		emit('timeRange:change', range);
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

	function setEvents(events: TrackerEvent[], total: number) {
		state.events = events.slice(0, 500);
		state.eventsTotal = total;
		state.eventsLoading = false;
		state.eventsError = null;
		emit('events:update', state.events);
	}

	function prependEvents(newEvents: TrackerEvent[]) {
		state.events = [...newEvents, ...state.events].slice(0, 500);
		emit('events:append', newEvents);
		emit('events:update', state.events);
	}

	function setEventsFilter(filter: EventsFilter) {
		state.eventsFilter = filter;
		state.events = [];
		state.selectedEvent = null;
		emit('events:filter', filter);
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

	function setBackendStatus(online: boolean) {
		state.backendOnline = online;
		emit('backend:status', online);
	}

	function clearListeners() {
		listeners.clear();
	}

	return {
		get: () => state as Readonly<AppState>,
		on,
		emit,
		clearListeners,
		setAuth,
		setTab,
		setTimeRange,
		setChartType,
		setMetrics,
		setMetricsLoading,
		setMetricsError,
		setEvents,
		prependEvents,
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
