// Renders every page of the plugin to standalone HTML, with no cluster and no
// app: the same fixtures the render test uses, the plugin's real stylesheet,
// and the app's real theme tokens written onto :root the way the SDK does.
//
//   node scripts/preview.mjs [out-dir]
//
// It is a way to look at the pages, not a test -- the test is
// `npm run test`, which asserts on what this draws.
//
// The app's themes are read from a checkout of K8s Dockside beside this one
// (../k8sdockside); set K8SDOCKSIDE to point somewhere else.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Window } from 'happy-dom';
import * as esbuild from 'esbuild';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.argv[2] ?? path.join(ROOT, 'preview');
const APP = process.env.K8SDOCKSIDE ?? path.resolve(ROOT, '../k8sdockside');

const PAGE = '<div id="page"><div id="head"></div><p id="first"></p><div id="body"></div></div>';
const PANEL = '<div id="panel"></div>';

const STATIC = 'crd:vaultstaticsecrets.secrets.hashicorp.com';
const PKI = 'crd:vaultpkisecrets.secrets.hashicorp.com';
const pod = (f, name) => f.pods.find((p) => p.metadata.name === name || p.metadata.name.startsWith(name));

// [file name, page module, title, page or panel, address hash, the panel's object, what storage holds]
const PAGES = [
    ['overview', 'overview', 'Dashboard', 'page', ''],
    ['cluster', 'cluster', 'Servers: OpenBao, one node sealed', 'page', 'namespace=openbao&name=openbao'],
    ['cluster-vault', 'cluster', 'Servers: Vault, auto-unseal, mixed versions', 'page', 'namespace=vault&name=vault'],
    ['cluster-staging', 'cluster', 'Servers: OpenBao not initialised', 'page', 'namespace=bao-staging&name=staging'],
    ['flow', 'flow', 'Secret flow', 'page', ''],
    ['flow-problems', 'flow', 'Secret flow: only problems', 'page', '', null, { 'focus-flow': { problems: 'true' } }],
    ['expiry', 'expiry', 'Certificates & leases', 'page', ''],
    ['pod-server', 'pod', 'Panel: pod openbao-2 (sealed server)', 'panel', '', (f) => pod(f, 'openbao-2')],
    ['pod-app', 'pod', 'Panel: pod web (synced Secrets)', 'panel', '', (f) => pod(f, 'web-')],
    ['pod-agent', 'pod', 'Panel: pod invoicer (agent injector)', 'panel', '', (f) => pod(f, 'invoicer-')],
    ['vso-failing', 'vso', 'Panel: VaultStaticSecret stripe-keys (failing)', 'panel', '', (f) => ({ ...f.statics[1], ref: { kind: STATIC, namespace: 'shop', name: 'stripe-keys' } })],
    ['vso-pki', 'vso', 'Panel: VaultPKISecret web-tls (near expiry)', 'panel', '', (f) => ({ ...f.pkis[0], ref: { kind: PKI, namespace: 'shop', name: 'web-tls' } })],
];

/**
 * Bundles a TypeScript entry point and imports what it exports.
 *
 * The fragment on the end is not decoration: Node caches an ES module by its
 * URL, and a page is imported once per theme with byte-identical code.
 */
let imports = 0;
async function load(entry) {
    const built = await esbuild.build({ entryPoints: [entry], bundle: true, write: false, format: 'esm', platform: 'browser', target: ['es2022'] });
    const code = built.outputFiles[0].text;
    return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}#${imports++}`);
}

const themes = ['k8sdockside-light', 'k8sdockside-dark'].map((id) => JSON.parse(readFileSync(path.join(APP, 'internal/themes/builtin', `${id}.json`), 'utf8')));

// The same fixtures the render test asserts on.
const fixtures = await load(path.join(ROOT, 'src/fixtures.ts'));

const css = readFileSync(path.join(ROOT, 'ui/openbao.css'), 'utf8');
const logo = readFileSync(path.join(ROOT, 'ui/logo.svg'), 'utf8');

// Dates the way the app writes them by default: ISO dates, 24-hour clock.
const pad = (n) => String(n).padStart(2, '0');
const format = {
    settings: () => ({ clock: '24h', dates: 'iso', zone: 'local', ages: 'relative' }),
    date: (w) => { const d = new Date(w); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; },
    day: (w) => { const d = new Date(w); return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; },
    time: (w) => { const d = new Date(w); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; },
    dateTime: (w) => `${format.date(w)} ${format.time(w)}`,
    age: () => '',
    moment: (w) => ({ text: format.dateTime(w), title: '' }),
};

