#!/usr/bin/env bash
set -euo pipefail

# ===== CONFIG =====
HARBOR_URL="https://registry.fctf.site"
HARBOR_HOST="registry.fctf.site"

ADMIN_USER="admin"
ADMIN_PASSWORD="FCTF@2025"

PROJECT_NAME="fctf"

ARGO_NAMESPACE="argo"
APP_NAMESPACE="app"

INSTALL_NERDCTL="true"

# ===== PATH RESOLUTION =====
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(realpath "${SCRIPT_DIR}/..")"

echo "==> SCRIPT_DIR: $SCRIPT_DIR"
echo "==> ROOT_DIR:   $ROOT_DIR"

# ===== INSTALL DEPENDENCIES =====
install_dependencies() {
  echo "==> Checking dependencies..."

  install_pkg() {
    PKG=$1
    if ! command -v "$PKG" >/dev/null 2>&1; then
      echo "==> Installing $PKG..."
      if command -v apt-get >/dev/null 2>&1; then
        sudo apt-get update -y
        sudo apt-get install -y "$PKG"
      elif command -v yum >/dev/null 2>&1; then
        sudo yum install -y "$PKG"
      elif command -v apk >/dev/null 2>&1; then
        sudo apk add --no-cache "$PKG"
      else
        echo "❌ Unsupported package manager"
        exit 1
      fi
    fi
  }

  install_pkg curl
  install_pkg jq
  install_pkg git
  install_pkg ca-certificates

  echo "==> Dependencies OK"
}

# ===== CHECK CONTAINERD =====
check_containerd() {
  echo "==> Checking containerd (k3s)..."

  SOCKET="/run/k3s/containerd/containerd.sock"

  if [[ ! -S "$SOCKET" ]]; then
    echo "❌ containerd socket not found: $SOCKET"
    exit 1
  fi

  if ! sudo nerdctl --address "$SOCKET" info >/dev/null 2>&1; then
    echo "❌ containerd not responding"
    exit 1
  fi

  echo "==> containerd OK (k3s)"
}

# ===== INSTALL NERDCTL =====
install_nerdctl() {
  if command -v nerdctl >/dev/null 2>&1; then
    echo "==> nerdctl already installed"
    return
  fi

  echo "==> Installing nerdctl..."

  ARCH=$(uname -m)
  case "$ARCH" in
    x86_64|amd64) ARCH="amd64" ;;
    aarch64|arm64) ARCH="arm64" ;;
    *) echo "Unsupported arch: $ARCH"; exit 1 ;;
  esac

  VERSION="1.7.5"

  curl -L https://github.com/containerd/nerdctl/releases/download/v${VERSION}/nerdctl-${VERSION}-linux-${ARCH}.tar.gz \
    | sudo tar -C /usr/local -xz

  echo "==> nerdctl installed"
}

# ===== DETECT NERDCTL =====
detect_nerdctl() {
  SOCKET="/run/k3s/containerd/containerd.sock"

  if command -v nerdctl >/dev/null 2>&1 && \
     nerdctl --address "$SOCKET" info >/dev/null 2>&1; then
    NERDCTL="nerdctl --address $SOCKET --namespace k8s.io"
  else
    NERDCTL="sudo nerdctl --address $SOCKET --namespace k8s.io"
  fi

  echo "==> Using: $NERDCTL"
}

# ===== WAIT HARBOR =====
wait_harbor() {
  echo "==> Waiting Harbor..."
  until curl -k -s --fail "${HARBOR_URL}/api/v2.0/ping" | grep -q "pong"; do
    sleep 3
  done
}

# ===== LOGIN ADMIN =====
login_admin() {
  echo "==> Login admin..."

  TOKEN=$(curl -k -s --fail -X POST "${HARBOR_URL}/api/v2.0/users/login" \
    -H "Content-Type: application/json" \
    -d "{\"principal\":\"${ADMIN_USER}\",\"password\":\"${ADMIN_PASSWORD}\"}" \
    | jq -r '.token')

  if [[ -z "$TOKEN" || "$TOKEN" == "null" ]]; then
    echo "❌ Harbor login failed"
    exit 1
  fi

  AUTH_HEADER="Authorization: Bearer ${TOKEN}"
}

# ===== CREATE PROJECT =====
create_project() {
  echo "==> Create project..."
  curl -k -s --fail -X POST "${HARBOR_URL}/api/v2.0/projects" \
    -H "$AUTH_HEADER" \
    -H "Content-Type: application/json" \
    -d "{\"project_name\":\"${PROJECT_NAME}\",\"public\":false}" \
    || true
}

