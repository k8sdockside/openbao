// The secret flow: who gets what, from which server, through what.
//
// The filters narrow whole chains, never single boxes, so "search for the
// web Deployment" still shows the server, the login and the Secret in front
// of it. They are remembered per cluster; the dashboard's links set one of
// them before opening this view.

import { buildFlow, filterFlow, flowCounts, layoutFlow, VIA_WORDS, VIAS, type FlowFilter, type Via } from '../model/flow.js';
import { plural } from '../model/units.js';
import { byId, el, replace } from '../ui/dom.js';
import { drawFlow, legend } from '../ui/flow.js';
import { load } from '../ui/load.js';
import { every, fingerprint, openOn, remember, start, wanted } from '../ui/page.js';
import { heading, nothing } from '../ui/parts.js';
import type { World } from '../model/world.js';

const REFRESH = 20_000;

interface Saved {
    namespace: string;
    vias: Via[];
    problemsOnly: boolean;
    search: string;
    server: string;
}

start('page', async (ctx) => {
    const head = byId('head');
    const body = byId('body');
    const failure = el('p', { class: 'refresh-failure' });
    const note = `Which workloads get secrets from which server, and how, in ${ctx.contextName}. Secrets appear by name only: this page cannot read them.`;
    replace(head, heading('flow', 'Secret flow', note));

    const saved: Saved = { namespace: '', vias: [], problemsOnly: false, search: '', server: '', ...((await remember.get<Saved>('flow.filters')) ?? {}) };
    const focus = await wanted('flow');
    if (focus.via && (VIAS as string[]).includes(focus.via)) Object.assign(saved, { vias: [focus.via as Via], problemsOnly: false, server: '' });
    if (focus.problems) Object.assign(saved, { problemsOnly: true, vias: [], server: '' });
    if (focus.server) Object.assign(saved, { server: focus.server, vias: [], problemsOnly: false });
    if (focus.search) Object.assign(saved, { search: focus.search, vias: [], problemsOnly: false, server: '', namespace: '' });

    let world: World | null = null;
    let last = '';

    const ns = el('select', { 'aria-label': 'Namespace' });
    const server = el('select', { 'aria-label': 'Server' });
    const search = el('input', { type: 'search', placeholder: 'Search names and paths', 'aria-label': 'Search', value: saved.search, spellcheck: 'false' });
    const problems = el('input', { type: 'checkbox', id: 'only-problems', checked: saved.problemsOnly });
    const toggles = el('span', { class: 'toggles', role: 'group', 'aria-label': 'How secrets arrive' });
    const counts = el('span', { class: 'count' });
    const bar = el('div', { class: 'bar' }, ns, server, toggles, search, el('label', { class: 'check', for: 'only-problems' }, problems, 'Only problems'), el('span', { class: 'spacer' }), counts);
    const canvas = el('div', { class: 'map-scroll' });

    const save = () => void remember.set('flow.filters', saved);
    ns.addEventListener('change', () => {
        saved.namespace = ns.value;
        save();
        draw();
    });
    server.addEventListener('change', () => {
        saved.server = server.value;
        save();
        draw();
    });
    let typing: ReturnType<typeof setTimeout> | undefined;
    search.addEventListener('input', () => {
        clearTimeout(typing);
        typing = setTimeout(() => {
            saved.search = search.value;
            save();
            draw();
        }, 150);
    });
    problems.addEventListener('change', () => {
        saved.problemsOnly = problems.checked;
        save();
        draw();
    });

    function options(sel: HTMLSelectElement, values: [string, string][], current: string) {
        replace(sel, ...values.map(([v, label]) => el('option', { value: v, selected: v === current }, label)));
        sel.value = values.some(([v]) => v === current) ? current : '';
    }

    function draw() {
        if (!world) return;
        const full = buildFlow(world);
        const namespaces = [...new Set(full.nodes.filter((n) => n.type === 'sync').map((n) => n.namespace ?? ''))].filter(Boolean).sort();
        options(ns, [['', 'All namespaces'], ...namespaces.map((n): [string, string] => [n, n])], saved.namespace);
        options(server, [['', 'All servers'], ...world.clusters.map((c): [string, string] => [c.id, `${c.namespace}/${c.name}`])], saved.server);
        saved.namespace = ns.value;
        saved.server = server.value;

        // The ways in, as toggles, with how many chains each has.
        replace(toggles);
        for (const via of VIAS) {
            const n = full.nodes.filter((x) => x.type === 'sync' && x.via === via).length;
            if (!n && !saved.vias.includes(via)) continue;
            const on = saved.vias.includes(via);
            const t = el('button', { type: 'button', class: `toggle${on ? ' on' : ''}`, 'aria-pressed': on ? 'true' : 'false', title: on ? `Showing ${VIA_WORDS[via]} only; click to show everything` : `Show ${VIA_WORDS[via]} only` }, VIA_WORDS[via], el('span', { class: 'toggle-n' }, String(n)));
            t.addEventListener('click', () => {
                saved.vias = on ? saved.vias.filter((v) => v !== via) : [...saved.vias, via];
                save();
                draw();
            });
            toggles.append(t);
        }

        const filter: FlowFilter = { namespace: saved.namespace, vias: saved.vias, problemsOnly: saved.problemsOnly, search: saved.search, server: saved.server };
        const graph = filterFlow(full, filter);
        const c = flowCounts(graph);
        counts.textContent = `${plural(c.servers, 'server')} · ${plural(c.syncs, 'sync', 'syncs')} · ${plural(c.secrets, 'Secret')} · ${plural(c.workloads, 'workload')}`;

        if (graph.nodes.length === 0) {
            const filtered = saved.namespace || saved.vias.length || saved.search || saved.problemsOnly || saved.server;
            const reset = el('button', { type: 'button' }, 'Clear the filters');
            reset.addEventListener('click', () => {
                Object.assign(saved, { namespace: '', vias: [], problemsOnly: false, search: '', server: '' });
                search.value = '';
                problems.checked = false;
                save();
                draw();
            });
            replace(
                canvas,
                filtered
                    ? el('div', { class: 'empty-state' }, nothing(saved.problemsOnly && !saved.search ? 'No problems anywhere along the way: everything drawn would be healthy.' : 'Nothing matches the filters.'), reset)
                    : nothing('Nothing in this cluster fetches secrets from OpenBao or Vault yet: no Secrets Operator objects, no injected pods, no External Secrets store or CSI class using them.'),
            );
            return;
        }
        replace(canvas, drawFlow(graph, layoutFlow(graph), { onServer: (id) => void openOn('cluster', { namespace: id.split('/')[0] ?? '', name: id.split('/')[1] ?? '' }) }));
    }

    const stop = every(
        REFRESH,
        async () => {
            const loaded = await load();
            failure.textContent = '';
            document.getElementById('first')?.remove();
            const print = fingerprint(loaded.snap);
            if (print === last) return;
            last = print;
            world = loaded.world;
            const bad = world.items.filter((i) => i.tone === 'error').length + world.externals.filter((e) => e.tone === 'error').length;
            replace(head, heading('flow', 'Secret flow', note, { flow: bad }));
            if (!body.contains(canvas)) replace(body, failure, bar, canvas, legend());
            draw();
        },
        (err) => {
            failure.textContent = err instanceof Error ? err.message : String(err);
        },
    );
    addEventListener('pagehide', stop);
});
