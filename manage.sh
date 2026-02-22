#!/bin/bash

# Script quản lý triển khai và vận hành hệ thống FCTF
# Hỗ trợ các môi trường: dev, uat, production
# Định nghĩa đường dẫn gốc của dự án
PROJECT_ROOT="/home/mnhduc/FCTF"

# Kiểm tra quyền sudo ngay từ đầu
if ! sudo -n true 2>/dev/null; then
    echo "Lỗi: Script yêu cầu quyền root (sudo) để thực thi. Vui lòng chạy với 'sudo'."
    echo "Ví dụ: sudo ./manage.sh <môi trường> <lệnh>"
    exit 1
fi

# Kiểm tra PROJECT_ROOT có tồn tại không
if [ ! -d "$PROJECT_ROOT" ]; then
    echo "Lỗi: Đường dẫn PROJECT_ROOT ($PROJECT_ROOT) không tồn tại."
    echo "Vui lòng chỉnh sửa biến PROJECT_ROOT ở đầu file manage.sh cho đúng với thư mục dự án của bạn."
    exit 1
fi

# Danh sách các cổng cần kiểm tra và giải phóng
PORTS=(5000 5001 5010 5020 6379 8000 8010)

# Hàm hiển thị hướng dẫn sử dụng
usage() {
    echo "Sử dụng: $0 <môi trường> <lệnh>"
    echo "Môi trường: dev, uat, production"
    echo "Lệnh:"
    echo "  up                : Khởi động toàn bộ hệ thống (Docker, ChallengeHosting, ControlCenter)."
    echo "  up [no-cache]     : Thêm 'no-cache' để rebuild image trước khi up mà không dùng cache."
    echo "  down              : Dừng và xóa toàn bộ dịch vụ Docker"
    echo "  build             : Build themes và ứng dụng .NET (ChallengeHosting và ControlCenter)"
    echo "  check-env         : Kiểm tra môi trường và cài đặt các công cụ cần thiết nếu chưa có"
    echo "  restart           : Khởi động lại toàn bộ hệ thống"
    echo "  logs              : Hiển thị log của các container Docker trong FCTF-ManagementPlatform"
    echo "  rebuild [no-cache]: Rebuild Docker image (thêm 'no-cache' để không dùng cache)"
    echo "  status            : Kiểm tra trạng thái các container, tiến trình .NET và k8s proxy"
    echo "  clean             : Xóa các file build và container/image Docker"
    echo "  check-config      : Kiểm tra nội dung file appsettings.json và .env"
    echo "  -h, --help        : Hiển thị hướng dẫn này"
    exit 1
}

# Hàm kiểm tra môi trường hợp lệ
check_environment() {
    case "$1" in
        dev|uat|production)
            ;;
        *)
            echo "Lỗi: Môi trường phải là 'dev', 'uat' hoặc 'production'"
            exit 1
            ;;
    esac
}

