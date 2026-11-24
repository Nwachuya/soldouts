# Task 04: Holdout Design, Suppression Generator & Readout Script

- **Status**: `done`
- **Target Paths**: `scripts/generate_suppressions.py`, `scripts/holdout_readout.py`, `deliverables/suppressions_treatment.csv`, `tests/test_holdout.py`

## Objective
Design a Peak-freeze-compatible merchant-level holdout experiment and build offline scripts that:
1. Generate the production-ready `suppressions.csv` artifact (`deal_id,merchant_id,reason,source,added_on`) scoped to the treatment arm (aligned with Greg's approved suppression scope).
2. Estimate a defensible **current annual net GP range** from historical simulation for Dan's Friday meeting.
3. Read out the **real post-launch number** (Intent-to-Treat 30-day net GP per sold-out and per rep-hour, refund guardrails, and 95% confidence intervals) on a stated calendar date once the 30-day post-sold-out GP window closes.

## Evaluation Criteria
1. **Leak-Free Stratified Holdout**:
   - Deterministic hash assignment at `merchant_id` granularity (80% Treatment / 20% Holdout), stratified by `(size_band, category)` so multi-deal merchants never split across treatment and holdout.
   - Pre-period baseline monthly GP and sold-out rates balanced within `±5%` between arms.
2. **Suppression File Validity**:
   - Generated `deliverables/suppressions_treatment.csv` passes `routing.suppressions.load_suppressions()` validation cleanly with populated `reason`, `source`, and `added_on` audit columns.
3. **Readout Script (`scripts/holdout_readout.py`)**:
   - Runs 100% offline against historical or post-experiment CSVs (`--data-dir`).
   - Outputs: (a) simulated annual £ GP range (conservative to upper bound, explaining divergence from Priya's £340k), (b) ITT treatment vs. holdout 30-day GP & net GP per rep-hour with 95% bootstrap CI, (c) guardrail checks (refund rate delta, auto-replenish restock rate delta) flagging whether Greg's stop rule tripped, and (d) exact calendar readout date.

## Validation
- `PYTHONPATH=.:routing python3 -m unittest discover -s tests -v`: **13/13 tests passed** (`0.008s`, 100% offline), including stratified `(size_band, category)` balance, `net_gp_per_rep_hour_diff`, and all 4 stop rules.
- `PYTHONPATH=. python3 -m scripts.generate_suppressions`: Generated `deliverables/suppressions_treatment.csv` with **1,058 rows** (`1,058` active auto-replenish deals across `2,401` treatment merchants; `599` holdout merchants untouched; opt-outs sourced strictly from rep marks via `--marks-json` per Greg's condition).
- `PYTHONPATH=. python3 -m scripts.holdout_readout --data-dir plans-directives/data`: Verified stratified holdout balance (`pre_period_gp_diff_gbp: 0.18`, `95% CI: [-0.87, 1.18]`, `balanced: true`), scenario-simulated annual net GP range **£6,800 – £18,400** (midpoint **£11,700**, +**£1,300** post-freeze Band D upside), early guardrail check **2026-12-11**, and full 30d ITT readout **2027-01-25**.
