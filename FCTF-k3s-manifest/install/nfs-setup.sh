#!/usr/bin/env bash
# Setup NFS server and allow a subnet (or *) to access /srv/nfs/share

set -euo pipefail

SHARE_PATH="${1:-/srv/nfs/share}"
ALLOWED_SUBNET="${2:-*}"

normalize_clients() {
  local raw="$1"
  raw="${raw//,/ }"
  echo "${raw}" | xargs
}

build_export_clients() {
  local clients_raw="$1"
  local opts="rw,sync,no_subtree_check,root_squash,sec=sys"
  local clients
  clients="$(normalize_clients "${clients_raw}")"

  if [[ -z "${clients}" || "${clients}" == "*" ]]; then
    echo "*(${opts})"
    return
  fi

  local out=""
  local client
  for client in ${clients}; do
    out+=" ${client}(${opts})"
  done
  echo "${out# }"
}

echo "==> Installing nfs-kernel-server"
sudo apt update
sudo apt install -y nfs-kernel-server nfs-common acl

echo "==> Preparing share at ${SHARE_PATH}"
sudo mkdir -p "${SHARE_PATH}/challenges" "${SHARE_PATH}/start-challenge" "${SHARE_PATH}/file"

echo "==> Applying ACL model for service UIDs"
sudo chmod 770 "${SHARE_PATH}/challenges" "${SHARE_PATH}/start-challenge" "${SHARE_PATH}/file"

# admin-mvc: RWX on challenges + file
sudo setfacl -R -m u:1101:rwx "${SHARE_PATH}/challenges" "${SHARE_PATH}/file"
sudo setfacl -R -m d:u:1101:rwx "${SHARE_PATH}/challenges" "${SHARE_PATH}/file"

# contestant-be: read-only on file
sudo setfacl -R -m u:1102:rx "${SHARE_PATH}/file"
sudo setfacl -R -m d:u:1102:rx "${SHARE_PATH}/file"

# up-challenge-workflow: read-only on challenges
sudo setfacl -R -m u:1103:rx "${SHARE_PATH}/challenges"
sudo setfacl -R -m d:u:1103:rx "${SHARE_PATH}/challenges"

# Kaniko runs as root but may be squashed to anonymous UID/GID
sudo setfacl -R -m u:65534:rx,g:65534:rx "${SHARE_PATH}/challenges"
sudo setfacl -R -m d:u:65534:rx,d:g:65534:rx "${SHARE_PATH}/challenges"

# start-chal-v2-workflow: read-only on start-challenge
sudo setfacl -R -m u:1104:rx "${SHARE_PATH}/start-challenge"
sudo setfacl -R -m d:u:1104:rx "${SHARE_PATH}/start-challenge"

# filebrowser: full RWX on all folders
sudo setfacl -R -m u:1105:rwx "${SHARE_PATH}/challenges" "${SHARE_PATH}/start-challenge" "${SHARE_PATH}/file"
sudo setfacl -R -m d:u:1105:rwx "${SHARE_PATH}/challenges" "${SHARE_PATH}/start-challenge" "${SHARE_PATH}/file"

echo "==> Configuring /etc/exports for ${ALLOWED_SUBNET}"
EXPORT_CLIENTS="$(build_export_clients "${ALLOWED_SUBNET}")"
EXPORT_LINE="${SHARE_PATH} ${EXPORT_CLIENTS}"
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
  if [[ "$(normalize_clients "${ALLOWED_SUBNET}")" == "*" ]]; then
    echo "==> Allowing NFS service via ufw"
    sudo ufw allow nfs || true
  else
    echo "==> Allowing configured clients to access NFS via ufw"
    for client in $(normalize_clients "${ALLOWED_SUBNET}"); do
      sudo ufw allow from "${client}" to any port nfs || true
    done
  fi
  sudo ufw reload || true
else
  echo "ufw not installed; skipping firewall changes"
fi

echo "==> Effective ACL"
getfacl "${SHARE_PATH}" || true
getfacl "${SHARE_PATH}/file" || true
getfacl "${SHARE_PATH}/challenges" || true
getfacl "${SHARE_PATH}/start-challenge" || true

echo "==> Current exports:"
showmount -e localhost || true

echo "Done."
