#!/usr/bin/env bash
# KYPO Cyber Range connection settings for this installation.
#
# These say which range the platform talks to and as what. They used to live in
# the `config` table, editable from Platform Settings, which put them within
# reach of anyone who could sign in with an admin session - and the base URL in
# particular is the host that receives a contestant's Keycloak access, refresh
# and id tokens in the redirect fragment. Setting it is therefore a deployment
# decision, so it is made here, by whoever installs the platform, and the pods
# read it from their environment.
#
# Two records, deliberately:
#   /etc/fctf/kypo.env         the source, so a reinstall reproduces the same
#                              settings without anyone having to remember them
#   Secret + ConfigMap in app  what the pods actually read
# --apply rewrites the second from the first, so the two cannot drift.
#
# admin-mvc and contestant-be read the same values under different variable
# names (KYPO_USERNAME vs KYPO_ADMIN_USER, and so on). Each answer below is
# written out under every name that needs it, so the two services cannot end up
# pointed at different ranges.
#
#   ./kypo-config.sh --configure   prompt, save, then apply and restart
#   ./kypo-config.sh --apply       apply the saved file to the cluster
#   ./kypo-config.sh --show        print what is saved (passwords masked)

set -euo pipefail

KYPO_ENV_FILE="${KYPO_ENV_FILE:-/etc/fctf/kypo.env}"
KYPO_NAMESPACE="${KYPO_NAMESPACE:-app}"
KYPO_CONFIGMAP="kypo-cm"
KYPO_SECRET="kypo-secret"

# One question per row: variable to store it under, prompt, default, secret?,
# and the environment variable names the services expect it under.
#
# Keep the two name lists in step with CTFd/constants/envvars.py and
# ContestantBE/Utils/ContestantBEConfigHelper.cs - a name dropped from one side
# silently falls back to that service's own default rather than failing.
KYPO_QUESTIONS=(
  "BASE_URL|KYPO base URL|https://vuontre.iahn.hanoi.vn|public|KYPO_BASE_URL"
  "KEYCLOAK_URL|Keycloak URL|https://vuontre.iahn.hanoi.vn/keycloak|public|KYPO_KEYCLOAK_URL"
  "REALM|Keycloak realm|CRCZP|public|KYPO_REALM"
  "CLIENT_ID|KYPO client id|CRCZP-Client|public|KYPO_CLIENT_ID"
  "VERIFY_SSL|Verify SSL (true/false)|false|public|KYPO_VERIFY_SSL"
  "CLIENT_SECRET|KYPO client secret (blank if the client is public)||secret|KYPO_CLIENT_SECRET"
  "API_USERNAME|KYPO API username|crczp-admin|secret|KYPO_USERNAME,KYPO_ADMIN_USER"
  "API_PASSWORD|KYPO API password||secret|KYPO_PASSWORD,KYPO_ADMIN_PASS"
  "KEYCLOAK_ADMIN_USERNAME|Keycloak admin username|admin|secret|KYPO_ADMIN_USERNAME,KYPO_KEYCLOAK_ADMIN_USER"
  "KEYCLOAK_ADMIN_PASSWORD|Keycloak admin password||secret|KYPO_ADMIN_PASSWORD,KYPO_KEYCLOAK_ADMIN_PASS"
)

# The services that read these. Restarted after an apply, because a Secret or
# ConfigMap consumed through envFrom is read once at container start - editing it
# under a running pod changes nothing until the pod is replaced.
KYPO_CONSUMERS=("admin-mvc" "contestant-be")

_field() { printf '%s' "$1" | cut -d'|' -f"$2"; }

# The default path is under /etc, but it is overridable and the caller may
# already own it, so escalate only when the filesystem actually refuses.
_sudo_prefix() {
  local target_dir="$1"
  local probe

  [[ "$(id -u)" -eq 0 ]] && return 0

  probe="${target_dir}"
  while [[ ! -e "${probe}" && "${probe}" != "/" && "${probe}" != "." ]]; do
    probe="$(dirname "${probe}")"
  done

  if [[ -w "${probe}" ]]; then
    return 0
  fi

  if ! command -v sudo >/dev/null 2>&1; then
    echo "Error: ${target_dir} is not writable and sudo is unavailable." >&2
    return 1
  fi

  printf 'sudo'
}

_read_saved() {
  local sudo_cmd
  [[ -f "${KYPO_ENV_FILE}" ]] || return 0

  sudo_cmd="$(_sudo_prefix "$(dirname "${KYPO_ENV_FILE}")")" || return 1
  # shellcheck disable=SC1090
  source <(${sudo_cmd} cat "${KYPO_ENV_FILE}")
}

