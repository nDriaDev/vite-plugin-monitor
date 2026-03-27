import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupErrorTracker } from '../../../src/client/trackers/errors';
import type { ErrorPayload } from '../../../src/types';

class MockPromiseRejectionEvent extends Event {
	readonly reason: unknown;
	readonly promise: Promise<unknown>;

	constructor(type: string, init: { reason?: unknown; promise: Promise<unknown> }) {
		super(type, { cancelable: true, bubbles: false });
		this.reason = init.reason;
		this.promise = init.promise;
	}
}

function makeErrorEvent(overrides: Partial<{ message: string; filename: string; lineno: number; colno: number; error: Error | null; }>): ErrorEvent {
	const err = overrides.error !== undefined ? overrides.error : new Error(overrides.message ?? 'Test error');
	return new ErrorEvent('error', {
		message: overrides.message ?? 'Test error',
		filename: overrides.filename ?? 'test.js',
		lineno: overrides.lineno ?? 10,
		colno: overrides.colno ?? 5,
		error: err,
		cancelable: true
	});
}

function makeRejectionEvent(reason: unknown): Event {
	return new MockPromiseRejectionEvent('unhandledrejection', {
		promise: Promise.resolve(),
		reason
	});
}

describe('setupErrorTracker', () => {
	let onEvent: ReturnType<typeof vi.fn>;
	let teardown: () => void;

	beforeEach(() => {
		onEvent = vi.fn();
	});

	afterEach(() => {
		teardown?.();
	});

	describe('window.onerror — ErrorEvent', () => {
		it('emits the correct payload with all fields populated', () => {
			const err = new TypeError('something went wrong');
			teardown = setupErrorTracker(onEvent as Parameters<typeof setupErrorTracker>[0]);

			window.dispatchEvent(makeErrorEvent({
				message: 'something went wrong',
				filename: 'app.js',
				lineno: 42,
				colno: 7,
				error: err
			}));

			expect(onEvent).toHaveBeenCalledOnce();
			const payload: ErrorPayload = onEvent.mock.calls[0][0];
			expect(payload.message).toBe('something went wrong');
			expect(payload.filename).toBe('app.js');
			expect(payload.lineno).toBe(42);
			expect(payload.colno).toBe(7);
			expect(payload.stack).toBe(err.stack);
			expect(payload.errorType).toBe('TypeError');
		});

		it('uses e.error.name as errorType', () => {
			class CustomError extends Error {
				override name = 'CustomError';
			}
			const err = new CustomError('boom');
			teardown = setupErrorTracker(onEvent as Parameters<typeof setupErrorTracker>[0]);

			window.dispatchEvent(makeErrorEvent({ message: 'boom', error: err }));

			const payload: ErrorPayload = onEvent.mock.calls[0][0];
			expect(payload.errorType).toBe('CustomError');
		});

		it('fallback errorType to "Error" if e.error has no name', () => {
			const err = new Error('generic');
			teardown = setupErrorTracker(onEvent as Parameters<typeof setupErrorTracker>[0]);

			window.dispatchEvent(makeErrorEvent({ message: 'generic', error: err }));

			const payload: ErrorPayload = onEvent.mock.calls[0][0];
			expect(payload.errorType).toBe('Error');
		});

		it('fallback message to "Unknown error" when e.message is an empty string', () => {
			teardown = setupErrorTracker(onEvent as Parameters<typeof setupErrorTracker>[0]);

			window.dispatchEvent(makeErrorEvent({ message: '', error: new Error('') }));

			const payload: ErrorPayload = onEvent.mock.calls[0][0];
			expect(payload.message).toBe('Unknown error');
		});

		it('stack is undefined when e.error is null', () => {
			teardown = setupErrorTracker(onEvent as Parameters<typeof setupErrorTracker>[0]);

			window.dispatchEvent(makeErrorEvent({ message: 'no error obj', error: null }));

			const payload: ErrorPayload = onEvent.mock.calls[0][0];
			expect(payload.stack).toBeUndefined();
		});

		it('errorType fallback to "Error" when e.error is null', () => {
			teardown = setupErrorTracker(onEvent as Parameters<typeof setupErrorTracker>[0]);

			window.dispatchEvent(makeErrorEvent({ message: 'no error obj', error: null }));

			const payload: ErrorPayload = onEvent.mock.calls[0][0];
			expect(payload.errorType).toBe('Error');
		});
	});

	describe('unhandledrejection — PromiseRejectionEvent', () => {
		it('reject con un Error -> message e stack dall\'Error', () => {
			const err = new RangeError('out of range');
			teardown = setupErrorTracker(onEvent as Parameters<typeof setupErrorTracker>[0]);

			window.dispatchEvent(makeRejectionEvent(err));

			expect(onEvent).toHaveBeenCalledOnce();
			const payload: ErrorPayload = onEvent.mock.calls[0][0];
			expect(payload.message).toBe('out of range');
			expect(payload.stack).toBe(err.stack);
			expect(payload.errorType).toBe('RangeError');
		});

		it('reject with a string -> message as String(reason)', () => {
			teardown = setupErrorTracker(onEvent as Parameters<typeof setupErrorTracker>[0]);

			window.dispatchEvent(makeRejectionEvent('something bad happened'));

			const payload: ErrorPayload = onEvent.mock.calls[0][0];
			expect(payload.message).toBe('something bad happened');
			expect(payload.stack).toBeUndefined();
			expect(payload.errorType).toBe('UnhandledRejection');
		});

		it('reject with a number -> message as String(reason)', () => {
			teardown = setupErrorTracker(onEvent as Parameters<typeof setupErrorTracker>[0]);

			window.dispatchEvent(makeRejectionEvent(404));

			const payload: ErrorPayload = onEvent.mock.calls[0][0];
			expect(payload.message).toBe('404');
		});

		it('reject con undefined -> message di fallback "Unhandled promise rejection"', () => {
			teardown = setupErrorTracker(onEvent as Parameters<typeof setupErrorTracker>[0]);

			window.dispatchEvent(makeRejectionEvent(undefined));

			const payload: ErrorPayload = onEvent.mock.calls[0][0];
			expect(payload.message).toBe('Unhandled promise rejection');
			expect(payload.stack).toBeUndefined();
			expect(payload.errorType).toBe('UnhandledRejection');
		});

		it('reject con null -> message come String(null) -> "null"', () => {
			teardown = setupErrorTracker(onEvent as Parameters<typeof setupErrorTracker>[0]);

			window.dispatchEvent(makeRejectionEvent(null));

			const payload: ErrorPayload = onEvent.mock.calls[0][0];
			expect(payload.message).toBe('null');
		});
	});

	describe('teardown', () => {

		it('after teardown(), the "error" listener no longer emits', () => {
			const td = setupErrorTracker(onEvent as Parameters<typeof setupErrorTracker>[0]);
			teardown = () => { };
			td();
			window.dispatchEvent(makeErrorEvent({ message: 'should be ignored', error: null }));
			expect(onEvent).not.toHaveBeenCalled();
		});

		it('after teardown(), the "unhandledrejection" listener no longer emits', () => {
			const td = setupErrorTracker(onEvent as Parameters<typeof setupErrorTracker>[0]);
			teardown = () => { };
			td();
			window.dispatchEvent(makeRejectionEvent(new Error('should be ignored')));
			expect(onEvent).not.toHaveBeenCalled();
		});

		it('teardown is idempotent — calling it twice does not throw', () => {
			const td = setupErrorTracker(onEvent as Parameters<typeof setupErrorTracker>[0]);
			teardown = () => { };
			expect(() => { td(); td(); }).not.toThrow();
		});
	});
});
