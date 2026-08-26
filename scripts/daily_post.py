#!/usr/bin/env python3
"""Generate today's rakugo story and publish it to note.com.

Orchestrates generate_rakugo.py -> post_to_note.py, and keeps a local
record of every day's post under posts/.
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from generate_rakugo import generate

JST = ZoneInfo("Asia/Tokyo")
REPO_ROOT = Path(__file__).resolve().parent.parent
POSTS_DIR = REPO_ROOT / "posts"


def save_record(date_str: str, post, note_url: str | None) -> Path:
    POSTS_DIR.mkdir(parents=True, exist_ok=True)
    record = {
        "date": date_str,
        "title": post.title,
        "hashtags": post.hashtags,
        "note_url": note_url,
        "raw": post.raw,
    }
    out_path = POSTS_DIR / f"{date_str}.json"
    out_path.write_text(json.dumps(record, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return out_path


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="Generate only, don't post to note.com")
    args = parser.parse_args()

    today = datetime.now(JST)
    date_str = today.strftime("%Y-%m-%d")

    print(f"Generating rakugo for {date_str}...", file=sys.stderr)
    post = generate(today)
    print(post.raw, file=sys.stderr)

    content_path = POSTS_DIR / f".{date_str}.content.json"
    POSTS_DIR.mkdir(parents=True, exist_ok=True)
    content_path.write_text(
        json.dumps(
            {
                "title": post.title,
                "full_body": post.full_body,
                "hashtags": post.hashtags,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    note_url = None
    if not args.dry_run:
        import subprocess

        result = subprocess.run(
            [
                sys.executable,
                str(REPO_ROOT / "scripts" / "post_to_note.py"),
                "--content-json",
                str(content_path),
            ],
            capture_output=True,
            text=True,
        )
        print(result.stdout)
        print(result.stderr, file=sys.stderr)
        if result.returncode != 0:
            save_record(date_str, post, note_url=None)
            return result.returncode

        for line in result.stdout.splitlines():
            if line.startswith("Published: "):
                note_url = line.removeprefix("Published: ").strip()
    else:
        print("(dry run - skipping note.com post)", file=sys.stderr)

    save_record(date_str, post, note_url)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
