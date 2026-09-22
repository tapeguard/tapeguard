#!/usr/bin/env bash
#
# Ship the working tree to the VPS and restart. Run from the repo root.
#
#   HOST=root@203.0.113.10 bash deploy/push.sh
#
set -euo pipefail
: "${HOST:?set HOST=user@ip}"
APP_DIR=${APP_DIR:-/srv/tapeguard}

# Tests first. A deploy that skips them is a deploy that finds out in public.
npm test
if command -v forge >/dev/null 2>&1; then forge test; fi
npx tsc --noEmit

rsync -az --delete \
  --exclude .git --exclude node_modules --exclude out --exclude cache \
  --exclude .env --exclude data \
  ./ "$HOST:$APP_DIR/"

# Restart only what is installed. On a host that has been bootstrapped but
# not yet configured, the relayer unit exists and is deliberately not
# enabled, and a blind restart of it would fail the whole deploy.
ssh "$HOST" "
  set -e
  chown -R tapeguard:tapeguard $APP_DIR
  if systemctl list-unit-files | grep -q '^tapeguard-api.service'; then
    systemctl restart tapeguard-api
    sleep 2
    systemctl is-active tapeguard-api
    curl -fsS localhost:8080/api/health >/dev/null && echo 'health ok'
  else
    echo 'tapeguard-api not installed yet — run deploy/bootstrap.sh first'
    exit 1
  fi
  if systemctl is-enabled tapeguard-relayer >/dev/null 2>&1; then
    systemctl restart tapeguard-relayer
    echo 'relayer restarted'
  fi
"
