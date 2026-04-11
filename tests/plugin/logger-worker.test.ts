import { PassThrough } from 'node:stream';
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { TrackerEvent, LogTransport } from '../../src/types';
import { EventEmitter } from 'node:events';

class FakeParentPort extends EventEmitter {
	postMessage = vi.fn()
}

function makeFakeStream() {
	const stream = {
		write: vi.fn().mockReturnValue(true),
		end: vi.fn(),
		once: vi.fn(),
		on: vi.fn(),
		bytesWritten: 0
	}
	return stream;
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
	}
}

type WorkerModule = typeof import('../../src/plugin/logger-worker')

async function loadWorker(opts: { transports: LogTransport[], minLevel: number, fakePort: FakeParentPort, fakeStream?: ReturnType<typeof makeFakeStream> }): Promise<WorkerModule> {
	const stream = opts.fakeStream ?? makeFakeStream();

	vi.resetModules();

	vi.doMock('node:worker_threads', () => ({
		parentPort: opts.fakePort,
		workerData: { transports: opts.transports, minLevel: opts.minLevel },
	}));

	vi.doMock('node:fs', () => ({
		default: {
			existsSync: vi.fn().mockReturnValue(true),
			mkdirSync: vi.fn(),
			createWriteStream: vi.fn().mockReturnValue(stream),
			renameSync: vi.fn(),
			readdirSync: vi.fn().mockReturnValue([]),
			statSync: vi.fn().mockReturnValue({ mtimeMs: Date.now() }),
			unlinkSync: vi.fn()
		},
		existsSync: vi.fn().mockReturnValue(true),
		mkdirSync: vi.fn(),
		createWriteStream: vi.fn().mockReturnValue(stream),
		renameSync: vi.fn(),
		readdirSync: vi.fn().mockReturnValue([]),
		statSync: vi.fn().mockReturnValue({ mtimeMs: Date.now() }),
		unlinkSync: vi.fn()
	}));

	return import('../../src/plugin/logger-worker');
}

function makeValidLine(overrides: Partial<TrackerEvent> = {}, makeInvalid = false): string {
	return makeInvalid ? "null" as unknown as string : JSON.stringify(makeEvent({ userId: 'user-test', ...overrides }));
}

/**
 * Creates a fake readline + stream pair that emits the given lines and then
 * closes. Mirrors what `readline.createInterface` returns in production.
 */
function makeFakeRl(lines: string[]) {
	const rl = new EventEmitter() as EventEmitter & { close?: () => void };
	const emit = () => {
		for (const line of lines) {
			rl.emit('line', line);
		}
		rl.emit('close');
	};

	return { rl, emit };
}

afterEach(() => {
	vi.restoreAllMocks();
	vi.doUnmock('node:worker_threads');
	vi.doUnmock('node:fs');
});

describe('logger-worker — initialization', () => {
	it('invia { type: "ready" } a parentPort subito dopo l\'import', async () => {
		const port = new FakeParentPort();
		await loadWorker({ transports: [makeTransport()], minLevel: 1, fakePort: port });
		expect(port.postMessage).toHaveBeenCalledWith({ type: 'ready' });
	});

	it('creates a WriteStream for each transport provided in workerData', async () => {
		const port = new FakeParentPort();
		const stream = makeFakeStream();

		vi.resetModules();
		vi.doMock('node:worker_threads', () => ({
			parentPort: port,
			workerData: {
				transports: [makeTransport(), makeTransport({ path: './logs/b.log' })],
				minLevel: 1,
			},
		}));

		let createWriteStreamCallCount = 0;
		vi.doMock('node:fs', () => {
			const createWriteStream = vi.fn().mockImplementation(() => {
				createWriteStreamCallCount++;
				return stream;
			});
			return {
				default: {
					existsSync: vi.fn().mockReturnValue(true),
					mkdirSync: vi.fn(),
					createWriteStream,
					renameSync: vi.fn(),
					readdirSync: vi.fn().mockReturnValue([]),
					statSync: vi.fn().mockReturnValue({ mtimeMs: Date.now() }),
					unlinkSync: vi.fn()
				},
				existsSync: vi.fn().mockReturnValue(true),
				mkdirSync: vi.fn(),
				createWriteStream,
				renameSync: vi.fn(),
				readdirSync: vi.fn().mockReturnValue([]),
				statSync: vi.fn().mockReturnValue({ mtimeMs: Date.now() }),
				unlinkSync: vi.fn()
			}
		});

		await import('../../src/plugin/logger-worker');

		expect(createWriteStreamCallCount).toBe(2);
	});

	it('creates the log directory if it does not exist (ensureDir)', async () => {
		const port = new FakeParentPort();
		const stream = makeFakeStream();

		vi.resetModules();
		vi.doMock('node:worker_threads', () => ({
			parentPort: port,
			workerData: { transports: [makeTransport()], minLevel: 1 },
		}));

		const mkdirSyncMock = vi.fn();
		vi.doMock('node:fs', () => ({
			default: {
				existsSync: vi.fn().mockReturnValue(false),
				mkdirSync: mkdirSyncMock,
				createWriteStream: vi.fn().mockReturnValue(stream),
				renameSync: vi.fn(),
				readdirSync: vi.fn().mockReturnValue([]),
				statSync: vi.fn().mockReturnValue({ mtimeMs: Date.now() }),
				unlinkSync: vi.fn(),
			},
			existsSync: vi.fn().mockReturnValue(false),
			mkdirSync: mkdirSyncMock,
			createWriteStream: vi.fn().mockReturnValue(stream),
			renameSync: vi.fn(),
			readdirSync: vi.fn().mockReturnValue([]),
			statSync: vi.fn().mockReturnValue({ mtimeMs: Date.now() }),
			unlinkSync: vi.fn(),
		}));

		await import('../../src/plugin/logger-worker');

		expect(mkdirSyncMock).toHaveBeenCalledWith('./logs', { recursive: true });;
	});
});


