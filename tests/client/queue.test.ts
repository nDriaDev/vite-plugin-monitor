import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventQueue } from '../../src/client/queue';
import type { QueueOptions, TrackerEvent } from '../../src/types';

class MockWebSocket {
	static instances: MockWebSocket[] = [];

	readyState = 0;
	send = vi.fn();
	close = vi.fn();

	private listeners = new Map<string, Array<EventListenerOrEventListenerObject>>();

	constructor(public url: string) {
		MockWebSocket.instances.push(this);
	}

	addEventListener(event: string, handler: EventListenerOrEventListenerObject) {
		if (!this.listeners.has(event)) {
			this.listeners.set(event, []);
		}
		this.listeners.get(event)!.push(handler);
	}

	removeEventListener(event: string, handler: EventListenerOrEventListenerObject) {
		const list = this.listeners.get(event);
		if (list) {
			this.listeners.set(event, list.filter(h => h !== handler));
		}
	}

	generateEvent(name: string) {
		return new Event(name, { bubbles: true });
	}

	simulateMessage(data: unknown) {
		const event = new MessageEvent('message', { data: JSON.stringify(data) });
		this.listeners.get('message')?.forEach(h => {
			typeof h === 'function' ? h(event) : h.handleEvent(event);
		});
	}

	simulateOpen() {
		this.readyState = 1;
		this.listeners.get('open')?.forEach(h => {
			typeof h === 'function' ? h(this.generateEvent('open')) : h.handleEvent(this.generateEvent('open'));
		});
	}

	simulateClose(code = 1000) {
		this.readyState = 3;
		const closeEvent = new CloseEvent('close', { code });
		this.listeners.get('close')?.forEach(h => {
			typeof h === 'function' ? h(closeEvent) : h.handleEvent(closeEvent);
		});
	}

	simulateError() {
		this.listeners.get('error')?.forEach(h => {
			typeof h === 'function' ? h(this.generateEvent('error')) : h.handleEvent(this.generateEvent('error'));
		});
	}

	static latest(): MockWebSocket {
		return MockWebSocket.instances[MockWebSocket.instances.length - 1];
	}
}

const BASE_OPTS: QueueOptions = {
	wsEndpoint: '',
	writeEndpoint: '/_tracker/events',
	apiKey: '',
	batchSize: 2,
	flushInterval: 5000,
}

function makeOpts(overrides: Partial<QueueOptions> = {}): QueueOptions {
	return { ...BASE_OPTS, ...overrides }
}

let eventCounter = 0;

function makeEvent(id?: string): TrackerEvent {
	const n = id ?? String(++eventCounter);
	return {
		id: `evt-${n}`,
		timestamp: new Date().toISOString(),
		type: 'custom',
		level: 'info',
		appId: 'test-app',
		sessionId: 'sess_1',
		userId: 'user_1',
		payload: { name: `event_${n}`, data: {} },
		meta: { userAgent: 'vitest', route: '/', viewport: '1024x768', language: 'it' },
	}
}

async function flushPromises() {
	for (let i = 0; i < 5; i++) {
		await Promise.resolve();
	}
}

function mockVisibilityState(state: 'visible' | 'hidden') {
	Object.defineProperty(document, 'visibilityState', {
		configurable: true,
		get: () => state,
	});
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
	vi.useFakeTimers();
	eventCounter = 0;
	MockWebSocket.instances = [];

	fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
	vi.stubGlobal('fetch', fetchMock);
	vi.stubGlobal('WebSocket', MockWebSocket);

	mockVisibilityState('visible');
})

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
	mockVisibilityState('visible');
});

