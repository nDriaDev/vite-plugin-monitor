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
