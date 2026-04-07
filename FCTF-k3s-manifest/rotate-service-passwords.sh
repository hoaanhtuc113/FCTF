#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROD_DIR="${SCRIPT_DIR}/prod"

DB_NAMESPACE="db"
APP_NAMESPACE="app"

SKIP_ROLLOUT_RESTART="false"
DEBUG_MODE="false"

NEED_REDIS_ROTATION="true"
NEED_MARIADB_ROTATION="true"
ROTATE_RABBITMQ="true"
ROTATE_HARBOR="true"
HASH_TOOL_READY="false"

usage() {
  cat <<EOF
Usage:
  $0 [--skip-rollout-restart] [--debug]

Description:
  Rotate Redis passwords, RabbitMQ producer/consumer passwords,
  MariaDB credentials, and Harbor credentials, then restart workloads.
  The script will:
    1) Rotate all Redis ACL users + Redis default password
    2) Rotate RabbitMQ producer/consumer only (no admin rotation)
     3) Rotate MariaDB passwords for ctfd-username/root/replication
       (SQL ALTER USER + secret patch + redeploy)
     4) Rotate MariaDB service-account passwords (contestant_be, deployment_*)
       (SQL ALTER USER + DB_CONNECTION patch)
     5) Patch matching Kubernetes Secrets (excluding ctfd namespace)
    6) Keep Harbor admin/rabbit-admin/rancher/grafana admin accounts unchanged
    7) Rotate RABBIT_PASSWORD only for deployment-center/deployment-consumer
     8) Rotate SECRET_KEY and PRIVATE_KEY for secrets in namespace app

Options:
  --skip-rollout-restart   Do not restart workloads after secret rotation
  --debug                  Enable verbose debug/progress logs
  -h, --help               Show help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-rollout-restart)
      SKIP_ROLLOUT_RESTART="true"
      shift
      ;;
    --debug)
      DEBUG_MODE="true"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1"
      usage
      exit 1
      ;;
  esac
done

debug_log() {
  if [[ "${DEBUG_MODE}" == "true" ]]; then
    echo "[DEBUG] $*"
  fi
}

require_command() {
  local cmd="$1"
  if ! command -v "${cmd}" >/dev/null 2>&1; then
    echo "Error: command '${cmd}' is required but not found."
    exit 1
  fi
}

run_privileged() {
  if [[ "$(id -u)" -eq 0 ]]; then
    "$@"
    return $?
  fi

  if command -v sudo >/dev/null 2>&1; then
    sudo "$@"
    return $?
  fi

  return 1
}

install_hash_generation_tools() {
  if command -v htpasswd >/dev/null 2>&1; then
    HASH_TOOL_READY="true"
    return 0
  fi

  echo "==> htpasswd not found, attempting auto-install"

  if command -v apt-get >/dev/null 2>&1; then
    run_privileged apt-get update -y >/dev/null
    run_privileged apt-get install -y apache2-utils >/dev/null
  elif command -v dnf >/dev/null 2>&1; then
    run_privileged dnf install -y httpd-tools >/dev/null
  elif command -v yum >/dev/null 2>&1; then
    run_privileged yum install -y httpd-tools >/dev/null
  elif command -v apk >/dev/null 2>&1; then
    run_privileged apk add --no-cache apache2-utils >/dev/null
  elif command -v zypper >/dev/null 2>&1; then
    run_privileged zypper --non-interactive install apache2-utils >/dev/null
  elif command -v pacman >/dev/null 2>&1; then
    run_privileged pacman -Sy --noconfirm apache >/dev/null
  else
    echo "Error: no supported package manager found for auto-install (apt/dnf/yum/apk/zypper/pacman)."
    return 1
  fi

  if command -v htpasswd >/dev/null 2>&1; then
    HASH_TOOL_READY="true"
    echo "==> htpasswd installed successfully"
    return 0
  fi

  echo "Error: auto-install completed but htpasswd is still unavailable."
  return 1
}

ensure_hash_generation_tool() {
  if [[ "${HASH_TOOL_READY}" == "true" ]]; then
    return 0
  fi

  if command -v htpasswd >/dev/null 2>&1; then
    HASH_TOOL_READY="true"
    return 0
  fi

  install_hash_generation_tools
}

