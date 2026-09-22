#!/usr/bin/env bash
#
# Provision a fresh Ubuntu VPS for tapeguard. Idempotent; safe to re-run.
#
#   sudo bash deploy/setup.sh
#
set -euo pipefail

DOMAIN="${DOMAIN:-tapeguard.xyz}"
APP_DIR=/srv/tapeguard
APP_USER=tapeguard

if [[ $EUID -ne 0 ]]; then echo "run with sudo" >&2; exit 1; fi

echo "==> packages"
apt-get update -qq
apt-get install -y -qq curl ca-certificates git nginx ufw

# Node 22.6+ is enough: this project has no build step and runs TypeScript
# through Node's own type stripping, which the units invoke explicitly with
# --experimental-strip-types so it works either side of 23.6.
#
# Deliberately does NOT upgrade an existing Node. This box may run other
# services, and replacing their runtime to satisfy ours is a way to take
# down something unrelated while installing something new.
if ! command -v node >/dev/null 2>&1; then
  echo "==> node 22 (none installed)"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y -qq nodejs
else
  MAJOR=$(node -p 'process.versions.node.split(".")[0]')
  MINOR=$(node -p 'process.versions.node.split(".")[1]')
  if [ "$MAJOR" -lt 22 ] || { [ "$MAJOR" -eq 22 ] && [ "$MINOR" -lt 6 ]; }; then
    echo "    node $(node -v) is too old and other services may depend on it."
    echo "    Upgrade it yourself, or run this project under a newer node."
    exit 1
  fi
  echo "    reusing node $(node -v), untouched"
fi

echo "==> user and directories"
id -u "$APP_USER" >/dev/null 2>&1 || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin "$APP_USER"
mkdir -p "$APP_DIR/data"
chown -R "$APP_USER:$APP_USER" "$APP_DIR"

echo "==> firewall"
# Allow the port SSH is ACTUALLY on before enabling the firewall.
#
# `ufw allow OpenSSH` only opens 22. On a host whose sshd was moved — which
# is common hardening advice, and which Hostinger images sometimes ship —
# enabling ufw after allowing only 22 locks you out of your own machine,
# and the lockout happens on the same command that caused it.
#
# Two sources, because either alone can be wrong: the port sshd is
# configured for, and the port this very session arrived on.
SSH_PORTS=$(grep -oPi '^\s*Port\s+\K[0-9]+' /etc/ssh/sshd_config 2>/dev/null | sort -u || true)
CURRENT_PORT=$(echo "${SSH_CONNECTION:-}" | awk '{print $4}')
[ -n "$CURRENT_PORT" ] && SSH_PORTS=$(printf '%s\n%s\n' "$SSH_PORTS" "$CURRENT_PORT" | sort -u)
[ -z "$(echo "$SSH_PORTS" | tr -d '[:space:]')" ] && SSH_PORTS=22

for port in $SSH_PORTS; do
  echo "    allowing ssh on $port"
  ufw allow "$port"/tcp >/dev/null
done
ufw allow 'Nginx Full' >/dev/null
ufw --force enable >/dev/null
# 8080 is deliberately NOT opened. The service binds 127.0.0.1 and is only
# reachable through nginx, so TLS and rate limiting cannot be bypassed by
# hitting the port directly.

echo "==> nginx"
# Validate BEFORE enabling, and roll the symlink back if it does not hold.
#
# nginx config is global: a broken file in sites-enabled blocks every reload
# on the box, including for sites that have nothing to do with this one. On a
# host already serving other projects, linking first and testing second means
# the failure lands on them.
install -m 644 "$(dirname "$0")/nginx.conf" /etc/nginx/sites-available/tapeguard
ln -sf /etc/nginx/sites-available/tapeguard /etc/nginx/sites-enabled/tapeguard
if nginx -t 2>/dev/null; then
  systemctl reload nginx
  echo "    nginx reloaded with the tapeguard site"
else
  rm -f /etc/nginx/sites-enabled/tapeguard
  echo "    nginx config REJECTED; the site was not enabled and nothing changed:"
  nginx -t || true
  exit 1
fi
# Deliberately NOT removing the default site or anything else already here.

echo "==> systemd"
install -m 644 "$(dirname "$0")/tapeguard-api.service" /etc/systemd/system/
install -m 644 "$(dirname "$0")/tapeguard-relayer.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable tapeguard-api

cat <<NEXT

Provisioned. Remaining steps, in order:

  1. Copy the app and its env:
       rsync -a --delete --exclude .git --exclude node_modules ./ root@HOST:$APP_DIR/
       cp .env.example $APP_DIR/.env && \$EDITOR $APP_DIR/.env
       chown -R $APP_USER:$APP_USER $APP_DIR
       chmod 600 $APP_DIR/.env

  2. Point DNS A/AAAA for $DOMAIN at this host, then:
       apt-get install -y certbot python3-certbot-nginx
       certbot --nginx -d $DOMAIN -d www.$DOMAIN

  3. Start it:
       systemctl start tapeguard-api
       curl -s localhost:8080/api/health | head -40

  4. Only once TAPEGUARD_ADDRESS and the keys are set:
       systemctl enable --now tapeguard-relayer

Check that /api/health reports canCorroborateHalts: true before treating any
halt verdict as corroborated. With Yahoo alone it is false, and it should be.

NEXT
