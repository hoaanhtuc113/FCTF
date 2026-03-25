#!/usr/bin/env bash
# Setup NFS server and allow a subnet (or *) to access /srv/nfs/share

set -euo pipefail

SHARE_PATH="${1:-/srv/nfs/share}"
ALLOWED_SUBNET="${2:-*}"

echo "==> Installing nfs-kernel-server"
sudo apt update
sudo apt install -y nfs-kernel-server

echo "==> Preparing share at ${SHARE_PATH}"
sudo mkdir -p "${SHARE_PATH}"
sudo chown nobody:nogroup "${SHARE_PATH}"
sudo chmod 0777 "${SHARE_PATH}"

echo "==> Configuring /etc/exports for ${ALLOWED_SUBNET}"
EXPORT_LINE="${SHARE_PATH} ${ALLOWED_SUBNET}(rw,sync,no_subtree_check,no_root_squash,insecure)"
if grep -qE "^${SHARE_PATH}\\s" /etc/exports; then
  sudo sed -i "s|^${SHARE_PATH} .*|${EXPORT_LINE}|" /etc/exports
else
  echo "${EXPORT_LINE}" | sudo tee -a /etc/exports >/dev/null
fi

echo "==> Reloading exports"
sudo exportfs -ra

if systemctl list-unit-files | grep -q '^nfs-kernel-server.service'; then
  NFS_SERVICE="nfs-kernel-server"
else
  NFS_SERVICE="nfs-server"
fi

echo "==> Enabling and starting ${NFS_SERVICE}"
sudo systemctl enable --now "${NFS_SERVICE}"

if command -v ufw >/dev/null 2>&1; then
  if [[ "${ALLOWED_SUBNET}" == "*" ]]; then
    echo "==> Allowing NFS service via ufw"
    sudo ufw allow nfs || true
  else
    echo "==> Allowing ${ALLOWED_SUBNET} to access NFS via ufw"
    sudo ufw allow from "${ALLOWED_SUBNET}" to any port nfs || true
  fi
  sudo ufw reload || true
else
  echo "ufw not installed; skipping firewall changes"
fi

echo "==> Current exports:"
showmount -e localhost || true

echo "Done."
