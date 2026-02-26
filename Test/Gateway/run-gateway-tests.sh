#!/usr/bin/env bash
set -u

TYPE="quick"
ENV_FILE=".env"
OUT_ROOT="test-results"
INCLUDE_BODY_LIMITS=0
SKIP_LONG_RUNNING=0

usage() {
  cat <<'EOF'
Usage: ./run-gateway-tests.sh [--type quick|integration|security|resilience|load|spike|soak|race|race-sweep|all] [--env-file .env] [--include-body-limits] [--skip-long-running]

Runs the ChallengeGateway test suite (k6 + curl) on Linux/macOS.

Notes:
  - k6 v1.x does not support --env-file; this runner sources the env file.
  - TCP tests are not included here (PowerShell scripts).
  - Race test can use RACE_TOKENS_CSV (or RACE_TOKENS_FILE) to simulate multiple teams.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --type)
      TYPE="$2"; shift 2;;
    --env-file)
      ENV_FILE="$2"; shift 2;;
    --include-body-limits)
      INCLUDE_BODY_LIMITS=1; shift 1;;
    --skip-long-running)
      SKIP_LONG_RUNNING=1; shift 1;;
    -h|--help)
      usage; exit 0;;
    *)
      echo "Unknown arg: $1" >&2
      usage
      exit 2;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if ! command -v k6 >/dev/null 2>&1; then
  echo "k6 is not installed or not in PATH" >&2
  exit 1
fi
if ! command -v curl >/dev/null 2>&1; then
  echo "curl is not installed or not in PATH" >&2
  exit 1
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Env file not found: $ENV_FILE" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

load_race_tokens_from_file() {
  # Allows keeping many tokens out of .env.
  # File format: one token per line; blank lines and lines starting with # are ignored.
  if [[ -n "${RACE_TOKENS_CSV:-}" ]]; then
    return 0
  fi
  if [[ -z "${RACE_TOKENS_FILE:-}" ]]; then
    return 0
  fi
  if [[ ! -f "$RACE_TOKENS_FILE" ]]; then
    echo "RACE_TOKENS_FILE not found: $RACE_TOKENS_FILE" >&2
    return 2
  fi

  RACE_TOKENS_CSV="$(
    awk '
      BEGIN{ first=1 }
      /^[[:space:]]*#/ { next }
      /^[[:space:]]*$/ { next }
      {
        gsub(/^[[:space:]]+|[[:space:]]+$/, "", $0)
        if ($0=="") next
        if (!first) printf ","
        printf "%s", $0
        first=0
      }
    ' "$RACE_TOKENS_FILE"
  )"
  export RACE_TOKENS_CSV
  return 0
}

race_tokens_count() {
  python3 - <<'PY'
import os
import re

raw = os.environ.get('RACE_TOKENS_CSV', '')
tokens = [t.strip().strip('"\'') for t in re.split(r'[\n,]+', raw) if t.strip()]
print(len(tokens))
PY
}

load_race_tokens_from_file || true

generate_token_py() {
  local route="$1"; shift
  python3 "$SCRIPT_DIR/generate-gateway-token.py" --private-key "${PRIVATE_KEY}" --route "$route" "$@"
}

