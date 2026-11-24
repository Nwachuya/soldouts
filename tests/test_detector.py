import json
import tempfile
import unittest
from pathlib import Path

from detector.clean import clean_activities, clean_notes, fix_mojibake
from detector.cli import main as detector_cli_main
from detector.extract import (
    SourceRecord,
    analyze_merchant_offline,
    should_accept_llm_override,
    verify_quote_in_sources,
)


class DetectorTest(unittest.TestCase):
    def test_fix_mojibake_repairs_cp1252_and_preserves_clean_text(self):
        self.assertEqual(fix_mojibake("Weâ€™re at Â£30 — fine"), "We're at £30 — fine")
        self.assertEqual(fix_mojibake("Already clean £50"), "Already clean £50")

    def test_clean_notes_dedup_backfill_and_truncation(self):
        rows = [
            {"note_id": "N-1", "merchant_id": "M1", "rep_id": "", "created_at": "2024-01-01 10:00:00", "text": "Weâ€™re closed"},
            {"note_id": "N-2", "merchant_id": "M1", "rep_id": "", "created_at": "2024-01-01 10:00:00", "text": "We're closed"},
            {"note_id": "N-3", "merchant_id": "M2", "rep_id": "R10", "created_at": "2025-02-01 10:00:00", "text": "x" * 500},
        ]
        cleaned, stats = clean_notes(rows, {"M1": "R10"})
        self.assertEqual(len(cleaned), 2)
        self.assertEqual(stats["duplicates_removed"], 1)
        self.assertEqual(cleaned[0]["rep_id"], "R10")
        self.assertEqual(cleaned[0]["text"], "We're closed")
        self.assertTrue(cleaned[1]["is_truncated"])

    def test_clean_activities_removes_feb_deal_alert_noise_and_dups(self):
        rows = [
            {"activity_id": "A1", "merchant_id": "M1", "sold_out_id": "SO1", "activity_date": "2026-02-10", "type": "email", "owner_id": "R10", "duration_s": "", "subject": "Deal Alert sent"},
            {"activity_id": "A2", "merchant_id": "M1", "sold_out_id": "SO2", "activity_date": "2026-02-11", "type": "call", "owner_id": "R10", "duration_s": "180", "subject": "Restock call - cap raised"},
            {"activity_id": "A3", "merchant_id": "M1", "sold_out_id": "SO2", "activity_date": "2026-02-11", "type": "call", "owner_id": "R10", "duration_s": "180", "subject": "Restock call - cap raised"},
        ]
        cleaned, stats = clean_activities(rows)
        self.assertEqual(len(cleaned), 1)
        self.assertEqual(stats["duplicates_removed"], 1)
        self.assertEqual(stats["deal_alert_noise_removed"], 1)

    def test_pause_auto_replenish_and_quote_verification(self):
        recs = [
            SourceRecord("rep_note", "N-99", "2026-11-02", "Tariq wants nothing live over christmas. pause"),
        ]
        res = analyze_merchant_offline("M10547", recs, has_active_schedule=True)
        self.assertEqual(res["signal"], "pause_auto_replenish")
        self.assertTrue(res["quote_verified"])
        self.assertIsNotNone(verify_quote_in_sources(res["quote"], recs))
        self.assertIsNone(verify_quote_in_sources("hallucinated quote never written", recs))

    def test_llm_cannot_downgrade_actionable_signals(self):
        self.assertFalse(should_accept_llm_override("portal_or_terms_assist", "neutral"))
        self.assertFalse(should_accept_llm_override("pause_auto_replenish", "merchant_opt_out"))
        self.assertFalse(should_accept_llm_override("capacity_refund_risk", "eager_restock"))
        self.assertTrue(should_accept_llm_override("neutral", "eager_restock"))

    def test_short_exact_quote_verifies(self):
        recs = [SourceRecord("review", "RV-1", "2026-05-01", "Mint!")]
        self.assertIsNotNone(verify_quote_in_sources("Mint!", recs))
        self.assertIsNone(verify_quote_in_sources("M", recs))

    def test_offline_cli_end_to_end(self):
        with tempfile.TemporaryDirectory() as d:
            tmp = Path(d)
            (tmp / "merchants.csv").write_text("merchant_id,merchant_name,category,region,city,size_band,rep_id,joined,do_not_contact\nM1,Spa One,Health & Beauty,North,Leeds,A,R10,2020-01-01,0\n")
            (tmp / "rep_notes.csv").write_text("note_id,merchant_id,rep_id,created_at,text\nN1,M1,R10,2026-10-20,I know - leave it\n")
            (tmp / "deal_alert_replies.csv").write_text("reply_id,merchant_id,received_at,text\n")
            (tmp / "reviews.csv").write_text("review_id,merchant_id,deal_id,created_at,rating,text\n")
            (tmp / "refunds.csv").write_text("refund_id,merchant_id,deal_id,created_at,amount_gbp,reason_text\n")
            (tmp / "auto_replenish_schedules.csv").write_text("schedule_id,deal_id,merchant_id,start_date,end_date,cadence,top_up_qty,created_by\n")
            (tmp / "merchant_months.csv").write_text("merchant_id,month,gp_gbp,vouchers_sold,refunds_gbp,live_deals,sold_out_events\n")
            (tmp / "activities.csv").write_text("activity_id,merchant_id,sold_out_id,activity_date,type,owner_id,duration_s,subject\n")

            out_path = tmp / "signals.json"
            rc = detector_cli_main(["--input-dir", str(tmp), "--output", str(out_path), "--offline"])
            self.assertEqual(rc, 0)
            payload = json.loads(out_path.read_text(encoding="utf-8"))
            self.assertEqual(payload["signals"]["M1"]["signal"], "merchant_opt_out")
            self.assertTrue(payload["signals"]["M1"]["quote_verified"])


if __name__ == "__main__":
    unittest.main()
