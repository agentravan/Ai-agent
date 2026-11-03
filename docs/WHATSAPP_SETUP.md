# WhatsApp Desk — setup (free, no Meta)

## Fastest path: one command on an Oracle Always Free server
1. Create the server (from a phone browser is fine): cloud.oracle.com → Compute → Instances → Create → Ubuntu, shape
   **VM.Standard.A1.Flex** (Always Free). Networking → your VCN → Security Lists → Default → **Add Ingress Rules**:
   source `0.0.0.0/0`, TCP, ports `80,443`.
2. Open **Cloud Shell** (top bar), `ssh ubuntu@PUBLIC_IP`, then run:
   ```bash
   curl -fsSLo setup.sh https://raw.githubusercontent.com/agentravan/Ai-agent/feat/ai-empire-os-foundation/scripts/whatsapp-gateway-setup.sh
   sudo WAHA_KEY='…' HOOK_SECRET='…' bash setup.sh
   ```
   It installs Docker, starts WAHA behind HTTPS (`https://<ip>.sslip.io`) and points WAHA's **signed** webhook at the app.
3. Vercel (Production): `WAHA_URL` (printed), `WAHA_API_KEY` (= WAHA_KEY), `WHATSAPP_WEBHOOK_SECRET` (= HOOK_SECRET),
   `WHATSAPP_AUTO_REPLY=safe`. Redeploy → WhatsApp Desk → scan the QR (WhatsApp → Linked devices).

## Automation (Founder's policy, 3 Nov 2026: `WHATSAPP_AUTO_REPLY=safe`)
- A client writes → WAHA calls `/api/whatsapp/waha` (HMAC-SHA512, rejected without a valid signature) → Iris drafts.
- **Simple answers** (timings, services, next step) are sent automatically.
- Anything about **price, payment, legal/tax, dates/promises**, photos/files, or more than 4 auto-replies in a chat within
  an hour → **Approval Center** with the client's message and Iris's reply; **Approve** sends it.
- "STOP" / "message mat karo" → blocked forever. Every message is handled once; every send is audited.
- `WHATSAPP_AUTO_REPLY=off` → every reply waits for approval.

The team chats with clients on **your own WhatsApp number**. A small free program, **WAHA**
(github.com/devlikeapro/waha), logs in to your number by QR — like WhatsApp Web — and AI Empire talks to it.

> ⚠️ This is WhatsApp Web, not Meta's official API. WhatsApp can restrict numbers that spam. Use it for real
> conversations; the desk caps new people per day (`WHATSAPP_DAILY_NEW_LIMIT`, default 10), honours "STOP"
> forever, and nothing is sent without the Founder pressing **Send**.

## 1. A computer that stays on (pick one)
- **Office PC / old laptop** that stays on and online, with Docker Desktop installed, or
- **Oracle Cloud "Always Free" VM** (Ubuntu, free forever; signup asks for a card only to verify).

Vercel cannot run WAHA: the WhatsApp connection has to stay open all the time.

**No laptop? Do it from a phone (Oracle, ~20 min, ₹0):**
1. Sign up at cloud.oracle.com (Always Free; card only to verify). Choose the region nearest you (e.g. Mumbai).
2. Menu → Compute → Instances → **Create instance** → image **Ubuntu**, shape **VM.Standard.A1.Flex** (Always Free, 1 OCPU / 6 GB) → Create. Copy its **public IP**.
3. Top bar → **Cloud Shell** (a terminal in the browser) → `ssh ubuntu@PUBLIC_IP` (Cloud Shell can use the key you downloaded/created in step 2).
4. On the VM: `curl -fsSL https://get.docker.com | sudo sh`, then the `docker run` command below (with `sudo`), then the Cloudflare quick tunnel
   from step 3 below (`sudo docker run -d --network host cloudflare/cloudflared tunnel --url http://localhost:3000`, read the https URL with `sudo docker logs`).

Until then, use **phone mode**: My Desk → WhatsApp reply assistant (paste the client's message → Iris replies → tap Send on WhatsApp).

## 2. Start WAHA (one command)
Pick a long random key first (e.g. from a password manager) — it protects your WhatsApp.

```bash
docker run -d --name waha --restart unless-stopped -p 3000:3000 \
  -e WAHA_API_KEY=PUT-A-LONG-RANDOM-KEY \
  -e WHATSAPP_DEFAULT_ENGINE=WEBJS \
  -v waha_sessions:/app/.sessions \
  devlikeapro/waha
```
`-v waha_sessions…` keeps you logged in after a restart. Only one number ("default" session) is needed.

## 3. Give it a safe public HTTPS address
AI Empire (on Vercel) must reach the gateway over HTTPS:
- **Office PC:** Cloudflare Tunnel (free): `cloudflared tunnel --url http://localhost:3000` gives an `https://…trycloudflare.com`
  address; for a permanent address create a named tunnel in a free Cloudflare account.
- **Oracle VM:** put Caddy in front (`caddy reverse-proxy --from your-domain --to localhost:3000`), or use a Cloudflare Tunnel too.

Never expose WAHA without `WAHA_API_KEY` — anyone with the URL could read and send your messages.

## 4. Connect AI Empire
Vercel → ai-empire-os → Settings → Environment Variables (Production), type **Sensitive** for the key:
- `WAHA_URL` = the https address from step 3
- `WAHA_API_KEY` = the same key as step 2
- optional `WHATSAPP_DAILY_NEW_LIMIT` = 10

Redeploy, open **WhatsApp Desk** in the app, and scan the QR: WhatsApp Business → ⋮ → **Linked devices** → **Link a device**.

## How the team uses it
- Clients' chats appear in the desk (refreshes every 15 s while open).
- **Draft with Iris** writes a reply in the client's language from your playbooks and lead notes — it never invents prices or dates.
- You read, edit, press **Send on WhatsApp**. Price/payment/legal/date mentions are highlighted to check first.
- "STOP", "unsubscribe", "message mat karo" → that number is blocked for good (also marks the lead lost).
- AI Empire stores only opt-outs, first-contact dates and an audit of sent texts — your chats stay in WhatsApp and your gateway.
