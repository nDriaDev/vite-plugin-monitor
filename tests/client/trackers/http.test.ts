import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { HttpPayload, LogLevel } from '../../../src/types';
import { setupHttpTracker } from '../../../src/client/trackers/http';

async function flushPromises() {
	for (let i = 0; i < 5; i++) {
		await Promise.resolve();
	}
}

type CapturedEvent = { payload: HttpPayload; level: LogLevel };

function makeOnEvent(): { onEvent: (p: HttpPayload, l: LogLevel) => void; events: CapturedEvent[] } {
	const events: CapturedEvent[] = [];
	return {
		events,
		onEvent: (payload, level) => events.push({ payload, level }),
	};
}

let teardown: () => void;

afterEach(() => {
	teardown?.();
});

describe('patchFetch', () => {
	let originalFetch: typeof window.fetch;

	beforeEach(() => {
		originalFetch = window.fetch;
	});

	afterEach(() => {
		window.fetch = originalFetch;
	});

	it('intercepts fetch calls and emits the correct payload', async () => {
		const { onEvent, events } = makeOnEvent();
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
		teardown = setupHttpTracker([], true, onEvent);

		await window.fetch('/api/data');
		await flushPromises();

		expect(events).toHaveLength(1);
		expect(events[0].payload.url).toBe('/api/data');
		expect(events[0].payload.method).toBe('GET');
		expect(events[0].payload.status).toBe(200);
		expect(typeof events[0].payload.duration).toBe('number');
		expect(events[0].level).toBe('info');

		vi.unstubAllGlobals();
	});

	it('URLs in ignoreUrls bypass the tracker and call the original fetch', async () => {
		const { onEvent, events } = makeOnEvent();
		const mockFetch = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
		vi.stubGlobal('fetch', mockFetch);
		teardown = setupHttpTracker(['/_tracker'], true, onEvent);
		await window.fetch('/_tracker/events');
		await flushPromises();

		expect(events).toHaveLength(0);
		expect(mockFetch).toHaveBeenCalledTimes(1);
		vi.unstubAllGlobals();
	});

	it('status 2xx -> level "info"', async () => {
		const { onEvent, events } = makeOnEvent();
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 201 })));
		teardown = setupHttpTracker([], true, onEvent);
		await window.fetch('/api/resource');
		await flushPromises();
		expect(events[0].level).toBe('info');
		vi.unstubAllGlobals();
	});

	it('status 4xx -> level "warn"', async () => {
		const { onEvent, events } = makeOnEvent();
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 404 })));
		teardown = setupHttpTracker([], true, onEvent);
		await window.fetch('/api/missing');
		await flushPromises();

		expect(events[0].level).toBe('warn');
		vi.unstubAllGlobals();
	});

	it('status 5xx -> level "error"', async () => {
		const { onEvent, events } = makeOnEvent();
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 503 })));
		teardown = setupHttpTracker([], true, onEvent);
		await window.fetch('/api/fail');
		await flushPromises();

		expect(events[0].level).toBe('error');
		vi.unstubAllGlobals();
	});

	it('fetch that rejects -> emits error payload and rethrows', async () => {
		const { onEvent, events } = makeOnEvent();
		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Network error')));
		teardown = setupHttpTracker([], true, onEvent);
		await expect(window.fetch('/api/down')).rejects.toThrow('Network error');
		await flushPromises();

		expect(events).toHaveLength(1);
		expect(events[0].level).toBe('error');
		expect(events[0].payload.error).toContain('Network error');
		expect(events[0].payload.url).toBe('/api/down');
		vi.unstubAllGlobals();
	});

	it('captureRequestHeaders: true -> sanitized headers included in payload', async () => {
		const { onEvent, events } = makeOnEvent();
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
		teardown = setupHttpTracker([], {
			captureRequestHeaders: true,
		}, onEvent);
		await window.fetch('/api/data', {
			headers: { 'Content-Type': 'application/json', 'X-Custom': 'value' },
		});
		await flushPromises();

		expect(events[0].payload.requestHeaders).toBeDefined();
		expect(events[0].payload.requestHeaders!['content-type']).toBe('application/json');
		expect(events[0].payload.requestHeaders!['x-custom']).toBe('value');
		vi.unstubAllGlobals();
	});

	it('sensitive headers (authorization, cookie, x-api-key...) are excluded', async () => {
		const { onEvent, events } = makeOnEvent();
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
		teardown = setupHttpTracker([], {
			captureRequestHeaders: true,
		}, onEvent);
		await window.fetch('/api/data', {
			headers: {
				'Authorization': 'Bearer secret',
				'Cookie': 'session=abc',
				'X-Api-Key': 'key123',
				'X-Auth-Token': 'tok',
				'Content-Type': 'application/json',
			},
		});
		await flushPromises();

		const headers = events[0].payload.requestHeaders!;
		expect(headers['authorization']).toBeUndefined();
		expect(headers['cookie']).toBeUndefined();
		expect(headers['x-api-key']).toBeUndefined();
		expect(headers['x-auth-token']).toBeUndefined();
		expect(headers['content-type']).toBe('application/json');
		vi.unstubAllGlobals();
	});

	it('captureRequestBody: true -> body included in payload', async () => {
		const { onEvent, events } = makeOnEvent();
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
		teardown = setupHttpTracker([], {
			captureRequestBody: true,
		}, onEvent);

		await window.fetch('/api/data', {
			method: 'POST',
			body: JSON.stringify({ user: 'test' }),
		});
		await flushPromises();

		expect(events[0].payload.requestBody).toEqual({ user: 'test' });
		vi.unstubAllGlobals();
	});

	it('captureResponseBody: true -> response body cloned', async () => {
		const { onEvent, events } = makeOnEvent();
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ result: 'ok' }), {
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			})
		));
		teardown = setupHttpTracker([], {
			captureResponseBody: true,
		}, onEvent);

		await window.fetch('/api/data');
		await flushPromises();

		expect(events[0].payload.responseBody).toEqual({ result: 'ok' });
		vi.unstubAllGlobals();
	});

	it('JSON body with sensitive keys (password, token, card...) is redacted', async () => {
		const { onEvent, events } = makeOnEvent();
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
		teardown = setupHttpTracker([], {
			captureRequestBody: true,
		}, onEvent);

		await window.fetch('/api/login', {
			method: 'POST',
			body: JSON.stringify({ username: 'mario', password: 'secret123', token: 'abc' }),
		});
		await flushPromises();

		const body = events[0].payload.requestBody as Record<string, unknown>;
		expect(body.username).toBe('mario');
		expect(body.password).toBe('[REDACTED]');
		expect(body.token).toBe('[REDACTED]');
		vi.unstubAllGlobals();
	});

	it('JSON body with null, undefined and arrays is redacted correctly (redactBody recursion)', async () => {
		const { onEvent, events } = makeOnEvent();
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
		teardown = setupHttpTracker([], { captureRequestBody: true }, onEvent);

		await window.fetch('/api/data', {
			method: 'POST',
			body: JSON.stringify({
				nothing: null,
				items: [{ password: 'secret' }, { label: 'safe' }],
			}),
		});
		await flushPromises();

		const body = events[0].payload.requestBody as any;
		expect(body.nothing).toBeNull();
		expect(body.items[0].password).toBe('[REDACTED]');
		expect(body.items[1].label).toBe('safe');
		vi.unstubAllGlobals();
	});

	it('captureRequestBody: true with null body does not include requestBody in payload', async () => {
		const { onEvent, events } = makeOnEvent();
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
		teardown = setupHttpTracker([], { captureRequestBody: true }, onEvent);

		await window.fetch('/api/data', { method: 'POST' });
		await flushPromises();

		expect(events[0].payload.requestBody).toBeUndefined();
		vi.unstubAllGlobals();
	});

	it('valid JSON body beyond maxBodySize is truncated after serialization', async () => {
		const { onEvent, events } = makeOnEvent();
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
		teardown = setupHttpTracker([], {
			captureRequestBody: true,
			maxBodySize: 10,
		}, onEvent);

		await window.fetch('/api/data', {
			method: 'POST',
			body: JSON.stringify({ username: 'mario-molto-lungo' }),
		});
		await flushPromises();

		const body = events[0].payload.requestBody as string;
		expect(typeof body).toBe('string');
		expect(body).toContain('…[truncated');
		vi.unstubAllGlobals();
	});

	it('captureResponseHeaders: true -> sanitized response headers included in payload', async () => {
		const { onEvent, events } = makeOnEvent();
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
			new Response(null, {
				status: 200,
				headers: {
					'Content-Type': 'application/json',
					'X-Request-Id': 'req-99',
					'Authorization': 'Bearer leak',
				}
			})
		));
		teardown = setupHttpTracker([], { captureResponseHeaders: true }, onEvent);

		await window.fetch('/api/data');
		await flushPromises();

		const headers = events[0].payload.responseHeaders!;
		expect(headers).toBeDefined();
		expect(headers['content-type']).toBe('application/json');
		expect(headers['x-request-id']).toBe('req-99');
		expect(headers['authorization']).toBeUndefined();
		vi.unstubAllGlobals();
	});

	it('captureResponseBody: response non leggibile -> responseBody "[unreadable]"', async () => {
		const { onEvent, events } = makeOnEvent();

		const brokenResponse = new Response('data', { status: 200 });
		const cloneSpy = vi.spyOn(brokenResponse, 'clone').mockReturnValue({
			text: () => { throw new Error('stream already consumed'); },
		} as any);

		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(brokenResponse));
		teardown = setupHttpTracker([], { captureResponseBody: true }, onEvent);

		await window.fetch('/api/data');
		await flushPromises();

		expect(events[0].payload.responseBody).toBe('[unreadable]');
		cloneSpy.mockRestore();
		vi.unstubAllGlobals();
	});

	it('body beyond maxBodySize is truncated', async () => {
		const { onEvent, events } = makeOnEvent();
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
		teardown = setupHttpTracker([], {
			captureRequestBody: true,
			maxBodySize: 10,
		}, onEvent);

		const longBody = 'a'.repeat(50);
		await window.fetch('/api/data', { method: 'POST', body: longBody });
		await flushPromises();

		const body = events[0].payload.requestBody as string;
		expect(body).toContain('…[truncated');
		vi.unstubAllGlobals();
	});

	it('body ReadableStream -> "[ReadableStream - not captured]"', async () => {
		const { onEvent, events } = makeOnEvent();
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
		teardown = setupHttpTracker([], {
			captureRequestBody: true,
		}, onEvent);

		const stream = new ReadableStream();
		await window.fetch('/api/data', { method: 'POST', body: stream });
		await flushPromises();

		expect(events[0].payload.requestBody).toBe('[ReadableStream - not captured]');
		vi.unstubAllGlobals();
	});

	it('teardown restores the original window.fetch', async () => {
		const originalFetchBeforePatch = window.fetch;
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
		const savedStubbed = window.fetch;

		const { onEvent } = makeOnEvent();
		const td = setupHttpTracker([], true, onEvent);
		const patchedFetch = window.fetch;

		td();
		expect(window.fetch).toBe(savedStubbed);
		expect(window.fetch).not.toBe(patchedFetch);

		vi.unstubAllGlobals();
		expect(window.fetch).toBe(originalFetchBeforePatch);
	});

	it('accepts a URL object as input', async () => {
		const { onEvent, events } = makeOnEvent();
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
		teardown = setupHttpTracker([], true, onEvent);

		await window.fetch(new URL('http://localhost/api/url-obj'));
		await flushPromises();

		expect(events[0].payload.url).toBe('http://localhost/api/url-obj');
		vi.unstubAllGlobals();
	});

	it('accepts a Request object as input and reads its method and url', async () => {
		const { onEvent, events } = makeOnEvent();
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
		teardown = setupHttpTracker([], true, onEvent);

		await window.fetch(new Request('http://localhost/api/req-obj', { method: 'DELETE' }));
		await flushPromises();

		expect(events[0].payload.url).toBe('http://localhost/api/req-obj');
		expect(events[0].payload.method).toBe('DELETE');
		vi.unstubAllGlobals();
	});
});

