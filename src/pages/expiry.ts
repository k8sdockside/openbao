// Certificates & leases: every VaultPKISecret and VaultDynamicSecret on one
// time axis, soonest first.
//
// A row's bar runs from when it was issued to when it runs out; the tick on
// it is when the operator plans to renew or reissue it; the line through
// every row is now. Amber is stale or within a day, red is expired or broken.

import { axisOf, position, rows, type Row, type Axis } from '../model/expiry.js';
import { relative, span } from '../model/units.js';
import type { World } from '../model/world.js';
import { byId, el, replace, svgEl } from '../ui/dom.js';
import { load } from '../ui/load.js';
import { every, fingerprint, moment, start } from '../ui/page.js';
import { block, clickable, heading, nothing, pill } from '../ui/parts.js';

const REFRESH = 30_000;

start('page', async () => {
    const head = byId('head');
    const body = byId('body');
    const failure = el('p', { class: 'refresh-failure' });
    const note = `When each certificate and lease the Secrets Operator holds runs out, and when it is renewed.`;
    replace(head, heading('expiry', 'Certificates & leases', note));
    let last = '';

    const stop = every(
        REFRESH,
        async () => {
            const { snap, world } = await load();
            failure.textContent = '';
            document.getElementById('first')?.remove();
            const print = fingerprint([snap, Math.floor(Date.now() / 60_000)]);
            if (print === last) return;
            last = print;
            const list = rows(world.items, world.now);
            replace(head, heading('expiry', 'Certificates & leases', note, { expiry: list.filter((r) => r.tone === 'error').length }));
            replace(body, failure, ...draw(world, list));
        },
        (err) => {
            failure.textContent = err instanceof Error ? err.message : String(err);
        },
    );
    addEventListener('pagehide', stop);
});

function draw(world: World, list: Row[]): HTMLElement[] {
    if (!world.served.vso) {
        return [block('The Secrets Operator is not installed', 'Certificates and leases are drawn from VaultPKISecret and VaultDynamicSecret objects, and this cluster does not serve the secrets.hashicorp.com API.', null)];
    }
    if (list.length === 0) {
        return [block('Nothing issued yet', '', nothing('No VaultPKISecret or VaultDynamicSecret has been issued anything with an end date. Static secrets never expire, so they are not here.'))];
    }
    const axis = axisOf(list, world.now);
    const soon = list.filter((r) => r.tone !== 'ok').length;
    return [
        block(
            'Timeline',
            `${soon ? `${soon} of ${list.length} need a look.` : `All ${list.length} renew on schedule.`} Soonest first, on a scale that gives minutes and months room alike. Click a row to open it.`,
            el('div', { class: 'timeline-holder' }, timeline(list, axis, world.now)),
            el(
                'div',
                { class: 'map-legend' },
                el('span', { class: 'legend-item' }, el('span', { class: 'key-line ok' }), 'time left'),
                el('span', { class: 'legend-item' }, el('span', { class: 'key-tick' }), 'when the operator renews it'),
                el('span', { class: 'legend-item' }, el('span', { class: 'key-line warn' }), 'renewal overdue, or near the end of a long life'),
                el('span', { class: 'legend-item' }, el('span', { class: 'key-line error' }), 'expired or failing'),
            ),
        ),
        table(list, world.now),
    ];
}

const LABEL_W = 270;
const PAST_W = 76;
const CHART_W = 600;
const ROW_H = 38;
const HEAD = 28;

