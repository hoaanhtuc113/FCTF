#!/usr/bin/env bash
set -euo pipefail

TIMEZONE="Asia/Ho_Chi_Minh"
MAX_PODS="110"
K3S_CLUSTER_CIDR="10.42.0.0/16"
K3S_SERVICE_CIDR="10.43.0.0/16"
# inputable
TLS_SAN="42.115.38.90"
INSTALL_CALICO="true"
CALICO_NETWORK_MODE="vxlan"
CALICO_VERSION="v3.27.0"
INSTALL_GVISOR="true"
APPLY_HELM="true"
DEPLOY_APP_SERVICES="true"
APPLY_PRODUCTION_INGRESS="true"
APPLY_CRONJOB="true"
APPLY_ARGO_TEMPLATES="true"
SERVICE_MODE="clusterip"
SETUP_NFS_SERVER="true"
NFS_SHARE_PATH="/srv/nfs/share"
# inputable
NFS_ALLOWED_SUBNET="10.13.2.0/24"
INTERACTIVE="true"
ARG_COUNT=$#
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROD_DIR="${SCRIPT_DIR}/prod"
MARIADB_AUTH_SECRET_FILE="${PROD_DIR}/env/secret/mariadb-auth-secret.yaml"
MARIADB_POST_INIT_GRANTS_SQL="${PROD_DIR}/helm/db/mariadb/least-privilege-service-accounts.sql"

normalize_nfs_allowed_subnet() {
  local raw="$1"
  raw="${raw//,/ }"
  echo "${raw}" | xargs
}

