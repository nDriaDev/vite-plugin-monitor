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
		it('closes the connection with 1008 when apiKey does not match', () => {
			const opts = makeOpts();
			opts.storage.apiKey = 'secret';
			createStandaloneServer(opts, makeLogger());

			const client = makeFakeWsClient();
			mockWss.emit('connection', client, { headers: { 'x-tracker-key': 'wrong' } });

			expect(client.close).toHaveBeenCalledWith(1008, 'Unauthorized');
		});

		it('does not close the connection when apiKey matches', () => {
			const opts = makeOpts();
			opts.storage.apiKey = 'secret';
			createStandaloneServer(opts, makeLogger());

			const client = makeFakeWsClient();
			mockWss.emit('connection', client, { headers: { 'x-tracker-key': 'secret' } });

			expect(client.close).not.toHaveBeenCalled();
		});

		it('does not close the connection when apiKey is not configured', () => {
			const opts = makeOpts();
			opts.storage.apiKey = '';
			createStandaloneServer(opts, makeLogger());

			const client = makeFakeWsClient();
			mockWss.emit('connection', client, { headers: {} });

			expect(client.close).not.toHaveBeenCalled();
		});

		it('registers the "message" listener on the client upon connection', () => {
			createStandaloneServer(makeOpts(), makeLogger());

			const client = makeFakeWsClient();
			const onSpy = vi.spyOn(client, 'on');
			mockWss.emit('connection', client, { headers: {} });

			expect(onSpy).toHaveBeenCalledWith('message', expect.any(Function));
		});
	});

	describe('WebSocket message handler', () => {
		function connectClient(opts = makeOpts(), logger = makeLogger()) {
			createStandaloneServer(opts, logger);
			const client = makeFakeWsClient();
			mockWss.emit('connection', client, { headers: {} });
			return { client, logger };
		}

		it('ingests valid events and responds with ack', () => {
			const { client, logger } = connectClient();
			const event = makeEvent();

			client.emit('message', Buffer.from(JSON.stringify({ events: [event] })));

			expect(logger.writeEvent).toHaveBeenCalledWith(event);
			expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('ingested 1 events'));
			expect(JSON.parse(client.send.mock.calls[0][0])).toMatchObject({ type: 'ack', saved: 1 });
		});

		it('does not call writeEvent when events is an empty array', () => {
			const { client, logger } = connectClient();

			client.emit('message', Buffer.from(JSON.stringify({ events: [] })));

			expect(logger.writeEvent).not.toHaveBeenCalled();
		});

		it('responds with error for invalid JSON messages', () => {
			const { client } = connectClient();

			client.emit('message', Buffer.from('{not valid json'));

			expect(JSON.parse(client.send.mock.calls[0][0])).toMatchObject({ type: 'error', message: 'Invalid message' });
		});
	});
});
