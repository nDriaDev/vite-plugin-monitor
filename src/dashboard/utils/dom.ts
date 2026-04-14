/**
* Lightweight DOM helpers used throughout the dashboard.
* These exist solely to reduce boilerplate: no abstractions,
* no virtual DOM, just thin wrappers around standard browser APIs.
*/

import type { Attrs } from "@tracker/types";

/** Typed querySelector: throws if element is not found. */
export function qs<T extends Element>(selector: string, root: ParentNode = document): T {
	const el = root.querySelector<T>(selector);
	if (!el) {
		throw new Error(`[vite-plugin-monitor] element not found: "${selector}"`);
	}
	return el;
}

/** Typed querySelector: returns null if not found (no throw). */
export function qsMaybe<T extends Element>(selector: string, root: ParentNode = document): T | null {
	return root.querySelector<T>(selector);
}

/** querySelectorAll -> typed array */
export function qsAll<T extends Element>(selector: string, root: ParentNode = document): T[] {
	return Array.from(root.querySelectorAll<T>(selector));
}

/**
* Create a DOM element with optional attributes, classes and text content.
*
* @example
* const btn = el('button', { class: 'btn', 'data-id': '42' }, 'Click me')
*/
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, text?: string): HTMLElementTagNameMap[K] {
	const node = document.createElement(tag);
	for (const [k, v] of Object.entries(attrs)) {
		if (v === null || v === undefined || v === false) {
			continue;
		}
		if (v === true) {
			node.setAttribute(k, '');
		} else {
			node.setAttribute(k, String(v));
		}
	}
	if (text !== undefined) {
		node.textContent = text;
	}
	return node;
}

/**
* Create an SVG element (requires SVG namespace).
*/
export function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
	const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
	for (const [k, v] of Object.entries(attrs)) {
		node.setAttribute(k, String(v));
	}
	return node as SVGElementTagNameMap[K];
}

/**
* Add an event listener and return a cleanup function.
* Enables easy teardown: `const off = on(btn, 'click', handler); off()`
*/
export function on<K extends keyof HTMLElementEventMap>(target: EventTarget, event: K, handler: (e: HTMLElementEventMap[K]) => void, opts?: AddEventListenerOptions): () => void {
	target.addEventListener(event as string, handler as EventListener, opts);
	return () => target.removeEventListener(event as string, handler as EventListener, opts);
}

/** Empty a container and optionally append new children. */
export function empty(container: Element, ...children: Node[]): void {
	container.replaceChildren(...children);
}

/** Append multiple children to a parent in one call. */
export function append(parent: Element, ...children: (Node | string)[]): void {
	for (const child of children) {
		parent.append(child);
	}
}

/** Show an element (removes 'hidden' attribute / display:none). */
export function show(el: HTMLElement): void {
	el.hidden = false;
}

/** Hide an element. */
export function hide(el: HTMLElement): void {
	el.hidden = true;
}

/** Toggle 'hidden' based on condition. */
export function toggleVisible(el: HTMLElement, visible: boolean): void {
	el.hidden = !visible;
}

/**
* Escape a string for safe interpolation inside HTML markup or attribute values.
* Replaces &, <, >, ", ' with their HTML entities.
* Use this whenever inserting user-supplied or event-derived data into innerHTML
* or HTML attribute strings (e.g. title="...").
*/
export function escapeHtml(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

/**
* Set text content safely: escapes HTML by using textContent.
* Use this instead of innerHTML when rendering user-supplied strings.
*/
export function setText(el: Element, text: string): void {
	el.textContent = text;
}

/**
* Set innerHTML: only use for trusted, sanitized markup generated
* internally by the dashboard (never for user event data).
*/
export function setHtml(el: Element, html: string): void {
	el.innerHTML = html;
}
