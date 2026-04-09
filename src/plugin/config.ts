import type { AutoStorageOptions, HttpStorageOptions, ManagedStorageOptions, ResolvedTrackerOptions, StorageMode, TrackerPluginOptions, WsStorageOptions } from "@tracker/types";
import { createHmac } from "node:crypto";


function hashCredential(value: string, appId: string): string {
	return createHmac('sha256', appId).update(value).digest('hex')
}

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

	// INFO 'auto' gets its own type because it supports writeEndpoint/readEndpoint/pingEndpoint as optional fields — used only when the build resolves 'auto' to 'http'.
	const httpOpts = mode === 'http' ? opts.storage as HttpStorageOptions : undefined;
	const autoOpts = mode === 'auto' ? opts.storage as AutoStorageOptions : undefined;
	const managedOpts = (mode === 'standalone' || mode === 'middleware') ? opts.storage as ManagedStorageOptions : undefined;
	const wsOpts = mode === 'websocket' ? opts.storage as WsStorageOptions : undefined;
	const anyOpts = httpOpts ?? autoOpts ?? managedOpts;

	let auth = opts.dashboard?.auth;
	if (auth === false || auth === undefined || auth === null) {
		auth = false;
	} else {
		auth = {
			username: hashCredential(auth.username, opts.appId),
			password: hashCredential(auth.password, opts.appId)
		}
	}

	return {
		enabled: opts.enabled ?? true,
		appId: opts.appId,
		buildVersion: opts.buildVersion,
		storage: isWs
			? {
				mode: 'websocket' as const,
				wsEndpoint: wsOpts!.wsEndpoint,
				writeEndpoint: '' as const,
				readEndpoint: '' as const,
				pingEndpoint: wsOpts!.pingEndpoint ?? '',
				apiKey: wsOpts!.apiKey ?? '',
				port: 4242,
				batchSize: wsOpts!.batchSize ?? 25,
				flushInterval: wsOpts!.flushInterval ?? 3000,
				maxBufferSize: 500000,
			}
			: {
				mode,
				wsEndpoint: '' as const,
				writeEndpoint: (httpOpts?.writeEndpoint ?? autoOpts?.writeEndpoint ?? '').replace(/\/$/, ''),
				readEndpoint: (httpOpts?.readEndpoint ?? autoOpts?.readEndpoint ?? '').replace(/\/$/, ''),
				pingEndpoint: httpOpts?.pingEndpoint ?? autoOpts?.pingEndpoint ?? '',
				apiKey: anyOpts?.apiKey ?? '',
				port: (autoOpts ?? managedOpts)?.port ?? 4242,
				batchSize: anyOpts?.batchSize ?? 25,
				flushInterval: anyOpts?.flushInterval ?? 3000,
				maxBufferSize: (autoOpts ?? managedOpts)?.maxBufferSize ?? 500000,
			},
		track: {
			clicks: opts.track?.clicks ?? false,
			http: opts.track?.http ?? false,
			errors: opts.track?.errors ?? false,
			navigation: opts.track?.navigation ?? false,
			console: opts.track?.console ?? true,
			userId: opts.track?.userId ?? (() => null),
			level: opts.track?.level ?? 'info',
			ignoreUrls: opts.track?.ignoreUrls ?? [],
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
			enabled: opts.dashboard?.enabled ?? false,
			route: opts.dashboard?.route ?? '/_dashboard',
			auth,
			includeInBuild: opts.dashboard?.includeInBuild ?? false,
			pollInterval: opts.dashboard?.pollInterval ?? 3000,
		},
		overlay: {
			enabled: opts.overlay?.enabled ?? false,
			position: opts.overlay?.position ?? 'bottom-right',
		},
		autoInit: opts.autoInit ?? true
	}
}
