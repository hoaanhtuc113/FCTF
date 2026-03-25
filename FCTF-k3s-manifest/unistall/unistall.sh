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

log "2) Delete namespaces (best-effort)"
for ns in app challenge db storage argo monitoring ctfd cert-manager ingress-nginx cattle-system kubernetes-dashboard; do
	run kubectl delete namespace "$ns" --ignore-not-found
done

log "3) Host cleanup (NFS + K3s)"
if [ -f "$(dirname "${BASH_SOURCE[0]}")/clean-nfs.sh" ]; then
	run_shell "chmod +x '$(dirname "${BASH_SOURCE[0]}")/clean-nfs.sh'"
	run_shell "sudo '$(dirname "${BASH_SOURCE[0]}")/clean-nfs.sh'"
else
	warn "clean-nfs.sh not found, skip NFS data cleanup"
fi

run_shell "sudo apt remove --purge -y nfs-kernel-server nfs-common"
run_shell "sudo apt autoremove -y"

run_shell "if [ -x /usr/local/bin/k3s-uninstall.sh ]; then sudo /usr/local/bin/k3s-uninstall.sh; else echo 'k3s-uninstall.sh not found'; fi"
run_shell "if [ -x /usr/local/bin/k3s-agent-uninstall.sh ]; then sudo /usr/local/bin/k3s-agent-uninstall.sh; else echo 'k3s-agent-uninstall.sh not found'; fi"

log "Done."
log "You can verify with: kubectl get pods -A ; kubectl get pvc -A ; kubectl get pv"
