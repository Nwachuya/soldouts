"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  PauseCircle,
  PhoneCall,
  Quote,
  RefreshCw,
  ShieldAlert,
  SkipForward,
  Wrench,
} from "lucide-react";
import type { EnrichedSoldout, MarkInfo, RepInfo } from "@/lib/enrich";
import { evaluateSoldout } from "@/lib/valuation";
import { MarkDrawer } from "@/components/MarkDrawer";

type TabKey = "action" | "skip" | "risk" | "all";

const ACTION_BADGE_STYLES: Record<string, string> = {
  CALL: "bg-emerald-50 text-emerald-800 border-emerald-200",
  CALL_CALLBACK: "bg-sky-50 text-sky-800 border-sky-200",
  ASSIST_DEAL_OR_LINK: "bg-amber-50 text-amber-800 border-amber-200",
  PAUSE_SCHEDULE: "bg-orange-50 text-orange-800 border-orange-200",
  HOLD_CAP_RISK: "bg-rose-50 text-rose-800 border-rose-200",
  DONT_BOTHER: "bg-zinc-100 text-zinc-700 border-zinc-200",
};

function ActionIcon({ action }: { action: string }) {
  switch (action) {
    case "CALL":
    case "CALL_CALLBACK":
      return <PhoneCall className="w-4 h-4 shrink-0" />;
    case "ASSIST_DEAL_OR_LINK":
      return <Wrench className="w-4 h-4 shrink-0" />;
    case "PAUSE_SCHEDULE":
      return <PauseCircle className="w-4 h-4 shrink-0" />;
    case "HOLD_CAP_RISK":
      return <ShieldAlert className="w-4 h-4 shrink-0" />;
    default:
      return <SkipForward className="w-4 h-4 shrink-0" />;
  }
}

