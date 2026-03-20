
## /etc/rancher/k3s/k3s.yaml 
## /var/lib/rancher/k3s/server/node-token

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
  --wait --debug

# Cài cert-manager để tạo ssl cho các service (https)
helm repo add jetstack https://charts.jetstack.io
helm repo update
helm upgrade --install cert-manager jetstack/cert-manager \
  --namespace cert-manager --create-namespace \
  --set installCRDs=true \
  --set webhook.securePort=10250

# cài linkerd service mesh để mã hóa pod-to-pod bằng mTLS và cấp workload identity tự động
helm repo add linkerd https://helm.linkerd.io/stable
helm repo update
helm upgrade --install linkerd-crds linkerd/linkerd-crds \
  --namespace linkerd --create-namespace
helm upgrade --install linkerd-control-plane linkerd/linkerd-control-plane \
  --namespace linkerd \
  -f ./helm/linkerd/control-plane-values.yaml \
  --wait


# # Cài jenkins để tạo pipeline
# helm repo add jenkins https://charts.jenkins.io
# helm repo update
# helm upgrade --install jenkins jenkins/jenkins \
#   --namespace jenkins --create-namespace \
#   -f ./dev/helm/jenkins/jenkins-values.yaml

# Cài mariadb
helm repo add bitnami https://charts.bitnami.com/bitnami
helm repo update
helm upgrade --install mariadb bitnami/mariadb \
  --namespace db --create-namespace \
  -f ./helm/db/mariadb/mariadb-values.yaml

# Cài redis
helm repo add bitnami https://charts.bitnami.com/bitnami
helm repo update
helm upgrade --install redis bitnami/redis \
  --namespace db --create-namespace \
  -f ./helm/db/redis/redis-values.yaml 

  # cài rabbitmq
helm repo add bitnami https://charts.bitnami.com/bitnami
helm repo update
helm upgrade --install rabbitmq bitnami/rabbitmq \
  --namespace db --create-namespace \
  -f ./helm/db/rabbitmq/rabbitmq-values.yaml \
  --set global.security.allowInsecureImages=true

# cài monitoring stack (prometheus, grafana, loki, promtail)
helm repo add grafana https://grafana.github.io/helm-charts
helm repo update
helm upgrade --install loki-stack grafana/loki-stack \
  --namespace monitoring --create-namespace \
  -f ./helm/monitoring/loki-stack-values.yaml

helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo update
helm upgrade --install prometheus prometheus-community/kube-prometheus-stack \
  -n monitoring --create-namespace \
  -f ./helm/monitoring/prometheus-stack-values.yaml

# cài prometheus mysql exporter để giám sát mysql
helm upgrade --install prometheus-mysql-exporter \
  prometheus-community/prometheus-mysql-exporter \
  --namespace monitoring \
  --create-namespace \
  -f ./helm/monitoring/mysql-exporter-values.yaml



# cài argo workflows
helm repo add argo https://argoproj.github.io/argo-helm
helm repo update
helm upgrade --install argo-workflows argo/argo-workflows \
  --namespace argo --create-namespace \
  -f ./helm/argo/argo-values.yaml

#cài k8s dashboard
# helm repo add kubernetes-dashboard https://kubernetes.github.io/dashboard/
# helm repo update
# helm upgrade --install kubernetes-dashboard kubernetes-dashboard/kubernetes-dashboard \
#   --create-namespace --namespace kubernetes-dashboard

# cài rancher
helm repo add rancher-latest https://releases.rancher.com/server-charts/latest
helm repo update
helm upgrade --install rancher rancher-latest/rancher \
  -n cattle-system \
  --create-namespace \
  -f ./helm/rancher/rancher-values.yaml

# helm repo add nfs-ganesha-server-and-external-provisioner https://kubernetes-sigs.github.io/nfs-ganesha-server-and-external-provisioner/
# helm repo update
# helm upgrade --install nfs nfs-ganesha-server-and-external-provisioner/nfs-server-provisioner \
#   --create-namespace --namespace storage \
#   -f ./dev/helm/nfs/nfs-values.yaml

#cài filebrowser
helm repo add utkuozdemir https://utkuozdemir.github.io/helm-charts
helm repo update
helm upgrade --install filebrowser utkuozdemir/filebrowser \
  --create-namespace --namespace storage \
  -f ./helm/filebrowser/values.yaml

#cài sonarqube
# helm repo add sonarqube https://SonarSource.github.io/helm-chart-sonarqube
# helm repo update
# helm upgrade --install sonarqube sonarqube/sonarqube \
#   --namespace sonarqube --create-namespace \
#   -f ./prod/helm/sonarqube/sonar-values.yaml

# Bật mTLS mặc định toàn bộ namespace nội bộ (kể cả DB) bằng Linkerd policy.
# Không áp cho ingress-nginx/cert-manager vì cần nhận traffic từ bên ngoài mesh.
for ns in app challenge db argo monitoring storage ctfd; do
  if kubectl get namespace "${ns}" >/dev/null 2>&1; then
    kubectl annotate namespace "${ns}" linkerd.io/inject=enabled --overwrite
    kubectl annotate namespace "${ns}" config.linkerd.io/default-inbound-policy=all-authenticated --overwrite
  fi
done