import { describe, it, expect, vi } from 'vitest';
import { createRequestHandler, createMiddleware } from '../../src/plugin/standalone-server';
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
		destroy: vi.fn().mockResolvedValue(undefined)
	}
}

function makeEvent(overrides: Partial<TrackerEvent> = {}): TrackerEvent {
	return {
		type: 'console',
		level: 'info',
		timestamp: new Date().toISOString(),
		appId: 'test-app',
		sessionId: 'sess_abc',
		userId: null,
		payload: { message: 'test' },
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
		it('risponde 204 per qualsiasi richiesta OPTIONS', async () => {
			const { req, res } = makeReqRes({ method: 'OPTIONS', url: '/_tracker/events' });
			const handler = createRequestHandler(makeOpts(), { push: vi.fn(), query: vi.fn(), all: vi.fn(), size: vi.fn() } as any, makeLogger());
			const handled = await handler(req, res);
			expect(handled).toBe(true);
			expect((res as any).writeHead).toHaveBeenCalledWith(204, expect.any(Object));
		});
	});

	describe('POST /_tracker/events', () => {
		it('ingestisce eventi validi e risponde 200', async () => {
			const logger = makeLogger()
			const buffer = { push: vi.fn(), query: vi.fn(), all: vi.fn(), size: vi.fn().mockReturnValue(1) } as any
			const handler = createRequestHandler(makeOpts(), buffer, logger);
			const events = [makeEvent()];
			const { req, res } = makeReqRes({ method: 'POST', url: '/_tracker/events', body: { events } });

			const handled = await handler(req, res);
			expect(handled).toBe(true);
			expect(buffer.push).toHaveBeenCalledWith(events);
			expect(logger.writeEvent).toHaveBeenCalledWith(events[0]);
			expect((res as any).getBody()).toMatchObject({ ok: true, saved: 1 });
		});

		it('risponde 400 se il body è JSON malformato', async () => {
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

		it('non chiama push se events è array vuoto', async () => {
			const buffer = { push: vi.fn(), query: vi.fn(), all: vi.fn(), size: vi.fn().mockReturnValue(0) } as any;
			const handler = createRequestHandler(makeOpts(), buffer, makeLogger());
			const { req, res } = makeReqRes({ method: 'POST', url: '/_tracker/events', body: { events: [] } });
			await handler(req, res);
			expect(buffer.push).not.toHaveBeenCalled();
		});

		it('risponde 200 anche con events: [] (nessun errore)', async () => {
			const handler = createRequestHandler(makeOpts(), { push: vi.fn(), query: vi.fn(), all: vi.fn(), size: vi.fn().mockReturnValue(0) } as any, makeLogger());
			const { req, res } = makeReqRes({ method: 'POST', url: '/_tracker/events', body: { events: [] } });
			await handler(req, res);
			expect((res as any).writeHead).toHaveBeenCalledWith(200, expect.any(Object));
		});
	});

	describe('GET /_tracker/events', () => {
		it('risponde 200 con la lista degli eventi', async () => {
			const ev = makeEvent();
			const buffer = {
				push: vi.fn(),
				query: vi.fn().mockReturnValue({ events: [ev], total: 1 }),
				all: vi.fn(),
				size: vi.fn().mockReturnValue(1)
			} as any;
			const handler = createRequestHandler(makeOpts(), buffer, makeLogger());
			const { req, res } = makeReqRes({ method: 'GET', url: '/_tracker/events' });
			await handler(req, res);
			const body = (res as any).getBody() as { events: TrackerEvent[]; total: number };
			expect(body.events).toHaveLength(1);
			expect(body.total).toBe(1);
		});

		it('passa i parametri since/until/after/limit/page alla query', async () => {
			const buffer = {
				push: vi.fn(),
				query: vi.fn().mockReturnValue({ events: [], total: 0 }),
				all: vi.fn(),
				size: vi.fn().mockReturnValue(0)
			} as any;
			const handler = createRequestHandler(makeOpts(), buffer, makeLogger());
			const { req, res } = makeReqRes({
				method: 'GET',
				url: '/_tracker/events?since=2024-01-01&until=2024-12-31&limit=10&page=2'
			});
			await handler(req, res);
			expect(buffer.query).toHaveBeenCalledWith(
				expect.objectContaining({ since: '2024-01-01', until: '2024-12-31', limit: 10, page: 2 })
			);
		});

		it('nextCursor è il timestamp del primo evento restituito', async () => {
			const ev = makeEvent({ timestamp: '2024-06-01T00:00:00.000Z' });
			const buffer = {
				push: vi.fn(),
				query: vi.fn().mockReturnValue({ events: [ev], total: 1 }),
				all: vi.fn(),
				size: vi.fn().mockReturnValue(1)
			} as any;
			const handler = createRequestHandler(makeOpts(), buffer, makeLogger());
			const { req, res } = makeReqRes({ method: 'GET', url: '/_tracker/events' });
			await handler(req, res);
			expect((res as any).getBody()).toMatchObject({ nextCursor: ev.timestamp });
		});

		it('nextCursor è undefined se nessun evento restituito', async () => {
			const buffer = {
				push: vi.fn(),
				query: vi.fn().mockReturnValue({ events: [], total: 0 }),
				all: vi.fn(),
				size: vi.fn().mockReturnValue(0)
			} as any;
			const handler = createRequestHandler(makeOpts(), buffer, makeLogger());
			const { req, res } = makeReqRes({ method: 'GET', url: '/_tracker/events' });
			await handler(req, res);
			expect((res as any).getBody()).not.toHaveProperty('nextCursor');
		});
	});

	describe('GET /_tracker/ping', () => {
		it('risponde { ok: true, appId, mode } per ping', async () => {
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

	describe('rotte non gestite', () => {
		it('restituisce false per URL non riconosciuto', async () => {
			const handler = createRequestHandler(makeOpts(), { push: vi.fn(), query: vi.fn(), all: vi.fn(), size: vi.fn() } as any, makeLogger());
			const { req, res } = makeReqRes({ method: 'GET', url: '/unknown' });
			const handled = await handler(req, res);
			expect(handled).toBe(false);
		});
	});

	describe('autenticazione via apiKey', () => {
		it('senza apiKey ogni richiesta è consentita', async () => {
			const opts = makeOpts();
			opts.storage.apiKey = '';
			const buffer = { push: vi.fn(), query: vi.fn().mockReturnValue({ events: [], total: 0 }), all: vi.fn(), size: vi.fn().mockReturnValue(0) } as any
			const handler = createRequestHandler(opts, buffer, makeLogger());
			const { req, res } = makeReqRes({ method: 'GET', url: '/_tracker/events' });
			await handler(req, res);
			expect((res as any).writeHead).toHaveBeenCalledWith(200, expect.any(Object));
		});

		it('con apiKey e header corretto risponde 200', async () => {
			const opts = makeOpts();
			opts.storage.apiKey = 'secret';
			const buffer = { push: vi.fn(), query: vi.fn().mockReturnValue({ events: [], total: 0 }), all: vi.fn(), size: vi.fn().mockReturnValue(0) } as any
			const handler = createRequestHandler(opts, buffer, makeLogger());
			const { req, res } = makeReqRes({
				method: 'GET',
				url: '/_tracker/events',
				headers: { 'x-tracker-key': 'secret' }
			});
			await handler(req, res);
			expect((res as any).writeHead).toHaveBeenCalledWith(200, expect.any(Object));
		});

		it('con apiKey e header errato risponde 401', async () => {
			const opts = makeOpts();
			opts.storage.apiKey = 'secret';
			const handler = createRequestHandler(opts, { push: vi.fn(), query: vi.fn(), all: vi.fn(), size: vi.fn() } as any, makeLogger());
			const { req, res } = makeReqRes({
				method: 'GET',
				url: '/_tracker/events',
				headers: { 'x-tracker-key': 'wrong' }
			});
			await handler(req, res);
			expect((res as any).writeHead).toHaveBeenCalledWith(401, expect.any(Object));
		});

		it('con apiKey e header mancante risponde 401', async () => {
			const opts = makeOpts();
			opts.storage.apiKey = 'secret';
			const handler = createRequestHandler(opts, { push: vi.fn(), query: vi.fn(), all: vi.fn(), size: vi.fn() } as any, makeLogger());
			const { req, res } = makeReqRes({ method: 'POST', url: '/_tracker/events' });
			await handler(req, res);
			expect((res as any).writeHead).toHaveBeenCalledWith(401, expect.any(Object));
		});
	});

	describe('CORS headers', () => {
		it('la risposta include Access-Control-Allow-Origin: *', async () => {
			const buffer = { push: vi.fn(), query: vi.fn().mockReturnValue({ events: [], total: 0 }), all: vi.fn(), size: vi.fn().mockReturnValue(0) } as any
			const handler = createRequestHandler(makeOpts(), buffer, makeLogger());
			const { req, res } = makeReqRes({ method: 'GET', url: '/_tracker/ping' });
			await handler(req, res);
			expect((res as any).getHeaders()['Access-Control-Allow-Origin']).toBe('*');
		});
	});

});

describe('createMiddleware()', () => {
	it('chiama next() per URL che non iniziano con /_tracker', async () => {
		const middleware = createMiddleware(makeOpts(), makeLogger()) as Connect.NextHandleFunction;
		const next = vi.fn();
		const { req, res } = makeReqRes({ method: 'GET', url: '/app/page' });
		await middleware(req, res, next);
		expect(next).toHaveBeenCalledOnce();
	});

	it('gestisce /_tracker/ping senza chiamare next()', async () => {
		const middleware = createMiddleware(makeOpts(), makeLogger()) as Connect.NextHandleFunction;
		const next = vi.fn();
		const { req, res } = makeReqRes({ method: 'GET', url: '/_tracker/ping' });
		await middleware(req, res, next);
		expect(next).not.toHaveBeenCalled();
		expect((res as any).writeHead).toHaveBeenCalledWith(200, expect.any(Object));
	});

	it('gestisce POST /_tracker/events con eventi validi', async () => {
		const middleware = createMiddleware(makeOpts(), makeLogger()) as Connect.NextHandleFunction;
		const next = vi.fn();
		const events = [makeEvent()];
		const { req, res } = makeReqRes({ method: 'POST', url: '/_tracker/events', body: { events } });
		await middleware(req, res, next);
		expect(next).not.toHaveBeenCalled();
		expect((res as any).writeHead).toHaveBeenCalledWith(200, expect.any(Object));
	});

	it('chiama next() per rotte /_tracker non gestite', async () => {
		const middleware = createMiddleware(makeOpts(), makeLogger()) as Connect.NextHandleFunction;
		const next = vi.fn();
		const { req, res } = makeReqRes({ method: 'GET', url: '/_tracker/unknown-route' });
		await middleware(req, res, next);
		expect(next).toHaveBeenCalledOnce();
	});
});
// ============================================================
// AGGIUNTE al file standalone-server.test.ts esistente
//
// Aggiungere in cima al file esistente:
//
//   import { existsSync, readdirSync, readFileSync } from 'node:fs';
//
//   vi.mock('node:fs', async (importOriginal) => {
//     const actual = await importOriginal<typeof import('node:fs')>();
//     return {
//       ...actual,
//       existsSync:   vi.fn((...a: any[]) => (actual.existsSync   as any)(...a)),
//       readdirSync:  vi.fn((...a: any[]) => (actual.readdirSync  as any)(...a)),
//       readFileSync: vi.fn((...a: any[]) => (actual.readFileSync as any)(...a)),
//     };
//   });
//
// Incollare i describe block qui sotto in fondo al file.
// ============================================================

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { afterEach } from 'node:test';

// In ESM i namespace dei moduli non sono configurabili, quindi vi.spyOn
// non funziona su node:fs. La soluzione corretta è vi.mock con factory:
// le singole funzioni diventano vi.fn() che passano through all'implementazione
// reale per default, e in ogni test si usa vi.mocked(fn) per sovrascriverle.
vi.mock('node:fs', async (importOriginal) => {
	const actual = await importOriginal<typeof import('node:fs')>();
	return {
		...actual,
		existsSync: vi.fn((...a: any[]) => (actual.existsSync as any)(...a)),
		readdirSync: vi.fn((...a: any[]) => (actual.readdirSync as any)(...a)),
		readFileSync: vi.fn((...a: any[]) => (actual.readFileSync as any)(...a)),
	};
});

// ----------------------------------------------------------------
// RingBuffer — linee 28-66
// Testato indirettamente tramite createMiddleware, che istanzia
// un RingBuffer reale al suo interno.
// ----------------------------------------------------------------

describe('RingBuffer (tramite createMiddleware)', () => {
	it('tronca il buffer quando supera maxBufferSize', async () => {
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

		const { req: r2, res: s2 } = makeReqRes({ method: 'GET', url: '/_tracker/events?limit=100&page=1' });
		await mw(r2, s2, next);

		const body = (s2 as any).getBody() as { events: TrackerEvent[]; total: number };
		expect(body.total).toBe(2);
		expect(body.events[0].timestamp).toBe('2024-01-03T00:00:00.000Z');
		expect(body.events[1].timestamp).toBe('2024-01-02T00:00:00.000Z');
	});

	it('restituisce gli eventi dal più recente al meno recente', async () => {
		const mw = createMiddleware(makeOpts(), makeLogger()) as Connect.NextHandleFunction;
		const next = vi.fn();

		const events = [
			makeEvent({ timestamp: '2024-01-01T00:00:00.000Z' }),
			makeEvent({ timestamp: '2024-06-01T00:00:00.000Z' }),
		];
		const { req: r1, res: s1 } = makeReqRes({ method: 'POST', url: '/_tracker/events', body: { events } });
		await mw(r1, s1, next);

		const { req: r2, res: s2 } = makeReqRes({ method: 'GET', url: '/_tracker/events?limit=100&page=1' });
		await mw(r2, s2, next);

		const body = (s2 as any).getBody() as { events: TrackerEvent[] };
		expect(body.events[0].timestamp).toBe('2024-06-01T00:00:00.000Z');
		expect(body.events[1].timestamp).toBe('2024-01-01T00:00:00.000Z');
	});

	it('filtra gli eventi tramite since', async () => {
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
			url: '/_tracker/events?since=2024-03-01T00:00:00.000Z&limit=100&page=1',
		});
		await mw(r2, s2, next);

		const body = (s2 as any).getBody() as { events: TrackerEvent[]; total: number };
		expect(body.total).toBe(1);
		expect(body.events[0].timestamp).toBe('2024-06-01T00:00:00.000Z');
	});

	it('filtra gli eventi tramite until', async () => {
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
			url: '/_tracker/events?until=2024-06-01T00:00:00.000Z&limit=100&page=1',
		});
		await mw(r2, s2, next);

		const body = (s2 as any).getBody() as { events: TrackerEvent[]; total: number };
		expect(body.total).toBe(1);
		expect(body.events[0].timestamp).toBe('2024-01-01T00:00:00.000Z');
	});

	it('filtra gli eventi tramite after (cursor)', async () => {
		const mw = createMiddleware(makeOpts(), makeLogger()) as Connect.NextHandleFunction;
		const next = vi.fn();

		const events = [
			makeEvent({ timestamp: '2024-01-01T00:00:00.000Z' }),
			makeEvent({ timestamp: '2024-06-01T00:00:00.000Z' }),
			makeEvent({ timestamp: '2024-12-01T00:00:00.000Z' }),
		];
		const { req: r1, res: s1 } = makeReqRes({ method: 'POST', url: '/_tracker/events', body: { events } });
		await mw(r1, s1, next);

		// after è esclusivo: restituisce solo timestamp > cursor
		const { req: r2, res: s2 } = makeReqRes({
			method: 'GET',
			url: '/_tracker/events?after=2024-06-01T00:00:00.000Z&limit=100&page=1',
		});
		await mw(r2, s2, next);

		const body = (s2 as any).getBody() as { events: TrackerEvent[]; total: number };
		expect(body.total).toBe(1);
		expect(body.events[0].timestamp).toBe('2024-12-01T00:00:00.000Z');
	});

	it('rispetta la paginazione con limit e page', async () => {
		const mw = createMiddleware(makeOpts(), makeLogger()) as Connect.NextHandleFunction;
		const next = vi.fn();

		const events = [
			makeEvent({ timestamp: '2024-01-01T00:00:00.000Z' }),
			makeEvent({ timestamp: '2024-02-01T00:00:00.000Z' }),
			makeEvent({ timestamp: '2024-03-01T00:00:00.000Z' }),
		];
		const { req: r1, res: s1 } = makeReqRes({ method: 'POST', url: '/_tracker/events', body: { events } });
		await mw(r1, s1, next);

		// Pagina 1: i 2 eventi più recenti
		const { req: r2, res: s2 } = makeReqRes({ method: 'GET', url: '/_tracker/events?limit=2&page=1' });
		await mw(r2, s2, next);
		const body1 = (s2 as any).getBody() as { events: TrackerEvent[]; total: number };
		expect(body1.total).toBe(3);
		expect(body1.events).toHaveLength(2);
		expect(body1.events[0].timestamp).toBe('2024-03-01T00:00:00.000Z');

		// Pagina 2: il solo evento rimasto
		const { req: r3, res: s3 } = makeReqRes({ method: 'GET', url: '/_tracker/events?limit=2&page=2' });
		await mw(r3, s3, next);
		const body2 = (s3 as any).getBody() as { events: TrackerEvent[]; total: number };
		expect(body2.total).toBe(3);
		expect(body2.events).toHaveLength(1);
		expect(body2.events[0].timestamp).toBe('2024-01-01T00:00:00.000Z');
	});
});

