import { NextResponse } from "next/server";
import { readRuntimeCache, writeRuntimeCache } from "@/lib/cacheStore";
import { BUNDLE, enrichSoldoutRow, getReps, type MarkInfo } from "@/lib/enrich";
import { OFFLINE_MARKS } from "@/lib/offlineMarks";
import { sandboxFetch } from "@/lib/sandbox";
import { computeMerchantTextHash, type TextSnippet } from "@/lib/textHash";

export const dynamic = "force-dynamic";

async function fetchMerchantLiveText(merchantId: string): Promise<{
  notes: Array<Record<string, unknown>>;
  replies: Array<Record<string, unknown>>;
  reviews: Array<Record<string, unknown>>;
  refunds: Array<Record<string, unknown>>;
  snippets: TextSnippet[];
  text_hash: string;
} | null> {
  try {
    const [nRes, rRes, rvRes, rfRes] = await Promise.all([
      sandboxFetch(`/notes?merchant_id=${encodeURIComponent(merchantId)}&limit=5`),
      sandboxFetch(`/alert-replies?merchant_id=${encodeURIComponent(merchantId)}&limit=5`),
      sandboxFetch(`/reviews?merchant_id=${encodeURIComponent(merchantId)}&limit=5`),
      sandboxFetch(`/refunds?merchant_id=${encodeURIComponent(merchantId)}&limit=5`),
    ]);
    const notes: Array<Record<string, unknown>> = nRes.ok ? ((await nRes.json()).data ?? []) : [];
    const replies: Array<Record<string, unknown>> = rRes.ok ? ((await rRes.json()).data ?? []) : [];
    const reviews: Array<Record<string, unknown>> = rvRes.ok ? ((await rvRes.json()).data ?? []) : [];
    const refunds: Array<Record<string, unknown>> = rfRes.ok ? ((await rfRes.json()).data ?? []) : [];

    const snippets: TextSnippet[] = [
      ...notes.map((n) => ({ source_type: "rep_note", id: String(n.note_id ?? ""), date: String(n.created_at ?? ""), text: String(n.text ?? "") })),
      ...replies.map((r) => ({ source_type: "deal_alert_reply", id: String(r.reply_id ?? ""), date: String(r.received_at ?? ""), text: String(r.text ?? "") })),
      ...reviews.map((rv) => ({ source_type: "review", id: String(rv.review_id ?? ""), date: String(rv.created_at ?? ""), text: String(rv.text ?? "") })),
      ...refunds.map((rf) => ({ source_type: "refund", id: String(rf.refund_id ?? ""), date: String(rf.created_at ?? ""), text: String(rf.reason_text ?? "") })),
    ];
    return {
      notes,
      replies,
      reviews,
      refunds,
      snippets,
      text_hash: computeMerchantTextHash(snippets),
    };
  } catch {
    return null;
  }
}

