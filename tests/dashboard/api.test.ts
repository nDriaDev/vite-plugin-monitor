import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { installTrackerConfig, makeConfig } from './setup';

async function importApi() {
	const { fetchPing, fetchAllEvents } = await import('../../src/dashboard/api');
	return { fetchPing, fetchAllEvents };
}

describe('fetchPing', () => {
	beforeEach(() => {
		vi.stubGlobal('fetch', vi.fn());
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('returns true when pingEndpoint is empty', async () => {
		installTrackerConfig(makeConfig({ pingEndpoint: '' }));
		const { fetchPing } = await importApi();
		const result = await fetchPing();
		expect(result).toBe(true);
	});

	it('returns true when the response is ok', async () => {
		installTrackerConfig(makeConfig({ pingEndpoint: '/ping' }));
		vi.mocked(fetch).mockResolvedValue({ ok: true } as Response);
		const { fetchPing } = await importApi();
		expect(await fetchPing()).toBe(true);
	});

	it('returns false when the response is not ok', async () => {
		installTrackerConfig(makeConfig({ pingEndpoint: '/ping' }));
		vi.mocked(fetch).mockResolvedValue({ ok: false } as Response);
		const { fetchPing } = await importApi();
		expect(await fetchPing()).toBe(false);
	});

	it('returns false when fetch throws an error', async () => {
		installTrackerConfig(makeConfig({ pingEndpoint: '/ping' }));
		vi.mocked(fetch).mockRejectedValue(new Error('network error'));
		const { fetchPing } = await importApi();
		expect(await fetchPing()).toBe(false);
	});

	it('sends X-Tracker-Key when apiKey is configured', async () => {
		installTrackerConfig(makeConfig({ pingEndpoint: '/ping', apiKey: 'secret-key' }));
		vi.mocked(fetch).mockResolvedValue({ ok: true } as Response);
		const { fetchPing } = await importApi();
		await fetchPing();
		expect(vi.mocked(fetch)).toHaveBeenCalledWith(
			'/ping',
			expect.objectContaining({ headers: { 'X-Tracker-Key': 'secret-key' } })
		);
	});
});

describe('fetchAllEvents (HTTP)', () => {
	beforeEach(() => {
		vi.stubGlobal('fetch', vi.fn());
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('Returns events received from the API', async () => {
		installTrackerConfig(makeConfig({ wsEndpoint: '', readEndpoint: 'http://localhost/_tracker' }));
		const events = [{ id: '1', type: 'click' }];
		vi.mocked(fetch).mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({ events })
		} as Response);
		const { fetchAllEvents } = await importApi();
		const result = await fetchAllEvents('2026-01-01T00:00Z', '2026-12-31T23:59Z');
		expect(result).toEqual(events);
	});

	it('Include the since and until parameters in the URL', async () => {
		installTrackerConfig(makeConfig({ wsEndpoint: '', readEndpoint: 'http://localhost/_tracker' }));
		vi.mocked(fetch).mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({ events: [] })
		} as Response);
		const { fetchAllEvents } = await importApi();
		await fetchAllEvents('2026-01-01T00:00Z', '2026-12-31T23:59Z');
		const url = vi.mocked(fetch).mock.calls[0][0] as string;
		expect(url).toContain('since=');
		expect(url).toContain('until=');
	});

	it('throws an error when the response is not ok', async () => {
		installTrackerConfig(makeConfig({ wsEndpoint: '', readEndpoint: 'http://localhost/_tracker' }));
		vi.mocked(fetch).mockResolvedValue({
			ok: false,
			status: 500,
			statusText: 'Internal Server Error'
		} as Response);
		const { fetchAllEvents } = await importApi();
		await expect(fetchAllEvents('from', 'to')).rejects.toThrow('500');
	});

	it('sends X-Tracker-Key when apiKey is configured', async () => {
		installTrackerConfig(makeConfig({ wsEndpoint: '', readEndpoint: 'http://localhost/_tracker', apiKey: 'key-123' }));
		vi.mocked(fetch).mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({ events: [] })
		} as Response);
		const { fetchAllEvents } = await importApi();
		await fetchAllEvents('from', 'to');
		const opts = vi.mocked(fetch).mock.calls[0][1] as RequestInit;
		expect((opts.headers as Record<string, string>)['X-Tracker-Key']).toBe('key-123');
	});

	it('returns [] when the response does not contain events', async () => {
		installTrackerConfig(makeConfig({ wsEndpoint: '', readEndpoint: 'http://localhost/_tracker' }));
		vi.mocked(fetch).mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({})
		} as Response);
		const { fetchAllEvents } = await importApi();
		expect(await fetchAllEvents('from', 'to')).toEqual([]);
	});

	it('throws an error when __TRACKER_CONFIG__ is not present', async () => {
		Reflect.deleteProperty(window, '__TRACKER_CONFIG__');
		const { fetchAllEvents } = await importApi();
		await expect(fetchAllEvents('from', 'to')).rejects.toThrow('__TRACKER_CONFIG__');
	});
});