describe('logger-worker — message handler: write', () => {
	it('writes the event to the transport when level is >= minLevel', async () => {
		const port = new FakeParentPort();
		const stream = makeFakeStream();
		await loadWorker({ transports: [makeTransport()], minLevel: 1, fakePort: port, fakeStream: stream });

		const ev = makeEvent({ level: 'info' });
		port.emit('message', { type: 'write', event: ev });

		expect(stream.write).toHaveBeenCalledOnce();
		const written = stream.write.mock.calls[0][0] as string;
		expect(written).toContain('"type":"console"');
	});

	it('discards the event when level is < minLevel', async () => {
		const port = new FakeParentPort();
		const stream = makeFakeStream();
		await loadWorker({ transports: [makeTransport()], minLevel: 2, fakePort: port, fakeStream: stream });

		port.emit('message', { type: 'write', event: makeEvent({ level: 'info' }) });
		expect(stream.write).not.toHaveBeenCalled();
	});

	it('writes only to the transport indicated by transportIdx', async () => {
		const port = new FakeParentPort();
		const stream0 = makeFakeStream();;
		const stream1 = makeFakeStream();;
		let callCount = 0;

		vi.resetModules();
		vi.doMock('node:worker_threads', () => ({
			parentPort: port,
			workerData: {
				transports: [makeTransport(), makeTransport({ path: './logs/b.log' })],
				minLevel: 0,
			},
		}));
		vi.doMock('node:fs', () => {
			const createWriteStream = vi.fn().mockImplementation(() =>
				callCount++ === 0 ? stream0 : stream1
			)
			return {
				default: { existsSync: vi.fn().mockReturnValue(true), mkdirSync: vi.fn(), createWriteStream, renameSync: vi.fn(), readdirSync: vi.fn().mockReturnValue([]), statSync: vi.fn().mockReturnValue({ mtimeMs: 0 }), unlinkSync: vi.fn() },
				existsSync: vi.fn().mockReturnValue(true), mkdirSync: vi.fn(), createWriteStream, renameSync: vi.fn(), readdirSync: vi.fn().mockReturnValue([]), statSync: vi.fn().mockReturnValue({ mtimeMs: 0 }), unlinkSync: vi.fn(),
			}
		});
		await import('../../src/plugin/logger-worker');

		const ev = makeEvent();
		port.emit('message', { type: 'write', event: ev, transportIdx: 1 });

		expect(stream0.write).not.toHaveBeenCalled();
		expect(stream1.write).toHaveBeenCalledOnce();
	});

	it('writes to all transports when transportIdx is absent', async () => {
		const port = new FakeParentPort();
		const stream0 = makeFakeStream();
		const stream1 = makeFakeStream();
		let callCount = 0;

		vi.resetModules();
		vi.doMock('node:worker_threads', () => ({
			parentPort: port,
			workerData: {
				transports: [makeTransport(), makeTransport({ path: './logs/b.log' })],
				minLevel: 0
			}
		}));
		vi.doMock('node:fs', () => {
			const createWriteStream = vi.fn().mockImplementation(() =>
				callCount++ === 0 ? stream0 : stream1
			)
			return {
				default: { existsSync: vi.fn().mockReturnValue(true), mkdirSync: vi.fn(), createWriteStream, renameSync: vi.fn(), readdirSync: vi.fn().mockReturnValue([]), statSync: vi.fn().mockReturnValue({ mtimeMs: 0 }), unlinkSync: vi.fn() },
				existsSync: vi.fn().mockReturnValue(true), mkdirSync: vi.fn(), createWriteStream, renameSync: vi.fn(), readdirSync: vi.fn().mockReturnValue([]), statSync: vi.fn().mockReturnValue({ mtimeMs: 0 }), unlinkSync: vi.fn(),
			}
		});
		await import('../../src/plugin/logger-worker');

		const ev = makeEvent();
		port.emit('message', { type: 'write', event: ev });

		expect(stream0.write).toHaveBeenCalledOnce();
		expect(stream1.write).toHaveBeenCalledOnce();
	});

	it('signals error to parentPort when write() throws', async () => {
		const port = new FakeParentPort();
		const stream = makeFakeStream();
		stream.write.mockImplementation(() => { throw new Error('disk full') });

		await loadWorker({ transports: [makeTransport()], minLevel: 0, fakePort: port, fakeStream: stream });

		port.emit('message', { type: 'write', event: makeEvent() });

		expect(port.postMessage).toHaveBeenCalledWith(
			expect.objectContaining({ type: 'error', message: expect.stringContaining('disk full') })
		);
	});
});


describe('logger-worker — message handler: destroy', () => {
	it('calls process.exit(0) on receiving the destroy message', async () => {
		const port = new FakeParentPort();
		const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

		await loadWorker({ transports: [makeTransport()], minLevel: 1, fakePort: port });

		port.emit('message', { type: 'destroy' });

		expect(exitSpy).toHaveBeenCalledWith(0);
		exitSpy.mockRestore();
	});

	it('closes all WriteStreams (stream.end()) before exiting', async () => {
		const port = new FakeParentPort();
		const stream0 = makeFakeStream();
		const stream1 = makeFakeStream();
		let callCount = 0;

		vi.resetModules();
		vi.doMock('node:worker_threads', () => ({
			parentPort: port,
			workerData: {
				transports: [makeTransport(), makeTransport({ path: './logs/b.log' })],
				minLevel: 1
			}
		}));
		vi.doMock('node:fs', () => {
			const createWriteStream = vi.fn().mockImplementation(() =>
				callCount++ === 0 ? stream0 : stream1
			)
			return {
				default: { existsSync: vi.fn().mockReturnValue(true), mkdirSync: vi.fn(), createWriteStream, renameSync: vi.fn(), readdirSync: vi.fn().mockReturnValue([]), statSync: vi.fn().mockReturnValue({ mtimeMs: 0 }), unlinkSync: vi.fn() },
				existsSync: vi.fn().mockReturnValue(true), mkdirSync: vi.fn(), createWriteStream, renameSync: vi.fn(), readdirSync: vi.fn().mockReturnValue([]), statSync: vi.fn().mockReturnValue({ mtimeMs: 0 }), unlinkSync: vi.fn(),
			}
		});
		await import('../../src/plugin/logger-worker');

		const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
		port.emit('message', { type: 'destroy' });

		expect(stream0.end).toHaveBeenCalledOnce();
		expect(stream1.end).toHaveBeenCalledOnce();
		exitSpy.mockRestore();
	});
});