auto_generate_tokens() {
  # Bring parity with run-gateway-tests.ps1: if PRIVATE_KEY is available, mint tokens locally.
  if [[ -n "${PRIVATE_KEY:-}" ]] && [[ -n "${CHALLENGE_ROUTE:-}" ]]; then
    if [[ -z "${VALID_TOKEN:-}" ]]; then
      VALID_TOKEN="$(generate_token_py "${CHALLENGE_ROUTE}" --expires-in-seconds 3600)"
      export VALID_TOKEN
    fi
    if [[ -z "${EXPIRED_TOKEN:-}" ]]; then
      EXPIRED_TOKEN="$(generate_token_py "${CHALLENGE_ROUTE}" --expires-in-seconds 3600 --expired)"
      export EXPIRED_TOKEN
    fi
  fi

  if [[ -n "${PRIVATE_KEY:-}" ]] && [[ -n "${BROKEN_ROUTE:-}" ]]; then
    if [[ -z "${BROKEN_TOKEN:-}" ]]; then
      BROKEN_TOKEN="$(generate_token_py "${BROKEN_ROUTE}" --expires-in-seconds 3600)"
      export BROKEN_TOKEN
    fi
  fi

  # Optional: generate multiple distinct tokens (same route) for multi-team simulation.
  # This helps exercise per-token limiter keys without needing real team-issued tokens.
  if [[ -z "${RACE_TOKENS_CSV:-}" ]] && [[ -n "${RACE_TOKENS_COUNT:-}" ]] && [[ -n "${PRIVATE_KEY:-}" ]] && [[ -n "${CHALLENGE_ROUTE:-}" ]]; then
    if [[ "$RACE_TOKENS_COUNT" =~ ^[0-9]+$ ]] && (( RACE_TOKENS_COUNT > 0 )); then
      RACE_TOKENS_CSV="$(generate_token_py "${CHALLENGE_ROUTE}" --expires-in-seconds 3600 --count "$RACE_TOKENS_COUNT" --format csv)"
      export RACE_TOKENS_CSV
    fi
  fi
}

auto_generate_tokens || true

TS="$(date -u +%Y%m%dT%H%M%SZ)"
OUT_DIR="$OUT_ROOT/$TS"
mkdir -p "$OUT_DIR"

