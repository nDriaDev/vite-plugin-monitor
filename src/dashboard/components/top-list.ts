import { ErrorItem, FunnelStep, RankedItem } from "../aggregations";
import { el, empty } from "../utils/dom";
import { formatCount, formatRelative, truncate } from "../utils/format";

/**
* Public interface of the Top Pages panel component.
*
* @remarks
* Extends `HTMLElement` directly so instances can be appended to the DOM without
* an extra wrapper. Manages its own internal DOM tree, updated in-place on `render()`.
*
*/
export interface TopPagesComponent extends HTMLElement {
	/**
	* Re-render the list with fresh top-pages data.
	*
	* @remarks
	* Replaces all items on each call. An empty array renders an empty-state placeholder.
	*
	* @param items - Ranked list from {@link MetricsResult.topPages}.
	*/
	render(items: RankedItem[]): void
}

/**
* Public interface of the Top Errors panel component.
*
*/
export interface TopErrorsComponent extends HTMLElement {
	/**
	* Re-render the list with fresh top-errors data.
	*
	* @param items - Error list from {@link MetricsResult.topErrors}.
	*/
	render(items: ErrorItem[]): void
}

/**
* Public interface of the Navigation Funnel panel component.
*
* @remarks
* Renders a visual funnel of the most common navigation transitions.
*
*/
export interface FunnelComponent extends HTMLElement {
	/**
	* Re-render the funnel with fresh navigation step data.
	*
	* @param steps - Step list from {@link MetricsResult.navigationFunnel}.
	*/
	render(steps: FunnelStep[]): void
}

/**
* Generic ranked list component with proportional bars.
* Used for: Top Pages, Top Errors, Navigation Funnel.
*/
export function createTopPages(): TopPagesComponent {
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
			const row = el('div', { class: 'top-row' });
			const pct = Math.round((item.count / max) * 100);
			row.innerHTML = `
        <div class="top-label" title="${item.label}">${truncate(item.label, 40)}</div>
        <div class="top-bar-wrap">
			<div class="top-bar" style="width:${pct}%"></div>
        </div>
        <div class="top-count">${formatCount(item.count)}</div>
		`
			list.append(row);
		}
	}

	return Object.assign(section, { render }) as TopPagesComponent;
}

export function createTopErrors(): TopErrorsComponent {
	const section = el('div', { class: 'panel' });
	section.innerHTML = `<div class="panel-title">Top Errors</div><div class="error-list" id="error-list"></div>`;
	const list = section.querySelector<HTMLElement>('#error-list')!;

	function render(items: ErrorItem[]) {
		empty(list);
		if (!items.length) {
			list.append(el('div', { class: 'empty-msg' }, 'No errors'));
			return;
		}
		for (const item of items) {
			const row = el('div', { class: 'error-row' });
			row.innerHTML = `
        <div class="error-msg" title="${item.message}">${truncate(item.message, 80)}</div>
        <div class="error-meta">
			<span class="error-count">×${formatCount(item.count)}</span>
			<span class="error-time">${formatRelative(item.lastSeen)}</span>
        </div>
		`
			list.append(row);
		}
	}

	return Object.assign(section, { render }) as TopErrorsComponent;
}

export function createFunnel(): FunnelComponent {
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
			const row = el('div', { class: 'funnel-row' });
			const pct = Math.round((step.count / max) * 100);
			const from = truncate(step.from || '(direct)', 20);
			const to = truncate(step.to || '?', 20);
			row.innerHTML = `
        <div class="funnel-route">
			<span class="funnel-from" title="${step.from}">${from}</span>
			<span class="funnel-arrow">→</span>
			<span class="funnel-to"   title="${step.to}">${to}</span>
        </div>
        <div class="top-bar-wrap">
			<div class="top-bar funnel-bar" style="width:${pct}%"></div>
        </div>
        <div class="top-count">${formatCount(step.count)}</div>
		`
			list.append(row);
		}
	}

	return Object.assign(section, { render }) as FunnelComponent;
}
