// The agent injector: which pods ask for secrets through annotations, and
// which paths.
//
// The annotations are metadata the pod's author wrote -- a role and the paths
// to render -- never the secrets themselves. Two prefixes are in use, with
// the same names after them:
//
//   vault.hashicorp.com/   hashicorp/vault-k8s (agent-inject/agent/annotations.go).
//                          The OpenBao Helm chart still deploys this injector
//                          image by default, so OpenBao pods use it too.
//   openbao.org/           openbao/openbao-k8s, OpenBao's own fork of it.
//
//   agent-inject                 "true" asks for the agent
//   agent-inject-status          "injected", written by the webhook once it has
//   role                         the role the agent logs in with
//   agent-inject-secret-<file>   a secret path, rendered to /vault/secrets/<file>
//   agent-inject-template-<file> how that file is rendered (only its presence is read)
//   agent-inject-file-<file>     a different file name for it
//   agent-pre-populate-only      "true": an init container only, no sidecar
//   auth-path, namespace, service   where and how it logs in
//
// The injector itself is the chart's `component: webhook` Deployment, named
// <release>-agent-injector, behind a MutatingWebhookConfiguration whose
// webhook is called vault.hashicorp.com (openbao-helm and vault-helm alike).

import type { Product } from './product.js';
import { key, KIND, type Deployment, type MutatingWebhookConfiguration, type Pod, type Tone } from './types.js';

export const PREFIXES = ['vault.hashicorp.com/', 'openbao.org/'] as const;

export interface InjectedSecret {
    /** The file under /vault/secrets the agent renders it into. */
    file: string;
    /** The secret's path in the server: `secret/data/app/config`. */
    path: string;
    templated: boolean;
}

export interface Injection {
    prefix: string;
    product: Product;
    /** The pod asked for the agent. */
    requested: boolean;
    /** The webhook injected it. */
    injected: boolean;
    role?: string;
    authPath?: string;
    service?: string;
    vaultNamespace?: string;
    prePopulateOnly: boolean;
    secrets: InjectedSecret[];
}

function truthy(value: string | undefined): boolean {
    return value !== undefined && /^(true|1|t|yes|on)$/i.test(value.trim());
}

/** What a pod's annotations ask of the agent injector, or undefined when they ask nothing. */
export function injectionOf(annotations: Record<string, string> | undefined): Injection | undefined {
    if (!annotations) return undefined;
    for (const prefix of PREFIXES) {
        const inject = annotations[`${prefix}agent-inject`];
        const status = annotations[`${prefix}agent-inject-status`];
        const secretKeys = Object.keys(annotations).filter((k) => k.startsWith(`${prefix}agent-inject-secret-`));
        if (inject === undefined && status === undefined && secretKeys.length === 0) continue;

        const secrets: InjectedSecret[] = secretKeys
            .map((k) => {
                const file = k.slice(`${prefix}agent-inject-secret-`.length);
                return {
                    file: annotations[`${prefix}agent-inject-file-${file}`] || file,
                    path: (annotations[k] ?? '').trim(),
                    templated: `${prefix}agent-inject-template-${file}` in annotations || `${prefix}agent-inject-template-file-${file}` in annotations,
                };
            })
            .sort((a, b) => a.file.localeCompare(b.file));

        return {
            prefix,
            product: prefix === 'openbao.org/' ? 'openbao' : 'unknown',
            requested: truthy(inject),
            injected: status === 'injected' || status === 'update',
            role: annotations[`${prefix}role`] || undefined,
            authPath: annotations[`${prefix}auth-path`] || undefined,
            service: annotations[`${prefix}service`] || undefined,
            vaultNamespace: annotations[`${prefix}namespace`] || undefined,
            prePopulateOnly: truthy(annotations[`${prefix}agent-pre-populate-only`]),
            secrets,
        };
    }
    return undefined;
}

