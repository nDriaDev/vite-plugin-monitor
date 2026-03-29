/* eslint-disable no-unused-vars */
/* eslint-disable no-undef */
import type { ConsoleMethod, ConsolePayload, ConsoleTrackOptions, LogLevel, ResolvedConsoleOpts, SerializedArg } from "@tracker/types";

const ALL_METHODS: ConsoleMethod[] = [
	'log', 'warn', 'error', 'debug', 'info', 'trace',
	'table', 'group', 'groupCollapsed', 'groupEnd',
	'count', 'countReset',
	'time', 'timeEnd', 'timeLog',
	'assert', 'dir', 'dirxml', 'clear',
];

const METHOD_LEVEL: Record<ConsoleMethod, LogLevel> = {
	log: 'info',
	info: 'info',
	debug: 'debug',
	warn: 'warn',
	error: 'error',
	trace: 'debug',
	table: 'info',
	group: 'debug',
	groupCollapsed: 'debug',
	groupEnd: 'debug',
	count: 'debug',
	countReset: 'debug',
	time: 'debug',
	timeEnd: 'debug',
	timeLog: 'debug',
	assert: 'warn',
	dir: 'debug',
	dirxml: 'debug',
	clear: 'info',
};

const DEFAULT_IGNORE_PATTERNS = ['[vite]', '[HMR]', '[tracker]', '[vue]'];

/**
* Safely serialize a single console argument to a `SerializedArg`.
*
* Strategy:
*  - primitives (string, number, boolean, null, undefined) -> stored as-is
*  - DOM nodes -> described as '[HTMLTagName]'
*  - Functions -> described as '[Function: name]'
*  - Errors -> { message, name, stack }
*  - Everything else -> JSON.stringify with a custom replacer that handles:
*    circular refs (WeakSet), DOM nodes (instanceof Element/Node), functions, BigInt.
*    The original value (not a structuredClone) is stringified so that DOM node
*    identity is preserved — jsdom's structuredClone loses Element instanceof info.
*/
function serializeArg(value: unknown, maxLength: number): SerializedArg {
	if (value === null) {
		return { type: 'null', value: null };
	}
	if (value === undefined) {
		return { type: 'undefined', value: 'undefined' };
	}
	if (typeof value === 'boolean') {
		return { type: 'boolean', value };
	}
	if (typeof value === 'number') {
		return { type: 'number', value: Number.isFinite(value) ? value : String(value) };
	}
	if (typeof value === 'bigint') {
		return { type: 'bigint', value: value.toString() + 'n' };
	}
	if (typeof value === 'symbol') {
		return { type: 'symbol', value: value.toString() };
	}
	if (typeof value === 'string') {
		return {
			type: 'string',
			value: value.length > maxLength
				? value.slice(0, maxLength) + `…[+${value.length - maxLength}]`
				: value
		};
	}
	if (typeof value === 'function') {
		return { type: 'function', value: `[Function: ${value.name || '(anonymous)'}]` };
	}
	if (typeof Element !== 'undefined' && value instanceof Element) {
		return {
			type: 'Element',
			value: `[${value.tagName.toLowerCase()}${value.id ? '#' + value.id : ''}${value.className ? '.' + String(value.className).trim().replace(/\s+/g, '.') : ''}]`
		};
	}
	if (typeof Node !== 'undefined' && value instanceof Node) {
		return { type: 'Node', value: `[${value.constructor?.name ?? 'Node'}]` };
	}
	if (value instanceof Error) {
		return {
			type: 'Error',
			value: { name: value.name, message: value.message, stack: value.stack }
		};
	}
	// INFO Always stringify the original value with the replacer (which handles Element, circular,
	// functions, etc.). structuredClone is intentionally NOT used here: in jsdom it clones
	// HTMLElements as empty plain objects, losing all type identity. The replacer's WeakSet
	// handles circular references directly on the original object graph.
	try {
		const json = JSON.stringify(value, replacer(new WeakSet()), 2);
		if (json.length <= maxLength) {
			return {
				type: Array.isArray(value) ? 'array' : 'object',
				value: JSON.parse(json)
			}
		}
		const truncated = json.slice(0, maxLength) + `\n…[+${json.length - maxLength} chars]`;
		return {
			type: Array.isArray(value) ? 'array' : 'object',
			value: truncated
		}
	} catch {
		return { type: 'object', value: '[unserializable object]' };
	}
}

