import { EventsResponse, TrackerEvent } from "@tracker/types";

function getConfig() {
	const cfg = window.__TRACKER_CONFIG__;
	if (!cfg) {
		throw new Error('[dashboard] __TRACKER_CONFIG__ not found on window');
	}
	return cfg;
}

let wsInstance: WebSocket | null = null;

function getOrOpenWs(onEvents: (events: TrackerEvent[]) => void): WebSocket | null {
	const { wsEndpoint, apiKey } = getConfig();
	if (!wsEndpoint) {
		return null;
	}
	if (wsInstance && wsInstance.readyState === WebSocket.OPEN) {
		return wsInstance;
	}

	const ws = new WebSocket(wsEndpoint);
	wsInstance = ws;

	ws.addEventListener('message', (e) => {
		try {
			const msg = JSON.parse(e.data) as { type: string; events?: TrackerEvent[] };
			if (msg.type === 'push' && Array.isArray(msg.events)) {
				onEvents(msg.events);
			}
		} catch { /* ignore malformed */ }
	});

	ws.addEventListener('close', () => {
		wsInstance = null;
		// INFO reconnect dopo 3s
		setTimeout(() => getOrOpenWs(onEvents), 3000);
	});

	return ws;
}

async function apiFetch<T>(params: Record<string, string | number | undefined> = {}): Promise<T> {
	const { readEndpoint, apiKey } = getConfig();

	const url = new URL(readEndpoint);

	for (const [k, v] of Object.entries(params)) {
		if (v !== undefined && v !== null && v !== '') {
			url.searchParams.set(k, String(v));
		}
	}

	const headers: Record<string, string> = {
		'Accept': 'application/json',
	};
	if (apiKey) {
		headers['X-Tracker-Key'] = apiKey;
	}

	const res = await fetch(url.toString(), { headers });

	if (!res.ok) {
		throw new Error(`[vite-plugin-monitor] API ${res.status} ${res.statusText}`);
	}

	return res.json() as Promise<T>;
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
* Downloads all events from the backend without any filters.
*
* @remarks
* The backend is responsible for returning the entire collection of available events,
* without applying any filters. All the filtering, temporal grouping, and aggregation logic occurs
* client-side in the browser after receiving the complete dataset.
*
* The call does not send any query parameters. The backend must
* respond with all the events it has available in its buffer
* or database, sorted from newest to oldest.
*/
export async function fetchAllEvents(): Promise<TrackerEvent[]> {
	const config = getConfig();

	if (config.wsEndpoint) {
		return new Promise((resolve, reject) => {
			const ws = wsInstance;
			if (!ws || ws.readyState !== WebSocket.OPEN) {
				reject(new Error('[vite-plugin-monitor] WebSocket not connected'));
				return;
			}
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
			ws.send(JSON.stringify({ type: 'events:query', reqId, query: {} }));
			setTimeout(() => {
				ws.removeEventListener('message', handler);
				reject(new Error('[vite-plugin-monitor] WebSocket query timeout'));
			}, 5000);
		});
	}

	const { readEndpoint, apiKey } = config;
	const headers: Record<string, string> = { 'Accept': 'application/json' };
	if (apiKey) headers['X-Tracker-Key'] = apiKey;

	const res = await fetch(readEndpoint, { headers });
	if (!res.ok) {
		throw new Error(`[vite-plugin-monitor] API ${res.status} ${res.statusText}`);
	}
	const data = await res.json() as EventsResponse;
	return data.events ?? [];
}
