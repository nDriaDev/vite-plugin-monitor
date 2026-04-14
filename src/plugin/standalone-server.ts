import type { EventsResponse, Logger, ResolvedTrackerOptions, TrackerEvent } from "@tracker/types";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Connect } from "vite";
import { createServer } from "node:http";
import { version } from '../../package.json';
import { WebSocketServer } from "ws";

/**
* Ring buffer
* Implemented as a true circular buffer with a head pointer so that
* push() is O(1) regardless of capacity
*
* @remarks
* Keeps the last N events in memory for fast dashboard queries.
* Backed by the log files for persistence across restarts.
* Capacity is controlled by {@link HttpStorageOptions.maxBufferSize}.
*/
class RingBuffer {
	private buf: (TrackerEvent | undefined)[];
	private head = 0;    // INFO index of the oldest slot (next to be overwritten)
	private count = 0;   // INFO number of valid entries currently stored
	private readonly cap: number;

	constructor(maxSize: number) {
		this.cap = maxSize;
		this.buf = new Array(maxSize);
	}

	push(events: TrackerEvent[]) {
		for (const e of events) {
			this.buf[this.head] = e;
			this.head = (this.head + 1) % this.cap;
			if (this.count < this.cap) this.count++;
		}
	}

	private toArray(): TrackerEvent[] {
		if (this.count < this.cap) {
			return this.buf.slice(0, this.count) as TrackerEvent[];
		}
		// INFO head linked to the next slot to write = the oldest
		return [
			...this.buf.slice(this.head) as TrackerEvent[],
			...this.buf.slice(0, this.head) as TrackerEvent[],
		];
	}

	/**
	 * Query the ring buffer with optional time-range filters and pagination.
	 *
	 * @remarks
	 * Server-side filtering is intentionally minimal: only `since`, `until`,
	 * and `after` (cursor) are applied here. All other filtering (type, level,
	 * userId, search, etc.) is performed client-side in the dashboard so that
	 * the full time-windowed dataset is always available for instant re-filtering
	 * without round-trips.
	 */
	query(filters: { since?: string; until?: string; after?: string; limit: number; page: number }): { events: TrackerEvent[]; total: number } {
		let result = this.toArray();

		if (filters.since) {
			result = result.filter(e => e.timestamp >= filters.since!);
		}
		if (filters.until) {
			result = result.filter(e => e.timestamp <= filters.until!);
		}
		if (filters.after) {
			result = result.filter(e => e.timestamp > filters.after!);
		}
		// INFO newest first
		result = result.reverse();

		const total = result.length;
		const start = (filters.page - 1) * filters.limit;
		return {
			events: result.slice(start, start + filters.limit),
			total,
		}
	}

	size(): number {
		return this.count;
	}
}

function parseBody(req: IncomingMessage): Promise<string> {
	return new Promise((resolve, reject) => {
		let body = '';
		req.on('data', chunk => { body += chunk });
		req.on('end', () => resolve(body));
		req.on('error', reject);
	});
}

function parseQs(url: string): Record<string, string> {
	const qs = url.includes('?') ? url.split('?')[1] : '';
	return Object.fromEntries(new URLSearchParams(qs));
}

function json(res: ServerResponse, status: number, data: unknown) {
	const body = JSON.stringify(data);
	res.writeHead(status, {
		'Content-Type': 'application/json',
		'Access-Control-Allow-Origin': '*',
		'Access-Control-Allow-Headers': 'Content-Type, X-Tracker-Key',
		'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
	});
	res.end(body);
}

export function createRequestHandler(opts: ResolvedTrackerOptions, buffer: RingBuffer, logger: Logger) {
	const apiKey = opts.storage.apiKey;

	function checkAuth(req: IncomingMessage, res: ServerResponse): boolean {
		if (!apiKey) {
			return true;
		}
		if (req.headers['x-tracker-key'] !== apiKey) {
			json(res, 401, { error: 'Unauthorized' });
			return false;
		}
		return true;
	}

	return async function handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
		const url = req.url ?? '/';
		const method = req.method ?? 'GET';
		const base = `/_tracker`;

		if (method === 'OPTIONS') {
			json(res, 204, {});
			return true;
		}

		if (method === 'POST' && url.startsWith(`${base}/events`)) {
			if (!checkAuth(req, res)) {
				return true;
			}
			try {
				const body = await parseBody(req);
				const { events } = JSON.parse(body) as { events: TrackerEvent[] };
				if (Array.isArray(events) && events.length) {
					buffer.push(events);
					events.forEach(e => logger.writeEvent(e));
					logger.debug(`Ingested ${events.length} events (buffer: ${buffer.size()})`);
				}
				json(res, 200, { ok: true, saved: events?.length ?? 0 });
			} catch (err) {
				json(res, 400, { error: String(err) });
			}
			return true;
		}

		if (method === 'GET' && url === `${base}/ping`) {
			json(res, 200, { ok: true, appId: opts.appId, mode: opts.storage.mode, version });
			return true;
		}

		if (method === 'GET' && url.split("?")[0] === base) {
			if (!checkAuth(req, res)) {
				return true;
			}
			const qs = parseQs(url);
			const limit = qs['limit'] ? parseInt(qs['limit'], 10) : buffer.size();
			const page = Math.max(parseInt(qs['page'] ?? '1', 10), 1);
			const { events, total } = buffer.query({
				since: qs['since'],
				until: qs['until'],
				after: qs['after'],
				limit,
				page,
			});
			const nextCursor = events.length > 0 ? events[0].timestamp : undefined;
			const response: EventsResponse = {
				events,
				total,
				page,
				limit,
				nextCursor
			}
			json(res, 200, response);
			return true;
		}

		return false;  // INFO not handled - let Vite continue
	}
}

