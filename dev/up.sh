#!/usr/bin/env bash
# A kind cluster with OpenBao, a dev-mode Vault and the Vault Secrets
# Operator, in every state the plugin draws: a three-node raft cluster with
# one node left sealed on purpose, syncs that work and one that fails, a PKI
# certificate, a Deployment using the synced Secrets, and a pod that gets its
# secret from the agent injector.
#
#   dev/up.sh                  create (or reuse) the kind cluster and set it all up
#   CLUSTER=foo dev/up.sh      under another kind cluster name
#   WITH_VAULT=0 dev/up.sh     without the dev-mode Vault
#
# It never changes which kubectl context is current: kind switches to the new
# cluster when it creates one, and this script switches back. Every kubectl
# and helm call below names the kind context explicitly, so nothing here can
# land on another cluster by accident.
#
# The unseal keys and root token OpenBao prints when it is initialised are
# kept in dev/.cache/openbao-init.json, which git ignores. They unlock nothing
# but this throwaway cluster; dev/down.sh deletes them with it.
#
# Needs: docker (or podman with KIND_EXPERIMENTAL_PROVIDER=podman), kind,
# kubectl, helm and jq. Charts and images are pulled from the internet.

set -euo pipefail

CLUSTER="${CLUSTER:-openbao-dev}"
CONTEXT="kind-${CLUSTER}"
WITH_VAULT="${WITH_VAULT:-1}"

# The releases the setup was written against.
OPENBAO_CHART_VERSION="${OPENBAO_CHART_VERSION:-0.29.6}"   # OpenBao 2.6.3
VAULT_CHART_VERSION="${VAULT_CHART_VERSION:-0.34.1}"       # Vault 2.0.4
VSO_CHART_VERSION="${VSO_CHART_VERSION:-1.6.0}"            # Vault Secrets Operator 1.6.0
OPENBAO_REPO="https://openbao.github.io/openbao-helm"
HASHICORP_REPO="https://helm.releases.hashicorp.com"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CACHE="${HERE}/.cache"
INIT="${CACHE}/openbao-init.json"
NS=openbao

say() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
k() { kubectl --context "${CONTEXT}" "$@"; }
h() { helm --kube-context "${CONTEXT}" "$@"; }
# The OpenBao CLI in a server pod. BAO_ADDR is set in the pod by the chart.
bao() { local pod="$1"; shift; k -n "${NS}" exec "${pod}" -- bao "$@"; }
# The same, logged in with the dev root token; bao_root_in also passes stdin.
bao_root() { local pod="$1"; shift; k -n "${NS}" exec "${pod}" -- env "BAO_TOKEN=$(jq -r .root_token "${INIT}")" bao "$@"; }
bao_root_in() { local pod="$1"; shift; k -n "${NS}" exec -i "${pod}" -- env "BAO_TOKEN=$(jq -r .root_token "${INIT}")" bao "$@"; }
key() { jq -r ".unseal_keys_b64[$1]" "${INIT}"; }

for tool in kind kubectl helm jq; do
    command -v "${tool}" >/dev/null || { echo "dev/up.sh needs ${tool} on the PATH" >&2; exit 1; }
done

previous="$(kubectl config current-context 2>/dev/null || true)"
restore() {
    if [[ -n "${previous}" && "$(kubectl config current-context 2>/dev/null || true)" != "${previous}" ]]; then
        kubectl config use-context "${previous}" >/dev/null
        echo "(current kubectl context left at ${previous}; this script uses ${CONTEXT})"
    fi
}
trap restore EXIT

if kind get clusters 2>/dev/null | grep -qx "${CLUSTER}"; then
    say "kind cluster ${CLUSTER} is already there; reusing it"
else
    say "Creating kind cluster ${CLUSTER}"
    kind create cluster --name "${CLUSTER}" --wait 120s
fi
restore

mkdir -p "${CACHE}"
chmod 700 "${CACHE}"

# ----- OpenBao ---------------------------------------------------------------------

say "Installing OpenBao (chart ${OPENBAO_CHART_VERSION}): three raft nodes and the agent injector"
h upgrade --install openbao openbao --repo "${OPENBAO_REPO}" --version "${OPENBAO_CHART_VERSION}" \
    --namespace "${NS}" --create-namespace -f "${HERE}/values/openbao.yaml" --wait=false

