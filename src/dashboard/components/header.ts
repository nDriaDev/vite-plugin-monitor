import { el, on, qs } from "../utils/dom";
import { navigateTo } from "../router";
import { clearAuth } from "./login";
import { LIVE_WINDOW_MS, PRESETS, presetToRange, store } from "../state";
import type { AppTab, TimePreset, TimeRange } from "@tracker/types";
// @ts-ignore
import logo from "../../resources/logo.png";

const STORAGE_KEY = '__tracker_theme__';

function getTheme(): 'dark' | 'light' {
	return (localStorage.getItem(STORAGE_KEY) as 'dark' | 'light') ?? 'dark';
}

function applyTheme(theme: 'dark' | 'light') {
	document.documentElement.setAttribute('data-theme', theme);
	localStorage.setItem(STORAGE_KEY, theme);
}

applyTheme(getTheme());

/**
* Top header bar
*
* @remarks
* Contains:
* - Logo + app name
* - Tab switcher (Metrics / Events)
* - Time range picker (presets + custom datetime-local inputs)
* - Backend status indicator
* - Logout button
*/
export function createHeader(): HTMLElement {
	const header = el('header', { class: 'app-header' });

	header.innerHTML = `
    <div class="header-left">
		<div class="header-logo">
			<img src="${logo}" alt="vite-plugin-monitor" class="header-logo-img" />
			<span>Dashboard</span>
		</div>

		<div class="status-dot" id="status-dot" title="Backend status"></div>

		<nav class="tab-nav">
			<button class="tab-btn" data-tab="metrics">Metrics</button>
			<button class="tab-btn" data-tab="events">Events</button>
		</nav>
    </div>

    <div class="header-right">
		<div class="time-range-picker">
			<div class="preset-btns">
				<button class="preset-btn preset-btn--live" data-preset="live">
					<span class="live-dot"></span>Live
				</button>
				${PRESETS.map(p => `<button class="preset-btn" data-preset="${p.value}">${p.label}</button>`).join('')}
				<button class="preset-btn" data-preset="custom">Custom</button>
			</div>
			<div class="custom-range" id="custom-range" hidden>
				<input type="datetime-local" id="range-from" />
				<span class="range-sep">-></span>
				<input type="datetime-local" id="range-to" />
				<button class="apply-btn" id="apply-range">Apply</button>
			</div>
		</div>
		<div class="btns">
		<button class="theme-toggle" id="theme-toggle" title="Toggle theme">
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" id="theme-icon-dark">
				<circle cx="12" cy="12" r="5"/>
				<line x1="12" y1="1" x2="12" y2="3"/>
				<line x1="12" y1="21" x2="12" y2="23"/>
				<line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
				<line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
				<line x1="1" y1="12" x2="3" y2="12"/>
				<line x1="21" y1="12" x2="23" y2="12"/>
				<line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
				<line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
			</svg>
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" id="theme-icon-light" style="display:none">
				<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
			</svg>
		</button>

		<button class="logout-btn" id="logout-btn" title="Logout">
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
				<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
				<polyline points="16 17 21 12 16 7"/>
				<line x1="21" y1="12" x2="9" y2="12"/>
			</svg>
		</button>
	</div>
`;

	const tabBtns = header.querySelectorAll<HTMLButtonElement>('.tab-btn');

	function syncTabs(active: AppTab) {
		tabBtns.forEach(btn => {
			btn.classList.toggle('active', btn.dataset.tab === active);
		});
	}

	tabBtns.forEach(btn => {
		on(btn, 'click', () => navigateTo(btn.dataset.tab as AppTab));
	});

	store.on('tab:change', syncTabs);
	syncTabs(store.get().tab);

	const presetBtns = header.querySelectorAll<HTMLButtonElement>('.preset-btn');
	const customRange = qs<HTMLElement>('#custom-range', header);
	const fromInput = qs<HTMLInputElement>('#range-from', header);
	const toInput = qs<HTMLInputElement>('#range-to', header);
	const applyBtn = qs<HTMLButtonElement>('#apply-range', header);

	function syncPresetBtns(range: TimeRange) {
		presetBtns.forEach(btn => {
			btn.classList.toggle('active', btn.dataset.preset === range.preset);
		});
		customRange.hidden = range.preset !== 'custom';
	}

	store.on('timeRange:change', (range) => {
		syncPresetBtns(range);
	});

	presetBtns.forEach(btn => {
		on(btn, 'click', () => {
			store.selectEvent(null);
			const preset = btn.dataset.preset as TimePreset | 'custom' | 'live';
			if (preset === 'live') {
				// INFO live mode: last 5 minutes
				const to = new Date();
				const from = new Date(to.getTime() - LIVE_WINDOW_MS);
				store.setTimeRange({
					preset: 'live',
					from: from.toISOString(),
					to: to.toISOString(),
				});
			} else if (preset === 'custom') {
				const cur = store.get().timeRange;
				fromInput.value = cur.from.slice(0, 16);
				toInput.value = cur.to.slice(0, 16);
				store.setTimeRange({ ...cur, preset: 'custom' });
			} else {
				store.setTimeRange({ preset, ...presetToRange(preset) });
			}
		});
	});

	on(applyBtn, 'click', () => {
		store.selectEvent(null);
		const from = fromInput.value;
		const to = toInput.value;
		if (!from || !to) {
			return;
		}
		store.setTimeRange({
			preset: 'custom',
			from: new Date(from).toISOString(),
			to: new Date(to).toISOString()
		});
	})

	store.on('timeRange:change', syncPresetBtns);
	syncPresetBtns(store.get().timeRange);

	const statusDot = qs<HTMLElement>('#status-dot', header);

	store.on('backend:status', (online) => {
		statusDot.classList.toggle('online', online);
		statusDot.classList.toggle('offline', !online);
		statusDot.title = online ? 'Backend online' : 'Backend unreachable';
	});

	on(qs<HTMLButtonElement>('#logout-btn', header), 'click', clearAuth);

	const toggleBtn = qs<HTMLButtonElement>('#theme-toggle', header);
	const iconDark = qs<SVGElement>('#theme-icon-dark', header);
	const iconLight = qs<SVGElement>('#theme-icon-light', header);

	function syncThemeIcon(theme: 'dark' | 'light') {
		iconDark.style.display = theme === 'light' ? 'block' : 'none';
		iconLight.style.display = theme === 'dark' ? 'block' : 'none';
		toggleBtn.title = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
	}

	syncThemeIcon(getTheme());

	on(toggleBtn, 'click', () => {
		const next = getTheme() === 'dark' ? 'light' : 'dark';
		applyTheme(next);
		syncThemeIcon(next);
	});

	return header;
}
