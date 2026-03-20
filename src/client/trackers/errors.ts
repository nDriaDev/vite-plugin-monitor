import { ErrorPayload } from "@tracker/types";

export function setupErrorTracker(onEvent: (payload: ErrorPayload) => void): () => void {
	if (typeof window === 'undefined') {
		return () => { };
	}

	const onError = (e: ErrorEvent) => {
		onEvent({
			message: e.message || 'Unknown error',
			stack: e.error?.stack,
			filename: e.filename,
			lineno: e.lineno,
			colno: e.colno,
			errorType: e.error?.name ?? 'Error',
		});
	}

	const onUnhandledRejection = (e: PromiseRejectionEvent) => {
		const reason = e.reason;
		onEvent({
			message: reason?.message ?? (reason === undefined ? 'Unhandled promise rejection' : String(reason)),
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
