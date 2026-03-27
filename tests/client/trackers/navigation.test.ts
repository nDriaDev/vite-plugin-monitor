import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { NavigationPayload } from '../../../src/types';
import { setupNavigationTracker } from '../../../src/client/trackers/navigation';

type CapturedNav = NavigationPayload;

function makeOnEvent(): { onEvent: (p: NavigationPayload) => void; events: CapturedNav[] } {
	const events: CapturedNav[] = [];
	return { events, onEvent: (p) => events.push(p) };
}

const MPA_FROM_KEY = '__tracker_mpa_from__';

let teardown: () => void;

const originalPushState = history.pushState.bind(history);
const originalReplaceState = history.replaceState.bind(history);

afterEach(() => {
	teardown?.();
	history.pushState = originalPushState;
	history.replaceState = originalReplaceState;
	sessionStorage.removeItem(MPA_FROM_KEY);
});

describe('initial load', () => {
	it('emette una navigation con trigger "load" al setup', () => {
		const { onEvent, events } = makeOnEvent();
		teardown = setupNavigationTracker(onEvent);

		expect(events).toHaveLength(1);
		expect(events[0].trigger).toBe('load');
		expect(events[0].to).toBe(window.location.pathname + window.location.search);
	});

	it('from = consumePreviousRoute() when the MPA key is in sessionStorage', () => {
		sessionStorage.setItem(MPA_FROM_KEY, '/previous-page');

		const { onEvent, events } = makeOnEvent();
		teardown = setupNavigationTracker(onEvent);

		expect(events[0].from).toBe('/previous-page');
		// La chiave deve essere stata consumata (rimossa)
		expect(sessionStorage.getItem(MPA_FROM_KEY)).toBeNull();
	});

	it('from = referrerPath() (same origin) when sessionStorage is empty', () => {
		// Imposta document.referrer tramite Object.defineProperty
		Object.defineProperty(document, 'referrer', {
			configurable: true,
			get: () => window.location.origin + '/from-referrer',
		});

		const { onEvent, events } = makeOnEvent();
		teardown = setupNavigationTracker(onEvent);

		expect(events[0].from).toBe('/from-referrer');

		Object.defineProperty(document, 'referrer', { configurable: true, get: () => '' });
	});

	it('from = referrerPath() show only the origin for cross-origin referrers', () => {
		Object.defineProperty(document, 'referrer', {
			configurable: true,
			get: () => 'https://external.example.com/some/path',
		});

		const { onEvent, events } = makeOnEvent();
		teardown = setupNavigationTracker(onEvent);

		expect(events[0].from).toBe('https://external.example.com');

		Object.defineProperty(document, 'referrer', { configurable: true, get: () => '' });
	});

	it('from = currentRoute when neither sessionStorage nor referrer are available', () => {
		const { onEvent, events } = makeOnEvent();
		teardown = setupNavigationTracker(onEvent);

		const currentRoute = window.location.pathname + window.location.search;
		expect(events[0].from).toBe(currentRoute);
		expect(events[0].to).toBe(currentRoute);
	});

	it('consumePreviousRoute: error in sessionStorage -> savedFrom is an empty string', () => {
		const originalSessionStorage = globalThis.sessionStorage;

		const fakeSessionStorage = {
			getItem: () => { throw new Error('boom'); },
			setItem: () => { },
			removeItem: () => { },
			clear: () => { },
			key: () => null,
			length: 0,
		};

		Object.defineProperty(globalThis, 'sessionStorage', {
			configurable: true,
			value: fakeSessionStorage,
		});

		const { onEvent, events } = makeOnEvent();
		teardown = setupNavigationTracker(onEvent);

		expect(events[0].from).toBe(window.location.pathname + window.location.search);

		Object.defineProperty(globalThis, 'sessionStorage', {
			configurable: true,
			value: originalSessionStorage,
		});
	});

	it('referrerPath: invalid referrer -> returns document.referrer in catch', () => {
		Object.defineProperty(document, 'referrer', {
			configurable: true,
			get: () => '::::not-a-valid-url::::',
		});

		const { onEvent, events } = makeOnEvent();
		teardown = setupNavigationTracker(onEvent);

		expect(events[0].from).toBe('::::not-a-valid-url::::');

		Object.defineProperty(document, 'referrer', { configurable: true, get: () => '' });
	});

});

