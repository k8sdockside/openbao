// The dashboard: every OpenBao and Vault server at a glance, and what needs
// a person.
//
//   Can anything read a secret?   one card per server cluster: a padlock,
//                                 open or shut; the unseal keys as slots;
//                                 the cluster's shape with its leader
//   Are the clients getting them? tiles for the Secrets Operator's syncs,
//                                 and a line per way secrets reach pods
//   What needs me?                the attention list, worst first, each row
//                                 opening the object it is about
//   How is it doing?              the servers' own metrics from Prometheus,
//                                 when there is one

import { issues, soonest, type Issue } from '../model/attention.js';
import { VIA_WORDS } from '../model/flow.js';
import { healthStanding } from '../model/api.js';
import { productName } from '../model/product.js';
import type { ServerCluster } from '../model/servers.js';
import { plural } from '../model/units.js';
import type { World } from '../model/world.js';
import { byId, el, replace } from '../ui/dom.js';
import { load } from '../ui/load.js';
import { keySlots, padlock } from '../ui/lock.js';
import { every, fingerprint, openOn, start } from '../ui/page.js';
import { block, clickable, dot, footLink, formatValue, heading, linkButton, nothing, pill, productBadge, sparkline, tile, toneVar } from '../ui/parts.js';
import { miniTopology } from '../ui/topology.js';

const REFRESH = 20_000;

start('page', async (ctx) => {
    const head = byId('head');
    const body = byId('body');
    const failure = el('p', { class: 'refresh-failure' });
    const note = `Seal state, leaders and who gets which secrets, in ${ctx.contextName}.`;
    replace(head, heading('overview', 'OpenBao & Vault', note));
    let last = '';

    const stop = every(
        REFRESH,
        async () => {
            const [{ snap, world }, charts] = await Promise.all([load({ api: true }), k8sdockside.charts({ minutes: 60 }).catch(() => null)]);
            failure.textContent = '';
            document.getElementById('first')?.remove();
            const print = fingerprint([snap, charts?.charts.map((c) => c.series.map((s) => s.points.length))]);
            if (print === last) return;
            last = print;
            const problems = issues(world);
            const sealed = world.clusters.reduce((n, c) => n + c.counts.sealed + (c.lock === 'uninitialized' ? 1 : 0), 0);
            const failing = world.items.filter((i) => i.tone === 'error').length + world.externals.filter((e) => e.tone === 'error').length;
            const expiring = world.items.filter((i) => i.expires !== undefined && i.tone !== 'ok').length;
            replace(head, heading('overview', 'OpenBao & Vault', note, { cluster: sealed, flow: failing, expiry: expiring }));
            replace(body, failure, ...draw(world, problems, charts, ctx));
        },
        (err) => {
            failure.textContent = err instanceof Error ? err.message : String(err);
        },
    );
    addEventListener('pagehide', stop);
});

function draw(world: World, problems: Issue[], charts: K8sDockside.ChartsPanel | null, ctx: K8sDockside.Context): (Node | null)[] {
    if (!world.anything) return [notHere(ctx)];
    return [
        tiles(world),
        world.clusters.length ? el('div', { class: 'cards' }, ...world.clusters.map((c) => card(c))) : block('Servers', '', nothing('No OpenBao or Vault server runs in this cluster. The clients below talk to one outside it.')),
        attention(problems),
        clients(world),
        chartBlock(charts),
    ];
}