generate_random_secret() {
  local length="${1:-50}"
  local secret=""
  local chunk=""
  local status=0

  while [[ ${#secret} -lt ${length} ]]; do
    set +o pipefail
    chunk="$(LC_ALL=C tr -dc 'A-Za-z0-9' < /dev/urandom | head -c "$((length - ${#secret}))")"
    status=$?
    set -o pipefail

    if [[ ${status} -ne 0 && -z "${chunk}" ]]; then
      echo "Error: failed to generate random secret."
      exit 1
    fi

    secret+="${chunk}"
  done

  printf '%s' "${secret:0:length}"
}

rawurlencode() {
  local string="${1}"
  local strlen=${#string}
  local encoded=""
  local pos c o

  for (( pos=0; pos<strlen; pos++ )); do
    c=${string:pos:1}
    case "${c}" in
      [a-zA-Z0-9.~_-])
        o="${c}"
        ;;
      *)
        printf -v o '%%%02X' "'${c}"
        ;;
    esac
    encoded+="${o}"
  done

  printf '%s' "${encoded}"
}

json_escape() {
  local input="$1"
  input="${input//\\/\\\\}"
  input="${input//\"/\\\"}"
  input="${input//$'\n'/\\n}"
  input="${input//$'\r'/\\r}"
  printf '%s' "${input}"
}

get_pod_name() {
  local namespace="$1"
  local primary_name="$2"
  local selector="$3"

  if kubectl -n "${namespace}" get pod "${primary_name}" >/dev/null 2>&1; then
    printf '%s' "${primary_name}"
    return 0
  fi

  local discovered
  discovered="$(kubectl -n "${namespace}" get pod -l "${selector}" -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)"
  if [[ -z "${discovered}" ]]; then
    return 1
  fi

  printf '%s' "${discovered}"
}

get_secret_value() {
  local namespace="$1"
  local secret_name="$2"
  local key="$3"

  local raw
  raw="$(kubectl --request-timeout=10s -n "${namespace}" get secret "${secret_name}" -o "jsonpath={.data['${key}']}" 2>/dev/null || true)"
  if [[ -z "${raw}" ]]; then
    return 1
  fi

  printf '%s' "${raw}" | base64 --decode
}

get_secret_keys() {
  local namespace="$1"
  local secret_name="$2"

  kubectl --request-timeout=10s -n "${namespace}" get secret "${secret_name}" \
    -o go-template='{{range $k,$v := .data}}{{printf "%s\n" $k}}{{end}}' 2>/dev/null || true
}

secret_has_key() {
  local namespace="$1"
  local secret_name="$2"
  local key="$3"

  get_secret_keys "${namespace}" "${secret_name}" | grep -Fxq "${key}"
}

patch_secret_string_key() {
  local namespace="$1"
  local secret_name="$2"
  local key="$3"
  local value="$4"

  local payload
  payload="{\"stringData\":{\"${key}\":\"$(json_escape "${value}")\"}}"
  kubectl -n "${namespace}" patch secret "${secret_name}" --type merge -p "${payload}" >/dev/null
}

strip_yaml_quotes() {
  local value="$1"
  if [[ "${value}" =~ ^\".*\"$ || "${value}" =~ ^\'.*\'$ ]]; then
    value="${value:1:${#value}-2}"
  fi
  printf '%s' "${value}"
}

yaml_read_scalar() {
  local file="$1"
  local path="$2"

  [[ -f "${file}" ]] || {
    printf ''
    return 0
  }

  awk -v path="${path}" '
    function trim(s) {
      sub(/^[ \t\r\n]+/, "", s)
      sub(/[ \t\r\n]+$/, "", s)
      return s
    }
    BEGIN {
      want_count = split(path, want, ".")
      depth = 0
    }
    /^[[:space:]]*#/ { next }
    {
      line = $0
      sub(/[[:space:]]+#.*/, "", line)
      if (line ~ /^[[:space:]]*$/) next

      indent = match(line, /[^[:space:]]/) - 1
      if (indent < 0) next

      while (depth > 0 && indents[depth] >= indent) {
        delete keys[depth]
        delete indents[depth]
        depth--
      }

      if (line ~ /^[[:space:]]*[A-Za-z0-9_.-]+:[[:space:]]*/) {
        work = line
        sub(/^[[:space:]]*/, "", work)
        sep = index(work, ":")
        if (sep <= 0) next

        depth++
        keys[depth] = substr(work, 1, sep - 1)
        indents[depth] = indent
        value = trim(substr(work, sep + 1))

        if (depth == want_count) {
          ok = 1
          for (i = 1; i <= want_count; i++) {
            if (keys[i] != want[i]) {
              ok = 0
              break
            }
          }
          if (ok) {
            if (value == "|" || value == ">") {
              print ""
              exit
            }
            print value
            exit
          }
        }
      }
    }
  ' "${file}" | {
    IFS= read -r raw || true
    raw="$(strip_yaml_quotes "$(printf '%s' "${raw}" | sed -E 's/^[[:space:]]+|[[:space:]]+$//g')")"
    printf '%s' "${raw}"
  }
}

load_harbor_static_values() {
  local harbor_values="${PROD_DIR}/helm/registry/harbor-values.yaml"

  HARBOR_ADMIN_PASSWORD="$(yaml_read_scalar "${harbor_values}" "harborAdminPassword")"
  HARBOR_SECRET_KEY="$(yaml_read_scalar "${harbor_values}" "secretKey")"
  HARBOR_CORE_SECRET="$(yaml_read_scalar "${harbor_values}" "core.secret")"
  HARBOR_CSRF_KEY="$(yaml_read_scalar "${harbor_values}" "core.xsrfKey")"
  HARBOR_JOBSERVICE_SECRET="$(yaml_read_scalar "${harbor_values}" "jobservice.secret")"
  HARBOR_REGISTRY_HTTP_SECRET="$(yaml_read_scalar "${harbor_values}" "registry.secret")"
  HARBOR_REGISTRY_USERNAME="$(yaml_read_scalar "${harbor_values}" "registry.credentials.username")"
  HARBOR_REGISTRY_PASSWORD="$(yaml_read_scalar "${harbor_values}" "registry.credentials.password")"
  HARBOR_REGISTRY_HTPASSWD="$(yaml_read_scalar "${harbor_values}" "registry.credentials.htpasswdString")"
  HARBOR_DATABASE_PASSWORD="$(yaml_read_scalar "${harbor_values}" "database.internal.password")"
  HARBOR_CORE_TLS_CRT="$(yaml_read_scalar "${harbor_values}" "core.tokenCert")"
  HARBOR_CORE_TLS_KEY="$(yaml_read_scalar "${harbor_values}" "core.tokenKey")"

  if [[ -n "$(yaml_read_scalar "${harbor_values}" "existingSecretAdminPassword")" ]]; then
    HARBOR_ADMIN_PASSWORD=""
  fi
  # Keep Harbor admin unchanged by policy.
  HARBOR_ADMIN_PASSWORD=""
  if [[ -n "$(yaml_read_scalar "${harbor_values}" "existingSecretSecretKey")" ]]; then
    HARBOR_SECRET_KEY=""
  fi
  if [[ -n "$(yaml_read_scalar "${harbor_values}" "core.existingSecret")" ]]; then
    HARBOR_CORE_SECRET=""
  fi
  if [[ -n "$(yaml_read_scalar "${harbor_values}" "core.existingXsrfSecret")" ]]; then
    HARBOR_CSRF_KEY=""
  fi
  if [[ -n "$(yaml_read_scalar "${harbor_values}" "jobservice.existingSecret")" ]]; then
    HARBOR_JOBSERVICE_SECRET=""
  fi
  if [[ -n "$(yaml_read_scalar "${harbor_values}" "registry.existingSecret")" ]]; then
    HARBOR_REGISTRY_HTTP_SECRET=""
  fi
  if [[ -n "$(yaml_read_scalar "${harbor_values}" "registry.credentials.existingSecret")" ]]; then
    HARBOR_REGISTRY_USERNAME=""
    HARBOR_REGISTRY_PASSWORD=""
    HARBOR_REGISTRY_HTPASSWD=""
  fi
  if [[ "$(yaml_read_scalar "${harbor_values}" "database.type")" != "internal" ]]; then
    HARBOR_DATABASE_PASSWORD=""
  fi
  if [[ -n "$(yaml_read_scalar "${harbor_values}" "core.secretName")" ]]; then
    HARBOR_CORE_TLS_CRT=""
    HARBOR_CORE_TLS_KEY=""
  fi
}

prepare_harbor_rotation_values() {
  if [[ -n "${HARBOR_SECRET_KEY}" ]]; then
    HARBOR_SECRET_KEY="$(generate_random_secret 50)"
  fi
  if [[ -n "${HARBOR_CORE_SECRET}" ]]; then
    HARBOR_CORE_SECRET="$(generate_random_secret 40)"
  fi
  if [[ -n "${HARBOR_CSRF_KEY}" ]]; then
    HARBOR_CSRF_KEY="$(generate_random_secret 32)"
  fi
  if [[ -n "${HARBOR_JOBSERVICE_SECRET}" ]]; then
    HARBOR_JOBSERVICE_SECRET="$(generate_random_secret 40)"
  fi
  if [[ -n "${HARBOR_REGISTRY_HTTP_SECRET}" ]]; then
    HARBOR_REGISTRY_HTTP_SECRET="$(generate_random_secret 40)"
  fi
  if [[ -n "${HARBOR_REGISTRY_PASSWORD}" ]]; then
    HARBOR_REGISTRY_PASSWORD="$(generate_random_secret 40)"
    # Regenerate htpasswd from the new password unless chart pins a fixed value.
    HARBOR_REGISTRY_HTPASSWD=""
  fi
  if [[ -n "${HARBOR_DATABASE_PASSWORD}" ]]; then
    HARBOR_DATABASE_PASSWORD="$(generate_random_secret 40)"
  fi
}

generate_registry_htpasswd_entry() {
  local username="$1"
  local password="$2"
  local entry=""

  if command -v htpasswd >/dev/null 2>&1; then
    entry="$(htpasswd -nbB "${username}" "${password}" 2>/dev/null || true)"
    if [[ -n "${entry}" ]]; then
      printf '%s' "${entry}"
      return 0
    fi
  fi

  return 1
}

get_registry_username_from_secret() {
  local ns="$1"
  local sec="$2"
  local user ht_line

  user="$(get_secret_value "${ns}" "${sec}" "REGISTRY_USERNAME" || true)"
  if [[ -z "${user}" ]]; then
    user="$(get_secret_value "${ns}" "${sec}" "REGISTRY_USER" || true)"
  fi

  if [[ -z "${user}" ]]; then
    ht_line="$(get_secret_value "${ns}" "${sec}" "REGISTRY_HTPASSWD" || true)"
    if [[ -n "${ht_line}" && "${ht_line}" == *":"* ]]; then
      user="${ht_line%%:*}"
    fi
  fi

  if [[ -z "${user}" ]]; then
    user="harbor_registry_user"
  fi

  printf '%s' "${user}"
}

discover_harbor_database_current_password() {
  local harbor_ns="registry"
  local secret_name current

  while IFS= read -r secret_name; do
    [[ -n "${secret_name}" ]] || continue
    [[ "${secret_name}" == *harbor* ]] || continue

    current="$(get_secret_value "${harbor_ns}" "${secret_name}" "POSTGRESQL_PASSWORD" || true)"
    if [[ -n "${current}" ]]; then
      printf '%s' "${current}"
      return 0
    fi

    current="$(get_secret_value "${harbor_ns}" "${secret_name}" "POSTGRES_PASSWORD" || true)"
    if [[ -n "${current}" ]]; then
      printf '%s' "${current}"
      return 0
    fi
  done < <(kubectl -n "${harbor_ns}" get secrets -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}' 2>/dev/null || true)

  return 1
}

apply_harbor_database_password_change() {
  local harbor_ns="registry"
  local harbor_db_pod="harbor-database-0"
  local escaped_new_password

  if [[ -z "${HARBOR_DATABASE_PASSWORD_OLD}" || -z "${HARBOR_DATABASE_PASSWORD}" ]]; then
    return 0
  fi

  if ! kubectl -n "${harbor_ns}" get pod "${harbor_db_pod}" >/dev/null 2>&1; then
    echo "Error: Harbor database pod ${harbor_ns}/${harbor_db_pod} not found."
    return 1
  fi

  escaped_new_password="$(printf '%s' "${HARBOR_DATABASE_PASSWORD}" | sed "s/'/''/g")"

  if kubectl -n "${harbor_ns}" exec "${harbor_db_pod}" -- env "PGPASSWORD=${HARBOR_DATABASE_PASSWORD_OLD}" \
      psql -h 127.0.0.1 -U postgres -d registry -c "ALTER USER postgres WITH PASSWORD '${escaped_new_password}';" >/dev/null 2>&1; then
    echo "    applied Harbor Postgres password ALTER USER in ${harbor_ns}/${harbor_db_pod}"
    return 0
  fi

  echo "Error: failed to apply Harbor Postgres password ALTER USER."
  echo "Hint: verify current Harbor DB password in registry secrets before rotation."
  return 1
}

patch_harbor_secrets() {
  local patched="0"
  local harbor_ns="registry"
  local secret_name current registry_user htpasswd_entry

  while IFS= read -r secret_name; do
    [[ -n "${secret_name}" ]] || continue

    if [[ "${secret_name}" != *harbor* ]]; then
      continue
    fi

    current="$(get_secret_value "${harbor_ns}" "${secret_name}" "HARBOR_ADMIN_PASSWORD" || true)"
    if [[ -n "${current}" && -n "${HARBOR_ADMIN_PASSWORD}" ]]; then
      patch_secret_string_key "${harbor_ns}" "${secret_name}" "HARBOR_ADMIN_PASSWORD" "${HARBOR_ADMIN_PASSWORD}"
      patched=$((patched + 1))
      echo "    patched ${harbor_ns}/${secret_name}:HARBOR_ADMIN_PASSWORD"
    fi

    current="$(get_secret_value "${harbor_ns}" "${secret_name}" "secretKey" || true)"
    if [[ -n "${current}" && -n "${HARBOR_SECRET_KEY}" ]]; then
      patch_secret_string_key "${harbor_ns}" "${secret_name}" "secretKey" "${HARBOR_SECRET_KEY}"
      patched=$((patched + 1))
      echo "    patched ${harbor_ns}/${secret_name}:secretKey"
    fi

    current="$(get_secret_value "${harbor_ns}" "${secret_name}" "CSRF_KEY" || true)"
    if [[ -n "${current}" && -n "${HARBOR_CSRF_KEY}" ]]; then
      patch_secret_string_key "${harbor_ns}" "${secret_name}" "CSRF_KEY" "${HARBOR_CSRF_KEY}"
      patched=$((patched + 1))
      echo "    patched ${harbor_ns}/${secret_name}:CSRF_KEY"
    fi

    current="$(get_secret_value "${harbor_ns}" "${secret_name}" "CORE_SECRET" || true)"
    if [[ -n "${current}" && -n "${HARBOR_CORE_SECRET}" ]]; then
      patch_secret_string_key "${harbor_ns}" "${secret_name}" "CORE_SECRET" "${HARBOR_CORE_SECRET}"
      patched=$((patched + 1))
      echo "    patched ${harbor_ns}/${secret_name}:CORE_SECRET"
    fi

    current="$(get_secret_value "${harbor_ns}" "${secret_name}" "POSTGRESQL_PASSWORD" || true)"
    if [[ -n "${current}" && -n "${HARBOR_DATABASE_PASSWORD}" ]]; then
      patch_secret_string_key "${harbor_ns}" "${secret_name}" "POSTGRESQL_PASSWORD" "${HARBOR_DATABASE_PASSWORD}"
      patched=$((patched + 1))
      echo "    patched ${harbor_ns}/${secret_name}:POSTGRESQL_PASSWORD"
    fi

    current="$(get_secret_value "${harbor_ns}" "${secret_name}" "POSTGRES_PASSWORD" || true)"
    if [[ -n "${current}" && -n "${HARBOR_DATABASE_PASSWORD}" ]]; then
      patch_secret_string_key "${harbor_ns}" "${secret_name}" "POSTGRES_PASSWORD" "${HARBOR_DATABASE_PASSWORD}"
      patched=$((patched + 1))
      echo "    patched ${harbor_ns}/${secret_name}:POSTGRES_PASSWORD"
    fi

    if [[ "${secret_name}" == *"harbor-core"* ]]; then
      current="$(get_secret_value "${harbor_ns}" "${secret_name}" "secret" || true)"
      if [[ -n "${current}" && -n "${HARBOR_CORE_SECRET}" ]]; then
        patch_secret_string_key "${harbor_ns}" "${secret_name}" "secret" "${HARBOR_CORE_SECRET}"
        patched=$((patched + 1))
        echo "    patched ${harbor_ns}/${secret_name}:secret"
      fi
    fi

    current="$(get_secret_value "${harbor_ns}" "${secret_name}" "JOBSERVICE_SECRET" || true)"
    if [[ -n "${current}" && -n "${HARBOR_JOBSERVICE_SECRET}" ]]; then
      patch_secret_string_key "${harbor_ns}" "${secret_name}" "JOBSERVICE_SECRET" "${HARBOR_JOBSERVICE_SECRET}"
      patched=$((patched + 1))
      echo "    patched ${harbor_ns}/${secret_name}:JOBSERVICE_SECRET"
    fi

    current="$(get_secret_value "${harbor_ns}" "${secret_name}" "REGISTRY_HTTP_SECRET" || true)"
    if [[ -n "${current}" && -n "${HARBOR_REGISTRY_HTTP_SECRET}" ]]; then
      patch_secret_string_key "${harbor_ns}" "${secret_name}" "REGISTRY_HTTP_SECRET" "${HARBOR_REGISTRY_HTTP_SECRET}"
      patched=$((patched + 1))
      echo "    patched ${harbor_ns}/${secret_name}:REGISTRY_HTTP_SECRET"
    fi

    if [[ -n "${HARBOR_REGISTRY_PASSWORD}" ]] && secret_has_key "${harbor_ns}" "${secret_name}" "REGISTRY_PASSWD"; then
      patch_secret_string_key "${harbor_ns}" "${secret_name}" "REGISTRY_PASSWD" "${HARBOR_REGISTRY_PASSWORD}"
      patched=$((patched + 1))
      echo "    patched ${harbor_ns}/${secret_name}:REGISTRY_PASSWD"
    fi

    if [[ -n "${HARBOR_REGISTRY_PASSWORD}" ]] && secret_has_key "${harbor_ns}" "${secret_name}" "REGISTRY_CREDENTIAL_PASSWORD"; then
      patch_secret_string_key "${harbor_ns}" "${secret_name}" "REGISTRY_CREDENTIAL_PASSWORD" "${HARBOR_REGISTRY_PASSWORD}"
      patched=$((patched + 1))
      echo "    patched ${harbor_ns}/${secret_name}:REGISTRY_CREDENTIAL_PASSWORD"
    fi

    current="$(get_secret_value "${harbor_ns}" "${secret_name}" "tls.crt" || true)"
    if [[ -n "${current}" && -n "${HARBOR_CORE_TLS_CRT}" ]]; then
      patch_secret_string_key "${harbor_ns}" "${secret_name}" "tls.crt" "${HARBOR_CORE_TLS_CRT}"
      patched=$((patched + 1))
      echo "    patched ${harbor_ns}/${secret_name}:tls.crt"
    fi

    current="$(get_secret_value "${harbor_ns}" "${secret_name}" "tls.key" || true)"
    if [[ -n "${current}" && -n "${HARBOR_CORE_TLS_KEY}" ]]; then
      patch_secret_string_key "${harbor_ns}" "${secret_name}" "tls.key" "${HARBOR_CORE_TLS_KEY}"
      patched=$((patched + 1))
      echo "    patched ${harbor_ns}/${secret_name}:tls.key"
    fi

    if secret_has_key "${harbor_ns}" "${secret_name}" "REGISTRY_HTPASSWD" && [[ -n "${HARBOR_REGISTRY_HTPASSWD}" || -n "${HARBOR_REGISTRY_PASSWORD}" ]]; then
      if [[ -n "${HARBOR_REGISTRY_HTPASSWD}" ]]; then
        patch_secret_string_key "${harbor_ns}" "${secret_name}" "REGISTRY_HTPASSWD" "${HARBOR_REGISTRY_HTPASSWD}"
        patched=$((patched + 1))
        echo "    patched ${harbor_ns}/${secret_name}:REGISTRY_HTPASSWD"
      else
        if ! ensure_hash_generation_tool; then
          echo "Error: ${harbor_ns}/${secret_name} requires REGISTRY_HTPASSWD update but hash tool install failed."
          exit 1
        fi

        registry_user="${HARBOR_REGISTRY_USERNAME}"
        if [[ -z "${registry_user}" ]]; then
          registry_user="$(get_registry_username_from_secret "${harbor_ns}" "${secret_name}")"
        fi
        htpasswd_entry="$(generate_registry_htpasswd_entry "${registry_user}" "${HARBOR_REGISTRY_PASSWORD}" || true)"

        if [[ -n "${htpasswd_entry}" ]]; then
          patch_secret_string_key "${harbor_ns}" "${secret_name}" "REGISTRY_HTPASSWD" "${htpasswd_entry}"
          patched=$((patched + 1))
          echo "    patched ${harbor_ns}/${secret_name}:REGISTRY_HTPASSWD"
        else
          echo "Error: ${harbor_ns}/${secret_name} requires REGISTRY_HTPASSWD but cannot generate it (install htpasswd with bcrypt support)."
          exit 1
        fi
      fi
    fi
  done < <(kubectl -n "${harbor_ns}" get secrets -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}' 2>/dev/null || true)

  if [[ "${patched}" -eq 0 ]]; then
    echo "==> Harbor static-value secret patches: 0"
  else
    echo "==> Harbor static-value secret patches: ${patched}"
  fi
}

restart_harbor_workloads() {
  local ns="registry"
  local -a deployments=("harbor-core" "harbor-jobservice" "harbor-portal" "harbor-registry" "harbor-nginx")
  local -a statefulsets=("harbor-database" "harbor-redis")
  local name replicas

  echo "==> Restarting Harbor workloads"
  for name in "${deployments[@]}"; do
    if kubectl -n "${ns}" get deployment "${name}" >/dev/null 2>&1; then
      replicas="$(kubectl -n "${ns}" get deployment "${name}" -o jsonpath='{.spec.replicas}' 2>/dev/null || echo "1")"
      if [[ "${replicas}" == "0" ]]; then
        kubectl -n "${ns}" scale "deployment/${name}" --replicas=1 >/dev/null
      fi
      kubectl -n "${ns}" rollout restart "deployment/${name}"
    fi
  done

  for name in "${statefulsets[@]}"; do
    if kubectl -n "${ns}" get statefulset "${name}" >/dev/null 2>&1; then
      kubectl -n "${ns}" rollout restart "statefulset/${name}"
    fi
  done

  for name in "${deployments[@]}"; do
    if kubectl -n "${ns}" get deployment "${name}" >/dev/null 2>&1; then
      kubectl -n "${ns}" rollout status "deployment/${name}" --timeout=600s
    fi
  done

  for name in "${statefulsets[@]}"; do
    if kubectl -n "${ns}" get statefulset "${name}" >/dev/null 2>&1; then
      kubectl -n "${ns}" rollout status "statefulset/${name}" --timeout=600s
    fi
  done
}

scale_harbor_deployments_down() {
  local ns="registry"
  local -a deployments=("harbor-core" "harbor-jobservice" "harbor-portal" "harbor-registry" "harbor-nginx")
  local name

  echo "==> Scaling Harbor app deployments to 0 before secret patch"
  for name in "${deployments[@]}"; do
    if kubectl -n "${ns}" get deployment "${name}" >/dev/null 2>&1; then
      kubectl -n "${ns}" scale "deployment/${name}" --replicas=0 >/dev/null
    fi
  done

  for name in "${deployments[@]}"; do
    if kubectl -n "${ns}" get deployment "${name}" >/dev/null 2>&1; then
      kubectl -n "${ns}" rollout status "deployment/${name}" --timeout=600s
    fi
  done
}

redis_password_for_user() {
  local username="$1"
  case "${username}" in
    svc_admin_mvc) printf '%s' "${ADMIN_REDIS_PASSWORD}" ;;
    svc_gateway) printf '%s' "${GATEWAY_REDIS_PASSWORD}" ;;
    svc_contestant_be) printf '%s' "${CONTESTANT_BE_REDIS_PASSWORD}" ;;
    svc_deployment_center) printf '%s' "${DEPLOYMENT_CENTER_REDIS_PASSWORD}" ;;
    svc_deployment_listener) printf '%s' "${DEPLOYMENT_LISTENER_REDIS_PASSWORD}" ;;
    svc_deployment_consumer) printf '%s' "${DEPLOYMENT_CONSUMER_REDIS_PASSWORD}" ;;
    *) printf '' ;;
  esac
}

