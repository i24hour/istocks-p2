#!/usr/bin/env bash
# List Vercel project env var names, targets, and types (no values).
# Same API the CLI uses; requires a token from:
#   Vercel → Account Settings → Tokens → Create
#
# Usage:
#   export VERCEL_TOKEN="..."
#   export VERCEL_TEAM_ID="team_..."   # optional; default: i24hours team below
#   export VERCEL_PROJECT="istocks-p"  # optional; project id or name
#   ./scripts/vercel-env-audit.sh

set -euo pipefail

TOKEN="${VERCEL_TOKEN:-}"
TEAM="${VERCEL_TEAM_ID:-team_m2nFDtaRoWmuOvTwQdcc9J3s}"
PROJECT="${VERCEL_PROJECT:-istocks-p}"

if [[ -z "$TOKEN" ]]; then
  echo "Missing VERCEL_TOKEN."
  echo "Create one: https://vercel.com/account/tokens"
  echo "Then: export VERCEL_TOKEN='...' && ./scripts/vercel-env-audit.sh"
  exit 1
fi

URL="https://api.vercel.com/v9/projects/${PROJECT}/env?teamId=${TEAM}"
RESP="$(curl -sS -H "Authorization: Bearer ${TOKEN}" "$URL")"

if echo "$RESP" | jq -e '.error' >/dev/null 2>&1; then
  echo "$RESP" | jq .
  exit 1
fi

echo "Project: ${PROJECT}  Team: ${TEAM}"
echo ""
echo "=== Variables (key | targets | type | branch) ==="
echo "$RESP" | jq -r '
  .envs // [] |
  sort_by(.key) |
  .[] |
  [
    .key,
    (if (.target | type) == "array" then (.target | join(",")) else (.target // "?") end),
    (.type // "?"),
    (.gitBranch // "-")
  ] | @tsv
' | column -t -s $'\t' 2>/dev/null || echo "$RESP" | jq -r '.envs // [] | sort_by(.key) | .[] | "\(.key)\t\(.target)\t\(.type)\t\(.gitBranch // "-")"'

HIDDEN="$(echo "$RESP" | jq -r '.hiddenProductionEnvCount // 0')"
if [[ "$HIDDEN" != "0" && "$HIDDEN" != "null" ]]; then
  echo ""
  echo "Note: hiddenProductionEnvCount=$HIDDEN (some production vars may be hidden from API)."
fi

# Minimal checklist vs production (names only)
REQUIRED=(
  DATABASE_URL
  GEMINI_API_KEY
  NEXTAUTH_SECRET
  NEXTAUTH_URL
  CRON_SECRET
)

echo ""
echo "=== Suggested production checks (missing key listed if absent for production) ==="
KEYS_JSON="$(echo "$RESP" | jq -c '[.envs[] | select(
    (.target | type == "array" and (.target | index("production") != null)) or
    (.target == "production")
  ) | .key] | unique')"
for k in "${REQUIRED[@]}"; do
  if echo "$KEYS_JSON" | jq -e --arg k "$k" 'index($k) != null' >/dev/null 2>&1; then
    echo "  ok   $k (production)"
  else
    echo "  MISSING $k (production)"
  fi
done