function tiles(world: World): HTMLElement {
    const nodes = world.clusters.flatMap((c) => c.nodes);
    const ready = nodes.filter((n) => n.ready).length;
    const sealed = nodes.filter((n) => n.role === 'sealed');
    const uninit = world.clusters.filter((c) => c.lock === 'uninitialized').length;
    const syncs = [...world.items.map((i) => i.tone), ...world.externals.map((e) => e.tone)];
    const inSync = syncs.filter((t) => t === 'ok').length;
    const failing = syncs.filter((t) => t === 'error').length;
    const stale = syncs.filter((t) => t === 'warn').length;
    const next = soonest(world);
    return el(
        'div',
        { class: 'tiles' },
        tile({
            label: 'Servers ready',
            value: nodes.length ? `${ready} / ${nodes.length}` : '—',
            tone: nodes.length && ready < nodes.length ? 'warn' : '',
            note: world.clusters.length ? `in ${plural(world.clusters.length, 'cluster')}${uninit ? `, ${uninit} not initialised` : ''}` : 'none in this cluster',
            noteTone: uninit ? 'error' : '',
            onPick: () => void k8sdockside.openView('cluster'),
        }),
        tile({
            label: 'Sealed nodes',
            value: String(sealed.length),
            tone: sealed.length ? 'error' : nodes.length ? 'ok' : '',
            note: sealed.length ? sealed.map((n) => n.name).slice(0, 3).join(', ') : nodes.length ? 'every node unsealed' : '—',
            onPick: sealed[0] ? () => void openOn('cluster', { namespace: sealed[0]?.namespace ?? '', name: world.clusters.find((c) => c.nodes.includes(sealed[0] as never))?.name ?? '' }) : undefined,
        }),
        tile({
            label: 'Secrets in sync',
            value: syncs.length ? `${inSync} / ${syncs.length}` : '—',
            tone: syncs.length && inSync === syncs.length ? 'ok' : '',
            note: syncs.length ? (stale ? `${stale} stale or expiring` : next.words || 'synced by the operators') : world.served.vso ? 'no VaultStaticSecret, dynamic or PKI secret yet' : 'the Secrets Operator is not installed',
            noteTone: stale ? 'warn' : '',
            onPick: () => void k8sdockside.openView('flow'),
        }),
        tile({
            label: 'Failing syncs',
            value: String(failing),
            tone: failing ? 'error' : syncs.length ? 'ok' : '',
            note: failing ? 'nothing reaches their Secrets' : syncs.length ? 'none' : '—',
            onPick: failing ? () => void openOn('flow', { problems: 'true' }) : undefined,
        }),
    );
}

/** One server cluster: a padlock, its shape, its keys, and a sentence. */
function card(c: ServerCluster): HTMLElement {
    const open = () => void openOn('cluster', { namespace: c.namespace, name: c.name });
    const sealedNow = c.lock === 'closed' || c.lock === 'partial' || c.lock === 'uninitialized';
    const name = el('button', { type: 'button', class: 'card-name', title: 'Open in Servers' }, c.name);
    name.addEventListener('click', open);

    const lock = el('div', { class: 'card-lock' }, padlock(c.lock, 60, c.counts.sealed));
    clickable(lock, open, `${c.name}: ${c.words}`);
    const shape = el('div', { class: 'card-shape', title: 'Open in Servers' }, miniTopology(c));
    clickable(shape, open, `The nodes of ${c.name}`);

    const leader = c.nodes.find((n) => n.role === 'active');
    const api = c.active?.service ?? c.main?.service;
    const standing = c.main?.healthCode ? ` (the node behind it is ${healthStanding(c.main.healthCode)})` : '';
    const node = el(
        'article',
        { class: 'card' },
        el(
            'div',
            { class: 'card-top' },
            lock,
            el(
                'div',
                { class: 'card-id' },
                el('div', { class: 'card-title' }, name, el('span', { class: 'card-ns' }, c.namespace), productBadge(c.product)),
                el('div', { class: 'card-state' }, pill(c.words, c.tone), c.version ? el('span', { class: 'faint' }, `v${c.version}`) : null, c.storage ? el('span', { class: 'faint' }, `${c.storage} storage`) : null),
            ),
        ),
        el('p', { class: 'card-sentence' }, c.sentence),
        el('div', { class: 'card-mid' }, shape, keySlots(c.seal, sealedNow && c.lock !== 'uninitialized', c.lock === 'uninitialized')),
        el(
            'dl',
            { class: 'card-facts' },
            el('dt', {}, 'Nodes'),
            el('dd', {}, `${c.counts.ready} of ${c.nodes.length} ready${c.desired !== undefined && c.desired !== c.nodes.length ? `, ${c.desired} wanted` : ''}`),
            el('dt', {}, 'Leader'),
            el('dd', {}, leader ? leader.name : c.nodes.length > 1 ? el('span', { class: 'tone-error' }, 'none') : c.ha === false ? 'not HA' : '—'),
            el('dt', {}, 'API'),
            el('dd', { title: c.apiError ?? `${api ?? ''}${standing}` }, api ? el('span', {}, dot('ok'), ` ${api}`) : el('span', { class: 'faint' }, dot('warn'), c.apiError?.includes('another cluster') ? ' answered for another cluster; state from pod labels' : ' not reachable; state from pod labels')),
        ),
        el('div', { class: 'card-foot' }, footLink('Servers', open), footLink('Secret flow', () => void openOn('flow', { server: c.id })), c.clusterName ? el('span', { class: 'faint' }, c.clusterName) : null),
    );
    node.style.borderLeftColor = toneVar(c.tone);
    return node;
}

