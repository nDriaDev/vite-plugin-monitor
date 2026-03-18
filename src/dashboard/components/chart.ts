import { ChartComponent, ChartMode, ChartOptions, TimePoint } from "@tracker/types";
import { el, empty, svgEl } from "../utils/dom";
import { formatBucket } from "../utils/format";

const W = 600;
const H = 120;
const PAD = { top: 8, right: 8, bottom: 24, left: 40 };
const INNER_W = W - PAD.left - PAD.right;
const INNER_H = H - PAD.top - PAD.bottom;

/**
* Reads a CSS custom property value from the document root at call time,
* so the chart always reflects the current theme (dark / light).
*/
function cssVar(name: string): string {
	return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/**
* Zero-dependency SVG chart component.
*
* @remarks
* Supports both line+area and bar modes.
* Updates in place when render() is called with new data.
* Colors are resolved from CSS custom properties at render time so both
* dark and light themes are handled correctly.
*/
export function createChart(opts: ChartOptions = {}): ChartComponent {
	const color = opts.color ?? '#3b82f6';
	let mode: ChartMode = 'line';

	const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
	svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
	svg.setAttribute('class', 'chart-svg');
	svg.setAttribute('aria-hidden', 'true');

	// INFO Gradient def for area fill
	const defs = svgEl('defs');
	const grad = svgEl('linearGradient', { id: `grad-${Math.random().toString(36).slice(2)}`, x1: '0', y1: '0', x2: '0', y2: '1' });
	const stop1 = svgEl('stop', { offset: '0%', 'stop-color': color, 'stop-opacity': '0.3' });
	const stop2 = svgEl('stop', { offset: '100%', 'stop-color': color, 'stop-opacity': '0.0' });
	grad.append(stop1, stop2);
	defs.append(grad);
	svg.append(defs);

	const gradId = grad.id;

	const gridLayer = svgEl('g', { class: 'chart-grid' });
	const dataLayer = svgEl('g', { class: 'chart-data' });
	const axisLayer = svgEl('g', { class: 'chart-axis' });

	svg.append(gridLayer, dataLayer, axisLayer);

	const wrapper = el('div');
	if (opts.onClick) {
		wrapper.style.cursor = "pointer";
		wrapper.title = "Click to view events";
		wrapper.addEventListener("click", opts.onClick);
	}
	wrapper.appendChild(svg);

	function render(data: TimePoint[], newMode?: ChartMode) {
		if (newMode) {
			mode = newMode;
		}

		empty(gridLayer);
		empty(dataLayer);
		empty(axisLayer);

		// INFO Resolve theme-aware colors at render time from CSS custom properties
		const gridColor  = cssVar('--border') || '#1e293b';
		const labelColor = cssVar('--text-muted') || '#475569';
		const emptyColor = cssVar('--text-dim') || '#334155';

		if (!data.length) {
			const txt = svgEl(
				'text',
				{
					x: W / 2, y: H / 2,
					'text-anchor': 'middle',
					'dominant-baseline': 'middle',
					fill: emptyColor,
					'font-size': '12'
				}
			);
			txt.textContent = 'No data';
			dataLayer.append(txt);
			return;
		}

		const values  = data.map(d => d.value)
		const maxVal = Math.max(...values, 0.001);   // INFO avoid division by zero
		const minVal = 0;

		const xScaleLine = (i: number) => PAD.left + (i / (data.length - 1 || 1)) * INNER_W;
		const xScaleBar = (i: number) => PAD.left + ((i + 0.5) / data.length) * INNER_W;
		const xScale = mode === 'bar' ? xScaleBar : xScaleLine;
		const yScale = (v: number) => PAD.top + INNER_H - ((v - minVal) / (maxVal - minVal)) * INNER_H;

		const yTicks = [0, 0.25, 0.5, 0.75, 1];
		for (const t of yTicks) {
			const y = PAD.top + INNER_H - t * INNER_H;

			const line = svgEl(
				'line',
				{
					x1: PAD.left, y1: y, x2: PAD.left + INNER_W, y2: y,
					stroke: gridColor, 'stroke-width': '1'
				}
			);
			gridLayer.append(line);

			const val = minVal + t * (maxVal - minVal);
			const label = val >= 1000 ? (val / 1000).toFixed(1) + 'k' : val.toFixed(val < 10 ? 1 : 0);
			const txt = svgEl('text', {
				x: PAD.left - 4, y,
				'text-anchor': 'end', 'dominant-baseline': 'middle',
				fill: labelColor, 'font-size': '9',
			});
			txt.textContent = label;
			axisLayer.append(txt);
		}

		const xLabelIdxs = data.length <= 3
			? data.map((_, i) => i)
			: [0, Math.floor((data.length - 1) / 2), data.length - 1];

		for (const i of xLabelIdxs) {
			const x = xScale(i);
			const txt = svgEl(
				'text',
				{
					x, y: H - 4,
					'text-anchor': 'middle',
					fill: labelColor, 'font-size': '9',
				}
			);
			txt.textContent = formatBucket(data[i].bucket);
			axisLayer.append(txt);
		}

		if (mode === 'bar') {
			const barW = Math.max(2, (INNER_W / data.length) * 0.7);

			for (let i = 0; i < data.length; i++) {
				const x = xScale(i) - barW / 2;
				const y = yScale(data[i].value);
				const h = PAD.top + INNER_H - y;

				const rect = svgEl(
					'rect',
					{
						x, y,
						width:  barW,
						height: Math.max(1, h),
						fill:   color,
						opacity: '0.75',
						rx: '2',
					}
				);
				dataLayer.append(rect);
			}
		} else {
			const points = data.map((d, i) => `${xScale(i)},${yScale(d.value)}`).join(' ');

			const areaPoints = [
				`${xScale(0)},${PAD.top + INNER_H}`,
				...data.map((d, i) => `${xScale(i)},${yScale(d.value)}`),
				`${xScale(data.length - 1)},${PAD.top + INNER_H}`
			].join(' ');

			const area = svgEl(
				'polygon',
				{
					points: areaPoints,
					fill:   `url(#${gradId})`
				}
			);

			const line = svgEl(
				'polyline',
				{
					points,
					fill:           'none',
					stroke:         color,
					'stroke-width': '1.5',
					'stroke-linejoin': 'round',
					'stroke-linecap':  'round'
				}
			);

			dataLayer.append(area, line);

			if (data.length <= 24) {
				for (let i = 0; i < data.length; i++) {
					const circle = svgEl(
						'circle', {
							cx: xScale(i), cy: yScale(data[i].value),
							r: '2.5', fill: color
						}
					);
					dataLayer.append(circle);
				}
			}
		}
	}

	render([]);

	return {
		el: wrapper,
		render
	}
}