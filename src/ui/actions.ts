// The one change the pages can ask for: "Sync now" on a Secrets Operator
// secret.
//
// The operator reconciles a VaultStaticSecret, VaultDynamicSecret or
// VaultPKISecret whenever its annotations change (controllers/predicates.go,
// annotationChangedPredicate, in hashicorp/vault-secrets-operator). For a
// dynamic or PKI secret that change also puts it in the operator's sync
// registry, which forces a new sync: new credentials, a new certificate
// (reason ForceSync). A static secret is read again and written if it
// changed. So "Sync now" writes one annotation with the time in it --
// vso.hashicorp.com/resync, the name the operator's own constants reserve
// for it -- and nothing else. A timestamp cannot be written in a manifest
// action, so it is a patch from the page, shown to the user first like every
// patch.

import type { SyncItem } from '../model/vso.js';
import { el } from './dom.js';

export const RESYNC_ANNOTATION = 'vso.hashicorp.com/resync';

/** RFC 3339 to the second. */
export function stamp(now = Date.now()): string {
    return new Date(now).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

const declined = (err: unknown) => err instanceof Error && /declined|cancel/i.test(err.message);

/** What pressing it will do, in a sentence, for the button's title. */
export function syncWords(item: SyncItem): string {
    if (item.kind === 'dynamic') return `Ask the operator for new credentials now: it fetches a fresh lease from ${item.location} and rewrites Secret ${item.destination}.`;
    if (item.kind === 'pki') return `Ask the operator for a new certificate now: it issues one from ${item.location} and rewrites Secret ${item.destination}.`;
    return `Ask the operator to read ${item.location} again now, and rewrite Secret ${item.destination} if it changed.`;
}

/** A "Sync now" button with a line for what happened. Nothing when the plugin may not write. */
export function syncButton(item: SyncItem, ctx: K8sDockside.Context, after?: () => void): HTMLElement | null {
    if (!ctx.write) return null;
    const notice = el('p', { class: 'notice' });
    const go = el('button', { type: 'button', class: 'primary', title: syncWords(item) }, item.kind === 'static' ? 'Sync now' : item.kind === 'pki' ? 'Reissue now' : 'Renew now');
    go.addEventListener('click', async () => {
        go.disabled = true;
        try {
            await k8sdockside.patch({ kind: item.ref.kind, namespace: item.namespace, name: item.name, patch: { metadata: { annotations: { [RESYNC_ANNOTATION]: stamp() } } } });
            notice.textContent = item.kind === 'static' ? 'Asked. The operator reads it again within seconds.' : 'Asked. The operator fetches a new one within seconds.';
            notice.className = 'notice notice-ok';
            after?.();
        } catch (err) {
            if (!declined(err)) {
                notice.textContent = err instanceof Error ? err.message : String(err);
                notice.className = 'notice notice-error';
            }
        } finally {
            go.disabled = false;
        }
    });
    return el('div', { class: 'action-row' }, go, notice);
}
