#!/usr/bin/env bash
set -euo pipefail

TIMEZONE="Asia/Ho_Chi_Minh"
MAX_PODS="110"
TLS_SAN=""
INSTALL_CALICO="true"
INSTALL_GVISOR="true"
APPLY_HELM="true"
DEPLOY_APP_SERVICES="true"
APPLY_PRODUCTION_INGRESS="true"
APPLY_CRONJOB="true"
APPLY_ARGO_TEMPLATES="true"
SERVICE_MODE="clusterip"
SETUP_NFS_SERVER="true"
NFS_SHARE_PATH="/srv/nfs/share"
NFS_ALLOWED_SUBNET="*"
INTERACTIVE="true"
ARG_COUNT=$#
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROD_DIR="${SCRIPT_DIR}/prod"
ROTATE_SERVICE_SCRIPT="${SCRIPT_DIR}/rotate-service-passwords.sh"
MARIADB_AUTH_SECRET_FILE="${PROD_DIR}/env/secret/mariadb-auth-secret.yaml"
REDIS_AUTH_SECRET_FILE="${PROD_DIR}/env/secret/redis-auth-secret.yaml"
REDIS_ACL_USERS_SECRET_FILE="${PROD_DIR}/env/secret/redis-acl-users-secret.yaml"
MARIADB_CREATE_DB_SQL="${PROD_DIR}/helm/db/mariadb/createDB.sql"
MARIADB_POST_INIT_GRANTS_SQL="${PROD_DIR}/helm/db/mariadb/least-privilege-service-accounts.sql"
RABBIT_DEPLOY_PRODUCER_BOOTSTRAP_PASSWORD="Fctf2025@producer"
RABBIT_DEPLOY_CONSUMER_BOOTSTRAP_PASSWORD="Fctf2025@consumer"
RABBIT_ADMIN_BOOTSTRAP_PASSWORD="Fctf2025@admin"

STORAGE_PV_FILES=(
  "${PROD_DIR}/storage/pv/admin-mvc-pv.yaml"
  "${PROD_DIR}/storage/pv/contestant-be-pv.yaml"
  "${PROD_DIR}/storage/pv/up-challenge-workflow-pv.yaml"
  "${PROD_DIR}/storage/pv/start-challenge-workflow-pv.yaml"
)

STORAGE_PVC_FILES=(
  "${PROD_DIR}/storage/pvc/admin-mvc-pvc.yaml"
  "${PROD_DIR}/storage/pvc/contestant-be-pvc.yaml"
  "${PROD_DIR}/storage/pvc/up-challenge-workflow-pvc.yaml"
  "${PROD_DIR}/storage/pvc/start-challenge-workflow-pvc.yaml"
)

apply_storage_manifests() {
  echo "==> Applying storage PVs"
  for manifest in "${STORAGE_PV_FILES[@]}"; do
    if [[ ! -f "${manifest}" ]]; then
      echo "Error: PV manifest not found at ${manifest}"
      exit 1
    fi
    kubectl apply -f "${manifest}"
  done

  echo "==> Applying storage PVCs"
  for manifest in "${STORAGE_PVC_FILES[@]}"; do
    if [[ ! -f "${manifest}" ]]; then
      echo "Error: PVC manifest not found at ${manifest}"
      exit 1
    fi
    kubectl apply -f "${manifest}"
  done
}

