"use client";

import { useEffect, useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { Database, Sparkles, X } from "lucide-react";

export interface CacheStatusInfo {
  mode: string;
  last_synced_at: string | null;
  last_llm_run_at: string | null;
  last_llm_cost_usd: number;
  last_llm_processed: number;
  pending_ai_count: number;
}

export function formatSyncTs(iso: string | null): string {
  if (!iso) return "Not yet";
  try {
    return new Date(iso).toLocaleString("en-GB", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function SyncStatusDrawer() {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<CacheStatusInfo>({
    mode: "offline_fallback",
    last_synced_at: null,
    last_llm_run_at: null,
    last_llm_cost_usd: 0,
    last_llm_processed: 0,
    pending_ai_count: 0,
  });
  const [runningLlm, setRunningLlm] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    function onStatus(e: Event) {
      const detail = (e as CustomEvent<CacheStatusInfo>).detail;
      if (detail) setStatus(detail);
    }
    window.addEventListener("soldouts:sync-status", onStatus);
    return () => window.removeEventListener("soldouts:sync-status", onStatus);
  }, []);

  async function handleRunLlm() {
    setRunningLlm(true);
    setFeedback(null);
    try {
      const res = await fetch("/api/llm/refresh", { method: "POST" });
      const data = await res.json();
      setFeedback(
        `LLM processed ${data.processed ?? 0} pending (${data.skipped_unchanged ?? 0} unchanged skipped, $${Number(data.cost_usd ?? 0).toFixed(4)})`
      );
      window.dispatchEvent(new CustomEvent("soldouts:refresh"));
    } catch {
      setFeedback("LLM run failed or offline.");
    } finally {
      setRunningLlm(false);
    }
  }

  const modeLabel =
    status.mode === "live_sandbox"
      ? "Live"
      : status.mode === "offline_cached"
      ? "Cached Offline"
      : "Bundled Snapshot";

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger className="coss-btn coss-btn-secondary">
        <Database className="w-4 h-4 shrink-0 text-[#53a318]" />
        <span>
          AI &amp; Cache ({modeLabel}
          {status.pending_ai_count > 0 ? ` · ${status.pending_ai_count} pending` : ""})
        </span>
      </Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[1px] smooth-panel" />
        <Dialog.Popup className="fixed z-50 bottom-0 left-0 right-0 sm:bottom-auto sm:top-1/2 sm:left-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 w-full sm:max-w-lg bg-white border border-zinc-200 rounded-t-2xl sm:rounded-2xl p-5 shadow-xl smooth-panel">
          <div className="flex items-start justify-between gap-3 mb-4">
            <div className="min-w-0">
              <Dialog.Title className="text-zinc-900">AI Processing &amp; Offline Cache</Dialog.Title>
              <Dialog.Description className="text-caption">
                Runs capped LLM only on untreated merchant notes and updates the offline snapshot
              </Dialog.Description>
            </div>
            <Dialog.Close className="coss-btn coss-btn-secondary" aria-label="Close">
              <X className="w-4 h-4" />
            </Dialog.Close>
          </div>

          <div className="space-y-3">
            <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3.5 space-y-1.5">
              <p className="text-eyebrow">Offline Snapshot</p>
              <p className="font-semibold text-zinc-900">Mode: {modeLabel}</p>
              <p className="text-caption">Last synced: {formatSyncTs(status.last_synced_at)}</p>
            </div>

            <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3.5 space-y-1.5">
              <p className="text-eyebrow">Incremental AI Queue</p>
              <p className="font-semibold text-zinc-900">
                Pending AI processing: {status.pending_ai_count} merchant
                {status.pending_ai_count === 1 ? "" : "s"}
              </p>
              <p className="text-caption">
                Last LLM run: {formatSyncTs(status.last_llm_run_at)}
                {status.last_llm_run_at
                  ? ` (${status.last_llm_processed} processed · $${status.last_llm_cost_usd.toFixed(4)})`
                  : ""}
              </p>
            </div>

            {feedback && (
              <p className="rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-emerald-900 font-medium">
                {feedback}
              </p>
            )}

            <div className="flex items-center justify-end pt-2">
              <button
                type="button"
                onClick={handleRunLlm}
                disabled={runningLlm || status.pending_ai_count === 0}
                className="coss-btn coss-btn-primary w-full sm:w-auto disabled:opacity-50"
              >
                <Sparkles className="w-4 h-4" />
                <span>
                  {runningLlm
                    ? "Running LLM..."
                    : `Run LLM (${status.pending_ai_count})`}
                </span>
              </button>
            </div>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
