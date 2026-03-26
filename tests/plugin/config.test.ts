import { describe, it, expect } from 'vitest';
import { resolveOptions } from '../../src/plugin/config';
import type { TrackerPluginOptions } from '../../src/types';

function baseOpts(overrides: Partial<TrackerPluginOptions> = {}): TrackerPluginOptions {
	return { appId: 'test-app', ...overrides }
}

describe('resolveOptions()', () => {

	describe('validazione input', () => {
		it('lancia se appId è assente', () => {
			expect(() => resolveOptions({} as TrackerPluginOptions)).toThrow(
				'`appId` is required'
			);
		});

		it('lancia se appId è stringa vuota', () => {
			expect(() => resolveOptions({ appId: '' })).toThrow(
				'`appId` is required'
			);
		});

		it('lancia se mode è "websocket" e wsEndpoint è assente', () => {
			expect(() =>
				resolveOptions(baseOpts({ storage: { mode: 'websocket' } as any }))
			).toThrow('`storage.wsEndpoint` is required when mode is "websocket"');
		});

		it('lancia se mode è "http" e writeEndpoint è assente', () => {
			expect(() =>
				resolveOptions(baseOpts({ storage: { mode: 'http' } as any }))
			).toThrow('`storage.writeEndpoint` is required when mode is "http"');
		});

		it('non lancia se mode è "http" con writeEndpoint valido', () => {
			expect(() =>
				resolveOptions(baseOpts({ storage: { mode: 'http', writeEndpoint: '/api/events' } as any }))
			).not.toThrow();
		});

		it('non lancia se mode è "websocket" con wsEndpoint valido', () => {
			expect(() =>
				resolveOptions(baseOpts({ storage: { mode: 'websocket', wsEndpoint: 'ws://localhost:4242' } as any }))
			).not.toThrow();
		});

		it('non lancia con solo appId (mode auto)', () => {
			expect(() => resolveOptions(baseOpts())).not.toThrow();
		});
	});

	describe('valori di default', () => {
		it('enabled è true di default', () => {
			const r = resolveOptions(baseOpts());
			expect(r.enabled).toBe(true);;
		});

		it('autoInit è true di default', () => {
			const r = resolveOptions(baseOpts());
			expect(r.autoInit).toBe(true);
		});

		it('storage.mode è "auto" di default', () => {
			const r = resolveOptions(baseOpts());
			expect(r.storage.mode).toBe('auto');
		});

		it('storage.port è 4242 di default', () => {
			const r = resolveOptions(baseOpts());
			expect(r.storage.port).toBe(4242);
		});

		it('storage.batchSize è 25 di default', () => {
			const r = resolveOptions(baseOpts());
			expect(r.storage.batchSize).toBe(25);
		});

		it('storage.flushInterval è 3000 di default', () => {
			const r = resolveOptions(baseOpts());
			expect(r.storage.flushInterval).toBe(3000);
		});

		it('storage.maxBufferSize è 500000 di default', () => {
			const r = resolveOptions(baseOpts());
			expect(r.storage.maxBufferSize).toBe(500000);
		});

		it('track.clicks è false di default', () => {
			const r = resolveOptions(baseOpts());
			expect(r.track.clicks).toBe(false);
		});

		it('track.console è true di default', () => {
			const r = resolveOptions(baseOpts());
			expect(r.track.console).toBe(true);
		});

		it('track.level è "info" di default', () => {
			const r = resolveOptions(baseOpts());
			expect(r.track.level).toBe('info');
		});

		it('track.ignoreUrls è [] di default', () => {
			const r = resolveOptions(baseOpts());
			expect(r.track.ignoreUrls).toEqual([]);
		});

		it('logging.level è "info" di default', () => {
			const r = resolveOptions(baseOpts());
			expect(r.logging.level).toBe('info');
		});

		it('logging.transports ha un transport json di default', () => {
			const r = resolveOptions(baseOpts());
			expect(r.logging.transports).toHaveLength(1);
			expect(r.logging.transports![0].format).toBe('json');
			expect(r.logging.transports![0].path).toContain('test-app.log');
		});

		it('dashboard.enabled è false di default', () => {
			const r = resolveOptions(baseOpts());
			expect(r.dashboard.enabled).toBe(false);
		});

		it('dashboard.route è "/_dashboard" di default', () => {
			const r = resolveOptions(baseOpts());
			expect(r.dashboard.route).toBe('/_dashboard');
		});

		it('dashboard.auth è false di default', () => {
			const r = resolveOptions(baseOpts());
			expect(r.dashboard.auth).toBe(false);
		});

		it('dashboard.pollInterval è 3000 di default', () => {
			const r = resolveOptions(baseOpts());
			expect(r.dashboard.pollInterval).toBe(3000);
		});

		it('overlay.enabled è false di default', () => {
			const r = resolveOptions(baseOpts());
			expect(r.overlay.enabled).toBe(false);
		});

		it('overlay.position è "bottom-right" di default', () => {
			const r = resolveOptions(baseOpts());
			expect(r.overlay.position).toBe('bottom-right');
		});
	});

	describe('storage - modalità http', () => {

		it('preserva writeEndpoint senza trailing slash', () => {
			const r = resolveOptions(baseOpts({
				storage: { mode: 'http', writeEndpoint: '/api/events' } as any
			}));
			expect(r.storage.writeEndpoint).toBe('/api/events');
		});

		it('rimuove il trailing slash da writeEndpoint', () => {
			const r = resolveOptions(baseOpts({
				storage: { mode: 'http', writeEndpoint: '/api/events/' } as any
			}));
			expect(r.storage.writeEndpoint).toBe('/api/events');
		});

		it('rimuove il trailing slash da readEndpoint', () => {
			const r = resolveOptions(baseOpts({
				storage: { mode: 'http', writeEndpoint: '/api/events', readEndpoint: '/api/' } as any
			}));
			expect(r.storage.readEndpoint).toBe('/api');
		});

		it('wsEndpoint è stringa vuota per mode http', () => {
			const r = resolveOptions(baseOpts({
				storage: { mode: 'http', writeEndpoint: '/api/events' } as any
			}));
			expect(r.storage.wsEndpoint).toBe('');
		});

		it('eredita batchSize, flushInterval, apiKey da httpOpts', () => {
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

	describe('storage - modalità websocket', () => {

		it('mode è "websocket" nel risultato', () => {
			const r = resolveOptions(baseOpts({
				storage: { mode: 'websocket', wsEndpoint: 'ws://remote:4242' } as any
			}));
			expect(r.storage.mode).toBe('websocket');
			expect(r.storage.wsEndpoint).toBe('ws://remote:4242');
		});

		it('writeEndpoint e readEndpoint sono stringhe vuote per websocket', () => {
			const r = resolveOptions(baseOpts({
				storage: { mode: 'websocket', wsEndpoint: 'ws://remote:4242' } as any
			}));
			expect(r.storage.writeEndpoint).toBe('');
			expect(r.storage.readEndpoint).toBe('');
		});

		it('port fisso a 4242 per websocket', () => {
			const r = resolveOptions(baseOpts({
				storage: { mode: 'websocket', wsEndpoint: 'ws://remote:4242' } as any
			}));
			expect(r.storage.port).toBe(4242);
		});
	});

	describe('dashboard.auth - hashing delle credenziali', () => {

		it('auth false rimane false', () => {
			const r = resolveOptions(baseOpts({ dashboard: { auth: false } as any }));
			expect(r.dashboard.auth).toBe(false);
		});

		it('auth null rimane false', () => {
			const r = resolveOptions(baseOpts({ dashboard: { auth: null } as any }));
			expect(r.dashboard.auth).toBe(false);
		});

		it('auth undefined rimane false', () => {
			const r = resolveOptions(baseOpts({ dashboard: { auth: undefined } as any }));
			expect(r.dashboard.auth).toBe(false);
		});

		it('auth con credenziali viene hashed', () => {
			const r = resolveOptions(baseOpts({
				dashboard: { auth: { username: 'admin', password: 'secret' } } as any
			}));
			expect(r.dashboard.auth).not.toBe(false);
			const auth = r.dashboard.auth as { username: string; password: string }
			expect(auth.username).toHaveLength(64);
			expect(auth.password).toHaveLength(64);
		});

		it('credenziali diverse producono hash diversi', () => {
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

		it('lo stesso input produce sempre lo stesso hash (deterministico)', () => {
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

	describe('opts passate direttamente', () => {

		it('enabled false viene propagato', () => {
			const r = resolveOptions(baseOpts({ enabled: false }));
			expect(r.enabled).toBe(false);
		});

		it('autoInit false viene propagato', () => {
			const r = resolveOptions(baseOpts({ autoInit: false }));
			expect(r.autoInit).toBe(false);
		});

		it('track.level "debug" viene propagato', () => {
			const r = resolveOptions(baseOpts({ track: { level: 'debug' } as any }));
			expect(r.track.level).toBe('debug');
		});

		it('track.ignoreUrls viene propagato', () => {
			const r = resolveOptions(baseOpts({ track: { ignoreUrls: ['/health'] } as any }));
			expect(r.track.ignoreUrls).toEqual(['/health']);
		});

		it('userId fn passata viene preservata', () => {
			const fn = () => 'user-123'
			const r = resolveOptions(baseOpts({ track: { userId: fn } as any }));
			expect(r.track.userId).toBe(fn);
		});

		it('logging.level "debug" viene propagato', () => {
			const r = resolveOptions(baseOpts({ logging: { level: 'debug' } as any }));
			expect(r.logging.level).toBe('debug');
		});

		it('usa la funzione di default se track esiste ma userId non è fornito', () => {
			const r = resolveOptions(baseOpts({
				track: { clicks: true } as any
			}));

			expect(r.track.userId()).toBe(null);
		});

	});
});
