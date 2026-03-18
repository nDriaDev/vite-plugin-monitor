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

export function setupClickTracker(onEvent: (payload: ClickPayload) => void): () => void {
	if (typeof window === 'undefined') {
		return () => { };
	}

	function onClick(e: MouseEvent) {
		const target = e.target as Element;
		if (!target?.tagName) {
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