function attention(problems: Issue[]): HTMLElement {
    if (problems.length === 0) return block('Needs attention', '', nothing('Nothing. Every server is unsealed, every sync is working, and nothing is about to expire.'));
    const list = el('ul', { class: 'issues' });
    for (const issue of problems.slice(0, 30)) {
        const row = el('li', { class: 'issue' }, dot(issue.tone), el('span', { class: 'issue-title' }, issue.title), el('span', { class: 'issue-detail', title: issue.detail }, issue.detail));
        clickable(row, () => (issue.view ? void openOn(issue.view.id, { namespace: issue.view.namespace, name: issue.view.name }) : void k8sdockside.open(issue.ref)));
        list.append(row);
    }
    const errors = problems.filter((p) => p.tone === 'error').length;
    const note = `${errors ? `${plural(errors, 'problem')} to fix, worst first.` : 'Nothing is broken; these are worth knowing.'} Each row opens what it is about.`;
    return block('Needs attention', problems.length > 30 ? `The worst 30 of ${problems.length}. ${note}` : note, list);
}

/** The ways secrets reach pods, one line each. */
function clients(world: World): HTMLElement {
    const rows: HTMLElement[] = [];
    const row = (label: string, tone: string, count: string, words: string, onPick?: () => void) => {
        const r = el('li', { class: 'client' }, dot(tone as never), el('span', { class: 'client-label' }, label), el('span', { class: 'client-count' }, count), el('span', { class: 'client-words' }, words));
        if (onPick) clickable(r, onPick);
        rows.push(r);
    };
    const flow = (via: string) => () => void openOn('flow', { via });

    if (world.served.vso || world.items.length) {
        const bad = world.items.filter((i) => i.tone === 'error').length;
        const kinds = ['static', 'dynamic', 'pki'].map((k) => [k, world.items.filter((i) => i.kind === k).length] as const).filter(([, n]) => n > 0);
        row(VIA_WORDS.vso, bad ? 'error' : world.items.length ? 'ok' : '', String(world.items.length), world.items.length ? `${kinds.map(([k, n]) => `${n} ${k === 'pki' ? 'PKI' : k}`).join(', ')}${bad ? ` · ${bad} failing` : ''} · ${plural(world.auths.length, 'VaultAuth')}` : 'installed, nothing synced yet', flow('vso'));
    }
    const injectedOk = world.injected.filter((p) => p.tone === 'ok').length;
    if (world.injectors.length || world.injected.length) {
        const down = world.injectors.filter((i) => i.tone === 'error');
        const inj = world.injectors.map((i) => `${i.name} ${i.words}`).join(', ') || 'no injector found';
        row(VIA_WORDS.agent, down.length ? 'error' : world.injected.some((p) => p.tone !== 'ok') ? 'warn' : 'ok', String(world.injected.length), `${injectedOk} of ${plural(world.injected.length, 'pod')} injected · ${inj}`, flow('agent'));
    }
    if (world.stores.length) {
        const bad = world.externals.filter((e) => e.tone === 'error').length;
        row(VIA_WORDS.eso, bad ? 'error' : 'ok', String(world.externals.length), `${plural(world.stores.length, 'Vault store')}, ${plural(world.externals.length, 'ExternalSecret')}${bad ? ` · ${bad} failing` : ''}`, flow('eso'));
    }
    if (world.classes.length) {
        row(VIA_WORDS.csi, 'ok', String(world.classes.length), `${plural(world.classes.length, 'SecretProviderClass', 'SecretProviderClasses')} for ${[...new Set(world.classes.map((c) => c.provider))].join(' and ')}`, flow('csi'));
    }
    if (!rows.length) return block('Clients', '', nothing('Nothing in this cluster fetches secrets from these servers yet: no Secrets Operator objects, no injected pods, no External Secrets store or CSI class using them.'));
    return block('How secrets reach pods', 'Each line opens the secret flow, narrowed to that way.', el('ul', { class: 'clients' }, ...rows));
}

