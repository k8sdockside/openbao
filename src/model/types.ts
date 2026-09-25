// The objects this plugin reads, as far as it reads them, and the app's
// names for their kinds.
//
// Only the fields the model uses are typed, and every one of them optional
// where the API server may leave it out: an object nobody has reconciled yet
// has no status at all, and a page must draw that rather than throw on it.
// Field names are the upstream ones, checked against their sources:
//
//   Vault Secrets Operator   api/v1beta1/*_types.go (hashicorp/vault-secrets-operator)
//   External Secrets         apis/externalsecrets/v1 (external-secrets/external-secrets)
//   Secrets Store CSI        secrets-store.csi.x-k8s.io/v1 SecretProviderClass
//
// Secrets are never read -- the app refuses them to every plugin page -- so a
// Kubernetes Secret appears in this model only as a name something points at.

export const KIND = {
    pods: 'pods',
    statefulsets: 'statefulsets',
    deployments: 'deployments',
    nodes: 'nodes',
    webhooks: 'mutatingwebhookconfigurations',
    // Vault Secrets Operator, group secrets.hashicorp.com.
    connections: 'crd:vaultconnections.secrets.hashicorp.com',
    auths: 'crd:vaultauths.secrets.hashicorp.com',
    authGlobals: 'crd:vaultauthglobals.secrets.hashicorp.com',
    staticSecrets: 'crd:vaultstaticsecrets.secrets.hashicorp.com',
    dynamicSecrets: 'crd:vaultdynamicsecrets.secrets.hashicorp.com',
    pkiSecrets: 'crd:vaultpkisecrets.secrets.hashicorp.com',
    // External Secrets Operator, group external-secrets.io.
    secretStores: 'crd:secretstores.external-secrets.io',
    clusterSecretStores: 'crd:clustersecretstores.external-secrets.io',
    externalSecrets: 'crd:externalsecrets.external-secrets.io',
    // The Secrets Store CSI driver.
    providerClasses: 'crd:secretproviderclasses.secrets-store.csi.x-k8s.io',
} as const;

export type Tone = 'ok' | 'warn' | 'error' | 'info' | '';

export interface Meta {
    name: string;
    namespace?: string;
    uid?: string;
    generation?: number;
    creationTimestamp?: string;
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
    ownerReferences?: { kind: string; name: string; controller?: boolean }[];
}

export interface Condition {
    type: string;
    status: string;
    reason?: string;
    message?: string;
    lastTransitionTime?: string;
}

export interface Obj {
    apiVersion?: string;
    kind?: string;
    metadata: Meta;
}

// ----- core ---------------------------------------------------------------

export interface EnvVar {
    name: string;
    value?: string;
    valueFrom?: { secretKeyRef?: { name?: string; key?: string; optional?: boolean } };
}

export interface Container {
    name: string;
    image?: string;
    args?: string[];
    command?: string[];
    env?: EnvVar[];
    envFrom?: { secretRef?: { name?: string }; configMapRef?: { name?: string } }[];
}

export interface Volume {
    name: string;
    secret?: { secretName?: string };
    projected?: { sources?: { secret?: { name?: string } }[] };
    csi?: { driver?: string; volumeAttributes?: Record<string, string> };
}

export interface Pod extends Obj {
    spec?: {
        nodeName?: string;
        serviceAccountName?: string;
        containers?: Container[];
        initContainers?: Container[];
        volumes?: Volume[];
    };
    status?: {
        phase?: string;
        conditions?: Condition[];
        containerStatuses?: { name: string; ready?: boolean; restartCount?: number; image?: string; state?: Record<string, unknown> }[];
        startTime?: string;
    };
}

export interface StatefulSet extends Obj {
    spec?: { replicas?: number; serviceName?: string; template?: { spec?: { containers?: Container[] } } };
    status?: { replicas?: number; readyReplicas?: number; currentRevision?: string; updateRevision?: string };
}

export interface Deployment extends Obj {
    spec?: { replicas?: number; template?: { spec?: { containers?: Container[] } } };
    status?: { replicas?: number; readyReplicas?: number; availableReplicas?: number; conditions?: Condition[] };
}

export interface KubeNode extends Obj {
    status?: { conditions?: Condition[] };
}

export interface MutatingWebhookConfiguration extends Obj {
    webhooks?: { name: string; clientConfig?: { service?: { name?: string; namespace?: string } }; failurePolicy?: string }[];
}

// ----- Vault Secrets Operator ------------------------------------------------

export interface VaultConnection extends Obj {
    spec?: { address?: string; skipTLSVerify?: boolean; tlsServerName?: string };
    status?: { valid?: boolean | null; conditions?: Condition[] };
}

export interface VaultAuthGlobalRefSpec {
    name?: string;
    namespace?: string;
}

