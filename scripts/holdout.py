"""Deterministic merchant-level stratified holdout assignment (80% treatment / 20% holdout)."""
from __future__ import annotations

import hashlib
from collections import defaultdict
from typing import Iterable, Mapping


def _hash_key(merchant_id: str, salt: str) -> str:
    return hashlib.sha256(f"{salt}:{merchant_id}".encode("utf-8")).hexdigest()


def assign_arm(merchant_id: str, holdout_pct: int = 20, salt: str = "soldouts-peak-2026") -> str:
    """Single-merchant deterministic hash fallback ('holdout' or 'treatment')."""
    digest = hashlib.sha256(f"{salt}:{merchant_id}".encode("utf-8")).digest()
    bucket = int.from_bytes(digest[:4], "big") % 100
    return "holdout" if bucket < holdout_pct else "treatment"


def stratified_assign_arms(
    merchants: Iterable[Mapping[str, str]],
    holdout_pct: int = 20,
    salt: str = "soldouts-peak-2026",
) -> dict[str, str]:
    """Deterministically assign merchants to 'holdout' / 'treatment' stratified by (size_band, category).

    Within each (size_band, category) stratum, merchants are ordered by SHA-256 hash
    and the target share is assigned to 'holdout', guaranteeing exact stratum balance
    and zero multi-deal merchant spillover.
    """
    by_stratum: dict[tuple[str, str], list[str]] = defaultdict(list)
    for m in merchants:
        mid = m["merchant_id"]
        stratum = (m.get("size_band", "C"), m.get("category", "Unknown"))
        by_stratum[stratum].append(mid)

    assignments: dict[str, str] = {}
    for _, mids in sorted(by_stratum.items()):
        ordered = sorted(mids, key=lambda mid: _hash_key(mid, salt))
        n = len(ordered)
        n_holdout = round(n * holdout_pct / 100)
        if n >= 5 and holdout_pct > 0 and n_holdout == 0:
            n_holdout = 1
        for idx, mid in enumerate(ordered):
            assignments[mid] = "holdout" if idx < n_holdout else "treatment"
    return assignments
