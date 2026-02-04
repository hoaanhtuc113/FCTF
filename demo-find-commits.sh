#!/bin/bash

# Script demo để tạo các commit mẫu và test find-commits.sh
# Chỉ dùng để demo, không chạy trên production

echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║     FCTF - Demo Script để test find-commits.sh            ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo ""

# Tạo thư mục demo
DEMO_DIR="/tmp/fctf-demo-$$"
echo "Tạo thư mục demo: $DEMO_DIR"
mkdir -p "$DEMO_DIR"
cd "$DEMO_DIR"

# Khởi tạo git repo
git init
git config user.name "Demo User"
git config user.email "demo@fctf.com"

echo "Tạo các commit mẫu..."
echo ""

# Commit 1: Security
echo "test1" > test1.txt
git add test1.txt
git commit -m "Fix XSS vulnerability in user input validation"
echo "✓ Tạo commit security #1"

# Commit 2: Query
echo "test2" > test2.txt
git add test2.txt
git commit -m "Optimize database query to reduce N+1 problem"
echo "✓ Tạo commit query #1"

# Commit 3: Performance
echo "test3" > test3.txt
git add test3.txt
git commit -m "Improve performance by adding Redis cache"
echo "✓ Tạo commit performance #1"

# Commit 4: Refactor
echo "test4" > test4.txt
git add test4.txt
git commit -m "Refactor authentication module for better code quality"
echo "✓ Tạo commit refactor #1"

# Commit 5: Security (Vietnamese)
echo "test5" > test5.txt
git add test5.txt
git commit -m "Sửa lỗ hổng bảo mật SQL injection trong form đăng nhập"
echo "✓ Tạo commit security #2 (tiếng Việt)"

# Commit 6: Performance (Vietnamese)
echo "test6" > test6.txt
git add test6.txt
git commit -m "Cải thiện hiệu suất bằng cách tối ưu hóa thuật toán"
echo "✓ Tạo commit performance #2 (tiếng Việt)"

# Commit 7: Regular commit (should not be found)
echo "test7" > test7.txt
git add test7.txt
git commit -m "Add new feature for user profile"
echo "✓ Tạo commit thường (không thuộc category nào)"

# Commit 8: Security + Performance
echo "test8" > test8.txt
git add test8.txt
git commit -m "Patch security vulnerability and optimize query performance"
echo "✓ Tạo commit security + performance"

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "Đã tạo 8 commits mẫu trong: $DEMO_DIR"
echo "═══════════════════════════════════════════════════════════════"
echo ""

# Copy script find-commits.sh vào demo dir
if [ -f "/home/runner/work/FCTF/FCTF/find-commits.sh" ]; then
    cp /home/runner/work/FCTF/FCTF/find-commits.sh .
    chmod +x find-commits.sh
    
    echo "Chạy find-commits.sh để test..."
    echo ""
    ./find-commits.sh all
else
    echo "Không tìm thấy find-commits.sh. Vui lòng chạy từ thư mục FCTF."
    echo ""
    echo "Bạn có thể chạy thủ công:"
    echo "  cd $DEMO_DIR"
    echo "  git log --oneline"
    echo "  # Copy find-commits.sh vào đây và chạy"
fi

echo ""
echo "Để xem tất cả commits đã tạo:"
echo "  cd $DEMO_DIR"
echo "  git log --oneline"
echo ""
echo "Để xóa demo dir:"
echo "  rm -rf $DEMO_DIR"
echo ""
