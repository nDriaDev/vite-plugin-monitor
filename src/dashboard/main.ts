import { createChart } from './components/chart';
import { createHeader } from './components/header';
import { createKpiCards } from './components/kpi-cards';
import { checkStoredAuth, createLoginScreen } from './components/login';
import { initRouter } from './router';
import { store } from './state';
import './style.css';
import { el, hide, on, show, toggleVisible } from './utils/dom';
import { createFunnel, createTopErrors, createTopPages, FunnelComponent, TopErrorsComponent, TopPagesComponent } from './components/top-list';
import { createEventsTable } from './components/events-table';
import { createEventDetail } from './components/event-detail';
import { createPoller } from './utils/poll';
import { fetchEvents, fetchPing } from './api';
import { computeMetrics, computeStats, fetchAllEvents } from './aggregations';

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

	const kpiCards = createKpiCards();
	const volumeChart = createChart({ color: '#3b82f6', label: 'events' });
	const errorChart = createChart({ color: '#ef4444', label: '%' });
	const topPages: TopPagesComponent = createTopPages();
	const topErrors: TopErrorsComponent = createTopErrors();
	const funnel: FunnelComponent = createFunnel();

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
		<span class="panel-title">Error Rate %</span>
    </div>
`;
	errorPanel.append(errorChart.el);

	chartsRow.append(volumePanel, errorPanel);

	const bottomRow = el('div', { class: 'bottom-row' });
	bottomRow.append(topPages, topErrors, funnel);

	metricsTab.append(kpiCards, chartsRow, bottomRow);

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
	})

	const eventsTable = createEventsTable();
	const eventDetail = createEventDetail();
	const eventsLayout = el('div', { class: 'events-layout' });
	eventsLayout.append(eventsTable, eventDetail);
	eventsTab.append(eventsLayout);

	main.append(metricsTab, eventsTab);

	store.on('events:select', (ev) => {
		eventsLayout.classList.toggle('has-detail', !!ev);
	})

	store.on('tab:change', (tab) => {
		toggleVisible(metricsTab, tab === 'metrics');
		toggleVisible(eventsTab, tab === 'events');
	});

	store.on('metrics:error', (err) => {
		if (err) {
			errorBanner.textContent = `Metrics error: ${err}`;
			show(errorBanner);
		} else {
			hide(errorBanner);
		}
	})

	const cfg = (window as any).__TRACKER_CONFIG__;
	const pollIntervalMs = cfg?.dashboard?.pollInterval ?? 3000;

	const metricsPoller = createPoller({
		intervalMs: pollIntervalMs,
		onError: (err) => store.setMetricsError(String(err)),
		onTick: async () => {
			const { from, to } = store.get().timeRange;
			store.setMetricsLoading(true);
			try {
				const events = await fetchAllEvents(from, to);
				const metrics = computeMetrics(events, from, to);
				const stats = computeStats(events, from, to);
				store.setMetrics(metrics, stats);

				const s = store.get();
				volumeChart.render(metrics.eventVolume, s.chartType);
				errorChart.render(metrics.errorRateTimeline,  s.chartType);
				topPages.render(metrics.topPages);
				topErrors.render(metrics.topErrors);
				funnel.render(metrics.navigationFunnel);
			} catch (err) {
				store.setMetricsError(String(err));
			}
			return null;  // INFO metrics polling doesn't use a cursor
		}
	});

	const eventsPoller = createPoller({
		intervalMs: pollIntervalMs,
		onError: (err) => store.setEventsError(String(err)),
		onTick: async (cursor) => {
			const { from, to } = store.get().timeRange;
			const filter = store.get().eventsFilter;

			if (!cursor) {
				store.setEventsLoading(true);
				try {
					const res = await fetchEvents({ since: from, until: to, limit: 200, ...filter });
					store.setEvents(res.events ?? [], res.total ?? 0);
					return res.events?.[0]?.timestamp ?? null;
				} catch (err) {
					store.setEventsError(String(err));
					return null;
				}
			} else {
				try {
					const res = await fetchEvents({ after: cursor, limit: 100, ...filter });
					if (res.events?.length) {
						store.prependEvents(res.events);
						return res.events[0].timestamp;
					}
					return cursor;
				} catch {
					return cursor;
				}
			}
		}
	});

	store.on('timeRange:change', () => {
		metricsPoller.resetCursor();
		metricsPoller.refresh();
		eventsPoller.resetCursor();
		eventsPoller.refresh();
	})

	store.on('events:filter', () => {
		eventsPoller.resetCursor();
		eventsPoller.refresh();
	})

	async function pingBackend() {
		const ok = await fetchPing();
		store.setBackendStatus(ok);
	}
	pingBackend();
	setInterval(pingBackend, 10_000);
}

document.addEventListener('DOMContentLoaded', boot);
