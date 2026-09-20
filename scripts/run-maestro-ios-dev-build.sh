#!/usr/bin/env bash

# Runs explicitly selected Maestro flows against the EAS iOS development build. This deliberately
# does not start Simulator.app, erase devices, or choose a simulator implicitly.
set -euo pipefail

readonly DEFAULT_EAS_BUILD_ID="dbd22da6-b42b-4d4b-a270-0e6fd138e42b"
readonly APP_ID="com.ian.paceanalysisai"
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
readonly PROJECT_ROOT
readonly FLOW_DIR="$PROJECT_ROOT/.maestro/flows"
readonly RESTORE_ONLINE_FLOW="$FLOW_DIR/subflows/restore-online.yaml"
readonly DEFAULT_RUNTIME_ROOT="$PROJECT_ROOT/node_modules/.cache/maestro-ios-dev"

EAS_BUILD_ID="${EAS_BUILD_ID:-$DEFAULT_EAS_BUILD_ID}"
METRO_PORT="${MAESTRO_METRO_PORT:-8081}"
UDID="${MAESTRO_IOS_SIMULATOR_UDID:-}"
CACHE_DIR="${MAESTRO_IOS_DEV_CACHE_DIR:-$DEFAULT_RUNTIME_ROOT/builds}"
OUTPUT_ROOT="${MAESTRO_OUTPUT_DIR:-$DEFAULT_RUNTIME_ROOT/runs}"
RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)-$$"
RUN_OUTPUT_DIR=""
APP_BUNDLE=""
METRO_PID=""
TEMP_DIR=""
RESTORE_READY=false

usage() {
  cat <<'EOF'
Usage: MAESTRO_IOS_SIMULATOR_UDID=<simulator-udid> npm run e2e:maestro:ios-dev -- <flow> [<flow> ...]

Each flow may be its top-level name (for example, happy-path), filename, .maestro/flows path,
or absolute top-level path. The script never runs a flow unless it is named explicitly.

Environment:
  EAS_BUILD_ID                         EAS build UUID (default: dbd22da6-b42b-4d4b-a270-0e6fd138e42b)
  MAESTRO_IOS_SIMULATOR_UDID          Required available iOS Simulator UDID
  MAESTRO_METRO_PORT                  Metro port (default: 8081)
  MAESTRO_IOS_DEV_CACHE_DIR           Downloaded build cache directory
  MAESTRO_OUTPUT_DIR                  Run-scoped JUnit and debug-artifact directory
  MAESTRO_ALLOW_PAID_ANALYSIS=1       Required for each live analysis flow
  MAESTRO_ALLOW_FIXTURE_FLOWS=1       Required for the quota fixture flow
  MAESTRO_E2E_EMAIL/PASSWORD          Required for happy-path/dead-end-offline (both sign in to
                                      the fixture account by design; see README)

The caller's MAESTRO_* credential variables are preserved for Maestro interpolation.
EOF
}

fail() {
  echo "error: $*" >&2
  exit 1
}

restore_online() {
  [[ "$RESTORE_READY" == true ]] || return 0
  maestro --udid "$UDID" test "$RESTORE_ONLINE_FLOW" >/dev/null 2>&1 || {
    echo "warning: could not restore airplane mode to false for $UDID" >&2
    return 1
  }
}

