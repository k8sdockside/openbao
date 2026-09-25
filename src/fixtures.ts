// A cluster's worth of objects, shaped the way the charts, the servers and
// the operators really write them, for the render tests and `npm run
// preview`. Times are relative to when the module is loaded, so "expires in
// two days" stays true whenever it runs.
//
// What is in it, so every state has something to draw:
//
//   openbao/openbao        OpenBao 2.6.3, three raft nodes: openbao-0 active,
//                          openbao-1 standby, openbao-2 sealed with 2 of 3
//                          keys entered
//   vault/vault            Vault, three nodes unsealed by AWS KMS, one still
//                          on the old version
//   bao-staging/staging    OpenBao nobody has initialised yet
//   Secrets Operator       static secrets synced, failing (a bad path) and
//                          stale (spec changed); dynamic database and AWS
//                          credentials, one overdue for renewal; PKI
//                          certificates, one two days from expiry
//   agent injector         billing/invoicer injected, billing/reports asking
//                          and not injected
//   External Secrets       a ClusterSecretStore on OpenBao, one ExternalSecret
//                          synced and one failing
//   CSI                    an OpenBao SecretProviderClass mounted by ml/trainer

import { parseJSON, type ApiReading, type Health, type Leader, type SealStatus } from './model/api.js';
import { KIND } from './model/types.js';

const NOW = Date.now();
const S = 1000;
const MIN = 60 * S;
const H = 60 * MIN;
const D = 24 * H;
const iso = (offset: number) => new Date(NOW + offset).toISOString();
const unix = (offset: number) => Math.floor((NOW + offset) / 1000);

type Labels = Record<string, string>;

function cond(type: string, status: string, reason = '', message = '', ago = 10 * MIN) {
    return { type, status, reason, message, lastTransitionTime: iso(-ago) };
}

// ----- nodes --------------------------------------------------------------------

export const nodes = ['worker-a', 'worker-b', 'worker-c'].map((name, i) => ({
    apiVersion: 'v1',
    kind: 'Node',
    metadata: { name, labels: { 'kubernetes.io/hostname': name, 'topology.kubernetes.io/zone': `eu-north-1${'abc'[i]}` } },
}));

// ----- server pods ------------------------------------------------------------------

interface ServerPodOptions {
    namespace: string;
    set: string;
    ordinal: number;
    product: 'openbao' | 'vault';
    image: string;
    ready: boolean;
    labels?: Labels;
    node?: string;
    restarts?: number;
    phase?: string;
}

function serverPod(o: ServerPodOptions) {
    const name = `${o.set}-${o.ordinal}`;
    return {
        apiVersion: 'v1',
        kind: 'Pod',
        metadata: {
            name,
            namespace: o.namespace,
            uid: `${o.namespace}-${name}`,
            creationTimestamp: iso(-6 * D),
            labels: {
                'app.kubernetes.io/name': o.product,
                'app.kubernetes.io/instance': o.set,
                component: 'server',
                'statefulset.kubernetes.io/pod-name': name,
                ...(o.labels ?? {}),
            },
            ownerReferences: [{ apiVersion: 'apps/v1', kind: 'StatefulSet', name: o.set, controller: true }],
        },
        spec: {
            nodeName: o.node ?? nodes[o.ordinal % 3]?.metadata.name,
            serviceAccountName: o.set,
            containers: [{ name: o.product, image: o.image, args: ['server'] }],
        },
        status: {
            phase: o.phase ?? 'Running',
            conditions: [cond('Ready', o.ready ? 'True' : 'False', o.ready ? '' : 'ContainersNotReady')],
            containerStatuses: [{ name: o.product, ready: o.ready, restartCount: o.restarts ?? 0, image: o.image }],
        },
    };
}

const bao = (active: boolean, sealed: boolean, initialized = true): Labels => ({
    'openbao-active': String(active),
    'openbao-sealed': String(sealed),
    'openbao-initialized': String(initialized),
    'openbao-perf-standby': 'false',
    'openbao-version': '2.6.3',
});