redact_value() {
  local v="$1"
  if [[ -z "$v" ]]; then
    echo ""
    return 0
  fi
  local len=${#v}
  if (( len <= 10 )); then
    echo "***"
    return 0
  fi
  echo "${v:0:6}***${v: -4}"
}

write_env_snapshot() {
  {
    echo "UTC timestamp: $TS"
    echo "TYPE=$TYPE"
    echo "k6_version=$(k6 version | tr -d '\r')"
    echo "GATEWAY_BASE_URL=${GATEWAY_BASE_URL:-}"
    echo "PROTECTED_PATH=${PROTECTED_PATH:-}"
    echo "AUTH_COOKIE_NAME=${AUTH_COOKIE_NAME:-}"
    echo "ASSERT_ECHO=${ASSERT_ECHO:-}"
    echo "STRICT_ECHO=${STRICT_ECHO:-}"
    echo "TCP_GATEWAY_HOST=${TCP_GATEWAY_HOST:-}"
    echo "TCP_GATEWAY_PORT=${TCP_GATEWAY_PORT:-}"
    echo "VALID_TOKEN_present=$([[ -n "${VALID_TOKEN:-}" ]] && echo yes || echo no)"
    echo "VALID_TOKEN_redacted=$(redact_value "${VALID_TOKEN:-}")"
    echo "RACE_TOKENS_CSV_present=$([[ -n "${RACE_TOKENS_CSV:-}" ]] && echo yes || echo no)"
    echo "RACE_TOKENS_count=$(race_tokens_count 2>/dev/null || echo 0)"
    echo "RACE_TOKENS_COUNT=${RACE_TOKENS_COUNT:-}"
    echo "EXPIRED_TOKEN_present=$([[ -n "${EXPIRED_TOKEN:-}" ]] && echo yes || echo no)"
    echo "BROKEN_TOKEN_present=$([[ -n "${BROKEN_TOKEN:-}" ]] && echo yes || echo no)"
    echo "PRIVATE_KEY_present=$([[ -n "${PRIVATE_KEY:-}" ]] && echo yes || echo no)"
  } >"$OUT_DIR/env.txt"
}

run_cmd_to_file() {
  local outfile="$1"; shift
  # Capture stdout+stderr; preserve exit code even with tee.
  # NOTE: Do NOT toggle `set -e` here; caller controls errexit.
  ( "$@" ) 2>&1 | tee "$outfile"
  return ${PIPESTATUS[0]}
}

have_valid_token() {
  [[ -n "${VALID_TOKEN:-}" ]]
}

have_race_tokens() {
  [[ -n "${RACE_TOKENS_CSV:-}" ]]
}

have_token_for_race() {
  have_valid_token || have_race_tokens
}

have_broken_token() {
  [[ -n "${BROKEN_TOKEN:-}" ]]
}

smoke_curl() {
  local base="${GATEWAY_BASE_URL:-}"
  local path="${PROTECTED_PATH:-/anything/fctf-gateway}"
  if [[ -z "$base" ]]; then
    echo "GATEWAY_BASE_URL missing" >&2
    return 2
  fi

  SMOKE_HEALTH_CODE="$(curl -sS -o /dev/null -w '%{http_code}' "$base/healthz" || true)"
  SMOKE_MISSING_CODE="$(curl -sS -o /dev/null -w '%{http_code}' "$base$path" || true)"
  SMOKE_INVALID_CODE="$(curl -sS -o /dev/null -w '%{http_code}' "$base$path?token=invalid.token" || true)"

  {
    echo "== curl healthz =="
    echo "$SMOKE_HEALTH_CODE"
    echo "== curl missing token =="
    echo "$SMOKE_MISSING_CODE"
    echo "== curl invalid token =="
    echo "$SMOKE_INVALID_CODE"
  } | tee "$OUT_DIR/smoke_curl.txt" >/dev/null
}

select_scripts() {
  local t="$1"
  case "$t" in
    quick)
      echo "gateway_auth_flow.js gateway_integration_extended.js gateway_rate_limit.js gateway_security_negative.js";;
    integration)
      echo "gateway_auth_flow.js gateway_integration_extended.js gateway_rate_limit.js";;
    security)
      echo "gateway_security_negative.js";;
    resilience)
      echo "gateway_resilience.js";;
    load)
      echo "gateway_passthrough_load.js";;
    spike)
      echo "gateway_spike.js";;
    soak)
      echo "gateway_soak.js";;
    race)
      echo "gateway_race_under_load.js";;
    race-sweep)
      # Handled via a dedicated sweep runner (multiple k6 invocations)
      echo "";;
    all)
      # Keep soak/spike/load optional behind --skip-long-running
      if (( SKIP_LONG_RUNNING == 1 )); then
        echo "gateway_auth_flow.js gateway_integration_extended.js gateway_rate_limit.js gateway_security_negative.js gateway_resilience.js gateway_race_under_load.js";
      else
        echo "gateway_auth_flow.js gateway_integration_extended.js gateway_rate_limit.js gateway_security_negative.js gateway_resilience.js gateway_race_under_load.js gateway_passthrough_load.js gateway_spike.js gateway_soak.js";
      fi
      ;;
    *)
      echo "Unknown type: $t" >&2
      exit 2;;
  esac
}

python_parse_race_summary() {
  local json_path="$1"
  python3 - "$json_path" <<'PY'
import json
import os
import sys

path = sys.argv[1]
with open(path, 'r', encoding='utf-8') as f:
    data = json.load(f)

def metric_values(name):
    m = data.get('metrics', {}).get(name, {})
    return m.get('values', {})

http_p95 = metric_values('http_req_duration').get('p(95)')
http_p99 = metric_values('http_req_duration').get('p(99)')
failed = metric_values('http_req_failed').get('rate')

unexpected5xx = metric_values('gateway_race_unexpected_5xx').get('count')
burst429_p95 = metric_values('gateway_race_burst_429_ratio').get('p(95)')
accepted_avg = metric_values('gateway_race_burst_accepted_ratio').get('avg')

def fmt(x):
    if x is None:
        return 'n/a'
    if isinstance(x, (int, float)):
        # Keep short and stable
        if abs(x) >= 100:
            return f"{x:.0f}"
        if abs(x) >= 10:
            return f"{x:.2f}"
        return f"{x:.4f}"
    return str(x)

print(f"p95_ms={fmt(http_p95)} p99_ms={fmt(http_p99)} http_req_failed_rate={fmt(failed)} burst429_p95={fmt(burst429_p95)} accepted_avg={fmt(accepted_avg)} unexpected5xx={fmt(unexpected5xx)}")
PY
}

