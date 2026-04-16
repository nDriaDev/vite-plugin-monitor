import type { Logger, ResolvedTrackerOptions, TrackerPluginOptions } from "@tracker/types";
import { normalizePath, type Plugin, type PreviewServer, type ResolvedConfig, type ViteDevServer } from "vite";
import { resolveOptions } from "./config";
import { createLogger } from "./logger";
import { createMiddleware, createStandaloneServer } from "./standalone-server";
import { generateConfigScript, generateSetupScript } from "./codegen";
import { version } from '../../package.json';
import { copyFileSync, createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, extname, join, resolve, sep } from "node:path";

const mimeTypeMap: Record<string, string> = {
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

function copyDirSync(src: string, dest: string): void {
	mkdirSync(dest, { recursive: true });
	for (const entry of readdirSync(src, { withFileTypes: true })) {
		const srcPath = join(src, entry.name);
		const destPath = join(dest, entry.name);
		if (entry.isDirectory()) {
			copyDirSync(srcPath, destPath);
		} else {
			copyFileSync(srcPath, destPath);
		}
	}
}

function getMimeType(filePath: string): string {
	const ext = extname(filePath).toLowerCase();
	return mimeTypeMap[ext] ?? 'application/octet-stream';
}

function getLogPaths(transports: ResolvedTrackerOptions["logging"]["transports"]) {
	return (transports ?? []).map(t => normalizePath(resolve(t.path)))
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
	let cachedSetupScript: string | null = null;
	let cachedDashboardHtml: string | null = null;
	let standalone: ReturnType<typeof createStandaloneServer> | null = null;
	let logPaths: string[] | null = null;

	async function cleanup() {
		standalone?.stop();
		standalone = null;
		await logger?.destroy();
		cachedSetupScript = null;
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

	function resolvedHost(): string {
		const h = viteConfig.server?.host;
		if (!h || h === true) {
			return 'localhost';
		}
		return h;
	}

	function resolvedWsEndpoint(mode: ReturnType<typeof effectiveMode>): string {
		return mode === "standalone"
			? `ws://${resolvedHost()}:${opts.storage.port}/_tracker/ws`
			: mode === "websocket"
				? opts.storage.wsEndpoint
				: '';
	}

	function resolvedWriteEndpoint(mode: ReturnType<typeof effectiveMode>): string {
		return mode === "http"
			? opts.storage.writeEndpoint
			: mode === "standalone"
				? `http://${resolvedHost()}:${opts.storage.port}/_tracker/events`
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
				? `http://${resolvedHost()}:${opts.storage.port}/_tracker`
				: "/_tracker";
	}

	/* v8 ignore start */
	function dashboardDistDir(): string {
		try {
			const __filename = fileURLToPath(import.meta.url);
			return join(dirname(__filename), 'dashboard');
		} catch {
			return join(__dirname, 'dashboard');
		}
	}
	/* v8 ignore stop */

	function configureServer(server: ViteDevServer | PreviewServer) {
		/* v8 ignore start */
		/**
		 * INFO
		 * plugin print on process.stoud/sterr with console. If the process running in background,
		 * when client disconnect session, stdout/stderr receive EIO/EPIPE error.
		 * So register an hanlder to avoid process's death for uncaughtException
		 */
		const suppressIoError = (err: NodeJS.ErrnoException) => {
			if (err.code !== 'EIO' && err.code !== 'EPIPE') {
				throw err;
			}
		};
		if (process.stdout.listenerCount('error') === 0) {
			process.stdout.on('error', suppressIoError);
		}
		if (process.stderr.listenerCount('error') === 0) {
			process.stderr.on('error', suppressIoError);
		}
		/* v8 ignore stop */

		logger = createLogger(opts.appId, opts.logging);

		if (mode === 'middleware') {
			server.middlewares.use(createMiddleware(opts, logger));
		} else if (mode === 'standalone') {
			standalone = createStandaloneServer(opts, logger);
			standalone.start();
		}

		server.httpServer?.once('close', cleanup);

		server.middlewares.use('/_tracker/ping', (_req, res) => {
			res.setHeader('Content-Type', 'application/json');
			res.end(JSON.stringify({ ok: true, appId: opts.appId, mode, version }));
		});

		if (opts.dashboard.enabled) {
			const dashDir = dashboardDistDir();
			const resolvedDashDir = resolve(dashDir);
			const dashAssets = new Set((readdirSync(dashDir, { recursive: true }) as string[]).map(f => resolve(join(dashDir, f))));

			server.middlewares.use(opts.dashboard.route, (req, res, next) => {
				const url = req.url ?? '/';
				const safeUrl = url.split('?')[0];
				const filePath = join(dashDir, safeUrl);
				const resolvedPath = resolve(filePath);
				if (resolvedPath !== resolvedDashDir && !resolvedPath.startsWith(resolvedDashDir + sep)) {
					res.writeHead(403);
					res.end();
					return;
				}
				if (dashAssets.has(resolvedPath)) {
					res.setHeader('Content-Type', getMimeType(filePath));
					const stream = createReadStream(filePath);
					stream.on("error", (err: NodeJS.ErrnoException) => {
						if (!res.headersSent) {
							res.writeHead(err.code === "ENOENT" ? 404 : 500);
						}
						res.end();
					});
					stream.pipe(res);
					return;
				}

				if (!cachedDashboardHtml) {
					const indexPath = join(dashDir, 'index.html');
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
				const host = resolvedHost();
				const port = viteConfig.server?.port ?? 5173;
				const base = (viteConfig.base ?? '/').replace(/\/$/, '');
				const dash = opts.dashboard.route;
				const apiUrl = mode === 'standalone'
					? `http://${host}:${opts.storage.port}/_tracker`
					: mode === 'http'
						? opts.storage.readEndpoint
							? opts.storage.readEndpoint
							: opts.storage.writeEndpoint.replace(/\/events\/?$/, "")
						: mode === 'websocket'
							? opts.storage.wsEndpoint
							: `http://${host}:${port}${base}/_tracker`;

				console.log(
					`  \x1b[32m➜\x1b[0m  \x1b[1mvite-plugin-monitor Tracker API\x1b[0m:       ` +
					`\x1b[36m${apiUrl}\x1b[0m`
				);

				if (opts.dashboard.enabled) {
					console.log(
						`  \x1b[32m➜\x1b[0m  \x1b[1mvite-plugin-monitor Dashboard\x1b[0m:       ` +
						`\x1b[36mhttp://${host}:${port}${base}${dash}\x1b[0m`
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
			opts.storage.wsEndpoint = resolvedWsEndpoint(mode);
			opts.storage.writeEndpoint = resolvedWriteEndpoint(mode);
			opts.storage.readEndpoint = resolvedReadEndpoint(mode);
			logPaths = getLogPaths(opts.logging.transports);
			/**
			 * INFO If buildVersion was not set explicitly, fall back to the consumer
			 * project's package.json version. config.root is the reliable way to find
			 * it — it is the Vite-resolved project root, independent of how Vite was invoked.
			 */
			if (!opts.buildVersion) {
				try {
					const pkgPath = join(config.root, 'package.json');
					const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
					if (pkg.version) {
						opts.buildVersion = pkg.version;
					}
				} catch {
					opts.buildVersion = "X.X.X";
				}
			}
			cachedSetupScript = generateSetupScript(opts, isBuild);
		},
		transformIndexHtml: {
			order: 'pre',
			handler() {
				return [
					{
						tag: 'script',
						attrs: { type: 'module' },
						children: cachedSetupScript ?? generateSetupScript(opts, isBuild),
						injectTo: 'head-prepend',
					}
				];
			},
		},
		configureServer(server) {
			configureServer(server);
		},
		configurePreviewServer(server) {
			configureServer(server);
		},
		handleHotUpdate(ctx) {
			if ((logPaths || getLogPaths(opts.logging.transports)).some(p => resolve(ctx.file) === p)) {
				return [];
			}
		},
		buildStart() {
			for (const t of opts.logging?.transports ?? []) {
				const dir = dirname(t.path);
				if (!existsSync(dir)) {
					mkdirSync(dir, { recursive: true });
				}
			}
		},
		async closeBundle() {
			if (isBuild && opts.dashboard?.includeInBuild) {
				const dashSrc = dashboardDistDir();
				const routeSegments = opts.dashboard.route.split('/').filter(Boolean);
				const dashDest = join(viteConfig.build.outDir, ...routeSegments);

				if (existsSync(dashSrc)) {
					copyDirSync(dashSrc, dashDest);
					const copiedIndex = join(dashDest, 'index.html');
					if (existsSync(copiedIndex)) {
						let html = readFileSync(copiedIndex, 'utf8');
						const configScript = `<script>${generateConfigScript(opts)}</script>`;
						html = html.replace('</head>', `${configScript}\n</head>`);
						writeFileSync(copiedIndex, html);
					}
				} else {
					console.warn(
						`includeInBuild is true but dashboard dist not found at ${dashSrc}. ` +
						`Run 'pnpm build:dashboard' before 'vite build'.`
					);
				}
			}
			await cleanup();
		},
	}
}