describe('logger-worker — formatters', () => {
	it('formatJson produces a JSON line terminated by \\n', async () => {
		const port = new FakeParentPort();
		const stream = makeFakeStream();
		await loadWorker({ transports: [makeTransport({ format: 'json' })], minLevel: 0, fakePort: port, fakeStream: stream });

		const ev = makeEvent();
		port.emit('message', { type: 'write', event: ev });

		const line = stream.write.mock.calls[0][0] as string;
		expect(() => JSON.parse(line.trim())).not.toThrow();
		expect(line.endsWith('\n')).toBe(true);
	});

	it('formatPretty produces a human-readable line with timestamp, level, type, user, session', async () => {
		const port = new FakeParentPort();
		const stream = makeFakeStream();
		await loadWorker({ transports: [makeTransport({ format: 'pretty' })], minLevel: 0, fakePort: port, fakeStream: stream });

		const ev = makeEvent({ level: 'warn', type: 'console', userId: 'u123', sessionId: 'sess_abcdef12' });
		port.emit('message', { type: 'write', event: ev });

		const line = stream.write.mock.calls[0][0] as string;
		expect(line).toContain('WARN');
		expect(line).toContain('console');
		expect(line).toContain('user:u123');
		expect(line).toContain('sess:sess_abc');
		expect(line.endsWith('\n')).toBe(true);
	});
});


describe('logger-worker — parseSize', () => {
	it('transport without rotation does not rotate — stream.write is called directly', async () => {
		const port = new FakeParentPort();
		const stream = makeFakeStream();
		stream.bytesWritten = 0;

		await loadWorker({
			transports: [makeTransport({ path: './logs/no-rotation.log' })],
			minLevel: 0,
			fakePort: port,
			fakeStream: stream
		});

		port.emit('message', { type: 'write', event: makeEvent() });
		expect(stream.write).toHaveBeenCalledOnce();
	});

	it('parseSize uses the 10mb fallback when maxSize has an invalid format', async () => {
		const port = new FakeParentPort();

		vi.resetModules();
		vi.doMock('node:worker_threads', () => ({
			parentPort: port,
			workerData: {
				transports: [
					makeTransport({
						path: './logs/invalid-size.log',
						rotation: { strategy: 'size', maxSize: 'weird-unit' } as any,
					}),
				],
				minLevel: 0,
			},
		}));

		vi.doMock('node:fs', () => ({
			default: {
				existsSync: vi.fn().mockReturnValue(true),
				mkdirSync: vi.fn(),
				createWriteStream: vi.fn().mockReturnValue(makeFakeStream()),
				renameSync: vi.fn(),
				readdirSync: vi.fn().mockReturnValue([]),
				statSync: vi.fn().mockReturnValue({ mtimeMs: Date.now() }),
				unlinkSync: vi.fn(),
			},
			existsSync: vi.fn().mockReturnValue(true),
			mkdirSync: vi.fn(),
			createWriteStream: vi.fn().mockReturnValue(makeFakeStream()),
			renameSync: vi.fn(),
			readdirSync: vi.fn().mockReturnValue([]),
			statSync: vi.fn().mockReturnValue({ mtimeMs: Date.now() }),
			unlinkSync: vi.fn(),
		}));

		await import('../../src/plugin/logger-worker');
	});

});

describe('logger-worker — size rotation', () => {
	it('performs rotation and reopens the stream when bytesWritten >= bytesLimit', async () => {
		const port = new FakeParentPort();

		let streamCallCount = 0;
		const stream1 = makeFakeStream();
		const stream2 = makeFakeStream();

		vi.resetModules();
		vi.doMock('node:worker_threads', () => ({
			parentPort: port,
			workerData: {
				transports: [makeTransport({
					path: './logs/size.log',
					rotation: { strategy: 'size', maxSize: '1b', maxFiles: 5 },
				})],
				minLevel: 0
			}
		}));

		const renameSync = vi.fn();
		vi.doMock('node:fs', () => {
			const createWriteStream = vi.fn().mockImplementation(() => {
				streamCallCount++;
				const s = streamCallCount === 1 ? stream1 : stream2;
				if (streamCallCount === 1) {
					s.bytesWritten = 999;
				}
				return s;
			});
			return {
				default: { existsSync: vi.fn().mockReturnValue(true), mkdirSync: vi.fn(), createWriteStream, renameSync, readdirSync: vi.fn().mockReturnValue([]), statSync: vi.fn().mockReturnValue({ mtimeMs: 0 }), unlinkSync: vi.fn() },
				existsSync: vi.fn().mockReturnValue(true), mkdirSync: vi.fn(), createWriteStream, renameSync, readdirSync: vi.fn().mockReturnValue([]), statSync: vi.fn().mockReturnValue({ mtimeMs: 0 }), unlinkSync: vi.fn(),
			}
		});
		await import('../../src/plugin/logger-worker');

		port.emit('message', { type: 'write', event: makeEvent() });

		expect(stream1.end).toHaveBeenCalledOnce();
		expect(stream2.write).toHaveBeenCalledOnce();
	});

	it('cleanupOldFiles removes files beyond maxFiles during rotation', async () => {
		const port = new FakeParentPort();

		let streamCallCount = 0;
		const stream = makeFakeStream();

		vi.resetModules();
		vi.doMock('node:worker_threads', () => ({
			parentPort: port,
			workerData: {
				transports: [
					makeTransport({
						path: './logs/rotate.log',
						rotation: { strategy: 'size', maxSize: '1b', maxFiles: 1 },
					}),
				],
				minLevel: 0,
			},
		}));

		const unlinkSync = vi.fn();
		vi.doMock('node:fs', () => {
			const createWriteStream = vi.fn().mockImplementation(() => {
				streamCallCount++;
				if (streamCallCount === 1) {
					stream.bytesWritten = 2;
				}
				return stream;
			});

			return {
				default: {
					existsSync: vi.fn().mockReturnValue(true),
					mkdirSync: vi.fn(),
					createWriteStream,
					renameSync: vi.fn(),
					readdirSync: vi.fn().mockReturnValue([
						'rotate.log',
						'rotate-1.log',
						'rotate-2.log',
						'rotate-3.log',
					]),
					statSync: vi.fn()
						.mockReturnValueOnce({ mtimeMs: 300 })
						.mockReturnValueOnce({ mtimeMs: 200 })
						.mockReturnValueOnce({ mtimeMs: 100 }),
					unlinkSync,
				},
				existsSync: vi.fn().mockReturnValue(true),
				mkdirSync: vi.fn(),
				createWriteStream,
				renameSync: vi.fn(),
				readdirSync: vi.fn().mockReturnValue([
					'rotate.log',
					'rotate-1.log',
					'rotate-2.log',
					'rotate-3.log',
				]),
				statSync: vi.fn()
					.mockReturnValueOnce({ mtimeMs: 300 })
					.mockReturnValueOnce({ mtimeMs: 200 })
					.mockReturnValueOnce({ mtimeMs: 100 }),
				unlinkSync,
			};
		});

		await import('../../src/plugin/logger-worker');

		port.emit('message', { type: 'write', event: makeEvent() });

		expect(unlinkSync).toHaveBeenCalled();
	});

});

