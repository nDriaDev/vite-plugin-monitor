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

		it('generates a new sessionId when sessionStorage is empty', () => {
			const session = new TrackerSession();
			expect(session.sessionId).toBeTruthy();
			expect(session.sessionId).toMatch(/^sess_/);
		});

		it('saves the generated sessionId in sessionStorage', () => {
			const session = new TrackerSession();
			expect(ssGet(SESSION_ID_KEY)).toBe(session.sessionId);
		});

		it('retrieves the existing sessionId from sessionStorage', () => {
			ssSet(SESSION_ID_KEY, 'sess_esistente');
			const session = new TrackerSession();
			expect(session.sessionId).toBe('sess_esistente');
		});

		it('two instances in the same sessionStorage share the same sessionId', () => {
			const s1 = new TrackerSession();
			const s2 = new TrackerSession();
			expect(s1.sessionId).toBe(s2.sessionId);
		});

		it('different sessionId between tests (sessionStorage is cleared)', () => {
			const s1 = new TrackerSession();
			sessionStorage.clear();
			const s2 = new TrackerSession();
			expect(s1.sessionId).not.toBe(s2.sessionId);
		});

		it('generates a sessionId using Math.random fallback when crypto.randomUUID is unavailable', () => {
			const originalUUID = crypto.randomUUID;
			crypto.randomUUID = undefined as unknown as typeof crypto.randomUUID;

			sessionStorage.clear();
			const session = new TrackerSession();

			expect(session.sessionId).toMatch(/^sess_/);

			crypto.randomUUID = originalUUID;
		});

		it('Returns null from sessionGet if sessionStorage throws an exception', () => {
			vi.spyOn(Storage.prototype, 'getItem').mockImplementationOnce(() => {
				throw new Error('SecurityError: storage non disponibile');
			});

			const session = new TrackerSession();
			expect(session.sessionId).toMatch(/^sess_/);
		})
	})

	describe('constructor — appId', () => {

		it('reads appId from window.__TRACKER_CONFIG__', () => {
			const session = new TrackerSession();
			expect(session.appId).toBe('test-app');
		});

		it('uses "unknown" when window.__TRACKER_CONFIG__ is not present', () => {
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

		it('uses the value returned by userIdFn when not null', () => {
			const session = new TrackerSession(() => 'user-123');
			expect(session.userId).toBe('user-123');
		});

		it('saves the resolved userId in sessionStorage', () => {
			new TrackerSession(() => 'user-123');
			expect(ssGet(USER_ID_KEY)).toBe('user-123');
		});

		it('generates an anonymous userId when userIdFn returns null', () => {
			const session = new TrackerSession(() => null);
			expect(session.userId).toMatch(/^anon_/);
		});

		it('generates an anonymous userId when no userIdFn is provided', () => {
			const session = new TrackerSession();
			expect(session.userId).toMatch(/^anon_/);
		});

		it('saves the anonymous userId in sessionStorage', () => {
			const session = new TrackerSession();
			expect(ssGet(USER_ID_KEY)).toBe(session.userId);
		});

		it('retrieves existing userId from sessionStorage when userIdFn is absent', () => {
			ssSet(USER_ID_KEY, 'anon_saved');
			const session = new TrackerSession();
			expect(session.userId).toBe('anon_saved');
		});

		it('the resolver takes priority over sessionStorage', () => {
			ssSet(USER_ID_KEY, 'anon_old');
			const session = new TrackerSession(() => 'user-new');
			expect(session.userId).toBe('user-new');
		});

		it('two instances with the same sessionStorage share the anonymous userId', () => {
			const s1 = new TrackerSession();
			const s2 = new TrackerSession();
			expect(s1.userId).toBe(s2.userId);
		});
	});

	describe('setUserIdFn()', () => {

		it('updates the resolver and re-resolves immediately when the result is truthy', () => {
			const session = new TrackerSession(() => null);
			const anonId = session.userId;

			session.setUserIdFn(() => 'user-after-login');

			expect(session.userId).toBe('user-after-login');
			expect(session.userId).not.toBe(anonId);
		});

		it('saves the new userId in sessionStorage', () => {
			const session = new TrackerSession();
			session.setUserIdFn(() => 'user-after-login');
			expect(ssGet(USER_ID_KEY)).toBe('user-after-login');
		});

		it('does not update userId when the resolver returns null', () => {
			const session = new TrackerSession(() => 'user-123');
			session.setUserIdFn(() => null);
			expect(session.userId).toBe('user-123');
		});

		it('does not update userId when the resolver returns an empty string', () => {
			const session = new TrackerSession(() => 'user-123');
			session.setUserIdFn(() => '');
			expect(session.userId).toBe('user-123');
		});
	});

	describe('setContext()', () => {

		it('adds keys to the context', () => {
			const session = new TrackerSession();
			session.setContext({ env: 'production', version: '1.0' });
			expect(session.getContext()).toEqual({ env: 'production', version: '1.0' });
		});

		it('merges multiple successive calls without overwriting', () => {
			const session = new TrackerSession();
			session.setContext({ env: 'production' });
			session.setContext({ version: '1.0' });
			expect(session.getContext()).toEqual({ env: 'production', version: '1.0' });
		});

		it('overwrites an existing key', () => {
			const session = new TrackerSession();
			session.setContext({ env: 'staging' });
			session.setContext({ env: 'production' });
			expect(session.getContext()).toEqual({ env: 'production' });
		});

		it('removes a key when the value is null', () => {
			const session = new TrackerSession();
			session.setContext({ env: 'production', version: '1.0' });
			session.setContext({ env: null });
			expect(session.getContext()).toEqual({ version: '1.0' });
		});

		it('removing a non-existent key with null is a no-op', () => {
			const session = new TrackerSession();
			session.setContext({ chiaveInesistente: null });
			expect(session.getContext()).toBeUndefined();
		});

		it('does not remove a key when the value is undefined (only null removes)', () => {
			const session = new TrackerSession();
			session.setContext({ env: 'production' });
			session.setContext({ env: undefined });
			const ctx = session.getContext();
			expect(ctx).toHaveProperty('env', undefined);
		});
	});

	describe('getContext()', () => {

		it('returns undefined when the context is empty', () => {
			const session = new TrackerSession();
			expect(session.getContext()).toBeUndefined();
		});

		it('returns undefined after removing all keys', () => {
			const session = new TrackerSession();
			session.setContext({ env: 'production' });
			session.setContext({ env: null });
			expect(session.getContext()).toBeUndefined();
		});

		it('returns a copy and not the internal reference', () => {
			const session = new TrackerSession();
			session.setContext({ env: 'production' });

			const ctx = session.getContext()!;
			ctx.env = 'staging';

			expect(session.getContext()).toEqual({ env: 'production' });
		});
	});

	describe('createEvent()', () => {

		it('produces a TrackerEvent with all required fields', () => {
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

		it('timestamp is a valid ISO string', () => {
			const session = new TrackerSession();
			const event = session.createEvent('custom', 'info', { name: 'test', data: {} });
			expect(() => new Date(event.timestamp)).not.toThrow();
			expect(new Date(event.timestamp).toISOString()).toBe(event.timestamp);
		});

		it('timestamp reflects the time of the call', () => {
			const before = new Date().toISOString();
			const session = new TrackerSession();
			const event = session.createEvent('custom', 'info', { name: 'test', data: {} });
			const after = new Date().toISOString();
			expect(event.timestamp >= before).toBe(true);
			expect(event.timestamp <= after).toBe(true);
		});

		it('includes groupId when provided', () => {
			const session = new TrackerSession();
			const event = session.createEvent('custom', 'info', { name: 'test', data: {} }, 'grp_abc');
			expect(event.groupId).toBe('grp_abc');
		});

		it('groupId is undefined when not provided', () => {
			const session = new TrackerSession();
			const event = session.createEvent('custom', 'info', { name: 'test', data: {} });
			expect(event.groupId).toBeUndefined();
		});

		describe('context', () => {

			it('context is undefined when nothing has been set', () => {
				const session = new TrackerSession();
				const event = session.createEvent('custom', 'info', { name: 'test', data: {} });
				expect(event.context).toBeUndefined();
			});

			it('includes the context set via setContext()', () => {
				const session = new TrackerSession();
				session.setContext({ env: 'production' });
				const event = session.createEvent('custom', 'info', { name: 'test', data: {} });
				expect(event.context).toEqual({ env: 'production' });
			});

			it('includes extraCtx when provided', () => {
				const session = new TrackerSession();
				const event = session.createEvent(
					'custom', 'info',
					{ name: 'test', data: {} },
					undefined,
					{ requestId: 'req-42' }
				);
				expect(event.context).toEqual({ requestId: 'req-42' });
			});

			it('extraCtx is merged with the existing context', () => {
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

			it('extraCtx overrides the context on key conflict', () => {
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

			it('the event context is a copy: modifying it does not alter the session', () => {
				const session = new TrackerSession();
				session.setContext({ env: 'production' });
				const event = session.createEvent('custom', 'info', { name: 'test', data: {} });

				event.context!.env = 'staging';

				expect(session.getContext()).toEqual({ env: 'production' });
			});
		});

		describe('meta', () => {

			it('includes userAgent from navigator', () => {
				const session = new TrackerSession();
				const event = session.createEvent('custom', 'info', { name: 'test', data: {} });
				expect(event.meta.userAgent).toBe(navigator.userAgent);
			});

			it('includes route as pathname + search', () => {
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

			it('includes language from navigator', () => {
				const session = new TrackerSession();
				const event = session.createEvent('custom', 'info', { name: 'test', data: {} });
				expect(event.meta.language).toBe(navigator.language);
			});

			it('referrer is undefined when document.referrer is an empty string', () => {
				const session = new TrackerSession();
				const event = session.createEvent('custom', 'info', { name: 'test', data: {} });
				expect(event.meta.referrer).toBeUndefined();
			});

			it('userAttributes is undefined when userAttributes is an empty object', () => {
				const session = new TrackerSession();
				const event = session.createEvent('custom', 'info', { name: 'test', data: {} });
				expect(event.meta.userAttributes).toBeUndefined();
			});

			it('includes userAttributes when populated', () => {
				const session = new TrackerSession();
				session.userAttributes = { plan: 'pro', locale: 'it-IT' };
				const event = session.createEvent('custom', 'info', { name: 'test', data: {} });
				expect(event.meta.userAttributes).toEqual({ plan: 'pro', locale: 'it-IT' });
			});
		});

		describe('event types', () => {

			it('type "click" is passed correctly', () => {
				const session = new TrackerSession();
				const event = session.createEvent('click', 'info', { tag: 'button', text: 'ok', xpath: '/button', coordinates: { x: 0, y: 0 } });
				expect(event.type).toBe('click');
			});

			it('type "error" with level "error"', () => {
				const session = new TrackerSession();
				const event = session.createEvent('error', 'error', { message: 'crash', errorType: 'Error' });
				expect(event.type).toBe('error');
				expect(event.level).toBe('error');
			});

			it('type "session" with action start', () => {
				const session = new TrackerSession();
				const event = session.createEvent('session', 'info', { action: 'start', trigger: 'init' });
				expect(event.type).toBe('session');
				expect(event.payload).toEqual({ action: 'start', trigger: 'init' });
			});

			it('type "http" with level "warn"', () => {
				const session = new TrackerSession();
				const event = session.createEvent('http', 'warn', { method: 'GET', url: '/api', duration: 100 });
				expect(event.type).toBe('http');
				expect(event.level).toBe('warn');
			});
		});

		it('snapshot of the complete event structure', () => {
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
