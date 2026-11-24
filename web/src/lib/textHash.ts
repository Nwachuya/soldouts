import crypto from "node:crypto";

export interface TextSnippet {
  source_type: string;
  id: string;
  date: string;
  text: string;
}

const VALID_SIGNALS = new Set([
  "pause_auto_replenish",
  "merchant_opt_out",
  "capacity_refund_risk",
  "portal_or_terms_assist",
  "eager_restock",
  "self_served",
  "ooo_temporary",
  "neutral",
]);

function normalizeWs(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

/** Compute deterministic SHA-256 hash over a merchant's latest free-text records. */
export function computeMerchantTextHash(records: TextSnippet[]): string {
  if (records.length === 0) return "empty";
  const unique = Array.from(
    new Set(
      records.map(
        (r) => `${r.source_type}:${r.date.slice(0, 10)}:${normalizeWs(r.text)}`
      )
    )
  ).sort();
  return crypto.createHash("sha256").update(unique.join("\n"), "utf8").digest("hex").slice(0, 16);
}

/** Verify an LLM quote is a grounded substring (or exact short match) of actual merchant records. */
export function verifyQuoteInTexts(quote: string, records: TextSnippet[]): TextSnippet | null {
  let normQ = normalizeWs(quote);
  if (normQ.endsWith("...")) {
    normQ = normQ.slice(0, -3).trimEnd();
  }
  if (!normQ) return null;
  if (normQ.length < 6) {
    return records.find((r) => normQ === normalizeWs(r.text)) ?? null;
  }
  return records.find((r) => normalizeWs(r.text).includes(normQ)) ?? null;
}

/** Mirror Python's guard: prevent LLM from downgrading actionable signals to neutral or masking schedule/capacity blocks. */
export function shouldAcceptLlmOverride(deterministicSignal: string, llmSignal: string): boolean {
  if (!VALID_SIGNALS.has(llmSignal)) return false;
  if (deterministicSignal === "pause_auto_replenish") return false;
  if (deterministicSignal !== "neutral" && llmSignal === "neutral") return false;
  if (deterministicSignal === "capacity_refund_risk" && (llmSignal === "eager_restock" || llmSignal === "neutral")) {
    return false;
  }
  return true;
}