mariadb_service_password_for_user() {
  local username="$1"
  case "${username}" in
    contestant_be) printf '%s' "${MARIADB_CONTESTANT_BE_PASSWORD_NEW}" ;;
    deployment_center) printf '%s' "${MARIADB_DEPLOYMENT_CENTER_PASSWORD_NEW}" ;;
    deployment_listener) printf '%s' "${MARIADB_DEPLOYMENT_LISTENER_PASSWORD_NEW}" ;;
    deployment_consumer) printf '%s' "${MARIADB_DEPLOYMENT_CONSUMER_PASSWORD_NEW}" ;;
    *) printf '' ;;
  esac
}

replace_rabbitmq_user_password_in_definition() {
  local definition_json="$1"
  local username="$2"
  local new_password="$3"
  local escaped_password

  escaped_password="$(json_escape "${new_password}")"

  printf '%s\n' "${definition_json}" | awk -v target_user="${username}" -v target_password="${escaped_password}" '
    BEGIN { hit_user = 0 }
    {
      if ($0 ~ "\"name\"[[:space:]]*:[[:space:]]*\"" target_user "\"") {
        hit_user = 1
      }

      if (hit_user == 1 && $0 ~ /"password"[[:space:]]*:[[:space:]]*"/) {
        match($0, /^[[:space:]]*/)
        indent = substr($0, RSTART, RLENGTH)
        trailing_comma = ""
        if ($0 ~ /,[[:space:]]*$/) {
          trailing_comma = ","
        }
        print indent "\"password\": \"" target_password "\"" trailing_comma
        hit_user = 0
        next
      }

      print
    }
  '
}

