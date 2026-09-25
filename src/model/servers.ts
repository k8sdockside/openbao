// Server pods, grouped into clusters, with each node's seal state and role.
//
// Two sources, and they are combined rather than chosen between:
//
//  - The pods' own labels. With `service_registration "kubernetes"` -- which
//    both charts put in their HA config -- every server keeps
//    <product>-sealed, -initialized, -active, -perf-standby and -version on
//    its own pod, current to within a few seconds. They are per node, which
//    the API through a Service can never be.
//  - The API, unauthenticated, through the leader's Service and the main one
//    (see api.ts). It adds what labels do not carry: the seal's threshold and
//    shares, unseal progress, the storage type, the cluster's name and where
//    the leader is. When the pods carry no labels (a dev server, a config
//    without service registration), it is also the only word on the seal,
//    and it is applied to a node only where it can be pinned to one: the
//    leader by its address, or a cluster of a single pod.
//
// When neither can be had, the node is drawn as "running" with its readiness
// and nothing is guessed.

import { leaderHost, serviceBase, serviceParts, type ApiReading, type SealStatus } from './api.js';
import { cli, containersProduct, detectProduct, imageVersion, isServerPod, normaliseVersion, productName, REG, serverContainer, type Product } from './product.js';
import { condition, key, KIND, type KubeNode, type Pod, type StatefulSet, type Tone } from './types.js';
import { plural } from './units.js';

export type Role = 'active' | 'standby' | 'perf-standby' | 'sealed' | 'uninitialized' | 'down' | 'running' | 'pending';

export interface ServerNode {
    name: string;
    namespace: string;
    product: Product;
    ref: K8sDockside.ObjectRef;
    ready: boolean;
    phase: string;
    restarts: number;
    nodeName?: string;
    zone?: string;
    version?: string;
    image?: string;
    sealed?: boolean;
    initialized?: boolean;
    active?: boolean;
    perfStandby?: boolean;
    /** Where the seal state came from. */
    source: 'labels' | 'api' | 'none';
    role: Role;
    tone: Tone;
    words: string;
    /** The node the leader address names, or the active one. */
    leader: boolean;
}

export type Lock = 'open' | 'partial' | 'closed' | 'uninitialized' | 'unknown';

export interface SealFacts {
    /** shamir, or an auto-unseal: transit, awskms, gcpckms, azurekeyvault, pkcs11 ... */
    type?: string;
    auto: boolean;
    /** Key shares needed. */
    t?: number;
    /** Key shares that exist. */
    n?: number;
    /** Shares entered so far on a sealed node. */
    progress?: number;
    /** The node the progress is for, when it can be told. */
    progressNode?: string;
}

export interface ServerCluster {
    id: string;
    namespace: string;
    name: string;
    product: Product;
    /** The StatefulSet, or the lone pod, to open. */
    ref: K8sDockside.ObjectRef;
    nodes: ServerNode[];
    desired?: number;
    active?: ApiReading;
    main?: ApiReading;
    /** Why the API could not be asked about this cluster, when it could not. */
    apiError?: string;
    seal: SealFacts;
    ha?: boolean;
    storage?: string;
    clusterName?: string;
    leaderAddress?: string;
    leaderName?: string;
    version?: string;
    versions: string[];
    drift: boolean;
    counts: { total: number; ready: number; sealed: number; unsealed: number; uninitialized: number; down: number; unknown: number };
    lock: Lock;
    tone: Tone;
    words: string;
    sentence: string;
    cli: string;
}

export interface ServerInputs {
    pods: Pod[];
    statefulsets?: StatefulSet[];
    nodes?: KubeNode[];
    readings?: ApiReading[];
}

const ZONE = 'topology.kubernetes.io/zone';

function flag(value: string | undefined): boolean | undefined {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return undefined;
}

function podReady(pod: Pod): boolean {
    return condition(pod.status?.conditions, 'Ready')?.status === 'True';
}

