"""Run a worker operation locally.

uv run python -m media.cli render request.json --storage-root ./local-storage
uv run python -m media.cli ingest request.json            # uses Supabase (env vars)
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .ops import OPS
from .storage import LocalStorage, SupabaseJobReporter, SupabaseStorage


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="media")
    p.add_argument("op", choices=sorted(OPS))
    p.add_argument("request", help="JSON file with the request ('-' for stdin)")
    p.add_argument("--storage-root", help="use a local folder instead of Supabase Storage")
    args = p.parse_args(argv)
    raw = json.load(sys.stdin if args.request == "-" else open(args.request, encoding="utf-8"))
    if args.storage_root:
        storage = LocalStorage(Path(args.storage_root))
        reporter = None
    else:
        storage = SupabaseStorage()
        reporter = SupabaseJobReporter(raw.get("jobId"))
    result = OPS[args.op](raw, storage, reporter)
    json.dump(result, sys.stdout, ensure_ascii=False)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
