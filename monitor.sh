#!/bin/bash

# Directory and environment setup
WORK_DIR="/home/ubuntu/FCTF-Platform-Deploy/ctf-directory"
ACTIVATE_SCRIPT="kctf/activate"
# File to store CSV output
CSV_FILE="/home/ubuntu/k8s_resource_usage2.csv"
# Sleep interval between checks (in seconds)
SLEEP_INTERVAL=60

# Ensure CSV file exists and has headers
if [ ! -f "$CSV_FILE" ]; then
    echo "Timestamp,Pod_Count,Free_Memory_GB,Available_Memory_GB,Total_Memory_GB,CPU_Usage_Percent" > "$CSV_FILE"
fi

# Function to activate Kubernetes environment
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

# Function to get Kubernetes pod count (running pods)
get_pod_count() {
    if command -v jq &> /dev/null; then
        kubectl get pods --all-namespaces --field-selector=status.phase=Running -o json | jq '.items | length'
    else
        kubectl get pods --all-namespaces --field-selector=status.phase=Running --no-headers | wc -l
    fi
}

# Function to get memory usage (free, available, and total in GB)
get_memory_usage() {
    free -g | awk '/Mem:/ {print $4 "," $7 "," $2}'
}

# Function to get CPU usage (approximation)
get_cpu_usage() {
    # Use top to get CPU idle percentage, then calculate usage as 100 - idle
    top -bn1 | grep "Cpu(s)" | awk '{print 100 - $8}'
}

# Activate Kubernetes environment once at start
activate_k8s_env

# Main loop
while true; do
    # Get current timestamp
    TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')
    
    # Get number of running Kubernetes pods
    POD_COUNT=$(get_pod_count)
    
    # Get memory usage (free, available, and total in GB)
    MEMORY_USAGE=$(get_memory_usage)
    FREE_MEMORY=$(echo "$MEMORY_USAGE" | cut -d',' -f1)
    AVAILABLE_MEMORY=$(echo "$MEMORY_USAGE" | cut -d',' -f2)
    TOTAL_MEMORY=$(echo "$MEMORY_USAGE" | cut -d',' -f3)
    
    # Get CPU usage percentage
    CPU_USAGE=$(get_cpu_usage)
    
    # Print current resource usage
    echo "[$TIMESTAMP] Pods: $POD_COUNT, Free Memory: $FREE_MEMORY GB, Available Memory: $AVAILABLE_MEMORY GB, Total Memory: $TOTAL_MEMORY GB, CPU Usage: $CPU_USAGE%"
    
    # Append to CSV file
    echo "$TIMESTAMP,$POD_COUNT,$FREE_MEMORY,$AVAILABLE_MEMORY,$TOTAL_MEMORY,$CPU_USAGE" >> "$CSV_FILE"
    
    # Sleep for the specified interval
    sleep "$SLEEP_INTERVAL"
done