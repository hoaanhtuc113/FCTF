#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
YAML_FILE="$ROOT_DIR/prod/localhost/local-host.yaml"

echo "Deleting NodePort services defined in: $YAML_FILE"
kubectl delete -f "$YAML_FILE" --ignore-not-found

echo
echo "Current NodePort services (for verification):"
kubectl get svc -A | grep NodePort || echo "No NodePort services found."

echo
echo "Clean done."

