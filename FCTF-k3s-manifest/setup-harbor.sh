#!/usr/bin/env bash
set -euo pipefail

# ===== CONFIG =====
HARBOR_URL="https://registry.sanchoi.iahn.hanoi.vn"
HARBOR_HOST="registry.sanchoi.iahn.hanoi.vn"

PROJECT_NAME="fctf"

ARGO_NAMESPACE="argo"
APP_NAMESPACE="app"

INSTALL_DOCKER="${INSTALL_DOCKER:-true}"
DOCKER_WAIT_SECONDS="${DOCKER_WAIT_SECONDS:-120}"
HARBOR_WAIT_SECONDS="${HARBOR_WAIT_SECONDS:-180}"
BUILD_NO_CACHE="${BUILD_NO_CACHE:-true}"

DOCKER=()
SUDO=()
CI_USER="${CI_USER:-}"
CI_PASS="${CI_PASS:-}"

# ===== PATH RESOLUTION =====
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(realpath "${SCRIPT_DIR}/..")"

echo "==> SCRIPT_DIR: $SCRIPT_DIR"
echo "==> ROOT_DIR:   $ROOT_DIR"

# ===== SUDO HELPERS =====
setup_sudo() {
  if [[ "$(id -u)" -eq 0 ]]; then
    SUDO=()
    return
  fi

  if command -v sudo >/dev/null 2>&1; then
    SUDO=(sudo)
    return
  fi

  echo "❌ Script requires root privileges (run as root or install sudo)"
  exit 1
}

# ===== INSTALL DEPENDENCIES =====
install_dependencies() {
  echo "==> Checking dependencies..."

  install_pkg() {
    local pkg=$1
    if ! command -v "$pkg" >/dev/null 2>&1; then
      echo "==> Installing $pkg..."
      if command -v apt-get >/dev/null 2>&1; then
        "${SUDO[@]}" apt-get update -y
        "${SUDO[@]}" apt-get install -y "$pkg"
      elif command -v yum >/dev/null 2>&1; then
        "${SUDO[@]}" yum install -y "$pkg"
      elif command -v apk >/dev/null 2>&1; then
        "${SUDO[@]}" apk add --no-cache "$pkg"
      else
        echo "❌ Unsupported package manager"
        exit 1
      fi
    fi
  }

  install_pkg curl
  install_pkg git
  install_pkg ca-certificates
  install_pkg tar

  echo "==> Dependencies OK"
}

# ===== INSTALL DOCKER =====
install_docker() {
  if command -v docker >/dev/null 2>&1; then
    echo "==> docker already installed: $(docker --version 2>/dev/null || echo 'unknown version')"
    return
  fi

  echo "==> Installing Docker Engine (official script)..."
  local tmp_script
  tmp_script="$(mktemp)"

  curl -fsSL https://get.docker.com -o "$tmp_script"
  "${SUDO[@]}" sh "$tmp_script"
  rm -f "$tmp_script"

  if ! command -v docker >/dev/null 2>&1; then
    echo "❌ docker installation failed"
    exit 1
  fi

  echo "==> docker installed: $(docker --version 2>/dev/null || echo 'unknown version')"
}

start_docker_service_if_available() {
  if ! command -v systemctl >/dev/null 2>&1; then
    return
  fi

  if ! systemctl list-unit-files | grep -q '^docker\.service'; then
    return
  fi

  if ! "${SUDO[@]}" systemctl is-active --quiet docker; then
    echo "==> Starting docker service..."
    "${SUDO[@]}" systemctl enable --now docker
  fi
}

# ===== DETECT DOCKER =====
detect_docker() {
  if ! command -v docker >/dev/null 2>&1; then
    echo "❌ docker not found in PATH"
    echo "   Set INSTALL_DOCKER=true and rerun setup-harbor.sh"
    exit 1
  fi

  local waited=0
  while true; do
    if docker info >/dev/null 2>&1; then
      DOCKER=(docker)
      break
    fi

    if "${SUDO[@]}" docker info >/dev/null 2>&1; then
      DOCKER=("${SUDO[@]}" docker)
      break
    fi

    if (( waited == 0 )); then
      start_docker_service_if_available
    fi

    if (( waited >= DOCKER_WAIT_SECONDS )); then
      echo "❌ docker daemon is not ready after ${DOCKER_WAIT_SECONDS}s"
      if command -v systemctl >/dev/null 2>&1; then
        "${SUDO[@]}" systemctl --no-pager --full status docker 2>/dev/null || true
      fi
      exit 1
    fi

    sleep 3
    waited=$((waited + 3))
  done

  echo "==> Using: ${DOCKER[*]}"
}

# ===== WAIT HARBOR =====
wait_harbor() {
  echo "==> Waiting Harbor..."

  local timeout="$HARBOR_WAIT_SECONDS"
  local elapsed=0
  local http_code=""

  while true; do
    http_code="$(curl -4 -k -s -o /dev/null -w '%{http_code}' "${HARBOR_URL}/v2/" || true)"
    echo "HTTP /v2/: $http_code"

    if [[ "$http_code" == "200" || "$http_code" == "401" ]]; then
      echo "==> Harbor ready"
      return 0
    fi

    elapsed=$((elapsed + 3))
    if [ "$elapsed" -ge "$timeout" ]; then
      echo "❌ Timeout waiting Harbor"
      exit 1
    fi

    sleep 3
  done
}

