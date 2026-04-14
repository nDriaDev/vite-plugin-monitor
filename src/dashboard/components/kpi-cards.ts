import { formatCompactNumber, formatCount, formatDuration, formatPercent } from "../utils/format";
import { el } from "../utils/dom";
import { store } from "../state";
import type { HttpStats, KpiCard, MetricsResult, StatsResult } from "@tracker/types";

const CARDS: KpiCard[] = [
	{
		id: 'active-sessions',
		label: 'Active Sessions',
		getValue: (_s, m) => formatCompactNumber(m?.activeSessions ?? 0),
		getClass: () => ''
	},
	{
		id: 'total-events',
		label: 'Total Events',
		getValue: s => formatCompactNumber(s.totalEvents ?? 0),
		getClass: () => ''
	},
	{
		id: 'unique-users',
		label: 'Unique Users',
		getValue: s => formatCompactNumber(s.totalUsers ?? 0),
		getClass: () => ''
	},
	{
		id: 'app-error-rate',
		label: 'App Error Rate',
		getValue: s => formatPercent(s.errorRate ?? 0),
		getClass: s => (s.errorRate ?? 0) > 0.05 ? 'kpi-warn' : ''
	}
]

export function createKpiCards({ onTotalEventsClick, onAppErrorRateClick }: { onTotalEventsClick?: () => void, onAppErrorRateClick?: () => void }): HTMLElement {
	const container = el('div', { class: 'kpi-cards' });

	const clickHandlers: Record<string, (() => void) | undefined> = {
		'total-events': onTotalEventsClick,
		'app-error-rate': onAppErrorRateClick,
	};

	for (const card of CARDS) {
		const handler = clickHandlers[card.id];
		const cardEl = el('div', {
			class: `kpi-card${handler ? ' kpi-card--clickable' : ''}`,
			id: `kpi-${card.id}`,
		});
		cardEl.innerHTML = `
    <div class="kpi-value" id="kpi-val-${card.id}">-</div>
    <div class="kpi-label">${card.label}</div>
    `;
		if (handler) {
			cardEl.addEventListener('click', handler);
		}
		container.append(cardEl);
	}

	function update(stats: StatsResult, metrics: MetricsResult | null = null) {
		for (const card of CARDS) {
			const valueEl = container.querySelector<HTMLElement>(`#kpi-val-${card.id}`);
			const cardEl = container.querySelector<HTMLElement>(`#kpi-${card.id}`);
			if (!valueEl || !cardEl) {
				continue;
			}
			valueEl.textContent = card.getValue(stats, metrics);
			const hasClickable = clickHandlers[card.id] !== undefined;
			const semanticClass = card.getClass(stats, metrics);
			cardEl.className = ['kpi-card', semanticClass, hasClickable ? 'kpi-card--clickable' : '']
				.filter(Boolean).join(' ');
		}
	}

	store.on('metrics:update', ({ stats, metrics }) => update(stats, metrics));
	store.on('metrics:loading', (loading) => {
		if (loading) {
			for (const card of CARDS) {
				const v = container.querySelector<HTMLElement>(`#kpi-val-${card.id}`);
				if (v && v.textContent === '-') {
					v.textContent = '...';
				}
			}
		}
	});

	return container;
}

