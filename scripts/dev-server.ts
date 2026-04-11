/**
 * Standalone development server for the dashboard.
 *
 * Starts the tracker standalone server independently of Vite so the
 * dashboard SPA (`pnpm dev:dashboard`) has a backend to talk to, and
 * seeds the ring buffer with realistic fixture events so the dashboard
 * has data to display immediately.
 *
 * Usage - three terminals:
 *   pnpm dev           -> tsdown --watch (compiles plugin + client)
 *   pnpm dev:server    -> this script (standalone server + seed)
 *   pnpm dev:dashboard -> Vite SPA with proxy -> :4242
 */
import { createStandaloneServer } from '../src/plugin/standalone-server';
import type { ResolvedTrackerOptions, TrackerEvent } from '../src/types';

const opts: ResolvedTrackerOptions = {
	enabled: true,
	appId: 'dev',
	autoInit: true,
	storage: {
		mode: 'standalone',
		writeEndpoint: 'http://localhost:4242/_tracker/events',
		readEndpoint: 'http://localhost:4242/_tracker',
		pingEndpoint: '',
		wsEndpoint: '',
		apiKey: '',
		port: 4242,
		batchSize: 25,
		flushInterval: 3000,
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
		pollInterval: 3000
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
const server = createStandaloneServer(opts, logger);

server.start();

logger.info('Dev server running  ->  http://localhost:4242/_tracker/events');
logger.info('Start the dashboard ->  pnpm dev:dashboard');

process.on('SIGINT', () => { server.stop(); process.exit(0) });
process.on('SIGTERM', () => { server.stop(); process.exit(0) });

setTimeout(() => seedEvents(), 500);

/**
 * Returns an ISO 8601 timestamp `minutesAgo` minutes in the past.
 */
function ts(minutesAgo: number): string {
	return new Date(Date.now() - minutesAgo * 60_000).toISOString()
}

function seedEvents() {
	const SESSIONS = [
		'sess_aaa111', 'sess_bbb222', 'sess_ccc333',
		'sess_ddd444', 'sess_eee555', 'sess_fff666',
	] as const;

	const USERS = [
		'user_alice', 'user_bob', 'user_carol',
		'user_dave', 'anon_xk3j', 'anon_p9qr',
	] as const;

	type S = typeof SESSIONS[number];
	type U = typeof USERS[number];

	function ev(
		minutesAgo: number,
		level: TrackerEvent['level'],
		type: TrackerEvent['type'],
		sessionIdx: number,
		userIdx: number,
		payload: TrackerEvent['payload'],
		route: string,
		viewport = '1440x900',
		language = 'it-IT',
	): TrackerEvent {
		return {
			timestamp: ts(minutesAgo),
			level,
			type,
			appId: 'dev',
			sessionId: SESSIONS[sessionIdx % SESSIONS.length] as S,
			userId: USERS[userIdx % USERS.length] as U,
			payload,
			meta: {
				userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
				route,
				viewport,
				language,
			},
		};
	}

	// INFO Navigations
	const navEvents: TrackerEvent[] = [
		// INFO Session 0: alice browses products -> cart -> checkout
		ev(88, 'info', 'navigation', 0, 0, { from: '/', to: '/products', trigger: 'pushState', duration: undefined }, '/'),
		ev(82, 'info', 'navigation', 0, 0, { from: '/products', to: '/products/42', trigger: 'pushState', duration: 6000 }, '/products'),
		ev(75, 'info', 'navigation', 0, 0, { from: '/products/42', to: '/cart', trigger: 'pushState', duration: 7000 }, '/products/42'),
		ev(68, 'info', 'navigation', 0, 0, { from: '/cart', to: '/checkout', trigger: 'pushState', duration: 7000 }, '/cart'),
		ev(55, 'info', 'navigation', 0, 0, { from: '/checkout', to: '/account', trigger: 'pushState', duration: 13000 }, '/checkout'),
		// INFO Session 1: bob quick browse
		ev(85, 'info', 'navigation', 1, 1, { from: '/', to: '/products', trigger: 'pushState', duration: undefined }, '/'),
		ev(80, 'info', 'navigation', 1, 1, { from: '/products', to: '/products/18', trigger: 'pushState', duration: 5000 }, '/products'),
		ev(72, 'info', 'navigation', 1, 1, { from: '/products/18', to: '/products', trigger: 'popstate', duration: 8000 }, '/products/18'),
		ev(65, 'info', 'navigation', 1, 1, { from: '/products', to: '/products/55', trigger: 'pushState', duration: 7000 }, '/products'),
		ev(58, 'info', 'navigation', 1, 1, { from: '/products/55', to: '/cart', trigger: 'pushState', duration: 7000 }, '/products/55'),
		// INFO Session 2: carol account + dashboard
		ev(70, 'info', 'navigation', 2, 2, { from: '/', to: '/account', trigger: 'pushState', duration: undefined }, '/'),
		ev(60, 'info', 'navigation', 2, 2, { from: '/account', to: '/account/orders', trigger: 'pushState', duration: 10000 }, '/account'),
		ev(45, 'info', 'navigation', 2, 2, { from: '/account/orders', to: '/account/orders/ORD-100', trigger: 'pushState', duration: 15000 }, '/account/orders'),
		// INFO Session 3: dave lands on checkout directly
		ev(50, 'info', 'navigation', 3, 3, { from: '/', to: '/checkout', trigger: 'pushState', duration: undefined }, '/'),
		ev(40, 'info', 'navigation', 3, 3, { from: '/checkout', to: '/checkout/confirm', trigger: 'pushState', duration: 10000 }, '/checkout'),
		// INFO Session 4: anon bounces
		ev(30, 'info', 'navigation', 4, 4, { from: '/', to: '/products', trigger: 'pushState', duration: undefined }, '/'),
		ev(28, 'info', 'navigation', 4, 4, { from: '/products', to: '/', trigger: 'popstate', duration: 2000 }, '/products'),
		// INFO Session 5: anon explores
		ev(20, 'info', 'navigation', 5, 5, { from: '/', to: '/products', trigger: 'pushState', duration: undefined }, '/'),
		ev(18, 'info', 'navigation', 5, 5, { from: '/products', to: '/products/42', trigger: 'pushState', duration: 2000 }, '/products'),
		ev(12, 'info', 'navigation', 5, 5, { from: '/products/42', to: '/cart', trigger: 'pushState', duration: 6000 }, '/products/42'),
		ev(5, 'info', 'navigation', 5, 5, { from: '/cart', to: '/checkout', trigger: 'pushState', duration: 7000 }, '/cart'),
	];

	/**
	 * INFO HTTP
	 * endpoints: /api/products (many calls), /api/products/:id, /api/cart,
	 *            /api/orders (slow), /api/payments, /api/reports/export (very slow),
	 *            /api/auth/me, /api/account/orders
	 */
	const httpEvents: TrackerEvent[] = [
		// INFO GET /api/products - high frequency
		ev(87, 'info', 'http', 0, 0, { method: 'GET', url: 'https://api.dev.io/api/products?page=1', status: 200, duration: 118 }, '/products'),
		ev(84, 'info', 'http', 1, 1, { method: 'GET', url: 'https://api.dev.io/api/products?page=1', status: 200, duration: 134 }, '/products'),
		ev(79, 'info', 'http', 1, 1, { method: 'GET', url: 'https://api.dev.io/api/products?page=2', status: 200, duration: 121 }, '/products'),
		ev(73, 'info', 'http', 5, 5, { method: 'GET', url: 'https://api.dev.io/api/products?page=1', status: 200, duration: 145 }, '/products'),
		ev(66, 'info', 'http', 5, 5, { method: 'GET', url: 'https://api.dev.io/api/products?page=2', status: 200, duration: 110 }, '/products'),
		ev(21, 'info', 'http', 4, 4, { method: 'GET', url: 'https://api.dev.io/api/products?page=1', status: 200, duration: 128 }, '/products'),
		ev(19, 'info', 'http', 5, 5, { method: 'GET', url: 'https://api.dev.io/api/products?page=1', status: 200, duration: 139 }, '/products'),

		// INFO GET /api/products/:id
		ev(81, 'info', 'http', 0, 0, { method: 'GET', url: 'https://api.dev.io/api/products/42', status: 200, duration: 88 }, '/products/42'),
		ev(74, 'info', 'http', 1, 1, { method: 'GET', url: 'https://api.dev.io/api/products/18', status: 200, duration: 95 }, '/products/18'),
		ev(64, 'info', 'http', 1, 1, { method: 'GET', url: 'https://api.dev.io/api/products/55', status: 200, duration: 102 }, '/products/55'),
		ev(17, 'info', 'http', 5, 5, { method: 'GET', url: 'https://api.dev.io/api/products/42', status: 200, duration: 91 }, '/products/42'),

		// INFO GET /api/auth/me - called on every page load
		ev(89, 'info', 'http', 0, 0, { method: 'GET', url: 'https://api.dev.io/api/auth/me', status: 200, duration: 44 }, '/'),
		ev(86, 'info', 'http', 1, 1, { method: 'GET', url: 'https://api.dev.io/api/auth/me', status: 200, duration: 51 }, '/'),
		ev(71, 'info', 'http', 2, 2, { method: 'GET', url: 'https://api.dev.io/api/auth/me', status: 200, duration: 47 }, '/'),
		ev(51, 'info', 'http', 3, 3, { method: 'GET', url: 'https://api.dev.io/api/auth/me', status: 200, duration: 39 }, '/'),
		ev(31, 'info', 'http', 4, 4, { method: 'GET', url: 'https://api.dev.io/api/auth/me', status: 200, duration: 55 }, '/'),
		ev(22, 'info', 'http', 5, 5, { method: 'GET', url: 'https://api.dev.io/api/auth/me', status: 200, duration: 42 }, '/'),

		// INFO POST /api/cart/items
		ev(76, 'info', 'http', 0, 0, { method: 'POST', url: 'https://api.dev.io/api/cart/items', status: 201, duration: 210 }, '/products/42'),
		ev(63, 'info', 'http', 1, 1, { method: 'POST', url: 'https://api.dev.io/api/cart/items', status: 201, duration: 198 }, '/products/55'),
		ev(11, 'info', 'http', 5, 5, { method: 'POST', url: 'https://api.dev.io/api/cart/items', status: 201, duration: 225 }, '/products/42'),

		// INFO GET /api/cart
		ev(74, 'info', 'http', 0, 0, { method: 'GET', url: 'https://api.dev.io/api/cart', status: 200, duration: 76 }, '/cart'),
		ev(57, 'info', 'http', 1, 1, { method: 'GET', url: 'https://api.dev.io/api/cart', status: 200, duration: 82 }, '/cart'),
		ev(10, 'info', 'http', 5, 5, { method: 'GET', url: 'https://api.dev.io/api/cart', status: 200, duration: 79 }, '/cart'),

		// INFO POST /api/orders
		ev(44, 'info', 'http', 0, 0, { method: 'POST', url: 'https://api.dev.io/api/orders', status: 201, duration: 540 }, '/checkout'),
		ev(38, 'info', 'http', 3, 3, { method: 'POST', url: 'https://api.dev.io/api/orders', status: 201, duration: 488 }, '/checkout'),

		// INFO POST /api/payments - one 5xx
		ev(42, 'info', 'http', 0, 0, { method: 'POST', url: 'https://api.dev.io/api/payments', status: 200, duration: 820 }, '/checkout'),
		ev(36, 'error', 'http', 3, 3, { method: 'POST', url: 'https://api.dev.io/api/payments', status: 500, duration: 3240 }, '/checkout'),
		ev(8, 'info', 'http', 5, 5, { method: 'POST', url: 'https://api.dev.io/api/payments', status: 200, duration: 910 }, '/checkout'),

		// INFO GET /api/account/orders
		ev(59, 'info', 'http', 2, 2, { method: 'GET', url: 'https://api.dev.io/api/account/orders', status: 200, duration: 164 }, '/account/orders'),
		ev(44, 'info', 'http', 2, 2, { method: 'GET', url: 'https://api.dev.io/api/account/orders/ORD-100', status: 200, duration: 188 }, '/account/orders'),
		// INFO 401 when session expired
		ev(9, 'warn', 'http', 4, 4, { method: 'GET', url: 'https://api.dev.io/api/account/orders', status: 401, duration: 38 }, '/account'),

		// INFO GET /api/reports/export - very slow, used for Slowest Endpoint
		ev(62, 'info', 'http', 2, 2, { method: 'GET', url: 'https://api.dev.io/api/reports/export?format=csv', status: 200, duration: 4850 }, '/account'),
		ev(33, 'info', 'http', 3, 3, { method: 'GET', url: 'https://api.dev.io/api/reports/export?format=xlsx', status: 200, duration: 5120 }, '/account'),

		// INFO 4xx miscellaneous
		ev(56, 'warn', 'http', 1, 1, { method: 'GET', url: 'https://api.dev.io/api/products/999', status: 404, duration: 42 }, '/products'),
		ev(27, 'warn', 'http', 4, 4, { method: 'POST', url: 'https://api.dev.io/api/cart/items', status: 422, duration: 95 }, '/cart'),

		// INFO 5xx - server errors
		ev(35, 'error', 'http', 2, 2, { method: 'GET', url: 'https://api.dev.io/api/reports/export?format=csv', status: 503, duration: 6000 }, '/account'),
		ev(6, 'error', 'http', 5, 5, { method: 'POST', url: 'https://api.dev.io/api/orders', status: 500, duration: 2100 }, '/checkout'),
	];

	// INFO JS (type === 'error')
	const errorEvents: TrackerEvent[] = [
		ev(69, 'error', 'error', 0, 0, {
			message: "Cannot read properties of undefined (reading 'price')",
			errorType: 'TypeError',
			filename: 'https://dev.io/assets/index-4f3a2b.js',
			lineno: 318, colno: 22,
			stack: "TypeError: Cannot read properties of undefined (reading 'price')\n    at ProductCard (index.js:318:22)\n    at renderList (index.js:201:4)",
		}, '/products/42'),
		ev(37, 'error', 'error', 3, 3, {
			message: "Cannot read properties of undefined (reading 'price')",
			errorType: 'TypeError',
			filename: 'https://dev.io/assets/index-4f3a2b.js',
			lineno: 318, colno: 22,
			stack: "TypeError: Cannot read properties of undefined (reading 'price')\n    at ProductCard (index.js:318:22)",
		}, '/checkout'),
		ev(34, 'error', 'error', 3, 3, {
			message: 'ChunkLoadError: Loading chunk 12 failed (missing: /assets/checkout-d3f1.js)',
			errorType: 'ChunkLoadError',
			stack: 'ChunkLoadError: Loading chunk 12 failed\n    at requireEnsure (runtime.js:88:15)',
		}, '/checkout'),
		ev(16, 'error', 'error', 5, 5, {
			message: "Cannot read properties of null (reading 'querySelector')",
			errorType: 'TypeError',
			filename: 'https://dev.io/assets/index-4f3a2b.js',
			lineno: 540, colno: 8,
			stack: "TypeError: Cannot read properties of null\n    at initWidget (index.js:540:8)",
		}, '/cart'),
		ev(7, 'error', 'error', 5, 5, {
			message: 'Unhandled promise rejection: Network request failed',
			errorType: 'UnhandledRejection',
			stack: 'Error: Network request failed\n    at fetch.catch (api.js:44:12)',
		}, '/checkout'),
	];

	// INFO Clicks
	const clickEvents: TrackerEvent[] = [
		ev(83, 'info', 'click', 0, 0, { tag: 'button', text: 'Add to cart', id: 'add-to-cart-btn', coordinates: { x: 320, y: 480 } }, '/products/42'),
		ev(78, 'info', 'click', 1, 1, { tag: 'button', text: 'Add to cart', id: 'add-to-cart-btn', coordinates: { x: 320, y: 480 } }, '/products/18'),
		ev(73, 'info', 'click', 0, 0, { tag: 'a', text: 'Proceed to checkout', coordinates: { x: 200, y: 100 } }, '/cart', '390x844', 'en-US'),
		ev(53, 'info', 'click', 3, 3, { tag: 'button', text: 'Pay now', id: 'pay-btn', coordinates: { x: 640, y: 600 } }, '/checkout'),
		ev(43, 'info', 'click', 0, 0, { tag: 'button', text: 'Pay now', id: 'pay-btn', coordinates: { x: 640, y: 600 } }, '/checkout'),
		ev(15, 'info', 'click', 5, 5, { tag: 'button', text: 'Add to cart', id: 'add-to-cart-btn', coordinates: { x: 320, y: 480 } }, '/products/42'),
		ev(13, 'info', 'click', 5, 5, { tag: 'a', text: 'Proceed to checkout', coordinates: { x: 200, y: 100 } }, '/cart'),
		ev(4, 'info', 'click', 5, 5, { tag: 'button', text: 'Pay now', id: 'pay-btn', coordinates: { x: 640, y: 600 } }, '/checkout'),
	];

	// INFO Custom
	const customEvents: TrackerEvent[] = [
		ev(85, 'info', 'custom', 0, 0, { name: 'search:query', data: { term: 'running shoes', resultCount: 24 } }, '/products'),
		ev(77, 'info', 'custom', 1, 1, { name: 'search:query', data: { term: 'winter jacket', resultCount: 8 } }, '/products'),
		ev(43, 'info', 'custom', 0, 0, { name: 'checkout:complete', data: { orderId: 'ORD-201', total: 89.99, currency: 'EUR', items: 2 } }, '/checkout', '390x844', 'en-US'),
		ev(38, 'info', 'custom', 3, 3, { name: 'checkout:complete', data: { orderId: 'ORD-202', total: 129.00, currency: 'EUR', items: 1 } }, '/checkout'),
		ev(35, 'warn', 'custom', 3, 3, { name: 'payment:failed', data: { code: 'CARD_DECLINED', retryCount: 1 }, duration: 0 }, '/checkout'),
		ev(26, 'info', 'custom', 2, 2, { name: 'feature:toggle', data: { feature: 'new-checkout-ui', enabled: true } }, '/account'),
		ev(14, 'info', 'custom', 5, 5, { name: 'search:query', data: { term: 'red sneakers', resultCount: 31 } }, '/products'),
		ev(3, 'warn', 'custom', 5, 5, { name: 'payment:failed', data: { code: 'INSUFFICIENT_FUNDS', retryCount: 2 }, duration: 0 }, '/checkout'),
	];

	// INFO Session events
	const sessionEvents: TrackerEvent[] = [
		// INFO Session 0: alice - init, then login (userId change), then page close
		ev(90, 'info', 'session', 0, 4, { action: 'start', trigger: 'init' }, '/'),
		ev(70, 'info', 'session', 0, 4, { action: 'end', trigger: 'userId-change', previousUserId: USERS[4] }, '/products/42'),
		ev(70, 'info', 'session', 0, 0, { action: 'start', trigger: 'userId-change', newUserId: USERS[0] }, '/products/42'),
		ev(54, 'info', 'session', 0, 0, { action: 'end', trigger: 'unload' }, '/checkout'),
		// INFO Session 1: bob - init and close
		ev(86, 'info', 'session', 1, 1, { action: 'start', trigger: 'init' }, '/'),
		ev(57, 'info', 'session', 1, 1, { action: 'end', trigger: 'unload' }, '/cart'),
		// INFO Session 2: carol - init and explicit destroy
		ev(71, 'info', 'session', 2, 2, { action: 'start', trigger: 'init' }, '/'),
		ev(44, 'info', 'session', 2, 2, { action: 'end', trigger: 'destroy' }, '/account/orders'),
		// INFO Session 3: dave - init, then logout (userId change to anon)
		ev(52, 'info', 'session', 3, 3, { action: 'start', trigger: 'init' }, '/'),
		ev(39, 'info', 'session', 3, 3, { action: 'end', trigger: 'userId-change', previousUserId: USERS[3] }, '/checkout/confirm'),
		ev(39, 'info', 'session', 3, 4, { action: 'start', trigger: 'userId-change', newUserId: USERS[4] }, '/checkout/confirm'),
		ev(35, 'info', 'session', 3, 4, { action: 'end', trigger: 'unload' }, '/checkout/confirm'),
		// INFO Session 4: anon - quick bounce
		ev(31, 'info', 'session', 4, 4, { action: 'start', trigger: 'init' }, '/'),
		ev(27, 'info', 'session', 4, 4, { action: 'end', trigger: 'unload' }, '/'),
		// INFO Session 5: anon - init and still active (no end event = current session)
		ev(21, 'info', 'session', 5, 5, { action: 'start', trigger: 'init' }, '/'),
	];

	const events: TrackerEvent[] = [
		...navEvents,
		...httpEvents,
		...errorEvents,
		...clickEvents,
		...customEvents,
		...sessionEvents,
	];

	fetch('http://localhost:4242/_tracker/events', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ events }),
	})
		.then((res) => {
			if (res.ok) {
				logger.info(`Seeded ${events.length} fixture events into the ring buffer`);
			} else {
				logger.warn(`Seed request returned HTTP ${res.status}`);
			}
		})
		.catch((err: unknown) => logger.warn(`Seed failed: ${String(err)}`));
}