export interface InjectedPod {
    pod: Pod;
    namespace: string;
    name: string;
    ref: K8sDockside.ObjectRef;
    injection: Injection;
    tone: Tone;
    words: string;
}

/** Every pod that asks for the agent, with a word on whether it got it. */
export function injectedPods(pods: Pod[]): InjectedPod[] {
    const out: InjectedPod[] = [];
    for (const pod of pods) {
        const injection = injectionOf(pod.metadata.annotations);
        if (!injection || (!injection.requested && !injection.injected)) continue;
        const namespace = pod.metadata.namespace ?? '';
        const running = pod.status?.phase === 'Running' || pod.status?.phase === 'Succeeded';
        let tone: Tone = 'ok';
        let words = injection.prePopulateOnly ? 'rendered at start' : 'agent running';
        if (!injection.injected) {
            tone = 'warn';
            words = 'asked for the agent, not injected';
        } else if (!running) {
            // An agent that cannot log in keeps its init container, and so the
            // pod, from ever starting.
            tone = pod.status?.phase === 'Pending' ? 'warn' : 'error';
            words = pod.status?.phase === 'Pending' ? 'waiting for its secrets' : `pod ${pod.status?.phase ?? 'unknown'}`;
        }
        out.push({ pod, namespace, name: pod.metadata.name, ref: { kind: KIND.pods, namespace, name: pod.metadata.name }, injection, tone, words });
    }
    return out.sort((a, b) => a.namespace.localeCompare(b.namespace) || a.name.localeCompare(b.name));
}

export interface Injector {
    namespace: string;
    name: string;
    ref: K8sDockside.ObjectRef;
    desired: number;
    ready: number;
    /** The server address the injector points agents at (AGENT_INJECT_VAULT_ADDR). */
    address?: string;
    /** The webhook configuration that sends pods to it, if one does. */
    webhook?: string;
    failurePolicy?: string;
    tone: Tone;
    words: string;
}

/** Whether a Deployment is an agent injector: the charts name it <release>-agent-injector. */
export function isInjector(deployment: Deployment): boolean {
    const labels = deployment.metadata.labels ?? {};
    const name = labels['app.kubernetes.io/name'] ?? '';
    return name.endsWith('-agent-injector') || deployment.metadata.name.endsWith('-agent-injector') || (labels['component'] === 'webhook' && /vault|openbao/.test(name));
}

/** The injectors, each with its readiness and the webhook that feeds it. */
export function injectors(deployments: Deployment[], webhooks: MutatingWebhookConfiguration[]): Injector[] {
    return deployments.filter(isInjector).map((d) => {
        const namespace = d.metadata.namespace ?? '';
        const desired = d.spec?.replicas ?? 1;
        const ready = d.status?.readyReplicas ?? 0;
        const env = d.spec?.template?.spec?.containers?.flatMap((c) => c.env ?? []) ?? [];
        const address = env.find((e) => e.name === 'AGENT_INJECT_VAULT_ADDR')?.value;
        const hook = webhooks
            .flatMap((w) => (w.webhooks ?? []).map((h) => ({ config: w.metadata.name, hook: h })))
            .find(({ hook }) => hook.clientConfig?.service?.namespace === namespace && (hook.clientConfig?.service?.name ?? '').startsWith(d.metadata.name));
        const tone: Tone = desired === 0 ? 'warn' : ready === 0 ? 'error' : ready < desired ? 'warn' : 'ok';
        const words = desired === 0 ? 'scaled to zero' : ready === 0 ? 'down' : ready < desired ? `${ready} of ${desired} ready` : 'ready';
        return {
            namespace,
            name: d.metadata.name,
            ref: { kind: KIND.deployments, namespace, name: d.metadata.name },
            desired,
            ready,
            address,
            webhook: hook?.config,
            failurePolicy: hook?.hook.failurePolicy,
            tone,
            words,
        };
    });
}

/** `namespace/name` of an injector, for lists. */
export function injectorKey(i: Injector): string {
    return key(i.namespace, i.name);
}
