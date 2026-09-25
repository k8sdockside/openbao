import { describe, expect, it } from 'vitest';
import * as F from '../fixtures.js';
import { fixtureReadings } from '../fixtures.js';
import { healthStanding, leaderHost, parseJSON, serviceBase, serviceParts, type ApiReading } from './api.js';
import { cli, detectProduct, imageVersion, isServerPod, normaliseVersion } from './product.js';
import { buildClusters, roleOf } from './servers.js';
import type { Pod } from './types.js';

const clusters = () => buildClusters({ pods: F.pods as Pod[], statefulsets: F.statefulsets, nodes: F.nodes, readings: fixtureReadings() });

describe('telling OpenBao from Vault', () => {
    it('reads the service-registration labels first', () => {
        const [bao, , , vault] = F.serverPods;
        expect(detectProduct(bao as Pod)).toBe('openbao');
        expect(detectProduct(vault as Pod)).toBe('vault');
    });

    it('falls back to the image, and not to injector or operator images', () => {
        const pod = (image: string, labels: Record<string, string> = { component: 'server' }): Pod => ({ metadata: { name: 'x', labels }, spec: { containers: [{ name: 'c', image }] } });
        expect(detectProduct(pod('quay.io/openbao/openbao:2.6.3'))).toBe('openbao');
        expect(detectProduct(pod('hashicorp/vault:1.21.1'))).toBe('vault');
        expect(detectProduct(pod('hashicorp/vault-enterprise:1.21.1-ent'))).toBe('vault');
        expect(isServerPod(pod('hashicorp/vault-k8s:1.7.2', { component: 'webhook' }))).toBe(false);
        expect(isServerPod(pod('hashicorp/vault-secrets-operator:1.6.0', {}))).toBe(false);
        expect(isServerPod(pod('quay.io/openbao/openbao:2.6.3'))).toBe(true);
    });

    it('writes versions comparably and names the CLI', () => {
        expect(imageVersion('quay.io/openbao/openbao:v2.6.3@sha256:abc')).toBe('2.6.3');
        expect(imageVersion('hashicorp/vault:latest')).toBeUndefined();
        expect(normaliseVersion('1.21.1+ent')).toBe('1.21.1-ent');
        expect(cli('openbao')).toBe('bao');
        expect(cli('vault')).toBe('vault');
    });
});

describe('the API helpers', () => {
    it('reads the health status codes', () => {
        expect(healthStanding(200)).toBe('active');
        expect(healthStanding(429)).toBe('standby');
        expect(healthStanding(473)).toBe('performance standby');
        expect(healthStanding(501)).toBe('not initialised');
        expect(healthStanding(503)).toBe('sealed');
    });

    it('finds the pod a leader address names, and the StatefulSet behind a Service', () => {
        expect(leaderHost('http://openbao-0.openbao-internal:8200')).toBe('openbao-0');
        expect(leaderHost('https://10.0.0.4:8200')).toBeUndefined();
        expect(serviceParts('openbao/openbao-active:http')).toEqual({ namespace: 'openbao', name: 'openbao-active' });
        expect(serviceBase('openbao-active')).toBe('openbao');
        expect(serviceBase('vault-standby')).toBe('vault');
    });

    it('tolerates a body that is not JSON', () => {
        expect(parseJSON('<html>')).toBeUndefined();
        expect(parseJSON('')).toBeUndefined();
    });
});

