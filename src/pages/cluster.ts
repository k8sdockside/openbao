// Servers: one OpenBao or Vault cluster, whole.
//
//   its state          the padlock, the verdict, the key slots
//   its shape          every node as a card: seal state, role, readiness,
//                      where it runs and its version, the leader on top
//   what to do         in plain words, with the command to run -- the
//                      plugin never handles a key, it only says where one goes
//   what the API says  the seal type and threshold, storage, HA, the leader's
//                      address, and which Service answered
//   the nodes          as a table, for the details
//
// The cluster comes from the address (a focus from a search hit), from the
// dashboard's hand-over, or is the first one.

import { healthStanding } from '../model/api.js';
import { productName } from '../model/product.js';
import { ROLE_WORDS, type ServerCluster } from '../model/servers.js';
import { KIND } from '../model/types.js';
import { plural } from '../model/units.js';
import type { World } from '../model/world.js';
import { button, byId, el, replace } from '../ui/dom.js';
import { load } from '../ui/load.js';
import { keySlots, padlock } from '../ui/lock.js';
import { every, fingerprint, openOn, remember, start, wanted } from '../ui/page.js';
import { block, clickable, dot, facts, heading, linkButton, nothing, pill, productBadge } from '../ui/parts.js';
import { bigTopology } from '../ui/topology.js';

const REFRESH = 15_000;

start('page', async (ctx) => {
    const head = byId('head');
    const body = byId('body');
    const failure = el('p', { class: 'refresh-failure' });
    const note = `Every OpenBao and Vault node in ${ctx.contextName}: sealed or not, leader or standby, and what to do about it.`;
    replace(head, heading('cluster', 'Servers', note));

    const focus = await wanted('cluster');
    let picked = focus.name ? `${focus.namespace}/${focus.name}` : ((await remember.get<string>('cluster.picked')) ?? '');
    let world: World | null = null;
    let last = '';

    const draw = () => {
        if (!world) return;
        if (world.clusters.length === 0) {
            replace(body, failure, block('No servers here', `No OpenBao or Vault server pod runs in ${ctx.contextName}. Pods are recognised by the labels service registration writes (openbao-sealed, vault-sealed …) or by the charts' component=server label with an OpenBao or Vault image.`, el('p', { class: 'links' }, linkButton('OpenBao on Kubernetes', 'https://openbao.org/docs/platform/k8s/helm/'))));
            return;
        }
        const cluster = world.clusters.find((c) => c.id === picked) ?? world.clusters[0];
        if (!cluster) return;
        const chips = world.clusters.length > 1 ? picker(world.clusters, cluster.id) : null;
        replace(body, failure, chips, summary(cluster), el('div', { class: 'block' }, bigTopology(cluster, (n) => void k8sdockside.open(n.ref))), el('div', { class: 'two' }, whatToDo(cluster, ctx), apiFacts(cluster)), nodeTable(cluster));
    };

    const picker = (clusters: ServerCluster[], current: string) => {
        const row = el('div', { class: 'picker', role: 'tablist' });
        for (const c of clusters) {
            const chip = el('button', { type: 'button', class: `chip${c.id === current ? ' here' : ''}`, role: 'tab', 'aria-selected': c.id === current ? 'true' : 'false' }, dot(c.tone), `${c.namespace}/${c.name}`, productBadge(c.product));
            chip.addEventListener('click', () => {
                picked = c.id;
                void remember.set('cluster.picked', picked);
                draw();
            });
            row.append(chip);
        }
        return row;
    };

    const stop = every(
        REFRESH,
        async () => {
            const loaded = await load({ api: true });
            failure.textContent = '';
            document.getElementById('first')?.remove();
            const print = fingerprint([loaded.snap, picked]);
            if (print === last) return;
            last = print;
            world = loaded.world;
            const sealed = world.clusters.reduce((n, c) => n + c.counts.sealed, 0);
            replace(head, heading('cluster', 'Servers', note, { cluster: sealed }));
            draw();
        },
        (err) => {
            failure.textContent = err instanceof Error ? err.message : String(err);
        },
    );
    addEventListener('pagehide', stop);
});

function summary(c: ServerCluster): HTMLElement {
    const sealedNow = c.lock === 'closed' || c.lock === 'partial';
    return el(
        'section',
        { class: 'block summary' },
        padlock(c.lock, 72, c.counts.sealed),
        el(
            'div',
            { class: 'summary-main' },
            el('div', { class: 'summary-title' }, el('h3', {}, c.name), el('span', { class: 'card-ns' }, c.namespace), productBadge(c.product), pill(c.words, c.tone)),
            el('p', { class: 'summary-sentence' }, c.sentence),
            el('div', { class: 'links' }, button('Open the StatefulSet', () => void k8sdockside.open(c.ref)), button('Secret flow from here', () => void openOn('flow', { server: c.id }))),
        ),
        el('div', { class: 'summary-keys' }, keySlots(c.seal, sealedNow, c.lock === 'uninitialized')),
    );
}

