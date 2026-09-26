// Built by k8sdockside-plugin from src/ -- edit the TypeScript there, not this file.
"use strict";
(() => {
  // src/model/api.ts
  function parseJSON(body) {
    if (!body) return void 0;
    try {
      const value = JSON.parse(body);
      return value && typeof value === "object" ? value : void 0;
    } catch {
      return void 0;
    }
  }
  function serviceParts(service) {
    if (!service) return void 0;
    const match = /^([^/]+)\/([^:]+)(?::.*)?$/.exec(service);
    if (!match || !match[1] || !match[2]) return void 0;
    return { namespace: match[1], name: match[2] };
  }
  function serviceBase(name) {
    return name.replace(/-(active|standby|internal|ui)$/, "");
  }
  function leaderHost(address) {
    if (!address) return void 0;
    let host;
    try {
      host = new URL(address).hostname;
    } catch {
      host = address.replace(/^[a-z]+:\/\//, "").split(/[:/]/)[0] ?? "";
    }
    if (!host || /^[\d.]+$/.test(host) || host.includes(":")) return void 0;
    return host.split(".")[0];
  }

  // src/model/address.ts
  function addressParts(address, defaultNamespace = "") {
    if (!address) return void 0;
    let host = "";
    try {
      host = new URL(address.includes("://") ? address : `http://${address}`).hostname;
    } catch {
      return void 0;
    }
    if (!host) return void 0;
    if (/^[\d.]+$/.test(host) || host.includes(":") || host === "localhost") return { host };
    const labels = host.split(".");
    if (labels.length >= 2 && (labels[1] ?? "").endsWith("-internal")) {
      return { host, service: labels[1], namespace: labels[2] && labels[2] !== "svc" ? labels[2] : defaultNamespace || void 0 };
    }
    const inCluster = labels.length === 1 || labels[2] === "svc" || labels.length === 2 && labels[1] !== "svc";
    if (!inCluster) return { host };
    return { host, service: labels[0], namespace: labels.length >= 2 && labels[1] !== "svc" ? labels[1] : defaultNamespace || void 0 };
  }
  function clusterFor(address, defaultNamespace, clusters) {
    const parts = addressParts(address, defaultNamespace);
    if (!parts?.service) return void 0;
    const base = serviceBase(parts.service);
    const exact = clusters.find((c) => c.name === base && (!parts.namespace || c.namespace === parts.namespace));
    if (exact) return exact;
    const named = clusters.filter((c) => c.name === base);
    return named.length === 1 ? named[0] : void 0;
  }
  function shortAddress(address) {
    if (!address) return "";
    return address.replace(/^[a-z]+:\/\//i, "").replace(/\/$/, "");
  }

  // src/model/product.ts
  var REG = {
    openbao: {
      active: "openbao-active",
      sealed: "openbao-sealed",
      initialized: "openbao-initialized",
      perfStandby: "openbao-perf-standby",
      version: "openbao-version"
    },
    vault: {
      active: "vault-active",
      sealed: "vault-sealed",
      initialized: "vault-initialized",
      perfStandby: "vault-perf-standby",
      version: "vault-version"
    }
  };
  function productName(product) {
    return product === "openbao" ? "OpenBao" : product === "vault" ? "Vault" : "OpenBao or Vault";
  }
  function cli(product) {
    return product === "openbao" ? "bao" : "vault";
  }
  var SERVER_IMAGE = {
    openbao: /(^|\/)openbao(:|@|$)/,
    vault: /(^|\/)(vault|vault-enterprise)(:|@|$)/
  };
  var NOT_A_SERVER = /vault-k8s|openbao-k8s|vault-secrets-operator|csi-provider|agent-injector|external-secrets/;
  function imageProduct(image) {
    if (!image || NOT_A_SERVER.test(image)) return "unknown";
    const repo = image.split("@")[0] ?? image;
    const path = repo.replace(/:[^/:]*$/, "");
    if (SERVER_IMAGE.openbao.test(path)) return "openbao";
    if (SERVER_IMAGE.vault.test(path)) return "vault";
    return "unknown";
  }
  function registrationProduct(labels) {
    if (!labels) return "unknown";
    if (REG.openbao.sealed in labels || REG.openbao.initialized in labels || REG.openbao.active in labels) return "openbao";
    if (REG.vault.sealed in labels || REG.vault.initialized in labels || REG.vault.active in labels) return "vault";
    return "unknown";
  }
  function serverContainer(pod) {
    const containers = pod.spec?.containers ?? [];
    return containers.find((c) => imageProduct(c.image) !== "unknown") ?? containers[0];
  }
  function detectProduct(pod) {
    const labels = pod.metadata.labels;
    const registered = registrationProduct(labels);
    if (registered !== "unknown") return registered;
    for (const c of pod.spec?.containers ?? []) {
      const p = imageProduct(c.image);
      if (p !== "unknown") return p;
    }
    const name = labels?.["app.kubernetes.io/name"];
    if (name === "openbao") return "openbao";
    if (name === "vault") return "vault";
    return "unknown";
  }
  function containersProduct(containers) {
    for (const c of containers ?? []) {
      const p = imageProduct(c.image);
      if (p !== "unknown") return p;
    }
    return "unknown";
  }
  function isServerPod(pod) {
    const labels = pod.metadata.labels ?? {};
    if (registrationProduct(labels) !== "unknown") return true;
    if (labels["component"] !== "server") return false;
    const name = labels["app.kubernetes.io/name"];
    if (name === "openbao" || name === "vault") return true;
    return (pod.spec?.containers ?? []).some((c) => imageProduct(c.image) !== "unknown");
  }
  function imageVersion(image) {
    if (!image) return void 0;
    const noDigest = image.split("@")[0] ?? image;
    const match = /:([^/:]+)$/.exec(noDigest);
    if (!match || !match[1] || match[1] === "latest") return void 0;
    return match[1].replace(/^v(?=\d)/, "");
  }
  function normaliseVersion(version) {
    if (!version) return void 0;
    return version.trim().replace(/^v(?=\d)/, "").replace(/\+/g, "-") || void 0;
  }

  // src/model/types.ts
  var KIND = {
    pods: "pods",
    statefulsets: "statefulsets",
    deployments: "deployments",
    nodes: "nodes",
    webhooks: "mutatingwebhookconfigurations",
    // Vault Secrets Operator, group secrets.hashicorp.com.
    connections: "crd:vaultconnections.secrets.hashicorp.com",
    auths: "crd:vaultauths.secrets.hashicorp.com",
    authGlobals: "crd:vaultauthglobals.secrets.hashicorp.com",
    staticSecrets: "crd:vaultstaticsecrets.secrets.hashicorp.com",
    dynamicSecrets: "crd:vaultdynamicsecrets.secrets.hashicorp.com",
    pkiSecrets: "crd:vaultpkisecrets.secrets.hashicorp.com",
    // External Secrets Operator, group external-secrets.io.
    secretStores: "crd:secretstores.external-secrets.io",
    clusterSecretStores: "crd:clustersecretstores.external-secrets.io",
    externalSecrets: "crd:externalsecrets.external-secrets.io",
    // The Secrets Store CSI driver.
    providerClasses: "crd:secretproviderclasses.secrets-store.csi.x-k8s.io"
  };
  function condition(conditions, type) {
    return (conditions ?? []).find((c) => c.type === type);
  }
  function key(namespace, name) {
    return namespace ? `${namespace}/${name}` : name;
  }
  function when(value) {
    if (!value) return void 0;
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : void 0;
  }

  // src/model/units.ts
  var SECOND = 1e3;
  var MINUTE = 60 * SECOND;
  var HOUR = 60 * MINUTE;
  var DAY = 24 * HOUR;
  function plural(n, word, many = `${word}s`) {
    return `${n} ${n === 1 ? word : many}`;
  }
  var RANK = { error: 4, warn: 3, info: 2, ok: 1, "": 0 };
  function worst(...tones) {
    let out = "";
    for (const tone of tones) if ((RANK[tone] ?? 0) > (RANK[out] ?? 0)) out = tone;
    return out;
  }
  function span(ms) {
    const abs = Math.abs(ms);
    if (abs < MINUTE) return `${Math.round(abs / SECOND)} s`;
    if (abs < HOUR) return `${Math.round(abs / MINUTE)} min`;
    if (abs < 36 * HOUR) {
      const h = abs / HOUR;
      return `${h < 10 ? Math.round(h * 10) / 10 : Math.round(h)} h`;
    }
    return `${Math.round(abs / DAY)} d`;
  }
  function relative(at, now) {
    return at >= now ? `in ${span(at - now)}` : `${span(now - at)} ago`;
  }
  function goDuration(text2) {
    if (!text2) return void 0;
    const trimmed = text2.trim();
    if (trimmed === "0") return 0;
    const re = /(\d+(?:\.\d+)?)(ns|us|µs|ms|s|m|h|d)/g;
    const factor = { ns: 1e-6, us: 1e-3, µs: 1e-3, ms: 1, s: SECOND, m: MINUTE, h: HOUR, d: DAY };
    let total = 0;
    let consumed = 0;
    let match;
    while ((match = re.exec(trimmed)) !== null) {
      if (match.index !== consumed) return void 0;
      total += Number(match[1]) * (factor[match[2] ?? "s"] ?? 0);
      consumed = match.index + match[0].length;
    }
    return consumed === trimmed.length && consumed > 0 ? total : void 0;
  }

  // src/model/vso.ts
  var SYNC_KIND_WORDS = { static: "Static secret", dynamic: "Dynamic secret", pki: "PKI certificate" };
  var SYNC_APP_KIND = { static: KIND.staticSecrets, dynamic: KIND.dynamicSecrets, pki: KIND.pkiSecrets };
  function resolveRef(ref, ownNamespace, operatorNamespace2) {
    const value = (ref ?? "").trim();
    if (!value) return { namespace: operatorNamespace2, name: "default", defaulted: true };
    const parts = value.split("/");
    if (parts.length === 2) return { namespace: parts[0] ?? "", name: parts[1] ?? "", defaulted: false };
    return { namespace: ownNamespace, name: value, defaulted: false };
  }
  function failing(conditions) {
    const bad = (conditions ?? []).filter((c) => c.status === "False" && ["SecretSynced", "Healthy", "Ready", "LeaseRenewal", "ResourceValidation", "RolloutRestart"].includes(c.type));
    const order = ["SecretSynced", "LeaseRenewal", "ResourceValidation", "RolloutRestart", "Healthy", "Ready"];
    return bad.sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type))[0];
  }
  function shortMessage(message2) {
    if (!message2) return void 0;
    const err = /err=([\s\S]*)$/.exec(message2);
    return (err?.[1] ?? message2).trim();
  }
  function baseHealth(c) {
    const bad = failing(c.conditions);
    const behind = (c.lastGeneration ?? 0) > 0 && c.generation !== void 0 && c.generation > (c.lastGeneration ?? 0);
    if (bad) return { health: "failing", tone: "error", words: "failing", message: shortMessage(bad.message) || bad.reason, behind };
    if (!c.everSynced && !(c.conditions ?? []).some((x) => x.type === "Ready" && x.status === "True")) {
      return { health: "pending", tone: "info", words: "not synced yet", behind };
    }
    if (behind) return { health: "stale", tone: "warn", words: "spec changed, not synced since", behind };
    return { health: "synced", tone: "ok", words: "synced", behind };
  }
  function syncedAt(conditions) {
    const synced = condition(conditions, "SecretSynced");
    if (synced?.status === "True") return when(synced.lastTransitionTime);
    const ready = condition(conditions, "Ready");
    return ready?.status === "True" ? when(ready.lastTransitionTime) : void 0;
  }
  function dest(d) {
    return { destination: d?.name ?? "", create: d?.create === true };
  }
  function staticItem(o, operatorNamespace2) {
    const namespace = o.metadata.namespace ?? "";
    const spec = o.spec ?? {};
    const status = o.status ?? {};
    const base = baseHealth({ namespace, name: o.metadata.name, generation: o.metadata.generation, lastGeneration: status.lastGeneration, conditions: status.conditions, everSynced: !!status.secretMAC || (status.lastGeneration ?? 0) > 0 });
    const mount = spec.mount ?? "";
    const path = spec.path ?? "";
    return {
      kind: "static",
      namespace,
      name: o.metadata.name,
      ref: { kind: KIND.staticSecrets, namespace, name: o.metadata.name },
      mount,
      path,
      location: [mount, path].filter(Boolean).join("/"),
      secretType: spec.type,
      ...dest(spec.destination),
      auth: resolveRef(spec.vaultAuthRef, namespace, operatorNamespace2),
      rolloutTargets: spec.rolloutRestartTargets ?? [],
      ...base,
      lastSync: syncedAt(status.conditions),
      refreshAfter: spec.refreshAfter,
      instantUpdates: spec.syncConfig?.instantUpdates === true
    };
  }
  function dynamicItem(o, operatorNamespace2, now) {
    const namespace = o.metadata.namespace ?? "";
    const spec = o.spec ?? {};
    const status = o.status ?? {};
    const base = baseHealth({ namespace, name: o.metadata.name, generation: o.metadata.generation, lastGeneration: status.lastGeneration, conditions: status.conditions, everSynced: (status.lastRenewalTime ?? 0) > 0 || (status.lastGeneration ?? 0) > 0 });
    const mount = spec.mount ?? "";
    const path = spec.path ?? "";
    const item = {
      kind: "dynamic",
      namespace,
      name: o.metadata.name,
      ref: { kind: KIND.dynamicSecrets, namespace, name: o.metadata.name },
      mount,
      path,
      location: [mount, path].filter(Boolean).join("/"),
      ...dest(spec.destination),
      auth: resolveRef(spec.vaultAuthRef, namespace, operatorNamespace2),
      rolloutTargets: spec.rolloutRestartTargets ?? [],
      ...base,
      lastSync: status.lastRenewalTime ? status.lastRenewalTime * SECOND : syncedAt(status.conditions),
      renewable: status.secretLease?.renewable,
      refreshAfter: spec.refreshAfter
    };
    const issued = status.lastRenewalTime ? status.lastRenewalTime * SECOND : void 0;
    const duration = status.secretLease?.duration ?? 0;
    if (issued && duration > 0) {
      const percent = spec.renewalPercent && spec.renewalPercent > 0 ? Math.min(spec.renewalPercent, 90) : 67;
      item.issuedAt = issued;
      item.expires = issued + duration * SECOND;
      item.renewAt = issued + duration * SECOND * (percent / 100);
    }
    judgeExpiry(item, now);
    return item;
  }
  function pkiItem(o, operatorNamespace2, now) {
    const namespace = o.metadata.namespace ?? "";
    const spec = o.spec ?? {};
    const status = o.status ?? {};
    const base = baseHealth({ namespace, name: o.metadata.name, generation: o.metadata.generation, lastGeneration: status.lastGeneration, conditions: status.conditions, everSynced: !!status.serialNumber });
    const mount = spec.mount ?? "";
    const role = spec.role ?? "";
    const item = {
      kind: "pki",
      namespace,
      name: o.metadata.name,
      ref: { kind: KIND.pkiSecrets, namespace, name: o.metadata.name },
      mount,
      path: role,
      location: [mount, "issue", role].filter(Boolean).join("/"),
      ...dest(spec.destination),
      auth: resolveRef(spec.vaultAuthRef, namespace, operatorNamespace2),
      rolloutTargets: spec.rolloutRestartTargets ?? [],
      ...base,
      lastSync: status.lastRotation ? status.lastRotation * SECOND : syncedAt(status.conditions),
      commonName: spec.commonName,
      serial: status.serialNumber
    };
    if (status.valid === false || status.error && base.health !== "failing") {
      item.health = "failing";
      item.tone = "error";
      item.words = "failing";
      item.message = item.message ?? shortMessage(status.error) ?? "the operator marked it invalid";
    }
    if (status.expiration && status.expiration > 0) {
      item.expires = status.expiration * SECOND;
      item.issuedAt = status.lastRotation ? status.lastRotation * SECOND : void 0;
      const offset = goDuration(spec.expiryOffset) ?? 0;
      item.renewAt = item.expires - offset;
    }
    judgeExpiry(item, now);
    return item;
  }
  var GRACE = 5 * MINUTE;
  function judgeExpiry(item, now) {
    if (item.expires === void 0 || item.health === "failing") return;
    if (item.expires <= now) {
      item.health = "failing";
      item.tone = "error";
      item.words = item.kind === "pki" ? "certificate expired" : "lease expired";
      item.message = `${item.kind === "pki" ? "The certificate" : "The lease"} ran out ${relative(item.expires, now)} and has not been ${item.kind === "pki" ? "reissued" : "renewed"}.`;
      return;
    }
    if (item.renewAt !== void 0 && now > item.renewAt + GRACE && item.renewAt < item.expires) {
      item.health = "stale";
      item.tone = "warn";
      item.words = "renewal overdue";
      item.message = `It was due to be ${item.kind === "pki" ? "reissued" : "renewed"} ${relative(item.renewAt, now)}; it runs out ${relative(item.expires, now)}.`;
      return;
    }
    const life = item.issuedAt !== void 0 ? item.expires - item.issuedAt : void 0;
    const left = item.expires - now;
    const earlierRenewal = item.renewAt !== void 0 && item.renewAt < item.expires - GRACE;
    if (life !== void 0 && life >= DAY && left < life * 0.2 && left < 7 * DAY && !earlierRenewal) {
      item.health = item.health === "synced" ? "stale" : item.health;
      item.tone = "warn";
      item.words = `expires in ${span(left)}`;
      item.message = `Less than a fifth of its ${span(life)} life is left, and nothing is set to renew it sooner.`;
    }
  }
  function authRole(spec, method) {
    if (!spec) return void 0;
    const s = spec;
    const byMethod = { kubernetes: "kubernetes", jwt: "jwt", appRole: "appRole", aws: "aws", gcp: "gcp" };
    return s[byMethod[method] ?? method]?.role || void 0;
  }
  function authInfo(o, globals, operatorNamespace2) {
    const namespace = o.metadata.namespace ?? "";
    const spec = o.spec ?? {};
    const globalRef = spec.vaultAuthGlobalRef?.name ? globals.find((g) => g.metadata.name === spec.vaultAuthGlobalRef?.name && (g.metadata.namespace ?? "") === (spec.vaultAuthGlobalRef?.namespace || namespace)) : void 0;
    const method = spec.method || globalRef?.spec?.defaultAuthMethod || "kubernetes";
    const mount = spec.mount || globalRef?.spec?.defaultMount || method;
    const connectionRef = spec.vaultConnectionRef || globalRef?.spec?.vaultConnectionRef;
    const connection = resolveRef(connectionRef, namespace, operatorNamespace2);
    const valid = o.status?.valid ?? void 0;
    return {
      namespace,
      name: o.metadata.name,
      ref: { kind: KIND.auths, namespace, name: o.metadata.name },
      method,
      mount,
      role: authRole(spec, method) ?? authRole(globalRef?.spec, method),
      connection,
      valid: valid === null ? void 0 : valid,
      error: o.status?.error || void 0,
      tone: valid === false ? "error" : valid === true ? "ok" : ""
    };
  }
  function connectionInfo(o) {
    const namespace = o.metadata.namespace ?? "";
    const valid = o.status?.valid ?? void 0;
    return {
      namespace,
      name: o.metadata.name,
      ref: { kind: KIND.connections, namespace, name: o.metadata.name },
      address: o.spec?.address ?? "",
      valid: valid === null ? void 0 : valid,
      tone: valid === false ? "error" : valid === true ? "ok" : ""
    };
  }
  function syncItems(input, operatorNamespace2, now) {
    return [
      ...(input.statics ?? []).map((o) => staticItem(o, operatorNamespace2)),
      ...(input.dynamics ?? []).map((o) => dynamicItem(o, operatorNamespace2, now)),
      ...(input.pkis ?? []).map((o) => pkiItem(o, operatorNamespace2, now))
    ].sort((a, b) => a.namespace.localeCompare(b.namespace) || a.name.localeCompare(b.name));
  }
  function operatorNamespace(deployments, connections, auths) {
    const deployment = deployments.find((d) => d.metadata.labels?.["app.kubernetes.io/name"] === "vault-secrets-operator");
    if (deployment?.metadata.namespace) return deployment.metadata.namespace;
    const fallback = connections.find((c) => c.metadata.name === "default") ?? auths.find((a) => a.metadata.name === "default");
    return fallback?.metadata.namespace ?? "vault-secrets-operator-system";
  }

  // src/model/csi.ts
  var CSI_DRIVER = "secrets-store.csi.k8s.io";
  function objectPaths(objects) {
    if (!objects) return [];
    const out = [];
    for (const line of objects.split("\n")) {
      const match = /^[\s-]*secretPath\s*:\s*(.+?)\s*$/.exec(line);
      if (!match?.[1]) continue;
      const value = match[1].replace(/^["']|["']$/g, "").trim();
      if (value && !out.includes(value)) out.push(value);
    }
    return out;
  }
  function providerClasses(classes) {
    const out = [];
    for (const c of classes) {
      const provider = c.spec?.provider;
      if (provider !== "vault" && provider !== "openbao") continue;
      const p = c.spec?.parameters ?? {};
      const namespace = c.metadata.namespace ?? "";
      out.push({
        namespace,
        name: c.metadata.name,
        ref: { kind: KIND.providerClasses, namespace, name: c.metadata.name },
        provider,
        role: p["roleName"] || void 0,
        address: p["vaultAddress"] || p["baoAddress"] || p["openbaoAddress"] || void 0,
        paths: objectPaths(p["objects"]),
        syncs: (c.spec?.secretObjects ?? []).map((s) => s.secretName ?? "").filter(Boolean)
      });
    }
    return out;
  }
  function classesOf(pod) {
    return (pod.spec?.volumes ?? []).filter((v) => v.csi?.driver === CSI_DRIVER && v.csi.volumeAttributes?.["secretProviderClass"]).map((v) => v.csi?.volumeAttributes?.["secretProviderClass"] ?? "");
  }

  // src/model/consumers.ts
  var WORKLOAD_APP_KIND = {
    Deployment: KIND.deployments,
    StatefulSet: KIND.statefulsets,
    DaemonSet: "daemonsets",
    Job: "jobs",
    CronJob: "cronjobs",
    Pod: KIND.pods
  };
  function workloadOf(pod) {
    const namespace = pod.metadata.namespace ?? "";
    const owner = (pod.metadata.ownerReferences ?? []).find((o) => o.controller !== false) ?? pod.metadata.ownerReferences?.[0];
    if (owner?.kind === "ReplicaSet") {
      const hash = pod.metadata.labels?.["pod-template-hash"];
      const name = hash && owner.name.endsWith(`-${hash}`) ? owner.name.slice(0, -hash.length - 1) : owner.name.replace(/-[a-z0-9]{6,10}$/, "");
      return { kind: "Deployment", namespace, name };
    }
    if (owner?.kind === "StatefulSet" || owner?.kind === "DaemonSet") return { kind: owner.kind, namespace, name: owner.name };
    if (owner?.kind === "Job") {
      const cron = /^(.*)-\d{8,}$/.exec(owner.name);
      return cron?.[1] ? { kind: "CronJob", namespace, name: cron[1] } : { kind: "Job", namespace, name: owner.name };
    }
    return { kind: "Pod", namespace, name: pod.metadata.name };
  }
  function workloadKey(w) {
    return `${w.namespace}/${w.kind}/${w.name}`;
  }
  function secretsOf(pod) {
    const names = /* @__PURE__ */ new Set();
    const spec = pod.spec ?? {};
    for (const c of [...spec.initContainers ?? [], ...spec.containers ?? []]) {
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
  function podReady(pod) {
    return (pod.status?.conditions ?? []).some((c) => c.type === "Ready" && c.status === "True") || pod.status?.phase === "Succeeded";
  }
  function workloads(pods) {
    const out = /* @__PURE__ */ new Map();
    for (const pod of pods) {
      const id = workloadOf(pod);
      const k = workloadKey(id);
      let w = out.get(k);
      if (!w) {
        w = { ...id, id: k, ref: { kind: WORKLOAD_APP_KIND[id.kind], namespace: id.namespace, name: id.name }, pods: [], ready: 0, secrets: [], classes: [], tone: "" };
        out.set(k, w);
      }
      w.pods.push(pod);
      if (podReady(pod)) w.ready++;
      for (const s of secretsOf(pod)) if (!w.secrets.includes(s)) w.secrets.push(s);
      for (const c of classesOf(pod)) if (!w.classes.includes(c)) w.classes.push(c);
    }
    for (const w of out.values()) {
      w.tone = w.ready === w.pods.length ? "ok" : w.ready === 0 ? "error" : "warn";
      w.secrets.sort();
    }
    return out;
  }
  function usersBySecret(all) {
    const out = /* @__PURE__ */ new Map();
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

  // src/model/eso.ts
  function authMethod(auth) {
    if (!auth) return { method: "none" };
    if (auth.kubernetes) return { method: "kubernetes", role: auth.kubernetes.role };
    if (auth.jwt) return { method: "jwt", role: auth.jwt.role };
    if (auth.appRole) return { method: "approle" };
    if (auth.tokenSecretRef) return { method: "token" };
    if (auth.ldap) return { method: "ldap" };
    if (auth.userPass) return { method: "userpass" };
    if (auth.cert) return { method: "cert" };
    if (auth.iam) return { method: "aws iam" };
    if (auth.gcp) return { method: "gcp" };
    return { method: "other" };
  }
  function readiness(conditions) {
    const ready = condition(conditions, "Ready");
    if (!ready) return { tone: "info", words: "not checked yet" };
    if (ready.status === "True") return { tone: "ok", words: "ready" };
    return { tone: "error", words: ready.reason ? ready.reason.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase() : "not ready", message: ready.message };
  }
  function vaultStores(stores, clusterStores) {
    const out = [];
    const add = (s, kind) => {
      const vault = s.spec?.provider?.vault;
      if (!vault) return;
      const namespace = kind === "SecretStore" ? s.metadata.namespace ?? "" : "";
      const { method, role } = authMethod(vault.auth);
      out.push({
        kind,
        namespace,
        name: s.metadata.name,
        ref: { kind: kind === "SecretStore" ? KIND.secretStores : KIND.clusterSecretStores, namespace, name: s.metadata.name },
        server: vault.server ?? "",
        path: vault.path,
        version: vault.version,
        method,
        role,
        ...readiness(s.status?.conditions)
      });
    };
    for (const s of stores) add(s, "SecretStore");
    for (const s of clusterStores) add(s, "ClusterSecretStore");
    return out;
  }
  function storeOf(item, stores) {
    return stores.find((s) => s.kind === item.store.kind && s.name === item.store.name && (s.kind === "ClusterSecretStore" || s.namespace === item.namespace));
  }
  function externalItems(externals, stores) {
    const out = [];
    for (const e of externals) {
      const namespace = e.metadata.namespace ?? "";
      const storeKind = e.spec?.secretStoreRef?.kind === "ClusterSecretStore" ? "ClusterSecretStore" : "SecretStore";
      const item = {
        namespace,
        name: e.metadata.name,
        ref: { kind: KIND.externalSecrets, namespace, name: e.metadata.name },
        store: { kind: storeKind, name: e.spec?.secretStoreRef?.name ?? "" },
        target: e.spec?.target?.name || e.metadata.name,
        keys: [
          .../* @__PURE__ */ new Set([
            ...(e.spec?.data ?? []).map((d) => d.remoteRef?.key ?? "").filter(Boolean),
            ...(e.spec?.dataFrom ?? []).map((d) => d.extract?.key ?? d.find?.path ?? "").filter(Boolean)
          ])
        ],
        ...readiness(e.status?.conditions),
        refreshed: when(e.status?.refreshTime)
      };
      if (item.words === "ready") item.words = "synced";
      if (storeOf(item, stores)) out.push(item);
    }
    return out.sort((a, b) => key(a.namespace, a.name).localeCompare(key(b.namespace, b.name)));
  }

  // src/model/injector.ts
  var PREFIXES = ["vault.hashicorp.com/", "openbao.org/"];
  function truthy(value) {
    return value !== void 0 && /^(true|1|t|yes|on)$/i.test(value.trim());
  }
  function injectionOf(annotations) {
    if (!annotations) return void 0;
    for (const prefix of PREFIXES) {
      const inject = annotations[`${prefix}agent-inject`];
      const status = annotations[`${prefix}agent-inject-status`];
      const secretKeys = Object.keys(annotations).filter((k) => k.startsWith(`${prefix}agent-inject-secret-`));
      if (inject === void 0 && status === void 0 && secretKeys.length === 0) continue;
      const secrets = secretKeys.map((k) => {
        const file = k.slice(`${prefix}agent-inject-secret-`.length);
        return {
          file: annotations[`${prefix}agent-inject-file-${file}`] || file,
          path: (annotations[k] ?? "").trim(),
          templated: `${prefix}agent-inject-template-${file}` in annotations || `${prefix}agent-inject-template-file-${file}` in annotations
        };
      }).sort((a, b) => a.file.localeCompare(b.file));
      return {
        prefix,
        product: prefix === "openbao.org/" ? "openbao" : "unknown",
        requested: truthy(inject),
        injected: status === "injected" || status === "update",
        role: annotations[`${prefix}role`] || void 0,
        authPath: annotations[`${prefix}auth-path`] || void 0,
        service: annotations[`${prefix}service`] || void 0,
        vaultNamespace: annotations[`${prefix}namespace`] || void 0,
        prePopulateOnly: truthy(annotations[`${prefix}agent-pre-populate-only`]),
        secrets
      };
    }
    return void 0;
  }
  function injectedPods(pods) {
    const out = [];
    for (const pod of pods) {
      const injection = injectionOf(pod.metadata.annotations);
      if (!injection || !injection.requested && !injection.injected) continue;
      const namespace = pod.metadata.namespace ?? "";
      const running = pod.status?.phase === "Running" || pod.status?.phase === "Succeeded";
      let tone = "ok";
      let words = injection.prePopulateOnly ? "rendered at start" : "agent running";
      if (!injection.injected) {
        tone = "warn";
        words = "asked for the agent, not injected";
      } else if (!running) {
        tone = pod.status?.phase === "Pending" ? "warn" : "error";
        words = pod.status?.phase === "Pending" ? "waiting for its secrets" : `pod ${pod.status?.phase ?? "unknown"}`;
      }
      out.push({ pod, namespace, name: pod.metadata.name, ref: { kind: KIND.pods, namespace, name: pod.metadata.name }, injection, tone, words });
    }
    return out.sort((a, b) => a.namespace.localeCompare(b.namespace) || a.name.localeCompare(b.name));
  }
  function isInjector(deployment) {
    const labels = deployment.metadata.labels ?? {};
    const name = labels["app.kubernetes.io/name"] ?? "";
    return name.endsWith("-agent-injector") || deployment.metadata.name.endsWith("-agent-injector") || labels["component"] === "webhook" && /vault|openbao/.test(name);
  }
  function injectors(deployments, webhooks) {
    return deployments.filter(isInjector).map((d) => {
      const namespace = d.metadata.namespace ?? "";
      const desired = d.spec?.replicas ?? 1;
      const ready = d.status?.readyReplicas ?? 0;
      const env = d.spec?.template?.spec?.containers?.flatMap((c) => c.env ?? []) ?? [];
      const address = env.find((e) => e.name === "AGENT_INJECT_VAULT_ADDR")?.value;
      const hook = webhooks.flatMap((w) => (w.webhooks ?? []).map((h) => ({ config: w.metadata.name, hook: h }))).find(({ hook: hook2 }) => hook2.clientConfig?.service?.namespace === namespace && (hook2.clientConfig?.service?.name ?? "").startsWith(d.metadata.name));
      const tone = desired === 0 ? "warn" : ready === 0 ? "error" : ready < desired ? "warn" : "ok";
      const words = desired === 0 ? "scaled to zero" : ready === 0 ? "down" : ready < desired ? `${ready} of ${desired} ready` : "ready";
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
        words
      };
    });
  }

  // src/model/servers.ts
  var ZONE = "topology.kubernetes.io/zone";
  function flag(value) {
    if (value === "true") return true;
    if (value === "false") return false;
    return void 0;
  }
  function podReady2(pod) {
    return condition(pod.status?.conditions, "Ready")?.status === "True";
  }
  function roleOf(node) {
    if (node.phase !== "Running") return node.phase === "Pending" ? "pending" : "down";
    if (node.initialized === false) return "uninitialized";
    if (node.sealed === true) return "sealed";
    if (node.active === true) return "active";
    if (node.perfStandby === true) return "perf-standby";
    if (node.sealed === false) return "standby";
    return node.ready ? "running" : "pending";
  }
  var ROLE_WORDS = {
    active: "active",
    standby: "standby",
    "perf-standby": "performance standby",
    sealed: "sealed",
    uninitialized: "not initialised",
    down: "not running",
    running: "running",
    pending: "starting"
  };
  function roleTone(role, ready) {
    switch (role) {
      case "sealed":
      case "down":
        return "error";
      case "uninitialized":
      case "pending":
        return "warn";
      case "active":
      case "standby":
      case "perf-standby":
        return ready ? "ok" : "warn";
      default:
        return ready ? "ok" : "warn";
    }
  }
  function settle(node) {
    node.role = roleOf(node);
    node.tone = roleTone(node.role, node.ready);
    node.words = ROLE_WORDS[node.role];
  }
  function nodeOf(pod, zones) {
    const product = detectProduct(pod);
    const labels = pod.metadata.labels ?? {};
    const reg = REG[product === "vault" ? "vault" : "openbao"];
    const container = serverContainer(pod);
    const sealed = flag(labels[reg.sealed]);
    const initialized = flag(labels[reg.initialized]);
    const namespace = pod.metadata.namespace ?? "";
    const node = {
      name: pod.metadata.name,
      namespace,
      product,
      ref: { kind: KIND.pods, namespace, name: pod.metadata.name },
      ready: podReady2(pod),
      phase: pod.status?.phase ?? "Unknown",
      restarts: (pod.status?.containerStatuses ?? []).reduce((n, c) => n + (c.restartCount ?? 0), 0),
      nodeName: pod.spec?.nodeName,
      zone: pod.spec?.nodeName ? zones.get(pod.spec.nodeName) : void 0,
      version: normaliseVersion(labels[reg.version]) ?? normaliseVersion(imageVersion(container?.image)),
      image: container?.image,
      sealed,
      initialized,
      active: flag(labels[reg.active]),
      perfStandby: flag(labels[reg.perfStandby]),
      source: sealed !== void 0 || initialized !== void 0 ? "labels" : "none",
      role: "running",
      tone: "",
      words: "",
      leader: false
    };
    node.leader = node.active === true;
    settle(node);
    return node;
  }
  function groupOf(pod) {
    const namespace = pod.metadata.namespace ?? "";
    const owner = (pod.metadata.ownerReferences ?? []).find((o) => o.kind === "StatefulSet");
    if (owner) return { name: owner.name, ref: { kind: KIND.statefulsets, namespace, name: owner.name } };
    const instance = pod.metadata.labels?.["app.kubernetes.io/instance"];
    if (instance) return { name: instance, ref: { kind: KIND.pods, namespace, name: pod.metadata.name } };
    return { name: pod.metadata.name, ref: { kind: KIND.pods, namespace, name: pod.metadata.name } };
  }
  function readingCluster(reading2, clusters) {
    const parts = serviceParts(reading2.service);
    if (!parts) return void 0;
    const base = serviceBase(parts.name);
    const exact = clusters.find((c) => c.namespace === parts.namespace && c.name === base);
    if (exact) return exact;
    const sameNs = clusters.filter((c) => c.namespace === parts.namespace && (c.product === reading2.product || c.product === "unknown"));
    if (sameNs.length === 1) return sameNs[0];
    return void 0;
  }
  function applyApi(cluster) {
    const active = cluster.active;
    const main = cluster.main;
    const seal = active?.seal ?? main?.seal;
    if (seal) {
      cluster.seal.type = seal.type;
      cluster.seal.auto = !!seal.type && seal.type !== "shamir";
      cluster.seal.t = seal.t;
      cluster.seal.n = seal.n;
      cluster.storage = seal.storage_type;
      cluster.clusterName = seal.cluster_name || void 0;
      cluster.version = normaliseVersion(seal.version);
    }
    const health = active?.health ?? main?.health;
    if (!cluster.clusterName && health?.cluster_name) cluster.clusterName = health.cluster_name;
    if (!cluster.version && health?.version) cluster.version = normaliseVersion(health.version);
    const leader = active?.leader ?? main?.leader;
    if (leader) {
      cluster.ha = leader.ha_enabled;
      cluster.leaderAddress = leader.leader_address || void 0;
      const host = leaderHost(leader.leader_address);
      if (host && cluster.nodes.some((n) => n.name === host)) cluster.leaderName = host;
    }
    const sealedAnswer = [main?.seal, active?.seal].find((s) => s?.sealed === true);
    if (sealedAnswer) {
      cluster.seal.progress = sealedAnswer.progress ?? 0;
      if (cluster.seal.t === void 0) cluster.seal.t = sealedAnswer.t;
      if (cluster.seal.n === void 0) cluster.seal.n = sealedAnswer.n;
      const sealedNodes = cluster.nodes.filter((n) => n.sealed === true);
      if (sealedNodes.length === 1) cluster.seal.progressNode = sealedNodes[0]?.name;
      else if (cluster.nodes.length === 1) cluster.seal.progressNode = cluster.nodes[0]?.name;
    }
    for (const node of cluster.nodes) {
      if (node.source !== "none") continue;
      if (cluster.leaderName === node.name) {
        Object.assign(node, { sealed: false, initialized: true, active: true, source: "api" });
      } else if (cluster.nodes.length === 1) {
        const answer = main?.seal ?? active?.seal;
        if (answer) {
          node.sealed = answer.sealed;
          node.initialized = answer.initialized;
          const code = main?.healthCode ?? active?.healthCode;
          node.active = answer.sealed ? false : code === 200 || code === void 0 && (health?.standby === false || leader?.is_self === true || leader?.ha_enabled === false);
          node.perfStandby = code === 473 || health?.performance_standby === true;
          node.source = "api";
        }
      }
      settle(node);
    }
    for (const node of cluster.nodes) if (cluster.leaderName === node.name) node.leader = true;
  }
  function describe(cluster) {
    const c = cluster.counts;
    const name = productName(cluster.product);
    const leader = cluster.nodes.find((n) => n.role === "active");
    const standbys = cluster.nodes.filter((n) => n.role === "standby" || n.role === "perf-standby");
    const sealedNames = cluster.nodes.filter((n) => n.role === "sealed").map((n) => n.name);
    const t = cluster.seal.t;
    const keys = t ? plural(t, "unseal key") : "the unseal keys";
    if (cluster.lock === "uninitialized") {
      cluster.tone = "error";
      cluster.words = "Not initialised";
      cluster.sentence = `Nobody has run ${cluster.cli} operator init on it, so it holds no secrets and serves no one.`;
      return;
    }
    if (cluster.lock === "closed") {
      cluster.tone = "error";
      cluster.words = c.total === 1 ? "Sealed" : "All sealed";
      cluster.sentence = cluster.seal.auto ? `Every node is sealed and waiting for its ${cluster.seal.type} auto-unseal to answer. Nothing can read a secret until it does.` : `Every node is sealed. Nothing can read a secret until ${keys} are entered on ${c.total === 1 ? "it" : "each node"}.`;
      return;
    }
    if (c.total === 0) {
      cluster.tone = "error";
      cluster.words = "No pods";
      cluster.sentence = `The StatefulSet has no ${name} pods running.`;
      return;
    }
    if (cluster.lock === "partial") {
      cluster.tone = "warn";
      cluster.words = `${c.sealed} of ${c.total} sealed`;
      cluster.sentence = leader ? `Serving from ${leader.name}. ${sealedNames.join(", ")} ${sealedNames.length === 1 ? "is" : "are"} sealed and cannot take over if the leader goes.` : `${sealedNames.join(", ")} ${sealedNames.length === 1 ? "is" : "are"} sealed, and no node says it is the leader.`;
      return;
    }
    if (cluster.lock === "open" && cluster.nodes.length > 1 && !leader && cluster.ha !== false) {
      cluster.tone = "error";
      cluster.words = "No leader";
      cluster.sentence = "Every node is unsealed, yet none of them is active: requests have nowhere to go until one is elected.";
      return;
    }
    if (c.down > 0 || c.ready < c.total) {
      cluster.tone = c.down > 0 ? "error" : "warn";
      cluster.words = `${c.ready} of ${c.total} ready`;
      cluster.sentence = leader ? `Serving from ${leader.name}, with ${plural(c.total - c.ready, "node")} not ready.` : `${plural(c.total - c.ready, "node")} not ready.`;
      return;
    }
    if (cluster.drift) {
      cluster.tone = "warn";
      cluster.words = "Mixed versions";
      cluster.sentence = `The nodes run ${cluster.versions.join(" and ")}: finish the upgrade, standbys first and the leader last.`;
      return;
    }
    if (cluster.lock === "unknown") {
      cluster.tone = "";
      cluster.words = "Seal state unknown";
      cluster.sentence = cluster.apiError ? `The pods carry no service-registration labels and the API could not be asked: ${cluster.apiError}` : "The pods carry no service-registration labels, and no API answer could be pinned to them.";
      return;
    }
    cluster.tone = "ok";
    cluster.words = "Unsealed";
    if (c.total === 1) cluster.sentence = `One node, unsealed and serving${cluster.storage ? ` from ${cluster.storage} storage` : ""}.`;
    else cluster.sentence = `${leader?.name ?? "The leader"} is active, with ${plural(standbys.length, "standby", "standbys")} ready to take over.`;
  }
  function buildClusters(input) {
    const zones = /* @__PURE__ */ new Map();
    for (const n of input.nodes ?? []) {
      const zone = n.metadata.labels?.[ZONE];
      if (zone) zones.set(n.metadata.name, zone);
    }
    const byId2 = /* @__PURE__ */ new Map();
    for (const pod of input.pods) {
      if (!isServerPod(pod)) continue;
      const group = groupOf(pod);
      const namespace = pod.metadata.namespace ?? "";
      const id = key(namespace, group.name);
      const node = nodeOf(pod, zones);
      let cluster = byId2.get(id);
      if (!cluster) {
        cluster = {
          id,
          namespace,
          name: group.name,
          product: node.product,
          ref: group.ref,
          nodes: [],
          seal: { auto: false },
          versions: [],
          drift: false,
          counts: { total: 0, ready: 0, sealed: 0, unsealed: 0, uninitialized: 0, down: 0, unknown: 0 },
          lock: "unknown",
          tone: "",
          words: "",
          sentence: "",
          cli: cli(node.product)
        };
        byId2.set(id, cluster);
      }
      if (cluster.product === "unknown" && node.product !== "unknown") {
        cluster.product = node.product;
        cluster.cli = cli(node.product);
      }
      cluster.nodes.push(node);
    }
    for (const sts of input.statefulsets ?? []) {
      const namespace = sts.metadata.namespace ?? "";
      const id = key(namespace, sts.metadata.name);
      const existing = byId2.get(id);
      if (existing) {
        existing.desired = sts.spec?.replicas;
        continue;
      }
      const product = containersProduct(sts.spec?.template?.spec?.containers);
      const chart = sts.metadata.labels?.["app.kubernetes.io/name"];
      if (product === "unknown" && chart !== "openbao" && chart !== "vault") continue;
      const which = product !== "unknown" ? product : chart === "vault" ? "vault" : "openbao";
      byId2.set(id, {
        id,
        namespace,
        name: sts.metadata.name,
        product: which,
        ref: { kind: KIND.statefulsets, namespace, name: sts.metadata.name },
        nodes: [],
        desired: sts.spec?.replicas,
        seal: { auto: false },
        versions: [],
        drift: false,
        counts: { total: 0, ready: 0, sealed: 0, unsealed: 0, uninitialized: 0, down: 0, unknown: 0 },
        lock: "unknown",
        tone: "",
        words: "",
        sentence: "",
        cli: cli(which)
      });
    }
    const clusters = [...byId2.values()].sort((a, b) => a.namespace.localeCompare(b.namespace) || a.name.localeCompare(b.name));
    for (const cluster of clusters) {
      cluster.nodes.sort((a, b) => a.name.localeCompare(b.name, void 0, { numeric: true }));
    }
    const readings2 = input.readings ?? [];
    for (const reading2 of readings2) {
      if (reading2.error) continue;
      const cluster = readingCluster(reading2, clusters);
      if (!cluster) continue;
      if (reading2.via === "active" && !cluster.active) cluster.active = reading2;
      if (reading2.via === "main" && !cluster.main) cluster.main = reading2;
    }
    for (const cluster of clusters) {
      if (!cluster.active && !cluster.main) {
        const failed = readings2.find((r) => r.product === cluster.product && r.error);
        const answered = readings2.find((r) => r.product === cluster.product && !r.error);
        cluster.apiError = failed?.error ? failed.error : answered ? `the ${productName(cluster.product)} API answered from ${answered.service}, which is another cluster: the app calls the first matching Service it finds` : void 0;
      }
      applyApi(cluster);
      const c = cluster.counts;
      c.total = cluster.nodes.length;
      c.ready = cluster.nodes.filter((n) => n.ready).length;
      c.sealed = cluster.nodes.filter((n) => n.role === "sealed").length;
      c.unsealed = cluster.nodes.filter((n) => n.sealed === false).length;
      c.uninitialized = cluster.nodes.filter((n) => n.role === "uninitialized").length;
      c.down = cluster.nodes.filter((n) => n.role === "down").length;
      c.unknown = cluster.nodes.filter((n) => n.sealed === void 0 && n.role !== "down").length;
      const versions = /* @__PURE__ */ new Set();
      for (const n of cluster.nodes) if (n.version) versions.add(n.version);
      cluster.versions = [...versions].sort();
      cluster.drift = cluster.versions.length > 1;
      if (!cluster.version) cluster.version = cluster.versions.length === 1 ? cluster.versions[0] : void 0;
      const apiUninit = (cluster.active?.seal ?? cluster.main?.seal)?.initialized === false;
      const known = c.total - c.unknown - c.down;
      if (c.uninitialized > 0 || apiUninit) cluster.lock = "uninitialized";
      else if (known <= 0) cluster.lock = "unknown";
      else if (c.sealed >= known && c.unsealed === 0) cluster.lock = "closed";
      else if (c.sealed > 0) cluster.lock = "partial";
      else cluster.lock = "open";
      if (!cluster.leaderName) cluster.leaderName = cluster.nodes.find((n) => n.role === "active")?.name;
      describe(cluster);
    }
    return clusters;
  }

  // src/model/world.ts
  function derive(snap, now) {
    const clusters = buildClusters({ pods: snap.pods, statefulsets: snap.statefulsets, nodes: snap.nodes, readings: snap.readings });
    const opNs = operatorNamespace(snap.deployments ?? [], snap.connections ?? [], snap.auths ?? []);
    const items = syncItems({ statics: snap.statics, dynamics: snap.dynamics, pkis: snap.pkis }, opNs, now);
    const auths = (snap.auths ?? []).map((a) => authInfo(a, snap.authGlobals ?? [], opNs));
    const connections = (snap.connections ?? []).map(connectionInfo);
    const stores = vaultStores(snap.secretStores ?? [], snap.clusterSecretStores ?? []);
    const externals = externalItems(snap.externalSecrets ?? [], stores);
    const classes = providerClasses(snap.providerClasses ?? []);
    const all = workloads(snap.pods);
    const world = {
      now,
      clusters,
      operatorNamespace: opNs,
      items,
      auths,
      connections,
      injectors: injectors(snap.deployments ?? [], snap.webhooks ?? []),
      injected: injectedPods(snap.pods),
      stores,
      externals,
      classes,
      workloads: all,
      users: usersBySecret(all),
      served: { vso: snap.served?.vso ?? items.length > 0, eso: snap.served?.eso ?? stores.length > 0, csi: snap.served?.csi ?? classes.length > 0 },
      anything: false
    };
    world.anything = clusters.length > 0 || items.length > 0 || world.injected.length > 0 || world.injectors.length > 0 || stores.length > 0 || classes.length > 0 || connections.length > 0;
    return world;
  }
  function authOf(world, item) {
    return world.auths.find((a) => a.namespace === item.auth.namespace && a.name === item.auth.name);
  }
  function connectionOf(world, auth) {
    if (!auth) return void 0;
    return world.connections.find((c) => c.namespace === auth.connection.namespace && c.name === auth.connection.name);
  }
  function sourceFor(world, address, namespace) {
    const cluster = clusterFor(address, namespace, world.clusters);
    if (cluster) return { id: `srv:${cluster.id}`, cluster, address, label: cluster.name };
    if (address) return { id: `ext:${shortAddress(address)}`, address, label: shortAddress(address) };
    if (world.clusters.length === 1 && world.clusters[0]) return { id: `srv:${world.clusters[0].id}`, cluster: world.clusters[0], label: world.clusters[0].name };
    return { id: "ext:unknown", label: "unknown server" };
  }
  function sourceOfItem(world, item) {
    const auth = authOf(world, item);
    const connection = connectionOf(world, auth);
    return sourceFor(world, connection?.address, connection?.namespace ?? item.namespace);
  }
  function sourceOfStore(world, store) {
    return sourceFor(world, store.server, store.namespace);
  }
  function sourceOfInjection(world, pod) {
    const address = pod.injection.service ?? world.injectors.find((i) => i.address)?.address;
    return sourceFor(world, address, pod.namespace);
  }
  function sourceOfClass(world, c) {
    return sourceFor(world, c.address, c.namespace);
  }
  function consumersOfItem(world, item) {
    return world.users.get(key(item.namespace, item.destination)) ?? [];
  }
  function storeOfExternal(world, e) {
    return storeOf(e, world.stores);
  }

  // src/model/flow.ts
  var VIAS = ["vso", "agent", "eso", "csi"];
  var VIA_WORDS = { vso: "Secrets Operator", agent: "Agent injector", eso: "External Secrets", csi: "CSI driver" };
  var COLUMNS = ["Server", "Logs in as", "Synced by", "Kubernetes Secret", "Used by"];
  var Builder = class {
    nodes = /* @__PURE__ */ new Map();
    edges = /* @__PURE__ */ new Map();
    node(n) {
      const had = this.nodes.get(n.id);
      if (had) {
        had.tone = worst(had.tone, n.tone);
        return had;
      }
      this.nodes.set(n.id, n);
      return n;
    }
    edge(from, to, tone, extra = {}) {
      const id = `${from}->${to}`;
      const had = this.edges.get(id);
      if (had) {
        had.tone = worst(had.tone, tone);
        return;
      }
      this.edges.set(id, { id, from, to, tone, ...extra });
    }
  };
  function serverNode(b, source, via) {
    const c = source.cluster;
    if (c) {
      return b.node({
        id: source.id,
        col: 0,
        type: "server",
        kicker: `${c.nodes.length === 1 ? "1 node" : `${c.nodes.length} nodes`}${c.storage ? ` · ${c.storage}` : ""}`,
        label: c.name,
        sub: `${c.namespace} · ${c.words.toLowerCase()}`,
        tone: c.tone,
        title: `${productName(c.product)} ${c.namespace}/${c.name}: ${c.sentence}`,
        ref: c.ref,
        badge: c.product === "openbao" ? "OpenBao" : c.product === "vault" ? "Vault" : void 0,
        via,
        namespace: c.namespace,
        clusterId: c.id
      });
    }
    return b.node({
      id: source.id,
      col: 0,
      type: "server",
      kicker: "Server outside the cluster",
      label: source.label,
      sub: source.address ? "not in view" : "no address given",
      tone: "",
      title: source.address ? `${source.address}: a server this cluster does not run, or one the plugin cannot see.` : "Nothing names the server, and more than one is in view.",
      via
    });
  }
  function workloadNode(b, w, via, extra = "") {
    return b.node({
      id: `wl:${w.id}`,
      col: 4,
      type: "workload",
      kicker: `${w.kind}${extra}`,
      label: w.name,
      sub: `${w.namespace} · ${w.ready}/${w.pods.length} ready`,
      tone: w.tone,
      title: `${w.kind} ${w.namespace}/${w.name}: ${plural(w.pods.length, "pod")}, ${w.ready} ready.`,
      ref: w.ref,
      via,
      namespace: w.namespace
    });
  }
  function secretNode(b, namespace, name, tone, via) {
    return b.node({
      id: `sec:${key(namespace, name)}`,
      col: 3,
      type: "secret",
      kicker: "Secret",
      label: name,
      sub: namespace,
      tone,
      title: `Secret ${namespace}/${name}. Only its name is shown: plugin pages can never read Secrets.`,
      ref: { kind: "secrets", namespace, name },
      via,
      namespace
    });
  }
  function buildFlow(world) {
    const b = new Builder();
    for (const item of world.items) {
      const src = serverNode(b, sourceOfItem(world, item), "vso");
      const auth = authOf(world, item);
      const authId = `auth:${key(item.auth.namespace, item.auth.name)}`;
      b.node({
        id: authId,
        col: 1,
        type: "login",
        kicker: auth ? `VaultAuth · ${auth.method}` : "VaultAuth",
        label: item.auth.name,
        sub: auth ? auth.role ? `role ${auth.role}` : `mount ${auth.mount}` : "not found",
        tone: auth ? auth.tone : "error",
        title: auth ? `VaultAuth ${auth.namespace}/${auth.name}: ${auth.method} login at auth/${auth.mount}${auth.role ? ` as role ${auth.role}` : ""}.${auth.error ? ` ${auth.error}` : ""}` : `VaultAuth ${item.auth.namespace}/${item.auth.name} does not exist${item.auth.defaulted ? " (it is the operator default, used when vaultAuthRef is empty)" : ""}.`,
        ref: auth?.ref ?? void 0,
        via: "vso",
        namespace: item.auth.namespace,
        missing: !auth
      });
      const objId = `obj:${item.ref.kind}/${key(item.namespace, item.name)}`;
      b.node({
        id: objId,
        col: 2,
        type: "sync",
        kicker: SYNC_KIND_WORDS[item.kind],
        label: item.name,
        sub: item.location || "—",
        tone: item.tone,
        title: `${SYNC_KIND_WORDS[item.kind]} ${item.namespace}/${item.name}: ${item.words}.${item.message ? ` ${item.message}` : ""}`,
        ref: item.ref,
        via: "vso",
        namespace: item.namespace
      });
      b.edge(src.id, authId, auth ? worst(src.tone === "error" ? "error" : "", auth.tone === "error" ? "error" : "") || "ok" : "error");
      b.edge(authId, objId, item.tone === "error" ? "error" : item.tone === "warn" ? "warn" : "ok");
      if (!item.destination) continue;
      const sec = secretNode(b, item.namespace, item.destination, item.tone === "info" ? "" : item.tone, "vso");
      b.edge(objId, sec.id, item.tone === "info" ? "" : item.tone);
      const users = consumersOfItem(world, item);
      for (const w of users) {
        const target = item.rolloutTargets.some((t) => t.kind === w.kind && t.name === w.name);
        const node = workloadNode(b, w, "vso", target ? " · auto-restart" : "");
        b.edge(sec.id, node.id, worst(item.tone === "info" ? "" : item.tone, node.tone));
      }
      for (const t of item.rolloutTargets) {
        const w = world.workloads.get(`${item.namespace}/${t.kind}/${t.name}`);
        if (!w || users.includes(w)) continue;
        const node = workloadNode(b, w, "vso", " · auto-restart");
        b.edge(sec.id, node.id, "", { dashed: true, title: `${t.kind} ${t.name} is restarted when the secret changes, but its pods do not name the Secret.` });
      }
    }
    for (const e of world.externals) {
      const store = storeOfExternal(world, e);
      if (!store) continue;
      const src = serverNode(b, sourceOfStore(world, store), "eso");
      const storeId = `store:${store.kind}/${key(store.namespace, store.name)}`;
      b.node({
        id: storeId,
        col: 1,
        type: "login",
        kicker: `${store.kind === "ClusterSecretStore" ? "Cluster store" : "SecretStore"} · ${store.method}`,
        label: store.name,
        sub: store.role ? `role ${store.role}` : store.path ? `path ${store.path}` : store.words,
        tone: store.tone === "info" ? "" : store.tone,
        title: `${store.kind} ${store.namespace ? `${store.namespace}/` : ""}${store.name}, the Vault provider at ${store.server}${store.path ? `, path ${store.path}` : ""}${store.version ? ` (kv ${store.version})` : ""}: ${store.words}.${store.message ? ` ${store.message}` : ""}`,
        ref: store.ref,
        via: "eso",
        namespace: store.namespace || void 0
      });
      const objId = `obj:${e.ref.kind}/${key(e.namespace, e.name)}`;
      b.node({
        id: objId,
        col: 2,
        type: "sync",
        kicker: "ExternalSecret",
        label: e.name,
        sub: e.keys.length ? `${e.keys[0]}${e.keys.length > 1 ? ` +${e.keys.length - 1}` : ""}` : "—",
        tone: e.tone === "info" ? "" : e.tone,
        title: `ExternalSecret ${e.namespace}/${e.name}: ${e.words}.${e.message ? ` ${e.message}` : ""} Keys: ${e.keys.join(", ") || "—"}.`,
        ref: e.ref,
        via: "eso",
        namespace: e.namespace
      });
      b.edge(src.id, storeId, store.tone === "error" ? "error" : "ok");
      b.edge(storeId, objId, e.tone === "error" ? "error" : "ok");
      const sec = secretNode(b, e.namespace, e.target, e.tone === "info" ? "" : e.tone, "eso");
      b.edge(objId, sec.id, e.tone === "info" ? "" : e.tone);
      for (const w of world.users.get(key(e.namespace, e.target)) ?? []) {
        const node = workloadNode(b, w, "eso");
        b.edge(sec.id, node.id, worst(e.tone === "info" ? "" : e.tone, node.tone));
      }
    }
    for (const c of world.classes) {
      const src = serverNode(b, sourceOfClass(world, c), "csi");
      const roleId = `csirole:${src.id}/${c.role ?? ""}`;
      b.node({ id: roleId, col: 1, type: "login", kicker: `CSI provider · ${c.provider}`, label: c.role ? `role ${c.role}` : "no role", sub: "kubernetes login per pod", tone: "", title: `The ${c.provider} CSI provider logs in as each pod's service account${c.role ? `, role ${c.role}` : ""}.`, via: "csi" });
      const objId = `obj:${c.ref.kind}/${key(c.namespace, c.name)}`;
      b.node({ id: objId, col: 2, type: "sync", kicker: "SecretProviderClass", label: c.name, sub: c.paths.length ? `${c.paths[0]}${c.paths.length > 1 ? ` +${c.paths.length - 1}` : ""}` : "—", tone: "", title: `SecretProviderClass ${c.namespace}/${c.name}: mounts ${c.paths.join(", ") || "nothing yet"} as files.`, ref: c.ref, via: "csi", namespace: c.namespace });
      b.edge(src.id, roleId, "ok");
      b.edge(roleId, objId, "ok");
      for (const s of c.syncs) {
        const sec = secretNode(b, c.namespace, s, "", "csi");
        b.edge(objId, sec.id, "");
        for (const w of world.users.get(key(c.namespace, s)) ?? []) b.edge(sec.id, workloadNode(b, w, "csi").id, "ok");
      }
      for (const w of world.workloads.values()) {
        if (w.namespace !== c.namespace || !w.classes.includes(c.name)) continue;
        b.edge(objId, workloadNode(b, w, "csi", " · CSI mount").id, w.tone, { title: "Mounted as a CSI volume" });
      }
    }
    const byWorkload = /* @__PURE__ */ new Map();
    for (const p of world.injected) {
      const id = workloadKey(workloadOf(p.pod));
      const entry = byWorkload.get(id) ?? { pods: [], w: world.workloads.get(id) };
      entry.pods.push(p);
      byWorkload.set(id, entry);
    }
    for (const [id, { pods, w }] of byWorkload) {
      const first = pods[0];
      if (!first) continue;
      const src = serverNode(b, sourceOfInjection(world, first), "agent");
      const role = first.injection.role ?? "";
      const roleId = `agentrole:${src.id}/${role}`;
      b.node({
        id: roleId,
        col: 1,
        type: "login",
        kicker: "Agent injector",
        label: role ? `role ${role}` : "no role",
        sub: first.injection.authPath ?? "auth/kubernetes",
        tone: role ? "" : "warn",
        title: `Agents log in with their pod's service account${role ? ` as role ${role}` : ", and no role annotation: the login fails"}.`,
        via: "agent"
      });
      const paths = [...new Set(pods.flatMap((p) => p.injection.secrets.map((s) => s.path)))];
      const tone = worst(...pods.map((p) => p.tone));
      const agentId = `agent:${id}`;
      b.node({
        id: agentId,
        col: 2,
        type: "sync",
        kicker: "Injected by the agent",
        label: paths[0] ?? "no secrets listed",
        sub: paths.length > 1 ? `+${paths.length - 1} more path${paths.length > 2 ? "s" : ""}` : first.injection.secrets[0] ? `to /vault/secrets/${first.injection.secrets[0].file}` : "—",
        tone,
        title: `The agent renders ${paths.join(", ") || "nothing"} into files in the pod. ${pods.map((p) => `${p.name}: ${p.words}`).join("; ")}.`,
        ref: first.ref,
        via: "agent",
        namespace: first.namespace
      });
      b.edge(src.id, roleId, "ok");
      b.edge(roleId, agentId, tone === "error" ? "error" : "ok");
      if (w) b.edge(agentId, workloadNode(b, w, "agent").id, tone);
    }
    return { nodes: [...b.nodes.values()], edges: [...b.edges.values()] };
  }
  function lineage(graph, id) {
    const nodes = /* @__PURE__ */ new Set([id]);
    const edges = /* @__PURE__ */ new Set();
    const walk = (start2, forward) => {
      const queue = [start2];
      while (queue.length) {
        const at = queue.shift();
        for (const e of graph.edges) {
          const [from, to] = forward ? [e.from, e.to] : [e.to, e.from];
          if (from !== at) continue;
          edges.add(e.id);
          if (!nodes.has(to)) {
            nodes.add(to);
            queue.push(to);
          }
        }
      }
    };
    walk(id, true);
    walk(id, false);
    return { nodes, edges };
  }
  function matches(n, needle) {
    return [n.label, n.sub, n.kicker, n.namespace ?? ""].some((s) => s.toLowerCase().includes(needle));
  }
  function filterFlow(graph, filter) {
    const needle = (filter.search ?? "").trim().toLowerCase();
    const vias = filter.vias && filter.vias.length ? new Set(filter.vias) : null;
    const byId2 = new Map(graph.nodes.map((n) => [n.id, n]));
    const keepNodes = /* @__PURE__ */ new Set();
    const keepEdges = /* @__PURE__ */ new Set();
    for (const n of graph.nodes) {
      if (n.type !== "sync") continue;
      if (vias && !vias.has(n.via)) continue;
      if (filter.namespace && n.namespace !== filter.namespace) continue;
      const chain = lineage(graph, n.id);
      if (filter.server && !chain.nodes.has(`srv:${filter.server}`)) continue;
      const members = [...chain.nodes].map((id) => byId2.get(id)).filter((x) => !!x);
      if (filter.problemsOnly && !members.some((m) => m.tone === "error" || m.missing || m.tone === "warn" && m.type !== "server")) continue;
      if (needle && !members.some((m) => matches(m, needle))) continue;
      for (const id of chain.nodes) keepNodes.add(id);
      for (const id of chain.edges) keepEdges.add(id);
    }
    const nodes = graph.nodes.filter((n) => keepNodes.has(n.id));
    const edges = graph.edges.filter((e) => keepEdges.has(e.id) && keepNodes.has(e.from) && keepNodes.has(e.to));
    return { nodes, edges };
  }
  var NODE_W = 200;
  var NODE_H = 54;
  var ROW = 66;
  var GAP_X = 58;
  var TOP = 30;
  function layoutFlow(graph) {
    const cols = [[], [], [], [], []];
    for (const n of graph.nodes) cols[n.col]?.push(n);
    const up = /* @__PURE__ */ new Map();
    const down = /* @__PURE__ */ new Map();
    for (const e of graph.edges) {
      up.set(e.to, [...up.get(e.to) ?? [], e.from]);
      down.set(e.from, [...down.get(e.from) ?? [], e.to]);
    }
    const y = /* @__PURE__ */ new Map();
    const origin = (id) => {
      const login = (up.get(id) ?? [])[0] ?? "";
      const server = (up.get(login) ?? [])[0] ?? "";
      return `${server}|${login}`;
    };
    const middle = cols[2] ?? [];
    middle.sort((a, b) => origin(a.id).localeCompare(origin(b.id)) || (a.namespace ?? "").localeCompare(b.namespace ?? "") || a.label.localeCompare(b.label));
    middle.forEach((n, i) => y.set(n.id, TOP + i * ROW));
    const place = (column, neighbours) => {
      const want = column.map((n) => {
        const ys = (neighbours.get(n.id) ?? []).map((id) => y.get(id)).filter((v) => v !== void 0);
        return { n, want: ys.length ? ys.reduce((s, v) => s + v, 0) / ys.length : Number.MAX_SAFE_INTEGER };
      });
      want.sort((a, b) => a.want - b.want || a.n.label.localeCompare(b.n.label));
      let next = TOP;
      for (const { n, want: w } of want) {
        const at = Math.max(next, w === Number.MAX_SAFE_INTEGER ? next : w);
        y.set(n.id, at);
        next = at + ROW;
      }
    };
    place(cols[1] ?? [], down);
    place(cols[0] ?? [], down);
    place(cols[3] ?? [], up);
    place(cols[4] ?? [], up);
    const boxes = /* @__PURE__ */ new Map();
    let height = TOP + NODE_H;
    for (const n of graph.nodes) {
      const at = y.get(n.id) ?? TOP;
      boxes.set(n.id, { x: n.col * (NODE_W + GAP_X), y: at });
      height = Math.max(height, at + NODE_H);
    }
    return {
      boxes,
      width: 5 * NODE_W + 4 * GAP_X,
      height: height + 8,
      columns: COLUMNS.map((label, i) => ({ x: i * (NODE_W + GAP_X), label, used: (cols[i] ?? []).length > 0 }))
    };
  }
  function flowCounts(graph) {
    const count = (t) => graph.nodes.filter((n) => n.type === t).length;
    return { servers: count("server"), syncs: count("sync"), secrets: count("secret"), workloads: count("workload") };
  }

  // src/ui/dom.ts
  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [name, value] of Object.entries(attrs)) {
      if (value === void 0 || value === false) continue;
      if (name === "class") node.className = String(value);
      else if (name === "text") node.textContent = String(value);
      else node.setAttribute(name, String(value));
    }
    for (const child of children) {
      if (child === null || child === void 0 || child === false) continue;
      node.append(child);
    }
    return node;
  }
  function svgEl(tag, attrs = {}, ...children) {
    const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [name, value] of Object.entries(attrs)) {
      if (value !== void 0) node.setAttribute(name, String(value));
    }
    for (const child of children) {
      if (child === null || child === void 0) continue;
      node.append(child);
    }
    return node;
  }
  function replace(parent, ...children) {
    parent.replaceChildren();
    for (const child of children) {
      if (child === null || child === void 0 || child === false) continue;
      parent.append(child);
    }
  }
  function byId(id) {
    const node = document.getElementById(id);
    if (!node) throw new Error(`the page has no #${id}`);
    return node;
  }

  // src/ui/parts.ts
  var VIEWS = [
    ["overview", "Dashboard"],
    ["cluster", "Servers"],
    ["flow", "Secret flow"],
    ["expiry", "Certificates & leases"]
  ];
  function heading(current, title2, note, counts = {}) {
    const nav = el("nav", { class: "tabs", "aria-label": "OpenBao and Vault views" });
    for (const [id, label] of VIEWS) {
      const here = id === current;
      const tab = el("button", { type: "button", class: here ? "tab here" : "tab", "aria-current": here ? "page" : void 0 }, label, counts[id] && !here ? el("span", { class: "tab-count" }, String(counts[id])) : null);
      if (!here) tab.addEventListener("click", () => void k8sdockside.openView(id));
      nav.append(tab);
    }
    return el(
      "header",
      { class: "page-head" },
      el("div", { class: "page-title" }, el("img", { class: "mark", src: "logo.svg", alt: "", width: 28, height: 28 }), el("div", {}, el("h1", {}, title2), note ? el("p", { class: "note" }, note) : null)),
      nav
    );
  }
  function nothing(message2) {
    return el("p", { class: "empty" }, message2);
  }
  function clickable(node, onPick, label = "") {
    node.classList.add("pick");
    node.setAttribute("role", "button");
    node.setAttribute("tabindex", "0");
    if (label) node.setAttribute("aria-label", label);
    node.addEventListener("click", (event) => {
      event.stopPropagation();
      onPick();
    });
    node.addEventListener("keydown", (event) => {
      const key2 = event.key;
      if (key2 === "Enter" || key2 === " ") {
        event.preventDefault();
        onPick();
      }
    });
    return node;
  }

  // src/ui/flow.ts
  function truncate(value, n) {
    return value.length > n ? `${value.slice(0, Math.max(1, n - 1))}…` : value;
  }
  function truncatePath(value, n) {
    if (value.length <= n || !value.includes("/")) return truncate(value, n);
    const parts = value.split("/");
    while (parts.length > 1 && `…/${parts.join("/")}`.length > n) parts.shift();
    const kept = `…/${parts.join("/")}`;
    return kept.length <= n ? kept : `…${value.slice(value.length - n + 1)}`;
  }
  function text(x, y, cls, value, extra = {}) {
    const t = svgEl("text", { x, y, class: cls, ...extra });
    t.textContent = value;
    return t;
  }
  function title(value) {
    const t = svgEl("title");
    t.textContent = value;
    return t;
  }
  function drawFlow(graph, layout, options = {}) {
    const pad = 12;
    const top = options.compact ? TOP - 16 : 0;
    const width = layout.width + pad * 2;
    const height = layout.height - top + 4;
    const svg = svgEl("svg", { class: "map", viewBox: `${-pad} ${top} ${width} ${height}`, width, height, role: "img", "aria-label": `Secret flow: ${graph.nodes.length} objects` });
    const lanes = svgEl("g", { class: "lanes" });
    for (const c of layout.columns) {
      lanes.append(svgEl("rect", { class: "lane", x: c.x - 7, y: TOP - 9, width: NODE_W + 14, height: Math.max(NODE_H + 18, layout.height - TOP + 6), rx: 12 }));
      if (!options.compact) lanes.append(text(c.x + 4, 15, "lane-label", c.label.toUpperCase()));
    }
    svg.append(lanes);
    const edgeLayer = svgEl("g", { class: "edges" });
    const nodeLayer = svgEl("g", { class: "nodes" });
    const edgeEls = /* @__PURE__ */ new Map();
    const nodeEls = /* @__PURE__ */ new Map();
    for (const e of graph.edges) {
      const a = layout.boxes.get(e.from);
      const b = layout.boxes.get(e.to);
      if (!a || !b) continue;
      const path = drawEdge(e, a.x + NODE_W, a.y + NODE_H / 2, b.x, b.y + NODE_H / 2);
      edgeLayer.append(path);
      edgeEls.set(e.id, path);
    }
    for (const n of graph.nodes) {
      const box = layout.boxes.get(n.id);
      if (!box) continue;
      const g = drawNode(n, box.x, box.y);
      nodeLayer.append(g);
      nodeEls.set(n.id, g);
      const pick = n.clusterId && options.onServer ? () => options.onServer?.(n.clusterId) : n.ref ? () => void k8sdockside.open(n.ref) : null;
      if (pick) clickable(g, pick);
      const light = () => {
        const l = lineage(graph, n.id);
        svg.classList.add("focusing");
        for (const [id, node] of nodeEls) node.classList.toggle("lit", l.nodes.has(id));
        for (const [id, edge] of edgeEls) edge.classList.toggle("lit", l.edges.has(id));
      };
      const dark = () => svg.classList.remove("focusing");
      g.addEventListener("mouseenter", light);
      g.addEventListener("mouseleave", dark);
      g.addEventListener("focus", light);
      g.addEventListener("blur", dark);
    }
    svg.append(edgeLayer, nodeLayer);
    return svg;
  }
  function drawEdge(e, x1, y1, x2, y2) {
    const dx = Math.max(GAP_X / 2, (x2 - x1) / 2);
    const cls = ["edge", `edge-${e.tone || "none"}`];
    if (e.dashed) cls.push("edge-dashed");
    const path = svgEl("path", { d: `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`, class: cls.join(" ") });
    if (e.title) path.append(title(e.title));
    return path;
  }
  function drawNode(n, x, y) {
    const cls = ["fnode", `fnode-${n.type}`, `tone-${n.tone || "none"}`];
    if (n.missing) cls.push("missing");
    const g = svgEl("g", { class: cls.join(" "), transform: `translate(${x},${y})` });
    g.append(svgEl("rect", { class: "fnode-box", width: NODE_W, height: NODE_H, rx: 9 }));
    g.append(svgEl("rect", { class: "fnode-bar", x: 5, y: 9, width: 3, height: NODE_H - 18, rx: 1.5 }));
    const badgeW = n.badge ? n.badge.length * 6 + 12 : 0;
    g.append(text(16, 17, "fnode-kicker", truncate(n.kicker.toUpperCase(), Math.floor((NODE_W - 36 - badgeW) / 6.3))));
    g.append(text(16, 34, "fnode-label", n.type === "sync" && n.via === "agent" ? truncatePath(n.label, 26) : truncate(n.label, 25)));
    g.append(text(16, 47.5, "fnode-sub", n.type === "sync" ? truncatePath(n.sub, 32) : truncate(n.sub, 32)));
    if (n.badge) {
      const bx = NODE_W - badgeW - 22;
      g.append(svgEl("g", { class: `fnode-badge ${n.badge.toLowerCase()}`, transform: `translate(${bx},7)` }, svgEl("rect", { width: badgeW, height: 14, rx: 4 }), text(badgeW / 2, 10.3, "", n.badge, { "text-anchor": "middle" })));
    }
    g.append(svgEl("circle", { class: "fnode-dot", cx: NODE_W - 12, cy: 14, r: 4 }));
    const hint = n.clusterId ? "Click to open it in Servers." : n.ref ? "Click to open it." : "";
    g.append(title(`${n.title}${hint ? `

${hint}` : ""}`));
    return g;
  }
  function legend() {
    const line = (cls) => {
      const s = svgEl("svg", { width: 34, height: 10, viewBox: "0 0 34 10", "aria-hidden": "true" });
      s.append(svgEl("path", { d: "M1,5 L33,5", class: `edge ${cls}` }));
      return s;
    };
    const item = (node, words) => el("span", { class: "legend-item" }, node, words);
    return el(
      "div",
      { class: "map-legend" },
      item(line("edge-ok"), "working"),
      item(line("edge-warn"), "stale or expiring"),
      item(line("edge-error"), "failing"),
      item(el("span", { class: "legend-box dashed" }), "a Kubernetes Secret, by name only: never read"),
      el("span", { class: "legend-item faint" }, "Hover a box to follow its secrets; click to open it.")
    );
  }

  // src/ui/page.ts
  function fail(host, err) {
    const message2 = err instanceof Error ? err.message : String(err);
    replace(host, el("div", { class: "failure" }, el("strong", {}, "That did not work. "), el("span", {}, message2)));
  }
  function start(hostId, body) {
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
  function every(ms, body, onError) {
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
  async function maybeList(query) {
    try {
      return await k8sdockside.list(query);
    } catch {
      return null;
    }
  }
  function focused() {
    const params = new URLSearchParams(location.hash.replace(/^#/, ""));
    return { namespace: params.get("namespace") ?? "", name: params.get("name") ?? "" };
  }
  var remember = {
    async get(key2) {
      try {
        return await k8sdockside.storage?.get(key2) ?? null;
      } catch {
        return null;
      }
    },
    async set(key2, value) {
      try {
        await k8sdockside.storage?.set(key2, value);
      } catch {
      }
    },
    async take(key2) {
      const value = await remember.get(key2);
      if (value !== null) {
        try {
          await k8sdockside.storage?.remove(key2);
        } catch {
        }
      }
      return value;
    }
  };
  async function openOn(viewId, focus) {
    await remember.set(`focus-${viewId}`, focus);
    await k8sdockside.openView(viewId);
  }
  async function wanted(viewId) {
    const hash = focused();
    if (hash.name) return hash;
    return await remember.take(`focus-${viewId}`) ?? {};
  }
  function fingerprint(value) {
    return JSON.stringify(value, (_k, v) => v instanceof Map ? [...v.entries()] : v);
  }

  // src/ui/load.ts
  var SERVICE_IDS = {
    openbao: { active: ["bao-active", "bao-active-tls"], main: ["bao", "bao-tls"] },
    vault: { active: ["vault-active", "vault-active-tls"], main: ["vault", "vault-tls"] }
  };
  var message = (err) => err instanceof Error ? err.message : String(err);
  async function ask(id, path) {
    const services = k8sdockside.services;
    if (!services) throw new Error("this version of K8s Dockside cannot call services in the cluster (0.0.27 and newer can)");
    return services.get({ service: id, path });
  }
  async function reading(product, via) {
    const errors = [];
    for (const id of SERVICE_IDS[product][via]) {
      let seal;
      try {
        seal = await ask(id, "/v1/sys/seal-status");
      } catch (err) {
        errors.push(message(err));
        continue;
      }
      const out = { product, via, service: seal.service, seal: parseJSON(seal.body) };
      if (!out.seal) {
        errors.push(`${seal.service} answered ${seal.status} with something that is not the seal status`);
        continue;
      }
      const [health, leader] = await Promise.all([ask(id, "/v1/sys/health").catch(() => void 0), ask(id, "/v1/sys/leader").catch(() => void 0)]);
      if (health) {
        out.health = parseJSON(health.body);
        out.healthCode = health.status;
      }
      if (leader && leader.status >= 200 && leader.status < 300) out.leader = parseJSON(leader.body);
      return out;
    }
    const telling = errors.find((e) => !/^no service labelled/.test(e)) ?? errors[0] ?? "no answer";
    return { product, via, error: telling };
  }
  async function readings(products) {
    const wanted2 = [...new Set(products)].filter((p) => p === "openbao" || p === "vault");
    const jobs = wanted2.flatMap((p) => [reading(p, "active"), reading(p, "main")]);
    return Promise.all(jobs);
  }
  async function load(options = {}) {
    const [pods, statefulsets, deployments, nodes, webhooks, connections, auths, authGlobals, statics, dynamics, pkis, secretStores, clusterSecretStores, externalSecrets, providerClasses2] = await Promise.all([
      k8sdockside.list({ kind: KIND.pods }),
      maybeList({ kind: KIND.statefulsets }),
      maybeList({ kind: KIND.deployments }),
      maybeList({ kind: KIND.nodes }),
      maybeList({ kind: KIND.webhooks }),
      maybeList({ kind: KIND.connections }),
      maybeList({ kind: KIND.auths }),
      maybeList({ kind: KIND.authGlobals }),
      maybeList({ kind: KIND.staticSecrets }),
      maybeList({ kind: KIND.dynamicSecrets }),
      maybeList({ kind: KIND.pkiSecrets }),
      maybeList({ kind: KIND.secretStores }),
      maybeList({ kind: KIND.clusterSecretStores }),
      maybeList({ kind: KIND.externalSecrets }),
      maybeList({ kind: KIND.providerClasses })
    ]);
    const snap = {
      pods,
      statefulsets: statefulsets ?? [],
      deployments: deployments ?? [],
      nodes: nodes ?? [],
      webhooks: webhooks ?? [],
      connections: connections ?? [],
      auths: auths ?? [],
      authGlobals: authGlobals ?? [],
      statics: statics ?? [],
      dynamics: dynamics ?? [],
      pkis: pkis ?? [],
      secretStores: secretStores ?? [],
      clusterSecretStores: clusterSecretStores ?? [],
      externalSecrets: externalSecrets ?? [],
      providerClasses: providerClasses2 ?? [],
      served: { vso: statics !== null || connections !== null, eso: externalSecrets !== null, csi: providerClasses2 !== null },
      readings: []
    };
    if (options.api) {
      const clusters = buildClusters({ pods, statefulsets: snap.statefulsets });
      snap.readings = await readings(clusters.map((c) => c.product));
    }
    return { snap, world: derive(snap, Date.now()) };
  }

  // src/pages/flow.ts
  var REFRESH = 2e4;
  start("page", async (ctx) => {
    const head = byId("head");
    const body = byId("body");
    const failure = el("p", { class: "refresh-failure" });
    const note = `Which workloads get secrets from which server, and how, in ${ctx.contextName}. Secrets appear by name only: this page cannot read them.`;
    replace(head, heading("flow", "Secret flow", note));
    const saved = { namespace: "", vias: [], problemsOnly: false, search: "", server: "", ...await remember.get("flow.filters") ?? {} };
    const focus = await wanted("flow");
    if (focus.via && VIAS.includes(focus.via)) Object.assign(saved, { vias: [focus.via], problemsOnly: false, server: "" });
    if (focus.problems) Object.assign(saved, { problemsOnly: true, vias: [], server: "" });
    if (focus.server) Object.assign(saved, { server: focus.server, vias: [], problemsOnly: false });
    if (focus.search) Object.assign(saved, { search: focus.search, vias: [], problemsOnly: false, server: "", namespace: "" });
    let world = null;
    let last = "";
    const ns = el("select", { "aria-label": "Namespace" });
    const server = el("select", { "aria-label": "Server" });
    const search = el("input", { type: "search", placeholder: "Search names and paths", "aria-label": "Search", value: saved.search, spellcheck: "false" });
    const problems = el("input", { type: "checkbox", id: "only-problems", checked: saved.problemsOnly });
    const toggles = el("span", { class: "toggles", role: "group", "aria-label": "How secrets arrive" });
    const counts = el("span", { class: "count" });
    const bar = el("div", { class: "bar" }, ns, server, toggles, search, el("label", { class: "check", for: "only-problems" }, problems, "Only problems"), el("span", { class: "spacer" }), counts);
    const canvas = el("div", { class: "map-scroll" });
    const save = () => void remember.set("flow.filters", saved);
    ns.addEventListener("change", () => {
      saved.namespace = ns.value;
      save();
      draw();
    });
    server.addEventListener("change", () => {
      saved.server = server.value;
      save();
      draw();
    });
    let typing;
    search.addEventListener("input", () => {
      clearTimeout(typing);
      typing = setTimeout(() => {
        saved.search = search.value;
        save();
        draw();
      }, 150);
    });
    problems.addEventListener("change", () => {
      saved.problemsOnly = problems.checked;
      save();
      draw();
    });
    function options(sel, values, current) {
      replace(sel, ...values.map(([v, label]) => el("option", { value: v, selected: v === current }, label)));
      sel.value = values.some(([v]) => v === current) ? current : "";
    }
    function draw() {
      if (!world) return;
      const full = buildFlow(world);
      const namespaces = [...new Set(full.nodes.filter((n) => n.type === "sync").map((n) => n.namespace ?? ""))].filter(Boolean).sort();
      options(ns, [["", "All namespaces"], ...namespaces.map((n) => [n, n])], saved.namespace);
      options(server, [["", "All servers"], ...world.clusters.map((c2) => [c2.id, `${c2.namespace}/${c2.name}`])], saved.server);
      saved.namespace = ns.value;
      saved.server = server.value;
      replace(toggles);
      for (const via of VIAS) {
        const n = full.nodes.filter((x) => x.type === "sync" && x.via === via).length;
        if (!n && !saved.vias.includes(via)) continue;
        const on = saved.vias.includes(via);
        const t = el("button", { type: "button", class: `toggle${on ? " on" : ""}`, "aria-pressed": on ? "true" : "false", title: on ? `Showing ${VIA_WORDS[via]} only; click to show everything` : `Show ${VIA_WORDS[via]} only` }, VIA_WORDS[via], el("span", { class: "toggle-n" }, String(n)));
        t.addEventListener("click", () => {
          saved.vias = on ? saved.vias.filter((v) => v !== via) : [...saved.vias, via];
          save();
          draw();
        });
        toggles.append(t);
      }
      const filter = { namespace: saved.namespace, vias: saved.vias, problemsOnly: saved.problemsOnly, search: saved.search, server: saved.server };
      const graph = filterFlow(full, filter);
      const c = flowCounts(graph);
      counts.textContent = `${plural(c.servers, "server")} · ${plural(c.syncs, "sync", "syncs")} · ${plural(c.secrets, "Secret")} · ${plural(c.workloads, "workload")}`;
      if (graph.nodes.length === 0) {
        const filtered = saved.namespace || saved.vias.length || saved.search || saved.problemsOnly || saved.server;
        const reset = el("button", { type: "button" }, "Clear the filters");
        reset.addEventListener("click", () => {
          Object.assign(saved, { namespace: "", vias: [], problemsOnly: false, search: "", server: "" });
          search.value = "";
          problems.checked = false;
          save();
          draw();
        });
        replace(
          canvas,
          filtered ? el("div", { class: "empty-state" }, nothing(saved.problemsOnly && !saved.search ? "No problems anywhere along the way: everything drawn would be healthy." : "Nothing matches the filters."), reset) : nothing("Nothing in this cluster fetches secrets from OpenBao or Vault yet: no Secrets Operator objects, no injected pods, no External Secrets store or CSI class using them.")
        );
        return;
      }
      replace(canvas, drawFlow(graph, layoutFlow(graph), { onServer: (id) => void openOn("cluster", { namespace: id.split("/")[0] ?? "", name: id.split("/")[1] ?? "" }) }));
    }
    const stop = every(
      REFRESH,
      async () => {
        const loaded = await load();
        failure.textContent = "";
        document.getElementById("first")?.remove();
        const print = fingerprint(loaded.snap);
        if (print === last) return;
        last = print;
        world = loaded.world;
        const bad = world.items.filter((i) => i.tone === "error").length + world.externals.filter((e) => e.tone === "error").length;
        replace(head, heading("flow", "Secret flow", note, { flow: bad }));
        if (!body.contains(canvas)) replace(body, failure, bar, canvas, legend());
        draw();
      },
      (err) => {
        failure.textContent = err instanceof Error ? err.message : String(err);
      }
    );
    addEventListener("pagehide", stop);
  });
})();
