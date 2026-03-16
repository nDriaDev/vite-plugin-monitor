/**
 * Standalone development server for the dashboard.
 *
 * Starts the tracker standalone server independently of Vite so the
 * dashboard SPA (pnpm dev:dashboard) has a backend to talk to.
 *
 * Usage:
 *   pnpm dev:server
 *
 * Then in a separate terminal:
 *   pnpm dev:dashboard
 */
import { createStandaloneServer } from '../src/plugin/standalone-server';
import { createLogger } from '../src/plugin/logger';

const opts = {
	appId: 'dev',
	autoInit: true,
	storage: {
		mode: 'standalone' as const,
		writeEndpoint: 'http://localhost:4242/_tracker/events',
		readEndpoint: 'http://localhost:4242/_tracker',
		apiKey: '',
		port: 4242,
		batchSize: 10,
		flushInterval: 3000,
	},
	track: {
		clicks: true,
		http: true,
		errors: true,
		navigation: true,
		performance: true,
		console: false as const,
		userId: () => null,
		level: 'info' as const,
		ignoreUrls: [],
	},
	logging: {
		level: 'info' as const,
		transports: [
			{
				format: 'json' as const,
				path: './logs/tracker-dev.log',
				rotation: { strategy: 'daily' as const, maxFiles: 7, compress: false },
			},
		],
	},
	dashboard: {
		enabled: true,
		route: '/_tracker',
		auth: { username: 'admin', password: 'tracker' },
		includeInBuild: false,
		pollInterval: 3000,
	},
	overlay: {
		enabled: false,
		position: 'bottom-right' as const,
	},
}

const logger = createLogger(opts.logging);
const server = createStandaloneServer(opts, logger);

server.start();
logger.info('Dev server running on http://localhost:4242/_tracker');
logger.info('Start the dashboard with: pnpm dev:dashboard');

process.on('SIGINT', () => { server.stop(); process.exit(0) });
process.on('SIGTERM', () => { server.stop(); process.exit(0) });
