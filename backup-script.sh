#!/bin/bash

DATA_DIR="./FCTF-ManagementPlatform/data"
BACKUP_DIR="./backups"
TZ_OFFSET="+07:00"

mkdir -p "$BACKUP_DIR"

get_time_now() {
    TZ="Asia/Bangkok" date +"%Y-%m-%d_%H-%M-%S"
}

backup_data() {
    local time_str
    time_str=$(get_time_now)
    local filename="data_backup_${time_str}.zip"

    echo "[+] Backing up all data in: $DATA_DIR"
    zip -r "${BACKUP_DIR}/${filename}" "$DATA_DIR" >/dev/null

    echo "[✔] Backup complete: ${BACKUP_DIR}/${filename}"
}

restore_data() {
    local zip_file=$1

    if [[ ! -f "$zip_file" ]]; then
        echo "[✘] Backup file not found: $zip_file"
        exit 1
    fi

    echo "[!] This will restore data and may overwrite existing files in ${DATA_DIR}"
    read -p "⚠️  Are you sure you want to continue? [y/N]: " confirm
    confirm=${confirm,,}  # convert to lowercase

    if [[ "$confirm" != "y" && "$confirm" != "yes" ]]; then
        echo "[✘] Restore canceled."
        exit 0
    fi

    echo "[...] Restoring data from: $zip_file"
    unzip -o "$zip_file" -d ./ >/dev/null
    echo "[✔] Restore complete. Restart your containers if needed."
}

usage() {
    echo "Usage:"
    echo "  $0 backup                  - Create a zip backup of all data"
    echo "  $0 restore <zip_file>      - Restore data from backup zip"
}

case "$1" in
    backup)
        backup_data
        ;;
    restore)
        if [ -z "$2" ]; then
            echo "[!] Please specify the zip file to restore."
            usage
            exit 1
        fi
        restore_data "$2"
        ;;
    *)
        usage
        ;;
esac
