import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { formatDateTime, formatTime, formatShortTime, formatRelative, formatBucket, formatCount, formatPercent, formatPct, formatDuration, formatBytes, truncate, capitalize, formatJson, getEventDetail, formatCompactNumber } from '../../../src/dashboard/utils/format';

describe('formatDateTime', () => {
	it('returns a non-empty string for a valid ISO', () => {
		const result = formatDateTime('2026-03-11T14:32:01.000Z');
		expect(typeof result).toBe('string');
		expect(result.length).toBeGreaterThan(0);
	});

	it('returns the original string for an invalid ISO', () => {
		expect(formatDateTime('not-a-date')).toBe('not-a-date');
	});
});

describe('formatTime', () => {
	it('returns a non-empty string for a valid ISO', () => {
		const result = formatTime('2026-03-11T14:32:01.000Z');
		expect(typeof result).toBe('string');
		expect(result.length).toBeGreaterThan(0);
	});

	it('returns the original string for an invalid ISO', () => {
		expect(formatTime('bad')).toBe('bad');
	});
});

describe('formatShortTime', () => {
	it('returns a non-empty string for a valid ISO', () => {
		const result = formatShortTime('2026-03-11T14:32:01.000Z');
		expect(typeof result).toBe('string');
		expect(result.length).toBeGreaterThan(0);
	});

	it('returns the original string for an invalid ISO', () => {
		expect(formatShortTime('bad')).toBe('bad');
	});
});

describe('formatRelative', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-03-11T14:32:01.000Z'));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('returns "just now" by date in the future', () => {
		expect(formatRelative('2026-03-11T14:32:05.000Z')).toBe('just now');
	});

	it('returns "just now" for less than 5 seconds ago', () => {
		expect(formatRelative('2026-03-11T14:31:57.000Z')).toBe('just now');
	});

	it('returns "Xs ago" for less than 30 seconds', () => {
		expect(formatRelative('2026-03-11T14:31:41.000Z')).toBe('20s ago');
	});

	it('returns "Xs ago" for less than 60 seconds', () => {
		expect(formatRelative('2026-03-11T14:31:01.000Z')).toBe('1m ago');
	});

	it('returns "Xm ago" for less than 1 hour', () => {
		expect(formatRelative('2026-03-11T14:02:01.000Z')).toBe('30m ago');
	});

	it('returns "Xh ago" for less than 24 hours', () => {
		expect(formatRelative('2026-03-11T12:32:01.000Z')).toBe('2h ago');
	});

	it('returns "Xd ago" for less than 7 days', () => {
		expect(formatRelative('2026-03-09T14:32:01.000Z')).toBe('2d ago');
	});

	it('returns formatDateTime for dates older than 7 days', () => {
		const old = '2026-03-01T14:32:01.000Z';
		const result = formatRelative(old);
		expect(result).toBe(formatDateTime(old));
	});

	it('returns the original string for an invalid ISO', () => {
		expect(formatRelative('not-a-date')).toBe('not-a-date');
	});
});

describe('formatBucket', () => {
	it('returns HH:MM for hourly bucket (contains T)', () => {
		expect(formatBucket('2026-03-11T14:00')).toBe('14:00');
	});

	it('returns "Mar 11" for daily bucket', () => {
		const result = formatBucket('2026-03-11');
		expect(result).toContain('11');
	});

	it('returns the original bucket when the date is not valid', () => {
		expect(formatBucket('bad-date')).toBe('bad-date');
	});
});

describe('formatCount', () => {
	it('formats integer numbers', () => {
		expect(formatCount(1234)).toBe('1,234');
	});

	it('returns "-" for non-finite values', () => {
		expect(formatCount(NaN)).toBe('-');
		expect(formatCount(Infinity)).toBe('-');
	});

	it('rounds decimal values', () => {
		expect(formatCount(1.6)).toBe('2');
	});
});

describe('formatPercent', () => {
	it('converts ratio to percentage with 1 decimal by default', () => {
		expect(formatPercent(0.1234)).toBe('12.3%');
	});

	it('respects the decimals parameter', () => {
		expect(formatPercent(0.1234, 2)).toBe('12.34%');
	});

	it('returns "-" for non-finite values', () => {
		expect(formatPercent(NaN)).toBe('-');
	});
});

describe('formatPct', () => {
	it('formats value already as percentage', () => {
		expect(formatPct(12.345)).toBe('12.3%');
	});

	it('respects the decimals parameter', () => {
		expect(formatPct(12.345, 2)).toBe('12.35%');
	});

	it('returns "-" for non-finite values', () => {
		expect(formatPct(Infinity)).toBe('-');
	});
});

describe('formatDuration', () => {
	it('returns "-" for negatives values', () => {
		expect(formatDuration(-1)).toBe('-');
	});

	it('returns "-" for NaN', () => {
		expect(formatDuration(NaN)).toBe('-');
	});

	it('less than 1s -> "Xms"', () => {
		expect(formatDuration(42)).toBe('42ms');
	});

	it('less than 60s -> "X.Xs"', () => {
		expect(formatDuration(1500)).toBe('1.5s');
	});

	it('less than 1h with seconds -> "Xm Ys"', () => {
		expect(formatDuration(62000)).toBe('1m 2s');
	});

	it('less than 1h without seconds -> "Xm"', () => {
		expect(formatDuration(60000)).toBe('1m');
	});

	it('less than 1h exactly a minute -> "1m"', () => {
		expect(formatDuration(60000)).toBe('1m');
	});

	it('>=1h with minutes -> "Xh Ym"', () => {
		expect(formatDuration(3661000)).toBe('1h 1m');
	});

	it('>=1h without minutes -> "Xh"', () => {
		expect(formatDuration(3600000)).toBe('1h');
	});
});

