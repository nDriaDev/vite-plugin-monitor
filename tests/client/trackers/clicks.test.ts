import { describe, it, expect, afterEach, vi } from 'vitest';
import { setupClickTracker } from '../../../src/client/trackers/clicks';
import type { ClickPayload } from '../../../src/types';

function click(target: Element, opts: MouseEventInit = {}, onEvent: (p: ClickPayload) => void = vi.fn()): ClickPayload {
	let captured: ClickPayload | undefined;
	const wrapped = (p: ClickPayload) => {
		captured = p
		onEvent(p)
	}
	const teardown = setupClickTracker(wrapped);
	target.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, ...opts }));
	teardown();
	if (!captured) {
		throw new Error('onEvent non è stato chiamato');
	}
	return captured;
}

function buildChain(depth: number, tags?: string[]): Element {
	const root = document.createElement(tags?.[0] ?? 'div');
	document.body.appendChild(root);
	let current: Element = root;
	for (let i = 1; i < depth; i++) {
		const child = document.createElement(tags?.[i] ?? 'div');
		current.appendChild(child);
		current = child;
	}
	return current;
}

afterEach(() => {
	document.body.innerHTML = '';
	vi.restoreAllMocks();
});

describe('setupClickTracker', () => {
	describe('SSR', () => {
		it('returns a no-op function when window is undefined', () => {
			vi.stubGlobal('window', undefined);
			const onEvent = vi.fn();
			const teardown = setupClickTracker(onEvent);
			expect(typeof teardown).toBe('function');
			expect(() => teardown()).not.toThrow();
			expect(onEvent).not.toHaveBeenCalled();
			vi.unstubAllGlobals();
		});
	});

	describe('base payload', () => {
		it('emits the tag in lowercase', () => {
			const btn = document.createElement('button');
			document.body.appendChild(btn);
			const payload = click(btn);
			expect(payload.tag).toBe('button');
		});

		it('outputs the trimmed text of the element', () => {
			const btn = document.createElement('button');
			btn.textContent = '  Salva  ';
			document.body.appendChild(btn);
			const payload = click(btn);
			expect(payload.text).toBe('Salva');
		});

		it('emits the clientX/clientY coordinates of the click', () => {
			const btn = document.createElement('button');
			document.body.appendChild(btn);
			const payload = click(btn, { clientX: 42, clientY: 77 });
			expect(payload.coordinates).toEqual({ x: 42, y: 77 });
		});

		it('emits id when present', () => {
			const div = document.createElement('div');
			div.id = 'my-div';
			document.body.appendChild(div);
			const payload = click(div);
			expect(payload.id).toBe('my-div');
		});

		it('id is undefined when the element has no id', () => {
			const div = document.createElement('div');
			document.body.appendChild(div);
			const payload = click(div);
			expect(payload.id).toBeUndefined();
		});

		it('emits classes when present', () => {
			const div = document.createElement('div');
			div.className = 'btn primary';
			document.body.appendChild(div);
			const payload = click(div);
			expect(payload.classes).toBe('btn primary');
		});

		it('classes is undefined when the element has no classes', () => {
			const div = document.createElement('div');
			document.body.appendChild(div);
			const payload = click(div);
			expect(payload.classes).toBeUndefined();
		});

		it('outputs xpath of the element', () => {
			const div = document.createElement('div');
			document.body.appendChild(div);
			const payload = click(div);
			expect(payload.xpath).toContain('div');
			expect(payload.xpath!.startsWith('/')).toBe(true);
		});
	});

	describe('text truncation', () => {
		it('text exactly 100 characters long is not truncated', () => {
			const div = document.createElement('div');
			div.textContent = 'x'.repeat(100);
			document.body.appendChild(div);
			const payload = click(div);
			expect(payload.text).toHaveLength(100);
		});

		it('text longer than 100 characters is truncated to 100', () => {
			const div = document.createElement('div');
			div.textContent = 'x'.repeat(101);
			document.body.appendChild(div);
			const payload = click(div);
			expect(payload.text).toHaveLength(100);
		});

		it('empty text produces an empty string', () => {
			const div = document.createElement('div');
			div.textContent = '';
			document.body.appendChild(div);
			const payload = click(div);
			expect(payload.text).toBe('');
		});
	});

	describe('className SVGAnimatedString', () => {
		it('handles className as SVGAnimatedString using baseVal', () => {
			const div = document.createElement('div');
			document.body.appendChild(div);

			Object.defineProperty(div, 'className', {
				configurable: true,
				get: () => ({ baseVal: 'svg-class' } as SVGAnimatedString)
			});

			const onEvent = vi.fn();
			const teardown = setupClickTracker(onEvent);
			div.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
			teardown();
			expect(onEvent).toHaveBeenCalledOnce();
			expect(onEvent.mock.calls[0][0].classes).toBe('svg-class');
		});

		it('classes is undefined when baseVal is an empty string', () => {
			const div = document.createElement('div');
			document.body.appendChild(div);

			Object.defineProperty(div, 'className', {
				configurable: true,
				get: () => ({ baseVal: '' } as SVGAnimatedString)
			});

			const onEvent = vi.fn();
			const teardown = setupClickTracker(onEvent);
			div.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
			teardown();

			expect(onEvent.mock.calls[0][0].classes).toBeUndefined();
		});
	});

	describe('ignorePaths', () => {
		it('click on path ignored does not emit event', () => {
			const onEvent = vi.fn();
			const teardown = setupClickTracker(onEvent, true, ['/']);
			const div = document.createElement('div');
			document.body.appendChild(div);
			div.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
			teardown();
			expect(onEvent).not.toHaveBeenCalled();
		});

		it('click on path not ignored emits event', () => {
			const onEvent = vi.fn();
			const teardown = setupClickTracker(onEvent, true, ['/dashboard']);
			const div = document.createElement('div');
			document.body.appendChild(div);
			div.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
			teardown();
			expect(onEvent).toHaveBeenCalledOnce();
		});

		it('uses startsWith: matching prefix suppresses the click', () => {
			const onEvent = vi.fn();
			const teardown = setupClickTracker(onEvent, true, ['/']);
			const btn = document.createElement('button');
			document.body.appendChild(btn);
			btn.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
			teardown();
			expect(onEvent).not.toHaveBeenCalled();
		});

		it('empty string in ignorePaths does not suppress the click', () => {
			const onEvent = vi.fn();
			const teardown = setupClickTracker(onEvent, true, ['']);
			const div = document.createElement('div');
			document.body.appendChild(div);
			div.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
			teardown();
			expect(onEvent).toHaveBeenCalledOnce();
		});

		it('empty ignorePaths does not suppress any click', () => {
			const onEvent = vi.fn();
			const teardown = setupClickTracker(onEvent);
			const div = document.createElement('div');
			document.body.appendChild(div);
			div.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
			teardown();
			expect(onEvent).toHaveBeenCalledOnce();
		});
	});

	describe('target without tagName', () => {
		it('Click on target without tagName does not emit the event', () => {
			const onEvent = vi.fn();
			const teardown = setupClickTracker(onEvent);

			const fakeEvent = new MouseEvent('click', { bubbles: true, composed: true });
			Object.defineProperty(fakeEvent, 'target', {
				value: { tagName: undefined },
				writable: false
			});
			document.dispatchEvent(fakeEvent);
			teardown();

			expect(onEvent).not.toHaveBeenCalled();
		});

		it('click with null target does not emit the event', () => {
			const onEvent = vi.fn();
			const teardown = setupClickTracker(onEvent);

			const fakeEvent = new MouseEvent('click', { bubbles: true, composed: true });
			Object.defineProperty(fakeEvent, 'target', {
				value: null,
				writable: false
			});
			document.dispatchEvent(fakeEvent);
			teardown();

			expect(onEvent).not.toHaveBeenCalled();
		});
	});

	describe('teardown', () => {
		it('after teardown() clicks no longer emit events', () => {
			const onEvent = vi.fn();
			const teardown = setupClickTracker(onEvent);
			const div = document.createElement('div');
			document.body.appendChild(div);
			teardown();
			div.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));

			expect(onEvent).not.toHaveBeenCalled();
		});

		it('calling teardown() twice does not throw errors', () => {
			const teardown = setupClickTracker(vi.fn());
			teardown();
			expect(() => teardown()).not.toThrow();
		});

		it('multiple independent trackers: the teardown of one does not deactivate the other', () => {
			const onEvent1 = vi.fn();
			const onEvent2 = vi.fn();
			const teardown1 = setupClickTracker(onEvent1);
			const teardown2 = setupClickTracker(onEvent2);

			const div = document.createElement('div');
			document.body.appendChild(div);

			teardown1();
			div.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
			teardown2();

			expect(onEvent1).not.toHaveBeenCalled();
			expect(onEvent2).toHaveBeenCalledOnce();
		});
	});

	describe('getXPath', () => {
		it('direct element in body -> simple xpath without index', () => {
			const div = document.createElement('div');
			document.body.appendChild(div);
			const payload = click(div);
			expect(payload.xpath).not.toContain('[');
		});

		it('adds [N] only to siblings with the same tag', () => {
			const container = document.createElement('div');
			document.body.appendChild(container);
			const s1 = document.createElement('span');
			const s2 = document.createElement('span');
			const s3 = document.createElement('span');
			container.appendChild(s1);
			container.appendChild(s2);
			container.appendChild(s3);

			const p1 = click(s1);
			const p2 = click(s2);
			const p3 = click(s3);

			expect(p1.xpath).toContain('span[1]');
			expect(p2.xpath).toContain('span[2]');
			expect(p3.xpath).toContain('span[3]');
		});

		it('siblings with different tags do not receive an index', () => {
			const container = document.createElement('div');
			document.body.appendChild(container);
			const span = document.createElement('span');
			const em = document.createElement('em');
			container.appendChild(span);
			container.appendChild(em);

			const ps = click(span);
			const pe = click(em);

			expect(ps.xpath).not.toContain('span[');
			expect(pe.xpath).not.toContain('em[');
		});

		it('respects maxDepth=8: deeper chain is truncated', () => {
			const deepest = buildChain(12);
			const payload = click(deepest);
			const segments = payload.xpath!.split('/').filter(Boolean);
			expect(segments.length).toBeLessThanOrEqual(8);
		});

		it('chain of exactly 8 levels produces 8 segments', () => {
			const deepest = buildChain(8);
			const payload = click(deepest);
			const segments = payload.xpath!.split('/').filter(Boolean);
			expect(segments.length).toBe(8);
		});

		it('xpath of the root element includes only its tag', () => {
			const floating = document.createElement('section');

			const onEvent = vi.fn();
			const teardown = setupClickTracker(onEvent);

			const fakeEvent = new MouseEvent('click', { bubbles: true, composed: true });
			Object.defineProperty(fakeEvent, 'target', {
				value: floating,
				writable: false
			});
			document.dispatchEvent(fakeEvent);
			teardown();

			expect(onEvent).toHaveBeenCalledOnce();
			const xpath: string = onEvent.mock.calls[0][0].xpath;
			expect(xpath).toBe('/section');
		});

		it('correct full path for simple nested structure', () => {
			const div = document.createElement('div');
			const btn = document.createElement('button');
			document.body.appendChild(div);
			div.appendChild(btn);

			const payload = click(btn);
			expect(payload.xpath).toBe('/html/body/div/button');
		});
	});

	describe('ignoreSelectors', () => {
		it('click on element matching a selector is suppressed', () => {
			const onEvent = vi.fn();
			const teardown = setupClickTracker(onEvent, { ignoreSelectors: ['[data-no-track]'] });
			const btn = document.createElement('button');
			btn.setAttribute('data-no-track', '');
			document.body.appendChild(btn);
			btn.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
			teardown();
			expect(onEvent).not.toHaveBeenCalled();
		});

		it('click on child of a matching selector is suppressed (closest() walk)', () => {
			const onEvent = vi.fn();
			const teardown = setupClickTracker(onEvent, { ignoreSelectors: ['#cookie-banner'] });
			const banner = document.createElement('div');
			banner.id = 'cookie-banner';
			const innerBtn = document.createElement('button');
			banner.appendChild(innerBtn);
			document.body.appendChild(banner);
			innerBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
			teardown();
			expect(onEvent).not.toHaveBeenCalled();
		});

		it('click on element NOT matching any selector is tracked normally', () => {
			const onEvent = vi.fn();
			const teardown = setupClickTracker(onEvent, { ignoreSelectors: ['[data-no-track]'] });
			const btn = document.createElement('button');
			document.body.appendChild(btn);
			btn.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
			teardown();
			expect(onEvent).toHaveBeenCalledOnce();
		});

		it('invalid CSS selector in ignoreSelectors does not throw — click is tracked', () => {
			const onEvent = vi.fn();
			const teardown = setupClickTracker(onEvent, { ignoreSelectors: ['[invalid selector!!!'] });
			const btn = document.createElement('button');
			document.body.appendChild(btn);
			btn.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
			teardown();
			// invalid selector is silently skipped, event should still be tracked
			expect(onEvent).toHaveBeenCalledOnce();
		});

		it('class-based selector suppresses matching click', () => {
			const onEvent = vi.fn();
			const teardown = setupClickTracker(onEvent, { ignoreSelectors: ['.dev-toolbar'] });
			const el = document.createElement('div');
			el.className = 'dev-toolbar';
			document.body.appendChild(el);
			el.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
			teardown();
			expect(onEvent).not.toHaveBeenCalled();
		});

		it('empty ignoreSelectors array does not suppress any click', () => {
			const onEvent = vi.fn();
			const teardown = setupClickTracker(onEvent, true, []);
			const btn = document.createElement('button');
			document.body.appendChild(btn);
			btn.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
			teardown();
			expect(onEvent).toHaveBeenCalledOnce();
		});
	});

	describe('ignoreRoutes', () => {
		it('string route: suppresses click when pathname equals the given string', () => {
			vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, pathname: '/admin/settings' } as Location);
			const onEvent = vi.fn();
			const teardown = setupClickTracker(onEvent, true, ['/admin/settings']);
			const btn = document.createElement('button');
			document.body.appendChild(btn);
			btn.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
			teardown();
			expect(onEvent).not.toHaveBeenCalled();
			vi.restoreAllMocks();
		});

		it('RegExp route: suppresses click when pattern matches', () => {
			vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, pathname: '/user/42' } as Location);
			const onEvent = vi.fn();
			const teardown = setupClickTracker(onEvent, true, [/^\/user\/\d+/]);
			const btn = document.createElement('button');
			document.body.appendChild(btn);
			btn.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
			teardown();
			expect(onEvent).not.toHaveBeenCalled();
			vi.restoreAllMocks();
		});

		it('click on a non-ignored route is tracked normally', () => {
			const onEvent = vi.fn();
			const teardown = setupClickTracker(onEvent, true, ['/admin']);
			const btn = document.createElement('button');
			document.body.appendChild(btn);
			btn.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
			teardown();
			// default jsdom pathname is '/', which doesn't start with '/admin'
			expect(onEvent).toHaveBeenCalledOnce();
		});

		it('empty ignoreRoutes does not suppress any click', () => {
			const onEvent = vi.fn();
			const teardown = setupClickTracker(onEvent, true, []);
			const btn = document.createElement('button');
			document.body.appendChild(btn);
			btn.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
			teardown();
			expect(onEvent).toHaveBeenCalledOnce();
		});
	});
});
