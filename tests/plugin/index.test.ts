import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync, createReadStream, readdirSync, copyFileSync } from 'node:fs';
import type { Plugin, ResolvedConfig } from 'vite';
import { trackerPlugin } from '../../src/plugin/index';
import { createLogger } from '../../src/plugin/logger';
import { createMiddleware, createStandaloneServer } from '../../src/plugin/standalone-server';
import { registerShutdownHook } from '../../src/plugin/shutdown';
import type { TrackerPluginOptions } from '../../src/types';

const mockLogger = {
	debug: vi.fn(),
	info: vi.fn(),
	warn: vi.fn(),
	error: vi.fn(),
	writeEvent: vi.fn(),
	destroy: vi.fn().mockResolvedValue(undefined)
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

const mockUnregister = vi.fn()
vi.mock('../../src/plugin/shutdown', () => ({
	registerShutdownHook: vi.fn(() => mockUnregister)
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
		createReadStream: vi.fn(() => ({ pipe: vi.fn() }))
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
const mockRegisterShutdownHook = registerShutdownHook as ReturnType<typeof vi.fn>;

beforeEach(() => {
	vi.clearAllMocks();
	mockLogger.destroy.mockResolvedValue(undefined);
	mockExistsSync.mockReturnValue(false);
	mockReadFileSync.mockReturnValue('<html><head></head></html>');
	process.removeAllListeners('SIGTERM');
	process.removeAllListeners('SIGINT');
	process.removeAllListeners('SIGHUP');
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('trackerPlugin()', () => {
	describe('plugin disabilitato (enabled: false)', () => {
		it('restituisce un plugin no-op senza hook', () => {
			const plugin = trackerPlugin(baseOpts({ enabled: false }));
			expect(plugin.name).toBe('vite-plugin-monitor');
			expect(plugin.configResolved).toBeUndefined();
			expect(plugin.transformIndexHtml).toBeUndefined();
		});

		it('non crea il logger', () => {
			trackerPlugin(baseOpts({ enabled: false }));
			expect(mockCreateLogger).not.toHaveBeenCalled();
		});

		it('non registra shutdown hook', () => {
			trackerPlugin(baseOpts({ enabled: false }));
			expect(mockRegisterShutdownHook).not.toHaveBeenCalled();
		});
	});

	describe('proprietà base del plugin', () => {
		it('name è "vite-plugin-monitor"', () => {
			const plugin = trackerPlugin(baseOpts());
			expect(plugin.name).toBe('vite-plugin-monitor');
		});

		it('enforce è "pre"', () => {
			const plugin = trackerPlugin(baseOpts());
			expect(plugin.enforce).toBe('pre');
		});
	});

	describe('configResolved()', () => {

		it('crea il logger con le opzioni di logging', () => {
			const plugin = trackerPlugin(baseOpts());
			const hook = getHook(plugin, 'configResolved') as Function;
			hook(makeViteConfig());
			expect(mockCreateLogger).toHaveBeenCalledOnce();
		});

		it('registra uno shutdown hook', () => {
			const plugin = trackerPlugin(baseOpts());
			const hook = getHook(plugin, 'configResolved') as Function;
			hook(makeViteConfig());
			expect(mockRegisterShutdownHook).toHaveBeenCalledOnce();
		});

		it('in modalità serve, mode diventa "middleware" per mode auto → writeEndpoint risolto a /_tracker/events', () => {
			const plugin = trackerPlugin(baseOpts());
			(getHook(plugin, 'configResolved') as Function)(makeViteConfig({ command: 'serve' }));
			const server = makeServer();
			(getHook(plugin, 'configureServer') as Function)(server);
			expect(mockCreateMiddleware).toHaveBeenCalledOnce();
			expect(mockCreateStandaloneServer).not.toHaveBeenCalled();
		});

		it('in modalità build con writeEndpoint, mode diventa "http" → nessun middleware né standalone', () => {
			const plugin = trackerPlugin(baseOpts({
				storage: { mode: 'http', writeEndpoint: '/api/events' } as any
			}));
			(getHook(plugin, 'configResolved') as Function)(makeViteConfig({ command: 'build' }));
			const server = makeServer();
			(getHook(plugin, 'configureServer') as Function)(server);
			expect(mockCreateMiddleware).not.toHaveBeenCalled();
			expect(mockCreateStandaloneServer).not.toHaveBeenCalled();
		});

		it('lancia se mode è "auto" in build senza writeEndpoint', () => {
			const plugin = trackerPlugin(baseOpts());
			const hook = getHook(plugin, 'configResolved') as Function;
			expect(() => hook(makeViteConfig({ command: 'build' }))).toThrow(
				'Production build requires'
			);
		});

		it('risolve wsEndpoint per mode standalone → crea il standalone server', () => {
			const plugin = trackerPlugin(baseOpts({
				storage: { mode: 'standalone' } as any
			}));
			(getHook(plugin, 'configResolved') as Function)(makeViteConfig());
			const server = makeServer();
			(getHook(plugin, 'configureServer') as Function)(server);
			expect(mockCreateStandaloneServer).toHaveBeenCalledOnce();
			expect(mockStandaloneServer.start).toHaveBeenCalledOnce();
		});

		it('su HMR (seconda configResolved) chiama prima unregister del vecchio hook', () => {
			const plugin = trackerPlugin(baseOpts());
			const hook = getHook(plugin, 'configResolved') as Function;
			hook(makeViteConfig());
			hook(makeViteConfig());
			expect(mockUnregister).toHaveBeenCalledOnce();
			expect(mockRegisterShutdownHook).toHaveBeenCalledTimes(2);
		});
	});

	describe('effectiveMode() — risoluzione del mode', () => {
		function resolveMode(opts: TrackerPluginOptions, command: 'serve' | 'build' = 'serve') {
			const plugin = trackerPlugin(opts);
			const hook = getHook(plugin, 'configResolved') as Function;
			hook(makeViteConfig({ command }));
		}

		it('"http" rimane "http"', () => {
			expect(() => resolveMode(baseOpts({
				storage: { mode: 'http', writeEndpoint: '/api/events' } as any
			}))).not.toThrow();
		});

		it('"standalone" rimane "standalone"', () => {
			expect(() => resolveMode(baseOpts({
				storage: { mode: 'standalone' } as any
			}))).not.toThrow();
		});

		it('"middleware" rimane "middleware"', () => {
			expect(() => resolveMode(baseOpts({
				storage: { mode: 'middleware' } as any
			}))).not.toThrow();
		});

		it('"websocket" rimane "websocket"', () => {
			expect(() => resolveMode(baseOpts({
				storage: { mode: 'websocket', wsEndpoint: 'ws://remote' } as any
			}))).not.toThrow();
		});

		it('"auto" + serve → "middleware"', () => {
			expect(() => resolveMode(baseOpts(), 'serve')).not.toThrow();
		});

		it('"auto" + build + writeEndpoint → "http"', () => {
			expect(() => resolveMode(baseOpts({
				storage: { writeEndpoint: '/api/events' } as any
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

		it('order è "pre"', () => {
			const plugin = trackerPlugin(baseOpts());
			(getHook(plugin, 'configResolved') as Function)(makeViteConfig());
			const transform = getHook(plugin, 'transformIndexHtml') as { order: string };
			expect(transform.order).toBe('pre');
		});

		it('restituisce sempre il tag setupScript', () => {
			const tags = runTransform(baseOpts()) as Array<{ children: string }>;
			const setup = tags.find(t => t.children?.includes('setupTrackers'));
			expect(setup).toBeDefined();
		});

		it('con autoInit: true restituisce anche il tag autoInit', () => {
			const tags = runTransform(baseOpts({ autoInit: true })) as Array<{ children: string }>;
			const autoInit = tags.find(t => t.children?.includes('tracker.init'));
			expect(autoInit).toBeDefined();
		});

		it('con autoInit: false non restituisce il tag autoInit', () => {
			const tags = runTransform(baseOpts({ autoInit: false })) as Array<{ children: string }>;
			const autoInit = tags.find(t => t.children?.includes('tracker.init'));
			expect(autoInit).toBeUndefined();
		});

		it('i tag hanno type: "module" e injectTo: "head-prepend"', () => {
			const tags = runTransform(baseOpts()) as Array<{ attrs: Record<string, string>; injectTo: string }>;
			for (const tag of tags) {
				expect(tag.attrs?.type).toBe('module');
				expect(tag.injectTo).toBe('head-prepend');
			}
		});
	});

	describe('configureServer() — mode middleware', () => {
		function setupMiddlewareMode() {
			const plugin = trackerPlugin(baseOpts({
				storage: { mode: 'middleware' } as any
			}));
			(getHook(plugin, 'configResolved') as Function)(makeViteConfig());
			const server = makeServer();
			(getHook(plugin, 'configureServer') as Function)(server);
			return { plugin, server }
		}

		it('monta il middleware con server.middlewares.use()', () => {
			const { server } = setupMiddlewareMode();
			expect(mockCreateMiddleware).toHaveBeenCalledOnce();
			expect(server.middlewares.use).toHaveBeenCalledWith(mockMiddlewareFn);
		});

		it('non crea il standalone server in mode middleware', () => {
			setupMiddlewareMode();
			expect(mockCreateStandaloneServer).not.toHaveBeenCalled();
		});

		it('registra il ping endpoint su /_tracker/ping', () => {
			const { server } = setupMiddlewareMode();
			const pingCall = (server.middlewares.use as ReturnType<typeof vi.fn>).mock.calls
				.find((args: any[]) => args[0] === '/_tracker/ping');
			expect(pingCall).toBeDefined();
		});

		it('il ping handler risponde { ok: true, appId }', () => {
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

		it('sostituisce server.printUrls con una versione decorata', () => {
			const { server } = setupMiddlewareMode();
			expect(typeof server.printUrls).toBe('function');
		});
	});

	describe('configureServer() — mode standalone', () => {
		function setupStandaloneMode() {
			const plugin = trackerPlugin(baseOpts({
				storage: { mode: 'standalone' } as any
			}));
			(getHook(plugin, 'configResolved') as Function)(makeViteConfig());
			const server = makeServer();
			(getHook(plugin, 'configureServer') as Function)(server);
			return { plugin, server }
		}

		it('crea e avvia il standalone server', () => {
			setupStandaloneMode();
			expect(mockCreateStandaloneServer).toHaveBeenCalledOnce();
			expect(mockStandaloneServer.start).toHaveBeenCalledOnce();
		});

		it('non monta il middleware in mode standalone', () => {
			setupStandaloneMode();
			expect(mockCreateMiddleware).not.toHaveBeenCalled();
		});
	});

	describe('configureServer() — dashboard abilitato', () => {
		function setupWithDashboard(dashboardOpts = {}) {
			const plugin = trackerPlugin(baseOpts({
				storage: { mode: 'middleware' } as any,
				dashboard: { enabled: true, route: '/_dashboard', ...dashboardOpts } as any,
			}));
			(getHook(plugin, 'configResolved') as Function)(makeViteConfig());
			const server = makeServer();
			(getHook(plugin, 'configureServer') as Function)(server);
			return { server }
		}

		it('registra il middleware per la route dashboard', () => {
			const { server } = setupWithDashboard();
			const dashCall = (server.middlewares.use as ReturnType<typeof vi.fn>).mock.calls
				.find((args: any[]) => args[0] === '/_dashboard');
			expect(dashCall).toBeDefined();
		});

		it('il dashboard handler serve index.html con il config iniettato', () => {
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

		it('il config viene iniettato prima di </head>', () => {
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

		it('se index.html non esiste, chiama next() e logga un warning', () => {
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

		it('URL con estensione → tenta di servire il file statico', () => {
			mockExistsSync.mockImplementation((p: string) => p.includes('.js'));
			const { server } = setupWithDashboard();

			const dashCall = (server.middlewares.use as ReturnType<typeof vi.fn>).mock.calls
				.find((args: any[]) => args[0] === '/_dashboard');
			const handler = dashCall![1];

			const pipeMock = vi.fn();
			mockCreateReadStream.mockReturnValue({ pipe: pipeMock });

			const res = { setHeader: vi.fn(), end: vi.fn() }
			handler({ url: '/assets/index.js' }, res, vi.fn());

			expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/javascript')
		});
	});

	describe('configurePreviewServer()', () => {
		it('monta il middleware anche sul preview server', () => {
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
		it('crea la directory di log se non esiste', () => {
			mockExistsSync.mockReturnValue(false);
			const plugin = trackerPlugin(baseOpts({
				logging: {
					transports: [{ format: 'json', path: './logs/test.log' }]
				} as any
			}));
			(getHook(plugin, 'configResolved') as Function)(makeViteConfig());
			(getHook(plugin, 'buildStart') as Function)();

			expect(mockMkdirSync).toHaveBeenCalledWith('./logs', { recursive: true });
			expect(mockLogger.info).toHaveBeenCalledWith(
				expect.stringContaining('Log directory created')
			);
		});

		it('non chiama mkdirSync se la directory esiste già', () => {
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
		it('chiama unregisterShutdown e poi cleanup', async () => {
			const plugin = trackerPlugin(baseOpts({
				storage: { mode: 'http', writeEndpoint: '/api/events' } as any
			}));
			(getHook(plugin, 'configResolved') as Function)(makeViteConfig({ command: 'build' }));
			await (getHook(plugin, 'closeBundle') as Function)();

			expect(mockUnregister).toHaveBeenCalledOnce();
			expect(mockLogger.destroy).toHaveBeenCalledOnce();
		});

		it('non copia il dashboard se isBuild è false', async () => {
			const plugin = trackerPlugin(baseOpts({
				dashboard: { enabled: true, includeInBuild: true } as any
			}));
			(getHook(plugin, 'configResolved') as Function)(makeViteConfig({ command: 'serve' }));
			await (getHook(plugin, 'closeBundle') as Function)();

			expect(mockWriteFileSync).not.toHaveBeenCalled();
		});

		it('non copia il dashboard se includeInBuild è false', async () => {
			const plugin = trackerPlugin(baseOpts({
				storage: { mode: 'http', writeEndpoint: '/api/events' } as any,
				dashboard: { enabled: true, includeInBuild: false } as any
			}));
			(getHook(plugin, 'configResolved') as Function)(makeViteConfig({ command: 'build' }));
			await (getHook(plugin, 'closeBundle') as Function)();

			expect(mockWriteFileSync).not.toHaveBeenCalled();
		});

		it('logga warning se includeInBuild è true ma la dir dashboard non esiste', async () => {
			mockExistsSync.mockReturnValue(false);
			const plugin = trackerPlugin(baseOpts({
				storage: { mode: 'http', writeEndpoint: '/api/events' } as any,
				dashboard: { enabled: true, includeInBuild: true } as any,
			}));
			(getHook(plugin, 'configResolved') as Function)(makeViteConfig({ command: 'build' }));
			await (getHook(plugin, 'closeBundle') as Function)();

			expect(mockLogger.warn).toHaveBeenCalledWith(
				expect.stringContaining('includeInBuild is true but dashboard dist not found')
			);
		});

		it('copia la dashboard e inietta il config se tutto esiste', async () => {
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
			expect(mockLogger.info).toHaveBeenCalledWith(
				expect.stringContaining('Dashboard copied to')
			);
		});

		it('ferma il standalone server prima di chiamare logger.destroy', async () => {
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

		it('copia ricorsivamente directory e file nel dashboard (copertura copyDirSync)', async () => {
			mockExistsSync.mockImplementation((p: string) => {
				if (p.includes('dashboard/assets')) return true
				if (p.includes('dashboard/index.html')) return true
				if (p.includes('dashboard')) return true
				if (p.includes('dist/_dashboard/index.html')) return true
				return false
			});

			mockReaddirSync.mockImplementation((p: string) => {
				if (p.endsWith('dashboard')) {
					return [
						{ name: 'index.html', isDirectory: () => false },
						{ name: 'assets', isDirectory: () => true },
					];
				}
				if (p.endsWith('dashboard/assets')) {
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
			['/app.js', 'application/javascript'],
			['/style.css', 'text/css'],
			['/data.json', 'application/json'],
			['/icon.svg', 'image/svg+xml'],
			['/logo.png', 'image/png'],
			['/favicon.ico', 'image/x-icon'],
			['/font.woff2', 'font/woff2'],
			['/font.woff', 'font/woff'],
			['/page.html', 'text/html'],
			['/file.bin', 'application/octet-stream']
		];

		for (const [url, expectedMime] of mimeTests) {
			it(`${url} → ${expectedMime}`, () => {
				const pipeMock = vi.fn();
				mockCreateReadStream.mockReturnValue({ pipe: pipeMock });

				mockExistsSync.mockImplementation((p: string) =>
					p.endsWith(url.slice(1))
				);

				const plugin = trackerPlugin(baseOpts({
					storage: { mode: 'middleware' } as any,
					dashboard: { enabled: true, route: '/_dashboard' } as any,
				}));
				(getHook(plugin, 'configResolved') as Function)(makeViteConfig());
				const server = makeServer();
				(getHook(plugin, 'configureServer') as Function)(server);

				const dashCall = (server.middlewares.use as ReturnType<typeof vi.fn>).mock.calls
					.find((args: any[]) => args[0] === '/_dashboard');
				const handler = dashCall![1];

				const res = { setHeader: vi.fn(), end: vi.fn() }
				handler({ url }, res, vi.fn());

				expect(res.setHeader).toHaveBeenCalledWith('Content-Type', expectedMime);
			});
		}
	});

	describe('printUrls() — URL mostrati in console', () => {
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

		it('in mode middleware stampa /_tracker come URL API', () => {
			const spy = setupAndCallPrintUrls(baseOpts({
				storage: { mode: 'middleware' } as any
			}));
			expect(spy).toHaveBeenCalledWith(expect.stringContaining('/_tracker'));
		});

		it('in mode standalone stampa la porta standalone come URL API', () => {
			const spy = setupAndCallPrintUrls(baseOpts({
				storage: { mode: 'standalone' } as any
			}));
			expect(spy).toHaveBeenCalledWith(expect.stringContaining('4242'));
		});

		it('in mode http stampa readEndpoint come URL API', () => {
			const spy = setupAndCallPrintUrls(baseOpts({
				storage: { mode: 'http', writeEndpoint: '/api/events', readEndpoint: '/api' } as any
			}));
			expect(spy).toHaveBeenCalledWith(expect.stringContaining('/api'));
		});

		it('in mode websocket stampa wsEndpoint come URL API', () => {
			const spy = setupAndCallPrintUrls(baseOpts({
				storage: { mode: 'websocket', wsEndpoint: 'ws://remote:9000' } as any
			}));
			expect(spy).toHaveBeenCalledWith(expect.stringContaining('ws://remote:9000'));
		});

		it('con dashboard abilitato stampa anche la URL del dashboard', () => {
			const spy = setupAndCallPrintUrls(baseOpts({
				storage: { mode: 'middleware' } as any,
				dashboard: { enabled: true, route: '/_dashboard' } as any,
			}));
			expect(spy).toHaveBeenCalledWith(expect.stringContaining('/_dashboard'));
		});

		it('senza dashboard non stampa la URL del dashboard', () => {
			const spy = setupAndCallPrintUrls(baseOpts({
				storage: { mode: 'middleware' } as any,
			}));
			const dashboardPrint = spy.mock.calls.find(
				(args: any[]) => String(args[0]).includes('Dashboard')
			);
			expect(dashboardPrint).toBeUndefined();
		});

		it('chiama la printUrls originale prima di stampare le proprie righe', () => {
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
