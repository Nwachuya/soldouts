# Task 02: Deterministic Valuation Engine ("The Money, in Code")

- **Status**: `done`
- **Target Paths**: `valuation/__init__.py`, `valuation/engine.py`, `valuation/priors_calibrated.json`, `tests/fixtures/valuation_vectors.json`, `tests/test_valuation.py`

## Objective
Implement the pure-code expected net GP valuation and action recommendation engine per sold-out event—incorporating expected GP lift from a cap raise, minus rep call/attempt time cost, minus post-sale refund/capacity risk—with **zero arithmetic delegated to an LLM**, and export shared test vectors so Python scripts and the Next.js rep UI produce identical £ numbers.

## Evaluation Criteria
1. **Empirical Calibration**:
   - Derives clean band/category restock lift priors from historical data after removing active `auto_replenish` deals (`5,690` rows), Feb 2026 `"Deal Alert sent"` noise (`1,430` rows), and pre-call self-restocks (`500` rows), accounting for within-merchant baseline selection.
2. **Explicit Net £ Formula in Code**:
   - Computes gross expected 30-day GP lift, late-refund/capacity risk deduction (from `merchant_months.csv` refund ratio + review/refund distress flags), and rep slot cost (`12 min` task allocation from `routing.json`).
   - Correctly scores Band D low-value tasks and active `auto_replenish` tasks as net non-call (`<= £0` incremental net EV), while surfacing high-EV Band A/B restocks and warm Deal Alert hand-raises.
3. **Rule Precedence & Transparency**:
   - Enforces hard deterministic overrides (`do_not_contact == 1`, active `auto_replenish` with vs. without pause conflict, `already_restocked`, `merchant_opt_out`, `callback_promised == 1`, `rep_mark`).
   - Returns structured breakdown (`gross_lift_gbp`, `rep_time_cost_gbp`, `refund_risk_penalty_gbp`, `net_ev_gbp`, `recommended_action`, `plain_reason`) for auditability.
4. **Cross-Runtime Parity**:
   - Exports deterministic JSON test vectors (`tests/fixtures/valuation_vectors.json`) verified by both Python `unittest` and Next.js TypeScript tests to `±£0.01`.

## Validation
- Calibrated clean within-merchant fixed-effects 30-day GP lifts (excluding active auto-replenish, Feb 2026 Deal Alert pseudo-activities, and pre-call self-restocks): **Band A `£8.23` (`21.3%`)**, **Band B `£6.06` (`31.0%`)**, **Band C `£2.58` (`20.1%`)**, **Band D `£1.92` (`32.2%`)**; stored in `valuation/priors_calibrated.json` alongside `£5.50` rep call slot cost (`12 min` at `£27.50/hr`) and `£3.00` assist slot cost.
- `python3 -m unittest discover -s tests -v`: **8/8 tests passed** (`0.004s`, 100% offline), including all 6 shared cross-runtime vectors in `tests/fixtures/valuation_vectors.json`, callback precedence warnings, and DNC/`no_call` overrides.
