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


install_gvisor_production() {
  local arch version release_base url tmpdir expected actual

  arch="$(uname -m)"
  case "${arch}" in
    x86_64|amd64)
      arch="x86_64"
      ;;
    aarch64|arm64)
      arch="aarch64"
      ;;
    *)
      echo "Error: Unsupported architecture for gVisor: ${arch}"
      exit 1
      ;;
  esac

  version="${GVISOR_VERSION:-latest}"
  release_base="${GVISOR_RELEASE_BASE:-https://storage.googleapis.com/gvisor/releases/release}"
  url="${release_base}/${version}/${arch}"

  tmpdir="$(mktemp -d)"
  trap 'rm -rf "${tmpdir}"' RETURN

  for bin in runsc containerd-shim-runsc-v1; do
    echo "==> Downloading ${bin} (version=${version}, arch=${arch})"
    curl --fail --silent --show-error --location \
      --retry 5 --retry-delay 2 --connect-timeout 10 \
      "${url}/${bin}" -o "${tmpdir}/${bin}"
    curl --fail --silent --show-error --location \
      --retry 5 --retry-delay 2 --connect-timeout 10 \
      "${url}/${bin}.sha512" -o "${tmpdir}/${bin}.sha512"

    expected="$(awk '{print $1}' "${tmpdir}/${bin}.sha512")"
    actual="$(sha512sum "${tmpdir}/${bin}" | awk '{print $1}')"
    if [[ -z "${expected}" || "${expected}" != "${actual}" ]]; then
      echo "Error: Checksum mismatch for ${bin}"
      exit 1
    fi
  done

  echo "==> Installing verified gVisor binaries"
  sudo install -o root -g root -m 0755 "${tmpdir}/runsc" /usr/local/bin/runsc
  sudo install -o root -g root -m 0755 "${tmpdir}/containerd-shim-runsc-v1" /usr/local/bin/containerd-shim-runsc-v1

  echo "==> gVisor installed: $(/usr/local/bin/runsc --version 2>/dev/null | head -n 1 || echo "unknown version")"
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
  echo "==> Installing gVisor (runsc) in production mode"
  install_gvisor_production

  echo "==> Configuring containerd runtime for runsc (preserve k3s base template)"
  sudo mkdir -p /var/lib/rancher/k3s/agent/etc/containerd
  for tmpl in config.toml.tmpl config-v3.toml.tmpl; do
    sudo tee "/var/lib/rancher/k3s/agent/etc/containerd/${tmpl}" >/dev/null <<'EOF'
{{ template "base" . }}

[plugins."io.containerd.grpc.v1.cri".containerd]
  default_runtime_name = "runc"

[plugins."io.containerd.grpc.v1.cri".containerd.runtimes.runsc]
  runtime_type = "io.containerd.runsc.v1"

[plugins."io.containerd.grpc.v1.cri".containerd.runtimes.runsc.options]
  BinaryName = "/usr/local/bin/runsc"
EOF
  done

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

echo
echo "Master setup complete."
echo "Worker join token:"
sudo cat /var/lib/rancher/k3s/server/node-token
echo
echo "Use private IP of this master for workers (example: https://10.x.x.x:6443)."
