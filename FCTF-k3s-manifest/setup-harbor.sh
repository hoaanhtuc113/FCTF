#!/usr/bin/env bash
set -euo pipefail

# ===== CONFIG =====
HARBOR_URL="https://registry.fctf.site"
HARBOR_HOST="registry.fctf.site"

PROJECT_NAME="fctf"

ARGO_NAMESPACE="argo"
APP_NAMESPACE="app"

INSTALL_NERDCTL="true"
INSTALL_BUILDKIT="${INSTALL_BUILDKIT:-true}"
NERDCTL_VERSION="${NERDCTL_VERSION:-2.1.6}"
BUILDKIT_VERSION="${BUILDKIT_VERSION:-0.14.1}"
CONTAINERD_SOCKET="${CONTAINERD_SOCKET:-/run/k3s/containerd/containerd.sock}"
CONTAINERD_WAIT_SECONDS="${CONTAINERD_WAIT_SECONDS:-90}"
HARBOR_WAIT_SECONDS="${HARBOR_WAIT_SECONDS:-180}"
BUILDKIT_SOCKET="${BUILDKIT_SOCKET:-unix:///run/buildkit/buildkitd.sock}"
BUILDKIT_WAIT_SECONDS="${BUILDKIT_WAIT_SECONDS:-60}"
BUILDKIT_LOG_FILE="${BUILDKIT_LOG_FILE:-/tmp/buildkitd.log}"

NERDCTL=()
CI_USER="${CI_USER:-}"
CI_PASS="${CI_PASS:-}"

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
  install_pkg git
  install_pkg ca-certificates
  install_pkg tar

  echo "==> Dependencies OK"
}

# ===== CHECK CONTAINERD =====
check_containerd() {
  echo "==> Checking containerd (k3s)..."

  SOCKET="$CONTAINERD_SOCKET"

  if command -v systemctl >/dev/null 2>&1; then
    if systemctl list-unit-files | grep -q '^k3s\.service'; then
      if ! sudo systemctl is-active --quiet k3s; then
        echo "==> Starting k3s service..."
        sudo systemctl enable --now k3s
      fi
    fi
  fi

  waited=0
  until sudo test -S "$SOCKET"; do
    if (( waited >= CONTAINERD_WAIT_SECONDS )); then
      echo "❌ containerd socket not found after ${CONTAINERD_WAIT_SECONDS}s: $SOCKET"
      exit 1
    fi

    sleep 3
    waited=$((waited + 3))
  done

  waited=0
  until (command -v k3s >/dev/null 2>&1 && sudo k3s ctr version >/dev/null 2>&1) || \
        (command -v ctr >/dev/null 2>&1 && sudo ctr --address "$SOCKET" version >/dev/null 2>&1) || \
        (command -v nerdctl >/dev/null 2>&1 && sudo nerdctl --address "$SOCKET" info >/dev/null 2>&1); do
    if (( waited >= CONTAINERD_WAIT_SECONDS )); then
      echo "❌ containerd not responding after ${CONTAINERD_WAIT_SECONDS}s"
      if command -v systemctl >/dev/null 2>&1; then
        sudo systemctl --no-pager --full status k3s 2>/dev/null || true
        sudo systemctl --no-pager --full status k3s-agent 2>/dev/null || true
      fi
      exit 1
    fi

    sleep 3
    waited=$((waited + 3))
  done

  echo "==> containerd OK (k3s)"
}

# ===== INSTALL NERDCTL =====
install_nerdctl() {
  current_version=""
  if command -v nerdctl >/dev/null 2>&1; then
    current_version="$(nerdctl --version 2>/dev/null | awk '{print $3}')"
    if [[ "$current_version" == "$NERDCTL_VERSION" || "$current_version" == "v${NERDCTL_VERSION}" ]]; then
      echo "==> nerdctl already installed (${current_version})"
      return
    fi

    echo "==> nerdctl ${current_version:-unknown} found, installing v${NERDCTL_VERSION}..."
  else
    echo "==> Installing nerdctl v${NERDCTL_VERSION}..."
  fi

  ARCH=$(uname -m)
  case "$ARCH" in
    x86_64|amd64) ARCH="amd64" ;;
    aarch64|arm64) ARCH="arm64" ;;
    *) echo "Unsupported arch: $ARCH"; exit 1 ;;
  esac

  TMP_DIR="$(mktemp -d)"
  ARCHIVE_PATH="${TMP_DIR}/nerdctl.tar.gz"

  curl -fsSL "https://github.com/containerd/nerdctl/releases/download/v${NERDCTL_VERSION}/nerdctl-${NERDCTL_VERSION}-linux-${ARCH}.tar.gz" \
    -o "$ARCHIVE_PATH"

  tar -xzf "$ARCHIVE_PATH" -C "$TMP_DIR"

  if [[ ! -f "${TMP_DIR}/nerdctl" ]]; then
    echo "❌ Failed to find nerdctl binary in archive"
    rm -rf "$TMP_DIR"
    exit 1
  fi

  sudo install -m 0755 "${TMP_DIR}/nerdctl" /usr/local/bin/nerdctl
  rm -rf "$TMP_DIR"

  echo "==> nerdctl installed: $(nerdctl --version 2>/dev/null || echo 'unknown version')"
}

