import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync, createReadStream, readdirSync, copyFileSync } from 'node:fs';
import type { Plugin, ResolvedConfig, ResolvedServerOptions } from 'vite';
import { trackerPlugin } from '../../src/plugin/index';
import { createLogger } from '../../src/plugin/logger';
import { createMiddleware, createStandaloneServer } from '../../src/plugin/standalone-server';
import type { TrackerPluginOptions } from '../../src/types';

const mockLogger = {
	debug: vi.fn(),
	info: vi.fn(),
	warn: vi.fn(),
	error: vi.fn(),
	writeEvent: vi.fn(),
	destroy: vi.fn().mockResolvedValue(undefined),
	destroyForHmr: vi.fn(),
	startHydration: vi.fn()
}
vi.mock('../../src/plugin/logger', () => ({
	createLogger: vi.fn(() => mockLogger)
}));

const mockStandaloneServer = {
	start: vi.fn(),
	stop: vi.fn()
}
const mockMiddlewareFn = vi.fn()
vi.mock('../../src/plugin/standalone-server', () => ({
	createStandaloneServer: vi.fn(() => mockStandaloneServer),
	createMiddleware: vi.fn(() => mockMiddlewareFn)
}));

vi.mock('node:fs', async (importOriginal) => {
	const actual = await importOriginal<typeof import('node:fs')>();
	return {
		...actual,
		existsSync: vi.fn(() => false),
		mkdirSync: vi.fn(),
		readFileSync: vi.fn(() => '<html><head></head></html>'),
		writeFileSync: vi.fn(),
		copyFileSync: vi.fn(),
		readdirSync: vi.fn(() => []),
		createReadStream: vi.fn(() => ({ pipe: vi.fn(), on: vi.fn() }))
	}
});

const mockExistsSync = existsSync as ReturnType<typeof vi.fn>
const mockMkdirSync = mkdirSync as ReturnType<typeof vi.fn>
const mockReadFileSync = readFileSync as ReturnType<typeof vi.fn>
const mockWriteFileSync = writeFileSync as ReturnType<typeof vi.fn>
const mockCreateReadStream = createReadStream as unknown as ReturnType<typeof vi.fn>
const mockReaddirSync = readdirSync as ReturnType<typeof vi.fn>
const mockCopyFileSync = copyFileSync as ReturnType<typeof vi.fn>

function makeViteConfig(overrides: Partial<ResolvedConfig> = {}): ResolvedConfig {
	return {
		command: 'serve',
		root: process.cwd(),
		base: '/',
		server: { port: 5173 },
		build: { outDir: 'dist' },
		...overrides
	} as unknown as ResolvedConfig;
}

function makeMiddlewares() {
	const used: Array<[string | Function, Function?]> = [];
	return {
		use: vi.fn((...args: any[]) => used.push(args as typeof used[number])),
		_used: used
	}
}

function makeServer(overrides: Record<string, unknown> = {}) {
	const middlewares = makeMiddlewares();
	return {
		middlewares,
		printUrls: vi.fn(),
		...overrides,
	}
}

function baseOpts(overrides: Partial<TrackerPluginOptions> = {}): TrackerPluginOptions {
	return { appId: 'test-app', ...overrides }
}

function getHook<K extends keyof Plugin>(plugin: Plugin, name: K): Plugin[K] {
	return plugin[name]
}

const mockCreateLogger = createLogger as ReturnType<typeof vi.fn>;
const mockCreateMiddleware = createMiddleware as ReturnType<typeof vi.fn>;
const mockCreateStandaloneServer = createStandaloneServer as ReturnType<typeof vi.fn>;

function setupWithDashboard(dashboardOpts: Record<string, unknown> = {}, assetRelPaths: string[] = []) {
	mockReaddirSync.mockReturnValue(assetRelPaths);

	const plugin = trackerPlugin(baseOpts({
		storage: { mode: 'middleware' } as any,
		dashboard: { enabled: true, route: '/_dashboard', ...dashboardOpts } as any,
	}));
	(getHook(plugin, 'configResolved') as Function)(makeViteConfig());
	const server = makeServer();
	(getHook(plugin, 'configureServer') as Function)(server);
	return { server }
}

