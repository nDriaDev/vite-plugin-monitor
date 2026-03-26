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

	simulateOpen() {
		this.readyState = 1;
		this.listeners.get('open')?.forEach(h => {
			typeof h === 'function' ? h(this.generateEvent('open')) : h.handleEvent(this.generateEvent('open'));
		});
	}

	simulateClose() {
		this.readyState = 3;
		this.listeners.get('close')?.forEach(h => {
			typeof h === 'function' ? h(this.generateEvent('close')) : h.handleEvent(this.generateEvent('close'));
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

		it('non crea una connessione WebSocket se wsEndpoint è vuoto', () => {
			new EventQueue(makeOpts({ wsEndpoint: '' }));
			expect(MockWebSocket.instances).toHaveLength(0);
		});

		it('crea una connessione WebSocket se wsEndpoint è configurato', () => {
			new EventQueue(makeOpts({ wsEndpoint: 'ws://localhost:4242/_tracker/ws' }));
			expect(MockWebSocket.instances).toHaveLength(1);
			expect(MockWebSocket.instances[0].url).toBe('ws://localhost:4242/_tracker/ws');
		});
	});

	describe('connectWs()', () => {

		it('imposta wsReady = true all\'evento open', () => {
			const queue = new EventQueue(makeOpts({ wsEndpoint: 'ws://test' }));
			expect((queue as any).wsReady).toBe(false);

			MockWebSocket.latest().simulateOpen();

			expect((queue as any).wsReady).toBe(true);
		});

		it('svuota wsPending all\'apertura se ci sono eventi bufferizzati', () => {
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

		it('non chiama send all\'apertura se wsPending è vuoto', () => {
			new EventQueue(makeOpts({ wsEndpoint: 'ws://test' }));
			MockWebSocket.latest().simulateOpen();
			expect(MockWebSocket.latest().send).not.toHaveBeenCalled();
		});

		it('imposta wsReady = false e ws = null all\'evento close', () => {
			const queue = new EventQueue(makeOpts({ wsEndpoint: 'ws://test' }));
			MockWebSocket.latest().simulateOpen();

			MockWebSocket.latest().simulateClose();

			expect((queue as any).wsReady).toBe(false);
			expect((queue as any).ws).toBeNull();
		});

		it('tenta la riconnessione dopo 3s all\'evento close', () => {
			new EventQueue(makeOpts({ wsEndpoint: 'ws://test' }));
			MockWebSocket.latest().simulateOpen();
			MockWebSocket.latest().simulateClose();

			expect(MockWebSocket.instances).toHaveLength(1);

			vi.advanceTimersByTime(3000);

			expect(MockWebSocket.instances).toHaveLength(2);
		})

		it('non ricrea il socket se wsEndpoint viene svuotato prima del reconnect', () => {
			const queue = new EventQueue(makeOpts({ wsEndpoint: 'ws://test' }));
			MockWebSocket.latest().simulateOpen();
			MockWebSocket.latest().simulateClose();

			(queue as any).opts.wsEndpoint = '';
			vi.advanceTimersByTime(3000);

			expect(MockWebSocket.instances).toHaveLength(1);
		});

		it('imposta wsReady = false all\'evento error', () => {
			const queue = new EventQueue(makeOpts({ wsEndpoint: 'ws://test' }));
			MockWebSocket.latest().simulateOpen();
			expect((queue as any).wsReady).toBe(true);

			MockWebSocket.latest().simulateError();

			expect((queue as any).wsReady).toBe(false);
		});
	});

	describe('sendViaWs()', () => {

		it('bufferizza in wsPending se ws non è pronto', () => {
			const queue = new EventQueue(makeOpts({ wsEndpoint: 'ws://test' }));
			const evt = makeEvent();

			(queue as any).sendViaWs([evt]);

			expect((queue as any).wsPending).toContain(evt);
			expect(MockWebSocket.latest().send).not.toHaveBeenCalled();
		});

		it('bufferizza in wsPending se ws è null', () => {
			const queue = new EventQueue(makeOpts({ wsEndpoint: 'ws://test' }));
			(queue as any).ws = null;
			(queue as any).wsReady = false;
			const evt = makeEvent();

			(queue as any).sendViaWs([evt]);

			expect((queue as any).wsPending).toContain(evt);
		});

		it('invia via ws.send se il socket è pronto', () => {
			const queue = new EventQueue(makeOpts({ wsEndpoint: 'ws://test' }));
			MockWebSocket.latest().simulateOpen();
			const evt = makeEvent();

			(queue as any).sendViaWs([evt]);

			expect(MockWebSocket.latest().send).toHaveBeenCalledOnce();
			const payload = JSON.parse(MockWebSocket.latest().send.mock.calls[0][0]);
			expect(payload.events[0]).toMatchObject({ payload: evt.payload });
		});

		it('rimette gli eventi in coda se ws.send lancia un\'eccezione', () => {
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

		it('schedula il primo flush dopo flushInterval ms', () => {
			const queue = new EventQueue(makeOpts());
			queue.enqueue(makeEvent());
			queue.init();

			expect(fetchMock).not.toHaveBeenCalled();

			vi.advanceTimersByTime(5000);

			expect(fetchMock).toHaveBeenCalledOnce();
		});
	});

	describe('enqueue()', () => {

		it('aggiunge l\'evento alla coda interna', () => {
			const queue = new EventQueue(makeOpts({ batchSize: 10 }));
			const evt = makeEvent();
			queue.enqueue(evt);
			expect((queue as any).queue).toContain(evt);
		});

		it('non triggera flush se non si raggiunge batchSize', () => {
			const queue = new EventQueue(makeOpts({ batchSize: 3 }));
			queue.enqueue(makeEvent());
			queue.enqueue(makeEvent());
			expect(fetchMock).not.toHaveBeenCalled();
		});

		it('triggera flush immediatamente al raggiungimento di batchSize', async () => {
			const queue = new EventQueue(makeOpts({ batchSize: 2 }));
			fetchMock.mockResolvedValue(new Response());

			queue.enqueue(makeEvent());
			queue.enqueue(makeEvent());

			await flushPromises();
			expect(fetchMock).toHaveBeenCalledOnce();
		});
	});

	describe('flush() — guardie iniziali', () => {

		it('non chiama fetch se la coda è vuota', () => {
			const queue = new EventQueue(makeOpts());
			queue.flush();
			expect(fetchMock).not.toHaveBeenCalled();
		});

		it('schedula il prossimo flush anche se la coda è vuota', () => {
			const queue = new EventQueue(makeOpts());
			queue.flush();
			expect((queue as any).timer).not.toBeNull();
		});

		it('non chiama fetch se un invio è già in corso (sending = true)', () => {
			const queue = new EventQueue(makeOpts());
			queue.enqueue(makeEvent());
			(queue as any).sending = true;

			queue.flush();

			expect(fetchMock).not.toHaveBeenCalled();
		});

		it('cancella il timer pendente all\'inizio di flush()', () => {
			const queue = new EventQueue(makeOpts());
			queue.init();
			const timerBefore = (queue as any).timer;
			expect(timerBefore).not.toBeNull();

			queue.enqueue(makeEvent());
			queue.flush();

			expect((queue as any).timer).not.toBe(timerBefore);
		});
	});

	describe('flush() — modalità WebSocket', () => {

		it('invia via WebSocket e non chiama fetch', async () => {
			const queue = new EventQueue(makeOpts({ wsEndpoint: 'ws://test' }));
			MockWebSocket.latest().simulateOpen();
			queue.enqueue(makeEvent());

			queue.flush();
			await flushPromises();

			expect(fetchMock).not.toHaveBeenCalled();
			expect(MockWebSocket.latest().send).toHaveBeenCalledOnce();
		});

		it('il payload inviato via WS contiene gli eventi corretti', () => {
			const queue = new EventQueue(makeOpts({ wsEndpoint: 'ws://test' }));
			MockWebSocket.latest().simulateOpen();
			const evt = makeEvent();
			queue.enqueue(evt);

			queue.flush();

			const raw = MockWebSocket.latest().send.mock.calls[0][0];
			const parsed = JSON.parse(raw);
			expect(parsed.events[0].payload).toEqual(evt.payload);
		});

		it('resetta sending = false dopo l\'invio WS', () => {
			const queue = new EventQueue(makeOpts({ wsEndpoint: 'ws://test' }));
			MockWebSocket.latest().simulateOpen();
			queue.enqueue(makeEvent());

			queue.flush();

			expect((queue as any).sending).toBe(false);
		});

		it('schedula il prossimo flush dopo l\'invio WS', () => {
			const queue = new EventQueue(makeOpts({ wsEndpoint: 'ws://test' }));
			MockWebSocket.latest().simulateOpen();
			queue.enqueue(makeEvent());

			queue.flush();

			expect((queue as any).timer).not.toBeNull();
		});
	});

	describe('flush() — modalità sendBeacon (pagina nascosta)', () => {

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

		it('usa sendBeacon invece di fetch quando la pagina è nascosta', () => {
			const queue = new EventQueue(makeOpts());
			queue.enqueue(makeEvent());

			queue.flush();

			expect(sendBeaconMock).toHaveBeenCalledOnce();
			expect(fetchMock).not.toHaveBeenCalled();
		});

		it('invia batch + eventi rimanenti in un unico beacon', () => {
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

		it('rimette gli eventi in coda se sendBeacon restituisce false', () => {
			sendBeaconMock.mockReturnValue(false);
			const queue = new EventQueue(makeOpts());
			const evt = makeEvent();
			queue.enqueue(evt);

			queue.flush();

			expect((queue as any).queue).toContain(evt);
		});

		it('la coda è vuota dopo un sendBeacon andato a buon fine', () => {
			const queue = new EventQueue(makeOpts());
			queue.enqueue(makeEvent());

			queue.flush();

			expect((queue as any).queue).toHaveLength(0);
		});

		it('schedula il prossimo flush anche dopo sendBeacon', () => {
			const queue = new EventQueue(makeOpts());
			queue.enqueue(makeEvent());

			queue.flush();

			expect((queue as any).timer).not.toBeNull();
		});
	});

	describe('flush() — modalità fetch', () => {

		it('chiama fetch con il writeEndpoint corretto', async () => {
			const queue = new EventQueue(makeOpts({ writeEndpoint: '/api/track' }));
			queue.enqueue(makeEvent());

			queue.flush();
			await flushPromises();

			expect(fetchMock).toHaveBeenCalledWith(
				'/api/track',
				expect.objectContaining({ method: 'POST' }),
			);
		});

		it('il body è un JSON con la struttura { events: [...] }', async () => {
			const queue = new EventQueue(makeOpts());
			const evt = makeEvent();
			queue.enqueue(evt);

			queue.flush();
			await flushPromises();

			const [, init] = fetchMock.mock.calls[0];
			const body = JSON.parse(init.body);
			expect(body.events).toHaveLength(1);
			expect(body.events[0].payload).toEqual(evt.payload);
		});

		it('include Content-Type: application/json negli header', async () => {
			const queue = new EventQueue(makeOpts());
			queue.enqueue(makeEvent());

			queue.flush();
			await flushPromises();

			const [, init] = fetchMock.mock.calls[0];
			expect(init.headers['Content-Type']).toBe('application/json');
		});

		it('include X-Tracker-Key se apiKey è configurato', async () => {
			const queue = new EventQueue(makeOpts({ apiKey: 'secret-key' }));
			queue.enqueue(makeEvent());

			queue.flush();
			await flushPromises();

			const [, init] = fetchMock.mock.calls[0];
			expect(init.headers['X-Tracker-Key']).toBe('secret-key');
		});

		it('non include X-Tracker-Key se apiKey è vuoto', async () => {
			const queue = new EventQueue(makeOpts({ apiKey: '' }));
			queue.enqueue(makeEvent());

			queue.flush();
			await flushPromises();

			const [, init] = fetchMock.mock.calls[0];
			expect(init.headers).not.toHaveProperty('X-Tracker-Key');
		});

		it('invia keepalive: true', async () => {
			const queue = new EventQueue(makeOpts());
			queue.enqueue(makeEvent());

			queue.flush();
			await flushPromises();

			const [, init] = fetchMock.mock.calls[0];
			expect(init.keepalive).toBe(true);
		});

		it('imposta sending = false nel finally dopo il successo', async () => {
			const queue = new EventQueue(makeOpts());
			queue.enqueue(makeEvent());

			queue.flush();
			expect((queue as any).sending).toBe(true);

			await flushPromises();
			expect((queue as any).sending).toBe(false);
		});

		it('schedula il prossimo flush nel finally', async () => {
			const queue = new EventQueue(makeOpts());
			queue.enqueue(makeEvent());

			queue.flush();
			await flushPromises();

			expect((queue as any).timer).not.toBeNull();
		});

		it('rimette gli eventi in coda (unshift) se fetch rigetta', async () => {
			fetchMock.mockRejectedValue(new Error('Network error'));
			const queue = new EventQueue(makeOpts());
			const evt = makeEvent();
			queue.enqueue(evt);

			queue.flush();
			await flushPromises();

			expect((queue as any).queue).toContain(evt);
		});

		it('imposta sending = false nel finally anche dopo un errore fetch', async () => {
			fetchMock.mockRejectedValue(new Error('Network error'));
			const queue = new EventQueue(makeOpts());
			queue.enqueue(makeEvent());

			queue.flush();
			await flushPromises();

			expect((queue as any).sending).toBe(false);
		});

		it('non supera batchSize eventi per singola chiamata fetch', async () => {
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

		it('non crea un secondo timer se ne esiste già uno', () => {
			const queue = new EventQueue(makeOpts());
			queue.init();
			const firstTimer = (queue as any).timer;

			queue.init();
			const secondTimer = (queue as any).timer;

			expect(secondTimer).toBe(firstTimer);
		});

		it('il timer chiama flush() allo scadere di flushInterval', async () => {
			const queue = new EventQueue(makeOpts({ flushInterval: 3000 }));
			queue.enqueue(makeEvent());
			queue.init();

			vi.advanceTimersByTime(2999);
			expect(fetchMock).not.toHaveBeenCalled();

			vi.advanceTimersByTime(1);
			await flushPromises();

			expect(fetchMock).toHaveBeenCalledOnce();
		});

		it('azzera il riferimento al timer prima di eseguire flush()', async () => {
			const queue = new EventQueue(makeOpts());
			queue.enqueue(makeEvent());
			queue.init();

			vi.advanceTimersByTime(5000);
			await flushPromises();

			expect((queue as any).timer).not.toBeNull();
		});
	});
});
