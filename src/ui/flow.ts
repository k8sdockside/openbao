// Draws the secret flow as SVG.
//
// Colour comes from classes only -- `tone-ok`, `edge-error` -- so the
// stylesheet maps them onto the app's tokens and a theme switch needs no
// redraw. Text is set with textContent, like everywhere else: a secret's
// name is cluster data, and SVG <text> is no safer than HTML for it.
//
// Hovering a node lights up every chain through it and dims the rest;
// clicking opens the object in the app -- or, for a server in view, the
// Servers view on it.

import { GAP_X, lineage, NODE_H, NODE_W, TOP, type FEdge, type FlowGraph, type FNode, type Layout } from '../model/flow.js';
import { el, svgEl } from './dom.js';
import { clickable } from './parts.js';

function truncate(value: string, n: number): string {
    return value.length > n ? `${value.slice(0, Math.max(1, n - 1))}…` : value;
}

/** A path keeps its end, which is the part that tells two apart: …/billing/config. */
function truncatePath(value: string, n: number): string {
    if (value.length <= n || !value.includes('/')) return truncate(value, n);
    const parts = value.split('/');
    while (parts.length > 1 && `…/${parts.join('/')}`.length > n) parts.shift();
    const kept = `…/${parts.join('/')}`;
    return kept.length <= n ? kept : `…${value.slice(value.length - n + 1)}`;
}

function text(x: number, y: number, cls: string, value: string, extra: Record<string, string | number> = {}): SVGElement {
    const t = svgEl('text', { x, y, class: cls, ...extra });
    t.textContent = value;
    return t;
}

function title(value: string): SVGElement {
    const t = svgEl('title');
    t.textContent = value;
    return t;
}

export interface FlowOptions {
    onServer?: (clusterId: string) => void;
    /** Leaves out the column headings, for a panel. */
    compact?: boolean;
}

export function drawFlow(graph: FlowGraph, layout: Layout, options: FlowOptions = {}): SVGElement {
    const pad = 12;
    const top = options.compact ? TOP - 16 : 0;
    // Columns nothing is in are drawn narrow rather than left as a gap.
    const width = layout.width + pad * 2;
    const height = layout.height - top + 4;
    const svg = svgEl('svg', { class: 'map', viewBox: `${-pad} ${top} ${width} ${height}`, width, height, role: 'img', 'aria-label': `Secret flow: ${graph.nodes.length} objects` });

    const lanes = svgEl('g', { class: 'lanes' });
    for (const c of layout.columns) {
        lanes.append(svgEl('rect', { class: 'lane', x: c.x - 7, y: TOP - 9, width: NODE_W + 14, height: Math.max(NODE_H + 18, layout.height - TOP + 6), rx: 12 }));
        if (!options.compact) lanes.append(text(c.x + 4, 15, 'lane-label', c.label.toUpperCase()));
    }
    svg.append(lanes);

    const edgeLayer = svgEl('g', { class: 'edges' });
    const nodeLayer = svgEl('g', { class: 'nodes' });
    const edgeEls = new Map<string, SVGElement>();
    const nodeEls = new Map<string, SVGElement>();

    for (const e of graph.edges) {
        const a = layout.boxes.get(e.from);
        const b = layout.boxes.get(e.to);
        if (!a || !b) continue;
        const path = drawEdge(e, a.x + NODE_W, a.y + NODE_H / 2, b.x, b.y + NODE_H / 2);
        edgeLayer.append(path);
        edgeEls.set(e.id, path);
    }

    for (const n of graph.nodes) {
        const box = layout.boxes.get(n.id);
        if (!box) continue;
        const g = drawNode(n, box.x, box.y);
        nodeLayer.append(g);
        nodeEls.set(n.id, g);
        const pick = n.clusterId && options.onServer ? () => options.onServer?.(n.clusterId as string) : n.ref ? () => void k8sdockside.open(n.ref as K8sDockside.OpenRef) : null;
        if (pick) clickable(g as unknown as HTMLElement, pick);
        const light = () => {
            const l = lineage(graph, n.id);
            svg.classList.add('focusing');
            for (const [id, node] of nodeEls) node.classList.toggle('lit', l.nodes.has(id));
            for (const [id, edge] of edgeEls) edge.classList.toggle('lit', l.edges.has(id));
        };
        const dark = () => svg.classList.remove('focusing');
        g.addEventListener('mouseenter', light);
        g.addEventListener('mouseleave', dark);
        g.addEventListener('focus', light);
        g.addEventListener('blur', dark);
    }
    svg.append(edgeLayer, nodeLayer);
    return svg;
}