patch_rabbitmq_definition_secret() {
  local secret_name="rabbitmq-load-definition"
  local key_name="load_definition.json"
  local current_json updated_json

  current_json="$(get_secret_value "${DB_NAMESPACE}" "${secret_name}" "${key_name}" || true)"
  if [[ -z "${current_json}" ]]; then
    return 0
  fi

  updated_json="${current_json}"
  updated_json="$(replace_rabbitmq_user_password_in_definition "${updated_json}" "deployment-producer" "${RABBIT_PRODUCER_PASSWORD}")"
  updated_json="$(replace_rabbitmq_user_password_in_definition "${updated_json}" "deployment-consumer" "${RABBIT_CONSUMER_PASSWORD}")"

  if [[ "${updated_json}" != "${current_json}" ]]; then
    patch_secret_string_key "${DB_NAMESPACE}" "${secret_name}" "${key_name}" "${updated_json}"
    echo "    patched ${DB_NAMESPACE}/${secret_name}:${key_name}"
  fi
}

replace_url_password_for_user() {
  local value="$1"
  local user="$2"
  local password="$3"
  local url_encode_password="$4"

  if [[ "${value}" != *"${user}:"* ]]; then
    printf '%s' "${value}"
    return 0
  fi

  local prefix rest new_password
  prefix="${value%%${user}:*}"
  rest="${value#*${user}:}"

  if [[ "${rest}" == "${value}" || "${rest}" != *"@"* ]]; then
    printf '%s' "${value}"
    return 0
  fi

  new_password="${password}"
  if [[ "${url_encode_password}" == "true" ]]; then
    new_password="$(rawurlencode "${password}")"
  fi

  printf '%s%s:%s@%s' "${prefix}" "${user}" "${new_password}" "${rest#*@}"
}

replace_db_connection_password_for_user() {
  local value="$1"
  local user="$2"
  local password="$3"

  if [[ "${value}" != *"Password="* ]]; then
    printf '%s' "${value}"
    return 0
  fi

  if [[ "${value}" != *"User=${user};"* && "${value}" != *"User Id=${user};"* && "${value}" != *"Uid=${user};"* ]]; then
    printf '%s' "${value}"
    return 0
  fi

  local prefix tail
  prefix="${value%%Password=*}Password="
  tail="${value#*Password=}"

  if [[ "${tail}" == *";"* ]]; then
    printf '%s%s;%s' "${prefix}" "${password}" "${tail#*;}"
  else
    printf '%s%s' "${prefix}" "${password}"
  fi
}