describe('headersToRecord', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	function makeTracker(onEvent: (p: HttpPayload, l: LogLevel) => void) {
		return setupHttpTracker([], { captureRequestHeaders: true }, onEvent);
	}

	it('absent headers (undefined) -> requestHeaders is a sanitized empty object', async () => {
		const { onEvent, events } = makeOnEvent();
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
		teardown = makeTracker(onEvent);

		await window.fetch('/api');
		await flushPromises();

		expect(events[0].payload.requestHeaders).toBeDefined();
		expect(events[0].payload.requestHeaders).toEqual({});
	});

	it('Headers instance -> correct record', async () => {
		const { onEvent, events } = makeOnEvent();
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
		teardown = makeTracker(onEvent);

		const headers = new Headers({ 'Accept': 'application/json' });
		await window.fetch('/api', { headers });
		await flushPromises();

		expect(events[0].payload.requestHeaders!['accept']).toBe('application/json');
	});

	it('array of tuples -> correct record', async () => {
		const { onEvent, events } = makeOnEvent();
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
		teardown = makeTracker(onEvent);

		await window.fetch('/api', { headers: [['X-Custom', 'tuple-value']] });
		await flushPromises();

		expect(events[0].payload.requestHeaders!['x-custom']).toBe('tuple-value');
	});

	it('plain object -> correct record', async () => {
		const { onEvent, events } = makeOnEvent();
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
		teardown = makeTracker(onEvent);

		await window.fetch('/api', { headers: { 'X-Plain': 'plain-value' } });
		await flushPromises();

		expect(events[0].payload.requestHeaders!['x-plain']).toBe('plain-value');
	});

	it('duck-type (object with forEach+get) -> correct record', async () => {
		const { onEvent, events } = makeOnEvent();
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
		teardown = makeTracker(onEvent);

		const duckHeaders: any = {
			_data: { 'x-duck': 'duck-value' },
			forEach(cb: (v: string, k: string) => void) {
				for (const [k, v] of Object.entries(this._data)) cb(v as string, k);
			},
			get(k: string) { return (this._data as any)[k] ?? null; },
		};

		await window.fetch('/api', { headers: duckHeaders });
		await flushPromises();

		expect(events[0].payload.requestHeaders!['x-duck']).toBe('duck-value');
	});
});

