import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { evaluateSoldout } from "./valuation.ts";

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
