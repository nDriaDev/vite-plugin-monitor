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
		it('restituisce una funzione no-op se window è undefined', () => {
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
		it('chiama il metodo originale prima di emettere l\'evento', () => {
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

		it('dopo teardown(), il metodo originale è ripristinato', () => {
			const originalLog = console.log;
			const teardown = setupConsoleTracker({ methods: ['log'] }, vi.fn());

			expect(console.log).not.toBe(originalLog);

			teardown();
			expect(console.log).toBe(originalLog);
		});

		it('teardown ripristina tutti i metodi specificati in methods', () => {
			const origLog = console.log;
			const origWarn = console.warn;
			const origError = console.error;

			const teardown = setupConsoleTracker({ methods: ['log', 'warn', 'error'] }, vi.fn());
			teardown();

			expect(console.log).toBe(origLog);
			expect(console.warn).toBe(origWarn);
			expect(console.error).toBe(origError);
		});

		it('solo i metodi specificati in opts.methods vengono wrappati', () => {
			const onEvent = vi.fn();
			const teardown = setupConsoleTracker({ methods: ['log'] }, onEvent);

			console.log('tracciato');
			console.warn('non tracciato');
			teardown();
			expect(onEvent).toHaveBeenCalledTimes(1);
			expect(onEvent.mock.calls[0][0].method).toBe('log');
		});

		it('se console[method] non è una funzione il metodo viene saltato senza errori (riga 219)', () => {
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

		it('il teardown non tenta di ripristinare metodi non-funzione (non entrano in originals)', () => {
			const originalTable = console.table;
			Object.defineProperty(console, 'table', { configurable: true, writable: true, value: undefined });

			const teardown = setupConsoleTracker({ methods: ['table'] }, vi.fn());
			expect(() => teardown()).not.toThrow();
			expect(console.table).toBeUndefined();

			Object.defineProperty(console, 'table', { configurable: true, writable: true, value: originalTable });
		});
	});

	describe('filtraggio per pattern', () => {
		it('messaggi che contengono [vite] non emettono evento', () => {
			const events = capture({ methods: ['log'] }, () =>
				console.log('[vite] HMR update')
			);
			expect(events).toHaveLength(0);
		});

		it('messaggi che contengono [HMR] non emettono evento', () => {
			const events = capture({ methods: ['log'] }, () =>
				console.log('[HMR] connected')
			);
			expect(events).toHaveLength(0);
		});

		it('messaggi che contengono [tracker] non emettono evento', () => {
			const events = capture({ methods: ['log'] }, () =>
				console.log('[tracker] init ok')
			);
			expect(events).toHaveLength(0);
		});

		it('messaggi che contengono [vue] non emettono evento', () => {
			const events = capture({ methods: ['warn'] }, () =>
				console.warn('[vue] something')
			);
			expect(events).toHaveLength(0);
		});

		it('messaggi senza pattern predefiniti emettono normalmente', () => {
			const events = capture({ methods: ['log'] }, () =>
				console.log('hello world')
			);
			expect(events).toHaveLength(1);
		});

		it('pattern custom via ignorePatterns sopprimono il messaggio', () => {
			const events = capture(
				{ methods: ['log'], ignorePatterns: ['SUPPRESSED'] },
				() => console.log('SUPPRESSED message')
			);
			expect(events).toHaveLength(0);
		});

		it('pattern custom vengono aggiunti ai predefiniti — entrambi funzionano', () => {
			const cfg: ConsoleTrackOptions = { methods: ['log'], ignorePatterns: ['CUSTOM'] };

			const e1 = capture(cfg, () => console.log('[vite] built-in pattern'));
			const e2 = capture(cfg, () => console.log('CUSTOM pattern'));
			const e3 = capture(cfg, () => console.log('normal message'));

			expect(e1).toHaveLength(0);
			expect(e2).toHaveLength(0);
			expect(e3).toHaveLength(1);
		});

		it('il filtraggio converte il primo arg con String() — null non corrisponde ad alcun pattern', () => {
			const events = capture({ methods: ['log'] }, () => console.log(null));
			expect(events).toHaveLength(1);
		});
	});

	describe('console.assert', () => {
		it('assertion vera (args[0] truthy): non emette nulla', () => {
			const events = capture({ methods: ['assert'] }, () =>
				console.assert(true, 'questo non deve essere emesso')
			);
			expect(events).toHaveLength(0);
		});

		it('assertion falsa (args[0] falsy): emette evento con argomenti da [1] in poi', () => {
			const { payload } = captureOne({ methods: ['assert'] }, () =>
				console.assert(false, 'assertion message', 'detail')
			);
			expect(payload.method).toBe('assert');
			expect(payload.message).toBe('assertion message');
			expect(payload.args).toHaveLength(2);
			expect(payload.args[0]).toEqual({ type: 'string', value: 'assertion message' });
			expect(payload.args[1]).toEqual({ type: 'string', value: 'detail' });
		});

		it('assertion falsa senza messaggi aggiuntivi: emette con args vuoto e message ""', () => {
			const { payload } = captureOne({ methods: ['assert'] }, () =>
				console.assert(false)
			);
			expect(payload.args).toHaveLength(0);
			expect(payload.message).toBe('');
		});

		it('assertion falsa: il boolean false (args[0]) è escluso dagli effectiveArgs serializzati', () => {
			const { payload } = captureOne({ methods: ['assert'] }, () =>
				console.assert(false, 'msg')
			);
			expect(payload.args).toHaveLength(1);
			expect(payload.args[0]).toEqual({ type: 'string', value: 'msg' });
		});
	});

	describe('groupDepth', () => {
		it('evento group porta groupDepth=0 (il depth si incrementa DOPO onEvent)', () => {
			const { payload } = captureOne({ methods: ['group'] }, () =>
				console.group('g1')
			);
			expect(payload.groupDepth).toBe(0);
		});

		it('evento groupCollapsed porta groupDepth=0 (incremento avviene dopo)', () => {
			const { payload } = captureOne({ methods: ['groupCollapsed'] }, () =>
				console.groupCollapsed('gc1')
			);
			expect(payload.groupDepth).toBe(0);
		});

		it('eventi log all\'interno di un group portano groupDepth=1', () => {
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

		it('groupEnd decrementa groupDepth prima di emettere l\'evento', () => {
			const events = capture({ methods: ['group', 'groupEnd'] }, () => {
				console.group('g')
				console.groupEnd()
			});
			expect(events).toHaveLength(2);
			expect(events[1].payload.groupDepth).toBe(0);
		});

		it('groupEnd su depth già 0 non scende sotto 0 (clamp a 0)', () => {
			const { payload } = captureOne({ methods: ['groupEnd'] }, () =>
				console.groupEnd()
			);
			expect(payload.groupDepth).toBe(0);
		});

		it('nesting a due livelli: tutti gli eventi portano il groupDepth corretto', () => {
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

		it('teardown azzera il groupDepth — un secondo tracker parte da 0', () => {
			capture({ methods: ['group'] }, () => console.group('open'));

			const { payload } = captureOne({ methods: ['log'] }, () => console.log('test'));
			expect(payload.groupDepth).toBe(0);
		});
	});

	describe('stack trace', () => {
		it('console.trace include sempre lo stack', () => {
			const { payload } = captureOne({ methods: ['trace'] }, () =>
				console.trace('trace msg')
			);
			expect(payload.stack).toBeDefined();
			expect(typeof payload.stack).toBe('string');
			expect(payload.stack!.length).toBeGreaterThan(0);
		});

		it('console.error senza captureStackOnError non include lo stack', () => {
			const { payload } = captureOne(
				{ methods: ['error'], captureStackOnError: false },
				() => console.error('boom')
			);
			expect(payload.stack).toBeUndefined();
		});

		it('console.error con captureStackOnError: true include lo stack', () => {
			const { payload } = captureOne(
				{ methods: ['error'], captureStackOnError: true },
				() => console.error('boom')
			);
			expect(payload.stack).toBeDefined();
			expect(typeof payload.stack).toBe('string');
			expect(payload.stack!.length).toBeGreaterThan(0);
		});

		it('console.log non include mai lo stack, nemmeno con captureStackOnError: true', () => {
			const { payload } = captureOne(
				{ methods: ['log'], captureStackOnError: true },
				() => console.log('hello')
			);
			expect(payload.stack).toBeUndefined();
		});
	});

	describe('maxArgs', () => {
		it('tutti gli argomenti entro maxArgs vengono serializzati senza sentinel', () => {
			const { payload } = captureOne(
				{ methods: ['log'], maxArgs: 3 },
				() => console.log('a', 'b', 'c')
			);
			expect(payload.args).toHaveLength(3);
			expect(payload.args.every(a => a.type === 'string')).toBe(true);
		});

		it('argomenti oltre maxArgs: aggiunge un sentinel { type: "truncated" }', () => {
			const { payload } = captureOne(
				{ methods: ['log'], maxArgs: 2 },
				() => console.log('a', 'b', 'c', 'd')
			);
			expect(payload.args).toHaveLength(3);
			expect(payload.args[2].type).toBe('truncated');
			expect(payload.args[2].value).toBe('[2 more args]');
		});

		it('maxArgs=1: un solo argomento e sentinel per i restanti', () => {
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

		it('null → { type: "null", value: null }', () => {
			expect(logArg(null)).toEqual({ type: 'null', value: null });
		});

		it('undefined → { type: "undefined", value: "undefined" }', () => {
			expect(logArg(undefined)).toEqual({ type: 'undefined', value: 'undefined' });
		});

		it('boolean true → { type: "boolean", value: true }', () => {
			expect(logArg(true)).toEqual({ type: 'boolean', value: true });
		});

		it('boolean false → { type: "boolean", value: false }', () => {
			expect(logArg(false)).toEqual({ type: 'boolean', value: false });
		});

		it('number finito → { type: "number", value: 42 }', () => {
			expect(logArg(42)).toEqual({ type: 'number', value: 42 });
		});

		it('Infinity → { type: "number", value: "Infinity" } (non finito → String)', () => {
			expect(logArg(Infinity)).toEqual({ type: 'number', value: 'Infinity' });
		});

		it('NaN → { type: "number", value: "NaN" } (non finito → String)', () => {
			expect(logArg(NaN)).toEqual({ type: 'number', value: 'NaN' });
		});

		it('bigint → { type: "bigint", value: "12345n" }', () => {
			expect(logArg(12345n)).toEqual({ type: 'bigint', value: '12345n' });
		});

		it('symbol → { type: "symbol", value: "Symbol(test)" }', () => {
			expect(logArg(Symbol('test'))).toEqual({ type: 'symbol', value: 'Symbol(test)' });
		});

		it('string corta (≤ maxArgLength) → restituita as-is', () => {
			expect(logArg('hello')).toEqual({ type: 'string', value: 'hello' });
		});

		it('string lunga (> maxArgLength) → troncata con indicatore dei caratteri omessi', () => {
			const arg = logArg('x'.repeat(15), cfgShort);
			expect(arg.type).toBe('string');
			expect(arg.value).toBe('x'.repeat(10) + '…[+5]');
		});

		it('string di esattamente maxArgLength → non troncata', () => {
			const arg = logArg('x'.repeat(10), cfgShort);
			expect(arg.type).toBe('string');
			expect(arg.value).toBe('x'.repeat(10));
		});

		it('function con nome → { type: "function", value: "[Function: myFn]" }', () => {
			function myFn() { }
			expect(logArg(myFn)).toEqual({ type: 'function', value: '[Function: myFn]' });
		});

		it('arrow function senza nome → { type: "function", value: "[Function: (anonymous)]" }', () => {
			expect(logArg(() => { })).toEqual({ type: 'function', value: '[Function: (anonymous)]' });
		});

		it('Element con id e classi → { type: "Element", value: "[tag#id.cls1.cls2]" }', () => {
			const el = document.createElement('button');
			el.id = 'submit-btn';
			el.className = 'primary large';
			const arg = logArg(el);
			expect(arg.type).toBe('Element');
			expect(arg.value).toBe('[button#submit-btn.primary.large]');
		});

		it('Element senza id né classi → { type: "Element", value: "[tag]" }', () => {
			const el = document.createElement('div');
			const arg = logArg(el);
			expect(arg.type).toBe('Element');
			expect(arg.value).toBe('[div]');
		});

		it('Element con solo id (nessuna classe) → "[tag#id]"', () => {
			const el = document.createElement('span');
			el.id = 'my-span';
			const arg = logArg(el);
			expect(arg.value).toBe('[span#my-span]');
		});

		it('TextNode (Node ma non Element) → { type: "Node", value: "[Text]" } (riga 84)', () => {
			const textNode = document.createTextNode('hello');
			const arg = logArg(textNode);
			expect(arg.type).toBe('Node');
			expect(arg.value).toBe('[Text]');
		});

		it('Comment (Node ma non Element) → { type: "Node", value: "[Comment]" } (riga 84)', () => {
			const comment = document.createComment('nota');
			const arg = logArg(comment);
			expect(arg.type).toBe('Node');
			expect(arg.value).toBe('[Comment]');
		});

		it('Error → { type: "Error", value: { name, message, stack } }', () => {
			const err = new TypeError('something went wrong');
			const arg = logArg(err);
			expect(arg.type).toBe('Error');
			const v = arg.value as { name: string; message: string; stack: string | undefined };
			expect(v.name).toBe('TypeError');
			expect(v.message).toBe('something went wrong');
			expect(v).toHaveProperty('name');
			expect(v).toHaveProperty('message');
		});

		it('oggetto normale → { type: "object", value: <parsed JSON dell\'oggetto> }', () => {
			const obj = { x: 1, y: 'hello' };
			const arg = logArg(obj);
			expect(arg.type).toBe('object');
			expect(arg.value).toEqual({ x: 1, y: 'hello' });
		});

		it('array → { type: "array", value: <array clonato> }', () => {
			const arr = [1, 'two', true];
			const arg = logArg(arr);
			expect(arg.type).toBe('array');
			expect(arg.value).toEqual([1, 'two', true]);
		});

		it('oggetto il cui JSON supera maxArgLength → troncato e re-parsato (riga 102)', () => {
			const cfg: ConsoleTrackOptions = { methods: ['log'], maxArgLength: 30 };
			const arg = logArg({ key: 'x'.repeat(100) }, cfg);
			expect(arg.type).toBe('object');
			expect(arg.value).toBeDefined();
		});

		it('array il cui JSON supera maxArgLength → JSON.parse del truncated lancia, cade nel catch (riga 102)', () => {
			const cfg: ConsoleTrackOptions = { methods: ['log'], maxArgLength: 20 };
			const arg = logArg(Array.from({ length: 50 }, (_, i) => i), cfg);
			expect(arg.type).toBe('array');
			expect(arg.value).toBe('[\n  0,\n  1,\n  2,\n  3\n…[+272 chars]');
		});

		it('oggetto con proprietà BigInt → la proprietà bigint è convertita a "Xn" dal replacer (riga 128)', () => {
			const arg = logArg({ n: 42n });
			expect(arg.type).toBe('object');
			expect((arg.value as Record<string, unknown>).n).toBe('42n');
		});

		it('oggetto con proprietà funzione → convertita a "[Function: name]" dal replacer (riga 131)', () => {
			function myHandler() { }
			const arg = logArg({ handler: myHandler });
			expect(arg.type).toBe('object');
			expect((arg.value as Record<string, unknown>).handler).toBe('[Function: myHandler]');
		});

		it('oggetto con funzione anonima → il replacer usa "anonymous" come fallback (riga 131)', () => {
			const anonFn = function named() { }
			Object.defineProperty(anonFn, 'name', { value: '', configurable: true });
			const arg = logArg({ cb: anonFn });
			expect(arg.type).toBe('object');
			expect((arg.value as Record<string, unknown>).cb).toBe('[Function: anonymous]');
		});

		it('oggetto con proprietà Element → convertita a "[tagname]" dal replacer (riga 135)', () => {
			const el = document.createElement('button');
			const obj: Record<string, unknown> = { node: el };
			obj.self = obj;
			const arg = logArg(obj);
			expect(arg.type).toBe('object');
			expect((arg.value as Record<string, unknown>).node).toBe('[button]');
			expect((arg.value as Record<string, unknown>).self).toBe('[Circular]');
		});

		it('oggetto con riferimento circolare → il valore circolare diventa "[Circular]"', () => {
			const circular: Record<string, unknown> = { a: 1 }
			circular.self = circular;

			const arg = logArg(circular);
			expect(arg.type).toBe('object');
			expect((arg.value as Record<string, unknown>).a).toBe(1);
			expect((arg.value as Record<string, unknown>).self).toBe('[Circular]');
		});

		it('oggetto non serializzabile → { type: "object", value: "[unserializable object]" }', () => {
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

		it('nessun argomento → stringa vuota', () => {
			const { payload } = captureOne(cfg, () => console.log());
			expect(payload.message).toBe('');
		});

		it('primo arg Error → "ErrorName: message"', () => {
			expect(logMsg(new TypeError('type error'))).toBe('TypeError: type error');
		});

		it('primo arg null → "null"', () => {
			expect(logMsg(null)).toBe('null');
		});

		it('primo arg undefined → "undefined"', () => {
			expect(logMsg(undefined)).toBe('undefined');
		});

		it('primo arg array → "[Array]"', () => {
			expect(logMsg([1, 2, 3])).toBe('[Array]');
		});

		it('primo arg oggetto → "[Object]"', () => {
			expect(logMsg({ a: 1 })).toBe('[Object]');
		});

		it('primo arg number → String(number)', () => {
			expect(logMsg(42)).toBe('42');
		});

		it('format %s → sostituisce con String(arg)', () => {
			expect(logMsg('hello %s!', 'world')).toBe('hello world!');
		});

		it('format %d → sostituisce con String(number)', () => {
			expect(logMsg('count: %d items', 5)).toBe('count: 5 items');
		});

		it('format %o → sostituisce con JSON.stringify(arg)', () => {
			expect(logMsg('data: %o', { x: 1 })).toBe('data: {"x":1}');
		});

		it('format %o con argomento circolare → fallback String(sub) (riga 185)', () => {
			const circular: Record<string, unknown> = { x: 1 }
			circular.self = circular;
			expect(logMsg('result: %o', circular)).toBe('result: [object Object]');
		});

		it('format %O con argomento non serializzabile → fallback String(sub) (riga 185)', () => {
			const nonSerializable = {
				toJSON() { throw new Error('cannot serialize') }
			}
			expect(logMsg('val: %O', nonSerializable)).toBe('val: [object Object]');
		});

		it('format %c → sostituito con stringa vuota (direttiva CSS, scartata)', () => {
			expect(logMsg('%cbold text', 'color: red')).toBe('bold text');
		});

		it('più placeholder che argomenti → token non sostituito rimane nel messaggio', () => {
			expect(logMsg('a=%s b=%s', 'value')).toBe('a=value b=%s');
		});

		it('nessun placeholder con argomenti aggiuntivi → stringa invariata', () => {
			expect(logMsg('hello world', 'extra1', 'extra2')).toBe('hello world');
		});
	});

	describe('livelli degli eventi (METHOD_LEVEL)', () => {
		it('console.log → level "info"', () => {
			const { level } = captureOne({ methods: ['log'] }, () => console.log('test'));
			expect(level).toBe('info');
		});

		it('console.info → level "info"', () => {
			const { level } = captureOne({ methods: ['info'] }, () => console.info('test'));
			expect(level).toBe('info');
		});

		it('console.warn → level "warn"', () => {
			const { level } = captureOne({ methods: ['warn'] }, () => console.warn('test'));
			expect(level).toBe('warn');
		});

		it('console.error → level "error"', () => {
			const { level } = captureOne({ methods: ['error'] }, () => console.error('test'));
			expect(level).toBe('error');
		});

		it('console.debug → level "debug"', () => {
			const { level } = captureOne({ methods: ['debug'] }, () => console.debug('test'));
			expect(level).toBe('debug');
		});

		it('console.trace → level "debug"', () => {
			const { level } = captureOne({ methods: ['trace'] }, () => console.trace('test'));
			expect(level).toBe('debug');
		});

		it('console.assert (false) → level "warn"', () => {
			const { level } = captureOne({ methods: ['assert'] }, () =>
				console.assert(false, 'msg')
			);
			expect(level).toBe('warn');
		});
	});

	describe('config boolean true', () => {
		it('true come config usa tutti i metodi predefiniti', () => {
			const events = capture(true, () => console.log('hello'));
			expect(events).toHaveLength(1);
			expect(events[0].payload.method).toBe('log');
		});

		it('true come config: i pattern predefiniti sono attivi', () => {
			const events = capture(true, () => console.log('[vite] something'));
			expect(events).toHaveLength(0);
		});

		it('true come config: maxArgs default è 10', () => {
			const args = Array.from({ length: 10 }, (_, i) => `arg${i}`);
			const { payload } = captureOne(true, () => console.log(...(args as [string, ...string[]])));
			expect(payload.args).toHaveLength(10);
			expect(payload.args.every(a => a.type === 'string')).toBe(true);
		});
	});
});
