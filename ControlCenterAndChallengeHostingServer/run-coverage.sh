#!/bin/bash

# Script để chạy tests và generate HTML coverage report
# Usage: ./run-coverage.sh

set -e

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  DeploymentCenter Coverage Report${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# Navigate to project directory
cd "$(dirname "$0")"
PROJECT_DIR="/home/ubuntu/FCTF-Platform-Deploy/ControlCenterAndChallengeHostingServer"
cd "$PROJECT_DIR"

# Step 1: Run tests with coverage
echo -e "${YELLOW}Step 1: Running tests with coverage...${NC}"
dotnet test DeploymentCenter.Tests/DeploymentCenter.Tests.csproj \
  /p:CollectCoverage=true \
  /p:CoverletOutputFormat=opencover \
  /p:Include="[DeploymentCenter]*"

if [ $? -ne 0 ]; then
    echo -e "${YELLOW}Warning: Some tests failed, but continuing with coverage report...${NC}"
fi

echo ""

# Step 2: Check if reportgenerator is installed
echo -e "${YELLOW}Step 2: Checking ReportGenerator...${NC}"
if ! command -v reportgenerator &> /dev/null; then
    echo -e "${YELLOW}ReportGenerator not found. Installing...${NC}"
    dotnet tool install -g dotnet-reportgenerator-globaltool
    export PATH="$PATH:$HOME/.dotnet/tools"
fi

echo ""

# Step 3: Generate HTML report
echo -e "${YELLOW}Step 3: Generating HTML coverage report...${NC}"
reportgenerator \
  -reports:"DeploymentCenter.Tests/coverage.opencover.xml" \
  -targetdir:"DeploymentCenter.Tests/coverage-report" \
  -reporttypes:"Html;HtmlSummary;Badges;TextSummary"

echo ""

# Step 4: Display results
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  Coverage Report Generated!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "Report location: ${BLUE}DeploymentCenter.Tests/coverage-report/index.html${NC}"
echo ""
echo "To view the report:"
echo "  1. Open in browser:"
echo -e "     ${BLUE}xdg-open DeploymentCenter.Tests/coverage-report/index.html${NC}"
echo ""
echo "  2. Or navigate to:"
echo -e "     ${BLUE}$PROJECT_DIR/DeploymentCenter.Tests/coverage-report/${NC}"
echo ""

# Display text summary if available
if [ -f "DeploymentCenter.Tests/coverage-report/Summary.txt" ]; then
    echo -e "${YELLOW}Coverage Summary:${NC}"
    cat "DeploymentCenter.Tests/coverage-report/Summary.txt"
    echo ""
fi

echo -e "${GREEN}Done!${NC}"
