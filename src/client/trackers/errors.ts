/* eslint-disable no-unused-vars */
/* eslint-disable no-undef */
import type { ErrorPayload, ErrorTrackOptions } from "@tracker/types";

/**
 * Returns true if the message matches any of the given patterns.
 * String patterns use `strict equality`; RegExp patterns are tested directly.
 */
function matchesMessage(message: string, patterns: (string | RegExp)[]): boolean {
	return patterns.some(p => {
		if (p instanceof RegExp) {
			return p.test(message);
		}
		return message === p;
	});
}

export function setupErrorTracker(onEvent: (payload: ErrorPayload) => void, errorConfig: true | ErrorTrackOptions = true): () => void {
	const ignoreMessages: (string | RegExp)[] = errorConfig !== true && typeof errorConfig === 'object' && errorConfig.ignoreMessages
		? errorConfig.ignoreMessages
		: [];

	const onError = (e: ErrorEvent) => {
		const message = e.message || 'Unknown error';
		if (ignoreMessages.length > 0 && matchesMessage(message, ignoreMessages)) {
			return;
		}
		onEvent({
			message,
			stack: e.error?.stack,
			filename: e.filename,
			lineno: e.lineno,
			colno: e.colno,
			errorType: e.error?.name ?? 'Error',
		});
	}

	const onUnhandledRejection = (e: PromiseRejectionEvent) => {
		const reason = e.reason;
		const message = reason?.message ?? (reason === undefined ? 'Unhandled promise rejection' : String(reason));
		if (ignoreMessages.length > 0 && matchesMessage(message, ignoreMessages)) {
			return;
		}
		onEvent({
			message,
			stack: reason?.stack,
			errorType: reason?.name ?? 'UnhandledRejection',
		});
	}

	window.addEventListener('error', onError);
	window.addEventListener('unhandledrejection', onUnhandledRejection);

	return () => {
		window.removeEventListener('error', onError);
		window.removeEventListener('unhandledrejection', onUnhandledRejection);
	}
}