const vaultLabels = (active: boolean, version: string): Labels => ({
    'vault-active': String(active),
    'vault-sealed': 'false',
    'vault-initialized': 'true',
    'vault-perf-standby': 'false',
    'vault-version': version,
});

const BAO_IMAGE = 'quay.io/openbao/openbao:2.6.3';

export const serverPods = [
    serverPod({ namespace: 'openbao', set: 'openbao', ordinal: 0, product: 'openbao', image: BAO_IMAGE, ready: true, labels: bao(true, false) }),
    serverPod({ namespace: 'openbao', set: 'openbao', ordinal: 1, product: 'openbao', image: BAO_IMAGE, ready: true, labels: bao(false, false) }),
    serverPod({ namespace: 'openbao', set: 'openbao', ordinal: 2, product: 'openbao', image: BAO_IMAGE, ready: false, restarts: 1, labels: bao(false, true) }),
    serverPod({ namespace: 'vault', set: 'vault', ordinal: 0, product: 'vault', image: 'hashicorp/vault:1.21.1', ready: true, labels: vaultLabels(true, '1.21.1') }),
    serverPod({ namespace: 'vault', set: 'vault', ordinal: 1, product: 'vault', image: 'hashicorp/vault:1.21.1', ready: true, labels: vaultLabels(false, '1.21.1') }),
    serverPod({ namespace: 'vault', set: 'vault', ordinal: 2, product: 'vault', image: 'hashicorp/vault:1.21.0', ready: true, labels: vaultLabels(false, '1.21.0') }),
    serverPod({ namespace: 'bao-staging', set: 'staging', ordinal: 0, product: 'openbao', image: BAO_IMAGE, ready: false, labels: bao(false, true, false) }),
];

export const statefulsets = [
    { apiVersion: 'apps/v1', kind: 'StatefulSet', metadata: { name: 'openbao', namespace: 'openbao', labels: { 'app.kubernetes.io/name': 'openbao' } }, spec: { replicas: 3, serviceName: 'openbao-internal', template: { spec: { containers: [{ name: 'openbao', image: BAO_IMAGE }] } } }, status: { replicas: 3, readyReplicas: 2 } },
    { apiVersion: 'apps/v1', kind: 'StatefulSet', metadata: { name: 'vault', namespace: 'vault', labels: { 'app.kubernetes.io/name': 'vault' } }, spec: { replicas: 3, serviceName: 'vault-internal', template: { spec: { containers: [{ name: 'vault', image: 'hashicorp/vault:1.21.1' }] } } }, status: { replicas: 3, readyReplicas: 3 } },
    { apiVersion: 'apps/v1', kind: 'StatefulSet', metadata: { name: 'staging', namespace: 'bao-staging', labels: { 'app.kubernetes.io/name': 'openbao' } }, spec: { replicas: 1, serviceName: 'staging-internal', template: { spec: { containers: [{ name: 'openbao', image: BAO_IMAGE }] } } }, status: { replicas: 1, readyReplicas: 0 } },
];

// ----- what the API answers ------------------------------------------------------------

const json = (value: unknown) => JSON.stringify(value);

/**
 * The declared services' answers, by service id and path. A service that is
 * not here rejects the way the app does when no Service matches.
 */