cleanup() {
  local exit_code=$? restore_failed=false
  trap - EXIT INT TERM

  if ! restore_online; then
    restore_failed=true
  fi
  if [[ -n "$METRO_PID" ]] && kill -0 "$METRO_PID" 2>/dev/null; then
    kill "$METRO_PID" 2>/dev/null || true
    wait "$METRO_PID" 2>/dev/null || true
  fi
  if [[ -n "$TEMP_DIR" && -d "$TEMP_DIR" ]]; then
    rm -rf "$TEMP_DIR"
  fi
  if [[ "$exit_code" -eq 0 && "$restore_failed" == true ]]; then
    exit 1
  fi
  exit "$exit_code"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

java_version() {
  local candidate="$1"
  "$candidate" -version 2>&1 | awk -F '"' '/version/ { print $2; exit }'
}

usable_java() {
  local candidate="$1" version major
  [[ -x "$candidate" ]] || return 1
  version="$(java_version "$candidate" || true)"
  [[ -n "$version" ]] || return 1
  if [[ "$version" == 1.* ]]; then
    major="${version#1.}"
    major="${major%%.*}"
  else
    major="${version%%.*}"
  fi
  [[ "$major" =~ ^[0-9]+$ && "$major" -ge 17 ]] || return 1
  printf '%s\n' "$candidate"
}

find_java() {
  local candidate homebrew_prefix java_home
  local -a candidates=()

  [[ -n "${JAVA_HOME:-}" ]] && candidates+=("$JAVA_HOME/bin/java")
  if command -v java >/dev/null 2>&1; then
    candidates+=("$(command -v java)")
  fi
  if [[ -x /usr/libexec/java_home ]]; then
    java_home="$(/usr/libexec/java_home -v 17 2>/dev/null || true)"
    [[ -n "$java_home" ]] && candidates+=("$java_home/bin/java")
  fi
  candidates+=(
    /opt/homebrew/opt/openjdk/libexec/openjdk.jdk/Contents/Home/bin/java
    /opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home/bin/java
    /opt/homebrew/opt/openjdk@17/bin/java
    /usr/local/opt/openjdk/libexec/openjdk.jdk/Contents/Home/bin/java
    /usr/local/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home/bin/java
    /usr/local/opt/openjdk@17/bin/java
  )
  if command -v brew >/dev/null 2>&1; then
    homebrew_prefix="$(brew --prefix openjdk@17 2>/dev/null || true)"
    [[ -n "$homebrew_prefix" ]] && candidates+=(
      "$homebrew_prefix/libexec/openjdk.jdk/Contents/Home/bin/java"
      "$homebrew_prefix/bin/java"
    )
  fi

  for candidate in "${candidates[@]}"; do
    if usable_java "$candidate"; then
      return 0
    fi
  done
  return 1
}

require_java() {
  local java_bin java_home
  java_bin="$(find_java || true)"
  [[ -n "$java_bin" ]] || fail "Maestro requires a working Java 17+. Install it with 'brew install openjdk@17', then set JAVA_HOME."
  java_home="$(cd "$(dirname "$java_bin")/.." && pwd -P)"
  export JAVA_HOME="$java_home"
}

resolve_flow() {
  local requested="$1" candidate
  case "$requested" in
    /*) candidate="$requested" ;;
    .maestro/flows/*) candidate="$PROJECT_ROOT/$requested" ;;
    *.yaml) candidate="$FLOW_DIR/$requested" ;;
    *) candidate="$FLOW_DIR/$requested.yaml" ;;
  esac
  [[ -f "$candidate" ]] || fail "Unknown flow '$requested'. Expected a top-level .maestro/flows/*.yaml file."
  candidate="$(cd "$(dirname "$candidate")" && pwd -P)/$(basename "$candidate")"
  [[ "$(dirname "$candidate")" == "$FLOW_DIR" ]] || fail "Flow '$requested' is not a top-level .maestro/flows/*.yaml file."
  printf '%s\n' "$candidate"
}

validate_flow_policy() {
  local flow_name="$1"
  case "$flow_name" in
    dead-end-analysis-failure.yaml)
      fail "$flow_name is hard-blocked until a deterministic failure-injection contract exists."
      ;;
    dead-end-quota-exhausted.yaml)
      [[ "${MAESTRO_ALLOW_FIXTURE_FLOWS:-}" == "1" ]] || fail "$flow_name requires MAESTRO_ALLOW_FIXTURE_FLOWS=1 and a provisioned quota fixture."
      [[ -n "${MAESTRO_QUOTA_EXHAUSTED_EMAIL:-}" && -n "${MAESTRO_QUOTA_EXHAUSTED_PASSWORD:-}" ]] || fail "$flow_name requires MAESTRO_QUOTA_EXHAUSTED_EMAIL and MAESTRO_QUOTA_EXHAUSTED_PASSWORD."
      ;;
    happy-path.yaml|dead-end-offline.yaml)
      [[ "${MAESTRO_ALLOW_PAID_ANALYSIS:-}" == "1" ]] || fail "$flow_name submits a live analysis and requires MAESTRO_ALLOW_PAID_ANALYSIS=1."
      [[ -n "${MAESTRO_E2E_EMAIL:-}" && -n "${MAESTRO_E2E_PASSWORD:-}" ]] || fail "$flow_name signs in to a pre-provisioned fixture account (see .maestro/README.md) and requires MAESTRO_E2E_EMAIL and MAESTRO_E2E_PASSWORD."
      ;;
  esac
}

validate_udid() {
  local devices_json
  devices_json="$(xcrun simctl list devices available --json)"
  node -e '
    const devices = JSON.parse(process.argv[1]).devices;
    const udid = process.argv[2];
    const found = Object.values(devices).flat().some((device) => device.udid === udid && device.isAvailable === true);
    process.exit(found ? 0 : 1);
  ' "$devices_json" "$UDID" || fail "MAESTRO_IOS_SIMULATOR_UDID is not an available iOS Simulator device: $UDID"
}

ensure_runtime_directories() {
  (umask 077; mkdir -p "$DEFAULT_RUNTIME_ROOT" "$CACHE_DIR" "$OUTPUT_ROOT")
  RUN_OUTPUT_DIR="$OUTPUT_ROOT/$RUN_ID"
  mkdir -m 700 "$RUN_OUTPUT_DIR"
}

validate_app_bundle() {
  local bundle="$1" info identifier executable platforms
  [[ -d "$bundle" ]] || return 1
  info="$bundle/Info.plist"
  [[ -f "$info" ]] || return 1
  identifier="$(plutil -extract CFBundleIdentifier raw -o - "$info" 2>/dev/null || true)"
  [[ "$identifier" == "$APP_ID" ]] || return 1
  executable="$(plutil -extract CFBundleExecutable raw -o - "$info" 2>/dev/null || true)"
  [[ -n "$executable" && -x "$bundle/$executable" ]] || return 1
  platforms="$(plutil -extract CFBundleSupportedPlatforms xml1 -o - "$info" 2>/dev/null || true)"
  [[ "$platforms" == *"iPhoneSimulator"* ]] || return 1
}

validate_build_metadata() {
  local build_json="$1"
  node -e '
    const fs = require("fs");
    const build = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    if (build.status !== "FINISHED" || build.platform !== "IOS" || build.buildProfile !== "development") process.exit(1);
    const url = build.artifacts && build.artifacts.buildUrl;
    if (typeof url !== "string" || url.length === 0) process.exit(1);
    process.stdout.write(url);
  ' "$build_json"
}

prepare_app_bundle() {
  local build_json build_url archive extracted app_candidate invalid_cache
  APP_BUNDLE="$CACHE_DIR/$EAS_BUILD_ID.app"
  if [[ -e "$APP_BUNDLE" ]]; then
    if validate_app_bundle "$APP_BUNDLE"; then
      return 0
    fi
    invalid_cache="$CACHE_DIR/invalid-$EAS_BUILD_ID-$RUN_ID.app"
    mv "$APP_BUNDLE" "$invalid_cache" || fail "Could not quarantine invalid cached app bundle $APP_BUNDLE."
  fi

  TEMP_DIR="$(mktemp -d "$DEFAULT_RUNTIME_ROOT/extract.XXXXXX")"
  build_json="$TEMP_DIR/build.json"
  npx eas-cli@latest build:view "$EAS_BUILD_ID" --json >"$build_json"
  build_url="$(validate_build_metadata "$build_json")" || fail "EAS build $EAS_BUILD_ID must be FINISHED, IOS, development, and include artifacts.buildUrl."

  archive="$TEMP_DIR/build-artifact"
  curl --fail --silent --show-error --location --retry 3 --output "$archive" "$build_url"
  extracted="$TEMP_DIR/extracted"
  mkdir -m 700 "$extracted"
  if unzip -tqq "$archive" >/dev/null 2>&1; then
    unzip -q "$archive" -d "$extracted"
  else
    tar -xf "$archive" -C "$extracted" || fail "Downloaded EAS artifact is neither a ZIP nor a tar archive."
  fi
  app_candidate="$(find "$extracted" -type d -name '*.app' -print -quit)"
  [[ -n "$app_candidate" ]] || fail "Downloaded EAS artifact did not contain an .app bundle."
  validate_app_bundle "$app_candidate" || fail "Downloaded EAS artifact is not an executable $APP_ID iPhoneSimulator app bundle."
  mv "$app_candidate" "$APP_BUNDLE"
}

boot_simulator() {
  xcrun simctl boot "$UDID" >/dev/null 2>&1 || true
  xcrun simctl bootstatus "$UDID" -b
  RESTORE_READY=true
}

verify_metro_listener() {
  local listener_pid listener_cwd listener_pids metro_status second_listener
  listener_pids="$(lsof -nP -iTCP:"$METRO_PORT" -sTCP:LISTEN -t 2>/dev/null | sort -u)" || fail "Could not inspect the listener on port $METRO_PORT."
  listener_pid="$(printf '%s\n' "$listener_pids" | sed -n '1p')"
  second_listener="$(printf '%s\n' "$listener_pids" | sed -n '2p')"
  [[ -n "$listener_pid" && -z "$second_listener" ]] || fail "Port $METRO_PORT must have exactly one listener to reuse."
  listener_cwd="$(lsof -a -p "$listener_pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p')"
  [[ "$listener_cwd" == "$PROJECT_ROOT" ]] || fail "Port $METRO_PORT is owned by PID $listener_pid outside $PROJECT_ROOT; refusing to reuse or kill it."
  metro_status="$(curl --fail --silent --show-error --max-time 2 "http://127.0.0.1:$METRO_PORT/status")" || fail "Port $METRO_PORT listener did not serve Metro /status."
  [[ "$metro_status" == *"packager-status:running"* ]] || fail "Port $METRO_PORT listener is not a running Metro packager."
}

start_or_reuse_metro() {
  local expo_bin="$PROJECT_ROOT/node_modules/.bin/expo"
  if lsof -nP -iTCP:"$METRO_PORT" -sTCP:LISTEN -t >/dev/null 2>&1; then
    verify_metro_listener
    echo "Reusing Metro listener on port $METRO_PORT."
    return 0
  fi

  [[ -x "$expo_bin" ]] || fail "Expected Expo CLI at $expo_bin. Run npm install before this harness."
  echo "Starting Metro on port $METRO_PORT."
  (
    cd "$PROJECT_ROOT"
    exec "$expo_bin" start --dev-client --port "$METRO_PORT"
  ) >"$RUN_OUTPUT_DIR/metro.log" 2>&1 &
  METRO_PID=$!

  for _ in $(seq 1 60); do
    if lsof -nP -iTCP:"$METRO_PORT" -sTCP:LISTEN -t >/dev/null 2>&1; then
      verify_metro_listener
      return 0
    fi
    if ! kill -0 "$METRO_PID" 2>/dev/null; then
      fail "Metro exited before listening on port $METRO_PORT. See $RUN_OUTPUT_DIR/metro.log."
    fi
    sleep 1
  done
  fail "Metro did not listen on port $METRO_PORT within 60 seconds. See $RUN_OUTPUT_DIR/metro.log."
}

app_install_state() {
  local apps_json parse_status
  apps_json="$(xcrun simctl listapps "$UDID" | plutil -convert json -o - - 2>/dev/null)" || {
    echo "error: simctl listapps failed for $UDID." >&2
    return 2
  }
  if node -e '
      try {
        const apps = JSON.parse(process.argv[1]);
        const appId = process.argv[2];
        process.exit(Object.prototype.hasOwnProperty.call(apps, appId) ? 0 : 1);
      } catch {
        process.exit(2);
      }
    ' "$apps_json" "$APP_ID"; then
    parse_status=0
  else
    parse_status=$?
  fi
  case "$parse_status" in
    0|1) return "$parse_status" ;;
    *) echo "error: simctl listapps returned an unreadable app list for $UDID." >&2; return 2 ;;
  esac
}

fresh_install() {
  local install_state
  if app_install_state; then
    xcrun simctl terminate "$UDID" "$APP_ID" >/dev/null 2>&1 || true
    xcrun simctl uninstall "$UDID" "$APP_ID" || return 1
    if app_install_state; then
      echo "error: $APP_ID remained installed after simctl uninstall." >&2
      return 1
    else
      install_state=$?
      [[ "$install_state" -eq 1 ]] || return "$install_state"
    fi
  else
    install_state=$?
    [[ "$install_state" -eq 1 ]] || return "$install_state"
  fi

  xcrun simctl install "$UDID" "$APP_BUNDLE" || return 1
  xcrun simctl privacy "$UDID" reset all "$APP_ID" || return 1
}

flow_env_args() {
  # `maestro test` only interpolates ${VAR} for names passed via -e/--env — it does NOT read the
  # process environment on its own (confirmed empirically 2026-09-19: an exported-but-not--e'd
  # var renders as the literal string "null" in the flow, not its value). Each flow gets exactly
  # the credential pair its own yaml references, so an unset, irrelevant var never leaks in as
  # "null" for a flow that doesn't need it.
  local flow_name="$1"
  local -a env_args=()
  case "$flow_name" in
    happy-path.yaml|dead-end-offline.yaml)
      env_args=(-e "MAESTRO_E2E_EMAIL=${MAESTRO_E2E_EMAIL:-}" -e "MAESTRO_E2E_PASSWORD=${MAESTRO_E2E_PASSWORD:-}")
      ;;
    dead-end-quota-exhausted.yaml)
      env_args=(-e "MAESTRO_QUOTA_EXHAUSTED_EMAIL=${MAESTRO_QUOTA_EXHAUSTED_EMAIL:-}" -e "MAESTRO_QUOTA_EXHAUSTED_PASSWORD=${MAESTRO_QUOTA_EXHAUSTED_PASSWORD:-}")
      ;;
  esac
  printf '%s\n' "${env_args[@]+"${env_args[@]}"}"
}

run_flow() {
  local flow="$1" name output_dir
  local -a env_args=()
  name="$(basename "$flow" .yaml)"
  output_dir="$RUN_OUTPUT_DIR/$name"
  mkdir -m 700 "$output_dir" || return 1
  while IFS= read -r arg; do
    [[ -n "$arg" ]] && env_args+=("$arg")
  done < <(flow_env_args "$(basename "$flow")")

  fresh_install || return 1
  xcrun simctl spawn "$UDID" defaults write "$APP_ID" EXDevMenuIsOnboardingFinished -bool YES || return 1
  xcrun simctl launch "$UDID" "$APP_ID" --initialUrl "http://localhost:$METRO_PORT" || return 1
  maestro --udid "$UDID" test "${env_args[@]+"${env_args[@]}"}" --format junit --output "$output_dir/junit.xml" --debug-output "$output_dir/debug" "$flow"
}

[[ $# -gt 0 ]] || {
  usage
  fail "Select at least one top-level flow explicitly."
}
[[ -n "$UDID" ]] || fail "MAESTRO_IOS_SIMULATOR_UDID is required; this script never chooses a simulator for you."
[[ "$METRO_PORT" =~ ^[0-9]+$ && "$METRO_PORT" -ge 1 && "$METRO_PORT" -le 65535 ]] || fail "MAESTRO_METRO_PORT must be a TCP port from 1 through 65535."
[[ "$EAS_BUILD_ID" =~ ^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$ ]] || fail "EAS_BUILD_ID must be a UUID."

declare -a flows=()
seen_flows=''
live_submission_budget=0
for requested in "$@"; do
  flow="$(resolve_flow "$requested")"
  if printf '%s\n' "$seen_flows" | grep -F -x -- "$flow" >/dev/null; then
    fail "Duplicate flow argument: $requested"
  fi
  seen_flows="${seen_flows}${flow}
"
  validate_flow_policy "$(basename "$flow")"
  case "$(basename "$flow")" in
    happy-path.yaml|dead-end-offline.yaml) ((live_submission_budget += 1)) ;;
  esac
  flows+=("$flow")
done
[[ "$live_submission_budget" -le 2 ]] || fail "Selected live analysis submission budget is $live_submission_budget; the hard cap is 2."
printf 'Selected client endpoint submission budget: %s (1 per selected live flow; the provider may retry each request once; cap: 2).\n' "$live_submission_budget"

require_java
command -v xcrun >/dev/null 2>&1 || fail "xcrun is required to boot and control the iOS Simulator."
command -v maestro >/dev/null 2>&1 || fail "maestro is required. Install it before running this script."
[[ -f "$RESTORE_ONLINE_FLOW" ]] || fail "Missing restore-online subflow: $RESTORE_ONLINE_FLOW"
validate_udid
ensure_runtime_directories
prepare_app_bundle
boot_simulator
start_or_reuse_metro

matrix_file="$RUN_OUTPUT_DIR/results.tsv"
printf 'flow\tstatus\n' >"$matrix_file"
suite_failed=false
for flow in "${flows[@]}"; do
  flow_name="$(basename "$flow")"
  echo "Running $flow_name on simulator $UDID."
  if run_flow "$flow"; then
    flow_status=PASS
  else
    flow_status=FAIL
    suite_failed=true
  fi
  printf '%s\t%s\n' "$flow_name" "$flow_status" | tee -a "$matrix_file"
  if ! restore_online; then
    suite_failed=true
  fi
done
echo "Results matrix: $matrix_file"
cat "$matrix_file"
[[ "$suite_failed" == false ]]
