import { HttpStorageOptions, ResolvedTrackerOptions, StorageMode, TrackerPluginOptions, WsStorageOptions } from "@tracker/types";

export function resolveOptions(opts: TrackerPluginOptions): ResolvedTrackerOptions {
	if (!opts.appId) {
		throw new Error('[vite-plugin-monitor] `appId` is required');
	}

	const mode: StorageMode = opts.storage?.mode ?? 'auto';
	const isWs = mode === 'websocket';
	if (isWs) {
		const wsOpts = opts.storage as WsStorageOptions;
		if (!wsOpts.wsEndpoint) {
			throw new Error('[vite-plugin-monitor] `storage.wsEndpoint` is required when mode is "websocket"');
		}
	} else {
		if (mode === 'http' && !(opts.storage as HttpStorageOptions)?.writeEndpoint) {
			throw new Error('[vite-plugin-monitor] `storage.writeEndpoint` is required when mode is "http"');
		}
	}

	const httpOpts = opts.storage as HttpStorageOptions | undefined
	const wsOpts = opts.storage as WsStorageOptions | undefined

	return {
		enabled: opts.enabled ?? true,
		appId: opts.appId,
		storage: isWs
			? {
				mode: 'websocket' as const,
				wsEndpoint: wsOpts!.wsEndpoint,
				writeEndpoint: '' as const,
				readEndpoint: '' as const,
				pingEndpoint: wsOpts!.pingEndpoint ?? '',
				apiKey: wsOpts!.apiKey ?? '',
				port: 4242,
				batchSize: wsOpts!.batchSize ?? 10,
				flushInterval: wsOpts!.flushInterval ?? 3000
			}
			: {
				mode,
				wsEndpoint: '' as const,
				writeEndpoint: httpOpts?.writeEndpoint?.replace(/\/$/, '') ?? '',
				readEndpoint: httpOpts?.readEndpoint?.replace(/\/$/, '') ?? '',
				pingEndpoint: httpOpts?.pingEndpoint ?? '',
				apiKey: httpOpts?.apiKey ?? '',
				port: httpOpts?.port ?? 4242,
				batchSize: httpOpts?.batchSize ?? 10,
				flushInterval: httpOpts?.flushInterval ?? 3000
			},
		track: {
			clicks:      opts.track?.clicks      ?? true,
			http:        opts.track?.http        ?? true,
			errors:      opts.track?.errors      ?? true,
			navigation:  opts.track?.navigation  ?? true,
			performance: opts.track?.performance ?? true,
			console:     opts.track?.console     ?? false,
			userId:      opts.track?.userId      ?? (() => null),
			level:       opts.track?.level       ?? 'info',
			ignoreUrls:  opts.track?.ignoreUrls  ?? [],
		},
		logging: {
			level: opts.logging?.level ?? 'info',
			transports: opts.logging?.transports ?? [
				{
					format: 'json',
					path: `./logs/${opts.appId}.log`,
					rotation: { strategy: 'daily', maxFiles: 30, compress: false },
				},
			],
		},
		dashboard: {
			enabled:        opts.dashboard?.enabled        ?? true,
			route:          opts.dashboard?.route          ?? '/_dashboard',
			auth: opts.dashboard?.auth ?? { username: 'admin', password: 'admin' },
			includeInBuild: opts.dashboard?.includeInBuild ?? false,
			pollInterval:   opts.dashboard?.pollInterval   ?? 3000,
		},

		overlay: {
			enabled:  opts.overlay?.enabled  ?? true,
			position: opts.overlay?.position ?? 'bottom-right',
		},
		autoInit: opts.autoInit ?? true
	}
}