describe('ensureWsConnected + fetchAllEvents (WebSocket)', () => {
	let mockWs: {
		readyState: number;
		send: ReturnType<typeof vi.fn>;
		close: ReturnType<typeof vi.fn>;
		addEventListener: ReturnType<typeof vi.fn>;
		removeEventListener: ReturnType<typeof vi.fn>;
		listeners: Map<string, Function>;
		_emit: (event: string, data?: unknown) => void;
	};

	function makeMockWebSocket() {
		const listeners = new Map<string, Function>();
		const ws = {
			readyState: 0,
			send: vi.fn(),
			close: vi.fn(),
			listeners,
			addEventListener: vi.fn((event: string, handler: Function, opts?: unknown) => {
				listeners.set(event, handler);
			}),
			removeEventListener: vi.fn((event: string, handler: Function) => {
				if (listeners.get(event) === handler) listeners.delete(event);
			}),
			_emit(event: string, data?: unknown) {
				listeners.get(event)?.(data);
			},
		};
		return ws;
	}

	beforeEach(() => {
		vi.resetModules();
		mockWs = makeMockWebSocket();

		const MockWebSocket = vi.fn(function (this: unknown) {
			return mockWs;
		}) as unknown as typeof WebSocket;

		(MockWebSocket as any).CONNECTING = 0;
		(MockWebSocket as any).OPEN = 1;
		(MockWebSocket as any).CLOSING = 2;
		(MockWebSocket as any).CLOSED = 3;

		vi.stubGlobal('WebSocket', MockWebSocket);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	describe('ensureWsConnected', () => {
		it('opens a new WebSocket connection and resolves to open', async () => {
			installTrackerConfig(makeConfig({ wsEndpoint: 'ws://localhost/_tracker' }));
			const { fetchAllEvents } = await importApi();

			const promise = fetchAllEvents('from', 'to');

			mockWs.readyState = 1;
			mockWs._emit('open');

			await vi.waitFor(() => expect(mockWs.send).toHaveBeenCalled());

			const [, handler] = mockWs.send.mock.calls[0] ?? [];
			const sentMsg = JSON.parse(mockWs.send.mock.calls[0][0]);
			mockWs._emit('message', {
				data: JSON.stringify({ type: 'events:response', reqId: sentMsg.reqId, response: { events: [] } })
			});

			await promise;
			expect(vi.mocked(WebSocket)).toHaveBeenCalledWith('ws://localhost/_tracker');
		});

		it('rejects when wsEndpoint is not configured', async () => {
			installTrackerConfig(makeConfig({ wsEndpoint: '' }));
			const { fetchAllEvents } = await importApi();
		});

		it('rejects and clears wsInstance when WebSocket emits error', async () => {
			installTrackerConfig(makeConfig({ wsEndpoint: 'ws://localhost/_tracker' }));
			const { fetchAllEvents } = await importApi();

			const promise = fetchAllEvents('from', 'to');

			mockWs._emit('error');

			await expect(promise).rejects.toThrow('WebSocket connection failed');
		});

		it('rejects when wsEndpoint is empty at connection time', async () => {
			vi.useFakeTimers();
			installTrackerConfig(makeConfig({ wsEndpoint: 'ws://localhost/_tracker' }));
			const { fetchAllEvents } = await importApi();
			const p1 = fetchAllEvents('from', 'to');
			mockWs.readyState = 1;
			mockWs._emit('open');

			await vi.waitFor(() => expect(mockWs.send).toHaveBeenCalledTimes(1));
			const msg1 = JSON.parse(mockWs.send.mock.calls[0][0]);
			mockWs._emit('message', {
				data: JSON.stringify({ type: 'events:response', reqId: msg1.reqId, response: { events: [] } })
			});
			await p1;

			installTrackerConfig(makeConfig({ wsEndpoint: '' }));
			mockWs.readyState = 3;
			mockWs._emit('close');
			await expect(vi.advanceTimersByTimeAsync(5000)).resolves.not.toThrow();
			expect(vi.mocked(WebSocket)).toHaveBeenCalledTimes(1);
			vi.useRealTimers();
		});

		it('reuses the existing connection when already OPEN', async () => {
			installTrackerConfig(makeConfig({ wsEndpoint: 'ws://localhost/_tracker' }));
			const { fetchAllEvents } = await importApi();

			const p1 = fetchAllEvents('from', 'to');

			mockWs.readyState = 1;
			mockWs._emit('open');

			await vi.waitFor(() => expect(mockWs.send).toHaveBeenCalledTimes(1));
			const msg1 = JSON.parse(mockWs.send.mock.calls[0][0]);
			mockWs._emit('message', {
				data: JSON.stringify({ type: 'events:response', reqId: msg1.reqId, response: { events: [] } })
			});
			await p1;

			const p2 = fetchAllEvents('from', 'to');

			await vi.waitFor(() => expect(mockWs.send).toHaveBeenCalledTimes(2));
			const msg2 = JSON.parse(mockWs.send.mock.calls[1][0]);
			mockWs._emit('message', {
				data: JSON.stringify({ type: 'events:response', reqId: msg2.reqId, response: { events: [] } })
			});
			await p2;

			expect(vi.mocked(WebSocket)).toHaveBeenCalledTimes(1);
		});

		it('attempts reconnection after close', async () => {
			vi.useFakeTimers();
			installTrackerConfig(makeConfig({ wsEndpoint: 'ws://localhost/_tracker' }));
			const { fetchAllEvents } = await importApi();

			const p1 = fetchAllEvents('from', 'to');
			mockWs.readyState = 1;
			mockWs._emit('open');
			await vi.waitFor(() => expect(mockWs.send).toHaveBeenCalled());

			const msg1 = JSON.parse(mockWs.send.mock.calls[0][0]);
			mockWs._emit('message', {
				data: JSON.stringify({ type: 'events:response', reqId: msg1.reqId, response: { events: [] } })
			});
			await p1;

			mockWs.readyState = WebSocket.CLOSED;
			mockWs._emit('close');

			const newMockWs = makeMockWebSocket();
			vi.mocked(WebSocket).mockImplementation(() => newMockWs as unknown as WebSocket);
			await vi.advanceTimersByTimeAsync(5000);

			expect(vi.mocked(WebSocket)).toHaveBeenCalledTimes(2);
			vi.useRealTimers();
		});
	});

	describe('fetchAllEvents (WebSocket)', () => {
		it('sends the query and resolves with the received events', async () => {
			installTrackerConfig(makeConfig({ wsEndpoint: 'ws://localhost/_tracker' }));
			const { fetchAllEvents } = await importApi();
			const events = [{ id: '1', type: 'click' }];

			const promise = fetchAllEvents('2026-01-01', '2026-12-31');
			mockWs.readyState = 1;
			mockWs._emit('open');

			await vi.waitFor(() => expect(mockWs.send).toHaveBeenCalled());
			const sent = JSON.parse(mockWs.send.mock.calls[0][0]);
			expect(sent.type).toBe('events:query');
			expect(sent.query).toEqual({ since: '2026-01-01', until: '2026-12-31' });

			mockWs._emit('message', {
				data: JSON.stringify({ type: 'events:response', reqId: sent.reqId, response: { events } })
			});

			expect(await promise).toEqual(events);
		});

		it('ignores messages with a different reqId', async () => {
			installTrackerConfig(makeConfig({ wsEndpoint: 'ws://localhost/_tracker' }));
			const { fetchAllEvents } = await importApi();

			const promise = fetchAllEvents('from', 'to');
			mockWs.readyState = 1;
			mockWs._emit('open');

			await vi.waitFor(() => expect(mockWs.send).toHaveBeenCalled());
			const sent = JSON.parse(mockWs.send.mock.calls[0][0]);

			mockWs._emit('message', {
				data: JSON.stringify({ type: 'events:response', reqId: 'wrong-id', response: { events: [{ id: 'x' }] } })
			});

			mockWs._emit('message', {
				data: JSON.stringify({ type: 'events:response', reqId: sent.reqId, response: { events: [] } })
			});

			expect(await promise).toEqual([]);
		});

		it('times out after 5s when no response arrives', async () => {
			vi.useFakeTimers();
			installTrackerConfig(makeConfig({ wsEndpoint: 'ws://localhost/_tracker' }));
			const { fetchAllEvents } = await importApi();
			const promise = fetchAllEvents('from', 'to');
			const rejection = expect(promise).rejects.toThrow('timeout');
			mockWs.readyState = 1;
			mockWs._emit('open');

			await vi.waitFor(() => expect(mockWs.send).toHaveBeenCalled());
			await vi.advanceTimersByTimeAsync(5000);

			await rejection;
			vi.useRealTimers();
		});

		it('returns [] when response.events is absent', async () => {
			installTrackerConfig(makeConfig({ wsEndpoint: 'ws://localhost/_tracker' }));
			const { fetchAllEvents } = await importApi();

			const promise = fetchAllEvents('from', 'to');
			mockWs.readyState = 1;
			mockWs._emit('open');

			await vi.waitFor(() => expect(mockWs.send).toHaveBeenCalled());
			const sent = JSON.parse(mockWs.send.mock.calls[0][0]);
			mockWs._emit('message', {
				data: JSON.stringify({ type: 'events:response', reqId: sent.reqId, response: {} })
			});

			expect(await promise).toEqual([]);
		});

		it('ignores malformed JSON messages without throwing', async () => {
			installTrackerConfig(makeConfig({ wsEndpoint: 'ws://localhost/_tracker' }));
			const { fetchAllEvents } = await importApi();

			const promise = fetchAllEvents('from', 'to');
			mockWs.readyState = 1;
			mockWs._emit('open');

			await vi.waitFor(() => expect(mockWs.send).toHaveBeenCalled());
			const sent = JSON.parse(mockWs.send.mock.calls[0][0]);

			mockWs._emit('message', { data: 'not-valid-json' });

			mockWs._emit('message', {
				data: JSON.stringify({ type: 'events:response', reqId: sent.reqId, response: { events: [] } })
			});

			expect(await promise).toEqual([]);
		});

		it('send authentication message if apiKey is provided', async () => {
			const apiKey = 'test-secret-key';
			installTrackerConfig(makeConfig({
				wsEndpoint: 'ws://localhost/_tracker',
				apiKey
			}));
			const { fetchAllEvents } = await importApi();
			const promise = fetchAllEvents('from', 'to');
			mockWs.readyState = 1;
			mockWs._emit('open');
			await vi.waitFor(() => {
				expect(mockWs.send).toHaveBeenCalledTimes(2);
			});
			const authCall = mockWs.send.mock.calls.find(args => JSON.parse(args[0]).type === 'auth');
			expect(authCall).toBeDefined();
			expect(JSON.parse(authCall![0])).toEqual({ type: 'auth', key: apiKey });
			const queryCall = mockWs.send.mock.calls.find(args => JSON.parse(args[0]).type === 'events:query');
			expect(queryCall).toBeDefined();
			const reqId = JSON.parse(queryCall![0]).reqId;
			mockWs._emit('message', {
				data: JSON.stringify({ type: 'events:response', reqId, response: { events: [] } })
			});
			await promise;
		});
	});
});