# Hàm kiểm tra và cài đặt công cụ cần thiết
check_env() {
    echo "Kiểm tra môi trường và các công cụ cần thiết..."

    # Kiểm tra xxd, wget, curl, netcat
    for tool in xxd wget curl netcat; do
        if ! command -v $tool > /dev/null 2>&1; then
            echo "Công cụ $tool chưa được cài đặt. Cài đặt ngay..."
            sudo apt update && sudo apt install -y "$tool"
        else
            echo "$tool đã được cài đặt."
        fi
    done

    # Xóa Node.js và npm hệ thống để tránh xung đột
    echo "Xóa Node.js và npm hệ thống cũ nếu có..."
    sudo apt-get remove --purge -y nodejs npm > /dev/null 2>&1 || true
    sudo rm -rf /usr/bin/node /usr/bin/npm /usr/local/bin/node /usr/local/bin/npm /usr/local/lib/node_modules /etc/apt/sources.list.d/nodesource.list* > /dev/null 2>&1 || true
    sudo apt-get autoremove -y && sudo apt-get autoclean > /dev/null 2>&1 || true

    # Kiểm tra và cài đặt nvm
    if [ -d "$HOME/.nvm" ]; then
        echo "nvm đã được cài đặt, bỏ qua bước cài đặt nvm."
    else
        echo "Installing nvm..."
        curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
        if [ ! -d "$HOME/.nvm" ]; then
            echo "Lỗi: Không thể cài đặt nvm."
            exit 1
        fi
        # Thêm nvm vào ~/.bashrc nếu chưa có
        if ! grep -q "nvm.sh" "$HOME/.bashrc"; then
            echo 'export NVM_DIR="$HOME/.nvm"' >> "$HOME/.bashrc"
            echo '[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"' >> "$HOME/.bashrc"
            echo '[ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"' >> "$HOME/.bashrc"
        fi
    fi

    # Tải nvm environment
    export NVM_DIR="$HOME/.nvm"
    [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
    [ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"

    # Kiểm tra nvm
    if ! command -v nvm > /dev/null 2>&1; then
        echo "Lỗi: nvm không được kích hoạt. Vui lòng kiểm tra thủ công: source $HOME/.nvm/nvm.sh"
        exit 1
    fi

    # Cài đặt Node.js 18 và đặt làm mặc định
    if ! nvm ls 18 > /dev/null 2>&1; then
        echo "Installing Node.js 18 LTS..."
        nvm install 18
        if [ $? -ne 0 ]; then
            echo "Lỗi: Không thể cài đặt Node.js 18."
            exit 1
        fi
    fi
    nvm use 18
    nvm alias default 18

    # Kiểm tra phiên bản Node.js
    if ! command -v node > /dev/null 2>&1 || [[ $(node -v) != v18.* ]]; then
        echo "Lỗi: Node.js không phải phiên bản 18 ($(node -v))."
        echo "Vui lòng kiểm tra: nvm ls"
        nvm ls
        exit 1
    fi
    echo "Node.js đã được cài đặt: $(node -v)"

    # Kiểm tra npm
    if ! command -v npm > /dev/null 2>&1; then
        echo "npm chưa được cài đặt. Cài đặt ngay..."
        nvm install-latest-npm
        if ! command -v npm > /dev/null 2>&1; then
            echo "Lỗi: Không thể cài đặt npm."
            exit 1
        fi
    fi
    echo "npm đã được cài đặt: $(npm -v)"

    # Hiển thị đường dẫn
    echo "Đường dẫn Node.js: $(which node)"
    echo "Đường dẫn npm: $(which npm)"

    # Kiểm tra Docker
    if ! command -v docker > /dev/null 2>&1; then
        echo "Docker chưa được cài đặt. Cài đặt ngay..."
        curl -fsSL https://get.docker.com -o get-docker.sh
        sudo sh get-docker.sh
        sudo usermod -aG docker "$USER"
        echo "Đã thêm người dùng vào nhóm Docker. Vui lòng đăng xuất và đăng nhập lại để áp dụng quyền."
        echo "Hoặc chạy lệnh: newgrp docker"
        rm -f get-docker.sh
        exit 1
    else
        echo "Docker đã được cài đặt: $(docker --version)"
    fi

    # Kiểm tra quyền Docker
    if ! docker info > /dev/null 2>&1; then
        echo "Lỗi: Không có quyền truy cập Docker daemon."
        echo "Đã thử thêm người dùng vào nhóm Docker. Vui lòng đăng xuất và đăng nhập lại."
        echo "Hoặc chạy lệnh: newgrp docker"
        sudo usermod -aG docker "$USER"
        exit 1
    fi

    # Kiểm tra kubectl
    if ! command -v kubectl > /dev/null 2>&1; then
        echo "kubectl chưa được cài đặt. Cài đặt ngay..."
        curl -LO "https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl"
        chmod +x kubectl
        sudo mv kubectl /usr/local/bin/
    else
        echo "kubectl đã được cài đặt: $(kubectl version --client)"
    fi

    # Kiểm tra dotnet SDK 8.0
    if ! command -v dotnet > /dev/null 2>&1 || [[ $(dotnet --version) != 8.* ]]; then
        echo "Dotnet SDK 8.0 chưa được cài đặt. Cài đặt ngay..."
        sudo apt update
        sudo apt install -y apt-transport-https
        wget https://packages.microsoft.com/config/ubuntu/$(lsb_release -rs)/packages-microsoft-prod.deb -O packages-microsoft-prod.deb
        sudo dpkg -i packages-microsoft-prod.deb
        rm packages-microsoft-prod.deb
        sudo apt update
        sudo apt install -y dotnet-sdk-8.0
    else
        echo "Dotnet SDK đã được cài đặt: $(dotnet --version)"
    fi

    # Kiểm tra Python và pip (yêu cầu cho kCTF)
    if ! command -v python3 > /dev/null 2>&1; then
        echo "Python3 chưa được cài đặt. Cài đặt ngay..."
        sudo apt install -y python3
    else
        echo "Python3 đã được cài đặt: $(python3 --version)"
    fi
    if ! command -v pip3 > /dev/null 2>&1; then
        echo "pip3 chưa được cài đặt. Cài đặt ngay..."
        sudo apt install -y python3-pip
    else
        echo "pip3 đã được cài đặt: $(pip3 --version)"
    fi

    echo "Kiểm tra môi trường hoàn tất."
}

# Hàm cập nhật cấu hình appsettings.json
update_appsettings() {
    local env=$1
    local domain="secathon2025.fpt.edu.vn"
    local control_domain="localhost"
    local env_upper=$(echo "$env" | tr '[:lower:]' '[:upper:]')

    # Nếu là môi trường production, hỏi người dùng nhập domain
    if [ "$env" = "production" ]; then
        read -p "Nhập domain cho ChallengeHosting (ví dụ: secathon2025-env.net): " domain
        read -p "Nhập domain cho ControlCenter (ví dụ: localhost nếu controlcenter nằm cùng server): " control_domain
        if [ -z "$domain" ] || [ -z "$control_domain" ]; then
            echo "Lỗi: Domain không được để trống!"
            exit 1
        fi
    fi

    # Tạo thư mục publish nếu chưa tồn tại
    mkdir -p "$PROJECT_ROOT/FCTF-ManagementPlatform"

    # Cập nhật file .env cho FCTF-ManagementPlatform, ContestantBE & DeploymentCenter
    # API_URL_CONTROLSERVER= Địa chỉ IP hoặc domain của ControlCenter
    cat > "$PROJECT_ROOT/.env" << EOF
# Cấu hình cho FCTF-ManagementPlatform
HOST_CACHE=cache:6379
REDIS_HOST=cache
REDIS_PORT=6379
REDIS_PASS=
REDIS_URL=redis://cache:6379
REDIS_DB=0
DATABASE_PORT=3306
DATABASE_URL=mysql+pymysql://ctfd:ctfd@db/ctfd
UPLOAD_PROVIDER=nfs
UP_CHALLENGE_TEMPLATE=up-challenge-template
IMAGE_REPO=fctf
DOCKER_USERNAME=quachuoiscontainer

# Cấu hình dùng chung
PRIVATE_KEY=emdungdepzai_secret_key_fctf_platform_2025
SECRET_KEY=emdungdepzai
ARGO_WORKFLOWS_URL=https://argo.fctf.site/api/v1/workflows/argo
ARGO_WORKFLOWS_TOKEN=eyJhbGciOiJSUzI1NiIsImtpZCI6InYwdURva2hrRmhGRG9yVy11dUwwdWhTdy1fVjNFdHF1RWViZ000QUw1dHcifQ.eyJpc3MiOiJrdWJlcm5ldGVzL3NlcnZpY2VhY2NvdW50Iiwia3ViZXJuZXRlcy5pby9zZXJ2aWNlYWNjb3VudC9uYW1lc3BhY2UiOiJhcmdvIiwia3ViZXJuZXRlcy5pby9zZXJ2aWNlYWNjb3VudC9zZWNyZXQubmFtZSI6ImFyZ28tc2Euc2VydmljZS1hY2NvdW50LXRva2VuIiwia3ViZXJuZXRlcy5pby9zZXJ2aWNlYWNjb3VudC9zZXJ2aWNlLWFjY291bnQubmFtZSI6ImFyZ28tc2EiLCJrdWJlcm5ldGVzLmlvL3NlcnZpY2VhY2NvdW50L3NlcnZpY2UtYWNjb3VudC51aWQiOiI5NzI3YzlhMS01MzYzLTQxNTYtOGZlNS1hZWRjZjY4YTc4OWYiLCJzdWIiOiJzeXN0ZW06c2VydmljZWFjY291bnQ6YXJnbzphcmdvLXNhIn0.UNEBbVnAyOZbeAz0AcfAg-v1kaaFN7QqNj5D-EZdl3pWte4OOBY-r4YvZjpHEt86BhxHJqBoQgSeqAnjckRZqFVvxL20BMag3GxqDehBMZ4Q52DaZpt0_8cSbGzkjbHcEqPxr81zqyOHPVhHAD49kF790iXyvwc7iLDyGPYleK2Td-74vnmmGZWl7OugmOoWObxuI5K2wd5j3sN355sgd8WSRC7WR80JOCa5NBVHVd4oDe52TM30qPEDzyP0byx-JfX8gNLbeuSPSrwa6sJifXLt8lRbZ_5oE2tXF0U4dlaGwgUGjzMNn5Za5OVs09-JSjM3h-hvIVsrdJDOLmK8eQ
DEPLOYMENT_SERVICE_API=http://172.31.177.154:5020
NFS_MOUNT_PATH=/mnt/nfs/data
TCP_DOMAIN=challenge-zg9uj3rfagfja19tzq.fctf.cloud

# Cấu hình cho ContestantBE & DeploymentCenter
ASPNETCORE_ENVIRONMENT=Production
DB_CONNECTION=Server=db;Port=3306;Database=ctfd;User=ctfd;Password=ctfd;
REDIS_CONNECTION=cache:6379
#REDIS_CONNECTION=dbzmn0zjiwmju.fctf.cloud:30379,password=Fctf2025@,defaultDatabase=0

START_CHALLENGE_TEMPLATE=start-chal-v2-template
CPU_LIMIT=300m
CPU_REQUEST=300m
MEMORY_LIMIT=256Mi
MEMORY_REQUEST=256Mi
POW_DIFFICULTY_SECONDS=5 #protect DDOS attack
EOF

    echo "Đã cập nhật cấu hình cho môi trường $env."
}

# Hàm build themes và ứng dụng .NET
build_apps() {
    echo "Build themes và ứng dụng ChallengeHosting, ControlCenter, và giao diện thi sinh viên..."

    # Tải nvm để đảm bảo Node.js 18
    export NVM_DIR="$HOME/.nvm"
    [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
    nvm use 18 --silent || { echo "Lỗi: Không thể sử dụng Node.js 18. Chạy './manage.sh dev check-env' trước."; exit 1; }
    echo "Sử dụng Node.js: $(node -v)"

    # Build themes cho FCTF-ManagementPlatform
    if [ ! -d "$PROJECT_ROOT/FCTF-ManagementPlatform/CTFd/themes" ]; then
        echo "Lỗi: Thư mục FCTF-ManagementPlatform/CTFd/themes không tồn tại."
        exit 1
    fi

    # Build theme admin
    if [ ! -d "$PROJECT_ROOT/FCTF-ManagementPlatform/CTFd/themes/admin" ]; then
        echo "Lỗi: Thư mục FCTF-ManagementPlatform/CTFd/themes/admin không tồn tại."
        exit 1
    fi
    if [ ! -f "$PROJECT_ROOT/FCTF-ManagementPlatform/CTFd/themes/admin/package.json" ]; then
        echo "Lỗi: File package.json không tồn tại trong FCTF-ManagementPlatform/CTFd/themes/admin."
        exit 1
    fi
    echo "Cài đặt dependencies cho theme admin..."
    cd "$PROJECT_ROOT/FCTF-ManagementPlatform/CTFd/themes/admin"
    if ! npm install; then
        echo "Lỗi: Không thể cài đặt dependencies cho theme admin."
        exit 1
    fi
    echo "Build theme admin..."
    if ! npm run build; then
        echo "Lỗi: Không thể build theme admin."
        exit 1
    fi

    # Build theme core-beta
    if [ ! -d "$PROJECT_ROOT/FCTF-ManagementPlatform/CTFd/themes/core-beta" ]; then
        echo "Lỗi: Thư mục FCTF-ManagementPlatform/CTFd/themes/core-beta không tồn tại."
        exit 1
    fi
    if [ ! -f "$PROJECT_ROOT/FCTF-ManagementPlatform/CTFd/themes/core-beta/package.json" ]; then
        echo "Lỗi: File package.json không tồn tại trong FCTF-ManagementPlatform/CTFd/themes/core-beta."
        exit 1
    fi
    echo "Cài đặt dependencies cho theme core-beta..."
    cd "$PROJECT_ROOT/FCTF-ManagementPlatform/CTFd/themes/core-beta"
    # Xóa thư mục static để tránh cache
    rm -rf static
    if ! npm install; then
        echo "Lỗi: Không thể cài đặt dependencies cho theme core-beta."
        exit 1
    fi
    echo "Build theme core-beta..."
    if ! npm run build; then
        echo "Lỗi: Không thể build theme core-beta."
        exit 1
    fi
    # Kiểm tra và di chuyển manifest.json nếu nằm sai chỗ
    if [ -f "$PROJECT_ROOT/FCTF-ManagementPlatform/CTFd/themes/core-beta/static/.vite/manifest.json" ] && [ ! -f "$PROJECT_ROOT/FCTF-ManagementPlatform/CTFd/themes/core-beta/static/manifest.json" ]; then
        echo "File manifest.json được tạo trong static/.vite/, di chuyển đến static/..."
        mv "$PROJECT_ROOT/FCTF-ManagementPlatform/CTFd/themes/core-beta/static/.vite/manifest.json" "$PROJECT_ROOT/FCTF-ManagementPlatform/CTFd/themes/core-beta/static/manifest.json"
    fi
    # Kiểm tra file manifest.json
    if [ ! -f "$PROJECT_ROOT/FCTF-ManagementPlatform/CTFd/themes/core-beta/static/manifest.json" ]; then
        echo "Lỗi: File manifest.json không được tạo trong themes/core-beta/static/ sau khi build."
        echo "Kiểm tra thủ công bằng lệnh:"
        echo "  cd $PROJECT_ROOT/FCTF-ManagementPlatform/CTFd/themes/core-beta && npm run build"
        echo "Tìm file manifest.json bằng:"
        echo "  find $PROJECT_ROOT/FCTF-ManagementPlatform/CTFd/themes/core-beta -name manifest.json"
        exit 1
    fi
    echo "File manifest.json đã được tạo thành công tại themes/core-beta/static/"

    cd "$PROJECT_ROOT"
    echo "Build themes, ứng dụng .NET, và giao diện thi sinh viên hoàn tất."
}

# Hàm khởi động hệ thống
start_system() {
    local env=$1
    local no_cache=$2
    echo "Starting system in $env environment..."

    # Thiết lập umask theo yêu cầu của kCTF
    umask 022

    # Kích hoạt kernel.unprivileged_userns_clone
    echo "kernel.unprivileged_userns_clone=1" | sudo tee -a /etc/sysctl.d/00-local-userns.conf
    sudo sysctl -p /etc/sysctl.d/00-local-userns.conf || true

    # Thiết lập quyền thư mục
    # if [ ! -d "$PROJECT_ROOT/ctf-directory/kctf" ]; then
    #     echo "Lỗi: Thư mục ctf-directory/kctf không tồn tại."
    #     exit 1
    # fi
    # sudo chmod -R 755 "$PROJECT_ROOT/ctf-directory/kctf"

    # if [ ! -d "$PROJECT_ROOT/FCTF-ManagementPlatform" ]; then
    #     echo "Lỗi: Thư mục FCTF-ManagementPlatform không tồn tại."
    #     exit 1
    # fi
    # sudo chmod -R 755 "$PROJECT_ROOT/FCTF-ManagementPlatform"

    # Kiểm tra và dừng các tiến trình trên các cổng được sử dụng
    for port in "${PORTS[@]}"; do
        if sudo lsof -i :$port > /dev/null; then
            echo "Cổng $port đang được sử dụng:"
            sudo lsof -i :$port
            for i in {1..3}; do
                if sudo lsof -i :$port > /dev/null; then
                    echo "Thử dừng tiến trình trên cổng $port (lần $i)..."
                    sudo kill -9 $(sudo lsof -t -i:$port) > /dev/null 2>&1 || true
                    sleep 1
                else
                    break
                fi
            done
            if sudo lsof -i :$port > /dev/null; then
                echo "Lỗi: Không thể giải phóng cổng $port sau nhiều lần thử."
                exit 1
            fi
        fi

    done

    # Chạy kubectl proxy
    if ! sudo lsof -i :8010 > /dev/null; then
        if ! command -v kubectl &> /dev/null; then
            echo "Lỗi: kubectl không được cài đặt. Vui lòng chạy './manage.sh dev check-env' trước."
            exit 1
        fi
        kubectl proxy --address=127.0.0.1 --port=8010 &
        sleep 1
        if ! sudo lsof -i :8010 > /dev/null; then
            echo "Lỗi: Không thể khởi động kubectl proxy trên cổng 8010."
            exit 1
        fi
        echo "kubectl proxy đã khởi động trên cổng 8010."
    fi

    # Kích hoạt môi trường kCTF
    # if [ ! -f "$PROJECT_ROOT/ctf-directory/kctf/activate" ]; then
    #     echo "Lỗi: File kctf/activate không tồn tại."
    #     exit 1
    # fi
    # source "$PROJECT_ROOT/ctf-directory/kctf/activate"

    # # Kiểm tra lệnh kctf
    # if ! command -v kctf &> /dev/null; then
    #     echo "Lỗi: Lệnh kctf không được tìm thấy sau khi kích hoạt môi trường."
    #     echo "Vui lòng kiểm tra cài đặt kCTF trong $PROJECT_ROOT/ctf-directory/kctf."
    #     echo "Thử cài đặt kCTF bằng lệnh:"
    #     echo "  cd $PROJECT_ROOT/ctf-directory/kctf && pip3 install -r requirements.txt"
    #     exit 1
    # fi

    # Tạo cluster kCTF
    # if ! docker info &> /dev/null; then
    #     echo "Lỗi: Không thể truy cập Docker daemon. Vui lòng chạy './manage.sh dev check-env' hoặc đăng xuất/đăng nhập lại."
    #     exit 1
    # fi
    # if ! kctf cluster create local-cluster --start --type kind; then
    #     echo "Lỗi: Không thể tạo cluster kCTF."
    #     exit 1
    # fi

    # Chạy FCTF-ManagementPlatform trước để khởi động Redis và MariaDB
    cd "$PROJECT_ROOT"
    if [ ! -f "docker-compose.yml" ]; then
        echo "Lỗi: File docker-compose.yml không tồn tại trong FCTF-Platform-Deployment."
        exit 1
    fi
    if [ ! -f ".env" ]; then
        echo "Lỗi: File .env không tồn tại trong FCTF-ManagementPlatform."
        exit 1
    fi
    # Nếu yêu cầu rebuild không dùng cache thì build trước
    if [ "$no_cache" = "no-cache" ]; then
        echo "Rebuilding Docker images with --no-cache..."
        docker compose build --no-cache
    fi
    docker compose --env-file .env up --force-recreate -d
    echo "Đang chờ Redis và MariaDB khởi động..."
    sleep 10  # Chờ 10 giây để đảm bảo Redis và MariaDB sẵn sàng

    # Kiểm tra Redis
    if ! docker ps | grep -q redis; then
        echo "Lỗi: Container Redis không chạy. Kiểm tra log Docker:"
        docker compose logs cache
        exit 1
    fi

    # Kiểm tra MariaDB
    if ! docker ps | grep -q mariadb; then
        echo "Lỗi: Container MariaDB không chạy. Kiểm tra log Docker:"
        docker compose logs db
        exit 1
    fi

    # Đảm bảo file log tồn tại và có quyền ghi
    LOG_FILE="$PROJECT_ROOT/fctf-app.log"
    sudo touch "$LOG_FILE"
    sudo chown root:root "$LOG_FILE"
    sudo chmod 664 "$LOG_FILE"

    echo "Hệ thống đã được khởi động trong môi trường $env."
    if [ "$env" = "production" ]; then
        echo "Truy cập portal tại: https://$domain hoặc https://$control_domain"
        echo "Lưu ý: Đảm bảo firewall đã mở các cổng 8000, 5000, 5001, 5010, 5020, 8010 cho phép truy cập từ bên ngoài nếu cần."
    else
        echo "Truy cập portal tại: http://127.0.0.1:8000"
        echo "Lưu ý: Nếu truy cập từ máy khác, hãy kiểm tra firewall và mở các cổng 8000, 5000, 5001, 5010, 5020, 8010."
    fi
}

# Hàm dừng hệ thống
stop_system() {
    echo "Dừng toàn bộ hệ thống..."

    # Dừng dịch vụ systemd cho hai ứng dụng .NET
    for service in fctf-challenge fctf-control fctf-contestant; do
        if systemctl is-active --quiet "$service"; then
            echo "Dừng dịch vụ $service..."
            sudo systemctl stop "$service"
        fi
    done

    # Dừng Docker Compose với xác nhận
    if [ -d "$PROJECT_ROOT" ]; then
        cd "$PROJECT_ROOT"
        if [ "$(docker compose ps -q)" ]; then
            read -p "Dừng container Docker (MariaDB, Redis, CTFd)? Dữ liệu MariaDB được bảo vệ trong .data/mysql, nhưng xác nhận để tiếp tục (y/n) [n]: " confirm_db
            confirm_db="${confirm_db:-n}"
            if [ "$confirm_db" = "y" ] || [ "$confirm_db" = "Y" ]; then
                echo "Dừng và xóa các container Docker..."
                docker compose down
            else
                echo "Bỏ qua việc dừng container Docker để giữ trạng thái hiện tại."
            fi
        fi
        cd "$PROJECT_ROOT"
    fi

    # Dừng các tiến trình .NET và kubectl
    pkill -f kubectl || true

    # Dừng các tiến trình trên các cổng được sử dụng
    for port in "${PORTS[@]}"; do
        if sudo lsof -i :$port > /dev/null; then
            echo "Cổng $port đang được sử dụng. Đang thử dừng tiến trình..."
            for i in {1..3}; do
                if sudo lsof -i :$port > /dev/null; then
                    echo "Thử dừng tiến trình trên cổng $port (lần $i)..."
                    sudo kill -9 $(sudo lsof -t -i:$port) || true
                    sleep 1
                else
                    break
                fi
            done
        fi
    done


    # Deactivate kCTF
    # if command -v deactivate &> /dev/null; then
    #     deactivate
    # fi

    echo "Hệ thống đã được dừng."
}

# Hàm khởi động lại hệ thống
restart_system() {
    stop_system
    start_system $1
}

# Hàm hiển thị log của các container Docker
show_logs() {
    if [ -d "$PROJECT_ROOT" ]; then
        cd "$PROJECT_ROOT"
        if [ "$(docker compose ps -q)" ]; then
            echo "Hiển thị log của các container trong FCTF-ManagementPlatform..."
            docker compose logs
        else
            echo "Không có container nào đang chạy trong FCTF-ManagementPlatform."
        fi
        cd "$PROJECT_ROOT"
    else
        echo "Thư mục FCTF-ManagementPlatform không tồn tại."
    fi
}

# Hàm rebuild Docker image
rebuild_images() {
    # note: caller passes (env, [no-cache]) so read flag from $2
    local no_cache=$2
    if [ -d "$PROJECT_ROOT/FCTF-ManagementPlatform" ]; then
        cd "$PROJECT_ROOT/FCTF-ManagementPlatform"
        echo "Rebuild Docker image cho FCTF-ManagementPlatform..."
        if [ "$no_cache" = "no-cache" ]; then
            docker compose build --no-cache
        else
            docker compose build
        fi
        cd "$PROJECT_ROOT"
        echo "Rebuild hoàn tất."
    else
        echo "Thư mục FCTF-ManagementPlatform không tồn tại."
    fi
}

# Hàm kiểm tra trạng thái hệ thống
check_status() {
    echo "Kiểm tra trạng thái hệ thống..."

    # Kiểm tra container Docker
    if [ -d "$PROJECT_ROOT" ]; then
        cd "$PROJECT_ROOT"
        if [ "$(docker compose ps -q)" ]; then
            echo "Trạng thái container trong FCTF-ManagementPlatform:"
            docker compose ps
        else
            echo "Không có container nào đang chạy trong FCTF-ManagementPlatform."
        fi
        cd "$PROJECT_ROOT"
    else
        echo "Thư mục FCTF-ManagementPlatform không tồn tại."
    fi

    # Kiểm tra dịch vụ systemd
    for service in fctf-challenge fctf-control fctf-contestant; do
        if [ -f "/etc/systemd/system/$service.service" ]; then
            echo "Trạng thái dịch vụ $service:"
            systemctl is-active --quiet "$service" && echo "$service đang chạy." || echo "$service không chạy."
            systemctl status "$service" --no-pager -l | head -n 10
        else
            echo "Dịch vụ $service không tồn tại."
        fi
    done

    # Kiểm tra k8s proxy
    if ps aux | grep -v grep | grep "kubectl proxy" > /dev/null; then
        echo "Kubernetes proxy đang chạy:"
        ps aux | grep -v grep | grep "kubectl proxy"
    else
        echo "Kubernetes proxy không chạy."
    fi

    # Kiểm tra Redis
    if docker ps | grep -q redis; then
        echo "Container Redis đang chạy."
    else
        echo "Container Redis không chạy."
    fi

    # Kiểm tra MariaDB
    if docker ps | grep -q mariadb; then
        echo "Container MariaDB đang chạy."
    else
        echo "Container MariaDB không chạy."
    fi

    # Kiểm tra các cổng
    for port in "${PORTS[@]}"; do
        if sudo lsof -i :$port > /dev/null; then
            echo "Cổng $port đang được sử dụng:"
            sudo lsof -i :$port
        else
            echo "Cổng $port trống."
        fi
    done
}

# Hàm xóa file build và container/image
clean_system() {
    echo "Xóa file build và container/image Docker..."

    # Dừng hệ thống (đã có xác nhận trong stop_system)
    stop_system

    # Xóa image và container với xác nhận
    if [ -d "$PROJECT_ROOT" ]; then
        cd "$PROJECT_ROOT"
        if [ "$(docker compose ps -q)" ]; then
            read -p "Cảnh báo: Xóa container và image Docker? Dữ liệu MariaDB được bảo vệ trong .data/mysql, nhưng xác nhận để tiếp tục (y/n) [n]: " confirm_db
            confirm_db="${confirm_db:-n}"
            if [ "$confirm_db" = "y" ] || [ "$confirm_db" = "Y" ]; then
                echo "Xóa tất cả container và image..."
                docker-compose down --rmi all
                echo "Đã xóa các container và image Docker trong FCTF-ManagementPlatform."
            else
                echo "Bỏ qua xóa container và image để giữ trạng thái hiện tại."
            fi
        fi
        cd "$PROJECT_ROOT"
    fi

    echo "Hệ thống đã được làm sạch."
}

# Hàm kiểm tra cấu hình
check_config() {
    echo "Kiểm tra nội dung các file cấu hình..."

    # kiểm tra .env của ContestantBE
    if [ -f "$PROJECT_ROOT/ControlCenterAndChallengeHostingServer/ContestantBE/.env" ]; then
        echo "Nội dung .env (ContestantBE):"
        cat "$PROJECT_ROOT/ControlCenterAndChallengeHostingServer/ContestantBE/.env"
    else
        echo "File .env của ContestantBE không tồn tại."
    fi

    # kiểm tra .env của DeploymentCenter
    if [ -f "$PROJECT_ROOT/ControlCenterAndChallengeHostingServer/DeploymentCenter/.env" ]; then
        echo "Nội dung .env (DeploymentCenter):"
        cat "$PROJECT_ROOT/ControlCenterAndChallengeHostingServer/DeploymentCenter/.env"
    else
        echo "File .env của DeploymentCenter không tồn tại."
    fi

    # Kiểm tra .env của FCTF-ManagementPlatform
    if [ -f "$PROJECT_ROOT/FCTF-ManagementPlatform/.env" ]; then
        echo "Nội dung .env (FCTF-ManagementPlatform):"
        cat "$PROJECT_ROOT/FCTF-ManagementPlatform/.env"
    else
        echo "File .env của FCTF-ManagementPlatform không tồn tại."
    fi
}

# Kiểm tra tham số đầu vào
if [ $# -lt 2 ]; then
    usage
fi

# Kiểm tra môi trường
ENV=$1
check_environment $ENV

# Xử lý lệnh
case "$2" in
    up)
        update_appsettings $ENV
        # forward optional third arg (e.g. 'no-cache') to start_system
        start_system $ENV $3
        ;;
    down)
        stop_system
        ;;
    build)
        build_apps
        update_appsettings $ENV
        ;;
    check-env)
        check_env
        ;;
    restart)
        restart_system $ENV
        ;;
    logs)
        show_logs
        ;;
    rebuild)
        rebuild_images $ENV $3
        ;;
    status)
        check_status
        ;;
    clean)
        clean_system
        ;;
    check-config)
        check_config
        ;;
    -h|--help)
        usage
        ;;
    *)
        echo "Lệnh không hợp lệ: $2"
        usage
        ;;
esac