export function createHttpInfoCards({ onMostCalledClick, onHttpErrorRateClick, onSlowestClick }: { onMostCalledClick?: (url: string) => void, onHttpErrorRateClick?: () => void, onSlowestClick?: (url: string) => void }): HTMLElement {
	const container = el('div', { class: 'kpi-cards http-info-cards' });

	const mostCalledCard = el('div', { class: 'kpi-card', id: 'kpi-most-called' });
	mostCalledCard.innerHTML = `
		<div class="kpi-label">Most Called Endpoint</div>
		<div class="kpi-value kpi-value--url" id="kpi-val-most-called">-</div>
		<div class="kpi-badge-row">
			<span class="kpi-badge" id="kpi-badge-most-called"></span>
		</div>
	`;

	const avgCard = el('div', { class: 'kpi-card', id: 'kpi-avg-http' });
	avgCard.innerHTML = `
		<div class="kpi-label">Avg HTTP</div>
		<div class="kpi-value" id="kpi-val-avg-http">-</div>
		<div class="kpi-badge-row"></div>
	`;

	const httpErrCard = el('div', { class: 'kpi-card', id: 'kpi-http-error-rate' });
	httpErrCard.innerHTML = `
		<div class="kpi-label">HTTP Error Rate</div>
		<div class="kpi-value" id="kpi-val-http-error-rate">-</div>
		<div class="kpi-badge-row"></div>
	`;

	const slowestCard = el('div', { class: 'kpi-card', id: 'kpi-slowest' });
	slowestCard.innerHTML = `
		<div class="kpi-label">Slowest Endpoint</div>
		<div class="kpi-value kpi-value--url" id="kpi-val-slowest">-</div>
		<div class="kpi-badge-row">
			<span class="kpi-badge" id="kpi-badge-slowest"></span>
		</div>
	`;

	container.append(mostCalledCard, avgCard, httpErrCard, slowestCard);

	function update(stats: StatsResult) {
		const h = stats.httpStats;

		const mcVal = container.querySelector<HTMLElement>('#kpi-val-most-called')!;
		const mcBadge = container.querySelector<HTMLElement>('#kpi-badge-most-called')!;
		const mcCard = container.querySelector<HTMLElement>('#kpi-most-called')!;
		if (h.mostCalledEndpoint) {
			const mc = h.mostCalledEndpoint;
			mcVal.textContent = mc.url;
			mcVal.title = mc.url;
			mcBadge.textContent = [mc.method, mc.topStatus, `×${formatCount(mc.count)}`]
				.filter(Boolean)
				.join(' · ');
			if (onMostCalledClick) {
				mcCard.className = 'kpi-card kpi-card--clickable';
				mcCard.onclick = () => onMostCalledClick!(`${mc.method} ${mc.url} ${mc.topStatus}`);
			}
		} else {
			mcVal.textContent = '-';
			mcBadge.textContent = '';
			mcCard.onclick = null;
		}

		const avgVal = container.querySelector<HTMLElement>('#kpi-val-avg-http')!;
		const avgCard2 = container.querySelector<HTMLElement>('#kpi-avg-http')!;
		const avgMs = stats.avgHttpDuration ?? 0;
		avgVal.textContent = formatDuration(avgMs);
		avgCard2.className = `kpi-card ${avgMs > 1000 ? 'kpi-warn' : ''}`.trim();

		const herVal = container.querySelector<HTMLElement>('#kpi-val-http-error-rate')!;
		const herCard = container.querySelector<HTMLElement>('#kpi-http-error-rate')!;
		herVal.textContent = formatPercent(h.httpErrorRate ?? 0);
		const herWarn = (h.httpErrorRate ?? 0) > 0.05 ? 'kpi-warn' : '';
		const herClickable = onHttpErrorRateClick ? 'kpi-card--clickable' : '';
		herCard.className = ['kpi-card', herWarn, herClickable].filter(Boolean).join(' ');
		if (onHttpErrorRateClick) {
			herCard.onclick = onHttpErrorRateClick;
		}

		const slVal = container.querySelector<HTMLElement>('#kpi-val-slowest')!;
		const slBadge = container.querySelector<HTMLElement>('#kpi-badge-slowest')!;
		const slCard = container.querySelector<HTMLElement>('#kpi-slowest')!;
		if (h.slowestEndpoint) {
			const sl = h.slowestEndpoint;
			slVal.textContent = sl.url;
			slVal.title = sl.url;
			slBadge.textContent = [sl.method, sl.topStatus, formatDuration(sl.avgDuration)]
				.filter(Boolean)
				.join(' · ');
			const slWarn = sl.avgDuration > 1000 ? 'kpi-warn' : '';
			const slClickable = onSlowestClick ? 'kpi-card--clickable' : '';
			slCard.className = ['kpi-card', slWarn, slClickable].filter(Boolean).join(' ');
			if (onSlowestClick) {
				slCard.onclick = () => onSlowestClick!(`${sl.method} ${sl.url} ${sl.topStatus}`);
			}
		} else {
			slVal.textContent = '-';
			slBadge.textContent = '';
			slCard.className = 'kpi-card';
			slCard.onclick = null;
		}
	}

	store.on('metrics:update', ({ stats }) => update(stats));
	store.on('metrics:loading', (loading) => {
		if (loading) {
			['#kpi-val-most-called', '#kpi-val-avg-http', '#kpi-val-http-error-rate', '#kpi-val-slowest'].forEach(sel => {
				const v = container.querySelector<HTMLElement>(sel);
				if (v && v.textContent === '-') {
					v.textContent = '...';
				}
			});
		}
	});

	return container;
}

type HttpRating = 'good' | 'needs-improvement' | 'poor'

interface HttpStatusCardDef {
	id: string
	label: string
	getPct: (h: HttpStats) => number
	getCount: (h: HttpStats) => number
	getRating: (pct: number) => HttpRating | null
	thresholds: string
	higherIsBetter: boolean
}

