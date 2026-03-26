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

	it('restituisce true se pingEndpoint è vuoto', async () => {
		installTrackerConfig(makeConfig({ pingEndpoint: '' }));
		const { fetchPing } = await importApi();
		const result = await fetchPing();
		expect(result).toBe(true);
	});

	it('restituisce true se la risposta è ok', async () => {
		installTrackerConfig(makeConfig({ pingEndpoint: '/ping' }));
		vi.mocked(fetch).mockResolvedValue({ ok: true } as Response);
		const { fetchPing } = await importApi();
		expect(await fetchPing()).toBe(true);
	});

	it('restituisce false se la risposta non è ok', async () => {
		installTrackerConfig(makeConfig({ pingEndpoint: '/ping' }));
		vi.mocked(fetch).mockResolvedValue({ ok: false } as Response);
		const { fetchPing } = await importApi();
		expect(await fetchPing()).toBe(false);
	});

	it('restituisce false se fetch lancia un errore', async () => {
		installTrackerConfig(makeConfig({ pingEndpoint: '/ping' }));
		vi.mocked(fetch).mockRejectedValue(new Error('network error'));
		const { fetchPing } = await importApi();
		expect(await fetchPing()).toBe(false);
	});

	it('invia X-Tracker-Key se apiKey è configurata', async () => {
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

	it('restituisce gli eventi ricevuti dall\'API', async () => {
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

	it('include i parametri since e until nell\'URL', async () => {
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

	it('lancia errore se la risposta non è ok', async () => {
		installTrackerConfig(makeConfig({ wsEndpoint: '', readEndpoint: 'http://localhost/_tracker' }));
		vi.mocked(fetch).mockResolvedValue({
			ok: false,
			status: 500,
			statusText: 'Internal Server Error'
		} as Response);
		const { fetchAllEvents } = await importApi();
		await expect(fetchAllEvents('from', 'to')).rejects.toThrow('500');
	});

	it('invia X-Tracker-Key se apiKey è configurata', async () => {
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

	it('restituisce [] se la risposta non contiene events', async () => {
		installTrackerConfig(makeConfig({ wsEndpoint: '', readEndpoint: 'http://localhost/_tracker' }));
		vi.mocked(fetch).mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({})
		} as Response);
		const { fetchAllEvents } = await importApi();
		expect(await fetchAllEvents('from', 'to')).toEqual([]);
	});

	it('lancia errore se __TRACKER_CONFIG__ non è presente', async () => {
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
		it('apre una nuova connessione WebSocket e risolve all\'open', async () => {
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

		it('rigetta se wsEndpoint non è configurato', async () => {
			installTrackerConfig(makeConfig({ wsEndpoint: '' }));
			const { fetchAllEvents } = await importApi();
		});

		it('rigetta e azzera wsInstance se WebSocket emette error', async () => {
			installTrackerConfig(makeConfig({ wsEndpoint: 'ws://localhost/_tracker' }));
			const { fetchAllEvents } = await importApi();

			const promise = fetchAllEvents('from', 'to');

			mockWs._emit('error');

			await expect(promise).rejects.toThrow('WebSocket connection failed');
		});

		it('rigetta se wsEndpoint è vuoto al momento della connessione', async () => {
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
			await expect(vi.advanceTimersByTimeAsync(3000)).resolves.not.toThrow();
			expect(vi.mocked(WebSocket)).toHaveBeenCalledTimes(1);
			vi.useRealTimers();
		});

		it('riusa la connessione esistente se già OPEN', async () => {
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

		it('tenta riconnessione dopo close', async () => {
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
			await vi.advanceTimersByTimeAsync(3000);

			expect(vi.mocked(WebSocket)).toHaveBeenCalledTimes(2);
			vi.useRealTimers();
		});
	});

	describe('fetchAllEvents (WebSocket)', () => {
		it('invia la query e risolve con gli eventi ricevuti', async () => {
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

		it('ignora messaggi con reqId diverso', async () => {
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

		it('va in timeout dopo 5s se nessuna risposta arriva', async () => {
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

		it('restituisce [] se response.events è assente', async () => {
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

		it('ignora messaggi JSON malformati senza lanciare', async () => {
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
	});
});
