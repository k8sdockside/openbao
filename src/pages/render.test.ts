// @vitest-environment happy-dom
//
// Does each page actually draw?
//
// The model tests say the OpenBao and Vault knowledge is right; this says the
// pages that use it put it on the screen, against objects shaped the way the
// charts, the servers and the operators really write them. It runs each page
// module against a stub of the bridge -- lists, the declared services, the
// charts -- with no cluster and no app, and reads the text that comes out.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as F from '../fixtures.js';

type Lists = Record<string, unknown[]>;

let opened: unknown[] = [];
let patches: { kind: string; namespace?: string; name: string; patch: unknown }[] = [];
let asked: string[] = [];

interface Options {
    lists?: Lists;
    object?: unknown;
    ref?: { kind: string; namespace?: string; name: string } | null;
    storage?: Record<string, unknown>;
    services?: boolean;
    write?: boolean;
}

function bridge(o: Options = {}) {
    const lists = o.lists ?? F.LISTS;
    const storage = { ...(o.storage ?? {}) };
    return {
        ready: async () => ({
            pluginId: 'openbao',
            viewId: '',
            sectionId: o.ref ? 'panel' : '',
            object: o.ref ?? null,
            contextId: 'test',
            contextName: 'test-cluster',
            readable: [],
            write: o.write ?? true,
            actions: [],
            theme: { id: 'k8sdockside-dark', base: 'dark' as const, tokens: {} },
        }),
        object: async () => o.object ?? null,
        list: async ({ kind }: { kind: string }) => {
            if (!(kind in lists)) throw new Error(`the cluster does not serve ${kind}`);
            return lists[kind];
        },
        get: async () => null,
        open: async (ref: unknown) => void opened.push(ref),
        openView: async () => null,
        openUrl: async () => null,
        summary: async () => ({ pluginId: 'openbao', installed: true, checked: true, requirements: [], cards: [], error: '' }),
        storage: {
            get: async (key: string) => storage[key] ?? null,
            set: async (key: string, value: unknown) => void (storage[key] = value),
            remove: async (key: string) => void delete storage[key],
            keys: async () => Object.keys(storage),
        },
        actions: async () => [],
        run: async () => ({ created: '' }),
        resize: async () => null,
        watch: () => () => {},
        namespaces: async () => [],
        charts: async () => F.charts,
        services:
            o.services === false
                ? undefined
                : {
                      get: async ({ service, path }: { service: string; path: string }) => {
                          asked.push(`${service}${path}`);
                          const s = F.services[service];
                          if (!s) throw new Error(`no service labelled for ${service} with that port in any namespace -- is it installed?`);
                          const a = s.answers[path];
                          return { service: s.service, status: a?.status ?? 404, contentType: 'application/json', body: a?.body ?? '' };
                      },
                  },
        patch: async (p: { kind: string; namespace?: string; name: string; patch: unknown }) => void patches.push(p),
        create: async () => ({ name: '' }),
        edit: async () => null,
        logs: async () => null,
        on: () => () => {},
    };
}

const PAGE = '<div id="page"><div id="head"></div><p id="first"></p><div id="body"></div></div>';
const PANEL = '<div id="panel"></div>';

/** Runs a page module fresh, then lets its promises settle. */
async function run(module: string, html: string): Promise<string> {
    document.body.innerHTML = html;
    vi.resetModules();
    await import(module);
    for (let i = 0; i < 60; i++) await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 20));
    return document.body.textContent ?? '';
}

