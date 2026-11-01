"use server";

import { budgetSchema, financialRecordSchema, idSchema, invoiceSchema, parseForm } from "@/lib/validation/forms";
import { must, runAction, UserFacingError } from "@/lib/utilities/action";
import { requireContext } from "@/modules/auth/session";
import { logEvent } from "@/modules/audit/service";

export async function recordTransactionAction(form: FormData) {
  await runAction("/finance", "Transaction recorded", async () => {
    // Recording money movements is a governance action (founder/admin), audited by DB triggers.
    const ctx = await requireContext("govern");
    const record = parseForm(financialRecordSchema, form);
    must(await ctx.db.from("financial_records").insert({ ...record, organisation_id: ctx.organisation.id }).select("id").single());
    return `${record.kind === "income" ? "Inbound payment" : "Expense"} recorded`;
  });
}

export async function createBudgetAction(form: FormData) {
  await runAction("/finance", "Budget created", async () => {
    const ctx = await requireContext("govern");
    const budget = parseForm(budgetSchema, form);
    const { id } = must(await ctx.db.from("budgets").insert({ ...budget, organisation_id: ctx.organisation.id }).select("id").single<{ id: string }>());
    await logEvent(ctx, { action: "budget.created", entity: "budgets", entityId: id, metadata: { amount_cents: budget.amount_cents } });
  });
}

export async function createInvoiceAction(form: FormData) {
  await runAction("/finance", "Invoice recorded", async () => {
    const ctx = await requireContext("govern");
    const inv = parseForm(invoiceSchema, form);
    must(await ctx.db.from("invoices").insert({ ...inv, organisation_id: ctx.organisation.id }).select("id").single());
  });
}

/** Marks an invoice paid exactly once and books the matching inbound payment. */
export async function markInvoicePaidAction(form: FormData) {
  await runAction("/finance", "Payment received", async () => {
    const ctx = await requireContext("govern");
    const { id } = parseForm(idSchema, form);
    const today = new Date().toISOString().slice(0, 10);
    const { data } = await ctx.db.from("invoices").update({ status: "paid", paid_on: today }).eq("id", id).eq("status", "sent")
      .select("id, number, client_name, amount_cents, business_unit_id").returns<{ id: string; number: string; client_name: string; amount_cents: number; business_unit_id: string | null }[]>();
    const inv = data?.[0];
    if (!inv) throw new UserFacingError("Invoice not found or not awaiting payment");
    const rec = must(await ctx.db.from("financial_records").insert({
      organisation_id: ctx.organisation.id, kind: "income", amount_cents: inv.amount_cents, occurred_on: today,
      business_unit_id: inv.business_unit_id, description: `Invoice ${inv.number} — ${inv.client_name}`,
    }).select("id").single<{ id: string }>());
    await ctx.db.from("invoices").update({ financial_record_id: rec.id }).eq("id", inv.id);
    return `Invoice ${inv.number} paid — inbound payment recorded`;
  });
}
