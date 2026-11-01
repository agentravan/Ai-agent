export type ProviderId = "ollama" | "anthropic" | "openai-compatible";

export interface GenerateRequest {
  system: string;
  prompt: string;
  maxTokens?: number;
  json?: boolean;
  signal?: AbortSignal;
}

export interface GenerateResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

export interface ProviderHealth {
  ok: boolean;
  detail: string;
}

export interface AiProvider {
  id: ProviderId;
  label: string;
  model: string;
  generate(req: GenerateRequest): Promise<GenerateResult>;
  health(signal?: AbortSignal): Promise<ProviderHealth>;
}

/** Provider error with retry semantics. */
export class AiError extends Error {
  constructor(message: string, readonly retryable: boolean, readonly status?: number) {
    super(message);
    this.name = "AiError";
  }
}

export class AiUnavailableError extends Error {
  constructor() {
    super("No AI provider is configured. Set OLLAMA_BASE_URL, ANTHROPIC_API_KEY or OPENAI_COMPATIBLE_BASE_URL.");
    this.name = "AiUnavailableError";
  }
}
