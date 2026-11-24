import { NextResponse } from "next/server";
import { OFFLINE_MARKS } from "@/lib/offlineMarks";
import { sandboxFetch } from "@/lib/sandbox";

export async function PUT(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const body = await req.json();
  const mark = String(body.mark ?? "").trim().slice(0, 64);
  const reason = String(body.reason ?? "").trim();
  const marked_by = String(body.marked_by ?? "R10").trim();

  if (!mark || !reason) {
    return NextResponse.json({ error: "Both mark and reason are required." }, { status: 400 });
  }

  try {
    const res = await sandboxFetch(`/merchants/${encodeURIComponent(id)}/mark`, {
      method: "PUT",
      body: JSON.stringify({ mark, reason, marked_by }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return NextResponse.json({ error: data.detail || `Sandbox error ${res.status}` }, { status: res.status });
    }
    return NextResponse.json({ mode: "live_sandbox", mark: { mark, reason, marked_by }, raw: data });
  } catch {
    const saved = { mark, reason, marked_by };
    OFFLINE_MARKS.set(id, saved);
    return NextResponse.json({
      mode: "offline_local",
      mark: saved,
    });
  }
}

export async function DELETE(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const body = await req.json().catch(() => ({}));
  try {
    const res = await sandboxFetch(`/merchants/${encodeURIComponent(id)}/mark`, {
      method: "DELETE",
      body: JSON.stringify({ reason: body.reason || "Removed via rep tool" }),
    });
    if (!res.ok && res.status !== 404) {
      return NextResponse.json({ error: `Sandbox error ${res.status}` }, { status: res.status });
    }
    return NextResponse.json({ mode: "live_sandbox", deleted: true });
  } catch {
    OFFLINE_MARKS.delete(id);
    return NextResponse.json({ mode: "offline_local", deleted: true });
  }
}
