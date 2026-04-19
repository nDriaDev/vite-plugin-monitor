/**
 * Development server for the dashboard.
 *
 * Starts a local HTTP server independently of Vite so the dashboard SPA
 * (`pnpm dev:dashboard`) has a backend to talk to, and loads events from
 * a local `test.log` file so the dashboard has data to display immediately.
 *
 * Usage - three terminals:
 *   pnpm dev           -> tsdown --watch (compiles plugin + client)
 *   pnpm dev:server    -> this script (HTTP server + seed)
 *   pnpm dev:dashboard -> Vite SPA with proxy -> :4242
 */
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequestHandler } from '../src/plugin/server';
import type { ResolvedTrackerOptions, TrackerEvent } from '../src/types';
import { randomUUID } from 'node:crypto';

// Utility per ottenere __dirname in un modulo ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const LOG_FILE_PATH = join(__dirname, 'test.log');

const opts: ResolvedTrackerOptions = {
	enabled: true,
	appId: 'dev',
	autoInit: true,
	storage: {
		mode: 'middleware',
		writeEndpoint: 'http://localhost:4242/_tracker/events',
		readEndpoint: 'http://localhost:4242/_tracker',
		pingEndpoint: '',
		wsEndpoint: '',
		apiKey: '',
		batchSize: 25,
		flushInterval: 5000,
		maxBufferSize: 500000
	},
	track: {
		clicks: true,
		http: true,
		errors: true,
		navigation: true,
		console: false,
		userId: () => null,
		level: 'info'
	},
	logging: {
		level: 'info',
		transports: [
			{
				format: 'json',
				path: './logs/tracker-dev.log',
				rotation: { strategy: 'daily', maxFiles: 7, compress: false }
			}
		]
	},
	dashboard: {
		enabled: true,
		route: '/_dashboard',
		auth: {
			username: '0a26ba53f50677da78a8ca98adcfd46d05cbee580ce6f30311ad336b1d386841',
			password: '0a26ba53f50677da78a8ca98adcfd46d05cbee580ce6f30311ad336b1d386841'
		},
		includeInBuild: false,
		pollInterval: 10000
	},
	overlay: {
		enabled: false,
		position: 'bottom-right'
	}
}

const logger = {
	debug: (msg: string) => console.debug(`\x1b[36m[vite-plugin-monitor]\x1b[0m ${msg}`),
	info: (msg: string) => console.info(`\x1b[36m[vite-plugin-monitor]\x1b[0m ${msg}`),
	warn: (msg: string) => console.warn(`\x1b[36m[vite-plugin-monitor]\x1b[0m ${msg}`),
	error: (msg: string) => console.error(`\x1b[36m[vite-plugin-monitor]\x1b[0m ${msg}`),
	writeEvent: (_event: TrackerEvent) => { /* no file logging in dev */ },
	destroy: async () => { },
	destroyForHmr: () => { },
	startHydration: (
		_onBatch: (events: TrackerEvent[]) => void,
		onDone: (stats: { loaded: number; skippedMalformed: number; skippedInvalid: number; limitReached: boolean }) => void,
	) => {
		onDone({ loaded: 0, skippedMalformed: 0, skippedInvalid: 0, limitReached: false });
	},
};
const PORT = 4242;

// Build a minimal in-memory buffer - dev-server only needs push/query/size.
const _buf: TrackerEvent[] = [];
const buffer = {
	push: (events: TrackerEvent[]) => { _buf.push(...events); },
	query: (filters: { since?: string; until?: string; after?: string; limit: number; page: number }) => {
		let result = [..._buf];
		if (filters.since) result = result.filter(e => e.timestamp >= filters.since!);
		if (filters.until) result = result.filter(e => e.timestamp <= filters.until!);
		if (filters.after) result = result.filter(e => e.timestamp > filters.after!);
		result = result.reverse();
		const total = result.length;
		const start = (filters.page - 1) * filters.limit;
		return { events: result.slice(start, start + filters.limit), total };
	},
	size: () => _buf.length,
};

const handler = createRequestHandler(opts, buffer as any, logger);

const server = createServer(async (req, res) => {
	const handled = await handler(req, res);
	if (!handled) {
		res.writeHead(404, { 'Content-Type': 'application/json' });
		res.end(JSON.stringify({ error: 'Not found' }));
	}
});

server.on('error', (err: NodeJS.ErrnoException) => {
	if (err.code === 'EADDRINUSE') {
		logger.warn(`Port ${PORT} already in use - dev server not started`);
	} else {
		logger.error(`Server error: ${err.message}`);
	}
});

server.listen(PORT, () => {
	logger.info(`Dev server running  ->  http://localhost:${PORT}/_tracker/events`);
	logger.info(`Start the dashboard ->  pnpm dev:dashboard`);
});

process.on('SIGINT', () => { server.close(); process.exit(0); });
process.on('SIGTERM', () => { server.close(); process.exit(0); });

// Avvia il caricamento da file dopo 500ms per assicurarsi che il server sia pronto
setTimeout(() => loadEventsFromFile(), 500);

/**
 * Reads TrackerEvents from the local test.log file (JSONL format)
 * and seeds them into the dev server's ring buffer via HTTP POST.
 */
function loadEventsFromFile() {
	try {
		// Legge il file in modo sincrono (va bene per un dev-server in avvio)
		const raw = readFileSync(LOG_FILE_PATH, 'utf-8');

		// Divide per riga e rimuove righe vuote (tipiche all'ultima riga del file)
		const lines = raw.split('\n').filter(line => line.trim() !== '');

		if (lines.length === 0) {
			logger.warn(`File ${LOG_FILE_PATH} is empty. No events seeded.`);
			return;
		}

		let skippedMalformed = 0;
		const events: TrackerEvent[] = lines.map((line, index) => {
			try {
				return {id: randomUUID(), ...JSON.parse(line)} as TrackerEvent;
			} catch (err) {
				skippedMalformed++;
				logger.warn(`Skipping malformed JSON at line ${index + 1} in test.log`);
				return null;
			}
		}).filter((event): event is TrackerEvent => event !== null);

		if (events.length === 0) {
			logger.warn(`No valid events parsed from ${LOG_FILE_PATH}`);
			return;
		}

		// Invia gli eventi all'endpoint locale esattamente come faceva la funzione precedente
		fetch('http://localhost:4242/_tracker/events', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ events }),
		})
			.then((res) => {
				if (res.ok) {
					logger.info(`Loaded ${events.length} events from test.log (${skippedMalformed} skipped)`);
				} else {
					logger.warn(`Seed request returned HTTP ${res.status}`);
				}
			})
			.catch((err: unknown) => logger.warn(`Seed failed: ${String(err)}`));

	} catch (err: any) {
		if (err.code === 'ENOENT') {
			logger.warn(`File ${LOG_FILE_PATH} not found. No events seeded.`);
		} else {
			logger.error(`Error reading ${LOG_FILE_PATH}: ${err.message}`);
		}
	}
}
