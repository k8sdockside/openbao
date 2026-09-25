// The padlock and the key slots: the two drawings that say "sealed" or
// "unsealed" before a word is read.
//
//   open, green          every node unsealed
//   open, amber, badge   serving, but some nodes are sealed -- the badge
//                        counts them
//   closed, red          nothing unsealed: no secret can be read
//   closed, "?"          not initialised: there is nothing to unseal yet
//   dashed               the plugin cannot tell
//
// The key slots are the seal's shares: n dots, the t that unseal it ringed,
// and on a sealed node the shares entered so far filled in. The drawing is
// all there is to it -- the plugin never sees, asks for or passes on a key.

import type { Lock, SealFacts } from '../model/servers.js';
import { plural } from '../model/units.js';
import { el, svgEl } from './dom.js';

const LOCK_TONE: Record<Lock, string> = { open: 'ok', partial: 'warn', closed: 'error', uninitialized: 'warn', unknown: 'none' };

export const LOCK_WORDS: Record<Lock, string> = {
    open: 'Unsealed',
    partial: 'Partly sealed',
    closed: 'Sealed',
    uninitialized: 'Not initialised',
    unknown: 'Seal state unknown',
};

function title(text: string): SVGElement {
    const t = svgEl('title');
    t.textContent = text;
    return t;
}

function text(x: number, y: number, cls: string, value: string): SVGElement {
    const t = svgEl('text', { x, y, class: cls, 'text-anchor': 'middle' });
    t.textContent = value;
    return t;
}

/** The padlock for a cluster, `size` pixels square. */
export function padlock(lock: Lock, size = 64, sealedCount = 0, label = ''): SVGElement {
    const open = lock === 'open' || lock === 'partial';
    const svg = svgEl('svg', { viewBox: '0 0 64 64', width: size, height: size, class: `padlock lock-${lock} tone-${LOCK_TONE[lock]}`, role: 'img' });
    svg.append(title(label || LOCK_WORDS[lock]));
    // The shackle: down into the body on both sides when closed; lifted, and
    // clear of the body on the right, when open.
    svg.append(svgEl('path', { class: 'lock-shackle', d: open ? 'M20 28 V17 a11.5 11.5 0 0 1 22.6 -3.2' : 'M20 28 V20 a12 12 0 0 1 24 0 V28' }));
    svg.append(svgEl('rect', { class: 'lock-body', x: 11, y: 27, width: 42, height: 31, rx: 8 }));
    if (lock === 'uninitialized') {
        svg.append(text(32, 50, 'lock-mark', '?'));
    } else if (lock === 'unknown') {
        svg.append(text(32, 49.5, 'lock-mark', '–'));
    } else {
        svg.append(svgEl('circle', { class: 'lock-hole', cx: 32, cy: 40, r: 4.4 }));
        svg.append(svgEl('path', { class: 'lock-hole', d: 'M30.2 42 h3.6 l1 8 h-5.6 z' }));
    }
    if (lock === 'partial' && sealedCount > 0) {
        svg.append(svgEl('circle', { class: 'lock-badge', cx: 52, cy: 26, r: 9.5 }));
        svg.append(text(52, 30.2, 'lock-badge-text', String(sealedCount)));
    }
    return svg;
}

/** The seal's key shares as dots, with a line saying what they mean. */
export function keySlots(seal: SealFacts, sealedNow: boolean, uninitialized = false): HTMLElement {
    const wrap = el('div', { class: 'keys' });
    const n = seal.n ?? 0;
    const t = seal.t ?? 0;
    if (seal.auto) {
        wrap.append(
            el('div', { class: 'keys-auto' }, el('span', { class: 'keys-auto-mark', 'aria-hidden': 'true' }, 'A'), el('span', {}, `Auto-unseal: ${seal.type}`)),
            el('div', { class: 'keys-words' }, n ? `Recovery keys: ${t} of ${n}` : 'No unseal keys to enter'),
        );
        return wrap;
    }
    if (!n || !t) {
        wrap.append(el('div', { class: 'keys-words faint' }, uninitialized ? 'No key shares yet: they are made when it is initialised.' : 'Key shares unknown: the API did not say.'));
        return wrap;
    }
    const progress = Math.min(seal.progress ?? 0, t);
    const gap = 19;
    const width = n * gap + 2;
    const svg = svgEl('svg', { viewBox: `0 0 ${width} 20`, width, height: 20, class: 'key-row', role: 'img' });
    for (let i = 0; i < n; i++) {
        let cls = 'key-slot';
        if (i < t) cls += ' key-needed';
        if (sealedNow ? i < progress : i < t) cls += sealedNow ? ' key-entered' : ' key-used';
        svg.append(svgEl('circle', { class: cls, cx: 10 + i * gap, cy: 10, r: 7 }));
    }
    const words = sealedNow
        ? `${progress} of ${t} keys entered${seal.progressNode ? ` on ${seal.progressNode}` : ''}`
        : `${plural(t, 'key')} of ${n} unseal it`;
    svg.append(title(sealedNow ? `${words}. ${t - progress} more to unseal.` : `Shamir seal: any ${t} of the ${n} key shares unseal a node.`));
    wrap.append(svg, el('div', { class: 'keys-words' }, words));
    return wrap;
}
