import { describe, it, expect, vi } from 'vitest';
import { qs, qsMaybe, qsAll, el, svgEl, on, empty, append, show, hide, toggleVisible, escapeHtml, setText, setHtml, } from '../../../src/dashboard/utils/dom';

describe('qs', () => {
	it('returns the element if found', () => {
		const div = document.createElement('div');
		div.innerHTML = '<span id="test">hello</span>';
		document.body.append(div);
		expect(qs<HTMLSpanElement>('#test')).not.toBeNull();
		div.remove();
	});

	it('throws exception if element does not exist', () => {
		expect(() => qs('#non-existent-xyz')).toThrow();
	});

	it('searches within the specified root', () => {
		const root = document.createElement('div');
		root.innerHTML = '<p class="p1">testo</p>';
		expect(qs('.p1', root)).not.toBeNull();
	});
});

describe('qsMaybe', () => {
	it('Returns null if the element does not exist.', () => {
		expect(qsMaybe('#non-existent-xyz')).toBeNull();
	});

	it('returns the element if found', () => {
		const div = document.createElement('div');
		div.innerHTML = '<span class="maybe-span"></span>';
		document.body.append(div);
		expect(qsMaybe('.maybe-span')).not.toBeNull();
		div.remove();
	});
});

describe('qsAll', () => {
	it('returns an empty array when no element matches', () => {
		expect(qsAll('.xyz-nonexistent')).toEqual([]);
	});

	it('returns all matching elements', () => {
		const div = document.createElement('div');
		div.innerHTML = '<span class="item"></span><span class="item"></span>';
		document.body.append(div);
		const results = qsAll('.item', div);
		expect(results).toHaveLength(2);
		div.remove();
	});
});

describe('el', () => {
	it('creates an element with the correct tag', () => {
		const btn = el('button');
		expect(btn.tagName).toBe('BUTTON');
	});

	it('sets the provided attributes', () => {
		const input = el('input', { type: 'text', id: 'my-input' });
		expect(input.getAttribute('type')).toBe('text');
		expect(input.getAttribute('id')).toBe('my-input');
	});

	it('sets the text when provided', () => {
		const p = el('p', {}, 'hello');
		expect(p.textContent).toBe('hello');
	});

	it('omits attributes with null, undefined or false value', () => {
		const div = el('div', { 'data-x': null as any, 'data-y': undefined as any, 'data-z': false as any });
		expect(div.hasAttribute('data-x')).toBe(false);
		expect(div.hasAttribute('data-y')).toBe(false);
		expect(div.hasAttribute('data-z')).toBe(false);
	});

	it('sets empty attribute for true value', () => {
		const input = el('input', { disabled: true as any });
		expect(input.getAttribute('disabled')).toBe('');
	});

	it('converts numeric values to string', () => {
		const div = el('div', { 'data-count': 42 as any });
		expect(div.getAttribute('data-count')).toBe('42');
	});
});

describe('svgEl', () => {
	it('creates an SVG element with the correct namespace', () => {
		const circle = svgEl('circle', { cx: 10, cy: 10, r: 5 });
		expect(circle.namespaceURI).toBe('http://www.w3.org/2000/svg');
		expect(circle.getAttribute('cx')).toBe('10');
	});
});

describe('on', () => {
	it('adds a listener that reacts to the event', () => {
		const btn = document.createElement('button');
		const handler = vi.fn();
		const off = on(btn, 'click', handler);
		btn.click();
		expect(handler).toHaveBeenCalledOnce();
		off();
	});

	it('the cleanup function removes the listener', () => {
		const btn = document.createElement('button');
		const handler = vi.fn();
		const off = on(btn, 'click', handler);
		off();
		btn.click();
		expect(handler).not.toHaveBeenCalled();
	});
});

describe('empty', () => {
	it('removes all children of the container', () => {
		const div = document.createElement('div');
		div.innerHTML = '<span></span><span></span>';
		empty(div);
		expect(div.childNodes.length).toBe(0);
	});

	it('adds the new children after emptying', () => {
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
	it('adds multiple children to the parent', () => {
		const parent = document.createElement('div');
		const a = document.createElement('span');
		const b = document.createElement('span');
		append(parent, a, b);
		expect(parent.children.length).toBe(2);
	});

	it('accepts text strings', () => {
		const parent = document.createElement('div');
		append(parent, 'hello');
		expect(parent.textContent).toBe('hello');
	});
});

describe('show / hide', () => {
	it('show removes the hidden attribute', () => {
		const div = document.createElement('div');
		div.hidden = true;
		show(div);
		expect(div.hidden).toBe(false);
	});

	it('hide sets hidden = true', () => {
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
	it('replaces special HTML characters', () => {
		expect(escapeHtml('a & b')).toBe('a &amp; b');
		expect(escapeHtml('<div>')).toBe('&lt;div&gt;');
		expect(escapeHtml('"quoted"')).toBe('&quot;quoted&quot;');
		expect(escapeHtml("it's")).toBe("it&#39;s");
	});

	it('leaves strings without special characters unchanged', () => {
		expect(escapeHtml('hello world')).toBe('hello world');
	});
});

describe('setText', () => {
	it('set textContent on the element', () => {
		const div = document.createElement('div');
		setText(div, 'ciao');
		expect(div.textContent).toBe('ciao');
	});
});

describe('setHtml', () => {
	it('set innerHTML on the element', () => {
		const div = document.createElement('div');
		setHtml(div, '<span>test</span>');
		expect(div.querySelector('span')!.textContent).toBe('test');
	});
});
