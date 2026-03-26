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

describe('logger-worker — inizializzazione', () => {
	it('invia { type: "ready" } a parentPort subito dopo l\'import', async () => {
		const port = new FakeParentPort();
		await loadWorker({ transports: [makeTransport()], minLevel: 1, fakePort: port });
		expect(port.postMessage).toHaveBeenCalledWith({ type: 'ready' });
	});

	it('crea un WriteStream per ogni transport fornito in workerData', async () => {
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

	it('crea la directory del log se non esiste (ensureDir)', async () => {
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
	it('scrive l\'evento nel transport quando il livello è >= minLevel', async () => {
		const port = new FakeParentPort();
		const stream = makeFakeStream();
		await loadWorker({ transports: [makeTransport()], minLevel: 1, fakePort: port, fakeStream: stream });

		const ev = makeEvent({ level: 'info' });
		port.emit('message', { type: 'write', event: ev });

		expect(stream.write).toHaveBeenCalledOnce();
		const written = stream.write.mock.calls[0][0] as string;
		expect(written).toContain('"type":"console"');
	});

	it('scarta l\'evento se il livello è < minLevel', async () => {
		const port = new FakeParentPort();
		const stream = makeFakeStream();
		await loadWorker({ transports: [makeTransport()], minLevel: 2, fakePort: port, fakeStream: stream });

		port.emit('message', { type: 'write', event: makeEvent({ level: 'info' }) });
		expect(stream.write).not.toHaveBeenCalled();
	});

	it('scrive solo nel transport indicato da transportIdx', async () => {
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

	it('scrive su tutti i transport se transportIdx è assente', async () => {
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

	it('segnala errore a parentPort se write() lancia', async () => {
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
	it('chiama process.exit(0) alla ricezione del messaggio destroy', async () => {
		const port = new FakeParentPort();
		const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

		await loadWorker({ transports: [makeTransport()], minLevel: 1, fakePort: port });

		port.emit('message', { type: 'destroy' });

		expect(exitSpy).toHaveBeenCalledWith(0);
		exitSpy.mockRestore();
	});

	it('chiude tutti i WriteStream (stream.end()) prima di uscire', async () => {
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
	it('formatJson produce una riga JSON terminata da \\n', async () => {
		const port = new FakeParentPort();
		const stream = makeFakeStream();
		await loadWorker({ transports: [makeTransport({ format: 'json' })], minLevel: 0, fakePort: port, fakeStream: stream });

		const ev = makeEvent();
		port.emit('message', { type: 'write', event: ev });

		const line = stream.write.mock.calls[0][0] as string;
		expect(() => JSON.parse(line.trim())).not.toThrow();
		expect(line.endsWith('\n')).toBe(true);
	});

	it('formatPretty produce una riga leggibile con timestamp, level, type, user, session', async () => {
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
	it('transport senza rotation non fa rotate — stream.write viene chiamato direttamente', async () => {
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

	it('parseSize usa il fallback 10mb quando maxSize ha un formato invalido', async () => {
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

describe('logger-worker — rotazione size', () => {
	it('esegue la rotazione e riapre lo stream quando bytesWritten >= bytesLimit', async () => {
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

	it('cleanupOldFiles elimina i file oltre maxFiles durante la rotazione', async () => {
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

describe('logger-worker — rotazione daily', () => {
	it('riapre lo stream con la data corrente quando la data cambia', async () => {
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
	it('segnala errori di stream a parentPort via { type: "error" }', async () => {
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

describe('logger-worker — buffering durante drain', () => {
	it('bufferizza le righe quando stream.write() ritorna false e le draina sull\'evento drain', async () => {
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
