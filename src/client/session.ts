/* eslint-disable no-undef */
import type { EventPayload, LogLevel, TrackerEvent } from "@tracker/types";

function generateId(): string {
	return typeof crypto !== 'undefined' && crypto.randomUUID
		? crypto.randomUUID()
		: Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function sessionGet(key: string): string | null {
	try {
		return sessionStorage.getItem(key);
	} catch {
		return null;
	}
}

function sessionSet(key: string, val: string): void {
	try {
		sessionStorage.setItem(key, val);
	} catch { /* unavailable */ }
}

function getOrCreate(key: string, prefix: string): string {
	let id = sessionGet(key);
	if (!id) {
		id = `${prefix}_${generateId()}`;
		sessionSet(key, id);
	}
	return id
}

export class TrackerSession {
	readonly sessionId: string;
	readonly appId: string;

	userId: string;
	userAttributes: Record<string, unknown> = {};

	private _context: Record<string, unknown> = {};
	private _userIdResolver?: () => string | null;

	constructor(userIdResolver?: () => string | null) {
		this._userIdResolver = userIdResolver;
		this.appId = (typeof window !== 'undefined' ? window.__TRACKER_CONFIG__?.appId : undefined) ?? 'unknown';
		this.sessionId = getOrCreate('__tracker_session_id__', 'sess');

		const resolvedId = userIdResolver?.() ?? null;
		if (resolvedId) {
			this.userId = resolvedId;
			sessionSet('__tracker_user_id__', resolvedId);
		} else {
			this.userId = getOrCreate('__tracker_user_id__', 'anon');
		}
	}

	/**
	* Update the userId resolver function and resolve immediately.
	* Called by initTracker() when userIdFn is provided after setupTrackers().
	*/
	setUserIdFn(fn: () => string | null): void {
		this._userIdResolver = fn;
		const resolved = fn();
		if (resolved) {
			this.userId = resolved;
			sessionSet('__tracker_user_id__', resolved);
		}
	}

	/**
	* Merge additional key-value pairs into the persistent context.
	* All subsequent events will carry these values in their `context` field.
	* Passing null as a value removes the key.
	*/
	setContext(attrs: Record<string, unknown>): void {
		for (const [k, v] of Object.entries(attrs)) {
			if (v === null) {
				delete this._context[k];
			} else {
				this._context[k] = v;
			}
		}
	}

	getContext(): Record<string, unknown> | undefined {
		return Object.keys(this._context).length > 0 ? { ...this._context } : undefined;
	}

	createEvent(type: TrackerEvent['type'], level: LogLevel, payload: EventPayload, groupId?: string, extraCtx?: Record<string, unknown>): TrackerEvent {
		const mergedContext = (Object.keys(this._context).length > 0 || extraCtx)
			? { ...this._context, ...extraCtx }
			: undefined;

		const userAttrs = Object.keys(this.userAttributes).length > 0
			? this.userAttributes
			: undefined;

		return {
			timestamp: new Date().toISOString(),
			level,
			type,
			appId: this.appId,
			sessionId: this.sessionId,
			userId: this.userId,
			groupId,
			context: mergedContext,
			payload,
			meta: {
				userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'ssr',
				route: typeof window !== 'undefined' ? window.location.pathname + window.location.search : '/',
				viewport: typeof window !== 'undefined' ? `${window.innerWidth}x${window.innerHeight}` : '0x0',
				language: typeof navigator !== 'undefined' ? navigator.language : '',
				referrer: typeof document !== 'undefined' ? document.referrer || undefined : undefined,
				userAttributes: userAttrs,
			},
		}
	}
}
