# WhatsApp gateway (WAHA) for AI Empire OS on a free Hugging Face Docker Space — no card, no laptop.
# Secrets (Space → Settings → Variables and secrets → New secret), never in this file:
#   WAHA_API_KEY            = same value as WAHA_API_KEY in Vercel
#   WHATSAPP_HOOK_HMAC_KEY  = same value as WHATSAPP_WEBHOOK_SECRET in Vercel
FROM devlikeapro/waha:latest

# Hugging Face runs containers as user 1000: keep WhatsApp session files in a writable folder.
USER root
RUN mkdir -p /home/user/sessions && chown -R 1000:1000 /home/user /app || true
USER 1000

ENV WHATSAPP_API_PORT=7860 \
    WAHA_LOCAL_STORE_BASE_DIR=/home/user/sessions \
    WHATSAPP_HOOK_URL=https://ai-os-hq.vercel.app/api/whatsapp/waha \
    WHATSAPP_HOOK_EVENTS=message \
    WHATSAPP_DEFAULT_ENGINE=WEBJS \
    WHATSAPP_START_SESSION=default \
    WHATSAPP_RESTART_ALL_SESSIONS=True \
    WAHA_DASHBOARD_ENABLED=False \
    WHATSAPP_SWAGGER_ENABLED=False

EXPOSE 7860
