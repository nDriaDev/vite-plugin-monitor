import { describe, it, expect, vi } from 'vitest';
import { createRequestHandler, createMiddleware } from '../../src/plugin/server';
import { resolveOptions } from '../../src/plugin/config';
import type { ResolvedTrackerOptions, TrackerEvent } from '../../src/types';
import { IncomingMessage, ServerResponse } from 'node:http';
import { EventEmitter } from 'node:events';
import { Connect } from 'vite';

function makeOpts(overrides: Partial<Parameters<typeof resolveOptions>[0]> = {}): ResolvedTrackerOptions {
	const opts = resolveOptions({ appId: 'test-app', ...overrides });
	opts.storage.maxBufferSize = 100;
	return opts;
}

function makeLogger() {
	return {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		writeEvent: vi.fn(),
		destroy: vi.fn().mockResolvedValue(undefined),
		destroyForHmr: vi.fn(),
		startHydration: vi.fn(),
	}
}

function makeEvent(overrides: Partial<TrackerEvent> = {}): TrackerEvent {
	return {
		id: 'evt-test-id',
		type: 'console',
		level: 'info',
		timestamp: new Date().toISOString(),
		appId: 'test-app',
		sessionId: 'sess_abc',
		userId: 'anon_test',
		payload: { message: 'test' },
		meta: { userAgent: 'test', route: '/', viewport: '1920x1080', language: 'en' },
		...overrides,
	} as TrackerEvent;
}

function makeReqRes(opts: { method?: string, url?: string, body?: unknown, headers?: Record<string, string> }) {
	const req = new EventEmitter() as IncomingMessage & EventEmitter;
	req.method = opts.method ?? 'GET';
	req.url = opts.url ?? '/';
	req.headers = opts.headers ?? {};

	const resChunks: string[] = [];
	let statusCode = 200;
	let headers: Record<string, string> = {};

	const res = {
		writeHead: vi.fn((code: number, h: Record<string, string>) => {
			statusCode = code;
			headers = h;
		}),
		end: vi.fn((body: string) => {
			resChunks.push(body);
		}),
		getStatus: () => statusCode,
		getBody: () => JSON.parse(resChunks[0] ?? 'null'),
		getHeaders: () => headers
	} as unknown as ServerResponse & {
		getStatus: () => number
		getBody: () => unknown
		getHeaders: () => Record<string, string>
	};

	if (opts.body !== undefined) {
		Promise.resolve().then(() => {
			req.emit('data', JSON.stringify(opts.body));
			req.emit('end');
		});
	} else {
		Promise.resolve().then(() => req.emit('end'));
	}

	return { req, res }
}

