#!/usr/bin/env sh
set -eu

SA_NAME="${1:-deployment-center-sa}"
SA_NAMESPACE="${2:-app}"
DURATION="${3:-1h}"

TOKEN="$(kubectl create token "${SA_NAME}" -n "${SA_NAMESPACE}" --duration="${DURATION}")"
printf 'Bearer %s\n' "${TOKEN}"