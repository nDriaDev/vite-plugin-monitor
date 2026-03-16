import { IDebugOverlay, ITrackerClient, LogLevel, SetUserOptions, Tracker, TrackerConfig, TrackerEvent, TrackEventOptions } from "@tracker/types";
import { TrackerSession } from "./session";
import { EventQueue } from "./queue";
import { setupConsoleTracker } from "./trackers/console";
import { setupClickTracker } from "./trackers/clicks";
import { setupHttpTracker } from "./trackers/http";
import { setupErrorTracker } from "./trackers/errors";
import { setupNavigationTracker } from "./trackers/navigation";
import { setupPerformanceTracker } from "./trackers/performance";
import { DebugOverlay } from "./overlay";

// INFO Holds the TrackerClient created by setupTrackers() before init() is called.
let preInitClient: TrackerClient | null = null

class TrackerClient implements ITrackerClient {
	private config: TrackerConfig;
	private session: TrackerSession;
	private queue: EventQueue;
	private overlay: IDebugOverlay | null = null;
	private teardowns: Array<() => void> = [];
	private timers = new Map<string, number>();

	constructor(config: TrackerConfig, userIdFn?: () => string | null) {
		if (typeof window === 'undefined') {
			throw new Error('[vite-plugin-monitor] TrackerClient cannot be instantiated in a non-browser environment.');
		}

		this.config = config;
		this.session = new TrackerSession(userIdFn);
		this.queue = new EventQueue({
			wsEndpoint: config.wsEndpoint,
			writeEndpoint: config.writeEndpoint,
			apiKey: config.apiKey,
			batchSize: config.batchSize,
			flushInterval: config.flushInterval,
		});
	}

	/**
	* INFO install all event proxies.
	* Called as early as possible (head-prepend) before any application code.
	* Events are enqueued immediately into the queue but not flushed until
	* init() activates the flush timer and sendBeacon listeners.
	*/
	setupTrackers() {
		const track = this.config.track;

		const emit = (event: ReturnType<typeof this.session.createEvent>) => {
			this.queue.enqueue(event);
			this.overlay?.pushEvent(event);
		}

		if (track.console) {
			this.teardowns.push(setupConsoleTracker(
				track.console,
				(payload, level) => emit(this.session.createEvent('console', level, payload))
			));
		}
		if (track.clicks) {
			this.teardowns.push(setupClickTracker((payload) => emit(this.session.createEvent('click', 'info', payload))));
		}
		if (track.http) {
			const ignoreUrls = [this.config.writeEndpoint, ...(track.ignoreUrls ?? [])];
			this.teardowns.push(setupHttpTracker(
				ignoreUrls,
				track.http,
				(payload, level) => emit(this.session.createEvent('http', level, payload))
			));
		}
		if (track.errors) {
			this.teardowns.push(setupErrorTracker((payload) => emit(this.session.createEvent('error', 'error', payload))));
		}
		if (track.navigation) {
			this.teardowns.push(setupNavigationTracker((payload) => emit(this.session.createEvent('navigation', 'info', payload))));
		}
		if (track.performance) {
			this.teardowns.push(setupPerformanceTracker((payload) => emit(this.session.createEvent('performance', payload.rating === 'poor' ? 'warn' : 'info', payload))));
		}
	}

	/**
	* INFO — activate flushing and mount overlay.
	* Called by initTracker() — either automatically (autoInit: true)
	* or manually by the consumer (autoInit: false).
	*/
	init(userIdFn?: () => string | null): void {
		if (userIdFn) {
			this.session.setUserIdFn(userIdFn);
		}

		this.queue.init();

		if (this.config.overlay.enabled) {
			this._mountOverlay(DebugOverlay);
		}

		window.addEventListener('visibilitychange', () => {
			if (document.visibilityState === 'hidden') {
				this.queue.flush();
			}
		});
		window.addEventListener('beforeunload', () => this.queue.flush());
	}

	private emit(name: string, data: Record<string, unknown>, opts: TrackEventOptions = {}) {
		const level: LogLevel = opts.level ?? 'info';
		const groupId: string | undefined = opts.groupId;
		const extraCtx = opts.context;

		const payload = { name, data: { ...data } };
		const event = this.session.createEvent('custom', level, payload, groupId, extraCtx);
		this.queue.enqueue(event);
		return event;
	}

	track(name: string, data: Record<string, unknown> = {}, opts: TrackEventOptions = {}): void {
		this.emit(name, data, opts);
	}

	time(label: string): void {
		if (typeof performance === 'undefined') return
		if (this.timers.has(label)) {
			console.warn(`[vite-plugin-monitor] timer "${label}" already started — call timeEnd() first`);
			return;
		}
		this.timers.set(label, performance.now());
	}

	timeEnd(label: string, data: Record<string, unknown> = {}, opts: TrackEventOptions = {}): number {
		if (typeof performance === 'undefined') {
			return -1;
		}
		const start = this.timers.get(label);
		if (start === undefined) {
			console.warn(`[vite-plugin-monitor] timeEnd("${label}") called without a matching time()`);
			return -1;
		}
		this.timers.delete(label);
		const duration = Math.round(performance.now() - start);
		this.emit(label, { ...data, duration }, opts);
		return duration;
	}