describe('server clusters', () => {
    it('groups pods by StatefulSet, in namespace order', () => {
        const list = clusters();
        expect(list.map((c) => c.id)).toEqual(['bao-staging/staging', 'openbao/openbao', 'vault/vault']);
    });

    it('draws the OpenBao raft cluster with one sealed node and the unseal progress pinned to it', () => {
        const c = clusters().find((x) => x.id === 'openbao/openbao');
        expect(c).toBeDefined();
        if (!c) return;
        expect(c.product).toBe('openbao');
        expect(c.nodes.map((n) => n.role)).toEqual(['active', 'standby', 'sealed']);
        expect(c.lock).toBe('partial');
        expect(c.tone).toBe('warn');
        expect(c.words).toBe('1 of 3 sealed');
        expect(c.seal).toMatchObject({ type: 'shamir', auto: false, t: 3, n: 5, progress: 2, progressNode: 'openbao-2' });
        expect(c.storage).toBe('raft');
        expect(c.clusterName).toBe('openbao-prod');
        expect(c.leaderName).toBe('openbao-0');
        expect(c.ha).toBe(true);
        expect(c.nodes[0]?.zone).toBe('eu-north-1a');
        expect(c.sentence).toContain('openbao-2 is sealed');
    });

    it('flags Vault running two versions, unsealed by KMS', () => {
        const c = clusters().find((x) => x.id === 'vault/vault');
        expect(c?.lock).toBe('open');
        expect(c?.seal.auto).toBe(true);
        expect(c?.seal.type).toBe('awskms');
        expect(c?.drift).toBe(true);
        expect(c?.versions).toEqual(['1.21.0', '1.21.1']);
        expect(c?.words).toBe('Mixed versions');
    });

    it('calls an uninitialised server what it is', () => {
        const c = clusters().find((x) => x.id === 'bao-staging/staging');
        expect(c?.lock).toBe('uninitialized');
        expect(c?.tone).toBe('error');
        expect(c?.sentence).toContain('bao operator init');
    });

    it('keeps the reason when the API could not be asked', () => {
        const c = buildClusters({ pods: F.pods as Pod[], readings: [{ product: 'openbao', via: 'active', error: 'not allowed to reach openbao/openbao-active:http' }] }).find((x) => x.id === 'openbao/openbao');
        expect(c?.apiError).toContain('not allowed');
        // The labels still tell the story.
        expect(c?.lock).toBe('partial');
        expect(c?.seal.t).toBeUndefined();
    });

    it('takes a lone dev server’s state from the API when it has no labels', () => {
        const pod: Pod = {
            metadata: { name: 'vault-0', namespace: 'dev', labels: { 'app.kubernetes.io/name': 'vault', component: 'server' }, ownerReferences: [{ kind: 'StatefulSet', name: 'vault' }] },
            spec: { containers: [{ name: 'vault', image: 'hashicorp/vault:1.21.1' }] },
            status: { phase: 'Running', conditions: [{ type: 'Ready', status: 'True' }] },
        };
        const reading: ApiReading = { product: 'vault', via: 'main', service: 'dev/vault:http', seal: { type: 'shamir', initialized: true, sealed: false, t: 1, n: 1, storage_type: 'inmem', version: '1.21.1' }, healthCode: 200, leader: { ha_enabled: false } };
        const [c] = buildClusters({ pods: [pod], readings: [reading] });
        expect(c?.nodes[0]?.source).toBe('api');
        expect(c?.nodes[0]?.role).toBe('active');
        expect(c?.lock).toBe('open');
        expect(c?.words).toBe('Unsealed');
        expect(c?.storage).toBe('inmem');
    });

    it('says nothing it does not know about a server with neither labels nor API', () => {
        const pod: Pod = {
            metadata: { name: 'bao-0', namespace: 'x', labels: { 'app.kubernetes.io/name': 'openbao', component: 'server' }, ownerReferences: [{ kind: 'StatefulSet', name: 'bao' }] },
            spec: { containers: [{ name: 'openbao', image: 'quay.io/openbao/openbao:2.6.3' }] },
            status: { phase: 'Running', conditions: [{ type: 'Ready', status: 'True' }] },
        };
        const [c] = buildClusters({ pods: [pod, { ...pod, metadata: { ...pod.metadata, name: 'bao-1' } }] });
        expect(c?.lock).toBe('unknown');
        expect(c?.nodes.every((n) => n.role === 'running')).toBe(true);
        expect(c?.words).toBe('Seal state unknown');
    });

    it('reports a StatefulSet with no pods at all', () => {
        const [c] = buildClusters({ pods: [], statefulsets: [F.statefulsets[0] as never] });
        expect(c?.nodes).toHaveLength(0);
        expect(c?.words).toBe('No pods');
        expect(c?.tone).toBe('error');
    });

    it('orders roles by what matters most', () => {
        expect(roleOf({ phase: 'Running', initialized: false, sealed: true, ready: false })).toBe('uninitialized');
        expect(roleOf({ phase: 'Running', initialized: true, sealed: true, active: false, ready: false })).toBe('sealed');
        expect(roleOf({ phase: 'Running', initialized: true, sealed: false, perfStandby: true, ready: true })).toBe('perf-standby');
        expect(roleOf({ phase: 'Failed', ready: false })).toBe('down');
        expect(roleOf({ phase: 'Pending', ready: false })).toBe('pending');
    });
});