replace_redis_connection_password_for_user() {
  local value="$1"
  local user="$2"
  local password="$3"

  if [[ "${value}" != *"user=${user}"* || "${value}" != *"password="* ]]; then
    printf '%s' "${value}"
    return 0
  fi

  local prefix tail
  prefix="${value%%password=*}password="
  tail="${value#*password=}"

  if [[ "${tail}" == *,* ]]; then
    printf '%s%s,%s' "${prefix}" "${password}" "${tail#*,}"
  else
    printf '%s%s' "${prefix}" "${password}"
  fi
}

transform_secret_value() {
  local namespace="$1"
  local secret_name="$2"
  local key="$3"
  local value="$4"
  local updated user password

  updated="${value}"

  case "${key}" in
    DATABASE_URL)
      if [[ -n "${MARIADB_CTFD_PASSWORD_NEW}" ]]; then
        updated="$(replace_url_password_for_user "${updated}" "ctfd-username" "${MARIADB_CTFD_PASSWORD_NEW}" "true")"
      fi
      ;;
    DB_CONNECTION)
      if [[ -n "${MARIADB_CTFD_PASSWORD_NEW}" ]]; then
        updated="$(replace_db_connection_password_for_user "${updated}" "ctfd-username" "${MARIADB_CTFD_PASSWORD_NEW}")"
      fi
      if [[ -n "${MARIADB_CONTESTANT_BE_PASSWORD_NEW}" ]]; then
        updated="$(replace_db_connection_password_for_user "${updated}" "contestant_be" "${MARIADB_CONTESTANT_BE_PASSWORD_NEW}")"
      fi
      if [[ -n "${MARIADB_DEPLOYMENT_CENTER_PASSWORD_NEW}" ]]; then
        updated="$(replace_db_connection_password_for_user "${updated}" "deployment_center" "${MARIADB_DEPLOYMENT_CENTER_PASSWORD_NEW}")"
      fi
      if [[ -n "${MARIADB_DEPLOYMENT_LISTENER_PASSWORD_NEW}" ]]; then
        updated="$(replace_db_connection_password_for_user "${updated}" "deployment_listener" "${MARIADB_DEPLOYMENT_LISTENER_PASSWORD_NEW}")"
      fi
      if [[ -n "${MARIADB_DEPLOYMENT_CONSUMER_PASSWORD_NEW}" ]]; then
        updated="$(replace_db_connection_password_for_user "${updated}" "deployment_consumer" "${MARIADB_DEPLOYMENT_CONSUMER_PASSWORD_NEW}")"
      fi
      ;;
    REDIS_URL)
      if [[ -n "${ADMIN_REDIS_PASSWORD}" ]]; then
        updated="$(replace_url_password_for_user "${updated}" "svc_admin_mvc" "${ADMIN_REDIS_PASSWORD}" "true")"
      fi
      if [[ -n "${GATEWAY_REDIS_PASSWORD}" ]]; then
        updated="$(replace_url_password_for_user "${updated}" "svc_gateway" "${GATEWAY_REDIS_PASSWORD}" "true")"
      fi
      if [[ -n "${CONTESTANT_BE_REDIS_PASSWORD}" ]]; then
        updated="$(replace_url_password_for_user "${updated}" "svc_contestant_be" "${CONTESTANT_BE_REDIS_PASSWORD}" "true")"
      fi
      if [[ -n "${DEPLOYMENT_CENTER_REDIS_PASSWORD}" ]]; then
        updated="$(replace_url_password_for_user "${updated}" "svc_deployment_center" "${DEPLOYMENT_CENTER_REDIS_PASSWORD}" "true")"
      fi
      if [[ -n "${DEPLOYMENT_LISTENER_REDIS_PASSWORD}" ]]; then
        updated="$(replace_url_password_for_user "${updated}" "svc_deployment_listener" "${DEPLOYMENT_LISTENER_REDIS_PASSWORD}" "true")"
      fi
      if [[ -n "${DEPLOYMENT_CONSUMER_REDIS_PASSWORD}" ]]; then
        updated="$(replace_url_password_for_user "${updated}" "svc_deployment_consumer" "${DEPLOYMENT_CONSUMER_REDIS_PASSWORD}" "true")"
      fi
      ;;
    REDIS_CONNECTION)
      if [[ -n "${ADMIN_REDIS_PASSWORD}" ]]; then
        updated="$(replace_redis_connection_password_for_user "${updated}" "svc_admin_mvc" "${ADMIN_REDIS_PASSWORD}")"
      fi
      if [[ -n "${GATEWAY_REDIS_PASSWORD}" ]]; then
        updated="$(replace_redis_connection_password_for_user "${updated}" "svc_gateway" "${GATEWAY_REDIS_PASSWORD}")"
      fi
      if [[ -n "${CONTESTANT_BE_REDIS_PASSWORD}" ]]; then
        updated="$(replace_redis_connection_password_for_user "${updated}" "svc_contestant_be" "${CONTESTANT_BE_REDIS_PASSWORD}")"
      fi
      if [[ -n "${DEPLOYMENT_CENTER_REDIS_PASSWORD}" ]]; then
        updated="$(replace_redis_connection_password_for_user "${updated}" "svc_deployment_center" "${DEPLOYMENT_CENTER_REDIS_PASSWORD}")"
      fi
      if [[ -n "${DEPLOYMENT_LISTENER_REDIS_PASSWORD}" ]]; then
        updated="$(replace_redis_connection_password_for_user "${updated}" "svc_deployment_listener" "${DEPLOYMENT_LISTENER_REDIS_PASSWORD}")"
      fi
      if [[ -n "${DEPLOYMENT_CONSUMER_REDIS_PASSWORD}" ]]; then
        updated="$(replace_redis_connection_password_for_user "${updated}" "svc_deployment_consumer" "${DEPLOYMENT_CONSUMER_REDIS_PASSWORD}")"
      fi
      ;;
    REDIS_PASS|REDIS_PASSWORD)
      user="$(get_secret_value "${namespace}" "${secret_name}" "REDIS_USER" || true)"
      if [[ -z "${user}" ]]; then
        user="$(get_secret_value "${namespace}" "${secret_name}" "REDIS_USERNAME" || true)"
      fi
      if [[ -z "${user}" ]]; then
        case "${secret_name}" in
          admin-mvc-secret) user="svc_admin_mvc" ;;
          challenge-gateway-secret) user="svc_gateway" ;;
        esac
      fi
      password="$(redis_password_for_user "${user}")"
      if [[ -n "${password}" ]]; then
        updated="${password}"
      fi
      ;;
    SECRET_KEY)
      if [[ "${namespace}" == "app" && -n "${APP_SECRET_KEY_NEW}" ]]; then
        updated="${APP_SECRET_KEY_NEW}"
      fi
      ;;
    PRIVATE_KEY)
      if [[ "${namespace}" == "app" && -n "${APP_PRIVATE_KEY_NEW}" ]]; then
        updated="${APP_PRIVATE_KEY_NEW}"
      fi
      ;;
    redis-password)
      if [[ -n "${REDIS_ROOT_PASSWORD_NEW}" ]]; then
        updated="${REDIS_ROOT_PASSWORD_NEW}"
      fi
      ;;
    HARBOR_ADMIN_PASSWORD)
      if [[ "${ROTATE_HARBOR}" == "true" && "${namespace}" == "registry" && "${secret_name}" == *harbor* && -n "${HARBOR_ADMIN_PASSWORD}" ]]; then
        updated="${HARBOR_ADMIN_PASSWORD}"
      fi
      ;;
    secretKey)
      if [[ "${ROTATE_HARBOR}" == "true" && "${namespace}" == "registry" && "${secret_name}" == *harbor* && -n "${HARBOR_SECRET_KEY}" ]]; then
        updated="${HARBOR_SECRET_KEY}"
      fi
      ;;
    secret|CORE_SECRET)
      if [[ "${ROTATE_HARBOR}" == "true" && "${namespace}" == "registry" && "${secret_name}" == *harbor* && -n "${HARBOR_CORE_SECRET}" ]]; then
        updated="${HARBOR_CORE_SECRET}"
      fi
      ;;
    CSRF_KEY)
      if [[ "${ROTATE_HARBOR}" == "true" && "${namespace}" == "registry" && "${secret_name}" == *harbor* && -n "${HARBOR_CSRF_KEY}" ]]; then
        updated="${HARBOR_CSRF_KEY}"
      fi
      ;;
    JOBSERVICE_SECRET)
      if [[ "${ROTATE_HARBOR}" == "true" && "${namespace}" == "registry" && "${secret_name}" == *harbor* && -n "${HARBOR_JOBSERVICE_SECRET}" ]]; then
        updated="${HARBOR_JOBSERVICE_SECRET}"
      fi
      ;;
    REGISTRY_HTTP_SECRET)
      if [[ "${ROTATE_HARBOR}" == "true" && "${namespace}" == "registry" && "${secret_name}" == *harbor* && -n "${HARBOR_REGISTRY_HTTP_SECRET}" ]]; then
        updated="${HARBOR_REGISTRY_HTTP_SECRET}"
      fi
      ;;
    REGISTRY_PASSWD)
      if [[ "${ROTATE_HARBOR}" == "true" && "${namespace}" == "registry" && "${secret_name}" == *harbor* && -n "${HARBOR_REGISTRY_PASSWORD}" ]]; then
        updated="${HARBOR_REGISTRY_PASSWORD}"
      fi
      ;;
    RABBIT_PASSWORD)
      case "${secret_name}" in
        deployment-center-secret)
          if [[ -n "${RABBIT_PRODUCER_PASSWORD}" ]]; then
            updated="${RABBIT_PRODUCER_PASSWORD}"
          fi
          ;;
        deployment-consumer-secret)
          if [[ -n "${RABBIT_CONSUMER_PASSWORD}" ]]; then
            updated="${RABBIT_CONSUMER_PASSWORD}"
          fi
          ;;
      esac
      ;;
    mariadb-password)
      if [[ -n "${MARIADB_CTFD_PASSWORD_NEW}" ]]; then
        updated="${MARIADB_CTFD_PASSWORD_NEW}"
      fi
      ;;
    mariadb-root-password)
      if [[ -n "${MARIADB_ROOT_PASSWORD_NEW}" ]]; then
        updated="${MARIADB_ROOT_PASSWORD_NEW}"
      fi
      ;;
    mariadb-replication-password)
      if [[ -n "${MARIADB_REPLICATION_PASSWORD_NEW}" ]]; then
        updated="${MARIADB_REPLICATION_PASSWORD_NEW}"
      fi
      ;;
  esac

  printf '%s' "${updated}"
}

