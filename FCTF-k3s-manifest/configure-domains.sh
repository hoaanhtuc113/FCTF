#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
THIS_SCRIPT="${SCRIPT_DIR}/$(basename "${BASH_SOURCE[0]}")"

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
  local input=""

  while [[ -z "${input}" ]]; do
    read -r -p "Enter value for ${token_name}: " input
    input="$(trim_whitespace "${input}")"
    if [[ -z "${input}" ]]; then
      echo "Value for ${token_name} cannot be empty."
    fi
  done

  echo "${input}"
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

echo "=============================================="
echo " FCTF Domain/IP Placeholder Configuration"
echo " Root directory: ${ROOT_DIR}"
echo "=============================================="
echo

for token in "${TOKENS[@]}"; do
  REPLACEMENTS["${token}"]="$(prompt_value "${token}")"
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
