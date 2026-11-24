import fs from "node:fs";
import path from "node:path";
import type { MarkInfo, SignalInfo } from "@/lib/enrich";

export interface CachedMerchantHistory {
  notes: Array<Record<string, unknown>>;
  replies: Array<Record<string, unknown>>;
  reviews: Array<Record<string, unknown>>;
  refunds: Array<Record<string, unknown>>;
  schedules: Array<Record<string, unknown>>;
  text_hash: string;
}

export interface CachedSignalEntry extends SignalInfo {
  source_hash?: string;
  updated_at?: string;
}

export interface RuntimeCache {
  last_synced_at: string | null;
  last_llm_run_at: string | null;
  last_llm_cost_usd: number;
  last_llm_processed: number;
  soldouts_snapshot: Array<Record<string, unknown>> | null;
  marks_snapshot: Record<string, MarkInfo>;
  signals_overrides: Record<string, CachedSignalEntry>;
  history_overrides: Record<string, CachedMerchantHistory>;
}

const EMPTY_CACHE: RuntimeCache = {
  last_synced_at: null,
  last_llm_run_at: null,
  last_llm_cost_usd: 0,
  last_llm_processed: 0,
  soldouts_snapshot: null,
  marks_snapshot: {},
  signals_overrides: {},
  history_overrides: {},
};

function getCacheFilePath(): string {
  const localDir = path.resolve(process.cwd(), ".cache");
  try {
    fs.mkdirSync(localDir, { recursive: true });
    const probe = path.join(localDir, ".write_test");
    fs.writeFileSync(probe, "ok");
    fs.unlinkSync(probe);
    return path.join(localDir, "runtime_state.json");
  } catch {
    return "/tmp/soldouts_runtime_state.json";
  }
}

export function readRuntimeCache(): RuntimeCache {
  try {
    const filePath = getCacheFilePath();
    if (!fs.existsSync(filePath)) return { ...EMPTY_CACHE };
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8")) as Partial<RuntimeCache>;
    return {
      ...EMPTY_CACHE,
      ...parsed,
      marks_snapshot: parsed.marks_snapshot ?? {},
      signals_overrides: parsed.signals_overrides ?? {},
      history_overrides: parsed.history_overrides ?? {},
    };
  } catch {
    return { ...EMPTY_CACHE };
  }
}

export function writeRuntimeCache(cache: RuntimeCache): void {
  try {
    const filePath = getCacheFilePath();
    fs.writeFileSync(filePath, JSON.stringify(cache), "utf-8");
  } catch {
    // Ignore read-only errors gracefully
  }
}
