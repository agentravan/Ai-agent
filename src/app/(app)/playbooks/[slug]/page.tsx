import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, PageHeader } from "@/components/ui";
import { requireContext } from "@/modules/auth/session";
import { PLAYBOOKS, playbookBySlug } from "@/modules/knowledge/catalog";
import { DOMAIN_LABEL, KIND_LABEL } from "@/modules/knowledge/logic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const p = playbookBySlug((await params).slug);
  return { title: p ? p.title : "Playbook" };
}

export default async function PlaybookPage({ params }: { params: Promise<{ slug: string }> }) {
  await requireContext();
  const book = playbookBySlug((await params).slug);
  if (!book) notFound();

  return (
    <>
      <PageHeader eyebrow={`${KIND_LABEL[book.kind]} · ${DOMAIN_LABEL[book.domain] ?? book.domain}`} title={book.title}
        subtitle={book.description || undefined}
        action={<Link href="/playbooks" className="btn-ghost">All playbooks</Link>} />
      {book.whenToUse && <p className="mb-4 text-sm text-zinc-400"><Badge>When to use</Badge> <span className="ml-1">{book.whenToUse}</span></p>}
      <div className="space-y-4">
        {book.sections.map((s, i) => (
          <Card key={i} title={s.heading}>
            {/* Plain text on purpose: imported knowledge is never rendered as HTML. */}
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-300">{s.text.replace(/\*\*(.+?)\*\*/g, "$1")}</p>
          </Card>
        ))}
      </div>
      <p className="mt-6 text-xs text-zinc-500">
        General executive know-how, mostly written for US companies — adapt it to India and to your stage; its numbers are examples, not your data.
        Source: <a href={PLAYBOOKS.source} className="underline hover:text-zinc-300" target="_blank" rel="noreferrer">Open Executive</a>, {PLAYBOOKS.license}.
      </p>
    </>
  );
}
