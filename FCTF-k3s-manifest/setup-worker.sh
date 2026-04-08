#!/usr/bin/env bash
set -euo pipefail

TIMEZONE="Asia/Ho_Chi_Minh"
MAX_PODS="400"
# inputable
MASTER_URL="https://10.13.2.3:6443"
# inputable
NODE_TOKEN=""
INSTALL_GVISOR="true"
INTERACTIVE="true"
ARG_COUNT=$#

usage() {
  cat <<EOF
Usage:
  $0 --master-url <https://master-private-ip:6443> --token <node-token> [--timezone <tz>] [--max-pods <n>] [--install-gvisor true|false] [--interactive]

Example:
  $0 --master-url https://10.148.0.32:6443 --token K10xxxx::server:yyyy
  $0 --master-url https://10.148.0.32:6443 --token K10xxxx::server:yyyy --install-gvisor true
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
    --master-url)
      MASTER_URL="${2:-}"
      shift 2
      ;;
    --token)
      NODE_TOKEN="${2:-}"
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
    --install-gvisor)
      INSTALL_GVISOR="${2:-}"
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
  while [[ -z "${MASTER_URL}" ]]; do
    read -r -p "Master URL (required, ex: https://10.148.0.32:6443): " MASTER_URL
  done

  while [[ -z "${NODE_TOKEN}" ]]; do
    read -r -p "Node token (required): " NODE_TOKEN
  done
elif [[ -z "${MASTER_URL}" || -z "${NODE_TOKEN}" ]]; then
  echo "Error: --master-url and --token are required."
  usage
  exit 1
fi

echo "==> Updating system and installing dependencies"
sudo apt update
sudo apt upgrade -y
sudo apt install -y curl wget git nano vim net-tools nfs-common acl

echo "==> Setting timezone: ${TIMEZONE}"
sudo timedatectl set-timezone "${TIMEZONE}"

configure_k8s_kernel_prereqs
disable_swap_for_k8s

echo "==> Writing kubelet config (maxPods=${MAX_PODS})"
sudo mkdir -p /etc/rancher/k3s
sudo tee /etc/rancher/k3s/kubelet.config >/dev/null <<EOF
apiVersion: kubelet.config.k8s.io/v1beta1
kind: KubeletConfiguration
maxPods: ${MAX_PODS}
EOF

echo "==> Installing K3s agent and joining master"
curl -sfL https://get.k3s.io | K3S_URL="${MASTER_URL}" \
  K3S_TOKEN="${NODE_TOKEN}" \
  INSTALL_K3S_EXEC="agent --kubelet-arg=config=/etc/rancher/k3s/kubelet.config" sh -

echo "==> Waiting for k3s-agent service"
sudo systemctl enable --now k3s-agent
sudo systemctl is-active --quiet k3s-agent

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

  echo "==> Restarting k3s-agent to apply runsc runtime"
  sudo systemctl stop k3s-agent
  sudo rm -f /var/lib/rancher/k3s/agent/etc/containerd/config.toml
  sudo systemctl start k3s-agent
  sudo systemctl is-active --quiet k3s-agent
fi

echo "Worker setup complete. Verify from master with: kubectl get nodes -o wide"
