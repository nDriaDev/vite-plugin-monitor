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
import type { ChartBucket, FunnelComponent, TopErrorsComponent, TopPagesComponent } from '@tracker/types';
import { createFunnel, createTopEndpoints, createTopErrors, createTopPages } from './components/top-list';
import { computeAll } from './aggregations';

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

	const BUCKET_OPTIONS: { label: string; value: string }[] = [
		{ label: '30m', value: '30m' },
		{ label: '1h', value: '1h' },
		{ label: '6h', value: '6h' },
		{ label: '12h', value: '12h' },
		{ label: '1d', value: '1d' },
		{ label: '7d', value: '7d' },
	];

	function makeBucketToggle(activeValue = '1h', idPrefix: string): HTMLElement {
		const wrap = el('div', { class: 'chart-toggle', id: `${idPrefix}-bucket-toggle` });
		wrap.innerHTML = BUCKET_OPTIONS.map(o =>
			`<button class="toggle-btn bucket-btn${o.value === activeValue ? ' active' : ''}" data-bucket="${o.value}">${o.label}</button>`
		).join('');
		return wrap;
	}

	const volumeBucketToggle = makeBucketToggle('1h', 'volume');
	const errorBucketToggle = makeBucketToggle('1h', 'error');

	const volumePanel = el('div', { class: 'panel chart-panel' });
	volumePanel.innerHTML = `
    <div class="panel-header">
		<span class="panel-title">Event Volume</span>
		<div style="display:flex;gap:6px;align-items:center">
			<div class="chart-toggle" id="mode-toggle">
				<button class="toggle-btn active" data-mode="line">Line</button>
				<button class="toggle-btn" data-mode="bar">Bar</button>
			</div>
		</div>
    </div>
`;
	volumePanel.querySelector('.panel-header div')!.prepend(volumeBucketToggle);
	volumePanel.append(volumeChart.el);

	const errorPanel = el('div', { class: 'panel chart-panel' });
	errorPanel.innerHTML = `
    <div class="panel-header">
		<span class="panel-title">Total Error Rate %</span>
		<div style="display:flex;gap:6px;align-items:center"></div>
    </div>
`;
	errorPanel.querySelector('.panel-header div')!.append(errorBucketToggle);
	errorPanel.append(errorChart.el);

	chartsRow.append(volumePanel, errorPanel);

	metricsTab.append(kpiCards, listsRow, httpInfoCards, httpStatusCards, chartsRow);

	volumePanel.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(btn => {
		on(btn, 'click', () => {
			volumePanel.querySelectorAll('[data-mode]').forEach(b => b.classList.remove('active'));
			btn.classList.add('active');
			store.setChartType(btn.dataset.mode as 'line' | 'bar');
		});
	});

	volumeBucketToggle.querySelectorAll<HTMLButtonElement>('.bucket-btn').forEach(btn => {
		on(btn, 'click', () => {
			volumeBucketToggle.querySelectorAll('.bucket-btn').forEach(b => b.classList.remove('active'));
			btn.classList.add('active');
			store.setVolumeBucket(btn.dataset.bucket as ChartBucket);
		});
	});

	errorBucketToggle.querySelectorAll<HTMLButtonElement>('.bucket-btn').forEach(btn => {
		on(btn, 'click', () => {
			errorBucketToggle.querySelectorAll('.bucket-btn').forEach(b => b.classList.remove('active'));
			btn.classList.add('active');
			store.setErrorBucket(btn.dataset.bucket as ChartBucket);
		});
	});

	store.on('chartType:change', (mode) => {
		const s = store.get();
		if (s.metrics) {
			volumeChart.render(s.metrics.eventVolume, mode);
			errorChart.render(s.metrics.errorRateTimeline, mode);
		}
	});

	store.on('volumeBucket:change', () => {
		const s = store.get();
		if (!s.metrics) {
			return;
		}
		const { from, to } = effectiveTimeRange(s.timeRange);
		const { volumeTimeline } = computeAll(store.getRawEvents(), from, to, s.chartBucket, s.volumeBucket, s.errorBucket);
		volumeChart.render(volumeTimeline, s.chartType);
	});

	store.on('errorBucket:change', () => {
		const s = store.get();
		if (!s.metrics) {
			return;
		}
		const { from, to } = effectiveTimeRange(s.timeRange);
		const { errorTimeline } = computeAll(store.getRawEvents(), from, to, s.chartBucket, s.volumeBucket, s.errorBucket);
		errorChart.render(errorTimeline, s.chartType);
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
	const pollIntervalMs = cfg?.dashboard?.pollInterval ?? 10000;

	/**
	 * INFO Single poller — single fetch per tick shared between metrics and events pipelines.
	 */
	const singlePoller = createPoller({
		intervalMs: pollIntervalMs,
		onError: (err) => {
			store.setMetricsError(String(err));
			store.setEventsError(String(err));
		},
		onTick: async () => {
			store.setMetricsLoading(true);
			store.setEventsLoading(true);
			try {
				const { from, to } = effectiveTimeRange(store.get().timeRange);
				const events = await fetchAllEvents(from, to);
				const { chartBucket, chartType, volumeBucket, errorBucket } = store.get();
				// INFO Populate rawEvents and trigger client-side filter in one call
				store.setEvents(events, events.length);

				// INFO Single pass over all events for all three bucket granularities
				const { metrics, stats, volumeTimeline, errorTimeline } = computeAll(events, from, to, chartBucket, volumeBucket, errorBucket);
				store.setMetrics(metrics, stats);
				volumeChart.render(volumeTimeline, chartType);
				errorChart.render(errorTimeline, chartType);
				topPages.render(metrics.topPages);
				topErrors.render(metrics.topErrors);
				funnel.render(metrics.navigationFunnel);
				topEndpoints.render(metrics.topEndpoints);
			} catch (err) {
				store.setMetricsError(String(err));
				store.setEventsError(String(err));
			}
			return null;
		}
	});

	store.on('timeRange:change', (range) => {
		singlePoller.resetCursor();
		// INFO In live mode, the poller automatically advances with each tick. For the other presets, we force an immediate refresh.
		if (range.preset !== 'live') {
			singlePoller.refresh();
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
