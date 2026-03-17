import { IDebugOverlay, TrackerEvent } from "@tracker/types";
import { TrackerSession } from "./session";
import { STYLES } from "./styles/overlay.styles";
import { ICONS } from "./styles/icons";

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
	* @param session        - The active {@link TrackerSession}, used to read
	*                         userId, sessionId, and appId for display.
	* @param dashboardRoute - The URL pathname where the dashboard SPA is served
	*                         (e.g. `'/_tracker'`).
	*/
	constructor(private session: TrackerSession, private dashboardRoute: string, private onUserIdChange: (newId: string | null) => void) {
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

		this.render();
		document.body.appendChild(this.host);
	}

	private buildUserIdRow(): string {
		return `
    <div class="row">
		<span class="row-key">User ID</span>
		<div class="row-right">
			<span class="row-val highlight" id="userid-display" title="${this.session.userId}">${this.session.userId}</span>
			<button class="copy-btn" data-val="${this.session.userId}" id="userid-copy">copy</button>
			<button class="edit-btn" id="userid-edit" title="Change user ID">edit</button>
		</div>
    </div>
    <div class="row" id="userid-edit-row" style="display:none">
		<input
			id="userid-input"
			class="userid-input"
			type="text"
			placeholder="Enter user ID or leave empty to clear"
			value="${this.session.userId}"
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
			{ key: 'Session ID', val: this.session.sessionId, copy: true },
			{ key: 'App ID', val: this.session.appId, copy: false },
		];

		const contextRows: Array<{ key: string; val: string }> = [
			{ key: 'Route', val: window.location.pathname },
			{ key: 'Viewport', val: `${window.innerWidth}×${window.innerHeight}` },
			{ key: 'Language', val: navigator.language },
			{ key: 'Connection', val: nav.connection?.effectiveType ?? '-' },
		];

		return `
    <div id="header">
        <div id="header-title">
			${ICONS.TRACKER_ICON}<span>Tracker</span>
        </div>
        <button id="close" title="Close">×</button>
    </div>

    <div id="body">

        <div>
			<div class="section-label">Identity</div>
			${this.buildUserIdRow()}
			${identityRows.map(r => `
				<div class="row">
					<span class="row-key">${r.key}</span>
					<div class="row-right">
						<span class="row-val highlight" title="${r.val}">${r.val}</span>
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
				<div class="row-right">
					<span class="row-val" data-field="${r.key}" title="${r.val}">${r.val}</span>
				</div>
				</div>
			`).join('')}
        </div>

        <div class="divider"></div>

        <a id="dashboard-link" href="${dashboardUrl}" target="_blank" rel="noopener">
			<div id="link-left">
				${ICONS.TRACKER_ICON}
				<span>Open Dashboard</span>
			</div>
			${ICONS.EXTERNAL_LINK_ICON}
        </a>

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
			editRow.style.display = 'flex';
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

		// INFO Copy buttons - delegated to the shadow root
		this.shadow.addEventListener('click', (e) => {
			const btn = (e.target as HTMLElement).closest('.copy-btn') as HTMLElement | null;
			if (!btn) {
				return;
			}
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
			Route: window.location.pathname,
			Viewport: `${window.innerWidth}×${window.innerHeight}`,
			Connection: nav.connection?.effectiveType ?? '-',
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
		document.removeEventListener('mousemove', this.onMouseMove);
		document.removeEventListener('mouseup', this.onMouseUp);
		document.removeEventListener('keydown', this.onKeyDown);
		this.host.remove();
	}
}
