#!/usr/bin/env bash
# Runs the real-Postgres/real-Storage integration tests in
# `supabase/functions/_shared/integration/` (issues #49, #59) against the local Supabase stack
# (issue #92). These are NOT part of `npm test`/`npm run test:edge` — they need a live local stack
# that a fresh checkout or CI does not have, so they follow the same opt-in convention as
# `npm run eval:grounding` (`*.local.ts`, discovered by neither `deno test`'s default glob nor
# Jest's) and are run explicitly, here, instead.
#
# Prereqs: Docker Desktop running, `supabase` CLI on PATH, local stack started
# (`supabase start` — see docs/architecture.md's local-dev section for the current setup notes).
set -euo pipefail

cd "$(dirname "$0")/.."

if ! command -v supabase >/dev/null 2>&1; then
  echo "error: the supabase CLI is not on PATH. Install it, then re-run this script." >&2
  echo "  (see docs/architecture.md's 'Local Supabase stack' section)" >&2
  exit 1
fi

STATUS_ENV="$(supabase status -o env 2>/dev/null)" || {
  echo "error: 'supabase status' failed — is the local stack running? Run 'supabase start' first." >&2
  exit 1
}

# shellcheck disable=SC2086
eval "$STATUS_ENV"

export SUPABASE_URL="$API_URL"
# The JWT-based SERVICE_ROLE_KEY, not the new sb_secret_... SECRET_KEY: PostgREST needs the
# "role": "service_role" claim to bypass RLS, and the local stack's Kong gateway does not
# translate the new key format into that claim the same way production's API gateway does.
export SUPABASE_SECRET_KEYS="$SERVICE_ROLE_KEY"

deno test \
  --config supabase/functions/deno.json \
  --allow-net --allow-env --allow-read \
  supabase/functions/_shared/integration/*.local.ts