describe('loadFromLogFiles() (tramite createMiddleware)', () => {
	afterEach(() => vi.resetAllMocks());

	function makeOptsWithTransport(logPath: string, format = 'json'): ResolvedTrackerOptions {
		const opts = makeOpts();
		(opts as any).logging = { transports: [{ format, path: logPath }] };
		return opts;
	}

	it('ignora i transport con formato diverso da json (riga 85)', () => {
		createMiddleware(makeOptsWithTransport('/logs/app.log', 'text'), makeLogger());
		expect(vi.mocked(readdirSync)).not.toHaveBeenCalled();
	});

	it('salta la directory se non esiste', () => {
		vi.mocked(existsSync).mockReturnValue(false);
		createMiddleware(makeOptsWithTransport('/non/existent/app.log.json'), makeLogger());
		expect(vi.mocked(readdirSync)).not.toHaveBeenCalled();
	});

	it('carica gli eventi dai file JSON e li inserisce nel buffer', async () => {
		const ev = makeEvent({ timestamp: '2024-01-01T00:00:00.000Z' });
		vi.mocked(existsSync).mockReturnValue(true);
		vi.mocked(readdirSync).mockReturnValue(['app.log.json'] as any);
		vi.mocked(readFileSync).mockReturnValue(JSON.stringify(ev) + '\n' as any);

		const logger = makeLogger();
		const mw = createMiddleware(makeOptsWithTransport('/logs/app.log.json'), logger) as Connect.NextHandleFunction;
		const next = vi.fn();

		const { req, res } = makeReqRes({ method: 'GET', url: '/_tracker/events?limit=100&page=1' });
		await mw(req, res, next);

		expect((res as any).getBody().total).toBe(1);
		expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Loaded 1 events'));
	});

	it('carica e ordina più file di log cronologicamente', async () => {
		const ev1 = makeEvent({ timestamp: '2024-01-01T00:00:00.000Z' });
		const ev2 = makeEvent({ timestamp: '2024-06-01T00:00:00.000Z' });

		vi.mocked(existsSync).mockReturnValue(true);
		// I file arrivano in ordine invertito: devono essere ordinati lessicograficamente
		vi.mocked(readdirSync).mockReturnValue(['app.log.2024-06-01.json', 'app.log.2024-01-01.json'] as any);
		vi.mocked(readFileSync)
			.mockReturnValueOnce(JSON.stringify(ev2) + '\n' as any)
			.mockReturnValueOnce(JSON.stringify(ev1) + '\n' as any);

		const logger = makeLogger();
		const mw = createMiddleware(makeOptsWithTransport('/logs/app.log.json'), logger) as Connect.NextHandleFunction;
		const next = vi.fn();

		const { req, res } = makeReqRes({ method: 'GET', url: '/_tracker/events?limit=100&page=1' });
		await mw(req, res, next);

		expect((res as any).getBody().total).toBe(2);
		expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Loaded 2 events'));
	});

	it('salta le righe JSON malformate senza lanciare eccezioni', () => {
		vi.mocked(existsSync).mockReturnValue(true);
		vi.mocked(readdirSync).mockReturnValue(['app.log.json'] as any);
		vi.mocked(readFileSync).mockReturnValue('not-json\n{broken\n\n' as any);

		expect(() => createMiddleware(makeOptsWithTransport('/logs/app.log.json'), makeLogger())).not.toThrow();
	});

	it('logga un avviso se readdirSync lancia un errore', () => {
		vi.mocked(existsSync).mockReturnValue(true);
		vi.mocked(readdirSync).mockImplementation(() => { throw new Error('EPERM: permission denied'); });

		const logger = makeLogger();
		createMiddleware(makeOptsWithTransport('/logs/app.log.json'), logger);

		expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Could not read log files'));
	});
});
