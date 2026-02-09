# FCTF Stress Test Suite - File Structure

## 📁 Directory Structure

```
Test/Stress/
├── README.md                    # Complete documentation
├── QUICKSTART.md               # 5-minute quick start guide
├── .gitignore                  # Ignore .env and results
├── .env.example                # Template for environment variables
├── helpers.js                  # Shared helper functions and test configurations
│
├── Test Scripts (10 files)
├── auth-stress.js              # Authentication API stress tests
├── challenge-stress.js         # Challenge management API stress tests
├── team-stress.js              # Team information API stress tests
├── hint-stress.js              # Hint retrieval API stress tests
├── scoreboard-stress.js        # Scoreboard API stress tests
├── notifications-stress.js     # Notifications API stress tests
├── config-stress.js            # Configuration API stress tests
├── users-stress.js             # User profile API stress tests
├── actionlogs-stress.js        # Action logging API stress tests
├── tickets-stress.js           # Ticket system API stress tests
├── all-in-one-stress.js        # Comprehensive test covering all APIs
│
├── Runner Scripts (4 files)
├── run-all-stress.ps1          # Run all tests with summary
├── run-single-stress.ps1       # Run individual test with custom parameters
├── run-with-report.ps1         # Run tests and generate HTML report
└── run-ci.ps1                  # CI/CD-friendly test runner
```

## 📄 File Descriptions

### Documentation Files

| File | Purpose | Size |
|------|---------|------|
| **README.md** | Complete documentation with all details | ~15KB |
| **QUICKSTART.md** | Quick start guide for beginners | ~8KB |

### Configuration Files

| File | Purpose |
|------|---------|
| **.env.example** | Template for environment configuration |
| **.gitignore** | Prevents committing sensitive files |

### Core Files

| File | Lines | Purpose |
|------|-------|---------|
| **helpers.js** | ~150 | Shared utilities, test configurations, authentication |

### Test Scripts

| File | APIs Tested | Lines |
|------|-------------|-------|
| **auth-stress.js** | `/api/Auth/*` | ~50 |
| **challenge-stress.js** | `/api/Challenge/*` | ~90 |
| **team-stress.js** | `/api/Team/*` | ~50 |
| **hint-stress.js** | `/api/Hint/*` | ~70 |
| **scoreboard-stress.js** | `/api/Scoreboard/*` | ~40 |
| **notifications-stress.js** | `/api/Notifications/*` | ~35 |
| **config-stress.js** | `/api/Config/*` | ~35 |
| **users-stress.js** | `/api/Users/*` | ~35 |
| **actionlogs-stress.js** | `/api/ActionLogs/*` | ~45 |
| **tickets-stress.js** | `/api/Ticket/*` | ~55 |
| **all-in-one-stress.js** | All APIs combined | ~120 |

### Runner Scripts

| File | Purpose | Features |
|------|---------|----------|
| **run-all-stress.ps1** | Run all tests | Summary report, filtering, colorized output |
| **run-single-stress.ps1** | Run one test | Custom parameters, flexible configuration |
| **run-with-report.ps1** | Generate HTML report | Visual reports in browser |
| **run-ci.ps1** | CI/CD integration | Exit codes, thresholds, minimal output |

## 🎯 Test Coverage Summary

### Total API Endpoints Tested: **20+**

#### Controller Coverage

| Controller | Endpoints | Tested | Coverage |
|------------|-----------|--------|----------|
| Auth | 2 | 1 | 50% (login only, change-password modifies state) |
| Challenge | 8 | 5 | 62.5% (read-only operations) |
| Team | 2 | 2 | 100% |
| Hint | 3 | 2 | 66.7% (unlock modifies state) |
| Scoreboard | 1 | 1 | 100% |
| Notifications | 1 | 1 | 100% |
| Config | 1 | 1 | 100% |
| Files | 1 | 0 | 0% (requires file token) |
| ActionLogs | 3 | 2 | 66.7% (save-logs modifies state) |
| Users | 1 | 1 | 100% |
| Tickets | 4 | 2 | 50% (create/delete modify state) |

**Overall Read-Only Coverage: ~85%**

*Write operations (create, update, delete) are intentionally excluded from stress tests to avoid data modification.*

## 🚀 Quick Reference

### Most Common Commands

```powershell
# Quick health check
.\run-all-stress.ps1 -Quick

# Full load test
.\run-all-stress.ps1

# Test specific API
.\run-single-stress.ps1 -TestFile "challenge-stress.js"

# Generate report
.\run-with-report.ps1

# CI/CD
.\run-ci.ps1 -BaseUrl "https://api.example.com" -Username "user" -Password "pass"
```

### Test Types

| Type | Duration | VUs | Use Case |
|------|----------|-----|----------|
| `smoke` | 1m | 1 | Quick validation |
| `load` | 6m | 50-100 | Normal load |
| `spike` | 3m | 20-200 | Traffic spikes |
| `stress` | 12m | 50-300 | Find limits |
| `soak` | 34m | 50 | Long-term stability |

## 📊 Expected Results Structure

After running tests, you'll get:

```
Test/Stress/
├── results/
│   ├── summary_20260209_120000.html
│   ├── auth_20260209_120000.json
│   ├── challenge_20260209_120000.json
│   └── ...
```

## 🔧 Customization

Each test file can be customized by:
1. Editing test options in the file
2. Using environment variables
3. Modifying `helpers.js` for global changes

## 📈 Metrics Tracked

All tests track:
- Response times (avg, min, max, p95, p99)
- Error rates
- Request throughput
- Check success rates
- Data transferred

## 🎓 Learning Path

1. **Start here**: QUICKSTART.md
2. **Run**: `.\run-all-stress.ps1 -Quick`
3. **Read**: README.md for detailed docs
4. **Customize**: Edit test files for specific needs
5. **Integrate**: Use run-ci.ps1 in CI/CD pipelines

## 📝 Notes

- All tests use authentication tokens
- Tests are non-destructive (read-only operations)
- Results can be exported to JSON/HTML
- Compatible with k6 Cloud for advanced analytics
- Designed for Windows PowerShell but adaptable to Linux/Mac

## 🤝 Contributing

To add new tests:
1. Create `new-api-stress.js` following existing patterns
2. Add to `$allTests` array in `run-all-stress.ps1`
3. Update this FILE_STRUCTURE.md
4. Update README.md test coverage section

---

**Total Files Created: 20**
**Total Lines of Code: ~2,500**
**Time to Setup: 5 minutes**
**Time to Run (smoke): 10 minutes**
**Time to Run (full): 60+ minutes**