export const services: Record<string, { service: string; answers: Record<string, { status: number; body: string }> }> = {
    'bao-active': {
        service: 'openbao/openbao-active:http',
        answers: {
            '/v1/sys/seal-status': { status: 200, body: json({ type: 'shamir', initialized: true, sealed: false, t: 3, n: 5, progress: 0, nonce: '', version: '2.6.3', build_date: '2026-08-20T11:02:13Z', migration: false, cluster_name: 'openbao-prod', cluster_id: '5f1c0e2a-8a55-4d0c-9d57-c0a0f1b0a111', recovery_seal: false, storage_type: 'raft' }) },
            '/v1/sys/health': { status: 200, body: json({ initialized: true, sealed: false, standby: false, performance_standby: false, server_time_utc: unix(0), version: '2.6.3', cluster_name: 'openbao-prod' }) },
            '/v1/sys/leader': { status: 200, body: json({ ha_enabled: true, is_self: true, active_time: iso(-5 * D), leader_address: 'http://openbao-0.openbao-internal:8200', leader_cluster_address: 'https://openbao-0.openbao-internal:8201', raft_committed_index: 48213, raft_applied_index: 48213 }) },
        },
    },
    // The main Service happened to land on the sealed node.
    bao: {
        service: 'openbao/openbao:http',
        answers: {
            '/v1/sys/seal-status': { status: 200, body: json({ type: 'shamir', initialized: true, sealed: true, t: 3, n: 5, progress: 2, nonce: 'b1d0', version: '2.6.3', migration: false, recovery_seal: false, storage_type: 'raft' }) },
            '/v1/sys/health': { status: 503, body: json({ initialized: true, sealed: true, standby: true, version: '2.6.3' }) },
            '/v1/sys/leader': { status: 503, body: json({ errors: ['Vault is sealed'] }) },
        },
    },
    'vault-active-tls': {
        service: 'vault/vault-active:https',
        answers: {
            '/v1/sys/seal-status': { status: 200, body: json({ type: 'awskms', initialized: true, sealed: false, t: 3, n: 5, progress: 0, version: '1.21.1', cluster_name: 'vault-cluster-7d2e', recovery_seal: true, recovery_seal_type: 'shamir', storage_type: 'raft' }) },
            '/v1/sys/health': { status: 200, body: json({ initialized: true, sealed: false, standby: false, version: '1.21.1', cluster_name: 'vault-cluster-7d2e' }) },
            '/v1/sys/leader': { status: 200, body: json({ ha_enabled: true, is_self: true, leader_address: 'https://vault-0.vault-internal:8200' }) },
        },
    },
};

/** The fixture services' answers as the loader turns them into readings. */
export function fixtureReadings(): ApiReading[] {
    const out: ApiReading[] = [];
    const routes: [string, 'openbao' | 'vault', 'active' | 'main'][] = [
        ['bao-active', 'openbao', 'active'],
        ['bao', 'openbao', 'main'],
        ['vault-active-tls', 'vault', 'active'],
    ];
    for (const [id, product, via] of routes) {
        const s = services[id];
        if (!s) continue;
        const health = s.answers['/v1/sys/health'];
        const leader = s.answers['/v1/sys/leader'];
        out.push({
            product,
            via,
            service: s.service,
            seal: parseJSON<SealStatus>(s.answers['/v1/sys/seal-status']?.body),
            health: parseJSON<Health>(health?.body),
            healthCode: health?.status,
            leader: leader && leader.status === 200 ? parseJSON<Leader>(leader.body) : undefined,
        });
    }
    out.push({ product: 'vault', via: 'main', error: 'no service labelled app.kubernetes.io/name=vault with a port http in any namespace -- is Vault installed?' });
    return out;
}

// ----- the agent injector ------------------------------------------------------------------

export const injectorDeployment = {
    apiVersion: 'apps/v1',
    kind: 'Deployment',
    metadata: { name: 'openbao-agent-injector', namespace: 'openbao', labels: { 'app.kubernetes.io/name': 'openbao-agent-injector', 'app.kubernetes.io/instance': 'openbao', component: 'webhook' } },
    spec: { replicas: 1, template: { spec: { containers: [{ name: 'sidecar-injector', image: 'docker.io/hashicorp/vault-k8s:1.7.2', env: [{ name: 'AGENT_INJECT_VAULT_ADDR', value: 'http://openbao.openbao.svc:8200' }] }] } } },
    status: { replicas: 1, readyReplicas: 1 },
};

export const vsoDeployment = {
    apiVersion: 'apps/v1',
    kind: 'Deployment',
    metadata: { name: 'vault-secrets-operator-controller-manager', namespace: 'vault-secrets-operator-system', labels: { 'app.kubernetes.io/name': 'vault-secrets-operator', control: 'controller-manager' } },
    spec: { replicas: 1 },
    status: { replicas: 1, readyReplicas: 1 },
};

