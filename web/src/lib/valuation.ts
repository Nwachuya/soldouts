export type ActionType =
  | "CALL"
  | "CALL_CALLBACK"
  | "ASSIST_DEAL_OR_LINK"
  | "PAUSE_SCHEDULE"
  | "HOLD_CAP_RISK"
  | "DONT_BOTHER";

export interface ValuationInput {
  size_band: string;
  value_30d_gbp: number;
  signal?: string;
  capacity_risk?: boolean;
  refund_ratio?: number;
  has_active_schedule?: boolean;
  do_not_contact?: boolean;
  callback_promised?: boolean;
  already_restocked?: boolean;
  rep_mark?: string | null;
}

export interface ValuationResult {
  action: ActionType;
  action_label: string;
  plain_reason: string;
  gross_lift_gbp: number;
  rep_time_cost_gbp: number;
  refund_risk_penalty_gbp: number;
  net_ev_gbp: number;
}

const LIFT_RATE_BY_BAND: Record<string, number> = {
  A: 0.055,
  B: 0.048,
  C: 0.035,
  D: 0.03,
};

const EMPIRICAL_FE_LIFT_GBP: Record<string, number> = {
  A: 8.23,
  B: 6.06,
  C: 2.58,
  D: 1.92,
};

const SIGNAL_MULTIPLIERS: Record<string, number> = {
  eager_restock: 1.35,
  portal_or_terms_assist: 1.35,
  ooo_temporary: 0.5,
  neutral: 1.0,
  capacity_refund_risk: 0.65,
  merchant_opt_out: 0.0,
  pause_auto_replenish: 0.0,
  self_served: 0.0,
};

const REP_SLOT_COST_GBP = 5.5;
const ASSIST_SLOT_COST_GBP = 3.0;

/** Python-compatible round-half-to-even to 2 decimal places. */
function round2(n: number): number {
  const scaled = n * 100;
  const floor = Math.floor(scaled);
  const diff = scaled - floor;
  if (Math.abs(diff - 0.5) < 1e-9) {
    return (floor % 2 === 0 ? floor : floor + 1) / 100;
  }
  return Math.round(scaled) / 100;
}

function makeResult(
  action: ActionType,
  action_label: string,
  plain_reason: string,
  gross: number,
  rep_cost: number,
  ref_pen: number
): ValuationResult {
  const net = round2(gross - rep_cost - ref_pen);
  return {
    action,
    action_label,
    plain_reason,
    gross_lift_gbp: round2(gross),
    rep_time_cost_gbp: round2(rep_cost),
    refund_risk_penalty_gbp: round2(ref_pen),
    net_ev_gbp: net,
  };
}

export function evaluateSoldout(input: ValuationInput): ValuationResult {
  const band = input.size_band in LIFT_RATE_BY_BAND ? input.size_band : "C";
  const rate = LIFT_RATE_BY_BAND[band];
  const empFloor = EMPIRICAL_FE_LIFT_GBP[band];
  const signal = input.signal ?? "neutral";
  const mult = SIGNAL_MULTIPLIERS[signal] ?? 1.0;

  const baseLift = 0.6 * (Math.max(0, input.value_30d_gbp) * rate) + 0.4 * empFloor;
  const rawGrossLift = round2(baseLift * mult);
  const riskRate = Math.min(0.85, Math.max(0, input.refund_ratio ?? 0) + (input.capacity_risk ? 0.25 : 0));
  const refundPenalty = round2(rawGrossLift * riskRate);

  if (input.do_not_contact) {
    return makeResult("DONT_BOTHER", "Don't bother", "Do-not-contact merchant flag set", 0, 0, 0);
  }
  if (input.rep_mark === "no_call") {
    return makeResult("DONT_BOTHER", "Don't bother", "Marked no_call by rep", 0, 0, 0);
  }
  if (input.already_restocked) {
    return makeResult("DONT_BOTHER", "Don't bother", "Deal already restocked", 0, 0, 0);
  }

  if (signal === "pause_auto_replenish") {
    return makeResult(
      "PAUSE_SCHEDULE",
      "Pause auto-replenish",
      "Active auto-replenish conflicts with merchant pause note — ask Ops to pause",
      0,
      ASSIST_SLOT_COST_GBP,
      0
    );
  }
  if (input.has_active_schedule && !input.callback_promised) {
    return makeResult(
      "DONT_BOTHER",
      "Don't bother",
      "Active auto-replenish schedule tops up automatically",
      0,
      0,
      0
    );
  }

  if (input.callback_promised) {
    const warn =
      signal === "merchant_opt_out" || signal === "capacity_refund_risk"
        ? " (note/reply warns full — check before raising cap)"
        : "";
    return makeResult(
      "CALL_CALLBACK",
      "Call (Callback)",
      `Promised callback — ring as agreed${warn}`,
      rawGrossLift,
      REP_SLOT_COST_GBP,
      refundPenalty
    );
  }

  if (signal === "merchant_opt_out") {
    return makeResult("DONT_BOTHER", "Don't bother", "Merchant asked to stay sold out", 0, 0, 0);
  }
  if (signal === "self_served") {
    return makeResult(
      "DONT_BOTHER",
      "Don't bother",
      "Merchant already self-topped-up via alert link",
      0,
      0,
      0
    );
  }
  if (signal === "capacity_refund_risk" || input.capacity_risk || (input.refund_ratio ?? 0) >= 0.18) {
    return makeResult(
      "HOLD_CAP_RISK",
      "Hold cap",
      "High refund/capacity distress — do not push cap raise",
      rawGrossLift,
      REP_SLOT_COST_GBP,
      refundPenalty
    );
  }
  if (signal === "portal_or_terms_assist") {
    return makeResult(
      "ASSIST_DEAL_OR_LINK",
      "Assist / edit deal",
      "Merchant needs Deal Alert login help or terms/price tweak before restock",
      rawGrossLift,
      ASSIST_SLOT_COST_GBP,
      refundPenalty
    );
  }

  const netIfCalled = round2(rawGrossLift - REP_SLOT_COST_GBP - refundPenalty);
  if (netIfCalled > 0) {
    return makeResult(
      "CALL",
      "Call",
      `Worth chasing: +£${netIfCalled.toFixed(2)} expected net GP after rep time & refund risk`,
      rawGrossLift,
      REP_SLOT_COST_GBP,
      refundPenalty
    );
  }
  return makeResult(
    "DONT_BOTHER",
    "Don't bother",
    `Expected lift (£${rawGrossLift.toFixed(2)}) does not cover £${REP_SLOT_COST_GBP.toFixed(2)} rep call cost`,
    rawGrossLift,
    REP_SLOT_COST_GBP,
    refundPenalty
  );
}
