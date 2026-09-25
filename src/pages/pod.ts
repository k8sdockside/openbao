// A panel on every pod.
//
// On an OpenBao or Vault server pod: its seal state as a padlock, its role,
// its version, and where its cluster stands. On any other pod: what it gets
// from OpenBao or Vault and how -- a Secret the Secrets Operator or External
// Secrets keeps in sync, a CSI mount, or the agent -- with the server it
// comes from. A pod that gets nothing says so in one line.

import { productName } from '../model/product.js';
import { isServerPod } from '../model/product.js';
import type { Pod } from '../model/types.js';
import { workloadOf } from '../model/consumers.js';
import { supplyOfPod, type PodSupply } from '../model/world.js';
import { byId, el, replace } from '../ui/dom.js';
import { load } from '../ui/load.js';
import { keySlots, padlock } from '../ui/lock.js';
import { openOn, start } from '../ui/page.js';
import { footLink, pill, productBadge } from '../ui/parts.js';

const VIA: Record<PodSupply['via'], string> = { vso: 'Secrets Operator', eso: 'External Secrets', csi: 'CSI mount', agent: 'Agent' };

start('panel', async () => {
    const host = byId('panel');
    const pod = (await k8sdockside.object()) as Pod | null;
    if (!pod) {
        replace(host, el('p', { class: 'empty' }, 'The pod is gone.'));
        return;
    }
    const server = isServerPod(pod);
    const { world } = await load({ api: server });

    if (server) {
        const cluster = world.clusters.find((c) => c.nodes.some((n) => n.name === pod.metadata.name && n.namespace === pod.metadata.namespace));
        const node = cluster?.nodes.find((n) => n.name === pod.metadata.name);
        if (!cluster || !node) {
            replace(host, el('p', { class: 'empty' }, 'An OpenBao or Vault server pod, not yet in a cluster the plugin can read.'));
            return;
        }
        const lock = node.role === 'sealed' ? 'closed' : node.role === 'uninitialized' ? 'uninitialized' : node.sealed === false ? 'open' : 'unknown';
        const leader = cluster.nodes.find((n) => n.role === 'active' && n !== node);
        const t = cluster.seal.t;
        const sentence =
            node.role === 'sealed'
                ? `${node.name} is sealed: it serves nothing until ${cluster.seal.auto ? `its ${cluster.seal.type} auto-unseal answers` : t ? `${t} key shares are entered on it` : 'its key shares are entered on it'}.${leader ? ` ${leader.name} serves ${cluster.name} meanwhile.` : ''}`
                : node.role === 'active'
                  ? `${node.name} leads ${cluster.name}: every request is served here${cluster.nodes.length > 1 ? `, and ${cluster.nodes.length - 1} other node${cluster.nodes.length > 2 ? 's' : ''} stand by` : ''}.`
                  : node.role === 'standby' || node.role === 'perf-standby'
                    ? `${node.name} is unsealed and stands by${leader ? ` for ${leader.name}` : ''}, ready to take over if it goes.`
                    : `${productName(node.product)} ${cluster.name}: ${cluster.sentence}`;
        const progress = cluster.seal.progressNode === node.name && node.role === 'sealed' ? keySlots(cluster.seal, true) : null;
        replace(
            host,
            el(
                'div',
                { class: 'panel-top' },
                padlock(lock, 48),
                el(
                    'div',
                    { class: 'panel-main' },
                    el('div', { class: 'panel-head' }, el('strong', {}, node.words[0]?.toUpperCase() + node.words.slice(1)), productBadge(node.product), node.leader ? pill('leader', 'ok') : null, node.version ? el('span', { class: 'faint' }, `v${node.version}`) : null),
                    el('p', { class: 'panel-sentence' }, sentence),
                ),
                progress,
            ),
            el('div', { class: 'links' }, footLink(node.role === 'sealed' ? 'How to unseal it' : 'Open in Servers', () => void openOn('cluster', { namespace: cluster.namespace, name: cluster.name }))),
        );
        return;
    }

    const supply = supplyOfPod(world, pod);
    if (supply.length === 0) {
        replace(host, el('p', { class: 'panel-sentence' }, 'This pod gets nothing from OpenBao or Vault: none of the Secrets it names is synced from one, and it has no agent or CSI mount.'));
        return;
    }
    const list = el('ul', { class: 'supply' });
    for (const s of supply) {
        const what = s.ref ? el('button', { type: 'button', class: 'link-name' }, s.what) : el('strong', {}, s.what);
        if (s.ref) what.addEventListener('click', () => void k8sdockside.open(s.ref as K8sDockside.ObjectRef));
        list.append(
            el(
                'li',
                {},
                el('span', { class: 'supply-how' }, pill(VIA[s.via], s.tone === 'ok' ? 'ok' : s.tone)),
                el('div', { class: 'supply-what' }, s.secret ? el('span', {}, 'Secret ', el('strong', {}, s.secret), ' from ') : null, what, el('span', { class: `tone-${s.tone || 'none'}` }, s.words)),
                el('div', { class: 'supply-paths' }, `${s.paths.join(', ') || '—'}  ·  from ${s.source.cluster ? `${productName(s.source.cluster.product)} ${s.source.cluster.namespace}/${s.source.cluster.name}` : s.source.label}`),
            ),
        );
    }
    replace(host, list, el('div', { class: 'links' }, footLink('Show on the secret flow', () => void openOn('flow', { search: workloadOf(pod).name }))));
});
