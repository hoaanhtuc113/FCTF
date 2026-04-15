#!/usr/bin/env bash
set -euo pipefail

run_cmd() {
  echo "+ $*"
  "$@" || true
}

run_shell() {
  echo "+ $*"
  bash -lc "$*" || true
}

echo "Stopping k3s-agent service"
if systemctl list-units --full -all | grep -q "k3s-agent.service"; then
  run_cmd sudo systemctl stop k3s-agent
  run_cmd sudo systemctl disable k3s-agent
fi

echo "Stopping k3s service (safety)"
if systemctl list-units --full -all | grep -q "k3s.service"; then
  run_cmd sudo systemctl stop k3s
  run_cmd sudo systemctl disable k3s
fi

echo "Stopping and removing all CRI containers (containerd/K3s)"
run_shell "if command -v crictl >/dev/null 2>&1; then sudo crictl ps -aq | xargs -r sudo crictl stop; else echo 'crictl not found, skipping'; fi"
run_shell "if command -v crictl >/dev/null 2>&1; then sudo crictl ps -aq | xargs -r sudo crictl rm; else echo 'crictl not found, skipping'; fi"

echo "Unmounting kubelet/rancher mounts (if any)"
run_shell "sudo mount | grep -E 'kubelet|rancher' | awk '{print \$3}' | sort -r | xargs -r sudo umount -l"

echo "Running official uninstall script (if exists)"
if [[ -x /usr/local/bin/k3s-agent-uninstall.sh ]]; then
  run_cmd sudo /usr/local/bin/k3s-agent-uninstall.sh
else
  echo "k3s-agent uninstall script not found, skipping..."
fi

if [[ -x /usr/local/bin/k3s-uninstall.sh ]]; then
  echo "Running k3s server uninstall script (safety fallback)"
  run_cmd sudo /usr/local/bin/k3s-uninstall.sh
fi

echo "==> Removing K3s directories"
sudo rm -rf /var/lib/rancher/k3s
sudo rm -rf /var/lib/rancher
sudo rm -rf /etc/rancher/k3s
sudo rm -rf /etc/rancher
sudo rm -rf /run/k3s
sudo rm -rf /var/lib/kubelet
sudo rm -rf /var/lib/cni
sudo rm -rf /etc/cni
sudo rm -rf /opt/cni

echo "Removing systemd service file (if still exists)"
sudo rm -f /etc/systemd/system/k3s-agent.service
sudo rm -f /etc/systemd/system/k3s-agent.service.env
sudo rm -f /etc/systemd/system/k3s.service
sudo rm -f /etc/systemd/system/k3s.service.env
sudo systemctl daemon-reexec || true
sudo systemctl daemon-reload || true

echo "Cleaning up containerd remnants (if any)"
sudo rm -rf /var/lib/containerd || true

echo "Removing gVisor (if installed)"
sudo rm -f /usr/local/bin/runsc || true
sudo rm -f /usr/local/bin/containerd-shim-runsc-v1 || true
sudo rm -f /etc/apt/sources.list.d/gvisor.list || true
sudo rm -f /usr/share/keyrings/gvisor-archive-keyring.gpg || true
sudo apt-get remove -y runsc || true
sudo apt-get autoremove -y || true

echo "Removing virtual interfaces from Calico/K3s (if any)"
run_cmd sudo ip link delete cni0
run_cmd sudo ip link delete flannel.1
run_cmd sudo ip link delete tunl0
run_shell "sudo ip link show | grep cali | awk '{print \$2}' | cut -d'@' -f1 | xargs -r -I {} sudo ip link delete {}"

echo "Restarting networking (optional cleanup)"
if systemctl list-units --full -all | grep -q "systemd-networkd"; then
  sudo systemctl restart systemd-networkd || true
fi

if systemctl list-units --full -all | grep -q "networking.service"; then
  sudo systemctl restart networking || true
fi

echo "Cleanup completed successfully"