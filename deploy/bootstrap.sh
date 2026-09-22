#!/usr/bin/env bash
#
# First-time setup of a VPS, and safe to re-run afterwards.
#
#   HOST=root@203.0.113.10 bash deploy/bootstrap.sh
#
# Does everything that does not involve a secret. The .env is created on the
# VPS from the example and left for you to fill in: keys are typed where they
# will live and are never rsynced from a laptop.
set -euo pipefail

: "${HOST:?set HOST=user@ip}"
APP_DIR=${APP_DIR:-/srv/tapeguard}
APP_USER=${APP_USER:-tapeguard}

say() { printf '\n==> %s\n' "$1"; }

say "checking the tree before shipping it"
npm test
npx tsc --noEmit
if command -v forge >/dev/null 2>&1; then forge test; fi
echo "    local checks pass"

say "reachable?"
# No BatchMode: password auth must be able to prompt. If you are typing a
# password you will be asked several times — `ssh-copy-id $HOST` once first
# makes the rest of this quiet.
ssh -o ConnectTimeout=10 "$HOST" 'echo "    connected to $(hostname), $(. /etc/os-release 2>/dev/null && echo "$PRETTY_NAME")"'

say "copying the tree to $HOST:$APP_DIR"
ssh "$HOST" "mkdir -p $APP_DIR"
# .env is never copied: it belongs to the host it runs on. node_modules is
# rebuilt there because native resolution differs from a laptop's.
rsync -az --delete \
  --exclude .git --exclude node_modules --exclude out --exclude cache \
  --exclude .env --exclude data \
  ./ "$HOST:$APP_DIR/"

say "installing dependencies and provisioning"
ssh "$HOST" "cd $APP_DIR && npm install --omit=dev --silent || npm install --silent"
ssh "$HOST" "cd $APP_DIR && sudo bash deploy/setup.sh"

say "seeding .env if it is not there yet"
ssh "$HOST" "
  if [ ! -f $APP_DIR/.env ]; then
    cp $APP_DIR/.env.example $APP_DIR/.env
    chmod 600 $APP_DIR/.env
    echo '    created $APP_DIR/.env from the example'
  else
    echo '    $APP_DIR/.env already exists, left alone'
  fi
  chown -R $APP_USER:$APP_USER $APP_DIR 2>/dev/null || true
"

say "can this host reach the chains?"
ssh "$HOST" "cd $APP_DIR && npm run doctor" || true

cat <<NEXT

Bootstrapped. What is left, and why it is left to you:

  1. Fill in $APP_DIR/.env on the VPS. Keys are typed where they run and
     are never copied from a laptop.

       ssh $HOST 'nano $APP_DIR/.env'

     At minimum: FINNHUB_API_KEY and FINNHUB_PRINT_TIME=true.
     Leave the chain keys empty until you are ready; the service runs
     without them and reports them as blockers.

  2. Start the site:

       ssh $HOST 'systemctl start tapeguard-api && systemctl is-active tapeguard-api'
       ssh $HOST 'curl -s localhost:8080/api/health | head -40'

  3. Point DNS at this host, then get a certificate:

       ssh $HOST 'apt-get install -y certbot python3-certbot-nginx'
       ssh $HOST 'certbot --nginx -d tapeguard.xyz -d www.tapeguard.xyz'

  Check the doctor output above before trusting any chain step. If it says
  DNS is intercepted on the VPS too, stop and say so: the whole chain plan
  changes.

NEXT
