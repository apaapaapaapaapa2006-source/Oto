#!/usr/bin/env python3
"""Generate today's "今日は何の日" rakugo short story with Claude.

Calls Claude Opus 5 with the web_search server tool so the model can look up
what today's date is notable for before writing, then returns the raw model
output split into the four required sections (title / body / closing line /
hashtags).
"""
from __future__ import annotations

import argparse
import dataclasses
import json
import re
import sys
from datetime import datetime
from zoneinfo import ZoneInfo

import anthropic

MODEL = "claude-opus-5"
JST = ZoneInfo("Asia/Tokyo")

CLOSING_LINE = "本日の一席、これにて。また明日、暦の隅で。"
FIXED_HASHTAG = "#暦の隅で"

SYSTEM_PROMPT = """あなたは寄席の作家です。「今日は何の日」を題材にした日替わり小噺を書きます。

【手順】
1. まず今日の日付を確認し、web_searchツールを使ってその日の記念日・出来事を洗い出す。
2. 候補の中から「意外性がある / ツッコミどころがある / 現代の話題に接続できる」ものを1つ選ぶ。
   ありきたりな記念日しかない場合は、語呂合わせや歴史的事件から拾ってよい。
3. サゲ（オチ）を頭の中で3案作り、いちばん切れ味のあるものを採用する。
   その過程は出力せず、完成した噺だけを出す。

【登場人物】
・八っつぁん：早とちりで直情的。世間の理不尽に本気で怒る。愛嬌がある。
・ご隠居：淡々として物知り。説教はせず、一言でひっくり返す。

【型】
・冒頭は状況説明ではなく「絵が浮かぶ一文」または八っつぁんの叫びから始める。
  例:「湯気の立った丼を抱えて駆け込んでまいります」
・中盤で必ず現代への皮肉を一滴入れる（SNS、レビュー、通知、リモート会議など）。
  刺すのは世相であって、特定の人物や属性ではない。
・サゲは短く。説明せず、言い切って終わる。

【決め台詞（毎回必ず一字一句そのまま。改変禁止）】
本文の最後に、以下の一行を必ず置いて締める。
「本日の一席、これにて。また明日、暦の隅で。」

【禁止】
・オチの解説をしない。「つまり〜ということですね」は書かない。
・道徳の教訓で締めない。乾いた笑いで終わらせる。
・「いかがでしたか」「〜な今日この頃」などのテンプレ表現。
・記念日の由来を長々と説明しない。噺の中に自然に溶かす。
・決め台詞を言い換えたり、前後に別の締め文句を足したりしない。

【出力形式】
以下の4つの見出しを一字一句そのまま使い、他の前置き・後書き・挨拶は一切書かないこと。

■タイトル
（15字以内・日付と記念日名を含む）

■本文
（300〜400字。会話主体、地の文は最小限）

■決め台詞
「本日の一席、これにて。また明日、暦の隅で。」

■ハッシュタグ
（3つ、半角スペース区切り。うち1つは #暦の隅で 固定）
"""


@dataclasses.dataclass
class RakugoPost:
    title: str
    body: str
    closing_line: str
    hashtags: list[str]
    raw: str

    @property
    def full_body(self) -> str:
        """Article body for posting: story + closing line."""
        return f"{self.body}\n\n{self.closing_line}"


def _extract_section(raw: str, header: str, next_headers: list[str]) -> str:
    alternatives = [re.escape(h) for h in next_headers] + [r"\Z"]
    pattern = re.escape(header) + r"\s*\n(.*?)(?=" + "|".join(alternatives) + r")"
    match = re.search(pattern, raw, re.DOTALL)
    if not match:
        raise ValueError(f"Could not find section {header!r} in model output:\n{raw}")
    return match.group(1).strip()


def parse_rakugo(raw: str) -> RakugoPost:
    headers = ["■タイトル", "■本文", "■決め台詞", "■ハッシュタグ"]
    title = _extract_section(raw, "■タイトル", headers[1:])
    body = _extract_section(raw, "■本文", headers[2:])
    closing = _extract_section(raw, "■決め台詞", headers[3:])
    tags_raw = _extract_section(raw, "■ハッシュタグ", [])

    if CLOSING_LINE not in closing:
        raise ValueError(f"Closing line was altered: {closing!r}")

    hashtags = re.findall(r"#\S+", tags_raw)
    if FIXED_HASHTAG not in hashtags:
        hashtags.append(FIXED_HASHTAG)

    return RakugoPost(
        title=title,
        body=body,
        closing_line=CLOSING_LINE,
        hashtags=hashtags,
        raw=raw,
    )


def generate(today: datetime | None = None) -> RakugoPost:
    today = today or datetime.now(JST)
    date_str = today.strftime("%Y年%m月%d日")

    client = anthropic.Anthropic()
    response = client.messages.create(
        model=MODEL,
        max_tokens=8000,
        system=SYSTEM_PROMPT,
        thinking={"type": "adaptive"},
        output_config={"effort": "high"},
        tools=[
            {
                "type": "web_search_20260209",
                "name": "web_search",
                "max_uses": 5,
            }
        ],
        messages=[
            {
                "role": "user",
                "content": (
                    f"今日は{date_str}です。今日の記念日・出来事をweb_searchで調べたうえで、"
                    "指定の出力形式どおりに小噺を書いてください。"
                ),
            }
        ],
    )

    text_parts = [block.text for block in response.content if block.type == "text"]
    raw = "\n".join(text_parts).strip()
    if not raw:
        raise RuntimeError(f"No text content in response: {response.to_dict()}")

    return parse_rakugo(raw)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--json", action="store_true", help="Print result as JSON")
    args = parser.parse_args()

    try:
        post = generate()
    except anthropic.APIStatusError as e:
        print(f"Anthropic API error ({e.status_code}): {e.message}", file=sys.stderr)
        return 1
    except (ValueError, RuntimeError) as e:
        print(f"Generation/parsing failed: {e}", file=sys.stderr)
        return 1

    if args.json:
        print(
            json.dumps(
                {
                    "title": post.title,
                    "body": post.body,
                    "closing_line": post.closing_line,
                    "full_body": post.full_body,
                    "hashtags": post.hashtags,
                },
                ensure_ascii=False,
                indent=2,
            )
        )
    else:
        print(post.raw)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
