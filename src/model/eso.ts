// External Secrets Operator stores that use the Vault provider -- which
// serves OpenBao just as well -- and the ExternalSecrets that read through
// them. Everything here is optional: most clusters have no ESO at all.
//
// Fields are ESO's v1 API (apis/externalsecrets/v1 in
// external-secrets/external-secrets): spec.provider.vault.{server, path,
// version, auth.*}; an ExternalSecret's spec.secretStoreRef.{name, kind},
// spec.target.name (the ExternalSecret's own name when left out),
// spec.data[].remoteRef.key and spec.dataFrom[].extract.key; the Ready
// condition on both.

import { condition, key, KIND, when, type ExternalSecret, type SecretStore, type Tone, type VaultProviderSpec } from './types.js';

export interface VaultStore {
    kind: 'SecretStore' | 'ClusterSecretStore';
    namespace: string;
    name: string;
    ref: K8sDockside.ObjectRef;
    server: string;
    path?: string;
    version?: string;
    method: string;
    role?: string;
    tone: Tone;
    words: string;
    message?: string;
}

export interface ExternalItem {
    namespace: string;
    name: string;
    ref: K8sDockside.ObjectRef;
    store: { kind: 'SecretStore' | 'ClusterSecretStore'; name: string };
    target: string;
    keys: string[];
    tone: Tone;
    words: string;
    message?: string;
    refreshed?: number;
}

function authMethod(auth: VaultProviderSpec['auth']): { method: string; role?: string } {
    if (!auth) return { method: 'none' };
    if (auth.kubernetes) return { method: 'kubernetes', role: auth.kubernetes.role };
    if (auth.jwt) return { method: 'jwt', role: auth.jwt.role };
    if (auth.appRole) return { method: 'approle' };
    if (auth.tokenSecretRef) return { method: 'token' };
    if (auth.ldap) return { method: 'ldap' };
    if (auth.userPass) return { method: 'userpass' };
    if (auth.cert) return { method: 'cert' };
    if (auth.iam) return { method: 'aws iam' };
    if (auth.gcp) return { method: 'gcp' };
    return { method: 'other' };
}

function readiness(conditions: { type: string; status: string; reason?: string; message?: string }[] | undefined): { tone: Tone; words: string; message?: string } {
    const ready = condition(conditions, 'Ready');
    if (!ready) return { tone: 'info', words: 'not checked yet' };
    if (ready.status === 'True') return { tone: 'ok', words: 'ready' };
    return { tone: 'error', words: ready.reason ? ready.reason.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase() : 'not ready', message: ready.message };
}

/** The stores whose provider is Vault, with their readiness. */
export function vaultStores(stores: SecretStore[], clusterStores: SecretStore[]): VaultStore[] {
    const out: VaultStore[] = [];
    const add = (s: SecretStore, kind: VaultStore['kind']) => {
        const vault = s.spec?.provider?.vault;
        if (!vault) return;
        const namespace = kind === 'SecretStore' ? (s.metadata.namespace ?? '') : '';
        const { method, role } = authMethod(vault.auth);
        out.push({
            kind,
            namespace,
            name: s.metadata.name,
            ref: { kind: kind === 'SecretStore' ? KIND.secretStores : KIND.clusterSecretStores, namespace, name: s.metadata.name },
            server: vault.server ?? '',
            path: vault.path,
            version: vault.version,
            method,
            role,
            ...readiness(s.status?.conditions),
        });
    };
    for (const s of stores) add(s, 'SecretStore');
    for (const s of clusterStores) add(s, 'ClusterSecretStore');
    return out;
}

/** The store an ExternalSecret reads through, when it is one of the Vault ones. */
export function storeOf(item: ExternalItem, stores: VaultStore[]): VaultStore | undefined {
    return stores.find((s) => s.kind === item.store.kind && s.name === item.store.name && (s.kind === 'ClusterSecretStore' || s.namespace === item.namespace));
}

/** The ExternalSecrets that read from one of the Vault stores. */
export function externalItems(externals: ExternalSecret[], stores: VaultStore[]): ExternalItem[] {
    const out: ExternalItem[] = [];
    for (const e of externals) {
        const namespace = e.metadata.namespace ?? '';
        const storeKind = e.spec?.secretStoreRef?.kind === 'ClusterSecretStore' ? 'ClusterSecretStore' : 'SecretStore';
        const item: ExternalItem = {
            namespace,
            name: e.metadata.name,
            ref: { kind: KIND.externalSecrets, namespace, name: e.metadata.name },
            store: { kind: storeKind, name: e.spec?.secretStoreRef?.name ?? '' },
            target: e.spec?.target?.name || e.metadata.name,
            keys: [
                ...new Set([
                    ...(e.spec?.data ?? []).map((d) => d.remoteRef?.key ?? '').filter(Boolean),
                    ...(e.spec?.dataFrom ?? []).map((d) => d.extract?.key ?? d.find?.path ?? '').filter(Boolean),
                ]),
            ],
            ...readiness(e.status?.conditions),
            refreshed: when(e.status?.refreshTime),
        };
        if (item.words === 'ready') item.words = 'synced';
        if (storeOf(item, stores)) out.push(item);
    }
    return out.sort((a, b) => key(a.namespace, a.name).localeCompare(key(b.namespace, b.name)));
}
