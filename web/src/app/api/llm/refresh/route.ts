import { NextResponse } from "next/server";
import { readRuntimeCache, writeRuntimeCache } from "@/lib/cacheStore";
import { BUNDLE, getBundleTextSnippets, getMerchantSignal } from "@/lib/enrich";
import { sandboxFetch } from "@/lib/sandbox";
import {
  computeMerchantTextHash,
  shouldAcceptLlmOverride,
  verifyQuoteInTexts,
  type TextSnippet,
} from "@/lib/textHash";

export const dynamic = "force-dynamic";

const MAX_BATCH_USD = 0.25;

function getSnippetsForMerchant(
  mid: string,
  cache: ReturnType<typeof readRuntimeCache>
): TextSnippet[] {
  const ov = cache.history_overrides[mid];
  if (!ov) return getBundleTextSnippets(mid);
  return [
    ...(ov.notes ?? []).map((n) => ({ source_type: "rep_note", id: String(n.note_id ?? ""), date: String(n.created_at ?? ""), text: String(n.text ?? "") })),
    ...(ov.replies ?? []).map((r) => ({ source_type: "deal_alert_reply", id: String(r.reply_id ?? ""), date: String(r.received_at ?? ""), text: String(r.text ?? "") })),
    ...(ov.reviews ?? []).map((rv) => ({ source_type: "review", id: String(rv.review_id ?? ""), date: String(rv.created_at ?? ""), text: String(rv.text ?? "") })),
    ...(ov.refunds ?? []).map((rf) => ({ source_type: "refund", id: String(rf.refund_id ?? ""), date: String(rf.created_at ?? ""), text: String(rf.reason_text ?? "") })),
  ];
}

export async function POST() {
  const cache = readRuntimeCache();
  const snapshot = cache.soldouts_snapshot ?? BUNDLE.fallback_soldouts;
  const uniqueMids = Array.from(new Set(snapshot.map((r) => String(r.merchant_id ?? "")).filter(Boolean)));

  const pending: Array<{ mid: string; hash: string; snippets: TextSnippet[] }> = [];
  let skippedUnchanged = 0;

  for (const mid of uniqueMids) {
    const snippets = getSnippetsForMerchant(mid, cache);
    const currentHash = computeMerchantTextHash(snippets);
    const bundleHash = computeMerchantTextHash(getBundleTextSnippets(mid));
    const knownHash = cache.signals_overrides[mid]?.source_hash ?? (BUNDLE.signals[mid] ? bundleHash : undefined);
    if (currentHash === "empty" || currentHash === knownHash) {
      skippedUnchanged += 1;
      continue;
    }
    pending.push({ mid, hash: currentHash, snippets });
  }

  if (pending.length === 0) {
    return NextResponse.json({
      processed: 0,
      skipped_unchanged: skippedUnchanged,
      cost_usd: 0,
      last_llm_run_at: cache.last_llm_run_at,
    });
  }

  let totalCostUsd = 0;
  let processed = 0;

  for (const item of pending) {
    if (totalCostUsd >= MAX_BATCH_USD) break;
    const baseSig = cache.signals_overrides[item.mid] ?? getMerchantSignal(item.mid);
    const lines = item.snippets
      .slice(0, 10)
      .map((s) => `[${s.source_type} | ${s.date.slice(0, 10)}] ${s.text.slice(0, 260)}`)
      .join("\n");

    const prompt =
      "Classify this UK local merchant's sold-out readiness from the records below.\n" +
      "Allowed signal values: merchant_opt_out, pause_auto_replenish, capacity_refund_risk, " +
      "portal_or_terms_assist, eager_restock, self_served, ooo_temporary, neutral.\n" +
      'Reply with JSON only: {"signal": "...", "summary": "1 short sentence", "quote": "exact verbatim substring"}.\n\n' +
      lines;

    try {
      const res = await sandboxFetch("/llm/v1/messages", {
        method: "POST",
        body: JSON.stringify({
          model: "claude-haiku-5-5",
          max_tokens: 500,
          thinking: { type: "disabled" },
          messages: [{ role: "user", content: prompt }],
        }),
      });
      if (!res.ok) continue;
      const data = await res.json();
      const usage = data.usage ?? {};
      totalCostUsd += ((usage.input_tokens ?? 0) * 1.0 + (usage.output_tokens ?? 0) * 5.0) / 1_000_000;

      if (data.stop_reason !== "end_turn") continue;
      const rawText = (data.content ?? [])
        .filter((b: { type: string }) => b.type === "text")
        .map((b: { text?: string }) => b.text ?? "")
        .join("");
      const match = rawText.match(/\{[\s\S]*\}/);
      if (!match) continue;
      const parsed = JSON.parse(match[0]);

      const llmSig = String(parsed.signal ?? "");
      const llmQuote = String(parsed.quote ?? "");
      const matchedSnippet = verifyQuoteInTexts(llmQuote, item.snippets);
      const nowIso = new Date().toISOString();

      if (shouldAcceptLlmOverride(baseSig.signal, llmSig) && matchedSnippet) {
        cache.signals_overrides[item.mid] = {
          ...baseSig,
          signal: llmSig,
          summary: String(parsed.summary || baseSig.summary),
          quote: llmQuote.slice(0, 180),
          quote_source_type: matchedSnippet.source_type,
          quote_date: matchedSnippet.date.slice(0, 10),
          quote_verified: true,
          method: "llm_verified",
          source_hash: item.hash,
          updated_at: nowIso,
        };
      } else {
        // Keep grounded deterministic signal and mark this text_hash as reviewed
        cache.signals_overrides[item.mid] = {
          ...baseSig,
          source_hash: item.hash,
          updated_at: nowIso,
        };
      }
      processed += 1;
    } catch {
      // Skip transient merchant error without aborting batch
    }
  }

  cache.last_llm_run_at = new Date().toISOString();
  cache.last_synced_at = cache.last_llm_run_at;
  cache.last_llm_cost_usd = Number(totalCostUsd.toFixed(4));
  cache.last_llm_processed = processed;
  writeRuntimeCache(cache);

  return NextResponse.json({
    processed,
    skipped_unchanged: skippedUnchanged,
    cost_usd: cache.last_llm_cost_usd,
    last_llm_run_at: cache.last_llm_run_at,
  });
}
