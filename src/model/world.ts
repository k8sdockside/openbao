// Everything read from the cluster, turned into the model the pages draw.
//
// `derive` is pure: the lists and the API readings go in, and what comes out
// is the same for the same input, so the tests build worlds from fixtures and
// the pages build them from the bridge.

import { clusterFor, shortAddress } from './address.js';
import type { ApiReading } from './api.js';
import { providerClasses, type ProviderClass } from './csi.js';
import { secretsOf, usersBySecret, workloads, type Workload } from './consumers.js';
import { externalItems, storeOf, vaultStores, type ExternalItem, type VaultStore } from './eso.js';
import { injectedPods, injectors, type InjectedPod, type Injector } from './injector.js';
import { buildClusters, type ServerCluster } from './servers.js';
import {
    key,
    type Deployment,
    type ExternalSecret,
    type KubeNode,
    type MutatingWebhookConfiguration,
    type Pod,
    type SecretProviderClass,
    type SecretStore,
    type StatefulSet,
    type VaultAuth,
    type VaultAuthGlobal,
    type VaultConnection,
    type VaultDynamicSecret,
    type VaultPKISecret,
    type VaultStaticSecret,
} from './types.js';
import { authInfo, connectionInfo, operatorNamespace, refKey, syncItems, type AuthInfo, type ConnectionInfo, type SyncItem } from './vso.js';

export interface Snapshot {
    pods: Pod[];
    statefulsets?: StatefulSet[];
    deployments?: Deployment[];
    nodes?: KubeNode[];
    webhooks?: MutatingWebhookConfiguration[];
    connections?: VaultConnection[];
    auths?: VaultAuth[];
    authGlobals?: VaultAuthGlobal[];
    statics?: VaultStaticSecret[];
    dynamics?: VaultDynamicSecret[];
    pkis?: VaultPKISecret[];
    secretStores?: SecretStore[];
    clusterSecretStores?: SecretStore[];
    externalSecrets?: ExternalSecret[];
    providerClasses?: SecretProviderClass[];
    readings?: ApiReading[];
    /** Which optional APIs the cluster serves: an absent CRD is not an empty list. */
    served?: { vso?: boolean; eso?: boolean; csi?: boolean };
}

/** Where a client's secrets come from: a cluster in view, or an address outside it. */
export interface Source {
    id: string;
    cluster?: ServerCluster;
    address?: string;
    label: string;
}

export interface World {
    now: number;
    clusters: ServerCluster[];
    operatorNamespace: string;
    items: SyncItem[];
    auths: AuthInfo[];
    connections: ConnectionInfo[];
    injectors: Injector[];
    injected: InjectedPod[];
    stores: VaultStore[];
    externals: ExternalItem[];
    classes: ProviderClass[];
    workloads: Map<string, Workload>;
    /** Workloads by the `namespace/name` of a Secret they use. */
    users: Map<string, Workload[]>;
    served: { vso: boolean; eso: boolean; csi: boolean };
    /** Whether there is anything at all for this plugin to show. */
    anything: boolean;
}

export function derive(snap: Snapshot, now: number): World {
    const clusters = buildClusters({ pods: snap.pods, statefulsets: snap.statefulsets, nodes: snap.nodes, readings: snap.readings });
    const opNs = operatorNamespace(snap.deployments ?? [], snap.connections ?? [], snap.auths ?? []);
    const items = syncItems({ statics: snap.statics, dynamics: snap.dynamics, pkis: snap.pkis }, opNs, now);
    const auths = (snap.auths ?? []).map((a) => authInfo(a, snap.authGlobals ?? [], opNs));
    const connections = (snap.connections ?? []).map(connectionInfo);
    const stores = vaultStores(snap.secretStores ?? [], snap.clusterSecretStores ?? []);
    const externals = externalItems(snap.externalSecrets ?? [], stores);
    const classes = providerClasses(snap.providerClasses ?? []);
    const all = workloads(snap.pods);
    const world: World = {
        now,
        clusters,
        operatorNamespace: opNs,
        items,
        auths,
        connections,
        injectors: injectors(snap.deployments ?? [], snap.webhooks ?? []),
        injected: injectedPods(snap.pods),
        stores,
        externals,
        classes,
        workloads: all,
        users: usersBySecret(all),
        served: { vso: snap.served?.vso ?? items.length > 0, eso: snap.served?.eso ?? stores.length > 0, csi: snap.served?.csi ?? classes.length > 0 },
        anything: false,
    };
    world.anything = clusters.length > 0 || items.length > 0 || world.injected.length > 0 || world.injectors.length > 0 || stores.length > 0 || classes.length > 0 || connections.length > 0;
    return world;
}

// ----- following the references ------------------------------------------------------

export function authOf(world: World, item: SyncItem): AuthInfo | undefined {
    return world.auths.find((a) => a.namespace === item.auth.namespace && a.name === item.auth.name);
}

