# FCTF Contestant API Stress Tests

Stress test suite for all Contestant Backend APIs using k6.

## 📋 Table of Contents

- [Overview](#overview)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Configuration](#configuration)
- [Test Types](#test-types)
- [Running Tests](#running-tests)
- [Test Coverage](#test-coverage)
- [Understanding Results](#understanding-results)
- [Best Practices](#best-practices)

## 🎯 Overview

This stress test suite validates the performance and scalability of the Contestant Backend APIs under various load conditions. It covers all major API endpoints including authentication, challenges, teams, hints, scoreboard, and more.

## 📦 Prerequisites

1. **k6** - Load testing tool
   - Download from: https://k6.io/docs/get-started/installation/
   - Or install via package manager:
     ```powershell
     # Windows (Chocolatey)
     choco install k6
     
     # Windows (Winget)
     winget install k6
     ```

2. **Access to FCTF API** - Ensure the API is running and accessible

3. **Valid credentials** - Username and password for authentication

## 🚀 Installation

1. Navigate to the Stress test directory:
   ```powershell
   cd Test\Stress
   ```

2. Copy the environment template:
   ```powershell
   Copy-Item .env.example .env
   ```

3. Edit `.env` with your configuration:
   ```env
   BASE_URL=http://localhost:5000
   USERNAME=your_username
   PASSWORD=your_password
   TEST_TYPE=load
   ```

## ⚙️ Configuration

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `BASE_URL` | Yes | - | API base URL (e.g., http://localhost:5000) |
| `USERNAME` | Yes | - | Contestant username for authentication |
| `PASSWORD` | Yes | - | Contestant password |
| `TOKEN` | No | - | Pre-generated JWT token (skips login if provided) |
| `TEST_TYPE` | No | `load` | Type of stress test to run |
| `TOP_COUNT` | No | `10` | Number of top teams to fetch in scoreboard tests |

## 🎭 Test Types

The suite supports multiple test types, each designed for different performance testing scenarios:

### 1. **Smoke Test** (`smoke`)
- **Purpose**: Verify basic functionality with minimal load
- **VUs**: 1
- **Duration**: 1 minute
- **Use case**: Quick sanity check before running larger tests

### 2. **Load Test** (`load`) - **DEFAULT**
- **Purpose**: Assess system behavior under expected load
- **Stages**:
  - Ramp up to 50 VUs (30s)
  - Maintain 50 VUs (2m)
  - Ramp up to 100 VUs (30s)
  - Maintain 100 VUs (2m)
  - Ramp down (30s)
- **Thresholds**:
  - 95th percentile < 500ms
  - 99th percentile < 1000ms
  - Error rate < 5%

### 3. **Spike Test** (`spike`)
- **Purpose**: Test system resilience to sudden traffic spikes
- **Stages**:
  - Normal load: 20 VUs
  - Spike to 200 VUs (10s)
  - Maintain spike (1m)
  - Return to normal
- **Thresholds**:
  - 95th percentile < 1000ms
  - Error rate < 10%

### 4. **Stress Test** (`stress`)
- **Purpose**: Find system breaking point
- **Stages**: Progressive increase from 50 → 100 → 200 → 300 VUs
- **Duration**: ~12 minutes
- **Thresholds**:
  - 95th percentile < 2000ms
  - Error rate < 20% at peak

### 5. **Soak Test** (`soak`)
- **Purpose**: Detect memory leaks and degradation over time
- **Load**: 50 VUs sustained for 30 minutes
- **Use case**: Long-running stability test

## 🏃 Running Tests

### Run All Tests

Run all stress tests with default configuration (load test):

```powershell
.\run-all-stress.ps1
```

With specific test type:

```powershell
.\run-all-stress.ps1 -TestType spike
```

Quick smoke test (runs all tests in smoke mode):

```powershell
.\run-all-stress.ps1 -Quick
```

Skip authentication test:

```powershell
.\run-all-stress.ps1 -SkipAuth
```

Run only specific tests (pattern matching):

```powershell
# Run only Challenge tests
.\run-all-stress.ps1 -Only Challenge

# Run only Team and Hint tests
.\run-all-stress.ps1 -Only "Team|Hint"
```

### Run Individual Test

```powershell
.\run-single-stress.ps1 -TestFile "challenge-stress.js" -TestType load
```

With custom parameters:

```powershell
.\run-single-stress.ps1 `
  -TestFile "auth-stress.js" `
  -TestType spike `
  -BaseUrl "https://api.example.com" `
  -Username "testuser" `
  -Password "testpass"
```

### Run with k6 Directly

For advanced usage:

```powershell
k6 run --env-file .env -e TEST_TYPE=load challenge-stress.js
```

With custom options:

```powershell
k6 run `
  -e BASE_URL=http://localhost:5000 `
  -e USERNAME=user1 `
  -e PASSWORD=pass1 `
  -e TEST_TYPE=stress `
  challenge-stress.js
```

## 📊 Test Coverage

### Test Files

| Test File | APIs Covered | Description |
|-----------|--------------|-------------|
| `auth-stress.js` | `/api/Auth/*` | Login authentication |
| `challenge-stress.js` | `/api/Challenge/*` | Challenge listing, retrieval, status checks |
| `team-stress.js` | `/api/Team/*` | Team score and solves |
| `hint-stress.js` | `/api/Hint/*` | Hint retrieval and preview |
| `scoreboard-stress.js` | `/api/Scoreboard/*` | Top teams and rankings |
| `notifications-stress.js` | `/api/Notifications/*` | Notification listing |
| `config-stress.js` | `/api/Config/*` | Date and time configuration |
| `users-stress.js` | `/api/Users/*` | User profile |
| `actionlogs-stress.js` | `/api/ActionLogs/*` | Action log retrieval |
| `tickets-stress.js` | `/api/Ticket/*` | Ticket listing and retrieval |

### API Endpoints Tested

#### ✅ Read-Only Operations (Safe for Stress Testing)
- `GET /api/Challenge/by-topic`
- `GET /api/Challenge/list_challenge/{category}`
- `GET /api/Challenge/{id}`
- `GET /api/Challenge/instances`
- `POST /api/Challenge/check-status`
- `GET /api/Team/contestant`
- `GET /api/Team/solves`
- `GET /api/Hint/{id}`
- `GET /api/Hint/{id}/all`
- `GET /api/Scoreboard/top/{count}`
- `GET /api/Notifications`
- `GET /api/Config/get_date_config`
- `GET /api/Users/profile`
- `GET /api/ActionLogs/get-logs`
- `GET /api/ActionLogs/get-logs-team`
- `GET /api/Ticket/tickets-user`
- `GET /api/Ticket/tickets/{ticketId}`

#### ⚠️ Write Operations (Not Included in Stress Tests)
These operations modify data and should be tested in integration tests instead:
- `POST /api/Challenge/start`
- `POST /api/Challenge/stop-by-user`
- `POST /api/Challenge/attempt`
- `POST /api/Hint/unlock`
- `POST /api/Auth/change-password`
- `POST /api/Ticket/sendticket`
- `DELETE /api/Ticket/tickets/{ticketId}`
- `POST /api/ActionLogs/save-logs`

## 📈 Understanding Results

### k6 Output Metrics

Key metrics to monitor:

```
checks.........................: 95.00%  ✓ 950   ✗ 50
data_received..................: 1.2 MB  20 kB/s
data_sent......................: 180 kB  3.0 kB/s
http_req_blocked...............: avg=1.2ms   min=0s   med=1ms   max=10ms  p(95)=3ms
http_req_connecting............: avg=0.8ms   min=0s   med=0.5ms max=8ms   p(95)=2ms
http_req_duration..............: avg=120ms   min=50ms med=100ms max=800ms p(95)=350ms
  { expected_response:true }...: avg=118ms   min=50ms med=98ms  max=800ms p(95)=340ms
http_req_failed................: 5.00%   ✓ 50    ✗ 950
http_req_receiving.............: avg=0.5ms   min=0.1ms med=0.4ms max=2ms   p(95)=1ms
http_req_sending...............: avg=0.3ms   min=0.1ms med=0.2ms max=1ms   p(95)=0.6ms
http_req_tls_handshaking.......: avg=0ms     min=0s   med=0ms   max=0ms   p(95)=0ms
http_req_waiting...............: avg=119ms   min=48ms med=99ms  max=798ms p(95)=348ms
http_reqs......................: 1000    16.66/s
iteration_duration.............: avg=1.2s    min=1s   med=1.1s  max=1.9s  p(95)=1.4s
iterations.....................: 1000    16.66/s
vus............................: 20      min=0   max=100
vus_max........................: 100     min=100 max=100
```

### Important Metrics Explained

- **http_req_duration**: Response time - Lower is better
  - `p(95)`: 95% of requests completed within this time
  - `p(99)`: 99% of requests completed within this time
- **http_req_failed**: Error rate - Should be low
- **checks**: Success rate of assertions - Should be high (>95%)
- **http_reqs**: Total requests and throughput (requests/second)

### Success Criteria

#### Load Test
- ✅ 95th percentile < 500ms
- ✅ 99th percentile < 1000ms
- ✅ Error rate < 5%
- ✅ Check success rate > 95%

#### Spike Test
- ✅ System recovers after spike
- ✅ Error rate < 10% during spike
- ✅ No permanent degradation

#### Stress Test
- ✅ Identify maximum sustainable load
- ✅ Graceful degradation under extreme load
- ✅ No crashes or data corruption

## 🎯 Best Practices

### 1. **Start Small**
Always run a smoke test first to verify configuration:
```powershell
.\run-all-stress.ps1 -Quick
```

### 2. **Test Progression**
Follow this order:
1. Smoke test (1 VU)
2. Load test (expected load)
3. Stress test (find limits)
4. Spike test (test resilience)
5. Soak test (long-term stability)

### 3. **Monitor Resources**
While running tests, monitor:
- Server CPU and memory usage
- Database connections and query performance
- Redis memory and hit rate
- Network bandwidth
- Application logs for errors

### 4. **Isolate Test Environment**
- Use a dedicated test environment
- Don't run stress tests on production
- Ensure database is properly sized
- Clear Redis cache between major test runs

### 5. **Analyze Failures**
If tests fail:
1. Check application logs
2. Review database slow query logs
3. Monitor Redis performance
4. Check for resource exhaustion (CPU, memory, connections)
5. Verify network latency

### 6. **Iterate and Optimize**
After identifying bottlenecks:
1. Optimize database queries
2. Add caching layers
3. Increase resource limits
4. Re-run tests to verify improvements

## 🔧 Troubleshooting

### k6 Not Found
```powershell
# Install k6
winget install k6
# Or
choco install k6
```

### Authentication Failed
- Verify credentials in `.env` file
- Check if API is accessible at `BASE_URL`
- Ensure user account is not locked/banned

### High Error Rates
- Reduce target VUs
- Check server logs for errors
- Verify database connections
- Monitor Redis performance

### Timeouts
- Increase timeout thresholds in test files
- Check network latency
- Verify server has sufficient resources

## 📝 Examples

### Quick Health Check
```powershell
.\run-single-stress.ps1 -TestFile "auth-stress.js" -TestType smoke
```

### Load Test All APIs
```powershell
.\run-all-stress.ps1 -TestType load
```

### Find Breaking Point
```powershell
.\run-all-stress.ps1 -TestType stress
```

### Test Spike Resilience
```powershell
.\run-single-stress.ps1 -TestFile "challenge-stress.js" -TestType spike
```

### Long-Running Stability Test
```powershell
.\run-single-stress.ps1 -TestFile "challenge-stress.js" -TestType soak
```

## 📚 Additional Resources

- [k6 Documentation](https://k6.io/docs/)
- [k6 Test Types Guide](https://k6.io/docs/test-types/introduction/)
- [k6 Thresholds](https://k6.io/docs/using-k6/thresholds/)
- [k6 Metrics](https://k6.io/docs/using-k6/metrics/)

## 🤝 Contributing

When adding new API endpoints:

1. Add test cases to appropriate stress test file
2. Use read-only operations only
3. Follow existing patterns for consistency
4. Update this README with new coverage

## 📄 License

Part of the FCTF project.
