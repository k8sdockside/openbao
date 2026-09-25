import { describe, expect, it } from 'vitest';
import * as F from '../fixtures.js';
import { fixtureReadings } from '../fixtures.js';
import { addressParts, clusterFor } from './address.js';
import { issues } from './attention.js';
import { howUsed, secretsOf, workloadOf } from './consumers.js';
import { objectPaths, providerClasses } from './csi.js';
import { externalItems, vaultStores } from './eso.js';
import { axisOf, position, rows } from './expiry.js';
import { buildFlow, filterFlow, layoutFlow, lineage, NODE_H } from './flow.js';
import { injectedPods, injectionOf, injectors } from './injector.js';
import { buildClusters } from './servers.js';
import type { Pod, SecretProviderClass } from './types.js';
import { DAY, goDuration, HOUR, MINUTE, span, worst } from './units.js';
import { dynamicItem, judgeExpiry, pkiItem, resolveRef, shortMessage, staticItem, type SyncItem } from './vso.js';
import { derive, sourceOfItem, supplyOfPod, type Snapshot } from './world.js';

const NOW = Date.now();

function snapshot(): Snapshot {
    return {
        pods: F.pods as Pod[],
        statefulsets: F.statefulsets,
        deployments: F.deployments as never,
        nodes: F.nodes,
        webhooks: F.webhooks,
        connections: F.connections,
        auths: F.auths,
        statics: F.statics,
        dynamics: F.dynamics,
        pkis: F.pkis,
        clusterSecretStores: F.clusterSecretStores,
        externalSecrets: F.externalSecrets,
        providerClasses: F.providerClasses as SecretProviderClass[],
        readings: fixtureReadings(),
    };
}

describe('units', () => {
    it('reads Go durations', () => {
        expect(goDuration('90s')).toBe(90_000);
        expect(goDuration('1h30m')).toBe(90 * MINUTE);
        expect(goDuration('720h')).toBe(30 * DAY);
        expect(goDuration('15m0s')).toBe(15 * MINUTE);
        expect(goDuration('soon')).toBeUndefined();
    });

    it('writes spans and ranks tones', () => {
        expect(span(45_000)).toBe('45 s');
        expect(span(3 * HOUR)).toBe('3 h');
        expect(span(3 * DAY)).toBe('3 d');
        expect(worst('ok', 'warn', 'info')).toBe('warn');
        expect(worst('', 'error', 'warn')).toBe('error');
    });
});

describe('addresses', () => {
    const clusters = buildClusters({ pods: F.pods as Pod[] });

    it('finds the cluster behind an in-cluster URL', () => {
        expect(clusterFor('http://openbao.openbao.svc.cluster.local:8200', 'x', clusters)?.id).toBe('openbao/openbao');
        expect(clusterFor('https://vault-active.vault:8200', 'x', clusters)?.id).toBe('vault/vault');
        expect(clusterFor('http://openbao-1.openbao-internal:8200', 'openbao', clusters)?.id).toBe('openbao/openbao');
        expect(clusterFor('http://vault:8200', 'vault', clusters)?.id).toBe('vault/vault');
    });

    it('leaves addresses outside the cluster alone', () => {
        expect(clusterFor('https://vault.example.com', 'x', clusters)).toBeUndefined();
        expect(addressParts('https://10.1.2.3:8200')?.service).toBeUndefined();
    });
});

describe('the Secrets Operator', () => {
    it('resolves references the way the operator does', () => {
        expect(resolveRef('', 'shop', 'vso')).toEqual({ namespace: 'vso', name: 'default', defaulted: true });
        expect(resolveRef('payments', 'shop', 'vso')).toEqual({ namespace: 'shop', name: 'payments', defaulted: false });
        expect(resolveRef('other/auth', 'shop', 'vso')).toEqual({ namespace: 'other', name: 'auth', defaulted: false });
    });

    it('reads synced, failing and stale static secrets', () => {
        const [ok, bad, stale] = F.statics.map((o) => staticItem(o, 'vso'));
        expect(ok?.health).toBe('synced');
        expect(ok?.location).toBe('secret/shop/config');
        expect(bad?.health).toBe('failing');
        expect(bad?.message).toBe('no secret found at secret/data/shop/stripe');
        expect(stale?.health).toBe('stale');
        expect(stale?.behind).toBe(true);
    });

    it('treats a never-synced secret as pending, not broken', () => {
        const item = staticItem({ metadata: { name: 'new', namespace: 'a', generation: 1 }, spec: { mount: 'kv', path: 'p', destination: { name: 'd' } } }, 'vso');
        expect(item.health).toBe('pending');
        expect(item.tone).toBe('info');
    });

    it('works out renewals of dynamic secrets and flags an overdue one', () => {
        const [db, aws] = F.dynamics.map((o) => dynamicItem(o, 'vso', NOW));
        expect(db?.health).toBe('synced');
        expect((db?.expires ?? 0) - NOW).toBeGreaterThan(39 * MINUTE);
        expect(db?.renewAt).toBeDefined();
        expect(aws?.health).toBe('stale');
        expect(aws?.words).toBe('renewal overdue');
    });

    it('flags a long-lived certificate near expiry, but not a short one renewing on schedule', () => {
        const [web, api, mtls] = F.pkis.map((o) => pkiItem(o, 'vso', NOW));
        expect(web?.tone).toBe('warn');
        expect(web?.words).toBe('expires in 2 d');
        expect(api?.tone).toBe('ok');
        expect(mtls?.tone).toBe('ok');
        expect(mtls?.location).toBe('pki/issue/mesh');
    });

    it('calls an expired certificate broken', () => {
        const item = { kind: 'pki', health: 'synced', tone: 'ok', words: 'synced', expires: NOW - HOUR, issuedAt: NOW - 30 * DAY } as SyncItem;
        judgeExpiry(item, NOW);
        expect(item.health).toBe('failing');
        expect(item.words).toBe('certificate expired');
    });

    it('trims the operator’s preamble off its messages', () => {
        expect(shortMessage('Failed to sync the secret, horizon=1s, err=permission denied')).toBe('permission denied');
        expect(shortMessage('plain')).toBe('plain');
    });
});

