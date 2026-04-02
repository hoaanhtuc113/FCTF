#!/usr/bin/env bash

set -u

# ============================================================
# FCTF uninstall script (reverse steps from README deploy flow)
# Usage:
#   bash unistall/unistall.sh [--yes]
#
# Behavior:
#   - uninstall helm releases (best-effort)
#   - delete project namespaces (best-effort)
#   - cleanup host NFS + purge nfs packages
#   - uninstall k3s / k3s-agent
#
# Option:
#   --yes        : skip confirmation prompt
# ============================================================

AUTO_YES=false

for arg in "$@"; do
	case "$arg" in
		--yes) AUTO_YES=true ;;
		-h|--help)
			echo "Usage: bash unistall/unistall.sh [--yes]"
			exit 0
			;;
		*)
			echo "[WARN] Unknown option: $arg"
			echo "Usage: bash unistall/unistall.sh [--yes]"
			exit 1
			;;
	esac
done

log() { echo "[INFO] $*"; }
warn() { echo "[WARN] $*"; }

run() {
	echo "+ $*"
	"$@" || warn "Command failed (ignored): $*"
}

run_shell() {
	echo "+ $*"
	bash -lc "$*" || warn "Command failed (ignored): $*"
}

confirm() {
	if [ "$AUTO_YES" = true ]; then
		return 0
	fi

	echo "This will uninstall FCTF resources from current kube-context:"
	run kubectl config current-context
	echo
	read -r -p "Continue? [y/N]: " ans
	case "$ans" in
		y|Y|yes|YES) return 0 ;;
		*)
			log "Cancelled."
			exit 0
			;;
	esac
}

confirm

log "1) Uninstall Helm releases (best-effort)"
run helm uninstall filebrowser -n storage
run helm uninstall argo-workflows -n argo
run helm uninstall prometheus -n monitoring
run helm uninstall loki-stack -n monitoring
run helm uninstall redis -n db
run helm uninstall mariadb -n db
run helm uninstall rabbitmq -n db
run helm uninstall cert-manager -n cert-manager
run helm uninstall ingress-nginx -n ingress-nginx
run helm uninstall rancher -n cattle-system
run helm uninstall harbor -n registry

# log "2) Delete namespaces (best-effort)"
# for ns in app challenge db storage argo monitoring ctfd cert-manager ingress-nginx cattle-system kubernetes-dashboard registry; do
# 	run kubectl delete namespace "$ns" --ignore-not-found --wait=true --timeout=120s
# done

log "2.1) Force Delete PVs to avoid hanging"
PV_NAMES=$(kubectl get pv -o jsonpath='{.items[*].metadata.name}' | tr ' ' '\n' | grep -E 'nfs-|pvc-')

if [ -n "$PV_NAMES" ]; then
    log "Patching finalizers for PVs..."
    echo "$PV_NAMES" | xargs -I {} kubectl patch pv {} -p '{"metadata":{"finalizers":null}}' --type merge
    
    log "Deleting PVs..."
    run kubectl delete pv $PV_NAMES --ignore-not-found --timeout=30s
fi

log "3) Host cleanup (NFS + K3s)"
if [ -f "$(dirname "${BASH_SOURCE[0]}")/clean-nfs.sh" ]; then
	run_shell "chmod +x '$(dirname "${BASH_SOURCE[0]}")/clean-nfs.sh'"
	run_shell "sudo '$(dirname "${BASH_SOURCE[0]}")/clean-nfs.sh'"
else
	warn "clean-nfs.sh not found, skip NFS data cleanup"
fi

run_shell "sudo apt remove --purge -y nfs-kernel-server nfs-common"
run_shell "sudo apt autoremove -y"

log "3.1) Stop K3s immediately"
run_shell "sudo systemctl stop k3s"
run_shell "sudo systemctl stop k3s-agent"

log "3.1.1) Prune Docker builder cache (if docker exists)"
run_shell "if command -v docker >/dev/null 2>&1; then sudo docker builder prune -a -f; else echo 'docker not found, skip'; fi"

log "3.1.2) Stop Docker service (if exists)"
run_shell "if systemctl list-unit-files | grep -q '^docker.service'; then sudo systemctl stop docker; sudo systemctl disable docker; else echo 'docker service not found, skip'; fi"

log "3.2) Stop and remove all running containers via CRI (containerd/K3s)"
run_shell "if command -v crictl >/dev/null 2>&1; then sudo crictl ps -aq | xargs -r sudo crictl stop; else echo 'crictl not found, skip'; fi"
run_shell "if command -v crictl >/dev/null 2>&1; then sudo crictl ps -aq | xargs -r sudo crictl rm; else echo 'crictl not found, skip'; fi"

log "3.3) Unmount kubelet/rancher mounts to avoid stuck PV/PVC"
run_shell "sudo mount | grep -E 'kubelet|rancher' | awk '{print \$3}' | sort -r | xargs -r sudo umount -l"

log "3.4) Remove gVisor binaries"
run_shell "sudo rm -f /usr/local/bin/runsc /usr/local/bin/containerd-shim-runsc-v1"
log "3.4.1) Remove gVisor apt repo and keyring"
run_shell "sudo rm -f /etc/apt/sources.list.d/gvisor.list"
run_shell "sudo rm -f /usr/share/keyrings/gvisor-archive-keyring.gpg"
run_shell "sudo apt-get remove -y runsc"
run_shell "sudo apt-get autoremove -y"

log "3.5) Remove virtual network interfaces (Calico/K3s)"
run_shell "sudo ip link delete cni0"
run_shell "sudo ip link delete flannel.1"
run_shell "sudo ip link delete tunl0"
run_shell "sudo ip link show | grep cali | awk '{print \$2}' | cut -d'@' -f1 | xargs -r -I {} sudo ip link delete {}"

log "3.6) Run K3s uninstall scripts"
run_shell "if [ -x /usr/local/bin/k3s-uninstall.sh ]; then sudo /usr/local/bin/k3s-uninstall.sh; else echo 'k3s-uninstall.sh not found'; fi"
run_shell "if [ -x /usr/local/bin/k3s-agent-uninstall.sh ]; then sudo /usr/local/bin/k3s-agent-uninstall.sh; else echo 'k3s-agent-uninstall.sh not found'; fi"

log "3.7) Uninstall Docker packages and data (if installed)"
run_shell "sudo apt-get remove --purge -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin docker-ce-rootless-extras || true"
run_shell "sudo apt-get autoremove -y"
run_shell "sudo rm -rf /var/lib/docker /var/lib/buildkit /etc/docker /run/docker /var/run/docker.sock"

log "4) Cleaning up Mount Points and Directories"
if mount | grep -qE '/var/lib/kubelet|/var/lib/rancher'; then
    log "Active mounts detected. Unmounting..."
    cat /proc/mounts | grep -E '/var/lib/kubelet|/var/lib/rancher' | awk '{print $2}' | sort -r | xargs -r sudo umount -l
fi

LEFTOVER_PATHS=(
	"/etc/rancher"
	"/var/lib/rancher"
	"/var/lib/kubelet"
	"/var/lib/cni"
	"/etc/cni"

	"/opt/cni"
	"/var/lib/containerd"
	"/run/containerd"

	"/run/k3s"

	"$HOME/.kube"
)

for p in "${LEFTOVER_PATHS[@]}"; do
	if [ -e "$p" ]; then
		warn "Found leftover path: $p"
		run_shell "sudo rm -rf '$p'"
	else
		log "Already clean: $p"
	fi
done

log "Done."
log "You can verify with: kubectl get pods -A ; kubectl get pvc -A ; kubectl get pv"
