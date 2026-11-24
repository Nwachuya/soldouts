# Change Request: Sold-Out Task Suppression (`suppress_soldout_tasks`)

**Owner:** Merchant Ops (Hana Kowalczyk day-to-day; Greg Lindqvist sign-off)  
**Target:** `routing` v2.15.0 (`routing/plan.py`, `config/routing.json`, `input/suppressions.csv`)  
**Status:** **Off by default (`suppress_soldout_tasks: false`) through Peak freeze.** Per Greg Lindqvist's ruling (*code change = post-freeze*), this targets **January (> 7 Jan)** deployment; switch remains `false` today.

---

## 1. What Changes
- **Code (`routing/routing/plan.py`)**: Wires `suppress_soldout_tasks` (default `false`) and `load_suppressions()` into `is_active()` / `build_plan()`. With the switch `false`, output is byte-for-byte identical to v2.15.0 (verified by `test_switch_off_ignores_suppression_file_for_rollback`).
- **Explicit `callback_promised` Rule (stated in docstring per Hana)**: `callback_promised == "1"` **beats** `suppressions.csv` so promised rep callbacks are never silently dropped; `do_not_contact == "1"` and Ops `suppressed_deal_ids` drop unconditionally.
- **V1 Scope (`deliverables/suppressions_treatment.csv` → `input/suppressions.csv`)**: Strictly **`1,101` active auto-replenish deals** (as of `2026-11-25`, from `auto_replenish_schedules.csv` on the 80% treatment arm of `2,401` merchants; `599` holdout merchants untouched; excludes `pause_auto_replenish` conflicts). **Rep-mark opt-outs are excluded from v1** until Ops agrees an expiry/reconfirmation rule.
- **Feeding & Lapsed Schedules**: Regenerated from the current active `auto_replenish_schedules` export before every 07:00 run (post-freeze), so lapsed schedules drop immediately.
- **Untouched**: `priors.json`, `env_overrides.json` (`0.46 / 0.43`), ranking math, input CSV column order, and automated cap raises (none).

## 2. Risk & Blast Radius
- **Low & bounded**: Only skips redundant morning tasks on deals already handled by active auto-replenish. Zero automated cap changes.

## 3. Instant Rollback
- Set `"routing": {"suppress_soldout_tasks": false}` in `config/env_overrides.json` (or `PUT /routing/switch` `false` in sandbox). Returns to today's list on the next 07:00 run with **no code deploy**.

## 4. Monitoring & When to Stop
- **Who watches & cadence**: **Sales Ops / Analytics** runs `scripts/holdout_readout.py` **weekly** on Friday mornings (zero new daily Ops check). Existing rep channels surface escalations.
- **Stop triggers** (immediately flip `suppress_soldout_tasks` to `false` if any trip):
  1. Treatment auto-replenish restock rate trails Holdout by **> 3.0 pp**.
  2. Treatment 30-day GP per sold-out drops **> £1.50** or **> 5%** below Holdout.
  3. Treatment refund rate rises **> +1.5 pp** above Holdout.
  4. **> 2** merchant or rep escalations on missed callbacks or unworked active deals.