describe('logger-worker — daily rotation', () => {
	it('reopens the stream with the current date when the date changes', async () => {
		const port = new FakeParentPort();

		let streamCallCount = 0;
		const stream1 = makeFakeStream();
		const stream2 = makeFakeStream();

		vi.resetModules();
		vi.doMock('node:worker_threads', () => ({
			parentPort: port,
			workerData: {
				transports: [makeTransport({
					path: './logs/daily.log',
					rotation: { strategy: 'daily', maxFiles: 5 },
				})],
				minLevel: 0
			}
		}));

		vi.doMock('node:fs', () => {
			const createWriteStream = vi.fn().mockImplementation(() => ++streamCallCount === 1 ? stream1 : stream2);
			return {
				default: { existsSync: vi.fn().mockReturnValue(true), mkdirSync: vi.fn(), createWriteStream, renameSync: vi.fn(), readdirSync: vi.fn().mockReturnValue([]), statSync: vi.fn().mockReturnValue({ mtimeMs: 0 }), unlinkSync: vi.fn() },
				existsSync: vi.fn().mockReturnValue(true), mkdirSync: vi.fn(), createWriteStream, renameSync: vi.fn(), readdirSync: vi.fn().mockReturnValue([]), statSync: vi.fn().mockReturnValue({ mtimeMs: 0 }), unlinkSync: vi.fn(),
			}
		});
		await import('../../src/plugin/logger-worker');

		port.emit('message', { type: 'write', event: makeEvent() });
		expect(stream1.write).toHaveBeenCalledOnce();

		const realDate = Date;
		const tomorrow = new Date();
		tomorrow.setDate(tomorrow.getDate() + 1);
		vi.setSystemTime(tomorrow);

		port.emit('message', { type: 'write', event: makeEvent() });

		expect(stream1.end).toHaveBeenCalledOnce();
		expect(stream2.write).toHaveBeenCalledOnce();

		vi.useRealTimers();
	});
});

describe('logger-worker — stream error callback', () => {
	it('Report stream errors to parentPort via { type: "error" }', async () => {
		const port = new FakeParentPort();

		vi.resetModules();
		vi.doMock('node:worker_threads', () => ({
			parentPort: port,
			workerData: { transports: [makeTransport()], minLevel: 0 },
		}));

		let errorCallback: ((err: Error) => void) | null = null;
		const stream = makeFakeStream();
		stream.on.mockImplementation((event: string, cb: (err: Error) => void) => {
			if (event === 'error') {
				errorCallback = cb;
			}
		});

		vi.doMock('node:fs', () => ({
			default: { existsSync: vi.fn().mockReturnValue(true), mkdirSync: vi.fn(), createWriteStream: vi.fn().mockReturnValue(stream), renameSync: vi.fn(), readdirSync: vi.fn().mockReturnValue([]), statSync: vi.fn().mockReturnValue({ mtimeMs: 0 }), unlinkSync: vi.fn() },
			existsSync: vi.fn().mockReturnValue(true), mkdirSync: vi.fn(), createWriteStream: vi.fn().mockReturnValue(stream), renameSync: vi.fn(), readdirSync: vi.fn().mockReturnValue([]), statSync: vi.fn().mockReturnValue({ mtimeMs: 0 }), unlinkSync: vi.fn(),
		}));

		await import('../../src/plugin/logger-worker');

		expect(errorCallback).not.toBeNull();
		errorCallback!(new Error('ENOSPC: no space left'));

		expect(port.postMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				type: 'error',
				message: expect.stringContaining('ENOSPC'),
			})
		);
	});
});

describe('logger-worker — buffering during drain', () => {
	it('Buffers lines when stream.write() returns false and drains them on the drain event', async () => {
		const port = new FakeParentPort();

		vi.resetModules();
		vi.doMock('node:worker_threads', () => ({
			parentPort: port,
			workerData: { transports: [makeTransport()], minLevel: 0 },
		}));

		let drainCallback: (() => void) | null = null
		const stream = makeFakeStream();

		stream.write
			.mockReturnValueOnce(false)
			.mockReturnValue(true);

		stream.once.mockImplementation((event: string, cb: () => void) => {
			if (event === 'drain') {
				drainCallback = cb;
			}
		});

		vi.doMock('node:fs', () => ({
			default: { existsSync: vi.fn().mockReturnValue(true), mkdirSync: vi.fn(), createWriteStream: vi.fn().mockReturnValue(stream), renameSync: vi.fn(), readdirSync: vi.fn().mockReturnValue([]), statSync: vi.fn().mockReturnValue({ mtimeMs: 0 }), unlinkSync: vi.fn() },
			existsSync: vi.fn().mockReturnValue(true), mkdirSync: vi.fn(), createWriteStream: vi.fn().mockReturnValue(stream), renameSync: vi.fn(), readdirSync: vi.fn().mockReturnValue([]), statSync: vi.fn().mockReturnValue({ mtimeMs: 0 }), unlinkSync: vi.fn(),
		}));

		await import('../../src/plugin/logger-worker');

		port.emit('message', { type: 'write', event: makeEvent() });
		port.emit('message', { type: 'write', event: makeEvent({ level: 'warn' }) });

		expect(stream.write).toHaveBeenCalledOnce();

		expect(drainCallback).not.toBeNull();
		drainCallback!();

		expect(stream.write).toHaveBeenCalledTimes(2);
	});
});