export const webhooks = [
    {
        apiVersion: 'admissionregistration.k8s.io/v1',
        kind: 'MutatingWebhookConfiguration',
        metadata: { name: 'openbao-agent-injector-cfg', labels: { 'app.kubernetes.io/name': 'openbao-agent-injector' } },
        webhooks: [{ name: 'vault.hashicorp.com', failurePolicy: 'Ignore', clientConfig: { service: { name: 'openbao-agent-injector-svc', namespace: 'openbao' } } }],
    },
];

// ----- workloads -------------------------------------------------------------------------------

interface AppPodOptions {
    namespace: string;
    deployment: string;
    index: number;
    ready?: boolean;
    phase?: string;
    envFrom?: string[];
    env?: [string, string][];
    volumes?: string[];
    csi?: string;
    annotations?: Labels;
}

function appPod(o: AppPodOptions) {
    const hash = '7c9f8d6b5';
    const name = `${o.deployment}-${hash}-${'xkq2z'.slice(0, 4)}${o.index}`;
    return {
        apiVersion: 'v1',
        kind: 'Pod',
        metadata: {
            name,
            namespace: o.namespace,
            uid: `${o.namespace}-${name}`,
            labels: { app: o.deployment, 'pod-template-hash': hash },
            annotations: o.annotations ?? {},
            ownerReferences: [{ apiVersion: 'apps/v1', kind: 'ReplicaSet', name: `${o.deployment}-${hash}`, controller: true }],
        },
        spec: {
            nodeName: nodes[o.index % 3]?.metadata.name,
            serviceAccountName: o.deployment,
            containers: [
                {
                    name: 'app',
                    image: `registry.example.com/${o.deployment}:1.4.0`,
                    envFrom: (o.envFrom ?? []).map((name) => ({ secretRef: { name } })),
                    env: (o.env ?? []).map(([secret, key]) => ({ name: key.toUpperCase(), valueFrom: { secretKeyRef: { name: secret, key } } })),
                },
            ],
            volumes: [
                ...(o.volumes ?? []).map((secretName) => ({ name: secretName, secret: { secretName } })),
                ...(o.csi ? [{ name: 'secrets', csi: { driver: 'secrets-store.csi.k8s.io', readOnly: true, volumeAttributes: { secretProviderClass: o.csi } } }] : []),
            ],
        },
        status: {
            phase: o.phase ?? 'Running',
            conditions: [cond('Ready', o.ready === false ? 'False' : 'True')],
        },
    };
}

const agent = (role: string, secrets: Record<string, string>, injected: boolean): Labels => ({
    'vault.hashicorp.com/agent-inject': 'true',
    'vault.hashicorp.com/role': role,
    ...(injected ? { 'vault.hashicorp.com/agent-inject-status': 'injected' } : {}),
    ...Object.fromEntries(Object.entries(secrets).map(([file, path]) => [`vault.hashicorp.com/agent-inject-secret-${file}`, path])),
    'vault.hashicorp.com/agent-inject-template-config': '{{ with secret "secret/data/billing/config" }}{{ .Data.data.url }}{{ end }}',
});

