// The things every page in this plugin does the same way.
//
//  1. `start` wraps the page in one try/catch. Every bridge call rejects with
//     an Error carrying a sentence written for a person, so the honest thing
//     to do with a failure is show that sentence -- not a blank page and a
//     console nobody can open, because the page is in a sandboxed frame.
//  2. `every` keeps a page live: the page has no network of its own, so it
//     re-reads what it needs on a timer, never two reads at once.
//  3. Nothing subscribes to the theme: the SDK writes the app's tokens onto
//     :root before `ready()` resolves and rewrites them when the user
//     switches, so a stylesheet in var(--text) follows along on its own. The
//     drawings are SVG coloured by class for the same reason.

import { el, replace } from './dom.js';

/** Shows a failure where the user is looking, as a sentence. */
export function fail(host: HTMLElement, err: unknown): void {
    const message = err instanceof Error ? err.message : String(err);
    replace(host, el('div', { class: 'failure' }, el('strong', {}, 'That did not work. '), el('span', {}, message)));
}

/** Runs a page's body once the bridge is ready, and shows anything that goes wrong. */
export function start(hostId: string, body: (ctx: K8sDockside.Context) => Promise<void>): void {
    const run = async () => {
        const host = document.getElementById(hostId);
        try {
            const ctx = await k8sdockside.ready();
            await body(ctx);
        } catch (err) {
            if (host) fail(host, err);
        }
    };
    void run();
}

/** Runs `body` now and every `ms` after, handing anything it throws to `onError`. */
export function every(ms: number, body: () => Promise<void>, onError: (err: unknown) => void): () => void {
    let stopped = false;
    let busy = false;
    const tick = async () => {
        if (stopped || busy) return;
        busy = true;
        try {
            await body();
        } catch (err) {
            onError(err);
        } finally {
            busy = false;
        }
    };
    void tick();
    const timer = setInterval(() => void tick(), ms);
    return () => {
        stopped = true;
        clearInterval(timer);
    };
}

/** A list of a kind the cluster may not serve, or may not let us read: null rather than a failure. */
export async function maybeList<T>(query: K8sDockside.ListQuery): Promise<T[] | null> {
    try {
        return (await k8sdockside.list(query)) as unknown as T[];
    } catch {
        return null;
    }
}

/** What follows the # in a focused page's address, as the app writes it. */
export function focused(): { namespace: string; name: string } {
    const params = new URLSearchParams(location.hash.replace(/^#/, ''));
    return { namespace: params.get('namespace') ?? '', name: params.get('name') ?? '' };
}

/** Remembered per plugin and cluster, where the app can (0.0.19 and newer); forgotten otherwise. */
export const remember = {
    async get<T>(key: string): Promise<T | null> {
        try {
            return ((await k8sdockside.storage?.get(key)) as T | null) ?? null;
        } catch {
            return null;
        }
    },
    async set(key: string, value: unknown): Promise<void> {
        try {
            await k8sdockside.storage?.set(key, value);
        } catch {
            // The page works the same without it.
        }
    },
    async take<T>(key: string): Promise<T | null> {
        const value = await remember.get<T>(key);
        if (value !== null) {
            try {
                await k8sdockside.storage?.remove(key);
            } catch {
                // Nothing to forget.
            }
        }
        return value;
    },
};

/**
 * Opens another of this plugin's views on one object. `openView` takes only
 * a view's id, so the object travels through the plugin's storage: written
 * here, read (once) by the view as it loads.
 */
export async function openOn(viewId: string, focus: Record<string, string>): Promise<void> {
    await remember.set(`focus-${viewId}`, focus);
    await k8sdockside.openView(viewId);
}

/** What a view was asked to focus on: its address first, then what `openOn` left. */
export async function wanted(viewId: string): Promise<Record<string, string>> {
    const hash = focused();
    if (hash.name) return hash;
    return (await remember.take<Record<string, string>>(`focus-${viewId}`)) ?? {};
}

/** A moment the user's way when the app can say it (0.1.10 and newer), plainly otherwise. */
export function moment(at: number | undefined): string {
    if (at === undefined) return '—';
    const format = k8sdockside.format;
    if (format) return format.dateTime(at);
    return new Date(at).toLocaleString();
}

/** A stable fingerprint of what is drawn, so a refresh that changed nothing redraws nothing. */
export function fingerprint(value: unknown): string {
    return JSON.stringify(value, (_k, v: unknown) => (v instanceof Map ? [...v.entries()] : v));
}
