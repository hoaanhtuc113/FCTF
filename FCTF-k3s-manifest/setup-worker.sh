#!/usr/bin/env bash
set -euo pipefail

TIMEZONE="Asia/Ho_Chi_Minh"
MAX_PODS="110"
MASTER_URL=""
NODE_TOKEN=""
INSTALL_GVISOR="true"
INTERACTIVE="true"
ARG_COUNT=$#

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
  $0 --master-url <https://master-private-ip:6443> --token <node-token> [--timezone <tz>] [--max-pods <n>] [--install-gvisor true|false] [--interactive]

Example:
  $0 --master-url https://10.148.0.32:6443 --token K10xxxx::server:yyyy
  $0 --master-url https://10.148.0.32:6443 --token K10xxxx::server:yyyy --install-gvisor true
  $0 --interactive
EOF
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
  install_gvisor_production

  echo "==> Configuring containerd runtime for runsc (preserve k3s base template)"
  sudo mkdir -p /var/lib/rancher/k3s/agent/etc/containerd
  sudo tee /var/lib/rancher/k3s/agent/etc/containerd/config.toml.tmpl > /dev/null <<'EOF'
  version = 2

  [plugins."io.containerd.grpc.v1.cri".containerd]
    default_runtime_name = "runc"

  [plugins."io.containerd.grpc.v1.cri".containerd.runtimes.runsc]
    runtime_type = "io.containerd.runsc.v1"
EOF

  echo "==> Restarting k3s-agent to apply runsc runtime"
  sudo systemctl restart k3s-agent
  sudo systemctl is-active --quiet k3s-agent
fi

echo "Worker setup complete. Verify from master with: kubectl get nodes -o wide"