describe('createRequestHandler()', () => {
	describe('OPTIONS preflight', () => {
		it('responds 200 for any OPTIONS request', async () => {
			const { req, res } = makeReqRes({ method: 'OPTIONS', url: '/_tracker/events' });
			const handler = createRequestHandler(makeOpts(), { push: vi.fn(), query: vi.fn(), all: vi.fn(), size: vi.fn() } as any, makeLogger());
			const handled = await handler(req, res);
			expect(handled).toBe(true);
			expect((res as any).writeHead).toHaveBeenCalledWith(200, expect.any(Object));
		});
	});

	describe('POST /_tracker/events', () => {
		it('ingests valid events and responds 200', async () => {
			const logger = makeLogger()
			const buffer = { push: vi.fn(), query: vi.fn(), all: vi.fn(), size: vi.fn().mockReturnValue(1) } as any
			const handler = createRequestHandler(makeOpts(), buffer, logger);
			const events = [makeEvent()];
			const { req, res } = makeReqRes({ method: 'POST', url: '/_tracker/events', body: { type: "ingest", events } });

			const handled = await handler(req, res);
			expect(handled).toBe(true);
			expect(buffer.push).toHaveBeenCalledWith(events);
			expect(logger.writeEvent).toHaveBeenCalledWith(events[0]);
			expect((res as any).getBody()).toMatchObject({ ok: true, saved: 1 });
		});

		it('assigns a UUID id to events that arrive without one', async () => {
			const logger = makeLogger();
			const buffer = { push: vi.fn(), query: vi.fn(), all: vi.fn(), size: vi.fn().mockReturnValue(1) } as any;
			const handler = createRequestHandler(makeOpts(), buffer, logger);
			const eventWithoutId = { ...makeEvent(), id: undefined } as unknown as TrackerEvent;
			const { req, res } = makeReqRes({ method: 'POST', url: '/_tracker/events', body: { type: "ingest", events: [eventWithoutId] } });

			await handler(req, res);
			const pushedEvents: TrackerEvent[] = buffer.push.mock.calls[0][0];
			expect(pushedEvents[0].id).toBeDefined();
			expect(typeof pushedEvents[0].id).toBe('string');
			expect(pushedEvents[0].id!.length).toBeGreaterThan(0);
		});

		it('preserves existing id when event already has one', async () => {
			const logger = makeLogger();
			const buffer = { push: vi.fn(), query: vi.fn(), all: vi.fn(), size: vi.fn().mockReturnValue(1) } as any;
			const handler = createRequestHandler(makeOpts(), buffer, logger);
			const existingId = 'already-set-id';
			const event = makeEvent({ id: existingId });
			const { req, res } = makeReqRes({ method: 'POST', url: '/_tracker/events', body: { type: "ingest", events: [event] } });

			await handler(req, res);
			const pushedEvents: TrackerEvent[] = buffer.push.mock.calls[0][0];
			expect(pushedEvents[0].id).toBe(existingId);
		});

		it('responds 400 when the body is malformed JSON', async () => {
			const handler = createRequestHandler(makeOpts(), { push: vi.fn(), query: vi.fn(), all: vi.fn(), size: vi.fn() } as any, makeLogger());
			const req = new EventEmitter() as IncomingMessage;
			req.method = 'POST';
			req.url = '/_tracker/events';
			req.headers = {};

			const res = {
				writeHead: vi.fn(),
				end: vi.fn(),
				getBody: () => JSON.parse((res.end as any).mock.calls[0]?.[0] ?? 'null')
			} as unknown as ServerResponse & { getBody: () => unknown };

			Promise.resolve().then(() => {
				req.emit('data', '{invalid json');
				req.emit('end');
			});

			await handler(req, res);
			expect((res as any).writeHead).toHaveBeenCalledWith(400, expect.any(Object));
		});

		it('does not call push when events is an empty array', async () => {
			const buffer = { push: vi.fn(), query: vi.fn(), all: vi.fn(), size: vi.fn().mockReturnValue(0) } as any;
			const handler = createRequestHandler(makeOpts(), buffer, makeLogger());
			const { req, res } = makeReqRes({ method: 'POST', url: '/_tracker/events', body: { events: [] } });
			await handler(req, res);
			expect(buffer.push).not.toHaveBeenCalled();
		});

		it('responds 200 also with events: [] (no error)', async () => {
			const handler = createRequestHandler(makeOpts(), { push: vi.fn(), query: vi.fn(), all: vi.fn(), size: vi.fn().mockReturnValue(0) } as any, makeLogger());
			const { req, res } = makeReqRes({ method: 'POST', url: '/_tracker/events', body: { events: [] } });
			await handler(req, res);
			expect((res as any).writeHead).toHaveBeenCalledWith(200, expect.any(Object));
		});
	});

	describe('GET /_tracker', () => {
		it('responds 200 with the event list', async () => {
			const ev = makeEvent();
			const buffer = {
				push: vi.fn(),
				query: vi.fn().mockReturnValue({ events: [ev], total: 1 }),
				all: vi.fn(),
				size: vi.fn().mockReturnValue(1)
			} as any;
			const handler = createRequestHandler(makeOpts(), buffer, makeLogger());
			const { req, res } = makeReqRes({ method: 'GET', url: '/_tracker' });
			await handler(req, res);
			const body = (res as any).getBody() as { events: TrackerEvent[]; total: number };
			expect(body.events).toHaveLength(1);
			expect(body.total).toBe(1);
		});

		it('passes the since/until/after/limit/page parameters to the query', async () => {
			const buffer = {
				push: vi.fn(),
				query: vi.fn().mockReturnValue({ events: [], total: 0 }),
				all: vi.fn(),
				size: vi.fn().mockReturnValue(0)
			} as any;
			const handler = createRequestHandler(makeOpts(), buffer, makeLogger());
			const { req, res } = makeReqRes({
				method: 'GET',
				url: '/_tracker?since=2024-01-01&until=2024-12-31&limit=10&page=2'
			});
			await handler(req, res);
			expect(buffer.query).toHaveBeenCalledWith(
				expect.objectContaining({ since: '2024-01-01', until: '2024-12-31', limit: 10, page: 2 })
			);
		});

		it('nextCursor is the timestamp of the last returned event', async () => {
			const ev = makeEvent({ timestamp: '2024-06-01T00:00:00.000Z' });
			const buffer = {
				push: vi.fn(),
				query: vi.fn().mockReturnValue({ events: [ev], total: 1 }),
				all: vi.fn(),
				size: vi.fn().mockReturnValue(1)
			} as any;
			const handler = createRequestHandler(makeOpts(), buffer, makeLogger());
			const { req, res } = makeReqRes({ method: 'GET', url: '/_tracker' });
			await handler(req, res);
			expect((res as any).getBody()).toMatchObject({ nextCursor: ev.timestamp });
		});

		it('nextCursor is undefined when no events are returned', async () => {
			const buffer = {
				push: vi.fn(),
				query: vi.fn().mockReturnValue({ events: [], total: 0 }),
				all: vi.fn(),
				size: vi.fn().mockReturnValue(0)
			} as any;
			const handler = createRequestHandler(makeOpts(), buffer, makeLogger());
			const { req, res } = makeReqRes({ method: 'GET', url: '/_tracker' });
			await handler(req, res);
			expect((res as any).getBody()).not.toHaveProperty('nextCursor');
		});
	});

	describe('GET /_tracker/ping', () => {
		it('responds { ok: true, appId, mode } for ping', async () => {
			const opts = makeOpts();
			const handler = createRequestHandler(opts, { push: vi.fn(), query: vi.fn(), all: vi.fn(), size: vi.fn() } as any, makeLogger());
			const { req, res } = makeReqRes({ method: 'GET', url: '/_tracker/ping' });
			const handled = await handler(req, res);
			expect(handled).toBe(true);
			const body = (res as any).getBody() as { ok: boolean; appId: string }
			expect(body.ok).toBe(true);
			expect(body.appId).toBe('test-app');
		});
	});

	describe('unhandled routes', () => {
		it('returns false for unrecognized URL', async () => {
			const handler = createRequestHandler(makeOpts(), { push: vi.fn(), query: vi.fn(), all: vi.fn(), size: vi.fn() } as any, makeLogger());
			const { req, res } = makeReqRes({ method: 'GET', url: '/unknown' });
			const handled = await handler(req, res);
			expect(handled).toBe(false);
		});
	});

	describe('authentication via apiKey', () => {
		it('without apiKey every request is allowed', async () => {
			const opts = makeOpts();
			opts.storage.apiKey = '';
			const buffer = { push: vi.fn(), query: vi.fn().mockReturnValue({ events: [], total: 0 }), all: vi.fn(), size: vi.fn().mockReturnValue(0) } as any
			const handler = createRequestHandler(opts, buffer, makeLogger());
			const { req, res } = makeReqRes({ method: 'GET', url: '/_tracker' });
			await handler(req, res);
			expect((res as any).writeHead).toHaveBeenCalledWith(200, expect.any(Object));
		});

		it('with apiKey and correct header responds 200', async () => {
			const opts = makeOpts();
			opts.storage.apiKey = 'secret';
			const buffer = { push: vi.fn(), query: vi.fn().mockReturnValue({ events: [], total: 0 }), all: vi.fn(), size: vi.fn().mockReturnValue(0) } as any
			const handler = createRequestHandler(opts, buffer, makeLogger());
			const { req, res } = makeReqRes({
				method: 'GET',
				url: '/_tracker',
				headers: { 'x-tracker-key': 'secret' }
			});
			await handler(req, res);
			expect((res as any).writeHead).toHaveBeenCalledWith(200, expect.any(Object));
		});

		it('with apiKey and incorrect header responds 401', async () => {
			const opts = makeOpts();
			opts.storage.apiKey = 'secret';
			const handler = createRequestHandler(opts, { push: vi.fn(), query: vi.fn(), all: vi.fn(), size: vi.fn() } as any, makeLogger());
			const { req, res } = makeReqRes({
				method: 'GET',
				url: '/_tracker',
				headers: { 'x-tracker-key': 'wrong' }
			});
			await handler(req, res);
			expect((res as any).writeHead).toHaveBeenCalledWith(401, expect.any(Object));
		});

		it('with apiKey and missing header responds 401', async () => {
			const opts = makeOpts();
			opts.storage.apiKey = 'secret';
			const handler = createRequestHandler(opts, { push: vi.fn(), query: vi.fn(), all: vi.fn(), size: vi.fn() } as any, makeLogger());
			const { req, res } = makeReqRes({ method: 'POST', url: '/_tracker/events' });
			await handler(req, res);
			expect((res as any).writeHead).toHaveBeenCalledWith(401, expect.any(Object));
		});
	});

	describe('CORS headers', () => {
		it('the response includes Access-Control-Allow-Origin: *', async () => {
			const buffer = { push: vi.fn(), query: vi.fn().mockReturnValue({ events: [], total: 0 }), all: vi.fn(), size: vi.fn().mockReturnValue(0) } as any
			const handler = createRequestHandler(makeOpts(), buffer, makeLogger());
			const { req, res } = makeReqRes({ method: 'GET', url: '/_tracker/ping' });
			await handler(req, res);
			expect((res as any).getHeaders()['Access-Control-Allow-Origin']).toBe('*');
		});
	});
});

