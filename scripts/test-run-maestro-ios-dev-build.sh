#!/usr/bin/env bash

# Dependency-free behavior checks for the safety-critical preflight in
# run-maestro-ios-dev-build.sh. External tools are stubbed so this test cannot
# boot a simulator, contact EAS, start Metro, or run Maestro.
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
HARNESS="$PROJECT_ROOT/scripts/run-maestro-ios-dev-build.sh"
BASH_BIN="$(command -v bash)"
TEMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/maestro-harness-test.XXXXXX")"
STUB_DIR="$TEMP_ROOT/bin"
TOOL_LOG="$TEMP_ROOT/tool-calls.log"
mkdir -p "$STUB_DIR"
: >"$TOOL_LOG"

cleanup() {
  rm -rf "$TEMP_ROOT"
}
trap cleanup EXIT INT TERM

cat >"$STUB_DIR/tool-stub" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s' "$(basename "$0")" >>"$MAESTRO_HARNESS_TEST_TOOL_LOG"
printf '\t%s' "$@" >>"$MAESTRO_HARNESS_TEST_TOOL_LOG"
printf '\n' >>"$MAESTRO_HARNESS_TEST_TOOL_LOG"

case "$(basename "$0")" in
  java)
    printf 'openjdk version "17.0.12" 2024-07-16\n' >&2
    ;;
  xcrun)
    if [[ "${1:-}" == "simctl" && "${2:-}" == "list" ]]; then
      printf '{"devices":{}}\n'
      exit 0
    fi
    printf 'unexpected xcrun side effect: %s\n' "$*" >&2
    exit 97
    ;;
  *)
    printf 'unexpected external tool call: %s %s\n' "$(basename "$0")" "$*" >&2
    exit 97
    ;;
esac
EOF
chmod +x "$STUB_DIR/tool-stub"
for tool in java xcrun maestro npx curl lsof brew; do
  ln -s tool-stub "$STUB_DIR/$tool"
done

OUTPUT=""
STATUS=0
RUN_NUMBER=0

run_harness() {
  local case_dir arg parsing_env
  local -a env_args=()
  local -a harness_args=()
  parsing_env=true
  for arg in "$@"; do
    if [[ "$parsing_env" == true && "$arg" == "--" ]]; then
      parsing_env=false
    elif [[ "$parsing_env" == true ]]; then
      env_args+=("$arg")
    else
      harness_args+=("$arg")
    fi
  done
  [[ "$parsing_env" == false ]] || {
    printf 'test error: run_harness requires -- between environment and CLI arguments\n' >&2
    exit 2
  }

  RUN_NUMBER=$((RUN_NUMBER + 1))
  case_dir="$TEMP_ROOT/case-$RUN_NUMBER"
  mkdir -p "$case_dir"
  : >"$TOOL_LOG"

  set +e
  OUTPUT="$(
    env \
      -u JAVA_HOME \
      -u EAS_BUILD_ID \
      -u MAESTRO_IOS_SIMULATOR_UDID \
      -u MAESTRO_ALLOW_PAID_ANALYSIS \
      -u MAESTRO_ALLOW_FIXTURE_FLOWS \
      -u MAESTRO_QUOTA_EXHAUSTED_EMAIL \
      -u MAESTRO_QUOTA_EXHAUSTED_PASSWORD \
      PATH="$STUB_DIR:$PATH" \
      MAESTRO_HARNESS_TEST_TOOL_LOG="$TOOL_LOG" \
      MAESTRO_IOS_DEV_CACHE_DIR="$case_dir/builds" \
      MAESTRO_OUTPUT_DIR="$case_dir/runs" \
      "${env_args[@]+"${env_args[@]}"}" \
      "$BASH_BIN" "$HARNESS" "${harness_args[@]+"${harness_args[@]}"}" 2>&1
  )"
  STATUS=$?
  set -e
}

assert_failed_with() {
  local description="$1" expected="$2"
  if [[ "$STATUS" -eq 0 || "$OUTPUT" != *"$expected"* ]]; then
    printf 'not ok - %s\nexpected nonzero status containing: %s\nactual status: %s\noutput:\n%s\n' \
      "$description" "$expected" "$STATUS" "$OUTPUT" >&2
    exit 1
  fi
  printf 'ok - %s\n' "$description"
}