/**
 * A command in a box, with a button that copies it. The page's frame may
 * not be allowed the clipboard; then the text is selected instead, for the
 * user's own copy.
 */
function command(line: string): HTMLElement {
    const code = el('code', {}, line);
    const copy = el('button', { type: 'button', title: 'Copy the command' }, 'Copy');
    copy.addEventListener('click', () => {
        const done = (words: string) => {
            copy.textContent = words;
            setTimeout(() => (copy.textContent = 'Copy'), 1600);
        };
        const select = () => {
            const range = document.createRange();
            range.selectNodeContents(code);
            const selection = window.getSelection();
            selection?.removeAllRanges();
            selection?.addRange(range);
            done('Press Ctrl+C');
        };
        try {
            void navigator.clipboard
                ?.writeText(line)
                .then(() => done('Copied'))
                .catch(select);
            if (!navigator.clipboard) select();
        } catch {
            select();
        }
    });
    return el('div', { class: 'command' }, code, copy);
}

function whatToDo(c: ServerCluster, ctx: K8sDockside.Context): HTMLElement {
    const exec = (pod: string, args: string) => `kubectl --context ${ctx.contextName} -n ${c.namespace} exec -ti ${pod} -- ${c.cli} ${args}`;
    const sealed = c.nodes.filter((n) => n.role === 'sealed');

    if (c.lock === 'uninitialized') {
        const first = c.nodes[0]?.name ?? `${c.name}-0`;
        return block(
            'Initialise it',
            `${productName(c.product)} has never been initialised, so there is nothing to unseal yet. Initialising creates the root key and splits it into key shares; it is done once, by a person.`,
            el(
                'ol',
                { class: 'steps' },
                el('li', {}, 'Run this on the first node. It prints the unseal keys and an initial root token, once.'),
                el('li', {}, el('strong', {}, 'Store every key share and the token somewhere safe'), ', each with a different person if you can. They cannot be shown again.'),
                el('li', {}, `Unseal the node with ${c.cli} operator unseal, then let the other nodes join and unseal them too.`),
            ),
            command(exec(first, 'operator init')),
            el('p', { class: 'callout' }, 'This plugin never sees, stores or sends a key. It only shows you where to type one.'),
        );
    }
    if (sealed.length > 0) {
        const t = c.seal.t;
        const words = c.seal.auto
            ? `These nodes use ${c.seal.type} auto-unseal, so they should unseal themselves. If they stay sealed, the seal cannot reach its KMS: check the pod's logs, its credentials and the network to the KMS.`
            : `A sealed node cannot read anything until ${t ? `${plural(t, 'key holder')} each enter${t === 1 ? 's' : ''} a key share` : 'enough key holders enter their key shares'}. Run the command below once per share; it asks for the key without echoing it. Progress is kept on the node until the threshold is reached.`;
        return block(
            sealed.length === 1 ? `Unseal ${sealed[0]?.name}` : `Unseal ${plural(sealed.length, 'node')}`,
            words,
            ...(c.seal.auto
                ? sealed.map((n) => el('div', {}, el('div', { class: 'command-label' }, n.name, el('span', { class: 'faint' }, ' — its logs')), command(`kubectl --context ${ctx.contextName} -n ${c.namespace} logs ${n.name}`)))
                : sealed.map((n) =>
                      el(
                          'div',
                          {},
                          el('div', { class: 'command-label' }, n.name, c.seal.progressNode === n.name && c.seal.progress !== undefined && t ? el('span', { class: 'faint' }, ` — ${c.seal.progress} of ${t} keys entered so far`) : null),
                          command(exec(n.name, 'operator unseal')),
                      ),
                  )),
            el('p', { class: 'callout' }, 'This plugin never sees, stores or sends a key. Unsealing needs a key share, which only its holder should type.'),
        );
    }
    if (c.lock === 'unknown') {
        return block(
            'Seal state unknown',
            `Neither the pods' labels nor the API said whether these nodes are sealed. Add service_registration "kubernetes" {} to the server configuration (both charts put it in their HA examples) and the pods label themselves.`,
            c.nodes[0] ? command(exec(c.nodes[0].name, 'status')) : null,
        );
    }
    if (c.drift) {
        const behind = c.nodes.filter((n) => n.version && n.version !== c.version);
        const leader = c.nodes.find((n) => n.role === 'active');
        return block(
            'Finish the upgrade',
            `The nodes run ${c.versions.join(' and ')}. The charts roll a StatefulSet with updateStrategy OnDelete, so a node runs its new image only once its pod is deleted. Delete the old ones one at a time, standbys first, waiting for each to come back and be unsealed${c.seal.auto ? ' (auto-unseal does that on its own)' : ''}; the leader last, so it steps down only once.`,
            ...behind.filter((n) => n !== leader).map((n) => el('div', {}, el('div', { class: 'command-label' }, n.name, el('span', { class: 'faint' }, ` — on ${n.version}`)), command(`kubectl --context ${ctx.contextName} -n ${c.namespace} delete pod ${n.name}`))),
            leader && behind.includes(leader) ? el('p', { class: 'callout' }, `${leader.name} leads on ${leader.version}: delete it last, once every standby runs the new version.`) : null,
        );
    }
    return block(
        'Nothing to do',
        c.nodes.length > 1 ? `Every node is unsealed and ${c.nodes.find((n) => n.role === 'active')?.name ?? 'one of them'} is leading. To see the same from a terminal:` : 'The server is unsealed and serving. To see the same from a terminal:',
        command(exec(c.leaderName ?? c.nodes[0]?.name ?? `${c.name}-0`, 'status')),
    );
}

