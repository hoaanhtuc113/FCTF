#!/bin/bash
set -e

NAMESPACE="monitoring"
PROM_STACK_VERSION="39.13.0"   # Chart kube-prometheus-stack cũ (hợp 1.21)
LOKI_STACK_VERSION="2.8.4"     # Chart loki-stack cũ (hợp 1.21)
GRAFANA_PORT=3000
SYSTEMD_SERVICE="/etc/systemd/system/grafana-portforward.service"
BACKUP_DIR="/home/ubuntu/FCTF-Platform-Deploy/grafana-backup"
DASHBOARD_DIR="/home/ubuntu/FCTF-Platform-Deploy/grafana-dashboards"


WORK_DIR="/home/ubuntu/FCTF-Platform-Deploy/ctf-directory"
ACTIVATE_SCRIPT="kctf/activate"

activate_k8s_env() {
    if [ -d "$WORK_DIR" ] && [ -f "$WORK_DIR/$ACTIVATE_SCRIPT" ]; then
        cd "$WORK_DIR" || { echo "Failed to cd to $WORK_DIR"; exit 1; }
        source "$ACTIVATE_SCRIPT"
        # Verify kubectl is accessible
        kubectl cluster-info &> /dev/null || { echo "Kubernetes cluster not accessible after activation"; exit 1; }
    else
        echo "Directory $WORK_DIR or activate script $ACTIVATE_SCRIPT not found"
        exit 1
    fi
}



usage() {
    echo "Usage: $0 {install|restart|uninstall|port-forward|status|stop|check-logs|pods|restart-pods|grafana-pass|grafana-reset-pass <newpass>|grafana-users}"
    echo "  install        Cài mới hoặc upgrade Prometheus + Loki stack"
    echo "  restart        Xóa và cài lại stack"
    echo "  uninstall      Gỡ hoàn toàn stack"
    echo "  port-forward   Chạy port-forward Grafana bằng systemd"
    echo "  status-portforward         Kiểm tra trạng thái port-forward"
    echo "  stop-portforward           Dừng port-forward"
    echo "  check-logs     Xem log của Grafana/Prometheus/Loki"
    echo "  pods           Liệt kê pod trong namespace $NAMESPACE"
    echo "  restart-pods   Restart toàn bộ pod stack"
    echo "  grafana-pass          In mật khẩu admin Grafana"
    echo "  grafana-reset-pass    Đặt lại mật khẩu admin Grafana"
    echo "  grafana-users         Liệt kê tài khoản Grafana"
    echo "  grafana-dashboards          Liệt kê tất cả dashboards (UID + tiêu đề)"
    echo "  grafana-export-dashboard <uid>  Export 1 dashboard ra file JSON"
    echo "  grafana-export-all       Export tất cả dashboards ra thư mục backup"
    echo "  grafana-import-all       Import lại dashboards từ thư mục backup"
    exit 1
}

add_helm_repo() {
    activate_k8s_env
    echo "[*] Thêm Helm repo nếu chưa có..."
    helm repo list | grep -q prometheus-community || helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
    helm repo list | grep -q grafana || helm repo add grafana https://grafana.github.io/helm-charts
    helm repo update
}

grafana_pass() {
    activate_k8s_env
    echo "[*] Grafana admin password:"
    kubectl get secret prometheus-grafana -n $NAMESPACE -o jsonpath="{.data.admin-password}" | base64 --decode ; echo
}

grafana_pass_only() {
    activate_k8s_env
    kubectl get secret prometheus-grafana -n $NAMESPACE -o jsonpath="{.data.admin-password}" | base64 --decode ; echo
}

grafana_dashboards() {
    activate_k8s_env
    PASS=$(grafana_pass_only)
    curl -s -u admin:$PASS "http://localhost:$GRAFANA_PORT/api/search?query=" | jq -r '.[] | "\(.uid) \t \(.title)"'
}

