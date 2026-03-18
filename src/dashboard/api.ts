import { EventsResponse, TrackerEvent } from "@tracker/types";

function getConfig() {
	const cfg = window.__TRACKER_CONFIG__;
	if (!cfg) {
		throw new Error('[dashboard] __TRACKER_CONFIG__ not found on window');
	}
	return cfg;
}

let wsInstance: WebSocket | null = null;

/**
 * Opens (or reuses) the dashboard WebSocket connection.
 *
 * @remarks
 * Called lazily the first time `fetchAllEvents` runs in WebSocket mode.
 * The connection is kept alive with automatic reconnection on close.
 * Incoming `push` messages (real-time server-push) are ignored by the
 * built-in dashboard - it relies entirely on its polling loop instead.
 */
function ensureWsConnected(): Promise<WebSocket> {
	return new Promise((resolve, reject) => {
		if (wsInstance && wsInstance.readyState === WebSocket.OPEN) {
			resolve(wsInstance);
			return;
		}

		const { wsEndpoint } = getConfig();
		if (!wsEndpoint) {
			reject(new Error('[vite-plugin-monitor] wsEndpoint is not configured'));
			return;
		}

		const ws = new WebSocket(wsEndpoint);
		wsInstance = ws;

		ws.addEventListener('open', () => resolve(ws), { once: true });
		ws.addEventListener('error', () => {
			wsInstance = null;
			reject(new Error('[vite-plugin-monitor] WebSocket connection failed'));
		}, { once: true });
		ws.addEventListener('close', () => {
			wsInstance = null;
			// INFO reconnect after 3s - mirrors flushInterval cadence
			setTimeout(() => ensureWsConnected().catch(() => {}), 3000);
		}, { once: true });
	});
}

/**
* Health check - used to verify the backend is reachable.
*/
export async function fetchPing(): Promise<boolean> {
	const { pingEndpoint, apiKey } = getConfig();

	if (!pingEndpoint) {
		return true;
	}

	try {
		const res = await fetch(
			pingEndpoint,
			{
				headers: apiKey ? { 'X-Tracker-Key': apiKey } : {}
			}
		);
		return res.ok;
	} catch {
		return false;
	}
}

/**
* Downloads events from the backend for the requested time window.
*
* @remarks
* The `since` and `until` parameters are always sent to the backend so it can
* return only the events that fall within the selected time range. All further
* filtering (type, level, userId, full-text search) and all aggregations are
* performed client-side on the returned dataset.
*
* @param since - ISO 8601 UTC lower bound (inclusive). Maps to `EventsQuery.since`.
* @param until - ISO 8601 UTC upper bound (inclusive). Maps to `EventsQuery.until`.
*/
export async function fetchAllEvents(since: string, until: string): Promise<TrackerEvent[]> {
	const config = getConfig();

	if (config.wsEndpoint) {
		const ws = await ensureWsConnected();
		return new Promise((resolve, reject) => {
			const reqId = Math.random().toString(36).slice(2);
			const handler = (e: MessageEvent) => {
				try {
					const msg = JSON.parse(e.data) as { type: string; reqId?: string; response?: EventsResponse };
					if (msg.type === 'events:response' && msg.reqId === reqId) {
						ws.removeEventListener('message', handler);
						resolve(msg.response?.events ?? []);
					}
				} catch { /* ignore */ }
			};
			ws.addEventListener('message', handler);
			ws.send(JSON.stringify({ type: 'events:query', reqId, query: { since, until } }));
			setTimeout(() => {
				ws.removeEventListener('message', handler);
				reject(new Error('[vite-plugin-monitor] WebSocket query timeout'));
			}, 5000);
		});
	}

	const { readEndpoint, apiKey } = config;
	const url = new URL(readEndpoint);
	url.searchParams.set('since', since);
	url.searchParams.set('until', until);

	const headers: Record<string, string> = { 'Accept': 'application/json' };
	if (apiKey) headers['X-Tracker-Key'] = apiKey;

	const res = await fetch(url.toString(), { headers });
	if (!res.ok) {
		throw new Error(`[vite-plugin-monitor] API ${res.status} ${res.statusText}`);
	}
	const data = await res.json() as EventsResponse;
	return data.events ?? [];
}
