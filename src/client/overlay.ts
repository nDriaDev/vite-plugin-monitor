/* eslint-disable no-unused-vars */
/* eslint-disable no-undef */
import type { IDebugOverlay, TrackerEvent } from "@tracker/types";
import type { TrackerSession } from "./session";
import { STYLES } from "./styles/overlay.styles";
import { ICONS } from "./styles/icons";

const THEME_STORAGE_KEY = '__tracker_theme__';

//INFO Escape user-controlled strings before interpolating into innerHTML.
function esc(s: string): string {
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export class DebugOverlay implements IDebugOverlay {
	/** Host element appended to `document.body`. Contains the Shadow DOM root. */
	private host: HTMLElement;

	/** Closed Shadow DOM root - prevents external CSS from leaking in or out. */
	private shadow: ShadowRoot;

	/** The floating panel element. Toggled via the `.open` CSS class. */
	private panel!: HTMLElement;

	/** The circular FAB button that toggles the panel. */
	private fab!: HTMLElement;

	/** Whether the panel is currently being dragged by the user. */
	private dragging = false;

	/** Current theme: 'dark' (default) or 'light'. */
	private theme: 'dark' | 'light' = 'dark';

	/** Horizontal offset from the panel's left edge to the drag start point. */
	private dragOffsetX = 0;

	/** Vertical offset from the panel's top edge to the drag start point. */
	private dragOffsetY = 0;

	/**
	* Bound `mousemove` handler stored as an instance property so the same
	* reference can be passed to both `addEventListener` and `removeEventListener`.
	*/
	private onMouseMove: (e: MouseEvent) => void;

	/**
	* Bound `mouseup` handler. Ends a drag operation when the mouse button
	* is released anywhere in the document.
	*/
	private onMouseUp: () => void;

	/**
	* Bound `keydown` handler. Listens for `Alt+T` to toggle the panel.
	*/
	private onKeyDown: (e: KeyboardEvent) => void;

	/**
	* Bound `click` handler. Closes the panel when the user clicks outside
	* of both the panel and the FAB. Uses `composedPath()` because the panel
	* lives inside a closed Shadow DOM and `e.target` would only expose the host.
	*/
	private onClickOutside: (e: MouseEvent) => void;

	/**
	* Bound `DOMContentLoaded` handler used when `document.body` is not yet
	* available at construction time. Stored so `destroy()` can remove it even
	* if it never fired, preventing listener leaks across tests and hot-reloads.
	*/
	private onDOMContentLoaded: (() => void) | null = null;

	/**
	* @param session        - The active {@link TrackerSession}, used to read
	*                         userId, sessionId, and appId for display.
	* @param dashboardRoute - The URL pathname where the dashboard SPA is served
	*                         (e.g. `'/_tracker'`).
	* @param position       - Corner of the viewport where the FAB is anchored.
	* @param onUserIdChange - Callback invoked when the user edits their ID in the overlay.
	*/
	constructor(private session: TrackerSession, private dashboardRoute: string, private position: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left', private onUserIdChange: (newId: string | null) => void) {
		this.host = document.createElement('div');
		this.host.setAttribute('data-tracker-overlay', '');
		this.shadow = this.host.attachShadow({ mode: 'closed' });

		// INFO Bind handlers so the same reference can be passed to removeEventListener
		this.onMouseMove = (e: MouseEvent) => {
			if (!this.dragging) {
				return;
			}
			this.panel.style.left = `${e.clientX - this.dragOffsetX}px`;
			this.panel.style.top = `${e.clientY - this.dragOffsetY}px`;
			this.panel.style.bottom = 'auto';
			this.panel.style.right = 'auto';
		}
		this.onMouseUp = () => {
			this.dragging = false;
		}
		this.onKeyDown = (e: KeyboardEvent) => {
			if (e.altKey && e.key === 't') {
				this.toggle();
			}
		}
		this.onClickOutside = (e: MouseEvent) => {
			if (!this.panel.classList.contains('open') || this.dragging) {
				return;
			}
			/**
			 * INFO
			 * composedPath() pierces the closed Shadow DOM boundary and returns
			 * all nodes the event passed through - including those inside the shadow.
			 */
			const path = e.composedPath();
			if (!path.includes(this.panel) && !path.includes(this.fab) && !path.includes(this.host)) {
				this.close();
			}
		}

		// INFO Restore saved theme or uses dark as default
		const saved = localStorage.getItem(THEME_STORAGE_KEY);
		this.theme = saved === 'light' ? 'light' : 'dark';

		this.render();
		this.applyTheme();
		if (document.body) {
			document.body.appendChild(this.host);
		} else {
			// Store the reference so destroy() can remove it if DOMContentLoaded
			// never fires (e.g. the overlay is destroyed before the document loads).
			// The handler removes itself on first call — DOMContentLoaded is one-shot.
			this.onDOMContentLoaded = () => {
				document.body.appendChild(this.host);
				document.removeEventListener('DOMContentLoaded', this.onDOMContentLoaded!);
				this.onDOMContentLoaded = null;
			};
			document.addEventListener('DOMContentLoaded', this.onDOMContentLoaded);
		}
	}

	private applyTheme(): void {
		if (this.theme === 'light') {
			this.host.classList.add('light');
		} else {
			this.host.classList.remove('light');
		}
	}

	private buildUserIdRow(): string {
		const uid = esc(this.session.userId);
		return `
    <div class="row">
		<span class="row-key">User ID</span>
		<span class="row-val highlight" id="userid-display" title="${uid}">${uid}</span>
		<div class="row-actions">
			<button class="edit-btn" id="userid-edit" title="Change user ID">edit</button>
			<button class="copy-btn" data-val="${uid}" id="userid-copy">copy</button>
		</div>
    </div>
    <div class="row" id="userid-edit-row" style="display:none">
		<input
			id="userid-input"
			class="userid-input"
			type="text"
			placeholder="Enter user ID or leave empty to clear"
			value="${uid}"
		/>
		<div class="userid-actions">
			<button class="confirm-btn" id="userid-confirm">✓</button>
			<button class="cancel-btn"  id="userid-cancel">✕</button>
		</div>
    </div>
	`;
	}

	/**
	* INFO
	* Build the initial Shadow DOM tree: inject styles, create the FAB button
	* and the panel, then attach event listeners.
	*/
	private render() {
		const style = document.createElement('style');
		style.textContent = STYLES;
		this.shadow.appendChild(style);

		this.fab = document.createElement('div');
		this.fab.id = 'fab';
		this.fab.innerHTML = ICONS.TRACKER_ICON;
		this.fab.title = 'Vite plugin Monitor - Tracks info (Alt+T)';
		this.shadow.appendChild(this.fab);

		this.panel = document.createElement('div');
		this.panel.id = 'panel';
		this.panel.innerHTML = this.buildHTML();
		this.shadow.appendChild(this.panel);

		// INFO Apply configured corner position to both FAB and panel
		const isBottom = this.position.startsWith('bottom');
		const isRight = this.position.endsWith('right');
		const vEdge = isBottom ? 'bottom' : 'top';
		const hEdge = isRight ? 'right' : 'left';
		const vOpp = isBottom ? 'top' : 'bottom';
		const hOpp = isRight ? 'left' : 'right';

		// INFO FAB
		this.fab.style.setProperty(vEdge, '20px');
		this.fab.style.setProperty(hEdge, '20px');
		this.fab.style.removeProperty(vOpp);
		this.fab.style.removeProperty(hOpp);

		// INFO Panel: offset from the FAB (60px on the same axis)
		this.panel.style.setProperty(vEdge, isBottom ? '70px' : '70px');
		this.panel.style.setProperty(hEdge, '20px');
		this.panel.style.removeProperty(vOpp);
		this.panel.style.removeProperty(hOpp);

		this.bindEvents();
	}

	/**
	* Generate the static inner HTML of the panel.
	*
	* @remarks
	* Dynamic fields (route, viewport, connection) are rendered with a
	* `data-field` attribute so `refreshDynamicFields()` can update them
	* in-place without re-rendering the whole panel.
	*/
	private buildHTML(): string {
		const dashboardUrl = window.location.origin + this.dashboardRoute;
		const nav = navigator as Navigator & { connection?: { effectiveType?: string } };

		const identityRows: Array<{ key: string; val: string; copy: boolean }> = [
			{ key: 'Session ID', val: esc(this.session.sessionId), copy: true },
			{ key: 'App ID', val: esc(this.session.appId), copy: false },
		];

		const contextRows: Array<{ key: string; val: string }> = [
			{ key: 'Route', val: esc(window.location.pathname) },
			{ key: 'Viewport', val: esc(`${window.innerWidth}×${window.innerHeight}`) },
			{ key: 'Language', val: esc(navigator.language) },
			{ key: 'Connection', val: esc(nav.connection?.effectiveType ?? '-') },
		];

		return `
    <div id="header">
        <div id="header-title">
			${ICONS.TRACKER_ICON}<span>Vite plugin Monitor - Tracker Info</span>
        </div>
        <div id="header-actions">
			<button id="theme-toggle" title="Toggle theme">${this.theme === 'dark' ? '☀' : '☾'}</button>
			<button id="close" title="Close">×</button>
        </div>
    </div>

    <div id="body">

        <div>
			<div class="section-label">Identity</div>
			${this.buildUserIdRow()}
			${identityRows.map(r => `
				<div class="row">
					<span class="row-key">${r.key}</span>
					<span class="row-val highlight" title="${r.val}">${r.val}</span>
					<div class="row-actions">
						${r.copy ? `<button class="copy-btn" data-val="${r.val}">copy</button>` : ''}
					</div>
				</div>
			`).join('')}
		</div>
        <div class="divider"></div>

        <div>
			<div class="section-label">Context</div>
			${contextRows.map(r => `
				<div class="row">
					<span class="row-key">${r.key}</span>
					<span class="row-val" data-field="${r.key}" title="${r.val}">${r.val}</span>
					<div class="row-actions"></div>
				</div>
			`).join('')}
        </div>

        <div class="divider"></div>

        <a id="dashboard-link" href="${dashboardUrl}" target="_blank" rel="noopener">
			<div id="link-left">
				<span>Open Dashboard</span>
			</div>
			${ICONS.EXTERNAL_LINK_ICON}
        </a>

		<button id="destroy-btn">
            <span>Remove Tracker Info</span>
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
                <path d="M12 4L4 12M4 4l8 8"/>
            </svg>
        </button>

    </div>
    `
	}

	refreshUserId() {
		const display = this.shadow.querySelector<HTMLElement>('#userid-display');
		const copyBtn = this.shadow.querySelector<HTMLElement>('#userid-copy');
		const input = this.shadow.querySelector<HTMLInputElement>('#userid-input');
		if (display) {
			display.textContent = this.session.userId;
			display.title = this.session.userId;
		}
		if (copyBtn) {
			copyBtn.dataset.val = this.session.userId;
		}
		if (input) {
			input.value = this.session.userId;
		}
	}

	/**
	* INFO
	* Attach all interactive event listeners to the Shadow DOM elements and
	* to `document` for drag and keyboard shortcut support.
	*/
	private bindEvents() {
		// INFO action on userId: edit
		this.shadow.querySelector('#userid-edit')!.addEventListener('click', () => {
			const display = this.shadow.querySelector<HTMLElement>('#userid-display')!;
			const editRow = this.shadow.querySelector<HTMLElement>('#userid-edit-row')!;
			const input = this.shadow.querySelector<HTMLInputElement>('#userid-input')!;
			const editBtn = this.shadow.querySelector<HTMLElement>('#userid-edit')!;
			const copyBtn = this.shadow.querySelector<HTMLElement>('#userid-copy')!;
			(display.closest('.row')! as HTMLElement).style.display = 'none';
			editBtn.style.display = 'none';
			copyBtn.style.display = 'none';
			editRow.style.display = 'grid';
			input.focus();
			input.select();
		});

		// INFO action on userId: cancel
		const cancelEdit = () => {
			const display = this.shadow.querySelector<HTMLElement>('#userid-display')!;
			const editRow = this.shadow.querySelector<HTMLElement>('#userid-edit-row')!;
			const input = this.shadow.querySelector<HTMLInputElement>('#userid-input')!;
			const editBtn = this.shadow.querySelector<HTMLElement>('#userid-edit')!;
			const copyBtn = this.shadow.querySelector<HTMLElement>('#userid-copy')!;
			input.value = this.session.userId;
			display.closest('.row')!.removeAttribute('style');
			editRow.style.display = 'none';
			editBtn.removeAttribute('style');
			copyBtn.removeAttribute('style');
		}

		this.shadow.querySelector('#userid-cancel')!.addEventListener('click', cancelEdit);

		// INFO action on userId: confirm
		const confirmEdit = () => {
			const input = this.shadow.querySelector<HTMLInputElement>('#userid-input')!;
			const newId = input.value.trim() || null;
			this.onUserIdChange(newId);
			this.refreshUserId();
			cancelEdit();
		}

		this.shadow.querySelector('#userid-confirm')!.addEventListener('click', confirmEdit);

		// INFO action on userId: confirm and cancel with keyboard
		this.shadow.querySelector('#userid-input')!.addEventListener('keydown', (e) => {
			const ke = e as KeyboardEvent;
			if (ke.key === 'Enter') {
				confirmEdit();
			}
			if (ke.key === 'Escape') {
				cancelEdit();
			}
		});

		this.fab.addEventListener('click', () => this.toggle());

		this.shadow.querySelector('#close')!.addEventListener('click', () => this.close());

		this.shadow.querySelector('#theme-toggle')!.addEventListener('click', () => {
			this.theme = this.theme === 'dark' ? 'light' : 'dark';
			try { localStorage.setItem(THEME_STORAGE_KEY, this.theme); } catch { /* ignore */ }
			this.applyTheme();
			const btn = this.shadow.querySelector<HTMLButtonElement>('#theme-toggle');
			if (btn) {
				btn.textContent = this.theme === 'dark' ? '☀' : '☾';
			}
		});

		// INFO Copy buttons - delegated to the shadow root
		this.shadow.addEventListener('click', (e) => {
			const btn = (e.target as HTMLElement).closest('.copy-btn') as HTMLElement | null;
			if (!btn) {
				return;
			}
			// eslint-disable-next-line @typescript-eslint/no-floating-promises
			navigator.clipboard?.writeText(btn.dataset.val ?? '').then(() => {
				btn.textContent = 'copied';
				btn.classList.add('copied');
				setTimeout(() => {
					btn.textContent = 'copy';
					btn.classList.remove('copied');
				}, 1500);
			});
		})

		// INFO Drag - initiated from the header, tracked on document
		const header = this.shadow.querySelector('#header') as HTMLElement;
		header.addEventListener('mousedown', (e) => {
			if (!this.panel.classList.contains('open')) {
				return;
			}
			this.dragging = true;
			const rect = this.panel.getBoundingClientRect();
			this.dragOffsetX = e.clientX - rect.left;
			this.dragOffsetY = e.clientY - rect.top;
			e.preventDefault();
		});

		document.addEventListener('mousemove', this.onMouseMove);
		document.addEventListener('mouseup', this.onMouseUp);
		document.addEventListener('keydown', this.onKeyDown);
		// INFO true = capture phase so the click is caught before any stopPropagation in the page
		document.addEventListener('click', this.onClickOutside, true);

		this.shadow.querySelector('#destroy-btn')!.addEventListener('click', () => this.destroy(), { once: true });
	}

	/**
	* Update the dynamic context fields (Route, Viewport, Connection) in the
	* already-rendered panel without re-building the full HTML.
	*
	* @remarks
	* Called every time the panel opens to reflect the current browser state,
	* since the user may have navigated or resized the window since the last open.
	*/
	private refreshDynamicFields() {
		const nav = navigator as Navigator & { connection?: { effectiveType?: string } };
		const updates: Record<string, string> = {
			Route: esc(window.location.pathname),
			Viewport: esc(`${window.innerWidth} x ${window.innerHeight}`),
			Connection: esc(nav.connection?.effectiveType ?? '-')
		};
		for (const [field, val] of Object.entries(updates)) {
			const el = this.shadow.querySelector<HTMLElement>(`[data-field="${field}"]`);
			if (el) {
				el.textContent = val;
				el.title = val;
			}
		}
	}

	/** @inheritdoc */
	pushEvent(_event: TrackerEvent): void {
		// INFO Reserved for future live event list rendering in the overlay panel. Called by TrackerClient after every emitted event.
	}

	/** @inheritdoc */
	toggle() {
		const opening = !this.panel.classList.contains('open');
		this.panel.classList.toggle('open');
		if (opening) {
			this.refreshDynamicFields();
		}
	}

	/** @inheritdoc */
	close() {
		this.panel.classList.remove('open');
	}

	/** @inheritdoc */
	destroy() {
		/* v8 ignore start */
		if (this.onDOMContentLoaded) {
			document.removeEventListener('DOMContentLoaded', this.onDOMContentLoaded);
			this.onDOMContentLoaded = null;
		}
		/* v8 ignore stop */
		document.removeEventListener('mousemove', this.onMouseMove);
		document.removeEventListener('mouseup', this.onMouseUp);
		document.removeEventListener('keydown', this.onKeyDown);
		document.removeEventListener('click', this.onClickOutside, true);
		this.host.remove();
	}
}
