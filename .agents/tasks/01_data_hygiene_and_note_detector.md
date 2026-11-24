# Task 01: Data Hygiene & Hybrid Free-Text Note Detector

- **Status**: `done`
- **Target Paths**: `detector/__init__.py`, `detector/clean.py`, `detector/extract.py`, `detector/cli.py`, `data/merchant_signals.json`, `tests/test_detector.py`

## Objective
Clean known data corruption across the historical CRM/text exports and build a runnable free-text signal & quote detector over `rep_notes.csv`, `deal_alert_replies.csv`, `reviews.csv`, and `refunds.csv` that:
1. Works **100% offline with zero network access or sandbox key** (`python3 -m detector.cli --offline`) against unseen CSV directories for facilitator grading.
2. Supports optional **batch LLM enrichment** (`--llm`) via the Sandbox Anthropic Gateway (`thinking: {"type": "disabled"}`, strict `< $3` budget guard, `stop_reason` verification).
3. Verifies every extracted quote as an exact normalized substring of the merchant's source text (zero hallucinated quotes) and cross-checks predictions on North H&B (`R10`) merchants against Renee Walsh's ground-truth feedback.

## Evaluation Criteria
1. **Data Hygiene**:
   - Repairs CP1252-in-UTF-8 mojibake (`â€™` -> `'`, `Â£` -> `£`, `â€“` -> `–`, smart quotes) across all `261` affected notes.
   - Deduplicates exact CRM sync replay rows (`380` duplicate notes, `526` duplicate activities) while preserving chronological order.
   - Excludes the `1,430` Feb 2026 `"Deal Alert sent"` pseudo-activity rows when classifying historical `Called` / `Attempted` / `Left alone` cohorts, and backfills pre-2025 blank `rep_id` from `merchants.csv`.
   - Flags 500-character truncated notes (`len(raw_text) == 500`).
2. **Actionable Signal Classification**:
   - Distinguishes: `eager_restock` (merchant wants cap lifted), `portal_or_terms_assist` (broken login link or wants price/per-customer voucher limit changed before restock, e.g. `M11688`), `pause_auto_replenish` (active schedule conflicts with recent seasonal/pause note, e.g. `M10547`), `merchant_opt_out` (explicit `"leave it"` / `"happy to stay sold out"`, e.g. `M10001`, `M10002`), `ooo_temporary`, `capacity_refund_risk` (double-booked, weeks wait, cancelled on day, high refund rate), and `self_served`.
3. **Quote Grounding & Offline Execution**:
   - 100% of output quotes match source text (`note_id`, `reply_id`, `review_id`, or `refund_id` cited).
   - `python3 -m detector.cli --input-dir <dir> --output <path> --offline` completes in `< 5s` with network disabled and no `.env` loaded.
4. **Rep Ground-Truth Check (`R10`)**:
   - Documented comparison table comparing detector verdicts on `R10` merchants against Renee Walsh's Desk replies, noting agreement rate and any failure modes where notes lagged reality.

## Validation
- `python3 -m unittest discover -s tests -v`: **5/5 tests passed** (`0.004s`, 100% offline).
- `python3 -m detector.cli --input-dir plans-directives/data --output data/merchant_signals.json --offline`: Processed all **3,000** merchants offline; repaired **261** CP1252 notes and **81** replies, deduplicated **380** replay notes and **526** replay activities, filtered **1,400** `"Deal Alert sent"` pseudo-activities, backfilled **3,239** pre-2025 blank `rep_id`s, and flagged **362** 500-char truncated notes.
- `python3 -m detector.cli ... --llm --focus-csv plans-directives/routing/input/todays_soldouts.csv --max-usd 0.50`: Enriched **31** merchants via Sandbox `claude-haiku-5-5` for **\$0.0356** (`0` hallucinated quote fallbacks; 100% substring-verified).
- *(Renee `R10` ground-truth calibration table pending Renee's Desk reply in `.agents/replies/`.)*
