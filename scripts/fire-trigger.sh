#!/usr/bin/env bash
# PART 1 - REMEDIATE: fire the LaunchDarkly flag trigger that turns
# `wall-reactions-comments` OFF. Equivalent to:  curl -X POST "$LD_TRIGGER_URL"
#
# >>> REPLACE ME: set LD_TRIGGER_URL in .env to the URL LaunchDarkly shows when you
#     create the trigger (Flag > Settings > Triggers > Add trigger > Generic trigger,
#     action "Turn the flag off"). The URL is a secret - anyone with it can flip the flag.
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ -f .env ]]; then set -a; source .env; set +a; fi
if [[ -z "${LD_TRIGGER_URL:-}" ]]; then
  echo "LD_TRIGGER_URL is not set. Add it to .env (see docs/launchdarkly-setup.md)." >&2
  exit 1
fi
echo "Firing LaunchDarkly trigger..."
curl -sS -X POST "$LD_TRIGGER_URL" -H 'Content-Type: application/json' \
  -d '{"source":"manual curl","reason":"Kill switch: wall reactions misbehaving"}' -w '\nHTTP %{http_code}\n'
