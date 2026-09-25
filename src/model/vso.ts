// The Vault Secrets Operator's secrets: what each one syncs, from where, into
// which Kubernetes Secret, and whether it is working.
//
// Fields, reasons and condition types are the operator's own
// (hashicorp/vault-secrets-operator, api/v1beta1 and consts/):
//
//   status.conditions        Ready, Healthy and SecretSynced on current
//                            releases; an older operator writes none, and
//                            then lastGeneration and secretMAC are all there
//                            is to go on
//   status.lastGeneration    the generation last synced: behind the object's
//                            own when its spec changed and was not synced since
//   VaultDynamicSecret       status.lastRenewalTime (Unix seconds) and
//                            status.secretLease.duration (seconds);
//                            spec.renewalPercent, 67 by default
//   VaultPKISecret           status.expiration (Unix seconds), lastRotation,
//                            valid and error; spec.expiryOffset
//
// A secret's VaultAuth is `vaultAuthRef` -- `name` in its own namespace, or
// `namespace/name` -- and without one the operator uses the VaultAuth called
// `default` in its own namespace. A VaultAuth's connection is found the same
// way (common/common.go, ParseResourceRef).

import { condition, key, KIND, when, type Condition, type Destination, type RolloutRestartTarget, type Tone, type VaultAuth, type VaultAuthGlobal, type VaultConnection, type VaultDynamicSecret, type VaultPKISecret, type VaultStaticSecret } from './types.js';
import { DAY, goDuration, MINUTE, relative, SECOND, span } from './units.js';

export type SyncKind = 'static' | 'dynamic' | 'pki';
export type SyncHealth = 'synced' | 'failing' | 'stale' | 'pending' | 'unknown';

export const SYNC_KIND_WORDS: Record<SyncKind, string> = { static: 'Static secret', dynamic: 'Dynamic secret', pki: 'PKI certificate' };
export const SYNC_APP_KIND: Record<SyncKind, string> = { static: KIND.staticSecrets, dynamic: KIND.dynamicSecrets, pki: KIND.pkiSecrets };

export interface Ref {
    namespace: string;
    name: string;
}

export interface SyncItem {
    kind: SyncKind;
    namespace: string;
    name: string;
    ref: K8sDockside.ObjectRef;
    mount: string;
    /** The path within the mount, or the PKI role. */
    path: string;
    /** mount and path together, the way the server's CLI would name them. */
    location: string;
    /** kv-v1, kv-v2 for a static secret. */
    secretType?: string;
    destination: string;
    create: boolean;
    auth: Ref & { defaulted: boolean };
    rolloutTargets: RolloutRestartTarget[];
    health: SyncHealth;
    tone: Tone;
    words: string;
    /** The operator's own words when something is wrong. */
    message?: string;
    /** When it last synced, as far as the status says. */
    lastSync?: number;
    /** When what it holds runs out: a lease's end, a certificate's notAfter. */
    expires?: number;
    /** When the operator means to renew or rotate it. */
    renewAt?: number;
    /** When what it holds was issued. */
    issuedAt?: number;
    renewable?: boolean;
    commonName?: string;
    serial?: string;
    refreshAfter?: string;
    instantUpdates?: boolean;
    /** Spec changed and not synced since. */
    behind: boolean;
}

/** `name` or `namespace/name`, resolved; empty means the operator's `default`. */
export function resolveRef(ref: string | undefined, ownNamespace: string, operatorNamespace: string): Ref & { defaulted: boolean } {
    const value = (ref ?? '').trim();
    if (!value) return { namespace: operatorNamespace, name: 'default', defaulted: true };
    const parts = value.split('/');
    if (parts.length === 2) return { namespace: parts[0] ?? '', name: parts[1] ?? '', defaulted: false };
    return { namespace: ownNamespace, name: value, defaulted: false };
}

function failing(conditions: Condition[] | undefined): Condition | undefined {
    const bad = (conditions ?? []).filter((c) => c.status === 'False' && ['SecretSynced', 'Healthy', 'Ready', 'LeaseRenewal', 'ResourceValidation', 'RolloutRestart'].includes(c.type));
    // The most telling message first: SecretSynced carries the error.
    const order = ['SecretSynced', 'LeaseRenewal', 'ResourceValidation', 'RolloutRestart', 'Healthy', 'Ready'];
    return bad.sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type))[0];
}

