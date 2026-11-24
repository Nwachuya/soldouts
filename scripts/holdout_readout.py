"""Offline holdout readout and pre-launch scenario estimator."""
from __future__ import annotations

import argparse
import json
import random
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path
from typing import Any

from detector.clean import clean_activities, read_csv_rows
from scripts.holdout import stratified_assign_arms


def _bootstrap_ci(
    t_vals: list[float],
    h_vals: list[float],
    n_boot: int = 400,
    seed: int = 42,
) -> tuple[float, float, float]:
    """Return (diff_mean, ci_low_95, ci_high_95) for mean(treatment) - mean(holdout)."""
    if not t_vals or not h_vals:
        return 0.0, 0.0, 0.0
    rng = random.Random(seed)
    t_mean = sum(t_vals) / len(t_vals)
    h_mean = sum(h_vals) / len(h_vals)
    obs_diff = t_mean - h_mean
    diffs: list[float] = []
    nt, nh = len(t_vals), len(h_vals)
    for _ in range(n_boot):
        bt = sum(t_vals[rng.randrange(nt)] for _ in range(nt)) / nt
        bh = sum(h_vals[rng.randrange(nh)] for _ in range(nh)) / nh
        diffs.append(bt - bh)
    diffs.sort()
    lo = diffs[int(0.025 * n_boot)]
    hi = diffs[int(0.975 * n_boot)]
    return round(obs_diff, 2), round(lo, 2), round(hi, 2)


