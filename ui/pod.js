// Built by scripts/build.mjs from src/ -- edit the TypeScript there, not this file.
"use strict";
(() => {
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

  // src/model/units.ts
  var SECOND = 1e3;
  var MINUTE = 60 * SECOND;
  var HOUR = 60 * MINUTE;
  var DAY = 24 * HOUR;
  function plural(n, word, many = `${word}s`) {
    return `${n} ${n === 1 ? word : many}`;
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

  // src/model/vso.ts
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
  function storeOfExternal(world, e) {
    return storeOf(e, world.stores);
  }
  function supplyOfPod(world, pod) {
    const namespace = pod.metadata.namespace ?? "";
    const out = [];
    const used = new Set(secretsOf(pod));
    for (const item of world.items) {
      if (item.namespace !== namespace || !used.has(item.destination)) continue;
      out.push({ via: "vso", secret: item.destination, ref: item.ref, what: `${item.kind === "pki" ? "VaultPKISecret" : item.kind === "dynamic" ? "VaultDynamicSecret" : "VaultStaticSecret"} ${item.name}`, paths: [item.location], tone: item.tone, words: item.words, source: sourceOfItem(world, item) });
    }
    for (const e of world.externals) {
      if (e.namespace !== namespace || !used.has(e.target)) continue;
      const store = storeOfExternal(world, e);
      out.push({ via: "eso", secret: e.target, ref: e.ref, what: `ExternalSecret ${e.name}`, paths: e.keys.map((k) => store?.path ? `${store.path}/${k}` : k), tone: e.tone, words: e.words, source: store ? sourceOfStore(world, store) : sourceFor(world, void 0, namespace) });
    }
    const mounted = (pod.spec?.volumes ?? []).map((v) => v.csi?.volumeAttributes?.["secretProviderClass"]).filter(Boolean);
    for (const c of world.classes) {
      if (c.namespace !== namespace || !mounted.includes(c.name)) continue;
      out.push({ via: "csi", ref: c.ref, what: `SecretProviderClass ${c.name}`, paths: c.paths, tone: "ok", words: "mounted", source: sourceOfClass(world, c) });
    }
    const injected = world.injected.find((p) => p.namespace === namespace && p.name === pod.metadata.name);
    if (injected) {
      out.push({ via: "agent", what: `agent${injected.injection.role ? `, role ${injected.injection.role}` : ""}`, paths: injected.injection.secrets.map((s) => s.path), tone: injected.tone, words: injected.words, source: sourceOfInjection(world, injected) });
    }
    return out;
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
  async function maybeList(query) {
    try {
      return await k8sdockside.list(query);
    } catch {
      return null;
    }
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
    const wanted = [...new Set(products)].filter((p) => p === "openbao" || p === "vault");
    const jobs = wanted.flatMap((p) => [reading(p, "active"), reading(p, "main")]);
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

  // src/ui/lock.ts
  var LOCK_TONE = { open: "ok", partial: "warn", closed: "error", uninitialized: "warn", unknown: "none" };
  var LOCK_WORDS = {
    open: "Unsealed",
    partial: "Partly sealed",
    closed: "Sealed",
    uninitialized: "Not initialised",
    unknown: "Seal state unknown"
  };
  function title(text2) {
    const t = svgEl("title");
    t.textContent = text2;
    return t;
  }
  function text(x, y, cls, value) {
    const t = svgEl("text", { x, y, class: cls, "text-anchor": "middle" });
    t.textContent = value;
    return t;
  }
  function padlock(lock, size = 64, sealedCount = 0, label = "") {
    const open = lock === "open" || lock === "partial";
    const svg = svgEl("svg", { viewBox: "0 0 64 64", width: size, height: size, class: `padlock lock-${lock} tone-${LOCK_TONE[lock]}`, role: "img" });
    svg.append(title(label || LOCK_WORDS[lock]));
    svg.append(svgEl("path", { class: "lock-shackle", d: open ? "M20 28 V17 a11.5 11.5 0 0 1 22.6 -3.2" : "M20 28 V20 a12 12 0 0 1 24 0 V28" }));
    svg.append(svgEl("rect", { class: "lock-body", x: 11, y: 27, width: 42, height: 31, rx: 8 }));
    if (lock === "uninitialized") {
      svg.append(text(32, 50, "lock-mark", "?"));
    } else if (lock === "unknown") {
      svg.append(text(32, 49.5, "lock-mark", "–"));
    } else {
      svg.append(svgEl("circle", { class: "lock-hole", cx: 32, cy: 40, r: 4.4 }));
      svg.append(svgEl("path", { class: "lock-hole", d: "M30.2 42 h3.6 l1 8 h-5.6 z" }));
    }
    if (lock === "partial" && sealedCount > 0) {
      svg.append(svgEl("circle", { class: "lock-badge", cx: 52, cy: 26, r: 9.5 }));
      svg.append(text(52, 30.2, "lock-badge-text", String(sealedCount)));
    }
    return svg;
  }
  function keySlots(seal, sealedNow, uninitialized = false) {
    const wrap = el("div", { class: "keys" });
    const n = seal.n ?? 0;
    const t = seal.t ?? 0;
    if (seal.auto) {
      wrap.append(
        el("div", { class: "keys-auto" }, el("span", { class: "keys-auto-mark", "aria-hidden": "true" }, "A"), el("span", {}, `Auto-unseal: ${seal.type}`)),
        el("div", { class: "keys-words" }, n ? `Recovery keys: ${t} of ${n}` : "No unseal keys to enter")
      );
      return wrap;
    }
    if (!n || !t) {
      wrap.append(el("div", { class: "keys-words faint" }, uninitialized ? "No key shares yet: they are made when it is initialised." : "Key shares unknown: the API did not say."));
      return wrap;
    }
    const progress = Math.min(seal.progress ?? 0, t);
    const gap = 19;
    const width = n * gap + 2;
    const svg = svgEl("svg", { viewBox: `0 0 ${width} 20`, width, height: 20, class: "key-row", role: "img" });
    for (let i = 0; i < n; i++) {
      let cls = "key-slot";
      if (i < t) cls += " key-needed";
      if (sealedNow ? i < progress : i < t) cls += sealedNow ? " key-entered" : " key-used";
      svg.append(svgEl("circle", { class: cls, cx: 10 + i * gap, cy: 10, r: 7 }));
    }
    const words = sealedNow ? `${progress} of ${t} keys entered${seal.progressNode ? ` on ${seal.progressNode}` : ""}` : `${plural(t, "key")} of ${n} unseal it`;
    svg.append(title(sealedNow ? `${words}. ${t - progress} more to unseal.` : `Shamir seal: any ${t} of the ${n} key shares unseal a node.`));
    wrap.append(svg, el("div", { class: "keys-words" }, words));
    return wrap;
  }

  // src/ui/parts.ts
  function pill(text2, tone = "", title2 = "") {
    return el("span", { class: `pill pill-${tone || "none"}`, ...title2 ? { title: title2 } : {} }, text2);
  }
  function productBadge(product) {
    const word = product === "openbao" ? "OpenBao" : product === "vault" ? "Vault" : "?";
    return el("span", { class: `badge badge-${product}`, title: product === "openbao" ? "OpenBao: the open-source fork of Vault" : product === "vault" ? "HashiCorp Vault" : "Not told apart yet" }, word);
  }
  function footLink(label, onClick) {
    const node = el("button", { type: "button", class: "foot-link" }, label);
    node.addEventListener("click", onClick);
    return node;
  }

  // src/pages/pod.ts
  var VIA = { vso: "Secrets Operator", eso: "External Secrets", csi: "CSI mount", agent: "Agent" };
  start("panel", async () => {
    const host = byId("panel");
    const pod = await k8sdockside.object();
    if (!pod) {
      replace(host, el("p", { class: "empty" }, "The pod is gone."));
      return;
    }
    const server = isServerPod(pod);
    const { world } = await load({ api: server });
    if (server) {
      const cluster = world.clusters.find((c) => c.nodes.some((n) => n.name === pod.metadata.name && n.namespace === pod.metadata.namespace));
      const node = cluster?.nodes.find((n) => n.name === pod.metadata.name);
      if (!cluster || !node) {
        replace(host, el("p", { class: "empty" }, "An OpenBao or Vault server pod, not yet in a cluster the plugin can read."));
        return;
      }
      const lock = node.role === "sealed" ? "closed" : node.role === "uninitialized" ? "uninitialized" : node.sealed === false ? "open" : "unknown";
      const leader = cluster.nodes.find((n) => n.role === "active" && n !== node);
      const t = cluster.seal.t;
      const sentence = node.role === "sealed" ? `${node.name} is sealed: it serves nothing until ${cluster.seal.auto ? `its ${cluster.seal.type} auto-unseal answers` : t ? `${t} key shares are entered on it` : "its key shares are entered on it"}.${leader ? ` ${leader.name} serves ${cluster.name} meanwhile.` : ""}` : node.role === "active" ? `${node.name} leads ${cluster.name}: every request is served here${cluster.nodes.length > 1 ? `, and ${cluster.nodes.length - 1} other node${cluster.nodes.length > 2 ? "s" : ""} stand by` : ""}.` : node.role === "standby" || node.role === "perf-standby" ? `${node.name} is unsealed and stands by${leader ? ` for ${leader.name}` : ""}, ready to take over if it goes.` : `${productName(node.product)} ${cluster.name}: ${cluster.sentence}`;
      const progress = cluster.seal.progressNode === node.name && node.role === "sealed" ? keySlots(cluster.seal, true) : null;
      replace(
        host,
        el(
          "div",
          { class: "panel-top" },
          padlock(lock, 48),
          el(
            "div",
            { class: "panel-main" },
            el("div", { class: "panel-head" }, el("strong", {}, node.words[0]?.toUpperCase() + node.words.slice(1)), productBadge(node.product), node.leader ? pill("leader", "ok") : null, node.version ? el("span", { class: "faint" }, `v${node.version}`) : null),
            el("p", { class: "panel-sentence" }, sentence)
          ),
          progress
        ),
        el("div", { class: "links" }, footLink(node.role === "sealed" ? "How to unseal it" : "Open in Servers", () => void openOn("cluster", { namespace: cluster.namespace, name: cluster.name })))
      );
      return;
    }
    const supply = supplyOfPod(world, pod);
    if (supply.length === 0) {
      replace(host, el("p", { class: "panel-sentence" }, "This pod gets nothing from OpenBao or Vault: none of the Secrets it names is synced from one, and it has no agent or CSI mount."));
      return;
    }
    const list = el("ul", { class: "supply" });
    for (const s of supply) {
      const what = s.ref ? el("button", { type: "button", class: "link-name" }, s.what) : el("strong", {}, s.what);
      if (s.ref) what.addEventListener("click", () => void k8sdockside.open(s.ref));
      list.append(
        el(
          "li",
          {},
          el("span", { class: "supply-how" }, pill(VIA[s.via], s.tone === "ok" ? "ok" : s.tone)),
          el("div", { class: "supply-what" }, s.secret ? el("span", {}, "Secret ", el("strong", {}, s.secret), " from ") : null, what, el("span", { class: `tone-${s.tone || "none"}` }, s.words)),
          el("div", { class: "supply-paths" }, `${s.paths.join(", ") || "—"}  ·  from ${s.source.cluster ? `${productName(s.source.cluster.product)} ${s.source.cluster.namespace}/${s.source.cluster.name}` : s.source.label}`)
        )
      );
    }
    replace(host, list, el("div", { class: "links" }, footLink("Show on the secret flow", () => void openOn("flow", { search: workloadOf(pod).name }))));
  });
})();
