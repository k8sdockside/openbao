// The secret flow: who gets what, as a graph read left to right.
//
//   server        an OpenBao or Vault cluster in view, or an address outside it
//   login         how the client authenticates: a VaultAuth (method and role),
//                 an External Secrets store, the agent injector's role, a CSI
//                 class's role
//   synced by     the object that fetches it: VaultStaticSecret,
//                 VaultDynamicSecret, VaultPKISecret, ExternalSecret,
//                 SecretProviderClass -- or the agent, with the paths it renders
//   Secret        the Kubernetes Secret it lands in, by name only: the plugin
//                 cannot read Secrets and does not need to
//   used by       the workloads whose pod specs name that Secret, or mount the
//                 class, or carry the agent
//
// Every chain runs through one "synced by" node, so the filters work on
// those and keep whole chains: searching for a workload still shows the
// server it gets its secrets from.

import { shortAddress } from './address.js';
import type { Workload } from './consumers.js';
import { productName } from './product.js';
import { key, type Tone } from './types.js';
import { plural, worst } from './units.js';
import { SYNC_KIND_WORDS } from './vso.js';
import { authOf, consumersOfItem, sourceOfClass, sourceOfInjection, sourceOfItem, sourceOfStore, storeOfExternal, type Source, type World } from './world.js';
import { workloadKey, workloadOf } from './consumers.js';

export type Via = 'vso' | 'agent' | 'eso' | 'csi';
export const VIAS: Via[] = ['vso', 'agent', 'eso', 'csi'];
export const VIA_WORDS: Record<Via, string> = { vso: 'Secrets Operator', agent: 'Agent injector', eso: 'External Secrets', csi: 'CSI driver' };

export const COLUMNS = ['Server', 'Logs in as', 'Synced by', 'Kubernetes Secret', 'Used by'];

export type NodeType = 'server' | 'login' | 'sync' | 'secret' | 'workload';

export interface FNode {
    id: string;
    col: number;
    type: NodeType;
    kicker: string;
    label: string;
    sub: string;
    tone: Tone;
    title: string;
    ref?: K8sDockside.OpenRef;
    /** A product badge on a server: OpenBao or Vault. */
    badge?: string;
    via: Via;
    namespace?: string;
    /** Drawn dashed: something that is referenced and not there. */
    missing?: boolean;
    /** For a server in view: its cluster, to open the cluster view on. */
    clusterId?: string;
}

export interface FEdge {
    id: string;
    from: string;
    to: string;
    tone: Tone;
    dashed?: boolean;
    title?: string;
}

export interface FlowGraph {
    nodes: FNode[];
    edges: FEdge[];
}

export interface FlowFilter {
    namespace?: string;
    vias?: Via[];
    problemsOnly?: boolean;
    search?: string;
    /** Only chains from this server cluster, by id. */
    server?: string;
}

class Builder {
    nodes = new Map<string, FNode>();
    edges = new Map<string, FEdge>();

    node(n: FNode): FNode {
        const had = this.nodes.get(n.id);
        if (had) {
            had.tone = worst(had.tone, n.tone);
            return had;
        }
        this.nodes.set(n.id, n);
        return n;
    }

    edge(from: string, to: string, tone: Tone, extra: Partial<FEdge> = {}): void {
        const id = `${from}->${to}`;
        const had = this.edges.get(id);
        if (had) {
            had.tone = worst(had.tone, tone);
            return;
        }
        this.edges.set(id, { id, from, to, tone, ...extra });
    }
}

function serverNode(b: Builder, source: Source, via: Via): FNode {
    const c = source.cluster;
    if (c) {
        return b.node({
            id: source.id,
            col: 0,
            type: 'server',
            kicker: `${c.nodes.length === 1 ? '1 node' : `${c.nodes.length} nodes`}${c.storage ? ` · ${c.storage}` : ''}`,
            label: c.name,
            sub: `${c.namespace} · ${c.words.toLowerCase()}`,
            tone: c.tone,
            title: `${productName(c.product)} ${c.namespace}/${c.name}: ${c.sentence}`,
            ref: c.ref,
            badge: c.product === 'openbao' ? 'OpenBao' : c.product === 'vault' ? 'Vault' : undefined,
            via,
            namespace: c.namespace,
            clusterId: c.id,
        });
    }
    return b.node({
        id: source.id,
        col: 0,
        type: 'server',
        kicker: 'Server outside the cluster',
        label: source.label,
        sub: source.address ? 'not in view' : 'no address given',
        tone: '',
        title: source.address ? `${source.address}: a server this cluster does not run, or one the plugin cannot see.` : 'Nothing names the server, and more than one is in view.',
        via,
    });
}

