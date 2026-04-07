#!/bin/bash
# ============================================================================
# FCTF – Create dedicated ServiceAccount + kubeconfig for CI/CD pipeline
#
# Usage:
#   chmod +x cicd-setup.sh && ./cicd-setup.sh
#
# What it does:
#   1. Creates ServiceAccount "cicd-deployer" in namespace "app"
#   2. Creates Role with minimal permissions (deployments only)
#   3. Binds Role to ServiceAccount
#   4. Generates a long-lived token (Secret)
#   5. Builds a standalone kubeconfig
#   6. Outputs base64-encoded kubeconfig → paste into GitHub Secret KUBE_CONFIG
#
# Prerequisites:
#   - kubectl configured with cluster-admin access
#   - jq installed (apt install jq)
# ============================================================================

set -euo pipefail

NAMESPACE="app"
SA_NAME="cicd-deployer"
SECRET_NAME="${SA_NAME}-token"
CLUSTER_NAME="fctf-cluster"

# ─── Colors ─────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${YELLOW}──────────────────────────────────────────────${NC}"
echo -e "${YELLOW} FCTF CI/CD ServiceAccount Setup${NC}"
echo -e "${YELLOW}──────────────────────────────────────────────${NC}"

# ─── 1. Create ServiceAccount ──────────────────────────────────────────────
echo -e "\n${GREEN}[1/6]${NC} Creating ServiceAccount '${SA_NAME}' in namespace '${NAMESPACE}'..."

kubectl apply -f - <<EOF
apiVersion: v1
kind: ServiceAccount
metadata:
  name: ${SA_NAME}
  namespace: ${NAMESPACE}
  labels:
    app.kubernetes.io/managed-by: cicd-setup
EOF

# ─── 2. Create Role (least privilege – deployments only) ───────────────────
echo -e "${GREEN}[2/6]${NC} Creating Role with deployment-only permissions..."

kubectl apply -f - <<EOF
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: ${SA_NAME}-role
  namespace: ${NAMESPACE}
  labels:
    app.kubernetes.io/managed-by: cicd-setup
rules:
  - apiGroups: ["apps"]
    resources: ["deployments"]
    verbs: ["get", "list", "patch", "update"]
  - apiGroups: ["apps"]
    resources: ["deployments/status"]
    verbs: ["get"]
  - apiGroups: [""]
    resources: ["pods"]
    verbs: ["get", "list", "watch"]
EOF

# ─── 3. Bind Role to ServiceAccount ───────────────────────────────────────
echo -e "${GREEN}[3/6]${NC} Creating RoleBinding..."

kubectl apply -f - <<EOF
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: ${SA_NAME}-binding
  namespace: ${NAMESPACE}
  labels:
    app.kubernetes.io/managed-by: cicd-setup
subjects:
  - kind: ServiceAccount
    name: ${SA_NAME}
    namespace: ${NAMESPACE}
roleRef:
  kind: Role
  name: ${SA_NAME}-role
  apiGroup: rbac.authorization.k8s.io
EOF

# ─── 4. Create long-lived token Secret ────────────────────────────────────
echo -e "${GREEN}[4/6]${NC} Creating long-lived token..."

kubectl apply -f - <<EOF
apiVersion: v1
kind: Secret
metadata:
  name: ${SECRET_NAME}
  namespace: ${NAMESPACE}
  labels:
    app.kubernetes.io/managed-by: cicd-setup
  annotations:
    kubernetes.io/service-account.name: ${SA_NAME}
type: kubernetes.io/service-account-token
EOF

# Wait for token to be populated
echo "    Waiting for token..."
for i in $(seq 1 30); do
  TOKEN=$(kubectl -n "${NAMESPACE}" get secret "${SECRET_NAME}" -o jsonpath='{.data.token}' 2>/dev/null || true)
  if [ -n "${TOKEN}" ]; then
    break
  fi
  sleep 1
done

if [ -z "${TOKEN}" ]; then
  echo -e "${RED}ERROR: Token was not created after 30s${NC}"
  exit 1
fi

SA_TOKEN=$(echo "${TOKEN}" | base64 -d)

# ─── 5. Build standalone kubeconfig ───────────────────────────────────────
echo -e "${GREEN}[5/6]${NC} Building standalone kubeconfig..."

# Get cluster CA and server from current kubeconfig
CLUSTER_CA=$(kubectl config view --raw -o jsonpath='{.clusters[0].cluster.certificate-authority-data}')
CLUSTER_SERVER=$(kubectl config view --raw -o jsonpath='{.clusters[0].cluster.server}')

