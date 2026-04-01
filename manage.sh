#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
K3S_DIR="${ROOT_DIR}/FCTF-k3s-manifest"

SETUP_MASTER_SH="${K3S_DIR}/setup-master.sh"
SETUP_WORKER_SH="${K3S_DIR}/setup-worker.sh"
APPLY_FCTF_SH="${K3S_DIR}/apply-fctf.sh"
SETUP_HARBOR_SH="${K3S_DIR}/setup-harbor.sh"
CICD_SETUP_SH="${K3S_DIR}/cicd-setup.sh"
GET_ARGO_TOKEN_SH="${K3S_DIR}/prod/sa/argo-workflow/get-token.sh"
UNINSTALL_MASTER_SH="${K3S_DIR}/uninstall/uninstall.sh"
UNINSTALL_WORKER_SH="${K3S_DIR}/uninstall/uninstall-worker.sh"

require_script() {
	local script_path="$1"
	if [[ ! -f "${script_path}" ]]; then
		echo "Error: script not found: ${script_path}"
		exit 1
	fi
}

run_script() {
	local script_path="$1"
	require_script "${script_path}"
	chmod +x "${script_path}" || true
	bash "${script_path}"
}

show_menu() {
	echo
	echo "================ FCTF Manager ================"
	echo "1) Setup master"
	echo "2) Setup worker"
	echo "3) Install FCTF"
	echo "4) Setup harbor"
	echo "5) Setup CI/CD"
	echo "6) Get Argo token"
	echo "7) Uninstall"
	echo "0) Exit"
	echo "============================================="
}

show_uninstall_menu() {
	echo
	echo "-------------- Uninstall --------------"
	echo "1) Uninstall worker"
	echo "2) Uninstall master"
	echo "0) Back"
	echo "---------------------------------------"
}

uninstall_worker() {
	echo "==> Running uninstall-worker.sh"
	run_script "${UNINSTALL_WORKER_SH}"
}

uninstall_master() {
	echo "==> Running uninstall.sh"
	run_script "${UNINSTALL_MASTER_SH}"
}

while true; do
	show_menu
	read -r -p "Select an option: " choice

	case "${choice}" in
		1)
			echo "==> Running setup-master.sh"
			run_script "${SETUP_MASTER_SH}"
			;;
		2)
			echo "==> Running setup-worker.sh"
			run_script "${SETUP_WORKER_SH}"
			;;
		3)
			echo "==> Running apply-fctf.sh"
			run_script "${APPLY_FCTF_SH}"
			;;
		4)
			echo "==> Running setup-harbor.sh"
			run_script "${SETUP_HARBOR_SH}"
			;;
		5)
			echo "==> Running cicd-setup.sh"
			run_script "${CICD_SETUP_SH}"
			;;
		6)
			echo "==> Running get-token.sh"
			run_script "${GET_ARGO_TOKEN_SH}"
			;;
		7)
			while true; do
				show_uninstall_menu
				read -r -p "Select uninstall option: " uninstall_choice

				case "${uninstall_choice}" in
					1)
						echo "==> Uninstall worker"
						uninstall_worker
						;;
					2)
						echo "==> Uninstall master"
						uninstall_master
						;;
					0)
						break
						;;
					*)
						echo "Invalid uninstall option. Please choose 0-2."
						;;
				esac
			done
			;;
		0)
			echo "Bye."
			exit 0
			;;
		*)
			echo "Invalid option. Please choose 0-7."
			;;
	esac
done