function workloadNode(b: Builder, w: Workload, via: Via, extra = ''): FNode {
    return b.node({
        id: `wl:${w.id}`,
        col: 4,
        type: 'workload',
        kicker: `${w.kind}${extra}`,
        label: w.name,
        sub: `${w.namespace} · ${w.ready}/${w.pods.length} ready`,
        tone: w.tone,
        title: `${w.kind} ${w.namespace}/${w.name}: ${plural(w.pods.length, 'pod')}, ${w.ready} ready.`,
        ref: w.ref,
        via,
        namespace: w.namespace,
    });
}

function secretNode(b: Builder, namespace: string, name: string, tone: Tone, via: Via): FNode {
    return b.node({
        id: `sec:${key(namespace, name)}`,
        col: 3,
        type: 'secret',
        kicker: 'Secret',
        label: name,
        sub: namespace,
        tone,
        title: `Secret ${namespace}/${name}. Only its name is shown: plugin pages can never read Secrets.`,
        ref: { kind: 'secrets', namespace, name },
        via,
        namespace,
    });
}

/** The whole graph, before any filter. */
export function buildFlow(world: World): FlowGraph {
    const b = new Builder();

    // The Secrets Operator.
    for (const item of world.items) {
        const src = serverNode(b, sourceOfItem(world, item), 'vso');
        const auth = authOf(world, item);
        const authId = `auth:${key(item.auth.namespace, item.auth.name)}`;
        b.node({
            id: authId,
            col: 1,
            type: 'login',
            kicker: auth ? `VaultAuth · ${auth.method}` : 'VaultAuth',
            label: item.auth.name,
            sub: auth ? (auth.role ? `role ${auth.role}` : `mount ${auth.mount}`) : 'not found',
            tone: auth ? auth.tone : 'error',
            title: auth ? `VaultAuth ${auth.namespace}/${auth.name}: ${auth.method} login at auth/${auth.mount}${auth.role ? ` as role ${auth.role}` : ''}.${auth.error ? ` ${auth.error}` : ''}` : `VaultAuth ${item.auth.namespace}/${item.auth.name} does not exist${item.auth.defaulted ? ' (it is the operator default, used when vaultAuthRef is empty)' : ''}.`,
            ref: auth?.ref ?? undefined,
            via: 'vso',
            namespace: item.auth.namespace,
            missing: !auth,
        });
        const objId = `obj:${item.ref.kind}/${key(item.namespace, item.name)}`;
        b.node({
            id: objId,
            col: 2,
            type: 'sync',
            kicker: SYNC_KIND_WORDS[item.kind],
            label: item.name,
            sub: item.location || '—',
            tone: item.tone,
            title: `${SYNC_KIND_WORDS[item.kind]} ${item.namespace}/${item.name}: ${item.words}.${item.message ? ` ${item.message}` : ''}`,
            ref: item.ref,
            via: 'vso',
            namespace: item.namespace,
        });
        b.edge(src.id, authId, auth ? worst(src.tone === 'error' ? 'error' : '', auth.tone === 'error' ? 'error' : '') || 'ok' : 'error');
        b.edge(authId, objId, item.tone === 'error' ? 'error' : item.tone === 'warn' ? 'warn' : 'ok');
        if (!item.destination) continue;
        const sec = secretNode(b, item.namespace, item.destination, item.tone === 'info' ? '' : item.tone, 'vso');
        b.edge(objId, sec.id, item.tone === 'info' ? '' : item.tone);
        const users = consumersOfItem(world, item);
        for (const w of users) {
            const target = item.rolloutTargets.some((t) => t.kind === w.kind && t.name === w.name);
            const node = workloadNode(b, w, 'vso', target ? ' · auto-restart' : '');
            // A Secret that is not being kept up to date is a problem for
            // whoever reads it, whatever state the workload is in.
            b.edge(sec.id, node.id, worst(item.tone === 'info' ? '' : item.tone, node.tone));
        }
        for (const t of item.rolloutTargets) {
            const w = world.workloads.get(`${item.namespace}/${t.kind}/${t.name}`);
            if (!w || users.includes(w)) continue;
            const node = workloadNode(b, w, 'vso', ' · auto-restart');
            b.edge(sec.id, node.id, '', { dashed: true, title: `${t.kind} ${t.name} is restarted when the secret changes, but its pods do not name the Secret.` });
        }
    }

    // External Secrets.
    for (const e of world.externals) {
        const store = storeOfExternal(world, e);
        if (!store) continue;
        const src = serverNode(b, sourceOfStore(world, store), 'eso');
        const storeId = `store:${store.kind}/${key(store.namespace, store.name)}`;
        b.node({
            id: storeId,
            col: 1,
            type: 'login',
            kicker: `${store.kind === 'ClusterSecretStore' ? 'Cluster store' : 'SecretStore'} · ${store.method}`,
            label: store.name,
            sub: store.role ? `role ${store.role}` : store.path ? `path ${store.path}` : store.words,
            tone: store.tone === 'info' ? '' : store.tone,
            title: `${store.kind} ${store.namespace ? `${store.namespace}/` : ''}${store.name}, the Vault provider at ${store.server}${store.path ? `, path ${store.path}` : ''}${store.version ? ` (kv ${store.version})` : ''}: ${store.words}.${store.message ? ` ${store.message}` : ''}`,
            ref: store.ref,
            via: 'eso',
            namespace: store.namespace || undefined,
        });
        const objId = `obj:${e.ref.kind}/${key(e.namespace, e.name)}`;
        b.node({
            id: objId,
            col: 2,
            type: 'sync',
            kicker: 'ExternalSecret',
            label: e.name,
            sub: e.keys.length ? `${e.keys[0]}${e.keys.length > 1 ? ` +${e.keys.length - 1}` : ''}` : '—',
            tone: e.tone === 'info' ? '' : e.tone,
            title: `ExternalSecret ${e.namespace}/${e.name}: ${e.words}.${e.message ? ` ${e.message}` : ''} Keys: ${e.keys.join(', ') || '—'}.`,
            ref: e.ref,
            via: 'eso',
            namespace: e.namespace,
        });
        b.edge(src.id, storeId, store.tone === 'error' ? 'error' : 'ok');
        b.edge(storeId, objId, e.tone === 'error' ? 'error' : 'ok');
        const sec = secretNode(b, e.namespace, e.target, e.tone === 'info' ? '' : e.tone, 'eso');
        b.edge(objId, sec.id, e.tone === 'info' ? '' : e.tone);
        for (const w of world.users.get(key(e.namespace, e.target)) ?? []) {
            const node = workloadNode(b, w, 'eso');
            b.edge(sec.id, node.id, worst(e.tone === 'info' ? '' : e.tone, node.tone));
        }
    }

    // The CSI provider.
    for (const c of world.classes) {
        const src = serverNode(b, sourceOfClass(world, c), 'csi');
        const roleId = `csirole:${src.id}/${c.role ?? ''}`;
        b.node({ id: roleId, col: 1, type: 'login', kicker: `CSI provider · ${c.provider}`, label: c.role ? `role ${c.role}` : 'no role', sub: 'kubernetes login per pod', tone: '', title: `The ${c.provider} CSI provider logs in as each pod's service account${c.role ? `, role ${c.role}` : ''}.`, via: 'csi' });
        const objId = `obj:${c.ref.kind}/${key(c.namespace, c.name)}`;
        b.node({ id: objId, col: 2, type: 'sync', kicker: 'SecretProviderClass', label: c.name, sub: c.paths.length ? `${c.paths[0]}${c.paths.length > 1 ? ` +${c.paths.length - 1}` : ''}` : '—', tone: '', title: `SecretProviderClass ${c.namespace}/${c.name}: mounts ${c.paths.join(', ') || 'nothing yet'} as files.`, ref: c.ref, via: 'csi', namespace: c.namespace });
        b.edge(src.id, roleId, 'ok');
        b.edge(roleId, objId, 'ok');
        for (const s of c.syncs) {
            const sec = secretNode(b, c.namespace, s, '', 'csi');
            b.edge(objId, sec.id, '');
            for (const w of world.users.get(key(c.namespace, s)) ?? []) b.edge(sec.id, workloadNode(b, w, 'csi').id, 'ok');
        }
        for (const w of world.workloads.values()) {
            if (w.namespace !== c.namespace || !w.classes.includes(c.name)) continue;
            b.edge(objId, workloadNode(b, w, 'csi', ' · CSI mount').id, w.tone, { title: 'Mounted as a CSI volume' });
        }
    }

    // The agent injector: one node per workload, with the paths it renders.
    const byWorkload = new Map<string, { pods: typeof world.injected; w?: Workload }>();
    for (const p of world.injected) {
        const id = workloadKey(workloadOf(p.pod));
        const entry = byWorkload.get(id) ?? { pods: [], w: world.workloads.get(id) };
        entry.pods.push(p);
        byWorkload.set(id, entry);
    }
    for (const [id, { pods, w }] of byWorkload) {
        const first = pods[0];
        if (!first) continue;
        const src = serverNode(b, sourceOfInjection(world, first), 'agent');
        const role = first.injection.role ?? '';
        const roleId = `agentrole:${src.id}/${role}`;
        b.node({
            id: roleId,
            col: 1,
            type: 'login',
            kicker: 'Agent injector',
            label: role ? `role ${role}` : 'no role',
            sub: first.injection.authPath ?? 'auth/kubernetes',
            tone: role ? '' : 'warn',
            title: `Agents log in with their pod's service account${role ? ` as role ${role}` : ', and no role annotation: the login fails'}.`,
            via: 'agent',
        });
        const paths = [...new Set(pods.flatMap((p) => p.injection.secrets.map((s) => s.path)))];
        const tone = worst(...pods.map((p) => p.tone));
        const agentId = `agent:${id}`;
        b.node({
            id: agentId,
            col: 2,
            type: 'sync',
            kicker: 'Injected by the agent',
            label: paths[0] ?? 'no secrets listed',
            sub: paths.length > 1 ? `+${paths.length - 1} more path${paths.length > 2 ? 's' : ''}` : first.injection.secrets[0] ? `to /vault/secrets/${first.injection.secrets[0].file}` : '—',
            tone,
            title: `The agent renders ${paths.join(', ') || 'nothing'} into files in the pod. ${pods.map((p) => `${p.name}: ${p.words}`).join('; ')}.`,
            ref: first.ref,
            via: 'agent',
            namespace: first.namespace,
        });
        b.edge(src.id, roleId, 'ok');
        b.edge(roleId, agentId, tone === 'error' ? 'error' : 'ok');
        if (w) b.edge(agentId, workloadNode(b, w, 'agent').id, tone);
    }

    return { nodes: [...b.nodes.values()], edges: [...b.edges.values()] };
}