function timeline(list: Row[], axis: Axis, now: number): SVGElement {
    const nowX = LABEL_W + PAST_W;
    const width = nowX + CHART_W + 96;
    const height = HEAD + list.length * ROW_H + 6;
    const svg = svgEl('svg', { class: 'timeline', viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': 'Time left on each certificate and lease' });
    const x = (at: number) => nowX + position(axis, at - now) * CHART_W;

    svg.append(svgEl('rect', { class: 'tl-past', x: LABEL_W + 4, y: HEAD - 6, width: PAST_W - 8, height: height - HEAD + 2, rx: 6 }));
    const past = svgEl('text', { class: 'tl-tick', x: LABEL_W + PAST_W / 2, y: 14, 'text-anchor': 'middle' });
    past.textContent = 'expired';
    svg.append(past);
    for (const tick of axis.ticks) {
        const tx = nowX + position(axis, tick.left) * CHART_W;
        svg.append(svgEl('line', { class: 'tl-grid', x1: tx, x2: tx, y1: HEAD - 6, y2: height - 4 }));
        const t = svgEl('text', { class: 'tl-tick', x: tx, y: 14, 'text-anchor': 'middle' });
        t.textContent = tick.label;
        svg.append(t);
    }

    list.forEach((r, i) => {
        const y = HEAD + i * ROW_H;
        const mid = y + ROW_H / 2;
        const g = svgEl('g', { class: `tl-row tone-${r.tone || 'none'}` });
        g.append(svgEl('rect', { class: 'tl-hover', x: 0, y: y + 1, width, height: ROW_H - 2, rx: 6 }));
        const name = svgEl('text', { class: 'tl-name', x: 8, y: y + 17 });
        name.textContent = `${r.item.namespace}/${r.item.name}`;
        const kind = svgEl('text', { class: 'tl-kind', x: 8, y: y + 31 });
        kind.textContent = `${r.item.kind === 'pki' ? 'Certificate' : 'Lease'} · ${r.item.commonName ?? r.item.location}`;
        g.append(name, kind);
        g.append(svgEl('rect', { class: 'tl-track', x: nowX, y: mid - 6, width: CHART_W, height: 12, rx: 6 }));
        let labelX: number;
        if (r.end <= now) {
            g.append(svgEl('rect', { class: 'tl-bar', x: LABEL_W + 10, y: mid - 6, width: PAST_W - 20, height: 12, rx: 6 }));
            labelX = nowX + 8;
        } else {
            const end = x(r.end);
            g.append(svgEl('rect', { class: 'tl-bar', x: nowX, y: mid - 6, width: Math.max(8, end - nowX), height: 12, rx: 6 }));
            labelX = Math.max(end, nowX + 8) + 7;
        }
        if (r.renew !== undefined && r.renew < r.end - 1000) {
            const rx = r.renew <= now ? nowX : x(r.renew);
            g.append(svgEl('line', { class: `tl-renew${r.renew <= now ? ' tl-renew-late' : ''}`, x1: rx, x2: rx, y1: mid - 10, y2: mid + 10 }));
        }
        const endLabel = svgEl('text', { class: 'tl-end', x: labelX, y: mid + 4 });
        endLabel.textContent = r.end <= now ? `expired ${relative(r.end, now)}` : `${span(r.end - now)} left`;
        g.append(endLabel);
        const tip = svgEl('title');
        const used = r.used !== undefined ? ` ${Math.round(r.used * 100)}% of its life is used.` : '';
        tip.textContent = `${r.item.namespace}/${r.item.name}: expires ${moment(r.end)}${r.renew !== undefined && r.renew < r.end ? `; the operator renews it ${relative(r.renew, now)}` : ''}.${used} ${r.item.message ?? ''}`.trim();
        g.append(tip);
        clickable(g as unknown as HTMLElement, () => void k8sdockside.open(r.item.ref));
        svg.append(g);
    });

    svg.append(svgEl('line', { class: 'tl-now', x1: nowX, x2: nowX, y1: HEAD - 10, y2: height - 2 }));
    const label = svgEl('text', { class: 'tl-now-label', x: nowX, y: HEAD - 13, 'text-anchor': 'middle' });
    label.textContent = 'now';
    svg.append(label);
    return svg;
}

function table(list: Row[], now: number): HTMLElement {
    const body = el('tbody');
    for (const r of list) {
        const row = el(
            'tr',
            {},
            el('td', {}, el('strong', {}, r.item.name), el('span', { class: 'faint' }, ` ${r.item.namespace}`)),
            el('td', {}, r.item.kind === 'pki' ? 'certificate' : r.item.renewable ? 'renewable lease' : 'lease'),
            el('td', { class: 'mono' }, r.item.location),
            el('td', {}, r.start !== undefined ? moment(r.start) : '—'),
            el('td', {}, r.renew !== undefined && r.renew < r.end - 1000 ? relative(r.renew, now) : 'at expiry'),
            el('td', {}, `${moment(r.end)} (${relative(r.end, now)})`),
            el('td', {}, pill(r.item.words, r.tone)),
            el('td', {}, r.item.destination),
        );
        clickable(row, () => void k8sdockside.open(r.item.ref));
        body.append(row);
    }
    return block(
        'Every one of them',
        'Renewal is when the operator means to renew a lease (at renewalPercent of it) or reissue a certificate (expiryOffset before it expires).',
        el('div', { class: 'table-wrap' }, el('table', {}, el('thead', {}, el('tr', {}, ...['Name', 'What', 'Path', 'Issued', 'Renewal', 'Expires', 'State', 'Secret'].map((h) => el('th', {}, h)))), body)),
    );
}
