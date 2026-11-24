# Change Request: Sold-Out Task Suppression (`suppress_soldout_tasks`)

**Owner:** Merchant Ops (Hana Kowalczyk day-to-day; Greg Lindqvist sign-off)  
**Target:** `routing` v2.15.0 (`config/routing.json`, `routing/plan.py`, `input/suppressions.csv`)  
**Status:** Off by default (`suppress_soldout_tasks: false`); **pending Hana's diff review** ahead of Wednesday 15:00 Change Review and Monday Peak freeze.

---

## 1. What Changes
- **Code (`routing/routing/plan.py`)**: Wires the pre-plumbed `suppress_soldout_tasks` flag and `routing.suppressions.load_suppressions()` into `is_active()` and `build_plan()`. When `false` (default), output is byte-for-byte identical to v2.15.0.
- **Explicit `callback_promised` Rule (stated in diff per Hana)**: `callback_promised == "1"` **beats** `suppressions.csv` so promised rep callbacks are never silently dropped; `do_not_contact == "1"` and Ops `suppressed_deal_ids` continue to drop unconditionally.
- **Scope (`deliverables/suppressions_treatment.csv` → `input/suppressions.csv`)**: Strictly limited per Greg's conditions to:
  1. **Active auto-replenish deals** (`1,058` deals from `auto_replenish_schedules.csv`, `source: merchant_ops_schedules`), excluding merchants with a recent pause conflict note (`pause_auto_replenish`).
  2. **Rep-confirmed opt-outs only** (`source: rep_mark` via `PUT /merchants/{id}/mark`, `no_call` / `seasonal_pause` / `capacity_full`) — **never** unreviewed AI note-detector output.
  - Applied to **80% Treatment merchants only** (`2,401` merchants); **20% Holdout (`599` merchants)** remain untouched for unbiased measurement.
- **Ownership & Feeding**: **Merchant Ops** owns `input/suppressions.csv`. Seeded once pre-freeze (`2026-11-25`) before Monday's freeze; post-freeze (`> 2027-01-07`), refreshed nightly before the 07:00 run via `scripts/generate_suppressions.py`.
- **Untouched**: `priors.json`, `env_overrides.json` (`0.46 / 0.43`), ranking math, input CSV column order, and automated cap raises (none).

## 2. Risk & Blast Radius
- **Low & bounded**: Only prevents redundant morning task creation on deals already covered by active auto-replenish or explicit rep marks, freeing ~15–20% of morning slots for unworked Band A/B deals.
- **No customer-facing or cap-mutation risk**: Zero automated cap changes; deals continue topping up on their existing Merchant Ops schedules.

## 3. Instant Rollback
- Set `"routing": {"suppress_soldout_tasks": false}` in `config/env_overrides.json` (which overrides `config/routing.json`) or flip `PUT /routing/switch` to `false` in sandbox.
- Takes effect on the next 07:00 run with **zero code revert or redeploy**.

## 4. When to Stop (Quantitative Kill-Switch Triggers)
Immediately flip `suppress_soldout_tasks` back to `false` if any of the following trigger during the **2026-12-11** early guardrail check or **2027-01-25** ITT readout (`scripts/holdout_readout.py`):
1. **Restock rate drop**: Treatment auto-replenish restock rate trails Holdout by **> 3.0 percentage points**.
2. **GP degradation**: Treatment 30-day GP per sold-out drops **> £1.50** (or **> 5%**) below Holdout.
3. **Refund spike**: Treatment refund rate rises **> +1.5 percentage points** above Holdout.
4. **Escalations**: **> 2** merchant or rep escalations regarding missed callbacks or unworked active deals.