describe('cloneBody', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	function makeTracker(onEvent: (p: HttpPayload, l: LogLevel) => void) {
		return setupHttpTracker([], { captureRequestBody: true, maxBodySize: 0 }, onEvent);
	}

	it('null/absent body with captureRequestBody: true -> requestBody undefined', async () => {
		const { onEvent, events } = makeOnEvent();
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
		teardown = makeTracker(onEvent);

		await window.fetch('/api', { method: 'POST' });
		await flushPromises();

		expect(events[0].payload.requestBody).toBeUndefined();
	});

	it('string -> returned as-is (after parseBody)', async () => {
		const { onEvent, events } = makeOnEvent();
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
		teardown = makeTracker(onEvent);

		await window.fetch('/api', { method: 'POST', body: 'plain text' });
		await flushPromises();

		expect(events[0].payload.requestBody).toBe('plain text');
	});

	it('URLSearchParams -> toString()', async () => {
		const { onEvent, events } = makeOnEvent();
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
		teardown = makeTracker(onEvent);

		const params = new URLSearchParams({ foo: 'bar', baz: '1' });
		await window.fetch('/api', { method: 'POST', body: params });
		await flushPromises();

		expect(events[0].payload.requestBody).toBe('foo=bar&baz=1');
	});

	it('FormData -> "[FormData]"', async () => {
		const { onEvent, events } = makeOnEvent();
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
		teardown = makeTracker(onEvent);

		const fd = new FormData();
		fd.append('key', 'value');
		await window.fetch('/api', { method: 'POST', body: fd });
		await flushPromises();

		expect(events[0].payload.requestBody).toBe('[FormData]');
	});

	it('Blob -> "[Blob NB]"', async () => {
		const { onEvent, events } = makeOnEvent();
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
		teardown = makeTracker(onEvent);

		const blob = new Blob(['hello'], { type: 'text/plain' });
		await window.fetch('/api', { method: 'POST', body: blob });
		await flushPromises();

		expect(events[0].payload.requestBody).toMatch(/^\[Blob \d+B\]$/);
	});

	it('ArrayBuffer -> "[Binary NB]"', async () => {
		const { onEvent, events } = makeOnEvent();
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
		teardown = makeTracker(onEvent);

		const buf = new ArrayBuffer(16);
		await window.fetch('/api', { method: 'POST', body: buf });
		await flushPromises();

		expect(events[0].payload.requestBody).toMatch(/^\[Binary \d+B\]$/);
	});

	it('body di tipo non supportato -> cloneBody restituisce "" e parseBody lo lascia undefined', async () => {
		const { onEvent, events } = makeOnEvent();
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
		teardown = setupHttpTracker([], { captureRequestBody: true, maxBodySize: 0 }, onEvent);

		await window.fetch('/api/data', {
			method: 'POST',
			body: { foo: 'bar' } as any,
		});
		await flushPromises();

		expect(events[0].payload.requestBody).toBeUndefined();

		vi.unstubAllGlobals();
	});

});

