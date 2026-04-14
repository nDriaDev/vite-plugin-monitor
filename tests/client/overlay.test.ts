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
	describe('constructor', () => {
		it('appends a host element to document.body', () => {
			overlay = makeOverlay();
			const host = document.body.querySelector('[data-tracker-overlay]');
			expect(host).not.toBeNull();
			overlay.destroy();
		});

		it('Use "dark" as default theme if localStorage doesn\'t have the theme', () => {
			overlay = makeOverlay();
			expect((overlay as any).theme).toBe('dark');
			expect((overlay as any).host.classList.contains('light')).toBe(false);
			overlay.destroy();
		});

		it('retrieves the "light" theme from localStorage if saved', () => {
			localStorage.setItem(THEME_STORAGE_KEY, 'light');
			overlay = makeOverlay();
			expect((overlay as any).theme).toBe('light');
			expect((overlay as any).host.classList.contains('light')).toBe(true);
			localStorage.removeItem(THEME_STORAGE_KEY);
			overlay.destroy();
		});

		it('use "dark" if localStorage contains an unrecognized value', () => {
			localStorage.setItem(THEME_STORAGE_KEY, 'unknown-value');
			overlay = makeOverlay();
			expect((overlay as any).theme).toBe('dark');
			localStorage.removeItem(THEME_STORAGE_KEY);
			overlay.destroy();
		});

		it('If document.body does not exist, onDOMContentLoaded appends the host when invoked', () => {
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

		it('the shadow DOM contains the fab (#fab) and the panel (#panel)', () => {
			overlay = makeOverlay();
			const shadow = getShadow(overlay);
			expect(shadow.querySelector('#fab')).not.toBeNull();
			expect(shadow.querySelector('#panel')).not.toBeNull();
			overlay.destroy();
		});

		it('renders the session userId in the display', () => {
			overlay = makeOverlay();
			const shadow = getShadow(overlay);
			expect(shadow.querySelector('#userid-display')!.textContent).toBe(session.userId);
			overlay.destroy();
		});
	});

	describe('position', () => {
		it('bottom-right: fab has bottom and right at 20px, top and left empty', () => {
			overlay = makeOverlay('bottom-right');
			const fab = (overlay as any).fab as HTMLElement;
			expect(fab.style.getPropertyValue('bottom')).toBe('20px');
			expect(fab.style.getPropertyValue('right')).toBe('20px');
			expect(fab.style.getPropertyValue('top')).toBe('');
			expect(fab.style.getPropertyValue('left')).toBe('');
			overlay.destroy();
		});

		it('bottom-left: fab has bottom and left at 20px, top and right empty', () => {
			overlay = makeOverlay('bottom-left');
			const fab = (overlay as any).fab as HTMLElement;
			expect(fab.style.getPropertyValue('bottom')).toBe('20px');
			expect(fab.style.getPropertyValue('left')).toBe('20px');
			expect(fab.style.getPropertyValue('top')).toBe('');
			expect(fab.style.getPropertyValue('right')).toBe('');
			overlay.destroy();
		});

		it('top-right: fab has top and right at 20px, bottom and left empty', () => {
			overlay = makeOverlay('top-right');
			const fab = (overlay as any).fab as HTMLElement;
			expect(fab.style.getPropertyValue('top')).toBe('20px');
			expect(fab.style.getPropertyValue('right')).toBe('20px');
			expect(fab.style.getPropertyValue('bottom')).toBe('');
			expect(fab.style.getPropertyValue('left')).toBe('');
			overlay.destroy();
		});

		it('top-left: fab has top and left at 20px, bottom and right empty', () => {
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
		it('Open the panel by adding the "open" class', () => {
			overlay = makeOverlay();
			const panel = getShadow(overlay).querySelector('#panel')!;
			expect(panel.classList.contains('open')).toBe(false);
			overlay.toggle();
			expect(panel.classList.contains('open')).toBe(true);
			overlay.destroy();
		});

		it('closes the panel by removing the "open" class', () => {
			overlay = makeOverlay();
			const panel = getShadow(overlay).querySelector('#panel')!;
			overlay.toggle();
			overlay.toggle();
			expect(panel.classList.contains('open')).toBe(false);
			overlay.destroy();
		});

		it('when opening, update the Route field', () => {
			overlay = makeOverlay();
			overlay.toggle();
			const routeEl = getShadow(overlay).querySelector<HTMLElement>('[data-field="Route"]')!;
			expect(routeEl.textContent).toBe(window.location.pathname);
			overlay.destroy();
		});

		it('when opening, update the Viewport field', () => {
			overlay = makeOverlay();
			overlay.toggle();
			const viewportEl = getShadow(overlay).querySelector<HTMLElement>('[data-field="Viewport"]')!;
			expect(viewportEl.textContent).toBe(`${window.innerWidth} x ${window.innerHeight}`);
			overlay.destroy();
		});

		it('when opening, update the Connection field ("-" in jsdom, navigator.connection missing)', () => {
			overlay = makeOverlay();
			overlay.toggle();
			const connEl = getShadow(overlay).querySelector<HTMLElement>('[data-field="Connection"]')!;
			expect(connEl.textContent).toBe('-');
			overlay.destroy();
		});

		it('on close the dynamic fields are NOT updated', () => {
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
		it('removes the "open" class from the panel', () => {
			overlay = makeOverlay();
			const panel = getShadow(overlay).querySelector('#panel')!;
			overlay.toggle();
			overlay.close();
			expect(panel.classList.contains('open')).toBe(false);
			overlay.destroy();
		});

		it('is idempotent when the panel was already closed', () => {
			overlay = makeOverlay();
			const panel = getShadow(overlay).querySelector('#panel')!;
			overlay.close();
			expect(panel.classList.contains('open')).toBe(false);
			overlay.destroy();
		});
	});

	describe('destroy()', () => {
		it('removes the host from document.body', () => {
			overlay = makeOverlay();
			expect(document.body.querySelector('[data-tracker-overlay]')).not.toBeNull();
			overlay.destroy();
			expect(document.body.querySelector('[data-tracker-overlay]')).toBeNull();
			overlay.destroy();
		});

		it('removes the keydown listener from document (Alt+T no longer opens the panel)', () => {
			overlay = makeOverlay();
			const panel = getShadow(overlay).querySelector('#panel')!;
			overlay.destroy();
			document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, altKey: true, key: 't' }));
			expect(panel.classList.contains('open')).toBe(false);
			overlay.destroy();
		});

		it('removes the mousemove listener from document (the panel is no longer moved)', () => {
			overlay = makeOverlay();
			overlay.toggle();
			(overlay as any).dragging = true;
			const panel = (overlay as any).panel as HTMLElement;
			overlay.destroy();
			document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 999, clientY: 999 }));
			expect(panel.style.left).not.toBe('999px');
			overlay.destroy();
		});

		it('removes the mouseup listener from document (dragging is no longer reset)', () => {
			overlay = makeOverlay();
			(overlay as any).dragging = true;
			overlay.destroy();
			document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
			expect((overlay as any).dragging).toBe(true);
			overlay.destroy();
		});
	});

	describe('refreshUserId()', () => {
		it('updates the text of #userid-display with the new userId', () => {
			overlay = makeOverlay();
			const shadow = getShadow(overlay);
			(overlay as any).session.userId = session.userId;
			overlay.refreshUserId();

			const display = shadow.querySelector<HTMLElement>('#userid-display')!;
			expect(display.textContent).toBe(session.userId);
			expect(display.title).toBe(session.userId);
			overlay.destroy();
		});

		it('updates the data-val of the #userid-copy button with the new userId', () => {
			overlay = makeOverlay();
			const shadow = getShadow(overlay);
			(overlay as any).session.userId = session.userId;
			overlay.refreshUserId();

			const copyBtn = shadow.querySelector<HTMLElement>('#userid-copy')!;
			expect(copyBtn.dataset.val).toBe(session.userId);
			overlay.destroy();
		});

		it('updates the value of #userid-input with the new userId', () => {
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
		it('is callable without errors (intentional no-op)', () => {
			overlay = makeOverlay();
			expect(() => overlay.pushEvent({ type: 'custom' } as any)).not.toThrow();
			overlay.destroy();
		});
	});

	describe('Alt+T shortcut', () => {
		it('Alt+T opens the panel when it is closed', () => {
			overlay = makeOverlay();
			const panel = getShadow(overlay).querySelector('#panel')!;
			document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, altKey: true, key: 't' }));
			expect(panel.classList.contains('open')).toBe(true);
			overlay.destroy();
		});

		it('Alt+T closes the panel when it was open', () => {
			overlay = makeOverlay();
			const panel = getShadow(overlay).querySelector('#panel')!;
			overlay.toggle();
			document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, altKey: true, key: 't' }));
			expect(panel.classList.contains('open')).toBe(false);
			overlay.destroy();
		});

		it('Alt+X does not open the panel', () => {
			overlay = makeOverlay();
			const panel = getShadow(overlay).querySelector('#panel')!;
			document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, altKey: true, key: 'x' }));
			expect(panel.classList.contains('open')).toBe(false);
			overlay.destroy();
		});

		it('Ctrl+T (without altKey) does not open the panel', () => {
			overlay = makeOverlay();
			const panel = getShadow(overlay).querySelector('#panel')!;
			document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ctrlKey: true, key: 't' }));
			expect(panel.classList.contains('open')).toBe(false);
			overlay.destroy();
		});
	});

	describe('FAB button', () => {
		it('click on FAB opens the panel', () => {
			overlay = makeOverlay();
			const panel = getShadow(overlay).querySelector('#panel')!;
			(overlay as any).fab.dispatchEvent(new MouseEvent('click', { bubbles: true }));
			expect(panel.classList.contains('open')).toBe(true);
			overlay.destroy();
		});

		it('double click on FAB closes the panel', () => {
			overlay = makeOverlay();
			const panel = getShadow(overlay).querySelector('#panel')!;
			const fab = (overlay as any).fab as HTMLElement;
			fab.dispatchEvent(new MouseEvent('click', { bubbles: true }));
			fab.dispatchEvent(new MouseEvent('click', { bubbles: true }));
			expect(panel.classList.contains('open')).toBe(false);
			overlay.destroy();
		});
	});

	describe('#close button', () => {
		it('click on #close closes the panel', () => {
			overlay = makeOverlay();
			const shadow = getShadow(overlay);
			const panel = shadow.querySelector('#panel')!;
			overlay.toggle();
			shadow.querySelector('#close')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
			expect(panel.classList.contains('open')).toBe(false);
			overlay.destroy();
		});
	});

	describe('#dashboard-link', () => {
		it('click calls window.open with the correct URL and target', () => {
			const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
			overlay = makeOverlay();
			getShadow(overlay).querySelector('#dashboard-link')!
				.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
			expect(openSpy).toHaveBeenCalledWith(
				window.location.origin + DASHBOARD_ROUTE,
				'tracker-dashboard'
			);
			openSpy.mockRestore();
			overlay.destroy();
		});

		it('click prevents the default anchor navigation', () => {
			vi.spyOn(window, 'open').mockImplementation(() => null);
			overlay = makeOverlay();
			const link = getShadow(overlay).querySelector('#dashboard-link')!;
			const event = new MouseEvent('click', { bubbles: true, cancelable: true });
			const preventSpy = vi.spyOn(event, 'preventDefault');
			link.dispatchEvent(event);
			expect(preventSpy).toHaveBeenCalled();
			vi.restoreAllMocks();
			overlay.destroy();
		});

		it('click closes the panel', () => {
			vi.spyOn(window, 'open').mockImplementation(() => null);
			overlay = makeOverlay();
			overlay.toggle();
			const panel = getShadow(overlay).querySelector('#panel')!;
			getShadow(overlay).querySelector('#dashboard-link')!
				.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
			expect(panel.classList.contains('open')).toBe(false);
			vi.restoreAllMocks();
			overlay.destroy();
		});
	});

	describe('theme', () => {
		it('click on #theme-toggle switches from dark to light', () => {
			overlay = makeOverlay();
			getShadow(overlay).querySelector('#theme-toggle')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
			expect((overlay as any).theme).toBe('light');
			expect((overlay as any).host.classList.contains('light')).toBe(true);
			overlay.destroy();
		});

		it('click on #theme-toggle switches from light to dark', () => {
			localStorage.setItem(THEME_STORAGE_KEY, 'light');
			overlay = makeOverlay();
			getShadow(overlay).querySelector('#theme-toggle')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
			expect((overlay as any).theme).toBe('dark');
			expect((overlay as any).host.classList.contains('light')).toBe(false);
			overlay.destroy();
		});

		it('the toggle saves the theme in localStorage', () => {
			overlay = makeOverlay();
			getShadow(overlay).querySelector('#theme-toggle')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
			expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
			overlay.destroy();
		});

		it('the toggle updates the button text (☀ ↔ ☾)', () => {
			overlay = makeOverlay();
			const btn = getShadow(overlay).querySelector<HTMLButtonElement>('#theme-toggle')!;
			expect(btn.textContent).toBe('☾');
			btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
			expect(btn.textContent).toBe('☀');
			overlay.destroy();
		});
	});

	describe('userId edit', () => {
		it('click on #userid-edit shows the edit form', () => {
			overlay = makeOverlay();
			const shadow = getShadow(overlay);
			shadow.querySelector('#userid-edit')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
			expect(shadow.querySelector<HTMLElement>('#userid-edit-row')!.style.display).toBe('grid');
			overlay.destroy();
		});

		it('click on #userid-cancel hides the form without calling onUserIdChange', () => {
			const onUserIdChange = vi.fn();
			overlay = makeOverlay('bottom-right', onUserIdChange);
			const shadow = getShadow(overlay);
			shadow.querySelector('#userid-edit')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
			shadow.querySelector('#userid-cancel')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
			expect(shadow.querySelector<HTMLElement>('#userid-edit-row')!.style.display).toBe('none');
			expect(onUserIdChange).not.toHaveBeenCalled();
			overlay.destroy();
		});

		it('click on #userid-confirm calls onUserIdChange with the new ID', () => {
			const onUserIdChange = vi.fn();
			overlay = makeOverlay('bottom-right', onUserIdChange);
			const shadow = getShadow(overlay);
			shadow.querySelector('#userid-edit')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
			shadow.querySelector<HTMLInputElement>('#userid-input')!.value = 'user-new';
			shadow.querySelector('#userid-confirm')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
			expect(onUserIdChange).toHaveBeenCalledWith('user-new');
			overlay.destroy();
		});

		it('confirm with empty input (spaces only) calls onUserIdChange with null', () => {
			const onUserIdChange = vi.fn();
			overlay = makeOverlay('bottom-right', onUserIdChange);
			const shadow = getShadow(overlay);
			shadow.querySelector('#userid-edit')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
			shadow.querySelector<HTMLInputElement>('#userid-input')!.value = '   ';
			shadow.querySelector('#userid-confirm')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
			expect(onUserIdChange).toHaveBeenCalledWith(null);
			overlay.destroy();
		});

		it('Enter on the input confirms the change and calls onUserIdChange', () => {
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

		it('Escaping on input cancels the change without calling onUserIdChange', () => {
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

		it('confirm calls refreshUserId updating the display with the new value', () => {
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
		it('click on a .copy-btn calls navigator.clipboard.writeText with the correct value', () => {
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

		it('The button text changes to "copied" after a click and returns to "copy" after 1500ms.', async () => {
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

		it('click on an element that is not .copy-btn does not call clipboard', () => {
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
		it('mousedown on header with panel open sets dragging = true', () => {
			overlay = makeOverlay();
			overlay.toggle();
			const header = getShadow(overlay).querySelector('#header') as HTMLElement;
			header.dispatchEvent(new MouseEvent('mousedown', { clientX: 50, clientY: 50, bubbles: true }));
			expect((overlay as any).dragging).toBe(true);
			overlay.destroy();
		});

		it('Mousedown on header with panel closed does not start dragging', () => {
			overlay = makeOverlay();
			const header = getShadow(overlay).querySelector('#header') as HTMLElement;
			header.dispatchEvent(new MouseEvent('mousedown', { clientX: 50, clientY: 50, bubbles: true }));
			expect((overlay as any).dragging).toBe(false);
			overlay.destroy();
		});

		it('mousemove on document moves the panel during drag', () => {
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

		it('mousemove does not move the panel when dragging is false', () => {
			overlay = makeOverlay();
			overlay.toggle();
			const panel = (overlay as any).panel as HTMLElement;
			document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 999, clientY: 999 }));
			expect(panel.style.left).not.toBe('999px');
			overlay.destroy();
		});

		it('mouseup on document ends the drag (dragging -> false)', () => {
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

	describe('click outside', () => {
		it('clicking outside the panel and FAB closes the panel when open', () => {
			overlay = makeOverlay();
			overlay.toggle();
			const panel = getShadow(overlay).querySelector('#panel')!;
			expect(panel.classList.contains('open')).toBe(true);

			document.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
			expect(panel.classList.contains('open')).toBe(false);
			overlay.destroy();
		});

		it('clicking inside the panel does not close it', () => {
			overlay = makeOverlay();
			overlay.toggle();
			const panel = (overlay as any).panel as HTMLElement;
			const event = new MouseEvent('click', { bubbles: true, cancelable: true });
			Object.defineProperty(event, 'composedPath', {
				value: () => [panel, document.body, document.documentElement, document, window],
			});
			document.dispatchEvent(event);

			expect(panel.classList.contains('open')).toBe(true);
			overlay.destroy();
		});

		it('clicking on the FAB does not close the panel (FAB handles its own toggle)', () => {
			overlay = makeOverlay();
			overlay.toggle();
			const panel = getShadow(overlay).querySelector('#panel')!;
			const fab = (overlay as any).fab as HTMLElement;
			const event = new MouseEvent('click', { bubbles: true, cancelable: true });
			Object.defineProperty(event, 'composedPath', {
				value: () => [fab, document.body, document.documentElement, document, window],
			});
			document.dispatchEvent(event);

			expect(panel.classList.contains('open')).toBe(true);
			overlay.destroy();
		});

		it('clicking outside does nothing when the panel is already closed', () => {
			overlay = makeOverlay();
			const panel = getShadow(overlay).querySelector('#panel')!;
			expect(panel.classList.contains('open')).toBe(false);

			document.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
			expect(panel.classList.contains('open')).toBe(false);
			overlay.destroy();
		});

		it('clicking outside during a drag does not close the panel', () => {
			overlay = makeOverlay();
			overlay.toggle();
			(overlay as any).dragging = true;
			const panel = getShadow(overlay).querySelector('#panel')!;
			document.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

			expect(panel.classList.contains('open')).toBe(true);
			overlay.destroy();
		});

		it('after destroy(), clicking outside no longer closes the panel', () => {
			overlay = makeOverlay();
			overlay.toggle();
			const panel = (overlay as any).panel as HTMLElement;
			overlay.destroy();
			document.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

			expect(panel.classList.contains('open')).toBe(true);
		});
	});
});