run_race_sweep() {
  local sweep_report="$SCRIPT_DIR/RaceSweepReport_${TS}.md"

  if ! have_token_for_race; then
    echo "Race sweep requires VALID_TOKEN or RACE_TOKENS_CSV (or RACE_TOKENS_FILE)." >&2
    return 2
  fi

  # Each step is: name|bg_rps|burst_vus|burst_requests
  # Keep it reasonably bounded by default to avoid accidental overload.
  local steps=(
    "S1_baseline|30|1|20"
    "S2_medium|60|2|30"
    "S3_high|100|3|50"
    "S4_very_high|150|5|75"
  )

  local first_fail_step=""
  local last_pass_step=""
  local last_pass_bg=""
  local last_pass_vus=""
  local last_pass_reqs=""

  {
    echo "# Challenge Gateway – Race Sweep (Ceiling) Report"
    echo
    echo "- Report ID: \`GW-RACE-SWEEP-${TS}\`"
    echo "- Date (UTC): \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\""
    echo "- Target HTTP Gateway: \`${GATEWAY_BASE_URL:-}\`"
    echo "- PROTECTED_PATH: \`${PROTECTED_PATH:-}\`"
    echo "- Token mode: $([[ -n \"${RACE_TOKENS_CSV:-}\" ]] && echo 'multi-team (RACE_TOKENS_CSV)' || echo 'single token (VALID_TOKEN)')"
    echo "- Token count: $(race_tokens_count 2>/dev/null || echo 0)"
    echo "- Evidence logs root: \`Test/Gateway/${OUT_DIR}\`"
    echo
    echo "## Method"
    echo
    echo "We run multiple short race-under-load executions, increasing background RPS and burst concurrency until thresholds fail or errors rise." 
    echo
    echo "## Sweep Results"
    echo
  } >"$sweep_report"

  run_single_sweep_step() {
    local step_name="$1"
    local step_bg="$2"
    local step_vus="$3"
    local step_reqs="$4"

    export RACE_BACKGROUND_RPS="$step_bg"
    export RACE_BURST_VUS="$step_vus"
    export RACE_BURST_REQUESTS="$step_reqs"

    local step_log="$OUT_DIR/gateway_race_under_load_${step_name}.txt"
    local step_summary="$OUT_DIR/gateway_race_under_load_${step_name}.summary.json"
    export K6_SUMMARY_PATH="$step_summary"

    echo "Running sweep step: ${step_name} (bg_rps=${step_bg}, burst_vus=${step_vus}, burst_reqs=${step_reqs})" >&2
    set +e
    run_cmd_to_file "$step_log" k6 run gateway_race_under_load.js
    local rc=$?
    set -e

    local status="PASS"
    if [[ "$rc" != "0" ]]; then
      status="FAIL"
    fi

    local parsed=""
    if [[ -f "$step_summary" ]]; then
      parsed="$(python_parse_race_summary "$step_summary" 2>/dev/null || true)"
    fi

    {
      echo "### ${step_name}"
      echo
      echo "- Settings: \`RACE_BACKGROUND_RPS=${step_bg}\`, \`RACE_BURST_VUS=${step_vus}\`, \`RACE_BURST_REQUESTS=${step_reqs}\`"
      echo "- Result: ${status} (rc=${rc})"
      echo "- Evidence: \`${OUT_DIR}/gateway_race_under_load_${step_name}.txt\`"
      [[ -n "$parsed" ]] && echo "- Metrics: ${parsed}"
      echo
    } >>"$sweep_report"

    if [[ "$status" == "PASS" ]]; then
      return 0
    fi
    return 1
  }

  local i=0
  local fail_bg=""
  local fail_vus=""
  local fail_reqs=""

  for step in "${steps[@]}"; do
    i=$((i+1))
    IFS='|' read -r step_name step_bg step_vus step_reqs <<<"$step"

    echo "Running sweep step ${i}/${#steps[@]}: ${step_name}" >&2

    if run_single_sweep_step "$step_name" "$step_bg" "$step_vus" "$step_reqs"; then
      last_pass_step="$step_name"
      last_pass_bg="$step_bg"
      last_pass_vus="$step_vus"
      last_pass_reqs="$step_reqs"
    else
      if [[ -z "$first_fail_step" ]]; then
        first_fail_step="$step_name"
        fail_bg="$step_bg"
        fail_vus="$step_vus"
        fail_reqs="$step_reqs"
      fi
      break
    fi
  done

  if [[ -n "$first_fail_step" && -n "$last_pass_step" ]]; then
    {
      echo "## Refinement (Isolate Cause)"
      echo
      echo "After the first FAIL step, we run two additional probes to isolate whether the instability is driven mainly by background RPS or by burst concurrency." 
      echo
    } >>"$sweep_report"

    # Background-only increase probe
    run_single_sweep_step "R_bg_only" "$fail_bg" "$last_pass_vus" "$last_pass_reqs" >/dev/null 2>&1 || true
    # Burst-only increase probe
    run_single_sweep_step "R_burst_only" "$last_pass_bg" "$fail_vus" "$fail_reqs" >/dev/null 2>&1 || true
  fi

  {
    echo "## Conclusion"
    echo
    if [[ -n "$first_fail_step" ]]; then
      echo "- Last PASS step: ${last_pass_step:-none}"
      echo "- First FAIL step (ceiling indicator): ${first_fail_step}"
      echo "- Interpretation: Gateway starts becoming unstable at or above the first FAIL step settings in this sweep."
    else
      echo "- All configured sweep steps PASSED."
      echo "- Interpretation: Within the tested envelope, gateway remained stable; increase steps to probe higher."
    fi
    echo
    echo "## Notes"
    echo
    echo "- This is a short sweep (not a soak). For production sizing, follow with soak tests at the chosen stable step." 
  } >>"$sweep_report"

  echo "$sweep_report" >"$OUT_DIR/report_path.txt"
  echo "DONE"
  echo "- Logs:   $OUT_DIR"
  echo "- Report: $(cat "$OUT_DIR/report_path.txt")"
}