kypo_configure() {
  local dir sudo_cmd tmp
  dir="$(dirname "${KYPO_ENV_FILE}")"
  sudo_cmd="$(_sudo_prefix "${dir}")" || return 1

  # Existing answers become the defaults, so rerunning to change one thing does
  # not mean retyping the rest - including the passwords.
  _read_saved || return 1

  echo
  echo "================ KYPO integration ================"
  echo "Press Enter to keep the value in brackets."
  echo

  local question key prompt fallback kind current answer
  for question in "${KYPO_QUESTIONS[@]}"; do
    key="$(_field "${question}" 1)"
    prompt="$(_field "${question}" 2)"
    fallback="$(_field "${question}" 3)"
    kind="$(_field "${question}" 4)"

    current="$(eval "printf '%s' \"\${KYPO_${key}:-}\"")"
    [[ -z "${current}" ]] && current="${fallback}"

    if [[ "${kind}" == "secret" && -n "${current}" ]]; then
      read -r -p "${prompt} [keep existing]: " answer
    else
      read -r -p "${prompt} [${current}]: " answer
    fi

    [[ -z "${answer}" ]] && answer="${current}"
    printf -v "KYPO_${key}" '%s' "${answer}"
  done

  case "$(printf '%s' "${KYPO_VERIFY_SSL}" | tr '[:upper:]' '[:lower:]')" in
    true|1|yes) KYPO_VERIFY_SSL="true" ;;
    *)          KYPO_VERIFY_SSL="false" ;;
  esac

  # Written via a temp file and moved into place, so an interrupted write cannot
  # leave a half-file that later sources as a set of empty credentials.
  tmp="$(mktemp)"
  chmod 600 "${tmp}"
  {
    echo "# FCTF KYPO integration settings - written by kypo-config.sh."
    echo "# Applied to the cluster as Secret/${KYPO_SECRET} and ConfigMap/${KYPO_CONFIGMAP}."
    for question in "${KYPO_QUESTIONS[@]}"; do
      key="$(_field "${question}" 1)"
      printf 'KYPO_%s=%s\n' "${key}" "$(eval "printf '%s' \"\${KYPO_${key}:-}\"")"
    done
  } > "${tmp}"

  ${sudo_cmd} mkdir -p "${dir}" || { echo "Error: cannot create ${dir}" >&2; return 1; }
  ${sudo_cmd} chmod 700 "${dir}" || { echo "Error: cannot chmod ${dir}" >&2; return 1; }
  ${sudo_cmd} cp "${tmp}" "${KYPO_ENV_FILE}" || { echo "Error: cannot write ${KYPO_ENV_FILE}" >&2; rm -f "${tmp}"; return 1; }
  ${sudo_cmd} chmod 600 "${KYPO_ENV_FILE}" || { echo "Error: cannot chmod ${KYPO_ENV_FILE}" >&2; rm -f "${tmp}"; return 1; }
  rm -f "${tmp}"

  echo
  echo "==> Saved to ${KYPO_ENV_FILE}"

  kypo_apply --restart
}

kypo_apply() {
  local restart="${1:-}"
  local question key kind names name value
  local -a cm_args=() secret_args=()

  if [[ ! -f "${KYPO_ENV_FILE}" ]]; then
    echo "No ${KYPO_ENV_FILE}; skipping KYPO configuration."
    echo "Run manage.sh option 11 to set it up."
    return 0
  fi

  _read_saved || return 1

  if ! kubectl get namespace "${KYPO_NAMESPACE}" >/dev/null 2>&1; then
    echo "Warning: namespace ${KYPO_NAMESPACE} not found; skipping KYPO apply."
    return 0
  fi

  for question in "${KYPO_QUESTIONS[@]}"; do
    key="$(_field "${question}" 1)"
    kind="$(_field "${question}" 4)"
    names="$(_field "${question}" 5)"
    value="$(eval "printf '%s' \"\${KYPO_${key}:-}\"")"

    # An empty answer is left out entirely rather than written as "". envFrom
    # would inject the empty string, and every reader treats empty as unset and
    # falls back - so writing it just adds a variable that means nothing.
    [[ -z "${value}" ]] && continue

    while IFS=',' read -r -d ',' name || [[ -n "${name}" ]]; do
      [[ -z "${name}" ]] && continue
      if [[ "${kind}" == "secret" ]]; then
        secret_args+=("--from-literal=${name}=${value}")
      else
        cm_args+=("--from-literal=${name}=${value}")
      fi
    done < <(printf '%s,' "${names}")
  done

  echo "==> Applying KYPO ConfigMap/${KYPO_CONFIGMAP} and Secret/${KYPO_SECRET} in ${KYPO_NAMESPACE}"

  kubectl create configmap "${KYPO_CONFIGMAP}" -n "${KYPO_NAMESPACE}" \
    "${cm_args[@]}" --dry-run=client -o yaml | kubectl apply -f -

  kubectl create secret generic "${KYPO_SECRET}" -n "${KYPO_NAMESPACE}" \
    "${secret_args[@]}" --dry-run=client -o yaml | kubectl apply -f -

  if [[ "${restart}" == "--restart" ]]; then
    local consumer
    for consumer in "${KYPO_CONSUMERS[@]}"; do
      if kubectl -n "${KYPO_NAMESPACE}" get deployment "${consumer}" >/dev/null 2>&1; then
        echo "==> Restarting ${consumer}"
        kubectl -n "${KYPO_NAMESPACE}" rollout restart "deployment/${consumer}"
      fi
    done
    echo "==> Restart requested. envFrom is read at container start, so the new"
    echo "    values take effect once these pods have been replaced."
  fi
}

kypo_show() {
  local question key prompt kind value

  if [[ ! -f "${KYPO_ENV_FILE}" ]]; then
    echo "No ${KYPO_ENV_FILE}. KYPO integration is not configured on this host."
    return 0
  fi

  _read_saved || return 1

  echo
  echo "================ KYPO integration ================"
  echo "Source: ${KYPO_ENV_FILE}"
  echo
  for question in "${KYPO_QUESTIONS[@]}"; do
    key="$(_field "${question}" 1)"
    prompt="$(_field "${question}" 2)"
    kind="$(_field "${question}" 4)"
    value="$(eval "printf '%s' \"\${KYPO_${key}:-}\"")"

    if [[ -z "${value}" ]]; then
      value="<not set>"
    elif [[ "${kind}" == "secret" ]]; then
      value="********"
    fi

    printf '  %-42s %s\n' "${prompt}" "${value}"
  done
  echo "=================================================="
}

case "${1:---show}" in
  --configure) kypo_configure ;;
  --apply)     kypo_apply "${2:-}" ;;
  --show)      kypo_show ;;
  *)
    echo "Usage: $0 [--configure|--apply [--restart]|--show]" >&2
    exit 1
    ;;
esac
