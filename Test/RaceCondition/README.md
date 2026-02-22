# k6 concurrency tests

This folder contains k6 scripts to stress concurrency-sensitive endpoints.
All scripts require a valid contestant account and a running backend.

## Table of Contents
- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Batch Runner](#batch-runner-passfail)
- [Token Generation](#generate-tokens-for-multi-team-tests)
- [Environment Variables](#common-environment-variables)
- [Test Scripts](#test-scripts)
- [Test Execution Order](#test-execution-order)
- [Troubleshooting](#troubleshooting)

## Prerequisites
- k6 installed
- Backend reachable (BASE_URL)
- A contestant user (USERNAME/PASSWORD) or a pre-generated TOKEN

## Quick Start

```powershell
# 1. Generate tokens for test users
cd Test/Integration
.\generate-tokens.ps1 -Start 2000 -End 2009 -Password 1

# 2. Edit .env with your configuration
# Update CHALLENGE_ID, CHALLENGE_FLAG, HINT_ID, START_CHALLENGE_ID, etc.

# 3. Validate test environment (recommended)
.\validate-test-data.ps1

# 4. Run all tests
cd ..
.\Test\Integration\run-k6-batch.ps1 -Strict -StopOnFail:$false
```

For tests to PASS, you need:
- Fresh challenge (type=dynamic, max_attempts≥100, time_limit≥5s)
- Locked hint
- Users that haven't attempted the challenge yet
- A deployable challenge for start/stop tests (RequireDeploy=true, not started yet)
- Team captain token for start/stop tests
- Ticket APIs accessible (CTF started, user has a team)

Run validation script to check your environment!

## Env file and runner
- Edit [Test/Integration/.env](Test/Integration/.env) with your values.
- Run a script via PowerShell (from repo root):
  .\Test\Integration\run-k6.ps1 -Script concurrent_correct_submissions.js
- Or change directory and run locally:
  cd Test/Integration
  .\run-k6.ps1 -Script concurrent_correct_submissions.js

## Batch runner (pass/fail)
- Validate test data first (recommended):
  .\Test\Integration\validate-test-data.ps1
- Run all scripts in order with strict checks:
  .\Test\Integration\run-k6-batch.ps1 -Strict
- Stop-on-fail is enabled by default. To keep running all tests:
  .\Test\Integration\run-k6-batch.ps1 -Strict -StopOnFail:$false

### Test data requirements for PASS results:
- Challenge with ≥10 remaining attempts (max_attempts - current_attempts ≥ 10)
- Challenge with time_limit ≥ 5s (for cooldown test)
- Challenge type = 'dynamic' (for dynamic_recalc test)
- Hint in 'locked' state (for hint_unlock test)
- Users in tokens.txt have NOT solved the challenge yet
- Users have NOT exhausted their attempts on the challenge
- Deployable challenge for start/stop tests (RequireDeploy=true, not started)
- Max-attempts challenge with low max_attempts and cooldown=0
- Set incorrect_submissions_per_min high enough to avoid rate limiting during max attempts test
- Ticket create/delete allowed (CTF started, ticket status open)

### Per-script token allocation (batch runner behavior)
- If `tokens.txt` (or `TOKEN_FILE` / `TOKEN_LIST`) is available in this folder, the batch runner auto-allocates tokens per script:
  - Scripts that need a single user (`concurrent_start_challenge.js`, `concurrent_stop_challenge.js`, `concurrent_max_attempts.js`, `concurrent_ticket_create.js`, `concurrent_ticket_delete.js`, `concurrent_hint_unlock.js`, `concurrent_cooldown_attempts.js`, `concurrent_correct_submissions.js`) will each be assigned one token sequentially from the tokens list (1 token per script). The stop test reuses the same token as the start test.
  - The dynamic test (`concurrent_dynamic_recalc.js`) will be assigned a slice of tokens equal to `CONCURRENCY` (written to a temporary `token_slice_*.txt` and exposed via `TOKEN_FILE`).
- When running an individual script (not the batch runner), ensure `TOKEN_FILE` is set in the script's env (we recommend `TOKEN_FILE=tokens.txt` in `Test/Integration/.env`) or set `TOKEN_LIST`/`TOKEN` explicitly. Runner scripts expect paths relative to the `Test/Integration` folder.
- This avoids test conflicts: single-user tests use dedicated tokens, multi-team dynamic test uses multiple tokens.
- You can still override behavior by setting `TOKEN`, `TOKEN_LIST`, or `TOKEN_FILE` manually before running the batch.


## Generate tokens for multi-team tests
If you have accounts user1..user1000 with password 1:
  .\Test\Integration\generate-tokens.ps1 -Start 1 -End 100 -Password 1

This writes:
- tokens.txt (one token per line)
- tokens.csv (single line, comma-separated)

To use in PowerShell:
  $env:TOKEN_LIST = Get-Content Test/Integration/tokens.csv -Raw

Batch runner auto-load:
- If `tokens.txt` exists in this folder and `TOKEN_LIST` is not set, the batch runner will auto-load it.

## Common environment variables
- BASE_URL (default: http://localhost:5000)
- USERNAME / PASSWORD (used if TOKEN is not provided)
- TOKEN (optional, overrides USERNAME/PASSWORD)
- TOKEN_LIST (optional, comma-separated tokens for multi-team runs)
- TOKEN_FILE (optional, path to tokens file - supports CSV or newline-separated tokens)
- CONCURRENCY (default: 10)
- STRICT (default: false) -> when true, scripts perform stricter count checks
- USE_TOKEN_LIST (default: false) -> when true, use TOKEN_LIST/TOKEN_FILE for multi-user same-team runs (per script)

### Env explanations
- BASE_URL: Base URL of the Contestant BE (no trailing slash).
- USERNAME / PASSWORD: Used by scripts when TOKEN is not set.
- TOKEN: Single bearer token for one user/team.
- TOKEN_LIST: Comma-separated tokens for multi-team tests (one per VU).
- CONCURRENCY: Number of concurrent virtual users.
- STRICT: Enable strict pass/fail checks in script summaries.
- CHALLENGE_ID: Target challenge id for attempt tests.
- CHALLENGE_FLAG: Correct flag for the challenge.
- WRONG_FLAG: Incorrect flag for cooldown test.
- START_CHALLENGE_ID: Challenge id for start/stop race tests (optional fallback to CHALLENGE_ID).
- STOP_CHALLENGE_ID: Challenge id for stop test (optional fallback to START_CHALLENGE_ID or CHALLENGE_ID).
- START_BEFORE_STOP: Whether stop test should call start once in setup (default: true).
- START_WAIT_SECONDS: Seconds to wait after setup start before sending stop (default: 2).
- MAX_ATTEMPTS_CHALLENGE_ID: Challenge id for max-attempts race test (optional fallback to CHALLENGE_ID).
- MAX_ATTEMPTS: Expected max attempts (used for STRICT validation in max-attempts test).
- TICKET_TITLE: Ticket title for create/delete tests.
- TICKET_TYPE: Ticket type for create/delete tests.
- TICKET_DESCRIPTION: Ticket description for create/delete tests.
- HINT_ID: Target hint id for unlock test.
- HINT_TYPE: Hint type (default: hints).
- CHALLENGE_CATEGORY: Category name used to read challenge value.
- DYN_FUNCTION: dynamic function (linear|logarithmic).
- DYN_INITIAL: dynamic initial value.
- DYN_DECAY: dynamic decay value.
- DYN_MINIMUM: dynamic minimum value.
- DYN_EXPECTED_SOLVE_COUNT: expected total solve count after test.
- DYN_BASE_SOLVE_COUNT: base solve count before test (auto = base + correct solves).
- DYN_POLL_ATTEMPTS: number of polls for dynamic value fetch.
- DYN_POLL_DELAY_MS: delay between polls in milliseconds.

## Script: concurrent_start_challenge.js
Purpose: N concurrent start requests -> only one deployment should initiate.

Required env:
- START_CHALLENGE_ID (or CHALLENGE_ID)

Optional env:
- USE_TOKEN_LIST=true (use TOKEN_LIST/TOKEN_FILE for multi-user same-team tests)

Recommended:
- Use a challenge with RequireDeploy=true and not started yet
- Use a captain token if captain_only_start_challenge is enabled
- For "many users in same team" tests, provide TOKEN_LIST or TOKEN_FILE with tokens from users in the same team.

STRICT behavior (current):
- When `STRICT=true` the script expects at least one successful start and no unexpected/limit/forbidden responses.

Run:
  k6 run Test/Integration/concurrent_start_challenge.js  # or: cd Test/Integration && k6 run concurrent_start_challenge.js

## Script: concurrent_stop_challenge.js
Purpose: N concurrent stop requests -> only one stop should succeed.

Required env:
- STOP_CHALLENGE_ID (or START_CHALLENGE_ID / CHALLENGE_ID)

Optional env:
- START_BEFORE_STOP (default: true)
- START_WAIT_SECONDS (default: 2)
- USE_TOKEN_LIST=true (use TOKEN_LIST/TOKEN_FILE for multi-user same-team tests)

Recommended:
- Use a challenge that is already running, or allow setup to start it
- For "many users in same team" tests, provide TOKEN_LIST or TOKEN_FILE with tokens from users in the same team.

STRICT behavior (current):
- When `STRICT=true` and `START_BEFORE_STOP=true`, the script expects at least one successful stop and no unexpected responses.

Run:
  k6 run Test/Integration/concurrent_stop_challenge.js  # or: cd Test/Integration && k6 run concurrent_stop_challenge.js

## Script: concurrent_max_attempts.js
Purpose: N concurrent incorrect submissions -> respect max attempts limit.

Required env:
- MAX_ATTEMPTS_CHALLENGE_ID (or CHALLENGE_ID)
- WRONG_FLAG

Optional env:
- MAX_ATTEMPTS (used for STRICT validation)
- USE_TOKEN_LIST=true (use TOKEN_LIST/TOKEN_FILE for multi-user same-team tests)

Recommended:
- Challenge max_attempts should be low (e.g., 3)
- Cooldown = 0 and incorrect_submissions_per_min high enough to avoid 429s
- For "many users in same team" tests, provide TOKEN_LIST or TOKEN_FILE with tokens from users in the same team.

STRICT behavior (current):
- When `STRICT=true` and `MAX_ATTEMPTS` is set, the script expects exactly MAX_ATTEMPTS incorrect responses and the rest max-attempts exceeded.

Run:
  k6 run Test/Integration/concurrent_max_attempts.js  # or: cd Test/Integration && k6 run concurrent_max_attempts.js

## Script: concurrent_ticket_create.js
Purpose: N concurrent ticket submissions -> only one should be created (duplicate detection).

Required env:
- TICKET_TITLE
- TICKET_TYPE
- TICKET_DESCRIPTION

STRICT behavior (current):
- When `STRICT=true` the script expects exactly one created ticket and the rest rejected as similar.

Run:
  k6 run Test/Integration/concurrent_ticket_create.js  # or: cd Test/Integration && k6 run concurrent_ticket_create.js

## Script: concurrent_ticket_delete.js
Purpose: N concurrent deletes -> only one delete succeeds.

Optional env:
- TICKET_TITLE
- TICKET_TYPE
- TICKET_DESCRIPTION

STRICT behavior (current):
- When `STRICT=true` the script expects exactly one delete success and no unexpected responses.

Run:
  k6 run Test/Integration/concurrent_ticket_delete.js  # or: cd Test/Integration && k6 run concurrent_ticket_delete.js

## Script: concurrent_hint_unlock.js
Purpose: N concurrent hint unlock -> only one unlock + award.

Required env:
- HINT_ID

Optional env:
- HINT_TYPE (default: hints)

STRICT behavior (current):
- When `STRICT=true` the script expects exactly one successful unlock; other VUs may receive `already_unlocked` or `another unlock operation is in progress`, and both are treated as acceptable failure responses for the strict check.

Run:
  k6 run Test/Integration/concurrent_hint_unlock.js  # or: cd Test/Integration && k6 run concurrent_hint_unlock.js

## Script: concurrent_cooldown_attempts.js
Purpose: N concurrent attempts during cooldown -> only one passes, others rate limited.

Required env:
- CHALLENGE_ID
- WRONG_FLAG

Recommended:
- Challenge cooldown > 0
- Keep CONCURRENCY <= 5 if incorrect submissions per minute limit is low

Run:
  k6 run Test/Integration/concurrent_cooldown_attempts.js  # or: cd Test/Integration && k6 run concurrent_cooldown_attempts.js

## Script: concurrent_correct_submissions.js
Purpose: N concurrent correct submissions -> only one solve should be recorded.

Required env:
- CHALLENGE_ID
- CHALLENGE_FLAG

Recommended:
- Use a challenge with cooldown = 0 and no max attempts.
- Run this BEFORE concurrent_dynamic_recalc.js if using same challenge.

STRICT behavior (current):
- When `STRICT=true` the script expects one correct submission and treats other failures as acceptable (for example `already_solved`, `ratelimited` and certain `unexpected_responses` are counted as valid failure outcomes). This allows the strict check to pass when multiple teams submit concurrently and the server rate-limits or otherwise rejects concurrent solves.

Run:
  k6 run Test/Integration/concurrent_correct_submissions.js  # or: cd Test/Integration && k6 run concurrent_correct_submissions.js

## Script: concurrent_dynamic_recalc.js
Purpose: N concurrent solves -> dynamic value recalculated correctly.

Required env:
- CHALLENGE_ID
- CHALLENGE_FLAG
- CHALLENGE_CATEGORY

Optional env for strict value check (important notes):
- `DYN_FUNCTION` (linear|logarithmic)
- `DYN_INITIAL`
- `DYN_DECAY`
- `DYN_MINIMUM`
- `DYN_EXPECTED_SOLVE_COUNT` (total solve count after this run). NOTE: **setting this to `0` is treated as a valid value and will yield an "expected" equal to `DYN_INITIAL`**. To use automatic calculation, leave `DYN_EXPECTED_SOLVE_COUNT` unset and set `DYN_BASE_SOLVE_COUNT` to the number of solves already present before this run (or let the script compute base + correct automatically).
- `DYN_BASE_SOLVE_COUNT` (auto: base + correct solves)

Strict behavior (current):
- When `STRICT=true` the script expects `correct === CONCURRENCY` (one correct solve per team/VU) and additionally validates the challenge's dynamic value against the computed expected value. The script writes `dyn_expected_value` and `dyn_actual_value` gauges during teardown and compares them in the summary.

Recommended for multi-team solve:
- Provide TOKEN_LIST with one token per team. The script will enforce TOKEN_LIST >= CONCURRENCY.

Run:
  k6 run Test/Integration/concurrent_dynamic_recalc.js  # or: cd Test/Integration && k6 run concurrent_dynamic_recalc.js

## Example
PowerShell:
  # Option A: use env file
  .\Test\Integration\run-k6.ps1 -Script concurrent_correct_submissions.js

  # Option B: set env vars inline
  $env:BASE_URL="http://localhost:5000"
  $env:USERNAME="team01"
  $env:PASSWORD="secret"
  $env:CHALLENGE_ID="12"
  $env:CHALLENGE_FLAG="flag{test}"
  $env:CONCURRENCY="10"
  k6 run Test/Integration/concurrent_correct_submissions.js  # or: cd Test/Integration && k6 run concurrent_correct_submissions.js

## Test execution order
Recommended order for fresh challenge (avoids state conflicts):
1. concurrent_start_challenge.js (deployable challenge, start race)
2. concurrent_stop_challenge.js (same deployable challenge, stop race)
3. concurrent_max_attempts.js (incorrect attempts against max_attempts)
4. concurrent_ticket_create.js (duplicate ticket detection)
5. concurrent_ticket_delete.js (delete race)
6. concurrent_hint_unlock.js (independent, tests hint only)
7. concurrent_cooldown_attempts.js (uses WRONG_FLAG, doesn't solve)
8. concurrent_correct_submissions.js (solves challenge, 1 correct + 9 already_solved)
9. concurrent_dynamic_recalc.js (uses multiple teams, each solves once)

**Important**: Tests require fresh data to pass:
- Challenge should have available attempts (max_attempts > current attempts)
- Hint should not be unlocked yet (for hint_unlock test)
- Users in tokens.txt should not have solved the challenge yet
- Deployable challenge should not be running before start/stop tests
- Max-attempts challenge should have remaining attempts and cooldown=0
- Ticket tests run during CTF time and use open tickets

To reset and run all tests:
```powershell
# Option 1: Generate new users
.\Test\Integration\generate-tokens.ps1 -Start 1001 -End 2000 -Password 1

# Option 2: Reset challenge attempts via admin panel or database
# Then run batch tests
.\Test\Integration\run-k6-batch.ps1 -Strict -StopOnFail:$false
```

See [TROUBLESHOOTING.md](TROUBLESHOOTING.md) for detailed debugging guide.

## Common run commands
PowerShell (env file):
  .\Test\Integration\run-k6.ps1 -Script concurrent_start_challenge.js
  .\Test\Integration\run-k6.ps1 -Script concurrent_stop_challenge.js
  .\Test\Integration\run-k6.ps1 -Script concurrent_max_attempts.js
  .\Test\Integration\run-k6.ps1 -Script concurrent_ticket_create.js
  .\Test\Integration\run-k6.ps1 -Script concurrent_ticket_delete.js
  .\Test\Integration\run-k6.ps1 -Script concurrent_hint_unlock.js
  .\Test\Integration\run-k6.ps1 -Script concurrent_cooldown_attempts.js
  .\Test\Integration\run-k6.ps1 -Script concurrent_correct_submissions.js
  .\Test\Integration\run-k6.ps1 -Script concurrent_dynamic_recalc.js

PowerShell (batch, strict):
  .\Test\Integration\run-k6-batch.ps1 -Strict

PowerShell (batch, run all even on failure):
  .\Test\Integration\run-k6-batch.ps1 -Strict -StopOnFail:$false

## Troubleshooting

### Tests Failing?

1. **Run validation script first**:
   ```powershell
   .\Test\Integration\validate-test-data.ps1
   ```
   This checks:
   - Token validity
   - Challenge configuration (attempts, cooldown, type)
   - Hint status (locked/unlocked)
   - Provides actionable recommendations

2. **Common issues**:
   - `ratelimited=10`: Challenge has insufficient remaining attempts
   - `passed=10` (cooldown test): Challenge has no cooldown or users are different teams
   - `already_unlocked`: Hint already unlocked, need fresh locked hint
   - `correct=0`: Users already attempted/solved challenge
   - `Dynamic value mismatch (expected=... actual=...)`: often caused by `DYN_EXPECTED_SOLVE_COUNT` being set to `0` (script treats `0` as a valid expected solve count which yields `expected = DYN_INITIAL`). To avoid this, unset `DYN_EXPECTED_SOLVE_COUNT` and set `DYN_BASE_SOLVE_COUNT` (the number of solves before the test) or provide an explicit `DYN_EXPECTED_SOLVE_COUNT` that reflects the expected total solves after the run.

3. **Solutions**:
   - Create fresh challenge with max_attempts ≥100, time_limit ≥5s, type='dynamic'
   - Generate new tokens from unused users: `.\Test\Integration\generate-tokens.ps1 -Start 301 -End 400 -Password 1`
   - Reset challenge data (if you have admin access)

### Documentation

- [COMPLETE_FIX_SUMMARY.md](COMPLETE_FIX_SUMMARY.md) - All fixes and validations
- [TROUBLESHOOTING.md](TROUBLESHOOTING.md) - Detailed debugging guide
- [SETUP.md](SETUP.md) - Setup instructions for fresh tests
- [FIX_SUMMARY.md](FIX_SUMMARY.md) - Technical bug fix details
