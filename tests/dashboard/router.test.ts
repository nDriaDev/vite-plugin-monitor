import { describe, it, expect, vi, beforeEach } from 'vitest';

async function importRouter() {
	vi.resetModules();
	const { initRouter, navigateTo } = await import('../../src/dashboard/router');
	const { store } = await import('../../src/dashboard/state');
	return { initRouter, navigateTo, store };
}

describe('router', () => {
	beforeEach(() => {
		window.location.hash = '';
	});

	describe('initRouter', () => {
		it('imposta tab su "metrics" se hash non è riconosciuto', async () => {
			window.location.hash = '';
			const { initRouter, store } = await importRouter();
			initRouter();
			expect(store.get().tab).toBe('metrics');
		});

		it('imposta tab su "metrics" per hash #/metrics', async () => {
			window.location.hash = '#/metrics';
			const { initRouter, store } = await importRouter();
			initRouter();
			expect(store.get().tab).toBe('metrics');
		});

		it('imposta tab su "events" per hash #/events', async () => {
			window.location.hash = '#/events';
			const { initRouter, store } = await importRouter();
			initRouter();
			expect(store.get().tab).toBe('events');
		});

		it('aggiorna il tab quando cambia l\'hash (hashchange)', async () => {
			window.location.hash = '#/metrics';
			const { initRouter, store } = await importRouter();
			initRouter();
			window.location.hash = '#/events';
			window.dispatchEvent(new HashChangeEvent('hashchange'));
			expect(store.get().tab).toBe('events');
		});

		it('non cambia tab se l\'hash è già quello corrente', async () => {
			window.location.hash = '#/metrics';
			const { initRouter, store } = await importRouter();
			initRouter();
			const setTabSpy = vi.spyOn(store, 'setTab');
			window.dispatchEvent(new HashChangeEvent('hashchange'));
			expect(setTabSpy).not.toHaveBeenCalled();
		});

		it('store.on tab:change aggiorna l\'hash della pagina', async () => {
			window.location.hash = '';
			const { initRouter, store } = await importRouter();
			initRouter();
			store.setTab('events');
			expect(window.location.hash).toBe('#/events');
		});

		it('non chiama replaceState se l\'hash è già corretto', async () => {
			window.location.hash = '#/metrics';
			const { initRouter, store } = await importRouter();
			const replaceSpy = vi.spyOn(history, 'replaceState');
			initRouter();
			store.setTab('metrics');
			expect(replaceSpy).not.toHaveBeenCalled();
		});
	});

	describe('navigateTo', () => {
		it('chiama store.setTab con il tab fornito', async () => {
			const { navigateTo, store } = await importRouter();
			navigateTo('events');
			expect(store.get().tab).toBe('events');
		});
	});
});
