#!/usr/bin/env bash
# Initial admin credentials for the platform consoles: Grafana, Rancher, Harbor.
#
# All three used to ship the same literal password in their values files, which
# meant one leaked repository handed over the monitoring console, the registry,
# and the cluster-admin UI at once. Instead the passwords are generated on the
# machine at install time and passed to Helm with --set, so no secret is stored
# in the repository at all.
#
# Generated ONCE and reused. Re-running the installer must not mint new
# passwords, because for two of these three services the value only takes
# effect on first boot:
#
#   Grafana  - reads the secret at startup; the admin user also lives in
#              Grafana's own database on its PVC.
#   Rancher  - bootstrapPassword is only good until an admin completes the
#              first-time setup wizard. After that Rancher keeps its own
#              password and this value is inert.
#   Harbor   - applies the password when it initialises its database. On an
#              already-initialised Harbor a changed value updates the
#              Kubernetes secret but NOT the account you actually log in with.
#
# So this file is the record of what was set at install time, not a rotation
# mechanism. To change a password after the fact, do it in that service's own
# UI - and then this file is out of date, which `--show` warns about.
#
# Sourced by prod/helm.sh; also runnable directly:
#   ./platform-credentials.sh --show      print the credentials
#   ./platform-credentials.sh --ensure    generate any that are missing

FCTF_CREDENTIALS_FILE="${FCTF_CREDENTIALS_FILE:-/etc/fctf/platform-credentials.env}"

# Scope is the consoles a human logs into over the Internet, nothing else.
# RabbitMQ is here because its admin account is the management UI login served
# on <RABBITMQ_DOMAIN>, not a service credential - the deployment services
# authenticate as deployment-producer / deployment-consumer instead. Passwords
# used only between pods inside the cluster (MariaDB root, the Redis ACL users,
# the RabbitMQ producer/consumer pair) are deliberately left where they are;
# rotate-service-passwords.sh owns those.
FCTF_CREDENTIAL_KEYS=(
  GRAFANA_ADMIN_PASSWORD
  RANCHER_BOOTSTRAP_PASSWORD
  HARBOR_ADMIN_PASSWORD
  RABBITMQ_ADMIN_PASSWORD
)