/** The role a node's state adds up to, most serious first. */
export function roleOf(node: Pick<ServerNode, 'phase' | 'initialized' | 'sealed' | 'active' | 'perfStandby' | 'ready'>): Role {
    if (node.phase !== 'Running') return node.phase === 'Pending' ? 'pending' : 'down';
    if (node.initialized === false) return 'uninitialized';
    if (node.sealed === true) return 'sealed';
    if (node.active === true) return 'active';
    if (node.perfStandby === true) return 'perf-standby';
    if (node.sealed === false) return 'standby';
    return node.ready ? 'running' : 'pending';
}

export const ROLE_WORDS: Record<Role, string> = {
    active: 'active',
    standby: 'standby',
    'perf-standby': 'performance standby',
    sealed: 'sealed',
    uninitialized: 'not initialised',
    down: 'not running',
    running: 'running',
    pending: 'starting',
};

function roleTone(role: Role, ready: boolean): Tone {
    switch (role) {
        case 'sealed':
        case 'down':
            return 'error';
        case 'uninitialized':
        case 'pending':
            return 'warn';
        case 'active':
        case 'standby':
        case 'perf-standby':
            return ready ? 'ok' : 'warn';
        default:
            return ready ? 'ok' : 'warn';
    }
}

function settle(node: ServerNode): void {
    node.role = roleOf(node);
    node.tone = roleTone(node.role, node.ready);
    node.words = ROLE_WORDS[node.role];
}

/** One server pod as a node, from its labels alone. */
export function nodeOf(pod: Pod, zones: Map<string, string>): ServerNode {
    const product = detectProduct(pod);
    const labels = pod.metadata.labels ?? {};
    const reg = REG[product === 'vault' ? 'vault' : 'openbao'];
    const container = serverContainer(pod);
    const sealed = flag(labels[reg.sealed]);
    const initialized = flag(labels[reg.initialized]);
    const namespace = pod.metadata.namespace ?? '';
    const node: ServerNode = {
        name: pod.metadata.name,
        namespace,
        product,
        ref: { kind: KIND.pods, namespace, name: pod.metadata.name },
        ready: podReady(pod),
        phase: pod.status?.phase ?? 'Unknown',
        restarts: (pod.status?.containerStatuses ?? []).reduce((n, c) => n + (c.restartCount ?? 0), 0),
        nodeName: pod.spec?.nodeName,
        zone: pod.spec?.nodeName ? zones.get(pod.spec.nodeName) : undefined,
        version: normaliseVersion(labels[reg.version]) ?? normaliseVersion(imageVersion(container?.image)),
        image: container?.image,
        sealed,
        initialized,
        active: flag(labels[reg.active]),
        perfStandby: flag(labels[reg.perfStandby]),
        source: sealed !== undefined || initialized !== undefined ? 'labels' : 'none',
        role: 'running',
        tone: '',
        words: '',
        leader: false,
    };
    node.leader = node.active === true;
    settle(node);
    return node;
}

/** What groups pods into one cluster: their StatefulSet, else the Helm release, else the pod itself. */
function groupOf(pod: Pod): { name: string; ref: K8sDockside.ObjectRef } {
    const namespace = pod.metadata.namespace ?? '';
    const owner = (pod.metadata.ownerReferences ?? []).find((o) => o.kind === 'StatefulSet');
    if (owner) return { name: owner.name, ref: { kind: KIND.statefulsets, namespace, name: owner.name } };
    const instance = pod.metadata.labels?.['app.kubernetes.io/instance'];
    if (instance) return { name: instance, ref: { kind: KIND.pods, namespace, name: pod.metadata.name } };
    return { name: pod.metadata.name, ref: { kind: KIND.pods, namespace, name: pod.metadata.name } };
}

/** Which cluster an API reading is about: by the Service's name, then by namespace and product. */
export function readingCluster(reading: ApiReading, clusters: ServerCluster[]): ServerCluster | undefined {
    const parts = serviceParts(reading.service);
    if (!parts) return undefined;
    const base = serviceBase(parts.name);
    const exact = clusters.find((c) => c.namespace === parts.namespace && c.name === base);
    if (exact) return exact;
    const sameNs = clusters.filter((c) => c.namespace === parts.namespace && (c.product === reading.product || c.product === 'unknown'));
    if (sameNs.length === 1) return sameNs[0];
    return undefined;
}