/** Every node upstream and downstream of one, and the edges between them. */
export function lineage(graph: FlowGraph, id: string): { nodes: Set<string>; edges: Set<string> } {
    const nodes = new Set<string>([id]);
    const edges = new Set<string>();
    const walk = (start: string, forward: boolean) => {
        const queue = [start];
        while (queue.length) {
            const at = queue.shift() as string;
            for (const e of graph.edges) {
                const [from, to] = forward ? [e.from, e.to] : [e.to, e.from];
                if (from !== at) continue;
                edges.add(e.id);
                if (!nodes.has(to)) {
                    nodes.add(to);
                    queue.push(to);
                }
            }
        }
    };
    walk(id, true);
    walk(id, false);
    return { nodes, edges };
}

function matches(n: FNode, needle: string): boolean {
    return [n.label, n.sub, n.kicker, n.namespace ?? ''].some((s) => s.toLowerCase().includes(needle));
}

/**
 * The chains the filters keep. A chain is one "synced by" node with all it
 * connects to; it is kept when its sync node matches the namespace and the
 * way it arrives, and anything along it matches the search or is in trouble.
 */
export function filterFlow(graph: FlowGraph, filter: FlowFilter): FlowGraph {
    const needle = (filter.search ?? '').trim().toLowerCase();
    const vias = filter.vias && filter.vias.length ? new Set(filter.vias) : null;
    const byId = new Map(graph.nodes.map((n) => [n.id, n]));
    const keepNodes = new Set<string>();
    const keepEdges = new Set<string>();
    for (const n of graph.nodes) {
        if (n.type !== 'sync') continue;
        if (vias && !vias.has(n.via)) continue;
        if (filter.namespace && n.namespace !== filter.namespace) continue;
        const chain = lineage(graph, n.id);
        if (filter.server && !chain.nodes.has(`srv:${filter.server}`)) continue;
        const members = [...chain.nodes].map((id) => byId.get(id)).filter((x): x is FNode => !!x);
        // A server one node short is not a problem for its clients; a server
        // that cannot serve is.
        if (filter.problemsOnly && !members.some((m) => m.tone === 'error' || m.missing || (m.tone === 'warn' && m.type !== 'server'))) continue;
        if (needle && !members.some((m) => matches(m, needle))) continue;
        for (const id of chain.nodes) keepNodes.add(id);
        for (const id of chain.edges) keepEdges.add(id);
    }
    // A chain's lineage runs through shared servers into other chains; keep
    // only edges whose ends both stayed, and only nodes one of them reaches.
    const nodes = graph.nodes.filter((n) => keepNodes.has(n.id));
    const edges = graph.edges.filter((e) => keepEdges.has(e.id) && keepNodes.has(e.from) && keepNodes.has(e.to));
    return { nodes, edges };
}

