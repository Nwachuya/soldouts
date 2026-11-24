"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Calendar, ChevronRight, Home, MessageSquare, ReceiptText, Star } from "lucide-react";
import type { MarkInfo, MerchantMeta, SignalInfo } from "@/lib/enrich";
import { MarkDrawer } from "@/components/MarkDrawer";

interface MerchantDetailPayload {
  mode: string;
  merchant: Record<string, unknown> | null;
  meta: MerchantMeta | null;
  signal: SignalInfo;
  notes: Array<Record<string, unknown>>;
  replies: Array<Record<string, unknown>>;
  reviews: Array<Record<string, unknown>>;
  refunds: Array<Record<string, unknown>>;
  schedules: Array<Record<string, unknown>>;
}

export default function MerchantDetailPage() {
  const params = useParams<{ id: string }>();
  const merchantId = params?.id ?? "";
  const [data, setData] = useState<MerchantDetailPayload | null>(null);
  const [mark, setMark] = useState<MarkInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!merchantId) return;
    setLoading(true);
    fetch(`/api/merchants/${encodeURIComponent(merchantId)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((payload: MerchantDetailPayload) => {
        setData(payload);
        const rawMark = payload.merchant?.mark as MarkInfo | null | undefined;
        setMark(rawMark ?? null);
      })
      .finally(() => setLoading(false));
  }, [merchantId]);

  const merchantName =
    (data?.merchant?.merchant_name as string) || data?.meta?.merchant_name || merchantId;

  return (
    <div className="space-y-5">
      {/* Breadcrumb Navigation (replaces any "Go back" buttons per global rules) */}
      <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1.5 text-caption">
        <Link href="/" className="inline-flex items-center gap-1 hover:underline text-zinc-700">
          <Home className="w-3.5 h-3.5" />
          <span>Home</span>
        </Link>
        <ChevronRight className="w-3.5 h-3.5 text-zinc-400" />
        <Link href="/" className="hover:underline text-zinc-700">
          Today&apos;s Sold-Outs
        </Link>
        <ChevronRight className="w-3.5 h-3.5 text-zinc-400" />
        <span className="font-semibold text-zinc-900 truncate">{merchantName}</span>
      </nav>

      {loading ? (
        <div className="bg-white border border-zinc-200 rounded-2xl p-6 text-caption">
          Loading merchant dossier...
        </div>
      ) : !data ? (
        <div className="bg-white border border-zinc-200 rounded-2xl p-6 text-caption">
          Merchant not found.
        </div>
      ) : (
        <>
          {/* Merchant Summary Header */}
          <section className="bg-white border border-zinc-200 rounded-2xl p-4 sm:p-5 shadow-xs space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-eyebrow">
                  {merchantId} · Band {data.meta?.size_band ?? "?"} · {data.meta?.category ?? "Local"}
                </p>
                <h1>{merchantName}</h1>
                <p className="text-caption mt-1">
                  {data.meta?.city}, {data.meta?.region} · Historical refund ratio:{" "}
                  {Math.round((data.meta?.refund_ratio ?? 0) * 100)}%
                </p>
              </div>
              <MarkDrawer
                merchantId={merchantId}
                merchantName={merchantName}
                defaultRepId={data.meta?.rep_id ?? "R10"}
                currentMark={mark}
                onSaved={setMark}
              />
            </div>

            <div className="rounded-xl bg-zinc-50 border border-zinc-200 p-3.5 space-y-1">
              <p className="text-eyebrow">Detector Verdict ({data.signal.signal})</p>
              <p className="font-semibold text-zinc-900">{data.signal.summary}</p>
              {data.signal.quote && (
                <p className="text-zinc-700 italic">&ldquo;{data.signal.quote}&rdquo;</p>
              )}
            </div>
          </section>

          {/* Auto-Replenish Schedules */}
          {data.schedules.length > 0 && (
            <section className="bg-white border border-zinc-200 rounded-2xl p-4 sm:p-5 space-y-2.5">
              <h2 className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-zinc-600" />
                <span>Auto-Replenish Schedules</span>
              </h2>
              <div className="space-y-2">
                {data.schedules.map((s, idx) => (
                  <div key={idx} className="rounded-lg border border-zinc-200 p-3 flex flex-wrap justify-between gap-2">
                    <span className="font-semibold">{String(s.deal_id)}</span>
                    <span className="text-caption">
                      {String(s.cadence)} (+{String(s.top_up_qty)}) ·{" "}
                      {s.end_date ? `Ended ${String(s.end_date)}` : "Active"}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Notes & Deal Alert Replies */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <section className="bg-white border border-zinc-200 rounded-2xl p-4 sm:p-5 space-y-3">
              <h2 className="flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-zinc-600" />
                <span>Deal Alert Replies ({data.replies.length})</span>
              </h2>
              {data.replies.length === 0 ? (
                <p className="text-caption">No recent Deal Alert replies loaded.</p>
              ) : (
                <ul className="space-y-2.5">
                  {data.replies.map((r, i) => (
                    <li key={i} className="rounded-lg bg-zinc-50 border border-zinc-200 p-3">
                      <p className="text-caption">{String(r.received_at ?? "").slice(0, 10)}</p>
                      <p className="text-zinc-900 mt-1 break-words">{String(r.text ?? "")}</p>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="bg-white border border-zinc-200 rounded-2xl p-4 sm:p-5 space-y-3">
              <h2 className="flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-zinc-600" />
                <span>Rep Notes ({data.notes.length})</span>
              </h2>
              {data.notes.length === 0 ? (
                <p className="text-caption">No rep notes loaded.</p>
              ) : (
                <ul className="space-y-2.5">
                  {data.notes.map((n, i) => (
                    <li key={i} className="rounded-lg bg-zinc-50 border border-zinc-200 p-3">
                      <p className="text-caption">{String(n.created_at ?? "").slice(0, 10)}</p>
                      <p className="text-zinc-900 mt-1 break-words">{String(n.text ?? "")}</p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          {/* Reviews & Refunds */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <section className="bg-white border border-zinc-200 rounded-2xl p-4 sm:p-5 space-y-3">
              <h2 className="flex items-center gap-2">
                <Star className="w-4 h-4 text-zinc-600" />
                <span>Customer Reviews ({data.reviews.length})</span>
              </h2>
              {data.reviews.length === 0 ? (
                <p className="text-caption">No customer reviews loaded.</p>
              ) : (
                <ul className="space-y-2.5">
                  {data.reviews.map((rv, i) => (
                    <li key={i} className="rounded-lg bg-zinc-50 border border-zinc-200 p-3">
                      <p className="text-caption">
                        {String(rv.created_at ?? "").slice(0, 10)} · {String(rv.rating ?? "")}★
                      </p>
                      <p className="text-zinc-900 mt-1 break-words">{String(rv.text ?? "")}</p>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="bg-white border border-zinc-200 rounded-2xl p-4 sm:p-5 space-y-3">
              <h2 className="flex items-center gap-2">
                <ReceiptText className="w-4 h-4 text-zinc-600" />
                <span>Refund Reasons ({data.refunds.length})</span>
              </h2>
              {data.refunds.length === 0 ? (
                <p className="text-caption">No refund reasons loaded.</p>
              ) : (
                <ul className="space-y-2.5">
                  {data.refunds.map((rf, i) => (
                    <li key={i} className="rounded-lg bg-zinc-50 border border-zinc-200 p-3">
                      <p className="text-caption">
                        {String(rf.created_at ?? "").slice(0, 10)} · £{String(rf.amount_gbp ?? "")}
                      </p>
                      <p className="text-zinc-900 mt-1 break-words">{String(rf.reason_text ?? "")}</p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  );
}
