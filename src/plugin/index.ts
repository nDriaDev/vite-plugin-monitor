/* eslint-disable no-undef */
import type { Logger, ResolvedTrackerOptions, TrackerPluginOptions } from "@tracker/types";
import type { HtmlTagDescriptor, Plugin, PreviewServer, ResolvedConfig, ViteDevServer } from "vite";
import { resolveOptions } from "./config";
import { createLogger } from "./logger";
import { createMiddleware, createStandaloneServer } from "./standalone-server";
import { registerShutdownHook } from "./shutdown";
import { generateAutoInitScript, generateConfigScript, generateSetupScript } from "./codegen";
import { version } from '../../package.json';
import path from "node:path";
import { copyFileSync, createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function copyDirSync(src: string, dest: string): void {
	mkdirSync(dest, { recursive: true });
	for (const entry of readdirSync(src, { withFileTypes: true })) {
		const srcPath = path.join(src, entry.name);
		const destPath = path.join(dest, entry.name);
		if (entry.isDirectory()) {
			copyDirSync(srcPath, destPath);
		} else {
			copyFileSync(srcPath, destPath);
		}
	}
}

function getMimeType(filePath: string): string {
	const ext = path.extname(filePath).toLowerCase();
	const map: Record<string, string> = {
		'.html': 'text/html',
		'.js': 'application/javascript',
		'.css': 'text/css',
		'.json': 'application/json',
		'.svg': 'image/svg+xml',
		'.png': 'image/png',
		'.ico': 'image/x-icon',
		'.woff2': 'font/woff2',
		'.woff': 'font/woff',
	};
	return map[ext] ?? 'application/octet-stream';
}

export function trackerPlugin(options: TrackerPluginOptions): Plugin {
	const opts = resolveOptions(options);
	if (!opts.enabled) {
		return { name: 'vite-plugin-monitor' }
	}

	let logger: Logger;
	let viteConfig: ResolvedConfig;
	let isBuild = false;
	let mode: "http" | "standalone" | "middleware" | "websocket";
	let standalone: ReturnType<typeof createStandaloneServer> | null = null;
	let unregisterShutdown: (() => void) | null = null;

	let cachedSetupScript: string | null = null;
	let cachedAutoInitScript: string | null = null;
	let cachedDashboardHtml: string | null = null;

	function cleanupForHmr() {
		standalone?.stop();
		standalone = null;
		cachedSetupScript = null;
		cachedAutoInitScript = null;
		cachedDashboardHtml = null;
	}

	async function cleanup() {
		standalone?.stop();
		standalone = null;
		await logger?.destroy();
		cachedSetupScript = null;
		cachedAutoInitScript = null;
		cachedDashboardHtml = null;
	}

	function effectiveMode(opts: ResolvedTrackerOptions, isBuild: boolean): 'http' | 'standalone' | 'middleware' | 'websocket' {
		const m = opts.storage.mode;
		if (m === 'http') {
			return 'http';
		}
		if (m === 'standalone') {
			return 'standalone';
		}
		if (m === 'middleware') {
			return 'middleware';
		}
		if (m === "websocket") {
			return 'websocket';
		}
		if (isBuild) {
			if (!opts.storage.writeEndpoint) {
				throw new Error('[vite-plugin-monitor] Production build requires storage.mode = "http" with a valid writeEndpoint. Set storage.mode explicitly or provide storage.writeEndpoint.');
			}
			return 'http';
		}
		return 'middleware';
	}

	function resolvedWsEndpoint(mode: ReturnType<typeof effectiveMode>): string {
		return mode === "standalone"
			? `ws://localhost:${opts.storage.port}/_tracker/ws`
			: mode === "websocket"
				? opts.storage.wsEndpoint
				: '';
	}

	function resolvedWriteEndpoint(mode: ReturnType<typeof effectiveMode>): string {
		return mode === "http"
			? opts.storage.writeEndpoint
			: mode === "standalone"
				? `http://localhost:${opts.storage.port}/_tracker/events`
				: mode === "middleware"
					? '/_tracker/events'
					: '';
	}

	function resolvedReadEndpoint(mode: ReturnType<typeof effectiveMode>): string {
		return mode === "http"
			? opts.storage.readEndpoint
				? opts.storage.readEndpoint
				: opts.storage.writeEndpoint.replace(/\/events\/?$/, "")
			: mode === "standalone"
				? `http://localhost:${opts.storage.port}/_tracker`
				: "/_tracker";
	}

	/* v8 ignore start */
	function dashboardDistDir(): string {
		try {
			const __filename = fileURLToPath(import.meta.url);
			return path.join(path.dirname(__filename), 'dashboard');
		} catch {
			return path.join(__dirname, 'dashboard');
		}
	}
	/* v8 ignore stop */

	function configureServer(server: ViteDevServer | PreviewServer) {
		if (mode === 'middleware') {
			server.middlewares.use(createMiddleware(opts, logger));
			logger.info('Middleware mounted on Vite dev server');
		} else if (mode === 'standalone') {
			standalone = createStandaloneServer(opts, logger);
			standalone.start();
		}

		server.middlewares.use('/_tracker/ping', (_req, res) => {
			res.setHeader('Content-Type', 'application/json');
			res.end(JSON.stringify({ ok: true, appId: opts.appId, mode, version }));
		});

		if (opts.dashboard.enabled) {
			const dashDir = dashboardDistDir();

			server.middlewares.use(opts.dashboard.route, (req, res, next) => {
				const url = req.url ?? '/';
				if (url !== '/' && url.includes('.')) {
					const filePath = path.join(dashDir, url);
					if (existsSync(filePath)) {
						res.setHeader('Content-Type', getMimeType(filePath));
						createReadStream(filePath).pipe(res);
						return;
					}
				}

				if (!cachedDashboardHtml) {
					const indexPath = path.join(dashDir, 'index.html');
					if (!existsSync(indexPath)) {
						logger.warn(
							`Dashboard HTML not found at ${indexPath}. ` +
							`Run 'pnpm build:dashboard' to build the dashboard first.`
						);
						return next();
					}
					let html = readFileSync(indexPath, 'utf8');
					const dashRoute = opts.dashboard.route.replace(/\/$/, '') + '/';
					html = html.replace(/(src|href)="\.\//g, `$1="${dashRoute}`);
					const configScript = `<script>${generateConfigScript(opts)}</script>`;
					html = html.replace('</head>', `${configScript}\n</head>`);
					cachedDashboardHtml = html;
				}

				res.setHeader('Content-Type', 'text/html');
				res.end(cachedDashboardHtml);
			});
		}

		server.printUrls = (function (originalPrint) {
			return function () {
				originalPrint.call(server);
				const port = viteConfig.server?.port ?? 5173;
				const base = (viteConfig.base ?? '/').replace(/\/$/, '');
				const dash = opts.dashboard.route;
				const apiUrl = mode === 'standalone'
					? `http://localhost:${opts.storage.port}/_tracker`
					: mode === 'http'
						? opts.storage.readEndpoint
							? opts.storage.readEndpoint
							: opts.storage.writeEndpoint.replace(/\/events\/?$/, "")
						: mode === 'websocket'
							? opts.storage.wsEndpoint
							: `http://localhost:${port}${base}/_tracker`;

				console.log(
					`  \x1b[32m➜\x1b[0m  \x1b[1mvite-plugin-monitor Tracker API\x1b[0m:       ` +
					`\x1b[36m${apiUrl}\x1b[0m`
				);

				if (opts.dashboard.enabled) {
					console.log(
						`  \x1b[32m➜\x1b[0m  \x1b[1mvite-plugin-monitor Dashboard\x1b[0m:       ` +
						`\x1b[36mhttp://localhost:${port}${base}${dash}\x1b[0m`
					);
				}
			}
		})(server.printUrls);
	}

	return {
		name: 'vite-plugin-monitor',
		enforce: 'pre',

		configResolved(config) {
			viteConfig = config;
			isBuild = config.command === 'build';
			mode = effectiveMode(opts, isBuild);

			/**
			 * INFO If buildVersion was not set explicitly, fall back to the consumer
			 * project's package.json version. config.root is the reliable way to find
			 * it — it is the Vite-resolved project root, independent of how Vite was invoked.
			 */
			if (!opts.buildVersion) {
				try {
					const pkgPath = path.join(config.root, 'package.json');
					const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
					if (pkg.version) {
						opts.buildVersion = pkg.version;
					}
				} catch {
					opts.buildVersion = "X.X.X";
				}
			}

			/**
			 * INFO
			 * Capture the previous logger instance BEFORE overwriting the reference.
			 * destroyForHmr() must run on the OLD logger, not the one we are about
			 * to create. Keeping this as an explicit local variable makes the
			 * ordering invariant visible and impossible to break by accident.
			 */
			const prevLogger = logger;
			unregisterShutdown?.();

			prevLogger?.destroyForHmr();
			cleanupForHmr();

			logger = createLogger(opts.appId, opts.logging);

			opts.storage.wsEndpoint = resolvedWsEndpoint(mode);
			opts.storage.writeEndpoint = resolvedWriteEndpoint(mode);
			opts.storage.readEndpoint = resolvedReadEndpoint(mode);

			cachedSetupScript = generateSetupScript(opts, isBuild);
			cachedAutoInitScript = opts.autoInit ? generateAutoInitScript(opts, isBuild) : null;

			unregisterShutdown = registerShutdownHook(cleanup);

			logger.info(`Plugin initialized - appId: ${opts.appId}, command: ${config.command}`);
		},

		transformIndexHtml: {
			order: 'pre',
			handler() {
				const tags: HtmlTagDescriptor[] = [
					{
						tag: 'script',
						attrs: { type: 'module' },
						children: cachedSetupScript ?? generateSetupScript(opts, isBuild),
						injectTo: 'head-prepend',
					}
				];
				if (opts.autoInit && cachedAutoInitScript) {
					tags.push({
						tag: 'script',
						attrs: { type: 'module' },
						children: cachedAutoInitScript,
						injectTo: 'head-prepend',
					});
				}
				return tags;
			},
		},

		configureServer(server) {
			configureServer(server);
		},

		configurePreviewServer(server) {
			configureServer(server);
		},

		buildStart() {
			for (const t of opts.logging?.transports ?? []) {
				const dir = path.dirname(t.path);
				if (!existsSync(dir)) {
					mkdirSync(dir, { recursive: true });
					logger.info(`Log directory created: ${dir}`);
				}
			}
		},

		/**
		 * INFO Normal shutdown (build lifecycle)
		 * CloseBundle runs at the end of `vite build` and when the dev server is stopped cleanly via the Vite API.
		 * For signal-based termination the signal handler registered in configResolved covers this path.
		 */
		async closeBundle() {
			unregisterShutdown?.();
			unregisterShutdown = null;
			if (isBuild && opts.dashboard?.includeInBuild) {
				const dashSrc = dashboardDistDir();
				const dashDest = path.join(
					viteConfig.build.outDir,
					opts.dashboard.route.replace(/^\//, '')
				);

				if (existsSync(dashSrc)) {
					copyDirSync(dashSrc, dashDest);
					const copiedIndex = path.join(dashDest, 'index.html');
					if (existsSync(copiedIndex)) {
						let html = readFileSync(copiedIndex, 'utf8');
						const configScript = `<script>${generateConfigScript(opts)}</script>`;
						html = html.replace('</head>', `${configScript}\n</head>`);
						writeFileSync(copiedIndex, html);
					}
					logger.info(`Dashboard copied to ${dashDest}`);
				} else {
					logger.warn(
						`includeInBuild is true but dashboard dist not found at ${dashSrc}. ` +
						`Run 'pnpm build:dashboard' before 'vite build'.`
					);
				}
			}
			await cleanup();
		},
	}
}