# ===== INSTALL BUILDKIT =====
install_buildkit() {
  if command -v buildctl >/dev/null 2>&1 && command -v buildkitd >/dev/null 2>&1; then
    echo "==> buildkit already installed"
    return
  fi

  echo "==> Installing buildkit v${BUILDKIT_VERSION}..."

  ARCH=$(uname -m)
  case "$ARCH" in
    x86_64|amd64) ARCH="amd64" ;;
    aarch64|arm64) ARCH="arm64" ;;
    *) echo "Unsupported arch: $ARCH"; exit 1 ;;
  esac

  TMP_DIR="$(mktemp -d)"
  ARCHIVE_PATH="${TMP_DIR}/buildkit.tar.gz"

  curl -fsSL "https://github.com/moby/buildkit/releases/download/v${BUILDKIT_VERSION}/buildkit-v${BUILDKIT_VERSION}.linux-${ARCH}.tar.gz" \
    -o "$ARCHIVE_PATH"

  tar -xzf "$ARCHIVE_PATH" -C "$TMP_DIR"

  if [[ ! -f "${TMP_DIR}/bin/buildctl" || ! -f "${TMP_DIR}/bin/buildkitd" ]]; then
    echo "❌ Failed to find buildctl/buildkitd in archive"
    rm -rf "$TMP_DIR"
    exit 1
  fi

  sudo install -m 0755 "${TMP_DIR}/bin/buildctl" /usr/local/bin/buildctl
  sudo install -m 0755 "${TMP_DIR}/bin/buildkitd" /usr/local/bin/buildkitd
  rm -rf "$TMP_DIR"

  echo "==> buildkit installed: $(buildctl --version 2>/dev/null || echo 'unknown version')"
}

# ===== CHECK BUILDKIT CONNECTION =====
buildkit_ready() {
  buildctl --addr "$BUILDKIT_SOCKET" debug workers >/dev/null 2>&1 || \
  sudo buildctl --addr "$BUILDKIT_SOCKET" debug workers >/dev/null 2>&1
}

# ===== START BUILDKITD =====
start_buildkitd() {
  local socket_path="${BUILDKIT_SOCKET#unix://}"
  local socket_dir
  socket_dir="$(dirname "$socket_path")"

  if buildkit_ready; then
    echo "==> buildkitd already ready"
    return
  fi

  if command -v systemctl >/dev/null 2>&1 && systemctl list-unit-files | grep -q '^buildkit\.service'; then
    echo "==> Starting buildkit service..."
    sudo systemctl enable --now buildkit
  else
    echo "==> Starting buildkitd process..."
    sudo mkdir -p "$socket_dir" /var/lib/buildkit

    if ! sudo ps -eo args | grep -F "buildkitd --addr ${BUILDKIT_SOCKET}" | grep -v grep >/dev/null 2>&1; then
      sudo nohup /usr/local/bin/buildkitd \
        --addr "$BUILDKIT_SOCKET" \
        --root /var/lib/buildkit \
        >"$BUILDKIT_LOG_FILE" 2>&1 &
    fi
  fi

  local waited=0
  until buildkit_ready; do
    if (( waited >= BUILDKIT_WAIT_SECONDS )); then
      echo "❌ buildkitd not ready after ${BUILDKIT_WAIT_SECONDS}s"
      echo "   socket: ${BUILDKIT_SOCKET}"
      echo "   log: ${BUILDKIT_LOG_FILE}"

      if command -v systemctl >/dev/null 2>&1; then
        sudo systemctl --no-pager --full status buildkit 2>/dev/null || true
      fi

      sudo tail -n 40 "$BUILDKIT_LOG_FILE" 2>/dev/null || true
      exit 1
    fi

    sleep 3
    waited=$((waited + 3))
  done

  echo "==> buildkitd ready (${BUILDKIT_SOCKET})"
}

# ===== ENSURE BUILDKIT =====
ensure_buildkit() {
  [[ "$INSTALL_BUILDKIT" == "true" ]] && install_buildkit

  if ! command -v buildctl >/dev/null 2>&1 || ! command -v buildkitd >/dev/null 2>&1; then
    echo "❌ buildkit is required for nerdctl build"
    echo "   Set INSTALL_BUILDKIT=true or manually install buildctl/buildkitd"
    exit 1
  fi

  start_buildkitd
  export BUILDKIT_HOST="$BUILDKIT_SOCKET"
  echo "==> Using BUILDKIT_HOST=${BUILDKIT_HOST}"
}

# ===== DETECT NERDCTL =====
detect_nerdctl() {
  SOCKET="$CONTAINERD_SOCKET"

  if ! command -v nerdctl >/dev/null 2>&1; then
    echo "❌ nerdctl not found in PATH"
    echo "   Set INSTALL_NERDCTL=true and rerun setup-harbor.sh"
    exit 1
  fi

  if command -v nerdctl >/dev/null 2>&1 && \
     nerdctl --address "$SOCKET" info >/dev/null 2>&1; then
    NERDCTL=(nerdctl --address "$SOCKET" --namespace k8s.io)
  elif sudo nerdctl --address "$SOCKET" info >/dev/null 2>&1; then
    NERDCTL=(sudo nerdctl --address "$SOCKET" --namespace k8s.io)
  else
    echo "❌ nerdctl cannot connect to containerd: $SOCKET"
    echo "   Try upgrading nerdctl by setting NERDCTL_VERSION and rerun the script"
    exit 1
  fi

  echo "==> Using: ${NERDCTL[*]}"
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
  echo "$CI_PASS" | "${NERDCTL[@]}" login "$HARBOR_HOST" -u "$CI_USER" --password-stdin
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

  "${NERDCTL[@]}" build -t "$IMAGE" -f "$DOCKERFILE_PATH" "$CONTEXT_PATH"
  "${NERDCTL[@]}" push "$IMAGE"
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
apply_secret () {
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

  install_dependencies  
  [[ "$INSTALL_NERDCTL" == "true" ]] && install_nerdctl
  check_containerd
  
  detect_nerdctl
  ensure_buildkit
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