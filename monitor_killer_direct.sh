#!/bin/bash

THRESHOLD=90.0

echo "=== Starting Resource Monitor (every 3s) ==="
echo "Will kill top process if CPU or RAM > ${THRESHOLD}%"
echo

# Kiểm tra lệnh `bc` có sẵn không
if ! command -v bc >/dev/null 2>&1; then
  echo "⚠️  'bc' is required but not installed. Run: sudo apt install bc"
  exit 1
fi

while true; do
    TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')

    # Lấy CPU usage (100 - %idle)
    CPU_USAGE=$(top -bn1 | grep "Cpu(s)" | awk '{print 100 - $8}')
    # Lấy RAM usage (% used / total)
    MEM_USAGE=$(free | awk '/Mem:/ {printf("%.2f"), $3/$2 * 100.0}')

    echo "$TIMESTAMP | CPU: $CPU_USAGE% | RAM: $MEM_USAGE%"

    if (( $(echo "$CPU_USAGE > $THRESHOLD" | bc -l) )) || (( $(echo "$MEM_USAGE > $THRESHOLD" | bc -l) )); then
        echo "$TIMESTAMP | 🚨 Resource limit exceeded! Finding top process..."

        # Tìm tiến trình tiêu thụ CPU cao nhất
        TOP_INFO=$(ps -eo pid,%cpu,%mem,comm --sort=-%cpu | awk 'NR==2')
        TOP_PID=$(echo "$TOP_INFO" | awk '{print $1}')
        TOP_CPU=$(echo "$TOP_INFO" | awk '{print $2}')
        TOP_MEM=$(echo "$TOP_INFO" | awk '{print $3}')
        TOP_CMD=$(echo "$TOP_INFO" | awk '{print $4}')

        echo "$TIMESTAMP | 🔪 Killing PID: $TOP_PID ($TOP_CMD) | CPU: $TOP_CPU% | MEM: $TOP_MEM%"

        kill -9 "$TOP_PID" && echo "$TIMESTAMP | ✅ Killed PID $TOP_PID ($TOP_CMD)" || echo "$TIMESTAMP | ❌ Failed to kill PID $TOP_PID"
    fi

    sleep 3
done
