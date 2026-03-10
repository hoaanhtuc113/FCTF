# FCTF Testing Suite

Comprehensive testing suite for the FCTF (CTF Platform) system, covering race-condition, stress, and gateway-focused tests.

This directory also contains `SystemTest-Nhat/`, an ordered Playwright admin system-test suite for CRUD and admin-management flows.

## 📁 Test Structure

```
Test/
├── RaceCondition/        # Integration & concurrency tests
│   ├── Various k6 test scripts
│   └── README.md
│
├── Stress/               # Performance & load tests
    ├── 10 stress test scripts
    ├── 4 runner scripts
    ├── README.md
    ├── QUICKSTART.md
    └── FILE_STRUCTURE.md
│
└── Gateway/              # Gateway auth/proxy/rate-limit tests
    ├── k6 scripts + PowerShell runners
    └── README.md

└── SystemTest-Nhat/      # Ordered Playwright admin system tests
    ├── 35 spec files under tests/
    ├── run-ordered-tests.cjs
    ├── playwright.config.ts
    └── all-test-cases.tsv
```

## 🎯 Test Types

### Integration Tests (`RaceCondition/`)
**Purpose**: Verify API functionality and handle concurrency scenarios

**Key Features**:
- Concurrent submission testing
- Dynamic scoring recalculation tests
- Hint unlock concurrency tests
- Cooldown mechanism testing
- Token-based authentication

**Example Tests**:
- `concurrent_correct_submissions.js` - Test race conditions in flag submissions
- `concurrent_dynamic_recalc.js` - Test dynamic score calculation under load
- `concurrent_hint_unlock.js` - Test hint unlock race conditions
- `concurrent_cooldown_attempts.js` - Test cooldown mechanisms
- `concurrent_start_challenge.js` - Test race conditions in challenge start
- `concurrent_stop_challenge.js` - Test race conditions in challenge stop
- `concurrent_max_attempts.js` - Test max-attempts race conditions
- `concurrent_ticket_create.js` - Test duplicate ticket creation race
- `concurrent_ticket_delete.js` - Test ticket delete race conditions

📖 **[See Integration Test README](RaceCondition/README.md)** for detailed documentation.

### Gateway Tests (`Gateway/`)
**Purpose**: Validate ChallengeGateway behavior for token auth, transparent proxying, and rate-limit controls

**Key Features**:
- Token auth flow checks (missing/invalid/expired/valid)
- Redirect and cookie flow verification (`token` stripped from URL)
- Exploit-like payload passthrough load tests
- Rate-limit behavior validation under burst traffic
- TCP auth smoke tests (empty/invalid/valid token)

📖 **[See Gateway Test README](Gateway/README.md)** for detailed documentation.

### Stress Tests (`Stress/`)
**Purpose**: Evaluate performance, scalability, and stability under various load conditions

**Key Features**:
- Multiple test types (smoke, load, spike, stress, soak)
- 20+ API endpoints covered
- HTML report generation
- CI/CD integration
- Non-destructive (read-only operations)

**Test Coverage**:
- ✅ Authentication APIs
- ✅ Challenge management APIs
- ✅ Team information APIs
- ✅ Hint retrieval APIs
- ✅ Scoreboard APIs
- ✅ User profile APIs
- ✅ Notifications APIs
- ✅ Configuration APIs
- ✅ Action logging APIs
- ✅ Ticket system APIs

📖 **[See Stress Test README](Stress/README.md)** for detailed documentation.

### Admin System Tests (`SystemTest-Nhat/`)
**Purpose**: Validate admin-side end-to-end workflows such as user/team management, submission moderation, bracket management, and custom field configuration.

**Key Features**:
- Ordered execution through `run-ordered-tests.cjs`
- Serial Playwright execution for shared admin data
- Excel-ready testcase export in `all-test-cases.tsv`
- Focused admin CRUD and validation coverage from UC23 to UC82

**Quick Start**:

```powershell
cd Test\SystemTest-Nhat
npm test
```

See [../TEST_AUTOMATION.md](../TEST_AUTOMATION.md) for the consolidated testcase inventory.

## 🚀 Quick Start

### Prerequisites

Both test suites require **k6** - install it first:

