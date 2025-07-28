#!/bin/bash

# Màu
RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
NC='\033[0m'

check_container() {
    cid=$1
    cname=$(docker inspect --format='{{.Name}}' "$cid" | sed 's/^\/\(.*\)/\1/')

    echo -e "\n🔍 Đang kiểm tra container: ${YELLOW}$cname${NC} (ID: $cid)"

    # 1. Kiểm tra --privileged
    privileged=$(docker inspect --format='{{.HostConfig.Privileged}}' "$cid")
    if [ "$privileged" == "true" ]; then
        echo -e "⚠️  ${RED}Container chạy với --privileged!${NC}"
    else
        echo -e "✅ Không dùng --privileged."
    fi

    # 2. Kiểm tra mount volume vào thư mục nhạy cảm
    mounts=$(docker inspect --format='{{range .Mounts}}{{.Source}} -> {{.Destination}}{{"\n"}}{{end}}' "$cid")
    echo "$mounts" | grep -E "/(etc|root|var|sys|proc|boot|lib|usr)" >/dev/null
    if [ $? -eq 0 ]; then
        echo -e "⚠️  ${RED}Container mount vào thư mục nhạy cảm:${NC}"
        echo "$mounts" | grep -E "/(etc|root|var|sys|proc|boot|lib|usr)"
    else
        echo -e "✅ Không mount vào thư mục hệ thống nhạy cảm."
    fi

    # 3. Kiểm tra mount docker.sock
    echo "$mounts" | grep "/var/run/docker.sock" >/dev/null
    if [ $? -eq 0 ]; then
        echo -e "❗ ${RED}Container có quyền truy cập Docker socket!${NC}"
    else
        echo -e "✅ Không mount docker.sock."
    fi

    # 4. Kiểm tra capabilities nguy hiểm
    caps=$(docker inspect --format='{{json .HostConfig.CapAdd}}' "$cid")
    if echo "$caps" | grep -E -q 'SYS_ADMIN|NET_ADMIN|ALL'; then
        echo -e "⚠️  ${RED}Container được cấp capability nguy hiểm:${NC} $caps"
    else
        echo -e "✅ Không cấp capability nguy hiểm."
    fi
}

# Main
containers=$(docker ps -q)

if [ -z "$containers" ]; then
    echo "Không có container nào đang chạy."
    exit 0
fi

for cid in $containers; do
    check_container "$cid"
done