describe('pushState', () => {
	it('history.pushState() outputs navigation with "pushState" trigger', () => {
		const { onEvent, events } = makeOnEvent();
		teardown = setupNavigationTracker(onEvent);
		const initialCount = events.length;

		history.pushState({}, '', '/nuova-pagina');

		expect(events.length).toBe(initialCount + 1);
		expect(events[events.length - 1].trigger).toBe('pushState');
		expect(events[events.length - 1].to).toBe('/nuova-pagina');
	});

	it('pushState updates "from" with the previous route', () => {
		const { onEvent, events } = makeOnEvent();
		teardown = setupNavigationTracker(onEvent);

		const fromRoute = window.location.pathname + window.location.search;
		history.pushState({}, '', '/destinazione');

		const nav = events[events.length - 1];
		expect(nav.from).toBe(fromRoute);
		expect(nav.to).toBe('/destinazione');
	});

	it('pushState with the same path is a no-op (does not emit event)', () => {
		const { onEvent, events } = makeOnEvent();
		teardown = setupNavigationTracker(onEvent);

		const currentPath = window.location.pathname;
		const before = events.length;
		history.pushState({ state: 'changed' }, '', currentPath);

		expect(events.length).toBe(before);
	});

	it('duration is calculated correctly between two pushState calls', () => {
		vi.useFakeTimers();
		const { onEvent, events } = makeOnEvent();
		teardown = setupNavigationTracker(onEvent);

		history.pushState({}, '', '/pagina-a');
		vi.advanceTimersByTime(300);
		history.pushState({}, '', '/pagina-b');

		const last = events[events.length - 1];
		expect(last.duration).toBeGreaterThanOrEqual(300);
		vi.useRealTimers();
	});
});

describe('replaceState', () => {

	it('history.replaceState() outputs navigation with "replaceState" trigger', () => {
		const { onEvent, events } = makeOnEvent();
		teardown = setupNavigationTracker(onEvent);
		const initialCount = events.length;

		history.replaceState({}, '', '/rimpiazzata');

		expect(events.length).toBe(initialCount + 1);
		expect(events[events.length - 1].trigger).toBe('replaceState');
		expect(events[events.length - 1].to).toBe('/rimpiazzata');
	});

	it('replaceState with the same path -> no-op (does not emit event)', () => {
		const { onEvent, events } = makeOnEvent();
		teardown = setupNavigationTracker(onEvent);

		const currentPath = window.location.pathname;
		const before = events.length;
		history.replaceState({}, '', currentPath);

		expect(events.length).toBe(before);
	});
});

describe('popstate / hashchange', () => {

	let _realLocation: Location;
	beforeEach(() => {
		_realLocation = window.location;
	});
	afterEach(() => {
		Object.defineProperty(window, 'location', {
			configurable: true,
			get: () => _realLocation,
		});
	});

	it('PopStateEvent -> navigation con trigger "popstate"', () => {
		const { onEvent, events } = makeOnEvent();
		teardown = setupNavigationTracker(onEvent);
		const before = events.length;

		history.pushState({}, '', '/pagina-x');
		window.dispatchEvent(new PopStateEvent('popstate', { bubbles: true }));

		expect(events.length).toBeGreaterThan(before);
		const popNav = events.find(e => e.trigger === 'popstate');
		expect(popNav).toBeDefined();
	});

	it('HashChangeEvent -> navigation con trigger "hashchange"', () => {
		const { onEvent, events } = makeOnEvent();
		teardown = setupNavigationTracker(onEvent);
		const before = events.length;

		window.dispatchEvent(new HashChangeEvent('hashchange', { bubbles: true }));

		expect(events.length).toBe(before + 1);
		expect(events[events.length - 1].trigger).toBe('hashchange');
	});

	it('hashchange includes the fragment (#hash) in the "to" field', () => {
		const { onEvent, events } = makeOnEvent();
		teardown = setupNavigationTracker(onEvent);

		const realLocation = window.location;
		const savedOrigin = realLocation.origin;
		const savedHref = realLocation.origin + '/pagina#sezione';

		Object.defineProperty(window, 'location', {
			configurable: true,
			get: () => ({
				pathname: '/pagina',
				search: '',
				hash: '#sezione',
				origin: savedOrigin,
				href: savedHref,
				host: realLocation.host,
				hostname: realLocation.hostname,
				port: realLocation.port,
				protocol: realLocation.protocol,
			}),
		});

		window.dispatchEvent(new HashChangeEvent('hashchange', { bubbles: true }));

		const last = events[events.length - 1];
		expect(last.to).toContain('#sezione');

		Object.defineProperty(window, 'location', {
			configurable: true,
			get: () => realLocation,
		});
	});
});