# A server pod runs but is not ready while it is sealed: its readiness probe
# is `bao status`, which fails on a sealed node. So wait for Running.
running() {
    local pod="$1"
    for _ in $(seq 1 120); do
        if [[ "$(k -n "${NS}" get pod "${pod}" -o jsonpath='{.status.phase}' 2>/dev/null)" == Running ]]; then
            # The container is up; give the listener a moment.
            for _ in $(seq 1 30); do
                bao "${pod}" status >/dev/null 2>&1 && return 0
                [[ $? -eq 2 ]] && return 0   # 2 = sealed, which is an answer
                sleep 2
            done
            return 0
        fi
        sleep 5
    done
    echo "${pod} did not start" >&2
    return 1
}

status_field() { bao "$1" status -format=json 2>/dev/null | jq -r ".$2" || true; }

# Enters the first `shares` keys on a node, from a clean start: a node left
# half-unsealed by an earlier run keeps its progress, and a key it already
# has would not move it on.
unseal() {
    local pod="$1" shares="$2"
    bao "${pod}" operator unseal -reset >/dev/null 2>&1 || true
    for i in $(seq 0 $((shares - 1))); do
        bao "${pod}" operator unseal "$(key "${i}")" >/dev/null
    done
}

for pod in openbao-0 openbao-1 openbao-2; do running "${pod}"; done

if [[ "$(status_field openbao-0 initialized)" != true ]]; then
    say "Initialising OpenBao: 5 key shares, 3 to unseal"
    bao openbao-0 operator init -key-shares=5 -key-threshold=3 -format=json > "${INIT}.tmp"
    mv "${INIT}.tmp" "${INIT}"
    chmod 600 "${INIT}"
    echo "unseal keys and root token written to ${INIT} (git-ignored)"
elif [[ ! -s "${INIT}" ]]; then
    echo "OpenBao is initialised but ${INIT} is missing, so it cannot be unsealed from here." >&2
    echo "Start over with dev/down.sh && dev/up.sh." >&2
    exit 1
fi

say "Unsealing openbao-0, then letting openbao-1 and openbao-2 join"
[[ "$(status_field openbao-0 sealed)" == true ]] && unseal openbao-0 3
for _ in $(seq 1 30); do
    [[ "$(status_field openbao-0 is_self)" == true ]] && break
    sleep 2
done
for pod in openbao-1 openbao-2; do
    [[ "$(status_field "${pod}" sealed)" == true ]] && unseal "${pod}" 3
done

# All three have to be raft peers before openbao-2 is sealed again, or it
# would come back as a node that never joined rather than a sealed member.
for _ in $(seq 1 60); do
    peers="$(bao_root openbao-0 operator raft list-peers -format=json 2>/dev/null | jq '.data.config.servers | length' || echo 0)"
    [[ "${peers}" == 3 ]] && break
    sleep 2
done
echo "raft peers: ${peers:-?}"

say "Writing the demo's secrets, PKI, policies and Kubernetes logins into OpenBao"
bao_root openbao-0 secrets list -format=json | jq -e '."secret/"' >/dev/null 2>&1 || bao_root openbao-0 secrets enable -path=secret kv-v2
bao_root openbao-0 kv put secret/shop/config api_url=https://api.shop.example feature_x=on >/dev/null
bao_root openbao-0 kv put secret/billing/config api=https://billing.example >/dev/null
if ! bao_root openbao-0 secrets list -format=json | jq -e '."pki/"' >/dev/null 2>&1; then
    bao_root openbao-0 secrets enable pki
    bao_root openbao-0 secrets tune -max-lease-ttl=720h pki
    bao_root openbao-0 write -field=serial_number pki/root/generate/internal common_name="openbao dev root" ttl=720h >/dev/null
fi
bao_root openbao-0 write pki/roles/web allowed_domains=shop.svc allow_subdomains=true max_ttl=72h >/dev/null

bao_root_in openbao-0 policy write shop - >/dev/null <<'EOF'
path "secret/data/shop/*" { capabilities = ["read"] }
path "pki/issue/web"      { capabilities = ["create", "update"] }
EOF
bao_root_in openbao-0 policy write billing - >/dev/null <<'EOF'
path "secret/data/billing/*" { capabilities = ["read"] }
EOF