describe('patchXHR', () => {
	it('intercepts open() and send() and emits the correct payload on loadend', () => {
		const { onEvent, events } = makeOnEvent();
		teardown = setupHttpTracker([], true, onEvent);

		const xhr = new XMLHttpRequest();
		xhr.open('GET', '/api/data');
		Object.defineProperty(xhr, 'status', { configurable: true, get: () => 200 });
		xhr.dispatchEvent(new ProgressEvent('loadend', { bubbles: true }));

		expect(events).toHaveLength(1);
		expect(events[0].payload.url).toBe('/api/data');
		expect(events[0].payload.method).toBe('GET');
		expect(typeof events[0].payload.duration).toBe('number');
	});

	it('URLs in ignoreUrls bypass the XHR tracker', () => {
		const { onEvent, events } = makeOnEvent();
		teardown = setupHttpTracker(['/_tracker'], true, onEvent);

		const xhr = new XMLHttpRequest();
		xhr.open('GET', '/_tracker/events');
		Object.defineProperty(xhr, 'status', { configurable: true, get: () => 200 });
		xhr.dispatchEvent(new ProgressEvent('loadend', { bubbles: true }));

		expect(events).toHaveLength(0);
	});

	it('loadend emits payload with status and duration', () => {
		const { onEvent, events } = makeOnEvent();
		teardown = setupHttpTracker([], true, onEvent);

		const xhr = new XMLHttpRequest();
		xhr.open('POST', '/api/resource');
		Object.defineProperty(xhr, 'status', { configurable: true, get: () => 201 });
		xhr.dispatchEvent(new ProgressEvent('loadend', { bubbles: true }));

		expect(events[0].payload.status).toBeDefined();
		expect(typeof events[0].payload.duration).toBe('number');
	});

	it('loadend with status === 0 (network error) does NOT emit — already handled by error handler (Bug 19)', () => {
		const { onEvent, events } = makeOnEvent();
		teardown = setupHttpTracker([], true, onEvent);

		const xhr = new XMLHttpRequest();
		xhr.open('GET', '/api/down');
		xhr.dispatchEvent(new ProgressEvent('loadend', { bubbles: true }));

		expect(events).toHaveLength(0);
	});

	it('captureRequestHeaders by setRequestHeader', () => {
		const { onEvent, events } = makeOnEvent();
		teardown = setupHttpTracker([], { captureRequestHeaders: true }, onEvent);

		const xhr = new XMLHttpRequest();
		xhr.open('GET', '/api/data');
		xhr.setRequestHeader('X-Custom', 'header-value');
		xhr.setRequestHeader('Authorization', 'Bearer secret');
		Object.defineProperty(xhr, 'status', { configurable: true, get: () => 200 });
		xhr.dispatchEvent(new ProgressEvent('loadend', { bubbles: true }));

		const headers = events[0].payload.requestHeaders!;
		expect(headers['x-custom']).toBe('header-value');
		expect(headers['authorization']).toBeUndefined();
	});

	it('response headers from getAllResponseHeaders()', () => {
		const { onEvent, events } = makeOnEvent();
		teardown = setupHttpTracker([], { captureResponseHeaders: true }, onEvent);

		const xhr = new XMLHttpRequest();
		xhr.open('GET', '/api/data');

		vi.spyOn(xhr, 'getAllResponseHeaders').mockReturnValue(
			'content-type: application/json\r\nx-request-id: req-42\r\n'
		);

		Object.defineProperty(xhr, 'status', { configurable: true, get: () => 200 });
		xhr.dispatchEvent(new ProgressEvent('loadend', { bubbles: true }));

		const headers = events[0].payload.responseHeaders!;
		expect(headers['content-type']).toBe('application/json');
		expect(headers['x-request-id']).toBe('req-42');
	});

	it('response body from responseText', () => {
		const { onEvent, events } = makeOnEvent();
		teardown = setupHttpTracker([], { captureResponseBody: true }, onEvent);

		const xhr = new XMLHttpRequest();
		xhr.open('GET', '/api/data');

		Object.defineProperty(xhr, 'responseText', {
			configurable: true,
			get: () => JSON.stringify({ result: 'ok' }),
		});

		Object.defineProperty(xhr, 'status', { configurable: true, get: () => 200 });
		xhr.dispatchEvent(new ProgressEvent('loadend', { bubbles: true }));

		expect(events[0].payload.responseBody).toEqual({ result: 'ok' });
	});

	it('"error" event on XHR emits error payload', () => {
		const { onEvent, events } = makeOnEvent();
		teardown = setupHttpTracker([], true, onEvent);

		const xhr = new XMLHttpRequest();
		xhr.open('GET', '/api/down');
		xhr.dispatchEvent(new ProgressEvent('error', { bubbles: true }));

		expect(events).toHaveLength(1);
		expect(events[0].level).toBe('error');
		expect(events[0].payload.error).toBe('Network error');
		expect(events[0].payload.url).toBe('/api/down');
	});

	it('"error" then "loadend" on network failure emits exactly ONE event (Bug 19)', () => {
		const { onEvent, events } = makeOnEvent();
		teardown = setupHttpTracker([], true, onEvent);

		const xhr = new XMLHttpRequest();
		xhr.open('GET', '/api/down');
		xhr.dispatchEvent(new ProgressEvent('error', { bubbles: true }));
		xhr.dispatchEvent(new ProgressEvent('loadend', { bubbles: true })); // status remains 0

		expect(events).toHaveLength(1);
		expect(events[0].payload.error).toBe('Network error');
	});

	it('"error" event with captureRequestHeaders: true includes headers in the payload', () => {
		const { onEvent, events } = makeOnEvent();
		teardown = setupHttpTracker([], { captureRequestHeaders: true }, onEvent);

		const xhr = new XMLHttpRequest();
		xhr.open('GET', '/api/down');
		xhr.setRequestHeader('X-Trace', 'trace-id-123');
		xhr.dispatchEvent(new ProgressEvent('error', { bubbles: true }));

		expect(events[0].payload.requestHeaders).toBeDefined();
		expect(events[0].payload.requestHeaders!['x-trace']).toBe('trace-id-123');
	});

	it('"error" event on ignored URL does not emit', () => {
		const { onEvent, events } = makeOnEvent();
		teardown = setupHttpTracker(['/_tracker'], true, onEvent);

		const xhr = new XMLHttpRequest();
		xhr.open('GET', '/_tracker/events');
		xhr.dispatchEvent(new ProgressEvent('error', { bubbles: true }));

		expect(events).toHaveLength(0);
	});

	it('send() on ignored URL bypasses the tracker and does not register startTime', () => {
		const { onEvent, events } = makeOnEvent();
		teardown = setupHttpTracker(['/_tracker'], true, onEvent);

		const xhr = new XMLHttpRequest() as any;
		xhr.open('POST', '/_tracker/events');
		xhr.send('payload');
		expect(xhr.__tracker_startTime__).toBeUndefined();
		Object.defineProperty(xhr, 'status', { configurable: true, get: () => 200 });
		xhr.dispatchEvent(new ProgressEvent('loadend', { bubbles: true }));
		expect(events).toHaveLength(0);
	});

	it('teardown restores the original prototypes', () => {
		const originalOpen = XMLHttpRequest.prototype.open;
		const originalSend = XMLHttpRequest.prototype.send;
		const originalSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;

		const { onEvent } = makeOnEvent();
		const td = setupHttpTracker([], true, onEvent);

		expect(XMLHttpRequest.prototype.open).not.toBe(originalOpen);
		expect(XMLHttpRequest.prototype.send).not.toBe(originalSend);
		expect(XMLHttpRequest.prototype.setRequestHeader).not.toBe(originalSetRequestHeader);

		td();

		expect(XMLHttpRequest.prototype.open).toBe(originalOpen);
		expect(XMLHttpRequest.prototype.send).toBe(originalSend);
		expect(XMLHttpRequest.prototype.setRequestHeader).toBe(originalSetRequestHeader);
	});

	it('captureRequestBody: true -> body included in XHR payload', () => {
		const { onEvent, events } = makeOnEvent();
		teardown = setupHttpTracker([], { captureRequestBody: true }, onEvent);

		const xhr = new XMLHttpRequest();
		xhr.open('POST', '/api/data');
		xhr.send(JSON.stringify({ hello: 'world' }));
		Object.defineProperty(xhr, 'status', { configurable: true, get: () => 200 });
		xhr.dispatchEvent(new ProgressEvent('loadend', { bubbles: true }));

		expect(events[0].payload.requestBody).toEqual({ hello: 'world' });
	});

	it('XHR body with sensitive keys is redacted', () => {
		const { onEvent, events } = makeOnEvent();
		teardown = setupHttpTracker([], { captureRequestBody: true }, onEvent);

		const xhr = new XMLHttpRequest();
		xhr.open('POST', '/api/login');
		xhr.send(JSON.stringify({ username: 'mario', password: 'secret' }));
		Object.defineProperty(xhr, 'status', { configurable: true, get: () => 200 });
		xhr.dispatchEvent(new ProgressEvent('loadend', { bubbles: true }));

		const body = events[0].payload.requestBody as Record<string, unknown>;
		expect(body.username).toBe('mario');
		expect(body.password).toBe('[REDACTED]');
	});
});