export function connectionOf(world: World, auth: AuthInfo | undefined): ConnectionInfo | undefined {
    if (!auth) return undefined;
    return world.connections.find((c) => c.namespace === auth.connection.namespace && c.name === auth.connection.name);
}

/** A source for an address, as the flow draws it. */
export function sourceFor(world: World, address: string | undefined, namespace: string): Source {
    const cluster = clusterFor(address, namespace, world.clusters);
    if (cluster) return { id: `srv:${cluster.id}`, cluster, address, label: cluster.name };
    if (address) return { id: `ext:${shortAddress(address)}`, address, label: shortAddress(address) };
    // Nothing names the server. With a single cluster in view it is the
    // obvious guess, and no guess at all is better than a wrong one otherwise.
    if (world.clusters.length === 1 && world.clusters[0]) return { id: `srv:${world.clusters[0].id}`, cluster: world.clusters[0], label: world.clusters[0].name };
    return { id: 'ext:unknown', label: 'unknown server' };
}

/** Where a VSO secret's data comes from: its auth's connection's address. */
export function sourceOfItem(world: World, item: SyncItem): Source {
    const auth = authOf(world, item);
    const connection = connectionOf(world, auth);
    return sourceFor(world, connection?.address, connection?.namespace ?? item.namespace);
}

export function sourceOfStore(world: World, store: VaultStore): Source {
    return sourceFor(world, store.server, store.namespace);
}

export function sourceOfInjection(world: World, pod: InjectedPod): Source {
    const address = pod.injection.service ?? world.injectors.find((i) => i.address)?.address;
    return sourceFor(world, address, pod.namespace);
}

export function sourceOfClass(world: World, c: ProviderClass): Source {
    return sourceFor(world, c.address, c.namespace);
}

/** The workloads using a VSO secret's destination, plus its rollout-restart targets. */
export function consumersOfItem(world: World, item: SyncItem): Workload[] {
    return world.users.get(key(item.namespace, item.destination)) ?? [];
}

export function storeOfExternal(world: World, e: ExternalItem): VaultStore | undefined {
    return storeOf(e, world.stores);
}

/** Every VSO secret that reads through an auth. */
export function itemsOfAuth(world: World, auth: AuthInfo): SyncItem[] {
    return world.items.filter((i) => refKey(i.auth) === key(auth.namespace, auth.name));
}

/** What a pod gets from OpenBao or Vault, however it gets it. */
export interface PodSupply {
    via: 'vso' | 'eso' | 'csi' | 'agent';
    /** The Kubernetes Secret it reads, when it reads one. */
    secret?: string;
    /** The object doing the syncing or the mounting. */
    ref?: K8sDockside.ObjectRef;
    what: string;
    paths: string[];
    tone: SyncItem['tone'];
    words: string;
    source: Source;
}

export function supplyOfPod(world: World, pod: Pod): PodSupply[] {
    const namespace = pod.metadata.namespace ?? '';
    const out: PodSupply[] = [];
    const used = new Set(secretsOf(pod));
    for (const item of world.items) {
        if (item.namespace !== namespace || !used.has(item.destination)) continue;
        out.push({ via: 'vso', secret: item.destination, ref: item.ref, what: `${item.kind === 'pki' ? 'VaultPKISecret' : item.kind === 'dynamic' ? 'VaultDynamicSecret' : 'VaultStaticSecret'} ${item.name}`, paths: [item.location], tone: item.tone, words: item.words, source: sourceOfItem(world, item) });
    }
    for (const e of world.externals) {
        if (e.namespace !== namespace || !used.has(e.target)) continue;
        const store = storeOfExternal(world, e);
        out.push({ via: 'eso', secret: e.target, ref: e.ref, what: `ExternalSecret ${e.name}`, paths: e.keys.map((k) => (store?.path ? `${store.path}/${k}` : k)), tone: e.tone, words: e.words, source: store ? sourceOfStore(world, store) : sourceFor(world, undefined, namespace) });
    }
    const mounted = (pod.spec?.volumes ?? []).map((v) => v.csi?.volumeAttributes?.['secretProviderClass']).filter(Boolean);
    for (const c of world.classes) {
        if (c.namespace !== namespace || !mounted.includes(c.name)) continue;
        out.push({ via: 'csi', ref: c.ref, what: `SecretProviderClass ${c.name}`, paths: c.paths, tone: 'ok', words: 'mounted', source: sourceOfClass(world, c) });
    }
    const injected = world.injected.find((p) => p.namespace === namespace && p.name === pod.metadata.name);
    if (injected) {
        out.push({ via: 'agent', what: `agent${injected.injection.role ? `, role ${injected.injection.role}` : ''}`, paths: injected.injection.secrets.map((s) => s.path), tone: injected.tone, words: injected.words, source: sourceOfInjection(world, injected) });
    }
    return out;
}
