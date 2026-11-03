#!/data/data/com.termux/files/usr/bin/bash
# AI Empire WhatsApp phone gateway — first run asks two things, then keeps itself running.
set -e
cd "$(dirname "$0")"
if [ ! -f .env ]; then
  echo "Your WhatsApp business number with country code (e.g. 919876543210):"; read -r PHONE
  echo "Gateway secret (same as WHATSAPP_WEBHOOK_SECRET in Vercel):"; read -r SECRET
  umask 077
  printf 'PHONE=%s\nSECRET=%s\nAPP_URL=https://ai-os-hq.vercel.app\n' "$PHONE" "$SECRET" > .env
fi
[ -d node_modules ] || npm install --omit=dev --no-audit --no-fund
command -v termux-wake-lock >/dev/null && termux-wake-lock   # keep running with the screen off
while true; do
  node index.mjs || true
  echo "gateway stopped — restarting in 10 s (Ctrl+C twice to quit)"; sleep 10
done
