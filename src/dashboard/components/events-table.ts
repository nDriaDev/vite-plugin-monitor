import { LogLevel, SearchOperator, TrackerEvent, TrackerEventType } from "@tracker/types";
import { formatDateTime, formatDuration, getEventDetail, truncate } from "../utils/format";
import { el, empty, escapeHtml, on, qs, toggleVisible } from "../utils/dom";
import { store } from "../state";

const TYPE_ICONS: Record<TrackerEventType, string> = {
	click: '🖱',
	http: '🌐',
	error: '💥',
	navigation: '🧭',
	console: '🖥',
	custom: '✳️',
	session: '🔄',
}

const LEVEL_CLASS: Record<LogLevel, string> = {
	debug: 'lvl-debug',
	info: 'lvl-info',
	warn: 'lvl-warn',
	error: 'lvl-error',
}

const LEVEL_ORDER: Record<LogLevel, number> = {
	debug: 0, info: 1, warn: 2, error: 3,
}

type SortKey = 'timestamp' | 'type' | 'level' | 'userId'
type SortDir = 'asc' | 'desc'

const DEFAULT_SORT_KEY: SortKey = 'timestamp';
const DEFAULT_SORT_DIR: SortDir = 'asc';

/**
 * Events tab: filterable, sortable table of raw events.
 *
 * @remarks
 * Sort is local to this component (not persisted in the store).
 * Default order is timestamp ascending: oldest events at the top: so the
 * user reads the sequence top-to-bottom as it happened in time.
 * Clicking a column header sorts by that column ascending; clicking again
 * toggles to descending. The Reset button restores the default sort.
 */
