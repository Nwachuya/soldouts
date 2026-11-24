import { NextResponse } from "next/server";
import { BUNDLE, enrichSoldoutRow, getReps, type MarkInfo } from "@/lib/enrich";
import { OFFLINE_MARKS } from "@/lib/offlineMarks";
import { sandboxFetch } from "@/lib/sandbox";

export const dynamic = "force-dynamic";

export async function GET() {
  let sourceMode: "live_sandbox" | "offline_fallback" = "live_sandbox";
  let rawSoldouts: Array<Record<string, unknown>> = [];
  const marksByMerchant = new Map<string, MarkInfo>();
  let routingSwitch: { suppress_soldout_tasks?: boolean; updated_by?: string } | null = null;

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

    if (marksRes.ok) {
      const marksJson = await marksRes.json();
      for (const m of marksJson.data ?? []) {
        if (m.merchant_id) {
          marksByMerchant.set(m.merchant_id, {
            mark: m.mark,
            reason: m.reason,
            marked_by: m.marked_by,
            updated_at: m.updated_at,
          });
        }
      }
    }

    if (switchRes.ok) {
      routingSwitch = await switchRes.json();
    }
  } catch {
    sourceMode = "offline_fallback";
    rawSoldouts = BUNDLE.fallback_soldouts;
    for (const [mid, m] of OFFLINE_MARKS.entries()) {
      marksByMerchant.set(mid, m);
    }
  }

  const items = rawSoldouts.map((row) => enrichSoldoutRow(row, marksByMerchant));

  // Sort: urgent operational actions & callbacks first, then positive net EV descending, then skips.
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

  return NextResponse.json({
    mode: sourceMode,
    routing_switch: routingSwitch,
    reps: getReps(),
    items,
  });
}