function applyApi(cluster: ServerCluster): void {
    const active = cluster.active;
    const main = cluster.main;
    const seal: SealStatus | undefined = active?.seal ?? main?.seal;

    if (seal) {
        cluster.seal.type = seal.type;
        cluster.seal.auto = !!seal.type && seal.type !== 'shamir';
        cluster.seal.t = seal.t;
        cluster.seal.n = seal.n;
        cluster.storage = seal.storage_type;
        cluster.clusterName = seal.cluster_name || undefined;
        cluster.version = normaliseVersion(seal.version);
    }
    const health = active?.health ?? main?.health;
    if (!cluster.clusterName && health?.cluster_name) cluster.clusterName = health.cluster_name;
    if (!cluster.version && health?.version) cluster.version = normaliseVersion(health.version);

    const leader = active?.leader ?? main?.leader;
    if (leader) {
        cluster.ha = leader.ha_enabled;
        cluster.leaderAddress = leader.leader_address || undefined;
        const host = leaderHost(leader.leader_address);
        if (host && cluster.nodes.some((n) => n.name === host)) cluster.leaderName = host;
    }

    // Unseal progress belongs to the node that answered, and only a sealed
    // node has any. It can be pinned to a node when that node is the only
    // sealed one, or the only one there is.
    const sealedAnswer = [main?.seal, active?.seal].find((s) => s?.sealed === true);
    if (sealedAnswer) {
        cluster.seal.progress = sealedAnswer.progress ?? 0;
        if (cluster.seal.t === undefined) cluster.seal.t = sealedAnswer.t;
        if (cluster.seal.n === undefined) cluster.seal.n = sealedAnswer.n;
        const sealedNodes = cluster.nodes.filter((n) => n.sealed === true);
        if (sealedNodes.length === 1) cluster.seal.progressNode = sealedNodes[0]?.name;
        else if (cluster.nodes.length === 1) cluster.seal.progressNode = cluster.nodes[0]?.name;
    }

    // The nodes the labels said nothing about.
    for (const node of cluster.nodes) {
        if (node.source !== 'none') continue;
        if (cluster.leaderName === node.name) {
            Object.assign(node, { sealed: false, initialized: true, active: true, source: 'api' as const });
        } else if (cluster.nodes.length === 1) {
            const answer = main?.seal ?? active?.seal;
            if (answer) {
                node.sealed = answer.sealed;
                node.initialized = answer.initialized;
                const code = main?.healthCode ?? active?.healthCode;
                node.active = answer.sealed ? false : code === 200 || (code === undefined && (health?.standby === false || leader?.is_self === true || leader?.ha_enabled === false));
                node.perfStandby = code === 473 || health?.performance_standby === true;
                node.source = 'api';
            }
        }
        settle(node);
    }
    for (const node of cluster.nodes) if (cluster.leaderName === node.name) node.leader = true;
}

