// Which server cluster an address points at.
//
// Clients name a server by URL: a VaultConnection's spec.address, an
// External Secrets store's provider.vault.server, the injector's
// AGENT_INJECT_VAULT_ADDR, a CSI class's vaultAddress. Inside the cluster
// those are Service names -- http://openbao.openbao.svc:8200,
// http://openbao-active.security:8200, http://vault:8200 from its own
// namespace, or a pod's own name under the headless Service. The Service's
// name, less -active, -standby or -internal, is the chart's full name, which
// is the StatefulSet's name; with the namespace, that is the cluster.

import { serviceBase } from './api.js';
import type { ServerCluster } from './servers.js';

export interface AddressParts {
    host: string;
    service?: string;
    namespace?: string;
}

/** The Service and namespace an in-cluster address names, as far as it names one. */
export function addressParts(address: string | undefined, defaultNamespace = ''): AddressParts | undefined {
    if (!address) return undefined;
    let host = '';
    try {
        host = new URL(address.includes('://') ? address : `http://${address}`).hostname;
    } catch {
        return undefined;
    }
    if (!host) return undefined;
    if (/^[\d.]+$/.test(host) || host.includes(':') || host === 'localhost') return { host };
    const labels = host.split('.');
    // A pod under the headless Service: openbao-0.openbao-internal[.ns[.svc...]]
    if (labels.length >= 2 && (labels[1] ?? '').endsWith('-internal')) {
        return { host, service: labels[1], namespace: labels[2] && labels[2] !== 'svc' ? labels[2] : defaultNamespace || undefined };
    }
    const inCluster = labels.length === 1 || labels[2] === 'svc' || (labels.length === 2 && labels[1] !== 'svc');
    if (!inCluster) return { host };
    return { host, service: labels[0], namespace: labels.length >= 2 && labels[1] !== 'svc' ? labels[1] : defaultNamespace || undefined };
}

/** The cluster an address reaches, or undefined for one outside the cluster or unknown to it. */
export function clusterFor(address: string | undefined, defaultNamespace: string, clusters: ServerCluster[]): ServerCluster | undefined {
    const parts = addressParts(address, defaultNamespace);
    if (!parts?.service) return undefined;
    const base = serviceBase(parts.service);
    const exact = clusters.find((c) => c.name === base && (!parts.namespace || c.namespace === parts.namespace));
    if (exact) return exact;
    const named = clusters.filter((c) => c.name === base);
    return named.length === 1 ? named[0] : undefined;
}

/** An address shortened for a label: the host and port, without the scheme. */
export function shortAddress(address: string | undefined): string {
    if (!address) return '';
    return address.replace(/^[a-z]+:\/\//i, '').replace(/\/$/, '');
}
