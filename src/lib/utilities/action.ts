import "server-only";
import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import { PermissionError } from "@/lib/permissions";
import { ValidationError } from "@/lib/validation/forms";
import { AiError, AiUnavailableError } from "@/lib/ai/types";

/** Errors whose message is safe to show the user. Anything else is logged and replaced. */
export class UserFacingError extends Error {}

function publicMessage(err: unknown): string {
  if (
    err instanceof UserFacingError || err instanceof ValidationError || err instanceof PermissionError ||
    err instanceof AiError || err instanceof AiUnavailableError
  ) return err.message;
  console.error("[action]", err);
  return "Something went wrong. The error has been logged.";
}

/** Runs a form action and redirects back with a flash message. Never leaks internal errors. */
export async function runAction(path: string, okMessage: string, fn: () => Promise<string | void>): Promise<never> {
  let message = okMessage;
  try {
    message = (await fn()) || okMessage;
  } catch (err) {
    unstable_rethrow(err);
    redirect(`${path}?error=${encodeURIComponent(publicMessage(err))}`);
  }
  revalidatePath(path);
  redirect(`${path}?ok=${encodeURIComponent(message)}`);
}

/** Unwraps a Supabase result, translating RLS/constraint failures into user-facing messages. */
export function must<T>(res: { data: T; error: { code?: string; message: string } | null }): NonNullable<T> {
  if (res.error) {
    const { code, message } = res.error;
    if (code === "42501") throw new UserFacingError("Permission denied by organisation policy");
    if (code === "23505") throw new UserFacingError("A record with that name already exists");
    if (code === "23503") throw new UserFacingError("Referenced record not found in your organisation");
    if (code === "23514") throw new UserFacingError(`Rule violated: ${message}`);
    if (code === "PGRST116") throw new UserFacingError("Record not found");
    throw new Error(`${code ?? "db"}: ${message}`);
  }
  if (res.data == null) throw new UserFacingError("Record not found");
  return res.data as NonNullable<T>;
}
