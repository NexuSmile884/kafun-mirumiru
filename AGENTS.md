# 花粉みるみる — Project Guide for AI Agents

このファイルは Claude Code / Codex CLI の両方が読む共通仕様。Claude は `CLAUDE.md` 経由でこれを参照する。

## What this is

埼玉県川口市（city code: 11203）の花粉飛散情報を 1 日 3 回 X (旧 Twitter) に自動投稿するボット + GitHub Pages の閲覧ダッシュボード。

- **Live site**: https://nexusmile884.github.io/kafun-mirumiru/
- **X account**: https://x.com/kafun_mirumiru
- **Repo**: https://github.com/NexuSmile884/kafun-mirumiru
- **Owner**: nexusmile884@gmail.com

## Repo layout

```
kafun-mirumiru/
├── .github/workflows/daily-post.yml   # 1 日 3 回 cron で X 投稿（朝7/昼12/夜20 JST）
├── x-bot/                              # Node.js: 花粉データ取得 → 本文生成 → X 投稿
│   ├── post.js                         # メインスクリプト（CONFIG, fetchPollen, buildPost, postToX, main）
│   ├── package.json                    # deps: dotenv, twitter-api-v2
│   ├── .env.example                    # X API 4 キー + DRY_RUN
│   └── .env                            # ローカル動作用（.gitignore 済）
├── index.html / app.js / style.css    # GitHub Pages ダッシュボード
├── AGENTS.md                           # ← このファイル（両 AI 共通）
├── CLAUDE.md                           # Claude 用エイリアス（@AGENTS.md import）
└── STRATEGY.md                         # 成長戦略（4→100→1000→10000 フォロワー）
```

## Common commands

すべて `x-bot/` 配下で実行（package.json があるため）。

```bash
cd x-bot

# ドライラン（投稿せず本文だけ確認、ローカルに .env 必要）
DRY_RUN=true node post.js
# または: npm run dry

# 本番投稿（API キー消費 = クレジット消費）
node post.js
# または: npm run post

# 依存追加
npm install --save <pkg>
```

GitHub Actions の手動トリガー（gh CLI 認証済み前提）:

```bash
gh workflow run "花粉みるみる Daily Post" -R NexuSmile884/kafun-mirumiru
gh run list -R NexuSmile884/kafun-mirumiru --workflow="花粉みるみる Daily Post" --limit 5
gh run view <RUN_ID> -R NexuSmile884/kafun-mirumiru --log-failed
```

## Data source

**WxTech 花粉ポールンロボ API**（無料・無認証）

- Endpoint: `https://wxtech.weathernews.com/opendata/v1/pollen?citycode=<CODE>&start=<YYYYMMDD>&end=<YYYYMMDD>`
- Returns: CSV (`citycode,date,pollen`)
- City code 11203 = 埼玉県川口市
- `pollen = -9999` は欠測扱い（コード内で除外）
- 飛散量レベル分け: 0 / ≤30 / ≤100 / ≤200 / ≤400 / それ以上 → なし/少ない/やや多い/多い/非常に多い/猛烈

## Secrets / Environment

GitHub Actions secrets（`gh secret list -R NexuSmile884/kafun-mirumiru` で確認可、値は不可）:

| Name | 用途 |
|------|-----|
| `X_API_KEY` / `X_API_SECRET` | X API v2 Consumer Keys（OAuth 1.0a） |
| `X_ACCESS_TOKEN` / `X_ACCESS_TOKEN_SECRET` | X API v2 User Access Tokens |

ローカル開発時は `x-bot/.env`（`.env.example` をコピー）。

その他の workflow env:
- `TZ=Asia/Tokyo` / `CITY_CODE=11203` / `CITY_NAME=川口市` / `PREF_NAME=埼玉県`

## X API status & known issues

- **2026-04-27 〜**: HTTP 402 `CreditsDepleted` で連続失敗 → クレジット枯渇が原因
- **対処**: 自動チャージ ON（2026-05-04）。今後は無駄打ち削減＋エンゲージメント最大化の方針
- **エラーログ**: post.js の `postToX()` は `err.code` / `err.data` / `err.errors` / `err.rateLimit` / `x-access-level` を全て出力する（[ade6752](https://github.com/NexuSmile884/kafun-mirumiru/commit/ade6752)）

## Conventions

- **Commit**: 日本語 or 英語どちらでも可。1 行目は要約、本文に why。Co-Authored-By trailers は AI 関与時に付与
- **Branching**: 単独開発のため master 直 push で OK。大きな変更は feature ブランチ + PR でレビュー
- **Files NOT to touch without reason**:
  - `.github/workflows/daily-post.yml` のスケジュール（クォータに直結）
  - `x-bot/.env`（秘密情報）
- **コメント**: 英語/日本語混在 OK。why が非自明な箇所だけ。テンプレート文言の絵文字は仕様の一部

## Workflow when modifying post.js

1. `cd x-bot && DRY_RUN=true node post.js` でロジック検証
2. git add / commit / push to master
3. `gh workflow run "..."` で手動トリガー（クレジット消費注意）
4. `gh run view --log-failed` または `gh run watch` で結果確認

## Cross-agent collaboration

- **Claude Code (Sonnet/Opus)**: MCP（Chrome / Obsidian / Gmail / Calendar 等）駆動、長文脈設計、対話的タスク
- **Codex CLI (gpt-5.5)**: 単発の明確タスク、第二眼レビュー、並列作業
- **どちらが何をするか**: タスクごとに Claude が A/B/C/D ルート提案 → ユーザー承認の運用
- Codex 呼び出し: `codex exec --skip-git-repo-check "<prompt>"`