export const appPods = [
    appPod({ namespace: 'shop', deployment: 'web', index: 0, envFrom: ['app-config'], env: [['stripe-keys', 'api_key']], volumes: ['web-tls'] }),
    appPod({ namespace: 'shop', deployment: 'web', index: 1, envFrom: ['app-config'], env: [['stripe-keys', 'api_key']], volumes: ['web-tls'] }),
    appPod({ namespace: 'shop', deployment: 'worker', index: 0, envFrom: ['feature-flags', 'aws-creds'] }),
    appPod({ namespace: 'payments', deployment: 'api', index: 0, envFrom: ['db-creds'], env: [['db-static', 'password']], volumes: ['api-tls'] }),
    appPod({ namespace: 'payments', deployment: 'api', index: 1, envFrom: ['db-creds'], env: [['db-static', 'password']], volumes: ['api-tls'], ready: false }),
    appPod({ namespace: 'billing', deployment: 'invoicer', index: 0, annotations: agent('billing', { db: 'database/creds/billing', config: 'secret/data/billing/config' }, true) }),
    appPod({ namespace: 'billing', deployment: 'reports', index: 0, annotations: agent('billing', { report: 'secret/data/billing/reports' }, false) }),
    appPod({ namespace: 'analytics', deployment: 'etl', index: 0, envFrom: ['warehouse-creds'] }),
    appPod({ namespace: 'ml', deployment: 'trainer', index: 0, csi: 'model-keys' }),
];

export const pods = [...serverPods, ...appPods];

export const deployments = [
    injectorDeployment,
    vsoDeployment,
    ...['shop/web', 'shop/worker', 'payments/api', 'billing/invoicer', 'billing/reports', 'analytics/etl', 'ml/trainer'].map((id) => {
        const [namespace, name] = id.split('/');
        return { apiVersion: 'apps/v1', kind: 'Deployment', metadata: { name: name ?? '', namespace }, spec: { replicas: 1 }, status: { replicas: 1, readyReplicas: 1 } };
    }),
];

// ----- the Vault Secrets Operator ----------------------------------------------------------------

const OP = 'vault-secrets-operator-system';

export const connections = [
    { apiVersion: 'secrets.hashicorp.com/v1beta1', kind: 'VaultConnection', metadata: { name: 'default', namespace: OP }, spec: { address: 'http://openbao.openbao.svc.cluster.local:8200', skipTLSVerify: false }, status: { valid: true } },
    { apiVersion: 'secrets.hashicorp.com/v1beta1', kind: 'VaultConnection', metadata: { name: 'vault', namespace: 'payments' }, spec: { address: 'https://vault-active.vault:8200' }, status: { valid: true } },
];

export const auths = [
    { apiVersion: 'secrets.hashicorp.com/v1beta1', kind: 'VaultAuth', metadata: { name: 'default', namespace: OP }, spec: { method: 'kubernetes', mount: 'kubernetes', kubernetes: { role: 'vso', serviceAccount: 'default' } }, status: { valid: true } },
    { apiVersion: 'secrets.hashicorp.com/v1beta1', kind: 'VaultAuth', metadata: { name: 'payments', namespace: 'payments' }, spec: { vaultConnectionRef: 'vault', method: 'kubernetes', mount: 'k8s-prod', kubernetes: { role: 'payments', serviceAccount: 'api' } }, status: { valid: true } },
];

const vss = (namespace: string, name: string, path: string, dest: string, status: object, extra: object = {}, generation = 1) => ({
    apiVersion: 'secrets.hashicorp.com/v1beta1',
    kind: 'VaultStaticSecret',
    metadata: { name, namespace, generation },
    spec: { mount: 'secret', path, type: 'kv-v2', refreshAfter: '60s', destination: { name: dest, create: true }, ...extra },
    status,
});

const syncedStatus = (generation = 1) => ({
    lastGeneration: generation,
    secretMAC: 'm4c',
    conditions: [cond('SecretSynced', 'True', 'Synced', 'Secret synced'), cond('Healthy', 'True', 'Healthy', 'VaultStaticSecretHealthy'), cond('Ready', 'True', 'Ready', 'VaultStaticSecretReady', 2 * H)],
});