bao_root openbao-0 auth list -format=json | jq -e '."kubernetes/"' >/dev/null 2>&1 || bao_root openbao-0 auth enable kubernetes
# In a pod, OpenBao reviews tokens with its own service account; the chart
# binds it to system:auth-delegator.
bao_root openbao-0 write auth/kubernetes/config kubernetes_host=https://kubernetes.default.svc >/dev/null
bao_root openbao-0 write auth/kubernetes/role/shop bound_service_account_names=default bound_service_account_namespaces=shop policies=shop ttl=1h >/dev/null
bao_root openbao-0 write auth/kubernetes/role/billing bound_service_account_names=default bound_service_account_namespaces=billing policies=billing ttl=1h >/dev/null

say "Sealing openbao-2 again, and entering only 2 of its 3 keys"
k -n "${NS}" delete pod openbao-2 --wait=true >/dev/null
running openbao-2
unseal openbao-2 2
echo "openbao-2: $(status_field openbao-2 progress) of $(status_field openbao-2 t) keys entered, sealed=$(status_field openbao-2 sealed)"

# ----- Vault, in dev mode -----------------------------------------------------------------

if [[ "${WITH_VAULT}" == 1 ]]; then
    say "Installing Vault in dev mode (chart ${VAULT_CHART_VERSION})"
    h upgrade --install vault vault --repo "${HASHICORP_REPO}" --version "${VAULT_CHART_VERSION}" \
        --namespace vault --create-namespace -f "${HERE}/values/vault.yaml" --wait --timeout 5m
fi

# ----- the Vault Secrets Operator ------------------------------------------------------------

say "Installing the Vault Secrets Operator (chart ${VSO_CHART_VERSION})"
h upgrade --install vault-secrets-operator vault-secrets-operator --repo "${HASHICORP_REPO}" --version "${VSO_CHART_VERSION}" \
    --namespace vault-secrets-operator-system --create-namespace -f "${HERE}/values/vso.yaml" --wait --timeout 5m

say "Waiting for the agent injector"
k -n "${NS}" rollout status deployment/openbao-agent-injector --timeout=300s

# The operator's CRDs and the injector's webhook answer a moment after their
# pods are ready, so each manifest is retried for a while.
apply() {
    local file="$1"
    for attempt in $(seq 1 30); do
        if k apply -f "${file}" >/dev/null 2>"${CACHE}/apply.err"; then
            echo "applied $(basename "${file}")"
            return 0
        fi
        [[ "${attempt}" == 1 ]] && echo "waiting for the cluster to accept $(basename "${file}")…"
        sleep 4
    done
    cat "${CACHE}/apply.err" >&2
    return 1
}

say "Applying the demo workloads"
for file in "${HERE}"/manifests/*.yaml; do apply "${file}"; done

say "Waiting for the syncs and the pods"
k -n shop wait --for=condition=Ready vaultstaticsecret/app-config --timeout=180s || true
k -n shop rollout status deployment/web --timeout=300s || true
k -n billing rollout status deployment/invoicer --timeout=300s || true

say "Done"
k -n "${NS}" get pods -L openbao-active,openbao-sealed,openbao-initialized,openbao-version
k get vaultstaticsecrets,vaultpkisecrets -A 2>/dev/null || true
cat <<EOF

Open the context "${CONTEXT}" in K8s Dockside and go to Plugins -> OpenBao & Vault.

  - openbao/openbao        three raft nodes: openbao-0 leads, openbao-1 stands by,
                           openbao-2 is sealed with 2 of 3 keys entered
  - vault/vault            Vault in dev mode: no pod labels, state from the API
  - shop/app-config        synced, used by Deployment web (restarted on change)
  - shop/stripe-keys       failing: the path does not exist
  - shop/web-tls           a 24 h certificate from OpenBao's PKI
  - billing/invoicer       its secret rendered by the agent injector

The unseal keys and root token are in ${INIT}.

Things to try:
  - Unseal openbao-2 with the third key, and watch its padlock open:
      kubectl --context ${CONTEXT} -n ${NS} exec -ti openbao-2 -- bao operator unseal
    (it asks for the key; the third one is: jq -r '.unseal_keys_b64[2]' ${INIT})
  - Fix the failing sync by writing the secret, then press "Sync now" on it:
      kubectl --context ${CONTEXT} -n ${NS} exec openbao-0 -- \\
        env BAO_TOKEN=\$(jq -r .root_token ${INIT}) bao kv put secret/shop/stripe api_key=sk_test
  - Seal a node and see the dashboard turn red:
      kubectl --context ${CONTEXT} -n ${NS} delete pod openbao-1

Delete it all with dev/down.sh.
EOF
