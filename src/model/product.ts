// OpenBao or Vault? Told apart per server pod, from what the pod says about
// itself, most reliable first:
//
//  1. The labels service registration writes. OpenBao's `service_registration
//     "kubernetes"` writes openbao-active, openbao-sealed, openbao-initialized,
//     openbao-perf-standby and openbao-version
//     (internal/serviceregistration/kubernetes/service_registration.go in
//     openbao/openbao); Vault writes the same five with a `vault-` prefix
//     (serviceregistration/kubernetes/service_registration.go in
//     hashicorp/vault). Whoever writes openbao-* is OpenBao.
//  2. The server container's image: quay.io/openbao/openbao is the OpenBao
//     chart's default, hashicorp/vault the Vault chart's.
//  3. The chart's app.kubernetes.io/name, "openbao" or "vault".
//
// The two are one API and one deployment shape, so everything past this file
// treats them alike and only the words and the CLI differ: `bao` for OpenBao,
// `vault` for Vault.

import type { Container, Pod } from './types.js';

export type Product = 'openbao' | 'vault' | 'unknown';

/** The labels service registration keeps on a server pod, per product. */
export const REG = {
    openbao: {
        active: 'openbao-active',
        sealed: 'openbao-sealed',
        initialized: 'openbao-initialized',
        perfStandby: 'openbao-perf-standby',
        version: 'openbao-version',
    },
    vault: {
        active: 'vault-active',
        sealed: 'vault-sealed',
        initialized: 'vault-initialized',
        perfStandby: 'vault-perf-standby',
        version: 'vault-version',
    },
} as const;

/** How the product is written for people. */
export function productName(product: Product): string {
    return product === 'openbao' ? 'OpenBao' : product === 'vault' ? 'Vault' : 'OpenBao or Vault';
}

/** The command-line tool in the server's image: `bao` in OpenBao's, `vault` in Vault's. */
export function cli(product: Product): string {
    return product === 'openbao' ? 'bao' : 'vault';
}

const SERVER_IMAGE = {
    openbao: /(^|\/)openbao(:|@|$)/,
    vault: /(^|\/)(vault|vault-enterprise)(:|@|$)/,
};

/** Images that carry "vault" or "openbao" in their name but are not a server. */
const NOT_A_SERVER = /vault-k8s|openbao-k8s|vault-secrets-operator|csi-provider|agent-injector|external-secrets/;

function imageProduct(image: string | undefined): Product {
    if (!image || NOT_A_SERVER.test(image)) return 'unknown';
    const repo = image.split('@')[0] ?? image;
    const path = repo.replace(/:[^/:]*$/, '');
    if (SERVER_IMAGE.openbao.test(path)) return 'openbao';
    if (SERVER_IMAGE.vault.test(path)) return 'vault';
    return 'unknown';
}

/** Which registration labels a pod carries, if any. */
export function registrationProduct(labels: Record<string, string> | undefined): Product {
    if (!labels) return 'unknown';
    if (REG.openbao.sealed in labels || REG.openbao.initialized in labels || REG.openbao.active in labels) return 'openbao';
    if (REG.vault.sealed in labels || REG.vault.initialized in labels || REG.vault.active in labels) return 'vault';
    return 'unknown';
}

/** The container that runs the server: the one with a server image, else the first. */
export function serverContainer(pod: Pod): Container | undefined {
    const containers = pod.spec?.containers ?? [];
    return containers.find((c) => imageProduct(c.image) !== 'unknown') ?? containers[0];
}

/** Which product a server pod runs. */
export function detectProduct(pod: Pod): Product {
    const labels = pod.metadata.labels;
    const registered = registrationProduct(labels);
    if (registered !== 'unknown') return registered;
    for (const c of pod.spec?.containers ?? []) {
        const p = imageProduct(c.image);
        if (p !== 'unknown') return p;
    }
    const name = labels?.['app.kubernetes.io/name'];
    if (name === 'openbao') return 'openbao';
    if (name === 'vault') return 'vault';
    return 'unknown';
}

/** The product a list of containers runs, from their images: a StatefulSet's template, say. */
export function containersProduct(containers: Container[] | undefined): Product {
    for (const c of containers ?? []) {
        const p = imageProduct(c.image);
        if (p !== 'unknown') return p;
    }
    return 'unknown';
}

/**
 * Whether a pod is an OpenBao or Vault server. Either service registration
 * labels it, or it is the chart's `component: server` pod with a server image
 * or the chart's name. The agent injector, the CSI provider and the Secrets
 * Operator all carry "vault" in their image and are none of these.
 */
export function isServerPod(pod: Pod): boolean {
    const labels = pod.metadata.labels ?? {};
    if (registrationProduct(labels) !== 'unknown') return true;
    if (labels['component'] !== 'server') return false;
    const name = labels['app.kubernetes.io/name'];
    if (name === 'openbao' || name === 'vault') return true;
    return (pod.spec?.containers ?? []).some((c) => imageProduct(c.image) !== 'unknown');
}

/** The version from an image tag: "quay.io/openbao/openbao:2.6.3" -> "2.6.3". */
export function imageVersion(image: string | undefined): string | undefined {
    if (!image) return undefined;
    const noDigest = image.split('@')[0] ?? image;
    const match = /:([^/:]+)$/.exec(noDigest);
    if (!match || !match[1] || match[1] === 'latest') return undefined;
    return match[1].replace(/^v(?=\d)/, '');
}

/**
 * A version as people compare them. The registration label is sanitised for
 * Kubernetes -- "2.6.3+ent" becomes "2.6.3-ent" -- and an API answer or an
 * image tag may carry a leading "v"; neither makes two nodes different.
 */
export function normaliseVersion(version: string | undefined): string | undefined {
    if (!version) return undefined;
    return version.trim().replace(/^v(?=\d)/, '').replace(/\+/g, '-') || undefined;
}
