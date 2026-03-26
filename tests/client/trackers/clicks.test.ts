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
		it('restituisce una funzione no-op se window è undefined', () => {
			vi.stubGlobal('window', undefined);
			const onEvent = vi.fn();
			const teardown = setupClickTracker(onEvent);
			expect(typeof teardown).toBe('function');
			expect(() => teardown()).not.toThrow();
			expect(onEvent).not.toHaveBeenCalled();
			vi.unstubAllGlobals();
		});
	});

	describe('payload base', () => {
		it('emette il tag in lowercase', () => {
			const btn = document.createElement('button');
			document.body.appendChild(btn);
			const payload = click(btn);
			expect(payload.tag).toBe('button');
		});

		it('emette il testo trimmed dell\'elemento', () => {
			const btn = document.createElement('button');
			btn.textContent = '  Salva  ';
			document.body.appendChild(btn);
			const payload = click(btn);
			expect(payload.text).toBe('Salva');
		});

		it('emette le coordinate clientX/clientY del click', () => {
			const btn = document.createElement('button');
			document.body.appendChild(btn);
			const payload = click(btn, { clientX: 42, clientY: 77 });
			expect(payload.coordinates).toEqual({ x: 42, y: 77 });
		});

		it('emette id se presente', () => {
			const div = document.createElement('div');
			div.id = 'my-div';
			document.body.appendChild(div);
			const payload = click(div);
			expect(payload.id).toBe('my-div');
		});

		it('id è undefined se l\'elemento non ha un id', () => {
			const div = document.createElement('div');
			document.body.appendChild(div);
			const payload = click(div);
			expect(payload.id).toBeUndefined();
		});

		it('emette classes se presenti', () => {
			const div = document.createElement('div');
			div.className = 'btn primary';
			document.body.appendChild(div);
			const payload = click(div);
			expect(payload.classes).toBe('btn primary');
		});

		it('classes è undefined se l\'elemento non ha classi', () => {
			const div = document.createElement('div');
			document.body.appendChild(div);
			const payload = click(div);
			expect(payload.classes).toBeUndefined();
		});

		it('emette xpath dell\'elemento', () => {
			const div = document.createElement('div');
			document.body.appendChild(div);
			const payload = click(div);
			expect(payload.xpath).toContain('div');
			expect(payload.xpath!.startsWith('/')).toBe(true);
		});
	});

	describe('troncamento del testo', () => {
		it('testo esattamente lungo 100 caratteri non viene troncato', () => {
			const div = document.createElement('div');
			div.textContent = 'x'.repeat(100);
			document.body.appendChild(div);
			const payload = click(div);
			expect(payload.text).toHaveLength(100);
		});

		it('testo più lungo di 100 caratteri viene troncato a 100', () => {
			const div = document.createElement('div');
			div.textContent = 'x'.repeat(101);
			document.body.appendChild(div);
			const payload = click(div);
			expect(payload.text).toHaveLength(100);
		});

		it('testo vuoto produce una stringa vuota', () => {
			const div = document.createElement('div');
			div.textContent = '';
			document.body.appendChild(div);
			const payload = click(div);
			expect(payload.text).toBe('');
		});
	});

	describe('className SVGAnimatedString', () => {
		it('gestisce className come SVGAnimatedString usando baseVal', () => {
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

		it('classes è undefined se baseVal è stringa vuota', () => {
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
		it('click su path ignorata non emette l\'evento', () => {
			const onEvent = vi.fn();
			const teardown = setupClickTracker(onEvent, ['/']);
			const div = document.createElement('div');
			document.body.appendChild(div);
			div.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
			teardown();
			expect(onEvent).not.toHaveBeenCalled();
		});

		it('click su path non ignorata emette l\'evento', () => {
			const onEvent = vi.fn();
			const teardown = setupClickTracker(onEvent, ['/dashboard']);
			const div = document.createElement('div');
			document.body.appendChild(div);
			div.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
			teardown();
			expect(onEvent).toHaveBeenCalledOnce();
		});

		it('usa startsWith: prefisso corrispondente sopprime il click', () => {
			const onEvent = vi.fn();
			const teardown = setupClickTracker(onEvent, ['/']);
			const btn = document.createElement('button');
			document.body.appendChild(btn);
			btn.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
			teardown();
			expect(onEvent).not.toHaveBeenCalled();
		});

		it('stringa vuota in ignorePaths non sopprime il click', () => {
			const onEvent = vi.fn();
			const teardown = setupClickTracker(onEvent, ['']);
			const div = document.createElement('div');
			document.body.appendChild(div);
			div.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
			teardown();
			expect(onEvent).toHaveBeenCalledOnce();
		});

		it('ignorePaths vuoto non sopprime nessun click', () => {
			const onEvent = vi.fn();
			const teardown = setupClickTracker(onEvent);
			const div = document.createElement('div');
			document.body.appendChild(div);
			div.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
			teardown();
			expect(onEvent).toHaveBeenCalledOnce();
		});
	});

	describe('target senza tagName', () => {
		it('click su target senza tagName non emette l\'evento', () => {
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

		it('click con target null non emette l\'evento', () => {
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
		it('dopo teardown() i click non emettono più eventi', () => {
			const onEvent = vi.fn();
			const teardown = setupClickTracker(onEvent);
			const div = document.createElement('div');
			document.body.appendChild(div);
			teardown();
			div.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));

			expect(onEvent).not.toHaveBeenCalled();
		});

		it('chiamare teardown() due volte non lancia errori', () => {
			const teardown = setupClickTracker(vi.fn());
			teardown();
			expect(() => teardown()).not.toThrow();
		});

		it('più tracker indipendenti: il teardown di uno non disattiva l\'altro', () => {
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
		it('elemento diretto in body → xpath semplice senza indice', () => {
			const div = document.createElement('div');
			document.body.appendChild(div);
			const payload = click(div);
			expect(payload.xpath).not.toContain('[');
		});

		it('aggiunge [N] solo ai fratelli con lo stesso tag', () => {
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

		it('fratelli con tag diversi non ricevono indice', () => {
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

		it('rispetta maxDepth=8: catena più profonda viene troncata', () => {
			const deepest = buildChain(12);
			const payload = click(deepest);
			const segments = payload.xpath!.split('/').filter(Boolean);
			expect(segments.length).toBeLessThanOrEqual(8);
		});

		it('catena di esattamente 8 livelli produce 8 segmenti', () => {
			const deepest = buildChain(8);
			const payload = click(deepest);
			const segments = payload.xpath!.split('/').filter(Boolean);
			expect(segments.length).toBe(8);
		});

		it('xpath dell\'elemento root include solo il suo tag', () => {
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

		it('percorso completo corretto per struttura annidata semplice', () => {
			const div = document.createElement('div');
			const btn = document.createElement('button');
			document.body.appendChild(div);
			div.appendChild(btn);

			const payload = click(btn);
			expect(payload.xpath).toBe('/html/body/div/button');
		});
	});
});
