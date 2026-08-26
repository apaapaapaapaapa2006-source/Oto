# 寄席小噺 自動投稿 (note.com)

「今日は何の日」を題材にした日替わり小噺を Claude で生成し、note.com に自動投稿する仕組み。
`.github/workflows/daily-rakugo.yml` が毎日 07:00 JST に起動する。

## 構成

- `generate_rakugo.py` — Claude Opus 5 に `web_search` ツールを与えて今日の記念日を調べさせ、
  指定フォーマット（■タイトル / ■本文 / ■決め台詞 / ■ハッシュタグ）で小噺を生成・パースする。
- `post_to_note.py` — Playwright で note.com に実際にログインし、新規記事エディタを操作して投稿する。
  note.com には投稿用の公式APIが無いため、実際の編集画面をブラウザ自動操作している。
- `daily_post.py` — 上記2つをつなぐオーケストレーター。生成結果を `posts/YYYY-MM-DD.json` に記録する。

## 必要な GitHub Secrets

リポジトリの Settings → Secrets and variables → Actions に以下を登録する。

| Secret | 用途 |
| --- | --- |
| `ANTHROPIC_API_KEY` | 小噺生成用の Claude API キー |
| `NOTE_EMAIL` | note.com ログイン用メールアドレス |
| `NOTE_PASSWORD` | note.com ログイン用パスワード |

## 手動実行・動作確認

GitHub Actions の "Run workflow" から `dry_run: true` を指定すると、小噺の生成だけ行い
note.com への投稿はスキップする。まずはこれで生成結果を確認するのが安全。

ローカルで試す場合:

```bash
cd scripts
pip install -r requirements.txt
playwright install chromium

export ANTHROPIC_API_KEY=...
python daily_post.py --dry-run
```

投稿まで含めて試す場合は `NOTE_EMAIL` / `NOTE_PASSWORD` を設定して `--dry-run` を外す。

## 既知の制約・注意点

- note.com は投稿用の公式APIを公開していないため、本スクリプトは実際のログイン画面・記事エディタを
  ブラウザ自動操作で操作している。note.com 側の画面構成が変わると壊れる可能性がある。
- ログイン時に CAPTCHA や2段階認証が表示されるアカウントでは自動ログインできない。該当する場合は
  投稿専用アカウントで2FAを無効化するなどの対応が必要。
- 失敗時はスクリーンショットとHTMLを `scripts/debug-artifacts/` に保存し、GitHub Actions の
  Artifacts からダウンロードできるようにしている。
- 生成された小噺は `posts/` 配下にJSONで記録され、ワークフローが自動コミットする。