grafana_import_all() {
    activate_k8s_env
    echo "[*] Import tất cả dashboards từ $BACKUP_DIR..."
    PASS=$(grafana_pass_only)
    for file in $BACKUP_DIR/*.json; do
        [ -e "$file" ] || continue
        DASH=$(jq -c . "$file")
        curl -s -u admin:$PASS -H "Content-Type: application/json" -X POST \
            -d "{\"dashboard\": $DASH, \"overwrite\": true}" \
            "http://localhost:$GRAFANA_PORT/api/dashboards/db" >/dev/null
        echo "[*] Imported: $file"
    done
    echo "[*] Hoàn tất import dashboards."
}

grafana_export_dashboard() {
    activate_k8s_env
    if [ -z "$1" ]; then
        echo "Usage: $0 grafana-export-dashboard <uid>"
        exit 1
    fi
    PASS=$(grafana_pass_only)
    mkdir -p "$BACKUP_DIR"
    curl -s -u admin:$PASS "http://localhost:$GRAFANA_PORT/api/dashboards/uid/$1" | jq '.dashboard' > "$BACKUP_DIR/dashboard-$1.json"
    echo "[*] Exported: $BACKUP_DIR/dashboard-$1.json"
}

grafana_export_all() {
    activate_k8s_env
    echo "[*] Export tất cả dashboards..."
    mkdir -p "$BACKUP_DIR"
    PASS=$(grafana_pass_only)
    for uid in $(curl -s -u admin:$PASS "http://localhost:$GRAFANA_PORT/api/search?query=" | jq -r '.[].uid'); do
        grafana_export_dashboard "$uid"
    done
    echo "[*] Hoàn tất export vào thư mục $BACKUP_DIR"
}

grafana_reset_pass() {
    activate_k8s_env
    if [ -z "$1" ]; then
        echo "Vui lòng nhập mật khẩu mới: $0 grafana-reset-pass <newpass>"
        exit 1
    fi
    POD=$(kubectl get pods -n $NAMESPACE -l app.kubernetes.io/name=grafana -o jsonpath="{.items[0].metadata.name}")
    echo "[*] Đặt lại mật khẩu admin Grafana thành: $1"
    kubectl exec -n $NAMESPACE -it $POD -- grafana-cli admin reset-admin-password "$1"
}

grafana_users() {
    activate_k8s_env
    PASS=$(kubectl get secret prometheus-grafana -n $NAMESPACE -o jsonpath="{.data.admin-password}" | base64 --decode)
    curl -s -u admin:$PASS "http://localhost:$GRAFANA_PORT/api/users" | jq
}

install_stack() {
    activate_k8s_env
    echo "[*] Tạo namespace $NAMESPACE nếu chưa có..."
    kubectl get ns $NAMESPACE >/dev/null 2>&1 || kubectl create ns $NAMESPACE

    add_helm_repo

    echo "[*] Cài kube-prometheus-stack (Prometheus + Grafana)..."
    helm upgrade --install prometheus prometheus-community/kube-prometheus-stack \
        --version $PROM_STACK_VERSION \
        -n $NAMESPACE

    echo "[*] Cài Loki stack..."
    helm upgrade --install loki grafana/loki-stack \
        --version $LOKI_STACK_VERSION \
        -n $NAMESPACE \
        --set grafana.enabled=false \
        --set prometheus.enabled=false \
        --set pspEnabled=false

    echo "[*] Lấy Grafana admin password:"
    kubectl get secret prometheus-grafana -n $NAMESPACE -o jsonpath="{.data.admin-password}" | base64 --decode ; echo
}

restart_stack() {
    activate_k8s_env
    echo "[*] Backup dashboards trước khi reset..."
    grafana_export_all
    echo "[*] Gỡ stack cũ..."
    helm uninstall prometheus -n $NAMESPACE || true
    helm uninstall loki -n $NAMESPACE || true
    install_stack
    echo "[*] Đợi Grafana khởi động..."
    sleep 30
    echo "[*] Restore dashboards..."
    grafana_import_all
}

uninstall_stack() {
    activate_k8s_env
    echo "[*] Gỡ toàn bộ stack..."
    helm uninstall prometheus -n $NAMESPACE || true
    helm uninstall loki -n $NAMESPACE || true
    kubectl delete ns $NAMESPACE || true
    echo "[*] Đã gỡ xong."
}

setup_portforward_service() {
    
    echo "[*] Tạo systemd service cho port-forward Grafana..."
    cat <<EOF | sudo tee $SYSTEMD_SERVICE >/dev/null
[Unit]
Description=Port Forward Grafana to localhost:3000
After=network.target

[Service]
ExecStart= /bin/bash -c 'source kctf/activate && kubectl port-forward svc/prometheus-grafana -n monitoring 3000:80'
Restart=always
User=ubuntu
WorkingDirectory=/home/ubuntu/FCTF-Platform-Deploy/ctf-directory
StandardOutput=file:/home/ubuntu/FCTF-Platform-Deploy/grafana-portforward.log
StandardError=file:/home/ubuntu/FCTF-Platform-Deploy/grafana-portforward.err.log

[Install]
WantedBy=multi-user.target
EOF
    sudo systemctl daemon-reload
    sudo systemctl enable grafana-portforward
    sudo systemctl start grafana-portforward
    echo "[*] Grafana đang lắng nghe tại http://localhost:$GRAFANA_PORT"
}

check_logs() {
    activate_k8s_env
    echo "[*] Pod hiện có:"
    kubectl get pods -n $NAMESPACE
    echo ""
    read -p "Nhập tên pod để xem log: " POD
    kubectl logs -f -n $NAMESPACE "$POD"
}

list_pods() {
    activate_k8s_env
    kubectl get pods -n $NAMESPACE -o wide
}

restart_pods() {
    activate_k8s_env
    echo "[*] Đang restart toàn bộ pod..."
    kubectl delete pods -n $NAMESPACE --all
    echo "[*] Đã xóa pod. Kubernetes sẽ tự tạo lại."
}

case "$1" in
    install)
        install_stack
        ;;
    restart)
        restart_stack
        ;;
    uninstall)
        uninstall_stack
        ;;
    port-forward)
        setup_portforward_service
        ;;
    status-portforward)
        systemctl status grafana-portforward
        ;;
    stop-portforward)
        sudo systemctl stop grafana-portforward
        ;;
    check-logs)
        check_logs
        ;;
    pods)
        list_pods
        ;;
    restart-pods)
        restart_pods
        ;;
    grafana-pass) grafana_pass_only ;;
    grafana-reset-pass) shift; grafana_reset_pass "$1" ;;
    grafana-users) grafana_users ;;
    grafana-dashboards) grafana_dashboards ;;
    grafana-export-dashboard) shift; grafana_export_dashboard "$1" ;;
    grafana-export-all) grafana_export_all ;;
    grafana-import-all) grafana_import_all ;;
    *)
        usage
        ;;
esac
