"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createDb } from "@/lib/database/server";
import { isEmailAllowed } from "@/lib/env";
import { credentialsSchema, parseForm, ValidationError } from "@/lib/validation/forms";
import { unstable_rethrow } from "next/navigation";

function fail(message: string): never {
  redirect(`/login?error=${encodeURIComponent(message)}`);
}

async function credentials(form: FormData) {
  try {
    return parseForm(credentialsSchema, form);
  } catch (err) {
    unstable_rethrow(err);
    fail(err instanceof ValidationError ? err.message : "Invalid input");
  }
}

export async function signInAction(form: FormData): Promise<void> {
  const { email, password, next } = await credentials(form);
  const db = await createDb();
  if (!db) fail("Authentication is not configured yet");
  if (!isEmailAllowed(email)) fail("This email is not authorised for this workspace");
  const { error } = await db.auth.signInWithPassword({ email, password });
  // Generic message: never reveal whether the account exists.
  if (error) fail("Invalid email or password");
  redirect(next ?? "/dashboard");
}

export async function signUpAction(form: FormData): Promise<void> {
  const { email, password } = await credentials(form);
  const db = await createDb();
  if (!db) fail("Authentication is not configured yet");
  if (!isEmailAllowed(email)) fail("This email is not authorised for this workspace");
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("x-forwarded-host") ?? h.get("host")}`;
  const { data, error } = await db.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: `${origin}/auth/callback` },
  });
  if (error) fail(error.message);
  if (data.session) redirect("/dashboard");
  redirect(`/login?ok=${encodeURIComponent("Check your email to confirm your account, then sign in.")}`);
}

export async function signOutAction(): Promise<void> {
  const db = await createDb();
  await db?.auth.signOut();
  redirect("/login");
}
