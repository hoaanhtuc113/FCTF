#!/usr/bin/env bash
set -euo pipefail

TIMEZONE="Asia/Ho_Chi_Minh"
MAX_PODS="110"
TLS_SAN=""
INSTALL_CALICO="true"
INSTALL_GVISOR="true"
APPLY_HELM="true"
DEPLOY_APP_SERVICES="true"
APPLY_PRODUCTION_INGRESS="true"
APPLY_CRONJOB="true"
APPLY_ARGO_TEMPLATES="true"
SERVICE_MODE="clusterip"
SETUP_NFS_SERVER="true"
NFS_SHARE_PATH="/srv/nfs/share"
NFS_ALLOWED_SUBNET="*"
INTERACTIVE="true"
ARG_COUNT=$#
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROD_DIR="${SCRIPT_DIR}/prod"
MARIADB_AUTH_SECRET_FILE="${PROD_DIR}/env/secret/mariadb-auth-secret.yaml"
MARIADB_POST_INIT_GRANTS_SQL="${PROD_DIR}/helm/db/mariadb/least-privilege-service-accounts.sql"

STORAGE_PV_FILES=(
  "${PROD_DIR}/storage/pv/admin-mvc-pv.yaml"
  "${PROD_DIR}/storage/pv/contestant-be-pv.yaml"
  "${PROD_DIR}/storage/pv/up-challenge-workflow-pv.yaml"
  "${PROD_DIR}/storage/pv/start-challenge-workflow-pv.yaml"
  "${PROD_DIR}/storage/pv/filebrowser-pv.yaml"
)

STORAGE_PVC_FILES=(
  "${PROD_DIR}/storage/pvc/admin-mvc-pvc.yaml"
  "${PROD_DIR}/storage/pvc/contestant-be-pvc.yaml"
  "${PROD_DIR}/storage/pvc/up-challenge-workflow-pvc.yaml"
  "${PROD_DIR}/storage/pvc/start-challenge-workflow-pvc.yaml"
  "${PROD_DIR}/storage/pvc/filebrowser-pvc.yaml"
)

apply_storage_manifests() {
  echo "==> Applying storage PVs"
  for manifest in "${STORAGE_PV_FILES[@]}"; do
    if [[ ! -f "${manifest}" ]]; then
      echo "Error: PV manifest not found at ${manifest}"
      exit 1
    fi
    kubectl apply -f "${manifest}"
  done

  echo "==> Applying storage PVCs"
  for manifest in "${STORAGE_PVC_FILES[@]}"; do
    if [[ ! -f "${manifest}" ]]; then
      echo "Error: PVC manifest not found at ${manifest}"
      exit 1
    fi
    kubectl apply -f "${manifest}"
  done
}

usage() {
  cat <<EOF
Usage:
  $0 --tls-san <master-public-ip-or-domain> [--timezone <tz>] [--max-pods <n>] [--install-calico true|false] [--install-gvisor true|false] [--setup-nfs-server true|false] [--nfs-share-path <path>] [--nfs-allowed-subnet "<client1 client2>|<client1,client2>|*"] [--apply-helm true|false] [--deploy-app-services true|false] [--apply-production-ingress true|false] [--apply-cronjob true|false] [--apply-argo-templates true|false] [--service-mode clusterip|nodeport] [--interactive]

Examples:
  $0 --tls-san 34.124.131.240
  $0 --tls-san k8s.example.com --max-pods 250 --install-calico true
  $0 --tls-san 34.124.131.240 --setup-nfs-server true --nfs-allowed-subnet 10.148.0.0/24
  $0 --tls-san 34.124.131.240 --install-gvisor true --apply-helm true --deploy-app-services true --apply-production-ingress true --apply-cronjob true --apply-argo-templates true
  $0 --interactive
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --tls-san)
      TLS_SAN="${2:-}"
      shift 2
      ;;
    --timezone)
      TIMEZONE="${2:-}"
      shift 2
      ;;
    --max-pods)
      MAX_PODS="${2:-}"
      shift 2
      ;;
    --install-calico)
      INSTALL_CALICO="${2:-}"
      shift 2
      ;;
    --install-gvisor)
      INSTALL_GVISOR="${2:-}"
      shift 2
      ;;
    --setup-nfs-server)
      SETUP_NFS_SERVER="${2:-}"
      shift 2
      ;;
    --nfs-share-path)
      NFS_SHARE_PATH="${2:-}"
      shift 2
      ;;
    --nfs-allowed-subnet)
      NFS_ALLOWED_SUBNET="${2:-}"
      shift 2
      ;;
    --apply-helm)
      APPLY_HELM="${2:-}"
      shift 2
      ;;
    --deploy-app-services)
      DEPLOY_APP_SERVICES="${2:-}"
      shift 2
      ;;
    --apply-production-ingress)
      APPLY_PRODUCTION_INGRESS="${2:-}"
      shift 2
      ;;
    --apply-cronjob)
      APPLY_CRONJOB="${2:-}"
      shift 2
      ;;
    --apply-argo-templates)
      APPLY_ARGO_TEMPLATES="${2:-}"
      shift 2
      ;;
    --service-mode)
      SERVICE_MODE="${2:-}"
      shift 2
      ;;
    --interactive)
      INTERACTIVE="true"
      shift 1
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1"
      usage
      exit 1
      ;;
  esac