	setUser(userId: string | null, opts: SetUserOptions = {}): void {
		if (userId === null) {
			try {
				sessionStorage.removeItem('__tracker_user_id__');
			} catch { /* ignore */ }
			this.session.userId = `anon_${Math.random().toString(36).slice(2)}`;
			this.session.userAttributes = {};
		} else {
			this.session.userId = userId;
			this.session.userAttributes = opts.attributes ?? {};
			try {
				sessionStorage.setItem('__tracker_user_id__', userId);
			} catch { /* ignore */ }
		}
		this.overlay?.refreshUserId();
	}

	setContext(attrs: Record<string, unknown>): void {
		this.session.setContext(attrs);
	}

	group(name: string): string {
		return `grp_${name}_${Date.now().toString(36)}`;
	}

	_mountOverlay(OverlayClass: typeof DebugOverlay) {
		if (this.overlay) {
			return;
		}
		this.overlay = new OverlayClass(
			this.session,
			this.config.dashboard.route,
			(newId: string | null) => {
				const prevId = this.session.userId;
				this.setUser(newId);
				this.emit(
					'user:id-changed',
					{
						previousUserId: prevId,
						newUserId: this.session.userId,
						source: "overlay"
					}
				);
			}
		);
	}

	destroy() {
		this.teardowns.forEach(fn => fn());
		this.overlay?.destroy();
		this.timers.clear();
		this.queue.flush();
	}
}

function getConfig() {
	const config = window.__TRACKER_CONFIG__;
	if (!config) {
		throw new Error('[vite-plugin-monitor] window.__TRACKER_CONFIG__ not found. Make sure the plugin is configured in vite.config.ts and the page has been reloaded.');
	}
	return config;
}

/**
 * Install all event proxies immediately.
 *
 * @remarks
 * Must be called before any application code to ensure proxies are
 * installed before the app can override fetch, XHR, console, etc.
 * Exported for use in the auto-generated setup script.
 */
export function setupTrackers(userIdFn?: () => string | null): void {
	if (typeof window === 'undefined') {
		return;
	}
	if (preInitClient) {
		return;
	}
	const config = getConfig();
	preInitClient = new TrackerClient(config, userIdFn);
	preInitClient.setupTrackers();
}

/**
 * Initialize the tracker client with the provided configuration.
 *
 * @remarks
 * Safe to call multiple times — returns the existing instance if already
 * initialized (singleton). Returns `null` in non-browser environments (SSR).
 *
 * When `autoInit: true` (default), this is called automatically by the
 * script injected into `index.html` by the plugin. When `autoInit: false`,
 * the consumer must call this manually at the appropriate point:
 *
 * ```ts
 * import { initTracker } from 'virtual:vite-tracker-client'
 * initTracker(config, () => store.getState().userId)
 * ```
 *
 * @param config    - Resolved plugin configuration serialized by the plugin.
 * @param userIdFn  - Function that returns the current user ID, or `null` to
 *                    fallback to the session ID.
 * @returns The `TrackerClient` singleton, or `null` in SSR environments.
 */
function initTracker(userIdFn?: () => string | null): void {
	if (typeof window === 'undefined') {
		return;
	}
	if (window.__tracker_instance__) {
		return;
	}

	/**
	* INFO
	* Reuse the client created by setupTrackers() if available,
	* otherwise create a fresh one (e.g. when autoInit: false and
	* the consumer calls tracker.init() without a prior setupTrackers())
	*/
	const client = preInitClient ?? new TrackerClient(getConfig(), userIdFn);
	preInitClient = null;
	client.init(userIdFn);

	Object.defineProperty(window, '__tracker_instance__', {
		value: client,
		writable: false,
		configurable: false,
		enumerable: false
	});
}

/**
 * Thin proxy over the TrackerClient singleton.
 *
 * @remarks
 * Safe to call before initTracker() — calls are silently dropped if the
 * instance is not yet available (e.g. during SSR or before initialization).
 */
function instance(): ITrackerClient | undefined {
	return typeof window !== 'undefined' ? window.__tracker_instance__ : undefined;
}

export const tracker: Tracker = {
	init(userIdFn?: () => string | null): void {
		initTracker(userIdFn);
	},
	track(name: string, data?: Record<string, unknown>, opts?: TrackEventOptions): void {
		instance()?.track(name, data, opts);
	},
	time(label: string): void {
		instance()?.time(label);
	},
	timeEnd(label: string, data?: Record<string, unknown>, opts?: TrackEventOptions): number {
		return instance()?.timeEnd(label, data, opts) ?? -1;
	},
	setUser(userId: string | null, opts?: SetUserOptions): void {
		instance()?.setUser(userId, opts);
	},
	setContext(attrs: Record<string, unknown>): void {
		instance()?.setContext(attrs);
	},
	group(name: string): string {
		return instance()?.group(name) ?? `grp_${name}_offline`;
	},
	destroy() {
		instance()?.destroy();
	}
}
