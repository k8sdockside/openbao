// A server cluster's shape: a glyph the size of a thumbnail for the
// dashboard's cards, and the full picture for the Servers view.
//
// Both use one vocabulary, so reading one teaches the other:
//
//   the leader            the big filled green node
//   a standby             a green ring: unsealed, ready to take over
//   a performance standby a dashed ring in the accent colour
//   a sealed node         filled red, with a small lock in it
//   not initialised       a dashed amber ring
//   not running           a dashed red ring
//
// Colours come from classes in the stylesheet, which are theme tokens, and
// every label is a text node.

import type { ServerCluster, ServerNode } from '../model/servers.js';
import { productName } from '../model/product.js';
import { el, svgEl } from './dom.js';
import { padlock } from './lock.js';
import { clickable } from './parts.js';

function title(value: string): SVGElement {
    const t = svgEl('title');
    t.textContent = value;
    return t;
}

function text(x: number, y: number, cls: string, value: string, anchor = 'start'): SVGElement {
    const t = svgEl('text', { x, y, class: cls, 'text-anchor': anchor });
    t.textContent = value;
    return t;
}

function nodeTip(n: ServerNode): string {
    const bits = [`${n.name}: ${n.words}${n.leader ? ', the leader' : ''}`, n.ready ? 'ready' : 'not ready'];
    if (n.version) bits.push(`version ${n.version}`);
    if (n.nodeName) bits.push(`on ${n.nodeName}${n.zone ? ` in ${n.zone}` : ''}`);
    if (n.source === 'none') bits.push('seal state unknown: no service-registration labels');
    return bits.join(' · ');
}

/** A tiny lock drawn inside a sealed node. */
function miniLock(cx: number, cy: number, r: number): SVGElement {
    const s = r / 8;
    const g = svgEl('g', { class: 'tnode-lock', transform: `translate(${cx - 4 * s},${cy - 5 * s}) scale(${s})` });
    g.append(svgEl('path', { d: 'M2 4.5 V3 a2 2 0 0 1 4 0 V4.5', fill: 'none' }));
    g.append(svgEl('rect', { x: 0.8, y: 4.4, width: 6.4, height: 5, rx: 1.2 }));
    return g;
}

function circle(n: ServerNode, cx: number, cy: number, r: number): SVGElement {
    const g = svgEl('g', { class: `tnode role-${n.role}${n.ready ? '' : ' not-ready'}` });
    g.append(title(nodeTip(n)));
    g.append(svgEl('circle', { cx: cx.toFixed(1), cy: cy.toFixed(1), r }));
    if (n.role === 'sealed' && r >= 7) g.append(miniLock(cx, cy, r));
    return g;
}

/** The thumbnail: the leader on the left, the other nodes stacked on the right. */
export function miniTopology(cluster: ServerCluster, width = 116, height = 72): SVGElement {
    const svg = svgEl('svg', { viewBox: `0 0 ${width} ${height}`, class: 'topo-mini', role: 'img', width, height });
    svg.append(title(`${productName(cluster.product)} ${cluster.name}: ${cluster.nodes.map((n) => `${n.name} ${n.words}`).join(', ') || 'no pods'}`));
    const leader = cluster.nodes.find((n) => n.role === 'active') ?? (cluster.nodes.length === 1 ? cluster.nodes[0] : undefined);
    const others = cluster.nodes.filter((n) => n !== leader);
    const lx = others.length ? 28 : width / 2;
    const ly = height / 2;
    const lr = 14;
    const shown = others.slice(0, 4);
    const rx = width - 20;
    const rr = 9;
    const gap = shown.length > 1 ? Math.min(21, (height - 20) / (shown.length - 1)) : 0;
    const top = ly - (gap * (shown.length - 1)) / 2;

    shown.forEach((n, i) => {
        const y = top + i * gap;
        if (leader) {
            const dx = rx - lx;
            const dy = y - ly;
            const len = Math.hypot(dx, dy) || 1;
            svg.append(svgEl('line', { class: `tlink${n.role === 'sealed' || n.role === 'down' ? ' tlink-broken' : ''}`, x1: (lx + (dx / len) * lr).toFixed(1), y1: (ly + (dy / len) * lr).toFixed(1), x2: (rx - (dx / len) * rr).toFixed(1), y2: (y - (dy / len) * rr).toFixed(1) }));
        }
        svg.append(circle(n, rx, y, rr));
    });
    if (leader) svg.append(circle(leader, lx, ly, lr));
    else if (cluster.nodes.length > 1) {
        // No leader: an empty place where one should be.
        svg.append(svgEl('circle', { class: 'tnode-ghost', cx: lx, cy: ly, r: lr }));
    }
    if (cluster.nodes.length === 0) svg.append(text(width / 2, ly + 4, 'topo-none', 'no pods', 'middle'));
    if (others.length > shown.length) svg.append(text(rx, height - 1, 'topo-more', `+${others.length - shown.length}`, 'middle'));
    return svg;
}

