#!/bin/bash

# Script để port-forward tất cả services cho development local
# Sử dụng: bash local-port-forward.sh

echo "Starting port-forward for all services..."
echo "Press Ctrl+C to stop all port-forwards"
echo ""

# Tạo thư mục logs nếu chưa có
mkdir -p /tmp/k3s-portforward

# Function để cleanup khi exit
cleanup() {
    echo ""
    echo "Stopping all port-forwards..."
    pkill -f "kubectl port-forward"
    echo "Cleanup completed!"
    exit 0
}

trap cleanup SIGINT SIGTERM

# Port-forward CTF Apps
echo "Starting port-forward: Admin Portal (http://localhost:8000)"
kubectl port-forward -n app svc/admin-mvc-svc 8000:8000 --address 0.0.0.0 &
sleep 2

echo "Starting port-forward: Contestant Portal (http://localhost:5173)"
kubectl port-forward -n app svc/contestant-portal-svc 5173:5173 --address 0.0.0.0 &
sleep 2

echo "Starting port-forward: API Backend (http://localhost:5010)"
kubectl port-forward -n app svc/contestant-be-svc 5010:5010 --address 0.0.0.0 &
sleep 2

echo "Starting port-forward: Deployment Center (http://localhost:5020)"
kubectl port-forward -n app svc/deployment-center-svc 5020:5020 --address 0.0.0.0 &
sleep 2

# Port-forward Tools
echo "Starting port-forward: Filebrowser (http://localhost:8080)"
kubectl port-forward -n storage svc/filebrowser 8080:80 --address 0.0.0.0 &
sleep 2

echo "Starting port-forward: Grafana (http://localhost:3000)"
kubectl port-forward -n monitoring svc/prometheus-grafana 3000:80 --address 0.0.0.0 &
sleep 2

echo "Starting port-forward: Argo Workflows (http://localhost:2746)"
kubectl port-forward -n argo svc/argo-workflows-server 2746:2746 --address 0.0.0.0 &
sleep 2

# Port-forward K8s Dashboard UI
echo "Starting port-forward: Kubernetes Dashboard (http://localhost:8001)"
kubectl port-forward -n kubernetes-dashboard svc/kubernetes-dashboard-web 8001:8000 --address 0.0.0.0 &
sleep 2

echo ""
echo "=========================================="
echo "CTF Applications:"
echo "=========================================="
echo "Admin Portal:        http://localhost:8000"
echo "Contestant Portal:   http://localhost:5173"
echo "Contestant API:      http://localhost:5010"
echo "Deployment Center:   http://localhost:5020"
echo ""
echo "=========================================="
echo "Monitoring & Tools:"
echo "=========================================="
echo "Filebrowser:       http://localhost:8080"
echo "   Username: admin | Password: admin"
echo ""
echo "Grafana:           http://localhost:3000"
echo "   Username: admin"
echo "   Password: (run: kubectl get secret -n monitoring prometheus-grafana -o jsonpath=\"{.data.admin-password}\" | base64 -d)"
echo ""
echo "Argo Workflows:    http://localhost:2746"
echo ""
echo "K8s Dashboard:     http://localhost:8001"
echo "   Đăng nhập bằng token admin-user hoặc kubeconfig"
echo ""
echo "=========================================="
echo "Logs: /tmp/k3s-portforward/"
echo "Press Ctrl+C to stop all port-forwards"
echo "=========================================="

# Wait for all background processes
wait
