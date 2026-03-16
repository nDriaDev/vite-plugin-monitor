import type { ResolvedTrackerOptions, TrackerConfig } from '../types'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

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

function buildConfig(opts: ResolvedTrackerOptions): TrackerConfig {
	const common = {
		appId: opts.appId,
		pingEndpoint: opts.storage.pingEndpoint,
		apiKey: opts.storage.apiKey,
		batchSize: opts.storage.batchSize,
		flushInterval: opts.storage.flushInterval,
		track: {
			clicks: opts.track.clicks,
			http: opts.track.http as boolean | Record<string, unknown>,
			errors: opts.track.errors,
			navigation: opts.track.navigation,
			performance: opts.track.performance,
			console: opts.track.console as boolean | Record<string, unknown>,
			level: opts.track.level,
			ignoreUrls: opts.track.ignoreUrls
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
 * passing only the optional `userIdFn` — the config is read from `window` automatically.
 *
 * The `userIdFn` is serialized from `opts.track.userId` via `.toString()`.
 * It must be a pure function with no closures over module-level variables
 * at build time, since it is serialized as a string and evaluated in the browser.
 */
export function generateAutoInitScript(opts: ResolvedTrackerOptions): string {
	const userIdFn = opts.track.userId?.toString() ?? '() => null';

	return `
// vite-plugin-tracker — auto-generated init script
import { tracker } from '/@fs/${clientDir()}/index.js';

tracker.init(${userIdFn});
`;
}

/**
 * Generates the config-only script injected into index.html when `autoInit: false`.
 *
 * @remarks
 * Injects `window.__TRACKER_CONFIG__` exactly as `generateAutoInitScript` does,
 * but does **not** call `tracker.init()`. The consumer is responsible for calling
 * `tracker.init()` manually at the appropriate point in the application lifecycle:
 *
 * ```ts
 * import { tracker } from 'vite-plugin-tracker/client'
 * tracker.init(() => authStore.userId)
 * ```
 *
 * The `userIdFn` is **not** serialized here — when `autoInit: false` the consumer
 * provides it directly as an argument to `tracker.init()`.
 */
export function generateConfigScript(opts: ResolvedTrackerOptions): string {
	const config = buildConfig(opts);

	return `
// vite-plugin-tracker — config injection (autoInit: false)
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
export function generateSetupScript(opts: ResolvedTrackerOptions): string {
	const config = buildConfig(opts);
	const userIdFn = opts.track.userId?.toString() ?? '() => null';

	return `
// vite-plugin-monitor — proxy setup (runs before app code)
import { setupTrackers } from '/@fs/${clientDir()}/index.js';

Object.defineProperty(window, '__TRACKER_CONFIG__', {
	value:        Object.freeze(${JSON.stringify(config, null, 2)}),
	writable:     false,
	configurable: false,
	enumerable:   false,
});

setupTrackers(${userIdFn});
`
}
