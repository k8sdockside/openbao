// The pieces the pages are drawn from: the heading with its tabs, tiles,
// pills, blocks, facts, sparklines.
//
// They are built from CSS classes rather than colour values, so the app's
// theme tokens colour them and a switch from light to dark needs no
// JavaScript at all.

import type { Tone } from '../model/types.js';
import { el, replace, svgEl } from './dom.js';

/** The plugin's pages, in the order the heading offers them. */
const VIEWS: [string, string][] = [
    ['overview', 'Dashboard'],
    ['cluster', 'Servers'],
    ['flow', 'Secret flow'],
    ['expiry', 'Certificates & leases'],
];

/** A page's own heading: the mark, the title, a line under it, and the other pages as tabs. */
export function heading(current: string, title: string, note: string, counts: Record<string, number> = {}): HTMLElement {
    const nav = el('nav', { class: 'tabs', 'aria-label': 'OpenBao and Vault views' });
    for (const [id, label] of VIEWS) {
        const here = id === current;
        const tab = el('button', { type: 'button', class: here ? 'tab here' : 'tab', 'aria-current': here ? 'page' : undefined }, label, counts[id] && !here ? el('span', { class: 'tab-count' }, String(counts[id])) : null);
        if (!here) tab.addEventListener('click', () => void k8sdockside.openView(id));
        nav.append(tab);
    }
    return el(
        'header',
        { class: 'page-head' },
        el('div', { class: 'page-title' }, el('img', { class: 'mark', src: 'logo.svg', alt: '', width: 28, height: 28 }), el('div', {}, el('h1', {}, title), note ? el('p', { class: 'note' }, note) : null)),
        nav,
    );
}

/** A labelled number, the tile the dashboard's top row is built from. */
export function tile(opts: { label: string; value: string; tone?: Tone; note?: string; noteTone?: Tone; onPick?: () => void; title?: string }): HTMLElement {
    const node = el(
        'div',
        { class: `tile tone-edge-${opts.tone || 'none'}`, title: opts.title },
        el('div', { class: 'tile-label' }, opts.label),
        el('div', { class: `tile-value tone-${opts.tone || 'none'}` }, opts.value),
        opts.note ? el('div', { class: `tile-note${opts.noteTone ? ` tone-${opts.noteTone}` : ''}` }, opts.note) : null,
    );
    if (opts.onPick) clickable(node, opts.onPick);
    return node;
}

/** A small coloured label: a state, a method, a role. */
export function pill(text: string, tone: Tone = '', title = ''): HTMLElement {
    return el('span', { class: `pill pill-${tone || 'none'}`, ...(title ? { title } : {}) }, text);
}

/** The product, as a badge: OpenBao and Vault each have one of their own. */
export function productBadge(product: string): HTMLElement {
    const word = product === 'openbao' ? 'OpenBao' : product === 'vault' ? 'Vault' : '?';
    return el('span', { class: `badge badge-${product}`, title: product === 'openbao' ? 'OpenBao: the open-source fork of Vault' : product === 'vault' ? 'HashiCorp Vault' : 'Not told apart yet' }, word);
}

/** A section with a heading, an optional sentence, and whatever follows. */
export function block(title: string, note: string, ...children: (Node | null | undefined)[]): HTMLElement {
    return el('section', { class: 'block' }, el('h2', {}, title), note ? el('p', { class: 'note' }, note) : null, ...children.filter((c): c is Node => !!c));
}

/** Terms and values in two columns. */
export function facts(pairs: [string, Node | string | undefined][]): HTMLElement {
    const list = el('dl', { class: 'facts' });
    for (const [term, value] of pairs) {
        if (value === undefined) continue;
        list.append(el('dt', {}, term), el('dd', {}, typeof value === 'string' ? value || '—' : value));
    }
    return list;
}

/** An empty state that says what would have been here. */
export function nothing(message: string): HTMLElement {
    return el('p', { class: 'empty' }, message);
}