done

if [[ ${ARG_COUNT} -eq 0 ]]; then
  INTERACTIVE="true"
fi

if [[ "${INTERACTIVE}" == "true" ]]; then
  while [[ -z "${TLS_SAN}" ]]; do
    read -r -p "Master TLS SAN (public IP/domain, required): " TLS_SAN
  done
elif [[ -z "${TLS_SAN}" ]]; then
  echo "Error: --tls-san is required."
  usage
  exit 1
fi

if [[ "${SERVICE_MODE}" != "clusterip" && "${SERVICE_MODE}" != "nodeport" ]]; then
  echo "Error: --service-mode must be clusterip or nodeport"
  exit 1
fi

echo "==> Updating system and installing dependencies"
sudo apt update
sudo apt upgrade -y
sudo apt install -y curl wget git nano vim net-tools nfs-common

echo "==> Setting timezone: ${TIMEZONE}"
sudo timedatectl set-timezone "${TIMEZONE}"

if [[ "${SETUP_NFS_SERVER}" == "true" ]]; then
  if [[ ! -f "${SCRIPT_DIR}/nfs-setup.sh" ]]; then
    echo "Error: nfs setup script not found at ${SCRIPT_DIR}/nfs-setup.sh"
    exit 1
  fi

  echo "==> Setting up NFS server on master"
  chmod +x "${SCRIPT_DIR}/nfs-setup.sh"
  bash "${SCRIPT_DIR}/nfs-setup.sh" "${NFS_SHARE_PATH}" "${NFS_ALLOWED_SUBNET}"
fi

echo "==> Writing kubelet config (maxPods=${MAX_PODS})"
sudo mkdir -p /etc/rancher/k3s
sudo tee /etc/rancher/k3s/kubelet.config >/dev/null <<EOF
apiVersion: kubelet.config.k8s.io/v1beta1
kind: KubeletConfiguration
maxPods: ${MAX_PODS}
EOF

echo "==> Installing K3s server"
curl -sfL https://get.k3s.io | INSTALL_K3S_EXEC="server \
  --flannel-backend=none \
  --disable-network-policy \
  --disable traefik \
  --kubelet-arg=config=/etc/rancher/k3s/kubelet.config \
  --write-kubeconfig-mode 644 \
  --tls-san=${TLS_SAN} \
  --node-taint node-role.kubernetes.io/control-plane=true:NoSchedule" sh -

echo "==> Waiting for k3s service"
sudo systemctl enable --now k3s
sudo systemctl is-active --quiet k3s

if [[ "${INSTALL_GVISOR}" == "true" ]]; then
  echo "==> Installing gVisor (runsc)"
  ARCH="$(uname -m)"
  URL="https://storage.googleapis.com/gvisor/releases/release/latest/${ARCH}"

  sudo curl -fsSL "${URL}/runsc" -o /usr/local/bin/runsc
  sudo curl -fsSL "${URL}/runsc.sha512" -o /tmp/runsc.sha512

  EXPECTED=$(cut -d ' ' -f1 /tmp/runsc.sha512)
  ACTUAL=$(sha512sum /usr/local/bin/runsc | cut -d ' ' -f1)

  sudo chmod +x /usr/local/bin/runsc
  
  if [[ "$EXPECTED" != "$ACTUAL" ]]; then
    echo "Checksum mismatch!"
    exit 1
  fi

  sudo curl -fsSL "${URL}/containerd-shim-runsc-v1" -o /usr/local/bin/containerd-shim-runsc-v1
  sudo chmod +x /usr/local/bin/containerd-shim-runsc-v1

  echo "==> Configuring containerd runtime for runsc"
  sudo mkdir -p /var/lib/rancher/k3s/agent/etc/containerd
  sudo tee /var/lib/rancher/k3s/agent/etc/containerd/config.toml.tmpl >/dev/null <<'EOF'