is_valid_ipv4() {
  local ip="$1"
  local IFS='.'
  local -a octets
  read -r -a octets <<< "${ip}"
  if [[ ${#octets[@]} -ne 4 ]]; then
    return 1
  fi

  local o
  for o in "${octets[@]}"; do
    [[ "${o}" =~ ^[0-9]{1,3}$ ]] || return 1
    (( o >= 0 && o <= 255 )) || return 1
  done
  return 0
}

is_valid_nfs_client_token() {
  local token="$1"
  local ip mask

  if [[ "${token}" == "*" ]]; then
    return 0
  fi

  if [[ "${token}" == */* ]]; then
    ip="${token%/*}"
    mask="${token#*/}"
    is_valid_ipv4 "${ip}" || return 1
    [[ "${mask}" =~ ^[0-9]{1,2}$ ]] || return 1
    (( mask >= 0 && mask <= 32 )) || return 1
    return 0
  fi

  is_valid_ipv4 "${token}"
}

is_valid_nfs_allowed_subnet() {
  local raw="$1"
  local normalized token
  normalized="$(normalize_nfs_allowed_subnet "${raw}")"

  [[ -n "${normalized}" ]] || return 1

  if [[ "${normalized}" == "*" ]]; then
    return 0
  fi

  for token in ${normalized}; do
    if [[ "${token}" == "*" ]]; then
      return 1
    fi
    is_valid_nfs_client_token "${token}" || return 1
  done

  return 0
}

is_valid_dns_name() {
  local host="$1"
  local label

  [[ ${#host} -le 253 ]] || return 1
  [[ "$host" != .* && "$host" != *. ]] || return 1

  IFS='.' read -r -a labels <<< "$host"
  [[ ${#labels[@]} -ge 1 ]] || return 1

  for label in "${labels[@]}"; do
    [[ -n "$label" ]] || return 1
    [[ ${#label} -le 63 ]] || return 1
    [[ "$label" =~ ^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?$ ]] || return 1
  done

  return 0
}

is_valid_tls_san() {
  local value="$1"

  [[ -n "$value" ]] || return 1
  [[ "$value" != *[[:space:]]* ]] || return 1
  [[ "$value" != *://* ]] || return 1
  [[ "$value" != */* ]] || return 1
  [[ "$value" != *:* ]] || return 1

  is_valid_ipv4 "$value" && return 0
  is_valid_dns_name "$value" && return 0

  return 1
}


usage() {
  cat <<EOF
Usage:
  $0 --tls-san <master-public-ip-or-domain> [--timezone <tz>] [--max-pods <n>] [--cluster-cidr <cidr>] [--service-cidr <cidr>] [--install-calico true|false] [--calico-network-mode l2|vxlan] [--install-gvisor true|false] [--setup-nfs-server true|false] [--nfs-share-path <path>] [--nfs-allowed-subnet "<client1 client2>|<client1,client2>|*"] [--apply-helm true|false] [--deploy-app-services true|false] [--apply-production-ingress true|false] [--apply-cronjob true|false] [--apply-argo-templates true|false] [--service-mode clusterip|nodeport] [--interactive]

Examples:
  $0 --tls-san 34.124.131.240
  $0 --tls-san k8s.example.com --max-pods 250 --cluster-cidr 10.42.0.0/16 --service-cidr 10.43.0.0/16 --install-calico true --calico-network-mode vxlan
  $0 --tls-san 34.124.131.240 --setup-nfs-server true --nfs-allowed-subnet 10.148.0.0/24
  $0 --tls-san 34.124.131.240 --install-gvisor true --apply-helm true --deploy-app-services true --apply-production-ingress true --apply-cronjob true --apply-argo-templates true
  $0 --interactive
EOF
}

configure_k8s_kernel_prereqs() {
  echo "==> Loading kernel modules required by Kubernetes"
  sudo modprobe br_netfilter
  sudo modprobe overlay

  echo "==> Persisting kernel modules across reboot"
  sudo tee /etc/modules-load.d/k8s.conf >/dev/null <<EOF
overlay
br_netfilter
EOF

  echo "==> Writing sysctl settings for Kubernetes networking"
  sudo tee /etc/sysctl.d/99-k8s.conf >/dev/null <<EOF
net.bridge.bridge-nf-call-iptables = 1
net.bridge.bridge-nf-call-ip6tables = 1
net.ipv4.ip_forward = 1
net.ipv4.conf.all.rp_filter = 0
net.ipv4.conf.default.rp_filter = 0
EOF

  sudo sysctl --system >/dev/null

}

disable_swap_for_k8s() {
  echo "==> Disabling swap"
  sudo swapoff -a
  sudo sed -i '/^[^#].*[[:space:]]swap[[:space:]]/ s/^/#/' /etc/fstab

  if sudo swapon --summary | grep -q .; then
    echo "Error: swap is still active after swapoff -a"
    exit 1
  fi
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
    --cluster-cidr)
      K3S_CLUSTER_CIDR="${2:-}"
      shift 2
      ;;
    --service-cidr)
      K3S_SERVICE_CIDR="${2:-}"
      shift 2
      ;;
    --install-calico)
      INSTALL_CALICO="${2:-}"
      shift 2
      ;;
    --calico-network-mode)
      CALICO_NETWORK_MODE="${2:-}"
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
  while true; do
    read -r -p "Master TLS SAN (public IP/domain, required): " TLS_SAN
    if is_valid_tls_san "${TLS_SAN}"; then
      break
    fi
    echo "Invalid TLS_SAN format. Use IPv4 or domain only (no scheme, port, or path)."
  done

  if [[ "${SETUP_NFS_SERVER}" == "true" ]]; then
    while true; do
      read -r -p "NFS allowed subnet/client list (IPv4/CIDR, comma/space list, or * for all). Examples: '*' or '10.148.0.0/24' or '10.148.0.0/24 10.149.0.0/24': " NFS_ALLOWED_SUBNET
      NFS_ALLOWED_SUBNET="$(normalize_nfs_allowed_subnet "${NFS_ALLOWED_SUBNET}")"
      if is_valid_nfs_allowed_subnet "${NFS_ALLOWED_SUBNET}"; then
        break
      fi
      echo "Invalid NFS_ALLOWED_SUBNET format."
    done
  fi
elif [[ -z "${TLS_SAN}" ]]; then
  echo "Error: --tls-san is required."
  usage
  exit 1
fi

if ! is_valid_tls_san "${TLS_SAN}"; then
  echo "Error: --tls-san has invalid format: ${TLS_SAN}"
  echo "Supported: IPv4 or domain only (example: 34.124.131.240 or k8s.example.com)"
  exit 1
fi

if [[ "${SETUP_NFS_SERVER}" == "true" && -z "${NFS_ALLOWED_SUBNET}" ]]; then
  NFS_ALLOWED_SUBNET="*"
fi

if [[ "${SETUP_NFS_SERVER}" == "true" ]]; then
  NFS_ALLOWED_SUBNET="$(normalize_nfs_allowed_subnet "${NFS_ALLOWED_SUBNET}")"
  if ! is_valid_nfs_allowed_subnet "${NFS_ALLOWED_SUBNET}"; then
    echo "Error: --nfs-allowed-subnet has invalid format: ${NFS_ALLOWED_SUBNET}"
    echo "Supported: * or IPv4/CIDR list (space/comma separated), e.g. 10.148.0.0/24,10.149.0.0/24"
    exit 1
  fi
fi

if [[ "${SERVICE_MODE}" != "clusterip" && "${SERVICE_MODE}" != "nodeport" ]]; then
  echo "Error: --service-mode must be clusterip or nodeport"
  exit 1
fi

if [[ "${CALICO_NETWORK_MODE}" != "l2" && "${CALICO_NETWORK_MODE}" != "vxlan" ]]; then
  echo "Error: --calico-network-mode must be l2 or vxlan"
  exit 1
fi

echo "==> Updating system and installing dependencies"
sudo apt update
sudo apt upgrade -y
sudo apt install -y curl wget git nano vim net-tools nfs-common

echo "==> Setting timezone: ${TIMEZONE}"
sudo timedatectl set-timezone "${TIMEZONE}"

configure_k8s_kernel_prereqs
disable_swap_for_k8s

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
curl -sfL https://get.k3s.io | K3S_NODE_NAME=server-1-master INSTALL_K3S_EXEC="server \
  --flannel-backend=none \
  --cluster-cidr=${K3S_CLUSTER_CIDR} \
  --service-cidr=${K3S_SERVICE_CIDR} \
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

  sudo apt-get update && \
  sudo apt-get install -y \
      apt-transport-https \
      ca-certificates \
      curl \
      gnupg

  curl -fsSL https://gvisor.dev/archive.key | sudo gpg --dearmor -o /usr/share/keyrings/gvisor-archive-keyring.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/gvisor-archive-keyring.gpg] https://storage.googleapis.com/gvisor/releases release main" | sudo tee /etc/apt/sources.list.d/gvisor.list > /dev/null

  sudo apt-get update && sudo apt-get install -y runsc  

  echo "==> Configuring containerd runtime for runsc (preserve k3s base template)"

  sudo mkdir -p /var/lib/rancher/k3s/agent/etc/containerd

  sudo tee /var/lib/rancher/k3s/agent/etc/containerd/config.toml.tmpl > /dev/null <<'EOF'
{{ template "base" . }}

[plugins."io.containerd.grpc.v1.cri".containerd.runtimes.runsc]
  runtime_type = "io.containerd.runsc.v1"

[plugins."io.containerd.grpc.v1.cri".containerd.runtimes.runsc.options]
  BinaryName = "/usr/bin/runsc"
  SystemdCgroup = true
EOF

  echo "==> Restarting k3s to apply runsc runtime"
  sudo systemctl stop k3s
  sudo rm -f /var/lib/rancher/k3s/agent/etc/containerd/config.toml
  sudo systemctl start k3s
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
  echo "==> Installing Calico from official manifest (${CALICO_VERSION})"
  kubectl apply -f "https://raw.githubusercontent.com/projectcalico/calico/${CALICO_VERSION}/manifests/calico.yaml"

  echo "==> Adding tolerations for Calico components"
  CALICO_TOLERATIONS_PATCH="$(cat <<'EOF'
spec:
  template:
    spec:
      tolerations:
      - key: node-role.kubernetes.io/control-plane
        operator: Exists
        effect: NoSchedule
EOF
)"
  kubectl -n kube-system patch daemonset/calico-node --type strategic --patch "${CALICO_TOLERATIONS_PATCH}"
  kubectl -n kube-system patch deployment/calico-kube-controllers --type strategic --patch "${CALICO_TOLERATIONS_PATCH}"

  echo "==> Aligning Calico IP pool with K3s cluster CIDR (${K3S_CLUSTER_CIDR})"
  if [[ "${CALICO_NETWORK_MODE}" == "l2" ]]; then
    kubectl -n kube-system set env daemonset/calico-node \
      CALICO_IPV4POOL_CIDR="${K3S_CLUSTER_CIDR}" \
      CALICO_IPV4POOL_VXLAN="Never" \
      CALICO_IPV4POOL_IPIP="Never"
  else
    kubectl -n kube-system set env daemonset/calico-node \
      CALICO_IPV4POOL_CIDR="${K3S_CLUSTER_CIDR}" \
      CALICO_IPV4POOL_VXLAN="Always" \
      CALICO_IPV4POOL_IPIP="Never"
  fi

  echo "==> Waiting for Calico components to be ready"
  kubectl -n kube-system rollout status daemonset/calico-node --timeout=300s
  kubectl -n kube-system rollout status deployment/calico-kube-controllers --timeout=300s

  echo "==> Verifying CoreDNS pod network is in pod CIDR"
  EXPECTED_POD_IP_PREFIX="$(echo "${K3S_CLUSTER_CIDR}" | cut -d'/' -f1 | awk -F. '{print $1"."$2"."}')"
  CORE_DNS_IP="$(kubectl -n kube-system get pod -l k8s-app=kube-dns -o jsonpath='{.items[0].status.podIP}' 2>/dev/null || true)"

  if [[ -n "${CORE_DNS_IP}" && "${CORE_DNS_IP}" != ${EXPECTED_POD_IP_PREFIX}* ]]; then
    echo "Error: CoreDNS pod IP ${CORE_DNS_IP} is outside expected pod CIDR ${K3S_CLUSTER_CIDR}."
    echo "Hint: if this node was reused, run uninstall/cleanup before reinstalling cluster."
    exit 1
  fi
fi

kubectl apply -f "${PROD_DIR}/runtime-class.yaml"

echo
echo "Master setup complete."
echo "Worker join token:"
sudo cat /var/lib/rancher/k3s/server/node-token
echo
echo "Use private IP of this master for workers (example: https://10.x.x.x:6443)."
