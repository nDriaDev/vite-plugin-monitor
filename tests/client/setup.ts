import { afterEach, beforeEach, vi } from 'vitest';
import type { TrackerConfig } from '../../src/types';

const BASE_CONFIG: TrackerConfig = {
	appId: 'test-app',
	mode: 'middleware',
	writeEndpoint: '/_tracker/events',
	readEndpoint: '/_tracker',
	wsEndpoint: '',
	pingEndpoint: '',
	apiKey: '',
	batchSize: 25,
	flushInterval: 3000,
	track: {
		clicks: false,
		http: false,
		errors: false,
		navigation: false,
		console: false,
		level: 'info',
		ignoreUrls: []
	},
	dashboard: {
		enabled: false,
		route: '/_dashboard',
		pollInterval: 3000,
		auth: false
	},
	overlay: {
		enabled: false,
		position: 'bottom-right'
	}
}

beforeEach(() => {
	installTrackerConfig(BASE_CONFIG);
});

afterEach(() => {
	Reflect.deleteProperty(window, '__TRACKER_CONFIG__');
	Reflect.deleteProperty(window, '__tracker_instance__');

	sessionStorage.clear();
	vi.restoreAllMocks();
})

export function overrideTrackerConfig(config: TrackerConfig): void {
	installTrackerConfig(config);
}

export function makeMiddlewareConfig(overrides: Partial<typeof BASE_CONFIG>): TrackerConfig {
	return { ...BASE_CONFIG, ...overrides } as TrackerConfig;
}

function installTrackerConfig(config: TrackerConfig): void {
	Object.defineProperty(window, '__TRACKER_CONFIG__', {
		value: Object.freeze(config),
		writable: false,
		configurable: true,
		enumerable: false
	});
}
