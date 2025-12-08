#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

YAML_FILE="$ROOT_DIR/prod/localhost/local-host.yaml"

echo "Applying NodePort services from: $YAML_FILE"
kubectl apply -f "$YAML_FILE"

echo
echo "Checking cluster nodes IPs..."

echo "Available nodes (NAME   INTERNAL-IP):"
kubectl get nodes -o wide | awk 'NR==1 {print; next} {printf "  %s\t%s\n", $1, $6}'
echo

if [[ -n "${NODE_IP:-}" ]]; then
  echo "NODE_IP is already set from environment: $NODE_IP"
else
  # Try to detect the first schedulable node IP
  NODE_IP="$(kubectl get nodes -o wide | awk 'NR==2 {print $6}')"
fi

if [[ -z "${NODE_IP:-}" ]]; then
  echo "Could not automatically detect NODE_IP."
  echo "Please export NODE_IP first, e.g.:"
  echo "  export NODE_IP=<your-node-ip>"
  echo "  ./start-local.sh"
  exit 1
fi

echo "Using NODE_IP=$NODE_IP"
echo
echo "You can now access services via:"
echo "  Admin MVC:              http://$NODE_IP:30070"
echo "  Contestant Backend:     http://$NODE_IP:30081"
echo "  Contestant Portal:      http://$NODE_IP:30082"
echo "  Filebrowser:            http://$NODE_IP:30083"
echo "  Argo Workflows:         http://$NODE_IP:30084"
echo "  Grafana:                http://$NODE_IP:30085"
echo "  MariaDB:                mysql://$NODE_IP:30306"
echo "  Kubernetes Dashboard:   https://$NODE_IP:30086"

echo
echo "Done."