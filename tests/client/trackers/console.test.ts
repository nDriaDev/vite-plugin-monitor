import { describe, it, expect, afterEach, vi } from 'vitest';
import { setupConsoleTracker } from '../../../src/client/trackers/console';
import type { ConsolePayload, ConsoleTrackOptions, LogLevel } from '../../../src/types';

function capture(config: boolean | ConsoleTrackOptions, fn: () => void): Array<{ payload: ConsolePayload; level: LogLevel }> {
	const events: Array<{ payload: ConsolePayload; level: LogLevel }> = [];
	const teardown = setupConsoleTracker(config, (p, l) => events.push({ payload: p, level: l }));
	fn();
	teardown();
	return events;
}

function captureOne(config: boolean | ConsoleTrackOptions, fn: () => void): { payload: ConsolePayload; level: LogLevel } {
	const events = capture(config, fn);
	if (events.length === 0) {
		throw new Error('Nessun evento emesso — verifica che il metodo sia in opts.methods e non filtrato');
	}
	return events[0];
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe('setupConsoleTracker', () => {
	describe('SSR', () => {
		it('returns a no-op function when window is undefined', () => {
			vi.stubGlobal('window', undefined);
			const onEvent = vi.fn();
			const teardown = setupConsoleTracker(true, onEvent);

			expect(typeof teardown).toBe('function');
			expect(() => teardown()).not.toThrow();
			expect(onEvent).not.toHaveBeenCalled();

			vi.unstubAllGlobals();
		});
	});

	describe('wrapping', () => {
		it('Call the original method before emitting the event', () => {
			const callOrder: string[] = [];
			vi.spyOn(console, 'log').mockImplementation(() => callOrder.push('original'));

			const teardown = setupConsoleTracker(
				{ methods: ['log'] },
				() => callOrder.push('event')
			);
			console.log('test');
			teardown();
			expect(callOrder).toEqual(['original', 'event']);
		});

		it('after teardown(), the original method is restored', () => {
			const originalLog = console.log;
			const teardown = setupConsoleTracker({ methods: ['log'] }, vi.fn());

			expect(console.log).not.toBe(originalLog);

			teardown();
			expect(console.log).toBe(originalLog);
		});

		it('teardown restores all methods specified in methods', () => {
			const origLog = console.log;
			const origWarn = console.warn;
			const origError = console.error;

			const teardown = setupConsoleTracker({ methods: ['log', 'warn', 'error'] }, vi.fn());
			teardown();

			expect(console.log).toBe(origLog);
			expect(console.warn).toBe(origWarn);
			expect(console.error).toBe(origError);
		});

		it('only the methods specified in opts.methods are wrapped', () => {
			const onEvent = vi.fn();
			const teardown = setupConsoleTracker({ methods: ['log'] }, onEvent);

			console.log('tracciato');
			console.warn('non tracciato');
			teardown();
			expect(onEvent).toHaveBeenCalledTimes(1);
			expect(onEvent.mock.calls[0][0].method).toBe('log');
		});

		it('when console[method] is not a function the method is skipped without errors', () => {
			const originalTable = console.table;
			Object.defineProperty(console, 'table', { configurable: true, writable: true, value: undefined });

			const onEvent = vi.fn();
			expect(() => {
				const teardown = setupConsoleTracker({ methods: ['table', 'log'] }, onEvent);
				console.log('test');
				teardown();
			}).not.toThrow();

			expect(onEvent).toHaveBeenCalledTimes(1);
			expect(onEvent.mock.calls[0][0].method).toBe('log');

			Object.defineProperty(console, 'table', { configurable: true, writable: true, value: originalTable });
		});

		it('teardown does not attempt to restore non-function methods (they do not enter originals)', () => {
			const originalTable = console.table;
			Object.defineProperty(console, 'table', { configurable: true, writable: true, value: undefined });

			const teardown = setupConsoleTracker({ methods: ['table'] }, vi.fn());
			expect(() => teardown()).not.toThrow();
			expect(console.table).toBeUndefined();

			Object.defineProperty(console, 'table', { configurable: true, writable: true, value: originalTable });
		});
	});

	describe('pattern filtering', () => {
		it('messages containing [vite] do not emit event', () => {
			const events = capture({ methods: ['log'] }, () =>
				console.log('[vite] HMR update')
			);
			expect(events).toHaveLength(0);
		});

		it('messages containing [HMR] do not emit event', () => {
			const events = capture({ methods: ['log'] }, () =>
				console.log('[HMR] connected')
			);
			expect(events).toHaveLength(0);
		});

		it('messages containing [tracker] do not emit event', () => {
			const events = capture({ methods: ['log'] }, () =>
				console.log('[tracker] init ok')
			);
			expect(events).toHaveLength(0);
		});

		it('messages without predefined patterns emit normally', () => {
			const events = capture({ methods: ['log'] }, () =>
				console.log('hello world')
			);
			expect(events).toHaveLength(1);
		});

		it('custom patterns via ignorePatterns suppress the message', () => {
			const events = capture(
				{ methods: ['log'], ignorePatterns: ['SUPPRESSED message'] },
				() => console.log('SUPPRESSED message')
			);
			expect(events).toHaveLength(0);
		});

		it('custom patterns are added to the predefined ones — both work', () => {
			const cfg: ConsoleTrackOptions = { methods: ['log'], ignorePatterns: ["", 'CUSTOM pattern'] };

			const e1 = capture(cfg, () => console.log('[vite] built-in pattern'));
			const e2 = capture(cfg, () => console.log('CUSTOM pattern'));
			const e3 = capture(cfg, () => console.log('normal message'));

			expect(e1).toHaveLength(0);
			expect(e2).toHaveLength(0);
			expect(e3).toHaveLength(1);
		});

		it('filtering converts the first arg with String() — null does not match any pattern', () => {
			const events = capture({ methods: ['log'] }, () => console.log(null));
			expect(events).toHaveLength(1);
		});
	});

	describe('console.assert', () => {
		it('true assertion (args[0] truthy): emits nothing', () => {
			const events = capture({ methods: ['assert'] }, () =>
				console.assert(true, 'questo non deve essere emesso')
			);
			expect(events).toHaveLength(0);
		});

		it('false assertion (args[0] falsy): emits event with arguments from [1] onwards', () => {
			const { payload } = captureOne({ methods: ['assert'] }, () =>
				console.assert(false, 'assertion message', 'detail')
			);
			expect(payload.method).toBe('assert');
			expect(payload.message).toBe('assertion message');
			expect(payload.args).toHaveLength(2);
			expect(payload.args[0]).toEqual({ type: 'string', value: 'assertion message' });
			expect(payload.args[1]).toEqual({ type: 'string', value: 'detail' });
		});

		it('false assertion with no additional messages: emits with empty args and message ""', () => {
			const { payload } = captureOne({ methods: ['assert'] }, () =>
				console.assert(false)
			);
			expect(payload.args).toHaveLength(0);
			expect(payload.message).toBe('');
		});

		it('false assertion: the boolean false (args[0]) is excluded from the serialized effectiveArgs', () => {
			const { payload } = captureOne({ methods: ['assert'] }, () =>
				console.assert(false, 'msg')
			);
			expect(payload.args).toHaveLength(1);
			expect(payload.args[0]).toEqual({ type: 'string', value: 'msg' });
		});
	});

	describe('groupDepth', () => {
		it('group event carries groupDepth=0 (depth is incremented AFTER onEvent)', () => {
			const { payload } = captureOne({ methods: ['group'] }, () =>
				console.group('g1')
			);
			expect(payload.groupDepth).toBe(0);
		});

		it('groupCollapsed event carries groupDepth=0 (increment happens after)', () => {
			const { payload } = captureOne({ methods: ['groupCollapsed'] }, () =>
				console.groupCollapsed('gc1')
			);
			expect(payload.groupDepth).toBe(0);
		});

		it('Log events within a group have groupDepth=1', () => {
			const events = capture({ methods: ['group', 'log'] }, () => {
				console.group('outer')
				console.log('inside')
			});

			const groupEvents = events.filter(e => e.payload.method === 'group');
			const logEvents = events.filter(e => e.payload.method === 'log');

			expect(groupEvents).toHaveLength(1);
			expect(groupEvents[0].payload.groupDepth).toBe(0);

			expect(logEvents.at(-1)!.payload.groupDepth).toBe(1);
		});

		it('groupEnd decrements groupDepth before emitting the event', () => {
			const events = capture({ methods: ['group', 'groupEnd'] }, () => {
				console.group('g')
				console.groupEnd()
			});
			expect(events).toHaveLength(2);
			expect(events[1].payload.groupDepth).toBe(0);
		});

		it('groupEnd at depth 0 does not go below 0 (clamp to 0)', () => {
			const { payload } = captureOne({ methods: ['groupEnd'] }, () =>
				console.groupEnd()
			);
			expect(payload.groupDepth).toBe(0);
		});

		it('two-level nesting: all events carry the correct groupDepth', () => {
			const events = capture(
				{ methods: ['group', 'groupCollapsed', 'groupEnd', 'log'] },
				() => {
					console.group('level1')
					console.log('at level 1')
					console.groupCollapsed('level2')
					console.log('at level 2')
					console.groupEnd()
					console.groupEnd()
				}
			);

			const byMethod = (m: string) => events.filter(e => e.payload.method === m);

			const groups = byMethod('group');
			const groupsColl = byMethod('groupCollapsed');
			const groupEnds = byMethod('groupEnd');
			const explicitLogs = events.filter(
				e => e.payload.method === 'log' &&
					(e.payload.message === 'at level 1' || e.payload.message === 'at level 2')
			);

			expect(groups[0].payload.groupDepth).toBe(0);
			expect(explicitLogs[0].payload.groupDepth).toBe(1);
			expect(groupsColl[0].payload.groupDepth).toBe(1);
			expect(explicitLogs[1].payload.groupDepth).toBe(2);
			expect(groupEnds[0].payload.groupDepth).toBe(1);
			expect(groupEnds[1].payload.groupDepth).toBe(0);
		});

		it('teardown resets groupDepth — a second tracker starts from 0', () => {
			capture({ methods: ['group'] }, () => console.group('open'));

			const { payload } = captureOne({ methods: ['log'] }, () => console.log('test'));
			expect(payload.groupDepth).toBe(0);
		});
	});

	describe('stack trace', () => {
		it('console.trace always includes the stack', () => {
			const { payload } = captureOne({ methods: ['trace'] }, () =>
				console.trace('trace msg')
			);
			expect(payload.stack).toBeDefined();
			expect(typeof payload.stack).toBe('string');
			expect(payload.stack!.length).toBeGreaterThan(0);
		});

		it('console.error without captureStackOnError does not include the stack', () => {
			const { payload } = captureOne(
				{ methods: ['error'], captureStackOnError: false },
				() => console.error('boom')
			);
			expect(payload.stack).toBeUndefined();
		});

		it('console.error with captureStackOnError: true includes the stack', () => {
			const { payload } = captureOne(
				{ methods: ['error'], captureStackOnError: true },
				() => console.error('boom')
			);
			expect(payload.stack).toBeDefined();
			expect(typeof payload.stack).toBe('string');
			expect(payload.stack!.length).toBeGreaterThan(0);
		});

		it('console.log never includes the stack, even with captureStackOnError: true', () => {
			const { payload } = captureOne(
				{ methods: ['log'], captureStackOnError: true },
				() => console.log('hello')
			);
			expect(payload.stack).toBeUndefined();
		});
	});

	describe('maxArgs', () => {
		it('all arguments within maxArgs are serialized without sentinel', () => {
			const { payload } = captureOne(
				{ methods: ['log'], maxArgs: 3 },
				() => console.log('a', 'b', 'c')
			);
			expect(payload.args).toHaveLength(3);
			expect(payload.args.every(a => a.type === 'string')).toBe(true);
		});

		it('arguments beyond maxArgs: adds a sentinel { type: "truncated" }', () => {
			const { payload } = captureOne(
				{ methods: ['log'], maxArgs: 2 },
				() => console.log('a', 'b', 'c', 'd')
			);
			expect(payload.args).toHaveLength(3);
			expect(payload.args[2].type).toBe('truncated');
			expect(payload.args[2].value).toBe('[2 more args]');
		});

		it('maxArgs=1: only one argument and sentinel for the rest', () => {
			const { payload } = captureOne(
				{ methods: ['log'], maxArgs: 1 },
				() => console.log('first', 'second', 'third')
			);
			expect(payload.args).toHaveLength(2);
			expect(payload.args[0]).toEqual({ type: 'string', value: 'first' });
			expect(payload.args[1].type).toBe('truncated');
			expect(payload.args[1].value).toBe('[2 more args]');
		});
	});

	describe('serializeArg', () => {
		const cfgDefault: ConsoleTrackOptions = { methods: ['log'], maxArgLength: 1024 };
		const cfgShort: ConsoleTrackOptions = { methods: ['log'], maxArgLength: 10 };

		function logArg(val: unknown, cfg = cfgDefault) {
			return captureOne(cfg, () => console.log(val)).payload.args[0];
		}

		it('null -> { type: "null", value: null }', () => {
			expect(logArg(null)).toEqual({ type: 'null', value: null });
		});

		it('undefined -> { type: "undefined", value: "undefined" }', () => {
			expect(logArg(undefined)).toEqual({ type: 'undefined', value: 'undefined' });
		});

		it('boolean true -> { type: "boolean", value: true }', () => {
			expect(logArg(true)).toEqual({ type: 'boolean', value: true });
		});

		it('boolean false -> { type: "boolean", value: false }', () => {
			expect(logArg(false)).toEqual({ type: 'boolean', value: false });
		});

		it('number finito -> { type: "number", value: 42 }', () => {
			expect(logArg(42)).toEqual({ type: 'number', value: 42 });
		});

		it('Infinity -> { type: "number", value: "Infinity" } (non finito -> String)', () => {
			expect(logArg(Infinity)).toEqual({ type: 'number', value: 'Infinity' });
		});

		it('NaN -> { type: "number", value: "NaN" } (non finito -> String)', () => {
			expect(logArg(NaN)).toEqual({ type: 'number', value: 'NaN' });
		});

		it('bigint -> { type: "bigint", value: "12345n" }', () => {
			expect(logArg(12345n)).toEqual({ type: 'bigint', value: '12345n' });
		});

		it('symbol -> { type: "symbol", value: "Symbol(test)" }', () => {
			expect(logArg(Symbol('test'))).toEqual({ type: 'symbol', value: 'Symbol(test)' });
		});

		it('short string (≤ maxArgLength) -> returned as-is', () => {
			expect(logArg('hello')).toEqual({ type: 'string', value: 'hello' });
		});

		it('long string (> maxArgLength) -> truncated with indicator of omitted characters', () => {
			const arg = logArg('x'.repeat(15), cfgShort);
			expect(arg.type).toBe('string');
			expect(arg.value).toBe('x'.repeat(10) + '…[+5]');
		});

		it('string of exactly maxArgLength -> not truncated', () => {
			const arg = logArg('x'.repeat(10), cfgShort);
			expect(arg.type).toBe('string');
			expect(arg.value).toBe('x'.repeat(10));
		});

		it('function con nome -> { type: "function", value: "[Function: myFn]" }', () => {
			function myFn() { }
			expect(logArg(myFn)).toEqual({ type: 'function', value: '[Function: myFn]' });
		});

		it('arrow function senza nome -> { type: "function", value: "[Function: (anonymous)]" }', () => {
			expect(logArg(() => { })).toEqual({ type: 'function', value: '[Function: (anonymous)]' });
		});

		it('Element con id e classi -> { type: "Element", value: "[tag#id.cls1.cls2]" }', () => {
			const el = document.createElement('button');
			el.id = 'submit-btn';
			el.className = 'primary large';
			const arg = logArg(el);
			expect(arg.type).toBe('Element');
			expect(arg.value).toBe('[button#submit-btn.primary.large]');
		});

		it('Element without id or classes -> { type: "Element", value: "[tag]" }', () => {
			const el = document.createElement('div');
			const arg = logArg(el);
			expect(arg.type).toBe('Element');
			expect(arg.value).toBe('[div]');
		});

		it('Element con solo id (nessuna classe) -> "[tag#id]"', () => {
			const el = document.createElement('span');
			el.id = 'my-span';
			const arg = logArg(el);
			expect(arg.value).toBe('[span#my-span]');
		});

		it('TextNode (Node ma non Element) -> { type: "Node", value: "[Text]" } (riga 84)', () => {
			const textNode = document.createTextNode('hello');
			const arg = logArg(textNode);
			expect(arg.type).toBe('Node');
			expect(arg.value).toBe('[Text]');
		});

		it('Comment (Node ma non Element) -> { type: "Node", value: "[Comment]" } (riga 84)', () => {
			const comment = document.createComment('nota');
			const arg = logArg(comment);
			expect(arg.type).toBe('Node');
			expect(arg.value).toBe('[Comment]');
		});

		it('Error -> { type: "Error", value: { name, message, stack } }', () => {
			const err = new TypeError('something went wrong');
			const arg = logArg(err);
			expect(arg.type).toBe('Error');
			const v = arg.value as { name: string; message: string; stack: string | undefined };
			expect(v.name).toBe('TypeError');
			expect(v.message).toBe('something went wrong');
			expect(v).toHaveProperty('name');
			expect(v).toHaveProperty('message');
		});

		it('oggetto normale -> { type: "object", value: <parsed JSON dell\'oggetto> }', () => {
			const obj = { x: 1, y: 'hello' };
			const arg = logArg(obj);
			expect(arg.type).toBe('object');
			expect(arg.value).toEqual({ x: 1, y: 'hello' });
		});

		it('array -> { type: "array", value: <array clonato> }', () => {
			const arr = [1, 'two', true];
			const arg = logArg(arr);
			expect(arg.type).toBe('array');
			expect(arg.value).toEqual([1, 'two', true]);
		});

		it('object whose JSON exceeds maxArgLength -> truncated and re-parsed', () => {
			const cfg: ConsoleTrackOptions = { methods: ['log'], maxArgLength: 30 };
			const arg = logArg({ key: 'x'.repeat(100) }, cfg);
			expect(arg.type).toBe('object');
			expect(arg.value).toBeDefined();
		});

		it('array whose JSON exceeds maxArgLength -> JSON.parse of truncated throws, falls into catch', () => {
			const cfg: ConsoleTrackOptions = { methods: ['log'], maxArgLength: 20 };
			const arg = logArg(Array.from({ length: 50 }, (_, i) => i), cfg);
			expect(arg.type).toBe('array');
			expect(arg.value).toBe('[\n  0,\n  1,\n  2,\n  3\n…[+272 chars]');
		});

		it('object with BigInt property -> the bigint property is converted to "Xn" by the replacer', () => {
			const arg = logArg({ n: 42n });
			expect(arg.type).toBe('object');
			expect((arg.value as Record<string, unknown>).n).toBe('42n');
		});

		it('object with function property -> converted to "[Function: name]" by the replacer', () => {
			function myHandler() { }
			const arg = logArg({ handler: myHandler });
			expect(arg.type).toBe('object');
			expect((arg.value as Record<string, unknown>).handler).toBe('[Function: myHandler]');
		});

		it('oggetto con funzione anonima -> il replacer usa "anonymous" come fallback (riga 131)', () => {
			const anonFn = function named() { }
			Object.defineProperty(anonFn, 'name', { value: '', configurable: true });
			const arg = logArg({ cb: anonFn });
			expect(arg.type).toBe('object');
			expect((arg.value as Record<string, unknown>).cb).toBe('[Function: anonymous]');
		});

		it('object with Element property -> converted to "[tagname]" by the replacer', () => {
			const el = document.createElement('button');
			const obj: Record<string, unknown> = { node: el };
			obj.self = obj;
			const arg = logArg(obj);
			expect(arg.type).toBe('object');
			expect((arg.value as Record<string, unknown>).node).toBe('[button]');
			expect((arg.value as Record<string, unknown>).self).toBe('[Circular]');
		});

		it('oggetto con riferimento circolare -> il valore circolare diventa "[Circular]"', () => {
			const circular: Record<string, unknown> = { a: 1 }
			circular.self = circular;

			const arg = logArg(circular);
			expect(arg.type).toBe('object');
			expect((arg.value as Record<string, unknown>).a).toBe(1);
			expect((arg.value as Record<string, unknown>).self).toBe('[Circular]');
		});

		it('oggetto non serializzabile -> { type: "object", value: "[unserializable object]" }', () => {
			const unserializable = {
				toJSON() { throw new Error('cannot serialize') },
			}
			const arg = logArg(unserializable);
			expect(arg.type).toBe('object');
			expect(arg.value).toBe('[unserializable object]');
		});
	});

	describe('extractMessage', () => {
		const cfg: ConsoleTrackOptions = { methods: ['log'] };
		function logMsg(...args: unknown[]): string {
			return captureOne(cfg, () =>
				console.log(...(args as [unknown, ...unknown[]]))
			).payload.message;
		}

		it('no arguments -> empty string', () => {
			const { payload } = captureOne(cfg, () => console.log());
			expect(payload.message).toBe('');
		});

		it('primo arg Error -> "ErrorName: message"', () => {
			expect(logMsg(new TypeError('type error'))).toBe('TypeError: type error');
		});

		it('primo arg null -> "null"', () => {
			expect(logMsg(null)).toBe('null');
		});

		it('primo arg undefined -> "undefined"', () => {
			expect(logMsg(undefined)).toBe('undefined');
		});

		it('primo arg array -> "[Array]"', () => {
			expect(logMsg([1, 2, 3])).toBe('[Array(3)]');
		});

		it('primo arg oggetto -> "[Object]"', () => {
			expect(logMsg({ a: 1 })).toBe('[Object]');
		});

		it('first arg number -> String(number)', () => {
			expect(logMsg(42)).toBe('42');
		});

		it('format %s -> replace with String(arg)', () => {
			expect(logMsg('hello %s!', 'world')).toBe('hello world!');
		});

		it('format %d -> replace with String(number)', () => {
			expect(logMsg('count: %d items', 5)).toBe('count: 5 items');
		});

		it('format %o -> replace with JSON.stringify(arg)', () => {
			expect(logMsg('data: %o', { x: 1 })).toBe('data: {"x":1}');
		});

		it('format %o with circular argument -> fallback String(sub)', () => {
			const circular: Record<string, unknown> = { x: 1 }
			circular.self = circular;
			expect(logMsg('result: %o', circular)).toBe('result: [object Object]');
		});

		it('format %O with non-serializable argument -> fallback String(sub)', () => {
			const nonSerializable = {
				toJSON() { throw new Error('cannot serialize') }
			}
			expect(logMsg('val: %O', nonSerializable)).toBe('val: [object Object]');
		});

		it('format %c -> replaced with empty string (CSS directive, discarded)', () => {
			expect(logMsg('%cbold text', 'color: red')).toBe('bold text');
		});

		it('more placeholders than arguments -> unsubstituted token remains in the message', () => {
			expect(logMsg('a=%s b=%s', 'value')).toBe('a=value b=%s');
		});

		it('no placeholder with additional arguments -> string unchanged', () => {
			expect(logMsg('hello world', 'extra1', 'extra2')).toBe('hello world');
		});
	});

	describe('events levels (METHOD_LEVEL)', () => {
		it('console.log -> level "info"', () => {
			const { level } = captureOne({ methods: ['log'] }, () => console.log('test'));
			expect(level).toBe('info');
		});

		it('console.info -> level "info"', () => {
			const { level } = captureOne({ methods: ['info'] }, () => console.info('test'));
			expect(level).toBe('info');
		});

		it('console.warn -> level "warn"', () => {
			const { level } = captureOne({ methods: ['warn'] }, () => console.warn('test'));
			expect(level).toBe('warn');
		});

		it('console.error -> level "error"', () => {
			const { level } = captureOne({ methods: ['error'] }, () => console.error('test'));
			expect(level).toBe('error');
		});

		it('console.debug -> level "debug"', () => {
			const { level } = captureOne({ methods: ['debug'] }, () => console.debug('test'));
			expect(level).toBe('debug');
		});

		it('console.trace -> level "debug"', () => {
			const { level } = captureOne({ methods: ['trace'] }, () => console.trace('test'));
			expect(level).toBe('debug');
		});

		it('console.assert (false) -> level "warn"', () => {
			const { level } = captureOne({ methods: ['assert'] }, () =>
				console.assert(false, 'msg')
			);
			expect(level).toBe('warn');
		});
	});

	describe('config boolean true', () => {
		it('true come config uses all default methods', () => {
			const events = capture(true, () => console.log('hello'));
			expect(events).toHaveLength(1);
			expect(events[0].payload.method).toBe('log');
		});

		it('true come config: default patterns are active', () => {
			const events = capture(true, () => console.log('[vite] something'));
			expect(events).toHaveLength(0);
		});

		it('true as config: maxArgs default is 10', () => {
			const args = Array.from({ length: 10 }, (_, i) => `arg${i}`);
			const { payload } = captureOne(true, () => console.log(...(args as [string, ...string[]])));
			expect(payload.args).toHaveLength(10);
			expect(payload.args.every(a => a.type === 'string')).toBe(true);
		});
	});
});
