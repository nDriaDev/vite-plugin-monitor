// tests/plugin/standalone-server-init.test.ts
//
// Test per createStandaloneServer() — linee 230-281
//
// Problema risolto: vi.mock viene hoistato prima delle dichiarazioni
// di variabili nel modulo, quindi mockServer/mockWss sarebbero in TDZ
// quando i factory di vi.mock vengono eseguiti.
// Soluzione: vi.hoisted() crea gli oggetti mock prima di qualsiasi
// vi.mock factory, rendendoli disponibili nel momento giusto.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ResolvedTrackerOptions, TrackerEvent } from '../../src/types';
import { resolveOptions } from '../../src/plugin/config';
import { createServer } from 'node:http';

// ----------------------------------------------------------------
// Step 1: creare i mock objects tramite vi.hoisted.
// Questo callback viene eseguito prima di qualsiasi vi.mock factory,
// garantendo che mockServer e mockWss siano definiti quando servono.
//
// Si usano plain objects con un mini event-emitter manuale anziché
// EventEmitter di node:events (che non è ancora importabile qui).
// ----------------------------------------------------------------
const { mockServer, mockWss } = vi.hoisted(() => {
	function makeEmitter() {
		const store: Record<string, ((...a: any[]) => void)[]> = {};
		return {
			listen: vi.fn(),
			close: vi.fn(),
			on(event: string, cb: (...a: any[]) => void) {
				(store[event] ??= []).push(cb);
				return this;
			},
			emit(event: string, ...a: any[]) {
				(store[event] ?? []).forEach(h => h(...a));
			},
			removeAllListeners() {
				for (const k of Object.keys(store)) delete store[k];
			},
		};
	}
	return { mockServer: makeEmitter(), mockWss: makeEmitter() };
});

// ----------------------------------------------------------------
// Step 2: mock di node:http e ws.
// I factory girano dopo vi.hoisted, quindi mockServer/mockWss
// sono già definiti e accessibili nelle closure.
//
// Per WebSocketServer si usa una class anziché vi.fn(() => mockWss)
// perché vi.fn() in alcuni ambienti ESM non è costruibile con `new`.
// Una class restituisce sempre un oggetto dall'interno del costruttore.
// ----------------------------------------------------------------
vi.mock('node:http', async (importOriginal) => {
	const actual = await importOriginal<typeof import('node:http')>();
	return { ...actual, createServer: vi.fn(() => mockServer) };
});

vi.mock('ws', () => ({
	WebSocketServer: class {
		constructor() { return mockWss as any; }
	},
}));

// Import DOPO i mock (l'hoisting di vi.mock garantisce che siano già attivi)
import { createStandaloneServer } from '../../src/plugin/standalone-server';

// ----------------------------------------------------------------
// Helpers (stessa convenzione del file di test principale)
// ----------------------------------------------------------------

function makeOpts(overrides: Partial<Parameters<typeof resolveOptions>[0]> = {}): ResolvedTrackerOptions {
	const opts = resolveOptions({ appId: 'test-app', ...overrides });
	opts.storage.maxBufferSize = 100;
	return opts;
}

function makeLogger() {
	return {
		debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
		writeEvent: vi.fn(), destroy: vi.fn().mockResolvedValue(undefined),
	};
}

function makeEvent(overrides: Partial<TrackerEvent> = {}): TrackerEvent {
	return {
		type: 'console', level: 'info',
		timestamp: new Date().toISOString(),
		appId: 'test-app', sessionId: 'sess_abc',
		userId: null, payload: { message: 'test' },
		...overrides,
	} as TrackerEvent;
}

// Crea un client WebSocket fake con close/send mockati e
// un vero event emitter manuale per simulare ws.on('message', ...)
function makeFakeWsClient() {
	const store: Record<string, ((...a: any[]) => void)[]> = {};
	return {
		close: vi.fn(),
		send: vi.fn(),
		on(event: string, cb: (...a: any[]) => void) { (store[event] ??= []).push(cb); },
		emit(event: string, ...a: any[]) { (store[event] ?? []).forEach(h => h(...a)); },
	};
}

// ----------------------------------------------------------------
// Suite
// ----------------------------------------------------------------

