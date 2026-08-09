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
DOMAINS_FILE="${SCRIPT_DIR}/../.fctf-domains"
ROTATE_SERVICE_SCRIPT="${SCRIPT_DIR}/rotate-service-passwords.sh"
MARIADB_AUTH_SECRET_FILE="${PROD_DIR}/env/secret/mariadb-auth-secret.yaml"
REDIS_AUTH_SECRET_FILE="${PROD_DIR}/env/secret/redis-auth-secret.yaml"
REDIS_ACL_USERS_SECRET_FILE="${PROD_DIR}/env/secret/redis-acl-users-secret.yaml"
REDIS_ACL_FILE_SECRET_FILE="${PROD_DIR}/env/secret/redis-acl-file-secret.yaml"
MARIADB_POST_INIT_GRANTS_SQL="${PROD_DIR}/helm/db/mariadb/least-privilege-service-accounts.sql"
RABBIT_DEPLOY_PRODUCER_BOOTSTRAP_PASSWORD="Fctf2025@producer"
RABBIT_DEPLOY_CONSUMER_BOOTSTRAP_PASSWORD="Fctf2025@consumer"

# shellcheck source=platform-credentials.sh
source "${SCRIPT_DIR}/platform-credentials.sh"
fctf_ensure_platform_credentials
RABBIT_ADMIN_BOOTSTRAP_PASSWORD="${RABBITMQ_ADMIN_PASSWORD}"

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