/** The operator's message, shortened: its "Failed to sync the secret, horizon=..., err=" preamble is noise. */
export function shortMessage(message: string | undefined): string | undefined {
    if (!message) return undefined;
    const err = /err=([\s\S]*)$/.exec(message);
    return (err?.[1] ?? message).trim();
}

interface Common {
    namespace: string;
    name: string;
    generation?: number;
    lastGeneration?: number;
    conditions?: Condition[];
    everSynced: boolean;
}

/** The part of the verdict every kind shares: conditions, then generations. */
function baseHealth(c: Common): { health: SyncHealth; tone: Tone; words: string; message?: string; behind: boolean } {
    const bad = failing(c.conditions);
    const behind = (c.lastGeneration ?? 0) > 0 && c.generation !== undefined && c.generation > (c.lastGeneration ?? 0);
    if (bad) return { health: 'failing', tone: 'error', words: 'failing', message: shortMessage(bad.message) || bad.reason, behind };
    if (!c.everSynced && !(c.conditions ?? []).some((x) => x.type === 'Ready' && x.status === 'True')) {
        return { health: 'pending', tone: 'info', words: 'not synced yet', behind };
    }
    if (behind) return { health: 'stale', tone: 'warn', words: 'spec changed, not synced since', behind };
    return { health: 'synced', tone: 'ok', words: 'synced', behind };
}

function syncedAt(conditions: Condition[] | undefined): number | undefined {
    const synced = condition(conditions, 'SecretSynced');
    if (synced?.status === 'True') return when(synced.lastTransitionTime);
    const ready = condition(conditions, 'Ready');
    return ready?.status === 'True' ? when(ready.lastTransitionTime) : undefined;
}

function dest(d: Destination | undefined): { destination: string; create: boolean } {
    return { destination: d?.name ?? '', create: d?.create === true };
}

/** A VaultStaticSecret. */
export function staticItem(o: VaultStaticSecret, operatorNamespace: string): SyncItem {
    const namespace = o.metadata.namespace ?? '';
    const spec = o.spec ?? {};
    const status = o.status ?? {};
    const base = baseHealth({ namespace, name: o.metadata.name, generation: o.metadata.generation, lastGeneration: status.lastGeneration, conditions: status.conditions, everSynced: !!status.secretMAC || (status.lastGeneration ?? 0) > 0 });
    const mount = spec.mount ?? '';
    const path = spec.path ?? '';
    return {
        kind: 'static',
        namespace,
        name: o.metadata.name,
        ref: { kind: KIND.staticSecrets, namespace, name: o.metadata.name },
        mount,
        path,
        location: [mount, path].filter(Boolean).join('/'),
        secretType: spec.type,
        ...dest(spec.destination),
        auth: resolveRef(spec.vaultAuthRef, namespace, operatorNamespace),
        rolloutTargets: spec.rolloutRestartTargets ?? [],
        ...base,
        lastSync: syncedAt(status.conditions),
        refreshAfter: spec.refreshAfter,
        instantUpdates: spec.syncConfig?.instantUpdates === true,
    };
}

/** A VaultDynamicSecret: a lease that is renewed, or credentials rotated, before they run out. */
export function dynamicItem(o: VaultDynamicSecret, operatorNamespace: string, now: number): SyncItem {
    const namespace = o.metadata.namespace ?? '';
    const spec = o.spec ?? {};
    const status = o.status ?? {};
    const base = baseHealth({ namespace, name: o.metadata.name, generation: o.metadata.generation, lastGeneration: status.lastGeneration, conditions: status.conditions, everSynced: (status.lastRenewalTime ?? 0) > 0 || (status.lastGeneration ?? 0) > 0 });
    const mount = spec.mount ?? '';
    const path = spec.path ?? '';
    const item: SyncItem = {
        kind: 'dynamic',
        namespace,
        name: o.metadata.name,
        ref: { kind: KIND.dynamicSecrets, namespace, name: o.metadata.name },
        mount,
        path,
        location: [mount, path].filter(Boolean).join('/'),
        ...dest(spec.destination),
        auth: resolveRef(spec.vaultAuthRef, namespace, operatorNamespace),
        rolloutTargets: spec.rolloutRestartTargets ?? [],
        ...base,
        lastSync: status.lastRenewalTime ? status.lastRenewalTime * SECOND : syncedAt(status.conditions),
        renewable: status.secretLease?.renewable,
        refreshAfter: spec.refreshAfter,
    };
    const issued = status.lastRenewalTime ? status.lastRenewalTime * SECOND : undefined;
    const duration = status.secretLease?.duration ?? 0;
    if (issued && duration > 0) {
        const percent = spec.renewalPercent && spec.renewalPercent > 0 ? Math.min(spec.renewalPercent, 90) : 67;
        item.issuedAt = issued;
        item.expires = issued + duration * SECOND;
        item.renewAt = issued + duration * SECOND * (percent / 100);
    }
    judgeExpiry(item, now);
    return item;
}

