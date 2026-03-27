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
		it('sets tab to "metrics" when hash is not recognized', async () => {
			window.location.hash = '';
			const { initRouter, store } = await importRouter();
			initRouter();
			expect(store.get().tab).toBe('metrics');
		});

		it('set tab to "metrics" to hash #/metrics', async () => {
			window.location.hash = '#/metrics';
			const { initRouter, store } = await importRouter();
			initRouter();
			expect(store.get().tab).toBe('metrics');
		});

		it('set tab to "events" to hash #/events', async () => {
			window.location.hash = '#/events';
			const { initRouter, store } = await importRouter();
			initRouter();
			expect(store.get().tab).toBe('events');
		});

		it('Refresh the tab when the hash changes (hashchange)', async () => {
			window.location.hash = '#/metrics';
			const { initRouter, store } = await importRouter();
			initRouter();
			window.location.hash = '#/events';
			window.dispatchEvent(new HashChangeEvent('hashchange'));
			expect(store.get().tab).toBe('events');
		});

		it('does not change tab when the hash is already the current one', async () => {
			window.location.hash = '#/metrics';
			const { initRouter, store } = await importRouter();
			initRouter();
			const setTabSpy = vi.spyOn(store, 'setTab');
			window.dispatchEvent(new HashChangeEvent('hashchange'));
			expect(setTabSpy).not.toHaveBeenCalled();
		});

		it('store.on tab:change updates the page hash', async () => {
			window.location.hash = '';
			const { initRouter, store } = await importRouter();
			initRouter();
			store.setTab('events');
			expect(window.location.hash).toBe('#/events');
		});

		it('does not call replaceState when the hash is already correct', async () => {
			window.location.hash = '#/metrics';
			const { initRouter, store } = await importRouter();
			const replaceSpy = vi.spyOn(history, 'replaceState');
			initRouter();
			store.setTab('metrics');
			expect(replaceSpy).not.toHaveBeenCalled();
		});
	});

	describe('navigateTo', () => {
		it('calls store.setTab with the provided tab', async () => {
			const { navigateTo, store } = await importRouter();
			navigateTo('events');
			expect(store.get().tab).toBe('events');
		});
	});
});
