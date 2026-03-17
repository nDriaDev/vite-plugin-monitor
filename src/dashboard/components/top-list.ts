import { ErrorItem, FunnelComponent, FunnelStep, RankedItem, TopErrorsComponent, TopPagesComponent } from "@tracker/types";
import { el, empty } from "../utils/dom";
import { formatCount, formatRelative, truncate } from "../utils/format";

/**
* Generic ranked list component with proportional bars.
* Used for: Top Pages, Top App Errors, Navigation Funnel.
*/
export function createTopPages(onSelect?: (route: string) => void): TopPagesComponent {
	const section = el('div', { class: 'panel' });
	section.innerHTML = `<div class="panel-title">Top Pages</div><div class="top-list" id="top-pages-list"></div>`;
	const list = section.querySelector<HTMLElement>('#top-pages-list')!;

	function render(items: RankedItem[]) {
		empty(list);
		if (!items.length) {
			list.append(el('div', { class: 'empty-msg' }, 'No data'));
			return;
		}
		const max = items[0].count;
		for (const item of items) {
			const row = el('div', { class: `top-row${onSelect ? ' clickable' : ''}` });
			const pct = Math.round((item.count / max) * 100);
			row.innerHTML = `
        <div class="top-label" title="${item.label}">${truncate(item.label, 40)}</div>
        <div class="top-bar-wrap">
			<div class="top-bar" style="width:${pct}%"></div>
        </div>
        <div class="top-count">${formatCount(item.count)}</div>
		`;
			onSelect && row.addEventListener("click", () => onSelect(item.label));
			list.append(row);
		}
	}

	return Object.assign(section, { render }) as TopPagesComponent;
}

export function createTopErrors(onSelect?: (message: string) => void): TopErrorsComponent {
	const section = el('div', { class: 'panel' });
	section.innerHTML = `<div class="panel-title">Top App Errors</div><div class="error-list" id="error-list"></div>`;
	const list = section.querySelector<HTMLElement>('#error-list')!;

	function render(items: ErrorItem[]) {
		empty(list);
		if (!items.length) {
			list.append(el('div', { class: 'empty-msg' }, 'No errors'));
			return;
		}
		for (const item of items) {
			const row = el('div', { class: `error-row${onSelect ? ' clickable' : ''}` });
			row.innerHTML = `
        <div class="error-msg" title="${item.message}">${truncate(item.message, 80)}</div>
        <div class="error-meta">
			<span class="error-count">×${formatCount(item.count)}</span>
			<span class="error-time">${formatRelative(item.lastSeen)}</span>
        </div>
		`;
			onSelect && row.addEventListener("click", () => onSelect(item.message));
			list.append(row);
		}
	}

	return Object.assign(section, { render }) as TopErrorsComponent;
}

export function createFunnel(onSelect?: (from: string, to: string) => void): FunnelComponent {
	const section = el('div', { class: 'panel' });
	section.innerHTML = `<div class="panel-title">Navigation Funnel</div><div class="funnel-list" id="funnel-list"></div>`;
	const list = section.querySelector<HTMLElement>('#funnel-list')!;

	function render(steps: FunnelStep[]) {
		empty(list);
		if (!steps.length) {
			list.append(el('div', { class: 'empty-msg' }, 'No navigation data'));
			return;
		}
		const max = steps[0].count;
		for (const step of steps) {
			const row = el('div', { class: `funnel-row${onSelect ? ' clickable' : ''}` });
			const pct = Math.round((step.count / max) * 100);
			const from = truncate(step.from || '(direct)', 20);
			const to = truncate(step.to || '?', 20);
			row.innerHTML = `
        <div class="funnel-route">
			<span class="funnel-from" title="${step.from}">${from}</span>
			<span class="funnel-arrow">-></span>
			<span class="funnel-to"   title="${step.to}">${to}</span>
        </div>
        <div class="top-bar-wrap">
			<div class="top-bar funnel-bar" style="width:${pct}%"></div>
        </div>
        <div class="top-count">${formatCount(step.count)}</div>
		`;
			onSelect && row.addEventListener("click", () => onSelect(step.from, step.to));
			list.append(row);
		}
	}

	return Object.assign(section, { render }) as FunnelComponent;
}

/**
 * Top Endpoints list - HTTP endpoints ranked by call count.
 */
export function createTopEndpoints(onSelect?: (url: string) => void): HTMLElement & { render(items: RankedItem[]): void } {
	const section = el('div', { class: 'panel' });
	section.innerHTML = `<div class="panel-title">Top Endpoints</div><div class="top-list" id="top-endpoints-list"></div>`;
	const list = section.querySelector<HTMLElement>('#top-endpoints-list')!;

	function render(items: RankedItem[]) {
		empty(list);
		if (!items.length) {
			list.append(el('div', { class: 'empty-msg' }, 'No HTTP data'));
			return;
		}
		const max = items[0].count;
		for (const item of items) {
			const row = el('div', { class: `top-row${onSelect ? ' clickable' : ''}` });
			const pct = Math.round((item.count / max) * 100);
			row.innerHTML = `
        <div class="top-label top-label--mono" title="${item.label}">${truncate(item.label, 45)}</div>
        <div class="top-bar-wrap">
			<div class="top-bar top-bar--endpoint" style="width:${pct}%"></div>
        </div>
        <div class="top-count">${formatCount(item.count)}</div>
		`;
			onSelect && row.addEventListener('click', () => onSelect(item.label));
			list.append(row);
		}
	}

	return Object.assign(section, { render });
}
