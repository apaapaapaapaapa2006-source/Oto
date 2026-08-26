#!/usr/bin/env python3
"""Publish an article to note.com using browser automation.

note.com has no official public API for creating posts, so this drives the
real editor UI with Playwright (the same flow a human would use). This is
inherently a little fragile: if note.com changes its editor markup or adds
a CAPTCHA/2FA step, this script will need updating. Run with --dry-run to
skip the browser entirely and just validate the content.

Required env vars (unless --dry-run):
    NOTE_EMAIL     - login email for the note.com account
    NOTE_PASSWORD  - login password for the note.com account
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

LOGIN_URL = "https://note.com/login"
NEW_NOTE_URL = "https://note.com/notes/new"
NAV_TIMEOUT_MS = 30_000
ACTION_TIMEOUT_MS = 15_000


def _dump_debug(page, out_dir: Path, label: str) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    try:
        page.screenshot(path=str(out_dir / f"{label}.png"), full_page=True)
        (out_dir / f"{label}.html").write_text(page.content(), encoding="utf-8")
    except Exception as e:  # best-effort debugging aid, never fatal
        print(f"(could not save debug artifacts: {e})", file=sys.stderr)


def login(page, email: str, password: str, debug_dir: Path) -> None:
    page.goto(LOGIN_URL, timeout=NAV_TIMEOUT_MS)

    email_field = page.get_by_placeholder("メールアドレス").first
    email_field.wait_for(timeout=ACTION_TIMEOUT_MS)
    email_field.fill(email)

    password_field = page.get_by_placeholder("パスワード").first
    password_field.fill(password)

    page.get_by_role("button", name="ログイン").first.click()

    try:
        page.wait_for_url(lambda url: "login" not in url, timeout=NAV_TIMEOUT_MS)
    except Exception:
        _dump_debug(page, debug_dir, "login_failed")
        raise RuntimeError(
            "note.com login did not navigate away from /login - "
            "check credentials, or note.com may be showing a CAPTCHA/2FA "
            "prompt that this script can't handle. See debug artifacts."
        )


def publish(page, title: str, body: str, hashtags: list[str], debug_dir: Path) -> str:
    page.goto(NEW_NOTE_URL, timeout=NAV_TIMEOUT_MS)

    title_field = page.get_by_placeholder("記事タイトル").first
    title_field.wait_for(timeout=ACTION_TIMEOUT_MS)
    title_field.click()
    title_field.fill(title)

    body_field = page.locator(".ProseMirror").first
    body_field.click()
    for i, paragraph in enumerate(body.split("\n\n")):
        if i > 0:
            page.keyboard.press("Enter")
            page.keyboard.press("Enter")
        page.keyboard.type(paragraph)

    publish_button = page.get_by_role("button", name="公開に進む").first
    publish_button.wait_for(timeout=ACTION_TIMEOUT_MS)
    publish_button.click()

    tag_field = page.get_by_placeholder("ハッシュタグを追加")
    try:
        tag_field.first.wait_for(timeout=ACTION_TIMEOUT_MS)
        for tag in hashtags:
            tag_field.first.fill(tag.lstrip("#"))
            page.keyboard.press("Enter")
    except Exception:
        _dump_debug(page, debug_dir, "tag_input_failed")
        print(
            "warning: could not fill hashtags, continuing without them",
            file=sys.stderr,
        )

    final_button = page.get_by_role("button", name="投稿する").first
    final_button.wait_for(timeout=ACTION_TIMEOUT_MS)
    final_button.click()

    try:
        page.wait_for_url(lambda url: "/notes/new" not in url, timeout=NAV_TIMEOUT_MS)
    except Exception:
        _dump_debug(page, debug_dir, "publish_failed")
        raise RuntimeError(
            "Publish click did not navigate to the published article - "
            "see debug artifacts to inspect what note.com showed."
        )

    return page.url


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--content-json", required=True, help="Path to JSON with title/full_body/hashtags")
    parser.add_argument("--dry-run", action="store_true", help="Skip the browser, just validate content")
    parser.add_argument("--debug-dir", default="debug-artifacts", help="Where to save screenshots/HTML on failure")
    args = parser.parse_args()

    content = json.loads(Path(args.content_json).read_text(encoding="utf-8"))
    title = content["title"]
    body = content["full_body"]
    hashtags = content["hashtags"]

    print(f"Title: {title}")
    print(f"Hashtags: {' '.join(hashtags)}")
    print("---")
    print(body)
    print("---")

    if args.dry_run:
        print("(dry run - not posting to note.com)")
        return 0

    email = os.environ.get("NOTE_EMAIL")
    password = os.environ.get("NOTE_PASSWORD")
    if not email or not password:
        print("NOTE_EMAIL / NOTE_PASSWORD must be set unless --dry-run", file=sys.stderr)
        return 1

    from playwright.sync_api import sync_playwright

    debug_dir = Path(args.debug_dir)
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(locale="ja-JP")
        try:
            login(page, email, password, debug_dir)
            url = publish(page, title, body, hashtags, debug_dir)
        finally:
            browser.close()

    print(f"Published: {url}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