describe('createMiddleware()', () => {
	it('calls next() for URLs that do not start with /_tracker', async () => {
		const middleware = createMiddleware(makeOpts(), makeLogger()) as Connect.NextHandleFunction;
		const next = vi.fn();
		const { req, res } = makeReqRes({ method: 'GET', url: '/app/page' });
		await middleware(req, res, next);
		expect(next).toHaveBeenCalledOnce();
	});

	it('handles /_tracker/ping without calling next()', async () => {
		const middleware = createMiddleware(makeOpts(), makeLogger()) as Connect.NextHandleFunction;
		const next = vi.fn();
		const { req, res } = makeReqRes({ method: 'GET', url: '/_tracker/ping' });
		await middleware(req, res, next);
		expect(next).not.toHaveBeenCalled();
		expect((res as any).writeHead).toHaveBeenCalledWith(200, expect.any(Object));
	});

	it('handles POST /_tracker/events with valid events', async () => {
		const middleware = createMiddleware(makeOpts(), makeLogger()) as Connect.NextHandleFunction;
		const next = vi.fn();
		const events = [makeEvent()];
		const { req, res } = makeReqRes({ method: 'POST', url: '/_tracker/events', body: { events } });
		await middleware(req, res, next);
		expect(next).not.toHaveBeenCalled();
		expect((res as any).writeHead).toHaveBeenCalledWith(200, expect.any(Object));
	});

	it('calls next() for unhandled /_tracker routes', async () => {
		const middleware = createMiddleware(makeOpts(), makeLogger()) as Connect.NextHandleFunction;
		const next = vi.fn();
		const { req, res } = makeReqRes({ method: 'GET', url: '/_tracker/unknown-route' });
		await middleware(req, res, next);
		expect(next).toHaveBeenCalledOnce();
	});
});

