#!/usr/bin/env bash
# One-command WhatsApp gateway for AI Empire OS on a fresh Ubuntu server (e.g. Oracle Cloud Always Free).
# Installs Docker, runs WAHA (WhatsApp Web gateway) behind Caddy with an automatic HTTPS address
# (<ip>.sslip.io), and points WAHA's signed webhook at AI Empire.
#
# Usage (on the server):
#   sudo WAHA_KEY='...' HOOK_SECRET='...' bash whatsapp-gateway-setup.sh
# Then put WAHA_URL (printed at the end), WAHA_API_KEY (=WAHA_KEY) and WHATSAPP_WEBHOOK_SECRET (=HOOK_SECRET) in Vercel.
#
# Safety: WAHA's own dashboard/swagger are off; every API call needs WAHA_KEY; the webhook is HMAC-signed;
# sessions persist in a Docker volume so you scan the QR only once.
set -euo pipefail

: "${WAHA_KEY:?set WAHA_KEY (long random string)}"
: "${HOOK_SECRET:?set HOOK_SECRET (long random string)}"
APP_URL="${APP_URL:-https://ai-os-hq.vercel.app}"
[ "${#WAHA_KEY}" -ge 24 ] || { echo "WAHA_KEY must be at least 24 characters"; exit 1; }
[ "${#HOOK_SECRET}" -ge 24 ] || { echo "HOOK_SECRET must be at least 24 characters"; exit 1; }
[ "$(id -u)" = "0" ] || { echo "run with sudo"; exit 1; }

echo "==> Installing Docker (if needed)"
if ! command -v docker >/dev/null; then curl -fsSL https://get.docker.com | sh; fi

echo "==> Opening ports 80/443 in the server firewall"
for p in 80 443; do iptables -C INPUT -p tcp --dport "$p" -j ACCEPT 2>/dev/null || iptables -I INPUT -p tcp --dport "$p" -j ACCEPT; done
if command -v netfilter-persistent >/dev/null; then netfilter-persistent save >/dev/null 2>&1 || true; fi

IP="$(curl -fsS https://api.ipify.org)"
HOST="$(echo "$IP" | tr . -).sslip.io"
IMAGE="devlikeapro/waha"; [ "$(uname -m)" = "aarch64" ] && IMAGE="devlikeapro/waha:arm"

mkdir -p /opt/ai-empire-whatsapp && cd /opt/ai-empire-whatsapp
umask 077
cat > .env <<EOF
WAHA_API_KEY=${WAHA_KEY}
WHATSAPP_HOOK_URL=${APP_URL}/api/whatsapp/waha
WHATSAPP_HOOK_EVENTS=message
WHATSAPP_HOOK_HMAC_KEY=${HOOK_SECRET}
WHATSAPP_DEFAULT_ENGINE=WEBJS
WHATSAPP_START_SESSION=default
WHATSAPP_RESTART_ALL_SESSIONS=True
WAHA_DASHBOARD_ENABLED=False
WHATSAPP_SWAGGER_ENABLED=False
EOF
cat > Caddyfile <<EOF
${HOST} {
  reverse_proxy waha:3000
}
EOF
cat > docker-compose.yml <<EOF
services:
  waha:
    image: ${IMAGE}
    restart: unless-stopped
    env_file: .env
    volumes: [ "sessions:/app/.sessions" ]
  caddy:
    image: caddy:2
    restart: unless-stopped
    ports: [ "80:80", "443:443" ]
    volumes: [ "./Caddyfile:/etc/caddy/Caddyfile:ro", "caddy_data:/data" ]
    depends_on: [ waha ]
volumes:
  sessions: {}
  caddy_data: {}
EOF

echo "==> Starting the gateway"
docker compose up -d
sleep 20
if curl -fsS -o /dev/null -H "X-Api-Key: ${WAHA_KEY}" "https://${HOST}/api/sessions/default"; then echo "==> HTTPS OK"; else
  echo "!! HTTPS not reachable yet. In Oracle: Networking → Virtual cloud networks → your VCN → Security Lists → Default → Add Ingress Rules:"
  echo "   Source 0.0.0.0/0, TCP, destination ports 80,443. Then run: cd /opt/ai-empire-whatsapp && docker compose restart caddy"
fi
echo
echo "Put this in Vercel (Production), then redeploy and open WhatsApp Desk to scan the QR:"
echo "  WAHA_URL=https://${HOST}"
