#!/bin/bash

# Quick script để chỉ chạy tests
# Usage: ./run-tests.sh

cd /home/ubuntu/FCTF-Platform-Deploy/ControlCenterAndChallengeHostingServer

echo "Running tests..."
dotnet test DeploymentCenter.Tests/DeploymentCenter.Tests.csproj --verbosity normal