def compute_readout(
    data_dir: Path,
    launch_date_str: str = "2026-11-26",
    post_start: str | None = None,
    escalations: int = 0,
) -> dict[str, Any]:
    """Compute stratified holdout balance, pre-launch scenario range, and post-launch ITT readout."""
    merchants_list = read_csv_rows(data_dir / "merchants.csv")
    merchants = {m["merchant_id"]: m for m in merchants_list}
    arm_map = stratified_assign_arms(merchants_list)
    soldouts = read_csv_rows(data_dir / "sold_out_deals.csv")
    schedules = read_csv_rows(data_dir / "auto_replenish_schedules.csv")
    mmonths = read_csv_rows(data_dir / "merchant_months.csv")
    acts_clean, _ = clean_activities(read_csv_rows(data_dir / "activities.csv"))

    sched_by_deal = defaultdict(list)
    for sc in schedules:
        sched_by_deal[sc["deal_id"]].append(sc)

    def has_sched(did: str, dt: str) -> bool:
        return any(s["start_date"] <= dt and (not s["end_date"] or dt <= s["end_date"]) for s in sched_by_deal.get(did, []))

    acts_by_so = defaultdict(list)
    for a in acts_clean:
        if a["sold_out_id"]:
            acts_by_so[a["sold_out_id"]].append(a)

    # 1. Pre-launch balance check (Oct 2025 - Sep 2026)
    t_pre, h_pre = [], []
    for s in soldouts:
        if not ("2025-10-01" <= s["sold_out_date"] <= "2026-09-30") or not s.get("gp_30d_after_gbp"):
            continue
        gp = float(s["gp_30d_after_gbp"])
        if arm_map.get(s["merchant_id"], "treatment") == "holdout":
            h_pre.append(gp)
        else:
            t_pre.append(gp)

    pre_diff, pre_lo, pre_hi = _bootstrap_ci(t_pre, h_pre)

    # 2. Pre-launch scenario simulation (explicitly labeled as assumed reallocation sensitivity, not measured ITT)
    so_yr = [s for s in soldouts if "2025-10-01" <= s["sold_out_date"] <= "2026-09-30"]
    called_auto = sum(
        1
        for s in so_yr
        if has_sched(s["deal_id"], s["sold_out_date"])
        and any(a["type"] == "call" and a["duration_s"] and int(a["duration_s"]) >= 120 for a in acts_by_so.get(s["sold_out_id"], []))
    )
    called_band_d = sum(
        1
        for s in so_yr
        if not has_sched(s["deal_id"], s["sold_out_date"])
        and merchants.get(s["merchant_id"], {}).get("size_band") == "D"
        and any(a["type"] == "call" and a["duration_s"] and int(a["duration_s"]) >= 120 for a in acts_by_so.get(s["sold_out_id"], []))
    )
    unworked_ab = sum(
        1
        for s in so_yr
        if not has_sched(s["deal_id"], s["sold_out_date"])
        and merchants.get(s["merchant_id"], {}).get("size_band") in ("A", "B")
        and not acts_by_so.get(s["sold_out_id"], [])
    )
    low_annual = round(called_auto * 5.50 + (unworked_ab * 0.15) * 4.00, -2)
    mid_annual = round(called_auto * 5.50 + (unworked_ab * 0.25) * 5.25, -2)
    high_annual = round(called_auto * 5.50 + (unworked_ab * 0.35) * 6.50, -2)
    band_d_upside = round(called_band_d * (5.50 - 1.92), -2)

    launch_dt = date.fromisoformat(launch_date_str)
    early_check_date = (launch_dt + timedelta(days=15)).isoformat()
    full_readout_date = (launch_dt + timedelta(days=60)).isoformat()

    result: dict[str, Any] = {
        "holdout_design": {
            "treatment_pct": 80,
            "holdout_pct": 20,
            "granularity": "merchant_id",
            "stratified_by": ["size_band", "category"],
            "pre_period_gp_diff_gbp": pre_diff,
            "pre_period_95_ci": [pre_lo, pre_hi],
            "balanced": abs(pre_diff) < 1.5,
        },
        "pre_launch_estimate": {
            "methodology": "pre_launch_scenario_simulation_not_measured_itt",
            "scope": "v1 pre-freeze (active auto-replenish + rep-marked opt-outs)",
            "assumptions": {
                "rep_slot_saved_gbp": 5.50,
                "unworked_ab_reallocation_rates": [0.15, 0.25, 0.35],
                "net_gp_per_reallocated_ab_call_gbp": [4.00, 5.25, 6.50],
            },
            "v1_pre_freeze_annual_net_gp_range_gbp": [int(low_annual), int(high_annual)],
            "midpoint_annual_net_gp_gbp": int(mid_annual),
            "post_freeze_band_d_upside_gbp": int(band_d_upside),
            "called_auto_replenish_per_year": called_auto,
            "called_band_d_per_year": called_band_d,
            "unworked_band_ab_per_year": unworked_ab,
            "early_guardrail_check_date": early_check_date,
            "full_itt_readout_date": full_readout_date,
        },
    }

    # 3. Post-launch measured ITT readout (runs when post_start date is provided)
    if post_start:
        t_post, h_post = [], []
        t_auto_restock, h_auto_restock = [], []
        t_worked_tasks = h_worked_tasks = 0
        t_total_gp = h_total_gp = 0.0

        for s in soldouts:
            if s["sold_out_date"] < post_start or not s.get("gp_30d_after_gbp"):
                continue
            gp = float(s["gp_30d_after_gbp"])
            restocked = 1.0 if s.get("restocked_date") else 0.0
            worked = 1 if acts_by_so.get(s["sold_out_id"]) else 0
            is_auto = has_sched(s["deal_id"], s["sold_out_date"])
            arm = arm_map.get(s["merchant_id"], "treatment")
            if arm == "holdout":
                h_post.append(gp)
                h_total_gp += gp
                h_worked_tasks += worked
                if is_auto:
                    h_auto_restock.append(restocked)
            else:
                t_post.append(gp)
                t_total_gp += gp
                t_worked_tasks += worked
                if is_auto:
                    t_auto_restock.append(restocked)

        itt_diff, itt_lo, itt_hi = _bootstrap_ci(t_post, h_post)
        h_mean_gp = (sum(h_post) / len(h_post)) if h_post else 0.0
        rel_gp_pct = round((itt_diff / h_mean_gp) * 100, 2) if h_mean_gp > 0 else 0.0

        auto_res_diff, _, _ = _bootstrap_ci(t_auto_restock, h_auto_restock)
        auto_res_diff_pp = round(auto_res_diff * 100, 2)

        # Net GP per rep-hour (0.20 hr per 12-min task slot, £27.50/hr loaded rep cost)
        t_rep_hours = t_worked_tasks * 0.20
        h_rep_hours = h_worked_tasks * 0.20
        t_net_per_hr = round((t_total_gp - t_rep_hours * 27.50) / t_rep_hours, 2) if t_rep_hours > 0 else 0.0
        h_net_per_hr = round((h_total_gp - h_rep_hours * 27.50) / h_rep_hours, 2) if h_rep_hours > 0 else 0.0
        net_per_hr_diff = round(t_net_per_hr - h_net_per_hr, 2)

        # Refund rate guardrail from merchant_months >= post_start[:7]
        post_ym = post_start[:7]
        t_gp = t_ref = h_gp = h_ref = 0.0
        for mm in mmonths:
            if mm["month"] < post_ym:
                continue
            if arm_map.get(mm["merchant_id"], "treatment") == "holdout":
                h_gp += float(mm["gp_gbp"])
                h_ref += float(mm["refunds_gbp"])
            else:
                t_gp += float(mm["gp_gbp"])
                t_ref += float(mm["refunds_gbp"])
        t_ref_rate = t_ref / (t_gp + t_ref) if (t_gp + t_ref) > 0 else 0.0
        h_ref_rate = h_ref / (h_gp + h_ref) if (h_gp + h_ref) > 0 else 0.0
        ref_delta_pp = round((t_ref_rate - h_ref_rate) * 100, 2)

        stop_rules_detail = {
            "restock_rate_drop_gt_3pp": bool(t_auto_restock and h_auto_restock and auto_res_diff_pp < -3.0),
            "gp_drop_gt_5pct_or_1_50": bool(itt_diff < -1.5 or rel_gp_pct < -5.0),
            "refund_rate_spike_gt_1_5pp": bool(ref_delta_pp > 1.5),
            "escalations_gt_2": bool(escalations > 2),
        }

        result["post_launch_itt"] = {
            "post_start": post_start,
            "n_treatment_soldouts": len(t_post),
            "n_holdout_soldouts": len(h_post),
            "itt_30d_gp_lift_gbp": itt_diff,
            "itt_relative_gp_diff_pct": rel_gp_pct,
            "itt_95_ci": [itt_lo, itt_hi],
            "net_gp_per_rep_hour_treatment": t_net_per_hr,
            "net_gp_per_rep_hour_holdout": h_net_per_hr,
            "net_gp_per_rep_hour_diff": net_per_hr_diff,
            "auto_replenish_restock_diff_pp": auto_res_diff_pp,
            "refund_rate_delta_pp": ref_delta_pp,
            "escalations": escalations,
            "stop_rules_detail": stop_rules_detail,
            "stop_rule_triggered": any(stop_rules_detail.values()),
        }

    return result


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run sold-outs holdout balance & ITT readout.")
    parser.add_argument("--data-dir", type=Path, default=Path("plans-directives/data"))
    parser.add_argument("--launch-date", type=str, default="2026-11-26")
    parser.add_argument("--post-start", type=str, default=None, help="YYYY-MM-DD start of live experiment for ITT readout.")
    parser.add_argument("--escalations", type=int, default=0, help="Observed merchant/rep escalations during window.")
    args = parser.parse_args(argv)

    out = compute_readout(
        args.data_dir,
        launch_date_str=args.launch_date,
        post_start=args.post_start,
        escalations=args.escalations,
    )
    print(json.dumps(out, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