describe('the agent injector', () => {
    it('reads both prefixes and every secret path', () => {
        const got = injectionOf({ 'openbao.org/agent-inject': 'true', 'openbao.org/role': 'web', 'openbao.org/agent-inject-secret-db': 'database/creds/web', 'openbao.org/agent-inject-file-db': 'db.env' });
        expect(got?.product).toBe('openbao');
        expect(got?.role).toBe('web');
        expect(got?.secrets).toEqual([{ file: 'db.env', path: 'database/creds/web', templated: false }]);
        expect(injectionOf({ 'vault.hashicorp.com/agent-inject': 'false' })?.requested).toBe(false);
        expect(injectionOf({ unrelated: 'x' })).toBeUndefined();
    });

    it('tells injected pods from ones the webhook skipped', () => {
        const list = injectedPods(F.pods as Pod[]);
        expect(list.map((p) => [p.namespace, p.tone])).toEqual([
            ['billing', 'ok'],
            ['billing', 'warn'],
        ]);
        expect(list[0]?.injection.secrets.map((s) => s.path)).toEqual(['secret/data/billing/config', 'database/creds/billing']);
        expect(list[0]?.injection.secrets[0]?.templated).toBe(true);
    });

    it('finds the injector, its address and its webhook', () => {
        const [i] = injectors(F.deployments as never, F.webhooks);
        expect(i?.name).toBe('openbao-agent-injector');
        expect(i?.address).toBe('http://openbao.openbao.svc:8200');
        expect(i?.webhook).toBe('openbao-agent-injector-cfg');
        expect(i?.tone).toBe('ok');
    });
});

describe('External Secrets and CSI', () => {
    it('keeps only Vault stores and the ExternalSecrets that use them', () => {
        const stores = vaultStores([{ metadata: { name: 'aws', namespace: 'x' }, spec: { provider: { aws: {} } as never } }], F.clusterSecretStores);
        expect(stores.map((s) => s.name)).toEqual(['openbao-kv']);
        expect(stores[0]?.method).toBe('kubernetes');
        const items = externalItems(F.externalSecrets, stores);
        expect(items.map((e) => [e.name, e.tone])).toEqual([
            ['bi-token', 'error'],
            ['warehouse-creds', 'ok'],
        ]);
        expect(items[0]?.keys).toEqual(['analytics/bi']);
    });

    it('reads the secret paths out of a class’s objects parameter', () => {
        expect(objectPaths('- objectName: a\n  secretPath: "secret/data/a"\n- objectName: b\n  secretPath: secret/data/b\n')).toEqual(['secret/data/a', 'secret/data/b']);
        const [c] = providerClasses(F.providerClasses as SecretProviderClass[]);
        expect(c?.provider).toBe('openbao');
        expect(c?.role).toBe('ml');
    });
});

describe('consumers', () => {
    it('reads the Secrets a pod names and gathers pods into their Deployment', () => {
        const web = F.appPods[0] as Pod;
        expect(secretsOf(web)).toEqual(['app-config', 'stripe-keys', 'web-tls']);
        expect(howUsed(web, 'stripe-keys')).toEqual(['env']);
        expect(howUsed(web, 'web-tls')).toEqual(['volume']);
        expect(workloadOf(web)).toEqual({ kind: 'Deployment', namespace: 'shop', name: 'web' });
    });
});