/** A VaultPKISecret: a certificate, reissued expiryOffset before it expires. */
export function pkiItem(o: VaultPKISecret, operatorNamespace: string, now: number): SyncItem {
    const namespace = o.metadata.namespace ?? '';
    const spec = o.spec ?? {};
    const status = o.status ?? {};
    const base = baseHealth({ namespace, name: o.metadata.name, generation: o.metadata.generation, lastGeneration: status.lastGeneration, conditions: status.conditions, everSynced: !!status.serialNumber });
    const mount = spec.mount ?? '';
    const role = spec.role ?? '';
    const item: SyncItem = {
        kind: 'pki',
        namespace,
        name: o.metadata.name,
        ref: { kind: KIND.pkiSecrets, namespace, name: o.metadata.name },
        mount,
        path: role,
        location: [mount, 'issue', role].filter(Boolean).join('/'),
        ...dest(spec.destination),
        auth: resolveRef(spec.vaultAuthRef, namespace, operatorNamespace),
        rolloutTargets: spec.rolloutRestartTargets ?? [],
        ...base,
        lastSync: status.lastRotation ? status.lastRotation * SECOND : syncedAt(status.conditions),
        commonName: spec.commonName,
        serial: status.serialNumber,
    };
    if (status.valid === false || (status.error && base.health !== 'failing')) {
        item.health = 'failing';
        item.tone = 'error';
        item.words = 'failing';
        item.message = item.message ?? shortMessage(status.error) ?? 'the operator marked it invalid';
    }
    if (status.expiration && status.expiration > 0) {
        item.expires = status.expiration * SECOND;
        item.issuedAt = status.lastRotation ? status.lastRotation * SECOND : undefined;
        const offset = goDuration(spec.expiryOffset) ?? 0;
        item.renewAt = item.expires - offset;
    }
    judgeExpiry(item, now);
    return item;
}

/** How long past its planned renewal something may be before it counts as overdue. */
export const GRACE = 5 * MINUTE;

/**
 * Expired is broken, whatever the conditions say. A renewal well past its
 * time means the operator is not renewing. And a long-lived certificate or
 * lease in the last fifth of its life, with under a week to go, is worth a
 * look -- a one-hour certificate reissued every forty minutes is not, so
 * only something that lives a day or more is judged that way.
 */
export function judgeExpiry(item: SyncItem, now: number): void {
    if (item.expires === undefined || item.health === 'failing') return;
    if (item.expires <= now) {
        item.health = 'failing';
        item.tone = 'error';
        item.words = item.kind === 'pki' ? 'certificate expired' : 'lease expired';
        item.message = `${item.kind === 'pki' ? 'The certificate' : 'The lease'} ran out ${relative(item.expires, now)} and has not been ${item.kind === 'pki' ? 'reissued' : 'renewed'}.`;
        return;
    }
    if (item.renewAt !== undefined && now > item.renewAt + GRACE && item.renewAt < item.expires) {
        item.health = 'stale';
        item.tone = 'warn';
        item.words = 'renewal overdue';
        item.message = `It was due to be ${item.kind === 'pki' ? 'reissued' : 'renewed'} ${relative(item.renewAt, now)}; it runs out ${relative(item.expires, now)}.`;
        return;
    }
    const life = item.issuedAt !== undefined ? item.expires - item.issuedAt : undefined;
    const left = item.expires - now;
    const earlierRenewal = item.renewAt !== undefined && item.renewAt < item.expires - GRACE;
    if (life !== undefined && life >= DAY && left < life * 0.2 && left < 7 * DAY && !earlierRenewal) {
        item.health = item.health === 'synced' ? 'stale' : item.health;
        item.tone = 'warn';
        item.words = `expires in ${span(left)}`;
        item.message = `Less than a fifth of its ${span(life)} life is left, and nothing is set to renew it sooner.`;
    }
}

// ----- auth and connections -------------------------------------------------------

