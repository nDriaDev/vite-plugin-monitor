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
		level: 'info'
	},
	dashboard: {
		enabled: true,
		route: '/_dashboard',
		pollInterval: 3000,
		auth: false
	},
	overlay: {
		enabled: false,
		position: 'bottom-right'
	}
};

beforeEach(() => {
	installTrackerConfig(BASE_CONFIG);
	vi.resetModules();
});

afterEach(() => {
	Reflect.deleteProperty(window, '__TRACKER_CONFIG__');
	Reflect.deleteProperty(window, '__tracker_instance__');
	sessionStorage.clear();
	localStorage.clear();
	vi.restoreAllMocks();
});

export function makeConfig(overrides: Partial<TrackerConfig> = {}): TrackerConfig {
	return { ...BASE_CONFIG, ...overrides } as TrackerConfig;
}

export function installTrackerConfig(config: TrackerConfig): void {
	Object.defineProperty(window, '__TRACKER_CONFIG__', {
		value: Object.freeze(config),
		writable: false,
		configurable: true,
		enumerable: false
	});
}
