import { formatCount, formatDuration, formatPct } from "../utils/format";
import { el } from "../utils/dom";
import { store } from "../state";
import { MetricsResult, StatsResult } from "../aggregations";

/**
* KPI cards row — displayed at the top of the Metrics tab.
* Each card shows a single aggregated value with a colour hint
* when the value crosses a warning threshold.
*/
interface KpiCard {
	id: string
	label: string
	getValue: (stats: StatsResult, metrics: MetricsResult | null) => string
	getClass: (stats: StatsResult, metrics: MetricsResult | null) => string
}

const CARDS: KpiCard[] = [
	{
		id:       'active-sessions',
		label:    'Active Sessions',
		getValue: (_s, m) => formatCount(m?.activeSessions ?? 0),
		getClass: () => '',
	},
	{
		id:       'total-events',
		label:    'Total Events',
		getValue: s => formatCount(s.totalEvents ?? 0),
		getClass: () => '',
	},
	{
		id:       'unique-users',
		label:    'Unique Users',
		getValue: s => formatCount(s.totalUsers ?? 0),
		getClass: () => '',
	},
	{
		id:       'error-rate',
		label:    'Error Rate',
		getValue: s => formatPct(s.errorRate ?? 0),
		getClass: s => (s.errorRate ?? 0) > 5 ? 'kpi-warn' : '',
	},
	{
		id:       'avg-http',
		label:    'Avg HTTP',
		getValue: s => formatDuration(s.avgHttpDuration ?? 0),
		getClass: s => (s.avgHttpDuration ?? 0) > 1000 ? 'kpi-warn' : '',
	},
]

export function createKpiCards(): HTMLElement {
	const container = el('div', { class: 'kpi-cards' });

	for (const card of CARDS) {
		const cardEl = el('div', { class: 'kpi-card', id: `kpi-${card.id}` });
		cardEl.innerHTML = `
    <div class="kpi-value" id="kpi-val-${card.id}">—</div>
    <div class="kpi-label">${card.label}</div>
    `;
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
			cardEl.className = `kpi-card ${card.getClass(stats, metrics)}`.trim();
		}
	}

	// INFO Subscribe to state updates
	store.on('metrics:update', ({ stats, metrics }) => update(stats, metrics));

	store.on('metrics:loading', (loading) => {
		if (loading) {
			for (const card of CARDS) {
				const v = container.querySelector<HTMLElement>(`#kpi-val-${card.id}`);
				if (v) {
					v.textContent = '…';
				}
			}
		}
	})

	return container;
}
