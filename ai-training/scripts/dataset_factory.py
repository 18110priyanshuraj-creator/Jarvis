#!/usr/bin/env python3
"""Validate and split JARVIS conversational JSONL without external dependencies."""
import argparse, hashlib, json, re, sys
from pathlib import Path
ROLES = {"system", "user", "assistant"}
SECRETS = [re.compile(r"(?i)\b(api[_-]?key|secret|password|token)\s*[:=]\s*[^\s]{8,}"), re.compile(r"gh[pousr]_[A-Za-z0-9]{20,}"), re.compile(r"AKIA[0-9A-Z]{16}")]
def validate_record(row):
    errors = []
    if not isinstance(row, dict) or not isinstance(row.get("messages"), list) or not row["messages"]: return ["record must have a non-empty messages array"]
    for i, msg in enumerate(row["messages"]):
        if not isinstance(msg, dict) or msg.get("role") not in ROLES or not isinstance(msg.get("content"), str) or not msg["content"].strip(): errors.append(f"message {i} has an invalid role or empty text")
        elif any(pattern.search(msg["content"]) for pattern in SECRETS): errors.append(f"message {i} appears to contain a credential")
    if not any(isinstance(m, dict) and m.get("role") == "assistant" for m in row["messages"]): errors.append("record must contain an assistant response")
    if not isinstance(row.get("source_group"), str) or not row["source_group"].strip(): errors.append("source_group is required to prevent leakage across splits")
    if row.get("split") not in (None, "train", "validation", "test"): errors.append("split must be train, validation, or test")
    return errors
def read_jsonl(path):
    rows = []
    for n, line in enumerate(Path(path).read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip(): continue
        try: row = json.loads(line)
        except json.JSONDecodeError as exc: raise ValueError(f"{path}:{n}: invalid JSON: {exc}") from exc
        errors = validate_record(row)
        if errors: raise ValueError(f"{path}:{n}: " + "; ".join(errors))
        rows.append(row)
    return rows
def validate(rows):
    seen = set()
    for n, row in enumerate(rows, 1):
        errors = validate_record(row)
        if errors: raise ValueError(f"record {n}: " + "; ".join(errors))
        digest = hashlib.sha256(json.dumps(row, ensure_ascii=False, sort_keys=True).encode()).hexdigest()
        if digest in seen: raise ValueError(f"record {n}: duplicate example")
        seen.add(digest)
    return {"records": len(rows), "unique": len(seen), "source_groups": len({r["source_group"] for r in rows})}
def split_by_source(rows, seed="jarvis-v1"):
    import hashlib
    groups = sorted({r["source_group"] for r in rows}, key=lambda g: hashlib.sha256((seed + g).encode()).hexdigest())
    if len(groups) < 3: raise ValueError("at least three independent source groups are required")
    train_n = min(len(groups)-2, max(1, round(len(groups)*0.8)))
    val_n = max(1, round(len(groups)*0.1))
    if train_n + val_n >= len(groups): val_n = 1; train_n = len(groups)-2
    result = {"train": [], "validation": [], "test": []}
    for i, group in enumerate(groups):
        name = "train" if i < train_n else "validation" if i < train_n+val_n else "test"
        result[name].extend({**row, "split": name} for row in rows if row["source_group"] == group)
    return result
def main():
    p = argparse.ArgumentParser(); sub = p.add_subparsers(dest="command", required=True)
    v = sub.add_parser("validate"); v.add_argument("input")
    s = sub.add_parser("split"); s.add_argument("input"); s.add_argument("--out", required=True); s.add_argument("--seed", default="jarvis-v1")
    args = p.parse_args()
    try:
        rows = read_jsonl(args.input); report = validate(rows)
        if args.command == "split":
            parts = split_by_source(rows, args.seed); out = Path(args.out); out.mkdir(parents=True, exist_ok=True)
            for name, items in parts.items(): (out / (name + ".jsonl")).write_text("".join(json.dumps(x, ensure_ascii=False) + "\n" for x in items), encoding="utf-8")
            report.update({name: len(items) for name, items in parts.items()})
        print(json.dumps(report, indent=2)); return 0
    except (OSError, ValueError) as exc:
        print("ERROR: " + str(exc), file=sys.stderr); return 2
if __name__ == "__main__": raise SystemExit(main())