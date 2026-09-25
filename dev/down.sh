#!/usr/bin/env bash
# Deletes the kind cluster dev/up.sh made, everything in it, and the dev
# unseal keys and root token kept in dev/.cache -- they unlock nothing once
# the cluster is gone.

set -euo pipefail

CLUSTER="${CLUSTER:-openbao-dev}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

kind delete cluster --name "${CLUSTER}"
rm -rf "${HERE}/.cache"