export function createEventsTable(): HTMLElement {
	const container = el('div', { class: 'events-tab' });

	container.innerHTML = `
    <div class="events-toolbar">
		<select class="filter-select" id="filter-type">
			<option value="">All types</option>
			${(['click', 'http', 'error', 'navigation', 'console', 'custom', 'session'] as TrackerEventType[]).map(t => `<option value="${t}">${TYPE_ICONS[t]} ${t}</option>`).join('')}
		</select>

		<div class="level-toggle-group" id="filter-level">
			<button class="level-toggle lvl-debug" data-level="debug">debug</button>
			<button class="level-toggle lvl-info"  data-level="info">info</button>
			<button class="level-toggle lvl-warn"  data-level="warn">warn</button>
			<button class="level-toggle lvl-error" data-level="error">error</button>
		</div>

		<select class="filter-select filter-select--user" id="filter-userid">
			<option value="">All users</option>
		</select>
		<div class="search-filter-wrap">
			<select class="filter-select filter-select--operator" id="filter-search-op">
				<option value="contains">contains</option>
				<option value="not-contains">not contains</option>
				<option value="equals">equals</option>
				<option value="starts-with">starts with</option>
				<option value="ends-with">ends with</option>
				<option value="regex">regex</option>
			</select>
			<input class="filter-input filter-input--search" id="filter-search" type="text" placeholder="Search payload" />
		</div>

		<button class="filter-reset-btn" id="filter-reset" title="Reset filters and sort">✕ Reset</button>
		<div class="events-count" id="events-count">0 events</div>
		<div class="events-loading" id="events-loading" hidden>
			<span class="spinner"></span>
		</div>
    </div>

    <div class="table-wrap">
		<table class="events-table">
			<thead>
				<tr>
					<th class="col-th sortable" data-sort="timestamp">Time <span class="sort-indicator">▲</span></th>
					<th class="col-th sortable" data-sort="type">Type <span class="sort-indicator"></span></th>
					<th class="col-th sortable" data-sort="level">Level <span class="sort-indicator"></span></th>
					<th class="col-th sortable" data-sort="userId">User <span class="sort-indicator"></span></th>
					<th class="col-th">Detail</th>
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
	const levelGroup = qs<HTMLElement>('#filter-level', container);
	const levelButtons = Array.from(
		levelGroup.querySelectorAll<HTMLButtonElement>('.level-toggle')
	);

	// INFO Sort
	let sortKey: SortKey = DEFAULT_SORT_KEY;
	let sortDir: SortDir = DEFAULT_SORT_DIR;
	let lastEvents: TrackerEvent[] = [];

	const sortHeaders = Array.from(container.querySelectorAll<HTMLElement>('th[data-sort]'));

	function syncSortHeaders() {
		for (const th of sortHeaders) {
			const key = th.dataset.sort as SortKey;
			const indicator = th.querySelector<HTMLElement>('.sort-indicator')!;
			th.classList.toggle('sort-active', key === sortKey);
			indicator.textContent = key === sortKey ? (sortDir === 'asc' ? '▲' : '▼') : '';
		}
	}

	function sortEvents(events: TrackerEvent[]): TrackerEvent[] {
		return [...events].sort((a, b) => {
			let cmp = 0;
			switch (sortKey) {
				case 'timestamp':
					cmp = a.timestamp.localeCompare(b.timestamp);
					break;
				case 'type':
					cmp = a.type.localeCompare(b.type);
					break;
				case 'level':
					cmp = LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level];
					break;
				case 'userId':
					cmp = a.userId.localeCompare(b.userId);
					break;
			}
			return sortDir === 'asc' ? cmp : -cmp;
		});
	}

	for (const th of sortHeaders) {
		on(th, 'click', () => {
			const key = th.dataset.sort as SortKey;
			if (key === sortKey) {
				sortDir = sortDir === 'asc' ? 'desc' : 'asc';
			} else {
				sortKey = key;
				sortDir = 'asc';
			}
			syncSortHeaders();
			renderAll(lastEvents);
		});
	}

	syncSortHeaders();

	// INFO Filter
	function getSelectedLevels(): LogLevel[] {
		return levelButtons
			.filter(b => b.classList.contains('active'))
			.map(b => b.dataset.level as LogLevel);
	}

	levelButtons.forEach(btn => {
		on(btn, 'click', () => {
			store.resetSelectEvent();
			btn.classList.toggle('active');
			emitFilter();
		});
	});

	const userSelect = qs<HTMLSelectElement>('#filter-userid', container);
	const searchInput = qs<HTMLInputElement>('#filter-search', container);
	const searchOpSelect = qs<HTMLSelectElement>('#filter-search-op', container);
	const resetBtn = qs<HTMLButtonElement>('#filter-reset', container);

	on(resetBtn, 'click', () => {
		// INFO Reset filter in store
		store.resetSelectEvent();
		store.setEventsFilter({});
		// INFO Reset sort to default
		sortKey = DEFAULT_SORT_KEY;
		sortDir = DEFAULT_SORT_DIR;
		syncSortHeaders();
		renderAll(lastEvents);
	});

	function emitFilter() {
		store.resetSelectEvent();
		const selectedLevels = getSelectedLevels();
		store.setEventsFilter({
			type: (typeSelect.value as TrackerEventType) || undefined,
			level: selectedLevels.length > 0 ? selectedLevels : undefined,
			userId: userSelect.value || undefined,
			search: searchInput.value.trim() || undefined,
			searchOperator: (searchOpSelect.value as SearchOperator) || 'contains'
		});
	}

	let filterDebounce: ReturnType<typeof setTimeout>;
	function debouncedFilter() {
		clearTimeout(filterDebounce);
		filterDebounce = setTimeout(emitFilter, 300);
	}

	on(typeSelect, 'change', emitFilter);
	on(searchOpSelect, 'change', emitFilter);
	on(userSelect, 'change', emitFilter);
	on(searchInput, 'input', debouncedFilter);

	// INFO Rendering
	const rowEventMap = new WeakMap<HTMLTableRowElement, TrackerEvent>();
	let selectedRow: HTMLTableRowElement | null = null;

	function buildRow(event: TrackerEvent): HTMLTableRowElement {
		const tr = el('tr', { class: `event-row ${LEVEL_CLASS[event.level]}` });
		const value = getEventDetail(event, false);
		const valueTruncated = getEventDetail(event, true);

		tr.innerHTML = `
		<td class="col-time">${formatDateTime(event.timestamp)}</td>
		<td class="col-type"><span class="type-badge type-${event.type}">${TYPE_ICONS[event.type]} ${event.type}</span></td>
		<td class="col-level"><span class="level-badge ${LEVEL_CLASS[event.level]}">${event.level}</span></td>
		<td class="col-user" title="${escapeHtml(event.userId)}">${escapeHtml(truncate(event.userId, 16))}</td>
		<td class="col-detail" title="${escapeHtml(value)}">${escapeHtml(valueTruncated)}</td>
    `;

		rowEventMap.set(tr, event);
		on(tr, 'click', () => store.selectEvent(event));
		return tr;
	}

	function renderAll(events: TrackerEvent[]) {
		lastEvents = events;
		const sorted = sortEvents(events);
		empty(tbody);
		toggleVisible(emptyEl, sorted.length === 0);
		const frag = document.createDocumentFragment();
		for (const e of sorted) {
			frag.append(buildRow(e));
		}
		tbody.append(frag);
		countEl.textContent = `${sorted.length} events`;
	}

	function populateUsers() {
		const current = userSelect.value;
		const users = store.getUniqueUserIds();
		userSelect.innerHTML = '<option value="">All users</option>';
		for (const uid of users) {
			const opt = document.createElement('option');
			opt.value = uid;
			opt.textContent = uid;
			if (uid === current) opt.selected = true;
			userSelect.appendChild(opt);
		}
	}

	store.on('events:update', (events) => {
		populateUsers();
		renderAll(events);
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

	store.on('events:filter', (filter) => {
		typeSelect.value = filter.type ?? '';
		const activeLevels = filter.level ?? [];
		levelButtons.forEach(btn => {
			btn.classList.toggle('active', activeLevels.includes(btn.dataset.level as LogLevel));
		});
		userSelect.value = filter.userId ?? '';
		searchInput.value = filter.search ?? '';
		searchOpSelect.value = filter.searchOperator ?? 'contains';
	});

	return container;
}