install_gvisor_production() {
  local arch version release_base url tmpdir expected actual

  arch="$(uname -m)"
  case "${arch}" in
    x86_64|amd64)
      arch="x86_64"
      ;;
    aarch64|arm64)
      arch="aarch64"
      ;;
    *)
      echo "Error: Unsupported architecture for gVisor: ${arch}"
      exit 1
      ;;
  esac

  version="${GVISOR_VERSION:-latest}"
  release_base="${GVISOR_RELEASE_BASE:-https://storage.googleapis.com/gvisor/releases/release}"
  url="${release_base}/${version}/${arch}"

  tmpdir="$(mktemp -d)"
  trap 'rm -rf "${tmpdir}"' RETURN

  for bin in runsc containerd-shim-runsc-v1; do
    echo "==> Downloading ${bin} (version=${version}, arch=${arch})"
    curl --fail --silent --show-error --location \
      --retry 5 --retry-delay 2 --connect-timeout 10 \
      "${url}/${bin}" -o "${tmpdir}/${bin}"
    curl --fail --silent --show-error --location \
      --retry 5 --retry-delay 2 --connect-timeout 10 \
      "${url}/${bin}.sha512" -o "${tmpdir}/${bin}.sha512"

    expected="$(awk '{print $1}' "${tmpdir}/${bin}.sha512")"
    actual="$(sha512sum "${tmpdir}/${bin}" | awk '{print $1}')"
    if [[ -z "${expected}" || "${expected}" != "${actual}" ]]; then
      echo "Error: Checksum mismatch for ${bin}"
      exit 1
    fi
  done

  echo "==> Installing verified gVisor binaries"
  sudo install -o root -g root -m 0755 "${tmpdir}/runsc" /usr/local/bin/runsc
  sudo install -o root -g root -m 0755 "${tmpdir}/containerd-shim-runsc-v1" /usr/local/bin/containerd-shim-runsc-v1

  echo "==> gVisor installed: $(/usr/local/bin/runsc --version 2>/dev/null | head -n 1 || echo "unknown version")"
}

bootstrap_rabbitmq_deploy_users() {
  local ns="db"
  local rabbit_pod=""
  local deadline

  if ! kubectl get namespace "${ns}" >/dev/null 2>&1; then
    echo "Warning: namespace ${ns} not found; skip RabbitMQ deployment-user bootstrap."
    return 0
  fi

  if ! kubectl -n "${ns}" get statefulset rabbitmq >/dev/null 2>&1; then
    echo "Warning: statefulset ${ns}/rabbitmq not found; skip RabbitMQ deployment-user bootstrap."
    return 0
  fi

  echo "==> Waiting for RabbitMQ pod readiness"
  kubectl -n "${ns}" rollout status statefulset/rabbitmq --timeout=600s

  if kubectl -n "${ns}" get pod rabbitmq-0 >/dev/null 2>&1; then
    rabbit_pod="rabbitmq-0"
  else
    rabbit_pod="$(kubectl -n "${ns}" get pod -l app.kubernetes.io/instance=rabbitmq,app.kubernetes.io/name=rabbitmq -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)"
  fi

  if [[ -z "${rabbit_pod}" ]]; then
    echo "Error: cannot find RabbitMQ pod in namespace ${ns} for deployment-user bootstrap."
    exit 1
  fi

  echo "==> Bootstrapping RabbitMQ deployment users"
  deadline=$((SECONDS + 600))
  while true; do
    if kubectl -n "${ns}" exec "${rabbit_pod}" -- rabbitmqctl await_startup >/dev/null 2>&1; then
      kubectl -n "${ns}" exec "${rabbit_pod}" -- rabbitmqctl add_vhost "fctf_deploy" >/dev/null 2>&1 || true

      if ! kubectl -n "${ns}" exec "${rabbit_pod}" -- rabbitmqctl change_password "deployment-producer" "${RABBIT_DEPLOY_PRODUCER_BOOTSTRAP_PASSWORD}" >/dev/null 2>&1; then
        kubectl -n "${ns}" exec "${rabbit_pod}" -- rabbitmqctl add_user "deployment-producer" "${RABBIT_DEPLOY_PRODUCER_BOOTSTRAP_PASSWORD}" >/dev/null 2>&1
      fi

      if ! kubectl -n "${ns}" exec "${rabbit_pod}" -- rabbitmqctl change_password "deployment-consumer" "${RABBIT_DEPLOY_CONSUMER_BOOTSTRAP_PASSWORD}" >/dev/null 2>&1; then
        kubectl -n "${ns}" exec "${rabbit_pod}" -- rabbitmqctl add_user "deployment-consumer" "${RABBIT_DEPLOY_CONSUMER_BOOTSTRAP_PASSWORD}" >/dev/null 2>&1
      fi

      if ! kubectl -n "${ns}" exec "${rabbit_pod}" -- rabbitmqctl change_password "rabbit-admin" "${RABBIT_ADMIN_BOOTSTRAP_PASSWORD}" >/dev/null 2>&1; then
        kubectl -n "${ns}" exec "${rabbit_pod}" -- rabbitmqctl add_user "rabbit-admin" "${RABBIT_ADMIN_BOOTSTRAP_PASSWORD}" >/dev/null 2>&1
      fi

      kubectl -n "${ns}" exec "${rabbit_pod}" -- rabbitmqctl set_user_tags "rabbit-admin" "administrator" >/dev/null 2>&1

      kubectl -n "${ns}" exec "${rabbit_pod}" -- rabbitmqctl set_permissions -p "fctf_deploy" "deployment-producer" "^$" "^(deployment_exchange)$" "^$" >/dev/null 2>&1
      kubectl -n "${ns}" exec "${rabbit_pod}" -- rabbitmqctl set_permissions -p "fctf_deploy" "deployment-consumer" "^$" "^$" "^(deployment_queue)$" >/dev/null 2>&1
      kubectl -n "${ns}" exec "${rabbit_pod}" -- rabbitmqctl set_permissions -p "fctf_deploy" "rabbit-admin" ".*" ".*" ".*" >/dev/null 2>&1
      return 0
    fi

    if (( SECONDS >= deadline )); then
      echo "Error: timeout bootstrapping RabbitMQ deployment users in ${ns}/${rabbit_pod}."
      exit 1
    fi

    sleep 5
  done
}

