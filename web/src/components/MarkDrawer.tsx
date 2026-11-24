"use client";

import { useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { ChevronDown, Flag, Trash2, X } from "lucide-react";
import type { MarkInfo } from "@/lib/enrich";

interface MarkDrawerProps {
  merchantId: string;
  merchantName: string;
  defaultRepId: string;
  currentMark: MarkInfo | null;
  onSaved: (mark: MarkInfo | null) => void;
}

const MARK_OPTIONS = [
  { value: "no_call", label: "no_call — Do not call for restocks" },
  { value: "seasonal_pause", label: "seasonal_pause — Paused for peak/holiday" },
  { value: "capacity_full", label: "capacity_full — Fully booked, hold cap" },
  { value: "always_call", label: "always_call — High priority merchant" },
  { value: "terms_edit_needed", label: "terms_edit_needed — Edit price/terms first" },
];

export function MarkDrawer({
  merchantId,
  merchantName,
  defaultRepId,
  currentMark,
  onSaved,
}: MarkDrawerProps) {
  const [open, setOpen] = useState(false);
  const [mark, setMark] = useState(currentMark?.mark || "no_call");
  const [reason, setReason] = useState(currentMark?.reason || "");
  const [markedBy, setMarkedBy] = useState(currentMark?.marked_by || defaultRepId || "R10");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!reason.trim()) {
      setError("Please add a short one-sentence reason.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/merchants/${encodeURIComponent(merchantId)}/mark`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mark, reason: reason.trim(), marked_by: markedBy.trim() || "R10" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save mark");
      onSaved(data.mark);
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save mark");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/merchants/${encodeURIComponent(merchantId)}/mark`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "Cleared by rep" }),
      });
      if (!res.ok) throw new Error("Failed to remove mark");
      onSaved(null);
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove mark");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger className="coss-btn coss-btn-secondary w-full sm:w-auto">
        <Flag className="w-4 h-4 shrink-0" />
        <span>{currentMark ? `Marked: ${currentMark.mark}` : "Mark merchant"}</span>
      </Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[1px] smooth-panel" />
        <Dialog.Popup className="fixed z-50 bottom-0 left-0 right-0 sm:bottom-auto sm:top-1/2 sm:left-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 w-full sm:max-w-lg bg-white border border-zinc-200 rounded-t-2xl sm:rounded-2xl p-5 shadow-xl smooth-panel">
          <div className="flex items-start justify-between gap-3 mb-4">
            <div className="min-w-0">
              <Dialog.Title className="text-zinc-900 truncate">{merchantName}</Dialog.Title>
              <Dialog.Description className="text-caption">
                Mark {merchantId} in sandbox &amp; explain why
              </Dialog.Description>
            </div>
            <Dialog.Close className="coss-btn coss-btn-secondary" aria-label="Close">
              <X className="w-4 h-4" />
            </Dialog.Close>
          </div>

          <form onSubmit={handleSave} className="space-y-4">
            <div>
              <label className="block text-eyebrow mb-1.5" htmlFor={`mark-${merchantId}`}>
                Mark Code
              </label>
              <div className="relative">
                <select
                  id={`mark-${merchantId}`}
                  value={mark}
                  onChange={(e) => setMark(e.target.value)}
                  className="appearance-none w-full rounded-lg border border-zinc-300 bg-white pl-3 pr-9 py-2.5 text-zinc-900"
                >
                  {MARK_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
              </div>
            </div>

            <div>
              <label className="block text-eyebrow mb-1.5" htmlFor={`reason-${merchantId}`}>
                Why (1 sentence)
              </label>
              <textarea
                id={`reason-${merchantId}`}
                rows={2}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g., Owner confirmed shut over Christmas; pause until Jan."
                className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-zinc-900"
              />
            </div>

            <div>
              <label className="block text-eyebrow mb-1.5" htmlFor={`rep-${merchantId}`}>
                Rep ID
              </label>
              <input
                id={`rep-${merchantId}`}
                type="text"
                value={markedBy}
                onChange={(e) => setMarkedBy(e.target.value)}
                className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-zinc-900"
              />
            </div>

            {error && <p className="text-rose-700 font-medium">{error}</p>}

            <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
              {currentMark ? (
                <button
                  type="button"
                  disabled={saving}
                  onClick={handleDelete}
                  className="coss-btn coss-btn-danger"
                >
                  <Trash2 className="w-4 h-4" />
                  <span>Clear mark</span>
                </button>
              ) : (
                <span />
              )}
              <button type="submit" disabled={saving} className="coss-btn coss-btn-primary">
                <span>{saving ? "Saving..." : "Save mark"}</span>
              </button>
            </div>
          </form>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
