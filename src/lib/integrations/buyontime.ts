import "server-only";
import { env } from "@/lib/env";

export interface BuyontimeOrderToFulfil {
  orderNumber: string; placedAt: string; status: string; paymentMethod: string; totalPaise: number; shipTo: string;
  items: { name: string; variant: string | null; quantity: number; supplier: string | null; supplierLink: string | null }[];
}
export interface BuyontimeSummary {
  window: { since: string; until: string };
  orders: number; cancelled: number; revenuePaise: number; estimatedProfitPaise: number;
  onlineOrders: number; codOrders: number; newCustomers: number; repeatCustomers: number;
  voucherOrders: number; voucherConversionPct: number; toFulfil: BuyontimeOrderToFulfil[];
}
export interface DraftProductInput {
  name: string; description: string; supplierLink: string; costPrice: number; shippingCost?: number; otherCost?: number;
  gstRate?: number; mrp?: number; targetProfit?: number; category?: string; variants?: string[]; imageUrls?: string[]; dryRun?: boolean;
}
export interface DraftProductResult { status: "priced" | "created" | "skipped"; productId?: string; sku?: string; message?: string; pricePaise: number; mrpPaise: number; unitProfitPaise: number }

export const buyontimeConfigured = () => !!(env.BUYONTIME_URL && env.BUYONTIME_API_TOKEN);

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!buyontimeConfigured()) throw new Error("Buyontime is not connected (BUYONTIME_URL / BUYONTIME_API_TOKEN).");
  const res = await fetch(`${env.BUYONTIME_URL!.replace(/\/$/, "")}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${env.BUYONTIME_API_TOKEN}`, "content-type": "application/json", ...init.headers },
    signal: AbortSignal.timeout(45_000),
    cache: "no-store",
  });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (res.status === 404) throw new Error("Buyontime does not have the AI Empire link yet (update pending approval).");
  if (!res.ok) throw new Error(`Buyontime: ${body.error ?? res.status}`);
  return body;
}

export const buyontimeSummary = (hours = 24) => call<BuyontimeSummary>(`/api/empire/summary?hours=${Math.round(hours)}`);
export const buyontimeDraftProduct = (input: DraftProductInput) => call<DraftProductResult>("/api/empire/products", { method: "POST", body: JSON.stringify(input) });
