# Task 03: Routing Suppression Service Change

- **Status**: `done`
- **Target Paths**: `routing/` (copied from `plans-directives/routing/`), `routing/routing/plan.py`, `routing/tests/test_plan.py`, `routing/tests/test_config.py`

## Objective
Wire sold-out task suppression into the Merchant Ops `routing` service (`routing.zip`) so redundant/unwanted restock tasks stop landing on reps' morning lists when switched on—while keeping the switch **off by default**, honoring `config/env_overrides.json` precedence, providing instant single-switch rollback, preserving importer compatibility, and addressing every operational trap flagged by Hana Kowalczyk.

## Evaluation Criteria
1. **Zero-Regression Default (`suppress_soldout_tasks: false`)**:
   - Shipped `config/routing.json` keeps `"suppress_soldout_tasks": false` and shipped `input/suppressions.csv` remains header-only so existing `test_suppress_switch_is_off_by_default` and `test_shipped_suppression_file_is_empty` pass unchanged.
   - With switch `false`, `build_plan()` output on `input/todays_soldouts.csv` is byte-for-byte identical to unmodified v2.15.0 (even if a suppression file contains rows).
2. **Suppression Wiring (`suppress_soldout_tasks: true`)**:
   - Loads `config["suppression_file"]` (resolved cleanly against `ROOT` when relative) via `routing.suppressions.load_suppressions()`.
   - Suppresses deal-specific rows (`deal_id` set) and merchant-wide rows (`merchant_id` set with blank `deal_id`), allowing carried-over high-GP restock tasks to move up into the rep's 210-minute daily budget.
3. **Operational Traps Handled (Hana Alignment)**:
   - `config/env_overrides.json` only sets `priors.restock` (`0.46 / 0.43`) with no `suppressed_deal_ids` clash; `env_overrides.json` `routing.suppress_soldout_tasks` overrides `config/routing.json` in both directions (`true` over `false` and `false` over `true`).
   - **Explicit `callback_promised` Rule (stated in diff)**: `callback_promised == "1"` **beats** `suppressions.csv` (because a rep promised the merchant a call), while `do_not_contact == "1"` and Ops `suppressed_deal_ids` still drop unconditionally.
   - **Ownership & Feeding of `suppressions.csv`**: Owned by **Merchant Ops**; seeded once pre-freeze via `scripts/generate_suppressions.py` (80% treatment arm) and refreshed nightly post-freeze before the 07:00 run.
   - Input CSV column order is untouched (importer depends on column order; any future columns go at the end).
4. **Offline Test Suite**:
   - `python3 -m unittest discover -s tests -v` inside `routing/` passes 100% offline with zero external dependencies.

## Validation
- `cd routing && python3 -m unittest discover -s tests -v`: **14/14 tests passed** (`0.005s`, 100% offline), including all 11 original tests plus `test_switch_off_ignores_suppression_file_for_rollback`, `test_switch_on_suppresses_deals_and_merchants_but_keeps_callbacks`, and `test_env_overrides_beats_routing_json_for_switch`.
- `python3 -m routing.plan input/todays_soldouts.csv`: Runs cleanly with `suppress_soldout_tasks: false` (default), producing `17` today tasks + `16` carried over (identical to v2.15.0).
