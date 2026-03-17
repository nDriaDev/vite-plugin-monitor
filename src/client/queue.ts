import { IngestRequest, QueueOptions, TrackerEvent } from "@tracker/types";

export class EventQueue {
	private queue: TrackerEvent[] = [];
	private timer: ReturnType<typeof setTimeout> | null = null;
	private opts: QueueOptions;
	private sending = false;
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
			this.wsReady = true
			// INFO  flush buffered events accumulated during connection
			if (this.wsPending.length > 0) {
				this.sendViaWs(this.wsPending.splice(0));
			}
		});

		ws.addEventListener('close', () => {
			this.wsReady = false;
			this.ws = null;
			// INFO reconnect after 3s - mirrors flushInterval cadence
			setTimeout(() => this.connectWs(), 3000);
		});

		ws.addEventListener('error', () => {
			// INFO error is always followed by close - reconnect handled there
			this.wsReady = false;
		});
	}

	private sendViaWs(batch: TrackerEvent[]): void {
		if(!this.ws || !this.wsReady) {
			this.wsPending.push(...batch);
			return;
		}
		const msg: IngestRequest = { events: batch };
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

		const body = JSON.stringify({ events: batch } satisfies IngestRequest);
		const headers: Record<string, string> = { 'Content-Type': 'application/json' };
		if (this.opts.apiKey) {
			headers['X-Tracker-Key'] = this.opts.apiKey;
		}

		if (document.visibilityState === 'hidden' && navigator.sendBeacon) {
			const blob = new Blob([body], { type: 'application/json' });
			const sent = navigator.sendBeacon(this.opts.writeEndpoint, blob);
			if (!sent) {
				this.queue.unshift(...batch);
			}
			this.sending = false;
			this.scheduleFlush();
			return;
		}

		fetch(this.opts.writeEndpoint, { method: 'POST', headers, body: JSON.stringify(body), keepalive: true })
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
		if (this.timer) {
			return;
		}
		this.timer = setTimeout(() => {
			this.timer = null;
			this.flush();
		}, this.opts.flushInterval);
	}
}