const CARD_W = 214;
const CARD_H = 116;
const GAP = 22;

function card(n: ServerNode, x: number, y: number, onPick: (n: ServerNode) => void, current?: string): SVGElement {
    const g = svgEl('g', { class: `tcard role-${n.role}${n.leader ? ' leader' : ''}`, transform: `translate(${x},${y})` });
    g.append(title(`${nodeTip(n)}\n\nClick to open the pod.`));
    g.append(svgEl('rect', { class: 'tcard-box', width: CARD_W, height: CARD_H, rx: 12 }));
    g.append(svgEl('rect', { class: 'tcard-bar', x: 0, y: 12, width: 4, height: CARD_H - 24, rx: 2 }));
    const lock = padlock(n.role === 'sealed' ? 'closed' : n.role === 'uninitialized' ? 'uninitialized' : n.sealed === false ? 'open' : 'unknown', 30);
    lock.setAttribute('x', '14');
    lock.setAttribute('y', '12');
    g.append(lock);
    g.append(text(52, 27, 'tcard-name', n.name.length > 20 ? `${n.name.slice(0, 19)}…` : n.name));
    g.append(text(52, 44, `tcard-role tone-${n.tone || 'none'}`, n.words));
    if (n.leader) {
        g.append(svgEl('rect', { class: 'tcard-tag', x: CARD_W - 64, y: 10, width: 54, height: 17, rx: 8.5 }));
        g.append(text(CARD_W - 37, 22, 'tcard-tag-text', 'LEADER', 'middle'));
    }
    const ready = `${n.ready ? 'ready' : 'not ready'}${n.restarts ? ` · ${n.restarts} restart${n.restarts === 1 ? '' : 's'}` : ''}`;
    g.append(text(16, 70, `tcard-line${n.ready ? '' : ' tone-warn'}`, ready));
    const where = [n.nodeName, n.zone].filter(Boolean).join(' · ');
    g.append(text(16, 87, 'tcard-line faint', where.length > 32 ? `${where.slice(0, 31)}…` : where || 'not scheduled'));
    const behind = !!current && !!n.version && n.version !== current;
    g.append(text(16, 104, `tcard-line ${behind ? 'tone-warn' : 'faint'}`, n.version ? `v${n.version}${behind ? `, not ${current}` : ''}` : 'version unknown'));
    if (n.source === 'api') g.append(text(CARD_W - 12, 104, 'tcard-src', 'from the API', 'end'));
    clickable(g as unknown as HTMLElement, () => onPick(n), `Open pod ${n.name}`);
    return g;
}

/**
 * The full picture: the leader on top, the rest in a row under it, each a
 * card with its lock, its role, its readiness, where it runs and its version.
 */
export function bigTopology(cluster: ServerCluster, onPick: (n: ServerNode) => void): HTMLElement {
    const leader = cluster.nodes.find((n) => n.role === 'active');
    const rest = cluster.nodes.filter((n) => n !== leader);
    const perRow = Math.max(1, rest.length);
    const rowW = perRow * CARD_W + (perRow - 1) * GAP;
    const width = Math.max(rowW, CARD_W) + 8;
    const top = 4;
    const second = leader ? top + CARD_H + 56 : top;
    const height = (rest.length ? second + CARD_H : top + CARD_H) + 6;
    const svg = svgEl('svg', { viewBox: `-4 0 ${width} ${height}`, width, height, class: 'topo-big', role: 'img' });
    svg.append(title(`${productName(cluster.product)} ${cluster.name}`));
    const x0 = (width - 8 - rowW) / 2;
    const lxCard = (width - 8 - CARD_W) / 2;
    const links = svgEl('g', { class: 'tlinks' });
    svg.append(links);
    rest.forEach((n, i) => {
        const x = x0 + i * (CARD_W + GAP);
        if (leader) {
            const x1 = lxCard + CARD_W / 2;
            const y1 = top + CARD_H;
            const x2 = x + CARD_W / 2;
            const y2 = second;
            const mid = (y1 + y2) / 2;
            links.append(svgEl('path', { class: `tlink${n.role === 'sealed' || n.role === 'down' ? ' tlink-broken' : ''}`, d: `M${x1},${y1} C${x1},${mid} ${x2},${mid} ${x2},${y2}` }));
        }
        svg.append(card(n, x, second, onPick, cluster.drift ? cluster.version : undefined));
    });
    if (leader) {
        svg.append(card(leader, lxCard, top, onPick, cluster.drift ? cluster.version : undefined));
        if (rest.length) svg.append(text(lxCard + CARD_W + 12, top + CARD_H + 30, 'tlink-label', cluster.storage === 'raft' ? 'raft replication' : 'standbys', 'start'));
    }
    return el('div', { class: 'topo-holder' }, svg);
}
