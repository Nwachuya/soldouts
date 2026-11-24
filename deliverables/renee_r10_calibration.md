# Renee Walsh (`R10`) Ground-Truth Calibration

Cross-check of our detector (`detector/extract.py`) and deterministic valuation engine (`valuation/engine.py`) against Renee Walsh's (`R10`, North H&B) real-world knowledge of 5 merchants in `todays_soldouts.csv`:

| Merchant | Renee (`R10`) Feedback | Detector Signal & Quote | Valuation Action & Net EV | Agreement & Takeaway |
|---|---|---|---|---|
| **Bright Skin & Spa (`M10001`)** | *"tasha leave"* | `merchant_opt_out` — *"I know - leave it. T"* (`deal_alert_reply`, `2026-09-23`) | **`DONT_BOTHER`** (`£0.00`) | **Exact match.** |
| **The Linen Room (`M10002`)** | *"fiona leave"* | `merchant_opt_out` — *"this is deliberate. Happy to stay sold out."* (`deal_alert_reply`, `2026-10-07`) | **`CALL_CALLBACK`** *(with warning: "note/reply warns full — check before raising cap")* | **Important edge case:** `todays_soldouts.csv` had `callback_promised=1`, which keeps the task per Hana's default callback rule. Surfacing the warning quote in the UI lets Renee mark `no_call` in one tap. |
| **The Aster Day Spa (`M10547`)** | *"aster day spa pause thing idk, would have to check"* | `pause_auto_replenish` — *"Tariq wants nothing live over christmas. pause"* (`rep_note`, `2026-11-02`) | **`PAUSE_SCHEDULE`** (`-£3.00` assist slot) | **High-value catch:** Even Renee couldn't recall the Nov 2 note from memory; the tool flagged the conflict against her active monthly auto-replenish schedule. |
| **Fern Beauty Rooms (`M11688`)** | *"fern ring"* | `portal_or_terms_assist` — *"sold out is great but i want to up the price to £30 first"* (`deal_alert_reply`, `2026-06-10`) | **`ASSIST_DEAL_OR_LINK`** (`+£15.51` net EV) | **Match:** Correctly routes as a terms-edit call rather than a blind top-up (after Task 7 Item 2/3 prevented LLM/capacity masking). |
| **Willow Aesthetics (`M10127`)** | *"willow ring"* | `neutral` — *"met Giorgio at the cafe nearby. 10 mins. all good"* (`rep_note`, `2026-04-07`) | **`CALL`** (`+£14.39` net EV) | **Exact match.** |
