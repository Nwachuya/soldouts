# UK Local Sold-Outs Triage & Routing Suppression

A phone-first rep triage app, offline-runnable free-text note detector, deterministic £ EV valuation engine, gated routing suppression change, and merchant-level holdout readout built for UK Local ahead of Monday's Peak change freeze.

---

## Quick Start (One-Command Runs & Offline Tests)

### 1. Run All Offline Tests (Zero Network, Zero Sandbox Key Required)
```bash
# Detector, valuation, and holdout unit tests (13 tests)
PYTHONPATH=.:routing python3 -m unittest discover -s tests -v

# Routing service unit tests (14 tests)
cd routing && python3 -m unittest discover -s tests -v

# Web app TypeScript valuation parity test & production build
cd web && npm test && npm run build
```

### 2. Run the Offline Detector CLI on Any CSV Directory
```bash
python3 -m detector.cli --input-dir plans-directives/data --output /tmp/detector_out.json --offline
```
*(Pass `--llm --focus-csv routing/input/todays_soldouts.csv --max-usd 0.50` with `BASE_URL` and `KEY` in `.env` for capped Sandbox LLM enrichment.)*

### 3. Run the Rep Web App Locally
```bash
cd web && npm install && npm run dev
# Open http://localhost:3000
```
Reads `BASE_URL` and `KEY` from `../.env` strictly on the server (never exposed to the browser) and falls back cleanly to `web/src/data/bundle.json` when offline.

### 4. Generate Treatment Suppressions & Holdout Readout
```bash
PYTHONPATH=. python3 -m scripts.generate_suppressions --marks-json /path/to/marks.json
PYTHONPATH=. python3 -m scripts.holdout_readout --data-dir plans-directives/data
```

---

## What We Decided & Why

### 1. Why Priya's £11/Call (£340k/yr) Memo Overstates Incremental Value
Auditing the 30,534 sold-outs in Priya's Oct 2025 – Sep 2026 window uncovered five empirical confounders:
1. **Active Auto-Replenish (`5,690` events / `18.6%`)**: Deals on active `auto_replenish_schedules.csv` top up automatically; calling yields ~£0 lift (`-£2.60` in Health & Beauty).
2. **Reverse Causality (`500` / `5,333` restocked calls / `9.4%`)**: The deal restocked *before* the rep's logged call date.
3. **Feb 2026 CRM Migration Noise (`1,400` rows)**: Automated `"Deal Alert sent"` activities were logged with `sold_out_id`, misclassifying left-alone deals into `Attempted`.
4. **Within-Band Selection Bias & Rep Time**: Clean within-merchant fixed-effects gross 30d GP lifts are **£8.23** (A), **£6.06** (B), **£2.58** (C), and **£1.92** (D). Deducting a 12-minute rep slot (`£5.50` at `£27.50/hr`) makes Band D and most of Band C net-negative to chase by phone.
5. **Late Refund & Capacity Risk (`7.8%` refund ratio)**: Over-capping capacity-constrained venues triggers double-bookings and post-30-day refunds (`merchant_months.csv`, `reviews.csv`, `refunds.csv`).

### 2. Pure-Code Net £ EV (`valuation/engine.py` & `web/src/lib/valuation.ts`)
Code computes 100% of the sums (verified identical across Python and TypeScript via `tests/fixtures/valuation_vectors.json`):
$$\text{Net EV (£)} = \text{Gross GP Lift} - \text{Rep Slot Cost (£5.50 call / £3.00 assist)} - \text{Refund Risk Penalty}$$
Assigns each sold-out to `CALL`, `CALL_CALLBACK`, `ASSIST_DEAL_OR_LINK`, `PAUSE_SCHEDULE`, `HOLD_CAP_RISK`, or `DONT_BOTHER`.

### 3. Routing Change (`routing/routing/plan.py`)
- Wired `suppress_soldout_tasks` (off by default) and `load_suppressions()`, honoring `config/env_overrides.json` precedence for instant single-switch rollback.
- **Explicit `callback_promised` rule**: `callback_promised == "1"` beats `suppressions.csv` so promised callbacks are never dropped; `do_not_contact == "1"` and Ops `suppressed_deal_ids` drop unconditionally.
- **Greg's opt-out rule**: `scripts/generate_suppressions.py` suppresses active `auto_replenish_schedules` deals (`1,058` rows) and **rep-confirmed marks (`source: rep_mark`) only**—never unreviewed AI detector output.

### 4. Holdout & Realistic £ Range (`scripts/holdout_readout.py`)
- **80% Treatment (`2,401` merchants) / 20% Holdout (`599` merchants)** via deterministic `(size_band, category)`-stratified `sha256` at `merchant_id` granularity (`pre_period_gp_diff_gbp = +£0.18`, `95% CI: [-£0.87, +£1.18]`).
- **v1 Pre-Freeze Annual Net GP Range (pre-launch scenario simulation)**: **£6,800 – £18,400/yr** (midpoint **£11,700/yr**), plus **£1,300/yr** post-freeze Band D upside; live post-launch ITT GP, net GP per rep-hour, and all 4 stop rules are measured by `scripts/holdout_readout.py --post-start ...`.
- **Readout Dates**: Early guardrail check **2026-12-11**; full 30-day ITT readout **2027-01-25**.

---

## Where AI Is Used & How We Checked It
- **Data hygiene first (`detector/clean.py`)**: Repaired **261** CP1252 mojibake notes and **81** replies, deduplicated **380** replay notes and **526** activities, filtered **1,400** `"Deal Alert sent"` pseudo-activities, and backfilled **3,239** pre-2025 blank `rep_id`s.
- **Hybrid extraction (`detector/extract.py`)**: Deterministic rule classifier runs 100% offline; optional `--llm` (`claude-haiku-5-5`, `thinking: disabled`, total spend **\$0.0343** of \$20 cap) enriches `neutral`/ambiguous merchants.
- **Anti-hallucination & downgrade guards**: Every quote must pass normalized substring verification (`0` unverified quotes across all `3,000` merchants), and `should_accept_llm_override()` blocks `--llm` from downgrading actionable signals (`M11006`) to `neutral`.
- **Rep ground-truth check**: Verified against Renee Walsh (`R10`) in [deliverables/renee_r10_calibration.md](deliverables/renee_r10_calibration.md).

---

## Deliberate Cut List (What We Cut & Why)
1. **Automated Cap Raises for Band A**: Ruled out by Greg until January and unsafe for capacity-constrained venues ahead of Peak freeze.
2. **Rewriting Routing's Ranking Formula or `env_overrides.json` Priors**: High blast radius right before Monday's freeze; wiring `suppress_soldout_tasks` captures the win with a 1-switch rollback.
3. **Live Per-Pageview LLM Calls**: Wastes the \$20 gateway cap, slows mobile loading, and breaks offline grading.
4. **Deal Alert Open/Click Logs & Booking Integration**: Provisioning takes days and misses Thursday 09:00; `deal_alert_replies.csv` and `auto_replenish_schedules.csv` already isolate the actionable cases.

## Current Limitations
- **Offline fallback mark persistence**: In `live_sandbox` mode, marks persist in the Sandbox API; in `offline_local` mode, marks persist in server memory until restart.
- **Hana diff sign-off**: `deliverables/greg_change_request.md` is ready for Wednesday 15:00 Change Review pending Hana's final diff review.
