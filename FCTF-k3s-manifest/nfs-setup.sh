#!/usr/bin/env bash
# Setup NFS server and allow a subnet (default 10.184.0.0/24) to access /srv/nfs/share

set -euo pipefail

SHARE_PATH="${1:-/srv/nfs/share}"
ALLOWED_SUBNET="${2:-10.184.0.0/24}"

echo "==> Installing nfs-kernel-server"
sudo apt update
sudo apt install -y nfs-kernel-server

echo "==> Preparing share at ${SHARE_PATH}"
sudo mkdir -p "${SHARE_PATH}"
sudo chown nobody:nogroup "${SHARE_PATH}"

echo "==> Configuring /etc/exports for ${ALLOWED_SUBNET}"
EXPORT_LINE="${SHARE_PATH} ${ALLOWED_SUBNET}(rw,sync,no_subtree_check,no_root_squash)"
if grep -qE "^${SHARE_PATH}\\s" /etc/exports; then
  sudo sed -i "s|^${SHARE_PATH} .*|${EXPORT_LINE}|" /etc/exports
else
  echo "${EXPORT_LINE}" | sudo tee -a /etc/exports >/dev/null
fi

echo "==> Reloading exports"
sudo exportfs -ra

echo "==> Enabling and starting nfs-server"
sudo systemctl enable --now nfs-server

if command -v ufw >/dev/null 2>&1; then
  echo "==> Allowing ${ALLOWED_SUBNET} to access NFS via ufw"
  sudo ufw allow from "${ALLOWED_SUBNET}" to any port nfs || true
  sudo ufw reload || true
else
  echo "ufw not installed; skipping firewall changes"
fi

echo "==> Current exports:"
showmount -e localhost || true

echo "Done."
