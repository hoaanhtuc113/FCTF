#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROD_DIR="${SCRIPT_DIR}/prod"

DB_NAMESPACE="db"
APP_NAMESPACE="app"

MARIADB_HOST="mariadb-headless.db.svc.cluster.local"
MARIADB_PORT="3306"
MARIADB_DATABASE="ctfd"

REDIS_HOST="redis-headless.db.svc.cluster.local"
REDIS_PORT="6379"

SKIP_ROLLOUT_RESTART="false"

ROTATE_RABBITMQ="true"
ROTATE_HARBOR="true"
ROTATE_RANCHER="true"
ROTATE_GRAFANA="true"
HASH_TOOL_READY="false"

usage() {
  cat <<EOF
Usage:
  $0 [--skip-rollout-restart]

Description:
  Rotate credentials for app services and infrastructure services.
  The script will:
    1) Auto-generate new passwords/secrets (50 chars, [A-Za-z0-9])
    2) Auto-read current root credentials where needed
    3) Rotate MariaDB, Redis, RabbitMQ users
    4) Rotate Harbor (admin, db, core/job/registry secrets)
    5) Rotate Rancher bootstrap and Grafana admin secrets
    6) Patch matching Kubernetes Secrets (excluding ctfd namespace)
    7) Restart workloads so runtime picks up new secrets

  Note:
    - When Harbor REGISTRY_HTPASSWD is present, script will auto-install
      htpasswd/openssl if both are missing.

Options:
  --skip-rollout-restart   Do not restart workloads after secret rotation
  -h, --help               Show help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-rollout-restart)
      SKIP_ROLLOUT_RESTART="true"
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
  if command -v htpasswd >/dev/null 2>&1 || command -v openssl >/dev/null 2>&1; then
    HASH_TOOL_READY="true"
    return 0
  fi

  echo "==> htpasswd/openssl not found, attempting auto-install"

  if command -v apt-get >/dev/null 2>&1; then
    run_privileged apt-get update -y >/dev/null
    run_privileged apt-get install -y apache2-utils openssl >/dev/null
  elif command -v dnf >/dev/null 2>&1; then
    run_privileged dnf install -y httpd-tools openssl >/dev/null
  elif command -v yum >/dev/null 2>&1; then
    run_privileged yum install -y httpd-tools openssl >/dev/null
  elif command -v apk >/dev/null 2>&1; then
    run_privileged apk add --no-cache apache2-utils openssl >/dev/null
  elif command -v zypper >/dev/null 2>&1; then
    run_privileged zypper --non-interactive install apache2-utils openssl >/dev/null
  elif command -v pacman >/dev/null 2>&1; then
    run_privileged pacman -Sy --noconfirm apache openssl >/dev/null
  else
    echo "Error: no supported package manager found for auto-install (apt/dnf/yum/apk/zypper/pacman)."
    return 1
  fi

  if command -v htpasswd >/dev/null 2>&1 || command -v openssl >/dev/null 2>&1; then
    HASH_TOOL_READY="true"
    echo "==> Hash-generation tool installed successfully"
    return 0
  fi

  echo "Error: auto-install completed but htpasswd/openssl is still unavailable."
  return 1
}

ensure_hash_generation_tool() {
  if [[ "${HASH_TOOL_READY}" == "true" ]]; then
    return 0
  fi

  if command -v htpasswd >/dev/null 2>&1 || command -v openssl >/dev/null 2>&1; then
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
    # Temporarily disable pipefail because tr may exit with SIGPIPE when head closes early.
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

sql_escape() {
  local input="$1"
  printf '%s' "${input//\'/\'\'}"
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
  raw="$(kubectl -n "${namespace}" get secret "${secret_name}" -o "jsonpath={.data['${key}']}" 2>/dev/null || true)"
  if [[ -z "${raw}" ]]; then
    return 1
  fi

  printf '%s' "${raw}" | base64 --decode
}

apply_secret_from_literals() {
  local namespace="$1"
  local secret_name="$2"
  shift 2

  local cmd=(kubectl -n "${namespace}" create secret generic "${secret_name}" --dry-run=client -o yaml)

  while [[ $# -gt 1 ]]; do
    local key="$1"
    local value="$2"
    shift 2
    cmd+=(--from-literal="${key}=${value}")
  done

  "${cmd[@]}" | kubectl apply -f - >/dev/null
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

db_password_for_user() {
  local username="$1"
  case "${username}" in
    ctfd-username) printf '%s' "${ADMIN_DB_PASSWORD}" ;;
    contestant_be) printf '%s' "${CONTESTANT_BE_DB_PASSWORD}" ;;
    deployment_center) printf '%s' "${DEPLOYMENT_CENTER_DB_PASSWORD}" ;;
    deployment_listener) printf '%s' "${DEPLOYMENT_LISTENER_DB_PASSWORD}" ;;
    deployment_consumer) printf '%s' "${DEPLOYMENT_CONSUMER_DB_PASSWORD}" ;;
    *) printf '' ;;
  esac
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

rabbit_password_for_key() {
  local key="$1"
  case "${key}" in
    rabbitmq-password) printf '%s' "${RABBIT_ADMIN_PASSWORD}" ;;
    rabbitmq-erlang-cookie|RABBITMQ_ERLANG_COOKIE) printf '%s' "${RABBIT_ERLANG_COOKIE}" ;;
    RABBIT_PASSWORD)
      case "${CURRENT_SECRET_NAME}" in
        deployment-center-secret) printf '%s' "${RABBIT_PRODUCER_PASSWORD}" ;;
        deployment-consumer-secret) printf '%s' "${RABBIT_CONSUMER_PASSWORD}" ;;
        *) printf '' ;;
      esac
      ;;
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

  updated_json="$(replace_rabbitmq_user_password_in_definition "${current_json}" "rabbit-admin" "${RABBIT_ADMIN_PASSWORD}")"
  updated_json="$(replace_rabbitmq_user_password_in_definition "${updated_json}" "deployment-producer" "${RABBIT_PRODUCER_PASSWORD}")"
  updated_json="$(replace_rabbitmq_user_password_in_definition "${updated_json}" "deployment-consumer" "${RABBIT_CONSUMER_PASSWORD}")"

  if [[ "${updated_json}" != "${current_json}" ]]; then
    patch_secret_string_key "${DB_NAMESPACE}" "${secret_name}" "${key_name}" "${updated_json}"
    echo "    patched ${DB_NAMESPACE}/${secret_name}:${key_name}"
  fi
}

