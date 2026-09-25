// A panel on every VaultStaticSecret, VaultDynamicSecret and VaultPKISecret:
// whether it syncs, the operator's own words when it does not, when it last
// synced and when what it holds runs out, and its chain as a strip -- server,
// login, this object, the Secret it writes, the workloads that use it --
// with "Sync now" when the plugin may write.

import { productName } from '../model/product.js';
import { relative } from '../model/units.js';
import { SYNC_KIND_WORDS, type SyncItem } from '../model/vso.js';
import { authOf, consumersOfItem, sourceOfItem, type World } from '../model/world.js';
import { syncButton } from '../ui/actions.js';
import { byId, el, replace } from '../ui/dom.js';
import { load } from '../ui/load.js';
import { moment, openOn, start } from '../ui/page.js';
import { facts, footLink, pill } from '../ui/parts.js';

start('panel', async (ctx) => {
    const host = byId('panel');
    const ref = ctx.object;
    if (!ref) {
        replace(host, el('p', { class: 'empty' }, 'Nothing to show.'));
        return;
    }
    const { world } = await load();
    const item = world.items.find((i) => i.ref.kind === ref.kind && i.namespace === (ref.namespace ?? '') && i.name === ref.name);
    if (!item) {
        replace(host, el('p', { class: 'empty' }, 'The operator has not seen this object yet.'));
        return;
    }
    replace(host, ...draw(world, item, ctx));
});

function step(kicker: string, label: string, opts: { here?: boolean; dashed?: boolean; tone?: string; onPick?: () => void; title?: string } = {}): HTMLElement {
    const node = el('span', { class: `mini-step${opts.here ? ' here' : ''}${opts.dashed ? ' dashed' : ''}`, title: opts.title }, el('span', { class: 'mini-kicker' }, kicker), el('span', { class: `mini-label${opts.tone ? ` tone-${opts.tone}` : ''}` }, label));
    if (opts.onPick) {
        node.classList.add('pick');
        node.setAttribute('role', 'button');
        node.setAttribute('tabindex', '0');
        node.addEventListener('click', opts.onPick);
    }
    return node;
}

function arrow(tone = ''): HTMLElement {
    return el('span', { class: `mini-arrow${tone ? ` tone-${tone}` : ''}`, 'aria-hidden': 'true' }, '→');
}

function draw(world: World, item: SyncItem, ctx: K8sDockside.Context): Node[] {
    const source = sourceOfItem(world, item);
    const auth = authOf(world, item);
    const users = consumersOfItem(world, item);
    const now = world.now;
    const bad = item.tone === 'error' ? 'error' : '';

    const chain = el(
        'div',
        { class: 'mini-flow' },
        step(source.cluster ? productName(source.cluster.product) : 'Server', source.label, { tone: source.cluster?.tone, onPick: source.cluster ? () => void openOn('cluster', { namespace: source.cluster?.namespace ?? '', name: source.cluster?.name ?? '' }) : undefined, title: source.address }),
        arrow(),
        step(auth ? `VaultAuth · ${auth.method}` : 'VaultAuth', auth ? (auth.role ? `${auth.name} (${auth.role})` : auth.name) : `${item.auth.name}: not found`, { tone: auth ? (auth.tone === 'error' ? 'error' : '') : 'error', onPick: auth ? () => void k8sdockside.open(auth.ref) : undefined }),
        arrow(),
        step(SYNC_KIND_WORDS[item.kind], item.location || item.name, { here: true, tone: item.tone === 'ok' ? '' : item.tone }),
        arrow(bad),
        step('Secret', item.destination || '—', { dashed: true, title: 'By name only: this panel cannot read Secrets.', onPick: item.destination ? () => void k8sdockside.open({ kind: 'secrets', namespace: item.namespace, name: item.destination }) : undefined }),
        ...(users.length ? [arrow(bad), ...users.slice(0, 3).map((w) => step(w.kind, w.name, { tone: w.tone === 'ok' ? '' : w.tone, onPick: () => void k8sdockside.open(w.ref) }))] : []),
        users.length > 3 ? el('span', { class: 'faint' }, `+${users.length - 3}`) : null,
    );

    const lines: [string, Node | string | undefined][] = [
        ['State', el('span', {}, pill(item.words, item.tone === 'info' ? 'info' : item.tone), item.message ? el('span', { class: 'faint' }, `  ${item.message}`) : null)],
        ['Last synced', item.lastSync ? `${moment(item.lastSync)} (${relative(item.lastSync, now)})` : 'never'],
        ['Expires', item.expires !== undefined ? `${moment(item.expires)} (${relative(item.expires, now)})` : undefined],
        ['Renewal', item.renewAt !== undefined && item.expires !== undefined && item.renewAt < item.expires ? `${moment(item.renewAt)} (${relative(item.renewAt, now)})` : undefined],
        ['Refresh', item.kind === 'static' ? `${item.refreshAfter ? `every ${item.refreshAfter}` : 'on change only'}${item.instantUpdates ? ', and on every change event' : ''}` : undefined],
        ['Restarts', item.rolloutTargets.length ? item.rolloutTargets.map((t) => `${t.kind} ${t.name}`).join(', ') : undefined],
        ['Used by', users.length ? users.map((w) => `${w.kind} ${w.name}`).join(', ') : 'no pod names this Secret'],
    ];

    return [chain, facts(lines), el('div', { class: 'panel-actions action-row' }, syncButton(item, ctx), footLink('Show on the secret flow', () => void openOn('flow', { search: item.name })))];
}