/**
* JSON.stringify replacer that handles:
* - Circular references -> '[Circular]'
* - DOM nodes -> '[HTMLTagName]'
* - Functions -> '[Function: name]'
* - BigInt -> 'Xn'
* - undefined inside objects -> kept as null (JSON standard)
*/
function replacer(seen: WeakSet<object>) {
	return function (_key: string, val: unknown): unknown {
		if (typeof val === 'bigint') {
			return val.toString() + 'n';
		}
		if (typeof val === 'function') {
			return `[Function: ${val.name || 'anonymous'}]`;
		}
		if (typeof val === 'object' && val !== null) {
			if (typeof Element !== 'undefined' && val instanceof Element) {
				return `[${(val as Element).tagName.toLowerCase()}]`;
			}
			if (seen.has(val)) {
				return '[Circular]';
			}
			seen.add(val);
		}
		return val;
	}
}

/**
* Extract a human-readable message string from the first console argument.
* Handles printf-style format strings ('%s %d %o') by substituting args.
*/
function extractMessage(args: unknown[]): string {
	if (args.length === 0) {
		return '';
	}
	const first = args[0];
	if (typeof first !== 'string') {
		if (first instanceof Error) {
			return `${first.name}: ${first.message}`;
		}
		if (first === null) {
			return 'null';
		}
		if (first === undefined) {
			return 'undefined';
		}
		if (typeof first === 'object') {
			return Array.isArray(first) ? '[Array]' : '[Object]';
		}
		return String(first);
	}

	// INFO Handle printf-style substitution (%s, %d, %i, %f, %o, %O, %c)
	let argIdx = 1;
	return first.replace(/%[sdifoOc]/g, (token) => {
		if (argIdx >= args.length) {
			return token;
		}
		const sub = args[argIdx++];
		if (token === '%c') {
			return '';
		}
		if (token === '%o' || token === '%O') {
			try {
				return JSON.stringify(sub);
			} catch {
				return String(sub);
			}
		}
		return String(sub);
	})
}

function resolveConsoleOpts(raw: boolean | ConsoleTrackOptions): ResolvedConsoleOpts {
	const opts = raw === true ? {} : raw as ConsoleTrackOptions;
	return {
		methods: new Set(opts.methods ?? ALL_METHODS),
		maxArgLength: opts.maxArgLength ?? 1024,
		maxArgs: opts.maxArgs ?? 10,
		captureStackOnError: opts.captureStackOnError ?? false,
		ignorePatterns: [
			...DEFAULT_IGNORE_PATTERNS,
			...(opts.ignorePatterns ?? []),
		]
	}
}

export function setupConsoleTracker(consoleConfig: boolean | ConsoleTrackOptions, onEvent: (payload: ConsolePayload, level: LogLevel) => void): () => void {
	const opts = resolveConsoleOpts(consoleConfig);
	const originals = new Map<ConsoleMethod, (...args: unknown[]) => void>();

	let groupDepth = 0;

	for (const method of opts.methods) {
		const original = console[method] as ((...args: unknown[]) => void) | undefined;
		if (typeof original !== 'function') {
			continue;
		}

		originals.set(method, original);

		console[method] = function (...args: unknown[]) {
			original.apply(console, args);
			if (method === 'groupEnd') {
				groupDepth = Math.max(0, groupDepth - 1);
			}

			let effectiveArgs = args;
			if (method === 'assert') {
				if (args[0]) {
					return;
				}
				effectiveArgs = args.slice(1);
			}

			const firstStr = effectiveArgs.length > 0 ? String(effectiveArgs[0]) : '';
			if (opts.ignorePatterns.some(p => firstStr.includes(p))) {
				return;
			}

			const limited = effectiveArgs.slice(0, opts.maxArgs);
			const serialized: SerializedArg[] = limited.map(a => serializeArg(a, opts.maxArgLength));
			if (effectiveArgs.length > opts.maxArgs) {
				serialized.push({ type: 'truncated', value: `[${effectiveArgs.length - opts.maxArgs} more args]` });
			}

			let stack: string | undefined;
			if (method === 'trace') {
				stack = new Error().stack?.split('\n').slice(2).join('\n');
			} else if (method === 'error' && opts.captureStackOnError) {
				stack = new Error().stack?.split('\n').slice(2).join('\n');
			}

			const payload: ConsolePayload = {
				method,
				message: extractMessage(effectiveArgs),
				args: serialized,
				stack,
				groupDepth,
			};

			onEvent(payload, METHOD_LEVEL[method]);

			if (method === 'group' || method === 'groupCollapsed') {
				groupDepth++;
			}
		}
	}

	// INFO Teardown: restore all original methods
	return () => {
		for (const [method, original] of originals) {
			Reflect.set(console, method, original);
		}
		groupDepth = 0;
	}
}
