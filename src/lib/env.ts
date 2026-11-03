import { z } from "zod";

/** Server/runtime configuration. Every integration is optional so the app degrades gracefully. */
const optional = z.string().trim().optional().transform((v) => (v ? v : undefined));
const intIn = (min: number, max: number, fallback: number) =>
  z.coerce.number().int().min(min).max(max).catch(fallback);

const schema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url().optional().catch(undefined),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: optional,
  FOUNDER_EMAILS: optional,
  AI_PROVIDER: z.enum(["ollama", "anthropic", "openai-compatible"]).optional().catch(undefined),
  OLLAMA_BASE_URL: z.url().optional().catch(undefined),
  OLLAMA_MODEL: z.string().default("llama3.2"),
  ANTHROPIC_API_KEY: optional,
  ANTHROPIC_MODEL: z.string().default("claude-haiku-5-5"),
  OPENAI_COMPATIBLE_BASE_URL: z.url().optional().catch(undefined),
  OPENAI_COMPATIBLE_API_KEY: optional,
  OPENAI_COMPATIBLE_MODEL: optional,
  // Comma-separated backup models on the same endpoint, tried in order when the main model fails or times out (max 3).
  OPENAI_COMPATIBLE_FALLBACK_MODELS: optional,
  // Backup AI services on other OpenAI-compatible endpoints (e.g. NVIDIA, OpenRouter), tried after the main one.
  AI_BACKUP_1_BASE_URL: z.url().optional().catch(undefined),
  AI_BACKUP_1_API_KEY: optional,
  AI_BACKUP_1_MODEL: optional,
  AI_BACKUP_2_BASE_URL: z.url().optional().catch(undefined),
  AI_BACKUP_2_API_KEY: optional,
  AI_BACKUP_2_MODEL: optional,
  AI_COST_INPUT_CENTS_PER_MTOK: z.coerce.number().min(0).catch(0),
  AI_COST_OUTPUT_CENTS_PER_MTOK: z.coerce.number().min(0).catch(0),
  AI_TIMEOUT_MS: intIn(1_000, 280_000, 60_000),
  AI_MAX_ATTEMPTS: intIn(1, 5, 3),
  // Total time one agent run may use across retries and backup models (stays under the 300 s function limit).
  AI_RUN_BUDGET_MS: intIn(30_000, 290_000, 240_000),
  // When the main AI provider fails: "free" tries other configured non-Anthropic providers (default, keeps ₹0),
  // "all" may also fall back to Anthropic (paid), "off" never falls back.
  AI_FALLBACK: z.enum(["free", "all", "off"]).catch("free"),
  // Your own mailbox (e.g. Gmail with an App Password). The AI employee sends and reads mail as you.
  SMTP_HOST: z.string().trim().default("smtp.gmail.com"),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).catch(465),
  IMAP_HOST: z.string().trim().default("imap.gmail.com"),
  IMAP_PORT: z.coerce.number().int().min(1).max(65535).catch(993),
  MAIL_USER: z.email().optional().catch(undefined),
  MAIL_PASSWORD: optional,
  MAIL_FROM_NAME: z.string().trim().max(80).default("AI Empire"),
  // Required by US CAN-SPAM for commercial email: a physical postal address in every pitch.
  BUSINESS_ADDRESS: optional,
  // Protects your mailbox reputation: max outreach emails per day.
  OUTREACH_DAILY_LIMIT: intIn(1, 200, 20),
  REPORT_EMAIL: z.email().optional().catch(undefined),
  // Scheduled jobs (Vercel Cron). Server-only secrets; never exposed to the browser.
  CRON_SECRET: optional,
  SUPABASE_SERVICE_ROLE_KEY: optional,
  // Buyontime store link (read-only summary + draft products), shared secret with EMPIRE_API_TOKEN there.
  BUYONTIME_URL: z.url().optional().catch(undefined),
  BUYONTIME_API_TOKEN: optional,
  // Lead discovery (OpenStreetMap — free public data).
  OVERPASS_URL: z.url().default("https://overpass-api.de/api/interpreter"),
  NOMINATIM_URL: z.url().default("https://nominatim.openstreetmap.org"),
  // Optional Google Places API (New) key: better leads (phone numbers) and the local rank tracker.
  // Server-only. Without it, leads come from OpenStreetMap and rank tracking shows as unavailable.
  GOOGLE_PLACES_API_KEY: optional,
  // Max Google Places result pages (20 each) per lead search. Phone/website fields are billed per request.
  GOOGLE_PLACES_MAX_PAGES: intIn(1, 3, 2),
  // WhatsApp Desk via a self-hosted WAHA gateway (WhatsApp Web, QR login; no Meta setup). Server-only.
  // WAHA_URL must be HTTPS (or a private http URL you trust); WAHA_API_KEY is sent as X-Api-Key.
  WAHA_URL: z.url().optional().catch(undefined),
  WAHA_API_KEY: optional,
  WAHA_SESSION: z.string().trim().regex(/^[a-zA-Z0-9_-]{1,40}$/).catch("default"),
  // Max NEW people the team may message first per day (protects the number from being flagged).
  WHATSAPP_DAILY_NEW_LIMIT: intIn(1, 30, 10),
});

export type Env = z.infer<typeof schema>;

export function readEnv(source: Record<string, string | undefined> = process.env): Env {
  return schema.parse({
    ...source,
    // Inlined at build time for the browser bundle; read explicitly so Next can substitute them.
    NEXT_PUBLIC_SUPABASE_URL: source.NEXT_PUBLIC_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: source.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });
}

export const env = readEnv();

export function supabaseConfig(e: Env = env) {
  return e.NEXT_PUBLIC_SUPABASE_URL && e.NEXT_PUBLIC_SUPABASE_ANON_KEY
    ? { url: e.NEXT_PUBLIC_SUPABASE_URL, key: e.NEXT_PUBLIC_SUPABASE_ANON_KEY }
    : null;
}

export function founderAllowlist(e: Env = env): Set<string> | null {
  const list = e.FOUNDER_EMAILS?.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean) ?? [];
  return list.length ? new Set(list) : null;
}

export function isEmailAllowed(email: string | undefined, e: Env = env): boolean {
  const allow = founderAllowlist(e);
  return !allow || (!!email && allow.has(email.toLowerCase()));
}
