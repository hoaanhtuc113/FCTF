#!/usr/bin/env bash

set -u

echo "[INFO] Cleanup NFS exports and data for FCTF"

if command -v exportfs >/dev/null 2>&1; then
	sudo exportfs -au || true
fi

if command -v systemctl >/dev/null 2>&1; then
	sudo systemctl stop nfs-kernel-server || true
	sudo systemctl disable nfs-kernel-server || true
fi

# Remove only FCTF export lines, avoid truncating unrelated exports
if [ -f /etc/exports ]; then
	sudo cp /etc/exports /etc/exports.bak.$(date +%Y%m%d%H%M%S)
	sudo sed -i '/\/srv\/nfs\/share/d' /etc/exports
fi

if [ -d /srv/nfs/share ]; then
	if command -v setfacl >/dev/null 2>&1; then
		sudo setfacl -R -b /srv/nfs/share || true
	fi
	sudo rm -rf /srv/nfs/share
fi

echo "[INFO] NFS cleanup completed"


sudo apt purge -y nfs-kernel-server nfs-common acl
sudo apt autoremove -y