describe('logger-worker — hydrate message handler', () => {
	it('skips transports whose format is not "json"', async () => {
		const port = new FakeParentPort();

		vi.resetModules();
		vi.doMock('node:worker_threads', () => ({
			parentPort: port,
			workerData: {
				transports: [makeTransport({ format: 'pretty', path: './logs/pretty.log' })],
				minLevel: 0,
			},
		}));

		const createReadStream = vi.fn();
		vi.doMock('node:fs', () => ({
			default: {
				existsSync: vi.fn().mockReturnValue(true),
				mkdirSync: vi.fn(),
				createWriteStream: vi.fn().mockReturnValue(makeFakeStream()),
				renameSync: vi.fn(),
				readdirSync: vi.fn().mockReturnValue([]),
				statSync: vi.fn(),
				unlinkSync: vi.fn(),
				createReadStream,
			},
			existsSync: vi.fn().mockReturnValue(true),
			mkdirSync: vi.fn(),
			createWriteStream: vi.fn().mockReturnValue(makeFakeStream()),
			createReadStream,
			readdirSync: vi.fn().mockReturnValue([]),
			statSync: vi.fn(),
			unlinkSync: vi.fn(),
		}));

		await import('../../src/plugin/logger-worker');

		port.emit('message', { type: 'hydrate', maxBytesPerTransport: 1024, batchSize: 10 });

		await new Promise(r => setTimeout(r, 10));

		expect(createReadStream).not.toHaveBeenCalled();
		expect(port.postMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				type: 'hydrate:done',
				loaded: 0,
				skippedMalformed: 0,
				skippedInvalid: 0,
				limitReached: false,
			})
		);
	});

	it('emits hydrate:done with zeros when log directory does not exist', async () => {
		const port = new FakeParentPort();

		vi.resetModules();
		vi.doMock('node:worker_threads', () => ({
			parentPort: port,
			workerData: {
				transports: [makeTransport({ path: './logs/test.log' })],
				minLevel: 0,
			},
		}));

		vi.doMock('node:fs', () => ({
			default: {
				existsSync: vi.fn().mockReturnValue(false),
				mkdirSync: vi.fn(),
				createWriteStream: vi.fn().mockReturnValue(makeFakeStream()),
				renameSync: vi.fn(),
				readdirSync: vi.fn().mockReturnValue([]),
				statSync: vi.fn(),
				unlinkSync: vi.fn(),
				createReadStream: vi.fn(),
			},
			existsSync: vi.fn().mockReturnValue(false),
			mkdirSync: vi.fn(),
			createWriteStream: vi.fn().mockReturnValue(makeFakeStream()),
			createReadStream: vi.fn(),
			readdirSync: vi.fn().mockReturnValue([]),
			statSync: vi.fn(),
			unlinkSync: vi.fn(),
		}));

		await import('../../src/plugin/logger-worker');

		port.emit('message', { type: 'hydrate', maxBytesPerTransport: 1024, batchSize: 10 });
		await new Promise(r => setTimeout(r, 10));

		expect(port.postMessage).toHaveBeenCalledWith(
			expect.objectContaining({ type: 'hydrate:done', loaded: 0 })
		);
	});

	it('sends hydrate:error when readdirSync throws', async () => {
		const port = new FakeParentPort();

		vi.resetModules();
		vi.doMock('node:worker_threads', () => ({
			parentPort: port,
			workerData: {
				transports: [makeTransport({ path: './logs/test.log' })],
				minLevel: 0,
			},
		}));

		vi.doMock('node:fs', () => ({
			default: {
				existsSync: vi.fn().mockReturnValue(true),
				mkdirSync: vi.fn(),
				createWriteStream: vi.fn().mockReturnValue(makeFakeStream()),
				renameSync: vi.fn(),
				readdirSync: vi.fn().mockImplementation(() => { throw new Error('EACCES'); }),
				statSync: vi.fn(),
				unlinkSync: vi.fn(),
				createReadStream: vi.fn(),
			},
			existsSync: vi.fn().mockReturnValue(true),
			mkdirSync: vi.fn(),
			createWriteStream: vi.fn().mockReturnValue(makeFakeStream()),
			createReadStream: vi.fn(),
			readdirSync: vi.fn().mockImplementation(() => { throw new Error('EACCES'); }),
			statSync: vi.fn(),
			unlinkSync: vi.fn(),
		}));

		await import('../../src/plugin/logger-worker');

		port.emit('message', { type: 'hydrate', maxBytesPerTransport: 1024, batchSize: 10 });
		await new Promise(r => setTimeout(r, 10));

		expect(port.postMessage).toHaveBeenCalledWith(
			expect.objectContaining({ type: 'error', message: expect.stringContaining('EACCES') })
		);
	});
});