patch_additional_db_redis_secrets() {
  local patched_count="0"
  local scanned_count="0"
  local namespace secret_name key current updated keys_blob
  local -a candidate_keys
  local -A candidate_lookup

  candidate_keys=(
    "DATABASE_URL" "DB_CONNECTION" "REDIS_URL" "REDIS_CONNECTION" "REDIS_PASS" "REDIS_PASSWORD"
    "SECRET_KEY" "PRIVATE_KEY"
    "RABBIT_PASSWORD"
    "redis-password"
    "HARBOR_ADMIN_PASSWORD" "secretKey" "secret" "CORE_SECRET" "CSRF_KEY" "JOBSERVICE_SECRET" "REGISTRY_HTTP_SECRET" "REGISTRY_PASSWD"
    "mariadb-password" "mariadb-root-password" "mariadb-replication-password"
  )

  for key in "${candidate_keys[@]}"; do
    candidate_lookup["${key}"]=1
  done

  while IFS='|' read -r namespace secret_name; do
    [[ -n "${namespace}" && -n "${secret_name}" ]] || continue
    scanned_count=$((scanned_count + 1))

    if [[ "${DEBUG_MODE}" == "true" && $((scanned_count % 25)) -eq 0 ]]; then
      echo "    [debug] scanned ${scanned_count} secrets, patched ${patched_count} keys so far"
    fi

    if [[ "${namespace}" == "ctfd" ]]; then
      debug_log "skip ${namespace}/${secret_name}"
      continue
    fi

    keys_blob="$(get_secret_keys "${namespace}" "${secret_name}")"
    [[ -n "${keys_blob}" ]] || continue

    while IFS= read -r key; do
      [[ -n "${key}" ]] || continue
      [[ -n "${candidate_lookup[${key}]+x}" ]] || continue

      current="$(get_secret_value "${namespace}" "${secret_name}" "${key}" || true)"
      [[ -n "${current}" ]] || continue

      updated="$(transform_secret_value "${namespace}" "${secret_name}" "${key}" "${current}")"
      if [[ "${updated}" != "${current}" ]]; then
        patch_secret_string_key "${namespace}" "${secret_name}" "${key}" "${updated}"
        patched_count=$((patched_count + 1))
        echo "    patched ${namespace}/${secret_name}:${key}"
      fi
    done <<< "${keys_blob}"
  done < <(kubectl get secrets -A -o jsonpath='{range .items[*]}{.metadata.namespace}{"|"}{.metadata.name}{"\n"}{end}')

  if [[ "${DEBUG_MODE}" == "true" ]]; then
    echo "    [debug] completed scan of ${scanned_count} secrets"
  fi
  echo "==> Additional secret keys patched: ${patched_count}"
}

restart_deployments() {
  local deployments=(
    "admin-mvc"
    "contestant-be"
    "deployment-center"
    "deployment-listener"
    "deployment-consumer"
    "challenge-gateway"
  )
  local dep

  echo "==> Restarting app deployments to reload env from Secret"
  for dep in "${deployments[@]}"; do
    kubectl -n "${APP_NAMESPACE}" rollout restart "deployment/${dep}"
  done

  echo "==> Waiting rollout status"
  for dep in "${deployments[@]}"; do
    kubectl -n "${APP_NAMESPACE}" rollout status "deployment/${dep}" --timeout=600s
  done
}

restart_mariadb_workload() {
  local ns="db"
  if ! kubectl -n "${ns}" get statefulset mariadb >/dev/null 2>&1; then
    echo "Error: mariadb statefulset not found in namespace '${ns}'."
    exit 1
  fi

  kubectl -n "${ns}" rollout restart statefulset/mariadb
  kubectl -n "${ns}" rollout status statefulset/mariadb --timeout=600s
}

restart_rabbitmq_workload() {
  local ns="db"
  if ! kubectl -n "${ns}" get statefulset rabbitmq >/dev/null 2>&1; then
    echo "Error: rabbitmq statefulset not found in namespace '${ns}'."
    exit 1
  fi

  kubectl -n "${ns}" rollout restart statefulset/rabbitmq
  kubectl -n "${ns}" rollout status statefulset/rabbitmq --timeout=600s
}

apply_mariadb_all_user_password_changes() {
  local mysql_cmd="mysql"
  local sql

  sql="ALTER USER IF EXISTS 'ctfd-username'@'%' IDENTIFIED BY '${MARIADB_CTFD_PASSWORD_NEW}';"
  sql+=" ALTER USER IF EXISTS 'replicator'@'%' IDENTIFIED BY '${MARIADB_REPLICATION_PASSWORD_NEW}';"
  sql+=" ALTER USER IF EXISTS 'root'@'%' IDENTIFIED BY '${MARIADB_ROOT_PASSWORD_NEW}';"
  sql+=" ALTER USER IF EXISTS 'root'@'localhost' IDENTIFIED BY '${MARIADB_ROOT_PASSWORD_NEW}';"
  sql+=" ALTER USER IF EXISTS 'contestant_be'@'%' IDENTIFIED BY '${MARIADB_CONTESTANT_BE_PASSWORD_NEW}';"
  sql+=" ALTER USER IF EXISTS 'deployment_center'@'%' IDENTIFIED BY '${MARIADB_DEPLOYMENT_CENTER_PASSWORD_NEW}';"
  sql+=" ALTER USER IF EXISTS 'deployment_listener'@'%' IDENTIFIED BY '${MARIADB_DEPLOYMENT_LISTENER_PASSWORD_NEW}';"
  sql+=" ALTER USER IF EXISTS 'deployment_consumer'@'%' IDENTIFIED BY '${MARIADB_DEPLOYMENT_CONSUMER_PASSWORD_NEW}';"
  sql+=" FLUSH PRIVILEGES;"

  if ! kubectl -n "${DB_NAMESPACE}" exec "${MARIADB_POD}" -- sh -ec "command -v mysql >/dev/null 2>&1"; then
    mysql_cmd="/opt/bitnami/mariadb/bin/mysql"
  fi

  if kubectl -n "${DB_NAMESPACE}" exec "${MARIADB_POD}" -- sh -ec "${mysql_cmd} -uroot -p\"${MARIADB_ROOT_PASSWORD_OLD}\" -e \"${sql}\"" >/dev/null 2>&1; then
    echo "    applied SQL ALTER USER for core + service DB users in ${DB_NAMESPACE}/${MARIADB_POD}"
    return 0
  fi

  echo "Error: failed to apply MariaDB ALTER USER statements with current root password."
  echo "Hint: verify ${DB_NAMESPACE}/mariadb-auth-secret:mariadb-root-password matches actual DB root password."
  return 1
}

