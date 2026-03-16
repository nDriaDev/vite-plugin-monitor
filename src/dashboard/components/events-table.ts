import { LogLevel, TrackerEvent, TrackerEventType } from "@tracker/types";
import { formatDuration, formatShortTime, truncate } from "../utils/format";
import { el, empty, on, qs, toggleVisible } from "../utils/dom";
import { store } from "../state";

const TYPE_ICONS: Record<TrackerEventType, string> = {
	click:       '🖱',
	http:        '🌐',
	error:       '💥',
	navigation:  '🧭',
	performance: '⚡',
	console:     '🖥',
	custom:      '✳️',
}

const LEVEL_CLASS: Record<LogLevel, string> = {
	debug: 'lvl-debug',
	info:  'lvl-info',
	warn:  'lvl-warn',
	error: 'lvl-error',
}

function getDetail(event: TrackerEvent): string {
	const p = event.payload as any;
	switch (event.type) {
		case 'click':
			return `${p.tag}${p.id ? '#' + p.id : ''} ${truncate(p.text ?? '', 30)}`;
		case 'http':
			return `${p.method} ${truncate(p.url, 50)} ${p.status ?? ''}`;
		case 'error':
			return truncate(p.message ?? '', 70);
		case 'navigation':
			return `${truncate(p.from ?? '', 25)} → ${truncate(p.to ?? '', 25)}`;
		case 'performance':
			return `${p.metric} ${p.value?.toFixed(1)}ms (${p.rating})`;
		case 'console': {
			const indent = '  '.repeat(Number(p.groupDepth ?? 0));
			return `${indent}[${p.method}] ${truncate(String(p.message ?? ''), 60)}`;
		}
		case 'custom':
			return `${p.name}${p.duration !== undefined ? ` — ${formatDuration(p.duration)}` : ''}`;
		default:
			return '';
	}
}

/**
 * Events tab: filterable table of raw events with cursor-based live polling.
 */
export function createEventsTable(): HTMLElement {
	const container = el('div', { class: 'events-tab' });

	container.innerHTML = `
    <div class="events-toolbar">
		<select class="filter-select" id="filter-type">
			<option value="">All types</option>
			${(['click', 'http', 'error', 'navigation', 'performance', 'console', 'custom'] as TrackerEventType[]).map(t => `<option value="${t}">${TYPE_ICONS[t]} ${t}</option>`).join('')}
		</select>

		<select class="filter-select" id="filter-level">
			<option value="">All levels</option>
			<option value="debug">debug</option>
			<option value="info">info</option>
			<option value="warn">warn</option>
			<option value="error">error</option>
		</select>

		<input class="filter-input" id="filter-userid" type="text" placeholder="User ID…" />
		<input class="filter-input" id="filter-search" type="text" placeholder="Search…" />

		<div class="events-count" id="events-count">0 events</div>
		<div class="events-loading" id="events-loading" hidden>
			<span class="spinner"></span>
		</div>
    </div>

    <div class="table-wrap">
		<table class="events-table">
			<thead>
				<tr>
					<th>Time</th>
					<th>Type</th>
					<th>Level</th>
					<th>User</th>
					<th>Detail</th>
				</tr>
			</thead>
			<tbody id="events-tbody"></tbody>
		</table>
		<div class="empty-events" id="empty-events" hidden>No events yet</div>
    </div>
`;

	const tbody = qs<HTMLTableSectionElement>('#events-tbody', container);
	const countEl = qs<HTMLElement>('#events-count', container);
	const loadingEl = qs<HTMLElement>('#events-loading', container);
	const emptyEl = qs<HTMLElement>('#empty-events', container);
	const typeSelect = qs<HTMLSelectElement>('#filter-type', container);
	const levelSelect = qs<HTMLSelectElement>('#filter-level', container);
	const userInput = qs<HTMLInputElement>('#filter-userid', container);
	const searchInput = qs<HTMLInputElement>('#filter-search', container);

	function emitFilter() {
		store.setEventsFilter({
			type: (typeSelect.value as TrackerEventType) || undefined,
			level: (levelSelect.value as LogLevel) || undefined,
			userId: userInput.value.trim() || undefined,
			search: searchInput.value.trim() || undefined,
		});
	}

	let filterDebounce: ReturnType<typeof setTimeout>;
	function debouncedFilter() {
		clearTimeout(filterDebounce);
		filterDebounce = setTimeout(emitFilter, 300);
	}

	on(typeSelect, 'change', emitFilter);
	on(levelSelect, 'change', emitFilter);
	on(userInput, 'input', debouncedFilter);
	on(searchInput, 'input', debouncedFilter);

	/**
	 * INFO
	 * Table rendering
	 * WeakMap: row element → event - allows O(1) selection highlight without
	 */
	const rowEventMap = new WeakMap<HTMLTableRowElement, TrackerEvent>();
	let selectedRow: HTMLTableRowElement | null = null;

	function buildRow(event: TrackerEvent): HTMLTableRowElement {
		const tr = el('tr', { class: `event-row ${LEVEL_CLASS[event.level]}` });

		tr.innerHTML = `
		<td class="col-time">${formatShortTime(event.timestamp)}</td>
		<td class="col-type"><span class="type-badge type-${event.type}">${TYPE_ICONS[event.type]} ${event.type}</span></td>
		<td class="col-level"><span class="level-badge ${LEVEL_CLASS[event.level]}">${event.level}</span></td>
		<td class="col-user">${truncate(event.userId, 16)}</td>
		<td class="col-detail">${getDetail(event)}</td>
    `;

		rowEventMap.set(tr, event);
		on(tr, 'click', () => store.selectEvent(event));
		return tr;
	}

	function renderAll(events: TrackerEvent[]) {
		empty(tbody);
		toggleVisible(emptyEl, events.length === 0);
		const frag = document.createDocumentFragment();
		for (const e of events) {
			frag.append(buildRow(e));
		}
		tbody.append(frag);
		countEl.textContent = `${events.length} events`;
	}

	function prependRows(newEvents: TrackerEvent[]) {
		const frag = document.createDocumentFragment();
		for (const e of newEvents) {
			frag.prepend(buildRow(e));
		}
		tbody.prepend(frag);
		while (tbody.rows.length > 500) {
			tbody.deleteRow(tbody.rows.length - 1);
		}
		countEl.textContent = `${tbody.rows.length} events`;
		toggleVisible(emptyEl, tbody.rows.length === 0);
	}

	store.on('events:update', renderAll);

	store.on('events:append', (newEvents) => {
		if (newEvents.length > 0) {
			prependRows(newEvents);
		}
	});

	store.on('events:loading', (loading) => {
		toggleVisible(loadingEl, loading);
	})

	store.on('events:select', (selected) => {
		if (selectedRow) {
			selectedRow.classList.remove('selected');
			selectedRow = null;
		}
		if (!selected) {
			return;
		}
		for (const row of Array.from(tbody.rows) as HTMLTableRowElement[]) {
			if (rowEventMap.get(row) === selected) {
				row.classList.add('selected');
				selectedRow = row;
				row.scrollIntoView({ block: 'nearest' });
				break;
			}
		}
	});

	return container;
}
