import type { ChartComponent, ChartMode, ChartOptions, TimePoint } from "@tracker/types";
import { el, empty, svgEl } from "../utils/dom";
import { formatBucket } from "../utils/format";

const W = 600;
const H = 180;
const PAD = { top: 16, right: 16, bottom: 36, left: 52 };
const INNER_W = W - PAD.left - PAD.right;
const INNER_H = H - PAD.top - PAD.bottom;

function cssVar(name: string): string {
	return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/**
 * Compute "nice" Y-axis ticks (0 … rounded max).
 * The last tick is always >= maxVal so the highest data point
 * never sits above or exactly on the top grid line.
 */
function niceYTicks(maxVal: number, count = 5): number[] {
	if (maxVal <= 0) return [0];
	const rawStep = maxVal / (count - 1);
	const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
	const norm = rawStep / magnitude;
	const niceStep = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
	const step = niceStep * magnitude;
	const ticks: number[] = [];
	for (let t = 0; t <= maxVal + step * 0.01; t += step) {
		ticks.push(parseFloat(t.toFixed(10)));
		if (ticks.length >= count + 1) break;
	}
	// Guarantee the last tick covers the actual maximum
	if (ticks[ticks.length - 1] < maxVal) {
		ticks.push(parseFloat((ticks[ticks.length - 1] + step).toFixed(10)));
	}
	return ticks;
}

/**
 * Pick at most maxLabels evenly-spread X indices, always include first + last.
 */
function xLabelIndices(n: number, maxLabels = 8): number[] {
	if (n <= 1) return [0];
	if (n <= maxLabels) return Array.from({ length: n }, (_, i) => i);
	const step = (n - 1) / (maxLabels - 1);
	const idxs = Array.from({ length: maxLabels }, (_, k) => Math.round(k * step));
	idxs[idxs.length - 1] = n - 1;
	return [...new Set(idxs)];
}

/**
 * Zero-dependency SVG chart component.
 *
 * Improvements over v1:
 * - Taller canvas (180 px vs 120 px) and wider left-padding for Y labels.
 * - "Nice" rounded Y-axis ticks instead of fixed 0/25/50/75/100 % fractions.
 * - Y-axis unit label (rotated text on the left).
 * - Adaptive X-axis labels: distributes up to ~8 labels so they never overlap.
 * - Explicit axis border lines + tick marks.
 * - Interactive hover tooltip: crosshair + nearest-point dot + value popup.
 * - Slightly bolder line (2 px) and more opaque area gradient.
 */
export function createChart(opts: ChartOptions = {}): ChartComponent {
	const color = opts.color ?? '#3b82f6';
	const unitLabel = opts.label ?? 'events';
	let mode: ChartMode = 'line';
	let currentData: TimePoint[] = [];

	const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
	svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
	svg.setAttribute('class', 'chart-svg');
	svg.setAttribute('aria-hidden', 'true');

	const defs = svgEl('defs');
	const gradId = `grad-${Math.random().toString(36).slice(2)}`;
	const grad = svgEl('linearGradient', { id: gradId, x1: '0', y1: '0', x2: '0', y2: '1' });
	grad.append(
		svgEl('stop', { offset: '0%', 'stop-color': color, 'stop-opacity': '0.25' }),
		svgEl('stop', { offset: '100%', 'stop-color': color, 'stop-opacity': '0.0' }),
	);
	defs.append(grad);
	svg.append(defs);

	const gridLayer = svgEl('g', { class: 'chart-grid' });
	const dataLayer = svgEl('g', { class: 'chart-data' });
	const axisLayer = svgEl('g', { class: 'chart-axis' });
	const hoverLayer = svgEl('g', { class: 'chart-hover', style: 'pointer-events:none' });
	svg.append(gridLayer, dataLayer, axisLayer, hoverLayer);

	// HTML tooltip overlay
	const tooltip = el('div');
	tooltip.style.cssText = [
		'position:absolute', 'display:none',
		'background:var(--bg-card,#1e293b)',
		'border:1px solid var(--border,#334155)',
		'border-radius:6px', 'padding:6px 10px',
		'font-size:12px', 'line-height:1.5',
		'color:var(--text,#e2e8f0)',
		'pointer-events:none', 'z-index:100',
		'white-space:nowrap',
		'box-shadow:0 4px 12px rgba(0,0,0,0.3)',
	].join(';');

	const wrapper = el('div');
	wrapper.style.position = 'relative';
	if (opts.onClick) {
		wrapper.style.cursor = 'pointer';
		wrapper.title = 'Click to view events';
		wrapper.addEventListener('click', opts.onClick);
	}
	wrapper.append(svg, tooltip);

	function getScales(data: TimePoint[], topTick: number) {
		const xScaleLine = (i: number) => PAD.left + (i / (data.length - 1 || 1)) * INNER_W;
		const xScaleBar = (i: number) => PAD.left + ((i + 0.5) / data.length) * INNER_W;
		return {
			xScale: mode === 'bar' ? xScaleBar : xScaleLine,
			yScale: (v: number) => PAD.top + INNER_H - (v / topTick) * INNER_H,
		};
	}

	svg.addEventListener('mousemove', (e: MouseEvent) => {
		if (!currentData.length) return;
		const rect = svg.getBoundingClientRect();
		const svgX = ((e.clientX - rect.left) / rect.width) * W;
		const svgY = ((e.clientY - rect.top) / rect.height) * H;

		if (svgX < PAD.left - 8 || svgX > PAD.left + INNER_W + 8 ||
			svgY < PAD.top || svgY > PAD.top + INNER_H) {
			hideTooltip(); return;
		}

		const topTick = niceYTicks(Math.max(...currentData.map(d => d.value), 0.001), 5).at(-1)!;
		const { xScale, yScale } = getScales(currentData, topTick);

		let closest = 0, minDist = Infinity;
		for (let i = 0; i < currentData.length; i++) {
			const d = Math.abs(xScale(i) - svgX);
			if (d < minDist) { minDist = d; closest = i; }
		}

		const pt = currentData[closest];
		const cx = xScale(closest);
		const cy = yScale(pt.value);

		empty(hoverLayer);
		hoverLayer.append(
			svgEl('line', {
				x1: cx, y1: PAD.top, x2: cx, y2: PAD.top + INNER_H,
				stroke: color, 'stroke-width': '1', 'stroke-dasharray': '3 3', opacity: '0.5'
			}),
			svgEl('circle', {
				cx, cy, r: '4.5', fill: color,
				stroke: 'var(--bg-card,#1e293b)', 'stroke-width': '2'
			}),
		);

		const wRect = wrapper.getBoundingClientRect();
		const rawLeft = e.clientX - wRect.left;
		const rawTop = e.clientY - wRect.top;
		const label = pt.value.toLocaleString();
		tooltip.innerHTML = `
			<div style="font-weight:600;margin-bottom:2px">${formatBucket(pt.bucket)}</div>
			<div>${label} <span style="color:var(--text-muted,#94a3b8)">${unitLabel}</span></div>
		`;
		tooltip.style.display = 'block';
		const ttW = tooltip.offsetWidth || 140;
		const left = rawLeft + ttW + 24 > wRect.width ? rawLeft - ttW - 12 : rawLeft + 12;
		tooltip.style.left = `${left}px`;
		tooltip.style.top = `${rawTop - 48}px`;
	});

	svg.addEventListener('mouseleave', hideTooltip);

	function hideTooltip() {
		tooltip.style.display = 'none';
		empty(hoverLayer);
	}

	function render(data: TimePoint[], newMode?: ChartMode) {
		if (newMode) mode = newMode;
		currentData = data;
		empty(gridLayer); empty(dataLayer); empty(axisLayer); empty(hoverLayer);
		tooltip.style.display = 'none';

		const gridColor = cssVar('--border') || '#1e293b';
		const labelColor = cssVar('--text-muted') || '#64748b';
		const axisColor = cssVar('--border') || '#334155';
		const emptyColor = cssVar('--text-dim') || '#334155';

		if (!data.length) {
			const txt = svgEl('text', {
				x: W / 2, y: H / 2, 'text-anchor': 'middle',
				'dominant-baseline': 'middle', fill: emptyColor, 'font-size': '12'
			});
			txt.textContent = 'No data';
			dataLayer.append(txt);
			return;
		}

		const maxVal = Math.max(...data.map(d => d.value), 0.001);
		const yTicks = niceYTicks(maxVal, 5);
		const topTick = yTicks[yTicks.length - 1];
		const { xScale, yScale } = getScales(data, topTick);

		// Y-axis border
		gridLayer.append(svgEl('line', {
			x1: PAD.left, y1: PAD.top, x2: PAD.left, y2: PAD.top + INNER_H,
			stroke: axisColor, 'stroke-width': '1'
		}));

		// Y ticks + grid lines + labels
		for (const tick of yTicks) {
			const y = yScale(tick);
			gridLayer.append(svgEl('line', {
				x1: PAD.left, y1: y, x2: PAD.left + INNER_W, y2: y,
				stroke: gridColor, 'stroke-width': '1',
				'stroke-dasharray': tick === 0 ? '' : '3 3',
				opacity: tick === 0 ? '1' : '0.55'
			}));
			// Tick mark
			axisLayer.append(svgEl('line', {
				x1: PAD.left - 4, y1: y, x2: PAD.left, y2: y,
				stroke: axisColor, 'stroke-width': '1'
			}));
			const lbl = tick >= 1_000_000
				? (tick / 1_000_000).toFixed(1) + 'M'
				: tick >= 1_000
					? (tick / 1_000).toFixed(tick % 1_000 === 0 ? 0 : 1) + 'k'
					: tick.toFixed(tick < 10 && tick !== Math.floor(tick) ? 1 : 0);
			const txt = svgEl('text', {
				x: PAD.left - 8, y,
				'text-anchor': 'end', 'dominant-baseline': 'middle',
				fill: labelColor, 'font-size': '11', 'font-family': 'inherit'
			});
			txt.textContent = lbl;
			axisLayer.append(txt);
		}

		// Y-axis unit label (rotated)
		const yUnit = svgEl('text', {
			x: '0', y: '0',
			transform: `rotate(-90) translate(${-(PAD.top + INNER_H / 2)},${13})`,
			'text-anchor': 'middle',
			fill: labelColor, 'font-size': '10', 'font-family': 'inherit', opacity: '0.65'
		});
		yUnit.textContent = unitLabel;
		axisLayer.append(yUnit);

		// X-axis baseline
		gridLayer.append(svgEl('line', {
			x1: PAD.left, y1: PAD.top + INNER_H, x2: PAD.left + INNER_W, y2: PAD.top + INNER_H,
			stroke: axisColor, 'stroke-width': '1'
		}));

		// X labels — adaptive
		const maxXLabels = Math.max(2, Math.min(data.length, Math.floor(INNER_W / 62)));
		for (const i of xLabelIndices(data.length, maxXLabels)) {
			const x = xScale(i);
			axisLayer.append(svgEl('line', {
				x1: x, y1: PAD.top + INNER_H, x2: x, y2: PAD.top + INNER_H + 4,
				stroke: axisColor, 'stroke-width': '1'
			}));
			const txt = svgEl('text', {
				x, y: PAD.top + INNER_H + 15,
				'text-anchor': 'middle',
				fill: labelColor, 'font-size': '11', 'font-family': 'inherit'
			});
			txt.textContent = formatBucket(data[i].bucket);
			axisLayer.append(txt);
		}

		// Data rendering
		if (mode === 'bar') {
			const barW = Math.max(2, (INNER_W / data.length) * 0.65);
			for (let i = 0; i < data.length; i++) {
				const x = xScale(i) - barW / 2;
				const y = yScale(data[i].value);
				dataLayer.append(svgEl('rect', {
					x, y, width: barW, height: Math.max(1, PAD.top + INNER_H - y),
					fill: color, opacity: '0.8', rx: '2'
				}));
			}
		} else {
			const pts = data.map((d, i) => `${xScale(i)},${yScale(d.value)}`).join(' ');
			const areaPts = [
				`${xScale(0)},${PAD.top + INNER_H}`,
				...data.map((d, i) => `${xScale(i)},${yScale(d.value)}`),
				`${xScale(data.length - 1)},${PAD.top + INNER_H}`
			].join(' ');

			dataLayer.append(
				svgEl('polygon', { points: areaPts, fill: `url(#${gradId})` }),
				svgEl('polyline', {
					points: pts, fill: 'none', stroke: color,
					'stroke-width': '2', 'stroke-linejoin': 'round', 'stroke-linecap': 'round'
				}),
			);

			if (data.length <= 48) {
				for (let i = 0; i < data.length; i++) {
					dataLayer.append(svgEl('circle', {
						cx: xScale(i), cy: yScale(data[i].value),
						r: data.length <= 24 ? '3' : '2', fill: color
					}));
				}
			}
		}
	}

	render([]);
	return { el: wrapper, render };
}