export interface AuthInfo {
    namespace: string;
    name: string;
    ref: K8sDockside.ObjectRef;
    method: string;
    mount: string;
    role?: string;
    connection: Ref & { defaulted: boolean };
    valid?: boolean;
    error?: string;
    tone: Tone;
}

export interface ConnectionInfo {
    namespace: string;
    name: string;
    ref: K8sDockside.ObjectRef;
    address: string;
    valid?: boolean;
    tone: Tone;
}

function authRole(spec: VaultAuth['spec'] | VaultAuthGlobal['spec'], method: string): string | undefined {
    if (!spec) return undefined;
    const s = spec as Record<string, { role?: string } | undefined>;
    const byMethod: Record<string, string> = { kubernetes: 'kubernetes', jwt: 'jwt', appRole: 'appRole', aws: 'aws', gcp: 'gcp' };
    return s[byMethod[method] ?? method]?.role || undefined;
}

export function authInfo(o: VaultAuth, globals: VaultAuthGlobal[], operatorNamespace: string): AuthInfo {
    const namespace = o.metadata.namespace ?? '';
    const spec = o.spec ?? {};
    const globalRef = spec.vaultAuthGlobalRef?.name ? globals.find((g) => g.metadata.name === spec.vaultAuthGlobalRef?.name && (g.metadata.namespace ?? '') === (spec.vaultAuthGlobalRef?.namespace || namespace)) : undefined;
    const method = spec.method || globalRef?.spec?.defaultAuthMethod || 'kubernetes';
    const mount = spec.mount || globalRef?.spec?.defaultMount || method;
    const connectionRef = spec.vaultConnectionRef || globalRef?.spec?.vaultConnectionRef;
    // The operator's own default VaultAuth reaches for its own default connection.
    const connection = resolveRef(connectionRef, namespace, operatorNamespace);
    const valid = o.status?.valid ?? undefined;
    return {
        namespace,
        name: o.metadata.name,
        ref: { kind: KIND.auths, namespace, name: o.metadata.name },
        method,
        mount,
        role: authRole(spec, method) ?? authRole(globalRef?.spec, method),
        connection,
        valid: valid === null ? undefined : valid,
        error: o.status?.error || undefined,
        tone: valid === false ? 'error' : valid === true ? 'ok' : '',
    };
}

export function connectionInfo(o: VaultConnection): ConnectionInfo {
    const namespace = o.metadata.namespace ?? '';
    const valid = o.status?.valid ?? undefined;
    return {
        namespace,
        name: o.metadata.name,
        ref: { kind: KIND.connections, namespace, name: o.metadata.name },
        address: o.spec?.address ?? '',
        valid: valid === null ? undefined : valid,
        tone: valid === false ? 'error' : valid === true ? 'ok' : '',
    };
}

/** Every VSO secret, in one list, sorted by namespace and name. */
export function syncItems(input: { statics?: VaultStaticSecret[]; dynamics?: VaultDynamicSecret[]; pkis?: VaultPKISecret[] }, operatorNamespace: string, now: number): SyncItem[] {
    return [
        ...(input.statics ?? []).map((o) => staticItem(o, operatorNamespace)),
        ...(input.dynamics ?? []).map((o) => dynamicItem(o, operatorNamespace, now)),
        ...(input.pkis ?? []).map((o) => pkiItem(o, operatorNamespace, now)),
    ].sort((a, b) => a.namespace.localeCompare(b.namespace) || a.name.localeCompare(b.name));
}

/**
 * Where the operator runs. Its Deployment is labelled
 * app.kubernetes.io/name=vault-secrets-operator by its chart; failing that, a
 * VaultConnection or VaultAuth called `default` lives there; failing that,
 * the namespace its documentation installs it into.
 */
export function operatorNamespace(deployments: { metadata: { name: string; namespace?: string; labels?: Record<string, string> } }[], connections: VaultConnection[], auths: VaultAuth[]): string {
    const deployment = deployments.find((d) => d.metadata.labels?.['app.kubernetes.io/name'] === 'vault-secrets-operator');
    if (deployment?.metadata.namespace) return deployment.metadata.namespace;
    const fallback = connections.find((c) => c.metadata.name === 'default') ?? auths.find((a) => a.metadata.name === 'default');
    return fallback?.metadata.namespace ?? 'vault-secrets-operator-system';
}

/** `namespace/name`. */
export function refKey(ref: Ref): string {
    return key(ref.namespace, ref.name);
}
