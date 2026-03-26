import { describe, it, expect, vi } from 'vitest';
import { DebugOverlay } from '../../src/client/overlay';
import type { TrackerSession } from '../../src/client/session';

const THEME_STORAGE_KEY = '__tracker_theme__';
const DASHBOARD_ROUTE = '/_tracker';

const session = {
	userId: 'user-test',
	sessionId: 'sess_test123',
	appId: 'test-app',
} as unknown as TrackerSession;
let overlay: DebugOverlay;

function makeOverlay(position: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left' = 'bottom-right', onUserIdChange: (id: string | null) => void = vi.fn()): DebugOverlay {
	return new DebugOverlay(session, DASHBOARD_ROUTE, position, onUserIdChange);
}

function getShadow(overlay: DebugOverlay): ShadowRoot {
	return (overlay as any).shadow as ShadowRoot;
}

function stubClipboard(writeText: ReturnType<typeof vi.fn>) {
	Object.defineProperty(navigator, 'clipboard', {
		configurable: true,
		writable: true,
		enumerable: true,
		value: { writeText }
	});
}

function restoreClipboard() {
	Object.defineProperty(navigator, 'clipboard', {
		configurable: true,
		writable: true,
		value: undefined,
	});
}

describe('DebugOverlay', () => {
	describe('costruttore', () => {
		it('aggiunge un elemento host a document.body', () => {
			overlay = makeOverlay();
			const host = document.body.querySelector('[data-tracker-overlay]');
			expect(host).not.toBeNull();
			overlay.destroy();
		});

		it('usa "dark" come tema di default se localStorage non ha il tema', () => {
			overlay = makeOverlay();
			expect((overlay as any).theme).toBe('dark');
			expect((overlay as any).host.classList.contains('light')).toBe(false);
			overlay.destroy();
		});

		it('recupera il tema "light" da localStorage se salvato', () => {
			localStorage.setItem(THEME_STORAGE_KEY, 'light');
			overlay = makeOverlay();
			expect((overlay as any).theme).toBe('light');
			expect((overlay as any).host.classList.contains('light')).toBe(true);
			localStorage.removeItem(THEME_STORAGE_KEY);
			overlay.destroy();
		});

		it('usa "dark" se localStorage contiene un valore non riconosciuto', () => {
			localStorage.setItem(THEME_STORAGE_KEY, 'unknown-value');
			overlay = makeOverlay();
			expect((overlay as any).theme).toBe('dark');
			localStorage.removeItem(THEME_STORAGE_KEY);
			overlay.destroy();
		});

		it('se document.body non esiste, onDOMContentLoaded appende l\'host quando invocato', () => {
			const realBody = document.body;
			document.documentElement.removeChild(realBody);


			try {
				overlay = makeOverlay();
				expect(document.querySelector('[data-tracker-overlay]')).toBeNull();
				expect((overlay as any).onDOMContentLoaded).not.toBeNull();
			} finally {
				document.documentElement.appendChild(realBody);
			}

			(overlay as any).onDOMContentLoaded();
			expect(document.body.querySelector('[data-tracker-overlay]')).not.toBeNull();
			expect((overlay as any).onDOMContentLoaded).toBeNull();
			overlay.destroy();
		});

		it('il shadow DOM contiene il fab (#fab) e il panel (#panel)', () => {
			overlay = makeOverlay();
			const shadow = getShadow(overlay);
			expect(shadow.querySelector('#fab')).not.toBeNull();
			expect(shadow.querySelector('#panel')).not.toBeNull();
			overlay.destroy();
		});

		it('renderizza lo userId della sessione nel display', () => {
			overlay = makeOverlay();
			const shadow = getShadow(overlay);
			expect(shadow.querySelector('#userid-display')!.textContent).toBe(session.userId);
			overlay.destroy();
		});
	});

	describe('posizione', () => {
		it('bottom-right: fab ha bottom e right a 20px, top e left vuoti', () => {
			overlay = makeOverlay('bottom-right');
			const fab = (overlay as any).fab as HTMLElement;
			expect(fab.style.getPropertyValue('bottom')).toBe('20px');
			expect(fab.style.getPropertyValue('right')).toBe('20px');
			expect(fab.style.getPropertyValue('top')).toBe('');
			expect(fab.style.getPropertyValue('left')).toBe('');
			overlay.destroy();
		});

		it('bottom-left: fab ha bottom e left a 20px, top e right vuoti', () => {
			overlay = makeOverlay('bottom-left');
			const fab = (overlay as any).fab as HTMLElement;
			expect(fab.style.getPropertyValue('bottom')).toBe('20px');
			expect(fab.style.getPropertyValue('left')).toBe('20px');
			expect(fab.style.getPropertyValue('top')).toBe('');
			expect(fab.style.getPropertyValue('right')).toBe('');
			overlay.destroy();
		});

		it('top-right: fab ha top e right a 20px, bottom e left vuoti', () => {
			overlay = makeOverlay('top-right');
			const fab = (overlay as any).fab as HTMLElement;
			expect(fab.style.getPropertyValue('top')).toBe('20px');
			expect(fab.style.getPropertyValue('right')).toBe('20px');
			expect(fab.style.getPropertyValue('bottom')).toBe('');
			expect(fab.style.getPropertyValue('left')).toBe('');
			overlay.destroy();
		});

		it('top-left: fab ha top e left a 20px, bottom e right vuoti', () => {
			overlay = makeOverlay('top-left');
			const fab = (overlay as any).fab as HTMLElement;
			expect(fab.style.getPropertyValue('top')).toBe('20px');
			expect(fab.style.getPropertyValue('left')).toBe('20px');
			expect(fab.style.getPropertyValue('bottom')).toBe('');
			expect(fab.style.getPropertyValue('right')).toBe('');
			overlay.destroy();
		});
	});

	describe('toggle()', () => {
		it('apre il panel aggiungendo la classe "open"', () => {
			overlay = makeOverlay();
			const panel = getShadow(overlay).querySelector('#panel')!;
			expect(panel.classList.contains('open')).toBe(false);
			overlay.toggle();
			expect(panel.classList.contains('open')).toBe(true);
			overlay.destroy();
		});

		it('chiude il panel rimuovendo la classe "open"', () => {
			overlay = makeOverlay();
			const panel = getShadow(overlay).querySelector('#panel')!;
			overlay.toggle();
			overlay.toggle();
			expect(panel.classList.contains('open')).toBe(false);
			overlay.destroy();
		});

		it('all\'apertura aggiorna il campo Route', () => {
			overlay = makeOverlay();
			overlay.toggle();
			const routeEl = getShadow(overlay).querySelector<HTMLElement>('[data-field="Route"]')!;
			expect(routeEl.textContent).toBe(window.location.pathname);
			overlay.destroy();
		});

		it('all\'apertura aggiorna il campo Viewport', () => {
			overlay = makeOverlay();
			overlay.toggle();
			const viewportEl = getShadow(overlay).querySelector<HTMLElement>('[data-field="Viewport"]')!;
			expect(viewportEl.textContent).toBe(`${window.innerWidth} x ${window.innerHeight}`);
			overlay.destroy();
		});

		it('all\'apertura aggiorna il campo Connection ("-" in jsdom, navigator.connection assente)', () => {
			overlay = makeOverlay();
			overlay.toggle();
			const connEl = getShadow(overlay).querySelector<HTMLElement>('[data-field="Connection"]')!;
			expect(connEl.textContent).toBe('-');
			overlay.destroy();
		});

		it('alla chiusura i campi dinamici NON vengono aggiornati', () => {
			overlay = makeOverlay();
			const shadow = getShadow(overlay);
			overlay.toggle();
			const routeEl = shadow.querySelector<HTMLElement>('[data-field="Route"]')!;
			routeEl.textContent = '__sentinel__';
			overlay.toggle();
			expect(routeEl.textContent).toBe('__sentinel__');
			overlay.destroy();
		});
	});

	describe('close()', () => {
		it('rimuove la classe "open" dal panel', () => {
			overlay = makeOverlay();
			const panel = getShadow(overlay).querySelector('#panel')!;
			overlay.toggle();
			overlay.close();
			expect(panel.classList.contains('open')).toBe(false);
			overlay.destroy();
		});

		it('è idempotente se il panel era già chiuso', () => {
			overlay = makeOverlay();
			const panel = getShadow(overlay).querySelector('#panel')!;
			overlay.close();
			expect(panel.classList.contains('open')).toBe(false);
			overlay.destroy();
		});
	});

	describe('destroy()', () => {
		it('rimuove l\'host da document.body', () => {
			overlay = makeOverlay();
			expect(document.body.querySelector('[data-tracker-overlay]')).not.toBeNull();
			overlay.destroy();
			expect(document.body.querySelector('[data-tracker-overlay]')).toBeNull();
			overlay.destroy();
		});

		it('rimuove il listener keydown da document (Alt+T non apre più il panel)', () => {
			overlay = makeOverlay();
			const panel = getShadow(overlay).querySelector('#panel')!;
			overlay.destroy();
			document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, altKey: true, key: 't' }));
			expect(panel.classList.contains('open')).toBe(false);
			overlay.destroy();
		});

		it('rimuove il listener mousemove da document (il panel non viene spostato)', () => {
			overlay = makeOverlay();
			overlay.toggle();
			(overlay as any).dragging = true;
			const panel = (overlay as any).panel as HTMLElement;
			overlay.destroy();
			document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 999, clientY: 999 }));
			expect(panel.style.left).not.toBe('999px');
			overlay.destroy();
		});

		it('rimuove il listener mouseup da document (dragging non viene resettato)', () => {
			overlay = makeOverlay();
			(overlay as any).dragging = true;
			overlay.destroy();
			document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
			expect((overlay as any).dragging).toBe(true);
			overlay.destroy();
		});
	});

	describe('refreshUserId()', () => {
		it('aggiorna il testo di #userid-display con il nuovo userId', () => {
			overlay = makeOverlay();
			const shadow = getShadow(overlay);
			(overlay as any).session.userId = session.userId;
			overlay.refreshUserId();

			const display = shadow.querySelector<HTMLElement>('#userid-display')!;
			expect(display.textContent).toBe(session.userId);
			expect(display.title).toBe(session.userId);
			overlay.destroy();
		});

		it('aggiorna il data-val del pulsante #userid-copy con il nuovo userId', () => {
			overlay = makeOverlay();
			const shadow = getShadow(overlay);
			(overlay as any).session.userId = session.userId;
			overlay.refreshUserId();

			const copyBtn = shadow.querySelector<HTMLElement>('#userid-copy')!;
			expect(copyBtn.dataset.val).toBe(session.userId);
			overlay.destroy();
		});

		it('aggiorna il valore di #userid-input con il nuovo userId', () => {
			overlay = makeOverlay();
			const shadow = getShadow(overlay);
			(overlay as any).session.userId = session.userId;
			overlay.refreshUserId();

			const input = shadow.querySelector<HTMLInputElement>('#userid-input')!;
			expect(input.value).toBe(session.userId);
			overlay.destroy();
		});
	});

	describe('pushEvent()', () => {
		it('è chiamabile senza errori (no-op intenzionale)', () => {
			overlay = makeOverlay();
			expect(() => overlay.pushEvent({ type: 'custom' } as any)).not.toThrow();
			overlay.destroy();
		});
	});

	describe('shortcut Alt+T', () => {
		it('Alt+T apre il panel se è chiuso', () => {
			overlay = makeOverlay();
			const panel = getShadow(overlay).querySelector('#panel')!;
			document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, altKey: true, key: 't' }));
			expect(panel.classList.contains('open')).toBe(true);
			overlay.destroy();
		});

		it('Alt+T chiude il panel se era aperto', () => {
			overlay = makeOverlay();
			const panel = getShadow(overlay).querySelector('#panel')!;
			overlay.toggle();
			document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, altKey: true, key: 't' }));
			expect(panel.classList.contains('open')).toBe(false);
			overlay.destroy();
		});

		it('Alt+X non apre il panel', () => {
			overlay = makeOverlay();
			const panel = getShadow(overlay).querySelector('#panel')!;
			document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, altKey: true, key: 'x' }));
			expect(panel.classList.contains('open')).toBe(false);
			overlay.destroy();
		});

		it('Ctrl+T (senza altKey) non apre il panel', () => {
			overlay = makeOverlay();
			const panel = getShadow(overlay).querySelector('#panel')!;
			document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ctrlKey: true, key: 't' }));
			expect(panel.classList.contains('open')).toBe(false);
			overlay.destroy();
		});
	});

	describe('pulsante FAB', () => {
		it('click sul FAB apre il panel', () => {
			overlay = makeOverlay();
			const panel = getShadow(overlay).querySelector('#panel')!;
			(overlay as any).fab.dispatchEvent(new MouseEvent('click', { bubbles: true }));
			expect(panel.classList.contains('open')).toBe(true);
			overlay.destroy();
		});

		it('click doppio sul FAB chiude il panel', () => {
			overlay = makeOverlay();
			const panel = getShadow(overlay).querySelector('#panel')!;
			const fab = (overlay as any).fab as HTMLElement;
			fab.dispatchEvent(new MouseEvent('click', { bubbles: true }));
			fab.dispatchEvent(new MouseEvent('click', { bubbles: true }));
			expect(panel.classList.contains('open')).toBe(false);
			overlay.destroy();
		});
	});

	describe('pulsante #close', () => {
		it('click su #close chiude il panel', () => {
			overlay = makeOverlay();
			const shadow = getShadow(overlay);
			const panel = shadow.querySelector('#panel')!;
			overlay.toggle();
			shadow.querySelector('#close')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
			expect(panel.classList.contains('open')).toBe(false);
			overlay.destroy();
		});
	});

	describe('tema', () => {
		it('click su #theme-toggle passa da dark a light', () => {
			overlay = makeOverlay();
			getShadow(overlay).querySelector('#theme-toggle')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
			expect((overlay as any).theme).toBe('light');
			expect((overlay as any).host.classList.contains('light')).toBe(true);
			overlay.destroy();
		});

		it('click su #theme-toggle passa da light a dark', () => {
			localStorage.setItem(THEME_STORAGE_KEY, 'light');
			overlay = makeOverlay();
			getShadow(overlay).querySelector('#theme-toggle')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
			expect((overlay as any).theme).toBe('dark');
			expect((overlay as any).host.classList.contains('light')).toBe(false);
			overlay.destroy();
		});

		it('il toggle salva il tema in localStorage', () => {
			overlay = makeOverlay();
			getShadow(overlay).querySelector('#theme-toggle')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
			expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
			overlay.destroy();
		});

		it('il toggle aggiorna il testo del pulsante (☀ ↔ ☾)', () => {
			overlay = makeOverlay();
			const btn = getShadow(overlay).querySelector<HTMLButtonElement>('#theme-toggle')!;
			expect(btn.textContent).toBe('☾');
			btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
			expect(btn.textContent).toBe('☀');
			overlay.destroy();
		});
	});

	describe('modifica userId', () => {
		it('click su #userid-edit mostra il form di modifica', () => {
			overlay = makeOverlay();
			const shadow = getShadow(overlay);
			shadow.querySelector('#userid-edit')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
			expect(shadow.querySelector<HTMLElement>('#userid-edit-row')!.style.display).toBe('flex');
			overlay.destroy();
		});

		it('click su #userid-cancel nasconde il form senza chiamare onUserIdChange', () => {
			const onUserIdChange = vi.fn();
			overlay = makeOverlay('bottom-right', onUserIdChange);
			const shadow = getShadow(overlay);
			shadow.querySelector('#userid-edit')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
			shadow.querySelector('#userid-cancel')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
			expect(shadow.querySelector<HTMLElement>('#userid-edit-row')!.style.display).toBe('none');
			expect(onUserIdChange).not.toHaveBeenCalled();
			overlay.destroy();
		});

		it('click su #userid-confirm chiama onUserIdChange con il nuovo ID', () => {
			const onUserIdChange = vi.fn();
			overlay = makeOverlay('bottom-right', onUserIdChange);
			const shadow = getShadow(overlay);
			shadow.querySelector('#userid-edit')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
			shadow.querySelector<HTMLInputElement>('#userid-input')!.value = 'user-new';
			shadow.querySelector('#userid-confirm')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
			expect(onUserIdChange).toHaveBeenCalledWith('user-new');
			overlay.destroy();
		});

		it('confirm con input vuoto (solo spazi) chiama onUserIdChange con null', () => {
			const onUserIdChange = vi.fn();
			overlay = makeOverlay('bottom-right', onUserIdChange);
			const shadow = getShadow(overlay);
			shadow.querySelector('#userid-edit')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
			shadow.querySelector<HTMLInputElement>('#userid-input')!.value = '   ';
			shadow.querySelector('#userid-confirm')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
			expect(onUserIdChange).toHaveBeenCalledWith(null);
			overlay.destroy();
		});

		it('Enter sull\'input conferma la modifica e chiama onUserIdChange', () => {
			const onUserIdChange = vi.fn();
			overlay = makeOverlay('bottom-right', onUserIdChange);
			const shadow = getShadow(overlay);
			shadow.querySelector('#userid-edit')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
			const input = shadow.querySelector<HTMLInputElement>('#userid-input')!;
			input.value = 'user-enter';
			input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }));
			expect(onUserIdChange).toHaveBeenCalledWith('user-enter');
			overlay.destroy();
		});

		it('Escape sull\'input annulla la modifica senza chiamare onUserIdChange', () => {
			const onUserIdChange = vi.fn();
			overlay = makeOverlay('bottom-right', onUserIdChange);
			const shadow = getShadow(overlay);
			shadow.querySelector('#userid-edit')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
			const input = shadow.querySelector<HTMLInputElement>('#userid-input')!;
			input.value = 'user-escape';
			input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }));
			expect(onUserIdChange).not.toHaveBeenCalled();
			expect(shadow.querySelector<HTMLElement>('#userid-edit-row')!.style.display).toBe('none');
			overlay.destroy();
		});

		it('confirm chiama refreshUserId aggiornando il display con il nuovo valore', () => {
			overlay = makeOverlay('bottom-right', (newId) => {
				(overlay as any).session.userId = newId ?? 'anon_x';
			});
			const shadow = getShadow(overlay);
			shadow.querySelector('#userid-edit')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
			shadow.querySelector<HTMLInputElement>('#userid-input')!.value = 'user-updated';
			shadow.querySelector('#userid-confirm')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
			expect(shadow.querySelector<HTMLElement>('#userid-display')!.textContent).toBe('user-updated');
			overlay.destroy();
		});
	});

	describe('copy button', () => {
		it('click su un .copy-btn chiama navigator.clipboard.writeText con il valore corretto', () => {
			const writeText = vi.fn().mockResolvedValue(undefined);
			stubClipboard(writeText);

			overlay = makeOverlay();
			const shadow = getShadow(overlay);
			const copyBtn = shadow.querySelector<HTMLElement>('.copy-btn')!;
			const expectedVal = copyBtn.dataset.val ?? '';
			copyBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));

			expect(writeText).toHaveBeenCalledWith(expectedVal);
			overlay.destroy();
			restoreClipboard();
		});

		it('il testo del pulsante diventa "copied" dopo il click e torna "copy" dopo 1500ms', async () => {
			vi.useFakeTimers();
			const writeText = vi.fn().mockResolvedValue(undefined);
			stubClipboard(writeText);

			overlay = makeOverlay();
			const shadow = getShadow(overlay);
			const copyBtn = shadow.querySelector<HTMLElement>('.copy-btn')!;
			copyBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));

			await Promise.resolve();

			expect(copyBtn.textContent).toBe('copied');
			expect(copyBtn.classList.contains('copied')).toBe(true);

			vi.advanceTimersByTime(1500);
			expect(copyBtn.textContent).toBe('copy');
			expect(copyBtn.classList.contains('copied')).toBe(false);
			overlay.destroy();
			restoreClipboard();
			vi.useRealTimers();
		});

		it('click su un elemento che non è .copy-btn non chiama clipboard', () => {
			const writeText = vi.fn().mockResolvedValue(undefined);
			stubClipboard(writeText);

			overlay = makeOverlay();
			const shadow = getShadow(overlay);
			shadow.querySelector('#panel')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

			expect(writeText).not.toHaveBeenCalled();
			overlay.destroy();
			restoreClipboard();
		});
	});

	describe('drag', () => {
		it('mousedown sull\'header con panel aperto imposta dragging = true', () => {
			overlay = makeOverlay();
			overlay.toggle();
			const header = getShadow(overlay).querySelector('#header') as HTMLElement;
			header.dispatchEvent(new MouseEvent('mousedown', { clientX: 50, clientY: 50, bubbles: true }));
			expect((overlay as any).dragging).toBe(true);
			overlay.destroy();
		});

		it('mousedown sull\'header con panel chiuso non avvia il drag', () => {
			overlay = makeOverlay();
			const header = getShadow(overlay).querySelector('#header') as HTMLElement;
			header.dispatchEvent(new MouseEvent('mousedown', { clientX: 50, clientY: 50, bubbles: true }));
			expect((overlay as any).dragging).toBe(false);
			overlay.destroy();
		});

		it('mousemove su document sposta il panel durante il drag', () => {
			overlay = makeOverlay();
			overlay.toggle();
			const shadow = getShadow(overlay);
			const header = shadow.querySelector('#header') as HTMLElement;

			header.dispatchEvent(new MouseEvent('mousedown', { clientX: 10, clientY: 20, bubbles: true }));
			document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 110, clientY: 120 }));

			const panel = (overlay as any).panel as HTMLElement;
			expect(panel.style.left).toBe('100px');
			expect(panel.style.top).toBe('100px');
			expect(panel.style.bottom).toBe('auto');
			expect(panel.style.right).toBe('auto');
			overlay.destroy();
		});

		it('mousemove non sposta il panel se dragging è false', () => {
			overlay = makeOverlay();
			overlay.toggle();
			const panel = (overlay as any).panel as HTMLElement;
			document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 999, clientY: 999 }));
			expect(panel.style.left).not.toBe('999px');
			overlay.destroy();
		});

		it('mouseup su document termina il drag (dragging → false)', () => {
			overlay = makeOverlay();
			overlay.toggle();
			const header = getShadow(overlay).querySelector('#header') as HTMLElement;
			header.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 0, clientY: 0 }));
			expect((overlay as any).dragging).toBe(true);
			document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
			expect((overlay as any).dragging).toBe(false);
			overlay.destroy();
		});
	});
});