function apiFacts(c: ServerCluster): HTMLElement {
    const answered = c.active ?? c.main;
    if (!answered) {
        return block(
            'What the API says',
            'Nothing: the servers were not asked, or could not be reached. The seal state on this page comes from the labels service registration keeps on each pod.',
            el('p', { class: 'faint' }, c.apiError ?? 'No declared Service matched this cluster.'),
            el('p', { class: 'note' }, 'The plugin asks the unauthenticated /v1/sys/seal-status, /v1/sys/health and /v1/sys/leader through the API server’s service proxy, which needs the services/proxy permission.'),
        );
    }
    const standing = (r: typeof c.active) => (r?.healthCode ? `${r.service} (${healthStanding(r.healthCode)})` : r?.service);
    const leader = c.active?.leader ?? c.main?.leader;
    return block(
        'What the API says',
        'Read without a token from the unauthenticated endpoints, through the API server.',
        facts([
            ['Seal', c.seal.type ? (c.seal.auto ? `${c.seal.type} (auto-unseal)` : `${c.seal.type}, ${c.seal.t} of ${c.seal.n} key shares`) : undefined],
            ['Storage', c.storage],
            ['Cluster name', c.clusterName],
            ['Version', c.version ? `${c.version}${c.drift ? ` (nodes run ${c.versions.join(', ')})` : ''}` : undefined],
            ['High availability', c.ha === undefined ? undefined : c.ha ? 'on' : 'off'],
            ['Leader address', c.leaderAddress],
            ['Raft index', leader?.raft_committed_index ? `${leader.raft_applied_index ?? '?'} applied of ${leader.raft_committed_index} committed` : undefined],
            ['Asked', [standing(c.active), standing(c.main)].filter(Boolean).join(' · ')],
        ]),
    );
}

function nodeTable(c: ServerCluster): HTMLElement {
    if (c.nodes.length === 0) return block('Nodes', '', nothing(`The StatefulSet wants ${c.desired ?? 0} and none is running.`));
    const rows = c.nodes.map((n) => {
        const row = el(
            'tr',
            {},
            el('td', {}, el('strong', {}, n.name), n.leader ? el('span', { class: 'faint' }, ' · leader') : null),
            el('td', {}, pill(ROLE_WORDS[n.role], n.tone)),
            el('td', { class: n.ready ? '' : 'tone-warn' }, n.ready ? 'ready' : 'not ready'),
            el('td', {}, String(n.restarts)),
            el('td', {}, n.nodeName ?? '—'),
            el('td', {}, n.zone ?? '—'),
            el('td', {}, n.version ?? '—'),
            el('td', { class: 'faint' }, n.source === 'labels' ? 'pod labels' : n.source === 'api' ? 'the API' : 'unknown'),
        );
        clickable(row, () => void k8sdockside.open({ kind: KIND.pods, namespace: n.namespace, name: n.name }));
        return row;
    });
    return block(
        'Nodes',
        'Click a row to open the pod.',
        el('div', { class: 'table-wrap' }, el('table', {}, el('thead', {}, el('tr', {}, ...['Pod', 'Role', 'Ready', 'Restarts', 'Node', 'Zone', 'Version', 'Seal state from'].map((h) => el('th', {}, h)))), el('tbody', {}, ...rows))),
    );
}
