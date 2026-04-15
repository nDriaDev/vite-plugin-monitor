import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import type { TrackerEvent, LogTransport, EventPayload } from '../../src/types';

function makeFakeStream() {
	const stream = new EventEmitter() as EventEmitter & {
		write: ReturnType<typeof vi.fn>;
		end: ReturnType<typeof vi.fn>;
		destroy: ReturnType<typeof vi.fn>;
		once: ReturnType<typeof vi.fn>;
		bytesWritten: number;
		simulateDrain: () => void;
		simulateError: (err: Error) => void;
	};
	stream.write = vi.fn().mockReturnValue(true);
	stream.end = vi.fn(() => stream.emit('finish'));
	stream.destroy = vi.fn();
	stream.bytesWritten = 0;
	stream.simulateDrain = () => stream.emit('drain');
	stream.simulateError = (err: Error) => stream.emit('error', err);

	const origOnce = stream.once.bind(stream);
	stream.once = vi.fn((event: string, handler: (...args: unknown[]) => void) => {
		return origOnce(event, handler);
	});

	return stream;
}

type FakeStream = ReturnType<typeof makeFakeStream>;

function makeFakeReadStream() {
	return Object.assign(new EventEmitter(), { destroy: vi.fn() });
}

let fakeStream: FakeStream;

/**
 * Wraps createWriteStream so that every returned stream emits 'open'
 * on the next tick — mirroring what a real fs.WriteStream does.
 * This is required because openStream() now awaits the 'open' event.
 */
function makeCreateWriteStream(stream: FakeStream) {
	return vi.fn().mockImplementation(() => {
		process.nextTick(() => stream.emit('open', 1));
		return stream;
	});
}

function setupFsMock(opts: { existsSync?: boolean; readdirSync?: string[]; streamOverride?: FakeStream } = {}) {
	const stream = opts.streamOverride ?? fakeStream;
	const fakeReadStream = makeFakeReadStream();
	const createWriteStream = makeCreateWriteStream(stream);

	vi.doMock('node:fs', () => ({
		default: {
			existsSync: vi.fn().mockReturnValue(opts.existsSync ?? true),
			mkdirSync: vi.fn(),
			createWriteStream,
			createReadStream: vi.fn().mockReturnValue(fakeReadStream),
			renameSync: vi.fn(),
			readdirSync: vi.fn().mockReturnValue(opts.readdirSync ?? []),
			unlinkSync: vi.fn(),
		},
		existsSync: vi.fn().mockReturnValue(opts.existsSync ?? true),
		mkdirSync: vi.fn(),
		createWriteStream,
		createReadStream: vi.fn().mockReturnValue(fakeReadStream),
		renameSync: vi.fn(),
		readdirSync: vi.fn().mockReturnValue(opts.readdirSync ?? []),
		unlinkSync: vi.fn(),
	}));
}

function makeEvent(overrides: Partial<TrackerEvent> = {}): TrackerEvent {
	return {
		type: 'console',
		level: 'info',
		timestamp: new Date().toISOString(),
		appId: 'test-app',
		sessionId: 'sess_test',
		userId: null,
		payload: { message: 'hello' },
		meta: {},
		...overrides,
	} as TrackerEvent;
}

function makeTransport(overrides: Partial<LogTransport> = {}): LogTransport {
	return {
		format: 'json',
		path: './logs/test.log',
		...overrides,
	};
}

function makeFakeRl(lines: string[]) {
	return {
		[Symbol.asyncIterator]: async function* () {
			for (const line of lines) {
				yield line;
			}
		},
		close: vi.fn(),
	};
}

function makeBrokenRl(error: Error) {
	return {
		[Symbol.asyncIterator]: async function* () {
			throw error;

			yield '';
		},
		close: vi.fn(),
	};
}

/** Flushes all pending microtasks and nextTick callbacks. */
async function flushAsync(ms = 20) {
	await new Promise(r => setTimeout(r, ms));
}

beforeEach(() => {
	fakeStream = makeFakeStream();
	setupFsMock();
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.doUnmock('node:fs');
	vi.doUnmock('node:readline');
	vi.resetModules();
	vi.useRealTimers();
});

