import { describe, it, expect } from 'vitest';
import { resolveOptions } from '../../src/plugin/config';
import type { TrackerPluginOptions } from '../../src/types';

function baseOpts(overrides: Partial<TrackerPluginOptions> = {}): TrackerPluginOptions {
	return { appId: 'test-app', ...overrides }
}

describe('resolveOptions()', () => {

	describe('input validation', () => {
		it('throws when appId is absent', () => {
			expect(() => resolveOptions({} as TrackerPluginOptions)).toThrow(
				'`appId` is required'
			);
		});

		it('throws when appId is an empty string', () => {
			expect(() => resolveOptions({ appId: '' })).toThrow(
				'`appId` is required'
			);
		});

		it('throws when mode is "websocket" and wsEndpoint is absent', () => {
			expect(() =>
				resolveOptions(baseOpts({ storage: { mode: 'websocket' } as any }))
			).toThrow('`storage.wsEndpoint` is required when mode is "websocket"');
		});

		it('throws when mode is "http" and writeEndpoint is absent', () => {
			expect(() =>
				resolveOptions(baseOpts({ storage: { mode: 'http' } as any }))
			).toThrow('`storage.writeEndpoint` is required when mode is "http"');
		});

		it('does not throw when mode is "http" with valid writeEndpoint', () => {
			expect(() =>
				resolveOptions(baseOpts({ storage: { mode: 'http', writeEndpoint: '/api/events' } as any }))
			).not.toThrow();
		});

		it('does not throw when mode is "websocket" with valid wsEndpoint', () => {
			expect(() =>
				resolveOptions(baseOpts({ storage: { mode: 'websocket', wsEndpoint: 'ws://localhost:4242' } as any }))
			).not.toThrow();
		});

		it('does not throw with only appId (auto mode)', () => {
			expect(() => resolveOptions(baseOpts())).not.toThrow();
		});
	});

	describe('default values', () => {
		it('enabled is true by default', () => {
			const r = resolveOptions(baseOpts());
			expect(r.enabled).toBe(true);;
		});

		it('autoInit is true by default', () => {
			const r = resolveOptions(baseOpts());
			expect(r.autoInit).toBe(true);
		});

		it('storage.mode is "auto" by default', () => {
			const r = resolveOptions(baseOpts());
			expect(r.storage.mode).toBe('auto');
		});

		it('storage.port is 4242 by default', () => {
			const r = resolveOptions(baseOpts());
			expect(r.storage.port).toBe(4242);
		});

		it('storage.batchSize is 25 by default', () => {
			const r = resolveOptions(baseOpts());
			expect(r.storage.batchSize).toBe(25);
		});

		it('storage.flushInterval is 3000 by default', () => {
			const r = resolveOptions(baseOpts());
			expect(r.storage.flushInterval).toBe(3000);
		});

		it('storage.maxBufferSize is 500000 by default', () => {
			const r = resolveOptions(baseOpts());
			expect(r.storage.maxBufferSize).toBe(500000);
		});

		it('track.clicks is false by default', () => {
			const r = resolveOptions(baseOpts());
			expect(r.track.clicks).toBe(false);
		});

		it('track.console is true by default', () => {
			const r = resolveOptions(baseOpts());
			expect(r.track.console).toBe(true);
		});

		it('track.level is "info" by default', () => {
			const r = resolveOptions(baseOpts());
			expect(r.track.level).toBe('info');
		});

		it('track.ignoreUrls is [] by default', () => {
			const r = resolveOptions(baseOpts());
			expect(r.track.ignoreUrls).toEqual([]);
		});

		it('logging.level is "info" by default', () => {
			const r = resolveOptions(baseOpts());
			expect(r.logging.level).toBe('info');
		});

		it('logging.transports has a json transport by default', () => {
			const r = resolveOptions(baseOpts());
			expect(r.logging.transports).toHaveLength(1);
			expect(r.logging.transports![0].format).toBe('json');
			expect(r.logging.transports![0].path).toContain('test-app.log');
		});

		it('dashboard.enabled is false by default', () => {
			const r = resolveOptions(baseOpts());
			expect(r.dashboard.enabled).toBe(false);
		});

		it('dashboard.route is "/_dashboard" by default', () => {
			const r = resolveOptions(baseOpts());
			expect(r.dashboard.route).toBe('/_dashboard');
		});

		it('dashboard.auth is false by default', () => {
			const r = resolveOptions(baseOpts());
			expect(r.dashboard.auth).toBe(false);
		});

		it('dashboard.pollInterval is 3000 by default', () => {
			const r = resolveOptions(baseOpts());
			expect(r.dashboard.pollInterval).toBe(3000);
		});

		it('overlay.enabled is false by default', () => {
			const r = resolveOptions(baseOpts());
			expect(r.overlay.enabled).toBe(false);
		});

		it('overlay.position is "bottom-right" by default', () => {
			const r = resolveOptions(baseOpts());
			expect(r.overlay.position).toBe('bottom-right');
		});
	});

	describe('storage - http mode', () => {

		it('preserves writeEndpoint without trailing slash', () => {
			const r = resolveOptions(baseOpts({
				storage: { mode: 'http', writeEndpoint: '/api/events' } as any
			}));
			expect(r.storage.writeEndpoint).toBe('/api/events');
		});

		it('removes the trailing slash from writeEndpoint', () => {
			const r = resolveOptions(baseOpts({
				storage: { mode: 'http', writeEndpoint: '/api/events/' } as any
			}));
			expect(r.storage.writeEndpoint).toBe('/api/events');
		});

		it('removes the trailing slash from readEndpoint', () => {
			const r = resolveOptions(baseOpts({
				storage: { mode: 'http', writeEndpoint: '/api/events', readEndpoint: '/api/' } as any
			}));
			expect(r.storage.readEndpoint).toBe('/api');
		});

		it('wsEndpoint is an empty string for http mode', () => {
			const r = resolveOptions(baseOpts({
				storage: { mode: 'http', writeEndpoint: '/api/events' } as any
			}));
			expect(r.storage.wsEndpoint).toBe('');
		});

		it('inherits batchSize, flushInterval, apiKey from httpOpts', () => {
			const r = resolveOptions(baseOpts({
				storage: {
					mode: 'http',
					writeEndpoint: '/api/events',
					batchSize: 10,
					flushInterval: 1000,
					apiKey: 'my-key',
				} as any
			}));
			expect(r.storage.batchSize).toBe(10);
			expect(r.storage.flushInterval).toBe(1000);
			expect(r.storage.apiKey).toBe('my-key');
		});
	});

	describe('storage - websocket mode', () => {

		it('mode is "websocket" in the result', () => {
			const r = resolveOptions(baseOpts({
				storage: { mode: 'websocket', wsEndpoint: 'ws://remote:4242' } as any
			}));
			expect(r.storage.mode).toBe('websocket');
			expect(r.storage.wsEndpoint).toBe('ws://remote:4242');
		});

		it('writeEndpoint and readEndpoint are empty strings for websocket', () => {
			const r = resolveOptions(baseOpts({
				storage: { mode: 'websocket', wsEndpoint: 'ws://remote:4242' } as any
			}));
			expect(r.storage.writeEndpoint).toBe('');
			expect(r.storage.readEndpoint).toBe('');
		});

		it('port fixed at 4242 for websocket', () => {
			const r = resolveOptions(baseOpts({
				storage: { mode: 'websocket', wsEndpoint: 'ws://remote:4242' } as any
			}));
			expect(r.storage.port).toBe(4242);
		});
	});

	describe('dashboard.auth - credential hashing', () => {

		it('auth false remains false', () => {
			const r = resolveOptions(baseOpts({ dashboard: { auth: false } as any }));
			expect(r.dashboard.auth).toBe(false);
		});

		it('auth null remains false', () => {
			const r = resolveOptions(baseOpts({ dashboard: { auth: null } as any }));
			expect(r.dashboard.auth).toBe(false);
		});

		it('auth undefined remains false', () => {
			const r = resolveOptions(baseOpts({ dashboard: { auth: undefined } as any }));
			expect(r.dashboard.auth).toBe(false);
		});

		it('auth with credentials is hashed', () => {
			const r = resolveOptions(baseOpts({
				dashboard: { auth: { username: 'admin', password: 'secret' } } as any
			}));
			expect(r.dashboard.auth).not.toBe(false);
			const auth = r.dashboard.auth as { username: string; password: string }
			expect(auth.username).toHaveLength(64);
			expect(auth.password).toHaveLength(64);
		});

		it('different credentials produce different hashes', () => {
			const r1 = resolveOptions(baseOpts({
				dashboard: { auth: { username: 'admin', password: 'secret1' } } as any
			}));
			const r2 = resolveOptions(baseOpts({
				dashboard: { auth: { username: 'admin', password: 'secret2' } } as any
			}));
			const a1 = r1.dashboard.auth as { username: string; password: string }
			const a2 = r2.dashboard.auth as { username: string; password: string }
			expect(a1.password).not.toBe(a2.password);
		});

		it('the same input always produces the same hash (deterministic)', () => {
			const r1 = resolveOptions(baseOpts({
				dashboard: { auth: { username: 'admin', password: 'pass' } } as any
			}));
			const r2 = resolveOptions(baseOpts({
				dashboard: { auth: { username: 'admin', password: 'pass' } } as any
			}));
			const a1 = r1.dashboard.auth as { username: string; password: string }
			const a2 = r2.dashboard.auth as { username: string; password: string }
			expect(a1.username).toBe(a2.username);
			expect(a1.password).toBe(a2.password);
		});
	});

	describe('directly passed opts', () => {

		it('enabled false is propagated', () => {
			const r = resolveOptions(baseOpts({ enabled: false }));
			expect(r.enabled).toBe(false);
		});

		it('autoInit false is propagated', () => {
			const r = resolveOptions(baseOpts({ autoInit: false }));
			expect(r.autoInit).toBe(false);
		});

		it('track.level "debug" viene propagato', () => {
			const r = resolveOptions(baseOpts({ track: { level: 'debug' } as any }));
			expect(r.track.level).toBe('debug');
		});

		it('track.ignoreUrls is propagated', () => {
			const r = resolveOptions(baseOpts({ track: { ignoreUrls: ['/health'] } as any }));
			expect(r.track.ignoreUrls).toEqual(['/health']);
		});

		it('passed userId fn is preserved', () => {
			const fn = () => 'user-123'
			const r = resolveOptions(baseOpts({ track: { userId: fn } as any }));
			expect(r.track.userId).toBe(fn);
		});

		it('logging.level "debug" is propagated', () => {
			const r = resolveOptions(baseOpts({ logging: { level: 'debug' } as any }));
			expect(r.logging.level).toBe('debug');
		});

		it('uses the default function when track exists but userId is not provided', () => {
			const r = resolveOptions(baseOpts({
				track: { clicks: true } as any
			}));

			expect(r.track.userId()).toBe(null);
		});

	});
});
