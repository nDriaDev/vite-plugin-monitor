import { HttpPayload, HttpTrackOptions, LogLevel, ResolvedHttpOpts, TrackedXHR } from "@tracker/types";

const SENSITIVE_HEADERS = new Set([
	'authorization',
	'cookie',
	'set-cookie',
	'x-api-key',
	'x-auth-token',
	'x-access-token',
	'x-csrf-token',
	'x-session-token',
	'proxy-authorization',
	'www-authenticate',
]);

const SENSITIVE_KEY_PATTERNS = [
	'password', 'passwd', 'pwd',
	'token', 'secret', 'apikey', 'api_key',
	'auth', 'credential',
	'ssn', 'fiscal', 'taxcode',
	'cvv', 'cvc', 'card',
	'iban', 'bic', 'swift',
	'private', 'signing',
];

const DEFAULT_MAX_BODY = 2048;  // INFO 2 KB

function isSensitiveHeader(name: string, extra: string[]): boolean {
	const lower = name.toLowerCase();
	return SENSITIVE_HEADERS.has(lower) || extra.some(e => e.toLowerCase() === lower);
}

function isSensitiveKey(key: string, extra: string[]): boolean {
	const lower = key.toLowerCase();
	return SENSITIVE_KEY_PATTERNS.some(p => lower.includes(p)) || extra.some(p => lower.includes(p.toLowerCase()));
}

/**
* INFO
* Deep-redacts any value whose key matches a sensitive pattern.
* Works on nested objects and arrays.
*/
function redactBody(value: unknown, extraKeys: string[]): unknown {
	if (value === null || value === undefined) {
		return value;
	}
	if (Array.isArray(value)) {
		return value.map(v => redactBody(v, extraKeys));
	}
	if (typeof value === 'object') {
		const out: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
			out[k] = isSensitiveKey(k, extraKeys) ? '[redacted]' : redactBody(v, extraKeys);
		}
		return out;
	}
	return value;
}

/**
* INFO
* Filters headers, removing sensitive ones and optionally truncating values.
*/
function sanitizeHeaders(headers: Record<string, string>, extraExcludes: string[]): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [k, v] of Object.entries(headers)) {
		if (!isSensitiveHeader(k, extraExcludes)) {
			out[k.toLowerCase()] = v;
		}
	}
	return out;
}

/**
* INFO
* Parses and sanitizes a body string:
* - Attempts JSON.parse for structured redaction
* - Falls back to plain string
* - Truncates to maxSize bytes
*/
function parseBody(raw: string, maxSize: number, redactKeys: string[]): unknown {
	if (!raw) {
		return undefined;
	}

	/**
	* INFO
	* Attempt JSON parse BEFORE truncating: truncating first produces invalid JSON.
	* After redaction we truncate the *re-serialized* safe output.
	*/
	try {
		const parsed = JSON.parse(raw);
		const redacted = redactBody(parsed, redactKeys);
		if (maxSize > 0) {
			const serialized = JSON.stringify(redacted);
			if (serialized.length > maxSize) {
				return serialized.slice(0, maxSize) + `…[truncated ${serialized.length - maxSize}B]`;
			}
		}
		return redacted;
	} catch {
		if (maxSize > 0 && raw.length > maxSize) {
			return raw.slice(0, maxSize) + `…[truncated ${raw.length - maxSize}B]`;
		}
		return raw;
	}
}

/**
* INFO
* Converts a HeadersInit (various formats) to a plain Record<string,string>.
*/
function headersToRecord(headers: HeadersInit | undefined | null): Record<string, string> {
	if (!headers) {
		return {};
	}
	if (headers instanceof Headers) {
		const out: Record<string, string> = {};
		headers.forEach((v, k) => { out[k] = v });
		return out;
	}
	if (Array.isArray(headers)) {
		return Object.fromEntries(headers);
	}
	/**
	 * INFO Duck-typing fallback: handles cross-realm Headers instances (e.g. jsdom vs undici)
	 * where instanceof check fails but the object still has a forEach method like Headers.
	 */
	if (typeof (headers as any).forEach === 'function' && typeof (headers as any).get === 'function') {
		const out: Record<string, string> = {};
		(headers as any).forEach((v: string, k: string) => { out[k] = v });
		return out;
	}
	return { ...(headers as Record<string, string>) };
}

function resolveHttpOpts(raw: boolean | HttpTrackOptions | undefined): ResolvedHttpOpts {
	if (!raw || raw === true) {
		return {
			captureRequestHeaders: false,
			captureRequestBody: false,
			captureResponseHeaders: false,
			captureResponseBody: false,
			excludeHeaders: [],
			redactKeys: [],
			maxBodySize: DEFAULT_MAX_BODY,
		};
	}
	return {
		captureRequestHeaders: raw.captureRequestHeaders ?? false,
		captureRequestBody: raw.captureRequestBody ?? false,
		captureResponseHeaders: raw.captureResponseHeaders ?? false,
		captureResponseBody: raw.captureResponseBody ?? false,
		excludeHeaders: raw.excludeHeaders ?? [],
		redactKeys: raw.redactKeys ?? [],
		maxBodySize: raw.maxBodySize ?? DEFAULT_MAX_BODY,
	};
}