function describe(cluster: ServerCluster): void {
    const c = cluster.counts;
    const name = productName(cluster.product);
    const leader = cluster.nodes.find((n) => n.role === 'active');
    const standbys = cluster.nodes.filter((n) => n.role === 'standby' || n.role === 'perf-standby');
    const sealedNames = cluster.nodes.filter((n) => n.role === 'sealed').map((n) => n.name);
    const t = cluster.seal.t;
    const keys = t ? plural(t, 'unseal key') : 'the unseal keys';

    if (cluster.lock === 'uninitialized') {
        cluster.tone = 'error';
        cluster.words = 'Not initialised';
        cluster.sentence = `Nobody has run ${cluster.cli} operator init on it, so it holds no secrets and serves no one.`;
        return;
    }
    if (cluster.lock === 'closed') {
        cluster.tone = 'error';
        cluster.words = c.total === 1 ? 'Sealed' : 'All sealed';
        cluster.sentence = cluster.seal.auto
            ? `Every node is sealed and waiting for its ${cluster.seal.type} auto-unseal to answer. Nothing can read a secret until it does.`
            : `Every node is sealed. Nothing can read a secret until ${keys} are entered on ${c.total === 1 ? 'it' : 'each node'}.`;
        return;
    }
    if (c.total === 0) {
        cluster.tone = 'error';
        cluster.words = 'No pods';
        cluster.sentence = `The StatefulSet has no ${name} pods running.`;
        return;
    }
    if (cluster.lock === 'partial') {
        cluster.tone = 'warn';
        cluster.words = `${c.sealed} of ${c.total} sealed`;
        cluster.sentence = leader
            ? `Serving from ${leader.name}. ${sealedNames.join(', ')} ${sealedNames.length === 1 ? 'is' : 'are'} sealed and cannot take over if the leader goes.`
            : `${sealedNames.join(', ')} ${sealedNames.length === 1 ? 'is' : 'are'} sealed, and no node says it is the leader.`;
        return;
    }
    if (cluster.lock === 'open' && cluster.nodes.length > 1 && !leader && cluster.ha !== false) {
        cluster.tone = 'error';
        cluster.words = 'No leader';
        cluster.sentence = 'Every node is unsealed, yet none of them is active: requests have nowhere to go until one is elected.';
        return;
    }
    if (c.down > 0 || c.ready < c.total) {
        cluster.tone = c.down > 0 ? 'error' : 'warn';
        cluster.words = `${c.ready} of ${c.total} ready`;
        cluster.sentence = leader ? `Serving from ${leader.name}, with ${plural(c.total - c.ready, 'node')} not ready.` : `${plural(c.total - c.ready, 'node')} not ready.`;
        return;
    }
    if (cluster.drift) {
        cluster.tone = 'warn';
        cluster.words = 'Mixed versions';
        cluster.sentence = `The nodes run ${cluster.versions.join(' and ')}: finish the upgrade, standbys first and the leader last.`;
        return;
    }
    if (cluster.lock === 'unknown') {
        cluster.tone = '';
        cluster.words = 'Seal state unknown';
        cluster.sentence = cluster.apiError
            ? `The pods carry no service-registration labels and the API could not be asked: ${cluster.apiError}`
            : 'The pods carry no service-registration labels, and no API answer could be pinned to them.';
        return;
    }
    cluster.tone = 'ok';
    cluster.words = 'Unsealed';
    if (c.total === 1) cluster.sentence = `One node, unsealed and serving${cluster.storage ? ` from ${cluster.storage} storage` : ''}.`;
    else cluster.sentence = `${leader?.name ?? 'The leader'} is active, with ${plural(standbys.length, 'standby', 'standbys')} ready to take over.`;
}