export default function HomePage() {
  const [items, setItems] = useState<EnrichedSoldout[]>([]);
  const [reps, setReps] = useState<RepInfo[]>([]);
  const [mode, setMode] = useState<string>("loading");
  const [switchState, setSwitchState] = useState<boolean | null>(null);
  const [selectedRep, setSelectedRep] = useState<string>("ALL");
  const [tab, setTab] = useState<TabKey>("action");
  const [expandedMath, setExpandedMath] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);

  async function loadData() {
    setLoading(true);
    try {
      const res = await fetch("/api/soldouts/today", { cache: "no-store" });
      const data = await res.json();
      setItems(data.items ?? []);
      setReps(data.reps ?? []);
      setMode(data.mode ?? "offline_fallback");
      setSwitchState(
        typeof data.routing_switch?.suppress_soldout_tasks === "boolean"
          ? data.routing_switch.suppress_soldout_tasks
          : null
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  function handleMarkUpdated(merchantId: string, newMark: MarkInfo | null) {
    setItems((prev) =>
      prev.map((item) => {
        if (item.merchant_id !== merchantId) return item;
        const valuation = evaluateSoldout({
          size_band: item.size_band,
          value_30d_gbp: item.value_30d_gbp,
          signal: item.signal.signal,
          capacity_risk: item.signal.capacity_risk,
          refund_ratio: item.refund_ratio,
          has_active_schedule: item.has_active_schedule,
          do_not_contact: item.do_not_contact,
          callback_promised: item.callback_promised,
          rep_mark: newMark?.mark ?? null,
        });
        return { ...item, mark: newMark, valuation };
      })
    );
  }

  const repFiltered = useMemo(() => {
    if (selectedRep === "ALL") return items;
    return items.filter((i) => i.rep_id === selectedRep);
  }, [items, selectedRep]);

  const counts = useMemo(() => {
    const action = repFiltered.filter((i) =>
      ["CALL", "CALL_CALLBACK", "ASSIST_DEAL_OR_LINK", "PAUSE_SCHEDULE"].includes(i.valuation.action)
    );
    const skip = repFiltered.filter((i) => i.valuation.action === "DONT_BOTHER");
    const risk = repFiltered.filter((i) => i.valuation.action === "HOLD_CAP_RISK");
    const totalNetEv = action.reduce((acc, i) => acc + Math.max(0, i.valuation.net_ev_gbp), 0);
    return {
      actionCount: action.length,
      skipCount: skip.length,
      riskCount: risk.length,
      allCount: repFiltered.length,
      totalNetEv,
    };
  }, [repFiltered]);

  const visibleItems = useMemo(() => {
    if (tab === "action") {
      return repFiltered.filter((i) =>
        ["CALL", "CALL_CALLBACK", "ASSIST_DEAL_OR_LINK", "PAUSE_SCHEDULE"].includes(i.valuation.action)
      );
    }
    if (tab === "skip") return repFiltered.filter((i) => i.valuation.action === "DONT_BOTHER");
    if (tab === "risk") return repFiltered.filter((i) => i.valuation.action === "HOLD_CAP_RISK");
    return repFiltered;
  }, [repFiltered, tab]);

  const availableRepIds = useMemo(() => new Set(items.map((i) => i.rep_id)), [items]);

  return (
    <div className="space-y-5">
      {/* Top Status & Controls */}
      <section className="bg-white border border-zinc-200 rounded-2xl p-4 sm:p-5 shadow-xs space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-eyebrow">Morning Restock Triage</p>
            <h1>Today&apos;s Sold-Outs</h1>
            <p className="text-caption mt-1">
              {mode === "live_sandbox" ? "Live Sandbox API" : "Offline Snapshot"}
              {switchState !== null && ` · Routing suppression switch: ${switchState ? "ON" : "OFF"}`}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
            <div className="relative flex-1 sm:flex-initial min-w-0">
              <select
                aria-label="Filter by rep"
                value={selectedRep}
                onChange={(e) => setSelectedRep(e.target.value)}
                className="appearance-none w-full rounded-lg border border-zinc-300 bg-white pl-3 pr-9 py-2.5 text-zinc-900"
              >
                <option value="ALL">All reps ({items.length})</option>
                {reps
                  .filter((r) => availableRepIds.size === 0 || availableRepIds.has(r.rep_id))
                  .map((r) => (
                    <option key={r.rep_id} value={r.rep_id}>
                      {r.rep_name} ({r.rep_id})
                    </option>
                  ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
            </div>

            <button
              type="button"
              onClick={loadData}
              disabled={loading}
              className="coss-btn coss-btn-secondary"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
              <span>Refresh</span>
            </button>
          </div>
        </div>

        {/* Summary KPI Strip */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3.5">
            <p className="text-eyebrow">Worth Acting On</p>
            <p className="font-bold text-zinc-900 mt-1">{counts.actionCount} deals</p>
          </div>
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3.5">
            <p className="text-eyebrow">Net £ EV on Table</p>
            <p className="font-bold text-emerald-900 mt-1">+£{counts.totalNetEv.toFixed(2)}</p>
          </div>
          <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3.5">
            <p className="text-eyebrow">Tasks Filtered Out</p>
            <p className="font-bold text-zinc-900 mt-1">
              {counts.skipCount + counts.riskCount} skipped / held
            </p>
          </div>
        </div>

        {/* Filter Tabs */}
        <div className="flex flex-wrap gap-2">
          {(
            [
              ["action", `Action (${counts.actionCount})`],
              ["risk", `Hold Cap (${counts.riskCount})`],
              ["skip", `Don't Bother (${counts.skipCount})`],
              ["all", `All (${counts.allCount})`],
            ] as Array<[TabKey, string]>
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`coss-btn ${tab === key ? "coss-btn-primary" : "coss-btn-secondary"}`}
            >
              <span>{label}</span>
            </button>
          ))}
        </div>
      </section>

      {/* Queue Cards */}
      {loading ? (
        <div className="bg-white border border-zinc-200 rounded-2xl p-6 text-center text-caption">
          Loading today&apos;s sold-outs...
        </div>
      ) : visibleItems.length === 0 ? (
        <div className="bg-white border border-zinc-200 rounded-2xl p-6 text-center text-caption">
          No sold-outs match this filter.
        </div>
      ) : (
        <div className="space-y-3">
          {visibleItems.map((item) => {
            const isMathOpen = Boolean(expandedMath[item.task_id]);
            const badgeClass =
              ACTION_BADGE_STYLES[item.valuation.action] ?? ACTION_BADGE_STYLES.DONT_BOTHER;

            return (
              <article
                key={item.task_id}
                className="bg-white border border-zinc-200 rounded-2xl p-4 sm:p-5 shadow-xs space-y-3 smooth-panel"
              >
                {/* Header row */}
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 mb-1.5">
                      <span
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border font-semibold ${badgeClass}`}
                      >
                        <ActionIcon action={item.valuation.action} />
                        <span>{item.valuation.action_label}</span>
                      </span>
                      <span className="text-caption">
                        Band {item.size_band} · {item.category} · {item.deal_id}
                      </span>
                    </div>
                    <h2 className="text-zinc-900 break-words">
                      <Link
                        href={`/merchant/${encodeURIComponent(item.merchant_id)}`}
                        className="hover:underline inline-flex items-center gap-1"
                      >
                        <span>{item.merchant_name}</span>
                        <ChevronRight className="w-4 h-4 text-zinc-400 shrink-0" />
                      </Link>
                    </h2>
                    <p className="text-zinc-700 mt-1">{item.valuation.plain_reason}</p>
                  </div>

                  {/* Net EV Pill */}
                  <div className="text-left sm:text-right shrink-0">
                    <p className="text-eyebrow">Net EV</p>
                    <p
                      className={`font-bold ${
                        item.valuation.net_ev_gbp > 0 ? "text-emerald-700" : "text-zinc-600"
                      }`}
                    >
                      {item.valuation.net_ev_gbp >= 0 ? "+" : "-"}£
                      {Math.abs(item.valuation.net_ev_gbp).toFixed(2)}
                    </p>
                  </div>
                </div>

                {/* Verified Quote Box */}
                {item.signal.quote && (
                  <div className="rounded-xl bg-zinc-50 border border-zinc-200 p-3 space-y-1">
                    <div className="flex items-center gap-1.5 text-eyebrow">
                      <Quote className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                      <span>
                        {item.signal.quote_source_type?.replace(/_/g, " ") || "Note"} ·{" "}
                        {item.signal.quote_date || "recent"}
                      </span>
                    </div>
                    <p className="text-zinc-800 italic break-words">&ldquo;{item.signal.quote}&rdquo;</p>
                  </div>
                )}

                {/* Active Rep Mark banner */}
                {item.mark && (
                  <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <p className="font-semibold text-amber-900">
                        Marked `{item.mark.mark}` by {item.mark.marked_by}
                      </p>
                      <p className="text-amber-800 break-words">{item.mark.reason}</p>
                    </div>
                  </div>
                )}

                {/* Expandable £ Math Breakdown */}
                {isMathOpen && (
                  <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3 grid grid-cols-1 sm:grid-cols-4 gap-2">
                    <div>
                      <p className="text-eyebrow">Gross GP Lift</p>
                      <p className="font-semibold">+£{item.valuation.gross_lift_gbp.toFixed(2)}</p>
                    </div>
                    <div>
                      <p className="text-eyebrow">Rep Time Cost</p>
                      <p className="font-semibold">-£{item.valuation.rep_time_cost_gbp.toFixed(2)}</p>
                    </div>
                    <div>
                      <p className="text-eyebrow">Refund Risk</p>
                      <p className="font-semibold">
                        -£{item.valuation.refund_risk_penalty_gbp.toFixed(2)} ({Math.round(item.refund_ratio * 100)}%)
                      </p>
                    </div>
                    <div>
                      <p className="text-eyebrow">Net Expected GP</p>
                      <p className="font-bold">
                        {item.valuation.net_ev_gbp >= 0 ? "+" : "-"}£
                        {Math.abs(item.valuation.net_ev_gbp).toFixed(2)}
                      </p>
                    </div>
                  </div>
                )}

                {/* Actions Row */}
                <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                  <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedMath((prev) => ({ ...prev, [item.task_id]: !prev[item.task_id] }))
                      }
                      className="coss-btn coss-btn-secondary w-full sm:w-auto"
                    >
                      {isMathOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      <span>{isMathOpen ? "Hide £ math" : "Why this £?"}</span>
                    </button>

                    <Link
                      href={`/merchant/${encodeURIComponent(item.merchant_id)}`}
                      className="coss-btn coss-btn-secondary w-full sm:w-auto"
                    >
                      <span>Merchant history</span>
                      <ChevronRight className="w-4 h-4" />
                    </Link>
                  </div>

                  <MarkDrawer
                    merchantId={item.merchant_id}
                    merchantName={item.merchant_name}
                    defaultRepId={item.rep_id}
                    currentMark={item.mark}
                    onSaved={(newMark) => handleMarkUpdated(item.merchant_id, newMark)}
                  />
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