export const statics = [
    vss('shop', 'app-config', 'shop/config', 'app-config', syncedStatus(), { rolloutRestartTargets: [{ kind: 'Deployment', name: 'web' }] }),
    vss('shop', 'stripe-keys', 'shop/stripe', 'stripe-keys', {
        lastGeneration: 1,
        conditions: [
            cond('SecretSynced', 'False', 'Synced', 'Failed to sync the secret, horizon=31.4s, err=no secret found at secret/data/shop/stripe', 3 * MIN),
            cond('Healthy', 'False', 'Unhealthy', 'VaultStaticSecretUnhealthy', 3 * MIN),
            cond('Ready', 'False', 'Ready', 'VaultStaticSecretReady', 3 * MIN),
        ],
    }),
    vss('shop', 'feature-flags', 'shop/flags', 'feature-flags', syncedStatus(4), {}, 5),
    vss('payments', 'db-static', 'payments/db', 'db-static', syncedStatus(), { vaultAuthRef: 'payments' }),
];

export const dynamics = [
    {
        apiVersion: 'secrets.hashicorp.com/v1beta1',
        kind: 'VaultDynamicSecret',
        metadata: { name: 'db-creds', namespace: 'payments', generation: 1 },
        spec: { vaultAuthRef: 'payments', mount: 'database', path: 'creds/payments', renewalPercent: 67, destination: { name: 'db-creds', create: true }, rolloutRestartTargets: [{ kind: 'Deployment', name: 'api' }] },
        status: { lastGeneration: 1, lastRenewalTime: unix(-20 * MIN), secretLease: { id: 'database/creds/payments/h7Kq', duration: 3600, renewable: true }, conditions: [cond('Ready', 'True', 'Ready', '')] },
    },
    {
        apiVersion: 'secrets.hashicorp.com/v1beta1',
        kind: 'VaultDynamicSecret',
        metadata: { name: 'aws-creds', namespace: 'shop', generation: 1 },
        spec: { mount: 'aws', path: 'creds/shop-uploader', destination: { name: 'aws-creds', create: true } },
        status: { lastGeneration: 1, lastRenewalTime: unix(-3 * H), secretLease: { id: 'aws/creds/shop-uploader/Zp2', duration: 4 * 3600, renewable: false } },
    },
];

export const pkis = [
    {
        apiVersion: 'secrets.hashicorp.com/v1beta1',
        kind: 'VaultPKISecret',
        metadata: { name: 'web-tls', namespace: 'shop', generation: 1 },
        spec: { mount: 'pki', role: 'web', commonName: 'shop.example.com', ttl: '720h', destination: { name: 'web-tls', create: true, type: 'kubernetes.io/tls' } },
        status: { serialNumber: '3a:91:c0:7e', expiration: unix(2 * D), lastGeneration: 1, lastRotation: unix(-28 * D), valid: true, error: '' },
    },
    {
        apiVersion: 'secrets.hashicorp.com/v1beta1',
        kind: 'VaultPKISecret',
        metadata: { name: 'api-tls', namespace: 'payments', generation: 1 },
        spec: { vaultAuthRef: 'payments', mount: 'pki_int', role: 'payments', commonName: 'api.payments.svc', ttl: '720h', expiryOffset: '72h', destination: { name: 'api-tls', create: true, type: 'kubernetes.io/tls' } },
        status: { serialNumber: '51:0f:aa:02', expiration: unix(20 * D), lastGeneration: 1, lastRotation: unix(-10 * D), valid: true, error: '' },
    },
    {
        apiVersion: 'secrets.hashicorp.com/v1beta1',
        kind: 'VaultPKISecret',
        metadata: { name: 'mtls', namespace: 'shop', generation: 1 },
        spec: { mount: 'pki', role: 'mesh', commonName: 'worker.shop.svc', ttl: '1h', expiryOffset: '10m', destination: { name: 'worker-mtls', create: true, type: 'kubernetes.io/tls' } },
        status: { serialNumber: '0c:22:19:4d', expiration: unix(25 * MIN), lastGeneration: 1, lastRotation: unix(-35 * MIN), valid: true, error: '' },
    },
];

// ----- External Secrets --------------------------------------------------------------------------

export const clusterSecretStores = [
    {
        apiVersion: 'external-secrets.io/v1',
        kind: 'ClusterSecretStore',
        metadata: { name: 'openbao-kv' },
        spec: { provider: { vault: { server: 'http://openbao.openbao:8200', path: 'secret', version: 'v2', auth: { kubernetes: { mountPath: 'kubernetes', role: 'eso' } } } } },
        status: { conditions: [cond('Ready', 'True', 'Valid', 'store validated')] },
    },
];