# ===== CREATE ROBOT =====
create_robot () {
  local name=$1
  local permissions=$2

  curl -k -s --fail -X POST "${HARBOR_URL}/api/v2.0/robots" \
    -H "$AUTH_HEADER" \
    -H "Content-Type: application/json" \
    -d "{
      \"name\": \"${name}\",
      \"level\": \"project\",
      \"permissions\": [
        {
          \"kind\": \"project\",
          \"namespace\": \"${PROJECT_NAME}\",
          \"access\": ${permissions}
        }
      ]
    }"
}

# ===== SETUP ROBOTS =====
setup_robots() {
  echo "==> Creating robots..."

  READ_JSON=$(create_robot "${PROJECT_NAME}-read" '[{"resource":"repository","action":"pull"}]')
  CI_JSON=$(create_robot "${PROJECT_NAME}-ci" '[{"resource":"repository","action":"pull"},{"resource":"repository","action":"push"}]')

  READ_USER=$(echo "$READ_JSON" | jq -r '.name')
  READ_PASS=$(echo "$READ_JSON" | jq -r '.secret')

  CI_USER=$(echo "$CI_JSON" | jq -r '.name')
  CI_PASS=$(echo "$CI_JSON" | jq -r '.secret')
}

# ===== LOGIN REGISTRY =====
login_registry() {
  echo "==> Login registry..."
  echo "$CI_PASS" | $NERDCTL login "$HARBOR_HOST" -u "$CI_USER" --password-stdin
}

# ===== BUILD & PUSH =====
build_and_push () {
  local name=$1
  local dockerfile=$2
  local context=$3

  IMAGE="${HARBOR_HOST}/${PROJECT_NAME}/${name}:latest"

  if [[ -f "${ROOT_DIR}/${dockerfile}" ]]; then
    DOCKERFILE_PATH="${ROOT_DIR}/${dockerfile}"
  else
    DOCKERFILE_PATH="${SCRIPT_DIR}/${dockerfile}"
  fi

  if [[ -d "${ROOT_DIR}/${context}" ]]; then
    CONTEXT_PATH="${ROOT_DIR}/${context}"
  else
    CONTEXT_PATH="${SCRIPT_DIR}/${context}"
  fi

  echo "==> Building $IMAGE"

  $NERDCTL build -t "$IMAGE" -f "$DOCKERFILE_PATH" "$CONTEXT_PATH"
  $NERDCTL push "$IMAGE"
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

  build_and_push "kubectl-cli" "docker/kubectl/Dockerfile" "docker/kubectl"
}

# ===== APPLY SECRET =====
apply_secret () {
  local name=$1
  local ns=$2

  kubectl create secret generic "$name" \
    --from-literal=.dockerconfigjson="$DOCKER_CONFIG" \
    --type=kubernetes.io/dockerconfigjson \
    -n "$ns" \
    --dry-run=client -o yaml | kubectl apply -f -
}

# ===== MAIN =====
main() {

  install_dependencies  
  [[ "$INSTALL_NERDCTL" == "true" ]] && install_nerdctl
  check_containerd
  
  detect_nerdctl
  wait_harbor
  login_admin
  create_project
  setup_robots
  login_registry

  build_all


  echo "==> Creating K8s secrets..."
  if [[ -z "$READ_PASS" || "$READ_PASS" == "null" ]]; then
    echo "❌ READ robot failed"
    exit 1
  fi

  if [[ -z "$CI_PASS" || "$CI_PASS" == "null" ]]; then
    echo "❌ CI robot failed"
    exit 1
  fi

  DOCKER_CONFIG_READ=$(cat <<EOF
{
  "auths": {
    "${HARBOR_HOST}": {
      "username": "${READ_USER}",
      "password": "${READ_PASS}"
    }
  }
}
EOF
)

  DOCKER_CONFIG_CI=$(cat <<EOF
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

  # Pull only
  DOCKER_CONFIG="$DOCKER_CONFIG_READ"
  apply_secret "global-regcred" "$ARGO_NAMESPACE"
  apply_secret "regcred" "$APP_NAMESPACE"

  # Push (Kaniko / CI)
  DOCKER_CONFIG="$DOCKER_CONFIG_CI"
  apply_secret "docker-registry-creds" "$ARGO_NAMESPACE"

  echo "==> DONE 🚀"
}

main