// ----- layout --------------------------------------------------------------------------

export const NODE_W = 200;
export const NODE_H = 54;
export const ROW = 66;
export const GAP_X = 58;
export const TOP = 30;

export interface Box {
    x: number;
    y: number;
}

export interface Layout {
    boxes: Map<string, Box>;
    width: number;
    height: number;
    columns: { x: number; label: string; used: boolean }[];
}

/**
 * Columns left to right; the "synced by" column is stacked first, grouped by
 * where it comes from, and every other column is placed level with the
 * middle of what it connects to, pushed down where boxes would overlap.
 */
export function layoutFlow(graph: FlowGraph): Layout {
    const cols: FNode[][] = [[], [], [], [], []];
    for (const n of graph.nodes) cols[n.col]?.push(n);
    const up = new Map<string, string[]>();
    const down = new Map<string, string[]>();
    for (const e of graph.edges) {
        up.set(e.to, [...(up.get(e.to) ?? []), e.from]);
        down.set(e.from, [...(down.get(e.from) ?? []), e.to]);
    }
    const y = new Map<string, number>();

    // Upstream of each sync node, for grouping: its login and its server.
    const origin = (id: string): string => {
        const login = (up.get(id) ?? [])[0] ?? '';
        const server = (up.get(login) ?? [])[0] ?? '';
        return `${server}|${login}`;
    };
    const middle = cols[2] ?? [];
    middle.sort((a, b) => origin(a.id).localeCompare(origin(b.id)) || (a.namespace ?? '').localeCompare(b.namespace ?? '') || a.label.localeCompare(b.label));
    middle.forEach((n, i) => y.set(n.id, TOP + i * ROW));

    const place = (column: FNode[], neighbours: Map<string, string[]>) => {
        const want = column.map((n) => {
            const ys = (neighbours.get(n.id) ?? []).map((id) => y.get(id)).filter((v): v is number => v !== undefined);
            return { n, want: ys.length ? ys.reduce((s, v) => s + v, 0) / ys.length : Number.MAX_SAFE_INTEGER };
        });
        want.sort((a, b) => a.want - b.want || a.n.label.localeCompare(b.n.label));
        let next = TOP;
        for (const { n, want: w } of want) {
            const at = Math.max(next, w === Number.MAX_SAFE_INTEGER ? next : w);
            y.set(n.id, at);
            next = at + ROW;
        }
    };
    place(cols[1] ?? [], down);
    place(cols[0] ?? [], down);
    place(cols[3] ?? [], up);
    place(cols[4] ?? [], up);

    const boxes = new Map<string, Box>();
    let height = TOP + NODE_H;
    for (const n of graph.nodes) {
        const at = y.get(n.id) ?? TOP;
        boxes.set(n.id, { x: n.col * (NODE_W + GAP_X), y: at });
        height = Math.max(height, at + NODE_H);
    }
    return {
        boxes,
        width: 5 * NODE_W + 4 * GAP_X,
        height: height + 8,
        columns: COLUMNS.map((label, i) => ({ x: i * (NODE_W + GAP_X), label, used: (cols[i] ?? []).length > 0 })),
    };
}

/** Counts for the toolbar. */
export function flowCounts(graph: FlowGraph): { servers: number; syncs: number; secrets: number; workloads: number } {
    const count = (t: NodeType) => graph.nodes.filter((n) => n.type === t).length;
    return { servers: count('server'), syncs: count('sync'), secrets: count('secret'), workloads: count('workload') };
}

export { shortAddress };