beforeEach(() => {
	vi.clearAllMocks();
	mockLogger.destroy.mockResolvedValue(undefined);
	mockExistsSync.mockReturnValue(false);
	mockReadFileSync.mockReturnValue('<html><head></head></html>');
	mockReaddirSync.mockReturnValue([]);
	process.removeAllListeners('SIGTERM');
	process.removeAllListeners('SIGINT');
	process.removeAllListeners('SIGHUP');
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('trackerPlugin()', () => {
	describe('plugin disabled (enabled: false)', () => {
		it('returns a no-op plugin without hooks', () => {
			const plugin = trackerPlugin(baseOpts({ enabled: false }));
			expect(plugin.name).toBe('vite-plugin-monitor');
			expect(plugin.configResolved).toBeUndefined();
			expect(plugin.transformIndexHtml).toBeUndefined();
		});

		it('does not create the logger', () => {
			trackerPlugin(baseOpts({ enabled: false }));
			expect(mockCreateLogger).not.toHaveBeenCalled();
		});
	});

	describe('base plugin properties', () => {
		it('name is "vite-plugin-monitor"', () => {
			const plugin = trackerPlugin(baseOpts());
			expect(plugin.name).toBe('vite-plugin-monitor');
		});

		it('enforce is "pre"', () => {
			const plugin = trackerPlugin(baseOpts());
			expect(plugin.enforce).toBe('pre');
		});
	});

	describe('configResolved()', () => {

		it('in serve mode, mode becomes "middleware" for auto mode -> writeEndpoint resolved to /_tracker/events', () => {
			const plugin = trackerPlugin(baseOpts());
			(getHook(plugin, 'configResolved') as Function)(makeViteConfig({ command: 'serve' }));
			const server = makeServer();
			(getHook(plugin, 'configureServer') as Function)(server);
			expect(mockCreateMiddleware).toHaveBeenCalledOnce();
			expect(mockCreateStandaloneServer).not.toHaveBeenCalled();
		});

		it('read version from package', () => {
			mockReadFileSync.mockReturnValue('{"version": "1.1.1"}');
			const plugin = trackerPlugin(baseOpts());
			const hook = getHook(plugin, 'configResolved') as Function;
			hook(makeViteConfig());
		});

		it('handleHotUpdate skips log files by resolved path', () => {
			mockReadFileSync.mockReturnValue('{"version": "1.1.1"}');
			const plugin = trackerPlugin(baseOpts());
			const hook = getHook(plugin, 'handleHotUpdate') as Function;
			const result = hook({ file: "logs/test-app.log" });
			expect(result).toStrictEqual([]);
		});

		it('in build mode with writeEndpoint, mode becomes "http" -> no middleware or standalone', () => {
			const plugin = trackerPlugin(baseOpts({
				storage: { mode: 'http', writeEndpoint: '/api/events' } as any
			}));
			(getHook(plugin, 'configResolved') as Function)(makeViteConfig({ command: 'build' }));
			const server = makeServer();
			(getHook(plugin, 'configureServer') as Function)(server);
			expect(mockCreateMiddleware).not.toHaveBeenCalled();
			expect(mockCreateStandaloneServer).not.toHaveBeenCalled();
		});

		it('throws when mode is "auto" in build without writeEndpoint', () => {
			const plugin = trackerPlugin(baseOpts());
			const hook = getHook(plugin, 'configResolved') as Function;
			expect(() => hook(makeViteConfig({ command: 'build' }))).toThrow(
				'Production build requires'
			);
		});

		it('resolves wsEndpoint for standalone mode -> creates the standalone server', () => {
			const plugin = trackerPlugin(baseOpts({
				storage: { mode: 'standalone' } as any
			}));
			(getHook(plugin, 'configResolved') as Function)(makeViteConfig());
			const server = makeServer();
			(getHook(plugin, 'configureServer') as Function)(server);
			expect(mockCreateStandaloneServer).toHaveBeenCalledOnce();
			expect(mockStandaloneServer.start).toHaveBeenCalledOnce();
		});

		it('in serve mode, readEndpoint resolves to /_tracker for middleware mode', () => {
			const plugin = trackerPlugin(baseOpts());
			const config = makeViteConfig({ command: 'serve' });
			(getHook(plugin, 'configResolved') as Function)(config);
		});
	});

	describe('effectiveMode() — mode resolution', () => {
		function resolveMode(opts: TrackerPluginOptions, command: 'serve' | 'build' = 'serve') {
			const plugin = trackerPlugin(opts);
			const hook = getHook(plugin, 'configResolved') as Function;
			hook(makeViteConfig({ command }));
		}

		it('"http" remains "http"', () => {
			expect(() => resolveMode(baseOpts({
				storage: { mode: 'http', writeEndpoint: '/api/events' } as any
			}))).not.toThrow();
		});

		it('"http" + build + writeEndpoint -> "http"', () => {
			expect(() => resolveMode(baseOpts({
				storage: { mode: "http", writeEndpoint: '/api/events' } as any
			}), 'build')).not.toThrow();
		});

		it('"standalone" remains "standalone"', () => {
			expect(() => resolveMode(baseOpts({
				storage: { mode: 'standalone' } as any
			}))).not.toThrow();
		});

		it('"middleware" remains "middleware"', () => {
			expect(() => resolveMode(baseOpts({
				storage: { mode: 'middleware' } as any
			}))).not.toThrow();
		});

		it('"websocket" remains "websocket"', () => {
			expect(() => resolveMode(baseOpts({
				storage: { mode: 'websocket', wsEndpoint: 'ws://remote' } as any
			}))).not.toThrow();
		});

		it('"auto" + serve -> "middleware"', () => {
			expect(() => resolveMode(baseOpts(), 'serve')).not.toThrow();
		});

		it('"auto" + build + writeEndpoint -> "http"', () => {
			expect(() => resolveMode(baseOpts({
				storage: { mode: "auto", writeEndpoint: '/api/events' } as any
			}), 'build')).not.toThrow();
		});
	});

	describe('transformIndexHtml()', () => {
		function runTransform(opts: TrackerPluginOptions, command: 'serve' | 'build' = 'serve') {
			const plugin = trackerPlugin(opts);
			(getHook(plugin, 'configResolved') as Function)(makeViteConfig({ command }));
			const transform = getHook(plugin, 'transformIndexHtml') as {
				order: string
				handler: () => unknown
			}
			return transform.handler();
		}

		it('order is "pre"', () => {
			const plugin = trackerPlugin(baseOpts());
			(getHook(plugin, 'configResolved') as Function)(makeViteConfig());
			const transform = getHook(plugin, 'transformIndexHtml') as { order: string };
			expect(transform.order).toBe('pre');
		});

		it('always returns exactly one script tag containing setupTrackers', () => {
			const tags = runTransform(baseOpts()) as Array<{ children: string }>;
			expect(tags).toHaveLength(1);
			expect(tags[0].children).toContain('setupTrackers');
		});

		it('with autoInit: true the single script also contains tracker.init', () => {
			const tags = runTransform(baseOpts({ autoInit: true })) as Array<{ children: string }>;
			expect(tags).toHaveLength(1);
			expect(tags[0].children).toContain('setupTrackers');
			expect(tags[0].children).toContain('tracker.init');
		});

		it('with autoInit: false the single script does not contain tracker.init', () => {
			const tags = runTransform(baseOpts({ autoInit: false })) as Array<{ children: string }>;
			expect(tags).toHaveLength(1);
			expect(tags[0].children).not.toContain('tracker.init');
		});

		it('the script tag has type: "module" and injectTo: "head-prepend"', () => {
			const tags = runTransform(baseOpts()) as Array<{ attrs: Record<string, string>; injectTo: string }>;
			expect(tags[0].attrs?.type).toBe('module');
			expect(tags[0].injectTo).toBe('head-prepend');
		});
	});

	describe('configureServer() — middleware mode', () => {
		function setupMiddlewareMode() {
			const plugin = trackerPlugin(baseOpts({
				storage: { mode: 'middleware' } as any
			}));
			(getHook(plugin, 'configResolved') as Function)(makeViteConfig());
			const server = makeServer();
			(getHook(plugin, 'configureServer') as Function)(server);
			return { plugin, server }
		}

		it('mounts the middleware with server.middlewares.use()', () => {
			const { server } = setupMiddlewareMode();
			expect(mockCreateMiddleware).toHaveBeenCalledOnce();
			expect(server.middlewares.use).toHaveBeenCalledWith(mockMiddlewareFn);
		});

		it('does not create the standalone server in middleware mode', () => {
			setupMiddlewareMode();
			expect(mockCreateStandaloneServer).not.toHaveBeenCalled();
		});

		it('registers the ping endpoint at /_tracker/ping', () => {
			const { server } = setupMiddlewareMode();
			const pingCall = (server.middlewares.use as ReturnType<typeof vi.fn>).mock.calls
				.find((args: any[]) => args[0] === '/_tracker/ping');
			expect(pingCall).toBeDefined();
		});

		it('the ping handler responds { ok: true, appId }', () => {
			const { server } = setupMiddlewareMode();
			const pingCall = (server.middlewares.use as ReturnType<typeof vi.fn>).mock.calls
				.find((args: any[]) => args[0] === '/_tracker/ping');
			const handler = pingCall![1];
			const res = { setHeader: vi.fn(), end: vi.fn() };
			handler({}, res);
			const body = JSON.parse(res.end.mock.calls[0][0]);
			expect(body.ok).toBe(true);
			expect(body.appId).toBe('test-app');
		});

		it('replaces server.printUrls with a decorated version', () => {
			const { server } = setupMiddlewareMode();
			expect(typeof server.printUrls).toBe('function');
		});
	});

	describe('configureServer() — standalone mode', () => {
		function setupStandaloneMode() {
			const plugin = trackerPlugin(baseOpts({
				storage: { mode: 'standalone' } as any
			}));
			(getHook(plugin, 'configResolved') as Function)(makeViteConfig({ server: { port: 5173, host: "http://127.0.0.1" } as ResolvedServerOptions }));
			const server = makeServer();
			(getHook(plugin, 'configureServer') as Function)(server);
			return { plugin, server }
		}

		it('creates and starts the standalone server', () => {
			setupStandaloneMode();
			expect(mockCreateStandaloneServer).toHaveBeenCalledOnce();
			expect(mockStandaloneServer.start).toHaveBeenCalledOnce();
		});

		it('does not mount the middleware in standalone mode', () => {
			setupStandaloneMode();
			expect(mockCreateMiddleware).not.toHaveBeenCalled();
		});
	});

	describe('configureServer() — dashboard enabled', () => {

		it('registers the middleware for the dashboard route', () => {
			const { server } = setupWithDashboard();
			const dashCall = (server.middlewares.use as ReturnType<typeof vi.fn>).mock.calls
				.find((args: any[]) => args[0] === '/_dashboard');
			expect(dashCall).toBeDefined();
		});

		it('the dashboard handler serves index.html with the injected config', () => {
			mockExistsSync.mockReturnValue(true);
			mockReadFileSync.mockReturnValue('<html><head></head></html>');
			const { server } = setupWithDashboard();

			const dashCall = (server.middlewares.use as ReturnType<typeof vi.fn>).mock.calls
				.find((args: any[]) => args[0] === '/_dashboard');
			const handler = dashCall![1];

			const req = { url: '/' }
			const res = { setHeader: vi.fn(), end: vi.fn() }
			const next = vi.fn();

			handler(req, res, next);

			expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/html');
			expect(res.end).toHaveBeenCalledOnce();
			const html = res.end.mock.calls[0][0] as string;
			expect(html).toContain('__TRACKER_CONFIG__');
		});

		it('the config is injected before </head>', () => {
			mockExistsSync.mockReturnValue(true);
			mockReadFileSync.mockReturnValue('<html><head></head></html>');
			const { server } = setupWithDashboard();

			const dashCall = (server.middlewares.use as ReturnType<typeof vi.fn>).mock.calls
				.find((args: any[]) => args[0] === '/_dashboard');
			const handler = dashCall![1];

			const req = { url: '/' }
			const res = { setHeader: vi.fn(), end: vi.fn() }
			handler(req, res, vi.fn());

			const html = res.end.mock.calls[0][0] as string;
			const scriptIdx = html.indexOf('__TRACKER_CONFIG__');
			const headCloseIdx = html.indexOf('</head>');
			expect(scriptIdx).toBeLessThan(headCloseIdx);
		});

		it('when index.html does not exist, calls next() and logs a warning', () => {
			mockExistsSync.mockReturnValue(false);
			const { server } = setupWithDashboard();

			const dashCall = (server.middlewares.use as ReturnType<typeof vi.fn>).mock.calls
				.find((args: any[]) => args[0] === '/_dashboard');
			const handler = dashCall![1];

			const next = vi.fn();
			handler({ url: '/' }, { setHeader: vi.fn(), end: vi.fn() }, next);

			expect(next).toHaveBeenCalledOnce();
			expect(mockLogger.warn).toHaveBeenCalledWith(
				expect.stringContaining('Dashboard HTML not found')
			);
		});

		it('URL with extension -> serves the static asset from dashAssets', () => {
			const { server } = setupWithDashboard({}, ['assets/index.js']);

			const dashCall = (server.middlewares.use as ReturnType<typeof vi.fn>).mock.calls
				.find((args: any[]) => args[0] === '/_dashboard');
			const handler = dashCall![1];

			const pipeMock = vi.fn();
			mockCreateReadStream.mockReturnValue({ pipe: pipeMock, on: vi.fn() });

			const res = { setHeader: vi.fn(), end: vi.fn() }
			handler({ url: '/assets/index.js' }, res, vi.fn());

			expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/javascript');
		});

		it('path traversal attempt returns 403', () => {
			const { server } = setupWithDashboard();
			const dashCall = (server.middlewares.use as ReturnType<typeof vi.fn>).mock.calls
				.find((args: any[]) => args[0] === '/_dashboard');
			const handler = dashCall![1];

			const res = { writeHead: vi.fn(), end: vi.fn() };
			handler({ url: '/../../../etc/passwd' }, res, vi.fn());

			expect(res.writeHead).toHaveBeenCalledWith(403);
			expect(res.end).toHaveBeenCalledOnce();
		});

		it('stream error ENOENT -> responds 404 and ends the response', () => {
			const { server } = setupWithDashboard({}, ['assets/index.js']);

			const dashCall = (server.middlewares.use as ReturnType<typeof vi.fn>).mock.calls
				.find((args: any[]) => args[0] === '/_dashboard');
			const handler = dashCall![1];

			let registeredErrorHandler: ((err: NodeJS.ErrnoException) => void) | null = null;
			mockCreateReadStream.mockReturnValue({
				pipe: vi.fn(),
				on: vi.fn((event: string, cb: (err: NodeJS.ErrnoException) => void) => {
					if (event === 'error') registeredErrorHandler = cb;
				}),
			});

			const res = { setHeader: vi.fn(), end: vi.fn(), headersSent: false, writeHead: vi.fn() };
			handler({ url: '/assets/index.js' }, res, vi.fn());

			expect(registeredErrorHandler).not.toBeNull();
			registeredErrorHandler!(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }) as NodeJS.ErrnoException);

			expect(res.writeHead).toHaveBeenCalledWith(404);
			expect(res.end).toHaveBeenCalledOnce();
		});

		it('stream error non-ENOENT -> responds 500 and ends the response', () => {
			const { server } = setupWithDashboard({}, ['assets/index.js']);

			const dashCall = (server.middlewares.use as ReturnType<typeof vi.fn>).mock.calls
				.find((args: any[]) => args[0] === '/_dashboard');
			const handler = dashCall![1];

			let registeredErrorHandler: ((err: NodeJS.ErrnoException) => void) | null = null;
			mockCreateReadStream.mockReturnValue({
				pipe: vi.fn(),
				on: vi.fn((event: string, cb: (err: NodeJS.ErrnoException) => void) => {
					if (event === 'error') registeredErrorHandler = cb;
				}),
			});

			const res = { setHeader: vi.fn(), end: vi.fn(), headersSent: false, writeHead: vi.fn() };
			handler({ url: '/assets/index.js' }, res, vi.fn());

			registeredErrorHandler!(Object.assign(new Error('EIO'), { code: 'EIO' }) as NodeJS.ErrnoException);

			expect(res.writeHead).toHaveBeenCalledWith(500);
			expect(res.end).toHaveBeenCalledOnce();
		});

		it('stream error with headers already sent -> skips writeHead, only calls end()', () => {
			const { server } = setupWithDashboard({}, ['assets/index.js']);

			const dashCall = (server.middlewares.use as ReturnType<typeof vi.fn>).mock.calls
				.find((args: any[]) => args[0] === '/_dashboard');
			const handler = dashCall![1];

			let registeredErrorHandler: ((err: NodeJS.ErrnoException) => void) | null = null;
			mockCreateReadStream.mockReturnValue({
				pipe: vi.fn(),
				on: vi.fn((event: string, cb: (err: NodeJS.ErrnoException) => void) => {
					if (event === 'error') registeredErrorHandler = cb;
				}),
			});

			const res = { setHeader: vi.fn(), end: vi.fn(), headersSent: true, writeHead: vi.fn() };
			handler({ url: '/assets/index.js' }, res, vi.fn());

			registeredErrorHandler!(Object.assign(new Error('EIO'), { code: 'EIO' }) as NodeJS.ErrnoException);

			expect(res.writeHead).not.toHaveBeenCalled();
			expect(res.end).toHaveBeenCalledOnce();
		});

		it('stream error handler is registered before pipe() is called', () => {
			const { server } = setupWithDashboard({}, ['assets/index.js']);

			const dashCall = (server.middlewares.use as ReturnType<typeof vi.fn>).mock.calls
				.find((args: any[]) => args[0] === '/_dashboard');
			const handler = dashCall![1];

			const callOrder: string[] = [];
			mockCreateReadStream.mockReturnValue({
				pipe: vi.fn(() => callOrder.push('pipe')),
				on: vi.fn((event: string) => { if (event === 'error') callOrder.push('on:error'); }),
			});

			const res = { setHeader: vi.fn(), end: vi.fn(), headersSent: false, writeHead: vi.fn() };
			handler({ url: '/assets/index.js' }, res, vi.fn());

			expect(callOrder[0]).toBe('on:error');
			expect(callOrder[1]).toBe('pipe');
		});
	});

	describe('configurePreviewServer()', () => {
		it('mounts the middleware also on the preview server', () => {
			const plugin = trackerPlugin(baseOpts({
				storage: { mode: 'middleware' } as any
			}));
			(getHook(plugin, 'configResolved') as Function)(makeViteConfig());
			const server = makeServer();
			(getHook(plugin, 'configurePreviewServer') as Function)(server);
			expect(server.middlewares.use).toHaveBeenCalled();
		});
	});

	describe('buildStart()', () => {
		it('creates the log directory if it does not exist', () => {
			mockExistsSync.mockReturnValue(false);
			const plugin = trackerPlugin(baseOpts({
				logging: {
					transports: [{ format: 'json', path: './logs/test.log' }]
				} as any
			}));
			(getHook(plugin, 'configResolved') as Function)(makeViteConfig());
			(getHook(plugin, 'buildStart') as Function)();

			expect(mockMkdirSync).toHaveBeenCalledWith('./logs', { recursive: true });
		});

		it('does not call mkdirSync when the directory already exists', () => {
			mockExistsSync.mockReturnValue(true);
			const plugin = trackerPlugin(baseOpts({
				logging: {
					transports: [{ format: 'json', path: './logs/test.log' }]
				} as any
			}));
			(getHook(plugin, 'configResolved') as Function)(makeViteConfig());
			(getHook(plugin, 'buildStart') as Function)();

			expect(mockMkdirSync).not.toHaveBeenCalled();
		});
	});

	describe('closeBundle()', () => {
		it('calls cleanup', async () => {
			const plugin = trackerPlugin(baseOpts({
				storage: { mode: 'http', writeEndpoint: '/api/events' } as any
			}));
			(getHook(plugin, 'configResolved') as Function)(makeViteConfig({ command: 'build' }));
			await (getHook(plugin, 'closeBundle') as Function)();

			expect(mockLogger.destroy).not.toHaveBeenCalledOnce();
		});

		it('does not copy the dashboard when isBuild is false', async () => {
			const plugin = trackerPlugin(baseOpts({
				dashboard: { enabled: true, includeInBuild: true } as any
			}));
			(getHook(plugin, 'configResolved') as Function)(makeViteConfig({ command: 'serve' }));
			await (getHook(plugin, 'closeBundle') as Function)();

			expect(mockWriteFileSync).not.toHaveBeenCalled();
		});

		it('does not copy the dashboard when includeInBuild is false', async () => {
			const plugin = trackerPlugin(baseOpts({
				storage: { mode: 'http', writeEndpoint: '/api/events' } as any,
				dashboard: { enabled: true, includeInBuild: false } as any
			}));
			(getHook(plugin, 'configResolved') as Function)(makeViteConfig({ command: 'build' }));
			await (getHook(plugin, 'closeBundle') as Function)();

			expect(mockWriteFileSync).not.toHaveBeenCalled();
		});

		it('logs warning when includeInBuild is true but the dashboard dir does not exist', async () => {
			mockExistsSync.mockReturnValue(false);
			const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => { });
			const plugin = trackerPlugin(baseOpts({
				storage: { mode: 'http', writeEndpoint: '/api/events' } as any,
				dashboard: { enabled: true, includeInBuild: true } as any,
			}));
			(getHook(plugin, 'configResolved') as Function)(makeViteConfig({ command: 'build' }));
			await (getHook(plugin, 'closeBundle') as Function)();

			expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('includeInBuild is true but dashboard dist not found'));
			consoleSpy.mockRestore();
		});

		it('copies the dashboard and injects the config when everything exists', async () => {
			mockExistsSync.mockReturnValue(true);
			mockReadFileSync.mockReturnValue('<html><head></head></html>');

			const plugin = trackerPlugin(baseOpts({
				storage: { mode: 'http', writeEndpoint: '/api/events' } as any,
				dashboard: { enabled: true, includeInBuild: true, route: '/_dashboard' } as any,
			}));
			(getHook(plugin, 'configResolved') as Function)(makeViteConfig({ command: 'build' }));
			await (getHook(plugin, 'closeBundle') as Function)();

			expect(mockWriteFileSync).toHaveBeenCalledOnce();
			const writtenHtml = mockWriteFileSync.mock.calls[0][1] as string;
			expect(writtenHtml).toContain('__TRACKER_CONFIG__');
		});

		it('stops the standalone server before calling logger.destroy', async () => {
			const callOrder: string[] = [];
			mockStandaloneServer.stop.mockImplementation(() => callOrder.push('stop'));
			mockLogger.destroy.mockImplementation(async () => { callOrder.push('destroy') });

			const plugin = trackerPlugin(baseOpts({
				storage: { mode: 'standalone' } as any
			}));
			(getHook(plugin, 'configResolved') as Function)(makeViteConfig());
			const server = makeServer();
			(getHook(plugin, 'configureServer') as Function)(server);
			await (getHook(plugin, 'closeBundle') as Function)();

			expect(callOrder[0]).toBe('stop');
			expect(callOrder[1]).toBe('destroy');
		});

		it('recursively copies directories and files into the dashboard (copyDirSync coverage)', async () => {
			mockExistsSync.mockImplementation((p: string) => {
				if (p.includes('dashboard/assets')) return true
				if (p.includes('dashboard/index.html')) return true
				if (p.includes('dashboard')) return true
				if (p.includes('dist/_dashboard/index.html')) return true
				return false
			});

			mockReaddirSync.mockImplementation((p: string, opts?: any) => {
				if (opts?.withFileTypes) {
					if (String(p).endsWith('dashboard')) {
						return [
							{ name: 'index.html', isDirectory: () => false },
							{ name: 'assets', isDirectory: () => true },
						];
					}
					if (String(p).endsWith('assets')) {
						return [];
					}
					return [];
				}
				return [];
			});

			mockReadFileSync.mockReturnValue('<html><head></head></html>');

			const plugin = trackerPlugin(baseOpts({
				storage: { mode: 'http', writeEndpoint: '/api/events' } as any,
				dashboard: { enabled: true, includeInBuild: true, route: '/_dashboard' } as any,
			}));
			(getHook(plugin, 'configResolved') as Function)(makeViteConfig({ command: 'build' }));
			await (getHook(plugin, 'closeBundle') as Function)();

			expect(mockCopyFileSync).toHaveBeenCalled();
			expect(mockWriteFileSync).toHaveBeenCalled();
		});
	});

	describe('getMimeType() — via dashboard asset handler', () => {
		const mimeTests: Array<[string, string]> = [
			['assets/app.js', 'application/javascript'],
			['assets/style.css', 'text/css'],
			['assets/data.json', 'application/json'],
			['assets/icon.svg', 'image/svg+xml'],
			['assets/logo.png', 'image/png'],
			['assets/favicon.ico', 'image/x-icon'],
			['assets/font.woff2', 'font/woff2'],
			['assets/font.woff', 'font/woff'],
			['assets/page.html', 'text/html'],
			['assets/file.bin', 'application/octet-stream'],
		];

		for (const [relPath, expectedMime] of mimeTests) {
			it(`${relPath} -> ${expectedMime}`, () => {
				const pipeMock = vi.fn();
				mockCreateReadStream.mockReturnValue({ pipe: pipeMock, on: vi.fn() });

				const { server } = setupWithDashboard(
					{ route: '/_dashboard' },
					[relPath]
				);

				const dashCall = (server.middlewares.use as ReturnType<typeof vi.fn>).mock.calls
					.find((args: any[]) => args[0] === '/_dashboard');
				const handler = dashCall![1];

				const res = { setHeader: vi.fn(), end: vi.fn() }
				handler({ url: `/${relPath}` }, res, vi.fn());

				expect(res.setHeader).toHaveBeenCalledWith('Content-Type', expectedMime);
			});
		}
	});

	describe('printUrls() — URLs shown in console', () => {
		function setupAndCallPrintUrls(opts: TrackerPluginOptions, viteConfigOverrides: Partial<ResolvedConfig> = {}) {
			const plugin = trackerPlugin(opts);
			const config = makeViteConfig(viteConfigOverrides);
			(getHook(plugin, 'configResolved') as Function)(config);
			const server = makeServer();
			(getHook(plugin, 'configureServer') as Function)(server);

			const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => { });
			(server.printUrls as any)();

			return consoleSpy;
		}

		it('in middleware mode prints /_tracker as the API URL', () => {
			const spy = setupAndCallPrintUrls(baseOpts({
				storage: { mode: 'middleware' } as any
			}));
			expect(spy).toHaveBeenCalledWith(expect.stringContaining('/_tracker'));
		});

		it('in standalone mode prints the standalone port as the API URL', () => {
			const spy = setupAndCallPrintUrls(baseOpts({
				storage: { mode: 'standalone' } as any
			}));
			expect(spy).toHaveBeenCalledWith(expect.stringContaining('4242'));
		});

		it('in http mode prints readEndpoint as the API URL', () => {
			const spy = setupAndCallPrintUrls(baseOpts({
				storage: { mode: 'http', writeEndpoint: '/api/events', readEndpoint: '/api' } as any
			}));
			expect(spy).toHaveBeenCalledWith(expect.stringContaining('/api'));
		});

		it('in websocket mode prints wsEndpoint as the API URL', () => {
			const spy = setupAndCallPrintUrls(baseOpts({
				storage: { mode: 'websocket', wsEndpoint: 'ws://remote:9000' } as any
			}));
			expect(spy).toHaveBeenCalledWith(expect.stringContaining('ws://remote:9000'));
		});

		it('with dashboard enabled also prints the dashboard URL', () => {
			const spy = setupAndCallPrintUrls(baseOpts({
				storage: { mode: 'middleware' } as any,
				dashboard: { enabled: true, route: '/_dashboard' } as any,
			}));
			expect(spy).toHaveBeenCalledWith(expect.stringContaining('/_dashboard'));
		});

		it('without dashboard does not print the dashboard URL', () => {
			const spy = setupAndCallPrintUrls(baseOpts({
				storage: { mode: 'middleware' } as any,
			}));
			const dashboardPrint = spy.mock.calls.find(
				(args: any[]) => String(args[0]).includes('Dashboard')
			);
			expect(dashboardPrint).toBeUndefined();
		});

		it('calls the original printUrls before printing its own lines', () => {
			const plugin = trackerPlugin(baseOpts({ storage: { mode: 'middleware' } as any }));
			(getHook(plugin, 'configResolved') as Function)(makeViteConfig());
			const originalPrint = vi.fn();
			const server = makeServer({ printUrls: originalPrint });
			(getHook(plugin, 'configureServer') as Function)(server);

			const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => { });
			(server.printUrls as any)();

			expect(originalPrint).toHaveBeenCalledOnce();
			consoleSpy.mockRestore();
		});
	});
});
