import { createChart } from './components/chart';
import { createHeader } from './components/header';
import { createHttpInfoCards, createHttpStatusCards, createKpiCards } from './components/kpi-cards';
import { checkStoredAuth, createLoginScreen } from './components/login';
import { initRouter } from './router';
import { effectiveTimeRange, store } from './state';
import './style.css';
import { el, hide, on, show, toggleVisible } from './utils/dom';
import { createEventsTable } from './components/events-table';
import { createEventDetail } from './components/event-detail';
import { createPoller } from './utils/poll';
import { fetchAllEvents, fetchPing } from './api';
import { computeMetrics, computeStats } from './aggregations';
import { FunnelComponent, TopErrorsComponent, TopPagesComponent } from '@tracker/types';
import { createFunnel, createTopEndpoints, createTopErrors, createTopPages } from './components/top-list';

/**
* Dashboard entry point.
*
* @remarks
* Responsibilities:
*  2. Check stored auth, show login or app
*  3. Assemble the component tree
*  4. Start the two polling loops (metrics + events)
*  5. Wire up the router
*/
function boot() {
	const root = document.getElementById('root')!;

	if (!checkStoredAuth()) {
		const loginScreen = createLoginScreen();
		root.append(loginScreen);
		store.on('auth:change', (authed) => {
			if (authed) {
				loginScreen.remove();
				mountApp(root);
			}
		});
		return;
	}

	mountApp(root);
}