/** Replaces a host's contents with a single "still reading" line. */
export function loading(host: HTMLElement, message: string): void {
    replace(host, el('p', { class: 'loading' }, message));
}

/**
 * Makes a node behave like a button: clickable, focusable, and answering the
 * keys a button answers.
 */
export function clickable<T extends Element>(node: T, onPick: () => void, label = ''): T {
    node.classList.add('pick');
    node.setAttribute('role', 'button');
    node.setAttribute('tabindex', '0');
    if (label) node.setAttribute('aria-label', label);
    node.addEventListener('click', (event) => {
        event.stopPropagation();
        onPick();
    });
    node.addEventListener('keydown', (event) => {
        const key = (event as KeyboardEvent).key;
        if (key === 'Enter' || key === ' ') {
            event.preventDefault();
            onPick();
        }
    });
    return node;
}

/** A button that opens an object in the app, drawn as the name of the thing. */
export function openName(label: string, ref: K8sDockside.OpenRef, className = 'link-name'): HTMLElement {
    const node = el('button', { type: 'button', class: className, title: `Open ${label}` }, label);
    node.addEventListener('click', () => void k8sdockside.open(ref));
    return node;
}

/** A link-styled button. */
export function footLink(label: string, onClick: () => void): HTMLElement {
    const node = el('button', { type: 'button', class: 'foot-link' }, label);
    node.addEventListener('click', onClick);
    return node;
}

/** A button that opens an address in the user's browser. */
export function linkButton(label: string, url: string): HTMLElement {
    const node = el('button', { type: 'button' }, label);
    node.addEventListener('click', () => void k8sdockside.openUrl(url));
    return node;
}

/** A coloured dot for a tone. */
export function dot(tone: Tone): HTMLElement {
    return el('span', { class: `dot dot-${tone || 'none'}`, 'aria-hidden': 'true' });
}

/** A small line chart of one or more series, coloured --chart-1, --chart-2 ... in order. */
export function sparkline(series: K8sDockside.ChartSeries[], width = 220, height = 40): SVGElement {
    const drawing = svgEl('svg', { viewBox: `0 0 ${width} ${height}`, class: 'spark', preserveAspectRatio: 'none', 'aria-hidden': 'true' });
    const points = series.flatMap((s) => s.points);
    if (points.length < 2) return drawing;
    const first = Math.min(...points.map((p) => p.t));
    const last = Math.max(...points.map((p) => p.t));
    const top = Math.max(...points.map((p) => p.v), 0);
    const spanT = Math.max(1, last - first);
    drawing.append(svgEl('line', { x1: 0, x2: width, y1: height - 0.5, y2: height - 0.5, class: 'spark-base' }));
    series.slice(0, 8).forEach((s, index) => {
        if (s.points.length < 2) return;
        const path = s.points.map((p) => `${(((p.t - first) / spanT) * width).toFixed(1)},${(height - 2 - (top > 0 ? (p.v / top) * (height - 4) : 0)).toFixed(1)}`).join(' ');
        drawing.append(svgEl('polyline', { points: path, class: `spark-line series-${index + 1}`, fill: 'none', 'vector-effect': 'non-scaling-stroke' }));
    });
    return drawing;
}

/** A chart value written the way its unit asks for. */
export function formatValue(unit: string, value: number | undefined): string {
    if (value === undefined || !Number.isFinite(value)) return '—';
    switch (unit) {
        case 'ops/s':
            return `${value >= 100 ? value.toFixed(0) : value.toFixed(1)}/s`;
        case 'seconds':
            return value < 1 ? `${(value * 1000).toFixed(0)} ms` : `${value.toFixed(1)} s`;
        default:
            return value >= 100 || Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1);
    }
}

/** The theme token behind a tone, for the few borders set by hand. */
export function toneVar(tone: Tone): string {
    return tone === 'ok' ? 'var(--ok)' : tone === 'warn' ? 'var(--warn)' : tone === 'error' ? 'var(--error)' : tone === 'info' ? 'var(--accent)' : 'var(--border)';
}

export { el, replace, svgEl };