version = 2

[plugins."io.containerd.grpc.v1.cri".containerd]
  default_runtime_name = "runc"

[plugins."io.containerd.grpc.v1.cri".containerd.runtimes.runsc]
  runtime_type = "io.containerd.runsc.v1"
EOF

  echo "==> Restarting k3s to apply runsc runtime"
  sudo systemctl restart k3s
  sudo systemctl is-active --quiet k3s
fi

echo "==> Configuring kubectl for current user"
mkdir -p "$HOME/.kube"
sudo cp /etc/rancher/k3s/k3s.yaml "$HOME/.kube/config"
sudo chown "$(id -u):$(id -g)" "$HOME/.kube/config"

if ! grep -q '^export KUBECONFIG=~/.kube/config$' "$HOME/.bashrc"; then
  echo 'export KUBECONFIG=~/.kube/config' >> "$HOME/.bashrc"
fi
export KUBECONFIG="$HOME/.kube/config"

echo "==> Cluster nodes"
kubectl get nodes -o wide

if [[ "${INSTALL_CALICO}" == "true" ]]; then
  echo "==> Installing Calico"
  kubectl create -f https://raw.githubusercontent.com/projectcalico/calico/v3.27.0/manifests/tigera-operator.yaml || true
  kubectl create -f https://raw.githubusercontent.com/projectcalico/calico/v3.27.0/manifests/custom-resources.yaml || true
fi

if [[ "${APPLY_HELM}" == "true" ]]; then
  if [[ ! -d "${PROD_DIR}" ]]; then
    echo "Error: prod directory not found at ${PROD_DIR}"
    exit 1
  fi

  echo "==> Creating required namespace for Helm components"
  kubectl create namespace storage --dry-run=client -o yaml | kubectl apply -f -
  kubectl create namespace db --dry-run=client -o yaml | kubectl apply -f -

  if [[ ! -f "${MARIADB_AUTH_SECRET_FILE}" ]]; then
    echo "Error: MariaDB auth secret manifest not found at ${MARIADB_AUTH_SECRET_FILE}"
    echo "Please create/update this file before running Helm so MariaDB existingSecret can be resolved."
    exit 1
  fi

  echo "==> Applying MariaDB auth secret before Helm"
  kubectl apply -f "${MARIADB_AUTH_SECRET_FILE}"

  apply_storage_manifests

  echo "==> Installing Helm (if missing)"
  if ! command -v helm >/dev/null 2>&1; then
    curl https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash
  fi

  echo "==> Applying Helm stack via prod/helm.sh"
  (
    cd "${PROD_DIR}"
    chmod +x ./helm.sh
    bash ./helm.sh
  )

  echo "==> Applying Argo ServiceAccount"
  kubectl apply -f "${PROD_DIR}/sa/argo-workflow/argo-sa.yaml"
fi