vi.mock('node:fs', async (importOriginal) => {
	const actual = await importOriginal<typeof import('node:fs')>();
	return {
		...actual,
		existsSync: vi.fn((...a: any[]) => (actual.existsSync as any)(...a)),
		readdirSync: vi.fn((...a: any[]) => (actual.readdirSync as any)(...a)),
		readFileSync: vi.fn((...a: any[]) => (actual.readFileSync as any)(...a)),
	};
});

describe('RingBuffer (via createMiddleware)', () => {
	it('truncates the buffer when maxBufferSize is exceeded', async () => {
		const opts = makeOpts();
		opts.storage.maxBufferSize = 2;
		const mw = createMiddleware(opts, makeLogger()) as Connect.NextHandleFunction;
		const next = vi.fn();

		const events = [
			makeEvent({ timestamp: '2024-01-01T00:00:00.000Z' }),
			makeEvent({ timestamp: '2024-01-02T00:00:00.000Z' }),
			makeEvent({ timestamp: '2024-01-03T00:00:00.000Z' }),
		];
		const { req: r1, res: s1 } = makeReqRes({ method: 'POST', url: '/_tracker/events', body: { events } });
		await mw(r1, s1, next);

		const { req: r2, res: s2 } = makeReqRes({ method: 'GET', url: '/_tracker?limit=100&page=1' });
		await mw(r2, s2, next);

		const body = (s2 as any).getBody() as { events: TrackerEvent[]; total: number };
		expect(body.total).toBe(2);
		expect(body.events[0].timestamp).toBe('2024-01-03T00:00:00.000Z');
		expect(body.events[1].timestamp).toBe('2024-01-02T00:00:00.000Z');
	});

	it('returns events from most recent to least recent', async () => {
		const mw = createMiddleware(makeOpts(), makeLogger()) as Connect.NextHandleFunction;
		const next = vi.fn();

		const events = [
			makeEvent({ timestamp: '2024-01-01T00:00:00.000Z' }),
			makeEvent({ timestamp: '2024-06-01T00:00:00.000Z' }),
		];
		const { req: r1, res: s1 } = makeReqRes({ method: 'POST', url: '/_tracker/events', body: { events } });
		await mw(r1, s1, next);

		const { req: r2, res: s2 } = makeReqRes({ method: 'GET', url: '/_tracker?limit=100&page=1' });
		await mw(r2, s2, next);

		const body = (s2 as any).getBody() as { events: TrackerEvent[] };
		expect(body.events[0].timestamp).toBe('2024-06-01T00:00:00.000Z');
		expect(body.events[1].timestamp).toBe('2024-01-01T00:00:00.000Z');
	});

	it('filters events via since', async () => {
		const mw = createMiddleware(makeOpts(), makeLogger()) as Connect.NextHandleFunction;
		const next = vi.fn();

		const events = [
			makeEvent({ timestamp: '2024-01-01T00:00:00.000Z' }),
			makeEvent({ timestamp: '2024-06-01T00:00:00.000Z' }),
		];
		const { req: r1, res: s1 } = makeReqRes({ method: 'POST', url: '/_tracker/events', body: { events } });
		await mw(r1, s1, next);

		const { req: r2, res: s2 } = makeReqRes({
			method: 'GET',
			url: '/_tracker?since=2024-03-01T00:00:00.000Z&limit=100&page=1',
		});
		await mw(r2, s2, next);

		const body = (s2 as any).getBody() as { events: TrackerEvent[]; total: number };
		expect(body.total).toBe(1);
		expect(body.events[0].timestamp).toBe('2024-06-01T00:00:00.000Z');
	});

	it('filters events via until', async () => {
		const mw = createMiddleware(makeOpts(), makeLogger()) as Connect.NextHandleFunction;
		const next = vi.fn();

		const events = [
			makeEvent({ timestamp: '2024-01-01T00:00:00.000Z' }),
			makeEvent({ timestamp: '2024-12-01T00:00:00.000Z' }),
		];
		const { req: r1, res: s1 } = makeReqRes({ method: 'POST', url: '/_tracker/events', body: { events } });
		await mw(r1, s1, next);

		const { req: r2, res: s2 } = makeReqRes({
			method: 'GET',
			url: '/_tracker?until=2024-06-01T00:00:00.000Z&limit=100&page=1',
		});
		await mw(r2, s2, next);

		const body = (s2 as any).getBody() as { events: TrackerEvent[]; total: number };
		expect(body.total).toBe(1);
		expect(body.events[0].timestamp).toBe('2024-01-01T00:00:00.000Z');
	});

	it('filters events via after (cursor)', async () => {
		const mw = createMiddleware(makeOpts(), makeLogger()) as Connect.NextHandleFunction;
		const next = vi.fn();

		const events = [
			makeEvent({ timestamp: '2024-01-01T00:00:00.000Z' }),
			makeEvent({ timestamp: '2024-06-01T00:00:00.000Z' }),
			makeEvent({ timestamp: '2024-12-01T00:00:00.000Z' }),
		];
		const { req: r1, res: s1 } = makeReqRes({ method: 'POST', url: '/_tracker/events', body: { events } });
		await mw(r1, s1, next);

		const { req: r2, res: s2 } = makeReqRes({
			method: 'GET',
			url: '/_tracker?after=2024-06-01T00:00:00.000Z&limit=100&page=1',
		});
		await mw(r2, s2, next);

		const body = (s2 as any).getBody() as { events: TrackerEvent[]; total: number };
		expect(body.total).toBe(1);
		expect(body.events[0].timestamp).toBe('2024-12-01T00:00:00.000Z');
	});

	it('respects pagination with limit and page', async () => {
		const mw = createMiddleware(makeOpts(), makeLogger()) as Connect.NextHandleFunction;
		const next = vi.fn();

		const events = [
			makeEvent({ timestamp: '2024-01-01T00:00:00.000Z' }),
			makeEvent({ timestamp: '2024-02-01T00:00:00.000Z' }),
			makeEvent({ timestamp: '2024-03-01T00:00:00.000Z' }),
		];
		const { req: r1, res: s1 } = makeReqRes({ method: 'POST', url: '/_tracker/events', body: { events } });
		await mw(r1, s1, next);

		const { req: r2, res: s2 } = makeReqRes({ method: 'GET', url: '/_tracker?limit=2&page=1' });
		await mw(r2, s2, next);
		const body1 = (s2 as any).getBody() as { events: TrackerEvent[]; total: number };
		expect(body1.total).toBe(3);
		expect(body1.events).toHaveLength(2);
		expect(body1.events[0].timestamp).toBe('2024-03-01T00:00:00.000Z');

		const { req: r3, res: s3 } = makeReqRes({ method: 'GET', url: '/_tracker?limit=2&page=2' });
		await mw(r3, s3, next);
		const body2 = (s3 as any).getBody() as { events: TrackerEvent[]; total: number };
		expect(body2.total).toBe(3);
		expect(body2.events).toHaveLength(1);
		expect(body2.events[0].timestamp).toBe('2024-01-01T00:00:00.000Z');
	});
});

