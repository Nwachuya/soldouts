import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { evaluateSoldout } from "./valuation.ts";
import { computeMerchantTextHash, shouldAcceptLlmOverride, verifyQuoteInTexts } from "./textHash.ts";

test("TypeScript valuation matches shared Python test vectors", () => {
  const vectorsPath = path.resolve(process.cwd(), "../tests/fixtures/valuation_vectors.json");
  const vectors = JSON.parse(fs.readFileSync(vectorsPath, "utf-8"));

  for (const vec of vectors) {
    const res = evaluateSoldout(vec.input);
    for (const [k, expectedVal] of Object.entries(vec.expected)) {
      assert.equal(
        res[k as keyof typeof res],
        expectedVal,
        `Mismatch on ${vec.name}.${k}: got ${res[k as keyof typeof res]}, expected ${expectedVal}`
      );
    }
  }
});

test("textHash detects new/changed merchant text and ignores duplicate ordering", () => {
  const a = [{ source_type: "rep_note", id: "N1", date: "2026-11-01", text: "Hello  world" }];
  const b = [{ source_type: "rep_note", id: "N9", date: "2026-11-01", text: "hello world" }];
  const c = [...a, { source_type: "deal_alert_reply", id: "R1", date: "2026-11-10", text: "Yes top up!" }];

  assert.equal(computeMerchantTextHash(a), computeMerchantTextHash(b));
  assert.notEqual(computeMerchantTextHash(a), computeMerchantTextHash(c));
  assert.ok(verifyQuoteInTexts("yes top up!", c));
  assert.equal(verifyQuoteInTexts("not in text", c), null);
  assert.equal(shouldAcceptLlmOverride("portal_or_terms_assist", "neutral"), false);
  assert.equal(shouldAcceptLlmOverride("neutral", "eager_restock"), true);
});
