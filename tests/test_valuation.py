import json
import unittest
from pathlib import Path

from valuation.engine import evaluate_soldout

VECTORS_PATH = Path(__file__).resolve().parent / "fixtures" / "valuation_vectors.json"


class ValuationTest(unittest.TestCase):
    def test_shared_valuation_vectors(self):
        vectors = json.loads(VECTORS_PATH.read_text(encoding="utf-8"))
        for vec in vectors:
            with self.subTest(vec["name"]):
                res = evaluate_soldout(**vec["input"])
                for k, expected_val in vec["expected"].items():
                    self.assertEqual(res[k], expected_val)

    def test_callback_promised_beats_opt_out_and_warns(self):
        res = evaluate_soldout(
            size_band="A",
            value_30d_gbp=178.13,
            signal="merchant_opt_out",
            has_active_schedule=True,
            callback_promised=True,
        )
        self.assertEqual(res["action"], "CALL_CALLBACK")
        self.assertIn("check before raising cap", res["plain_reason"])

    def test_do_not_contact_and_rep_mark_override_everything(self):
        dnc = evaluate_soldout(size_band="A", value_30d_gbp=500.0, do_not_contact=True, callback_promised=True)
        self.assertEqual(dnc["action"], "DONT_BOTHER")
        self.assertEqual(dnc["net_ev_gbp"], 0.0)

        marked = evaluate_soldout(size_band="A", value_30d_gbp=500.0, rep_mark="no_call")
        self.assertEqual(marked["action"], "DONT_BOTHER")
        self.assertEqual(marked["net_ev_gbp"], 0.0)


if __name__ == "__main__":
    unittest.main()
