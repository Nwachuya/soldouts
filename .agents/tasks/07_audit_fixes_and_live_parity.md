# Task 07: Audit Fixes, Detector Guardrails & Live Sandbox Parity

- **Status**: `done`
- **Target Paths**: `detector/extract.py`, `tests/test_detector.py`, `data/merchant_signals.json`, `web/src/data/bundle.json`, `web/src/app/api/merchants/[id]/route.ts`, `web/src/app/api/merchants/[id]/mark/route.ts`, `scripts/holdout_readout.py`

## Objective
Resolve all five inconsistencies surfaced during the self-audit of the build against `the_ask.md`, `handinguide.md`, and global rules:
1. **Live Sandbox Mode & Offline Dossier Parity**: Ensure `localhost:3000` can run with live Sandbox API access (`18` live `/soldouts/today` rows), pack recent notes/replies/reviews/refunds into `web/src/data/bundle.json` so `/merchant/[id]` is populated even offline, and persist `offline_local` marks in-memory for local reload consistency.
2. **Prevent LLM Downgrade of Actionable Signals**: Update `detector/extract.py` so `--llm` cannot overwrite an actionable deterministic signal (`pause_auto_replenish`, `merchant_opt_out`, `portal_or_terms_assist`, `capacity_refund_risk`) with `neutral` or mask `capacity_risk`.
3. **Fix Short-Quote Verification (`< 6` chars)**: Allow exact whole-record equality in `verify_quote_in_sources()` so legitimate short reviews (`"Mint!"`, `"Grand"`, `"10/10"`) verify as `quote_verified: true`.
4. **Clarify Annual £ Range Scope in `holdout_readout.py`**: Clearly label `£6,800 – £18,400/yr` as the v1 pre-freeze scope (auto-replenish + explicit opt-outs) and also report the incremental upside if Band D negative-EV tasks are suppressed post-freeze.
5. **Re-verify Global CSS & Mobile/Desktop UI**: Confirm `99vw`, `15px 20px` button padding, global typography, breadcrumbs, and zero horizontal overflow after the `bundle.json` / live server refresh.

## Evaluation Criteria
1. `unverified quotes` across all 3,000 merchants in `data/merchant_signals.json` drops from `4` to `0`.
2. `M11006` retains `portal_or_terms_assist` and `M11688` retains `capacity_refund_risk` / terms-edit visibility even when `--llm` runs.
3. `/merchant/[id]` displays non-empty recent notes/replies/reviews/refunds in both live and offline fallback modes, and `offline_local` marks persist across reloads.
4. `python3 -m unittest discover -s tests -v`, `routing` tests, `web` `npm test`, and `npm run build` all pass with zero regressions.

## Validation
- **Item 5 (Sync Updated Signals to `bundle.json`, Rebuild `web/`, & Live Parity Check)**:
  - Synced updated `data/merchant_signals.json` into `web/src/data/bundle.json` (`M11006` and `M11688` both `portal_or_terms_assist`).
  - `cd web && npm test && npm run build`: **1/1 TypeScript test passed** (`0.67ms`), production build succeeded.
  - Restarted `localhost:3000` (`task-347`): `/api/soldouts/today` returned `mode: "live_sandbox"` (`23` live sold-outs), `/api/merchants/M11006` returned `portal_or_terms_assist` (`6` notes, `2` replies), and `/api/merchants/M11688` returned `portal_or_terms_assist` (`5` replies).
- **Item 4 (Clarify Annual £ Range Scope in `scripts/holdout_readout.py`)**:
  - Updated `scripts/holdout_readout.py` to label `v1_pre_freeze_annual_net_gp_range_gbp` (`£6,800 – £18,400/yr`, midpoint `£11,700/yr`) explicitly as v1 pre-freeze scope (`487` auto-replenish calls/yr + `6,907` unworked Band A/B deals) and separately report `post_freeze_band_d_upside_gbp` (`£1,300/yr` across `368` called Band D deals/yr).
  - `PYTHONPATH=.:routing python3 -m unittest discover -s tests -v`: **13/13 tests passed** (`0.009s`).
- **Item 3 (Short-Quote Verification `< 6` chars & Guarded LLM Re-run)**:
  - Updated `verify_quote_in_sources()` in `detector/extract.py` to accept exact whole-record matches for `< 6`-char quotes and added `test_short_exact_quote_verifies` in `tests/test_detector.py` (**13/13 tests passed**, `0.007s`).
  - Regenerated `data/merchant_signals.json` with guarded `--llm` (`23` enriched, `$0.0343` cost, `0` fallbacks): **`0` unverified quotes** across all `3,000` merchants; `M11006` preserved as `portal_or_terms_assist` and `M11688` classified as `portal_or_terms_assist`.
- **Item 2 (Prevent LLM Downgrade of Actionable Signals)**:
  - Added `should_accept_llm_override()` in `detector/extract.py` blocking `--llm` from downgrading actionable deterministic signals (`portal_or_terms_assist`, `pause_auto_replenish`, `capacity_refund_risk`, `merchant_opt_out`) to `neutral` or masking schedule/capacity blocks.
  - Added `test_llm_cannot_downgrade_actionable_signals` in `tests/test_detector.py`: **12/12 tests passed** (`0.009s`).
- **Item 1 (Live Sandbox Mode & Offline Dossier Parity)**:
  - Packed recent `notes`, `replies`, `reviews`, `refunds`, and `schedules` into `web/src/data/bundle.json` (`6,406.2 KB`) and added `web/src/lib/offlineMarks.ts` for in-memory `offline_local` mark persistence across reloads.
  - `cd web && npm test && npm run build`: **1/1 TypeScript test passed**, production build succeeded.
  - Restarted `localhost:3000` (`task-292`) with Sandbox API access: `/api/soldouts/today` returned `mode: "live_sandbox"` (`21` live sold-outs, `suppress_soldout_tasks: false`) and `/api/merchants/M10547` returned `mode: "live_sandbox"` (`10` notes, `3` schedules).
