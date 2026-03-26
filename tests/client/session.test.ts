import { describe, it, expect, vi } from 'vitest';
import { TrackerSession } from '../../src/client/session';

function ssGet(key: string): string | null {
	return sessionStorage.getItem(key);
}

function ssSet(key: string, val: string): void {
	sessionStorage.setItem(key, val);
}

const SESSION_ID_KEY = '__tracker_session_id__';
const USER_ID_KEY = '__tracker_user_id__';

describe('TrackerSession', () => {

	describe('constructor — sessionId', () => {

		it('genera un new sessionId se sessionStorage è vuoto', () => {
			const session = new TrackerSession();
			expect(session.sessionId).toBeTruthy();
			expect(session.sessionId).toMatch(/^sess_/);
		});

		it('salva il sessionId generato in sessionStorage', () => {
			const session = new TrackerSession();
			expect(ssGet(SESSION_ID_KEY)).toBe(session.sessionId);
		});

		it('recupera il sessionId esistente da sessionStorage', () => {
			ssSet(SESSION_ID_KEY, 'sess_esistente');
			const session = new TrackerSession();
			expect(session.sessionId).toBe('sess_esistente');
		});

		it('due istanze nello stesso sessionStorage condividono lo stesso sessionId', () => {
			const s1 = new TrackerSession();
			const s2 = new TrackerSession();
			expect(s1.sessionId).toBe(s2.sessionId);
		});

		it('sessionId differente tra test (sessionStorage è pulito)', () => {
			const s1 = new TrackerSession();
			sessionStorage.clear();
			const s2 = new TrackerSession();
			expect(s1.sessionId).not.toBe(s2.sessionId);
		});

		it('genera un sessionId con il fallback Math.random se crypto.randomUUID non è disponibile', () => {
			const originalUUID = crypto.randomUUID;
			crypto.randomUUID = undefined as unknown as typeof crypto.randomUUID;

			sessionStorage.clear();
			const session = new TrackerSession();

			expect(session.sessionId).toMatch(/^sess_/);

			crypto.randomUUID = originalUUID;
		});

		it('restituisce null da sessionGet se sessionStorage lancia un\'eccezione', () => {
			vi.spyOn(Storage.prototype, 'getItem').mockImplementationOnce(() => {
				throw new Error('SecurityError: storage non disponibile');
			});

			const session = new TrackerSession();
			expect(session.sessionId).toMatch(/^sess_/);
		})
	})

	describe('constructor — appId', () => {

		it('legge appId da window.__TRACKER_CONFIG__', () => {
			const session = new TrackerSession();
			expect(session.appId).toBe('test-app');
		});

		it('usa "unknown" se window.__TRACKER_CONFIG__ non è presente', () => {
			Object.defineProperty(window, '__TRACKER_CONFIG__', {
				value: undefined,
				writable: true,
				configurable: true,
			});
			delete (window as any).__TRACKER_CONFIG__;

			const session = new TrackerSession();
			expect(session.appId).toBe('unknown');
		});
	});

	describe('constructor — userId', () => {

		it('usa il valore restituito da userIdFn se non nullo', () => {
			const session = new TrackerSession(() => 'user-123');
			expect(session.userId).toBe('user-123');
		});

		it('salva il userId risolto in sessionStorage', () => {
			new TrackerSession(() => 'user-123');
			expect(ssGet(USER_ID_KEY)).toBe('user-123');
		});

		it('genera un userId anonimo se userIdFn restituisce null', () => {
			const session = new TrackerSession(() => null);
			expect(session.userId).toMatch(/^anon_/);
		});

		it('genera un userId anonimo se non è fornita alcuna userIdFn', () => {
			const session = new TrackerSession();
			expect(session.userId).toMatch(/^anon_/);
		});

		it('salva il userId anonimo in sessionStorage', () => {
			const session = new TrackerSession();
			expect(ssGet(USER_ID_KEY)).toBe(session.userId);
		});

		it('recupera userId esistente da sessionStorage se userIdFn è assente', () => {
			ssSet(USER_ID_KEY, 'anon_saved');
			const session = new TrackerSession();
			expect(session.userId).toBe('anon_saved');
		});

		it('il resolver ha priorità su sessionStorage', () => {
			ssSet(USER_ID_KEY, 'anon_old');
			const session = new TrackerSession(() => 'user-new');
			expect(session.userId).toBe('user-new');
		});

		it('due istanze con stesso sessionStorage condividono il userId anonimo', () => {
			const s1 = new TrackerSession();
			const s2 = new TrackerSession();
			expect(s1.userId).toBe(s2.userId);
		});
	});

	describe('setUserIdFn()', () => {

		it('aggiorna il resolver e ri-risolve immediatamente se il risultato è truthy', () => {
			const session = new TrackerSession(() => null);
			const anonId = session.userId;

			session.setUserIdFn(() => 'user-after-login');

			expect(session.userId).toBe('user-after-login');
			expect(session.userId).not.toBe(anonId);
		});

		it('salva il new userId in sessionStorage', () => {
			const session = new TrackerSession();
			session.setUserIdFn(() => 'user-after-login');
			expect(ssGet(USER_ID_KEY)).toBe('user-after-login');
		});

		it('non aggiorna userId se il resolver restituisce null', () => {
			const session = new TrackerSession(() => 'user-123');
			session.setUserIdFn(() => null);
			expect(session.userId).toBe('user-123');
		});

		it('non aggiorna userId se il resolver restituisce stringa vuota', () => {
			const session = new TrackerSession(() => 'user-123');
			session.setUserIdFn(() => '');
			expect(session.userId).toBe('user-123');
		});
	});

	describe('setContext()', () => {

		it('aggiunge chiavi al context', () => {
			const session = new TrackerSession();
			session.setContext({ env: 'production', version: '1.0' });
			expect(session.getContext()).toEqual({ env: 'production', version: '1.0' });
		});

		it('merge di più chiamate successive senza sovrascrivere', () => {
			const session = new TrackerSession();
			session.setContext({ env: 'production' });
			session.setContext({ version: '1.0' });
			expect(session.getContext()).toEqual({ env: 'production', version: '1.0' });
		});

		it('sovrascrive una chiave esistente', () => {
			const session = new TrackerSession();
			session.setContext({ env: 'staging' });
			session.setContext({ env: 'production' });
			expect(session.getContext()).toEqual({ env: 'production' });
		});

		it('rimuove una chiave quando il valore è null', () => {
			const session = new TrackerSession();
			session.setContext({ env: 'production', version: '1.0' });
			session.setContext({ env: null });
			expect(session.getContext()).toEqual({ version: '1.0' });
		});

		it('rimuovere una chiave inesistente con null è un no-op', () => {
			const session = new TrackerSession();
			session.setContext({ chiaveInesistente: null });
			expect(session.getContext()).toBeUndefined();
		});

		it('non rimuove una chiave se il valore è undefined (solo null rimuove)', () => {
			const session = new TrackerSession();
			session.setContext({ env: 'production' });
			session.setContext({ env: undefined });
			const ctx = session.getContext();
			expect(ctx).toHaveProperty('env', undefined);
		});
	});

	describe('getContext()', () => {

		it('restituisce undefined se il context è vuoto', () => {
			const session = new TrackerSession();
			expect(session.getContext()).toBeUndefined();
		});

		it('restituisce undefined after aver rimosso tutte le chiavi', () => {
			const session = new TrackerSession();
			session.setContext({ env: 'production' });
			session.setContext({ env: null });
			expect(session.getContext()).toBeUndefined();
		});

		it('restituisce una copia e non il riferimento interno', () => {
			const session = new TrackerSession();
			session.setContext({ env: 'production' });

			const ctx = session.getContext()!;
			ctx.env = 'staging';

			expect(session.getContext()).toEqual({ env: 'production' });
		});
	});

	describe('createEvent()', () => {

		it('produce un TrackerEvent con tutti i campi obbligatori', () => {
			const session = new TrackerSession(() => 'user-123');
			const payload = { name: 'click', data: {} }

			const event = session.createEvent('custom', 'info', payload);

			expect(event.type).toBe('custom');
			expect(event.level).toBe('info');
			expect(event.appId).toBe('test-app');
			expect(event.sessionId).toBe(session.sessionId);
			expect(event.userId).toBe('user-123');
			expect(event.payload).toBe(payload);
		});

		it('timestamp è un ISO string valido', () => {
			const session = new TrackerSession();
			const event = session.createEvent('custom', 'info', { name: 'test', data: {} });
			expect(() => new Date(event.timestamp)).not.toThrow();
			expect(new Date(event.timestamp).toISOString()).toBe(event.timestamp);
		});

		it('timestamp riflette il momento della chiamata', () => {
			const before = new Date().toISOString();
			const session = new TrackerSession();
			const event = session.createEvent('custom', 'info', { name: 'test', data: {} });
			const after = new Date().toISOString();
			expect(event.timestamp >= before).toBe(true);
			expect(event.timestamp <= after).toBe(true);
		});

		it('include groupId se fornito', () => {
			const session = new TrackerSession();
			const event = session.createEvent('custom', 'info', { name: 'test', data: {} }, 'grp_abc');
			expect(event.groupId).toBe('grp_abc');
		});

		it('groupId è undefined se non fornito', () => {
			const session = new TrackerSession();
			const event = session.createEvent('custom', 'info', { name: 'test', data: {} });
			expect(event.groupId).toBeUndefined();
		});

		describe('context', () => {

			it('context è undefined se non è stato impostato nulla', () => {
				const session = new TrackerSession();
				const event = session.createEvent('custom', 'info', { name: 'test', data: {} });
				expect(event.context).toBeUndefined();
			});

			it('include il context impostato via setContext()', () => {
				const session = new TrackerSession();
				session.setContext({ env: 'production' });
				const event = session.createEvent('custom', 'info', { name: 'test', data: {} });
				expect(event.context).toEqual({ env: 'production' });
			});

			it('include extraCtx se fornito', () => {
				const session = new TrackerSession();
				const event = session.createEvent(
					'custom', 'info',
					{ name: 'test', data: {} },
					undefined,
					{ requestId: 'req-42' }
				);
				expect(event.context).toEqual({ requestId: 'req-42' });
			});

			it('extraCtx viene mergato con il context esistente', () => {
				const session = new TrackerSession();
				session.setContext({ env: 'production' });
				const event = session.createEvent(
					'custom', 'info',
					{ name: 'test', data: {} },
					undefined,
					{ requestId: 'req-42' }
				);
				expect(event.context).toEqual({ env: 'production', requestId: 'req-42' });
			});

			it('extraCtx sovrascrive il context in caso di chiave in conflitto', () => {
				const session = new TrackerSession();
				session.setContext({ env: 'production' });
				const event = session.createEvent(
					'custom', 'info',
					{ name: 'test', data: {} },
					undefined,
					{ env: 'override' }
				);
				expect(event.context?.env).toBe('override');
			});

			it('il context dell\'evento è una copia: modificarlo non altera la sessione', () => {
				const session = new TrackerSession();
				session.setContext({ env: 'production' });
				const event = session.createEvent('custom', 'info', { name: 'test', data: {} });

				event.context!.env = 'staging';

				expect(session.getContext()).toEqual({ env: 'production' });
			});
		});

		describe('meta', () => {

			it('include userAgent da navigator', () => {
				const session = new TrackerSession();
				const event = session.createEvent('custom', 'info', { name: 'test', data: {} });
				expect(event.meta.userAgent).toBe(navigator.userAgent);
			});

			it('include route come pathname + search', () => {
				const session = new TrackerSession();
				const event = session.createEvent('custom', 'info', { name: 'test', data: {} });
				const expected = window.location.pathname + window.location.search;
				expect(event.meta.route).toBe(expected);
			});

			it('include viewport come "WxH"', () => {
				const session = new TrackerSession();
				const event = session.createEvent('custom', 'info', { name: 'test', data: {} });
				expect(event.meta.viewport).toMatch(/^\d+x\d+$/);
			});

			it('include language da navigator', () => {
				const session = new TrackerSession();
				const event = session.createEvent('custom', 'info', { name: 'test', data: {} });
				expect(event.meta.language).toBe(navigator.language);
			});

			it('referrer è undefined se document.referrer è stringa vuota', () => {
				const session = new TrackerSession();
				const event = session.createEvent('custom', 'info', { name: 'test', data: {} });
				expect(event.meta.referrer).toBeUndefined();
			});

			it('userAttributes è undefined se userAttributes è un oggetto vuoto', () => {
				const session = new TrackerSession();
				const event = session.createEvent('custom', 'info', { name: 'test', data: {} });
				expect(event.meta.userAttributes).toBeUndefined();
			});

			it('include userAttributes quando popolato', () => {
				const session = new TrackerSession();
				session.userAttributes = { plan: 'pro', locale: 'it-IT' };
				const event = session.createEvent('custom', 'info', { name: 'test', data: {} });
				expect(event.meta.userAttributes).toEqual({ plan: 'pro', locale: 'it-IT' });
			});
		});

		describe('tipi di evento', () => {

			it('type "click" viene passato correttamente', () => {
				const session = new TrackerSession();
				const event = session.createEvent('click', 'info', { tag: 'button', text: 'ok', xpath: '/button', coordinates: { x: 0, y: 0 } });
				expect(event.type).toBe('click');
			});

			it('type "error" con level "error"', () => {
				const session = new TrackerSession();
				const event = session.createEvent('error', 'error', { message: 'crash', errorType: 'Error' });
				expect(event.type).toBe('error');
				expect(event.level).toBe('error');
			});

			it('type "session" con action start', () => {
				const session = new TrackerSession();
				const event = session.createEvent('session', 'info', { action: 'start', trigger: 'init' });
				expect(event.type).toBe('session');
				expect(event.payload).toEqual({ action: 'start', trigger: 'init' });
			});

			it('type "http" con level "warn"', () => {
				const session = new TrackerSession();
				const event = session.createEvent('http', 'warn', { method: 'GET', url: '/api', duration: 100 });
				expect(event.type).toBe('http');
				expect(event.level).toBe('warn');
			});
		});

		it('snapshot della struttura completa di un evento', () => {
			const session = new TrackerSession(() => 'user-snap');
			session.setContext({ env: 'test' });
			session.userAttributes = { plan: 'free' };

			const payload = { name: 'snapshot', data: { key: 'val' } }
			const event = session.createEvent('custom', 'debug', payload, 'grp_snap', { traceId: 't1' });

			expect(event).toMatchObject({
				type: 'custom',
				level: 'debug',
				appId: 'test-app',
				sessionId: session.sessionId,
				userId: 'user-snap',
				groupId: 'grp_snap',
				context: { env: 'test', traceId: 't1' },
				payload,
				meta: {
					userAttributes: { plan: 'free' }
				}
			});
			expect(event.timestamp).toBeTruthy();
		});
	});
});