patch_harbor_secrets() {
  local patched="0"
  local harbor_ns="registry"
  local secret_name current registry_user htpasswd_entry
  local seen="0"

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

    if command -v openssl >/dev/null 2>&1; then
      local hash
      hash="$(openssl passwd -apr1 "${password}" 2>/dev/null || true)"
      if [[ -n "${hash}" ]]; then
        printf '%s:%s' "${username}" "${hash}"
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

  while IFS= read -r secret_name; do
    [[ -n "${secret_name}" ]] || continue

    if [[ "${secret_name}" != *harbor* ]]; then
      continue
    fi

    current="$(get_secret_value "${harbor_ns}" "${secret_name}" "HARBOR_ADMIN_PASSWORD" || true)"
    if [[ -n "${current}" && -n "${HARBOR_ADMIN_PASSWORD}" ]]; then
      seen=$((seen + 1))
      patch_secret_string_key "${harbor_ns}" "${secret_name}" "HARBOR_ADMIN_PASSWORD" "${HARBOR_ADMIN_PASSWORD}"
      patched=$((patched + 1))
      echo "    patched ${harbor_ns}/${secret_name}:HARBOR_ADMIN_PASSWORD"
    fi

    current="$(get_secret_value "${harbor_ns}" "${secret_name}" "secretKey" || true)"
    if [[ -n "${current}" && -n "${HARBOR_SECRET_KEY}" ]]; then
      seen=$((seen + 1))
      patch_secret_string_key "${harbor_ns}" "${secret_name}" "secretKey" "${HARBOR_SECRET_KEY}"
      patched=$((patched + 1))
      echo "    patched ${harbor_ns}/${secret_name}:secretKey"
    fi

    current="$(get_secret_value "${harbor_ns}" "${secret_name}" "CSRF_KEY" || true)"
    if [[ -n "${current}" && -n "${HARBOR_CSRF_KEY}" ]]; then
      seen=$((seen + 1))
      patch_secret_string_key "${harbor_ns}" "${secret_name}" "CSRF_KEY" "${HARBOR_CSRF_KEY}"
      patched=$((patched + 1))
      echo "    patched ${harbor_ns}/${secret_name}:CSRF_KEY"
    fi

    current="$(get_secret_value "${harbor_ns}" "${secret_name}" "CORE_SECRET" || true)"
    if [[ -n "${current}" && -n "${HARBOR_CORE_SECRET}" ]]; then
      seen=$((seen + 1))
      patch_secret_string_key "${harbor_ns}" "${secret_name}" "CORE_SECRET" "${HARBOR_CORE_SECRET}"
      patched=$((patched + 1))
      echo "    patched ${harbor_ns}/${secret_name}:CORE_SECRET"
    fi

    if [[ "${secret_name}" == *"harbor-core"* ]]; then
      current="$(get_secret_value "${harbor_ns}" "${secret_name}" "secret" || true)"
      if [[ -n "${current}" && -n "${HARBOR_CORE_SECRET}" ]]; then
        seen=$((seen + 1))
        patch_secret_string_key "${harbor_ns}" "${secret_name}" "secret" "${HARBOR_CORE_SECRET}"
        patched=$((patched + 1))
        echo "    patched ${harbor_ns}/${secret_name}:secret"
      fi
    fi

    current="$(get_secret_value "${harbor_ns}" "${secret_name}" "JOBSERVICE_SECRET" || true)"
    if [[ -n "${current}" && -n "${HARBOR_JOBSERVICE_SECRET}" ]]; then
      seen=$((seen + 1))
      patch_secret_string_key "${harbor_ns}" "${secret_name}" "JOBSERVICE_SECRET" "${HARBOR_JOBSERVICE_SECRET}"
      patched=$((patched + 1))
      echo "    patched ${harbor_ns}/${secret_name}:JOBSERVICE_SECRET"
    fi

    current="$(get_secret_value "${harbor_ns}" "${secret_name}" "REGISTRY_HTTP_SECRET" || true)"
    if [[ -n "${current}" && -n "${HARBOR_REGISTRY_HTTP_SECRET}" ]]; then
      seen=$((seen + 1))
      patch_secret_string_key "${harbor_ns}" "${secret_name}" "REGISTRY_HTTP_SECRET" "${HARBOR_REGISTRY_HTTP_SECRET}"
      patched=$((patched + 1))
      echo "    patched ${harbor_ns}/${secret_name}:REGISTRY_HTTP_SECRET"
    fi

    current="$(get_secret_value "${harbor_ns}" "${secret_name}" "REGISTRY_PASSWD" || true)"
    if [[ -n "${current}" && -n "${HARBOR_REGISTRY_PASSWORD}" ]]; then
      seen=$((seen + 1))
      patch_secret_string_key "${harbor_ns}" "${secret_name}" "REGISTRY_PASSWD" "${HARBOR_REGISTRY_PASSWORD}"
      patched=$((patched + 1))
      echo "    patched ${harbor_ns}/${secret_name}:REGISTRY_PASSWD"
    fi

    current="$(get_secret_value "${harbor_ns}" "${secret_name}" "REGISTRY_HTPASSWD" || true)"
    if [[ -n "${current}" && -n "${HARBOR_REGISTRY_PASSWORD}" ]]; then
      if ! ensure_hash_generation_tool; then
        echo "Error: ${harbor_ns}/${secret_name} requires REGISTRY_HTPASSWD update but hash tool install failed."
        exit 1
      fi

      seen=$((seen + 1))
      registry_user="$(get_registry_username_from_secret "${harbor_ns}" "${secret_name}")"
      htpasswd_entry="$(generate_registry_htpasswd_entry "${registry_user}" "${HARBOR_REGISTRY_PASSWORD}" || true)"

      if [[ -n "${htpasswd_entry}" ]]; then
        patch_secret_string_key "${harbor_ns}" "${secret_name}" "REGISTRY_HTPASSWD" "${htpasswd_entry}"
        patched=$((patched + 1))
        echo "    patched ${harbor_ns}/${secret_name}:REGISTRY_HTPASSWD"
      else
        echo "Error: ${harbor_ns}/${secret_name} requires REGISTRY_HTPASSWD but cannot generate it (install htpasswd or openssl)."
        exit 1
      fi
    fi

    current="$(get_secret_value "${harbor_ns}" "${secret_name}" "POSTGRES_PASSWORD" || true)"
    if [[ -n "${current}" && -n "${HARBOR_DB_PASSWORD}" ]]; then
      seen=$((seen + 1))
      patch_secret_string_key "${harbor_ns}" "${secret_name}" "POSTGRES_PASSWORD" "${HARBOR_DB_PASSWORD}"
      patched=$((patched + 1))
      echo "    patched ${harbor_ns}/${secret_name}:POSTGRES_PASSWORD"
    fi

    current="$(get_secret_value "${harbor_ns}" "${secret_name}" "postgres-password" || true)"
    if [[ -n "${current}" && -n "${HARBOR_DB_PASSWORD}" ]]; then
      seen=$((seen + 1))
      patch_secret_string_key "${harbor_ns}" "${secret_name}" "postgres-password" "${HARBOR_DB_PASSWORD}"
      patched=$((patched + 1))
      echo "    patched ${harbor_ns}/${secret_name}:postgres-password"
    fi

    if [[ "${secret_name}" == *"harbor-database"* ]]; then
      current="$(get_secret_value "${harbor_ns}" "${secret_name}" "password" || true)"
      if [[ -n "${current}" && -n "${HARBOR_DB_PASSWORD}" ]]; then
        seen=$((seen + 1))
        patch_secret_string_key "${harbor_ns}" "${secret_name}" "password" "${HARBOR_DB_PASSWORD}"
        patched=$((patched + 1))
        echo "    patched ${harbor_ns}/${secret_name}:password"
      fi
    fi
  done < <(kubectl -n "${harbor_ns}" get secrets -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}' 2>/dev/null || true)

  if [[ "${seen}" -eq 0 ]]; then
    echo "Error: no Harbor secret keys discovered in namespace '${harbor_ns}'."
    exit 1
  fi

  echo "==> Harbor secret keys patched: ${patched}"
}

