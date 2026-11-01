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
  AI_COST_INPUT_CENTS_PER_MTOK: z.coerce.number().min(0).catch(0),
  AI_COST_OUTPUT_CENTS_PER_MTOK: z.coerce.number().min(0).catch(0),
  AI_TIMEOUT_MS: intIn(1_000, 280_000, 60_000),
  AI_MAX_ATTEMPTS: intIn(1, 5, 3),
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