const HTTP_STATUS_CARDS: HttpStatusCardDef[] = [
	{
		id: 'http-total',
		label: 'Total Requests',
		getPct: () => 0,
		getCount: h => h.total,
		getRating: () => null,
		thresholds: '',
		higherIsBetter: false
	},
	{
		id: 'http-2xx',
		label: '2xx Success',
		getPct: h => h.pct2xx,
		getCount: h => h.count2xx,
		getRating: pct => pct >= 95 ? 'good' : pct >= 80 ? 'needs-improvement' : 'poor',
		thresholds: '≥95% good · ≥80% ok',
		higherIsBetter: true
	},
	{
		id: 'http-4xx',
		label: '4xx Client Errors',
		getPct: h => h.pct4xx,
		getCount: h => h.count4xx,
		getRating: pct => pct <= 1 ? 'good' : pct <= 5 ? 'needs-improvement' : 'poor',
		thresholds: '≤1% good · ≤5% ok',
		higherIsBetter: false
	},
	{
		id: 'http-5xx',
		label: '5xx Server Errors',
		getPct: h => h.pct5xx,
		getCount: h => h.count5xx,
		getRating: pct => pct <= 0.5 ? 'good' : pct <= 2 ? 'needs-improvement' : 'poor',
		thresholds: '≤0.5% good · ≤2% ok',
		higherIsBetter: false
	}
]

const RATING_COLOR: Record<HttpRating, string> = {
	'good': '#22c55e',
	'needs-improvement': '#f59e0b',
	'poor': '#ef4444'
}

const RATING_LABEL: Record<HttpRating, string> = {
	'good': 'Good',
	'needs-improvement': 'Fair',
	'poor': 'Poor'
}

export function createHttpStatusCards({ onTotalClick, on2xxClick, on4xxClick, on5xxClick }: { onTotalClick?: () => void, on2xxClick?: () => void, on4xxClick?: () => void, on5xxClick?: () => void }): HTMLElement {
	const container = el('div', { class: 'vitals-grid' });

	const cbMap: Record<string, (() => void) | undefined> = {
		'http-total': onTotalClick,
		'http-2xx': on2xxClick,
		'http-4xx': on4xxClick,
		'http-5xx': on5xxClick,
	};

	for (const card of HTTP_STATUS_CARDS) {
		const isTotal = card.id === 'http-total';
		const cb = cbMap[card.id];
		const cardEl = el('div', {
			class: `vital-card${cb ? ' vital-card--clickable' : ''}`,
			id: `http-card-${card.id}`,
		});
		if (cb) {
			cardEl.addEventListener('click', cb);
		}
		cardEl.innerHTML = `
			<div class="vital-header">
				<span class="vital-metric">${card.label}</span>
				${!isTotal ? `<span class="vital-badge" id="http-badge-${card.id}">-</span>` : ''}
			</div>
			<div class="vital-value" id="http-val-${card.id}">-</div>
			${!isTotal ? `
			<div class="vital-bar-track">
				<div class="vital-bar" id="http-bar-${card.id}" style="width:0%"></div>
			</div>
			` : ''}
			<div class="vital-meta">
				<span id="http-count-${card.id}"></span>
				<span>${card.thresholds}</span>
			</div>
		`;
		container.append(cardEl);
	}

	function update(stats: StatsResult) {
		const h = stats.httpStats;

		for (const card of HTTP_STATUS_CARDS) {
			const isTotal = card.id === 'http-total';
			const valEl = container.querySelector<HTMLElement>(`#http-val-${card.id}`)!;
			const countEl = container.querySelector<HTMLElement>(`#http-count-${card.id}`)!;
			const count = card.getCount(h);
			const pct = card.getPct(h);

			if (isTotal) {
				valEl.textContent = formatCount(count);
				if (countEl) {
					countEl.textContent = '';
				}
				continue;
			}

			const barEl = container.querySelector<HTMLElement>(`#http-bar-${card.id}`)!;
			const badgeEl = container.querySelector<HTMLElement>(`#http-badge-${card.id}`)!;
			const rating = card.getRating(pct);

			valEl.textContent = h.total > 0 ? `${pct}%` : '-';
			if (countEl) {
				countEl.textContent = h.total > 0 ? `${formatCount(count)} reqs` : '';
			}

			// INFO bar: 2xx shows % forward; error cards scale ×10 for visibility at low values
			const barPct = card.higherIsBetter ? pct : Math.min(pct * 10, 100);
			barEl.style.width = h.total > 0 ? `${Math.min(barPct, 100)}%` : '0%';

			if (rating && h.total > 0) {
				const color = RATING_COLOR[rating];
				valEl.style.color = color;
				barEl.style.background = color;
				badgeEl.textContent = RATING_LABEL[rating];
				badgeEl.style.color = color;
			} else {
				valEl.style.color = '';
				barEl.style.background = '';
				badgeEl.textContent = '-';
				badgeEl.style.color = '';
			}
		}
	}

	store.on('metrics:update', ({ stats }) => update(stats));
	store.on('metrics:loading', (loading) => {
		if (loading) {
			HTTP_STATUS_CARDS.forEach(card => {
				const v = container.querySelector<HTMLElement>(`#http-val-${card.id}`);
				if (v && v.textContent === '-') {
					v.textContent = '...';
				}
			});
		}
	});

	return container;
}