/** Every server cluster in the lists, with the API's answers laid over the labels. */
export function buildClusters(input: ServerInputs): ServerCluster[] {
    const zones = new Map<string, string>();
    for (const n of input.nodes ?? []) {
        const zone = n.metadata.labels?.[ZONE];
        if (zone) zones.set(n.metadata.name, zone);
    }
    const byId = new Map<string, ServerCluster>();
    for (const pod of input.pods) {
        if (!isServerPod(pod)) continue;
        const group = groupOf(pod);
        const namespace = pod.metadata.namespace ?? '';
        const id = key(namespace, group.name);
        const node = nodeOf(pod, zones);
        let cluster = byId.get(id);
        if (!cluster) {
            cluster = {
                id,
                namespace,
                name: group.name,
                product: node.product,
                ref: group.ref,
                nodes: [],
                seal: { auto: false },
                versions: [],
                drift: false,
                counts: { total: 0, ready: 0, sealed: 0, unsealed: 0, uninitialized: 0, down: 0, unknown: 0 },
                lock: 'unknown',
                tone: '',
                words: '',
                sentence: '',
                cli: cli(node.product),
            };
            byId.set(id, cluster);
        }
        if (cluster.product === 'unknown' && node.product !== 'unknown') {
            cluster.product = node.product;
            cluster.cli = cli(node.product);
        }
        cluster.nodes.push(node);
    }

    // A StatefulSet whose pods are all gone is a cluster too: the worst kind.
    for (const sts of input.statefulsets ?? []) {
        const namespace = sts.metadata.namespace ?? '';
        const id = key(namespace, sts.metadata.name);
        const existing = byId.get(id);
        if (existing) {
            existing.desired = sts.spec?.replicas;
            continue;
        }
        const product = containersProduct(sts.spec?.template?.spec?.containers);
        const chart = sts.metadata.labels?.['app.kubernetes.io/name'];
        if (product === 'unknown' && chart !== 'openbao' && chart !== 'vault') continue;
        const which: Product = product !== 'unknown' ? product : chart === 'vault' ? 'vault' : 'openbao';
        byId.set(id, {
            id,
            namespace,
            name: sts.metadata.name,
            product: which,
            ref: { kind: KIND.statefulsets, namespace, name: sts.metadata.name },
            nodes: [],
            desired: sts.spec?.replicas,
            seal: { auto: false },
            versions: [],
            drift: false,
            counts: { total: 0, ready: 0, sealed: 0, unsealed: 0, uninitialized: 0, down: 0, unknown: 0 },
            lock: 'unknown',
            tone: '',
            words: '',
            sentence: '',
            cli: cli(which),
        });
    }

    const clusters = [...byId.values()].sort((a, b) => a.namespace.localeCompare(b.namespace) || a.name.localeCompare(b.name));
    for (const cluster of clusters) {
        cluster.nodes.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    }

    // Lay each API answer over the cluster it is about.
    const readings = input.readings ?? [];
    for (const reading of readings) {
        if (reading.error) continue;
        const cluster = readingCluster(reading, clusters);
        if (!cluster) continue;
        if (reading.via === 'active' && !cluster.active) cluster.active = reading;
        if (reading.via === 'main' && !cluster.main) cluster.main = reading;
    }

    for (const cluster of clusters) {
        if (!cluster.active && !cluster.main) {
            const failed = readings.find((r) => r.product === cluster.product && r.error);
            const answered = readings.find((r) => r.product === cluster.product && !r.error);
            cluster.apiError = failed?.error
                ? failed.error
                : answered
                  ? `the ${productName(cluster.product)} API answered from ${answered.service}, which is another cluster: the app calls the first matching Service it finds`
                  : undefined;
        }
        applyApi(cluster);

        const c = cluster.counts;
        c.total = cluster.nodes.length;
        c.ready = cluster.nodes.filter((n) => n.ready).length;
        c.sealed = cluster.nodes.filter((n) => n.role === 'sealed').length;
        c.unsealed = cluster.nodes.filter((n) => n.sealed === false).length;
        c.uninitialized = cluster.nodes.filter((n) => n.role === 'uninitialized').length;
        c.down = cluster.nodes.filter((n) => n.role === 'down').length;
        c.unknown = cluster.nodes.filter((n) => n.sealed === undefined && n.role !== 'down').length;

        const versions = new Set<string>();
        for (const n of cluster.nodes) if (n.version) versions.add(n.version);
        cluster.versions = [...versions].sort();
        cluster.drift = cluster.versions.length > 1;
        if (!cluster.version) cluster.version = cluster.versions.length === 1 ? cluster.versions[0] : undefined;

        const apiUninit = (cluster.active?.seal ?? cluster.main?.seal)?.initialized === false;
        const known = c.total - c.unknown - c.down;
        if (c.uninitialized > 0 || apiUninit) cluster.lock = 'uninitialized';
        else if (known <= 0) cluster.lock = 'unknown';
        else if (c.sealed >= known && c.unsealed === 0) cluster.lock = 'closed';
        else if (c.sealed > 0) cluster.lock = 'partial';
        else cluster.lock = 'open';

        if (!cluster.leaderName) cluster.leaderName = cluster.nodes.find((n) => n.role === 'active')?.name;
        describe(cluster);
    }
    return clusters;
}
