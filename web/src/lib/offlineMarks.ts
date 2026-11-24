import type { MarkInfo } from "@/lib/enrich";

const g = globalThis as unknown as { __offlineMarks?: Map<string, MarkInfo> };
if (!g.__offlineMarks) {
  g.__offlineMarks = new Map<string, MarkInfo>();
}

export const OFFLINE_MARKS = g.__offlineMarks;
