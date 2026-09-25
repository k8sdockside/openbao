# Trying the plugin on a kind cluster

`dev/up.sh` makes a local Kubernetes cluster with OpenBao, a dev-mode Vault
and the Vault Secrets Operator, set up so every state the plugin draws has
something real behind it.

```sh
dev/up.sh     # about five minutes the first time, mostly pulling images
dev/down.sh   # deletes the kind cluster, and the dev keys with it
```

It needs `docker` (or podman, with `KIND_EXPERIMENTAL_PROVIDER=podman`),
[`kind`](https://kind.sigs.k8s.io), `kubectl`, `helm` and `jq`. It creates a
kind cluster called `openbao-dev` (set `CLUSTER=` for another name) and
installs, straight from the charts' own repositories with `helm --repo`, so
nothing is added to your Helm repository list:

| Chart | Repository | Version | Values |
| --- | --- | --- | --- |
| `openbao` | `https://openbao.github.io/openbao-helm` | 0.29.6 (OpenBao 2.6.3) | [`values/openbao.yaml`](values/openbao.yaml) |
| `vault` | `https://helm.releases.hashicorp.com` | 0.34.1 (Vault 2.0.4) | [`values/vault.yaml`](values/vault.yaml) — skip it with `WITH_VAULT=0` |
| `vault-secrets-operator` | `https://helm.releases.hashicorp.com` | 1.6.0 | [`values/vso.yaml`](values/vso.yaml) |

Set `OPENBAO_CHART_VERSION=`, `VAULT_CHART_VERSION=` or `VSO_CHART_VERSION=`
for other releases.

**It never changes which kubectl context is current.** kind switches to the
new cluster when it makes one, and the script switches straight back; every
`kubectl` and `helm` call names the `kind-openbao-dev` context explicitly, so
nothing can land on another cluster.

**The unseal keys and root token** OpenBao prints when it is initialised go
to `dev/.cache/openbao-init.json` (mode 600, in a mode-700 folder), which git
ignores. They unlock nothing but this throwaway cluster, and `dev/down.sh`
deletes them. The script passes them to `bao` inside the pods on the command
line, which is fine for a dev cluster and nowhere else.

## What you get

| Where | Shows |
| --- | --- |
| `openbao/openbao` | OpenBao, three raft nodes with `service_registration "kubernetes"`: `openbao-0` leads, `openbao-1` stands by, and `openbao-2` is restarted after joining and given only 2 of its 3 keys — sealed, with the unseal progress showing. The agent injector runs beside it. |
| `vault/vault` | Vault in dev mode, one in-memory node. Dev mode has no service registration, so its pod carries no `vault-*` labels and the plugin reads its state from the API. |
| `shop/app-config` | A VaultStaticSecret for `secret/shop/config`: synced into Secret `app-config`, which Deployment `web` uses through `envFrom`, and which restarts `web` when it changes. |
| `shop/stripe-keys` | A VaultStaticSecret for a path that does not exist: failing, with the operator's own error. |
| `shop/web-tls` | A VaultPKISecret from OpenBao's PKI engine, 24 hours long and reissued an hour before it ends: on **Certificates & leases**, and mounted by `web`. |
| `billing/invoicer` | A Deployment annotated for the agent injector: role `billing`, `secret/data/billing/config` rendered into `/vault/secrets/config`. |

Inside OpenBao the script enables kv-v2 at `secret/`, PKI at `pki/` with a
root and role `web`, the Kubernetes auth method (reviewing tokens with the
server's own service account, which the chart binds to
`system:auth-delegator`), roles `shop` and `billing`, and a policy for each.

Not in the dev cluster, only in the preview fixtures (`npm run preview`): a
Vault HA cluster on auto-unseal running two versions, an uninitialised server,
dynamic database and AWS credentials (one overdue for renewal), External
Secrets and a CSI class. They need a database, a cloud account or more
operators than a laptop cluster should carry.

## Things to try in the app

Open the `kind-openbao-dev` context in K8s Dockside and go to **Plugins →
OpenBao & Vault**. If the plugin is not installed, **Settings → Plugins →
Watch another folder** and point it at this checkout.

The plugin calls the servers' API through the API server's service proxy;
kind's admin user may, so the cards show what the API said.

- **Unseal openbao-2** with the command the Servers view gives you. It asks
  for a key; the third one is `jq -r '.unseal_keys_b64[2]' dev/.cache/openbao-init.json`.
  Its padlock opens and the dashboard goes green.
- **Fix the failing sync**: write the secret, then press **Sync now** on
  `stripe-keys` (its panel), and watch it turn green:

  ```sh
  kubectl --context kind-openbao-dev -n openbao exec openbao-0 -- \
      env BAO_TOKEN=$(jq -r .root_token dev/.cache/openbao-init.json) \
      bao kv put secret/shop/stripe api_key=sk_test
  ```

- **Seal a node** and watch the dashboard turn amber, then red:

  ```sh
  kubectl --context kind-openbao-dev -n openbao delete pod openbao-1
  ```

- **Reissue now** on `web-tls`: a new certificate, and a new bar on the
  timeline.

## When kind will not start

On a machine whose running kernel does not match its installed modules (after
a kernel update, before the reboot), Docker cannot create the network pair a
kind node needs, and `kind create cluster` fails with `failed to add the host
<=> sandbox pair interfaces: operation not supported`. Reboot, and run
`dev/up.sh` again. The values and manifests can still be checked without a
cluster:

```sh
helm template openbao openbao --repo https://openbao.github.io/openbao-helm --version 0.29.6 -f dev/values/openbao.yaml
helm template vault vault --repo https://helm.releases.hashicorp.com --version 0.34.1 -f dev/values/vault.yaml
helm template vso vault-secrets-operator --repo https://helm.releases.hashicorp.com --version 1.6.0 -f dev/values/vso.yaml
```

## Starting over

`dev/down.sh`, then `dev/up.sh`. Reusing a cluster works too: `dev/up.sh`
checks what is there, skips initialising a server that already is, and
unseals only what is sealed.
