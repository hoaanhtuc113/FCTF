# Trên config node
sudo mkdir -p /etc/rancher/k3s
sudo tee /etc/rancher/k3s/kubelet.config <<EOF
apiVersion: kubelet.config.k8s.io/v1beta1
kind: KubeletConfiguration
maxPods: 250
EOF

# cài đặt k3s master-node là ip public của server
curl -sfL https://get.k3s.io | INSTALL_K3S_EXEC="server \
  --disable traefik \
  --flannel-backend=none \
  --disable-network-policy \
  --kubelet-arg=config=/etc/rancher/k3s/kubelet.config \
  --write-kubeconfig-mode 644 \
  --tls-san kubeconfig-prod.fctf.cloud" sh -

## install calico
kubectl create -f https://raw.githubusercontent.com/projectcalico/calico/v3.27.0/manifests/tigera-operator.yaml
kubectl create -f https://raw.githubusercontent.com/projectcalico/calico/v3.27.0/manifests/custom-resources.yaml

# cài k3s worker-node là ip private của server
curl -sfL https://get.k3s.io | K3S_URL=https://10.148.0.8:6443 \
  K3S_TOKEN=K1093ecca6c22d2a61c98a88ea654638744c52d46cc09ed4cf8649434312c3af985::server:27a1c0290ab435fbcbd59754dc967345 \
  INSTALL_K3S_EXEC="agent --kubelet-arg=config=/etc/rancher/k3s/kubelet.config" sh -

## /etc/rancher/k3s/k3s.yaml 
## /var/lib/rancher/k3s/server/node-token

# --------------APPLY HELM REPO AND CHARTS-----------------
# cài nginx ingress k3s để route traffic đến các service
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
helm repo update
helm upgrade --install ingress-nginx ingress-nginx/ingress-nginx \
  --namespace ingress-nginx --create-namespace \
  -f ./helm/nginx/nginx-values.yaml

# Cài cert-manager để tạo ssl cho các service (https)
helm repo add jetstack https://charts.jetstack.io
helm repo update
helm upgrade --install cert-manager jetstack/cert-manager \
  --namespace cert-manager --create-namespace \
  --set installCRDs=true

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
# helm repo add bitnami https://charts.bitnami.com/bitnami
# helm repo update
# helm upgrade --install rabbitmq bitnami/rabbitmq \
#   --namespace db --create-namespace \
#   -f ./dev/helm/db/rabbitmq/rabbitmq-values.yaml \
#   --set global.security.allowInsecureImages=true

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

# cài argo workflows
helm repo add argo https://argoproj.github.io/argo-helm
helm repo update
helm upgrade --install argo-workflows argo/argo-workflows \
  --namespace argo --create-namespace \
  -f ./helm/argo/argo-values.yaml

#cài k8s dashboard
helm repo add kubernetes-dashboard https://kubernetes.github.io/dashboard/
helm repo update
helm upgrade --install kubernetes-dashboard kubernetes-dashboard/kubernetes-dashboard \
  --create-namespace --namespace kubernetes-dashboard

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