# Same list configure-domains.sh substitutes. REDIS_ADMIN_CIDR is deliberately
# absent: that placeholder lives in a manifest this script never applies.
DOMAIN_PLACEHOLDER_TOKENS=(
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

# configure-domains.sh rewrites tracked files in place, so its edits are working
# tree changes that any `git pull`/`git reset --hard` throws away. Applying the
# restored manifests then sends placeholders to the API server, and the errors
# that follow name none of this: a PV whose nfs.server is already a real address
# fails with "spec.persistentvolumesource is immutable after creation", and a
# Deployment quietly accepts an image called <REGISTRY_DOMAIN>/fctf/... that no
# node can ever pull.
require_domains_configured() {
  local grep_args=() token hit
  local -a hits=()

  for token in "${DOMAIN_PLACEHOLDER_TOKENS[@]}"; do
    grep_args+=("-e" "<${token}>")
  done

  while IFS= read -r hit; do
    [[ -n "${hit}" ]] && hits+=("${hit}")
  done < <(grep -RIl "${grep_args[@]}" "${PROD_DIR}" 2>/dev/null || true)

  if [[ ${#hits[@]} -eq 0 ]]; then
    return 0
  fi

  echo "Error: unresolved domain/IP placeholders under ${PROD_DIR}:"
  for hit in "${hits[@]}"; do
    echo "  - ${hit}"
  done
  echo
  echo "Run 'Configure service domains/IP' (manage.sh option 9) before installing."

  if [[ -f "${DOMAINS_FILE}" ]]; then
    echo "Your answers from the last run are remembered in ${DOMAINS_FILE},"
    echo "so option 9 offers them as defaults - press Enter to keep each one."
  else
    echo "On a cluster that is already up, enter the SAME values as the first run -"
    echo "a PV's NFS server address cannot be changed after the PV exists."
  fi

  exit 1
}

# For manifests that create a namespace and, in the same file, our hardened
# copy of that namespace's `default` ServiceAccount. The namespace controller
# creates its own `default` SA as soon as the namespace appears, which can beat
# kubectl's create of ours: kubectl's read says the SA is absent, it POSTs, and
# the whole apply fails with `serviceaccounts "default" already exists`. On the
# retry the SA is there, so apply patches it instead of creating it.
apply_manifest_with_default_sa() {
  local manifest="$1"

  if [[ ! -f "${manifest}" ]]; then
    echo "Error: manifest not found at ${manifest}"
    exit 1
  fi

  if ! kubectl apply -f "${manifest}"; then
    echo "==> Re-applying ${manifest} (default ServiceAccount raced namespace creation)"
    kubectl apply -f "${manifest}"
  fi
}

# The Kaniko builder's egress policy denies the private ranges, which also
# covers the API server that the argoexec `wait` sidecar posts its
# workflowtaskresults to. Without an explicit allow the symptom is not an
# error anywhere: the image builds and lands in the registry, then the sidecar
# retries the API forever and the workflow sits in Running until someone
# deletes it. The two addresses cannot be baked into the manifest - the
# ClusterIP follows --service-cidr and the endpoint is whatever address k3s
# bound the API server to - so read both from the live cluster here. Calico
# evaluates egress policy after service DNAT, which is why the endpoint is
# needed on top of the ClusterIP.
apply_kaniko_network_policy() {
  local manifest="${PROD_DIR}/argo-workflows/up-challenge/kaniko-network-policy.yaml"
  local api_cluster_ip api_endpoint_ip api_endpoint_port endpoint_count

  if [[ ! -f "${manifest}" ]]; then
    echo "Error: manifest not found at ${manifest}"
    exit 1
  fi

  api_cluster_ip="$(kubectl -n default get svc kubernetes -o jsonpath='{.spec.clusterIP}')"
  api_endpoint_ip="$(kubectl -n default get endpoints kubernetes -o jsonpath='{.subsets[0].addresses[0].ip}')"
  api_endpoint_port="$(kubectl -n default get endpoints kubernetes -o jsonpath='{.subsets[0].ports[0].port}')"

  if [[ -z "${api_cluster_ip}" || -z "${api_endpoint_ip}" || -z "${api_endpoint_port}" ]]; then
    echo "Error: could not read the Kubernetes API address from svc/endpoints 'kubernetes' in namespace default."
    echo "Applying the policy with the placeholders unresolved would hang every challenge build."
    exit 1
  fi

  endpoint_count="$(kubectl -n default get endpoints kubernetes -o jsonpath='{.subsets[*].addresses[*].ip}' | wc -w)"
  if [[ "${endpoint_count}" -gt 1 ]]; then
    echo "Warning: the API server has ${endpoint_count} endpoints, the policy will only allow ${api_endpoint_ip}."
    echo "         Add the other addresses to ${manifest} on a multi-master cluster."
  fi

  echo "==> Applying Kaniko NetworkPolicy (API server ${api_cluster_ip}:443 and ${api_endpoint_ip}:${api_endpoint_port})"
  sed -e "s|<KUBERNETES_API_CLUSTER_IP>|${api_cluster_ip}|g" \
      -e "s|<KUBERNETES_API_ENDPOINT_IP>|${api_endpoint_ip}|g" \
      -e "s|<KUBERNETES_API_ENDPOINT_PORT>|${api_endpoint_port}|g" \
      "${manifest}" | kubectl apply -f -
}

# challenge-gateway mounts gateway-tls as a volume, and kubelet mounts volumes
# before it creates the pod sandbox - so while that secret is missing the pods
# stay in ContainerCreating with no IP, no restarts, and events that say nothing
# about certificates. Waiting here turns "the gateway is inexplicably down" into
# a message at install time, next to the thing that caused it.
#
# A warning rather than an error: on a first install the gateway cannot serve
# anything yet anyway (its image is pushed later by setup-harbor.sh), and the
# pods do start on their own the moment the certificate lands.
wait_for_gateway_certificate() {
  local ns="app" cert="gateway-tls"

  echo "==> Waiting for ${cert} to be issued (challenge-gateway mounts it)"
  if kubectl -n "${ns}" wait --for=condition=Ready "certificate/${cert}" --timeout=300s >/dev/null 2>&1; then
    echo "    ${cert} issued"
    return 0
  fi

  echo
  echo "WARNING: ${ns}/${cert} was not issued within 300s."
  echo "    challenge-gateway's pods will sit in ContainerCreating until it exists."
  echo "    The install continues and they start on their own once it is issued."
  echo
  echo "    To see where the ACME challenge is stuck:"
  echo "      kubectl -n ${ns} describe challenge | grep -E 'Reason:|State:'"
  echo
  return 0
}

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

# The password a service actually presents to RabbitMQ is the one in its
# Secret, so that Secret - not a constant in this script - is what the broker
# has to be synchronised against. rotate-service-passwords.sh only ever patches
# the live Secret, never the tracked YAML, so re-applying prod/env/secret/ after
# a rotation silently resets the app side while the broker keeps the rotated
# password. Reading the value back here means the two are realigned on every
# install, whether or not a rotation happened in between.
rabbit_password_from_secret() {
  local secret_name="$1"
  local fallback="$2"
  local value=""

  value="$(kubectl -n app get secret "${secret_name}" -o jsonpath='{.data.RABBIT_PASSWORD}' 2>/dev/null | base64 -d 2>/dev/null || true)"

  if [[ -z "${value}" ]]; then
    value="${fallback}"
  fi

  printf '%s' "${value}"
}

# Same reasoning as above, one layer deeper. MariaDB writes the root password
# into its datadir the first time the server initialises, so pushing a
# different one into the Secret afterwards does not move the account - it only
# makes the Secret disagree with the database, and the next thing to
# authenticate fails. Reuse whatever the cluster already holds; only a cluster
# with no Secret yet takes the freshly generated password. Changing it on a
# running install is rotate-service-passwords.sh's job, because that also
# issues the ALTER USER.
mariadb_root_password_to_apply() {
  local value=""

  value="$(kubectl -n db get secret mariadb-auth-secret -o jsonpath='{.data.mariadb-root-password}' 2>/dev/null | base64 -d 2>/dev/null || true)"

  if [[ -z "${value}" ]]; then
    value="${MARIADB_ROOT_PASSWORD}"
  fi

  printf '%s' "${value}"
}

# The manifest ships a ${MARIADB_ROOT_PASSWORD} placeholder instead of a
# password. Substituting in memory and piping to kubectl means the rendered
# Secret never touches the disk, so there is no file to forget to delete.
apply_mariadb_auth_secret() {
  local rendered password
  password="$(mariadb_root_password_to_apply)"
  rendered="$(cat "${MARIADB_AUTH_SECRET_FILE}")"
  printf '%s\n' "${rendered//\$\{MARIADB_ROOT_PASSWORD\}/${password}}" | kubectl apply -f -
}

bootstrap_rabbitmq_deploy_users() {
  local ns="db"
  local rabbit_pod=""
  local deadline
  local producer_password=""
  local consumer_password=""
  local user_check

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

      producer_password="$(rabbit_password_from_secret "deployment-center-secret" "${RABBIT_DEPLOY_PRODUCER_BOOTSTRAP_PASSWORD}")"
      consumer_password="$(rabbit_password_from_secret "deployment-consumer-secret" "${RABBIT_DEPLOY_CONSUMER_BOOTSTRAP_PASSWORD}")"

      if ! kubectl -n "${ns}" exec "${rabbit_pod}" -- rabbitmqctl change_password "deployment-producer" "${producer_password}" >/dev/null 2>&1; then
        kubectl -n "${ns}" exec "${rabbit_pod}" -- rabbitmqctl add_user "deployment-producer" "${producer_password}" >/dev/null 2>&1
      fi

      if ! kubectl -n "${ns}" exec "${rabbit_pod}" -- rabbitmqctl change_password "deployment-consumer" "${consumer_password}" >/dev/null 2>&1; then
        kubectl -n "${ns}" exec "${rabbit_pod}" -- rabbitmqctl add_user "deployment-consumer" "${consumer_password}" >/dev/null 2>&1
      fi

      if ! kubectl -n "${ns}" exec "${rabbit_pod}" -- rabbitmqctl change_password "admin" "${RABBIT_ADMIN_BOOTSTRAP_PASSWORD}" >/dev/null 2>&1; then
        kubectl -n "${ns}" exec "${rabbit_pod}" -- rabbitmqctl add_user "admin" "${RABBIT_ADMIN_BOOTSTRAP_PASSWORD}" >/dev/null 2>&1
      fi

      kubectl -n "${ns}" exec "${rabbit_pod}" -- rabbitmqctl set_user_tags "admin" "administrator" >/dev/null 2>&1

      kubectl -n "${ns}" exec "${rabbit_pod}" -- rabbitmqctl set_permissions -p "fctf_deploy" "deployment-producer" "^$" "^(deployment_exchange)$" "^$" >/dev/null 2>&1
      kubectl -n "${ns}" exec "${rabbit_pod}" -- rabbitmqctl set_permissions -p "fctf_deploy" "deployment-consumer" "^$" "^$" "^(deployment_queue)$" >/dev/null 2>&1
      kubectl -n "${ns}" exec "${rabbit_pod}" -- rabbitmqctl set_permissions -p "fctf_deploy" "admin" ".*" ".*" ".*" >/dev/null 2>&1

      # Prove the two sides agree before declaring the install done. Every way
      # this can drift produces the same useless symptom: RabbitMQ.Client wraps
      # an authentication failure in BrokerUnreachableException, deployment-center
      # turns that into "Deployment service is temporarily unavailable", and the
      # contestant sees a bare 500 with nothing naming RabbitMQ anywhere.
      for user_check in "deployment-producer:${producer_password}" "deployment-consumer:${consumer_password}"; do
        if ! kubectl -n "${ns}" exec "${rabbit_pod}" -- rabbitmqctl authenticate_user "${user_check%%:*}" "${user_check#*:}" >/dev/null 2>&1; then
          echo "Error: RabbitMQ user '${user_check%%:*}' does not accept the password held in its Kubernetes Secret."
          echo "Starting a challenge would fail with a 500 that never mentions RabbitMQ."
          exit 1
        fi
      done

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

require_domains_configured


if [[ "${APPLY_HELM}" == "true" ]]; then
  if [[ ! -d "${PROD_DIR}" ]]; then
    echo "Error: prod directory not found at ${PROD_DIR}"
    exit 1
  fi

  echo "==> Creating required namespace for Helm components"
  apply_manifest_with_default_sa "${PROD_DIR}/app/namespace.yaml"
  kubectl create namespace argo --dry-run=client -o yaml | kubectl apply -f -
  kubectl create namespace storage --dry-run=client -o yaml | kubectl apply -f -
  kubectl apply -f "${PROD_DIR}/db/namespace.yaml"

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

  if [[ ! -f "${REDIS_ACL_FILE_SECRET_FILE}" ]]; then
    echo "Error: Redis ACL file secret manifest not found at ${REDIS_ACL_FILE_SECRET_FILE}"
    echo "Please create/update this file before running Helm so redis-master can mount its aclfile."
    exit 1
  fi

  echo "==> Applying MariaDB auth secret before Helm"
  apply_mariadb_auth_secret

  echo "==> Applying Redis auth secrets before Helm"
  kubectl apply -f "${REDIS_AUTH_SECRET_FILE}"
  kubectl apply -f "${REDIS_ACL_USERS_SECRET_FILE}"
  # redis-master mounts this one as a plain (non-optional) secret volume and
  # reads its aclfile at startup, so it has to exist before the chart installs
  # or the pod sits in ContainerCreating on a FailedMount until the rest of
  # prod/env/secret/ is applied further down.
  kubectl apply -f "${REDIS_ACL_FILE_SECRET_FILE}"

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
  kubectl apply -f "${PROD_DIR}/sa/argo-workflow/"

  echo "==> Applying monitoring NetworkPolicy"
  kubectl apply -f "${PROD_DIR}/monitoring/NetworkPolicy/"

  echo "==> Applying db NetworkPolicy"
  kubectl apply -f "${PROD_DIR}/db/NetworkPolicy/"

  # The Redis NodePort is not applied or removed here. It lives in
  # prod/db-nodeport.yaml and is applied by hand together with its firewall rule
  # and admin NetworkPolicy - see that file's header. Applying it without both
  # of those puts Redis on a public port.
fi

if [[ "${DEPLOY_APP_SERVICES}" == "true" ]]; then
  if [[ ! -d "${PROD_DIR}" ]]; then
    echo "Error: prod directory not found at ${PROD_DIR}"
    exit 1
  fi

  echo "==> Creating required namespaces"
  apply_manifest_with_default_sa "${PROD_DIR}/app/namespace.yaml"
  kubectl apply -f "${PROD_DIR}/db/namespace.yaml"

  echo "==> Applying base classes, ConfigMaps and Secrets"
  kubectl apply -f "${PROD_DIR}/priority-classes.yaml"
    kubectl apply -f "${PROD_DIR}/env/configmap/"
  # Applied one at a time rather than as a directory: mariadb-auth-secret.yaml
  # holds a ${MARIADB_ROOT_PASSWORD} placeholder, and a blanket apply would
  # write that literal string into the Secret as the root password.
  for secret_manifest in "${PROD_DIR}"/env/secret/*.yaml; do
    [[ "${secret_manifest}" == "${MARIADB_AUTH_SECRET_FILE}" ]] && continue
    kubectl apply -f "${secret_manifest}"
  done
  apply_mariadb_auth_secret

  # Before the certificates below, not after: app/NetworkPolicy/ carries the rule
  # that lets the ingress controller reach cert-manager's HTTP-01 solver pods,
  # and without it every ACME challenge in this namespace times out.
  echo "==> Applying app NetworkPolicy"
  kubectl apply -f "${PROD_DIR}/app/NetworkPolicy/"

  # Puts fctf-internal-ca's ca.crt in the app namespace. The gateway and all
  # four .NET services mount it to verify the Redis certificate, so it has to
  # exist before they start or their pods wait on a missing secret.
  echo "==> Applying Redis client CA certificate"
  kubectl apply -f "${PROD_DIR}/app/redis-client-cert.yaml"

  # The gateway mounts gateway-tls, so it has to be issued before the deployment
  # below is of any use. The ClusterIssuer goes out here as well rather than only
  # in the ingress phase, so that deploying app services without that phase still
  # has something to issue from.
  echo "==> Applying gateway TLS certificate"
  kubectl apply -f "${PROD_DIR}/cert-manager/cluster-issuer.yaml"
  kubectl apply -f "${PROD_DIR}/app/gateway-cert.yaml"
  wait_for_gateway_certificate

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

  # Also applied in the Helm block. Repeated here because these services cannot
  # reach Redis without it: the allowlist lives in this directory rather than in
  # the chart values, so a run that deploys app services without touching Helm
  # would otherwise leave the db namespace denying them.
  echo "==> Applying db NetworkPolicy"
  kubectl apply -f "${PROD_DIR}/db/NetworkPolicy/"

  echo "==> Applying readOnlyRootFilesystem admission policy"
  kubectl apply -f "${PROD_DIR}/app/readonly-rootfs-policy.yaml"

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
  echo "==> Applying cleanup cronjob"
  apply_manifest_with_default_sa "${PROD_DIR}/cron-job/delete-chal-job.yaml"
fi

if [[ "${APPLY_ARGO_TEMPLATES}" == "true" ]]; then
  if [[ ! -f "${PROD_DIR}/argo-workflows/start-chal-v2/start-chal-v2-template.yaml" || ! -f "${PROD_DIR}/argo-workflows/up-challenge/up-challenge-template.yaml" ]]; then
    echo "Error: Argo templates not found under ${PROD_DIR}/argo-workflows"
    exit 1
  fi

  echo "==> Applying Argo workflow templates"
  kubectl apply -f "${PROD_DIR}/argo-workflows/start-chal-v2/start-chal-v2-template.yaml"
  kubectl apply -f "${PROD_DIR}/argo-workflows/up-challenge/up-challenge-template.yaml"
  apply_kaniko_network_policy
fi

bootstrap_rabbitmq_deploy_users

if [[ -f "${MARIADB_POST_INIT_GRANTS_SQL}" ]]; then
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

  # The schema belongs to CTFd's Alembic migrations, not to this script. It used
  # to be seeded from helm/db/mariadb/createDB.sql, but that dump was a snapshot
  # of one particular database rather than the output of the migration chain,
  # and it had drifted: it stamped alembic_version at e9a1c2d3f4b5 while already
  # containing tables that migrations after that revision create. CTFd then
  # replayed those migrations on first start and died on the first one,
  #
  #   (1050, "Table 'contests' already exists")
  #
  # in a crash loop it could never get out of. Restamping would not have fixed
  # it either - the same dump still had action_logs in its pre-rename camelCase
  # form and was missing columns from a dozen other migrations, so no single
  # revision described it. The MariaDB chart already creates an empty `ctfd`
  # database and a user with rights over it, which is all CTFd needs to build
  # the schema itself.
  #
  # The grants are table-level, so they can only be applied once those tables
  # exist. On a first install that is after setup-harbor.sh has pushed the
  # images and admin-mvc has started, which is later than this script runs.
  ctfd_table_count="$(kubectl -n db exec -i mariadb-0 -- bash -lc '/opt/bitnami/mariadb/bin/mariadb --ssl=0 -uroot -p"$(cat /opt/bitnami/mariadb/secrets/mariadb-root-password)" -N -B -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='"'"'ctfd'"'"'"' 2>/dev/null | tr -d '[:space:]' || true)"

  if [[ "${ctfd_table_count}" =~ ^[0-9]+$ && "${ctfd_table_count}" -gt 1 ]]; then
    echo "==> Applying least-privilege MariaDB grants (${ctfd_table_count} tables present)"
    kubectl -n db exec -i mariadb-0 -- bash -lc '/opt/bitnami/mariadb/bin/mariadb --ssl=0 -uroot -p"$(cat /opt/bitnami/mariadb/secrets/mariadb-root-password)" ctfd' < "${MARIADB_POST_INIT_GRANTS_SQL}"
  else
    echo "==> Skipping least-privilege MariaDB grants: the ctfd schema does not exist yet"
    echo "    CTFd creates it the first time admin-mvc starts, which needs its image in"
    echo "    Harbor - so run Setup Harbor, wait for admin-mvc, then apply the grants:"
    echo
    echo "      kubectl -n app rollout status deployment/admin-mvc --timeout=600s"
    echo "      kubectl -n db exec -i mariadb-0 -- bash -lc '/opt/bitnami/mariadb/bin/mariadb --ssl=0 -uroot -p\"\$(cat /opt/bitnami/mariadb/secrets/mariadb-root-password)\" ctfd' \\"
    echo "        < ${MARIADB_POST_INIT_GRANTS_SQL}"
    echo
    echo "    Re-running Install FCTF once admin-mvc is up applies them automatically."
  fi
else
  echo "Warning: grants SQL file not found at ${MARIADB_POST_INIT_GRANTS_SQL}; skipping least-privilege grants."
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