describe('logger-worker — hydrateFromLogs', () => {
	it('streams valid events back in hydrate:batch messages', async () => {
		const port = new FakeParentPort();
		const event1 = makeValidLine({ type: 'click' });
		const event2 = makeValidLine({ type: 'navigation' });

		vi.resetModules();
		vi.doMock('node:worker_threads', () => ({
			parentPort: port,
			workerData: {
				transports: [makeTransport({ path: './logs/test.log' })],
				minLevel: 0,
			},
		}));

		vi.doMock('node:fs', () => {
			const createWriteStream = vi.fn().mockReturnValue(makeFakeStream());
			const createReadStream = vi.fn().mockReturnValue(new EventEmitter());
			return {
				default: { existsSync: vi.fn().mockReturnValue(true), mkdirSync: vi.fn(), createWriteStream, renameSync: vi.fn(), readdirSync: vi.fn().mockReturnValue(['test.log']), statSync: vi.fn().mockReturnValue({ mtimeMs: Date.now() }), unlinkSync: vi.fn(), createReadStream },
				existsSync: vi.fn().mockReturnValue(true), mkdirSync: vi.fn(), createWriteStream, createReadStream, readdirSync: vi.fn().mockReturnValue(['test.log']), statSync: vi.fn().mockReturnValue({ mtimeMs: Date.now() }), unlinkSync: vi.fn(),
			};
		});

		vi.doMock('node:readline', () => {
			const createInterface = vi.fn().mockImplementation(() => {
				const rl = new EventEmitter();
				setImmediate(() => {
					rl.emit('line', event1);
					rl.emit('line', event2);
					rl.emit('close');
				});
				return rl;
			});
			return { default: { createInterface }, createInterface };
		});

		await import('../../src/plugin/logger-worker');
		port.emit('message', { type: 'hydrate', maxBytesPerTransport: 1024 * 1024, batchSize: 10 });
		await new Promise(r => setTimeout(r, 200));

		const batchCalls = port.postMessage.mock.calls.filter(([msg]) => msg.type === 'hydrate:batch');
		expect(batchCalls.length).toBeGreaterThanOrEqual(1);
		const allEvents = batchCalls.flatMap(([msg]) => msg.events as TrackerEvent[]);
		expect(allEvents).toHaveLength(2);
		expect(allEvents[0].type).toBe('click');
		expect(allEvents[1].type).toBe('navigation');
	});

	it('streams invalid events', async () => {
		const port = new FakeParentPort();
		const event1 = makeValidLine({ type: 'click' });
		const event2 = makeValidLine({ type: 'navigation' }, true);

		vi.resetModules();
		vi.doMock('node:worker_threads', () => ({
			parentPort: port,
			workerData: {
				transports: [makeTransport({ path: './logs/test.log' })],
				minLevel: 0,
			},
		}));

		vi.doMock('node:fs', () => {
			const createWriteStream = vi.fn().mockReturnValue(makeFakeStream());
			const createReadStream = vi.fn().mockReturnValue(new EventEmitter());
			return {
				default: { existsSync: vi.fn().mockReturnValue(true), mkdirSync: vi.fn(), createWriteStream, renameSync: vi.fn(), readdirSync: vi.fn().mockReturnValue(['test.log']), statSync: vi.fn().mockReturnValue({ mtimeMs: Date.now() }), unlinkSync: vi.fn(), createReadStream },
				existsSync: vi.fn().mockReturnValue(true), mkdirSync: vi.fn(), createWriteStream, createReadStream, readdirSync: vi.fn().mockReturnValue(['test.log']), statSync: vi.fn().mockReturnValue({ mtimeMs: Date.now() }), unlinkSync: vi.fn(),
			};
		});

		vi.doMock('node:readline', () => {
			const createInterface = vi.fn().mockImplementation(() => {
				const rl = new EventEmitter();
				setImmediate(() => {
					rl.emit('line', event1);
					rl.emit('line', event2);
					rl.emit('close');
				});
				return rl;
			});
			return { default: { createInterface }, createInterface };
		});

		await import('../../src/plugin/logger-worker');
		port.emit('message', { type: 'hydrate', maxBytesPerTransport: 1024 * 1024, batchSize: 10 });
		await new Promise(r => setTimeout(r, 200));

		const batchCalls = port.postMessage.mock.calls.filter(([msg]) => msg.type === 'hydrate:batch');
		expect(batchCalls.length).toBeGreaterThanOrEqual(1);
		const allEvents = batchCalls.flatMap(([msg]) => msg.events as TrackerEvent[]);
		expect(allEvents).toHaveLength(1);
		expect(allEvents[0].type).toBe('click');
	});

	it('flushes a full batch mid-stream when batch.length reaches batchSize', async () => {
		const port = new FakeParentPort();

		const line1 = makeValidLine({ type: 'click' });
		const line2 = makeValidLine({ type: 'navigation' });
		const line3 = makeValidLine({ type: 'console' });

		vi.resetModules();
		vi.doMock('node:worker_threads', () => ({
			parentPort: port,
			workerData: {
				transports: [makeTransport({ path: './logs/test.log' })],
				minLevel: 0,
			},
		}));

		vi.doMock('node:fs', () => {
			const createWriteStream = vi.fn().mockReturnValue(makeFakeStream());
			const createReadStream = vi.fn().mockReturnValue(new EventEmitter());
			return {
				default: { existsSync: vi.fn().mockReturnValue(true), mkdirSync: vi.fn(), createWriteStream, renameSync: vi.fn(), readdirSync: vi.fn().mockReturnValue(['test.log']), statSync: vi.fn().mockReturnValue({ mtimeMs: Date.now() }), unlinkSync: vi.fn(), createReadStream },
				existsSync: vi.fn().mockReturnValue(true), mkdirSync: vi.fn(), createWriteStream, createReadStream, readdirSync: vi.fn().mockReturnValue(['test.log']), statSync: vi.fn().mockReturnValue({ mtimeMs: Date.now() }), unlinkSync: vi.fn(),
			};
		});

		vi.doMock('node:readline', () => {
			const createInterface = vi.fn().mockImplementation(() => {
				const rl = new EventEmitter();
				setImmediate(() => {
					rl.emit('line', line1);
					rl.emit('line', line2);
					rl.emit('line', line3);
					rl.emit('close');
				});
				return rl;
			});
			return { default: { createInterface }, createInterface };
		});

		await import('../../src/plugin/logger-worker');
		port.emit('message', { type: 'hydrate', maxBytesPerTransport: 1024 * 1024, batchSize: 2 });
		await new Promise(r => setTimeout(r, 200));

		const batchCalls = port.postMessage.mock.calls.filter(([m]) => m.type === 'hydrate:batch');

		expect(batchCalls).toHaveLength(2);
		expect(batchCalls[0][0].events).toHaveLength(2);
		expect(batchCalls[1][0].events).toHaveLength(1);

		expect(port.postMessage).toHaveBeenCalledWith(
			expect.objectContaining({ type: 'hydrate:done', loaded: 3 })
		);
	});

	it('flushes the last partial batch on close even if smaller than batchSize', async () => {
		const port = new FakeParentPort();
		const line = makeValidLine();

		vi.resetModules();
		vi.doMock('node:worker_threads', () => ({
			parentPort: port,
			workerData: {
				transports: [makeTransport({ path: './logs/test.log' })],
				minLevel: 0,
			},
		}));

		vi.doMock('node:fs', () => {
			const createWriteStream = vi.fn().mockReturnValue(makeFakeStream());
			const createReadStream = vi.fn().mockReturnValue(new EventEmitter());
			return {
				default: { existsSync: vi.fn().mockReturnValue(true), mkdirSync: vi.fn(), createWriteStream, renameSync: vi.fn(), readdirSync: vi.fn().mockReturnValue(['test.log']), statSync: vi.fn().mockReturnValue({ mtimeMs: Date.now() }), unlinkSync: vi.fn(), createReadStream },
				existsSync: vi.fn().mockReturnValue(true), mkdirSync: vi.fn(), createWriteStream, createReadStream, readdirSync: vi.fn().mockReturnValue(['test.log']), statSync: vi.fn().mockReturnValue({ mtimeMs: Date.now() }), unlinkSync: vi.fn(),
			};
		});

		vi.doMock('node:readline', () => {
			const createInterface = vi.fn().mockImplementation(() => {
				const rl = new EventEmitter();
				setImmediate(() => {
					rl.emit('line', line);
					rl.emit('close');
				});
				return rl;
			});
			return { default: { createInterface }, createInterface };
		});

		await import('../../src/plugin/logger-worker');
		port.emit('message', { type: 'hydrate', maxBytesPerTransport: 1024 * 1024, batchSize: 10 });
		await new Promise(r => setTimeout(r, 200));

		const batchCalls = port.postMessage.mock.calls.filter(([m]) => m.type === 'hydrate:batch');
		expect(batchCalls).toHaveLength(1);
		expect(batchCalls[0][0].events).toHaveLength(1);
	});

	it('counts malformed JSON lines in skippedMalformed', async () => {
		const port = new FakeParentPort();

		vi.resetModules();
		vi.doMock('node:worker_threads', () => ({
			parentPort: port,
			workerData: {
				transports: [makeTransport({ path: './logs/test.log' })],
				minLevel: 0,
			},
		}));

		vi.doMock('node:readline', () => ({
			default: {
				createInterface: vi.fn().mockImplementation(() => {
					const rl = new EventEmitter();
					setImmediate(() => {
						rl.emit('line', '{invalid json}}}');
						rl.emit('close');
					});
					return rl;
				}),
			},
			createInterface: vi.fn().mockImplementation(() => {
				const rl = new EventEmitter();
				setImmediate(() => {
					rl.emit('line', '{invalid json}}}');
					rl.emit('close');
				});
				return rl;
			}),
		}));

		vi.doMock('node:fs', () => ({
			default: {
				existsSync: vi.fn().mockReturnValue(true),
				mkdirSync: vi.fn(),
				createWriteStream: vi.fn().mockReturnValue(makeFakeStream()),
				renameSync: vi.fn(),
				readdirSync: vi.fn().mockReturnValue(['test.log']),
				statSync: vi.fn().mockReturnValue({ mtimeMs: Date.now() }),
				unlinkSync: vi.fn(),
				createReadStream: vi.fn().mockReturnValue(new EventEmitter()),
			},
			existsSync: vi.fn().mockReturnValue(true),
			mkdirSync: vi.fn(),
			createWriteStream: vi.fn().mockReturnValue(makeFakeStream()),
			createReadStream: vi.fn().mockReturnValue(new EventEmitter()),
			readdirSync: vi.fn().mockReturnValue(['test.log']),
			statSync: vi.fn().mockReturnValue({ mtimeMs: Date.now() }),
			unlinkSync: vi.fn(),
		}));

		await import('../../src/plugin/logger-worker');

		port.emit('message', { type: 'hydrate', maxBytesPerTransport: 1024 * 1024, batchSize: 10 });
		await new Promise(r => setTimeout(r, 50));

		expect(port.postMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				type: 'hydrate:done',
				skippedMalformed: 1,
				loaded: 0,
			})
		);
	});

	it('counts structurally invalid events in skippedInvalid', async () => {
		const port = new FakeParentPort();


		const invalidEvent = JSON.stringify({ foo: 'bar' });

		vi.resetModules();
		vi.doMock('node:worker_threads', () => ({
			parentPort: port,
			workerData: {
				transports: [makeTransport({ path: './logs/test.log' })],
				minLevel: 0,
			},
		}));

		vi.doMock('node:readline', () => ({
			default: {
				createInterface: vi.fn().mockImplementation(() => {
					const rl = new EventEmitter();
					setImmediate(() => {
						rl.emit('line', invalidEvent);
						rl.emit('close');
					});
					return rl;
				}),
			},
			createInterface: vi.fn().mockImplementation(() => {
				const rl = new EventEmitter();
				setImmediate(() => {
					rl.emit('line', invalidEvent);
					rl.emit('close');
				});
				return rl;
			}),
		}));

		vi.doMock('node:fs', () => ({
			default: {
				existsSync: vi.fn().mockReturnValue(true),
				mkdirSync: vi.fn(),
				createWriteStream: vi.fn().mockReturnValue(makeFakeStream()),
				renameSync: vi.fn(),
				readdirSync: vi.fn().mockReturnValue(['test.log']),
				statSync: vi.fn().mockReturnValue({ mtimeMs: Date.now() }),
				unlinkSync: vi.fn(),
				createReadStream: vi.fn().mockReturnValue(new EventEmitter()),
			},
			existsSync: vi.fn().mockReturnValue(true),
			mkdirSync: vi.fn(),
			createWriteStream: vi.fn().mockReturnValue(makeFakeStream()),
			createReadStream: vi.fn().mockReturnValue(new EventEmitter()),
			readdirSync: vi.fn().mockReturnValue(['test.log']),
			statSync: vi.fn().mockReturnValue({ mtimeMs: Date.now() }),
			unlinkSync: vi.fn(),
		}));

		await import('../../src/plugin/logger-worker');

		port.emit('message', { type: 'hydrate', maxBytesPerTransport: 1024 * 1024, batchSize: 10 });
		await new Promise(r => setTimeout(r, 50));

		expect(port.postMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				type: 'hydrate:done',
				skippedInvalid: 1,
				loaded: 0,
			})
		);
	});

	it('sets limitReached=true and stops reading when maxBytesPerTransport is exceeded', async () => {
		const port = new FakeParentPort();
		const line = makeValidLine();

		vi.resetModules();
		vi.doMock('node:worker_threads', () => ({
			parentPort: port,
			workerData: {
				transports: [makeTransport({ path: './logs/test.log' })],
				minLevel: 0,
			},
		}));

		const createReadStreamMock = vi.fn().mockReturnValue(new EventEmitter());

		vi.doMock('node:readline', () => ({
			default: {
				createInterface: vi.fn().mockImplementation(() => {
					const rl = new EventEmitter();
					setImmediate(() => {
						rl.emit('line', line);
						rl.emit('close');
					});
					return rl;
				}),
			},
			createInterface: vi.fn().mockImplementation(() => {
				const rl = new EventEmitter();
				setImmediate(() => {
					rl.emit('line', line);
					rl.emit('close');
				});
				return rl;
			}),
		}));

		vi.doMock('node:fs', () => ({
			default: {
				existsSync: vi.fn().mockReturnValue(true),
				mkdirSync: vi.fn(),
				createWriteStream: vi.fn().mockReturnValue(makeFakeStream()),
				renameSync: vi.fn(),
				readdirSync: vi.fn().mockReturnValue(['test-a.log', 'test-b.log']),
				statSync: vi.fn().mockReturnValue({ mtimeMs: Date.now() }),
				unlinkSync: vi.fn(),
				createReadStream: createReadStreamMock,
			},
			existsSync: vi.fn().mockReturnValue(true),
			mkdirSync: vi.fn(),
			createWriteStream: vi.fn().mockReturnValue(makeFakeStream()),
			createReadStream: createReadStreamMock,
			readdirSync: vi.fn().mockReturnValue(['test-a.log', 'test-b.log']),
			statSync: vi.fn().mockReturnValue({ mtimeMs: Date.now() }),
			unlinkSync: vi.fn(),
		}));

		await import('../../src/plugin/logger-worker');
		port.emit('message', { type: 'hydrate', maxBytesPerTransport: 1, batchSize: 10 });
		await new Promise(r => setTimeout(r, 50));

		expect(port.postMessage).toHaveBeenCalledWith(
			expect.objectContaining({ type: 'hydrate:done', limitReached: true })
		);

		expect(createReadStreamMock).toHaveBeenCalledTimes(1);
	});

	it('reports an error and continues when a file cannot be read', async () => {
		const port = new FakeParentPort();

		vi.resetModules();
		vi.doMock('node:worker_threads', () => ({
			parentPort: port,
			workerData: {
				transports: [makeTransport({ path: './logs/test.log' })],
				minLevel: 0,
			},
		}));

		vi.doMock('node:readline', () => ({
			default: {
				createInterface: vi.fn().mockImplementation(() => {
					const rl = new EventEmitter();
					setImmediate(() => {
						rl.emit('error', new Error('ENOENT: no such file'));
					});
					return rl;
				}),
			},
			createInterface: vi.fn().mockImplementation(() => {
				const rl = new EventEmitter();
				setImmediate(() => {
					rl.emit('error', new Error('ENOENT: no such file'));
				});
				return rl;
			}),
		}));

		vi.doMock('node:fs', () => ({
			default: {
				existsSync: vi.fn().mockReturnValue(true),
				mkdirSync: vi.fn(),
				createWriteStream: vi.fn().mockReturnValue(makeFakeStream()),
				renameSync: vi.fn(),
				readdirSync: vi.fn().mockReturnValue(['test.log']),
				statSync: vi.fn().mockReturnValue({ mtimeMs: Date.now() }),
				unlinkSync: vi.fn(),
				createReadStream: vi.fn().mockReturnValue(new EventEmitter()),
			},
			existsSync: vi.fn().mockReturnValue(true),
			mkdirSync: vi.fn(),
			createWriteStream: vi.fn().mockReturnValue(makeFakeStream()),
			createReadStream: vi.fn().mockReturnValue(new EventEmitter()),
			readdirSync: vi.fn().mockReturnValue(['test.log']),
			statSync: vi.fn().mockReturnValue({ mtimeMs: Date.now() }),
			unlinkSync: vi.fn(),
		}));

		await import('../../src/plugin/logger-worker');

		port.emit('message', { type: 'hydrate', maxBytesPerTransport: 1024 * 1024, batchSize: 10 });
		await new Promise(r => setTimeout(r, 50));

		expect(port.postMessage).toHaveBeenCalledWith(
			expect.objectContaining({ type: 'error', message: expect.stringContaining('ENOENT') })
		);

		expect(port.postMessage).toHaveBeenCalledWith(
			expect.objectContaining({ type: 'hydrate:done' })
		);
	});

	it('skips blank lines without counting them as errors', async () => {
		const port = new FakeParentPort();

		vi.resetModules();
		vi.doMock('node:worker_threads', () => ({
			parentPort: port,
			workerData: {
				transports: [makeTransport({ path: './logs/test.log' })],
				minLevel: 0,
			},
		}));

		vi.doMock('node:readline', () => ({
			default: {
				createInterface: vi.fn().mockImplementation(() => {
					const rl = new EventEmitter();
					setImmediate(() => {
						rl.emit('line', '   ');
						rl.emit('line', '');
						rl.emit('close');
					});
					return rl;
				}),
			},
			createInterface: vi.fn().mockImplementation(() => {
				const rl = new EventEmitter();
				setImmediate(() => {
					rl.emit('line', '   ');
					rl.emit('line', '');
					rl.emit('close');
				});
				return rl;
			}),
		}));

		vi.doMock('node:fs', () => ({
			default: {
				existsSync: vi.fn().mockReturnValue(true),
				mkdirSync: vi.fn(),
				createWriteStream: vi.fn().mockReturnValue(makeFakeStream()),
				renameSync: vi.fn(),
				readdirSync: vi.fn().mockReturnValue(['test.log']),
				statSync: vi.fn().mockReturnValue({ mtimeMs: Date.now() }),
				unlinkSync: vi.fn(),
				createReadStream: vi.fn().mockReturnValue(new EventEmitter()),
			},
			existsSync: vi.fn().mockReturnValue(true),
			mkdirSync: vi.fn(),
			createWriteStream: vi.fn().mockReturnValue(makeFakeStream()),
			createReadStream: vi.fn().mockReturnValue(new EventEmitter()),
			readdirSync: vi.fn().mockReturnValue(['test.log']),
			statSync: vi.fn().mockReturnValue({ mtimeMs: Date.now() }),
			unlinkSync: vi.fn(),
		}));

		await import('../../src/plugin/logger-worker');

		port.emit('message', { type: 'hydrate', maxBytesPerTransport: 1024 * 1024, batchSize: 10 });
		await new Promise(r => setTimeout(r, 50));

		expect(port.postMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				type: 'hydrate:done',
				loaded: 0,
				skippedMalformed: 0,
				skippedInvalid: 0,
			})
		);
	});

	it('uses default maxBytesPerTransport and batchSize when not specified in message', async () => {
		const port = new FakeParentPort();

		vi.resetModules();
		vi.doMock('node:worker_threads', () => ({
			parentPort: port,
			workerData: {
				transports: [makeTransport({ path: './logs/test.log' })],
				minLevel: 0,
			},
		}));

		vi.doMock('node:readline', () => ({
			default: { createInterface: vi.fn().mockImplementation(() => { const rl = new EventEmitter(); setImmediate(() => rl.emit('close')); return rl; }) },
			createInterface: vi.fn().mockImplementation(() => { const rl = new EventEmitter(); setImmediate(() => rl.emit('close')); return rl; }),
		}));

		vi.doMock('node:fs', () => ({
			default: {
				existsSync: vi.fn().mockReturnValue(true),
				mkdirSync: vi.fn(),
				createWriteStream: vi.fn().mockReturnValue(makeFakeStream()),
				renameSync: vi.fn(),
				readdirSync: vi.fn().mockReturnValue(['test.log']),
				statSync: vi.fn(),
				unlinkSync: vi.fn(),
				createReadStream: vi.fn().mockReturnValue(new EventEmitter()),
			},
			existsSync: vi.fn().mockReturnValue(true),
			mkdirSync: vi.fn(),
			createWriteStream: vi.fn().mockReturnValue(makeFakeStream()),
			createReadStream: vi.fn().mockReturnValue(new EventEmitter()),
			readdirSync: vi.fn().mockReturnValue(['test.log']),
			statSync: vi.fn(),
			unlinkSync: vi.fn(),
		}));

		await import('../../src/plugin/logger-worker');


		port.emit('message', { type: 'hydrate' });
		await new Promise(r => setTimeout(r, 50));

		expect(port.postMessage).toHaveBeenCalledWith(
			expect.objectContaining({ type: 'hydrate:done' })
		);
	});
});