describe('createLogger()', () => {

	describe('console methods (main thread)', () => {
		it('debug() writes to console.debug when minLevel is debug', async () => {
			vi.resetModules();
			setupFsMock();
			const { createLogger: cl } = await import('../../src/plugin/logger');
			const spy = vi.spyOn(console, 'debug').mockImplementation(() => { });
			const logger = cl('test-app', { level: 'debug' });
			logger.debug('test debug');
			expect(spy).toHaveBeenCalledOnce();
			expect(spy.mock.calls[0][0]).toContain('test debug');
		});

		it('parseSize default 10mb', async () => {
			vi.resetModules();
			setupFsMock();
			const { createLogger: cl } = await import('../../src/plugin/logger');
			const spy = vi.spyOn(console, 'debug').mockImplementation(() => { });
			const logger = cl('test-app', { level: 'debug', transports: [{ rotation: { strategy: 'size', maxSize: 'aa' }, format: 'json', path: '' }] });
			logger.debug('test debug');
			expect(spy).toHaveBeenCalledOnce();
			expect(spy.mock.calls[0][0]).toContain('test debug');
		});

		it('debug() does not write when minLevel is info', async () => {
			vi.resetModules();
			setupFsMock();
			const { createLogger: cl } = await import('../../src/plugin/logger');
			const spy = vi.spyOn(console, 'debug').mockImplementation(() => { });
			const logger = cl('test-app', { level: 'info' });
			logger.debug('silent');
			expect(spy).not.toHaveBeenCalled();
		});

		it('info() writes to console.info', async () => {
			vi.resetModules();
			setupFsMock();
			const { createLogger: cl } = await import('../../src/plugin/logger');
			const spy = vi.spyOn(console, 'info').mockImplementation(() => { });
			const logger = cl('test-app', { level: 'info' });
			logger.info('test info');
			expect(spy).toHaveBeenCalledOnce();
		});

		it('warn() writes to console.warn', async () => {
			vi.resetModules();
			setupFsMock();
			const { createLogger: cl } = await import('../../src/plugin/logger');
			const spy = vi.spyOn(console, 'warn').mockImplementation(() => { });
			const logger = cl('test-app', { level: 'info' });
			logger.warn('test warn');
			expect(spy).toHaveBeenCalledOnce();
		});

		it('error() writes to console.error', async () => {
			vi.resetModules();
			setupFsMock();
			const { createLogger: cl } = await import('../../src/plugin/logger');
			const spy = vi.spyOn(console, 'error').mockImplementation(() => { });
			const logger = cl('test-app', { level: 'info' });
			logger.error('test error');
			expect(spy).toHaveBeenCalledOnce();
		});

		it('warn() does not write when minLevel is error', async () => {
			vi.resetModules();
			setupFsMock();
			const { createLogger: cl } = await import('../../src/plugin/logger');
			const spy = vi.spyOn(console, 'warn').mockImplementation(() => { });
			const logger = cl('test-app', { level: 'error' });
			logger.warn('silent warn');
			expect(spy).not.toHaveBeenCalled();
		});

		it('the message includes the prefix [vite-plugin-monitor]', async () => {
			vi.resetModules();
			setupFsMock();
			const { createLogger: cl } = await import('../../src/plugin/logger');
			const spy = vi.spyOn(console, 'info').mockImplementation(() => { });
			const logger = cl('test-app', { level: 'info' });
			logger.info('ciao');
			expect(spy.mock.calls[0][0]).toContain('[vite-plugin-monitor]');
		});

		it('creates directory if it does not exist', async () => {
			vi.resetModules();
			const mkdirSpy = vi.fn();
			const s = makeFakeStream();
			vi.doMock('node:fs', () => ({
				default: {
					existsSync: vi.fn().mockReturnValue(false),
					mkdirSync: mkdirSpy,
					createWriteStream: makeCreateWriteStream(s),
					createReadStream: vi.fn().mockReturnValue(makeFakeReadStream()),
					renameSync: vi.fn(),
					readdirSync: vi.fn().mockReturnValue([]),
					unlinkSync: vi.fn(),
				},
			}));
			const { createLogger } = await import('../../src/plugin/logger');
			createLogger('test', { transports: [{ format: 'json', path: './logs/test.log' }] });
			expect(mkdirSpy).toHaveBeenCalled();
		});

		it('handles transport write errors gracefully', async () => {
			vi.resetModules();
			setupFsMock();
			const { createLogger } = await import('../../src/plugin/logger');
			const spy = vi.spyOn(console, 'error').mockImplementation(() => { });
			const logger = createLogger('test', {
				level: 'info',
				transports: [makeTransport()],
			});


			await flushAsync();



			fakeStream.write = vi.fn().mockImplementation(() => {
				process.nextTick(() => fakeStream.emit('error', new Error('boom')));
				return true;
			});

			logger.writeEvent(makeEvent());
			await flushAsync();

			expect(spy).toHaveBeenCalledWith(expect.stringContaining('boom'));
		});
	});

	describe('writeEvent()', () => {
		it('writes a JSON line to the stream for an info event', async () => {
			vi.resetModules();
			setupFsMock();
			const { createLogger: cl } = await import('../../src/plugin/logger');
			const logger = cl('test-app', { level: 'info', transports: [makeTransport()] });
			const ev = makeEvent();
			logger.writeEvent(ev);
			await flushAsync();
			expect(fakeStream.write).toHaveBeenCalledOnce();
			const [line] = fakeStream.write.mock.calls[0];
			expect(line).toContain(JSON.stringify(ev));
		});

		it('event below minLevel is not written to stream', async () => {
			vi.resetModules();
			setupFsMock();
			const { createLogger: cl } = await import('../../src/plugin/logger');
			const logger = cl('test-app', { level: 'error', transports: [makeTransport()] });
			logger.writeEvent(makeEvent({ level: 'info' }));
			await flushAsync();
			expect(fakeStream.write).not.toHaveBeenCalled();
		});

		it('event at minLevel is written', async () => {
			vi.resetModules();
			setupFsMock();
			const { createLogger: cl } = await import('../../src/plugin/logger');
			const logger = cl('test-app', { level: 'warn', transports: [makeTransport()] });
			logger.writeEvent(makeEvent({ level: 'warn' }));
			await flushAsync();
			expect(fakeStream.write).toHaveBeenCalledOnce();
		});

		it('writes to all transports when multiple are configured', async () => {
			vi.resetModules();
			const stream1 = makeFakeStream();
			const stream2 = makeFakeStream();
			const streams = [stream1, stream2];
			let callCount = 0;
			vi.doMock('node:fs', () => {
				const mod = {
					existsSync: vi.fn().mockReturnValue(true),
					mkdirSync: vi.fn(),
					createWriteStream: vi.fn().mockImplementation(() => {
						const s = streams[callCount++] ?? stream2;
						process.nextTick(() => s.emit('open', 1));
						return s;
					}),
					createReadStream: vi.fn().mockReturnValue(makeFakeReadStream()),
					renameSync: vi.fn(),
					readdirSync: vi.fn().mockReturnValue([]),
					unlinkSync: vi.fn(),
				};
				return { default: mod, ...mod };
			});
			const { createLogger: cl } = await import('../../src/plugin/logger');
			const logger = cl('test-app', {
				level: 'info',
				transports: [makeTransport({ path: './logs/a.log' }), makeTransport({ path: './logs/b.log' })],
			});
			logger.writeEvent(makeEvent());
			await flushAsync();
			expect(stream1.write).toHaveBeenCalledOnce();
			expect(stream2.write).toHaveBeenCalledOnce();
		});

		it('pretty format produces aligned-column output', async () => {
			vi.resetModules();
			setupFsMock();
			const { createLogger: cl } = await import('../../src/plugin/logger');
			const logger = cl('test-app', {
				level: 'info',
				transports: [makeTransport({ format: 'pretty' })],
			});
			logger.writeEvent(makeEvent({ level: 'info', type: 'navigation' }));
			await flushAsync();
			const [line] = fakeStream.write.mock.calls[0];
			expect(line).toContain('INFO');
			expect(line).toContain('navigation');
		});

		it('stream error is reported via console.error', async () => {
			vi.resetModules();
			setupFsMock();
			const { createLogger: cl } = await import('../../src/plugin/logger');
			const spy = vi.spyOn(console, 'error').mockImplementation(() => { });
			cl('test-app', { level: 'info', transports: [makeTransport()] });

			await flushAsync();
			fakeStream.simulateError(new Error('disk full'));
			expect(spy).toHaveBeenCalledWith(expect.stringContaining('disk full'));
		});

		describe('backpressure handling', () => {
			it('buffers lines when stream.write returns false', async () => {
				vi.resetModules();
				const backpressureStream = makeFakeStream();
				backpressureStream.write = vi.fn()
					.mockReturnValueOnce(false)
					.mockReturnValue(true);
				setupFsMock({ streamOverride: backpressureStream });
				const { createLogger: cl } = await import('../../src/plugin/logger');
				const logger = cl('test-app', { level: 'info', transports: [makeTransport()] });


				await flushAsync();

				logger.writeEvent(makeEvent({ payload: { message: '1' } as EventPayload }));

				await flushAsync();

				logger.writeEvent(makeEvent({ payload: { message: '2' } as EventPayload }));

				await flushAsync();

				expect(backpressureStream.write).toHaveBeenCalledTimes(1);


				backpressureStream.simulateDrain();
				await flushAsync();

				expect(backpressureStream.write).toHaveBeenCalledTimes(2);
			});
		});
	});

	describe('rotation strategy', () => {
		it('rotates stream when day changes (daily rotation)', async () => {
			vi.resetModules();

			const stream1 = makeFakeStream();
			const stream2 = makeFakeStream();
			let call = 0;

			vi.doMock('node:fs', () => ({
				default: {
					existsSync: vi.fn().mockReturnValue(true),
					mkdirSync: vi.fn(),
					createWriteStream: vi.fn().mockImplementation(() => {
						const s = call++ === 0 ? stream1 : stream2;
						process.nextTick(() => s.emit('open', 1));
						return s;
					}),
					createReadStream: vi.fn().mockReturnValue(makeFakeReadStream()),
					renameSync: vi.fn(),
					readdirSync: vi.fn().mockReturnValue([]),
					unlinkSync: vi.fn(),
				},
			}));


			vi.useFakeTimers({ toFake: ['Date'] });
			vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));

			const { createLogger } = await import('../../src/plugin/logger');

			const logger = createLogger('test', {
				level: 'info',
				transports: [{
					format: 'json',
					path: './logs/test.log',
					rotation: { strategy: 'daily' },
				}],
			});


			await flushAsync();

			logger.writeEvent(makeEvent());
			await flushAsync();

			vi.setSystemTime(new Date('2024-01-02T00:00:00Z'));

			logger.writeEvent(makeEvent());
			await flushAsync();

			expect(stream1.end).toHaveBeenCalled();
			expect(call).toBeGreaterThan(1);
		});

		it('rotates when size limit is exceeded', async () => {
			vi.resetModules();

			const stream = makeFakeStream();
			stream.bytesWritten = 99_999_999;

			const renameSpy = vi.fn();

			vi.doMock('node:fs', () => ({
				default: {
					existsSync: vi.fn().mockReturnValue(true),
					mkdirSync: vi.fn(),
					createWriteStream: makeCreateWriteStream(stream),
					createReadStream: vi.fn().mockReturnValue(makeFakeReadStream()),
					renameSync: renameSpy,
					readdirSync: vi.fn().mockReturnValue([]),
					unlinkSync: vi.fn(),
				},
			}));

			const { createLogger } = await import('../../src/plugin/logger');

			const logger = createLogger('test', {
				level: 'info',
				transports: [{
					format: 'json',
					path: './logs/test.log',
					rotation: { strategy: 'size', maxSize: '1b' },
				}],
			});

			await flushAsync();
			logger.writeEvent(makeEvent());
			await flushAsync();

			expect(renameSpy).toHaveBeenCalled();
		});

		it('removes old rotated files beyond maxFiles', async () => {
			vi.resetModules();

			const unlinkSpy = vi.fn();
			const stream = makeFakeStream();
			stream.bytesWritten = 99_999_999;

			vi.doMock('node:fs', () => ({
				default: {
					existsSync: vi.fn().mockReturnValue(true),
					mkdirSync: vi.fn(),
					createWriteStream: makeCreateWriteStream(stream),
					createReadStream: vi.fn().mockReturnValue(makeFakeReadStream()),
					renameSync: vi.fn(),
					readdirSync: vi.fn().mockReturnValue([
						'test-2024_01_01.log',
						'test-2024_01_02.log',
						'test-2024_01_03.log',
						'test.log',
					]),
					unlinkSync: unlinkSpy,
				},
			}));

			const { createLogger } = await import('../../src/plugin/logger');

			const logger = createLogger('test', {
				level: 'info',
				transports: [{
					format: 'json',
					path: './logs/test.log',
					rotation: { strategy: 'size', maxFiles: 1 },
				}],
			});

			await flushAsync();
			logger.writeEvent(makeEvent());
			await flushAsync();

			expect(unlinkSpy).toHaveBeenCalled();
		});
	});

	describe('destroy()', () => {
		it('closes all write streams', async () => {
			vi.resetModules();
			setupFsMock();
			const { createLogger: cl } = await import('../../src/plugin/logger');
			const logger = cl('test-app', { level: 'info', transports: [makeTransport()] });
			await logger.destroy();
			expect(fakeStream.end).toHaveBeenCalledOnce();
		});

		it('flushes pending buffered lines before closing', async () => {
			vi.resetModules();
			const bufStream = makeFakeStream();
			bufStream.write = vi.fn()
				.mockReturnValueOnce(false)
				.mockReturnValue(true);
			setupFsMock({ streamOverride: bufStream });
			const { createLogger: cl } = await import('../../src/plugin/logger');
			const logger = cl('test-app', { level: 'info', transports: [makeTransport()] });

			await flushAsync();

			logger.writeEvent(makeEvent({ payload: { message: 'queued' } as EventPayload }));
			await flushAsync();


			bufStream.simulateDrain();
			await flushAsync();

			logger.writeEvent(makeEvent({ payload: { message: 'queued2' } as EventPayload }));

			await logger.destroy();

			expect(bufStream.write).toHaveBeenCalledTimes(2);
			expect(bufStream.end).toHaveBeenCalledOnce();
		});

		it('resolves when no transports have pending data', async () => {
			vi.resetModules();
			setupFsMock();
			const { createLogger: cl } = await import('../../src/plugin/logger');
			const logger = cl('test-app', { level: 'info', transports: [makeTransport()] });
			await expect(logger.destroy()).resolves.toBeUndefined();
		});
	});

	describe('startHydration()', () => {
		it('calls onDone with zeros if no log directory exists', async () => {
			vi.resetModules();
			const s = makeFakeStream();
			vi.doMock('node:fs', () => {
				const mod = {
					existsSync: vi.fn().mockReturnValue(false),
					mkdirSync: vi.fn(),
					createWriteStream: makeCreateWriteStream(s),
					createReadStream: vi.fn().mockReturnValue(makeFakeReadStream()),
					renameSync: vi.fn(),
					readdirSync: vi.fn().mockReturnValue([]),
					unlinkSync: vi.fn(),
				};
				return { default: mod, ...mod };
			});
			const { createLogger: cl } = await import('../../src/plugin/logger');
			const onDone = vi.fn();
			const logger = cl('test-app', { level: 'info', transports: [makeTransport()] });
			await logger.startHydration(vi.fn(), onDone);
			expect(onDone).toHaveBeenCalledWith({
				loaded: 0,
				skippedMalformed: 0,
				skippedInvalid: 0,
				limitReached: false,
			});
		});

		it('skips pretty-format transports', async () => {
			vi.resetModules();
			setupFsMock();
			const { createLogger: cl } = await import('../../src/plugin/logger');
			const onDone = vi.fn();
			const logger = cl('test-app', {
				level: 'info',
				transports: [makeTransport({ format: 'pretty' })],
			});
			await logger.startHydration(vi.fn(), onDone);
			expect(onDone).toHaveBeenCalledWith({
				loaded: 0,
				skippedMalformed: 0,
				skippedInvalid: 0,
				limitReached: false,
			});
		});

		it('parses valid JSONL lines and emits onBatch', async () => {
			vi.resetModules();
			const ev = makeEvent({ userId: 'user-hydrate' });
			const rl = makeFakeRl([JSON.stringify(ev)]);

			vi.doMock('node:fs', () => {
				const mod = {
					existsSync: vi.fn().mockReturnValue(true),
					mkdirSync: vi.fn(),
					createWriteStream: makeCreateWriteStream(fakeStream),
					createReadStream: vi.fn().mockReturnValue(makeFakeReadStream()),
					renameSync: vi.fn(),
					readdirSync: vi.fn().mockReturnValue(['test.log']),
					unlinkSync: vi.fn(),
				};
				return { default: mod, ...mod };
			});

			vi.doMock('node:readline', () => ({
				default: { createInterface: vi.fn().mockReturnValue(rl) },
				createInterface: vi.fn().mockReturnValue(rl),
			}));

			const { createLogger: cl } = await import('../../src/plugin/logger');
			const onBatch = vi.fn();
			const onDone = vi.fn();
			const logger = cl('test-app', { level: 'info', transports: [makeTransport()] });
			await logger.startHydration(onBatch, onDone);

			expect(onBatch).toHaveBeenCalledWith(
				expect.arrayContaining([expect.objectContaining({ userId: 'user-hydrate' })]),
			);
			expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ loaded: 1 }));
		});

		it('counts malformed JSON lines in skippedMalformed', async () => {
			vi.resetModules();
			const rl = makeFakeRl(['not-valid-json']);

			vi.doMock('node:fs', () => {
				const mod = {
					existsSync: vi.fn().mockReturnValue(true),
					mkdirSync: vi.fn(),
					createWriteStream: makeCreateWriteStream(fakeStream),
					createReadStream: vi.fn().mockReturnValue(makeFakeReadStream()),
					renameSync: vi.fn(),
					readdirSync: vi.fn().mockReturnValue(['test.log']),
					unlinkSync: vi.fn(),
				};
				return { default: mod, ...mod };
			});

			vi.doMock('node:readline', () => ({
				default: { createInterface: vi.fn().mockReturnValue(rl) },
				createInterface: vi.fn().mockReturnValue(rl),
			}));

			const { createLogger: cl } = await import('../../src/plugin/logger');
			const onDone = vi.fn();
			const logger = cl('test-app', { level: 'info', transports: [makeTransport()] });
			await logger.startHydration(vi.fn(), onDone);

			expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ skippedMalformed: 1 }));
		});

		it('counts structurally invalid events in skippedInvalid', async () => {
			vi.resetModules();
			const rl = makeFakeRl([JSON.stringify({ foo: 'bar' })]);

			vi.doMock('node:fs', () => {
				const mod = {
					existsSync: vi.fn().mockReturnValue(true),
					mkdirSync: vi.fn(),
					createWriteStream: makeCreateWriteStream(fakeStream),
					createReadStream: vi.fn().mockReturnValue(makeFakeReadStream()),
					renameSync: vi.fn(),
					readdirSync: vi.fn().mockReturnValue(['test.log']),
					unlinkSync: vi.fn(),
				};
				return { default: mod, ...mod };
			});

			vi.doMock('node:readline', () => ({
				default: { createInterface: vi.fn().mockReturnValue(rl) },
				createInterface: vi.fn().mockReturnValue(rl),
			}));

			const { createLogger: cl } = await import('../../src/plugin/logger');
			const onDone = vi.fn();
			const logger = cl('test-app', { level: 'info', transports: [makeTransport()] });
			await logger.startHydration(vi.fn(), onDone);

			expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ skippedInvalid: 1 }));
		});

		it('reports limitReached: true when byte cap is hit', async () => {
			vi.resetModules();
			const ev = makeEvent({ userId: 'user-x' });
			const rl = makeFakeRl([JSON.stringify(ev)]);

			vi.doMock('node:fs', () => {
				const mod = {
					existsSync: vi.fn().mockReturnValue(true),
					mkdirSync: vi.fn(),
					createWriteStream: makeCreateWriteStream(fakeStream),
					createReadStream: vi.fn().mockReturnValue(makeFakeReadStream()),
					renameSync: vi.fn(),
					readdirSync: vi.fn().mockReturnValue(['test-1.log', 'test-2.log']),
					unlinkSync: vi.fn(),
				};
				return { default: mod, ...mod };
			});

			vi.doMock('node:readline', () => ({
				default: { createInterface: vi.fn().mockReturnValue(rl) },
				createInterface: vi.fn().mockReturnValue(rl),
			}));

			const { createLogger: cl } = await import('../../src/plugin/logger');
			const onDone = vi.fn();
			const logger = cl('test-app', { level: 'info', transports: [makeTransport()] });
			await logger.startHydration(vi.fn(), onDone, 1, 200);

			expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ limitReached: true }));
		});

		it('handles readdirSync error during hydration', async () => {
			vi.resetModules();

			const spy = vi.spyOn(console, 'error').mockImplementation(() => { });
			const s = makeFakeStream();

			vi.doMock('node:fs', () => {
				const mod = {
					existsSync: vi.fn().mockReturnValue(true),
					mkdirSync: vi.fn(),
					createWriteStream: makeCreateWriteStream(s),
					createReadStream: vi.fn().mockReturnValue(makeFakeReadStream()),
					renameSync: vi.fn(),
					readdirSync: vi.fn().mockImplementation(() => { throw new Error('fail'); }),
					unlinkSync: vi.fn(),
				};
				return { default: mod, ...mod };
			});

			const { createLogger } = await import('../../src/plugin/logger');
			const logger = createLogger('test', { transports: [makeTransport()] });

			await logger.startHydration(vi.fn(), vi.fn());

			expect(spy).toHaveBeenCalledWith(expect.stringContaining('cannot list'));
		});

		it('stops reading further files when byte limit is reached', async () => {
			vi.resetModules();

			const ev = makeEvent();
			const line = JSON.stringify(ev);
			const rl1 = makeFakeRl(['']);
			const rl2 = makeFakeRl([line]);
			let rlCallCount = 0;

			vi.doMock('node:fs', () => {
				const mod = {
					existsSync: vi.fn().mockReturnValue(true),
					mkdirSync: vi.fn(),
					createWriteStream: makeCreateWriteStream(makeFakeStream()),
					createReadStream: vi.fn().mockReturnValue(makeFakeReadStream()),
					renameSync: vi.fn(),
					readdirSync: vi.fn().mockReturnValue(['test.log', 'testds.log']),
					unlinkSync: vi.fn(),
				};
				return { default: mod, ...mod };
			});

			vi.doMock('node:readline', () => ({
				default: {
					createInterface: vi.fn().mockImplementation(() => rlCallCount++ === 0 ? rl1 : rl2),
				},
				createInterface: vi.fn().mockImplementation(() => rlCallCount++ === 0 ? rl1 : rl2),
			}));

			const { createLogger } = await import('../../src/plugin/logger');
			const onDone = vi.fn();
			const logger = createLogger('test', { transports: [makeTransport()] });

			await logger.startHydration(vi.fn(), onDone, 1);

			expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ limitReached: true }));
			expect(rlCallCount).toBe(2);
		});

		it('stops reading further files when batch size is reached', async () => {
			vi.resetModules();

			const ev = makeEvent({ userId: 'jisjids' });
			const line = JSON.stringify(ev);

			const rl1 = makeFakeRl(['null']);
			const rl2 = makeFakeRl([line]);
			let rlCallCount = 0;

			vi.doMock('node:fs', () => {
				const mod = {
					existsSync: vi.fn().mockReturnValue(true),
					mkdirSync: vi.fn(),
					createWriteStream: makeCreateWriteStream(makeFakeStream()),
					createReadStream: vi.fn().mockReturnValue(makeFakeReadStream()),
					renameSync: vi.fn(),
					readdirSync: vi.fn().mockReturnValue(['test.log', 'testds.log']),
					unlinkSync: vi.fn(),
				};
				return { default: mod, ...mod };
			});

			vi.doMock('node:readline', () => ({
				default: {
					createInterface: vi.fn().mockImplementation(() => rlCallCount++ === 0 ? rl1 : rl2),
				},
				createInterface: vi.fn().mockImplementation(() => rlCallCount++ === 0 ? rl1 : rl2),
			}));

			const { createLogger } = await import('../../src/plugin/logger');
			const onBatch = vi.fn();
			const logger = createLogger('test', { transports: [makeTransport()] });

			await logger.startHydration(onBatch, vi.fn(), 25000, 1);

			expect(onBatch).toHaveBeenCalled();
			expect(rlCallCount).toBe(2);
		});

		it('handles read stream error during hydration', async () => {
			vi.resetModules();

			const spy = vi.spyOn(console, 'error').mockImplementation(() => { });
			const brokenRl = makeBrokenRl(new Error('read fail'));

			vi.doMock('node:fs', () => {
				const mod = {
					existsSync: vi.fn().mockReturnValue(true),
					mkdirSync: vi.fn(),
					createWriteStream: makeCreateWriteStream(makeFakeStream()),
					createReadStream: vi.fn().mockReturnValue(makeFakeReadStream()),
					renameSync: vi.fn(),
					readdirSync: vi.fn().mockReturnValue(['test.log']),
					unlinkSync: vi.fn(),
				};
				return { default: mod, ...mod };
			});

			vi.doMock('node:readline', () => ({
				default: { createInterface: vi.fn().mockReturnValue(brokenRl) },
				createInterface: vi.fn().mockReturnValue(brokenRl),
			}));

			const { createLogger } = await import('../../src/plugin/logger');
			const logger = createLogger('test', { transports: [makeTransport()] });

			await logger.startHydration(vi.fn(), vi.fn());

			expect(spy).toHaveBeenCalledWith(expect.stringContaining('cannot read'));
		});

		it('calls onDone with aggregated stats', async () => {
			vi.resetModules();
			setupFsMock();
			const { createLogger } = await import('../../src/plugin/logger');
			const onDone = vi.fn();
			const logger = createLogger('test', {
				transports: [makeTransport({ format: 'pretty' })],
			});

			await logger.startHydration(vi.fn(), onDone);

			expect(onDone).toHaveBeenCalledWith({
				loaded: 0,
				skippedMalformed: 0,
				skippedInvalid: 0,
				limitReached: false,
			});
		});
	});

	describe('streamWrite() error path', () => {
		it('rejects when stream errors after write returns false (backpressure then error)', async () => {
			vi.resetModules();

			const errStream = makeFakeStream();

			errStream.write = vi.fn().mockImplementation(() => {
				process.nextTick(() => errStream.emit('error', new Error('disk error during drain')));
				return false;
			});
			setupFsMock({ streamOverride: errStream });

			const { createLogger: cl } = await import('../../src/plugin/logger');
			const spy = vi.spyOn(console, 'error').mockImplementation(() => { });

			const logger = cl('test-app', { level: 'info', transports: [makeTransport()] });
			await flushAsync();

			logger.writeEvent(makeEvent());
			await flushAsync();
			expect(spy).toHaveBeenCalledWith(expect.stringContaining('disk error during drain'));
		});
	});

	describe('writeLoop null-stream guard', () => {
		it('does not crash when stream is null after a failed size-rotation openStream', async () => {
			vi.resetModules();

			const firstStream = makeFakeStream();
			firstStream.bytesWritten = 99_999_999;

			let openCallCount = 0;
			vi.doMock('node:fs', () => {
				const mod = {
					existsSync: vi.fn().mockReturnValue(true),
					mkdirSync: vi.fn(),

					createWriteStream: vi.fn().mockImplementation(() => {
						openCallCount++;
						if (openCallCount === 1) {
							process.nextTick(() => firstStream.emit('open', 1));
							return firstStream;
						}

						const failStream = makeFakeStream();
						process.nextTick(() => failStream.emit('error', new Error('cannot reopen')));
						return failStream;
					}),
					createReadStream: vi.fn().mockReturnValue(makeFakeReadStream()),
					renameSync: vi.fn(),
					readdirSync: vi.fn().mockReturnValue([]),
					unlinkSync: vi.fn(),
				};
				return { default: mod, ...mod };
			});

			const { createLogger: cl } = await import('../../src/plugin/logger');
			const spy = vi.spyOn(console, 'error').mockImplementation(() => { });

			const logger = cl('test-app', {
				level: 'info',
				transports: [makeTransport({
					path: './logs/test.log',
					rotation: { strategy: 'size', maxSize: '1b' },
				})],
			});
			await flushAsync();

			logger.writeEvent(makeEvent());
			await flushAsync();
			expect(spy).toHaveBeenCalledWith(expect.stringContaining('cannot reopen'));
		});
	});

	describe('lineSource() sentinel termination', () => {
		it('destroy() drains all queued events and terminates the generator cleanly', async () => {
			vi.resetModules();
			setupFsMock();
			const { createLogger: cl } = await import('../../src/plugin/logger');

			const logger = cl('test-app', { level: 'info', transports: [makeTransport()] });
			await flushAsync();

			logger.writeEvent(makeEvent({ payload: { message: 'a' } as EventPayload }));
			logger.writeEvent(makeEvent({ payload: { message: 'b' } as EventPayload }));
			logger.writeEvent(makeEvent({ payload: { message: 'c' } as EventPayload }));

			await logger.destroy();

			expect(fakeStream.write).toHaveBeenCalledTimes(3);
			expect(fakeStream.end).toHaveBeenCalledOnce();
		});
	});

	describe('StreamTransport.write() and destroy() direct paths', () => {
		it('write() enqueues the formatted event which the loop then flushes', async () => {
			vi.resetModules();
			setupFsMock();
			const { createLogger: cl } = await import('../../src/plugin/logger');

			const logger = cl('test-app', {
				level: 'info',
				transports: [makeTransport({ format: 'json' })],
			});
			await flushAsync();

			const ev = makeEvent({ userId: 'direct-write-test' });
			logger.writeEvent(ev);
			await flushAsync();

			const [written] = fakeStream.write.mock.calls[0];
			expect(written).toContain('direct-write-test');
		});

		it('destroy() enqueues null sentinel and resolves after stream closes', async () => {
			vi.resetModules();
			setupFsMock();
			const { createLogger: cl } = await import('../../src/plugin/logger');

			const logger = cl('test-app', { level: 'info', transports: [makeTransport()] });
			await flushAsync();

			await expect(logger.destroy()).resolves.toBeUndefined();
			expect(fakeStream.end).toHaveBeenCalledOnce();
		});
	});
});
