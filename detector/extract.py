"""Offline deterministic signal/quote extractor + optional Sandbox LLM batch enricher."""
from __future__ import annotations

import json
import os
import re
import time
import urllib.error
import urllib.request
from collections import defaultdict
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Any

from detector.clean import clean_activities, clean_notes, clean_replies, fix_mojibake, is_schedule_active, read_csv_rows

# Priority order when choosing the primary actionable signal for a merchant.
SIGNAL_PRIORITY = {
    "pause_auto_replenish": 1,
    "merchant_opt_out": 2,
    "capacity_refund_risk": 3,
    "portal_or_terms_assist": 4,
    "eager_restock": 5,
    "self_served": 6,
    "ooo_temporary": 7,
    "neutral": 8,
}

_PATTERNS: list[tuple[str, str, re.Pattern[str]]] = [
    (
        "merchant_opt_out",
        "Merchant explicitly asked to stay sold out or stop restock outreach",
        re.compile(
            r"\b(leave it|stay sold out|stay as we are|no thanks to a higher|don't want \d+|happy with \d+|"
            r"unsubscribe|please stop|no more emails|no more vouchers|leave cap|deliberate\.?\s*happy)\b",
            re.IGNORECASE,
        ),
    ),
    (
        "portal_or_terms_assist",
        "Merchant wants to restock but hit portal/link friction or needs deal terms/price edited first",
        re.compile(
            r"\b(asks me to log in|never set up a password|page can't be displayed|link.{0,20}(broken|not work|failed)|"
            r"up the price|limit of (two|2|one|1)|change the expiry|swapping it|before it restocks|before more are sold|"
            r"rather speak to someone|put a limit|price rise)\b",
            re.IGNORECASE,
        ),
    ),
    (
        "eager_restock",
        "Merchant asked to raise cap or expressed interest in selling more",
        re.compile(
            r"\b(yes top up|double it|increase (it|the cap)|lift the limit|go for it|happy to raise|"
            r"wants more|sounded made up|bumped it|keen|yes to \d+|increase please)\b",
            re.IGNORECASE,
        ),
    ),
    (
        "self_served",
        "Merchant already topped up via Deal Alert link or relies on auto-replenish",
        re.compile(
            r"\b(topped it up myself|did the link|working fine ever since|have the monday top up|refills monday|auto-?replenish)\b",
            re.IGNORECASE,
        ),
    ),
    (
        "ooo_temporary",
        "Merchant contact is temporarily away / out of office",
        re.compile(
            r"\b(out of the office|annual leave|on holiday|taking a (proper )?break|away from the computer|"
            r"unavailable until|off til|long weekend|back on (monday|tuesday|wednesday|thursday|friday|saturday))\b",
            re.IGNORECASE,
        ),
    ),
    (
        "pause_schedule_cue",
        "Note indicates merchant wants to pause live deals seasonally",
        re.compile(
            r"\b(nothing live over christmas|pause|shut over christmas|don't want a rush|closed)\b",
            re.IGNORECASE,
        ),
    ),
]

