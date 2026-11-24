"""Data hygiene utilities for CRM exports, notes, replies, reviews, and refunds."""
from __future__ import annotations

import csv
import re
from pathlib import Path
from typing import Any

# Common Windows-1252 / Latin-1 double-encoded UTF-8 sequences seen in CRM exports.
_MOJIBAKE_MAP = {
    "\u00e2\u20ac\u2122": "'",
    "\u00e2\u20ac\u02dc": "'",
    "\u00e2\u20ac\u0153": '"',
    "\u00e2\u20ac\u009d": '"',
    "\u00e2\u20ac\u201c": "-",
    "\u00e2\u20ac\u201d": "-",
    "\u00e2\u20ac\u00a6": "...",
    "\u00c2\u00a3": "£",
    "\u00c2\u00a0": " ",
    "â€™": "'",
    "â€˜": "'",
    "â€œ": '"',
    "â€\x9d": '"',
    "â€“": "-",
    "â€”": "-",
    "â€¦": "...",
    "Â£": "£",
}

_MOJIBAKE_RE = re.compile("|".join(re.escape(k) for k in _MOJIBAKE_MAP))


def fix_mojibake(text: str) -> str:
    """Repair Windows-1252-in-UTF-8 mojibake while leaving clean Unicode untouched."""
    if not text:
        return ""
    if any(marker in text for marker in ("â€", "Â£", "Ã©", "Ã¨", "Ã", "\u00c2", "\u00e2")):
        try:
            text = text.encode("cp1252").decode("utf-8")
        except (UnicodeEncodeError, UnicodeDecodeError):
            text = _MOJIBAKE_RE.sub(lambda m: _MOJIBAKE_MAP[m.group(0)], text)
    return (
        text.replace("\u2019", "'")
        .replace("\u2018", "'")
        .replace("\u201c", '"')
        .replace("\u201d", '"')
    )


def read_csv_rows(path: Path) -> list[dict[str, str]]:
    """Read a UTF-8 CSV file into a list of dicts; returns [] if file is absent."""
    if not path.exists():
        return []
    with open(path, newline="", encoding="utf-8", errors="replace") as f:
        return list(csv.DictReader(f))


def is_schedule_active(row: dict[str, str], as_of_date: str) -> bool:
    """Return True if an auto-replenish schedule is active on as_of_date (YYYY-MM-DD)."""
    start = (row.get("start_date") or "").strip()
    end = (row.get("end_date") or "").strip()
    if start and start > as_of_date:
        return False
    return not end or end >= as_of_date


def clean_notes(
    notes: list[dict[str, str]],
    merchant_rep_map: dict[str, str] | None = None,
) -> tuple[list[dict[str, Any]], dict[str, int]]:
    """Repair mojibake, deduplicate CRM sync replay rows, backfill rep_id, flag truncation."""
    merchant_rep_map = merchant_rep_map or {}
    seen: set[tuple[str, str, str]] = set()
    cleaned: list[dict[str, Any]] = []
    stats = {"raw": len(notes), "duplicates_removed": 0, "mojibake_fixed": 0, "truncated_500": 0, "rep_backfilled": 0}

    for row in notes:
        raw_text = row.get("text", "")
        fixed_text = fix_mojibake(raw_text).strip()
        if fixed_text != raw_text.strip():
            stats["mojibake_fixed"] += 1
        if len(raw_text) >= 500:
            stats["truncated_500"] += 1

        dedup_key = (row.get("merchant_id", ""), row.get("created_at", ""), fixed_text)
        if dedup_key in seen:
            stats["duplicates_removed"] += 1
            continue
        seen.add(dedup_key)

        rep_id = (row.get("rep_id") or "").strip()
        if not rep_id and row.get("merchant_id") in merchant_rep_map:
            rep_id = merchant_rep_map[row["merchant_id"]]
            stats["rep_backfilled"] += 1

        cleaned.append(
            {
                "note_id": row.get("note_id", ""),
                "merchant_id": row.get("merchant_id", ""),
                "rep_id": rep_id,
                "created_at": row.get("created_at", ""),
                "text": fixed_text,
                "is_truncated": len(raw_text) >= 500,
            }
        )
    return cleaned, stats


def clean_replies(replies: list[dict[str, str]]) -> tuple[list[dict[str, Any]], dict[str, int]]:
    """Repair mojibake and deduplicate Deal Alert replies."""
    seen: set[tuple[str, str, str]] = set()
    cleaned: list[dict[str, Any]] = []
    stats = {"raw": len(replies), "duplicates_removed": 0, "mojibake_fixed": 0}

    for row in replies:
        raw_text = row.get("text", "")
        fixed_text = fix_mojibake(raw_text).strip()
        if fixed_text != raw_text.strip():
            stats["mojibake_fixed"] += 1

        dedup_key = (row.get("merchant_id", ""), row.get("received_at", ""), fixed_text)
        if dedup_key in seen:
            stats["duplicates_removed"] += 1
            continue
        seen.add(dedup_key)

        cleaned.append(
            {
                "reply_id": row.get("reply_id", ""),
                "merchant_id": row.get("merchant_id", ""),
                "received_at": row.get("received_at", ""),
                "text": fixed_text,
            }
        )
    return cleaned, stats


def clean_activities(activities: list[dict[str, str]]) -> tuple[list[dict[str, str]], dict[str, int]]:
    """Deduplicate CRM sync replay rows and exclude Feb 2026 automated Deal Alert pseudo-activities."""
    seen: set[tuple[str, str, str, str, str, str, str]] = set()
    cleaned: list[dict[str, str]] = []
    stats = {"raw": len(activities), "duplicates_removed": 0, "deal_alert_noise_removed": 0}

    for row in activities:
        dedup_key = (
            row.get("merchant_id", ""),
            row.get("sold_out_id", ""),
            row.get("activity_date", ""),
            row.get("type", ""),
            row.get("owner_id", ""),
            row.get("duration_s", ""),
            row.get("subject", ""),
        )
        if dedup_key in seen:
            stats["duplicates_removed"] += 1
            continue
        seen.add(dedup_key)

        if (row.get("subject") or "").strip().lower() == "deal alert sent":
            stats["deal_alert_noise_removed"] += 1
            continue

        cleaned.append(row)
    return cleaned, stats