rotate_harbor_database_password() {
  local harbor_ns="registry"
  local current_password=""
  local sql_file=""
  local secret_name

  if [[ -z "${HARBOR_DB_POD}" ]]; then
    echo "Error: Harbor database pod not found."
    exit 1
  fi

  current_password="$(kubectl -n "${harbor_ns}" exec "${HARBOR_DB_POD}" -- sh -c 'cat /opt/bitnami/postgresql/secrets/postgres-password 2>/dev/null || cat /bitnami/postgresql/secrets/postgres-password 2>/dev/null || true' 2>/dev/null || true)"

  if [[ -z "${current_password}" ]]; then
    while IFS= read -r secret_name; do
      [[ "${secret_name}" == *harbor* ]] || continue
      current_password="$(get_secret_value "${harbor_ns}" "${secret_name}" "POSTGRES_PASSWORD" || true)"
      [[ -n "${current_password}" ]] && break
      current_password="$(get_secret_value "${harbor_ns}" "${secret_name}" "postgres-password" || true)"
      [[ -n "${current_password}" ]] && break
      if [[ "${secret_name}" == *"harbor-database"* ]]; then
        current_password="$(get_secret_value "${harbor_ns}" "${secret_name}" "password" || true)"
        [[ -n "${current_password}" ]] && break
      fi
    done < <(kubectl -n "${harbor_ns}" get secrets -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}')
  fi

  if [[ -z "${current_password}" ]]; then
    echo "Error: cannot read current Harbor DB password from pod/secret."
    exit 1
  fi

  sql_file="$(mktemp)"
  cat > "${sql_file}" <<EOF
ALTER USER postgres WITH PASSWORD '$(sql_escape "${HARBOR_DB_PASSWORD}")';
EOF

  if ! kubectl -n "${harbor_ns}" exec -i "${HARBOR_DB_POD}" -- env "PGPASSWORD=${current_password}" psql -U postgres -d postgres < "${sql_file}" >/dev/null 2>&1; then
    if ! kubectl -n "${harbor_ns}" exec -i "${HARBOR_DB_POD}" -- env "PGPASSWORD=${current_password}" /opt/bitnami/postgresql/bin/psql -U postgres -d postgres < "${sql_file}" >/dev/null 2>&1; then
      rm -f "${sql_file}"
      echo "Error: failed to rotate Harbor database password in Postgres."
      exit 1
    fi
  fi

  rm -f "${sql_file}"
  echo "==> Harbor database password rotated in Postgres"
}

restart_harbor_workloads() {
  local ns="registry"
  local -a deployments=("harbor-core" "harbor-jobservice" "harbor-portal" "harbor-registry" "harbor-nginx")
  local -a statefulsets=("harbor-database" "harbor-redis")
  local name

  echo "==> Restarting Harbor workloads"
  for name in "${deployments[@]}"; do
    if kubectl -n "${ns}" get deployment "${name}" >/dev/null 2>&1; then
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
}

patch_rancher_secrets() {
  local ns="cattle-system"
  local secret_name
  local patched="0"

  while IFS= read -r secret_name; do
    [[ -n "${secret_name}" ]] || continue
    if [[ "${secret_name}" != *bootstrap* && "${secret_name}" != *rancher* ]]; then
      continue
    fi

    if [[ -n "$(get_secret_value "${ns}" "${secret_name}" "bootstrapPassword" || true)" ]]; then
      patch_secret_string_key "${ns}" "${secret_name}" "bootstrapPassword" "${RANCHER_BOOTSTRAP_PASSWORD}"
      patched=$((patched + 1))
      echo "    patched ${ns}/${secret_name}:bootstrapPassword"
    fi

    if [[ -n "$(get_secret_value "${ns}" "${secret_name}" "RANCHER_BOOTSTRAP_PASSWORD" || true)" ]]; then
      patch_secret_string_key "${ns}" "${secret_name}" "RANCHER_BOOTSTRAP_PASSWORD" "${RANCHER_BOOTSTRAP_PASSWORD}"
      patched=$((patched + 1))
      echo "    patched ${ns}/${secret_name}:RANCHER_BOOTSTRAP_PASSWORD"
    fi
  done < <(kubectl -n "${ns}" get secrets -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}' 2>/dev/null || true)

  if [[ "${patched}" -eq 0 ]]; then
    echo "Error: Rancher bootstrap secret key not found in namespace '${ns}'."
    exit 1
  fi

  echo "==> Rancher secret keys patched: ${patched}"
}

