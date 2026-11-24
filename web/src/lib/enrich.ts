import bundleRaw from "@/data/bundle.json";
import { evaluateSoldout, type ValuationResult } from "@/lib/valuation";

export interface RepInfo {
  rep_id: string;
  rep_name: string;
  team: string;
}

export interface MerchantMeta {
  merchant_name: string;
  category: string;
  region: string;
  city: string;
  size_band: string;
  rep_id: string;
  do_not_contact: boolean;
  refund_ratio: number;
}

export interface SignalInfo {
  merchant_id: string;
  signal: string;
  summary: string;
  capacity_risk: boolean;
  capacity_complaint_count: number;
  quote: string;
  quote_source_type: string | null;
  quote_source_id: string | null;
  quote_date: string | null;
  quote_verified: boolean;
  method: string;
}

export interface MarkInfo {
  mark: string;
  reason: string;
  marked_by: string;
  updated_at?: string;
}

export interface EnrichedSoldout {
  task_id: string;
  sold_out_id: string;
  deal_id: string;
  merchant_id: string;
  merchant_name: string;
  category: string;
  size_band: string;
  rep_id: string;
  rep_name: string;
  sold_out_date: string;
  value_30d_gbp: number;
  callback_promised: boolean;
  do_not_contact: boolean;
  has_active_schedule: boolean;
  schedule_cadence: string | null;
  refund_ratio: number;
  signal: SignalInfo;
  mark: MarkInfo | null;
  valuation: ValuationResult;
}

interface MerchantHistory {
  notes: Array<Record<string, unknown>>;
  replies: Array<Record<string, unknown>>;
  reviews: Array<Record<string, unknown>>;
  refunds: Array<Record<string, unknown>>;
  schedules: Array<Record<string, unknown>>;
}

interface BundleShape {
  reps: RepInfo[];
  merchants: Record<string, MerchantMeta>;
  signals: Record<string, SignalInfo>;
  active_schedule_deals: Record<string, { cadence: string; top_up_qty: string }>;
  fallback_soldouts: Array<Record<string, string>>;
  history: Record<string, MerchantHistory>;
}

export const BUNDLE = bundleRaw as unknown as BundleShape;

const REP_MAP = new Map(BUNDLE.reps.map((r) => [r.rep_id, r]));

export function getReps(): RepInfo[] {
  return BUNDLE.reps;
}

export function getMerchantMeta(merchantId: string): MerchantMeta | null {
  return BUNDLE.merchants[merchantId] ?? null;
}

export function getMerchantSignal(merchantId: string): SignalInfo {
  return (
    BUNDLE.signals[merchantId] ?? {
      merchant_id: merchantId,
      signal: "neutral",
      summary: "No free-text signals recorded",
      capacity_risk: false,
      capacity_complaint_count: 0,
      quote: "",
      quote_source_type: null,
      quote_source_id: null,
      quote_date: null,
      quote_verified: true,
      method: "offline_rules",
    }
  );
}

export function enrichSoldoutRow(
  raw: Record<string, unknown>,
  marksByMerchant: Map<string, MarkInfo>
): EnrichedSoldout {
  const merchantId = String(raw.merchant_id ?? "");
  const dealId = String(raw.deal_id ?? "");
  const meta = getMerchantMeta(merchantId);
  const sig = getMerchantSignal(merchantId);
  const sched = BUNDLE.active_schedule_deals[dealId];

  const sizeBand = String(raw.size_band ?? meta?.size_band ?? "C");
  const value30d = Number(raw.value_30d_gbp ?? raw.gp_30d_after_gbp ?? 0) || 0;
  const callbackPromised = String(raw.callback_promised ?? "0") === "1" || raw.callback_promised === true;
  const doNotContact =
    String(raw.do_not_contact ?? "0") === "1" || raw.do_not_contact === true || Boolean(meta?.do_not_contact);
  const alreadyRestocked = Boolean(raw.restocked_date);
  const repId = String(raw.rep_id ?? meta?.rep_id ?? "R10");
  const repInfo = REP_MAP.get(repId);
  const mark = marksByMerchant.get(merchantId) ?? null;

  const valuation = evaluateSoldout({
    size_band: sizeBand,
    value_30d_gbp: value30d,
    signal: sig.signal,
    capacity_risk: sig.capacity_risk,
    refund_ratio: meta?.refund_ratio ?? 0,
    has_active_schedule: Boolean(sched),
    do_not_contact: doNotContact,
    callback_promised: callbackPromised,
    already_restocked: alreadyRestocked,
    rep_mark: mark?.mark ?? null,
  });

  return {
    task_id: String(raw.task_id ?? raw.sold_out_id ?? `${dealId}-${merchantId}`),
    sold_out_id: String(raw.sold_out_id ?? raw.task_id ?? ""),
    deal_id: dealId,
    merchant_id: merchantId,
    merchant_name: String(raw.merchant_name ?? meta?.merchant_name ?? merchantId),
    category: String(raw.category ?? meta?.category ?? "Health & Beauty"),
    size_band: sizeBand,
    rep_id: repId,
    rep_name: repInfo?.rep_name ?? repId,
    sold_out_date: String(raw.sold_out_date ?? ""),
    value_30d_gbp: value30d,
    callback_promised: callbackPromised,
    do_not_contact: doNotContact,
    has_active_schedule: Boolean(sched),
    schedule_cadence: sched?.cadence ?? null,
    refund_ratio: meta?.refund_ratio ?? 0,
    signal: sig,
    mark,
    valuation,
  };
}
