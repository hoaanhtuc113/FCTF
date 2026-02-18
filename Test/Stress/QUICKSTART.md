# Quick Start Guide - FCTF Stress Testing

## 🚀 5-Minute Quick Start

### Step 1: Install k6
```powershell
# Option 1: Using Winget
winget install k6

# Option 2: Using Chocolatey
choco install k6

# Option 3: Download from https://k6.io/docs/get-started/installation/
```

### Step 2: Configure Environment
```powershell
# Navigate to Stress folder
cd Test\Stress

# Copy environment template
Copy-Item .env.example .env

# Edit .env file with your credentials
notepad .env
```

**Minimum required in .env:**
```env
BASE_URL=http://localhost:5000
USERNAME=your_username
PASSWORD=your_password
```

### Step 3: Run Your First Test
```powershell
# Quick smoke test (1 minute, 1 VU)
.\run-all-stress.ps1 -Quick

# If successful, run full load test
.\run-all-stress.ps1
```

## 📊 Common Scenarios

### Scenario 1: Quick Health Check
**Use case:** Verify APIs are working before deployment
```powershell
.\run-all-stress.ps1 -Quick
```

### Scenario 2: Load Testing
**Use case:** Test system under normal load
```powershell
.\run-all-stress.ps1 -TestType load
```

### Scenario 3: Spike Testing
**Use case:** Verify resilience during traffic spikes
```powershell
.\run-all-stress.ps1 -TestType spike
```

### Scenario 4: Find Breaking Point
**Use case:** Determine maximum capacity
```powershell
.\run-all-stress.ps1 -TestType stress
```

### Scenario 5: Test Specific API
**Use case:** Focus on one component
```powershell
# Test only Challenge APIs
.\run-single-stress.ps1 -TestFile "challenge-stress.js" -TestType load

# Test only Authentication
.\run-single-stress.ps1 -TestFile "auth-stress.js" -TestType spike
```

### Scenario 6: Generate HTML Report
**Use case:** Get visual report in browser
```powershell
.\run-with-report.ps1 -TestType load
```

### Scenario 7: All-in-One Test
**Use case:** Test all APIs in one script
```powershell
k6 run --env-file .env -e TEST_TYPE=load all-in-one-stress.js
```

## 🎯 Test Type Selection Guide

| Scenario | Test Type | Duration | VUs | Best For |
|----------|-----------|----------|-----|----------|
| Quick validation | `smoke` | 1 min | 1 | CI/CD, pre-deployment checks |
| Normal load | `load` | 6 min | 50-100 | Baseline performance |
| Traffic spike | `spike` | 3 min | 20-200 | Black Friday, event launches |
| Find limits | `stress` | 12 min | 50-300 | Capacity planning |
| Long-term | `soak` | 34 min | 50 | Memory leak detection |

## ⚡ Pro Tips

### Tip 1: Run Tests in Order
```powershell
# Always start with smoke test
.\run-all-stress.ps1 -Quick

# Then move to load test
.\run-all-stress.ps1 -TestType load

# Then stress test
.\run-all-stress.ps1 -TestType stress
```

### Tip 2: Test One API at a Time Initially
```powershell
# Find which API is slow
.\run-single-stress.ps1 -TestFile "challenge-stress.js" -TestType load
.\run-single-stress.ps1 -TestFile "team-stress.js" -TestType load
```

### Tip 3: Use Pattern Matching
```powershell
# Test only Challenge-related APIs
.\run-all-stress.ps1 -Only Challenge

# Test Team and Hint
.\run-all-stress.ps1 -Only "Team|Hint"
```

### Tip 4: Monitor While Testing
Open these in separate terminals:
```powershell
# Terminal 1: Run stress test
.\run-all-stress.ps1 -TestType load

# Terminal 2: Monitor server logs
# (SSH to server or check log files)

# Terminal 3: Monitor database
# (Check query performance, connections)

# Terminal 4: Monitor Redis
redis-cli MONITOR
```

### Tip 5: Save Test Results
```powershell
# Run with HTML report
.\run-with-report.ps1 -TestType load

# Results saved to: results/summary_TIMESTAMP.html
```

## 🔍 Interpreting Results

### ✅ Good Results
```
http_req_duration..............: avg=120ms p(95)=350ms
http_req_failed................: 2.00%
checks.........................: 98.50%
```

### ⚠️ Warning Signs
```
http_req_duration..............: avg=800ms p(95)=2000ms
http_req_failed................: 8.00%
checks.........................: 85.00%
```
**Action:** Investigate slow endpoints, check server resources

### ❌ Critical Issues
```
http_req_duration..............: avg=3000ms p(95)=10000ms
http_req_failed................: 25.00%
checks.........................: 60.00%
```
**Action:** System is overloaded, reduce load or scale up

## 🐛 Troubleshooting

### Problem: "k6: command not found"
**Solution:**
```powershell
# Check installation
Get-Command k6

# If not found, install
winget install k6

# Restart PowerShell after install
```

### Problem: "Missing env var: USERNAME"
**Solution:**
```powershell
# Check .env file exists
Test-Path .env

# If not exists, copy from example
Copy-Item .env.example .env

# Edit with credentials
notepad .env
```

### Problem: "Login response missing generatedToken"
**Solution:**
- Check BASE_URL is correct and API is running
- Verify USERNAME and PASSWORD are valid
- Try login manually in browser/Postman first

### Problem: High error rates (>10%)
**Solution:**
1. Check server logs for errors
2. Reduce VU count: Use `-TestType smoke` first
3. Verify database/Redis are running
4. Check network connectivity

### Problem: Tests too slow
**Solution:**
```powershell
# Use fewer VUs
$env:K6_VUS = "10"
k6 run --env-file .env auth-stress.js

# Or use smoke test
.\run-all-stress.ps1 -Quick
```

## 📞 Getting Help

1. **Check README.md** - Full documentation
2. **View test files** - See what each test does
3. **Check logs** - Server and application logs
4. **k6 docs** - https://k6.io/docs/

## 🎬 Complete Example Workflow

```powershell
# 1. Setup (one time)
cd Test\Stress
Copy-Item .env.example .env
notepad .env  # Add credentials

# 2. Quick validation
.\run-all-stress.ps1 -Quick

# 3. Full load test
.\run-all-stress.ps1 -TestType load

# 4. Check specific slow API
.\run-single-stress.ps1 -TestFile "challenge-stress.js" -TestType stress

# 5. Generate report for stakeholders
.\run-with-report.ps1 -TestType load

# 6. Open report
Start-Process results\summary_*.html
```

## 🎉 Success Checklist

- [ ] k6 installed
- [ ] .env file configured
- [ ] Smoke test passes
- [ ] Load test passes
- [ ] Results documented
- [ ] Performance baselines established

**You're ready to stress test! 🚀**
