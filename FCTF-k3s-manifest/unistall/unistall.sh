#!/usr/bin/env bash

set -u

# ============================================================
# FCTF uninstall script (reverse steps from README deploy flow)
# Usage:
#   bash unistall/unistall.sh [--remove-nfs] [--remove-k3s] [--yes]
#
# Default:
#   - remove app manifests/resources
#   - uninstall helm releases
#   - delete project namespaces
#   - keep k3s and host NFS packages/files
#
# Optional:
#   --remove-nfs : run clean-nfs.sh + purge nfs packages
#   --remove-k3s : run k3s uninstall script(s)
#   --yes        : skip confirmation prompt
# ============================================================

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REMOVE_NFS=false
REMOVE_K3S=false
AUTO_YES=false

for arg in "$@"; do
	case "$arg" in
		--remove-nfs) REMOVE_NFS=true ;;
		--remove-k3s) REMOVE_K3S=true ;;
		--yes) AUTO_YES=true ;;
		-h|--help)
			echo "Usage: bash unistall/unistall.sh [--remove-nfs] [--remove-k3s] [--yes]"
			exit 0
			;;
		*)
			echo "[WARN] Unknown option: $arg"
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

delete_manifest_if_exists() {
	local file="$1"
	if [ -f "$file" ]; then
		run kubectl delete -f "$file" --ignore-not-found
	else
		warn "Missing file, skip: $file"
	fi
}

delete_dir_manifests_if_exists() {
	local dir="$1"
	if [ -d "$dir" ]; then
		run kubectl delete -f "$dir" --ignore-not-found
	else
		warn "Missing dir, skip: $dir"
	fi
}

confirm

log "1) Delete app-layer manifests"
delete_manifest_if_exists "$ROOT_DIR/prod/cron-job/delete-chal-job.yaml"
delete_dir_manifests_if_exists "$ROOT_DIR/prod/argo-workflows/start-chal-v2"
delete_dir_manifests_if_exists "$ROOT_DIR/prod/argo-workflows/up-challenge"
delete_dir_manifests_if_exists "$ROOT_DIR/prod/ingress/nginx"
delete_dir_manifests_if_exists "$ROOT_DIR/prod/ingress/certificate"
delete_manifest_if_exists "$ROOT_DIR/prod/cert-manager/cluster-issuer.yaml"

delete_manifest_if_exists "$ROOT_DIR/prod/app/service-nodeport.yaml"
delete_manifest_if_exists "$ROOT_DIR/prod/app/service-clusterip.yaml"
delete_dir_manifests_if_exists "$ROOT_DIR/prod/app/NetworkPolicy"

delete_dir_manifests_if_exists "$ROOT_DIR/prod/app/deployment-consumer"
delete_dir_manifests_if_exists "$ROOT_DIR/prod/app/challenge-gateway"
delete_dir_manifests_if_exists "$ROOT_DIR/prod/app/deployment-listener"
delete_dir_manifests_if_exists "$ROOT_DIR/prod/app/deployment-center"
delete_dir_manifests_if_exists "$ROOT_DIR/prod/app/contestant-portal"
delete_dir_manifests_if_exists "$ROOT_DIR/prod/app/contestant-be"
delete_dir_manifests_if_exists "$ROOT_DIR/prod/app/admin-mvc"

delete_dir_manifests_if_exists "$ROOT_DIR/prod/env/configmap"
delete_dir_manifests_if_exists "$ROOT_DIR/prod/env/secret"
delete_manifest_if_exists "$ROOT_DIR/prod/runtime-class.yaml"
delete_manifest_if_exists "$ROOT_DIR/prod/priority-classes.yaml"
delete_manifest_if_exists "$ROOT_DIR/prod/sa/argo-workflow/argo-sa.yaml"

log "2) Delete NFS PV/PVC manifests"
delete_dir_manifests_if_exists "$ROOT_DIR/prod/storage/pvc"
delete_dir_manifests_if_exists "$ROOT_DIR/prod/storage/pv"

log "3) Uninstall Helm releases"
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
run helm uninstall linkerd-control-plane -n linkerd
run helm uninstall linkerd-crds -n linkerd

log "4) Delete namespaces"
for ns in app challenge db storage argo monitoring ctfd cert-manager ingress-nginx linkerd cattle-system kubernetes-dashboard; do
	run kubectl delete namespace "$ns" --ignore-not-found
done

log "5) Optional host cleanup"
if [ "$REMOVE_NFS" = true ]; then
	if [ -f "$ROOT_DIR/unistall/clean-nfs.sh" ]; then
		run_shell "chmod +x '$ROOT_DIR/unistall/clean-nfs.sh'"
		run_shell "sudo '$ROOT_DIR/unistall/clean-nfs.sh'"
	else
		warn "clean-nfs.sh not found, skip NFS data cleanup"
	fi

	run_shell "sudo apt remove --purge -y nfs-kernel-server nfs-common"
	run_shell "sudo apt autoremove -y"
fi

if [ "$REMOVE_K3S" = true ]; then
	run_shell "if [ -x /usr/local/bin/k3s-uninstall.sh ]; then sudo /usr/local/bin/k3s-uninstall.sh; else echo 'k3s-uninstall.sh not found'; fi"
	run_shell "if [ -x /usr/local/bin/k3s-agent-uninstall.sh ]; then sudo /usr/local/bin/k3s-agent-uninstall.sh; else echo 'k3s-agent-uninstall.sh not found'; fi"
fi

log "Done."
log "You can verify with: kubectl get pods -A ; kubectl get pvc -A ; kubectl get pv"