beforeEach(() => {
    opened = [];
    patches = [];
    asked = [];
    location.hash = '';
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

describe('the dashboard', () => {
    it('draws a card per server cluster with its padlock, keys and verdict', async () => {
        vi.stubGlobal('k8sdockside', bridge());
        const text = await run('./overview.js', PAGE);
        expect(text).toContain('Servers ready');
        expect(text).toContain('5 / 7');
        expect(text).toContain('1 of 3 sealed');
        expect(text).toContain('2 of 3 keys entered on openbao-2');
        expect(text).toContain('Not initialised');
        expect(text).toContain('Auto-unseal: awskms');
        expect(text).toContain('Mixed versions');
        expect(text).toContain('openbao/openbao-active:http');
        expect(document.querySelectorAll('.card').length).toBe(3);
        expect(document.querySelector('.padlock.lock-partial')).not.toBeNull();
        expect(document.querySelector('.padlock.lock-open')).not.toBeNull();
        expect(document.querySelector('.padlock.lock-uninitialized')).not.toBeNull();
    });

    it('lists what needs attention, worst first, and how secrets reach pods', async () => {
        vi.stubGlobal('k8sdockside', bridge());
        const text = await run('./overview.js', PAGE);
        expect(text).toContain('Needs attention');
        expect(text).toContain('openbao-2 is sealed');
        expect(text).toContain('Static secret shop/stripe-keys: failing');
        expect(text).toContain('Secrets Operator');
        expect(text).toContain('Agent injector');
        expect(text).toContain('External Secrets');
        expect(text).toContain('CSI driver');
        const first = document.querySelector('.issue-title')?.textContent;
        expect(first).toBe('staging is not initialised');
    });

    it('asks the leader’s Service first, and never for anything but the unauthenticated status', async () => {
        vi.stubGlobal('k8sdockside', bridge());
        await run('./overview.js', PAGE);
        expect(asked).toContain('bao-active/v1/sys/seal-status');
        expect(asked.every((a) => /\/v1\/sys\/(seal-status|health|leader)$/.test(a))).toBe(true);
    });

    it('still draws from pod labels on an app that cannot call services', async () => {
        vi.stubGlobal('k8sdockside', bridge({ services: false }));
        const text = await run('./overview.js', PAGE);
        expect(text).toContain('1 of 3 sealed');
        expect(text).toContain('not reachable');
        expect(text).not.toContain('That did not work');
    });

    it('says plainly when there is nothing here', async () => {
        vi.stubGlobal('k8sdockside', bridge({ lists: { pods: [] } }));
        const text = await run('./overview.js', PAGE);
        expect(text).toContain('No OpenBao or Vault here');
    });
});

describe('the Servers view', () => {
    it('draws the chosen cluster, points out the leader, and says how to unseal the sealed node', async () => {
        location.hash = '#namespace=openbao&name=openbao';
        vi.stubGlobal('k8sdockside', bridge());
        const text = await run('./cluster.js', PAGE);
        expect(text).toContain('LEADER');
        expect(text).toContain('Unseal openbao-2');
        expect(text).toContain('kubectl --context test-cluster -n openbao exec -ti openbao-2 -- bao operator unseal');
        expect(text).toContain('2 of 3 keys entered so far');
        expect(text).toContain('never sees, stores or sends a key');
        expect(text).toContain('openbao-prod');
        expect(text).toContain('raft');
    });

    it('guides an uninitialised server through init', async () => {
        location.hash = '#namespace=bao-staging&name=staging';
        vi.stubGlobal('k8sdockside', bridge());
        const text = await run('./cluster.js', PAGE);
        expect(text).toContain('Initialise it');
        expect(text).toContain('staging-0 -- bao operator init');
    });

    it('uses the vault CLI for Vault and explains the upgrade', async () => {
        location.hash = '#namespace=vault&name=vault';
        vi.stubGlobal('k8sdockside', bridge());
        const text = await run('./cluster.js', PAGE);
        expect(text).toContain('Finish the upgrade');
        expect(text).toContain('delete pod vault-2');
        expect(text).toContain('awskms (auto-unseal)');
    });
});

describe('the secret flow', () => {
    it('draws every way secrets arrive, from server to workload', async () => {
        vi.stubGlobal('k8sdockside', bridge());
        const text = await run('./flow.js', PAGE);
        for (const want of ['SERVER', 'USED BY', 'app-config', 'stripe-keys', 'openbao-kv', 'model-keys', 'invoicer', 'role billing', 'warehouse-creds']) expect(text).toContain(want);
        expect(document.querySelectorAll('.fnode').length).toBeGreaterThan(30);
        expect(document.querySelector('.edge-error')).not.toBeNull();
    });

    it('narrows to problems when the dashboard asks', async () => {
        vi.stubGlobal('k8sdockside', bridge({ storage: { 'focus-flow': { problems: 'true' } } }));
        const text = await run('./flow.js', PAGE);
        expect(text).toContain('stripe-keys');
        expect(text).not.toContain('model-keys');
    });
});

describe('certificates and leases', () => {
    it('puts every certificate and lease on the timeline, soonest first', async () => {
        vi.stubGlobal('k8sdockside', bridge());
        const text = await run('./expiry.js', PAGE);
        expect(text).toContain('shop/mtls');
        expect(text).toContain('2 d left');
        expect(text).toContain('renewal overdue');
        expect(text).toContain('now');
    });
});

describe('the panels', () => {
    it('shows a sealed server pod as sealed, with its progress', async () => {
        const pod = F.serverPods[2];
        vi.stubGlobal('k8sdockside', bridge({ object: pod, ref: { kind: 'pods', namespace: 'openbao', name: 'openbao-2' } }));
        const text = await run('./pod.js', PANEL);
        expect(text).toContain('openbao-2 is sealed');
        expect(text).toContain('2 of 3 keys entered');
        expect(text).toContain('How to unseal it');
    });

    it('says what an application pod gets and from where', async () => {
        const pod = F.appPods[0];
        vi.stubGlobal('k8sdockside', bridge({ object: pod, ref: { kind: 'pods', namespace: 'shop', name: 'x' } }));
        const text = await run('./pod.js', PANEL);
        expect(text).toContain('app-config');
        expect(text).toContain('VaultStaticSecret stripe-keys');
        expect(text).toContain('from OpenBao openbao/openbao');
    });

    it('names the paths an injected pod gets', async () => {
        vi.stubGlobal('k8sdockside', bridge({ object: F.appPods[5], ref: { kind: 'pods', namespace: 'billing', name: 'x' } }));
        const text = await run('./pod.js', PANEL);
        expect(text).toContain('database/creds/billing');
        expect(text).toContain('role billing');
    });

    it('draws a sync’s chain and asks for a resync with one annotation', async () => {
        vi.stubGlobal('k8sdockside', bridge({ ref: { kind: 'crd:vaultstaticsecrets.secrets.hashicorp.com', namespace: 'shop', name: 'stripe-keys' } }));
        const text = await run('./vso.js', PANEL);
        expect(text).toContain('no secret found at secret/data/shop/stripe');
        expect(text).toContain('stripe-keys');
        const button = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Sync now');
        expect(button).toBeDefined();
        button?.click();
        await new Promise((resolve) => setTimeout(resolve, 5));
        expect(patches).toHaveLength(1);
        const annotations = (patches[0]?.patch as { metadata: { annotations: Record<string, string> } }).metadata.annotations;
        expect(Object.keys(annotations)).toEqual(['vso.hashicorp.com/resync']);
        expect(patches[0]?.name).toBe('stripe-keys');
    });

    it('offers no button when the plugin may not write', async () => {
        vi.stubGlobal('k8sdockside', bridge({ write: false, ref: { kind: 'crd:vaultpkisecrets.secrets.hashicorp.com', namespace: 'shop', name: 'web-tls' } }));
        const text = await run('./vso.js', PANEL);
        expect(text).toContain('expires in 2 d');
        expect(text).not.toContain('Reissue now');
    });
});
