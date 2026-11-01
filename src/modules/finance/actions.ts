"use server";

import { budgetSchema, financialRecordSchema, parseForm } from "@/lib/validation/forms";
import { must, runAction } from "@/lib/utilities/action";
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
