#!/usr/bin/env sh
set -eu

SA_NAME="${1:-start-chal-v2-workflow-sa}"
SA_NAMESPACE="${2:-argo}"
DURATION="${3:-1h}"

TOKEN="$(kubectl create token "${SA_NAME}" -n "${SA_NAMESPACE}" --duration="${DURATION}")"
printf 'Bearer %s\n' "${TOKEN}"