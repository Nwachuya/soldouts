import json
import tempfile
import unittest
from pathlib import Path

from routing.suppressions import load_suppressions
from scripts.generate_suppressions import generate_suppressions
from scripts.holdout import stratified_assign_arms
from scripts.holdout_readout import compute_readout


class HoldoutTest(unittest.TestCase):
    def test_stratified_assign_arms_balances_every_stratum(self):
        merchants = []
        for idx, (band, cat) in enumerate([("A", "Health & Beauty"), ("B", "Food & Drink"), ("D", "Things to Do")]):
            for j in range(10):
                merchants.append({"merchant_id": f"M{idx}{j:03d}", "size_band": band, "category": cat})
        arms = stratified_assign_arms(merchants, holdout_pct=20)
        self.assertEqual(arms, stratified_assign_arms(merchants, holdout_pct=20))
        # Every 10-merchant stratum gets exact 2 holdout / 8 treatment
        for idx in range(3):
            h_count = sum(1 for j in range(10) if arms[f"M{idx}{j:03d}"] == "holdout")
            self.assertEqual(h_count, 2)

    def test_generate_suppressions_respects_holdout_and_schema(self):
        with tempfile.TemporaryDirectory() as d:
            tmp = Path(d)
            data_dir = tmp / "data"
            data_dir.mkdir()

            merchants = [
                {"merchant_id": f"M{i}", "size_band": "B", "category": "Health & Beauty"}
                for i in range(10000, 10010)
            ]
            arms = stratified_assign_arms(merchants)
            t_mids = [m["merchant_id"] for m in merchants if arms[m["merchant_id"]] == "treatment"][:2]
            t_mid, t_opt_mid = t_mids[0], t_mids[1]
            h_mid = next(m["merchant_id"] for m in merchants if arms[m["merchant_id"]] == "holdout")

            m_lines = ["merchant_id,merchant_name,category,region,city,size_band,rep_id,joined,do_not_contact"]
            for m in merchants:
                m_lines.append(f"{m['merchant_id']},Spa {m['merchant_id']},Health & Beauty,North,Leeds,B,R10,2020-01-01,0")
            (data_dir / "merchants.csv").write_text("\n".join(m_lines) + "\n")

            (data_dir / "auto_replenish_schedules.csv").write_text(
                f"schedule_id,deal_id,merchant_id,start_date,end_date,cadence,top_up_qty,created_by\n"
                f"AR1,D1,{t_mid},2025-01-01,,weekly,10,ops\n"
                f"AR2,D2,{h_mid},2025-01-01,,weekly,10,ops\n"
                f"AR3,D3,{t_mid},2025-01-01,2027-06-01,weekly,10,ops\n"
                f"AR4,D4,{t_mid},2025-01-01,2026-01-01,weekly,10,ops\n"
            )
            sig_path = tmp / "signals.json"
            sig_path.write_text(json.dumps({"signals": {t_mid: {"signal": "neutral"}, t_opt_mid: {"signal": "merchant_opt_out"}, h_mid: {"signal": "merchant_opt_out"}}}))
            marks_path = tmp / "marks.json"
            marks_path.write_text(json.dumps({"data": [{"merchant_id": t_opt_mid, "mark": "no_call", "marked_by": "R10"}, {"merchant_id": h_mid, "mark": "no_call", "marked_by": "R10"}]}))
            out_csv = tmp / "suppressions.csv"

            counts = generate_suppressions(data_dir, sig_path, out_csv, added_on="2026-11-25", marks_path=marks_path)
            loaded = load_suppressions(out_csv)
            self.assertEqual(len(loaded), 3)
            self.assertEqual({r["deal_id"] for r in loaded if r["deal_id"]}, {"D1", "D3"})
            self.assertEqual({r["merchant_id"] for r in loaded}, {t_mid, t_opt_mid})
            self.assertEqual(counts["auto_replenish_deals"], 2)
            self.assertEqual(counts["rep_mark_opt_outs"], 1)
            self.assertEqual(counts["holdout_merchants"], 2)

    def test_holdout_readout_net_gp_per_rep_hour_and_all_stop_rules(self):
        with tempfile.TemporaryDirectory() as d:
            tmp = Path(d)
            merchants = [
                {"merchant_id": f"M{i}", "size_band": "A", "category": "Health & Beauty"}
                for i in range(10000, 10005)
            ]
            arms = stratified_assign_arms(merchants)
            t_mid = next(m["merchant_id"] for m in merchants if arms[m["merchant_id"]] == "treatment")
            h_mid = next(m["merchant_id"] for m in merchants if arms[m["merchant_id"]] == "holdout")

            m_lines = ["merchant_id,merchant_name,category,region,city,size_band,rep_id,joined,do_not_contact"]
            for m in merchants:
                m_lines.append(f"{m['merchant_id']},M,Health & Beauty,North,Leeds,A,R10,2020-01-01,0")
            (tmp / "merchants.csv").write_text("\n".join(m_lines) + "\n")

            (tmp / "sold_out_deals.csv").write_text(
                f"sold_out_id,deal_id,merchant_id,sold_out_date,cap,restocked_date,new_cap,gp_30d_after_gbp\n"
                f"SO1,D1,{t_mid},2026-12-01,50,2026-12-02,70,45.00\n"
                f"SO2,D2,{h_mid},2026-12-01,50,2026-12-02,70,20.00\n"
            )
            (tmp / "auto_replenish_schedules.csv").write_text(
                f"schedule_id,deal_id,merchant_id,start_date,end_date,cadence,top_up_qty,created_by\n"
                f"AR1,D1,{t_mid},2026-01-01,,weekly,10,ops\n"
                f"AR2,D2,{h_mid},2026-01-01,,weekly,10,ops\n"
            )
            (tmp / "merchant_months.csv").write_text(
                f"merchant_id,month,gp_gbp,vouchers_sold,refunds_gbp,live_deals,sold_out_events\n"
                f"{t_mid},2026-12,200.0,10,10.0,1,1\n"
                f"{h_mid},2026-12,200.0,10,10.0,1,1\n"
            )
            (tmp / "activities.csv").write_text(
                f"activity_id,merchant_id,sold_out_id,activity_date,type,owner_id,duration_s,subject\n"
                f"A1,{t_mid},SO1,2026-12-01,call,R10,180,Restock call\n"
                f"A2,{h_mid},SO2,2026-12-01,call,R10,180,Restock call\n"
            )

            out = compute_readout(tmp, launch_date_str="2026-11-26", post_start="2026-11-26", escalations=0)
            itt = out["post_launch_itt"]
            self.assertEqual(itt["itt_30d_gp_lift_gbp"], 25.0)
            self.assertEqual(itt["net_gp_per_rep_hour_diff"], 125.0)
            self.assertFalse(itt["stop_rule_triggered"])

            # Verify escalations > 2 triggers stop rule
            out_esc = compute_readout(tmp, launch_date_str="2026-11-26", post_start="2026-11-26", escalations=3)
            self.assertTrue(out_esc["post_launch_itt"]["stop_rules_detail"]["escalations_gt_2"])
            self.assertTrue(out_esc["post_launch_itt"]["stop_rule_triggered"])


if __name__ == "__main__":
    unittest.main()
