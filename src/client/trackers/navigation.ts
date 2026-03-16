import { NavigationPayload } from "@tracker/types";

/**
 *  INFO Storage key for MPA cross-page navigation
 *  When a full-page navigation happens (MPA, <a href> click), we save the
 *  current route to sessionStorage before unload. The next page reads it on
 *  load and uses it as the `from` field - giving accurate from→to tracking
 *  even across hard navigations.
 */
const MPA_FROM_KEY = '__tracker_mpa_from__';

function saveCurrentRouteForNextPage() {
	try {
		sessionStorage.setItem(MPA_FROM_KEY, window.location.pathname + window.location.search);
	} catch { /* sessionStorage unavailable (e.g. private browsing restrictions) */ }
}

function consumePreviousRoute(): string {
	try {
		const saved = sessionStorage.getItem(MPA_FROM_KEY);
		sessionStorage.removeItem(MPA_FROM_KEY);
		return saved ?? '';
	} catch {
		return '';
	}
}

function referrerPath(): string {
	try {
		// INFO document.referrer is the full URL of the previous page: extract pathname only and only use it if it's the same origin (cross-origin referrers are not useful)
		if (!document.referrer) {
			return '';
		}
		const ref = new URL(document.referrer);
		if (ref.origin !== window.location.origin) {
			return ref.origin;  // INFO show origin for cross-origin
		}
		return ref.pathname + ref.search;
	} catch {
		return document.referrer;
	}
}

/**
 *  INFO MPA anchor interception
 *  Attach a capture-phase listener to <a> clicks so we can save the current
 *  route before the browser navigates away. This works for:
 *    - Regular <a href="/page"> links
 *    - Links opened in the same tab (no target="_blank")
 *
 *  We do NOT prevent navigation — we just save state before it happens.
 */
function setupMpaLinkInterceptor(): () => void {
	function onAnchorClick(e: MouseEvent) {
		const anchor = (e.target as Element)?.closest('a');
		if (!anchor) {
			return;
		}
		const href = anchor.getAttribute('href');
		if (!href) {
			return;
		}

		// INFO Skip: new tab, external, mailto, tel, hash-only, javascript:
		if (
			anchor.target === '_blank' ||
			anchor.target === '_parent' ||
			href.startsWith('http') ||
			href.startsWith('//') ||
			href.startsWith('mailto:') ||
			href.startsWith('tel:') ||
			href.startsWith('javascript:') ||
			href.startsWith('#')
		) {
			return;
		}

		// INFO This is a same-origin navigation — save current route before leaving
		saveCurrentRouteForNextPage();
	}

	// INFO Use capture phase so we run before any app click handlers that might call stopPropagation()
	document.addEventListener('click', onAnchorClick, { capture: true });
	return () => document.removeEventListener('click', onAnchorClick, { capture: true });
}

export function setupNavigationTracker(onEvent: (payload: NavigationPayload) => void): () => void {
	if (typeof window === 'undefined') {
		return () => { };
	}

	let currentRoute = window.location.pathname + window.location.search;
	let routeStart = performance.now();

	function navigate(to: string, trigger: NavigationPayload['trigger'], fromOverride?: string) {
		const from = fromOverride ?? currentRoute;
		const duration = Math.round(performance.now() - routeStart);
		currentRoute = to;
		routeStart = performance.now();
		if (from === to && trigger !== 'load') {
			return;  // ignore no-op replaceState calls
		}
		onEvent({ from, to, trigger, duration });
	}

	// INFO SPA: patch history API
	const originalPushState = history.pushState.bind(history);
	const originalReplaceState = history.replaceState.bind(history);

	history.pushState = function (...args) {
		originalPushState(...args);
		navigate(window.location.pathname + window.location.search, 'pushState');
	}

	history.replaceState = function (...args) {
		originalReplaceState(...args);
		navigate(window.location.pathname + window.location.search, 'replaceState');
	}

	const onPopState = () => navigate(window.location.pathname + window.location.search, 'popstate');
	const onHashChange = () => navigate(window.location.pathname + window.location.hash, 'hashchange');

	window.addEventListener('popstate', onPopState);
	window.addEventListener('hashchange', onHashChange);

	// INFO MPA: anchor link interceptor
	const teardownMpa = setupMpaLinkInterceptor();

	/**
	 * ── Initial page load ────────────────────────────────────────────────────
	 * Determine the `from` for this page load:
	 *   1. MPA: read sessionStorage key saved by the previous page (most accurate)
	 *   2. Fallback: document.referrer (same-origin pathname)
	 *   3. Empty string if first visit or cross-origin
	 */
	const savedFrom = consumePreviousRoute();
	const from = savedFrom || referrerPath();

	navigate(currentRoute, 'load', from);

	return () => {
		history.pushState = originalPushState;
		history.replaceState = originalReplaceState;
		window.removeEventListener('popstate', onPopState);
		window.removeEventListener('hashchange', onHashChange);
		teardownMpa();
	}
}