function stub(theme, object, storage) {
    const LISTS = fixtures.LISTS;
    const ref = object ? { kind: object.ref?.kind ?? 'pods', namespace: object.metadata.namespace, name: object.metadata.name } : null;
    return {
        ready: async () => ({
            pluginId: 'openbao', viewId: '', sectionId: object ? 'panel' : '', object: ref,
            contextId: 'preview', contextName: 'kind-openbao-dev', readable: [], write: true,
            actions: [], theme,
        }),
        object: async () => object,
        list: async ({ kind }) => { if (!(kind in LISTS)) throw new Error(`the cluster does not serve ${kind}`); return LISTS[kind]; },
        get: async () => null,
        open: async () => null, openView: async () => null, openUrl: async () => null,
        summary: async () => ({ pluginId: 'openbao', installed: true, checked: true, requirements: [], cards: [], error: '' }),
        storage: { get: async (k) => storage[k] ?? null, set: async () => null, remove: async () => null, keys: async () => [] },
        actions: async () => [], run: async () => ({ created: '' }), resize: async () => null,
        watch: () => () => {}, namespaces: async () => [],
        charts: async () => fixtures.charts,
        services: {
            get: async ({ service, path: p }) => {
                const s = fixtures.services[service];
                if (!s) throw new Error(`no service labelled for ${service} with that port in any namespace`);
                const a = s.answers[p];
                return { service: s.service, status: a?.status ?? 404, contentType: 'application/json', body: a?.body ?? '' };
            },
        },
        patch: async () => null, create: async () => ({ name: '' }),
        edit: async () => null, logs: async () => null, on: () => () => {},
        format,
    };
}

async function render(page, theme, object) {
    const [, module, , kind, hash, , storage = {}] = page;
    const win = new Window({ url: `https://preview.local/${hash ? `#${hash}` : ''}` });
    const { document } = win;
    document.body.innerHTML = kind === 'panel' ? PANEL : PAGE;
    document.body.className = kind === 'panel' ? 'panel' : '';

    const root = document.documentElement;
    for (const [name, value] of Object.entries(theme.tokens)) root.style.setProperty(`--${name}`, value);
    root.setAttribute('data-theme-base', theme.base);

    const globals = ['window', 'document', 'navigator', 'location', 'DOMParser', 'URLSearchParams', 'Node', 'Element', 'HTMLElement', 'SVGElement', 'Event', 'KeyboardEvent', 'addEventListener', 'setTimeout', 'setInterval', 'clearInterval'];
    for (const key of globals) {
        if (win[key] === undefined) continue;
        const value = typeof win[key] === 'function' && key.endsWith('EventListener') ? win[key].bind(win) : win[key];
        Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
    }
    Object.defineProperty(globalThis, 'k8sdockside', { value: stub(theme, object, storage), configurable: true, writable: true });

    await load(path.join(ROOT, 'src/pages', `${module}.ts`));
    for (let i = 0; i < 80; i++) await new Promise((r) => setTimeout(r, 1));

    const html = document.body.innerHTML;
    await win.happyDOM.close();
    return html;
}

mkdirSync(OUT, { recursive: true });
const index = [];

for (const page of PAGES) {
    const object = page[5] ? page[5](fixtures) : null;
    for (const theme of themes) {
        const html = await render(page, theme, object);
        const file = `${page[0]}.${theme.base}.html`;
        const panel = page[3] === 'panel';
        writeFileSync(
            path.join(OUT, file),
            `<!doctype html><html lang="en" data-theme-base="${theme.base}" style="${Object.entries(theme.tokens).map(([k, v]) => `--${k}:${v}`).join(';')}">
<head><meta charset="utf-8"><title>${page[2]} — ${theme.base}</title><style>${css}</style>${panel ? '<style>body.panel{max-width:760px}</style>' : ''}</head>
<body class="${panel ? 'panel' : ''}" style="background:var(--bg);color:var(--text)">${html}</body></html>`,
        );
        if (theme.base === 'light') index.push([page[2], page[0]]);
    }
}

writeFileSync(path.join(OUT, 'logo.svg'), logo);
writeFileSync(
    path.join(OUT, 'index.html'),
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>OpenBao &amp; Vault plugin preview</title>
<style>body{font:14px/1.6 system-ui;margin:40px auto;max-width:680px;color:#1a1d21}h1{font-size:20px}li{margin:4px 0}a{color:#0b6bcb}</style></head>
<body><h1>OpenBao &amp; Vault plugin — page preview</h1>
<p>Every page, drawn against fixtures: an OpenBao raft cluster with one node sealed, a Vault cluster on auto-unseal running two versions, an OpenBao nobody has initialised, Secrets Operator syncs that work, fail, went stale and are about to expire, agent-injected pods, an External Secrets store and a CSI class.</p>
<ul>${index.map(([label, id]) => `<li>${label} — <a href="${id}.light.html">light</a> · <a href="${id}.dark.html">dark</a></li>`).join('')}</ul>
<p style="color:#5c636b">Static HTML. Buttons and links do nothing: there is no app behind them.</p></body></html>`,
);
console.log(`wrote ${PAGES.length * 2 + 2} files to ${OUT}`);
console.log(`open ${path.join(OUT, 'index.html')}`);
process.exit(0);
