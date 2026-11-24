"""Standalone CLI for running the sold-outs note & signal detector offline or with LLM."""
from __future__ import annotations

import argparse
import csv
import json
import os
from pathlib import Path

from detector.extract import run_detection


def _load_env_file(env_path: Path) -> dict[str, str]:
    vals: dict[str, str] = {}
    if not env_path.exists():
        return vals
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        vals[k.strip()] = v.strip().strip('"').strip("'")
    return vals


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run sold-outs free-text signal & quote detector.")
    parser.add_argument("--input-dir", type=Path, required=True, help="Directory containing CSV exports.")
    parser.add_argument("--output", type=Path, required=True, help="Output JSON file path.")
    parser.add_argument("--offline", action="store_true", help="Force 100%% offline deterministic mode.")
    parser.add_argument("--llm", action="store_true", help="Enable Sandbox LLM enrichment (capped).")
    parser.add_argument("--focus-csv", type=Path, default=None, help="Optional todays_soldouts.csv to scope LLM calls.")
    parser.add_argument("--max-usd", type=float, default=2.50, help="Maximum LLM spend cap in USD.")
    args = parser.parse_args(argv)

    use_llm = bool(args.llm and not args.offline)
    focus_ids: set[str] | None = None
    if args.focus_csv and args.focus_csv.exists():
        with open(args.focus_csv, newline="", encoding="utf-8") as f:
            focus_ids = {r["merchant_id"] for r in csv.DictReader(f) if r.get("merchant_id")}

    env_file = _load_env_file(Path.cwd() / ".env")
    base_url = os.environ.get("BASE_URL") or env_file.get("BASE_URL")
    api_key = os.environ.get("KEY") or env_file.get("KEY")

    result = run_detection(
        input_dir=args.input_dir,
        use_llm=use_llm,
        llm_merchant_ids=focus_ids,
        max_usd=args.max_usd,
        base_url=base_url,
        api_key=api_key,
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Wrote {result['merchant_count']} merchant signals to {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
