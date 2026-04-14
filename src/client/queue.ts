import type { IngestRequest, QueueOptions, TrackerEvent } from "@tracker/types";

export class EventQueue {
	private queue: TrackerEvent[] = [];
	private timer: ReturnType<typeof setTimeout> | null = null;
	private opts: QueueOptions;
	private sending = false;
	private stopped = false;
	private ws: WebSocket | null = null;
	private wsReady = false;
	private wsPending: TrackerEvent[] = [];

	constructor(opts: QueueOptions) {
		this.opts = opts;
		if (opts.wsEndpoint) {
			this.connectWs();
		}
	}

	private connectWs() {
		if (!this.opts.wsEndpoint) {
			return;
		}
		const ws = new WebSocket(this.opts.wsEndpoint);
		this.ws = ws;

		ws.addEventListener('open', () => {
			/**
			 * INFO The browser WebSocket API does not support custom HTTP headers
			 * during the upgrade handshake.  Authenticate by sending the key
			 * as the very first message so the server can verify it before
			 * processing any ingest payloads.
			 */
			if (this.opts.apiKey) {
				try {
					ws.send(JSON.stringify({ type: 'auth', key: this.opts.apiKey }));
				} catch {
					// INFO force socket closing if authentication fails.
					ws.close();
					return;
				}
				// INFO wsReady will be set to true only after receiving 'auth_ok' from the server
				return;
			}
			// INFO No apiKey — no handshake needed, mark ready immediately
			this.wsReady = true
			// INFO  flush buffered events accumulated during connection
			if (this.wsPending.length > 0) {
				this.sendViaWs(this.wsPending.splice(0));
			}
		});

		ws.addEventListener('message', (event: MessageEvent) => {
			try {
				const msg = JSON.parse(event.data as string);
				if (msg.type === 'auth_ok') {
					this.wsReady = true;
					// INFO flush buffered events accumulated during auth handshake
					if (this.wsPending.length > 0) {
						this.sendViaWs(this.wsPending.splice(0));
					}
				}
			} catch { /* ignore non-JSON frames */ }
		});

		ws.addEventListener('close', event => {
			this.wsReady = false;
			this.ws = null;

			// Server close connection with 1008 (Policy Violation/Unauthorized)
			if (event.code === 1008) {
				console.error('[vite-plugin-monitor] Invalid API Key. Stopping reconnection.');
				this.stop();
				return;
			}

			// INFO reconnect after 3s - mirrors flushInterval cadence
			setTimeout(() => {
				!this.stopped && this.connectWs();
			}, 3000);
		});

		ws.addEventListener('error', () => {
			// INFO error is always followed by close - reconnect handled there
			this.wsReady = false;
		});
	}

	private sendViaWs(batch: TrackerEvent[]): void {
		if (!this.ws || !this.wsReady) {
			this.wsPending.push(...batch);
			return;
		}
		const msg: IngestRequest = { type: 'ingest', events: batch };
		try {
			this.ws.send(JSON.stringify(msg));
		} catch {
			// INFO socket unexpectedly closed - requeue and let reconnect handle it
			this.queue.unshift(...batch);
		}
	}

	init(): void {
		this.scheduleFlush();
	}

	enqueue(event: TrackerEvent) {
		if (this.stopped) {
			return;
		}
		this.queue.push(event);
		if (this.queue.length >= this.opts.batchSize) {
			this.flush();
		}
	}

	flush() {
		if (this.timer) {
			clearTimeout(this.timer);
			this.timer = null;
		}

		if (this.queue.length === 0 || this.sending) {
			this.scheduleFlush();
			return;
		}

		const batch = this.queue.splice(0, this.opts.batchSize);
		this.sending = true;

		if (this.opts.wsEndpoint) {
			this.sendViaWs(batch);
			this.sending = false;
			this.scheduleFlush();
			return;
		}

		const body = JSON.stringify({ type: 'ingest', events: batch } satisfies IngestRequest);
		const headers: Record<string, string> = { 'Content-Type': 'application/json' };
		if (this.opts.apiKey) {
			headers['X-Tracker-Key'] = this.opts.apiKey;
		}

		if (document.visibilityState === 'hidden' && navigator.sendBeacon) {
			// INFO On page hide/unload, send the current batch AND any remaining events in one shot via sendBeacon so nothing is lost on tab close.
			const remaining = this.queue.splice(0);
			const allEvents = [...batch, ...remaining];
			const beaconBody = JSON.stringify({ type: 'ingest', events: allEvents } satisfies IngestRequest);
			const blob = new Blob([beaconBody], { type: 'application/json' });
			const sent = navigator.sendBeacon(this.opts.writeEndpoint, blob);
			if (!sent) {
				this.queue.unshift(...allEvents);
			}
			this.sending = false;
			this.scheduleFlush();
			return;
		}

		fetch(this.opts.writeEndpoint, { method: 'POST', headers, body, keepalive: true })
			.then((res) => {
				if (!res.ok) {
					console.warn(`[vite-plugin-monitor] Server responded with ${res.status}, requeueing batch`);
					this.queue.unshift(...batch);
				}
			})
			.catch((err) => {
				console.warn('[vite-plugin-monitor] Failed to send events, requeueing:', err);
				this.queue.unshift(...batch);
			})
			.finally(() => {
				this.sending = false;
				this.scheduleFlush();
			})
	}

	private scheduleFlush() {
		if (this.stopped || this.timer) {
			return;
		}
		this.timer = setTimeout(() => {
			this.timer = null;
			this.flush();
		}, this.opts.flushInterval);
	}

	/**
	 * INFO
	 * Permanently shut down the queue. Clears the flush timer and closes the
	 * WebSocket connection. After this call, `enqueue()` is a no-op and
	 * `scheduleFlush()` will never restart the timer.
	 */
	stop(): void {
		this.stopped = true;
		if (this.timer) {
			clearTimeout(this.timer);
			this.timer = null;
		}
		if (this.ws) {
			this.ws.close();
			this.ws = null;
		}
	}
}
