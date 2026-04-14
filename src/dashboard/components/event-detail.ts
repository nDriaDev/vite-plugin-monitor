import type { ConsolePayload, TrackerEvent } from "@tracker/types";
import { store } from "../state";
import { el, empty, escapeHtml, on, qs, setHtml, show } from "../utils/dom";
import { formatDateTime, formatDuration, formatJson } from "../utils/format";

/**
* Slide-in side panel showing the full detail of a selected event.
* Appears when the user clicks a row in the Events table.
*/
export function createEventDetail(): HTMLElement {
	const panel = el('div', { class: 'detail-panel' });

	panel.innerHTML = `
    <div class="detail-header">
		<div class="detail-title" id="detail-title">Event Detail</div>
		<button class="detail-close" id="detail-close" title="Close">×</button>
    </div>
    <div class="detail-body" id="detail-body"></div>
`;

	const body = qs<HTMLElement>('#detail-body', panel);
	const titleEl = qs<HTMLElement>('#detail-title', panel);
	const closeBtn = qs<HTMLButtonElement>('#detail-close', panel);

	on(closeBtn, 'click', () => store.selectEvent(null));

	store.on('events:select', (event) => {
		if (!event) {
			empty(body);
			titleEl.textContent = "Event Detail";
			return;
		}
		render(event);
		show(panel);
	});

	function section(title: string, content: HTMLElement | string): HTMLElement {
		const wrap = el('div', { class: 'detail-section' });
		const h = el('div', { class: 'detail-section-title' }, title);
		wrap.append(h);
		if (typeof content === 'string') {
			const pre = el('pre', { class: 'detail-pre' });
			setHtml(pre, content);
			wrap.append(pre);
		} else {
			wrap.append(content);
		}
		return wrap;
	}

	function metaRow(key: string, value: string): HTMLElement {
		const row = el('div', { class: 'meta-row' });
		row.innerHTML = `<span class="meta-key">${key}</span><span class="meta-val">${escapeHtml(value)}</span>`;
		return row;
	}

	function render(event: TrackerEvent) {
		titleEl.textContent = `${event.type} · ${event.level}`;
		empty(body);

		const meta = el('div', { class: 'detail-meta' });
		meta.append(
			metaRow('Timestamp', formatDateTime(event.timestamp)),
			metaRow('Type', event.type),
			metaRow('Level', event.level),
			metaRow('App', event.appId),
			metaRow('Session', event.sessionId),
			metaRow('User', event.userId)
		)
		if (event.groupId) {
			meta.append(metaRow('Group', event.groupId));
		}

		body.append(section('Identity', meta));

		const metaSec = el('div', { class: 'detail-meta' });
		metaSec.append(
			metaRow('Route', event.meta.route),
			metaRow('Viewport', event.meta.viewport),
			metaRow('Language', event.meta.language),
		);
		if (event.meta.userAgent) {
			metaSec.append(metaRow('UA', event.meta.userAgent));
		}
		if (event.meta.referrer) {
			metaSec.append(metaRow('Referrer', event.meta.referrer));
		}
		body.append(section('Context', metaSec));

		if (event.context && Object.keys(event.context).length > 0) {
			body.append(section('tracker.setContext()', formatJson(event.context)));
		}

		if (event.meta.userAttributes && Object.keys(event.meta.userAttributes).length > 0) {
			body.append(section('User Attributes', formatJson(event.meta.userAttributes)));
		}

		if (event.type === 'console') {
			const cp = event.payload as ConsolePayload;
			const argList = el('div', { class: 'console-args' });

			for (const arg of cp.args ?? []) {
				const argRow = el('div', { class: `console-arg console-arg-${arg.type}` });
				const typeTag = el('span', { class: 'arg-type' }, arg.type);
				const valuePre = el('pre', { class: 'arg-value' });
				valuePre.textContent = typeof arg.value === 'string'
					? arg.value
					: JSON.stringify(arg.value, null, 2) ?? 'undefined';
				argRow.append(typeTag, valuePre);
				argList.append(argRow);
			}

			body.append(section(`console.${cp.method}() - args`, argList));

			if (cp.stack) {
				body.append(section('Stack Trace', formatJson(cp.stack)));
			}
		}

		// INFO HTTP: show formatted duration and splitted stack before raw payload
		if (event.type === 'http') {
			const p = event.payload as any;
			const httpMeta = el('div', { class: 'detail-meta' });
			httpMeta.append(metaRow('Method', p.method ?? '-'));
			httpMeta.append(metaRow('URL', p.url ?? '-'));
			httpMeta.append(metaRow('Status', String(p.status ?? '-')));
			if (p.duration !== undefined) {
				httpMeta.append(metaRow('Duration', formatDuration(p.duration)));
			}
			if (p.error) {
				httpMeta.append(metaRow('Error', p.error));
			}
			body.append(section('HTTP Request', httpMeta));
		}

		body.append(section('Payload', formatJson(event.payload)));

		// INFO Session: show identity transition clearly
		if (event.type === 'session') {
			const p = event.payload as any;
			const sessionMeta = el('div', { class: 'detail-meta' });
			sessionMeta.append(metaRow('Action', p.action));
			sessionMeta.append(metaRow('Trigger', p.trigger));
			if (p.previousUserId) {
				sessionMeta.append(metaRow('Previous User', p.previousUserId));
			}
			if (p.newUserId) {
				sessionMeta.append(metaRow('New User', p.newUserId));
			}
			body.append(section('Session Boundary', sessionMeta));
		}

		// INFO Error: show splitted stack if present
		if (event.type === 'error') {
			const p = event.payload as any;
			if (p.stack) {
				const stackPre = el('pre', { class: 'detail-pre detail-stack' });
				stackPre.textContent = p.stack;
				body.append(section('Stack Trace', stackPre));
			}
		}
	}

	return panel;
}