export const externalSecrets = [
    {
        apiVersion: 'external-secrets.io/v1',
        kind: 'ExternalSecret',
        metadata: { name: 'warehouse-creds', namespace: 'analytics' },
        spec: { secretStoreRef: { kind: 'ClusterSecretStore', name: 'openbao-kv' }, target: { name: 'warehouse-creds' }, refreshInterval: '1h', data: [{ secretKey: 'password', remoteRef: { key: 'analytics/warehouse', property: 'password' } }] },
        status: { refreshTime: iso(-12 * MIN), conditions: [cond('Ready', 'True', 'SecretSynced', 'secret synced')] },
    },
    {
        apiVersion: 'external-secrets.io/v1',
        kind: 'ExternalSecret',
        metadata: { name: 'bi-token', namespace: 'analytics' },
        spec: { secretStoreRef: { kind: 'ClusterSecretStore', name: 'openbao-kv' }, target: { name: 'bi-token' }, dataFrom: [{ extract: { key: 'analytics/bi' } }] },
        status: { conditions: [cond('Ready', 'False', 'SecretSyncedError', 'could not get secret data from provider: permission denied', 7 * MIN)] },
    },
];

// ----- the CSI provider ----------------------------------------------------------------------------

export const providerClasses = [
    {
        apiVersion: 'secrets-store.csi.x-k8s.io/v1',
        kind: 'SecretProviderClass',
        metadata: { name: 'model-keys', namespace: 'ml' },
        spec: { provider: 'openbao', parameters: { roleName: 'ml', vaultAddress: 'http://openbao.openbao:8200', objects: '- objectName: "hf-token"\n  secretPath: "secret/data/ml/huggingface"\n  secretKey: "token"\n- objectName: "s3"\n  secretPath: "secret/data/ml/s3"\n  secretKey: "key"\n' } },
    },
];

// ----- charts -------------------------------------------------------------------------------------------

const series = (name: string, values: (t: number) => number) => ({
    name,
    points: Array.from({ length: 30 }, (_, i) => ({ t: Math.floor((NOW - (29 - i) * 2 * MIN) / 1000), v: values(i) })),
});

export const charts = {
    attached: true,
    range: 60,
    source: { available: true, error: '', describe: 'monitoring/prometheus-operated:9090' },
    charts: [
        { id: 'unsealed', label: 'Unsealed nodes', unit: 'count', description: '', error: '', series: [series('{namespace="openbao"}', (i) => (i < 22 ? 3 : 2)), series('{namespace="vault"}', () => 3)] },
        { id: 'leases', label: 'Leases', unit: 'count', description: '', error: '', series: [series('{namespace="openbao"}', (i) => 120 + i * 3), series('{namespace="vault"}', (i) => 40 + (i % 5))] },
        { id: 'active', label: 'Active nodes', unit: 'count', description: '', error: '', series: [series('{namespace="openbao"}', () => 1), series('{namespace="vault"}', () => 1)] },
    ],
};

/** Every list, by the app's kind names: what the stub bridge answers `list` with. */
export const LISTS: Record<string, unknown[]> = {
    [KIND.pods]: pods,
    [KIND.statefulsets]: statefulsets,
    [KIND.deployments]: deployments,
    [KIND.nodes]: nodes,
    [KIND.webhooks]: webhooks,
    [KIND.connections]: connections,
    [KIND.auths]: auths,
    [KIND.authGlobals]: [],
    [KIND.staticSecrets]: statics,
    [KIND.dynamicSecrets]: dynamics,
    [KIND.pkiSecrets]: pkis,
    [KIND.secretStores]: [],
    [KIND.clusterSecretStores]: clusterSecretStores,
    [KIND.externalSecrets]: externalSecrets,
    [KIND.providerClasses]: providerClasses,
};