patch_grafana_secrets() {
  local ns="monitoring"
  local secret_name
  local patched="0"

  while IFS= read -r secret_name; do
    [[ -n "${secret_name}" ]] || continue
    if [[ "${secret_name}" != *grafana* ]]; then
      continue
    fi

    if [[ -n "$(get_secret_value "${ns}" "${secret_name}" "admin-password" || true)" ]]; then
      patch_secret_string_key "${ns}" "${secret_name}" "admin-password" "${GRAFANA_ADMIN_PASSWORD}"
      patched=$((patched + 1))
      echo "    patched ${ns}/${secret_name}:admin-password"
    fi

    if [[ -n "$(get_secret_value "${ns}" "${secret_name}" "GF_SECURITY_ADMIN_PASSWORD" || true)" ]]; then
      patch_secret_string_key "${ns}" "${secret_name}" "GF_SECURITY_ADMIN_PASSWORD" "${GRAFANA_ADMIN_PASSWORD}"
      patched=$((patched + 1))
      echo "    patched ${ns}/${secret_name}:GF_SECURITY_ADMIN_PASSWORD"
    fi
  done < <(kubectl -n "${ns}" get secrets -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}' 2>/dev/null || true)

  if [[ "${patched}" -eq 0 ]]; then
    echo "Error: Grafana admin secret key not found in namespace '${ns}'."
    exit 1
  fi

  echo "==> Grafana secret keys patched: ${patched}"
}

restart_rancher_workload() {
  local ns="cattle-system"
  if ! kubectl -n "${ns}" get deployment rancher >/dev/null 2>&1; then
    echo "Error: rancher deployment not found in namespace '${ns}'."
    exit 1
  fi

  kubectl -n "${ns}" rollout restart deployment/rancher
  kubectl -n "${ns}" rollout status deployment/rancher --timeout=600s
}

restart_grafana_workloads() {
  local ns="monitoring"
  local dep
  local restarted="0"

  while IFS= read -r dep; do
    [[ -n "${dep}" ]] || continue
    if [[ "${dep}" == *grafana* ]]; then
      kubectl -n "${ns}" rollout restart "deployment/${dep}"
      restarted=$((restarted + 1))
    fi
  done < <(kubectl -n "${ns}" get deployments -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}' 2>/dev/null || true)

  if [[ "${restarted}" -eq 0 ]]; then
    echo "Error: no Grafana deployment found in namespace '${ns}'."
    exit 1
  fi

  while IFS= read -r dep; do
    [[ -n "${dep}" ]] || continue
    if [[ "${dep}" == *grafana* ]]; then
      kubectl -n "${ns}" rollout status "deployment/${dep}" --timeout=600s
    fi
  done < <(kubectl -n "${ns}" get deployments -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}')
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

  CURRENT_SECRET_NAME="${secret_name}"

  updated="${value}"

  case "${key}" in
    DATABASE_URL)
      updated="$(replace_url_password_for_user "${updated}" "ctfd-username" "${ADMIN_DB_PASSWORD}" "true")"
      ;;
    DB_CONNECTION)
      updated="$(replace_db_connection_password_for_user "${updated}" "ctfd-username" "${ADMIN_DB_PASSWORD}")"
      updated="$(replace_db_connection_password_for_user "${updated}" "contestant_be" "${CONTESTANT_BE_DB_PASSWORD}")"
      updated="$(replace_db_connection_password_for_user "${updated}" "deployment_center" "${DEPLOYMENT_CENTER_DB_PASSWORD}")"
      updated="$(replace_db_connection_password_for_user "${updated}" "deployment_listener" "${DEPLOYMENT_LISTENER_DB_PASSWORD}")"
      updated="$(replace_db_connection_password_for_user "${updated}" "deployment_consumer" "${DEPLOYMENT_CONSUMER_DB_PASSWORD}")"
      ;;
    REDIS_URL)
      updated="$(replace_url_password_for_user "${updated}" "svc_admin_mvc" "${ADMIN_REDIS_PASSWORD}" "true")"
      updated="$(replace_url_password_for_user "${updated}" "svc_gateway" "${GATEWAY_REDIS_PASSWORD}" "true")"
      updated="$(replace_url_password_for_user "${updated}" "svc_contestant_be" "${CONTESTANT_BE_REDIS_PASSWORD}" "true")"
      updated="$(replace_url_password_for_user "${updated}" "svc_deployment_center" "${DEPLOYMENT_CENTER_REDIS_PASSWORD}" "true")"
      updated="$(replace_url_password_for_user "${updated}" "svc_deployment_listener" "${DEPLOYMENT_LISTENER_REDIS_PASSWORD}" "true")"
      updated="$(replace_url_password_for_user "${updated}" "svc_deployment_consumer" "${DEPLOYMENT_CONSUMER_REDIS_PASSWORD}" "true")"
      ;;
    REDIS_CONNECTION)
      updated="$(replace_redis_connection_password_for_user "${updated}" "svc_admin_mvc" "${ADMIN_REDIS_PASSWORD}")"
      updated="$(replace_redis_connection_password_for_user "${updated}" "svc_gateway" "${GATEWAY_REDIS_PASSWORD}")"
      updated="$(replace_redis_connection_password_for_user "${updated}" "svc_contestant_be" "${CONTESTANT_BE_REDIS_PASSWORD}")"
      updated="$(replace_redis_connection_password_for_user "${updated}" "svc_deployment_center" "${DEPLOYMENT_CENTER_REDIS_PASSWORD}")"
      updated="$(replace_redis_connection_password_for_user "${updated}" "svc_deployment_listener" "${DEPLOYMENT_LISTENER_REDIS_PASSWORD}")"
      updated="$(replace_redis_connection_password_for_user "${updated}" "svc_deployment_consumer" "${DEPLOYMENT_CONSUMER_REDIS_PASSWORD}")"
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
    RABBIT_PASSWORD)
      if [[ "${ROTATE_RABBITMQ}" == "true" ]]; then
        password="$(rabbit_password_for_key "${key}")"
        if [[ -n "${password}" ]]; then
          updated="${password}"
        fi
      fi
      ;;
    rabbitmq-password|rabbitmq-erlang-cookie|RABBITMQ_ERLANG_COOKIE)
      if [[ "${ROTATE_RABBITMQ}" == "true" && "${namespace}" == "db" ]]; then
        password="$(rabbit_password_for_key "${key}")"
        if [[ -n "${password}" ]]; then
          updated="${password}"
        fi
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
    POSTGRES_PASSWORD|postgres-password)
      if [[ "${ROTATE_HARBOR}" == "true" && "${namespace}" == "registry" && "${secret_name}" == *harbor* && -n "${HARBOR_DB_PASSWORD}" ]]; then
        updated="${HARBOR_DB_PASSWORD}"
      fi
      ;;
    bootstrapPassword|RANCHER_BOOTSTRAP_PASSWORD)
      if [[ "${ROTATE_RANCHER}" == "true" && "${namespace}" == "cattle-system" && -n "${RANCHER_BOOTSTRAP_PASSWORD}" ]]; then
        updated="${RANCHER_BOOTSTRAP_PASSWORD}"
      fi
      ;;
    admin-password|GF_SECURITY_ADMIN_PASSWORD)
      if [[ "${ROTATE_GRAFANA}" == "true" && "${namespace}" == "monitoring" && "${secret_name}" == *grafana* && -n "${GRAFANA_ADMIN_PASSWORD}" ]]; then
        updated="${GRAFANA_ADMIN_PASSWORD}"
      fi
      ;;
    mariadb-password)
      updated="${ADMIN_DB_PASSWORD}"
      ;;
  esac

  printf '%s' "${updated}"
}