async function cloneBody(body: BodyInit | null | undefined, isStream?: boolean): Promise<string> {
	if (!body) {
		return '';
	}
	if (isStream) {
		return '[ReadableStream - not captured]';
	}
	if (typeof body === 'string') {
		return body;
	}
	if (body instanceof URLSearchParams) {
		return body.toString();
	}
	if (body instanceof FormData) {
		return '[FormData]';
	}
	if (body instanceof Blob) {
		return `[Blob ${body.size}B]`;
	}
	if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) {
		return `[Binary ${(body as ArrayBuffer).byteLength ?? (body as ArrayBufferView).byteLength}B]`;
	}

	return '';
}

function patchFetch(ignoreUrls: string[], httpOpts: ResolvedHttpOpts, onEvent: (payload: HttpPayload, level: LogLevel) => void): () => void {
	const originalFetch = window.fetch;

	window.fetch = async function (input: RequestInfo | URL, init?: RequestInit) {
		const url = typeof input === 'string'
			? input
			: input instanceof URL
				? input.href
				: (input as Request).url;
		const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();

		if (ignoreUrls.some(p => url.includes(p))) {
			return originalFetch.call(this, input, init);
		}

		// INFO Capture request data before the call
		const reqHeaders = httpOpts.captureRequestHeaders
			? sanitizeHeaders(
				headersToRecord(init?.headers ?? (input instanceof Request ? input.headers : undefined)),
				httpOpts.excludeHeaders,
			)
			: undefined;

		/**
		 * INFO Capture request body only if it's NOT a ReadableStream.
		 * If the init body or a pre-built Request carries a ReadableStream,
		 * touching body would consume the underlying stream before fetch can send it.
		 */
		const rawInitBody = init?.body;
		const rawInputBody = input instanceof Request ? (input as Request).body : undefined;
		const bodySource = rawInitBody ?? rawInputBody;
		const bodyIsStream = bodySource instanceof ReadableStream;

		const rawReqBody = httpOpts.captureRequestBody
			? await cloneBody(bodySource as BodyInit | null, bodyIsStream)
			: undefined;
		const reqBody = rawReqBody !== undefined
			? parseBody(rawReqBody, httpOpts.maxBodySize, httpOpts.redactKeys)
			: undefined;
		const reqSize = rawReqBody ? rawReqBody.length : undefined;

		const start = performance.now();
		try {
			// INFO Clone the request so we can read the response body without consuming it
			const response = await originalFetch.call(this, input, init);
			const duration = Math.round(performance.now() - start);

			// INFO Response body - must clone to avoid consuming the real stream
			let resBody: unknown;
			let resSize: number | undefined;
			let resHeaders: Record<string, string> | undefined;

			if (httpOpts.captureResponseHeaders) {
				resHeaders = sanitizeHeaders(
					headersToRecord(response.headers),
					httpOpts.excludeHeaders,
				);
			}

			if (httpOpts.captureResponseBody) {
				try {
					const cloned = response.clone();
					const text = await cloned.text();
					resSize = text.length;
					resBody = parseBody(text, httpOpts.maxBodySize, httpOpts.redactKeys);
				} catch {
					resBody = '[unreadable]';
				}
			}

			const payload: HttpPayload = {
				method, url,
				status: response.status,
				duration,
				requestHeaders: reqHeaders,
				requestBody: reqBody,
				requestSize: reqSize,
				responseHeaders: resHeaders,
				responseBody: resBody,
				responseSize: resSize,
			}
			onEvent(payload, levelFromStatus(response.status));
			return response;

		} catch (err) {
			const duration = Math.round(performance.now() - start);
			onEvent(
				{ method, url, duration, error: String(err), requestHeaders: reqHeaders, requestBody: reqBody },
				'error',
			);
			throw err;
		}
	}

	return () => { window.fetch = originalFetch };
}