usage() {
  cat <<EOF
Usage:
  $0 --tls-san <master-public-ip-or-domain> [--timezone <tz>] [--max-pods <n>] [--install-calico true|false] [--install-gvisor true|false] [--setup-nfs-server true|false] [--nfs-share-path <path>] [--nfs-allowed-subnet "<client1 client2>|<client1,client2>|*"] [--apply-helm true|false] [--deploy-app-services true|false] [--apply-production-ingress true|false] [--apply-cronjob true|false] [--apply-argo-templates true|false] [--service-mode clusterip|nodeport] [--interactive]

Examples:
  $0 --tls-san 34.124.131.240
  $0 --tls-san k8s.example.com --max-pods 250 --install-calico true
  $0 --tls-san 34.124.131.240 --setup-nfs-server true --nfs-allowed-subnet 10.148.0.0/24
  $0 --tls-san 34.124.131.240 --install-gvisor true --apply-helm true --deploy-app-services true --apply-production-ingress true --apply-cronjob true --apply-argo-templates true
  $0 --interactive
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --tls-san)
      TLS_SAN="${2:-}"
      shift 2
      ;;
    --timezone)
      TIMEZONE="${2:-}"
      shift 2
      ;;
    --max-pods)
      MAX_PODS="${2:-}"
      shift 2
      ;;
    --install-calico)
      INSTALL_CALICO="${2:-}"
      shift 2
      ;;
    --install-gvisor)
      INSTALL_GVISOR="${2:-}"
      shift 2
      ;;
    --setup-nfs-server)
      SETUP_NFS_SERVER="${2:-}"
      shift 2
      ;;
    --nfs-share-path)
      NFS_SHARE_PATH="${2:-}"
      shift 2
      ;;
    --nfs-allowed-subnet)
      NFS_ALLOWED_SUBNET="${2:-}"
      shift 2
      ;;
    --apply-helm)
      APPLY_HELM="${2:-}"
      shift 2
      ;;
    --deploy-app-services)
      DEPLOY_APP_SERVICES="${2:-}"
      shift 2
      ;;
    --apply-production-ingress)
      APPLY_PRODUCTION_INGRESS="${2:-}"
      shift 2
      ;;
    --apply-cronjob)
      APPLY_CRONJOB="${2:-}"
      shift 2
      ;;
    --apply-argo-templates)
      APPLY_ARGO_TEMPLATES="${2:-}"
      shift 2
      ;;
    --service-mode)
      SERVICE_MODE="${2:-}"
      shift 2
      ;;
    --interactive)
      INTERACTIVE="true"
      shift 1
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

if [[ ${ARG_COUNT} -eq 0 ]]; then
  INTERACTIVE="true"
fi


if [[ "${SERVICE_MODE}" != "clusterip" && "${SERVICE_MODE}" != "nodeport" ]]; then
  echo "Error: --service-mode must be clusterip or nodeport"
  exit 1
fi