```powershell
# Windows - using Winget
winget install k6

# Windows - using Chocolatey
choco install k6

# Or download from: https://k6.io/docs/get-started/installation/
```

### Integration Tests Quick Start

```powershell
cd Test\RaceCondition

# Copy and configure environment
Copy-Item .env.example .env
notepad .env  # Add your configuration

# Run all tests
.\run-k6-batch.ps1
```

### Gateway Tests Quick Start

```powershell
cd Test\Gateway

# Copy and configure environment
Copy-Item .env.example .env
notepad .env  # Add gateway URL and token/private key

# Run full gateway suite
.\run-gateway-tests.ps1
```

### Stress Tests Quick Start

```powershell
cd Test\Stress

# Copy and configure environment
Copy-Item .env.example .env
notepad .env  # Add your configuration

# Quick smoke test
.\run-all-stress.ps1 -Quick

# Full load test
.\run-all-stress.ps1
```

## 📊 Comparison: Integration vs Stress Tests

| Aspect | Integration Tests | Stress Tests |
|--------|------------------|--------------|
| **Purpose** | Verify functionality | Measure performance |
| **Scope** | Specific scenarios | All read-only APIs |
| **Load** | Moderate (race conditions) | High (load/stress) |
| **Duration** | Quick (seconds-minutes) | Longer (minutes-hours) |
| **Data Modification** | Yes (test scenarios) | No (read-only) |
| **Best For** | CI/CD functionality tests | Performance benchmarking |
| **When to Run** | Every deployment | Before releases, capacity planning |

## 🎭 Test Scenarios by Use Case

### Pre-Deployment Validation
```powershell
# 1. Run integration tests to verify functionality
cd Test\Integration
.\run-k6-batch.ps1

# 2. Run smoke test to verify APIs under minimal load
cd ..\Stress
.\run-all-stress.ps1 -Quick
```

### Performance Benchmarking
```powershell
cd Test\Stress

# Run load test to establish baseline
.\run-all-stress.ps1 -TestType load

# Generate HTML report for stakeholders
.\run-with-report.ps1 -TestType load
```

### Capacity Planning
```powershell
cd Test\Stress

# Find system breaking point
.\run-all-stress.ps1 -TestType stress

# Test spike resilience
.\run-all-stress.ps1 -TestType spike
```

### Stability Testing
```powershell
cd Test\Stress

# Long-running soak test (30+ minutes)
.\run-all-stress.ps1 -TestType soak
```

### Race Condition Testing
```powershell
cd Test\Integration

# Test concurrent submissions
k6 run --env-file .env concurrent_correct_submissions.js

# Test concurrent hint unlocks
k6 run --env-file .env concurrent_hint_unlock.js
```

## 🔧 Configuration

### Integration Tests Configuration

`.env` variables:
```env
BASE_URL=http://localhost:5000
CHALLENGE_ID=1
USERNAME=testuser
PASSWORD=testpass
CATEGORY=Web
VUS=10
DURATION=30s
```

### Stress Tests Configuration

`.env` variables:
```env
BASE_URL=http://localhost:5000
USERNAME=testuser
PASSWORD=testpass
TEST_TYPE=load          # smoke|load|spike|stress|soak
TOP_COUNT=10
```

## 📈 Understanding Results

### Integration Test Results
Focus on:
- ✅ All checks pass
- ✅ No race condition errors
- ✅ Expected behavior under concurrency

### Stress Test Results
Monitor:
- **Response Times**: p(95) < 500ms (load), < 2000ms (stress)
- **Error Rate**: < 5% (load), < 20% (stress)
- **Throughput**: Requests per second
- **Check Success Rate**: > 95%

Example good stress test result:
```
http_req_duration..............: avg=120ms p(95)=350ms
http_req_failed................: 2.00%
checks.........................: 98.50%
```

## 📚 Documentation Index

| Document | Location | Purpose |
|----------|----------|---------|
| RaceCondition Tests README | `RaceCondition/README.md` | Integration/race-condition test documentation |
| Stress Tests README | `Stress/README.md` | Complete stress test documentation |
| Gateway Tests README | `Gateway/README.md` | Gateway test usage and metrics |
| Gateway Test Cases | `Gateway/TestCases.md` | Full report-ready gateway test cases and test-type mapping |
| Stress Tests Quick Start | `Stress/QUICKSTART.md` | 5-minute quick start guide |
| Stress Tests File Structure | `Stress/FILE_STRUCTURE.md` | Detailed file descriptions |

