import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 px-4 text-center">
      <h1 className="text-xl font-semibold text-white">Page not found</h1>
      <Link href="/dashboard" className="btn-ghost">Back to dashboard</Link>
    </main>
  );
}