function chartBlock(panel: K8sDockside.ChartsPanel | null): HTMLElement | null {
    if (!panel || !panel.attached) return null;
    if (!panel.source.available) {
        return block('From Prometheus', 'The servers export vault_core_unsealed, vault_core_active and lease counts when telemetry is on. No Prometheus was found for this cluster, so there is nothing to chart.', el('p', { class: 'faint' }, panel.source.error || 'Set one in the cluster’s settings in the sidebar.'));
    }
    const tilesEl = el('div', { class: 'chart-tiles' });
    for (const chart of panel.charts) {
        const latest = (points: K8sDockside.ChartPoint[]) => points[points.length - 1]?.v;
        const top = [...chart.series].sort((a, b) => (latest(b.points) ?? 0) - (latest(a.points) ?? 0)).slice(0, 3);
        const legend = el('ul', { class: 'chart-legend' }, ...top.map((s, i) => el('li', {}, el('span', { class: `swatch series-${i + 1}` }), el('span', { class: 'legend-name' }, s.name.replace(/[{}"]/g, '').replace(/^namespace=/, '')), el('span', { class: 'legend-value' }, formatValue(chart.unit, latest(s.points))))));
        const empty = chart.series.length === 0;
        tilesEl.append(
            el(
                'div',
                { class: 'chart-tile', title: chart.description },
                el('div', { class: 'chart-head' }, el('span', { class: 'chart-label' }, chart.label)),
                empty ? el('p', { class: 'chart-empty' }, chart.error || 'No data: telemetry is off, or Prometheus does not scrape the servers.') : sparkline(top),
                empty ? null : legend,
            ),
        );
    }
    return block('From Prometheus', `The last hour, through ${panel.source.describe}.`, tilesEl);
}

function notHere(ctx: K8sDockside.Context): HTMLElement {
    return block(
        'No OpenBao or Vault here',
        `${ctx.contextName} runs no ${productName('openbao')} or ${productName('vault')} server that this plugin can find, and nothing in it fetches secrets from one: no Vault Secrets Operator objects, no pods asking for the agent, no External Secrets store or CSI class using the Vault provider.`,
        el('p', { class: 'links' }, linkButton('Install OpenBao', 'https://openbao.org/docs/platform/k8s/helm/'), linkButton('Install Vault', 'https://developer.hashicorp.com/vault/docs/platform/k8s/helm'), linkButton('Vault Secrets Operator', 'https://developer.hashicorp.com/vault/docs/platform/k8s/vso')),
    );
}