if [[ "${APPLY_HELM}" == "true" ]]; then
  if [[ ! -d "${PROD_DIR}" ]]; then
    echo "Error: prod directory not found at ${PROD_DIR}"
    exit 1
  fi

  echo "==> Creating required namespace for Helm components"
  kubectl create namespace app --dry-run=client -o yaml | kubectl apply -f -
  kubectl create namespace argo --dry-run=client -o yaml | kubectl apply -f -
  kubectl create namespace storage --dry-run=client -o yaml | kubectl apply -f -
  kubectl create namespace db --dry-run=client -o yaml | kubectl apply -f -

  if [[ ! -f "${MARIADB_AUTH_SECRET_FILE}" ]]; then
    echo "Error: MariaDB auth secret manifest not found at ${MARIADB_AUTH_SECRET_FILE}"
    echo "Please create/update this file before running Helm so MariaDB existingSecret can be resolved."
    exit 1
  fi

  if [[ ! -f "${REDIS_AUTH_SECRET_FILE}" ]]; then
    echo "Error: Redis auth secret manifest not found at ${REDIS_AUTH_SECRET_FILE}"
    echo "Please create/update this file before running Helm so Redis auth.existingSecret can be resolved."
    exit 1
  fi

  if [[ ! -f "${REDIS_ACL_USERS_SECRET_FILE}" ]]; then
    echo "Error: Redis ACL users secret manifest not found at ${REDIS_ACL_USERS_SECRET_FILE}"
    echo "Please create/update this file before running Helm so Redis auth.acl.userSecret can be resolved."
    exit 1
  fi

  echo "==> Applying MariaDB auth secret before Helm"
  kubectl apply -f "${MARIADB_AUTH_SECRET_FILE}"

  echo "==> Applying Redis auth secrets before Helm"
  kubectl apply -f "${REDIS_AUTH_SECRET_FILE}"
  kubectl apply -f "${REDIS_ACL_USERS_SECRET_FILE}"

  apply_storage_manifests

  echo "==> Installing Helm (if missing)"
  if ! command -v helm >/dev/null 2>&1; then
    curl https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash
  fi

  echo "==> Applying Helm stack via prod/helm.sh"
  (
    cd "${PROD_DIR}"
    chmod +x ./helm.sh
    bash ./helm.sh
  )

  echo "==> Applying Argo ServiceAccount"
  kubectl apply -f "${PROD_DIR}/sa/argo-workflow/argo-sa.yaml"
fi

if [[ "${DEPLOY_APP_SERVICES}" == "true" ]]; then
  if [[ ! -d "${PROD_DIR}" ]]; then
    echo "Error: prod directory not found at ${PROD_DIR}"
    exit 1
  fi

  echo "==> Creating required namespaces"
  kubectl create namespace app --dry-run=client -o yaml | kubectl apply -f -
  kubectl create namespace db --dry-run=client -o yaml | kubectl apply -f -

  echo "==> Applying base classes, ConfigMaps and Secrets"
  kubectl apply -f "${PROD_DIR}/priority-classes.yaml"
    kubectl apply -f "${PROD_DIR}/env/configmap/"
  kubectl apply -f "${PROD_DIR}/env/secret/"

  if [[ "${APPLY_HELM}" != "true" ]]; then
    apply_storage_manifests
  fi

  echo "==> Deploying app services"
  kubectl apply -f "${PROD_DIR}/app/admin-mvc/"
  kubectl apply -f "${PROD_DIR}/app/contestant-be/"
  kubectl apply -f "${PROD_DIR}/app/contestant-portal/"
  kubectl apply -f "${PROD_DIR}/app/deployment-center/"
  kubectl apply -f "${PROD_DIR}/app/deployment-listener/"
  kubectl apply -f "${PROD_DIR}/app/challenge-gateway/"
  kubectl apply -f "${PROD_DIR}/app/deployment-consumer/"

  echo "==> Applying app NetworkPolicy"
  kubectl apply -f "${PROD_DIR}/app/NetworkPolicy/"

  if [[ "${SERVICE_MODE}" == "clusterip" ]]; then
    echo "==> Applying ClusterIP service mode"
    kubectl delete -f "${PROD_DIR}/app/service-nodeport.yaml" --ignore-not-found
    kubectl apply -f "${PROD_DIR}/app/service-clusterip.yaml"
  else
    echo "==> Applying NodePort service mode"
    kubectl delete -f "${PROD_DIR}/app/service-clusterip.yaml" --ignore-not-found
    kubectl apply -f "${PROD_DIR}/app/service-nodeport.yaml"
  fi
fi