export async function GET() {
  const cache = readRuntimeCache();
  let sourceMode: "live_sandbox" | "offline_cached" | "offline_fallback" = "live_sandbox";
  let rawSoldouts: Array<Record<string, unknown>> = [];
  const marksByMerchant = new Map<string, MarkInfo>();
  let routingSwitch: { suppress_soldout_tasks?: boolean; updated_by?: string } | null = null;
  const liveHashes = new Map<string, string>();

  try {
    const [soldoutsRes, marksRes, switchRes] = await Promise.all([
      sandboxFetch("/soldouts/today?limit=200"),
      sandboxFetch("/marks?limit=500"),
      sandboxFetch("/routing/switch"),
    ]);

    if (!soldoutsRes.ok) {
      throw new Error(`Sandbox /soldouts/today returned ${soldoutsRes.status}`);
    }
    const soldoutsJson = await soldoutsRes.json();
    rawSoldouts = Array.isArray(soldoutsJson.data) ? soldoutsJson.data : [];

    const marksSnapshot: Record<string, MarkInfo> = {};
    if (marksRes.ok) {
      const marksJson = await marksRes.json();
      for (const m of marksJson.data ?? []) {
        if (m.merchant_id) {
          const info: MarkInfo = {
            mark: m.mark,
            reason: m.reason,
            marked_by: m.marked_by,
            updated_at: m.updated_at,
          };
          marksByMerchant.set(m.merchant_id, info);
          marksSnapshot[m.merchant_id] = info;
        }
      }
    }

    if (switchRes.ok) {
      routingSwitch = await switchRes.json();
    }

    // Check live text hashes for today's unique merchants (batched by 3 to stay under 10 req/s)
    const uniqueMids = Array.from(new Set(rawSoldouts.map((r) => String(r.merchant_id ?? "")).filter(Boolean)));
    for (let i = 0; i < uniqueMids.length; i += 2) {
      const batch = uniqueMids.slice(i, i + 2);
      const results = await Promise.all(batch.map((mid) => fetchMerchantLiveText(mid)));
      batch.forEach((mid, idx) => {
        const res = results[idx];
        if (res) {
          liveHashes.set(mid, res.text_hash);
          const existingHist = cache.history_overrides[mid];
          cache.history_overrides[mid] = {
            notes: res.notes,
            replies: res.replies,
            reviews: res.reviews,
            refunds: res.refunds,
            schedules: existingHist?.schedules ?? BUNDLE.history?.[mid]?.schedules ?? [],
            text_hash: res.text_hash,
          };
        }
      });
    }

    cache.last_synced_at = new Date().toISOString();
    cache.soldouts_snapshot = rawSoldouts;
    cache.marks_snapshot = marksSnapshot;
    writeRuntimeCache(cache);
  } catch {
    if (cache.soldouts_snapshot && cache.soldouts_snapshot.length > 0) {
      sourceMode = "offline_cached";
      rawSoldouts = cache.soldouts_snapshot;
      for (const [mid, m] of Object.entries(cache.marks_snapshot)) {
        marksByMerchant.set(mid, m);
      }
      for (const [mid, h] of Object.entries(cache.history_overrides)) {
        liveHashes.set(mid, h.text_hash);
      }
    } else {
      sourceMode = "offline_fallback";
      rawSoldouts = BUNDLE.fallback_soldouts;
    }
    for (const [mid, m] of OFFLINE_MARKS.entries()) {
      marksByMerchant.set(mid, m);
    }
  }

  const items = rawSoldouts.map((row) => {
    const mid = String(row.merchant_id ?? "");
    return enrichSoldoutRow(
      row,
      marksByMerchant,
      cache.signals_overrides[mid],
      liveHashes.get(mid)
    );
  });

  const priorityRank: Record<string, number> = {
    PAUSE_SCHEDULE: 1,
    CALL_CALLBACK: 2,
    ASSIST_DEAL_OR_LINK: 3,
    CALL: 4,
    HOLD_CAP_RISK: 5,
    DONT_BOTHER: 6,
  };
  items.sort((a, b) => {
    const pa = priorityRank[a.valuation.action] ?? 9;
    const pb = priorityRank[b.valuation.action] ?? 9;
    if (pa !== pb) return pa - pb;
    return b.valuation.net_ev_gbp - a.valuation.net_ev_gbp;
  });

  const pendingMerchantCount = new Set(items.filter((i) => i.pending_ai).map((i) => i.merchant_id)).size;

  return NextResponse.json({
    mode: sourceMode,
    routing_switch: routingSwitch,
    reps: getReps(),
    items,
    cache_status: {
      last_synced_at: cache.last_synced_at,
      last_llm_run_at: cache.last_llm_run_at,
      last_llm_cost_usd: cache.last_llm_cost_usd,
      last_llm_processed: cache.last_llm_processed,
      pending_ai_count: pendingMerchantCount,
    },
  });
}
