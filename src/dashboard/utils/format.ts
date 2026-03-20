/**
* Pure formatting functions: no side effects, no DOM access.
* Used throughout the dashboard to display timestamps, durations, counts.
*/

const dateFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'medium' });
const timeFormatter = new Intl.DateTimeFormat(undefined, { timeStyle: 'medium' });
const shortFormatter = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });

// INFO Full date + time: "11/03/2026, 14:32:01"
export function formatDateTime(iso: string): string {
	try {
		return dateFormatter.format(new Date(iso));
	} catch {
		return iso;
	}
}

// INFO Time only: "14:32:01"
export function formatTime(iso: string): string {
	try {
		return timeFormatter.format(new Date(iso));
	} catch {
		return iso;
	}
}

// INFO HH:MM:SS
export function formatShortTime(iso: string): string {
	try {
		return shortFormatter.format(new Date(iso));
	} catch {
		return iso;
	}
}

/**
* INFO
* Relative time: "2m ago", "just now", "3h ago".
* Falls back to formatDateTime for anything older than 7 days.
*/
export function formatRelative(iso: string): string {
	try {
		const diffMs = Date.now() - new Date(iso).getTime();
		if (diffMs < 0) {
			return 'just now';
		}
		if (diffMs < 5_000) {
			return 'just now';
		}
		if (diffMs < 60_000) {
			return `${Math.floor(diffMs / 1_000)}s ago`;
		}
		if (diffMs < 3_600_000) {
			return `${Math.floor(diffMs / 60_000)}m ago`;
		}
		if (diffMs < 86_400_000) {
			return `${Math.floor(diffMs / 3_600_000)}h ago`;
		}
		if (diffMs < 604_800_000) {
			return `${Math.floor(diffMs / 86_400_000)}d ago`;
		}
		return formatDateTime(iso);
	} catch {
		return iso;
	}
}

/**
* INFO
* Format a chart bucket label: ISO bucket string -> compact label.
* "2026-03-11T14:00" -> "14:00"
* "2026-03-11"       -> "Mar 11"
*/
export function formatBucket(bucket: string): string {
	if (bucket.includes('T')) {
		// INFO Hourly bucket: show HH:MM
		return bucket.slice(11, 16);
	}
	// INFO Daily bucket: show "Mar 11"
	try {
		const d = new Date(bucket + 'T00:00:00');
		return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
	} catch {
		return bucket;
	}
}

// INFO 1234 -> "1,234"  |  999 -> "999"
export function formatCount(n: number): string {
	if (!Number.isFinite(n)) {
		return '-';
	}
	return new Intl.NumberFormat().format(Math.round(n));
}

// INFO 0.1234 -> "12.3%"
export function formatPercent(ratio: number, decimals = 1): string {
	if (!Number.isFinite(ratio)) {
		return '-';
	}
	return (ratio * 100).toFixed(decimals) + '%';
}

// INFO Already-a-percent value: 12.34 -> "12.3%"
export function formatPct(value: number, decimals = 1): string {
	if (!Number.isFinite(value)) {
		return '-';
	}
	return value.toFixed(decimals) + '%';
}

