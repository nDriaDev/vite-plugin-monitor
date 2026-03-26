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

describe('load iniziale', () => {
	it('emette una navigation con trigger "load" al setup', () => {
		const { onEvent, events } = makeOnEvent();
		teardown = setupNavigationTracker(onEvent);

		expect(events).toHaveLength(1);
		expect(events[0].trigger).toBe('load');
		expect(events[0].to).toBe(window.location.pathname + window.location.search);
	});

	it('from = consumePreviousRoute() se la chiave MPA è in sessionStorage', () => {
		sessionStorage.setItem(MPA_FROM_KEY, '/previous-page');

		const { onEvent, events } = makeOnEvent();
		teardown = setupNavigationTracker(onEvent);

		expect(events[0].from).toBe('/previous-page');
		// La chiave deve essere stata consumata (rimossa)
		expect(sessionStorage.getItem(MPA_FROM_KEY)).toBeNull();
	});

	it('from = referrerPath() (stesso origine) se sessionStorage è vuoto', () => {
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

	it('from = referrerPath() mostra solo l\'origin per referrer cross-origin', () => {
		Object.defineProperty(document, 'referrer', {
			configurable: true,
			get: () => 'https://external.example.com/some/path',
		});

		const { onEvent, events } = makeOnEvent();
		teardown = setupNavigationTracker(onEvent);

		expect(events[0].from).toBe('https://external.example.com');

		Object.defineProperty(document, 'referrer', { configurable: true, get: () => '' });
	});

	it('from = currentRoute se né sessionStorage né referrer sono disponibili', () => {
		const { onEvent, events } = makeOnEvent();
		teardown = setupNavigationTracker(onEvent);

		const currentRoute = window.location.pathname + window.location.search;
		expect(events[0].from).toBe(currentRoute);
		expect(events[0].to).toBe(currentRoute);
	});

	it('consumePreviousRoute: errore in sessionStorage → savedFrom è stringa vuota', () => {
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

	it('referrerPath: referrer non valido → ritorna document.referrer nel catch', () => {
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
	it('history.pushState() emette navigation con trigger "pushState"', () => {
		const { onEvent, events } = makeOnEvent();
		teardown = setupNavigationTracker(onEvent);
		const initialCount = events.length;

		history.pushState({}, '', '/nuova-pagina');

		expect(events.length).toBe(initialCount + 1);
		expect(events[events.length - 1].trigger).toBe('pushState');
		expect(events[events.length - 1].to).toBe('/nuova-pagina');
	});

	it('pushState aggiorna "from" con la route precedente', () => {
		const { onEvent, events } = makeOnEvent();
		teardown = setupNavigationTracker(onEvent);

		const fromRoute = window.location.pathname + window.location.search;
		history.pushState({}, '', '/destinazione');

		const nav = events[events.length - 1];
		expect(nav.from).toBe(fromRoute);
		expect(nav.to).toBe('/destinazione');
	});

	it('pushState con stessa path è un no-op (non emette evento)', () => {
		const { onEvent, events } = makeOnEvent();
		teardown = setupNavigationTracker(onEvent);

		const currentPath = window.location.pathname;
		const before = events.length;
		history.pushState({ state: 'changed' }, '', currentPath);

		expect(events.length).toBe(before);
	});

	it('duration è calcolato correttamente tra due pushState', () => {
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

	it('history.replaceState() emette navigation con trigger "replaceState"', () => {
		const { onEvent, events } = makeOnEvent();
		teardown = setupNavigationTracker(onEvent);
		const initialCount = events.length;

		history.replaceState({}, '', '/rimpiazzata');

		expect(events.length).toBe(initialCount + 1);
		expect(events[events.length - 1].trigger).toBe('replaceState');
		expect(events[events.length - 1].to).toBe('/rimpiazzata');
	});

	it('replaceState con stessa path → no-op (non emette evento)', () => {
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

	it('PopStateEvent → navigation con trigger "popstate"', () => {
		const { onEvent, events } = makeOnEvent();
		teardown = setupNavigationTracker(onEvent);
		const before = events.length;

		history.pushState({}, '', '/pagina-x');
		window.dispatchEvent(new PopStateEvent('popstate', { bubbles: true }));

		expect(events.length).toBeGreaterThan(before);
		const popNav = events.find(e => e.trigger === 'popstate');
		expect(popNav).toBeDefined();
	});

	it('HashChangeEvent → navigation con trigger "hashchange"', () => {
		const { onEvent, events } = makeOnEvent();
		teardown = setupNavigationTracker(onEvent);
		const before = events.length;

		window.dispatchEvent(new HashChangeEvent('hashchange', { bubbles: true }));

		expect(events.length).toBe(before + 1);
		expect(events[events.length - 1].trigger).toBe('hashchange');
	});

	it('hashchange include il fragment (#hash) nel campo "to"', () => {
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

	it('navigazione verso path ignorata → soppressa', () => {
		const { onEvent, events } = makeOnEvent();
		teardown = setupNavigationTracker(onEvent, ['/_dashboard']);

		const afterLoad = events.length;

		history.pushState({}, '', '/_dashboard');

		expect(events.length).toBe(afterLoad);
	});

	it('navigazione da path ignorata → soppressa', () => {
		const { onEvent, events } = makeOnEvent();
		teardown = setupNavigationTracker(onEvent, ['/_dashboard']);

		history.pushState({}, '', '/_dashboard');
		const afterDashboard = events.length;

		history.pushState({}, '', '/app');
		expect(events.length).toBe(afterDashboard);
	});

	it('navigazione tra path non ignorate con ignorePaths configurato → emessa', () => {
		const { onEvent, events } = makeOnEvent();
		teardown = setupNavigationTracker(onEvent, ['/_dashboard']);

		const before = events.length;
		history.pushState({}, '', '/pagina-normale');

		expect(events.length).toBe(before + 1);
		expect(events[events.length - 1].to).toBe('/pagina-normale');
	});

	it('ignorePaths vuoto → nessuna soppressione', () => {
		const { onEvent, events } = makeOnEvent();
		teardown = setupNavigationTracker(onEvent, []);

		const before = events.length;
		history.pushState({}, '', '/qualsiasi');
		expect(events.length).toBe(before + 1);
	});

	it('ignorePaths con stringa vuota non sopprime nulla', () => {
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

	it('click su <a href="/pagina"> salva la route corrente in sessionStorage', () => {
		const { onEvent } = makeOnEvent();
		teardown = setupNavigationTracker(onEvent);

		const a = makeAnchor('/altra-pagina');
		a.dispatchEvent(new MouseEvent('click', { bubbles: true }));

		expect(sessionStorage.getItem(MPA_FROM_KEY)).toBe(
			window.location.pathname + window.location.search
		);
	});

	it('click su <a target="_blank"> → non salva in sessionStorage', () => {
		const { onEvent } = makeOnEvent();
		teardown = setupNavigationTracker(onEvent);

		const a = makeAnchor('/altra-pagina', '_blank');
		a.dispatchEvent(new MouseEvent('click', { bubbles: true }));

		expect(sessionStorage.getItem(MPA_FROM_KEY)).toBeNull();
	});

	it('click su <a target="_parent"> → non salva in sessionStorage', () => {
		const { onEvent } = makeOnEvent();
		teardown = setupNavigationTracker(onEvent);

		const a = makeAnchor('/altra-pagina', '_parent');
		a.dispatchEvent(new MouseEvent('click', { bubbles: true }));

		expect(sessionStorage.getItem(MPA_FROM_KEY)).toBeNull();
	});

	it('click su <a href="http://..."> (link esterno) → non salva', () => {
		const { onEvent } = makeOnEvent();
		teardown = setupNavigationTracker(onEvent);

		const a = makeAnchor('http://external.example.com/page');
		a.dispatchEvent(new MouseEvent('click', { bubbles: true }));

		expect(sessionStorage.getItem(MPA_FROM_KEY)).toBeNull();
	});

	it('click su <a href="//cdn.example.com/..."> → non salva', () => {
		const { onEvent } = makeOnEvent();
		teardown = setupNavigationTracker(onEvent);

		const a = document.createElement('a');
		a.setAttribute('href', '//cdn.example.com/file.js');
		document.body.appendChild(a);
		a.dispatchEvent(new MouseEvent('click', { bubbles: true }));

		expect(sessionStorage.getItem(MPA_FROM_KEY)).toBeNull();
	});

	it('click su <a href="mailto:..."> → non salva', () => {
		const { onEvent } = makeOnEvent();
		teardown = setupNavigationTracker(onEvent);

		const a = makeAnchor('mailto:user@example.com');
		a.dispatchEvent(new MouseEvent('click', { bubbles: true }));

		expect(sessionStorage.getItem(MPA_FROM_KEY)).toBeNull();
	});

	it('click su <a href="tel:..."> → non salva', () => {
		const { onEvent } = makeOnEvent();
		teardown = setupNavigationTracker(onEvent);

		const a = makeAnchor('tel:+39012345678');
		a.dispatchEvent(new MouseEvent('click', { bubbles: true }));

		expect(sessionStorage.getItem(MPA_FROM_KEY)).toBeNull();
	});

	it('click su <a href="#hash"> → non salva', () => {
		const { onEvent } = makeOnEvent();
		teardown = setupNavigationTracker(onEvent);

		const a = makeAnchor('#sezione');
		a.dispatchEvent(new MouseEvent('click', { bubbles: true }));

		expect(sessionStorage.getItem(MPA_FROM_KEY)).toBeNull();
	});

	it('click su <a href="javascript:..."> → non salva', () => {
		const { onEvent } = makeOnEvent();
		teardown = setupNavigationTracker(onEvent);

		const a = document.createElement('a');
		a.setAttribute('href', 'javascript:void(0)');
		document.body.appendChild(a);
		a.dispatchEvent(new MouseEvent('click', { bubbles: true }));

		expect(sessionStorage.getItem(MPA_FROM_KEY)).toBeNull();
	});

	it('click su elemento non-anchor non salva nulla', () => {
		const { onEvent } = makeOnEvent();
		teardown = setupNavigationTracker(onEvent);

		const btn = document.createElement('button');
		document.body.appendChild(btn);
		btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));

		expect(sessionStorage.getItem(MPA_FROM_KEY)).toBeNull();
		btn.remove();
	});

	it('click su elemento figlio di <a> (delegazione) salva la route', () => {
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

	it('click su <a> senza href → non salva nulla in sessionStorage', () => {
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

	it('ripristina history.pushState originale', () => {
		const { onEvent } = makeOnEvent();
		const td = setupNavigationTracker(onEvent);
		const patchedPush = history.pushState;

		td();

		expect(history.pushState).not.toBe(patchedPush);
		expect(history.pushState).toBe(originalPushState);
	});

	it('ripristina history.replaceState originale', () => {
		const { onEvent } = makeOnEvent();
		const td = setupNavigationTracker(onEvent);
		const patchedReplace = history.replaceState;

		td();

		expect(history.replaceState).not.toBe(patchedReplace);
		expect(history.replaceState).toBe(originalReplaceState);
	});

	it('dopo teardown, pushState non emette più eventi', () => {
		const { onEvent, events } = makeOnEvent();
		const td = setupNavigationTracker(onEvent);
		td();

		const before = events.length;
		originalPushState.call(history, {}, '', '/dopo-teardown');
		expect(events.length).toBe(before);
	});

	it('dopo teardown, popstate non emette più eventi', () => {
		const { onEvent, events } = makeOnEvent();
		const td = setupNavigationTracker(onEvent);
		td();

		const before = events.length;
		window.dispatchEvent(new PopStateEvent('popstate', { bubbles: true }));
		expect(events.length).toBe(before);
	});

	it('dopo teardown, hashchange non emette più eventi', () => {
		const { onEvent, events } = makeOnEvent();
		const td = setupNavigationTracker(onEvent);
		td();

		const before = events.length;
		window.dispatchEvent(new HashChangeEvent('hashchange', { bubbles: true }));
		expect(events.length).toBe(before);
	});

	it('dopo teardown, click su <a> non salva più in sessionStorage', () => {
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
