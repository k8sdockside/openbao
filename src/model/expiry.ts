// Certificates and leases, by how long each has left.
//
// Each VaultPKISecret and VaultDynamicSecret that has been issued something
// is a row. What it holds lives anywhere from minutes (a database lease) to
// months (a certificate), so a straight time axis would draw every lease as
// a dot at "now". The axis is logarithmic in the time left instead: ten
// minutes, an hour, a day, a week and a month each get room, and the order
// is still soonest first. What has already run out sits in a band of its own
// left of "now".

import type { Tone } from './types.js';
import { DAY, HOUR, MINUTE } from './units.js';
import type { SyncItem } from './vso.js';

export interface Row {
    item: SyncItem;
    start?: number;
    end: number;
    renew?: number;
    tone: Tone;
    /** Runs out within a day. */
    soon: boolean;
    /** How much of its life is used, 0..1, when its start is known. */
    used?: number;
}

export interface Axis {
    /** The furthest time left the axis reaches, in ms. */
    max: number;
    ticks: { left: number; label: string }[];
}

export function rows(items: SyncItem[], now: number): Row[] {
    return items
        .filter((i) => i.expires !== undefined && (i.kind === 'pki' || i.kind === 'dynamic'))
        .map((item) => {
            const end = item.expires as number;
            const tone: Tone = end <= now || item.tone === 'error' ? 'error' : item.tone === 'warn' ? 'warn' : 'ok';
            const life = item.issuedAt !== undefined ? end - item.issuedAt : undefined;
            return {
                item,
                start: item.issuedAt,
                end,
                renew: item.renewAt,
                tone,
                soon: end > now && end - now < DAY,
                used: life && life > 0 ? Math.min(1, Math.max(0, (now - (item.issuedAt as number)) / life)) : undefined,
            };
        })
        .sort((a, b) => a.end - b.end);
}

const TICKS: [number, string][] = [
    [10 * MINUTE, '10 min'],
    [HOUR, '1 h'],
    [6 * HOUR, '6 h'],
    [DAY, '1 d'],
    [7 * DAY, '1 wk'],
    [30 * DAY, '30 d'],
    [90 * DAY, '90 d'],
    [365 * DAY, '1 y'],
];

/** An axis reaching a little past the furthest row, at least an hour and at most two years. */
export function axisOf(list: Row[], now: number): Axis {
    const furthest = Math.max(HOUR, ...list.map((r) => r.end - now));
    const max = Math.min(2 * 365 * DAY, furthest * 1.35);
    return { max, ticks: TICKS.filter(([left]) => left <= max).map(([left, label]) => ({ left, label })) };
}

/** Where a time left falls along the axis, 0 (now) to 1, clamped. */
export function position(axis: Axis, left: number): number {
    if (left <= 0) return 0;
    const at = Math.log1p(left / MINUTE) / Math.log1p(axis.max / MINUTE);
    return Math.min(1, Math.max(0, at));
}
