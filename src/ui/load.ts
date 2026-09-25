// Reading everything the pages need, in one go.
//
// The lists are read in parallel and each may be refused -- the Secrets
// Operator, External Secrets and the CSI driver are all optional, and a role
// may not list Nodes or webhooks -- so a refused list is "not served" and
// the page draws without it.
//
// Then, for each product with a server cluster in view, the servers' own API
// is asked through the Services the manifest declares: the leader's
// (`bao-active`, `vault-active`) and the main one (`bao`, `vault`), each over
// http and, when there is no http port, over https. An API that cannot be
// reached leaves the labels to speak for the nodes; the reason is kept and
// shown on the cluster.

import { parseJSON, type ApiReading, type Health, type Leader, type SealStatus } from '../model/api.js';
import type { Product } from '../model/product.js';
import { KIND } from '../model/types.js';
import type {
    Deployment,
    ExternalSecret,
    KubeNode,
    MutatingWebhookConfiguration,
    Pod,
    SecretProviderClass,
    SecretStore,
    StatefulSet,
    VaultAuth,
    VaultAuthGlobal,
    VaultConnection,
    VaultDynamicSecret,
    VaultPKISecret,
    VaultStaticSecret,
} from '../model/types.js';
import { buildClusters } from '../model/servers.js';
import { derive, type Snapshot, type World } from '../model/world.js';
import { maybeList } from './page.js';

/** The service ids plugin.json declares, per product and route. */
export const SERVICE_IDS: Record<'openbao' | 'vault', Record<'active' | 'main', [string, string]>> = {
    openbao: { active: ['bao-active', 'bao-active-tls'], main: ['bao', 'bao-tls'] },
    vault: { active: ['vault-active', 'vault-active-tls'], main: ['vault', 'vault-tls'] },
};

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

async function ask(id: string, path: string): Promise<K8sDockside.ServiceAnswer> {
    const services = k8sdockside.services;
    if (!services) throw new Error('this version of K8s Dockside cannot call services in the cluster (0.0.27 and newer can)');
    return services.get({ service: id, path });
}

/** One reading through one route, trying http then https. */
async function reading(product: 'openbao' | 'vault', via: 'active' | 'main'): Promise<ApiReading> {
    const errors: string[] = [];
    for (const id of SERVICE_IDS[product][via]) {
        let seal: K8sDockside.ServiceAnswer;
        try {
            seal = await ask(id, '/v1/sys/seal-status');
        } catch (err) {
            errors.push(message(err));
            continue;
        }
        const out: ApiReading = { product, via, service: seal.service, seal: parseJSON<SealStatus>(seal.body) };
        if (!out.seal) {
            errors.push(`${seal.service} answered ${seal.status} with something that is not the seal status`);
            continue;
        }
        const [health, leader] = await Promise.all([ask(id, '/v1/sys/health').catch(() => undefined), ask(id, '/v1/sys/leader').catch(() => undefined)]);
        if (health) {
            out.health = parseJSON<Health>(health.body);
            out.healthCode = health.status;
        }
        if (leader && leader.status >= 200 && leader.status < 300) out.leader = parseJSON<Leader>(leader.body);
        return out;
    }
    // "No Service with that port" for the http route is expected when TLS is
    // on; the https route's reason is the interesting one then.
    const telling = errors.find((e) => !/^no service labelled/.test(e)) ?? errors[0] ?? 'no answer';
    return { product, via, error: telling };
}

/** Every reading worth taking for the products in view. */
export async function readings(products: Product[]): Promise<ApiReading[]> {
    const wanted = [...new Set(products)].filter((p): p is 'openbao' | 'vault' => p === 'openbao' || p === 'vault');
    const jobs = wanted.flatMap((p) => [reading(p, 'active'), reading(p, 'main')]);
    return Promise.all(jobs);
}

export interface Loaded {
    snap: Snapshot;
    world: World;
}

export interface LoadOptions {
    /** Ask the servers' API too (the dashboard and the cluster view do). */
    api?: boolean;
}

export async function load(options: LoadOptions = {}): Promise<Loaded> {
    const [pods, statefulsets, deployments, nodes, webhooks, connections, auths, authGlobals, statics, dynamics, pkis, secretStores, clusterSecretStores, externalSecrets, providerClasses] = await Promise.all([
        k8sdockside.list({ kind: KIND.pods }) as unknown as Promise<Pod[]>,
        maybeList<StatefulSet>({ kind: KIND.statefulsets }),
        maybeList<Deployment>({ kind: KIND.deployments }),
        maybeList<KubeNode>({ kind: KIND.nodes }),
        maybeList<MutatingWebhookConfiguration>({ kind: KIND.webhooks }),
        maybeList<VaultConnection>({ kind: KIND.connections }),
        maybeList<VaultAuth>({ kind: KIND.auths }),
        maybeList<VaultAuthGlobal>({ kind: KIND.authGlobals }),
        maybeList<VaultStaticSecret>({ kind: KIND.staticSecrets }),
        maybeList<VaultDynamicSecret>({ kind: KIND.dynamicSecrets }),
        maybeList<VaultPKISecret>({ kind: KIND.pkiSecrets }),
        maybeList<SecretStore>({ kind: KIND.secretStores }),
        maybeList<SecretStore>({ kind: KIND.clusterSecretStores }),
        maybeList<ExternalSecret>({ kind: KIND.externalSecrets }),
        maybeList<SecretProviderClass>({ kind: KIND.providerClasses }),
    ]);
    const snap: Snapshot = {
        pods,
        statefulsets: statefulsets ?? [],
        deployments: deployments ?? [],
        nodes: nodes ?? [],
        webhooks: webhooks ?? [],
        connections: connections ?? [],
        auths: auths ?? [],
        authGlobals: authGlobals ?? [],
        statics: statics ?? [],
        dynamics: dynamics ?? [],
        pkis: pkis ?? [],
        secretStores: secretStores ?? [],
        clusterSecretStores: clusterSecretStores ?? [],
        externalSecrets: externalSecrets ?? [],
        providerClasses: providerClasses ?? [],
        served: { vso: statics !== null || connections !== null, eso: externalSecrets !== null, csi: providerClasses !== null },
        readings: [],
    };
    if (options.api) {
        const clusters = buildClusters({ pods, statefulsets: snap.statefulsets });
        snap.readings = await readings(clusters.map((c) => c.product));
    }
    return { snap, world: derive(snap, Date.now()) };
}
