import { NextResponse } from "next/server";
import { BUNDLE, getMerchantMeta, getMerchantSignal } from "@/lib/enrich";
import { OFFLINE_MARKS } from "@/lib/offlineMarks";
import { sandboxFetch } from "@/lib/sandbox";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const meta = getMerchantMeta(id);
  const signal = getMerchantSignal(id);

  let mode: "live_sandbox" | "offline_fallback" = "live_sandbox";
  let merchant: Record<string, unknown> | null = meta ? { merchant_id: id, ...meta } : null;
  let notes: Array<Record<string, unknown>> = [];
  let replies: Array<Record<string, unknown>> = [];
  let reviews: Array<Record<string, unknown>> = [];
  let refunds: Array<Record<string, unknown>> = [];
  let schedules: Array<Record<string, unknown>> = [];

  try {
    const [mRes, nRes, rRes, rvRes, rfRes, sRes] = await Promise.all([
      sandboxFetch(`/merchants/${encodeURIComponent(id)}`),
      sandboxFetch(`/notes?merchant_id=${encodeURIComponent(id)}&limit=10`),
      sandboxFetch(`/alert-replies?merchant_id=${encodeURIComponent(id)}&limit=10`),
      sandboxFetch(`/reviews?merchant_id=${encodeURIComponent(id)}&limit=10`),
      sandboxFetch(`/refunds?merchant_id=${encodeURIComponent(id)}&limit=10`),
      sandboxFetch(`/automation/schedules?merchant_id=${encodeURIComponent(id)}&limit=10`),
    ]);
    if (mRes.ok) {
      merchant = await mRes.json();
    }
    if (nRes.ok) notes = (await nRes.json()).data ?? [];
    if (rRes.ok) replies = (await rRes.json()).data ?? [];
    if (rvRes.ok) reviews = (await rvRes.json()).data ?? [];
    if (rfRes.ok) refunds = (await rfRes.json()).data ?? [];
    if (sRes.ok) schedules = (await sRes.json()).data ?? [];
  } catch {
    mode = "offline_fallback";
    const hist = BUNDLE.history?.[id];
    if (hist) {
      notes = hist.notes;
      replies = hist.replies;
      reviews = hist.reviews;
      refunds = hist.refunds;
      schedules = hist.schedules;
    }
    if (merchant) {
      merchant = { ...merchant, mark: OFFLINE_MARKS.get(id) ?? null };
    }
  }

  return NextResponse.json({
    mode,
    merchant,
    meta,
    signal,
    notes,
    replies,
    reviews,
    refunds,
    schedules,
  });
}
