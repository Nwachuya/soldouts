# Product Requirements Document (PRD): UK Local Sold-Outs Triage & Routing Suppression

## 1. Problem & Strategic Context
UK Local generates ~600 morning restock tasks per week whenever a deal hits its voucher cap. Currently, the overnight `routing` service creates a restock task for **every** sold-out deal without visibility into active auto-replenish schedules, Deal Alert replies, customer refund/capacity distress, or rep call notes. Reps dislike chasing dead-end tasks, while genuinely lucrative restocks sit buried or carried over beyond the 210-minute daily budget (17 tasks/day at 12 min/task).

At the same time, Peak change freeze runs from **Monday through 7 January**, and Merchant Ops (Greg Lindqvist & Hana Kowalczyk) requires low-blast-radius changes with a single off-by-default switch (`suppress_soldout_tasks`), instant config rollback, and explicit stop criteria ahead of Wednesday's 15:00 change review.

---

## 2. Empirical Reality vs. Naive Assumptions
An audit of the 30,534 sold-outs in Priya Nair's Oct 2025 – Sep 2026 analysis window revealed five major confounders in the headline "£11 GP/call (£340k/yr)" figure:

1. **Active Auto-Replenish Schedules Ignored (`5,690` events / `18.6%`)**: Deals on active `auto_replenish_schedules.csv` top up automatically; calling them yields ~£0 incremental lift (**-£2.60** in Health & Beauty).
2. **Reverse Causality (`500` of `5,333` restocked calls / `9.4%`)**: The deal restocked *before* the rep's logged call date (e.g., merchant self-served via Deal Alert link), yet the subsequent 30-day GP was credited to the call.
3. **Feb 2026 CRM Migration Artefact (`1,430` events)**: Automated `"Deal Alert sent"` emails were logged in `activities.csv` with a `sold_out_id`, misclassifying left-alone deals into `Attempted`.
4. **Within-Band Selection Bias & Rep Time Cost**: Controlling for merchant fixed effects (excluding auto-replenish), gross 30-day GP lift is **£13.42** (Band A), **£8.60** (Band B), **£3.66** (Band C), and **£2.16** (Band D). Once a 12-minute rep task slot (~£6.00 loaded cost / opportunity cost) is deducted, **Band D and most of Band C are net-negative to chase by phone**.
5. **Capacity & Late-Refund Risk (`7.8%` refund ratio)**: Over-capping capacity-constrained salons, spas, and restaurants triggers double-bookings, cancellations, and post-30-day refunds (`merchant_months.csv`, `reviews.csv`, `refunds.csv`). Furthermore, free-text notes reveal critical non-call actions—such as pausing an active auto-replenish schedule before Christmas (`M10547`) or editing deal price/per-customer voucher limits (`M11688`).

---

## 3. Core Architecture & Pillars

1. **Free-Text Hygiene & Hybrid Signal Detector (`detector/`)**:
   - Repairs Windows-1252 mojibake (`261` notes), deduplicates CRM sync replay duplicates (`380` notes, `526` activities), and strips Feb 2026 `"Deal Alert sent"` pseudo-activities.
   - Extracts structured action signals and **substring-verified verbatim quotes** across `rep_notes.csv`, `deal_alert_replies.csv`, `reviews.csv`, and `refunds.csv`.
   - Operates in two modes from a single CLI (`python3 -m detector.cli`):
     - **Batch LLM Mode (`--llm`)**: Uses the Sandbox Anthropic Gateway (`claude-haiku-5-5` / `claude-sonnet-5-5`, `thinking` disabled, budget guard $< \$3$ of the \$20 cap) to build cached merchant intelligence.
     - **Offline Deterministic Mode (`--offline`, default without API key/network)**: Pure-Python lexical/rule classifier outputting the exact same schema and verified quotes so facilitators can run tests and unseen-data evaluations completely offline.
   - Calibrated against North H&B rep **Renee Walsh (`R10`)**.

2. **Deterministic Valuation Engine (`valuation/` & `web/src/lib/valuation.ts`)**:
   - Pure code computes every £ figure—never the LLM:
     $$\text{Net EV (£)} = \max(0,\; \Delta P_{\text{call}} \times \text{GP}_{30\text{d, baseline}} \times (1 - r_{\text{refund\_penalty}})) - C_{\text{rep\_slot}}$$
   - Assigns each sold-out to a concrete rep directive (`CALL`, `CALL_CALLBACK`, `ASSIST_DEAL_OR_LINK`, `PAUSE_SCHEDULE`, `HOLD_CAP_RISK`, or `DONT_BOTHER` with exact reason).

3. **Gated Routing Suppression (`routing/`)**:
   - Wires `suppress_soldout_tasks` (default `false`) and `input/suppressions.csv` into `routing/routing/plan.py`.
   - Honors `config/env_overrides.json` precedence over `config/routing.json`; preserves byte-for-byte legacy output when `false`; protects `callback_promised == "1"` (subject to Hana's confirmation); rolls back via one boolean switch with zero code deploy.

4. **Holdout & Readout Pipeline (`scripts/`)**:
   - Deterministic merchant-level hash split (`80%` Treatment / `20%` Holdout, stratified by `size_band` and `category` to prevent multi-deal merchant spillover).
   - Offline readout script (`scripts/holdout_readout.py`) outputs both our pre-launch simulated annual net GP range and post-launch Intent-to-Treat (ITT) 30-day net GP lift, refund guardrails, and 95% bootstrap confidence intervals.

5. **Phone-First Rep Web App (`web/`)**:
   - Next.js (App Router, TypeScript), Tailwind CSS v4, `lucide-react`, and `coss` UI primitives.
   - Server-only `.env` handling (`BASE_URL`, `KEY`), live `/soldouts/today` triage cards, transparent £ EV breakdown, verbatim evidence quotes, live merchant marking (`PUT` / `DELETE /merchants/{id}/mark`), read-only `GET /routing/switch` status (**never** calling `PUT /routing/switch` without Greg's written OK), and offline snapshot fallback.
   - Enforces global layout & CSS standards: fixed top navbar (`99vw`), `99vw` page/footer, global CSS typography (smaller on mobile), `15px 20px` button padding, breadcrumbs instead of "Go back" buttons, favicon, and smooth `200ms ease-in-out` transitions.

---

## 4. Deliberate Scope Cuts (What We Cut & Why)
1. **Automated Cap Raises for Band A Merchants**: Explicitly ruled out by Greg before January, unsafe ahead of Monday's Peak freeze, and hazardous for capacity-limited venues during Christmas rush.
2. **Rewriting Routing's Ranking Math or `env_overrides.json` Priors**: Changing ranking formulas right before Peak freeze creates unnecessary blast radius across every rep's queue; gating task suppression behind `suppress_soldout_tasks` delivers the gain with 1-switch rollback.
3. **Live Per-Pageview LLM Calls in the Rep UI**: Wastes the \$20 gateway cap, slows mobile load times, and breaks offline; pre-extracted signals + deterministic fallback load in `<100ms`.
4. **Deal Alert Open/Click Logs & External Booking Systems**: Access takes days and misses Thursday 09:00; `deal_alert_replies.csv` and `auto_replenish_schedules.csv` already isolate the actionable cases.

---

## 5. Governance & Task Tracking
- Every discrete engineering and deliverable workstream is tracked in `.agents/tasks/01_*.md` through `06_*.md` with explicit **Objective**, **Evaluation Criteria**, and **Validation Results**.
- **No changes or commits** proceed without passing the user approval gateway.
- **Git and Netlify** remain completely deferred until all builds and local testing are completed and validated.
