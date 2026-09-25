// Words for numbers and times, and the order of tones.

import type { Tone } from './types.js';

export const SECOND = 1000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

/** "1 node", "3 nodes". */
export function plural(n: number, word: string, many = `${word}s`): string {
    return `${n} ${n === 1 ? word : many}`;
}

const RANK: Record<string, number> = { error: 4, warn: 3, info: 2, ok: 1, '': 0 };

/** The worse of some tones: error over warn over info over ok. */
export function worst(...tones: Tone[]): Tone {
    let out: Tone = '';
    for (const tone of tones) if ((RANK[tone] ?? 0) > (RANK[out] ?? 0)) out = tone;
    return out;
}

/** How bad a tone is, for sorting worst first. */
export function rank(tone: Tone): number {
    return RANK[tone] ?? 0;
}

/**
 * A length of time in the largest unit that keeps it readable: "45 s",
 * "12 min", "5 h", "3 d". Negative spans are written as their size.
 */
export function span(ms: number): string {
    const abs = Math.abs(ms);
    if (abs < MINUTE) return `${Math.round(abs / SECOND)} s`;
    if (abs < HOUR) return `${Math.round(abs / MINUTE)} min`;
    if (abs < 36 * HOUR) {
        const h = abs / HOUR;
        return `${h < 10 ? Math.round(h * 10) / 10 : Math.round(h)} h`;
    }
    return `${Math.round(abs / DAY)} d`;
}

/** "in 3 d" or "3 d ago". */
export function relative(at: number, now: number): string {
    return at >= now ? `in ${span(at - now)}` : `${span(now - at)} ago`;
}

/**
 * A Go duration ("1h30m", "90s", "720h", "15m0s") as milliseconds, or
 * undefined when it is not one. The operators' fields -- refreshAfter,
 * expiryOffset, ttl -- are written this way.
 */
export function goDuration(text: string | undefined): number | undefined {
    if (!text) return undefined;
    const trimmed = text.trim();
    if (trimmed === '0') return 0;
    const re = /(\d+(?:\.\d+)?)(ns|us|µs|ms|s|m|h|d)/g;
    const factor: Record<string, number> = { ns: 1e-6, us: 1e-3, µs: 1e-3, ms: 1, s: SECOND, m: MINUTE, h: HOUR, d: DAY };
    let total = 0;
    let consumed = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(trimmed)) !== null) {
        if (match.index !== consumed) return undefined;
        total += Number(match[1]) * (factor[match[2] ?? 's'] ?? 0);
        consumed = match.index + match[0].length;
    }
    return consumed === trimmed.length && consumed > 0 ? total : undefined;
}