parse_k6_metric_line() {
  local file="$1"
  local metric="$2"
  # Extract the first matching metric line, if present (k6 formats as "metric........: value")
  grep -E "\b${metric}\b" "$file" 2>/dev/null | head -n 1 | tr -d '\r' || true
}

parse_k6_metric_value_line() {
  local file="$1"
  local metric="$2"
  grep -E "^[[:space:]]*${metric}\.\.*:" "$file" 2>/dev/null | head -n 1 | tr -d '\r' || true
}

write_report() {
  local report_file="$SCRIPT_DIR/TestReport_${TS}.md"
  local base="${GATEWAY_BASE_URL:-}"
  local tcp_host="${TCP_GATEWAY_HOST:-}"
  local tcp_port="${TCP_GATEWAY_PORT:-}"
  local path="${PROTECTED_PATH:-/anything/fctf-gateway}"
  local token_present="no"
  [[ -n "${VALID_TOKEN:-}" ]] && token_present="yes"

  local rate_limit_line=""
  if [[ -f "$OUT_DIR/gateway_rate_limit.txt" ]]; then
    rate_limit_line="$(parse_k6_metric_value_line "$OUT_DIR/gateway_rate_limit.txt" "gateway_rate_limit_seen")"
  fi

  local smoke_health_status="FAIL"
  local smoke_missing_status="FAIL"
  local smoke_invalid_status="FAIL"
  [[ "${SMOKE_HEALTH_CODE:-}" == "200" ]] && smoke_health_status="PASS"
  [[ "${SMOKE_MISSING_CODE:-}" == "401" ]] && smoke_missing_status="PASS"
  [[ "${SMOKE_INVALID_CODE:-}" == "401" ]] && smoke_invalid_status="PASS"

  {
    echo "# Challenge Gateway – Test Report"
    echo
    echo "- Report ID: \`GW-REPORT-${TS}\`"
    echo "- Date (UTC): \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\""
    echo "- Target HTTP Gateway: \`${base}\`"
    echo "- Target TCP Gateway: \`${tcp_host}:${tcp_port}\`"
    echo "- Runner: \`run-gateway-tests.sh\`"
    echo "- Evidence logs: \`Test/Gateway/${OUT_DIR}\`"
    echo
    echo "## Environment / Configuration"
    echo
    echo "- \`GATEWAY_BASE_URL=${base}\`"
    echo "- \`PROTECTED_PATH=${path}\`"
    echo "- \`VALID_TOKEN_present=${token_present}\`"
    echo
    echo "## Execution Summary"
    echo
    echo "- Smoke (curl): $( [[ -f "$OUT_DIR/smoke_curl.txt" ]] && echo DONE || echo SKIPPED )"
    echo "- k6 scripts:"
    for s in "${K6_SCRIPTS[@]}"; do
      local log="$OUT_DIR/${s%.js}.txt"
      if [[ -f "$log" ]]; then
        local rc="${SCRIPT_RC[$s]:-}"
        if [[ "$rc" == "0" ]]; then
          echo "  - ${s}: PASS"
        else
          echo "  - ${s}: FAIL (rc=${rc})"
        fi
      else
        echo "  - ${s}: NOT RUN"
      fi
    done
    echo
    echo "## Test Cases"
    echo
    echo "### GW-INT-001 – [Integration] Health endpoint availability"
    echo
    echo "- Description: Verify gateway health endpoint returns 200."
    echo "- Steps: run smoke curl in ${OUT_DIR}/smoke_curl.txt"
    echo "- Expected: HTTP 200"
    echo "- Actual: HTTP ${SMOKE_HEALTH_CODE:-unknown}"
    echo "- Status: ${smoke_health_status}"
    echo
    echo "### GW-INT-002 – [Integration/Security] Missing token is rejected"
    echo
    echo "- Description: Access protected path without token should be rejected."
    echo "- Steps: run smoke curl in ${OUT_DIR}/smoke_curl.txt"
    echo "- Expected: HTTP 401"
    echo "- Actual: HTTP ${SMOKE_MISSING_CODE:-unknown}"
    echo "- Status: ${smoke_missing_status}"
    echo
    echo "### GW-INT-003 – [Integration/Security] Invalid token is rejected"
    echo
    echo "- Description: Invalid token should be rejected."
    echo "- Steps: run smoke curl in ${OUT_DIR}/smoke_curl.txt"
    echo "- Expected: HTTP 401"
    echo "- Actual: HTTP ${SMOKE_INVALID_CODE:-unknown}"
    echo "- Status: ${smoke_invalid_status}"
    echo
    echo "### GW-INT-005/006 – [Integration] Valid token bootstrap + proxy acceptance"
    echo
    echo "- Description: Valid token sets cookie, redirects cleanly, and proxied request is accepted."
    echo "- Steps: \`k6 run gateway_auth_flow.js\`"
    echo "- Expected: 302 + Set-Cookie + redirect strips token; proxied request accepted."
    echo "- Actual: see ${OUT_DIR}/gateway_auth_flow.txt"
    if [[ -f "$OUT_DIR/gateway_auth_flow.txt" ]]; then
      echo "- Status: $( [[ "${SCRIPT_RC[gateway_auth_flow.js]:-1}" == "0" ]] && echo PASS || echo FAIL )"
    else
      echo "- Status: NOT RUN"
    fi
    echo
    echo "### GW-INT-007/008/009 – [Integration] Aliases, path token, cookie stripping"
    echo
    echo "- Description: Token aliases and path token bootstrap should work; gateway cookie should not leak upstream (best-effort)."
    echo "- Steps: \`k6 run gateway_integration_extended.js\`"
    echo "- Expected: 302 + cookie + redirect strips token params; probe accepted."
    echo "- Actual: see ${OUT_DIR}/gateway_integration_extended.txt"
    if [[ -f "$OUT_DIR/gateway_integration_extended.txt" ]]; then
      echo "- Status: $( [[ "${SCRIPT_RC[gateway_integration_extended.js]:-1}" == "0" ]] && echo PASS || echo FAIL )"
    else
      echo "- Status: NOT RUN"
    fi
    echo
    echo "### GW-INT-012 – [Policy] Rate limit behavior"
    echo
    echo "- Description: Under high VU load, rate limiting should trigger 429 at a minimum ratio."
    echo "- Steps: \`k6 run gateway_rate_limit.js\`"
    echo "- Expected: gateway_rate_limit_seen > MIN_429_RATIO; no unexpected 5xx."
    echo "- Actual: see ${OUT_DIR}/gateway_rate_limit.txt"
    [[ -n "$rate_limit_line" ]] && echo "- Observed: ${rate_limit_line}"
    if [[ -f "$OUT_DIR/gateway_rate_limit.txt" ]]; then
      echo "- Status: $( [[ "${SCRIPT_RC[gateway_rate_limit.js]:-1}" == "0" ]] && echo PASS || echo FAIL )"
    else
      echo "- Status: NOT RUN"
    fi
    echo
    echo "### GW-SEC-014/015 – [Security-Negative] Token fuzzing"
    echo
    echo "- Description: Malformed tokens and aliases must not bypass auth."
    echo "- Steps: \`k6 run gateway_security_negative.js\`"
    echo "- Expected: 401 for all fuzz cases; bypass rate 0."
    echo "- Actual: see ${OUT_DIR}/gateway_security_negative.txt"
    if [[ -f "$OUT_DIR/gateway_security_negative.txt" ]]; then
      echo "- Status: $( [[ "${SCRIPT_RC[gateway_security_negative.js]:-1}" == "0" ]] && echo PASS || echo FAIL )"
    else
      echo "- Status: NOT RUN"
    fi
    echo
    echo "## Notes"
    echo
    echo "- TCP tests are not executed by this runner (PowerShell scripts)."
    echo "- Body-limit test is optional; include with --include-body-limits and use an upstream that supports POST to avoid 405 noise."

    if [[ "${RESILIENCE_BLOCKED:-0}" == "1" ]]; then
      echo "- Resilience test (gateway_resilience.js) was skipped because BROKEN_TOKEN is missing."
    fi

    if [[ -f "$OUT_DIR/gateway_race_under_load.txt" || -f "$OUT_DIR/gateway_passthrough_load.txt" || -f "$OUT_DIR/gateway_spike.txt" || -f "$OUT_DIR/gateway_soak.txt" ]]; then
      echo
      echo "## Long-Running Tests"
    fi

    if [[ -f "$OUT_DIR/gateway_race_under_load.txt" ]]; then
      echo
      echo "### GW-RACE-026 – [Race/Load] Race-condition burst viability under load"
      echo
      echo "- Description: Generate background traffic and then send concurrent bursts (http.batch) to approximate a race exploit through the gateway under load."
      echo "- Steps: \`k6 run gateway_race_under_load.js\`"
      echo "- Expected: No gateway 5xx; burst not fully throttled; acceptable 429 ratio via MAX_RACE_429_RATIO."
      echo "- Actual: see ${OUT_DIR}/gateway_race_under_load.txt"
      echo "- Status: $( [[ "${SCRIPT_RC[gateway_race_under_load.js]:-1}" == "0" ]] && echo PASS || echo FAIL )"
    fi

    if [[ -f "$OUT_DIR/gateway_passthrough_load.txt" ]]; then
      echo
      echo "### GW-LOAD-018 – [Load/Stress] Passthrough payload exploit-like"
      echo
      echo "- Description: Sustained traffic through gateway using authorized cookie, measuring error/latency thresholds."
      echo "- Steps: \`k6 run gateway_passthrough_load.js\`"
      echo "- Expected: Script thresholds pass (error rate + latency)."
      echo "- Actual: see ${OUT_DIR}/gateway_passthrough_load.txt"
      echo "- Status: $( [[ "${SCRIPT_RC[gateway_passthrough_load.js]:-1}" == "0" ]] && echo PASS || echo FAIL )"
    fi

    if [[ -f "$OUT_DIR/gateway_spike.txt" ]]; then
      echo
      echo "### GW-SPIKE-019 – [Spike] Handles burst load"
      echo
      echo "- Description: Sudden increase in VUs to observe gateway stability."
      echo "- Steps: \`k6 run gateway_spike.js\`"
      echo "- Expected: Script thresholds pass; no abnormal 5xx."
      echo "- Actual: see ${OUT_DIR}/gateway_spike.txt"
      echo "- Status: $( [[ "${SCRIPT_RC[gateway_spike.js]:-1}" == "0" ]] && echo PASS || echo FAIL )"
    fi

    if [[ -f "$OUT_DIR/gateway_soak.txt" ]]; then
      echo
      echo "### GW-SOAK-020 – [Soak] Long stability"
      echo
      echo "- Description: Long duration run to detect degradation/leaks."
      echo "- Steps: \`k6 run gateway_soak.js\`"
      echo "- Expected: Script thresholds pass over SOAK_DURATION."
      echo "- Actual: see ${OUT_DIR}/gateway_soak.txt"
      echo "- Status: $( [[ "${SCRIPT_RC[gateway_soak.js]:-1}" == "0" ]] && echo PASS || echo FAIL )"
    fi
  } >"$report_file"

  echo "$report_file" >"$OUT_DIR/report_path.txt"
}

