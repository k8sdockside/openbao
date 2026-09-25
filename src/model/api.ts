// What the servers' own API says, read without a token.
//
// Three endpoints answer anyone, and they are all this plugin asks
// (internal/http/handler.go in openbao/openbao registers them outside the
// authenticated router; Vault does the same):
//
//   /v1/sys/seal-status   sealed, initialized, t and n, unseal progress, the
//                         seal type, the version, the storage type and the
//                         cluster's name
//   /v1/sys/health        the same in brief, with the node's standing in its
//                         HTTP status: 200 active, 429 standby, 473
//                         performance standby, 501 not initialised, 503 sealed
//   /v1/sys/leader        whether HA is on and where the leader is
//
// sys/ha-status and the raft autopilot state need a token, so they are not
// asked: the plugin holds no token and never will.
//
// The requests go through the API server's service proxy to a Service, so an
// answer comes from whichever pod the Service picked. The one behind the
// `-active` Service is the leader, which is why the plugin asks that one
// first; the main Service can land on any pod, sealed ones included.

import type { Product } from './product.js';

export interface SealStatus {
    type?: string;
    initialized?: boolean;
    sealed?: boolean;
    t?: number;
    n?: number;
    progress?: number;
    version?: string;
    build_date?: string;
    migration?: boolean;
    cluster_name?: string;
    cluster_id?: string;
    recovery_seal?: boolean;
    recovery_seal_type?: string;
    storage_type?: string;
}

export interface Health {
    initialized?: boolean;
    sealed?: boolean;
    standby?: boolean;
    performance_standby?: boolean;
    replication_performance_mode?: string;
    replication_dr_mode?: string;
    server_time_utc?: number;
    version?: string;
    cluster_name?: string;
}

export interface Leader {
    ha_enabled?: boolean;
    is_self?: boolean;
    active_time?: string;
    leader_address?: string;
    leader_cluster_address?: string;
    performance_standby?: boolean;
    raft_committed_index?: number;
    raft_applied_index?: number;
}

/** What one declared service answered, or why it could not be asked. */
export interface ApiReading {
    /** Which product's services were asked. */
    product: Product;
    /** `active` for the leader's Service, `main` for the one in front of every pod. */
    via: 'active' | 'main';
    /** The Service that answered, as the app reports it: `namespace/name:port`. */
    service?: string;
    seal?: SealStatus;
    health?: Health;
    /** The HTTP status /v1/sys/health answered with: the node's standing. */
    healthCode?: number;
    leader?: Leader;
    /** Why it could not be asked, in the app's words. */
    error?: string;
}

/** A JSON body, or undefined when it is not one. */
export function parseJSON<T>(body: string | undefined): T | undefined {
    if (!body) return undefined;
    try {
        const value = JSON.parse(body) as unknown;
        return value && typeof value === 'object' ? (value as T) : undefined;
    } catch {
        return undefined;
    }
}

/** What an HTTP status from /v1/sys/health says about the node that answered. */
export function healthStanding(code: number | undefined): string {
    switch (code) {
        case 200:
            return 'active';
        case 429:
            return 'standby';
        case 472:
            return 'DR secondary';
        case 473:
            return 'performance standby';
        case 501:
            return 'not initialised';
        case 503:
            return 'sealed';
        case undefined:
            return '';
        default:
            return `HTTP ${code}`;
    }
}

/** Where an answer came from: `namespace/name:port` split up. */
export function serviceParts(service: string | undefined): { namespace: string; name: string } | undefined {
    if (!service) return undefined;
    const match = /^([^/]+)\/([^:]+)(?::.*)?$/.exec(service);
    if (!match || !match[1] || !match[2]) return undefined;
    return { namespace: match[1], name: match[2] };
}

/**
 * The chart's full name a Service belongs to: `openbao-active` and
 * `openbao-standby` are both in front of the StatefulSet `openbao`.
 */
export function serviceBase(name: string): string {
    return name.replace(/-(active|standby|internal|ui)$/, '');
}

/**
 * The pod a leader address names: the chart configures raft with
 * `http://openbao-0.openbao-internal:8200`, so the host's first label is the
 * pod. Undefined when the address is an IP or a Service.
 */
export function leaderHost(address: string | undefined): string | undefined {
    if (!address) return undefined;
    let host: string;
    try {
        host = new URL(address).hostname;
    } catch {
        host = address.replace(/^[a-z]+:\/\//, '').split(/[:/]/)[0] ?? '';
    }
    if (!host || /^[\d.]+$/.test(host) || host.includes(':')) return undefined;
    return host.split('.')[0];
}