_CAPACITY_RE = re.compile(
    r"\b(double[- ]booked|cancelled on (the day|me)|staff shortage|weeks? (to book|wait|out)|"
    r"no appts|earliest\s*=|too busy|fully booked|closed due to|months? wait)\b",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class SourceRecord:
    source_type: str  # rep_note | deal_alert_reply | review | refund
    source_id: str
    date: str
    text: str


def _normalize_ws(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip().lower()


def verify_quote_in_sources(quote: str, records: list[SourceRecord]) -> SourceRecord | None:
    """Return the SourceRecord if quote is a grounded substring (or exact short match) of its text."""
    norm_q = _normalize_ws(quote)
    if norm_q.endswith("..."):
        norm_q = norm_q[:-3].rstrip()
    if not norm_q:
        return None
    if len(norm_q) < 6:
        for rec in records:
            if norm_q == _normalize_ws(rec.text):
                return rec
        return None
    for rec in records:
        if norm_q in _normalize_ws(rec.text):
            return rec
    return None


def _clip_verbatim(text: str, max_len: int = 180) -> str:
    text = re.sub(r"\s+", " ", text).strip()
    if len(text) <= max_len:
        return text
    return text[: max_len - 3].rstrip() + "..."


def analyze_merchant_offline(
    merchant_id: str,
    records: list[SourceRecord],
    has_active_schedule: bool = False,
    refund_ratio: float = 0.0,
) -> dict[str, Any]:
    """Deterministically classify one merchant and attach a substring-verified verbatim quote."""
    # Sort newest first so latest merchant intent wins over stale 2024 notes.
    sorted_recs = sorted(records, key=lambda r: r.date, reverse=True)
    matched: list[tuple[str, str, SourceRecord]] = []
    capacity_hits: list[SourceRecord] = []

    for rec in sorted_recs:
        if rec.source_type in ("review", "refund"):
            if _CAPACITY_RE.search(rec.text):
                capacity_hits.append(rec)
            continue

        # rep_note or deal_alert_reply
        for signal, summary, pattern in _PATTERNS:
            if pattern.search(rec.text):
                matched.append((signal, summary, rec))
                break

    # Check if an active auto-replenish schedule conflicts with a recent pause/opt-out cue.
    has_pause_or_optout = any(sig in ("pause_schedule_cue", "merchant_opt_out") for sig, _, _ in matched)
    capacity_risk = len(capacity_hits) >= 2 or (refund_ratio >= 0.14 and len(capacity_hits) >= 1)

    primary_signal = "neutral"
    primary_summary = "No strong free-text blocker or special request detected"
    primary_rec: SourceRecord | None = None

    if has_active_schedule and has_pause_or_optout:
        pause_rec = next((r for sig, _, r in matched if sig in ("pause_schedule_cue", "merchant_opt_out")), None)
        primary_signal = "pause_auto_replenish"
        primary_summary = "Active auto-replenish conflicts with merchant pause/stop request"
        primary_rec = pause_rec
    elif any(sig == "merchant_opt_out" for sig, _, _ in matched):
        primary_signal = "merchant_opt_out"
        primary_summary, primary_rec = next((sm, r) for sig, sm, r in matched if sig == "merchant_opt_out")
    elif capacity_risk:
        primary_signal = "capacity_refund_risk"
        primary_summary = f"Capacity & refund risk ({len(capacity_hits)} booking/cancellation complaints, {refund_ratio:.0%} refund rate)"
        primary_rec = capacity_hits[0]
    elif matched:
        # Pick highest-priority non-pause signal (preferring newest if tied)
        best = min(
            matched,
            key=lambda item: (SIGNAL_PRIORITY.get(item[0], 99), ""),
        )
        if best[0] == "pause_schedule_cue":
            primary_signal = "merchant_opt_out"
            primary_summary = "Merchant requested seasonal pause / closure"
            primary_rec = best[2]
        else:
            primary_signal, primary_summary, primary_rec = best
    elif sorted_recs:
        primary_rec = sorted_recs[0]

    quote = _clip_verbatim(primary_rec.text) if primary_rec else ""
    verified = verify_quote_in_sources(quote, records) is not None if quote else True

    return {
        "merchant_id": merchant_id,
        "signal": primary_signal,
        "summary": primary_summary,
        "capacity_risk": capacity_risk,
        "capacity_complaint_count": len(capacity_hits),
        "quote": quote,
        "quote_source_type": primary_rec.source_type if primary_rec else None,
        "quote_source_id": primary_rec.source_id if primary_rec else None,
        "quote_date": primary_rec.date[:10] if primary_rec else None,
        "quote_verified": verified,
        "method": "offline_rules",
    }


def should_accept_llm_override(deterministic_signal: str, llm_signal: str) -> bool:
    """Prevent LLM from downgrading actionable deterministic signals to neutral or masking schedule/capacity blocks."""
    if llm_signal not in SIGNAL_PRIORITY:
        return False
    if deterministic_signal == "pause_auto_replenish":
        return False
    if deterministic_signal != "neutral" and llm_signal == "neutral":
        return False
    if deterministic_signal == "capacity_refund_risk" and llm_signal in ("eager_restock", "neutral"):
        return False
    return True


def _call_sandbox_llm(
    merchant_id: str,
    records: list[SourceRecord],
    base_url: str,
    api_key: str,
    model: str = "claude-haiku-5-5",
) -> tuple[dict[str, Any] | None, float]:
    """Call Sandbox LLM gateway with thinking disabled and strict JSON output."""
    snippet_lines = [
        f"[{r.source_type} | {r.source_id} | {r.date[:10]}] {_clip_verbatim(r.text, 260)}"
        for r in sorted(records, key=lambda x: x.date, reverse=True)[:10]
    ]
    prompt = (
        "Classify this UK local merchant's sold-out readiness from the records below.\n"
        "Allowed signal values: merchant_opt_out, pause_auto_replenish, capacity_refund_risk, "
        "portal_or_terms_assist, eager_restock, self_served, ooo_temporary, neutral.\n"
        "Reply with JSON only: "
        '{"signal": "...", "summary": "1 short sentence", "quote": "exact verbatim substring from one record", "source_id": "..."}.\n\n'
        + "\n".join(snippet_lines)
    )
    payload = json.dumps(
        {
            "model": model,
            "max_tokens": 500,
            "thinking": {"type": "disabled"},
            "messages": [{"role": "user", "content": prompt}],
        }
    ).encode("utf-8")

    url = base_url.rstrip("/") + "/llm/v1/messages"
    req = urllib.request.Request(
        url,
        data=payload,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
        },
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
        data = json.loads(resp.read().decode("utf-8"))

    usage = data.get("usage", {})
    # Approximate Haiku 5.5 cost tracking ($1/M in, $5/M out conservative upper bound)
    est_cost = (usage.get("input_tokens", 0) * 1.0 + usage.get("output_tokens", 0) * 5.0) / 1_000_000
    if data.get("stop_reason") != "end_turn":
        return None, est_cost

    text_blocks = [b.get("text", "") for b in data.get("content", []) if b.get("type") == "text"]
    raw_text = "".join(text_blocks).strip()
    match = re.search(r"\{.*\}", raw_text, re.DOTALL)
    if not match:
        return None, est_cost
    parsed = json.loads(match.group(0))
    return parsed, est_cost


def run_detection(
    input_dir: Path,
    use_llm: bool = False,
    llm_merchant_ids: set[str] | None = None,
    max_usd: float = 2.50,
    base_url: str | None = None,
    api_key: str | None = None,
    as_of_date: str | None = None,
) -> dict[str, Any]:
    """Run cleaning + extraction over a CSV data directory and return structured payload."""
    as_of = as_of_date or date.today().isoformat()
    merchants = read_csv_rows(input_dir / "merchants.csv")
    merchant_rep_map = {m["merchant_id"]: m.get("rep_id", "") for m in merchants}

    notes_raw = read_csv_rows(input_dir / "rep_notes.csv")
    replies_raw = read_csv_rows(input_dir / "deal_alert_replies.csv")
    reviews_raw = read_csv_rows(input_dir / "reviews.csv")
    refunds_raw = read_csv_rows(input_dir / "refunds.csv")
    schedules_raw = read_csv_rows(input_dir / "auto_replenish_schedules.csv")
    mmonths_raw = read_csv_rows(input_dir / "merchant_months.csv")
    activities_raw = read_csv_rows(input_dir / "activities.csv")

    notes, note_stats = clean_notes(notes_raw, merchant_rep_map)
    replies, reply_stats = clean_replies(replies_raw)
    _, activity_stats = clean_activities(activities_raw)

    active_schedule_merchants = {s["merchant_id"] for s in schedules_raw if is_schedule_active(s, as_of)}
    gp_totals: dict[str, float] = defaultdict(float)
    ref_totals: dict[str, float] = defaultdict(float)
    for mm in mmonths_raw:
        mid = mm["merchant_id"]
        gp_totals[mid] += float(mm.get("gp_gbp") or 0.0)
        ref_totals[mid] += float(mm.get("refunds_gbp") or 0.0)

    records_by_merchant: dict[str, list[SourceRecord]] = defaultdict(list)
    for n in notes:
        records_by_merchant[n["merchant_id"]].append(
            SourceRecord("rep_note", n["note_id"], n["created_at"], n["text"])
        )
    for r in replies:
        records_by_merchant[r["merchant_id"]].append(
            SourceRecord("deal_alert_reply", r["reply_id"], r["received_at"], r["text"])
        )
    for rv in reviews_raw:
        records_by_merchant[rv["merchant_id"]].append(
            SourceRecord("review", rv["review_id"], rv["created_at"], fix_mojibake(rv.get("text", "")))
        )
    for rf in refunds_raw:
        records_by_merchant[rf["merchant_id"]].append(
            SourceRecord("refund", rf["refund_id"], rf["created_at"], fix_mojibake(rf.get("reason_text", "")))
        )

    all_mids = sorted(set(merchant_rep_map.keys()) | set(records_by_merchant.keys()))
    signals: dict[str, dict[str, Any]] = {}
    llm_spent_usd = 0.0
    llm_enriched = 0
    llm_quote_fallbacks = 0

    for mid in all_mids:
        recs = records_by_merchant.get(mid, [])
        gross = gp_totals[mid] + ref_totals[mid]
        refund_ratio = (ref_totals[mid] / gross) if gross > 0 else 0.0
        result = analyze_merchant_offline(
            mid,
            recs,
            has_active_schedule=(mid in active_schedule_merchants),
            refund_ratio=refund_ratio,
        )

        should_call_llm = (
            use_llm
            and base_url
            and api_key
            and recs
            and llm_spent_usd < max_usd
            and (llm_merchant_ids is None or mid in llm_merchant_ids)
        )
        if should_call_llm:
            try:
                parsed, cost = _call_sandbox_llm(mid, recs, base_url, api_key)
                llm_spent_usd += cost
                if parsed and should_accept_llm_override(result["signal"], parsed.get("signal", "")):
                    matched_rec = verify_quote_in_sources(parsed.get("quote", ""), recs)
                    if matched_rec:
                        result["signal"] = parsed["signal"]
                        result["summary"] = parsed.get("summary") or result["summary"]
                        result["quote"] = _clip_verbatim(parsed["quote"])
                        result["quote_source_type"] = matched_rec.source_type
                        result["quote_source_id"] = matched_rec.source_id
                        result["quote_date"] = matched_rec.date[:10]
                        result["quote_verified"] = True
                        result["method"] = "llm_verified"
                        llm_enriched += 1
                    else:
                        # Anti-hallucination fallback: keep deterministic grounded quote
                        llm_quote_fallbacks += 1
                time.sleep(0.12)
            except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, ValueError):
                pass

        signals[mid] = result

    return {
        "hygiene_stats": {
            "notes": note_stats,
            "replies": reply_stats,
            "activities": activity_stats,
        },
        "llm_stats": {
            "used": use_llm,
            "enriched_merchants": llm_enriched,
            "quote_fallbacks": llm_quote_fallbacks,
            "estimated_cost_usd": round(llm_spent_usd, 4),
        },
        "merchant_count": len(signals),
        "signals": signals,
    }