# ===== MANUAL HARBOR SETUP GUIDE =====
print_harbor_manual_guide() {
  cat <<EOF

==> MANUAL STEP REQUIRED (Harbor UI)
1) Open Harbor UI: ${HARBOR_URL}
2) Login with an account that can manage project '${PROJECT_NAME}'
3) Create project '${PROJECT_NAME}' (Private)
4) In project '${PROJECT_NAME}', create a Robot Account for CI/CD
5) Grant pull + push permissions for repositories in this project
6) Copy Robot username and secret

Script will ask for robot username/secret and then:
- re-apply Kubernetes image pull/push secrets
- build images
- push images to ${HARBOR_HOST}/${PROJECT_NAME}

EOF
}

confirm_harbor_manual_done() {
  local answer
  read -r -p "Da hoan thanh cac buoc tren UI Harbor? (y/N): " answer
  case "$answer" in
    y|Y|yes|YES)
      ;;
    *)
      echo "❌ Vui long hoan thanh setup tren Harbor UI truoc khi tiep tuc."
      exit 1
      ;;
  esac
}

# ===== INPUT ROBOT CREDENTIALS =====
prompt_robot_credentials() {
  if [[ -z "$CI_USER" ]]; then
    read -r -p "Nhap robot username (vi du: robot\$fctf-ci): " CI_USER
  else
    echo "==> Using CI_USER from environment"
  fi

  if [[ -z "$CI_PASS" ]]; then
    read -r -s -p "Nhap robot password/secret: " CI_PASS
    echo
  else
    echo "==> Using CI_PASS from environment"
  fi

  if [[ -z "$CI_USER" || -z "$CI_PASS" ]]; then
    echo "❌ Robot username/password is required"
    exit 1
  fi
}

# ===== LOGIN REGISTRY =====
login_registry() {
  echo "==> Login registry..."
  echo "$CI_PASS" | "${DOCKER[@]}" login "$HARBOR_HOST" -u "$CI_USER" --password-stdin
}

# ===== BUILD & PUSH =====
build_and_push() {
  local name=$1
  local dockerfile=$2
  local context=$3
  local image
  local dockerfile_path
  local context_path
  local build_no_cache_args=()

  image="${HARBOR_HOST}/${PROJECT_NAME}/${name}:latest"

  if [[ -f "${ROOT_DIR}/${dockerfile}" ]]; then
    dockerfile_path="${ROOT_DIR}/${dockerfile}"
  else
    dockerfile_path="${SCRIPT_DIR}/${dockerfile}"
  fi

  if [[ -d "${ROOT_DIR}/${context}" ]]; then
    context_path="${ROOT_DIR}/${context}"
  else
    context_path="${SCRIPT_DIR}/${context}"
  fi

  echo "==> Building $image"

  if [[ "$BUILD_NO_CACHE" == "true" ]]; then
    build_no_cache_args=(--no-cache)
  fi

  if ! "${DOCKER[@]}" build "${build_no_cache_args[@]}" -t "$image" -f "$dockerfile_path" "$context_path"; then
    echo "❌ Build failed for $image"
    return 1
  fi

  "${DOCKER[@]}" push "$image"
}

# ===== BUILD ALL =====
build_all() {
  build_and_push "contestant-portal" "ContestantPortal/docker/Dockerfile" "ContestantPortal"
  build_and_push "contestant-be" "ControlCenterAndChallengeHostingServer/ContestantBE/Dockerfile" "ControlCenterAndChallengeHostingServer"
  build_and_push "deployment-center" "ControlCenterAndChallengeHostingServer/DeploymentCenter/Dockerfile" "ControlCenterAndChallengeHostingServer"
  build_and_push "deployment-listener" "ControlCenterAndChallengeHostingServer/DeploymentListener/Dockerfile" "ControlCenterAndChallengeHostingServer"
  build_and_push "deployment-consumer" "ControlCenterAndChallengeHostingServer/DeploymentConsumer/Dockerfile" "ControlCenterAndChallengeHostingServer"
  build_and_push "admin-mvc" "FCTF-ManagementPlatform/Dockerfile" "FCTF-ManagementPlatform"
  build_and_push "challenge-gateway" "ChallengeGateway/Dockerfile" "ChallengeGateway"
  build_and_push "kubectl-cli" "docker/kubectl/dockerfile" "docker/kubectl"
}

# ===== APPLY SECRET =====
apply_secret() {
  local name=$1
  local ns=$2

  kubectl create secret generic "$name" \
    --from-literal=.dockerconfigjson="$DOCKER_CONFIG" \
    --type=kubernetes.io/dockerconfigjson \
    -n "$ns" \
    --dry-run=client -o yaml | kubectl apply -f -
}

ensure_kubectl() {
  if ! command -v kubectl >/dev/null 2>&1; then
    echo "❌ kubectl not found in PATH"
    exit 1
  fi
}

apply_registry_secrets() {
  ensure_kubectl

  echo "==> Re-applying K8s registry secrets using robot account: $CI_USER"

  DOCKER_CONFIG=$(cat <<EOF
{
  "auths": {
    "${HARBOR_HOST}": {
      "username": "${CI_USER}",
      "password": "${CI_PASS}"
    }
  }
}
EOF
)

  apply_secret "global-regcred" "$ARGO_NAMESPACE"
  apply_secret "regcred" "$APP_NAMESPACE"
  apply_secret "docker-registry-creds" "$ARGO_NAMESPACE"
}

# ===== MAIN =====
main() {
  setup_sudo
  install_dependencies
  [[ "$INSTALL_DOCKER" == "true" ]] && install_docker
  detect_docker
  wait_harbor
  print_harbor_manual_guide
  confirm_harbor_manual_done
  prompt_robot_credentials
  apply_registry_secrets
  login_registry
  build_all

  echo "==> DONE"
}

main