describe('ignorePaths', () => {

	it('navigation to ignored path -> suppressed', () => {
		const { onEvent, events } = makeOnEvent();
		teardown = setupNavigationTracker(onEvent, ['/_dashboard']);

		const afterLoad = events.length;

		history.pushState({}, '', '/_dashboard');

		expect(events.length).toBe(afterLoad);
	});

	it('navigation from ignored path -> suppressed', () => {
		const { onEvent, events } = makeOnEvent();
		teardown = setupNavigationTracker(onEvent, ['/_dashboard']);

		history.pushState({}, '', '/_dashboard');
		const afterDashboard = events.length;

		history.pushState({}, '', '/app');
		expect(events.length).toBe(afterDashboard);
	});

	it('navigation between non-ignored paths with ignorePaths configured -> emitted', () => {
		const { onEvent, events } = makeOnEvent();
		teardown = setupNavigationTracker(onEvent, ['/_dashboard']);

		const before = events.length;
		history.pushState({}, '', '/pagina-normale');

		expect(events.length).toBe(before + 1);
		expect(events[events.length - 1].to).toBe('/pagina-normale');
	});

	it('empty ignorePaths -> no suppression', () => {
		const { onEvent, events } = makeOnEvent();
		teardown = setupNavigationTracker(onEvent, []);

		const before = events.length;
		history.pushState({}, '', '/qualsiasi');
		expect(events.length).toBe(before + 1);
	});

	it('ignorePaths with empty string suppresses nothing', () => {
		const { onEvent, events } = makeOnEvent();
		teardown = setupNavigationTracker(onEvent, ['']);

		const before = events.length;
		history.pushState({}, '', '/qualsiasi-empty-string');
		expect(events.length).toBe(before + 1);
	});
});

describe('MPA link interceptor', () => {

	function makeAnchor(href: string, target?: string): HTMLAnchorElement {
		const a = document.createElement('a');
		a.href = href;
		if (target) a.target = target;
		document.body.appendChild(a);
		return a;
	}

	afterEach(() => {
		document.querySelectorAll('a[href]').forEach(a => a.remove());
	});

	it('Click <a href="/pagina"> to save the current route to sessionStorage.', () => {
		const { onEvent } = makeOnEvent();
		teardown = setupNavigationTracker(onEvent);

		const a = makeAnchor('/altra-pagina');
		a.dispatchEvent(new MouseEvent('click', { bubbles: true }));

		expect(sessionStorage.getItem(MPA_FROM_KEY)).toBe(
			window.location.pathname + window.location.search
		);
	});

	it('click su <a target="_blank"> -> non salva in sessionStorage', () => {
		const { onEvent } = makeOnEvent();
		teardown = setupNavigationTracker(onEvent);

		const a = makeAnchor('/altra-pagina', '_blank');
		a.dispatchEvent(new MouseEvent('click', { bubbles: true }));

		expect(sessionStorage.getItem(MPA_FROM_KEY)).toBeNull();
	});

	it('click su <a target="_parent"> -> non salva in sessionStorage', () => {
		const { onEvent } = makeOnEvent();
		teardown = setupNavigationTracker(onEvent);

		const a = makeAnchor('/altra-pagina', '_parent');
		a.dispatchEvent(new MouseEvent('click', { bubbles: true }));

		expect(sessionStorage.getItem(MPA_FROM_KEY)).toBeNull();
	});

	it('click su <a href="http://..."> (link esterno) -> non salva', () => {
		const { onEvent } = makeOnEvent();
		teardown = setupNavigationTracker(onEvent);

		const a = makeAnchor('http://external.example.com/page');
		a.dispatchEvent(new MouseEvent('click', { bubbles: true }));

		expect(sessionStorage.getItem(MPA_FROM_KEY)).toBeNull();
	});

	it('click su <a href="//cdn.example.com/..."> -> non salva', () => {
		const { onEvent } = makeOnEvent();
		teardown = setupNavigationTracker(onEvent);

		const a = document.createElement('a');
		a.setAttribute('href', '//cdn.example.com/file.js');
		document.body.appendChild(a);
		a.dispatchEvent(new MouseEvent('click', { bubbles: true }));

		expect(sessionStorage.getItem(MPA_FROM_KEY)).toBeNull();
	});

	it('click su <a href="mailto:..."> -> non salva', () => {
		const { onEvent } = makeOnEvent();
		teardown = setupNavigationTracker(onEvent);

		const a = makeAnchor('mailto:user@example.com');
		a.dispatchEvent(new MouseEvent('click', { bubbles: true }));

		expect(sessionStorage.getItem(MPA_FROM_KEY)).toBeNull();
	});

	it('click su <a href="tel:..."> -> non salva', () => {
		const { onEvent } = makeOnEvent();
		teardown = setupNavigationTracker(onEvent);

		const a = makeAnchor('tel:+39012345678');
		a.dispatchEvent(new MouseEvent('click', { bubbles: true }));

		expect(sessionStorage.getItem(MPA_FROM_KEY)).toBeNull();
	});

	it('click su <a href="#hash"> -> non salva', () => {
		const { onEvent } = makeOnEvent();
		teardown = setupNavigationTracker(onEvent);

		const a = makeAnchor('#sezione');
		a.dispatchEvent(new MouseEvent('click', { bubbles: true }));

		expect(sessionStorage.getItem(MPA_FROM_KEY)).toBeNull();
	});

	it('click su <a href="javascript:..."> -> non salva', () => {
		const { onEvent } = makeOnEvent();
		teardown = setupNavigationTracker(onEvent);

		const a = document.createElement('a');
		a.setAttribute('href', 'javascript:void(0)');
		document.body.appendChild(a);
		a.dispatchEvent(new MouseEvent('click', { bubbles: true }));

		expect(sessionStorage.getItem(MPA_FROM_KEY)).toBeNull();
	});

	it('click on non-anchor element saves nothing', () => {
		const { onEvent } = makeOnEvent();
		teardown = setupNavigationTracker(onEvent);

		const btn = document.createElement('button');
		document.body.appendChild(btn);
		btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));

		expect(sessionStorage.getItem(MPA_FROM_KEY)).toBeNull();
		btn.remove();
	});

	it('click on child element of <a> (delegation) saves the route', () => {
		const { onEvent } = makeOnEvent();
		teardown = setupNavigationTracker(onEvent);

		const a = makeAnchor('/pagina-delegata');
		const span = document.createElement('span');
		span.textContent = 'label';
		a.appendChild(span);

		span.dispatchEvent(new MouseEvent('click', { bubbles: true }));

		expect(sessionStorage.getItem(MPA_FROM_KEY)).toBe(
			window.location.pathname + window.location.search
		);
	});

	it('click on <a> without href -> does not save anything in sessionStorage', () => {
		const { onEvent } = makeOnEvent();
		teardown = setupNavigationTracker(onEvent);

		const a = document.createElement('a');
		document.body.appendChild(a);

		a.dispatchEvent(new MouseEvent('click', { bubbles: true }));

		expect(sessionStorage.getItem(MPA_FROM_KEY)).toBeNull();

		a.remove();
	});

});