set -euo pipefail

write_env_snapshot
smoke_curl

if [[ "$TYPE" == "race-sweep" ]]; then
  run_race_sweep
  exit 0
fi

SCRIPTS_STR="$(select_scripts "$TYPE")"
read -r -a K6_SCRIPTS <<<"$SCRIPTS_STR"

# If token is missing, only allow security-negative by default (and smoke). Others will fail immediately.
if ! have_valid_token; then
  filtered=()
  for s in "${K6_SCRIPTS[@]}"; do
    if [[ "$s" == "gateway_security_negative.js" ]]; then
      filtered+=("$s")
    elif [[ "$s" == "gateway_race_under_load.js" ]] && have_race_tokens; then
      filtered+=("$s")
    fi
  done
  K6_SCRIPTS=("${filtered[@]}")
fi

# Resilience requires BROKEN_TOKEN; skip it if missing so "all" doesn't fail early.
if [[ " ${K6_SCRIPTS[*]} " == *" gateway_resilience.js "* ]] && ! have_broken_token; then
  filtered=()
  for s in "${K6_SCRIPTS[@]}"; do
    if [[ "$s" != "gateway_resilience.js" ]]; then
      filtered+=("$s")
    fi
  done
  K6_SCRIPTS=("${filtered[@]}")
  RESILIENCE_BLOCKED=1
else
  RESILIENCE_BLOCKED=0
fi

if (( INCLUDE_BODY_LIMITS == 1 )); then
  K6_SCRIPTS+=("gateway_body_limits.js")
fi

declare -A SCRIPT_RC

for script in "${K6_SCRIPTS[@]}"; do
  logfile="$OUT_DIR/${script%.js}.txt"
  echo "Running: k6 run $script"
  set +e
  run_cmd_to_file "$logfile" k6 run "$script"
  rc=$?
  set -e
  SCRIPT_RC["$script"]=$rc
done

write_report

echo "DONE"
echo "- Logs:   $OUT_DIR"
echo "- Report: $(cat "$OUT_DIR/report_path.txt")"