describe('EventQueue', () => {

	describe('constructor', () => {

		it('does not create a WebSocket connection when wsEndpoint is empty', () => {
			new EventQueue(makeOpts({ wsEndpoint: '' }));
			expect(MockWebSocket.instances).toHaveLength(0);
		});

		it('creates a WebSocket connection when wsEndpoint is configured', () => {
			new EventQueue(makeOpts({ wsEndpoint: 'ws://localhost:4242/_tracker/ws' }));
			expect(MockWebSocket.instances).toHaveLength(1);
			expect(MockWebSocket.instances[0].url).toBe('ws://localhost:4242/_tracker/ws');
		});
	});

	describe('connectWs()', () => {

		it('sets wsReady = true on the open event when no apiKey is configured', () => {
			const queue = new EventQueue(makeOpts({ wsEndpoint: 'ws://test' }));
			expect((queue as any).wsReady).toBe(false);

			MockWebSocket.latest().simulateOpen();

			expect((queue as any).wsReady).toBe(true);
		});

		it('does not set wsReady = true on open when apiKey is configured — waits for auth_ok', () => {
			const queue = new EventQueue(makeOpts({ wsEndpoint: 'ws://test', apiKey: 'secret' }));
			MockWebSocket.latest().simulateOpen();

			expect((queue as any).wsReady).toBe(false);
		});

		it('sends auth message first if apiKey is configured', () => {
			const queue = new EventQueue(makeOpts({ wsEndpoint: 'ws://test', apiKey: 'secret' }));
			MockWebSocket.latest().simulateOpen();

			const ws = MockWebSocket.latest();
			expect(ws.send).toHaveBeenCalledOnce();
			const msg = JSON.parse(ws.send.mock.calls[0][0]);
			expect(msg).toEqual({ type: 'auth', key: 'secret' });
		});

		it('does not send auth message if apiKey is empty', () => {
			new EventQueue(makeOpts({ wsEndpoint: 'ws://test', apiKey: '' }));
			MockWebSocket.latest().simulateOpen();
			expect(MockWebSocket.latest().send).not.toHaveBeenCalled();
		});

		it('calls ws.close() if sending auth fails', () => {
			new EventQueue(makeOpts({ wsEndpoint: 'ws://test', apiKey: 'secret' }));
			const ws = MockWebSocket.latest();
			ws.send.mockImplementationOnce(() => {
				throw new Error('Immediate failure');
			});
			ws.simulateOpen();
			expect(ws.close).toHaveBeenCalled();
		});

		it('sends auth message before flushing wsPending events', () => {
			const queue = new EventQueue(makeOpts({ wsEndpoint: 'ws://test', apiKey: 'secret' }));
			const evt = makeEvent();
			(queue as any).wsPending.push(evt);

			const ws = MockWebSocket.latest();
			ws.simulateOpen();
			expect(ws.send).toHaveBeenCalledTimes(1);
			const first = JSON.parse(ws.send.mock.calls[0][0]);
			expect(first.type).toBe('auth');
			expect((queue as any).wsPending).toHaveLength(1);

			ws.simulateMessage({ type: 'auth_ok' });
			expect(ws.send).toHaveBeenCalledTimes(2);
			const second = JSON.parse(ws.send.mock.calls[1][0]);
			expect(second.type).toBe('ingest');
			expect((queue as any).wsPending).toHaveLength(0);
		});

		it('stops reconnection if server closes with 1008 (Unauthorized)', () => {
			const queue = new EventQueue(makeOpts({ wsEndpoint: 'ws://test' }));
			const ws = MockWebSocket.latest();
			ws.simulateOpen();
			ws.simulateClose(1008);
			vi.advanceTimersByTime(5000);
			expect(MockWebSocket.instances).toHaveLength(1);
			expect((queue as any).stopped).toBe(true);
		});

		it('flush wsPending on open if there are buffered events', () => {
			const queue = new EventQueue(makeOpts({ wsEndpoint: 'ws://test' }));
			const evt = makeEvent();
			(queue as any).wsPending.push(evt);

			MockWebSocket.latest().simulateOpen();

			const ws = MockWebSocket.latest();
			expect(ws.send).toHaveBeenCalledOnce();
			const sent = JSON.parse(ws.send.mock.calls[0][0]);
			expect(sent.events).toHaveLength(1);
			expect((queue as any).wsPending).toHaveLength(0);
		});

		it('does not call send on open when wsPending is empty', () => {
			new EventQueue(makeOpts({ wsEndpoint: 'ws://test' }));
			MockWebSocket.latest().simulateOpen();
			expect(MockWebSocket.latest().send).not.toHaveBeenCalled();
		});

		it('sets wsReady = false and ws = null on the close event', () => {
			const queue = new EventQueue(makeOpts({ wsEndpoint: 'ws://test' }));
			MockWebSocket.latest().simulateOpen();

			MockWebSocket.latest().simulateClose();

			expect((queue as any).wsReady).toBe(false);
			expect((queue as any).ws).toBeNull();
		});

		it('Attempt to reconnect after 3s at the close event', () => {
			new EventQueue(makeOpts({ wsEndpoint: 'ws://test' }));
			MockWebSocket.latest().simulateOpen();
			MockWebSocket.latest().simulateClose();

			expect(MockWebSocket.instances).toHaveLength(1);

			vi.advanceTimersByTime(5000);

			expect(MockWebSocket.instances).toHaveLength(2);
		})

		it('does not recreate the socket when wsEndpoint is cleared before reconnect', () => {
			const queue = new EventQueue(makeOpts({ wsEndpoint: 'ws://test' }));
			MockWebSocket.latest().simulateOpen();
			MockWebSocket.latest().simulateClose();

			(queue as any).opts.wsEndpoint = '';
			vi.advanceTimersByTime(5000);

			expect(MockWebSocket.instances).toHaveLength(1);
		});

		it('sets wsReady = true and drains wsPending on auth_ok message', () => {
			const queue = new EventQueue(makeOpts({ wsEndpoint: 'ws://test', apiKey: 'secret' }));
			const evt = makeEvent();
			(queue as any).wsPending.push(evt);

			const ws = MockWebSocket.latest();
			ws.simulateOpen();
			expect((queue as any).wsReady).toBe(false);

			ws.simulateMessage({ type: 'auth_ok' });

			expect((queue as any).wsReady).toBe(true);
			expect((queue as any).wsPending).toHaveLength(0);
			const sent = JSON.parse(ws.send.mock.calls[1][0]);
			expect(sent.type).toBe('ingest');
		});

		it('sets wsReady = false on the error event', () => {
			const queue = new EventQueue(makeOpts({ wsEndpoint: 'ws://test' }));
			MockWebSocket.latest().simulateOpen();
			expect((queue as any).wsReady).toBe(true);

			MockWebSocket.latest().simulateError();

			expect((queue as any).wsReady).toBe(false);
		});
	});

	describe('sendViaWs()', () => {

		it('buffers in wsPending when ws is not ready', () => {
			const queue = new EventQueue(makeOpts({ wsEndpoint: 'ws://test' }));
			const evt = makeEvent();

			(queue as any).sendViaWs([evt]);

			expect((queue as any).wsPending).toContain(evt);
			expect(MockWebSocket.latest().send).not.toHaveBeenCalled();
		});

		it('buffers in wsPending when ws is null', () => {
			const queue = new EventQueue(makeOpts({ wsEndpoint: 'ws://test' }));
			(queue as any).ws = null;
			(queue as any).wsReady = false;
			const evt = makeEvent();

			(queue as any).sendViaWs([evt]);

			expect((queue as any).wsPending).toContain(evt);
		});

		it('sends via ws.send when the socket is ready', () => {
			const queue = new EventQueue(makeOpts({ wsEndpoint: 'ws://test' }));
			MockWebSocket.latest().simulateOpen();
			const evt = makeEvent();

			(queue as any).sendViaWs([evt]);

			expect(MockWebSocket.latest().send).toHaveBeenCalledOnce();
			const payload = JSON.parse(MockWebSocket.latest().send.mock.calls[0][0]);
			expect(payload.type).toBe('ingest');
			expect(payload.events[0]).toMatchObject({ payload: evt.payload });
		});

		it('Requeue events if ws.send throws an exception', () => {
			const queue = new EventQueue(makeOpts({ wsEndpoint: 'ws://test' }));
			MockWebSocket.latest().simulateOpen();
			MockWebSocket.latest().send.mockImplementation(() => {
				throw new Error('socket unexpectedly closed');
			});
			const evt = makeEvent();

			(queue as any).sendViaWs([evt]);

			expect((queue as any).queue).toContain(evt);
		});
	});

	describe('init()', () => {

		it('schedules the first flush after flushInterval ms', () => {
			const queue = new EventQueue(makeOpts());
			queue.enqueue(makeEvent());
			queue.init();

			expect(fetchMock).not.toHaveBeenCalled();

			vi.advanceTimersByTime(5000);

			expect(fetchMock).toHaveBeenCalledOnce();
		});
	});

	describe('enqueue()', () => {

		it('adds the event to the internal queue', () => {
			const queue = new EventQueue(makeOpts({ batchSize: 10 }));
			const evt = makeEvent();
			queue.enqueue(evt);
			expect((queue as any).queue).toContain(evt);
		});

		it('does not trigger flush when batchSize is not reached', () => {
			const queue = new EventQueue(makeOpts({ batchSize: 3 }));
			queue.enqueue(makeEvent());
			queue.enqueue(makeEvent());
			expect(fetchMock).not.toHaveBeenCalled();
		});

		it('triggers flush immediately when batchSize is reached', async () => {
			const queue = new EventQueue(makeOpts({ batchSize: 2 }));
			fetchMock.mockResolvedValue(new Response());

			queue.enqueue(makeEvent());
			queue.enqueue(makeEvent());

			await flushPromises();
			expect(fetchMock).toHaveBeenCalledOnce();
		});
	});

	describe('flush() — initial guards', () => {

		it('does not call fetch when the queue is empty', () => {
			const queue = new EventQueue(makeOpts());
			queue.flush();
			expect(fetchMock).not.toHaveBeenCalled();
		});

		it('schedules the next flush even when the queue is empty', () => {
			const queue = new EventQueue(makeOpts());
			queue.flush();
			expect((queue as any).timer).not.toBeNull();
		});

		it('does not call fetch when a send is already in progress (sending = true)', () => {
			const queue = new EventQueue(makeOpts());
			queue.enqueue(makeEvent());
			(queue as any).sending = true;

			queue.flush();

			expect(fetchMock).not.toHaveBeenCalled();
		});

		it('clears the pending timer at the beginning of flush()', () => {
			const queue = new EventQueue(makeOpts());
			queue.init();
			const timerBefore = (queue as any).timer;
			expect(timerBefore).not.toBeNull();

			queue.enqueue(makeEvent());
			queue.flush();

			expect((queue as any).timer).not.toBe(timerBefore);
		});
	});

	describe('flush() — WebSocket mode', () => {

		it('sends via WebSocket and does not call fetch', async () => {
			const queue = new EventQueue(makeOpts({ wsEndpoint: 'ws://test' }));
			MockWebSocket.latest().simulateOpen();
			queue.enqueue(makeEvent());

			queue.flush();
			await flushPromises();

			expect(fetchMock).not.toHaveBeenCalled();
			expect(MockWebSocket.latest().send).toHaveBeenCalledOnce();
		});

		it('the payload sent via WS contains the correct events', () => {
			const queue = new EventQueue(makeOpts({ wsEndpoint: 'ws://test' }));
			MockWebSocket.latest().simulateOpen();
			const evt = makeEvent();
			queue.enqueue(evt);

			queue.flush();

			const raw = MockWebSocket.latest().send.mock.calls[0][0];
			const parsed = JSON.parse(raw);
			expect(parsed.type).toBe('ingest')
			expect(parsed.events[0].payload).toEqual(evt.payload);
		});

		it('reset sending = false after sending WS', () => {
			const queue = new EventQueue(makeOpts({ wsEndpoint: 'ws://test' }));
			MockWebSocket.latest().simulateOpen();
			queue.enqueue(makeEvent());

			queue.flush();

			expect((queue as any).sending).toBe(false);
		});

		it('schedules the next flush after sending WS', () => {
			const queue = new EventQueue(makeOpts({ wsEndpoint: 'ws://test' }));
			MockWebSocket.latest().simulateOpen();
			queue.enqueue(makeEvent());

			queue.flush();

			expect((queue as any).timer).not.toBeNull();
		});
	});

	describe('flush() — sendBeacon mode (page hidden)', () => {

		let sendBeaconMock: ReturnType<typeof vi.fn>;

		beforeEach(() => {
			global.Blob = window.Blob;
			sendBeaconMock = vi.fn().mockReturnValue(true);
			Object.defineProperty(navigator, 'sendBeacon', {
				configurable: true,
				writable: true,
				value: sendBeaconMock,
			});
			mockVisibilityState('hidden');
		});

		afterEach(() => {
			Object.defineProperty(navigator, 'sendBeacon', {
				configurable: true,
				writable: true,
				value: undefined,
			});
		});

		it('uses sendBeacon instead of fetch when the page is hidden', () => {
			const queue = new EventQueue(makeOpts());
			queue.enqueue(makeEvent());

			queue.flush();

			expect(sendBeaconMock).toHaveBeenCalledOnce();
			expect(fetchMock).not.toHaveBeenCalled();
		});

		it('sends batch + remaining events in a single beacon', () => {
			let capturedBody = '';
			const OriginalBlob = globalThis.Blob;
			vi.stubGlobal('Blob', class extends OriginalBlob {
				constructor(parts: BlobPart[], options?: BlobPropertyBag) {
					super(parts, options);
					capturedBody = parts[0] as string;
				}
			});

			const queue = new EventQueue(makeOpts({ batchSize: 2 }));
			(queue as any).queue.push(makeEvent('a'), makeEvent('b'), makeEvent('c'));

			queue.flush();

			const [endpoint] = sendBeaconMock.mock.calls[0];
			expect(endpoint).toBe('/_tracker/events');

			const body = JSON.parse(capturedBody);
			expect(body.events).toHaveLength(3);
		});

		it('re-queues events when sendBeacon returns false', () => {
			sendBeaconMock.mockReturnValue(false);
			const queue = new EventQueue(makeOpts());
			const evt = makeEvent();
			queue.enqueue(evt);

			queue.flush();

			expect((queue as any).queue).toContain(evt);
		});

		it('the queue is empty after a successful sendBeacon', () => {
			const queue = new EventQueue(makeOpts());
			queue.enqueue(makeEvent());

			queue.flush();

			expect((queue as any).queue).toHaveLength(0);
		});

		it('schedules the next flush also after sendBeacon', () => {
			const queue = new EventQueue(makeOpts());
			queue.enqueue(makeEvent());

			queue.flush();

			expect((queue as any).timer).not.toBeNull();
		});
	});

	describe('flush() — fetch mode', () => {

		it('calls fetch with the correct writeEndpoint', async () => {
			const queue = new EventQueue(makeOpts({ writeEndpoint: '/api/track' }));
			queue.enqueue(makeEvent());

			queue.flush();
			await flushPromises();

			expect(fetchMock).toHaveBeenCalledWith(
				'/api/track',
				expect.objectContaining({ method: 'POST' }),
			);
		});

		it('the body is a JSON with the structure { type: "ingest", events: [...] }', async () => {
			const queue = new EventQueue(makeOpts());
			const evt = makeEvent();
			queue.enqueue(evt);

			queue.flush();
			await flushPromises();

			const [, init] = fetchMock.mock.calls[0];
			const body = JSON.parse(init.body);
			expect(body.type).toBe('ingest');
			expect(body.events).toHaveLength(1);
			expect(body.events[0].payload).toEqual(evt.payload);
		});

		it('includes Content-Type: application/json in the headers', async () => {
			const queue = new EventQueue(makeOpts());
			queue.enqueue(makeEvent());

			queue.flush();
			await flushPromises();

			const [, init] = fetchMock.mock.calls[0];
			expect(init.headers['Content-Type']).toBe('application/json');
		});

		it('includes X-Tracker-Key when apiKey is configured', async () => {
			const queue = new EventQueue(makeOpts({ apiKey: 'secret-key' }));
			queue.enqueue(makeEvent());

			queue.flush();
			await flushPromises();

			const [, init] = fetchMock.mock.calls[0];
			expect(init.headers['X-Tracker-Key']).toBe('secret-key');
		});

		it('does not include X-Tracker-Key when apiKey is empty', async () => {
			const queue = new EventQueue(makeOpts({ apiKey: '' }));
			queue.enqueue(makeEvent());

			queue.flush();
			await flushPromises();

			const [, init] = fetchMock.mock.calls[0];
			expect(init.headers).not.toHaveProperty('X-Tracker-Key');
		});

		it('sends keepalive: true', async () => {
			const queue = new EventQueue(makeOpts());
			queue.enqueue(makeEvent());

			queue.flush();
			await flushPromises();

			const [, init] = fetchMock.mock.calls[0];
			expect(init.keepalive).toBe(true);
		});

		it('sets sending = false in finally after success', async () => {
			const queue = new EventQueue(makeOpts());
			queue.enqueue(makeEvent());

			queue.flush();
			expect((queue as any).sending).toBe(true);

			await flushPromises();
			expect((queue as any).sending).toBe(false);
		});

		it('schedules the next flush in finally', async () => {
			const queue = new EventQueue(makeOpts());
			queue.enqueue(makeEvent());

			queue.flush();
			await flushPromises();

			expect((queue as any).timer).not.toBeNull();
		});

		it('re-queues events (unshift) when fetch rejects', async () => {
			const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => { });
			fetchMock.mockRejectedValue(new Error('Network error'));
			const queue = new EventQueue(makeOpts());
			const evt = makeEvent();
			queue.enqueue(evt);

			queue.flush();
			await flushPromises();

			expect((queue as any).queue).toContain(evt);
			expect(debugSpy).toHaveBeenCalledWith(expect.stringContaining("[vite-plugin-monitor] Failed to send events, requeueing:"), expect.any(Error));
			debugSpy.mockRestore();
		});

		it('re-queues events (unshift) when server responds with non-2xx status', async () => {
			const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => { });
			fetchMock.mockResolvedValue(new Response(null, { status: 500 }));
			const queue = new EventQueue(makeOpts());
			const evt = makeEvent();
			queue.enqueue(evt);

			queue.flush();
			await flushPromises();

			expect((queue as any).queue).toContain(evt);
			expect(debugSpy).toHaveBeenCalledWith(
				expect.stringContaining('Server responded with 500'),
			);
			debugSpy.mockRestore();
		});

		it('does not re-queue events when server responds with 2xx status', async () => {
			fetchMock.mockResolvedValue(new Response(null, { status: 201 }));
			const queue = new EventQueue(makeOpts());
			const evt = makeEvent();
			queue.enqueue(evt);

			queue.flush();
			await flushPromises();

			expect((queue as any).queue).not.toContain(evt);
		});

		it('sets sending = false in finally also after a fetch error', async () => {
			const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => { });
			fetchMock.mockRejectedValue(new Error('Network error'));
			const queue = new EventQueue(makeOpts());
			queue.enqueue(makeEvent());

			queue.flush();
			await flushPromises();

			expect((queue as any).sending).toBe(false);
			debugSpy.mockRestore();
		});

		it('does not exceed batchSize events per single fetch call', async () => {
			const queue = new EventQueue(makeOpts({ batchSize: 2 }));
			(queue as any).queue.push(makeEvent(), makeEvent(), makeEvent(), makeEvent());

			queue.flush();
			await flushPromises();

			const [, init] = fetchMock.mock.calls[0];
			const body = JSON.parse(init.body);
			expect(body.events).toHaveLength(2);
			expect((queue as any).queue).toHaveLength(2);
		});
	});

	describe('scheduleFlush()', () => {

		it('does not create a second timer when one already exists', () => {
			const queue = new EventQueue(makeOpts());
			queue.init();
			const firstTimer = (queue as any).timer;

			queue.init();
			const secondTimer = (queue as any).timer;

			expect(secondTimer).toBe(firstTimer);
		});

		it('the timer calls flush() when flushInterval expires', async () => {
			const queue = new EventQueue(makeOpts({ flushInterval: 5000 }));
			queue.enqueue(makeEvent());
			queue.init();

			vi.advanceTimersByTime(2999);
			expect(fetchMock).not.toHaveBeenCalled();

			vi.advanceTimersByTime(1);
			await flushPromises();

			expect(fetchMock).toHaveBeenCalledOnce();
		});

		it('clears the timer reference before executing flush()', async () => {
			const queue = new EventQueue(makeOpts());
			queue.enqueue(makeEvent());
			queue.init();

			vi.advanceTimersByTime(5000);
			await flushPromises();

			expect((queue as any).timer).not.toBeNull();
		});
	});

	describe('stop()', () => {
		it('sets stopped = true and prevents new enqueues', () => {
			const queue = new EventQueue(makeOpts());
			queue.stop();
			const evt = makeEvent();
			queue.enqueue(evt);
			expect((queue as any).queue).not.toContain(evt);
		});

		it('clears the timer and sets it to null if it exists', () => {
			const queue = new EventQueue(makeOpts());
			queue.init();
			expect((queue as any).timer).not.toBeNull();
			queue.stop();
			expect((queue as any).timer).toBeNull();
			vi.advanceTimersByTime(BASE_OPTS.flushInterval);
			expect(fetchMock).not.toHaveBeenCalled();
		});

		it('closes the WebSocket connection and sets it to null if it exists', () => {
			const queue = new EventQueue(makeOpts({ wsEndpoint: 'ws://test' }));
			const ws = MockWebSocket.latest();
			expect((queue as any).ws).not.toBeNull();
			queue.stop();
			expect(ws.close).toHaveBeenCalledOnce();
			expect((queue as any).ws).toBeNull();
		});

		it('prevents scheduleFlush from restarting a timer after stop', () => {
			const queue = new EventQueue(makeOpts());
			queue.stop();
			(queue as any).scheduleFlush();
			expect((queue as any).timer).toBeNull();
		});
	});
});