export function createStandaloneServer(opts: ResolvedTrackerOptions, logger: Logger): { start: () => void; stop: () => void } {
	const buffer = new RingBuffer(opts.storage.maxBufferSize);
	const handler = createRequestHandler(opts, buffer, logger);

	logger.startHydration(
		(events) => buffer.push(events),
		({ loaded, skippedMalformed, skippedInvalid, limitReached }) => {
			if (loaded > 0) {
				logger.info(`Hydrated ${loaded} events from log files`);
			}
			if (skippedMalformed > 0) {
				logger.warn(`Skipped ${skippedMalformed} malformed JSON lines`);
			}
			if (skippedInvalid > 0) {
				logger.warn(`Skipped ${skippedInvalid} structurally invalid events`);
			}
			if (limitReached) {
				logger.warn(`Hydration byte limit reached — oldest log files skipped`);
			}
		}
	);

	const server = createServer(async (req, res) => {
		const handled = await handler(req, res);
		if (!handled) {
			json(res, 404, { error: 'Not found' });
		}
	});

	const wss = new WebSocketServer({ server, path: '/_tracker/ws' });

	wss.on('connection', (ws) => {
		/**
		 * INFO  The browser WebSocket API does not support custom headers on the
		 * HTTP upgrade request, so apiKey authentication cannot use the
		 * `x-tracker-key` header here.  Instead, the client sends the key
		 * as the very first message after the connection is established
		 * (type: 'auth').  Until that handshake completes, every other
		 * message is rejected and the socket is closed with 1008.
		 */
		const apiKey = opts.storage.apiKey;
		let authenticated = !apiKey; // no key configured → always authenticated

		ws.on('message', (data) => {
			try {
				const msg = JSON.parse(data.toString()) as {
					type: string;
					key?: string;
					events?: TrackerEvent[];
					reqId?: string;
					query?: { since?: string; until?: string };
				};

				if (!authenticated) {
					if (msg.type === 'auth' && msg.key === apiKey) {
						authenticated = true;
						ws.send(JSON.stringify({ type: 'auth_ok' }));
					} else {
						ws.send(JSON.stringify({ type: 'error', message: 'Unauthorized' }));
						ws.close(1008, 'Unauthorized');
					}
					return;
				}

				if (msg.type === 'ingest' && Array.isArray(msg.events) && msg.events.length) {
					buffer.push(msg.events);
					msg.events.forEach(e => logger.writeEvent(e));
					logger.debug(`WebSocket: ingested ${msg.events.length} events`);
					ws.send(JSON.stringify({ type: 'ack', saved: msg.events.length }));
				}

				if (msg.type === 'events:query' && msg.reqId) {
					const since = msg.query?.since;
					const until = msg.query?.until;
					const { events, total } = buffer.query({
						since,
						until,
						limit: buffer.size(),
						page: 1,
					});
					ws.send(JSON.stringify({
						type: 'events:response',
						reqId: msg.reqId,
						response: { events, total, page: 1, limit: buffer.size() }
					}));
				}
			} catch {
				ws.send(JSON.stringify({ type: 'error', message: 'Invalid message' }));
			}
		});
	});

	return {
		start() {
			server.listen(opts.storage.port, () => {
				logger.info(`Standalone server listening on port ${opts.storage.port}`);
				logger.info(`WebSocket endpoint: ws://localhost:${opts.storage.port}/_tracker/ws`);
			});
			// eslint-disable-next-line no-undef
			server.on('error', (err: NodeJS.ErrnoException) => {
				if (err.code === 'EADDRINUSE') {
					logger.warn(`Port ${opts.storage.port} already in use - standalone server not started`);
				} else {
					logger.error(`Server error: ${err.message}`);
				}
			});
		},
		stop() {
			wss.close();
			server.close();
			logger.info('Standalone server stopped');
		}
	}
}

export function createMiddleware(opts: ResolvedTrackerOptions, logger: Logger): Connect.HandleFunction {
	const buffer = new RingBuffer(opts.storage.maxBufferSize);
	const handler = createRequestHandler(opts, buffer, logger);

	logger.startHydration(
		(events) => buffer.push(events),
		({ loaded, skippedMalformed, skippedInvalid, limitReached }) => {
			if (loaded > 0) {
				logger.info(`Hydrated ${loaded} events from log files`);
			}
			if (skippedMalformed > 0) {
				logger.warn(`Skipped ${skippedMalformed} malformed JSON lines`);
			}
			if (skippedInvalid > 0) {
				logger.warn(`Skipped ${skippedInvalid} structurally invalid events`);
			}
			if (limitReached) {
				logger.warn(`Hydration byte limit reached — oldest log files skipped`);
			}
		}
	);

	// eslint-disable-next-line @typescript-eslint/no-misused-promises
	return async function trackerMiddleware(req: IncomingMessage, res: ServerResponse, next: Connect.NextFunction) {
		if (!req.url?.startsWith('/_tracker')) {
			return next();
		}
		const handled = await handler(req, res);
		if (!handled) {
			next();
		}
	}
}