if [[ "${APPLY_PRODUCTION_INGRESS}" == "true" ]]; then
  if [[ ! -d "${PROD_DIR}/ingress" || ! -d "${PROD_DIR}/cert-manager" ]]; then
    echo "Error: ingress/cert-manager manifests not found under ${PROD_DIR}"
    exit 1
  fi

  echo "==> Applying production ingress manifests"
  kubectl apply -f "${PROD_DIR}/cert-manager/cluster-issuer.yaml"
  kubectl apply -f "${PROD_DIR}/ingress/certificate/"
  kubectl apply -f "${PROD_DIR}/ingress/nginx/"
fi

if [[ "${APPLY_CRONJOB}" == "true" ]]; then
  if [[ ! -f "${PROD_DIR}/cron-job/delete-chal-job.yaml" ]]; then
    echo "Error: cronjob manifest not found at ${PROD_DIR}/cron-job/delete-chal-job.yaml"
    exit 1
  fi

  echo "==> Applying cleanup cronjob"
  kubectl apply -f "${PROD_DIR}/cron-job/delete-chal-job.yaml"
fi

if [[ "${APPLY_ARGO_TEMPLATES}" == "true" ]]; then
  if [[ ! -f "${PROD_DIR}/argo-workflows/start-chal-v2/start-chal-v2-template.yaml" || ! -f "${PROD_DIR}/argo-workflows/up-challenge/up-challenge-template.yaml" ]]; then
    echo "Error: Argo templates not found under ${PROD_DIR}/argo-workflows"
    exit 1
  fi

  echo "==> Applying Argo workflow templates"
  kubectl apply -f "${PROD_DIR}/argo-workflows/start-chal-v2/start-chal-v2-template.yaml"
  kubectl apply -f "${PROD_DIR}/argo-workflows/up-challenge/up-challenge-template.yaml"
fi

bootstrap_rabbitmq_deploy_users

if [[ -f "${MARIADB_CREATE_DB_SQL}" && -f "${MARIADB_POST_INIT_GRANTS_SQL}" ]]; then
  echo "==> Waiting for MariaDB pod readiness"
  kubectl rollout status statefulset/mariadb -n db --timeout=600s

  echo "==> Waiting for MariaDB to accept connections"
  mariadb_ready="false"
  for _ in $(seq 1 60); do
    if kubectl -n db exec mariadb-0 -- bash -lc '/opt/bitnami/mariadb/bin/mariadb-admin --ssl=0 -uroot -p"$(cat /opt/bitnami/mariadb/secrets/mariadb-root-password)" ping' >/dev/null 2>&1; then
      mariadb_ready="true"
      break
    fi
    sleep 5
  done

  if [[ "${mariadb_ready}" != "true" ]]; then
    echo "Error: MariaDB is not ready after timeout."
    exit 1
  fi

  echo "==> Applying createDB.sql baseline schema"
  kubectl -n db exec -i mariadb-0 -- bash -lc '/opt/bitnami/mariadb/bin/mariadb --ssl=0 -uroot -p"$(cat /opt/bitnami/mariadb/secrets/mariadb-root-password)"' < "${MARIADB_CREATE_DB_SQL}"

  echo "==> Applying least-privilege MariaDB grants"
  kubectl -n db exec -i mariadb-0 -- bash -lc '/opt/bitnami/mariadb/bin/mariadb --ssl=0 -uroot -p"$(cat /opt/bitnami/mariadb/secrets/mariadb-root-password)" ctfd' < "${MARIADB_POST_INIT_GRANTS_SQL}"
else
  [[ -f "${MARIADB_CREATE_DB_SQL}" ]] || echo "Warning: createDB SQL file not found at ${MARIADB_CREATE_DB_SQL}; skipping schema bootstrap."
  [[ -f "${MARIADB_POST_INIT_GRANTS_SQL}" ]] || echo "Warning: grants SQL file not found at ${MARIADB_POST_INIT_GRANTS_SQL}; skipping least-privilege grants."
fi

echo
echo "DONE: Installation FCTF complete!"
echo
echo "==> Running service password rotation"
if [[ ! -f "${ROTATE_SERVICE_SCRIPT}" ]]; then
  echo "Error: rotate service script not found at ${ROTATE_SERVICE_SCRIPT}"
  exit 1
fi

chmod +x "${ROTATE_SERVICE_SCRIPT}"
bash "${ROTATE_SERVICE_SCRIPT}"