function mountApp(root: HTMLElement) {
	initRouter();

	const header = createHeader();
	const main = el('main', { class: 'app-main' });
	const metricsTab = el('div', { class: 'tab-panel', id: 'tab-metrics' });
	const eventsTab = el('div', { class: 'tab-panel', id: 'tab-events', hidden: true });
	const errorBanner = el('div', { class: 'error-banner', hidden: true });

	root.append(header, errorBanner, main);

	// INFO Row 1: Active Sessions | Total Events | Unique Users | App Error Rate
	const kpiCards = createKpiCards({
		onTotalEventsClick: () => {
			store.setEventsFilter({});
			store.setTab('events');
		},
		onAppErrorRateClick: () => {
			store.setEventsFilter({ type: 'error', level: ["error"] });
			store.setTab('events');
		}
	});

	// INFO Row 2: Top Pages | Top App Errors | Navigation Funnel | Top Endpoints
	const topPages: TopPagesComponent = createTopPages((route) => {
		// INFO search on 'to' field of navigation payload, shown in search box
		store.setEventsFilter({ type: 'navigation', searchOperator: "ends-with", search: route });
		store.setTab('events');
	});
	const topErrors: TopErrorsComponent = createTopErrors((message) => {
		store.setEventsFilter({ type: 'error', searchOperator: "equals", search: message });
		store.setTab('events');
	});
	const funnel: FunnelComponent = createFunnel((from, to) => {
		// INFO filter navigation events whose 'to' field matches the destination
		store.setEventsFilter({ type: 'navigation', searchOperator: "equals", search: `${from} -> ${to}` });
		store.setTab('events');
	});
	const topEndpoints = createTopEndpoints((url) => {
		store.setEventsFilter({ type: 'http', searchOperator: "contains", search: url });
		store.setTab('events');
	});
	const listsRow = el('div', { class: 'bottom-row bottom-row--4col' });
	listsRow.append(topPages, topErrors, funnel, topEndpoints);

	// INFO Row 3: Most Called Endpoint | Avg HTTP | HTTP Error Rate | Slowest Endpoint
	const httpInfoCards = createHttpInfoCards({
		onMostCalledClick: (url) => {
			store.setEventsFilter({ type: 'http', searchOperator: "equals", search: url });
			store.setTab('events');
		},
		onHttpErrorRateClick: () => {
			store.setEventsFilter({ type: 'http', level: ['warn', 'error'] });
			store.setTab('events');
		},
		onSlowestClick: (url) => {
			store.setEventsFilter({ type: 'http', searchOperator: "equals", search: url });
			store.setTab('events');
		},
	});

	// INFO Row 4: Total Requests | 2xx | 4xx | 5xx (con rating)
	const httpStatusCards = createHttpStatusCards({
		onTotalClick: () => {
			store.setEventsFilter({ type: 'http' });
			store.setTab('events');
		},
		on2xxClick: () => {
			store.setEventsFilter({ type: 'http', level: ["info"] });
			store.setTab('events');
		},
		on4xxClick: () => {
			store.setEventsFilter({ type: 'http', level: ["warn"] });
			store.setTab('events');
		},
		on5xxClick: () => {
			store.setEventsFilter({ type: 'http', level: ["error"] });
			store.setTab('events');
		},
	});

	// INFO Row 5: graphs
	const volumeChart = createChart({
		color: '#3b82f6',
		label: 'events',
		onClick: () => {
			store.setEventsFilter({ type: undefined });
			store.setTab('events');
		}
	});
	const errorChart = createChart({
		color: '#ef4444',
		label: '%',
		onClick: () => {
			store.setEventsFilter({ level: ['error'] });
			store.setTab('events');
		}
	});

	const chartsRow = el('div', { class: 'charts-row' });

	const volumePanel = el('div', { class: 'panel chart-panel' });
	volumePanel.innerHTML = `
    <div class="panel-header">
		<span class="panel-title">Event Volume</span>
		<div class="chart-toggle">
			<button class="toggle-btn active" data-mode="line">Line</button>
			<button class="toggle-btn" data-mode="bar">Bar</button>
		</div>
    </div>
`;
	volumePanel.append(volumeChart.el);

	const errorPanel = el('div', { class: 'panel chart-panel' });
	errorPanel.innerHTML = `
    <div class="panel-header">
		<span class="panel-title">Total Error Rate %</span>
    </div>
`;
	errorPanel.append(errorChart.el);

	chartsRow.append(volumePanel, errorPanel);

	metricsTab.append(kpiCards, listsRow, httpInfoCards, httpStatusCards, chartsRow);

	volumePanel.querySelectorAll<HTMLButtonElement>('.toggle-btn').forEach(btn => {
		on(btn, 'click', () => {
			volumePanel.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
			btn.classList.add('active');
			store.setChartType(btn.dataset.mode as 'line' | 'bar');
		});
	});

	store.on('chartType:change', (mode) => {
		const s = store.get();
		if (s.metrics) {
			volumeChart.render(s.metrics.eventVolume, mode);
			errorChart.render(s.metrics.errorRateTimeline, mode);
		}
	});

	const eventsTable = createEventsTable();
	const eventDetail = createEventDetail();
	const eventsLayout = el('div', { class: 'events-layout' });
	eventsLayout.append(eventsTable, eventDetail);
	eventsTab.append(eventsLayout);

	main.append(metricsTab, eventsTab);

	store.on('events:select', (ev) => {
		eventsLayout.classList.toggle('has-detail', !!ev);
	});

	store.on('tab:change', (tab) => {
		toggleVisible(metricsTab, tab === 'metrics');
		toggleVisible(eventsTab, tab === 'events');
		main.scrollTop = 0;
	});
	const currentTab = store.get().tab;
	toggleVisible(metricsTab, currentTab === 'metrics');
	toggleVisible(eventsTab, currentTab === 'events');

	store.on('metrics:error', (err) => {
		if (err) {
			errorBanner.textContent = `Metrics error: ${err}`;
			show(errorBanner);
		} else {
			hide(errorBanner);
		}
	});

	const cfg = (window as any).__TRACKER_CONFIG__;
	const pollIntervalMs = cfg?.dashboard?.pollInterval ?? 3000;

	const metricsPoller = createPoller({
		intervalMs: pollIntervalMs,
		onError: (err) => store.setMetricsError(String(err)),
		onTick: async () => {
			store.setMetricsLoading(true);
			try {
				const events = await fetchAllEvents();
				const { from, to } = effectiveTimeRange(store.get().timeRange);
				const metrics = computeMetrics(events, from, to);
				const stats = computeStats(events, from, to);
				store.setMetrics(metrics, stats);

				const s = store.get();
				volumeChart.render(metrics.eventVolume, s.chartType);
				errorChart.render(metrics.errorRateTimeline, s.chartType);
				topPages.render(metrics.topPages);
				topErrors.render(metrics.topErrors);
				funnel.render(metrics.navigationFunnel);
				topEndpoints.render(metrics.topEndpoints);
			} catch (err) {
				store.setMetricsError(String(err));
			}
			return null;  // INFO metrics polling doesn't use a cursor
		}
	});

	const eventsPoller = createPoller({
		intervalMs: pollIntervalMs,
		onError: (err) => store.setEventsError(String(err)),
		onTick: async () => {
			store.setEventsLoading(true);
			try {
				const allEvents = await fetchAllEvents();
				/**
				* INFO In live mode, immediately filter to the actual range
				* before passing to the store, so applyFilter works
				* on the correct window
				*/
				const { from, to } = effectiveTimeRange(store.get().timeRange);
				const inRange = allEvents.filter(
					e => e.timestamp >= from && e.timestamp <= to
				);
				store.setEvents(inRange, inRange.length);
			} catch (err) {
				store.setEventsError(String(err));
			}
			return null;
		}
	});

	store.on('timeRange:change', (range) => {
		metricsPoller.resetCursor();
		eventsPoller.resetCursor();
		// INFO In live mode, the pollers automatically advance with each tick. For the other presets, we force an immediate refresh.
		if (range.preset !== 'live') {
			metricsPoller.refresh();
			eventsPoller.refresh();
		}
	});

	async function pingBackend() {
		const ok = await fetchPing();
		store.setBackendStatus(ok);
	}
	pingBackend();
	setInterval(pingBackend, 10_000);
}

document.addEventListener('DOMContentLoaded', boot);
