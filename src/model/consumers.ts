// Who uses a Secret: read from pod specs, never from the Secret.
//
// A pod names the Secrets it uses in three places -- env[].valueFrom
// .secretKeyRef, envFrom[].secretRef and a secret or projected volume -- in
// its containers and its init containers alike. Pods are then gathered into
// the workload that owns them, so a Deployment with six replicas is one
// consumer, not six: a ReplicaSet's name is its Deployment's name plus the
// pod-template-hash, which the pod carries as a label.

import { classesOf } from './csi.js';
import { key, KIND, type Pod, type Tone } from './types.js';

export type WorkloadKind = 'Deployment' | 'StatefulSet' | 'DaemonSet' | 'Job' | 'CronJob' | 'Pod';

export const WORKLOAD_APP_KIND: Record<WorkloadKind, string> = {
    Deployment: KIND.deployments,
    StatefulSet: KIND.statefulsets,
    DaemonSet: 'daemonsets',
    Job: 'jobs',
    CronJob: 'cronjobs',
    Pod: KIND.pods,
};

export interface WorkloadId {
    kind: WorkloadKind;
    namespace: string;
    name: string;
}

/** The workload a pod belongs to, or the pod itself when nothing owns it. */
export function workloadOf(pod: Pod): WorkloadId {
    const namespace = pod.metadata.namespace ?? '';
    const owner = (pod.metadata.ownerReferences ?? []).find((o) => o.controller !== false) ?? pod.metadata.ownerReferences?.[0];
    if (owner?.kind === 'ReplicaSet') {
        const hash = pod.metadata.labels?.['pod-template-hash'];
        const name = hash && owner.name.endsWith(`-${hash}`) ? owner.name.slice(0, -hash.length - 1) : owner.name.replace(/-[a-z0-9]{6,10}$/, '');
        return { kind: 'Deployment', namespace, name };
    }
    if (owner?.kind === 'StatefulSet' || owner?.kind === 'DaemonSet') return { kind: owner.kind, namespace, name: owner.name };
    if (owner?.kind === 'Job') {
        // A CronJob's Job is <cronjob>-<minutes since epoch>.
        const cron = /^(.*)-\d{8,}$/.exec(owner.name);
        return cron?.[1] ? { kind: 'CronJob', namespace, name: cron[1] } : { kind: 'Job', namespace, name: owner.name };
    }
    return { kind: 'Pod', namespace, name: pod.metadata.name };
}

export function workloadKey(w: WorkloadId): string {
    return `${w.namespace}/${w.kind}/${w.name}`;
}

/** Every Secret a pod names, by name, in its own namespace. */
export function secretsOf(pod: Pod): string[] {
    const names = new Set<string>();
    const spec = pod.spec ?? {};
    for (const c of [...(spec.initContainers ?? []), ...(spec.containers ?? [])]) {
        for (const e of c.env ?? []) {
            const name = e.valueFrom?.secretKeyRef?.name;
            if (name) names.add(name);
        }
        for (const f of c.envFrom ?? []) {
            const name = f.secretRef?.name;
            if (name) names.add(name);
        }
    }
    for (const v of spec.volumes ?? []) {
        if (v.secret?.secretName) names.add(v.secret.secretName);
        for (const s of v.projected?.sources ?? []) if (s.secret?.name) names.add(s.secret.name);
    }
    return [...names].sort();
}

/** How a workload gets at a Secret. */
export function howUsed(pod: Pod, secret: string): string[] {
    const ways = new Set<string>();
    const spec = pod.spec ?? {};
    for (const c of [...(spec.initContainers ?? []), ...(spec.containers ?? [])]) {
        if ((c.env ?? []).some((e) => e.valueFrom?.secretKeyRef?.name === secret)) ways.add('env');
        if ((c.envFrom ?? []).some((f) => f.secretRef?.name === secret)) ways.add('envFrom');
    }
    for (const v of spec.volumes ?? []) {
        if (v.secret?.secretName === secret || (v.projected?.sources ?? []).some((s) => s.secret?.name === secret)) ways.add('volume');
    }
    return [...ways];
}

export interface Workload extends WorkloadId {
    id: string;
    ref: K8sDockside.ObjectRef;
    pods: Pod[];
    ready: number;
    secrets: string[];
    classes: string[];
    tone: Tone;
}

function podReady(pod: Pod): boolean {
    return (pod.status?.conditions ?? []).some((c) => c.type === 'Ready' && c.status === 'True') || pod.status?.phase === 'Succeeded';
}

/** Pods gathered into workloads, each with the Secrets and CSI classes it uses. */
export function workloads(pods: Pod[]): Map<string, Workload> {
    const out = new Map<string, Workload>();
    for (const pod of pods) {
        const id = workloadOf(pod);
        const k = workloadKey(id);
        let w = out.get(k);
        if (!w) {
            w = { ...id, id: k, ref: { kind: WORKLOAD_APP_KIND[id.kind], namespace: id.namespace, name: id.name }, pods: [], ready: 0, secrets: [], classes: [], tone: '' };
            out.set(k, w);
        }
        w.pods.push(pod);
        if (podReady(pod)) w.ready++;
        for (const s of secretsOf(pod)) if (!w.secrets.includes(s)) w.secrets.push(s);
        for (const c of classesOf(pod)) if (!w.classes.includes(c)) w.classes.push(c);
    }
    for (const w of out.values()) {
        w.tone = w.ready === w.pods.length ? 'ok' : w.ready === 0 ? 'error' : 'warn';
        w.secrets.sort();
    }
    return out;
}

/** Which workloads use a Secret, by `namespace/secret`. */
export function usersBySecret(all: Map<string, Workload>): Map<string, Workload[]> {
    const out = new Map<string, Workload[]>();
    for (const w of all.values()) {
        for (const s of w.secrets) {
            const k = key(w.namespace, s);
            const list = out.get(k) ?? [];
            list.push(w);
            out.set(k, list);
        }
    }
    return out;
}
