import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ResolvedTrackerOptions, TrackerEvent } from '../../src/types';
import { resolveOptions } from '../../src/plugin/config';
import { createServer } from 'node:http';
import { createStandaloneServer } from '../../src/plugin/standalone-server';

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

vi.mock('node:http', async (importOriginal) => {
	const actual = await importOriginal<typeof import('node:http')>();
	return { ...actual, createServer: vi.fn(() => mockServer) };
});

vi.mock('ws', () => ({
	WebSocketServer: class {
		constructor() { return mockWss as any; }
	},
}));


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

function makeFakeWsClient() {
	const store: Record<string, ((...a: any[]) => void)[]> = {};
	return {
		close: vi.fn(),
		send: vi.fn(),
		on(event: string, cb: (...a: any[]) => void) { (store[event] ??= []).push(cb); },
		emit(event: string, ...a: any[]) { (store[event] ?? []).forEach(h => h(...a)); },
	};
}

describe('createStandaloneServer()', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockServer.removeAllListeners();
		mockWss.removeAllListeners();
	});

	describe('start()', () => {
		it('calls server.listen on the configured port', () => {
			const opts = makeOpts();
			opts.storage.port = 3456;
			const { start } = createStandaloneServer(opts, makeLogger());
			start();
			expect(mockServer.listen).toHaveBeenCalledWith(3456, expect.any(Function));
		});

		it('logs startup messages on listen completion', () => {
			const logger = makeLogger();
			mockServer.listen.mockImplementation((_port: number, cb: () => void) => cb?.());
			const opts = makeOpts();
			opts.storage.port = 3456;
			const { start } = createStandaloneServer(opts, logger);
			start();
			expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('3456'));
			expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('/_tracker/ws'));
		});

		it('logs a warning for EADDRINUSE error', () => {
			const logger = makeLogger();
			const opts = makeOpts();
			opts.storage.port = 3456;
			const { start } = createStandaloneServer(opts, logger);
			start();

			const err = Object.assign(new Error('address already in use'), { code: 'EADDRINUSE' });
			mockServer.emit('error', err);

			expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('already in use'));
		});

		it('logs a generic server error', () => {
			const logger = makeLogger();
			const { start } = createStandaloneServer(makeOpts(), logger);
			start();

			mockServer.emit('error', new Error('unexpected failure'));

			expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('unexpected failure'));
		});
	});

	describe('stop()', () => {
		it('closes both the HTTP server and the WebSocketServer', () => {
			const logger = makeLogger();
			const { stop } = createStandaloneServer(makeOpts(), logger);
			stop();
			expect(mockServer.close).toHaveBeenCalledOnce();
			expect(mockWss.close).toHaveBeenCalledOnce();
		});

		it('logs the shutdown message', () => {
			const logger = makeLogger();
			const { stop } = createStandaloneServer(makeOpts(), logger);
			stop();
			expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('stopped'));
		});
	});

	describe('internal HTTP handler', () => {
		it('responds 404 for routes not handled by /_tracker', async () => {
			let capturedHandler: ((req: any, res: any) => Promise<void>) | undefined;
			vi.mocked(createServer).mockImplementationOnce((h: any) => {
				capturedHandler = h;
				return mockServer as any;
			});

			createStandaloneServer(makeOpts(), makeLogger());
			expect(capturedHandler).toBeDefined();

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

	describe('WebSocket connection handler', () => {
		it('registers the "message" listener on the client upon connection', () => {
			createStandaloneServer(makeOpts(), makeLogger());

			const client = makeFakeWsClient();
			const onSpy = vi.spyOn(client, 'on');
			mockWss.emit('connection', client);

			expect(onSpy).toHaveBeenCalledWith('message', expect.any(Function));
		});

		it('does not close or send anything on connection when apiKey is not configured', () => {
			const opts = makeOpts();
			opts.storage.apiKey = '';
			createStandaloneServer(opts, makeLogger());

			const client = makeFakeWsClient();
			mockWss.emit('connection', client);

			expect(client.close).not.toHaveBeenCalled();
			expect(client.send).not.toHaveBeenCalled();
		});

		it('does not close the connection immediately when apiKey is configured (waits for auth message)', () => {
			const opts = makeOpts();
			opts.storage.apiKey = 'secret';
			createStandaloneServer(opts, makeLogger());

			const client = makeFakeWsClient();
			mockWss.emit('connection', client);

			// The server must NOT close the socket before the first message
			expect(client.close).not.toHaveBeenCalled();
		});
	});

	describe('WebSocket message handler', () => {
		function connectClient(opts = makeOpts(), logger = makeLogger()) {
			createStandaloneServer(opts, logger);
			const client = makeFakeWsClient();
			mockWss.emit('connection', client);
			return { client, logger };
		}

		it('accepts auth message with correct key and responds with auth_ok', () => {
			const opts = makeOpts();
			opts.storage.apiKey = 'secret';
			const { client } = connectClient(opts);

			client.emit('message', Buffer.from(JSON.stringify({ type: 'auth', key: 'secret' })));

			expect(client.close).not.toHaveBeenCalled();
			expect(JSON.parse(client.send.mock.calls[0][0])).toMatchObject({ type: 'auth_ok' });
		});

		it('closes with 1008 when auth message has wrong key', () => {
			const opts = makeOpts();
			opts.storage.apiKey = 'secret';
			const { client } = connectClient(opts);

			client.emit('message', Buffer.from(JSON.stringify({ type: 'auth', key: 'wrong' })));

			expect(client.close).toHaveBeenCalledWith(1008, 'Unauthorized');
		});

		it('closes with 1008 when first message is an ingest instead of auth', () => {
			const opts = makeOpts();
			opts.storage.apiKey = 'secret';
			const { client } = connectClient(opts);

			client.emit('message', Buffer.from(JSON.stringify({ type: 'ingest', events: [makeEvent()] })));

			expect(client.close).toHaveBeenCalledWith(1008, 'Unauthorized');
		});

		it('ingests events normally when no apiKey is configured (no auth message needed)', () => {
			const opts = makeOpts();
			opts.storage.apiKey = '';
			const { client, logger } = connectClient(opts);
			const event = makeEvent();

			client.emit('message', Buffer.from(JSON.stringify({ type: 'ingest', events: [event] })));

			expect(logger.writeEvent).toHaveBeenCalledWith(event);
			expect(JSON.parse(client.send.mock.calls[0][0])).toMatchObject({ type: 'ack', saved: 1 });
		});

		it('ingests events after successful auth', () => {
			const opts = makeOpts();
			opts.storage.apiKey = 'secret';
			const { client, logger } = connectClient(opts);
			const event = makeEvent();

			// First authenticate
			client.emit('message', Buffer.from(JSON.stringify({ type: 'auth', key: 'secret' })));
			// Then send events
			client.emit('message', Buffer.from(JSON.stringify({ type: 'ingest', events: [event] })));

			expect(logger.writeEvent).toHaveBeenCalledWith(event);
			expect(JSON.parse(client.send.mock.calls[1][0])).toMatchObject({ type: 'ack', saved: 1 });
		});

		it('ingests valid events and responds with ack (no apiKey)', () => {
			const { client, logger } = connectClient();
			const event = makeEvent();

			client.emit('message', Buffer.from(JSON.stringify({ type: 'ingest', events: [event] })));

			expect(logger.writeEvent).toHaveBeenCalledWith(event);
			expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('ingested 1 events'));
			expect(JSON.parse(client.send.mock.calls[0][0])).toMatchObject({ type: 'ack', saved: 1 });
		});

		it('does not call writeEvent when events is an empty array', () => {
			const { client, logger } = connectClient();

			client.emit('message', Buffer.from(JSON.stringify({ type: 'ingest', events: [] })));

			expect(logger.writeEvent).not.toHaveBeenCalled();
		});

		it('responds with error for invalid JSON messages', () => {
			const { client } = connectClient();

			client.emit('message', Buffer.from('{not valid json'));

			expect(JSON.parse(client.send.mock.calls[0][0])).toMatchObject({ type: 'error', message: 'Invalid message' });
		});

		it('responds to "events:query" with filtered events from the buffer', () => {
			const { client } = connectClient();
			const event1 = makeEvent({ timestamp: '2023-01-01T10:00:00Z', payload: { name: 'old', data: {id: 1} } });
			const event2 = makeEvent({ timestamp: '2023-01-02T10:00:00Z', payload: { name: 'new', data: {id: 0} } });
			client.emit('message', Buffer.from(JSON.stringify({
				type: 'ingest',
				events: [event1, event2]
			})));
			const queryMsg = {
				type: 'events:query',
				reqId: 'req_123',
				query: {
					since: '2023-01-02T00:00:00Z'
				}
			};

			client.emit('message', Buffer.from(JSON.stringify(queryMsg)));
			const response = JSON.parse(client.send.mock.calls[1][0]);

			expect(response).toMatchObject({
				type: 'events:response',
				reqId: 'req_123',
				response: {
					total: 1,
					page: 1
				}
			});

			expect(response.response.events).toHaveLength(1);
			expect(response.response.events[0].payload.name).toBe('new');
		});
	});
});
