import { describe, it, expect, vi } from 'vitest';
import { qs, qsMaybe, qsAll, el, svgEl, on, empty, append, show, hide, toggleVisible, escapeHtml, setText, setHtml, } from '../../../src/dashboard/utils/dom';

describe('qs', () => {
	it('restituisce l\'elemento se trovato', () => {
		const div = document.createElement('div');
		div.innerHTML = '<span id="test">hello</span>';
		document.body.append(div);
		expect(qs<HTMLSpanElement>('#test')).not.toBeNull();
		div.remove();
	});

	it('lancia eccezione se l\'elemento non esiste', () => {
		expect(() => qs('#non-existent-xyz')).toThrow();
	});

	it('cerca dentro il root specificato', () => {
		const root = document.createElement('div');
		root.innerHTML = '<p class="p1">testo</p>';
		expect(qs('.p1', root)).not.toBeNull();
	});
});

describe('qsMaybe', () => {
	it('restituisce null se l\'elemento non esiste', () => {
		expect(qsMaybe('#non-existent-xyz')).toBeNull();
	});

	it('restituisce l\'elemento se trovato', () => {
		const div = document.createElement('div');
		div.innerHTML = '<span class="maybe-span"></span>';
		document.body.append(div);
		expect(qsMaybe('.maybe-span')).not.toBeNull();
		div.remove();
	});
});

describe('qsAll', () => {
	it('restituisce un array vuoto se nessun elemento corrisponde', () => {
		expect(qsAll('.xyz-nonexistent')).toEqual([]);
	});

	it('restituisce tutti gli elementi corrispondenti', () => {
		const div = document.createElement('div');
		div.innerHTML = '<span class="item"></span><span class="item"></span>';
		document.body.append(div);
		const results = qsAll('.item', div);
		expect(results).toHaveLength(2);
		div.remove();
	});
});

describe('el', () => {
	it('crea un elemento con il tag corretto', () => {
		const btn = el('button');
		expect(btn.tagName).toBe('BUTTON');
	});

	it('imposta gli attributi forniti', () => {
		const input = el('input', { type: 'text', id: 'my-input' });
		expect(input.getAttribute('type')).toBe('text');
		expect(input.getAttribute('id')).toBe('my-input');
	});

	it('imposta il testo se fornito', () => {
		const p = el('p', {}, 'hello');
		expect(p.textContent).toBe('hello');
	});

	it('omette attributi con valore null, undefined o false', () => {
		const div = el('div', { 'data-x': null as any, 'data-y': undefined as any, 'data-z': false as any });
		expect(div.hasAttribute('data-x')).toBe(false);
		expect(div.hasAttribute('data-y')).toBe(false);
		expect(div.hasAttribute('data-z')).toBe(false);
	});

	it('imposta attributo vuoto per valore true', () => {
		const input = el('input', { disabled: true as any });
		expect(input.getAttribute('disabled')).toBe('');
	});

	it('converte valori numerici in stringa', () => {
		const div = el('div', { 'data-count': 42 as any });
		expect(div.getAttribute('data-count')).toBe('42');
	});
});

describe('svgEl', () => {
	it('crea un elemento SVG con il namespace corretto', () => {
		const circle = svgEl('circle', { cx: 10, cy: 10, r: 5 });
		expect(circle.namespaceURI).toBe('http://www.w3.org/2000/svg');
		expect(circle.getAttribute('cx')).toBe('10');
	});
});

describe('on', () => {
	it('aggiunge un listener che reagisce all\'evento', () => {
		const btn = document.createElement('button');
		const handler = vi.fn();
		const off = on(btn, 'click', handler);
		btn.click();
		expect(handler).toHaveBeenCalledOnce();
		off();
	});

	it('la funzione di cleanup rimuove il listener', () => {
		const btn = document.createElement('button');
		const handler = vi.fn();
		const off = on(btn, 'click', handler);
		off();
		btn.click();
		expect(handler).not.toHaveBeenCalled();
	});
});

describe('empty', () => {
	it('rimuove tutti i figli del container', () => {
		const div = document.createElement('div');
		div.innerHTML = '<span></span><span></span>';
		empty(div);
		expect(div.childNodes.length).toBe(0);
	});

	it('aggiunge i nuovi figli dopo aver svuotato', () => {
		const div = document.createElement('div');
		div.innerHTML = '<span>old</span>';
		const child = document.createElement('p');
		child.textContent = 'new';
		empty(div, child);
		expect(div.children.length).toBe(1);
		expect(div.querySelector('p')!.textContent).toBe('new');
	});
});

describe('append', () => {
	it('aggiunge più figli al genitore', () => {
		const parent = document.createElement('div');
		const a = document.createElement('span');
		const b = document.createElement('span');
		append(parent, a, b);
		expect(parent.children.length).toBe(2);
	});

	it('accetta stringhe di testo', () => {
		const parent = document.createElement('div');
		append(parent, 'hello');
		expect(parent.textContent).toBe('hello');
	});
});

describe('show / hide', () => {
	it('show rimuove l\'attributo hidden', () => {
		const div = document.createElement('div');
		div.hidden = true;
		show(div);
		expect(div.hidden).toBe(false);
	});

	it('hide imposta hidden = true', () => {
		const div = document.createElement('div');
		hide(div);
		expect(div.hidden).toBe(true);
	});
});

describe('toggleVisible', () => {
	it('visible=true -> hidden=false', () => {
		const div = document.createElement('div');
		div.hidden = true;
		toggleVisible(div, true);
		expect(div.hidden).toBe(false);
	});

	it('visible=false -> hidden=true', () => {
		const div = document.createElement('div');
		toggleVisible(div, false);
		expect(div.hidden).toBe(true);
	});
});

describe('escapeHtml', () => {
	it('sostituisce i caratteri speciali HTML', () => {
		expect(escapeHtml('a & b')).toBe('a &amp; b');
		expect(escapeHtml('<div>')).toBe('&lt;div&gt;');
		expect(escapeHtml('"quoted"')).toBe('&quot;quoted&quot;');
		expect(escapeHtml("it's")).toBe("it&#39;s");
	});

	it('lascia invariate le stringhe senza caratteri speciali', () => {
		expect(escapeHtml('hello world')).toBe('hello world');
	});
});

describe('setText', () => {
	it('imposta textContent sull\'elemento', () => {
		const div = document.createElement('div');
		setText(div, 'ciao');
		expect(div.textContent).toBe('ciao');
	});
});

describe('setHtml', () => {
	it('imposta innerHTML sull\'elemento', () => {
		const div = document.createElement('div');
		setHtml(div, '<span>test</span>');
		expect(div.querySelector('span')!.textContent).toBe('test');
	});
});
