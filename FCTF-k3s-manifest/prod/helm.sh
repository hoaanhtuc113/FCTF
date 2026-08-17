#!/usr/bin/env bash
# Without this, a failed chart install or a `kubectl wait` that times out was
# just an error line in the log: the script kept going and exited with the
# status of the last command, so apply-fctf.sh saw a successful Helm phase and
# only failed much later, far from the cause.
set -euo pipefail

# Grafana, Rancher and Harbor previously shared one admin password written
# into their values files, so a single copy of this repository was enough to
# log into all three - one of them being the cluster-admin console. The
# passwords are now generated on this machine and injected with --set below;
# nothing here is committed.
# shellcheck source=../platform-credentials.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/platform-credentials.sh"
fctf_ensure_platform_credentials

# --------------APPLY HELM REPO AND CHARTS-----------------
# Tạo PriorityClass (cần cho ingress-nginx và một số chart khác)
kubectl apply -f ./priority-classes.yaml
kubectl apply -f ./runtime-class.yaml

# cài nginx ingress k3s để route traffic đến các service
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
helm repo update
helm upgrade --install ingress-nginx ingress-nginx/ingress-nginx \
  --namespace ingress-nginx --create-namespace \
  -f ./helm/nginx/nginx-values.yaml \
  --debug

# Cài cert-manager để tạo ssl cho các service (https)
helm repo add jetstack https://charts.jetstack.io
helm repo update
helm upgrade --install cert-manager jetstack/cert-manager \
  --namespace cert-manager --create-namespace \
  --set installCRDs=true \
  --set webhook.securePort=10250 \
  --debug

# Internal CA + Redis server certificate.
# Order matters: the Redis chart mounts the redis-tls secret, so the pod will
# not start until cert-manager has filled it. Each step waits rather than
# racing - the webhook rejects Certificate objects until it is serving, and the
# CA ClusterIssuer is not usable until its own certificate is signed.
kubectl wait --for=condition=Available --timeout=300s \
  deployment --all -n cert-manager
kubectl apply -f ./cert-manager/internal-ca.yaml
kubectl wait --for=condition=Ready --timeout=180s \
  certificate/fctf-internal-ca -n cert-manager
kubectl apply -f ./db/redis-tls-cert.yaml
kubectl wait --for=condition=Ready --timeout=180s \
  certificate/redis-tls -n db

# Cài mariadb
helm repo add bitnami https://charts.bitnami.com/bitnami
helm repo update
helm upgrade --install mariadb bitnami/mariadb \
  --namespace db --create-namespace \
  -f ./helm/db/mariadb/mariadb-values.yaml \
  --debug

# Cài redis
helm repo add bitnami https://charts.bitnami.com/bitnami
helm repo update
helm upgrade --install redis bitnami/redis \
  --namespace db --create-namespace \
  -f ./helm/db/redis/redis-values.yaml \
  --debug

  # cài rabbitmq
helm repo add bitnami https://charts.bitnami.com/bitnami
helm repo update
helm upgrade --install rabbitmq bitnami/rabbitmq \
  --namespace db --create-namespace \
  -f ./helm/db/rabbitmq/rabbitmq-values.yaml \
  --set global.security.allowInsecureImages=true \
  --set auth.password="${RABBITMQ_ADMIN_PASSWORD}" \
  --debug

# RabbitMQ ignores auth.password if the PVC is already initialized.
# We must manually sync the admin password and ensure administrator permissions
# are set so the user can actually log into the Management UI.
(
  echo "==> Waiting for RabbitMQ to be ready to sync admin password..."
  kubectl wait --for=condition=Ready pod -l app.kubernetes.io/name=rabbitmq -n db --timeout=300s >/dev/null 2>&1 || true
  kubectl exec -n db statefulset/rabbitmq -- rabbitmqctl change_password admin "${RABBITMQ_ADMIN_PASSWORD}" >/dev/null 2>&1 || true
  kubectl exec -n db statefulset/rabbitmq -- rabbitmqctl set_user_tags admin administrator >/dev/null 2>&1 || true
  kubectl exec -n db statefulset/rabbitmq -- rabbitmqctl set_permissions -p / admin ".*" ".*" ".*" >/dev/null 2>&1 || true
  echo "==> RabbitMQ admin password synced successfully."
) &

# cài monitoring stack (prometheus, grafana, loki, promtail)
helm repo add grafana https://grafana.github.io/helm-charts
helm repo update
helm upgrade --install loki-stack grafana/loki-stack \
  --namespace monitoring --create-namespace \
  -f ./helm/monitoring/loki-stack-values.yaml \
  --debug

helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo update
helm upgrade --install prometheus prometheus-community/kube-prometheus-stack \
  -n monitoring --create-namespace \
  -f ./helm/monitoring/prometheus-stack-values.yaml \
  --set grafana.adminPassword="${GRAFANA_ADMIN_PASSWORD}" \
  --debug


# cài argo workflows
helm repo add argo https://argoproj.github.io/argo-helm
helm repo update
helm upgrade --install argo-workflows argo/argo-workflows \
  --namespace argo --create-namespace \
  -f ./helm/argo/argo-values.yaml \
  --debug

# cài harbor registry
helm repo add harbor https://helm.goharbor.io
helm repo update
helm upgrade --install harbor harbor/harbor \
  --namespace registry --create-namespace \
  -f ./helm/registry/harbor-values.yaml \
  --set harborAdminPassword="${HARBOR_ADMIN_PASSWORD}" \
  --debug

# cài rancher
helm repo add rancher-latest https://releases.rancher.com/server-charts/latest
helm repo update
helm upgrade --install rancher rancher-latest/rancher \
  -n cattle-system \
  --create-namespace \
  -f ./helm/rancher/rancher-values.yaml \
  --set bootstrapPassword="${RANCHER_BOOTSTRAP_PASSWORD}" \
  --debug

