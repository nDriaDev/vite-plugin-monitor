import { PerformancePayload } from "@tracker/types";

type Metric = PerformancePayload['metric'];

const THRESHOLDS: Record<Metric, [number, number]> = {
	FCP:  [1800, 3000],
	LCP:  [2500, 4000],
	FID:  [100,  300],
	CLS:  [0.1,  0.25],
	TTFB: [800,  1800],
	INP:  [200,  500],
};

function rating(metric: Metric, value: number): PerformancePayload['rating'] {
	const [good, poor] = THRESHOLDS[metric];
	return value <= good
		? 'good'
		: value <= poor
			? 'needs-improvement'
			: 'poor';
}

export function setupPerformanceTracker(onEvent: (payload: PerformancePayload) => void): () => void {
	if (typeof window === 'undefined' || typeof PerformanceObserver === 'undefined') {
		return () => { };
	}

	const observers: PerformanceObserver[] = [];

	function observe(types: string[], handler: (entries: PerformanceObserverEntryList) => void) {
		try {
			const obs = new PerformanceObserver(handler);
			obs.observe({ type: types[0], buffered: true });
			observers.push(obs);
		} catch { /* metric not supported in this browser */ }
	}

	observe(['paint'], (list) => {
		for (const entry of list.getEntries()) {
			if (entry.name === 'first-contentful-paint') {
				const value = Math.round(entry.startTime);
				onEvent({ metric: 'FCP', value, rating: rating('FCP', value) });
			}
		}
	})

	/**
	 * LCP: the browser may call the callback multiple times as the candidate updates.
	 * We only emit on the first user interaction or page hide (the "final" LCP).
	 * Until then we just track the latest candidate value without emitting.
	 */
	let lcpValue = 0;
	observe(['largest-contentful-paint'], (list) => {
		const entries = list.getEntries();
		const last = entries[entries.length - 1] as any;
		if (last) {
			lcpValue = Math.round(last.startTime);
		}
	});
	// INFO Emit final LCP on first user interaction or visibility change
	const commitLcp = () => {
		if (lcpValue > 0) {
			onEvent({ metric: 'LCP', value: lcpValue, rating: rating('LCP', lcpValue) });
			lcpValue = 0;
		}
		document.removeEventListener('keydown', commitLcp, { capture: true });
		document.removeEventListener('click', commitLcp, { capture: true });
		document.removeEventListener('pointerdown', commitLcp, { capture: true });
		document.removeEventListener('scroll', commitLcp, { capture: true });
	}
	document.addEventListener('keydown', commitLcp, { once: true, capture: true });
	document.addEventListener('click', commitLcp, { once: true, capture: true });
	document.addEventListener('pointerdown', commitLcp, { once: true, capture: true });
	document.addEventListener('scroll', commitLcp, { once: true, capture: true });

	observe(['first-input'], (list) => {
		const entry = list.getEntries()[0] as any;
		if (entry) {
			const value = Math.round(entry.processingStart - entry.startTime);
			onEvent({ metric: 'FID', value, rating: rating('FID', value) });
		}
	});

	/**
	 * CLS: accumulate across all callbacks; emit the running total.
	 * A separate per-page reset would require coupling with the navigation tracker.
	 * Instead we track the cumulative score and emit on each batch so the
	 * dashboard can take the max value seen for a given session.
	 */
	let clsTotal = 0;
	observe(['layout-shift'], (list) => {
		for (const entry of list.getEntries() as any[]) {
			if (!entry.hadRecentInput) {
				clsTotal += entry.value;
			}
		}
		if (clsTotal > 0) {
			const value = parseFloat(clsTotal.toFixed(4));
			onEvent({ metric: 'CLS', value, rating: rating('CLS', value) });
		}
	});

	observe(['navigation'], (list) => {
		const entry = list.getEntries()[0] as any;
		if (entry) {
			const value = Math.round(entry.responseStart);
			onEvent({ metric: 'TTFB', value, rating: rating('TTFB', value) });
		}
	});

	observe(['event'], (list) => {
		for (const entry of list.getEntries() as any[]) {
			if (entry.interactionId) {
				const value = Math.round(entry.duration);
				onEvent({ metric: 'INP', value, rating: rating('INP', value) });
			}
		}
	});

	return () => {
		observers.forEach(o => o.disconnect());
		commitLcp();  // INFO flush any pending LCP value on teardown
		document.removeEventListener('keydown', commitLcp, { capture: true });
		document.removeEventListener('click', commitLcp, { capture: true });
		document.removeEventListener('pointerdown', commitLcp, { capture: true });
		document.removeEventListener('scroll', commitLcp, { capture: true });
	}
}
