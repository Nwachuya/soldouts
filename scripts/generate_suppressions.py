"""Generate treatment-arm suppressions.csv in routing/suppressions.py schema."""
from __future__ import annotations

import argparse
import csv
import json
from datetime import date
from pathlib import Path

from detector.clean import read_csv_rows
from scripts.holdout import stratified_assign_arms


def generate_suppressions(
    data_dir: Path,
    signals_path: Path,
    output_path: Path,
    added_on: str | None = None,
    marks_path: Path | None = None,
    include_low_ev_band_d: bool = False,
) -> dict[str, int]:
    """Write suppressions_treatment.csv for 80% treatment merchants; leave 20% holdout untouched.

    Per Greg Lindqvist's pre-freeze condition:
    - Automated deals come from Merchant Ops' active auto_replenish_schedules.csv.
    - Opt-out suppressions come strictly from explicit rep marks (never unreviewed AI detector output).
    """
    added_on = added_on or date.today().isoformat()
    merchants_list = read_csv_rows(data_dir / "merchants.csv")
    merchants = {m["merchant_id"]: m for m in merchants_list}
    arm_map = stratified_assign_arms(merchants_list)
    schedules = read_csv_rows(data_dir / "auto_replenish_schedules.csv")
    signals_payload = json.loads(signals_path.read_text(encoding="utf-8")) if signals_path.exists() else {}
    signals = signals_payload.get("signals", {})
    marks_rows = json.loads(marks_path.read_text(encoding="utf-8")).get("data", []) if (marks_path and marks_path.exists()) else []

    rows: list[dict[str, str]] = []
    seen_keys: set[tuple[str, str]] = set()
    counts = {
        "treatment_merchants": 0,
        "holdout_merchants": 0,
        "auto_replenish_deals": 0,
        "rep_mark_opt_outs": 0,
        "band_d_merchants": 0,
    }

    for mid in merchants:
        if arm_map.get(mid, "treatment") == "holdout":
            counts["holdout_merchants"] += 1
        else:
            counts["treatment_merchants"] += 1

    # 1. Active auto-replenish deals (excluding merchants with a pause conflict note)
    for sc in schedules:
        if (sc.get("end_date") or "").strip():
            continue
        mid = sc["merchant_id"]
        did = sc["deal_id"]
        if arm_map.get(mid, "treatment") == "holdout":
            continue
        sig = signals.get(mid, {}).get("signal", "neutral")
        if sig == "pause_auto_replenish":
            continue
        key = (did, mid)
        if key not in seen_keys:
            seen_keys.add(key)
            rows.append(
                {
                    "deal_id": did,
                    "merchant_id": mid,
                    "reason": f"auto-replenish {sc.get('cadence', 'active')}",
                    "source": "merchant_ops_schedules",
                    "added_on": added_on,
                }
            )
            counts["auto_replenish_deals"] += 1

    # 2. Explicit rep-confirmed opt-outs (from GET /marks export, never raw AI detector)
    for mk in marks_rows:
        mid = mk.get("merchant_id", "")
        if not mid or arm_map.get(mid, "treatment") == "holdout":
            continue
        if mk.get("mark") in ("no_call", "seasonal_pause", "capacity_full"):
            key = ("", mid)
            if key not in seen_keys:
                seen_keys.add(key)
                rows.append(
                    {
                        "deal_id": "",
                        "merchant_id": mid,
                        "reason": f"rep_mark:{mk.get('mark')} ({mk.get('marked_by', 'rep')})",
                        "source": "rep_mark",
                        "added_on": added_on,
                    }
                )
                counts["rep_mark_opt_outs"] += 1

    # 3. Optional post-freeze Band D negative-EV suppression (off by default)
    if include_low_ev_band_d:
        for mid, m in sorted(merchants.items()):
            if arm_map.get(mid, "treatment") == "holdout":
                continue
            if m.get("size_band") == "D":
                key = ("", mid)
                if key not in seen_keys:
                    seen_keys.add(key)
                    rows.append(
                        {
                            "deal_id": "",
                            "merchant_id": mid,
                            "reason": "negative_net_ev_band_d",
                            "source": "valuation_engine",
                            "added_on": added_on,
                        }
                    )
                    counts["band_d_merchants"] += 1

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=["deal_id", "merchant_id", "reason", "source", "added_on"])
        writer.writeheader()
        writer.writerows(rows)

    counts["total_rows"] = len(rows)
    return counts


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Generate treatment-arm suppressions.csv.")
    parser.add_argument("--data-dir", type=Path, default=Path("plans-directives/data"))
    parser.add_argument("--signals", type=Path, default=Path("data/merchant_signals.json"))
    parser.add_argument("--marks-json", type=Path, default=None, help="Optional GET /marks JSON export from reps.")
    parser.add_argument("--output", type=Path, default=Path("deliverables/suppressions_treatment.csv"))
    parser.add_argument("--added-on", type=str, default="2026-11-25")
    parser.add_argument("--include-band-d", action="store_true")
    args = parser.parse_args(argv)

    counts = generate_suppressions(
        args.data_dir,
        args.signals,
        args.output,
        added_on=args.added_on,
        marks_path=args.marks_json,
        include_low_ev_band_d=args.include_band_d,
    )
    print(f"Generated {args.output}: {counts}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