function drawEdge(e: FEdge, x1: number, y1: number, x2: number, y2: number): SVGElement {
    const dx = Math.max(GAP_X / 2, (x2 - x1) / 2);
    const cls = ['edge', `edge-${e.tone || 'none'}`];
    if (e.dashed) cls.push('edge-dashed');
    const path = svgEl('path', { d: `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`, class: cls.join(' ') });
    if (e.title) path.append(title(e.title));
    return path;
}

function drawNode(n: FNode, x: number, y: number): SVGElement {
    const cls = ['fnode', `fnode-${n.type}`, `tone-${n.tone || 'none'}`];
    if (n.missing) cls.push('missing');
    const g = svgEl('g', { class: cls.join(' '), transform: `translate(${x},${y})` });
    g.append(svgEl('rect', { class: 'fnode-box', width: NODE_W, height: NODE_H, rx: 9 }));
    g.append(svgEl('rect', { class: 'fnode-bar', x: 5, y: 9, width: 3, height: NODE_H - 18, rx: 1.5 }));
    const badgeW = n.badge ? n.badge.length * 6 + 12 : 0;
    g.append(text(16, 17, 'fnode-kicker', truncate(n.kicker.toUpperCase(), Math.floor((NODE_W - 36 - badgeW) / 6.3))));
    g.append(text(16, 34, 'fnode-label', n.type === 'sync' && n.via === 'agent' ? truncatePath(n.label, 26) : truncate(n.label, 25)));
    g.append(text(16, 47.5, 'fnode-sub', n.type === 'sync' ? truncatePath(n.sub, 32) : truncate(n.sub, 32)));
    if (n.badge) {
        const bx = NODE_W - badgeW - 22;
        g.append(svgEl('g', { class: `fnode-badge ${n.badge.toLowerCase()}`, transform: `translate(${bx},7)` }, svgEl('rect', { width: badgeW, height: 14, rx: 4 }), text(badgeW / 2, 10.3, '', n.badge, { 'text-anchor': 'middle' })));
    }
    g.append(svgEl('circle', { class: 'fnode-dot', cx: NODE_W - 12, cy: 14, r: 4 }));
    const hint = n.clusterId ? 'Click to open it in Servers.' : n.ref ? 'Click to open it.' : '';
    g.append(title(`${n.title}${hint ? `\n\n${hint}` : ''}`));
    return g;
}

/** The key under the graph. */
export function legend(): HTMLElement {
    const line = (cls: string) => {
        const s = svgEl('svg', { width: 34, height: 10, viewBox: '0 0 34 10', 'aria-hidden': 'true' });
        s.append(svgEl('path', { d: 'M1,5 L33,5', class: `edge ${cls}` }));
        return s;
    };
    const item = (node: Node, words: string) => el('span', { class: 'legend-item' }, node, words);
    return el(
        'div',
        { class: 'map-legend' },
        item(line('edge-ok'), 'working'),
        item(line('edge-warn'), 'stale or expiring'),
        item(line('edge-error'), 'failing'),
        item(el('span', { class: 'legend-box dashed' }), 'a Kubernetes Secret, by name only: never read'),
        el('span', { class: 'legend-item faint' }, 'Hover a box to follow its secrets; click to open it.'),
    );
}