assert_no_external_tools() {
  local description="$1"
  if [[ -s "$TOOL_LOG" ]]; then
    printf 'not ok - %s\nunexpected external tool calls:\n' "$description" >&2
    sed 's/^/  /' "$TOOL_LOG" >&2
    exit 1
  fi
}

run_harness --
assert_failed_with "a flow must be selected explicitly" "Select at least one top-level flow explicitly."
assert_no_external_tools "missing-flow rejection happens before external tools"

run_harness -- happy-path
assert_failed_with "a simulator UDID must be supplied explicitly" "MAESTRO_IOS_SIMULATOR_UDID is required"
assert_no_external_tools "missing-UDID rejection happens before external tools"

run_harness \
  MAESTRO_IOS_SIMULATOR_UDID=test-udid \
  MAESTRO_ALLOW_PAID_ANALYSIS=1 \
  -- happy-path happy-path.yaml
assert_failed_with "duplicate aliases for one flow are rejected" "Duplicate flow argument: happy-path.yaml"
assert_no_external_tools "duplicate rejection happens before external tools"

run_harness \
  MAESTRO_IOS_SIMULATOR_UDID=test-udid \
  MAESTRO_ALLOW_PAID_ANALYSIS=1 \
  MAESTRO_ALLOW_FIXTURE_FLOWS=1 \
  MAESTRO_QUOTA_EXHAUSTED_EMAIL=fixture@example.invalid \
  MAESTRO_QUOTA_EXHAUSTED_PASSWORD=fixture-password \
  -- dead-end-analysis-failure
assert_failed_with "analysis-failure remains blocked despite every opt-in" "dead-end-analysis-failure.yaml is hard-blocked"
assert_no_external_tools "analysis-failure rejection happens before external tools"

run_harness MAESTRO_IOS_SIMULATOR_UDID=test-udid -- happy-path
assert_failed_with "live analysis requires paid-analysis opt-in" "happy-path.yaml submits a live analysis and requires MAESTRO_ALLOW_PAID_ANALYSIS=1."
assert_no_external_tools "paid-analysis rejection happens before external tools"

run_harness \
  MAESTRO_IOS_SIMULATOR_UDID=test-udid \
  MAESTRO_ALLOW_PAID_ANALYSIS=1 \
  -- happy-path dead-end-offline
assert_failed_with "the two-flow live budget stops at simulator validation" "MAESTRO_IOS_SIMULATOR_UDID is not an available iOS Simulator device: test-udid"
if [[ "$OUTPUT" != *"Selected client endpoint submission budget: 2"* || "$OUTPUT" != *"cap: 2"* ]]; then
  printf 'not ok - the live-analysis budget and cap are reported\noutput:\n%s\n' "$OUTPUT" >&2
  exit 1
fi
if grep -Eq $'xcrun\t.*\t(boot|install|launch)' "$TOOL_LOG"; then
  printf 'not ok - budget preflight attempted a simulator side effect\ntool calls:\n' >&2
  sed 's/^/  /' "$TOOL_LOG" >&2
  exit 1
fi
printf 'ok - the live-analysis budget and cap are reported before simulator side effects\n'

run_harness \
  MAESTRO_IOS_SIMULATOR_UDID=test-udid \
  MAESTRO_ALLOW_FIXTURE_FLOWS=1 \
  MAESTRO_QUOTA_EXHAUSTED_EMAIL=fixture@example.invalid \
  -- dead-end-quota-exhausted
assert_failed_with "fixture flow requires explicit credentials" "requires MAESTRO_QUOTA_EXHAUSTED_EMAIL and MAESTRO_QUOTA_EXHAUSTED_PASSWORD."
assert_no_external_tools "fixture-credential rejection happens before external tools"

for flow_spelling in \
  happy-path \
  happy-path.yaml \
  .maestro/flows/happy-path.yaml \
  "$PROJECT_ROOT/.maestro/flows/happy-path.yaml"; do
  run_harness MAESTRO_IOS_SIMULATOR_UDID=test-udid -- "$flow_spelling"
  assert_failed_with "accepted flow path resolves: $flow_spelling" "happy-path.yaml submits a live analysis and requires MAESTRO_ALLOW_PAID_ANALYSIS=1."
  assert_no_external_tools "flow-path policy rejection happens before external tools"
done

printf 'All Maestro iOS dev-build harness behavior checks passed.\n'
