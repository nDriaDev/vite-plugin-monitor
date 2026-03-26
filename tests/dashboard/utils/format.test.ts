import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { formatDateTime, formatTime, formatShortTime, formatRelative, formatBucket, formatCount, formatPercent, formatPct, formatDuration, formatBytes, truncate, capitalize, formatJson, getEventDetail } from '../../../src/dashboard/utils/format';

describe('formatDateTime', () => {
	it('restituisce una stringa non vuota per un ISO valido', () => {
		const result = formatDateTime('2026-03-11T14:32:01.000Z');
		expect(typeof result).toBe('string');
		expect(result.length).toBeGreaterThan(0);
	});

	it('restituisce la stringa originale per un ISO non valido', () => {
		expect(formatDateTime('not-a-date')).toBe('not-a-date');
	});
});

describe('formatTime', () => {
	it('restituisce una stringa non vuota per un ISO valido', () => {
		const result = formatTime('2026-03-11T14:32:01.000Z');
		expect(typeof result).toBe('string');
		expect(result.length).toBeGreaterThan(0);
	});

	it('restituisce la stringa originale per un ISO non valido', () => {
		expect(formatTime('bad')).toBe('bad');
	});
});

describe('formatShortTime', () => {
	it('restituisce una stringa non vuota per un ISO valido', () => {
		const result = formatShortTime('2026-03-11T14:32:01.000Z');
		expect(typeof result).toBe('string');
		expect(result.length).toBeGreaterThan(0);
	});

	it('restituisce la stringa originale per un ISO non valido', () => {
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

	it('restituisce "just now" per data nel futuro', () => {
		expect(formatRelative('2026-03-11T14:32:05.000Z')).toBe('just now');
	});

	it('restituisce "just now" per meno di 5 secondi fa', () => {
		expect(formatRelative('2026-03-11T14:31:57.000Z')).toBe('just now');
	});

	it('restituisce "Xs ago" per meno di 30 secondi', () => {
		expect(formatRelative('2026-03-11T14:31:41.000Z')).toBe('20s ago');
	});

	it('restituisce "Xs ago" per meno di 60 secondi', () => {
		expect(formatRelative('2026-03-11T14:31:01.000Z')).toBe('1m ago');
	});

	it('restituisce "Xm ago" per meno di 1 ora', () => {
		expect(formatRelative('2026-03-11T14:02:01.000Z')).toBe('30m ago');
	});

	it('restituisce "Xh ago" per meno di 24 ore', () => {
		expect(formatRelative('2026-03-11T12:32:01.000Z')).toBe('2h ago');
	});

	it('restituisce "Xd ago" per meno di 7 giorni', () => {
		expect(formatRelative('2026-03-09T14:32:01.000Z')).toBe('2d ago');
	});

	it('restituisce formatDateTime per date più vecchie di 7 giorni', () => {
		const old = '2026-03-01T14:32:01.000Z';
		const result = formatRelative(old);
		expect(result).toBe(formatDateTime(old));
	});

	it('restituisce la stringa originale per un ISO non valido', () => {
		expect(formatRelative('not-a-date')).toBe('not-a-date');
	});
});

describe('formatBucket', () => {
	it('restituisce HH:MM per bucket orario (contiene T)', () => {
		expect(formatBucket('2026-03-11T14:00')).toBe('14:00');
	});

	it('restituisce "Mar 11" per bucket giornaliero', () => {
		const result = formatBucket('2026-03-11');
		expect(result).toContain('11');
	});

	it('restituisce il bucket originale se la data non è valida', () => {
		expect(formatBucket('bad-date')).toBe('bad-date');
	});
});

describe('formatCount', () => {
	it('formatta numeri interi', () => {
		expect(formatCount(1234)).toBe('1,234');
	});

	it('restituisce "-" per valori non finiti', () => {
		expect(formatCount(NaN)).toBe('-');
		expect(formatCount(Infinity)).toBe('-');
	});

	it('arrotonda i valori decimali', () => {
		expect(formatCount(1.6)).toBe('2');
	});
});

describe('formatPercent', () => {
	it('converte ratio a percentuale con 1 decimale di default', () => {
		expect(formatPercent(0.1234)).toBe('12.3%');
	});

	it('rispetta il parametro decimals', () => {
		expect(formatPercent(0.1234, 2)).toBe('12.34%');
	});

	it('restituisce "-" per valori non finiti', () => {
		expect(formatPercent(NaN)).toBe('-');
	});
});

describe('formatPct', () => {
	it('formatta valore già in percentuale', () => {
		expect(formatPct(12.345)).toBe('12.3%');
	});

	it('rispetta il parametro decimals', () => {
		expect(formatPct(12.345, 2)).toBe('12.35%');
	});

	it('restituisce "-" per valori non finiti', () => {
		expect(formatPct(Infinity)).toBe('-');
	});
});

describe('formatDuration', () => {
	it('restituisce "-" per valori negativi', () => {
		expect(formatDuration(-1)).toBe('-');
	});

	it('restituisce "-" per NaN', () => {
		expect(formatDuration(NaN)).toBe('-');
	});

	it('meno di 1s -> "Xms"', () => {
		expect(formatDuration(42)).toBe('42ms');
	});

	it('meno di 60s -> "X.Xs"', () => {
		expect(formatDuration(1500)).toBe('1.5s');
	});

	it('meno di 1h con secondi -> "Xm Ys"', () => {
		expect(formatDuration(62000)).toBe('1m 2s');
	});

	it('meno di 1h senza secondi -> "Xm"', () => {
		expect(formatDuration(60000)).toBe('1m');
	});

	it('meno di 1h esatto un minuto -> "1m"', () => {
		expect(formatDuration(60000)).toBe('1m');
	});

	it('>=1h con minuti -> "Xh Ym"', () => {
		expect(formatDuration(3661000)).toBe('1h 1m');
	});

	it('>=1h senza minuti -> "Xh"', () => {
		expect(formatDuration(3600000)).toBe('1h');
	});
});

describe('formatBytes', () => {
	it('restituisce "-" per valori negativi', () => {
		expect(formatBytes(-1)).toBe('-');
	});

	it('restituisce "-" per NaN', () => {
		expect(formatBytes(NaN)).toBe('-');
	});

	it('meno di 1KB -> "X B"', () => {
		expect(formatBytes(500)).toBe('500 B');
	});

	it('meno di 1MB -> "X.X KB"', () => {
		expect(formatBytes(1536)).toBe('1.5 KB');
	});

	it('meno di 1GB -> "X.X MB"', () => {
		expect(formatBytes(2097152)).toBe('2.0 MB');
	});

	it('>= 1GB -> "X.XX GB"', () => {
		expect(formatBytes(1073741824)).toBe('1.00 GB');
	});
});

describe('truncate', () => {
	it('non tronca se la stringa è corta abbastanza', () => {
		expect(truncate('hello', 10)).toBe('hello');
	});

	it('tronca e aggiunge ellipsis se supera maxLen', () => {
		expect(truncate('hello world', 6)).toBe('hello…');
	});

	it('non tronca se la lunghezza è esattamente maxLen', () => {
		expect(truncate('hello', 5)).toBe('hello');
	});
});

describe('capitalize', () => {
	it('mette in maiuscolo la prima lettera', () => {
		expect(capitalize('hello')).toBe('Hello');
	});

	it('restituisce la stringa vuota invariata', () => {
		expect(capitalize('')).toBe('');
	});
});

describe('formatJson', () => {
	it('produce HTML con span per chiavi e valori', () => {
		const result = formatJson({ key: 'value', count: 1, flag: true, empty: null });
		expect(result).toContain('json-key');
		expect(result).toContain('json-str');
		expect(result).toContain('json-num');
		expect(result).toContain('json-bool');
		expect(result).toContain('json-null');
	});

	it('effettua l\'escape dei caratteri HTML', () => {
		const result = formatJson({ a: '<b>' });
		expect(result).toContain('&lt;');
		expect(result).toContain('&gt;');
	});
});

describe('getEventDetail', () => {
	it('click: restituisce "TAG#ID TESTO"', () => {
		const event = { type: 'click', payload: { tag: 'BUTTON', id: 'submit', text: 'Submit' } };
		expect(getEventDetail(event as any)).toBe('BUTTON#submit Submit');
	});

	it('click senza id: non aggiunge il #', () => {
		const event = { type: 'click', payload: { tag: 'DIV', id: '', text: 'Click' } };
		expect(getEventDetail(event as any)).toBe('DIV Click');
	});

	it('http: restituisce "METHOD URL STATUS"', () => {
		const event = { type: 'http', payload: { method: 'GET', url: '/api/users', status: 200 } };
		expect(getEventDetail(event as any)).toBe('GET /api/users 200');
	});

	it('error: restituisce il messaggio', () => {
		const event = { type: 'error', payload: { message: 'TypeError: foo' } };
		expect(getEventDetail(event as any)).toBe('TypeError: foo');
	});

	it('navigation: restituisce "from -> to"', () => {
		const event = { type: 'navigation', payload: { from: '/home', to: '/about' } };
		expect(getEventDetail(event as any)).toBe('/home -> /about');
	});

	it('console: restituisce "[method] messaggio" con indent per groupDepth', () => {
		const event = { type: 'console', payload: { method: 'log', message: 'hello', groupDepth: 1 } };
		expect(getEventDetail(event as any)).toBe('  [log] hello');
	});

	it('custom: restituisce "name" senza duration', () => {
		const event = { type: 'custom', payload: { name: 'my-event' } };
		expect(getEventDetail(event as any)).toBe('my-event');
	});

	it('custom: restituisce "name - duration" con duration', () => {
		const event = { type: 'custom', payload: { name: 'my-event', duration: 1500 } };
		expect(getEventDetail(event as any)).toBe('my-event - 1.5s');
	});

	it('session con previousUserId: mostra la transizione', () => {
		const event = { type: 'session', payload: { action: 'identify', trigger: 'manual', previousUserId: 'old', newUserId: 'new' } };
		const result = getEventDetail(event as any);
		expect(result).toContain('identify');
		expect(result).toContain('old -> new');
	});

	it('session senza previousUserId: non mostra la transizione', () => {
		const event = { type: 'session', payload: { action: 'start', trigger: 'auto', previousUserId: null, newUserId: 'user1' } };
		const result = getEventDetail(event as any);
		expect(result).toBe('start · auto');
	});

	it('tipo sconosciuto: restituisce stringa vuota', () => {
		const event = { type: 'unknown', payload: {} };
		expect(getEventDetail(event as any)).toBe('');
	});

	it('truncateValue=true: tronca i valori lunghi', () => {
		const longText = 'A'.repeat(100);
		const event = { type: 'error', payload: { message: longText } };
		const truncated = getEventDetail(event as any, true);
		expect(truncated.length).toBeLessThan(longText.length);
		expect(truncated).toContain('…');
	});
});
