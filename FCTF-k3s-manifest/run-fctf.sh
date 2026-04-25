#!/bin/bash
# ==============================================================================
# FCTF LOCAL RUNNER (Windows Localhost Native)
# Fixes WSL2 Networking issue by removing NodePort iptables bindings and
# establishing direct user-space port-forwards, allowing you to use 
# "localhost:30080" directly on Windows without proxy configurations.
# Usage: bash run-fctf.sh
# ==============================================================================

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

cleanup() {
  echo -e "\n${YELLOW}Stopping all port-forwards...${NC}"
  pkill -f "kubectl port-forward" >/dev/null 2>&1
  echo -e "${GREEN}Done. Exiting!${NC}"
  exit 0
}
trap cleanup SIGINT SIGTERM

echo -e "${YELLOW}Cleaning up old connections...${NC}"
pkill -f "kubectl port-forward" >/dev/null 2>&1
sleep 1

# Step 1: Remove iptables NodePort bindings by setting services to ClusterIP
# This is the secret to fixing WSL2 localhost forwarding!
echo -e "${YELLOW}Optimizing networking for WSL2 Localhost...${NC}"
SERVICES_APP="admin-mvc-svc contestant-portal-svc contestant-be-svc challenge-gateway-svc"
for svc in $SERVICES_APP; do
    kubectl patch svc $svc -n app --type='json' -p='[{"op": "replace", "path": "/spec/type", "value": "ClusterIP"}]' >/dev/null 2>&1 || true
    kubectl patch svc $svc -n app --type='json' -p='[{"op": "remove", "path": "/spec/ports/0/nodePort"}]' >/dev/null 2>&1 || true
done
kubectl patch svc prometheus-grafana -n monitoring --type='json' -p='[{"op": "replace", "path": "/spec/type", "value": "ClusterIP"}]' >/dev/null 2>&1 || true
kubectl patch svc argo-workflows-server -n argo  --type='json' -p='[{"op": "replace", "path": "/spec/type", "value": "ClusterIP"}]' >/dev/null 2>&1 || true
kubectl patch svc rabbitmq -n db  --type='json' -p='[{"op": "replace", "path": "/spec/type", "value": "ClusterIP"}]' >/dev/null 2>&1 || true

# Step 2: Ensure ConfigMap points to correct ports and reload portal
echo -e "${YELLOW}Applying Configuration Updates...${NC}"
kubectl apply -f prod/env/configmap/contestant-portal-cm.yaml >/dev/null 2>&1 || true
kubectl rollout restart deployment/contestant-portal -n app >/dev/null 2>&1

echo -e "${YELLOW}Waiting for contestant-portal to finish restarting...${NC}"
kubectl rollout status deployment/contestant-portal -n app --timeout=90s >/dev/null 2>&1 || true

# Wait for everything to be running
NOT_READY=$(kubectl get pods -n app --no-headers 2>/dev/null | grep -vc "Running" || echo 0)
if [ "$NOT_READY" -gt 0 ]; then
  echo -e "${YELLOW}Waiting for pods to be Ready...${NC}"
  kubectl wait --for=condition=ready pod --all -n app --timeout=60s >/dev/null 2>&1 || true
fi

# Step 3: Forward ports natively in user-space
echo -e "\n${YELLOW}Opening Native Windows Localhost Ports...${NC}"

# Define ports matching exact project NodePort specifications
# Format: "local_port target namespace container_port label"
PFS=(
  "30080 svc/admin-mvc-svc             app        8000   Admin_Portal"
  "30517 svc/contestant-portal-svc     app        8080   Contestant_Portal"
  "30501 svc/contestant-be-svc         app        5010   Backend_API"
  "30038 svc/challenge-gateway-svc     app        8080   Gateway_HTTP"
  "32746 svc/argo-workflows-server     argo       2746   Argo_Workflows"
  "30082 svc/prometheus-grafana        monitoring 80     Grafana"
  "31672 svc/rabbitmq                  db         15672  RabbitMQ"
)

# Exception for challenge gateway TCP which can't easily be forwarded alongside HTTP from deployment
# using 1 liner, so we forward the pod directly if needed, or by svc.
kubectl port-forward svc/challenge-gateway-svc -n app --address 0.0.0.0 30037:1337 >/tmp/fctf-tcp.log 2>&1 &

for entry in "${PFS[@]}"; do
  read -r lport target ns cport label <<< "$entry"
  kubectl port-forward "$target" -n "$ns" --address 0.0.0.0 "$lport:$cport" >"/tmp/fctf-${lport}.log" 2>&1 &
  sleep 0.3
  echo -e "  ${GREEN}✓${NC} ${BOLD}localhost:${lport}${NC} ($label)"
done

# Step 4: Display Links
echo -e "\n${CYAN}${BOLD}==============================================================${NC}"
echo -e "${GREEN}${BOLD}                  FCTF ENVIRONMENT READY                       ${NC}"
echo -e "${CYAN}${BOLD}==============================================================${NC}"
echo -e "  Simply click these links to open directly in Windows:"
echo -e ""
echo -e "  ${BOLD}Admin Portal:${NC}       http://localhost:30080"
echo -e "  ${BOLD}Contestant Portal:${NC}  http://localhost:30517"
echo -e "  ${BOLD}Challenge Gateway:${NC}  http://localhost:30038"
echo -e ""
echo -e "  ${BOLD}Argo Workflows:${NC}     http://localhost:32746"
echo -e "  ${BOLD}Grafana Dashboard:${NC}  http://localhost:30082  (admin/Fctf2025@)"
echo -e "  ${BOLD}RabbitMQ Queues:${NC}    http://localhost:31672"
echo -e "${CYAN}${BOLD}==============================================================${NC}"
echo -e "  ${YELLOW}Keep this terminal open.${NC} Press Ctrl+C to stop services.\n"

wait