function patchXHR(ignoreUrls: string[], httpOpts: ResolvedHttpOpts, onEvent: (payload: HttpPayload, level: LogLevel) => void): () => void {
	const OriginalXHR = window.XMLHttpRequest;
	const originalOpen = OriginalXHR.prototype.open;
	const originalSend = OriginalXHR.prototype.send;
	const originalSetRequestHeader = OriginalXHR.prototype.setRequestHeader;

	OriginalXHR.prototype.open = function (this: TrackedXHR, method: string, url: string, ...rest: unknown[]) {
		this.__tracker_method__ = method.toUpperCase();
		this.__tracker_url__ = url;
		this.__tracker_headers__ = {};

		// INFO Call originalOpen FIRST: jsdom resets EventTarget listeners during open(),
		// so listeners must be registered AFTER the native open to survive.
		// @ts-expect-error variadic
		const result = originalOpen.apply(this, [method, url, ...rest]);

		this.addEventListener('loadend', () => {
			const xhrUrl = this.__tracker_url__ ?? '';
			const xhrMethod = this.__tracker_method__ ?? 'GET';

			if (ignoreUrls.some(p => xhrUrl.includes(p))) return;

			const startTime = (this.__tracker_startTime__ as number | undefined) ?? performance.now();
			const duration = Math.round(performance.now() - startTime);

			const reqHeaders = httpOpts.captureRequestHeaders
				? sanitizeHeaders(this.__tracker_headers__ ?? {}, httpOpts.excludeHeaders)
				: undefined;

			const rawReqBody = ((this.__tracker_reqBody__ as string | undefined) ?? '');
			const reqBody = httpOpts.captureRequestBody && rawReqBody
				? parseBody(rawReqBody, httpOpts.maxBodySize, httpOpts.redactKeys)
				: undefined;
			const reqSize = rawReqBody ? rawReqBody.length : undefined;

			let resHeaders: Record<string, string> | undefined;
			if (httpOpts.captureResponseHeaders) {
				const raw = this.getAllResponseHeaders();
				const parsed: Record<string, string> = {};
				raw.trim().split('\r\n').forEach(line => {
					const idx = line.indexOf(': ');
					if (idx > 0) {
						parsed[line.slice(0, idx)] = line.slice(idx + 2);
					}
				});
				resHeaders = sanitizeHeaders(parsed, httpOpts.excludeHeaders);
			}

			let resBody: unknown;
			let resSize: number | undefined;
			if (httpOpts.captureResponseBody && this.responseText) {
				resSize = this.responseText.length;
				resBody = parseBody(this.responseText, httpOpts.maxBodySize, httpOpts.redactKeys);
			}

			onEvent(
				{
					method: xhrMethod,
					url: xhrUrl,
					status: this.status,
					duration,
					requestHeaders: reqHeaders,
					requestBody: reqBody,
					requestSize: reqSize,
					responseHeaders: resHeaders,
					responseBody: resBody,
					responseSize: resSize,
				},
				levelFromStatus(this.status)
			);
		});

		this.addEventListener('error', () => {
			const xhrUrl = this.__tracker_url__ ?? '';
			const xhrMethod = this.__tracker_method__ ?? 'GET';

			if (ignoreUrls.some(p => xhrUrl.includes(p))) return;

			const startTime = (this.__tracker_startTime__ as number | undefined) ?? performance.now();
			const duration = Math.round(performance.now() - startTime);
			const reqHeaders = httpOpts.captureRequestHeaders
				? sanitizeHeaders(this.__tracker_headers__ ?? {}, httpOpts.excludeHeaders)
				: undefined;
			onEvent({ method: xhrMethod, url: xhrUrl, duration, error: 'Network error', requestHeaders: reqHeaders }, 'error');
		});

		return result;
	}

	// INFO Intercept setRequestHeader to capture request headers
	OriginalXHR.prototype.setRequestHeader = function (this: TrackedXHR, name: string, value: string) {
		if (httpOpts.captureRequestHeaders && this.__tracker_headers__) {
			this.__tracker_headers__[name] = value;
		}
		return originalSetRequestHeader.call(this, name, value);
	}

	OriginalXHR.prototype.send = function (this: TrackedXHR, body?: Document | XMLHttpRequestBodyInit | null) {
		const url: string = this.__tracker_url__ ?? '';

		if (ignoreUrls.some(p => url.includes(p))) {
			return originalSend.apply(this, [body]);
		}

		// INFO Store start time and raw body on the instance so the listener in open() can read them
		this.__tracker_startTime__ = performance.now();
		this.__tracker_reqBody__ = body != null ? String(body) : '';

		return originalSend.apply(this, [body]);
	}

	return () => {
		OriginalXHR.prototype.open = originalOpen;
		OriginalXHR.prototype.send = originalSend;
		OriginalXHR.prototype.setRequestHeader = originalSetRequestHeader;
	}
}

function levelFromStatus(status: number): LogLevel {
	if (status >= 500) {
		return 'error';
	}
	if (status >= 400) {
		return 'warn';
	}
	return 'info';
}

export function setupHttpTracker(ignoreUrls: string[], httpConfig: boolean | HttpTrackOptions | undefined, onEvent: (payload: HttpPayload, level: LogLevel) => void): () => void {
	const httpOpts = resolveHttpOpts(httpConfig);
	const teardownFetch = patchFetch(ignoreUrls, httpOpts, onEvent);
	const teardownXHR = patchXHR(ignoreUrls, httpOpts, onEvent);
	return () => {
		teardownFetch();
		teardownXHR();
	}
}
