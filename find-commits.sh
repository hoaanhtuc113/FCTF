#!/bin/bash

# Script để tìm các commit liên quan đến security, query, performance, và refactor
# Author: FCTF Team
# Usage: ./find-commits.sh [all|security|query|performance|refactor]

set -e

# Màu sắc cho output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Hàm hiển thị banner
show_banner() {
    echo -e "${CYAN}╔═══════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${CYAN}║${NC}     ${YELLOW}FCTF - Công cụ tìm kiếm commit theo chủ đề${NC}            ${CYAN}║${NC}"
    echo -e "${CYAN}╚═══════════════════════════════════════════════════════════════╝${NC}"
    echo ""
}

# Hàm hiển thị usage
show_usage() {
    echo -e "${GREEN}Cách sử dụng:${NC}"
    echo "  ./find-commits.sh [category]"
    echo ""
    echo -e "${GREEN}Categories:${NC}"
    echo "  all         - Tìm tất cả các commit liên quan đến security, query, performance, refactor"
    echo "  security    - Tìm các commit về security fixes"
    echo "  query       - Tìm các commit về query optimization"
    echo "  performance - Tìm các commit về performance improvements"
    echo "  refactor    - Tìm các commit về code refactoring"
    echo ""
    echo -e "${GREEN}Ví dụ:${NC}"
    echo "  ./find-commits.sh all"
    echo "  ./find-commits.sh security"
    echo ""
}

# Từ khóa tìm kiếm cho từng loại commit
SECURITY_KEYWORDS=(
    "security"
    "vulnerability"
    "vulnerabilities"
    "CVE"
    "XSS"
    "CSRF"
    "SQL injection"
    "injection"
    "authentication"
    "authorization"
    "bảo mật"
    "lỗ hổng"
    "an ninh"
    "exploit"
    "patch"
    "hotfix"
    "fix.*security"
    "secure"
    "sanitize"
    "escape"
)

QUERY_KEYWORDS=(
    "query"
    "queries"
    "SQL"
    "database"
    "DB"
    "optimize.*query"
    "query.*optimization"
    "query.*performance"
    "truy vấn"
    "cơ sở dữ liệu"
    "N\+1"
    "index"
    "indices"
)

PERFORMANCE_KEYWORDS=(
    "performance"
    "optimize"
    "optimization"
    "speed up"
    "faster"
    "slow"
    "cache"
    "caching"
    "memory leak"
    "memory"
    "hiệu suất"
    "tối ưu"
    "cải thiện"
    "improve.*performance"
    "reduce.*time"
    "latency"
    "throughput"
)

REFACTOR_KEYWORDS=(
    "refactor"
    "refactoring"
    "restructure"
    "cleanup"
    "clean up"
    "code cleanup"
    "improve.*code"
    "code.*quality"
    "cấu trúc lại"
    "tái cấu trúc"
    "dọn dẹp"
    "simplify"
    "rewrite"
)

# Hàm tìm kiếm commit theo keywords
search_commits() {
    local category=$1
    local color=$2
    shift 2
    local keywords=("$@")
    
    echo -e "${color}═══════════════════════════════════════════════════════════════${NC}"
    echo -e "${color}📋 Tìm kiếm commit về: ${category}${NC}"
    echo -e "${color}═══════════════════════════════════════════════════════════════${NC}"
    echo ""
    
    local found=0
    local search_pattern=""
    
    # Tạo pattern tìm kiếm từ các keywords
    for keyword in "${keywords[@]}"; do
        if [ -z "$search_pattern" ]; then
            search_pattern="$keyword"
        else
            search_pattern="$search_pattern\|$keyword"
        fi
    done
    
    # Tìm kiếm commits
    local commits=$(git log --all --pretty=format:"%H|||%an|||%ad|||%s" --date=short --grep="$search_pattern" -i)
    
    if [ -z "$commits" ]; then
        echo -e "${YELLOW}⚠️  Không tìm thấy commit nào liên quan đến ${category}${NC}"
        echo ""
        return 0
    fi
    
    # Hiển thị kết quả
    while IFS= read -r line; do
        if [ -n "$line" ]; then
            found=$((found + 1))
            local hash=$(echo "$line" | awk -F'\\|\\|\\|' '{print $1}')
            local author=$(echo "$line" | awk -F'\\|\\|\\|' '{print $2}')
            local date=$(echo "$line" | awk -F'\\|\\|\\|' '{print $3}')
            local subject=$(echo "$line" | awk -F'\\|\\|\\|' '{print $4}')
            
            echo -e "${GREEN}Commit #${found}:${NC}"
            echo -e "  ${BLUE}Hash:${NC}    ${hash:0:7}"
            echo -e "  ${BLUE}Author:${NC}  $author"
            echo -e "  ${BLUE}Date:${NC}    $date"
            echo -e "  ${BLUE}Subject:${NC} $subject"
            echo ""
        fi
    done <<< "$commits"
    
    echo -e "${color}Tổng số commit tìm thấy: ${found}${NC}"
    echo ""
    
    return 0
}

# Hàm tìm tất cả
search_all() {
    search_commits "SECURITY FIXES" "$RED" "${SECURITY_KEYWORDS[@]}"
    search_commits "QUERY OPTIMIZATION" "$MAGENTA" "${QUERY_KEYWORDS[@]}"
    search_commits "PERFORMANCE IMPROVEMENTS" "$YELLOW" "${PERFORMANCE_KEYWORDS[@]}"
    search_commits "CODE REFACTORING" "$CYAN" "${REFACTOR_KEYWORDS[@]}"
    
    # Note: Một commit có thể xuất hiện trong nhiều category nếu chứa nhiều keyword
    # Ví dụ: "Fix security vulnerability and optimize query performance" sẽ xuất hiện
    # trong cả SECURITY FIXES và QUERY OPTIMIZATION
    echo -e "${GREEN}╔═══════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║${NC}  ${YELLOW}Tìm kiếm hoàn tất!${NC}                                        ${GREEN}║${NC}"
    echo -e "${GREEN}╚═══════════════════════════════════════════════════════════════╝${NC}"
}

# Main script
main() {
    show_banner
    
    # Kiểm tra xem có trong git repository không
    if ! git rev-parse --git-dir > /dev/null 2>&1; then
        echo -e "${RED}❌ Lỗi: Không phải là git repository!${NC}"
        echo "Vui lòng chạy script này trong thư mục git repository."
        exit 1
    fi
    
    local category="${1:-all}"
    
    case "$category" in
        all)
            search_all
            ;;
        security)
            search_commits "SECURITY FIXES" "$RED" "${SECURITY_KEYWORDS[@]}"
            ;;
        query)
            search_commits "QUERY OPTIMIZATION" "$MAGENTA" "${QUERY_KEYWORDS[@]}"
            ;;
        performance)
            search_commits "PERFORMANCE IMPROVEMENTS" "$YELLOW" "${PERFORMANCE_KEYWORDS[@]}"
            ;;
        refactor)
            search_commits "CODE REFACTORING" "$CYAN" "${REFACTOR_KEYWORDS[@]}"
            ;;
        -h|--help|help)
            show_usage
            exit 0
            ;;
        *)
            echo -e "${RED}❌ Lỗi: Category không hợp lệ: $category${NC}"
            echo ""
            show_usage
            exit 1
            ;;
    esac
}

# Chạy script
main "$@"
