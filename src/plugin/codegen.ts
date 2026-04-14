import type { ResolvedTrackerOptions, TrackerConfig } from '../types'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/* v8 ignore start */
/**
 * INFO Path resolution
 * Works for both CJS (__dirname) and ESM (import.meta.url)
 * tsdown compiles to both targets, so we try ESM first.
 */
function clientDir(): string {
	try {
		const __filename = fileURLToPath(import.meta.url)
		return path.join(path.dirname(__filename), 'client')
	} catch {
		return path.join(__dirname, 'client')
	}
}
/* v8 ignore stop */

function buildConfig(opts: ResolvedTrackerOptions): TrackerConfig {
	const common = {
		appId: opts.appId,
		buildVersion: opts.buildVersion,
		pingEndpoint: opts.storage.pingEndpoint,
		apiKey: opts.storage.apiKey,
		batchSize: opts.storage.batchSize,
		flushInterval: opts.storage.flushInterval,
		track: {
			clicks: opts.track.clicks,
			http: opts.track.http as boolean | Record<string, unknown>,
			errors: opts.track.errors,
			navigation: opts.track.navigation,
			console: opts.track.console as boolean | Record<string, unknown>,
			level: opts.track.level
		},
		dashboard: {
			enabled: opts.dashboard.enabled,
			route: opts.dashboard.route,
			pollInterval: opts.dashboard.pollInterval,
			auth: opts.dashboard.auth
		},
		overlay: {
			enabled: opts.overlay.enabled,
			position: opts.overlay.position
		}
	}

	if (opts.storage.mode === 'websocket') {
		return {
			...common,
			mode: 'websocket',
			wsEndpoint: opts.storage.wsEndpoint,
			writeEndpoint: '' as const,
			readEndpoint: '' as const
		}
	}

	return {
		...common,
		mode: opts.storage.mode,
		writeEndpoint: opts.storage.writeEndpoint,
		readEndpoint: opts.storage.readEndpoint,
		wsEndpoint: '' as const
	}
}

/**
 * Generates the auto-init script injected into index.html when `autoInit: true`.
 *
 * @remarks
 * Injects `window.__TRACKER_CONFIG__` as a frozen, non-writable, non-configurable
 * property so it cannot be tampered with at runtime. Then calls `tracker.init()`
 * passing only the optional `userIdFn` - the config is read from `window` automatically.
 *
 * The `userIdFn` is serialized from `opts.track.userId` via `.toString()`.
 * It must be a pure function with no closures over module-level variables
 * at build time, since it is serialized as a string and evaluated in the browser.
 */
export function generateAutoInitScript(opts: ResolvedTrackerOptions, isBuild: boolean): string {
	const userIdFn = opts.track.userId?.toString() ?? '() => null';

	const importPath = isBuild ? '@ndriadev/vite-plugin-monitor/client' : `/@fs/${clientDir()}/index.js`;

	return `
// vite-plugin-monitor - auto-generated init script
import { tracker } from '${importPath}';

tracker.init(${userIdFn});
`;
}

/**
 * Generates the inline `<script>` that injects `window.__TRACKER_CONFIG__` into
 * the dashboard HTML (`dashboard/index.html`).
 *
 * @remarks
 * Called in two places inside the plugin:
 *
 * 1. **Dev / preview** (`configureServer`) - injected into the dashboard HTML
 *    served by the Vite middleware or the standalone server on every request,
 *    so the dashboard SPA always has the current resolved config available as
 *    `window.__TRACKER_CONFIG__` when its `main.ts` executes.
 *
 * 2. **Production build** (`closeBundle`, when `includeInBuild: true`) - injected
 *    into the copied `dashboard/index.html` so the statically-served dashboard
 *    contains the correct production endpoints baked in.
 *
 * This function is **not** used to inject config into the consumer application's
 * `index.html`. The consumer app always receives config via {@link generateSetupScript},
 * which also calls `setupTrackers()`. This function is dashboard-only.
 */
export function generateConfigScript(opts: ResolvedTrackerOptions): string {
	const config = buildConfig(opts);

	return `
// vite-plugin-monitor - config injection (autoInit: false)
Object.defineProperty(window, '__TRACKER_CONFIG__', {
	value:        Object.freeze(${JSON.stringify(config, null, 2)}),
	writable:     false,
	configurable: false,
	enumerable:   false,
});
`;
}

/**
 * Generates the setup script injected as the very first script in head-prepend.
 *
 * @remarks
 * Installs all event proxies before any application code runs.
 */
export function generateSetupScript(opts: ResolvedTrackerOptions, isBuild: boolean): string {
	const config = buildConfig(opts);
	const userIdFn = opts.track.userId?.toString() ?? '() => null';

	const importPath = isBuild ? '@ndriadev/vite-plugin-monitor/client' : `/@fs/${clientDir()}/index.js`;

	return `
// vite-plugin-monitor - proxy setup (runs before app code)
import { setupTrackers } from '${importPath}';

Object.defineProperty(window, '__TRACKER_CONFIG__', {
	value:        Object.freeze(${JSON.stringify(config, null, 2)}),
	writable:     false,
	configurable: false,
	enumerable:   false,
});

setupTrackers(${userIdFn});
`
}
