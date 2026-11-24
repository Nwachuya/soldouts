"""Pure-code net expected GP valuation and action recommendation engine."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

_DEFAULT_PARAMS_PATH = Path(__file__).resolve().parent / "priors_calibrated.json"
DEFAULT_PARAMS: dict[str, Any] = json.loads(_DEFAULT_PARAMS_PATH.read_text(encoding="utf-8"))


def evaluate_soldout(
    *,
    size_band: str,
    value_30d_gbp: float,
    signal: str = "neutral",
    capacity_risk: bool = False,
    refund_ratio: float = 0.0,
    has_active_schedule: bool = False,
    do_not_contact: bool = False,
    callback_promised: bool = False,
    already_restocked: bool = False,
    rep_mark: str | None = None,
    params: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Compute net expected GP (£) and concrete rep action purely in code."""
    p = params or DEFAULT_PARAMS
    band = size_band if size_band in p["lift_rate_by_band"] else "C"
    rate = float(p["lift_rate_by_band"][band])
    emp_floor = float(p["empirical_fe_lift_gbp"][band])
    rep_cost_full = float(p["rep_slot_cost_gbp"])
    assist_cost = float(p["assist_slot_cost_gbp"])
    mult = float(p["signal_multipliers"].get(signal, 1.0))

    # Blend value_30d_gbp-scaled lift with empirical band FE lift (60/40) so extreme outliers don't explode.
    base_lift = 0.6 * (max(0.0, value_30d_gbp) * rate) + 0.4 * emp_floor
    raw_gross_lift = round(base_lift * mult, 2)
    risk_rate = min(0.85, max(0.0, refund_ratio) + (0.25 if capacity_risk else 0.0))
    refund_penalty = round(raw_gross_lift * risk_rate, 2)

    def _result(
        action: str,
        label: str,
        reason: str,
        gross: float,
        rep_cost: float,
        ref_pen: float,
    ) -> dict[str, Any]:
        net = round(gross - rep_cost - ref_pen, 2)
        return {
            "action": action,
            "action_label": label,
            "plain_reason": reason,
            "gross_lift_gbp": round(gross, 2),
            "rep_time_cost_gbp": round(rep_cost, 2),
            "refund_risk_penalty_gbp": round(ref_pen, 2),
            "net_ev_gbp": net,
        }

    # 1. Hard compliance / explicit rep mark blocks
    if do_not_contact:
        return _result("DONT_BOTHER", "Don't bother", "Do-not-contact merchant flag set", 0.0, 0.0, 0.0)
    if rep_mark == "no_call":
        return _result("DONT_BOTHER", "Don't bother", "Marked no_call by rep", 0.0, 0.0, 0.0)
    if already_restocked:
        return _result("DONT_BOTHER", "Don't bother", "Deal already restocked", 0.0, 0.0, 0.0)

    # 2. Active auto-replenish conflict vs normal auto-replenish
    if signal == "pause_auto_replenish":
        return _result(
            "PAUSE_SCHEDULE",
            "Pause auto-replenish",
            "Active auto-replenish conflicts with merchant pause note — ask Ops to pause",
            0.0,
            assist_cost,
            0.0,
        )
    if has_active_schedule and not callback_promised:
        return _result(
            "DONT_BOTHER",
            "Don't bother",
            "Active auto-replenish schedule tops up automatically",
            0.0,
            0.0,
            0.0,
        )

    # 3. Promised callbacks take precedence over routine skips (Hana rule)
    if callback_promised:
        warn = " (note/reply warns full — check before raising cap)" if signal in ("merchant_opt_out", "capacity_refund_risk") else ""
        return _result(
            "CALL_CALLBACK",
            "Call (Callback)",
            f"Promised callback — ring as agreed{warn}",
            raw_gross_lift,
            rep_cost_full,
            refund_penalty,
        )

    # 4. Free-text operational overrides
    if signal == "merchant_opt_out":
        return _result("DONT_BOTHER", "Don't bother", "Merchant asked to stay sold out", 0.0, 0.0, 0.0)
    if signal == "self_served":
        return _result("DONT_BOTHER", "Don't bother", "Merchant already self-topped-up via alert link", 0.0, 0.0, 0.0)
    if signal == "capacity_refund_risk" or capacity_risk or refund_ratio >= 0.18:
        return _result(
            "HOLD_CAP_RISK",
            "Hold cap",
            "High refund/capacity distress — do not push cap raise",
            raw_gross_lift,
            rep_cost_full,
            refund_penalty,
        )
    if signal == "portal_or_terms_assist":
        return _result(
            "ASSIST_DEAL_OR_LINK",
            "Assist / edit deal",
            "Merchant needs Deal Alert login help or terms/price tweak before restock",
            raw_gross_lift,
            assist_cost,
            refund_penalty,
        )

    # 5. Pure economic threshold
    net_if_called = round(raw_gross_lift - rep_cost_full - refund_penalty, 2)
    if net_if_called > 0:
        return _result(
            "CALL",
            "Call",
            f"Worth chasing: +£{net_if_called:.2f} expected net GP after rep time & refund risk",
            raw_gross_lift,
            rep_cost_full,
            refund_penalty,
        )
    return _result(
        "DONT_BOTHER",
        "Don't bother",
        f"Expected lift (£{raw_gross_lift:.2f}) does not cover £{rep_cost_full:.2f} rep call cost",
        raw_gross_lift,
        rep_cost_full,
        refund_penalty,
    )