if [[ "${DEPLOY_APP_SERVICES}" == "true" ]]; then
  if [[ ! -d "${PROD_DIR}" ]]; then
    echo "Error: prod directory not found at ${PROD_DIR}"
    exit 1
  fi

  echo "==> Creating required namespaces"
  kubectl create namespace app --dry-run=client -o yaml | kubectl apply -f -
  kubectl create namespace challenge --dry-run=client -o yaml | kubectl apply -f -
  kubectl create namespace db --dry-run=client -o yaml | kubectl apply -f -

  echo "==> Applying base classes, ConfigMaps and Secrets"
  kubectl apply -f "${PROD_DIR}/priority-classes.yaml"
  kubectl apply -f "${PROD_DIR}/runtime-class.yaml"
  kubectl apply -f "${PROD_DIR}/env/configmap/"
  kubectl apply -f "${PROD_DIR}/env/secret/"

  if [[ "${APPLY_HELM}" != "true" ]]; then
    apply_storage_manifests
  fi

  echo "==> Deploying app services"
  kubectl apply -f "${PROD_DIR}/app/admin-mvc/"
  kubectl apply -f "${PROD_DIR}/app/contestant-be/"
  kubectl apply -f "${PROD_DIR}/app/contestant-portal/"
  kubectl apply -f "${PROD_DIR}/app/deployment-center/"
  kubectl apply -f "${PROD_DIR}/app/deployment-listener/"
  kubectl apply -f "${PROD_DIR}/app/challenge-gateway/"
  kubectl apply -f "${PROD_DIR}/app/deployment-consumer/"

  echo "==> Applying app NetworkPolicy"
  kubectl apply -f "${PROD_DIR}/app/NetworkPolicy/"

  if [[ -f "${MARIADB_POST_INIT_GRANTS_SQL}" ]]; then
    echo "==> Waiting for admin-mvc deployment before applying post-init MariaDB grants"
    kubectl rollout status deployment/admin-mvc -n app --timeout=300s || true

    echo "==> Waiting for ctfd schema bootstrap"
    schema_ready="false"
    for _ in $(seq 1 30); do
      if kubectl -n db exec mariadb-0 -- bash -lc '/opt/bitnami/mariadb/bin/mariadb --ssl=0 -uroot -p"$(cat /opt/bitnami/mariadb/secrets/mariadb-root-password)" -Nse "SELECT 1 FROM information_schema.tables WHERE table_schema=\"ctfd\" AND table_name=\"users\" LIMIT 1;"' 2>/dev/null | grep -q '^1$'; then
        schema_ready="true"
        break
      fi
      sleep 10
    done

    if [[ "${schema_ready}" == "true" ]]; then
      echo "==> Applying least-privilege MariaDB grants"
      kubectl -n db exec -i mariadb-0 -- bash -lc '/opt/bitnami/mariadb/bin/mariadb --ssl=0 -uroot -p"$(cat /opt/bitnami/mariadb/secrets/mariadb-root-password)" ctfd' < "${MARIADB_POST_INIT_GRANTS_SQL}"
    else
      echo "Warning: ctfd schema not ready after timeout."
      echo "Run grants manually when admin bootstrap has completed:"
      echo "kubectl -n db exec -i mariadb-0 -- bash -lc '/opt/bitnami/mariadb/bin/mariadb --ssl=0 -uroot -p\"\$(cat /opt/bitnami/mariadb/secrets/mariadb-root-password)\" ctfd' < ${MARIADB_POST_INIT_GRANTS_SQL}"
    fi
  else
    echo "Warning: grants SQL file not found at ${MARIADB_POST_INIT_GRANTS_SQL}; skipping post-init grants."
  fi

  if [[ "${SERVICE_MODE}" == "clusterip" ]]; then
    echo "==> Applying ClusterIP service mode"
    kubectl delete -f "${PROD_DIR}/app/service-nodeport.yaml" --ignore-not-found
    kubectl apply -f "${PROD_DIR}/app/service-clusterip.yaml"
  else
    echo "==> Applying NodePort service mode"
    kubectl delete -f "${PROD_DIR}/app/service-clusterip.yaml" --ignore-not-found
    kubectl apply -f "${PROD_DIR}/app/service-nodeport.yaml"
  fi
fi

if [[ "${APPLY_PRODUCTION_INGRESS}" == "true" ]]; then
  if [[ ! -d "${PROD_DIR}/ingress" || ! -d "${PROD_DIR}/cert-manager" ]]; then
    echo "Error: ingress/cert-manager manifests not found under ${PROD_DIR}"
    exit 1
  fi

  echo "==> Applying production ingress manifests"
  kubectl apply -f "${PROD_DIR}/cert-manager/cluster-issuer.yaml"
  kubectl apply -f "${PROD_DIR}/ingress/certificate/"
  kubectl apply -f "${PROD_DIR}/ingress/nginx/"
fi

if [[ "${APPLY_CRONJOB}" == "true" ]]; then
  if [[ ! -f "${PROD_DIR}/cron-job/delete-chal-job.yaml" ]]; then
    echo "Error: cronjob manifest not found at ${PROD_DIR}/cron-job/delete-chal-job.yaml"
    exit 1
  fi

  echo "==> Applying cleanup cronjob"
  kubectl apply -f "${PROD_DIR}/cron-job/delete-chal-job.yaml"
fi

if [[ "${APPLY_ARGO_TEMPLATES}" == "true" ]]; then
  if [[ ! -f "${PROD_DIR}/argo-workflows/start-chal-v2/start-chal-v2-template.yaml" || ! -f "${PROD_DIR}/argo-workflows/up-challenge/up-challenge-template.yaml" ]]; then
    echo "Error: Argo templates not found under ${PROD_DIR}/argo-workflows"
    exit 1
  fi

  echo "==> Applying Argo workflow templates"
  kubectl apply -f "${PROD_DIR}/argo-workflows/start-chal-v2/start-chal-v2-template.yaml"
  kubectl apply -f "${PROD_DIR}/argo-workflows/up-challenge/up-challenge-template.yaml"
fi

echo
echo "Master setup complete."
echo "Worker join token:"
sudo cat /var/lib/rancher/k3s/server/node-token
echo
echo "Use private IP of this master for workers (example: https://10.x.x.x:6443)."
