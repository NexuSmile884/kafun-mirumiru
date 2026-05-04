# Claude → Codex 全国版実装のクロスレビュー

> 対象: 未コミットの作業ツリー (cities.json + index.html / app.js / style.css / x-bot/post.js)
> レビュー実施: 2026-05-04, Claude Code (Opus 4.7)
> 評価方法: 仕様書の受け入れ条件 7 項目 + コード設計レビュー + ローカル http サーバー (port 8765) で実機検証

## 結論

**おおむね Spec 完全準拠。Must-fix は 1 件のみ**。実装品質は高く、受け入れ条件 7 項目すべてクリア。発見されたバグは軽微で、ボタン 1 個の click ハンドラ漏れ。残りはすべて Nice-to-have。

---

## ✅ 受け入れ条件スコア

| # | 条件 | 結果 | 検証方法 |
|---|------|------|---------|
| 1 | 初回 `/` で川口固定にならない | ✅ | dashboard hidden / empty-state 表示 確認 |
| 2 | `/?city=11203` で川口直接表示 | ✅ | 「埼玉県 川口市」+ 本日合計 4 確認 |
| 3 | `/?city=13103` で東京都港区直接表示 | ✅ | 「東京都 港区」+ 本日合計 5 / 7日 146 確認 |
| 4 | 名前・都道府県・5桁コードで検索 | ✅ | `cities.json` の `search` フィールドで NFKC + lowercase + 全角空白除去 → AND 検索 (`renderSearchResults`) |
| 5 | 無効コード/API 404/欠測 -9999 で画面壊れない | ✅ | `?city=99999` → 全時間「欠測」表示 / `?city=abc` → status「5桁の数字で指定」 / -9999 は `getHourlyLevel` で「欠測」分岐 |
| 6 | DRY_RUN で全国版サイト導線になっている | ✅ | 投稿本文末尾に「全国の市区町村を選べます」、リンクは `?city=11203` 付き |
| 7 | git diff で `.env` が変更されていない | ✅ | `.env` は `.gitignore` 済 / git status に出ない |

---

## 🐞 Must-fix

### 1. `resumeRegion` ボタンに click ハンドラがない（dead button）

**症状**: 「前回の地域を表示: ◯◯」ボタンが表示されるが、クリックしても何も起こらない。
**原因**: `bindSearch / bindPopularButtons / bindCustomCode / bindTabs` のどこにも `els.resumeRegion` への listener bind がない。`bindPopularButtons` は `[data-city-code]` セレクタで bind するが、resumeRegion は `data-city-code` を持たない。
**該当箇所**: [app.js:222-231](app.js) の `renderResumeButton` は表示までしか責務がなく、bind 関数も無い。

**修正案** (4-5 行追加):

```js
function bindResumeButton() {
    els.resumeRegion.addEventListener('click', () => {
        const saved = readSavedCity();
        if (saved) selectCity(saved.code, { meta: saved.meta });
    });
}
```

そして `init()` 内の bind 列に `bindResumeButton();` を追加。

---

## 💡 Nice-to-have（任意、優先度低）

### N1. citySearch を選択後にラベルで埋めるか、空に戻すか

`selectCity` 内で `els.citySearch.value = cityLabel(meta)` により「東京都 港区」が入力欄に残る。利点: 現在の選択が一目でわかる。欠点: 続けて検索したい時に clear が必要（× ボタンあり）。
→ どちらでも良い。現状で十分実用的。

### N2. status message が `<main>` 外にある

`get_page_text` で `<main>` を抽出した時に status 文言が含まれない。スクレイパー目的なら `<main>` 内に移動 or `aria-live` を本文に重ねる手もあるが、人間 UX には影響なし。

### N3. 「コード指定」フォールバックの localStorage 永続化

不明コードを指定した後、localStorage に `pollenPrefName='コード指定'` が残る。次回訪問時 readSavedCity でそのまま復元される。「コード指定」表記が再表示されるが、これは仕様の範囲内（UX 上問題なし）。

### N4. 30 分間隔の auto-refresh の通知

`startTimer` で `setInterval(load, 30 min)` だが、ユーザーには更新時刻 (`HH:MM 更新`) しか出ない。タブ切替時に古いデータが残るのは Web の通例なのでこのままで OK。

### N5. mobile レスポンシブ確認できず

`max-width: 720px` 設計なので素直に縦並びになるはず。実機（375px 等）での重なり確認は手動推奨。

---

## 🌟 良かった点（特筆）

1. **欠測値 (-9999) の扱い**: `getHourlyLevel` で `0` (なし) と `-9999` (欠測) を別レベルに分けて UI 上「–／欠測」で明示。Spec 要件をきっちり実装。
2. **API ページネーション** (`fetchPollen` 30 日チャンク + `Map` で重複除去): 7 日間取得には不要だが将来の長期間対応に備えていて好設計。
3. **コード重複ガード**: 5桁コード以外は status error。`/^\d{5}$/` で 早期 return。
4. **searchable normalization**: `cities.json` に予め `search` フィールドが計算済み + 利用時に `NFKC + lowercase + 空白除去` でかなり堅牢な日本語検索。
5. **「コード指定」の直接入力導線**: `cities.json` にない 5 桁コードでも検索結果に「コード XXXXX を直接指定」が出る。WxTech がコード追加した時にもユーザーが先行して試せる。
6. **fetchPollen の reservation 構造** (`Number.parseInt` + `Number.isNaN` ガード + null 行除去): 不正 CSV へ堅牢。
7. **AdSense 完全コメントアウト** + 出典表記 + 「医療判断ではない」明記: 商用/規約配慮 OK。
8. **OGP / meta 全国版に書換**: title/description/og:* / twitter:card 一貫。
9. **post.js の `getSiteUrl()` 抽象化**: 今後地域別の URL 派生（例: `?city=...&range=week`）にも拡張しやすい。

---

## 📊 ボリューム

```
 4 files changed, 1173 insertions(+), 632 deletions(-)
 + cities.json (新規 312KB, 約 3000 市区町村)
```

post.js 改修は最小（リンク + ハッシュタグ + 1 行追加）。サイト側は事実上ゼロから書き直し、設計は **Spec 通り**。

---

## ✋ 次の一手（推奨手順）

1. **Must-fix #1** を実装（`bindResumeButton` 追加）
2. ローカル `python -m http.server` で `/`、`/?city=11203`、`/?city=13103`、`/?city=99999` を再確認
3. `git add .` して 1 コミットで push（`cities.json` を含む）
4. GitHub Pages がデプロイされたら本番 URL でも同じ確認
5. 続けて X 投稿の手動トリガーで `?city=11203` リンク付き投稿 → モバイルで card プレビューを目視

---

## 補足: 衝突確認

- 私 (Claude) は今回ファイルを編集していません。Codex が同 git tree で作業中とのことだったので、READ-ONLY で検証のみ実施。
- `git status` 上、Codex の作業はまだ uncommitted。`claude-review-of-codex.md` (このファイル) は untracked として追加されます。コミット時に含めるかどうかは判断ください。