# Every one of these is passed to `helm --set`, where a comma or a backslash
# would be read as syntax rather than as part of the value. Restricting the
# alphabet to [A-Za-z0-9] avoids the quoting problem entirely; the length is
# what carries the entropy.
fctf_generate_secret() {
  local length="${1:-32}"
  local secret=""
  local chunk=""

  while [[ ${#secret} -lt ${length} ]]; do
    chunk="$(LC_ALL=C tr -dc 'A-Za-z0-9' < /dev/urandom | head -c "$((length - ${#secret}))" || true)"
    if [[ -z "${chunk}" ]]; then
      echo "Error: failed to read randomness from /dev/urandom." >&2
      return 1
    fi
    secret+="${chunk}"
  done

  printf '%s' "${secret:0:length}"
}

# The default path is under /etc, but the path is overridable and the caller
# may already own it, so escalate only when the filesystem actually says no.
# Reaching for sudo unconditionally turns a working setup into a password
# prompt, or a hard failure where sudo is absent.
_fctf_sudo_prefix() {
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

# Appends only the keys that are absent, so an existing install keeps the
# passwords it was built with. Every write is checked: a credentials file that
# silently failed to save would hand out passwords that no longer open
# anything once the shell exits.
fctf_ensure_platform_credentials() {
  local dir sudo_cmd
  dir="$(dirname "${FCTF_CREDENTIALS_FILE}")"

  sudo_cmd="$(_fctf_sudo_prefix "${dir}")" || return 1

  ${sudo_cmd} mkdir -p "${dir}" || { echo "Error: cannot create ${dir}" >&2; return 1; }
  ${sudo_cmd} chmod 700 "${dir}" || { echo "Error: cannot chmod ${dir}" >&2; return 1; }

  if [[ ! -f "${FCTF_CREDENTIALS_FILE}" ]]; then
    ${sudo_cmd} touch "${FCTF_CREDENTIALS_FILE}" \
      || { echo "Error: cannot create ${FCTF_CREDENTIALS_FILE}" >&2; return 1; }
    ${sudo_cmd} sh -c "printf '%s\n' '# FCTF platform console credentials - generated at install time.' > '${FCTF_CREDENTIALS_FILE}'" \
      || { echo "Error: cannot write ${FCTF_CREDENTIALS_FILE}" >&2; return 1; }
  fi

  # Tighten on every run, not only at creation: an earlier version of this
  # script, or a restore from backup, can leave the file world-readable.
  ${sudo_cmd} chmod 600 "${FCTF_CREDENTIALS_FILE}" \
    || { echo "Error: cannot chmod ${FCTF_CREDENTIALS_FILE}" >&2; return 1; }

  local existing name value
  existing="$(${sudo_cmd} cat "${FCTF_CREDENTIALS_FILE}")" \
    || { echo "Error: cannot read ${FCTF_CREDENTIALS_FILE}" >&2; return 1; }

  for name in "${FCTF_CREDENTIAL_KEYS[@]}"; do
    if ! printf '%s\n' "${existing}" | grep -q "^${name}="; then
      value="$(fctf_generate_secret 32)" || return 1
      ${sudo_cmd} sh -c "printf '%s=%s\n' '${name}' '${value}' >> '${FCTF_CREDENTIALS_FILE}'" \
        || { echo "Error: cannot append ${name} to ${FCTF_CREDENTIALS_FILE}" >&2; return 1; }
      echo "==> Generated ${name}"
    fi
  done

  # shellcheck disable=SC1090
  source <(${sudo_cmd} cat "${FCTF_CREDENTIALS_FILE}")

  for name in "${FCTF_CREDENTIAL_KEYS[@]}"; do
    if [[ -z "${!name:-}" ]]; then
      echo "Error: ${name} is empty in ${FCTF_CREDENTIALS_FILE}" >&2
      return 1
    fi
    export "${name?}"
  done
}

# Reads the cluster rather than the file. The cluster is what a login actually
# checks, and the two can disagree - someone changes a password in the UI, or
# the file is restored onto a machine whose cluster was built separately.
_fctf_secret_value() {
  local ns="$1" secret="$2" key="$3"
  kubectl -n "${ns}" get secret "${secret}" -o "jsonpath={.data.${key}}" 2>/dev/null \
    | base64 -d 2>/dev/null || true
}

_fctf_ingress_host() {
  local ns="$1"
  kubectl -n "${ns}" get ingress -o jsonpath='{.items[0].spec.rules[0].host}' 2>/dev/null || true
}

_fctf_report() {
  local label="$1" url="$2" user="$3" password="$4" note="$5"

  echo "  ${label}"
  [[ -n "${url}" ]] && echo "    URL      : https://${url}"
  echo "    Username : ${user}"
  if [[ -n "${password}" ]]; then
    echo "    Password : ${password}"
  else
    echo "    Password : <not found - service not installed, or kubectl cannot reach the cluster>"
  fi
  [[ -n "${note}" ]] && echo "    Note     : ${note}"
  echo
}

fctf_show_platform_credentials() {
  echo
  echo "================ FCTF platform credentials ================"
  echo "Read live from the cluster. Treat this output as secret:"
  echo "it is not redacted and will sit in your shell scrollback."
  echo

  _fctf_report "Grafana" \
    "$(_fctf_ingress_host monitoring)" \
    "$(_fctf_secret_value monitoring prometheus-grafana admin-user)" \
    "$(_fctf_secret_value monitoring prometheus-grafana admin-password)" \
    ""

  _fctf_report "Rancher" \
    "$(_fctf_ingress_host cattle-system)" \
    "admin" \
    "$(_fctf_secret_value cattle-system bootstrap-secret bootstrapPassword)" \
    "bootstrap password - valid only until the first-time setup wizard is completed."

  _fctf_report "Harbor" \
    "$(_fctf_ingress_host registry)" \
    "admin" \
    "$(_fctf_secret_value registry harbor-core HARBOR_ADMIN_PASSWORD)" \
    "set when Harbor first initialised its database; a later change made in the Harbor UI will not show here."

  _fctf_report "RabbitMQ (management)" \
    "$(_fctf_ingress_host db)" \
    "admin" \
    "$(_fctf_secret_value db rabbitmq rabbitmq-password)" \
    "apply-fctf.sh re-applies this to the broker on every install, so the secret and the live account stay in step."

  echo "Stored copy: ${FCTF_CREDENTIALS_FILE}"
  echo "==========================================================="
}

# Only act when run directly, so `source`ing this from helm.sh stays side-effect free.
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  set -euo pipefail
  case "${1:---show}" in
    --show)
      fctf_show_platform_credentials
      ;;
    --ensure)
      fctf_ensure_platform_credentials
      echo "Credentials present in ${FCTF_CREDENTIALS_FILE}"
      ;;
    *)
      echo "Usage: $0 [--show|--ensure]" >&2
      exit 1
      ;;
  esac
fi
