// SecretProviderClasses served by the OpenBao or Vault CSI provider.
//
// spec.provider is "vault" for hashicorp/vault-csi-provider and "openbao" for
// openbao/openbao-csi-provider. The parameters are strings: roleName, the
// address as vaultAddress (OpenBao also takes baoAddress and openbaoAddress,
// internal/config/config.go), and `objects`, a YAML list in a string with a
// secretPath per object. spec.secretObjects, when present, also syncs what
// was mounted into Kubernetes Secrets. A pod uses a class through a CSI
// volume with driver secrets-store.csi.k8s.io and
// volumeAttributes.secretProviderClass.

import { KIND, type Pod, type SecretProviderClass } from './types.js';

export interface ProviderClass {
    namespace: string;
    name: string;
    ref: K8sDockside.ObjectRef;
    provider: 'vault' | 'openbao';
    role?: string;
    address?: string;
    paths: string[];
    /** Kubernetes Secrets it also syncs into. */
    syncs: string[];
}

export const CSI_DRIVER = 'secrets-store.csi.k8s.io';

/**
 * The secretPath of every object in the `objects` parameter. It is YAML in a
 * string; the provider's schema is a flat list of maps, so reading the
 * `secretPath:` lines is enough, with quotes taken off.
 */
export function objectPaths(objects: string | undefined): string[] {
    if (!objects) return [];
    const out: string[] = [];
    for (const line of objects.split('\n')) {
        const match = /^[\s-]*secretPath\s*:\s*(.+?)\s*$/.exec(line);
        if (!match?.[1]) continue;
        const value = match[1].replace(/^["']|["']$/g, '').trim();
        if (value && !out.includes(value)) out.push(value);
    }
    return out;
}

export function providerClasses(classes: SecretProviderClass[]): ProviderClass[] {
    const out: ProviderClass[] = [];
    for (const c of classes) {
        const provider = c.spec?.provider;
        if (provider !== 'vault' && provider !== 'openbao') continue;
        const p = c.spec?.parameters ?? {};
        const namespace = c.metadata.namespace ?? '';
        out.push({
            namespace,
            name: c.metadata.name,
            ref: { kind: KIND.providerClasses, namespace, name: c.metadata.name },
            provider,
            role: p['roleName'] || undefined,
            address: p['vaultAddress'] || p['baoAddress'] || p['openbaoAddress'] || undefined,
            paths: objectPaths(p['objects']),
            syncs: (c.spec?.secretObjects ?? []).map((s) => s.secretName ?? '').filter(Boolean),
        });
    }
    return out;
}

/** The SecretProviderClasses a pod mounts. */
export function classesOf(pod: Pod): string[] {
    return (pod.spec?.volumes ?? []).filter((v) => v.csi?.driver === CSI_DRIVER && v.csi.volumeAttributes?.['secretProviderClass']).map((v) => v.csi?.volumeAttributes?.['secretProviderClass'] ?? '');
}