## 🎓 Learning Path

1. **Start Here**: Read this README
2. **Integration Tests**: Go to `RaceCondition/README.md`
3. **Gateway Tests**: Go to `Gateway/README.md` then `Gateway/TestCases.md`
4. **Stress Tests**: Go to `Stress/QUICKSTART.md`
5. **Deep Dive**: Read `Stress/README.md` for complete details
6. **Reference**: Use `Stress/FILE_STRUCTURE.md` as reference

## 🛠️ Common Tasks

### Run All Integration Tests
```powershell
cd Test\Integration
.\run-k6-batch.ps1
```

### Run All Stress Tests (Quick)
```powershell
cd Test\Stress
.\run-all-stress.ps1 -Quick
```

### Test Specific API Under Load
```powershell
cd Test\Stress
.\run-single-stress.ps1 -TestFile "challenge-stress.js" -TestType load
```

### Generate Performance Report
```powershell
cd Test\Stress
.\run-with-report.ps1 -TestType load
```

### CI/CD Integration
```powershell
# Integration tests in CI
cd Test\Integration
k6 run --env-file .env concurrent_correct_submissions.js

# Stress tests in CI
cd ..\Stress
.\run-ci.ps1 -BaseUrl $env:API_URL -Username $env:API_USER -Password $env:API_PASS
```

## 🐛 Troubleshooting

### k6 Not Found
```powershell
# Install k6
winget install k6

# Verify installation
k6 version

# Restart PowerShell
```

### Authentication Failures
1. Check `.env` file exists and has correct credentials
2. Verify API is running at BASE_URL
3. Test login manually in browser/Postman
4. Check user is not banned/locked

### High Error Rates in Stress Tests
1. Start with smoke test to verify basic functionality
2. Check server resources (CPU, memory, database connections)
3. Review application logs for errors
4. Reduce VU count and gradually increase

### Tests Run Too Long
```powershell
# Use quick mode for stress tests
.\run-all-stress.ps1 -Quick

# Or run specific test only
.\run-single-stress.ps1 -TestFile "auth-stress.js" -TestType smoke
```

## 📊 Test Coverage Summary

### APIs Tested

| Category | Integration | Stress | Total |
|----------|-------------|--------|-------|
| Auth | ✅ | ✅ | ✅ |
| Challenge | ✅ | ✅ | ✅ |
| Team | ✅ | ✅ | ✅ |
| Hint | ✅ | ✅ | ✅ |
| Scoreboard | ❌ | ✅ | ✅ |
| Notifications | ❌ | ✅ | ✅ |
| Config | ❌ | ✅ | ✅ |
| Users | ❌ | ✅ | ✅ |
| ActionLogs | ❌ | ✅ | ✅ |
| Tickets | ❌ | ✅ | ✅ |

**Total API Coverage**: ~95% of read endpoints, ~70% of write endpoints

## 🎯 Best Practices

1. **Always run smoke tests first** before load/stress tests
2. **Isolate test environment** from production
3. **Monitor resources** during tests (CPU, memory, DB)
4. **Start small** and gradually increase load
5. **Document baselines** for comparison
6. **Run regularly** to catch performance regressions
7. **Use CI/CD integration** for automated testing

## 🤝 Contributing

To add new tests:

### For Integration Tests
1. Create new `.js` test file in `Integration/`
2. Follow existing patterns
3. Update `Integration/README.md`

### For Stress Tests
1. Create new `*-stress.js` file in `Stress/`
2. Add to `$allTests` in `run-all-stress.ps1`
3. Update `Stress/README.md` and `Stress/FILE_STRUCTURE.md`

## 📞 Support

- Check README files in each test directory
- Review k6 documentation: https://k6.io/docs/
- Check test file comments for specific behavior
- Review server logs for error details

## 📄 License

Part of the FCTF project.

---

**Quick Links**:
- [Integration Tests →](Integration/README.md)
- [Stress Tests →](Stress/README.md)
- [Stress Tests Quick Start →](Stress/QUICKSTART.md)
- [k6 Documentation →](https://k6.io/docs/)
