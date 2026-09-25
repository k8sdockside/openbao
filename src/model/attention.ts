// What needs a person, worst first.
//
// Ordered by what it costs if left: a sealed or uninitialised server stops
// every client at once; a cluster with no leader, the same; then broken
// syncs, which starve one workload each; then the things that will break
// later -- an injector that is down (new pods cannot start), certificates
// and leases running out, versions drifting apart, a pod not ready.

import { productName } from './product.js';
import type { Tone } from './types.js';
import { plural, rank, relative } from './units.js';
import { SYNC_KIND_WORDS } from './vso.js';
import type { World } from './world.js';

export interface Issue {
    tone: Tone;
    /** Lower is more urgent within a tone. */
    order: number;
    title: string;
    detail: string;
    ref: K8sDockside.OpenRef;
    /** A view of this plugin that shows it better, with the object to focus. */
    view?: { id: string; namespace: string; name: string };
}

export function issues(world: World): Issue[] {
    const out: Issue[] = [];
    const now = world.now;

    for (const c of world.clusters) {
        const view = { id: 'cluster', namespace: c.namespace, name: c.name };
        const product = productName(c.product);
        if (c.lock === 'uninitialized') {
            out.push({ tone: 'error', order: 0, title: `${c.name} is not initialised`, detail: `${product} in ${c.namespace} has never been initialised: run ${c.cli} operator init once, and keep the keys it prints somewhere safe.`, ref: c.ref, view });
            continue;
        }
        const sealed = c.nodes.filter((n) => n.role === 'sealed');
        if (sealed.length > 0) {
            const all = sealed.length === c.nodes.length;
            const keys = c.seal.auto ? `its ${c.seal.type} auto-unseal should unseal it` : c.seal.t ? `any ${c.seal.t} of its ${c.seal.n ?? '?'} key shares unseal ${sealed.length === 1 ? 'it' : 'each'}` : 'enter the unseal keys';
            for (const n of sealed) {
                out.push({
                    tone: 'error',
                    order: all ? 0 : 1,
                    title: `${n.name} is sealed`,
                    detail: `${all ? `Every node of ${c.name} is sealed` : `${sealed.length} of ${c.nodes.length} nodes in ${c.name} ${sealed.length === 1 ? 'is' : 'are'} sealed`}: ${keys}.`,
                    ref: n.ref,
                    view,
                });
            }
        }
        if (c.nodes.length > 1 && c.lock !== 'closed' && c.lock !== 'unknown' && !c.nodes.some((n) => n.role === 'active') && c.ha !== false) {
            out.push({ tone: 'error', order: 1, title: `${c.name} has no active leader`, detail: 'No node says it is active, so requests have nowhere to go.', ref: c.ref, view });
        }
        for (const n of c.nodes) {
            if (n.role === 'down') out.push({ tone: 'error', order: 2, title: `${n.name} is not running`, detail: `Pod phase ${n.phase}.`, ref: n.ref, view });
            else if (!n.ready && n.role !== 'sealed' && n.role !== 'uninitialized') out.push({ tone: 'warn', order: 6, title: `${n.name} is not ready`, detail: `${n.words}${n.restarts ? `, ${plural(n.restarts, 'restart')}` : ''}.`, ref: n.ref, view });
        }
        if (c.nodes.length === 0) out.push({ tone: 'error', order: 2, title: `${c.name} has no pods`, detail: `The StatefulSet asks for ${c.desired ?? 0} and none is there.`, ref: c.ref, view });
        if (c.drift) out.push({ tone: 'warn', order: 7, title: `${c.name} runs mixed versions`, detail: c.versions.join(', '), ref: c.ref, view });
    }

    for (const item of world.items) {
        const title = `${SYNC_KIND_WORDS[item.kind]} ${item.namespace}/${item.name}`;
        if (item.health === 'failing') {
            out.push({ tone: 'error', order: item.expires !== undefined && item.expires <= now ? 3 : 4, title: `${title}: ${item.words}`, detail: item.message ?? `Nothing is reaching Secret ${item.destination}.`, ref: item.ref });
        } else if (item.health === 'stale') {
            out.push({ tone: 'warn', order: item.expires !== undefined ? 5 : 6, title: `${title}: ${item.words}`, detail: item.message ?? `Secret ${item.destination} may be out of date.`, ref: item.ref });
        }
    }
    for (const a of world.auths) {
        if (a.valid === false) out.push({ tone: 'error', order: 4, title: `VaultAuth ${a.namespace}/${a.name} is invalid`, detail: a.error ?? 'Every secret that logs in through it fails.', ref: a.ref });
    }
    for (const e of world.externals) {
        if (e.tone === 'error') out.push({ tone: 'error', order: 4, title: `ExternalSecret ${e.namespace}/${e.name}: ${e.words}`, detail: e.message ?? `Secret ${e.target} is not being written.`, ref: e.ref });
    }
    for (const s of world.stores) {
        if (s.tone === 'error') out.push({ tone: 'error', order: 4, title: `${s.kind} ${s.namespace ? `${s.namespace}/` : ''}${s.name}: ${s.words}`, detail: s.message ?? 'The store cannot reach its server.', ref: s.ref });
    }

    for (const i of world.injectors) {
        if (i.tone === 'error') out.push({ tone: 'error', order: 3, title: `Agent injector ${i.name} is down`, detail: `No pod asking for the agent can be ${i.failurePolicy === 'Fail' ? 'created' : 'given one'} until it is back.`, ref: i.ref });
        else if (i.tone === 'warn') out.push({ tone: 'warn', order: 6, title: `Agent injector ${i.name}: ${i.words}`, detail: `${i.ready} of ${i.desired} replicas ready.`, ref: i.ref });
    }
    for (const p of world.injected) {
        if (p.tone === 'ok') continue;
        out.push({ tone: p.tone, order: p.tone === 'error' ? 4 : 6, title: `Pod ${p.namespace}/${p.name}: ${p.words}`, detail: p.injection.injected ? `Role ${p.injection.role ?? '—'}; ${plural(p.injection.secrets.length, 'secret')} to render.` : 'It has the annotation, but the webhook did not add the agent: the injector was down or does not watch its namespace.', ref: p.ref });
    }

    return out.sort((a, b) => rank(b.tone) - rank(a.tone) || a.order - b.order || a.title.localeCompare(b.title));
}

/** A line for the soonest expiry, for the dashboard's tile. */
export function soonest(world: World): { words: string; ref?: K8sDockside.ObjectRef } {
    const next = world.items.filter((i) => i.expires !== undefined).sort((a, b) => (a.expires ?? 0) - (b.expires ?? 0))[0];
    if (!next || next.expires === undefined) return { words: '' };
    return { words: `${next.name} ${next.expires <= world.now ? 'expired' : 'expires'} ${relative(next.expires, world.now)}`, ref: next.ref };
}
