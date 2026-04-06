# Database Migration Tool

Tool để migrate dữ liệu giữa KCTF và CTFd databases.

## Cài đặt

1. Tạo Python virtual environment:
```bash
python3 -m venv venv
source venv/bin/activate
# Windows PowerShell
# .\\venv\\Scripts\\Activate.ps1
```

2. Cài đặt dependencies:
```bash
pip install -r requirements.txt
```

3. Tạo file `.env` từ `.env.example`:
```bash
cp .env.example .env
```

4. Cập nhật file `.env` với thông tin database của bạn:
```
DB_KCTF_URL=mysql+pymysql://user:password@localhost:3306/kctf_db
DB_CTFD_URL=mysql+pymysql://user:password@localhost:3306/ctfd_db
MAPPING_KCTF_TO_CTFD=./mapping_fctf_to_ctfd.json
MAPPING_CTFD_TO_KCTF=./mapping_ctfd_to_fctf.json
```

5. Đặt file mapping JSON vào thư mục:
- `mapping_fctf_to_ctfd.json` - Config cho migration KCTF → CTFd
- `mapping_ctfd_to_fctf.json` - Config cho migration CTFd → KCTF

## Sử dụng

Activate virtual environment và chạy console:
```bash
source venv/bin/activate
# Windows PowerShell
# .\\venv\\Scripts\\Activate.ps1
python main.py
```

Menu sẽ hiện ra với các options:
- **[1] KCTF → CTFd**: Migrate data từ KCTF sang CTFd
- **[2] CTFd → KCTF**: Migrate data từ CTFd sang KCTF
- **[3] Test Database Connections**: Kiểm tra kết nối database
- **[0] Exit**: Thoát chương trình

## Cấu trúc File

```
database-migration/
├── main.py              # Entry point của application
├── config.py            # Database configuration
├── migrator.py          # Migration logic
├── requirements.txt     # Python dependencies
├── .env.example         # Environment template
├── .env                 # Your environment (gitignored)
├── mapping_fctf_to_ctfd.json   # KCTF→CTFd mapping
└── mapping_ctfd_to_fctf.json   # CTFd→KCTF mapping
```

## Mapping File Format

File mapping JSON có cấu trúc:

```json
{
  "tasks": [
    {
      "name": "task_name",
      "source": { "table": "source_table", "pk": ["id"] },
      "target": { "table": "target_table", "pk": ["id"] },
      "mode": "upsert",
      "preSQL": ["SET FOREIGN_KEY_CHECKS=0"],
      "postSQL": ["SET FOREIGN_KEY_CHECKS=1"],
      "columns": {
        "target_col1": { "from": "source_col1" },
        "target_col2": { "const": "constant_value" }
      }
    }
  ]
}
```

## Lưu ý

⚠️ **QUAN TRỌNG:**
- Backup database trước khi chạy migration
- Test trên môi trường development trước
- Kiểm tra mapping configuration cẩn thận
- Migration sẽ INSERT/UPDATE data, có thể ghi đè data hiện tại

## Features

- ✅ Upsert mode (Insert nếu chưa tồn tại, Update nếu đã tồn tại)
- ✅ Column mapping linh hoạt (from source hoặc constant value)
- ✅ Pre/Post SQL execution
- ✅ Error handling và reporting
- ✅ Migration statistics
- ✅ Connection testing
- ✅ Confirmation prompt trước khi migrate

## Troubleshooting

**Lỗi kết nối database:**
- Kiểm tra DB_KCTF_URL và DB_CTFD_URL trong .env
- Đảm bảo database server đang chạy
- Kiểm tra username/password và quyền truy cập

**Lỗi mapping:**
- Kiểm tra file JSON có đúng format không
- Đảm bảo tên table và column khớp với database schema
- Check primary key columns tồn tại

**Foreign key constraint errors:**
- Sử dụng preSQL/postSQL để tạm thời disable foreign key checks:
  ```json
  "preSQL": ["SET FOREIGN_KEY_CHECKS=0"],
  "postSQL": ["SET FOREIGN_KEY_CHECKS=1"]
  ```


cd /home/ubuntu/FCTF-Platform-Deploy/database-migration

# 1. Tạo virtual environment
python3 -m venv venv
source venv/bin/activate
# Windows PowerShell
# .\\venv\\Scripts\\Activate.ps1

# 2. Cài đặt dependencies
pip install -r requirements.txt

# 3. Tạo file .env
cp .env.example .env

# 4. Sửa .env với thông tin database của bạn
nano .env

# 5. Copy 2 file mapping JSON vào thư mục này
# mapping_fctf_to_ctfd.json và mapping_ctfd_to_fctf.json

# 6. Chạy console
python main.py

# Khi muốn thoát virtual environment
deactivate