set_redis_acl_user_password() {
  local username="$1"
  local password="$2"

  if [[ -z "${password}" ]]; then
    return 0
  fi

  if kubectl -n "${DB_NAMESPACE}" exec "${REDIS_POD}" -- \
    env "REDISCLI_AUTH=${REDIS_ROOT_PASSWORD}" \
    /opt/bitnami/redis/bin/redis-cli --no-auth-warning -h 127.0.0.1 -p 6379 \
    ACL SETUSER "${username}" on ">${password}" >/dev/null 2>&1; then
    return 0
  fi

  if kubectl -n "${DB_NAMESPACE}" exec "${REDIS_POD}" -- \
    env "REDISCLI_AUTH=${REDIS_ROOT_PASSWORD}" \
    /opt/bitnami/redis/bin/redis-cli --no-auth-warning --tls --insecure -h 127.0.0.1 -p 6379 \
    ACL SETUSER "${username}" on ">${password}" >/dev/null 2>&1; then
    return 0
  fi

  echo "Error: failed to rotate Redis ACL password for user '${username}'."
  echo "Hint: Redis may require TLS-only access; non-TLS and TLS attempts both failed."
  return 1
}

set_redis_default_password() {
  local new_password="$1"

  if [[ -z "${new_password}" ]]; then
    return 0
  fi

  if kubectl -n "${DB_NAMESPACE}" exec "${REDIS_POD}" -- \
    env "REDISCLI_AUTH=${REDIS_ROOT_PASSWORD}" \
    /opt/bitnami/redis/bin/redis-cli --no-auth-warning -h 127.0.0.1 -p 6379 \
    ACL SETUSER default on ">${new_password}" >/dev/null 2>&1; then
    return 0
  fi

  if kubectl -n "${DB_NAMESPACE}" exec "${REDIS_POD}" -- \
    env "REDISCLI_AUTH=${REDIS_ROOT_PASSWORD}" \
    /opt/bitnami/redis/bin/redis-cli --no-auth-warning --tls --insecure -h 127.0.0.1 -p 6379 \
    ACL SETUSER default on ">${new_password}" >/dev/null 2>&1; then
    return 0
  fi

  echo "Error: failed to rotate Redis default password."
  return 1
}

require_command kubectl
require_command base64
require_command awk
require_command tr
require_command head
require_command sed

if [[ ! -d "${PROD_DIR}" ]]; then
  echo "Error: prod directory not found at ${PROD_DIR}"
  exit 1
fi

echo "============================================================"
echo "Rotate Service + Infrastructure Credentials"
echo "============================================================"
echo "Mode: rotate Redis + RabbitMQ producer/consumer + MariaDB + Harbor credentials."
echo "Note: rabbit-admin/Harbor admin/Rancher/Grafana admins are not rotated."
echo "Note: RABBIT_PASSWORD is rotated only for deployment-center-secret/deployment-consumer-secret."
echo

MARIADB_CTFD_PASSWORD_NEW=""
MARIADB_ROOT_PASSWORD_NEW=""
MARIADB_REPLICATION_PASSWORD_NEW=""
MARIADB_ROOT_PASSWORD_OLD=""
MARIADB_CONTESTANT_BE_PASSWORD_NEW=""
MARIADB_DEPLOYMENT_CENTER_PASSWORD_NEW=""
MARIADB_DEPLOYMENT_LISTENER_PASSWORD_NEW=""
MARIADB_DEPLOYMENT_CONSUMER_PASSWORD_NEW=""

ADMIN_REDIS_PASSWORD=""
GATEWAY_REDIS_PASSWORD=""
CONTESTANT_BE_REDIS_PASSWORD=""
DEPLOYMENT_CENTER_REDIS_PASSWORD=""
DEPLOYMENT_LISTENER_REDIS_PASSWORD=""
DEPLOYMENT_CONSUMER_REDIS_PASSWORD=""
REDIS_ROOT_PASSWORD_NEW=""
APP_SECRET_KEY_NEW=""
APP_PRIVATE_KEY_NEW=""

RABBIT_PRODUCER_PASSWORD=""
RABBIT_CONSUMER_PASSWORD=""

HARBOR_ADMIN_PASSWORD=""
HARBOR_REGISTRY_PASSWORD=""
HARBOR_REGISTRY_USERNAME=""
HARBOR_REGISTRY_HTPASSWD=""
HARBOR_SECRET_KEY=""
HARBOR_CORE_SECRET=""
HARBOR_CSRF_KEY=""
HARBOR_JOBSERVICE_SECRET=""
HARBOR_REGISTRY_HTTP_SECRET=""
HARBOR_DATABASE_PASSWORD=""
HARBOR_DATABASE_PASSWORD_OLD=""
HARBOR_CORE_TLS_CRT=""
HARBOR_CORE_TLS_KEY=""

echo "==> Generating new passwords"
MARIADB_CTFD_PASSWORD_NEW="$(generate_random_secret 50)"
MARIADB_ROOT_PASSWORD_NEW="$(generate_random_secret 50)"
MARIADB_REPLICATION_PASSWORD_NEW="$(generate_random_secret 50)"
MARIADB_CONTESTANT_BE_PASSWORD_NEW="$(generate_random_secret 50)"
MARIADB_DEPLOYMENT_CENTER_PASSWORD_NEW="$(generate_random_secret 50)"
MARIADB_DEPLOYMENT_LISTENER_PASSWORD_NEW="$(generate_random_secret 50)"
MARIADB_DEPLOYMENT_CONSUMER_PASSWORD_NEW="$(generate_random_secret 50)"

ADMIN_REDIS_PASSWORD="$(generate_random_secret 50)"
GATEWAY_REDIS_PASSWORD="$(generate_random_secret 50)"
CONTESTANT_BE_REDIS_PASSWORD="$(generate_random_secret 50)"
DEPLOYMENT_CENTER_REDIS_PASSWORD="$(generate_random_secret 50)"
DEPLOYMENT_LISTENER_REDIS_PASSWORD="$(generate_random_secret 50)"
DEPLOYMENT_CONSUMER_REDIS_PASSWORD="$(generate_random_secret 50)"
REDIS_ROOT_PASSWORD_NEW="$(generate_random_secret 50)"
APP_SECRET_KEY_NEW="$(generate_random_secret 50)"
APP_PRIVATE_KEY_NEW="$(generate_random_secret 64)"

RABBIT_PRODUCER_PASSWORD="$(generate_random_secret 50)"
RABBIT_CONSUMER_PASSWORD="$(generate_random_secret 50)"

echo "==> Rotation plan"
echo "    Redis ACL users:             ${NEED_REDIS_ROTATION}"
echo "    Redis default password:      ${NEED_REDIS_ROTATION}"
echo "    RabbitMQ producer/consumer:  ${ROTATE_RABBITMQ}"
echo "    App SECRET/PRIVATE keys:     true"
echo "    MariaDB core SQL + secret:   ${NEED_MARIADB_ROTATION}"
echo "    MariaDB service SQL rotate:  ${NEED_MARIADB_ROTATION}"
echo "    Harbor credential rotate:    ${ROTATE_HARBOR}"

echo
echo "==> Discovering required pods"
REDIS_POD=""
RABBITMQ_POD=""
MARIADB_POD=""

if [[ "${NEED_REDIS_ROTATION}" == "true" ]]; then
  REDIS_POD="$(get_pod_name "${DB_NAMESPACE}" "redis-master-0" "app.kubernetes.io/instance=redis,app.kubernetes.io/name=redis" || true)"
fi

if [[ "${ROTATE_RABBITMQ}" == "true" ]]; then
  RABBITMQ_POD="$(get_pod_name "${DB_NAMESPACE}" "rabbitmq-0" "app.kubernetes.io/instance=rabbitmq,app.kubernetes.io/name=rabbitmq" || true)"
fi

