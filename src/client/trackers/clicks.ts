import { ClickPayload } from "@tracker/types";

function getXPath(el: Element, maxDepth = 8): string {
	const parts: string[] = []
	let current: Element | null = el
	let depth = 0

	while (current && current.tagName && depth < maxDepth) {
		const parent = current.parentElement as Element | null;
		if (!parent) {
			parts.unshift(current.tagName.toLowerCase());
			break;
		}
		const siblings = Array.from(parent.children).filter(c => c.tagName === current!.tagName);
		const idx = siblings.indexOf(current) + 1;
		const suffix = siblings.length > 1 ? `[${idx}]` : '';
		parts.unshift(`${current.tagName.toLowerCase()}${suffix}`);
		current = parent;
		depth++;
	}

	return '/' + parts.join('/');
}

/**
 * @param onEvent     - Callback invoked for every tracked click.
 * @param ignorePaths - Route prefixes where click tracking is suppressed.
 *                     Checked against `window.location.pathname` at click-time,
 *                     so it reacts to runtime navigations without re-registration.
 *                     The dashboard route is automatically injected here by TrackerClient
 *                     so the dashboard's own UI interactions are never self-tracked.
 */
export function setupClickTracker(onEvent: (payload: ClickPayload) => void, ignorePaths: string[] = []): () => void {
	if (typeof window === 'undefined') {
		return () => { };
	}

	function onClick(e: MouseEvent) {
		const target = e.target as Element;
		if (!target?.tagName) {
			return;
		}

		/**
		 * INFO Skip clicks while the user is on an ignored route (e.g. the dashboard itself).
		 * Evaluated at click-time so it adapts to runtime navigation without re-registration.
		 */
		const currentPath = window.location.pathname;
		if (ignorePaths.some(p => p && currentPath.startsWith(p))) {
			return;
		}

		onEvent({
			tag: target.tagName.toLowerCase(),
			text: (target.textContent ?? '').trim().slice(0, 100),
			id: target.id || undefined,
			classes: (typeof target.className === 'string' ? target.className : String((target.className as SVGAnimatedString).baseVal)) || undefined,
			xpath: getXPath(target),
			coordinates: { x: e.clientX, y: e.clientY }
		});
	}

	document.addEventListener('click', onClick, { passive: true });
	return () => document.removeEventListener('click', onClick);
}
