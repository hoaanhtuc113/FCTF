#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
THIS_SCRIPT="${SCRIPT_DIR}/$(basename "${BASH_SOURCE[0]}")"
DOMAINS_FILE="${ROOT_DIR}/.fctf-domains"

TOKENS=(
  "MASTER_NODE_PRIVATE_IP"
  "RABBITMQ_DOMAIN"
  "GRAFANA_DOMAIN"
  "CONTESTANT_DOMAIN"
  "ADMIN_DOMAIN"
  "ARGO_DOMAIN"
  "CONTESTANT_API_DOMAIN"
  "REGISTRY_DOMAIN"
  "RANCHER_DOMAIN"
  "GATEWAY_DOMAIN"
)

EXCLUDE_DIRS=(
  ".git"
  "node_modules"
  "bin"
  "obj"
  "dist"
  "build"
  ".next"
  ".venv"
  "venv"
  "__pycache__"
)

trim_whitespace() {
  local value="$1"
  value="$(echo "${value}" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
  echo "${value}"
}

escape_for_sed_replacement() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//&/\\&}"
  value="${value//|/\\|}"
  echo "${value}"
}

prompt_value() {
  local token_name="$1"
  local default_value="${2:-}"
  local input=""

  while [[ -z "${input}" ]]; do
    if [[ -n "${default_value}" ]]; then
      read -r -p "Enter value for ${token_name} [${default_value}]: " input
      input="$(trim_whitespace "${input}")"
      if [[ -z "${input}" ]]; then
        input="${default_value}"
      fi
    else
      read -r -p "Enter value for ${token_name}: " input
      input="$(trim_whitespace "${input}")"
    fi

    if [[ -z "${input}" ]]; then
      echo "Value for ${token_name} cannot be empty."
    fi
  done

  echo "${input}"
}

# This script rewrites tracked files in place, so its work is a set of working
# tree changes that any git pull, reset or fresh clone throws away - and then
# every value has to be typed again from memory. That is not just tedious:
# MASTER_NODE_PRIVATE_IP ends up in each PV's nfs.server, which is immutable
# once the PV exists, so a value recalled slightly wrong is unrecoverable
# without deleting storage. Remembering the answers outside the working tree
# turns the re-run into pressing Enter ten times. The file holds domains and a
# private IP, no credentials, but it is gitignored: it describes one specific
# deployment and must not follow the repo to another.
load_saved_values() {
  local key value token

  [[ -f "${DOMAINS_FILE}" ]] || return 0

  while IFS='=' read -r key value; do
    key="$(trim_whitespace "${key}")"
    [[ -z "${key}" || "${key}" == \#* ]] && continue

    for token in "${TOKENS[@]}"; do
      if [[ "${key}" == "${token}" ]]; then
        SAVED["${token}"]="$(trim_whitespace "${value}")"
        # Counted separately: with `set -u`, measuring an associative array
        # that never got an element is itself an unbound-variable error.
        SAVED_COUNT=$((SAVED_COUNT + 1))
        break
      fi
    done
  done < "${DOMAINS_FILE}"
}

save_values() {
  local token

  {
    echo "# Written by configure-domains.sh - answers from the last run."
    echo "# Reused as defaults on the next run; delete a line to be asked again."
    for token in "${TOKENS[@]}"; do
      printf '%s=%s\n' "${token}" "${REPLACEMENTS[${token}]}"
    done
  } > "${DOMAINS_FILE}"

  chmod 600 "${DOMAINS_FILE}" 2>/dev/null || true
  echo "Saved these answers to ${DOMAINS_FILE} for the next run."
}

build_grep_args() {
  local grep_args=()
  local token_name=""
  local dir_name=""

  for dir_name in "${EXCLUDE_DIRS[@]}"; do
    grep_args+=("--exclude-dir=${dir_name}")
  done

  for token_name in "${TOKENS[@]}"; do
    grep_args+=("-e" "<${token_name}>")
  done

  printf '%s\n' "${grep_args[@]}"
}

if ! command -v grep >/dev/null 2>&1; then
  echo "Error: grep is required but not found."
  exit 1
fi

if ! command -v sed >/dev/null 2>&1; then
  echo "Error: sed is required but not found."
  exit 1
fi

declare -A REPLACEMENTS
declare -A SAVED
SAVED_COUNT=0

load_saved_values

echo "=============================================="
echo " FCTF Domain/IP Placeholder Configuration"
echo " Root directory: ${ROOT_DIR}"
echo "=============================================="
echo

if [[ "${SAVED_COUNT}" -gt 0 ]]; then
  echo "Reusing the answers from ${DOMAINS_FILE} as defaults."
  echo "Press Enter to keep the value shown in brackets."
  echo "On a cluster that already exists, keep MASTER_NODE_PRIVATE_IP exactly as it is:"
  echo "it is the nfs.server of every PV, which cannot be changed after the PV exists."
  echo
fi

for token in "${TOKENS[@]}"; do
  REPLACEMENTS["${token}"]="$(prompt_value "${token}" "${SAVED[${token}]:-}")"
done

echo
echo "Please confirm the replacement values:"
for token in "${TOKENS[@]}"; do
  echo "- <${token}> => ${REPLACEMENTS[${token}]}"
done

echo
read -r -p "Proceed with replacement in entire project? (y/N): " confirm
confirm="$(trim_whitespace "${confirm}")"
if [[ "${confirm}" != "y" && "${confirm}" != "Y" ]]; then
  echo "Cancelled. No files were changed."
  exit 0
fi

# Before the substitution rather than after: if the rewrite goes wrong halfway,
# the answers are the part worth keeping - the file edits can be undone with git.
save_values

grep_args=()
while IFS= read -r line; do
  grep_args+=("${line}")
done < <(build_grep_args)

mapfile -t target_files < <(grep -RIl "${grep_args[@]}" "${ROOT_DIR}" || true)

filtered_files=()
for file_path in "${target_files[@]}"; do
  if [[ "${file_path}" == "${THIS_SCRIPT}" ]]; then
    continue
  fi
  filtered_files+=("${file_path}")
done

if [[ ${#filtered_files[@]} -eq 0 ]]; then
  echo "No placeholders found. Nothing to replace."
  exit 0
fi

for file_path in "${filtered_files[@]}"; do
  for token in "${TOKENS[@]}"; do
    replacement_value="$(escape_for_sed_replacement "${REPLACEMENTS[${token}]}")"
    sed -i "s|<${token}>|${replacement_value}|g" "${file_path}"
  done
done

mapfile -t remaining_files < <(grep -RIl "${grep_args[@]}" "${ROOT_DIR}" || true)

remaining_filtered=()
for file_path in "${remaining_files[@]}"; do
  if [[ "${file_path}" == "${THIS_SCRIPT}" ]]; then
    continue
  fi
  remaining_filtered+=("${file_path}")
done

echo
if [[ ${#remaining_filtered[@]} -eq 0 ]]; then
  echo "Done. Updated ${#filtered_files[@]} file(s). No placeholders remain."
else
  echo "Done with warnings. Updated ${#filtered_files[@]} file(s)."
  echo "Some placeholders are still present in:"
  for file_path in "${remaining_filtered[@]}"; do
    echo "- ${file_path}"
  done
fi
