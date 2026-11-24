import tempfile
import unittest
from pathlib import Path

from routing.plan import build_plan, load_config, load_priors, load_rows

ROWS = load_rows(Path(__file__).resolve().parent.parent / "input" / "todays_soldouts.csv")
BY_TASK = {r["task_id"]: r for r in ROWS}


class PlanTest(unittest.TestCase):
    def setUp(self):
        self.config = load_config()
        self.today, self.carried = build_plan(ROWS)
        self.ids = [p["task_id"] for p in self.today]

    def test_do_not_contact_never_listed(self):
        for p in self.today + self.carried:
            self.assertEqual(BY_TASK[p["task_id"]]["do_not_contact"], "0")

    def test_budget(self):
        self.assertLessEqual(len(self.today) * self.config["minutes_per_task"], self.config["minutes_per_day"])

    def test_callbacks_come_first(self):
        promised = [i for i in self.ids if BY_TASK[i]["callback_promised"] == "1"]
        self.assertEqual(self.ids[: len(promised)], promised)

    def test_failed_attempts_pause(self):
        for p in self.today + self.carried:
            r = BY_TASK[p["task_id"]]
            if r["callback_promised"] == "0":
                self.assertLess(int(r["failed_attempts"]), self.config["max_failed_attempts"])

    def test_suppressed_deals_get_no_task(self):
        suppressed = set(self.config["suppressed_deal_ids"])
        for p in self.today + self.carried:
            self.assertNotIn(p["deal_id"], suppressed)

    def test_ranked_by_expected_gp(self):
        gps = [p["expected_gp"] for p in self.today if p["reason"] == "restock"]
        self.assertEqual(gps, sorted(gps, reverse=True))

    def test_restock_priors_present(self):
        priors = load_priors()
        self.assertGreater(priors["restock"]["called"], priors["restock"]["left_alone"])

    def test_switch_off_ignores_suppression_file_for_rollback(self):
        with tempfile.TemporaryDirectory() as d:
            supp = Path(d) / "suppressions.csv"
            supp.write_text(
                "deal_id,merchant_id,reason,source,added_on\n"
                "D11006-2,M11006,auto-replenish,ops,2026-11-24\n"
                ",M10001,opt_out,rep_mark,2026-11-24\n"
            )
            cfg = dict(self.config, suppress_soldout_tasks=False, suppression_file=str(supp))
            today_off, carried_off = build_plan(ROWS, config=cfg)
            self.assertEqual(today_off, self.today)
            self.assertEqual(carried_off, self.carried)

    def test_switch_on_suppresses_deals_and_merchants_but_keeps_callbacks(self):
        with tempfile.TemporaryDirectory() as d:
            supp = Path(d) / "suppressions.csv"
            supp.write_text(
                "deal_id,merchant_id,reason,source,added_on\n"
                "D11006-2,M11006,auto-replenish weekly,ops,2026-11-24\n"
                ",M10001,merchant opt-out,rep_mark,2026-11-24\n"
                "D10002-1,M10002,auto-replenish weekly,ops,2026-11-24\n"
            )
            cfg = dict(self.config, suppress_soldout_tasks=True, suppression_file=str(supp))
            today_on, carried_on = build_plan(ROWS, config=cfg)
            all_items = today_on + carried_on
            all_deals = {p["deal_id"] for p in all_items}
            all_merchants = {p["merchant_id"] for p in all_items}

            # D11006-2 suppressed by deal_id, but sibling D11006-3 remains active
            self.assertNotIn("D11006-2", all_deals)
            self.assertIn("D11006-3", all_deals)
            # M10001 suppressed merchant-wide
            self.assertNotIn("M10001", all_merchants)
            # D10002-1 has callback_promised=1 -> preserved per explicit callback rule
            self.assertIn("D10002-1", all_deals)
            # Freed slots pull carried-over high-GP deals into today's list
            self.assertLess(len(carried_on), len(self.carried))


if __name__ == "__main__":
    unittest.main()
