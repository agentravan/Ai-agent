"use client";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 px-4 text-center">
      <h1 className="text-xl font-semibold text-white">Something went wrong</h1>
      <p className="max-w-md text-sm text-slate-400">{error.message.startsWith("Permission denied") ? error.message : `Reference: ${error.digest ?? "n/a"}`}</p>
      <button onClick={reset} className="btn-ghost">Try again</button>
    </main>
  );
}