export interface VaultAuth extends Obj {
    spec?: {
        vaultConnectionRef?: string;
        vaultAuthGlobalRef?: VaultAuthGlobalRefSpec;
        namespace?: string;
        method?: string;
        mount?: string;
        kubernetes?: { role?: string; serviceAccount?: string };
        appRole?: { roleId?: string };
        jwt?: { role?: string };
        aws?: { role?: string };
        gcp?: { role?: string };
    };
    status?: { valid?: boolean | null; error?: string; conditions?: Condition[] };
}

export interface VaultAuthGlobal extends Obj {
    spec?: {
        vaultConnectionRef?: string;
        defaultAuthMethod?: string;
        defaultMount?: string;
        kubernetes?: { role?: string };
        jwt?: { role?: string };
    };
}

export interface Destination {
    name?: string;
    create?: boolean;
    overwrite?: boolean;
    type?: string;
}

export interface RolloutRestartTarget {
    kind: string;
    name: string;
}

export interface VaultStaticSecret extends Obj {
    spec?: {
        vaultAuthRef?: string;
        namespace?: string;
        mount?: string;
        path?: string;
        version?: number;
        type?: string;
        refreshAfter?: string;
        destination?: Destination;
        rolloutRestartTargets?: RolloutRestartTarget[];
        syncConfig?: { instantUpdates?: boolean };
    };
    status?: { lastGeneration?: number; secretMAC?: string; conditions?: Condition[] };
}

export interface VaultDynamicSecret extends Obj {
    spec?: {
        vaultAuthRef?: string;
        namespace?: string;
        mount?: string;
        path?: string;
        renewalPercent?: number;
        revoke?: boolean;
        allowStaticCreds?: boolean;
        refreshAfter?: string;
        destination?: Destination;
        rolloutRestartTargets?: RolloutRestartTarget[];
    };
    status?: {
        lastRenewalTime?: number;
        lastGeneration?: number;
        secretLease?: { id?: string; duration?: number; renewable?: boolean };
        staticCredsMetaData?: { lastVaultRotation?: number; rotationPeriod?: number; rotationSchedule?: string; ttl?: number };
        secretMAC?: string;
        conditions?: Condition[];
    };
}

export interface VaultPKISecret extends Obj {
    spec?: {
        vaultAuthRef?: string;
        namespace?: string;
        mount?: string;
        role?: string;
        commonName?: string;
        altNames?: string[];
        ttl?: string;
        expiryOffset?: string;
        destination?: Destination;
        rolloutRestartTargets?: RolloutRestartTarget[];
    };
    status?: {
        serialNumber?: string;
        expiration?: number;
        lastGeneration?: number;
        lastRotation?: number;
        secretMAC?: string;
        valid?: boolean | null;
        error?: string;
        conditions?: Condition[];
    };
}

// ----- External Secrets Operator ------------------------------------------------

export interface VaultProviderSpec {
    server?: string;
    path?: string;
    version?: string;
    namespace?: string;
    auth?: {
        tokenSecretRef?: unknown;
        appRole?: { path?: string };
        kubernetes?: { mountPath?: string; role?: string };
        ldap?: { path?: string };
        jwt?: { path?: string; role?: string };
        cert?: unknown;
        iam?: unknown;
        userPass?: { path?: string };
        gcp?: unknown;
    };
}

export interface SecretStore extends Obj {
    spec?: { provider?: { vault?: VaultProviderSpec } & Record<string, unknown> };
    status?: { conditions?: Condition[] };
}

export interface ExternalSecret extends Obj {
    spec?: {
        secretStoreRef?: { name?: string; kind?: string };
        target?: { name?: string; creationPolicy?: string };
        refreshInterval?: string;
        data?: { secretKey?: string; remoteRef?: { key?: string; property?: string } }[];
        dataFrom?: { extract?: { key?: string }; find?: { path?: string; name?: { regexp?: string } } }[];
    };
    status?: { conditions?: Condition[]; refreshTime?: string };
}

// ----- Secrets Store CSI ------------------------------------------------------------

export interface SecretProviderClass extends Obj {
    spec?: {
        provider?: string;
        parameters?: Record<string, string>;
        secretObjects?: { secretName?: string; type?: string }[];
    };
}

// ----- helpers ------------------------------------------------------------------------

export const EMPTY_TONE: Tone = '';

/** The condition of a type, if the object has one. */
export function condition(conditions: Condition[] | undefined, type: string): Condition | undefined {
    return (conditions ?? []).find((c) => c.type === type);
}

/** `namespace/name`, or the name alone for a cluster-scoped object. */
export function key(namespace: string | undefined, name: string): string {
    return namespace ? `${namespace}/${name}` : name;
}

/** An RFC 3339 time as milliseconds, or undefined. */
export function when(value: string | undefined): number | undefined {
    if (!value) return undefined;
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : undefined;
}