describe('formatBytes', () => {
	it('returns "-" for negatives values', () => {
		expect(formatBytes(-1)).toBe('-');
	});

	it('returns "-" for NaN', () => {
		expect(formatBytes(NaN)).toBe('-');
	});

	it('less than 1KB -> "X B"', () => {
		expect(formatBytes(500)).toBe('500 B');
	});

	it('less than 1MB -> "X.X KB"', () => {
		expect(formatBytes(1536)).toBe('1.5 KB');
	});

	it('less than 1GB -> "X.X MB"', () => {
		expect(formatBytes(2097152)).toBe('2.0 MB');
	});

	it('>= 1GB -> "X.XX GB"', () => {
		expect(formatBytes(1073741824)).toBe('1.00 GB');
	});
});

describe('truncate', () => {
	it('does not truncate when the string is short enough', () => {
		expect(truncate('hello', 10)).toBe('hello');
	});

	it('truncates and adds ellipsis when maxLen is exceeded', () => {
		expect(truncate('hello world', 6)).toBe('hello…');
	});

	it('does not truncate when the length is exactly maxLen', () => {
		expect(truncate('hello', 5)).toBe('hello');
	});
});

describe('capitalize', () => {
	it('capitalizes the first letter', () => {
		expect(capitalize('hello')).toBe('Hello');
	});

	it('returns the empty string unchanged', () => {
		expect(capitalize('')).toBe('');
	});
});

describe('formatJson', () => {
	it('produces HTML with span for keys and values', () => {
		const result = formatJson({ key: 'value', count: 1, flag: true, empty: null });
		expect(result).toContain('json-key');
		expect(result).toContain('json-str');
		expect(result).toContain('json-num');
		expect(result).toContain('json-bool');
		expect(result).toContain('json-null');
	});

	it('escapes HTML characters', () => {
		const result = formatJson({ a: '<b>' });
		expect(result).toContain('&lt;');
		expect(result).toContain('&gt;');
	});
});

describe('getEventDetail', () => {
	it('click: returns "TAG#ID TEXT"', () => {
		const event = { type: 'click', payload: { tag: 'BUTTON', id: 'submit', text: 'Submit' } };
		expect(getEventDetail(event as any)).toBe('BUTTON#submit Submit');
	});

	it('click without id: does not add the #', () => {
		const event = { type: 'click', payload: { tag: 'DIV', id: '', text: 'Click' } };
		expect(getEventDetail(event as any)).toBe('DIV Click');
	});

	it('http: returns "METHOD URL STATUS"', () => {
		const event = { type: 'http', payload: { method: 'GET', url: '/api/users', status: 200 } };
		expect(getEventDetail(event as any)).toBe('GET /api/users 200');
	});

	it('error: returns the message', () => {
		const event = { type: 'error', payload: { message: 'TypeError: foo' } };
		expect(getEventDetail(event as any)).toBe('TypeError: foo');
	});

	it('navigation: returns "from -> to"', () => {
		const event = { type: 'navigation', payload: { from: '/home', to: '/about' } };
		expect(getEventDetail(event as any)).toBe('/home -> /about');
	});

	it('console: returns "[method] message" with indent for groupDepth', () => {
		const event = { type: 'console', payload: { method: 'log', message: 'hello', groupDepth: 1 } };
		expect(getEventDetail(event as any)).toBe('  [log] hello');
	});

	it('custom: Returns "name" without duration', () => {
		const event = { type: 'custom', payload: { name: 'my-event' } };
		expect(getEventDetail(event as any)).toBe('my-event');
	});

	it('custom: return "name - duration" with duration', () => {
		const event = { type: 'custom', payload: { name: 'my-event', duration: 1500 } };
		expect(getEventDetail(event as any)).toBe('my-event - 1.5s');
	});

	it('session with previousUserId: shows the transition', () => {
		const event = { type: 'session', payload: { action: 'identify', trigger: 'manual', previousUserId: 'old', newUserId: 'new' } };
		const result = getEventDetail(event as any);
		expect(result).toContain('identify');
		expect(result).toContain('old -> new');
	});

	it('session without previousUserId: does not show the transition', () => {
		const event = { type: 'session', payload: { action: 'start', trigger: 'auto', previousUserId: null, newUserId: 'user1' } };
		const result = getEventDetail(event as any);
		expect(result).toBe('start · auto');
	});

	it('unknown type: returns empty string', () => {
		const event = { type: 'unknown', payload: {} };
		expect(getEventDetail(event as any)).toBe('');
	});
});

describe('formatCompactNumber', () => {
	it('999', () => {
		const result = formatCompactNumber(999);
		expect(result).toBe('999')
	});

	it('Infinite', () => {
		const result = formatCompactNumber(Infinity);
		expect(result).toBe('-')
	});

	it('>999', () => {
		const result = formatCompactNumber(1250);
		expect(result).toBe("1.3k");
	});

	it('>9999999', () => {
		const result = formatCompactNumber(1_000_001);
		expect(result).toBe("1.0M");
	});
})