describe('hydration via logger.startHydration() (createMiddleware)', () => {
	it('calls logger.startHydration() when the middleware is created', () => {
		const logger = makeLogger();
		createMiddleware(makeOpts(), logger);
		expect(logger.startHydration).toHaveBeenCalledOnce();
	});

	it('passes onBatch and onDone callbacks to startHydration', () => {
		const logger = makeLogger();
		createMiddleware(makeOpts(), logger);
		const [onBatch, onDone] = logger.startHydration.mock.calls[0];
		expect(typeof onBatch).toBe('function');
		expect(typeof onDone).toBe('function');
	});

	it('onBatch pushes events into the buffer (visible in subsequent GET)', async () => {
		const logger = makeLogger();
		const mw = createMiddleware(makeOpts(), logger) as Connect.NextHandleFunction;
		const next = vi.fn();

		const [onBatch] = logger.startHydration.mock.calls[0];
		const ev = makeEvent({ timestamp: '2024-01-01T00:00:00.000Z' });
		onBatch([ev]);

		const { req, res } = makeReqRes({ method: 'GET', url: '/_tracker?limit=100&page=1' });
		await mw(req, res, next);

		expect((res as any).getBody().total).toBe(1);
	});

	it('onDone logs info when events were loaded', () => {
		const logger = makeLogger();
		createMiddleware(makeOpts(), logger);
		const [, onDone] = logger.startHydration.mock.calls[0];
		onDone({ loaded: 42, skippedMalformed: 0, skippedInvalid: 0, limitReached: false });
		expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('42'));
	});

	it('onDone logs warning when skippedMalformed > 0', () => {
		const logger = makeLogger();
		createMiddleware(makeOpts(), logger);
		const [, onDone] = logger.startHydration.mock.calls[0];
		onDone({ loaded: 0, skippedMalformed: 3, skippedInvalid: 0, limitReached: false });
		expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('malformed'));
	});

	it('onDone logs warning when skippedInvalid > 0', () => {
		const logger = makeLogger();
		createMiddleware(makeOpts(), logger);
		const [, onDone] = logger.startHydration.mock.calls[0];
		onDone({ loaded: 0, skippedMalformed: 0, skippedInvalid: 2, limitReached: false });
		expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('invalid'));
	});

	it('onDone logs warning when limitReached is true', () => {
		const logger = makeLogger();
		createMiddleware(makeOpts(), logger);
		const [, onDone] = logger.startHydration.mock.calls[0];
		onDone({ loaded: 0, skippedMalformed: 0, skippedInvalid: 0, limitReached: true });
		expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('limit'));
	});

	it('onDone does not log info when loaded is 0', () => {
		const logger = makeLogger();
		createMiddleware(makeOpts(), logger);
		const [, onDone] = logger.startHydration.mock.calls[0];
		onDone({ loaded: 0, skippedMalformed: 0, skippedInvalid: 0, limitReached: false });
		expect(logger.info).not.toHaveBeenCalledWith(expect.stringContaining('Hydrated'));
	});
});