patch_additional_db_redis_secrets() {
  local patched_count="0"
  local namespace secret_name key current updated
  local -a candidate_keys
  candidate_keys=(
    "DATABASE_URL" "DB_CONNECTION" "REDIS_URL" "REDIS_CONNECTION" "REDIS_PASS" "REDIS_PASSWORD"
    "RABBIT_PASSWORD" "rabbitmq-password" "rabbitmq-erlang-cookie" "RABBITMQ_ERLANG_COOKIE"
    "HARBOR_ADMIN_PASSWORD" "secretKey" "secret" "CORE_SECRET" "CSRF_KEY" "JOBSERVICE_SECRET" "REGISTRY_HTTP_SECRET" "REGISTRY_PASSWD" "POSTGRES_PASSWORD" "postgres-password"
    "bootstrapPassword" "RANCHER_BOOTSTRAP_PASSWORD" "admin-password" "GF_SECURITY_ADMIN_PASSWORD"
    "mariadb-password"
  )

  while IFS='|' read -r namespace secret_name; do
    [[ -n "${namespace}" && -n "${secret_name}" ]] || continue

    if [[ "${namespace}" == "ctfd" ]]; then
      continue
    fi

    for key in "${candidate_keys[@]}"; do
      current="$(get_secret_value "${namespace}" "${secret_name}" "${key}" || true)"
      [[ -n "${current}" ]] || continue

      updated="$(transform_secret_value "${namespace}" "${secret_name}" "${key}" "${current}")"
      if [[ "${updated}" != "${current}" ]]; then
        patch_secret_string_key "${namespace}" "${secret_name}" "${key}" "${updated}"
        patched_count=$((patched_count + 1))
        echo "    patched ${namespace}/${secret_name}:${key}"
      fi
    done
  done < <(kubectl get secrets -A -o jsonpath='{range .items[*]}{.metadata.namespace}{"|"}{.metadata.name}{"\n"}{end}')

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

  echo "==> Restarting app deployments to reload env from Secret"
  local dep
  for dep in "${deployments[@]}"; do
    kubectl -n "${APP_NAMESPACE}" rollout restart "deployment/${dep}"
  done

  echo "==> Waiting rollout status"
  for dep in "${deployments[@]}"; do
    kubectl -n "${APP_NAMESPACE}" rollout status "deployment/${dep}" --timeout=600s
  done
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

require_command kubectl
require_command base64
require_command awk
require_command tr
require_command head

if [[ ! -d "${PROD_DIR}" ]]; then
  echo "Error: prod directory not found at ${PROD_DIR}"
  exit 1
fi

echo "============================================================"
echo "Rotate Service + Infrastructure Credentials"
echo "============================================================"
echo "Note: root credentials are auto-loaded where possible; you only input new required credentials."
echo

ADMIN_DB_PASSWORD=""
CONTESTANT_BE_DB_PASSWORD=""
DEPLOYMENT_CENTER_DB_PASSWORD=""
DEPLOYMENT_LISTENER_DB_PASSWORD=""
DEPLOYMENT_CONSUMER_DB_PASSWORD=""

ADMIN_REDIS_PASSWORD=""
GATEWAY_REDIS_PASSWORD=""
CONTESTANT_BE_REDIS_PASSWORD=""
DEPLOYMENT_CENTER_REDIS_PASSWORD=""
DEPLOYMENT_LISTENER_REDIS_PASSWORD=""
DEPLOYMENT_CONSUMER_REDIS_PASSWORD=""

echo "==> Generating NEW credentials (50 chars, [A-Za-z0-9])"

ADMIN_DB_PASSWORD="$(generate_random_secret 50)"
CONTESTANT_BE_DB_PASSWORD="$(generate_random_secret 50)"
DEPLOYMENT_CENTER_DB_PASSWORD="$(generate_random_secret 50)"
DEPLOYMENT_LISTENER_DB_PASSWORD="$(generate_random_secret 50)"
DEPLOYMENT_CONSUMER_DB_PASSWORD="$(generate_random_secret 50)"

ADMIN_REDIS_PASSWORD="$(generate_random_secret 50)"
GATEWAY_REDIS_PASSWORD="$(generate_random_secret 50)"
CONTESTANT_BE_REDIS_PASSWORD="$(generate_random_secret 50)"
DEPLOYMENT_CENTER_REDIS_PASSWORD="$(generate_random_secret 50)"
DEPLOYMENT_LISTENER_REDIS_PASSWORD="$(generate_random_secret 50)"
DEPLOYMENT_CONSUMER_REDIS_PASSWORD="$(generate_random_secret 50)"

RABBIT_ADMIN_PASSWORD=""
RABBIT_PRODUCER_PASSWORD=""
RABBIT_CONSUMER_PASSWORD=""
RABBIT_ERLANG_COOKIE=""

RABBIT_ADMIN_PASSWORD="$(generate_random_secret 50)"
RABBIT_PRODUCER_PASSWORD="$(generate_random_secret 50)"
RABBIT_CONSUMER_PASSWORD="$(generate_random_secret 50)"
RABBIT_ERLANG_COOKIE="$(generate_random_secret 50)"

HARBOR_ADMIN_PASSWORD=""
HARBOR_REGISTRY_PASSWORD=""
HARBOR_DB_PASSWORD=""
HARBOR_SECRET_KEY=""
HARBOR_CORE_SECRET=""
HARBOR_CSRF_KEY=""
HARBOR_JOBSERVICE_SECRET=""
HARBOR_REGISTRY_HTTP_SECRET=""

HARBOR_ADMIN_PASSWORD="$(generate_random_secret 50)"
HARBOR_DB_PASSWORD="$(generate_random_secret 50)"
HARBOR_SECRET_KEY="$(generate_random_secret 50)"
HARBOR_CORE_SECRET="$(generate_random_secret 50)"
HARBOR_CSRF_KEY="$(generate_random_secret 50)"
HARBOR_JOBSERVICE_SECRET="$(generate_random_secret 50)"
HARBOR_REGISTRY_HTTP_SECRET="$(generate_random_secret 50)"
HARBOR_REGISTRY_PASSWORD="$(generate_random_secret 50)"

RANCHER_BOOTSTRAP_PASSWORD=""
RANCHER_BOOTSTRAP_PASSWORD="$(generate_random_secret 50)"

GRAFANA_ADMIN_PASSWORD=""
GRAFANA_ADMIN_PASSWORD="$(generate_random_secret 50)"

echo "==> All NEW credentials generated successfully"

echo
echo "==> Discovering DB/Redis pods"
MARIADB_POD="$(get_pod_name "${DB_NAMESPACE}" "mariadb-0" "app.kubernetes.io/instance=mariadb,app.kubernetes.io/name=mariadb" || true)"
REDIS_POD="$(get_pod_name "${DB_NAMESPACE}" "redis-master-0" "app.kubernetes.io/instance=redis,app.kubernetes.io/name=redis" || true)"
RABBITMQ_POD=""
HARBOR_DB_POD=""
if [[ "${ROTATE_RABBITMQ}" == "true" ]]; then
  RABBITMQ_POD="$(get_pod_name "${DB_NAMESPACE}" "rabbitmq-0" "app.kubernetes.io/instance=rabbitmq,app.kubernetes.io/name=rabbitmq" || true)"
fi
if [[ "${ROTATE_HARBOR}" == "true" ]]; then
  HARBOR_DB_POD="$(get_pod_name "registry" "harbor-database-0" "app=harbor,component=database" || true)"
fi

if [[ -z "${MARIADB_POD}" ]]; then
  echo "Error: cannot find MariaDB pod in namespace '${DB_NAMESPACE}'."
  exit 1
fi

if [[ -z "${REDIS_POD}" ]]; then
  echo "Error: cannot find Redis pod in namespace '${DB_NAMESPACE}'."
  exit 1
fi

if [[ "${ROTATE_RABBITMQ}" == "true" && -z "${RABBITMQ_POD}" ]]; then
  echo "Error: cannot find RabbitMQ pod in namespace '${DB_NAMESPACE}'."
  exit 1
fi

if [[ "${ROTATE_HARBOR}" == "true" && -z "${HARBOR_DB_POD}" ]]; then
  echo "Error: cannot find Harbor database pod in namespace 'registry'."
  exit 1
fi

echo "    MariaDB pod: ${MARIADB_POD}"
echo "    Redis pod:   ${REDIS_POD}"
if [[ "${ROTATE_RABBITMQ}" == "true" ]]; then
  echo "    RabbitMQ pod:${RABBITMQ_POD}"
fi
if [[ "${ROTATE_HARBOR}" == "true" ]]; then
  echo "    Harbor DB pod:${HARBOR_DB_POD}"
fi

echo
echo "==> Auto-loading root credentials"
MARIADB_ROOT_PASSWORD="$(kubectl -n "${DB_NAMESPACE}" exec "${MARIADB_POD}" -- cat /opt/bitnami/mariadb/secrets/mariadb-root-password 2>/dev/null || true)"
if [[ -z "${MARIADB_ROOT_PASSWORD}" ]]; then
  MARIADB_ROOT_PASSWORD="$(get_secret_value "${DB_NAMESPACE}" "mariadb-auth-secret" "mariadb-root-password" || true)"
fi

if [[ -z "${MARIADB_ROOT_PASSWORD}" ]]; then
  echo "Error: cannot auto-load MariaDB root password from pod or secret."
  exit 1
fi

REDIS_ROOT_PASSWORD="$(kubectl -n "${DB_NAMESPACE}" exec "${REDIS_POD}" -- cat /opt/bitnami/redis/secrets/redis-password 2>/dev/null || true)"
if [[ -z "${REDIS_ROOT_PASSWORD}" ]]; then
  REDIS_ROOT_PASSWORD="$(get_secret_value "${DB_NAMESPACE}" "redis" "redis-password" || true)"
fi

if [[ -z "${REDIS_ROOT_PASSWORD}" ]]; then
  echo "Error: cannot auto-load Redis root/default password from pod or secret."
  exit 1
fi

echo "==> Updating MariaDB user passwords"
MARIADB_SQL_FILE="$(mktemp)"
trap 'rm -f "${MARIADB_SQL_FILE}"' EXIT

cat > "${MARIADB_SQL_FILE}" <<EOF
CREATE USER IF NOT EXISTS 'ctfd-username'@'%' IDENTIFIED BY '$(sql_escape "${ADMIN_DB_PASSWORD}")';
ALTER USER 'ctfd-username'@'%' IDENTIFIED BY '$(sql_escape "${ADMIN_DB_PASSWORD}")';

CREATE USER IF NOT EXISTS 'contestant_be'@'%' IDENTIFIED BY '$(sql_escape "${CONTESTANT_BE_DB_PASSWORD}")';
ALTER USER 'contestant_be'@'%' IDENTIFIED BY '$(sql_escape "${CONTESTANT_BE_DB_PASSWORD}")';

CREATE USER IF NOT EXISTS 'deployment_center'@'%' IDENTIFIED BY '$(sql_escape "${DEPLOYMENT_CENTER_DB_PASSWORD}")';
ALTER USER 'deployment_center'@'%' IDENTIFIED BY '$(sql_escape "${DEPLOYMENT_CENTER_DB_PASSWORD}")';

CREATE USER IF NOT EXISTS 'deployment_listener'@'%' IDENTIFIED BY '$(sql_escape "${DEPLOYMENT_LISTENER_DB_PASSWORD}")';
ALTER USER 'deployment_listener'@'%' IDENTIFIED BY '$(sql_escape "${DEPLOYMENT_LISTENER_DB_PASSWORD}")';

CREATE USER IF NOT EXISTS 'deployment_consumer'@'%' IDENTIFIED BY '$(sql_escape "${DEPLOYMENT_CONSUMER_DB_PASSWORD}")';
ALTER USER 'deployment_consumer'@'%' IDENTIFIED BY '$(sql_escape "${DEPLOYMENT_CONSUMER_DB_PASSWORD}")';

FLUSH PRIVILEGES;
EOF

kubectl -n "${DB_NAMESPACE}" exec -i "${MARIADB_POD}" -- \
  /opt/bitnami/mariadb/bin/mariadb --ssl=0 -uroot "-p${MARIADB_ROOT_PASSWORD}" < "${MARIADB_SQL_FILE}"

echo "==> Updating Redis ACL user passwords"
set_redis_acl_user_password() {
  local username="$1"
  local password="$2"

  # Try non-TLS first, then TLS (common with Bitnami Redis when tls.enabled=true).
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

set_redis_acl_user_password "svc_admin_mvc" "${ADMIN_REDIS_PASSWORD}"
set_redis_acl_user_password "svc_gateway" "${GATEWAY_REDIS_PASSWORD}"
set_redis_acl_user_password "svc_contestant_be" "${CONTESTANT_BE_REDIS_PASSWORD}"
set_redis_acl_user_password "svc_deployment_center" "${DEPLOYMENT_CENTER_REDIS_PASSWORD}"
set_redis_acl_user_password "svc_deployment_listener" "${DEPLOYMENT_LISTENER_REDIS_PASSWORD}"
set_redis_acl_user_password "svc_deployment_consumer" "${DEPLOYMENT_CONSUMER_REDIS_PASSWORD}"

if [[ "${ROTATE_RABBITMQ}" == "true" ]]; then
  echo "==> Updating RabbitMQ user passwords"
  kubectl -n "${DB_NAMESPACE}" exec "${RABBITMQ_POD}" -- rabbitmqctl change_password rabbit-admin "${RABBIT_ADMIN_PASSWORD}" >/dev/null
  kubectl -n "${DB_NAMESPACE}" exec "${RABBITMQ_POD}" -- rabbitmqctl change_password deployment-producer "${RABBIT_PRODUCER_PASSWORD}" >/dev/null
  kubectl -n "${DB_NAMESPACE}" exec "${RABBITMQ_POD}" -- rabbitmqctl change_password deployment-consumer "${RABBIT_CONSUMER_PASSWORD}" >/dev/null

  if kubectl -n "${DB_NAMESPACE}" get secret rabbitmq >/dev/null 2>&1; then
    patch_secret_string_key "${DB_NAMESPACE}" "rabbitmq" "rabbitmq-password" "${RABBIT_ADMIN_PASSWORD}"
    patch_secret_string_key "${DB_NAMESPACE}" "rabbitmq" "rabbitmq-erlang-cookie" "${RABBIT_ERLANG_COOKIE}"
    echo "    patched ${DB_NAMESPACE}/rabbitmq:rabbitmq-password"
    echo "    patched ${DB_NAMESPACE}/rabbitmq:rabbitmq-erlang-cookie"
  fi

  patch_rabbitmq_definition_secret
fi

echo "==> Building new connection strings"
ADMIN_DB_PASSWORD_URLENC="$(rawurlencode "${ADMIN_DB_PASSWORD}")"
ADMIN_REDIS_PASSWORD_URLENC="$(rawurlencode "${ADMIN_REDIS_PASSWORD}")"

ADMIN_DATABASE_URL="mysql+pymysql://ctfd-username:${ADMIN_DB_PASSWORD_URLENC}@${MARIADB_HOST}:${MARIADB_PORT}/${MARIADB_DATABASE}"
ADMIN_REDIS_URL="rediss://svc_admin_mvc:${ADMIN_REDIS_PASSWORD_URLENC}@${REDIS_HOST}:${REDIS_PORT}/0?ssl_cert_reqs=none"

CBE_DB_CONNECTION="Server=${MARIADB_HOST};Port=${MARIADB_PORT};Database=${MARIADB_DATABASE};User=contestant_be;Password=${CONTESTANT_BE_DB_PASSWORD};"
DPC_DB_CONNECTION="Server=${MARIADB_HOST};Port=${MARIADB_PORT};Database=${MARIADB_DATABASE};User=deployment_center;Password=${DEPLOYMENT_CENTER_DB_PASSWORD};"
DPSL_DB_CONNECTION="Server=${MARIADB_HOST};Port=${MARIADB_PORT};Database=${MARIADB_DATABASE};User=deployment_listener;Password=${DEPLOYMENT_LISTENER_DB_PASSWORD};"
DPSC_DB_CONNECTION="Server=${MARIADB_HOST};Port=${MARIADB_PORT};Database=${MARIADB_DATABASE};User=deployment_consumer;Password=${DEPLOYMENT_CONSUMER_DB_PASSWORD};"

CBE_REDIS_CONNECTION="${REDIS_HOST}:${REDIS_PORT},user=svc_contestant_be,password=${CONTESTANT_BE_REDIS_PASSWORD},defaultDatabase=0,ssl=true,sslProtocols=Tls12"
DPC_REDIS_CONNECTION="${REDIS_HOST}:${REDIS_PORT},user=svc_deployment_center,password=${DEPLOYMENT_CENTER_REDIS_PASSWORD},defaultDatabase=0,ssl=true,sslProtocols=Tls12"
DPSL_REDIS_CONNECTION="${REDIS_HOST}:${REDIS_PORT},user=svc_deployment_listener,password=${DEPLOYMENT_LISTENER_REDIS_PASSWORD},defaultDatabase=0,ssl=true,sslProtocols=Tls12"
DPSC_REDIS_CONNECTION="${REDIS_HOST}:${REDIS_PORT},user=svc_deployment_consumer,password=${DEPLOYMENT_CONSUMER_REDIS_PASSWORD},defaultDatabase=0,ssl=true,sslProtocols=Tls12"

echo "==> Reading current non-password secret values"
ADMIN_SECRET_KEY="$(get_secret_value "${APP_NAMESPACE}" "admin-mvc-secret" "SECRET_KEY" || true)"
ADMIN_REDIS_USER="$(get_secret_value "${APP_NAMESPACE}" "admin-mvc-secret" "REDIS_USER" || true)"
ADMIN_REDIS_PORT_EXISTING="$(get_secret_value "${APP_NAMESPACE}" "admin-mvc-secret" "REDIS_PORT" || true)"
if [[ -z "${ADMIN_SECRET_KEY}" ]]; then
  echo "Error: cannot read SECRET_KEY from secret admin-mvc-secret."
  exit 1
fi
if [[ -z "${ADMIN_REDIS_USER}" ]]; then
  ADMIN_REDIS_USER="svc_admin_mvc"
fi
if [[ -z "${ADMIN_REDIS_PORT_EXISTING}" ]]; then
  ADMIN_REDIS_PORT_EXISTING="${REDIS_PORT}"
fi

DPC_RABBIT_PASSWORD="$(get_secret_value "${APP_NAMESPACE}" "deployment-center-secret" "RABBIT_PASSWORD" || true)"
DPSC_RABBIT_PASSWORD="$(get_secret_value "${APP_NAMESPACE}" "deployment-consumer-secret" "RABBIT_PASSWORD" || true)"
if [[ -z "${DPC_RABBIT_PASSWORD}" ]]; then
  echo "Error: cannot read RABBIT_PASSWORD from secret deployment-center-secret."
  exit 1
fi
if [[ -z "${DPSC_RABBIT_PASSWORD}" ]]; then
  echo "Error: cannot read RABBIT_PASSWORD from secret deployment-consumer-secret."
  exit 1
fi

if [[ "${ROTATE_RABBITMQ}" == "true" ]]; then
  DPC_RABBIT_PASSWORD="${RABBIT_PRODUCER_PASSWORD}"
  DPSC_RABBIT_PASSWORD="${RABBIT_CONSUMER_PASSWORD}"
fi
GATEWAY_REDIS_USER="$(get_secret_value "${APP_NAMESPACE}" "challenge-gateway-secret" "REDIS_USERNAME" || true)"
if [[ -z "${GATEWAY_REDIS_USER}" ]]; then
  GATEWAY_REDIS_USER="svc_gateway"
fi

MARIADB_REPLICATION_PASSWORD="$(get_secret_value "${DB_NAMESPACE}" "mariadb-auth-secret" "mariadb-replication-password" || true)"
if [[ -z "${MARIADB_REPLICATION_PASSWORD}" ]]; then
  echo "Error: cannot read mariadb-replication-password from secret mariadb-auth-secret."
  exit 1
fi

echo "==> Applying updated Kubernetes Secrets"
apply_secret_from_literals "${APP_NAMESPACE}" "admin-mvc-secret" \
  "DATABASE_URL" "${ADMIN_DATABASE_URL}" \
  "SECRET_KEY" "${ADMIN_SECRET_KEY}" \
  "REDIS_USER" "${ADMIN_REDIS_USER}" \
  "REDIS_PASS" "${ADMIN_REDIS_PASSWORD}" \
  "REDIS_PORT" "${ADMIN_REDIS_PORT_EXISTING}" \
  "REDIS_URL" "${ADMIN_REDIS_URL}"

apply_secret_from_literals "${APP_NAMESPACE}" "contestant-be-secret" \
  "DB_CONNECTION" "${CBE_DB_CONNECTION}" \
  "REDIS_CONNECTION" "${CBE_REDIS_CONNECTION}"

apply_secret_from_literals "${APP_NAMESPACE}" "deployment-center-secret" \
  "DB_CONNECTION" "${DPC_DB_CONNECTION}" \
  "REDIS_CONNECTION" "${DPC_REDIS_CONNECTION}" \
  "RABBIT_PASSWORD" "${DPC_RABBIT_PASSWORD}"

apply_secret_from_literals "${APP_NAMESPACE}" "deployment-consumer-secret" \
  "DB_CONNECTION" "${DPSC_DB_CONNECTION}" \
  "REDIS_CONNECTION" "${DPSC_REDIS_CONNECTION}" \
  "RABBIT_PASSWORD" "${DPSC_RABBIT_PASSWORD}"

apply_secret_from_literals "${APP_NAMESPACE}" "deployment-listener-secret" \
  "DB_CONNECTION" "${DPSL_DB_CONNECTION}" \
  "REDIS_CONNECTION" "${DPSL_REDIS_CONNECTION}"

apply_secret_from_literals "${APP_NAMESPACE}" "challenge-gateway-secret" \
  "REDIS_USERNAME" "${GATEWAY_REDIS_USER}" \
  "REDIS_PASSWORD" "${GATEWAY_REDIS_PASSWORD}"

apply_secret_from_literals "${DB_NAMESPACE}" "mariadb-auth-secret" \
  "mariadb-root-password" "${MARIADB_ROOT_PASSWORD}" \
  "mariadb-password" "${ADMIN_DB_PASSWORD}" \
  "mariadb-replication-password" "${MARIADB_REPLICATION_PASSWORD}"

if [[ "${ROTATE_HARBOR}" == "true" ]]; then
  echo "==> Rotating Harbor internal database password"
  rotate_harbor_database_password

  echo "==> Patching Harbor-related secret keys"
  patch_harbor_secrets
fi

if [[ "${ROTATE_RANCHER}" == "true" ]]; then
  echo "==> Patching Rancher-related secret keys"
  patch_rancher_secrets
fi

if [[ "${ROTATE_GRAFANA}" == "true" ]]; then
  echo "==> Patching Grafana-related secret keys"
  patch_grafana_secrets
fi

echo "==> Patching additional related credential keys in all other secrets"
patch_additional_db_redis_secrets

if [[ "${SKIP_ROLLOUT_RESTART}" != "true" ]]; then
  if [[ "${ROTATE_RABBITMQ}" == "true" ]]; then
    restart_rabbitmq_workload
  fi

  restart_deployments

  if [[ "${ROTATE_RANCHER}" == "true" ]]; then
    restart_rancher_workload
  fi

  if [[ "${ROTATE_GRAFANA}" == "true" ]]; then
    restart_grafana_workloads
  fi

  if [[ "${ROTATE_HARBOR}" == "true" ]]; then
    restart_harbor_workloads
  fi
else
  echo "==> Skip rollout restart as requested"
fi

echo
echo "DONE: Password rotation completed successfully."