describe('the world', () => {
    const world = derive(snapshot(), NOW);

    it('follows a secret to its server through its auth and connection', () => {
        const item = world.items.find((i) => i.name === 'db-static');
        expect(item && sourceOfItem(world, item).cluster?.id).toBe('vault/vault');
        const other = world.items.find((i) => i.name === 'app-config');
        expect(other && sourceOfItem(world, other).cluster?.id).toBe('openbao/openbao');
    });

    it('says what a pod gets, however it gets it', () => {
        const web = supplyOfPod(world, F.appPods[0] as Pod);
        expect(web.map((s) => [s.via, s.secret])).toEqual([
            ['vso', 'app-config'],
            ['vso', 'stripe-keys'],
            ['vso', 'web-tls'],
        ]);
        const invoicer = supplyOfPod(world, F.appPods[5] as Pod);
        expect(invoicer[0]?.via).toBe('agent');
        expect(invoicer[0]?.source.cluster?.id).toBe('openbao/openbao');
        const trainer = supplyOfPod(world, F.appPods[8] as Pod);
        expect(trainer[0]?.via).toBe('csi');
    });

    it('lists what needs attention, worst first', () => {
        const list = issues(world);
        expect(list[0]?.tone).toBe('error');
        expect(list[0]?.title).toBe('staging is not initialised');
        const titles = list.map((i) => i.title);
        expect(titles).toContain('openbao-2 is sealed');
        expect(titles).toContain('Static secret shop/stripe-keys: failing');
        expect(titles).toContain('Static secret shop/feature-flags: spec changed, not synced since');
        expect(titles).toContain('Dynamic secret shop/aws-creds: renewal overdue');
        expect(titles).toContain('PKI certificate shop/web-tls: expires in 2 d');
        expect(titles).toContain('vault runs mixed versions');
        expect(titles).toContain('ExternalSecret analytics/bi-token: secret synced error');
        expect(titles.some((t) => t.startsWith('Pod billing/reports'))).toBe(true);
        const tones = list.map((i) => i.tone);
        expect(tones.indexOf('warn')).toBeGreaterThan(tones.lastIndexOf('error'));
    });

    it('builds the flow, from server to workload', () => {
        const graph = buildFlow(world);
        const ids = new Set(graph.nodes.map((n) => n.id));
        expect(ids.has('srv:openbao/openbao')).toBe(true);
        expect(ids.has('auth:vault-secrets-operator-system/default')).toBe(true);
        expect(ids.has('sec:shop/app-config')).toBe(true);
        expect(ids.has('wl:shop/Deployment/web')).toBe(true);
        expect(ids.has('agent:billing/Deployment/invoicer')).toBe(true);
        expect(ids.has('store:ClusterSecretStore/openbao-kv')).toBe(true);
        expect(ids.has('obj:crd:secretproviderclasses.secrets-store.csi.x-k8s.io/ml/model-keys')).toBe(true);
        const server = graph.nodes.find((n) => n.id === 'srv:vault/vault');
        expect(server?.badge).toBe('Vault');

        const chain = lineage(graph, 'obj:crd:vaultstaticsecrets.secrets.hashicorp.com/shop/app-config');
        expect(chain.nodes.has('srv:openbao/openbao')).toBe(true);
        expect(chain.nodes.has('wl:shop/Deployment/web')).toBe(true);
        expect(chain.nodes.has('wl:payments/Deployment/api')).toBe(false);
    });

    it('filters whole chains', () => {
        const graph = buildFlow(world);
        const agent = filterFlow(graph, { vias: ['agent'] });
        expect(agent.nodes.filter((n) => n.type === 'sync').every((n) => n.via === 'agent')).toBe(true);
        const search = filterFlow(graph, { search: 'etl' });
        expect(search.nodes.map((n) => n.id)).toContain('store:ClusterSecretStore/openbao-kv');
        expect(search.nodes.some((n) => n.label === 'bi-token')).toBe(false);
        const problems = filterFlow(graph, { problemsOnly: true });
        expect(problems.nodes.some((n) => n.label === 'stripe-keys')).toBe(true);
        expect(problems.nodes.some((n) => n.label === 'model-keys')).toBe(false);
        const ns = filterFlow(graph, { namespace: 'payments' });
        expect(ns.nodes.filter((n) => n.type === 'sync').every((n) => n.namespace === 'payments')).toBe(true);
    });

    it('lays the flow out without overlaps', () => {
        const graph = buildFlow(world);
        const layout = layoutFlow(graph);
        for (let col = 0; col < 5; col++) {
            const ys = graph.nodes.filter((n) => n.col === col).map((n) => layout.boxes.get(n.id)?.y ?? 0).sort((a, b) => a - b);
            for (let i = 1; i < ys.length; i++) expect((ys[i] ?? 0) - (ys[i - 1] ?? 0)).toBeGreaterThanOrEqual(NODE_H);
        }
    });

    it('puts certificates and leases on a timeline, soonest first', () => {
        const list = rows(world.items, NOW);
        expect(list[0]?.item.name).toBe('mtls');
        expect(list.map((r) => r.item.name)).toContain('web-tls');
        const axis = axisOf(list, NOW);
        expect(axis.max).toBeGreaterThan(20 * DAY);
        expect(axis.ticks.map((t) => t.label)).toEqual(['10 min', '1 h', '6 h', '1 d', '1 wk']);
        // Minutes and weeks both get room: an hour is well clear of now.
        expect(position(axis, HOUR)).toBeGreaterThan(0.3);
        expect(position(axis, 0)).toBe(0);
        expect(position(axis, 400 * DAY)).toBe(1);
        expect(list.find((r) => r.item.name === 'mtls')?.tone).toBe('ok');
        expect(list.find((r) => r.item.name === 'web-tls')?.tone).toBe('warn');
    });
});