# Detect if server is localhost/private and warn
if echo "${CLUSTER_SERVER}" | grep -qE '(127\.0\.0\.1|localhost|10\.|192\.168\.)'; then
  echo -e "${YELLOW}  ⚠  WARNING: Server URL is '${CLUSTER_SERVER}'${NC}"
  echo -e "${YELLOW}     GitHub Actions runners need a PUBLIC IP/domain to reach the cluster.${NC}"
  echo -e "${YELLOW}     Replace the server URL below with your public IP before using.${NC}"
  echo ""
  read -rp "  Enter public IP/domain (or press Enter to keep current): " PUBLIC_ADDR
  if [ -n "${PUBLIC_ADDR}" ]; then
    # Extract port from current server URL
    PORT=$(echo "${CLUSTER_SERVER}" | grep -oP ':\d+$' || echo ":6443")
    CLUSTER_SERVER="https://${PUBLIC_ADDR}${PORT}"
    echo -e "  → Using: ${CLUSTER_SERVER}"
  fi
fi

KUBECONFIG_CONTENT=$(cat <<EOF
apiVersion: v1
kind: Config
clusters:
  - name: ${CLUSTER_NAME}
    cluster:
      certificate-authority-data: ${CLUSTER_CA}
      server: ${CLUSTER_SERVER}
contexts:
  - name: ${SA_NAME}@${CLUSTER_NAME}
    context:
      cluster: ${CLUSTER_NAME}
      namespace: ${NAMESPACE}
      user: ${SA_NAME}
current-context: ${SA_NAME}@${CLUSTER_NAME}
users:
  - name: ${SA_NAME}
    user:
      token: ${SA_TOKEN}
EOF
)

# ─── 6. Output base64 ────────────────────────────────────────────────────
echo -e "${GREEN}[6/6]${NC} Encoding kubeconfig to base64...\n"

KUBECONFIG_BASE64=$(echo "${KUBECONFIG_CONTENT}" | base64 -w 0)

echo -e "${YELLOW}══════════════════════════════════════════════════════════════${NC}"
echo -e "${YELLOW} Copy the value below and paste it as GitHub Secret:${NC}"
echo -e "${YELLOW} Settings → Secrets → Actions → New secret${NC}"
echo -e "${YELLOW} Name: KUBE_CONFIG${NC}"
echo -e "${YELLOW}══════════════════════════════════════════════════════════════${NC}"
echo ""
echo "${KUBECONFIG_BASE64}"
echo ""
echo -e "${YELLOW}══════════════════════════════════════════════════════════════${NC}"

cat <<'EOF'
# ============================================================================
# FCTF – CI/CD Pipeline
# Triggers on push to main. Only services whose files changed are rebuilt.
# Each service is built as a Docker image, pushed to DockerHub, then
# automatically redeployed to the k3s cluster.
#
# ─── Required GitHub Secrets ────────────────────────────────────────────────
#
#   HARBOR_USERNAME   – Harbor username (NOT email)
#   HARBOR_TOKEN      – Harbor access token (NOT password)
#                          Create at: https://registry.sanchoi.iahn.hanoi.vn/settings/security
#   KUBE_CONFIG          – base64-encoded kubeconfig cho CI/CD ServiceAccount
#                          Chạy script trên server K3s để tạo tự động:
#                            cd FCTF-k3s-manifest
#                            chmod +x cicd-setup.sh && ./cicd-setup.sh
#                          Script sẽ tạo ServiceAccount least-privilege và
#                          xuất base64 kubeconfig để paste vào secret này.
#                          (xem FCTF-k3s-manifest/cicd-setup.sh để biết chi tiết)
#
# ─── How to add secrets ────────────────────────────────────────────────────
#
#   GitHub repo → Settings → Secrets and variables → Actions → New secret
#
# ============================================================================
EOF

# ─── Verify ───────────────────────────────────────────────────────────────
echo -e "\n${GREEN}✅ Setup complete!${NC}"
echo -e "   ServiceAccount: ${NAMESPACE}/${SA_NAME}"
echo -e "   Permissions:    deployments (get/list/patch/update) in '${NAMESPACE}'"
echo -e "   Server:         ${CLUSTER_SERVER}"
echo ""
echo -e "${GREEN}Verifying access...${NC}"

# Quick test using the new kubeconfig
echo "${KUBECONFIG_CONTENT}" > /tmp/cicd-kubeconfig-test.yaml
if kubectl --kubeconfig=/tmp/cicd-kubeconfig-test.yaml -n "${NAMESPACE}" get deployments > /dev/null 2>&1; then
  echo -e "${GREEN}✅ ServiceAccount can list deployments in '${NAMESPACE}'${NC}"
else
  echo -e "${YELLOW}⚠  Could not verify access (may work from external network)${NC}"
fi
rm -f /tmp/cicd-kubeconfig-test.yaml
