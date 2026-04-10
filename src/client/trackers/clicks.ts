/* eslint-disable no-unused-vars */
/* eslint-disable no-undef */
import type { ClickPayload, ClickTrackOptions } from "@tracker/types";

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
 * Returns true if `path` matches any of the given route patterns.
 * String patterns use `strict equality`; RegExp patterns are tested against the full path.
 */
function matchesRoute(path: string, patterns: (string | RegExp)[]): boolean {
	return patterns.some(p => {
		if (!p) {
			return false;
		}
		if (p instanceof RegExp) {
			return p.test(path);
		}
		return path === p;
	});
}

/**
 * @param onEvent          - Callback invoked for every tracked click.
 * @param ignoreUrls      - Internal route prefixes where click tracking is suppressed
 *                           (used to inject the dashboard route). String prefix match only.
 * @param ignoreSelectors  - CSS selectors; clicks on matching elements (or their ancestors)
 *                           are suppressed. Checked via `Element.closest()` at click-time.
 * @param ignoreRoutes     - User-configurable route patterns (string prefix or RegExp).
 *                           Checked against `window.location.pathname` at click-time.
 */
export function setupClickTracker(onEvent: (payload: ClickPayload) => void, opts: true | ClickTrackOptions = true, ignoreUrls: (string | RegExp)[] = []): () => void {
	if (typeof window === 'undefined') {
		return () => { };
	}

	const clickOpts = typeof opts === 'object' ? opts : {};
	/**
	 * INFO Inject the overlay selector automatically so overlay interactions
	 * are never tracked, regardless of user config (fixes the overlay click bug).
	 */
	const ignoreSelectors = ['[data-tracker-overlay]', ...(clickOpts.ignoreSelectors || [])];
	/**
	 * INFO Inject the ignoreUrls derived from other config (e.g. the dashboard itself)
	 * so interactions in this routes are never tracked.
	 */
	const ignoreRoutes = [...ignoreUrls, ...(clickOpts.ignoreRoutes || [])];


	function onClick(e: MouseEvent) {
		const target = e.target as Element;
		if (!target?.tagName) {
			return;
		}

		/**
		 * INFO Skip clicks on user-configured ignored routes (supports RegExp).
		 */
		const currentPath = window.location.pathname;
		if (ignoreRoutes.length > 0 && matchesRoute(currentPath, ignoreRoutes)) {
			return;
		}

		/**
		 * INFO Skip clicks on elements matching any of the ignored CSS selectors.
		 * Uses closest() to walk up the DOM so that clicks on children of
		 * ignored elements (e.g. an icon inside a cookie-banner button) are
		 * also suppressed. This also fixes the overlay click-tracking bug:
		 * the overlay host `[data-tracker-overlay]` is injected into
		 * ignoreSelectors by TrackerClient so overlay interactions are never tracked.
		 */
		if (ignoreSelectors.length > 0 && ignoreSelectors.some(sel => {
			try {
				return target.closest(sel) !== null;
			} catch {
				return false;
			}
		})) {
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