describe('createStandaloneServer()', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockServer.removeAllListeners();
		mockWss.removeAllListeners();
	});

	// ------------------------------------------------------------
	// start()
	// ------------------------------------------------------------

	describe('start()', () => {
		it('chiama server.listen sulla porta configurata', () => {
			const opts = makeOpts();
			opts.storage.port = 3456;
			const { start } = createStandaloneServer(opts, makeLogger());
			start();
			expect(mockServer.listen).toHaveBeenCalledWith(3456, expect.any(Function));
		});

		it('logga i messaggi di avvio al completamento di listen', () => {
			const logger = makeLogger();
			mockServer.listen.mockImplementation((_port: number, cb: () => void) => cb?.());
			const opts = makeOpts();
			opts.storage.port = 3456;
			const { start } = createStandaloneServer(opts, logger);
			start();
			expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('3456'));
			expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('/_tracker/ws'));
		});

		it('logga un avviso per errore EADDRINUSE', () => {
			const logger = makeLogger();
			const opts = makeOpts();
			opts.storage.port = 3456;
			const { start } = createStandaloneServer(opts, logger);
			start();

			const err = Object.assign(new Error('address already in use'), { code: 'EADDRINUSE' });
			mockServer.emit('error', err);

			expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('already in use'));
		});

		it('logga un errore generico del server', () => {
			const logger = makeLogger();
			const { start } = createStandaloneServer(makeOpts(), logger);
			start();

			mockServer.emit('error', new Error('unexpected failure'));

			expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('unexpected failure'));
		});
	});

	// ------------------------------------------------------------
	// stop()
	// ------------------------------------------------------------

	describe('stop()', () => {
		it('chiude sia il server HTTP sia il WebSocketServer', () => {
			const logger = makeLogger();
			const { stop } = createStandaloneServer(makeOpts(), logger);
			stop();
			expect(mockServer.close).toHaveBeenCalledOnce();
			expect(mockWss.close).toHaveBeenCalledOnce();
		});

		it('logga il messaggio di chiusura', () => {
			const logger = makeLogger();
			const { stop } = createStandaloneServer(makeOpts(), logger);
			stop();
			expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('stopped'));
		});
	});

	// ------------------------------------------------------------
	// Handler HTTP interno — fallback 404 per rotte non gestite
	// ------------------------------------------------------------

	describe('handler HTTP interno', () => {
		it('risponde 404 per rotte non gestite da /_tracker', async () => {
			// Cattura il request handler passato a createServer
			let capturedHandler: ((req: any, res: any) => Promise<void>) | undefined;
			vi.mocked(createServer).mockImplementationOnce((h: any) => {
				capturedHandler = h;
				return mockServer as any;
			});

			createStandaloneServer(makeOpts(), makeLogger());
			expect(capturedHandler).toBeDefined();

			// Simula una richiesta su un percorso sconosciuto
			const fakeReq = Object.assign(
				{ method: 'GET', url: '/unknown-path', headers: {} },
				{
					on(event: string, cb: (...a: any[]) => void) {
						if (event === 'end') Promise.resolve().then(() => cb());
						return this;
					},
				}
			);
			let writtenStatus = 0;
			const resChunks: string[] = [];
			const fakeRes = {
				writeHead: vi.fn((code: number) => { writtenStatus = code; }),
				end: vi.fn((body: string) => resChunks.push(body)),
			};

			await capturedHandler!(fakeReq, fakeRes);

			expect(writtenStatus).toBe(404);
			expect(JSON.parse(resChunks[0])).toMatchObject({ error: 'Not found' });
		});
	});

	// ------------------------------------------------------------
	// WebSocket — handler di connessione
	// ------------------------------------------------------------

	describe('WebSocket connection handler', () => {
		it('chiude la connessione con 1008 se apiKey non corrisponde', () => {
			const opts = makeOpts();
			opts.storage.apiKey = 'secret';
			createStandaloneServer(opts, makeLogger());

			const client = makeFakeWsClient();
			mockWss.emit('connection', client, { headers: { 'x-tracker-key': 'wrong' } });

			expect(client.close).toHaveBeenCalledWith(1008, 'Unauthorized');
		});

		it('non chiude la connessione se apiKey corrisponde', () => {
			const opts = makeOpts();
			opts.storage.apiKey = 'secret';
			createStandaloneServer(opts, makeLogger());

			const client = makeFakeWsClient();
			mockWss.emit('connection', client, { headers: { 'x-tracker-key': 'secret' } });

			expect(client.close).not.toHaveBeenCalled();
		});

		it('non chiude la connessione se apiKey non è configurata', () => {
			const opts = makeOpts();
			opts.storage.apiKey = '';
			createStandaloneServer(opts, makeLogger());

			const client = makeFakeWsClient();
			mockWss.emit('connection', client, { headers: {} });

			expect(client.close).not.toHaveBeenCalled();
		});

		it('registra il listener "message" sul client alla connessione', () => {
			createStandaloneServer(makeOpts(), makeLogger());

			const client = makeFakeWsClient();
			const onSpy = vi.spyOn(client, 'on');
			mockWss.emit('connection', client, { headers: {} });

			expect(onSpy).toHaveBeenCalledWith('message', expect.any(Function));
		});
	});

	// ------------------------------------------------------------
	// WebSocket — handler di messaggio
	// ------------------------------------------------------------

	describe('WebSocket message handler', () => {
		function connectClient(opts = makeOpts(), logger = makeLogger()) {
			createStandaloneServer(opts, logger);
			const client = makeFakeWsClient();
			mockWss.emit('connection', client, { headers: {} });
			return { client, logger };
		}

		it('ingestisce eventi validi e risponde con ack', () => {
			const { client, logger } = connectClient();
			const event = makeEvent();

			client.emit('message', Buffer.from(JSON.stringify({ events: [event] })));

			expect(logger.writeEvent).toHaveBeenCalledWith(event);
			expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('ingested 1 events'));
			expect(JSON.parse(client.send.mock.calls[0][0])).toMatchObject({ type: 'ack', saved: 1 });
		});

		it('non chiama writeEvent se events è array vuoto', () => {
			const { client, logger } = connectClient();

			client.emit('message', Buffer.from(JSON.stringify({ events: [] })));

			expect(logger.writeEvent).not.toHaveBeenCalled();
		});

		it('risponde con errore per messaggi JSON non validi', () => {
			const { client } = connectClient();

			client.emit('message', Buffer.from('{not valid json'));

			expect(JSON.parse(client.send.mock.calls[0][0])).toMatchObject({ type: 'error', message: 'Invalid message' });
		});
	});
});