if [[ "${NEED_MARIADB_ROTATION}" == "true" ]]; then
  MARIADB_POD="$(get_pod_name "${DB_NAMESPACE}" "mariadb-0" "app.kubernetes.io/instance=mariadb,app.kubernetes.io/name=mariadb" || true)"
fi

if [[ "${NEED_REDIS_ROTATION}" == "true" && -z "${REDIS_POD}" ]]; then
  echo "Error: cannot find Redis pod in namespace '${DB_NAMESPACE}'."
  exit 1
fi

if [[ "${ROTATE_RABBITMQ}" == "true" && -z "${RABBITMQ_POD}" ]]; then
  echo "Error: cannot find RabbitMQ pod in namespace '${DB_NAMESPACE}'."
  exit 1
fi

if [[ "${NEED_MARIADB_ROTATION}" == "true" && -z "${MARIADB_POD}" ]]; then
  echo "Error: cannot find MariaDB pod in namespace '${DB_NAMESPACE}'."
  exit 1
fi

if [[ "${NEED_REDIS_ROTATION}" == "true" ]]; then
  echo "    Redis pod:    ${REDIS_POD}"
fi
if [[ "${ROTATE_RABBITMQ}" == "true" ]]; then
  echo "    RabbitMQ pod: ${RABBITMQ_POD}"
fi
if [[ "${NEED_MARIADB_ROTATION}" == "true" ]]; then
  echo "    MariaDB pod:  ${MARIADB_POD}"
fi

if [[ "${NEED_MARIADB_ROTATION}" == "true" ]]; then
  echo
  echo "==> Rotating MariaDB core credentials + service DB users (SQL + secret)"
  if ! kubectl -n "${DB_NAMESPACE}" get secret mariadb-auth-secret >/dev/null 2>&1; then
    echo "Error: secret ${DB_NAMESPACE}/mariadb-auth-secret not found."
    exit 1
  fi

  MARIADB_ROOT_PASSWORD_OLD="$(get_secret_value "${DB_NAMESPACE}" "mariadb-auth-secret" "mariadb-root-password" || true)"
  if [[ -z "${MARIADB_ROOT_PASSWORD_OLD}" ]]; then
    echo "Error: cannot read current root password from ${DB_NAMESPACE}/mariadb-auth-secret."
    exit 1
  fi

  patch_secret_string_key "${DB_NAMESPACE}" "mariadb-auth-secret" "mariadb-password" "${MARIADB_CTFD_PASSWORD_NEW}"
  patch_secret_string_key "${DB_NAMESPACE}" "mariadb-auth-secret" "mariadb-root-password" "${MARIADB_ROOT_PASSWORD_NEW}"
  patch_secret_string_key "${DB_NAMESPACE}" "mariadb-auth-secret" "mariadb-replication-password" "${MARIADB_REPLICATION_PASSWORD_NEW}"
  echo "    patched ${DB_NAMESPACE}/mariadb-auth-secret:mariadb-password"
  echo "    patched ${DB_NAMESPACE}/mariadb-auth-secret:mariadb-root-password"
  echo "    patched ${DB_NAMESPACE}/mariadb-auth-secret:mariadb-replication-password"
fi

if [[ "${NEED_REDIS_ROTATION}" == "true" ]]; then
  echo
  echo "==> Auto-loading current Redis default password"
  REDIS_ROOT_PASSWORD="$(kubectl -n "${DB_NAMESPACE}" exec "${REDIS_POD}" -- cat /opt/bitnami/redis/secrets/redis-password 2>/dev/null || true)"
  if [[ -z "${REDIS_ROOT_PASSWORD}" ]]; then
    REDIS_ROOT_PASSWORD="$(get_secret_value "${DB_NAMESPACE}" "redis" "redis-password" || true)"
  fi

  if [[ -z "${REDIS_ROOT_PASSWORD}" ]]; then
    echo "Error: cannot auto-load Redis default password from pod or secret."
    exit 1
  fi

  echo "==> Rotating Redis ACL users + default password"
  set_redis_acl_user_password "svc_admin_mvc" "${ADMIN_REDIS_PASSWORD}"
  set_redis_acl_user_password "svc_gateway" "${GATEWAY_REDIS_PASSWORD}"
  set_redis_acl_user_password "svc_contestant_be" "${CONTESTANT_BE_REDIS_PASSWORD}"
  set_redis_acl_user_password "svc_deployment_center" "${DEPLOYMENT_CENTER_REDIS_PASSWORD}"
  set_redis_acl_user_password "svc_deployment_listener" "${DEPLOYMENT_LISTENER_REDIS_PASSWORD}"
  set_redis_acl_user_password "svc_deployment_consumer" "${DEPLOYMENT_CONSUMER_REDIS_PASSWORD}"
  set_redis_default_password "${REDIS_ROOT_PASSWORD_NEW}"

  if kubectl -n "${DB_NAMESPACE}" get secret redis >/dev/null 2>&1; then
    patch_secret_string_key "${DB_NAMESPACE}" "redis" "redis-password" "${REDIS_ROOT_PASSWORD_NEW}"
    echo "    patched ${DB_NAMESPACE}/redis:redis-password"
  fi
fi

if [[ "${ROTATE_RABBITMQ}" == "true" ]]; then
  echo
  echo "==> Rotating RabbitMQ producer/consumer passwords"
  kubectl -n "${DB_NAMESPACE}" exec "${RABBITMQ_POD}" -- rabbitmqctl change_password deployment-producer "${RABBIT_PRODUCER_PASSWORD}" >/dev/null
  kubectl -n "${DB_NAMESPACE}" exec "${RABBITMQ_POD}" -- rabbitmqctl change_password deployment-consumer "${RABBIT_CONSUMER_PASSWORD}" >/dev/null

  patch_rabbitmq_definition_secret
fi

if [[ "${ROTATE_HARBOR}" == "true" ]]; then
  echo
  echo "==> Rotating Harbor credentials and patching Harbor secrets"
  load_harbor_static_values

  if [[ "${SKIP_ROLLOUT_RESTART}" != "true" ]]; then
    scale_harbor_deployments_down
  fi

  if [[ -n "${HARBOR_DATABASE_PASSWORD}" ]]; then
    HARBOR_DATABASE_PASSWORD_OLD="$(discover_harbor_database_current_password || true)"
    if [[ -z "${HARBOR_DATABASE_PASSWORD_OLD}" ]]; then
      echo "Error: cannot discover current Harbor Postgres password from registry secrets."
      exit 1
    fi
  fi

  prepare_harbor_rotation_values
  patch_harbor_secrets
fi

echo
echo "==> Patching additional related credential keys in all other secrets"
patch_additional_db_redis_secrets

if [[ "${NEED_MARIADB_ROTATION}" == "true" ]]; then
  echo
  echo "==> Applying MariaDB SQL password changes (late step before restarts)"
  apply_mariadb_all_user_password_changes

  if [[ "${SKIP_ROLLOUT_RESTART}" == "true" ]]; then
    echo "Warning: MariaDB SQL passwords changed but rollout restarts are skipped; services may fail auth until restarted."
  fi
fi

if [[ "${ROTATE_HARBOR}" == "true" && -n "${HARBOR_DATABASE_PASSWORD}" ]]; then
  echo
  echo "==> Applying Harbor Postgres password change (late step before restarts)"
  apply_harbor_database_password_change

  if [[ "${SKIP_ROLLOUT_RESTART}" == "true" ]]; then
    echo "Warning: Harbor Postgres password changed but rollout restarts are skipped; Harbor components may fail auth until restarted."
  fi
fi

RESTART_APP_DEPLOYMENTS="false"
if [[ "${NEED_REDIS_ROTATION}" == "true" || "${NEED_MARIADB_ROTATION}" == "true" || "${ROTATE_RABBITMQ}" == "true" ]]; then
  RESTART_APP_DEPLOYMENTS="true"
fi

if [[ "${SKIP_ROLLOUT_RESTART}" != "true" ]]; then
  if [[ "${ROTATE_HARBOR}" == "true" ]]; then
    restart_harbor_workloads
  fi

  if [[ "${NEED_MARIADB_ROTATION}" == "true" ]]; then
    restart_mariadb_workload
  fi

  if [[ "${ROTATE_RABBITMQ}" == "true" ]]; then
    restart_rabbitmq_workload
  fi

  if [[ "${RESTART_APP_DEPLOYMENTS}" == "true" ]]; then
    restart_deployments
  fi
else
  echo "==> Skip rollout restart as requested"
fi

echo
echo "DONE: Password rotation completed successfully."
