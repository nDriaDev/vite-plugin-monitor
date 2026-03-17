import { LogLevel, SearchOperator, TrackerEvent, TrackerEventType } from "@tracker/types";
import { formatDateTime, formatDuration, truncate } from "../utils/format";
import { el, empty, on, qs, toggleVisible } from "../utils/dom";
import { store } from "../state";

const TYPE_ICONS: Record<TrackerEventType, string> = {
	click:       '🖱',
	http:        '🌐',
	error:       '💥',
	navigation:  '🧭',
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
			return `${truncate(p.from ?? '', 25)} -> ${truncate(p.to ?? '', 25)}`;
		case 'console': {
			const indent = '  '.repeat(Number(p.groupDepth ?? 0));
			return `${indent}[${p.method}] ${truncate(String(p.message ?? ''), 60)}`;
		}
		case 'custom':
			return `${p.name}${p.duration !== undefined ? ` - ${formatDuration(p.duration)}` : ''}`;
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
			${(['click', 'http', 'error', 'navigation', 'console', 'custom'] as TrackerEventType[]).map(t => `<option value="${t}">${TYPE_ICONS[t]} ${t}</option>`).join('')}
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
			<input class="filter-input filter-input--search" id="filter-search" type="text" placeholder="Search payload…" />
		</div>

		<button class="filter-reset-btn" id="filter-reset" title="Reset filters">✕ Reset</button>
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
	const levelGroup = qs<HTMLElement>('#filter-level', container);
	const levelButtons = Array.from(
		levelGroup.querySelectorAll<HTMLButtonElement>('.level-toggle')
	);

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
		store.resetSelectEvent();
		store.setEventsFilter({});
	});

	function emitFilter() {
		store.resetSelectEvent();
		const selectedLevels = getSelectedLevels();
		store.setEventsFilter({
			type: (typeSelect.value as TrackerEventType) || undefined,
			level: selectedLevels.length > 0 ? selectedLevels : undefined,
			userId: userSelect.value || undefined,
			search: searchInput.value.trim() || undefined,
			searchOperator: (searchOpSelect.value as import('@tracker/types').SearchOperator) || 'contains'
		});
	}

	let filterDebounce: ReturnType<typeof setTimeout>;
	function debouncedFilter() {
		clearTimeout(filterDebounce);
		filterDebounce = setTimeout(emitFilter, 300);
	}

	on(typeSelect, 'change', emitFilter);
	on(typeSelect, 'change', emitFilter);
	on(searchOpSelect, 'change', emitFilter);
	on(searchOpSelect, 'change', emitFilter);
	on(userSelect, 'change', emitFilter);
	on(searchInput, 'input', debouncedFilter);

	/**
	 * INFO
	 * Table rendering
	 * WeakMap: row element -> event - allows O(1) selection highlight without
	 */
	const rowEventMap = new WeakMap<HTMLTableRowElement, TrackerEvent>();
	let selectedRow: HTMLTableRowElement | null = null;

	function buildRow(event: TrackerEvent): HTMLTableRowElement {
		const tr = el('tr', { class: `event-row ${LEVEL_CLASS[event.level]}` });

		tr.innerHTML = `
		<td class="col-time">${formatDateTime(event.timestamp)}</td>
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