/**
* INFO
* Format milliseconds to a human-readable duration.
* 42      -> "42ms"
* 1500    -> "1.5s"
* 62000   -> "1m 2s"
* 3661000 -> "1h 1m"
*/
export function formatDuration(ms: number): string {
	if (!Number.isFinite(ms) || ms < 0) {
		return '-';
	}
	if (ms < 1_000) {
		return `${Math.round(ms)}ms`;
	}
	if (ms < 60_000) {
		return `${(ms / 1_000).toFixed(1)}s`;
	}
	if (ms < 3_600_000) {
		const m = Math.floor(ms / 60_000);
		const s = Math.floor((ms % 60_000) / 1_000);
		return s > 0 ? `${m}m ${s}s` : `${m}m`;
	}
	const h = Math.floor(ms / 3_600_000);
	const m = Math.floor((ms % 3_600_000) / 60_000);
	return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

// INFO 1536 -> "1.5 KB"  |  2097152 -> "2.0 MB"
export function formatBytes(bytes: number): string {
	if (!Number.isFinite(bytes) || bytes < 0) {
		return '-';
	}
	if (bytes < 1_024) {
		return `${bytes} B`;
	}
	if (bytes < 1_048_576) {
		return `${(bytes / 1_024).toFixed(1)} KB`;
	}
	if (bytes < 1_073_741_824) {
		return `${(bytes / 1_048_576).toFixed(1)} MB`;
	}
	return `${(bytes / 1_073_741_824).toFixed(2)} GB`;
}

// INFO Truncate to maxLen characters with ellipsis.
export function truncate(s: string, maxLen: number): string {
	if (s.length <= maxLen) {
		return s;
	}
	return s.slice(0, maxLen - 1) + '…';
}

// INFO Capitalize first letter.
export function capitalize(s: string): string {
	if (!s) {
		return s;
	}
	return s[0].toUpperCase() + s.slice(1);
}

/**
* INFO
* Format a JSON value for display in the detail panel.
* Returns syntax-highlighted HTML string (safe: only used for our own data).
*/
export function formatJson(value: unknown, indent = 2): string {
	const json = JSON.stringify(value, null, indent) ?? 'undefined';
	// INFO Minimal syntax highlighting via CSS classes (colours applied via style tag)
	return json
		.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
		.replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g, (match) => {
			let cls = 'json-num';
			if (/^"/.test(match)) {
				cls = match.endsWith(':') ? 'json-key' : 'json-str';
			} else if (/true|false/.test(match)) {
				cls = 'json-bool';
			} else if (/null/.test(match)) {
				cls = 'json-null';
			}
			return `<span class="${cls}">${match}</span>`;
		});
}

/**
* Produces the detail string visible in the Detail column of the
* events table. Used for both row rendering and the
* client-side filter in the search field.
*
* @remarks
* The returned text is not truncated for the filter (unlike the
* version displayed in the table) so as not to lose matches on
* long strings. The displayed version truncates with `truncate()`.
*/
export function getEventDetail(event: { type: string, payload: unknown }, truncateValue?: boolean): string {
	const p = event.payload as any;
	let val;
	switch (event.type) {
		case 'click':
			val = truncateValue ? truncate((p.text ?? "").trim(), 30) : (p.text ?? "").trim();
			return `${p.tag}${p.id ? '#' + p.id : ''} ${val}`;
		case 'http':
			val = truncateValue ? truncate((p.url ?? ""), 50) : (p.url ?? "").trim();
			return `${p.method} ${val} ${p.status ?? ''}`;
		case 'error':
			val = truncateValue ? truncate((p.message ?? ""), 70) : (p.message ?? "").trim();
			return val;
		case 'navigation':
			val = truncateValue ? truncate((p.from ?? ""), 25) : (p.from ?? "").trim();
			let to = truncateValue ? truncate((p.to ?? ""), 25) : (p.to ?? "").trim();
			return `${val} -> ${to}`;
		case 'console': {
			const indent = '  '.repeat(Number(p.groupDepth ?? 0));
			val = truncateValue ? truncate((p.message ?? ""), 60) : (p.message ?? "").trim();
			return `${indent}[${p.method}] ${val}`;
		}
		case 'custom':
			return `${p.name}${p.duration !== undefined ? ` - ${formatDuration(p.duration)}` : ''}`;
		case 'session': {
			val = truncateValue ? truncate((p.previousUserId ?? ""), 16) : (p.previousUserId ?? "").trim();
			let newUserId = truncateValue ? truncate((p.newUserId ?? "-"), 16) : (p.newUserId ?? "-").trim();
			const who = p.previousUserId ? ` (${val} -> ${newUserId})` : '';
			return `${p.action} · ${p.trigger}${who}`;
		}
		default:
			return '';
	}
}