describe('teardown', () => {

	it('restores original history.pushState', () => {
		const { onEvent } = makeOnEvent();
		const td = setupNavigationTracker(onEvent);
		const patchedPush = history.pushState;

		td();

		expect(history.pushState).not.toBe(patchedPush);
		expect(history.pushState).toBe(originalPushState);
	});

	it('restores original history.replaceState', () => {
		const { onEvent } = makeOnEvent();
		const td = setupNavigationTracker(onEvent);
		const patchedReplace = history.replaceState;

		td();

		expect(history.replaceState).not.toBe(patchedReplace);
		expect(history.replaceState).toBe(originalReplaceState);
	});

	it('after teardown, pushState no longer emits events', () => {
		const { onEvent, events } = makeOnEvent();
		const td = setupNavigationTracker(onEvent);
		td();

		const before = events.length;
		originalPushState.call(history, {}, '', '/dopo-teardown');
		expect(events.length).toBe(before);
	});

	it('after teardown, popstate no longer emits events', () => {
		const { onEvent, events } = makeOnEvent();
		const td = setupNavigationTracker(onEvent);
		td();

		const before = events.length;
		window.dispatchEvent(new PopStateEvent('popstate', { bubbles: true }));
		expect(events.length).toBe(before);
	});

	it('after teardown, hashchange no longer emits events', () => {
		const { onEvent, events } = makeOnEvent();
		const td = setupNavigationTracker(onEvent);
		td();

		const before = events.length;
		window.dispatchEvent(new HashChangeEvent('hashchange', { bubbles: true }));
		expect(events.length).toBe(before);
	});

	it('after teardown, click on <a> no longer saves in sessionStorage', () => {
		const { onEvent } = makeOnEvent();
		const td = setupNavigationTracker(onEvent);
		td();

		const a = document.createElement('a');
		a.setAttribute('href', '/pagina');
		document.body.appendChild(a);
		a.dispatchEvent(new MouseEvent('click', { bubbles: true }));

		expect(sessionStorage.getItem(MPA_FROM_KEY)).toBeNull();
		a.remove();
	});
});
