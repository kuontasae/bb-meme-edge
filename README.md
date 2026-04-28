# bb Meme Edge

## 概要

bb Meme Edge は、NansenのSmart Moneyデータを使ってSolana小型ミーム候補を発見し、Discord上でResearch Cardとして表示するBotです。

ユーザーは Watch / Paper IN / Conviction でPaper Pickでき、Botは候補投稿時のMCapとユーザーがボタンを押した瞬間のMCapを記録します。

その後、1h / 6h / 24h Result、Leaderboard、Daily / Weekly / Monthly Recapで、Botとコミュニティの成績を可視化します。

## Demo Flow

審査員がデモで確認しやすい基本フローです。

1. `/meme-scan`
2. Research Cardを確認
3. Watch / Paper IN / Conviction を押す
4. `/my-picks`
5. `/meme-results period:latest`
6. `/leaderboard period:daily`
7. `/meme-recap period:daily`
8. `/dev-post-result window:1h`
9. `/dev-run-recap period:weekly`

`/dev-post-result` と `/dev-run-recap` などのdev系コマンドは、デモ・開発確認用です。通常運用では定時スキャン・定時Recapによって自動投稿される想定です。

## 解決する課題

- Solanaミーム候補を探す時間がかかる
- 何のトークンか、なぜ見るべきか分かりにくい
- NansenのSmart Money dataをそのまま見ても初心者には解釈しづらい
- 候補を出して終わりでは、あとで本当に伸びたか検証しづらい
- コミュニティ内で誰のPaper Pickが良かったか見えにくい

## 主な機能

- Nansen Smart Money netflowから候補検出
- Meme Edge Score
- Status表示
- Research Card
- Watch / Paper IN / Conviction
- ボタン押下人数表示
- `/meme-results`
- `/my-picks`
- `/my-performance`
- `/leaderboard`
- `/meme-recap`
- 1h / 6h / 24h Result
- 定時スキャン
- Daily / Weekly / Monthly Recap

## Research Card

Research Cardは、Discord上で候補をすぐ判断できるように、トークン概要・Smart Money signal・リンク・Paper Pickボタンを1枚にまとめます。

表示内容:

- Token symbol / name
- token icon
- Meme Edge Score
- Status
- Summary
- Narrative
- Why flagged
- Entry data
- Contract
- Quick Links
- Watch / Paper IN / Conviction buttons

Quick Links:

- DexScreener
- GMGN
- UniversalX
- Nansen deep dive placeholder

UniversalXのSolanaリンク形式:

```text
https://universalx.app/trade?assetId=101_<TOKEN_ADDRESS>
```

## Paper Pick ルール

- Watch: 0pt、ランキング対象外
- Paper IN: 1pt、ランキング対象
- Conviction: 3pt、ランキング対象、1日1回まで
- Daily Budget: 5pt
- Score = Σ((return_x - 1) × used_points × 100)

例:

2.0x の Paper IN:

```text
(2.0 - 1) × 1pt × 100 = +100 pts
```

4.0x の Conviction:

```text
(4.0 - 1) × 3pt × 100 = +900 pts
```

Paper Pickは実取引ではありません。候補を見た時点の判断をPaper上で記録し、あとから結果を検証するための仕組みです。

## Nansen活用

- Nansen CLI / API でSmart Money netflowを取得
- Smart Money Flow、Flow/MCap、24h / 7d Flow、Trader数、Token ageなどを使ってMeme Edge Scoreを計算
- Nansen Signal ReviewでDaily / Weekly / Monthlyに勝ちパターンを振り返る
- 現在はmock/cacheでクレジット消費を抑えながら開発可能
- 将来的に token info / flow-intelligence / holders / who-bought-sold / Nansen agent を使ってナラティブと精査精度を強化予定

開発中は `USE_MOCK_NANSEN=true` にすることで、保存済みサンプルJSONを使ってNansenクレジットを消費せずに動作確認できます。Nansen結果は短時間キャッシュし、同じ確認で不要にAPIを叩かない設計です。

## Meme Edge Score

初期スコア配分:

- Flow/MCap異常度: 30点
- Smart Money Flow: 25点
- Earlyness: 20点
- Trader Confirmation: 15点
- Risk Adjustment: 10点

Status:

- Strong Edge
- Watch
- High-risk Speculative
- Weak

## Commands

- `/ping`: Botの疎通確認用。`pong`を返します。
- `/desk-test`: Nansen CLI の Smart Money netflow 取得をテストします。
- `/meme-scan`: Solana meme候補をスキャンし、Research Cardを投稿します。
- `/meme-rules`: Watch / Paper IN / Conviction のPaper Pickルールを表示します。
- `/meme-results`: 保存済みシグナルの成績を latest / daily / weekly / monthly で表示します。
- `/my-picks`: 自分のPaper Pick履歴を today / weekly / monthly で確認します。
- `/my-performance`: 自分のPaper Pick成績を daily / weekly / monthly で確認します。
- `/leaderboard`: Paper IN / Conviction のコミュニティランキングを表示します。
- `/meme-recap`: Daily / Weekly / Monthly のBot・コミュニティ・Nansen Signal Reviewを表示します。
- `/dev-reset-me`: 開発・デモ用。自分の本日使用ポイントをリセットします。
- `/dev-post-result`: 開発・デモ用。最新スキャンの 1h / 6h / 24h Result を再投稿します。
- `/dev-run-scheduled-scan`: 開発・デモ用。定時スキャンと同じ処理を任意チャンネルで実行します。
- `/dev-run-recap`: 開発・デモ用。定時Recapと同じ処理を任意チャンネルで実行します。

## 自動運用

JST基準で以下の定時投稿を行います。

- 09:00 Morning Scan
- 16:00 EU Open Scan
- 23:00 US Prime Scan
- 09:30 Daily Recap
- 日曜21:00 Weekly Recap
- 毎月1日21:00 Monthly Recap

現在のスケジューラーは `setInterval` ベースの簡易実装です。Botプロセスが起動している間だけ有効で、再起動中・停止中の予定は実行されません。本番ではcron / persistent scheduler / job queueへの移行が望ましいです。

## セットアップ

```bash
npm install
cp .env.example .env
npm run dev
```

`.env` にDiscordとNansenの設定を入れます。

- `DISCORD_TOKEN`: Discord Bot token
- `DISCORD_CLIENT_ID`: Discord application client id
- `NANSEN_API_KEY`: Nansen CLI / APIで使うAPI key
- `USE_MOCK_NANSEN`: Nansen取得モードの切替
- `MEME_EDGE_CHANNEL_ID`: 定時スキャン・定時Recapの投稿先チャンネルID

開発・デモ時は `USE_MOCK_NANSEN=true` でmock/cacheを使えます。本番確認時は `USE_MOCK_NANSEN=false` にしてlive Nansenを使います。

## データソース

- Nansen: Smart Money / Flow / Signal
- DexScreener: price / MCap / token icon / chart link
- GMGN: Solana token research link
- UniversalX: trade link

## 安全性

- 投資助言として表示しない
- 実取引を実行しない
- ウォレット接続なし
- 秘密鍵なし
- APIキーは `.env` で管理し、コードに直書きしない
- `.env` はGitに含めない
- 取得データが不足する場合はN/Aや低confidenceとして扱う
- Paper Pickは調査・学習・振り返り用

## AI利用開示

開発AI:

- OpenAI ChatGPT / Codex を仕様整理、実装支援、UI文言調整、TypeScript修正に使用

ランタイムAI:

- 現時点では必須ではありません。
- 将来的にNarrative ResolverやNansen Signal Reviewの要約でAIを使う場合は、プロバイダー、モデル、ガードレール、フォールバックを明記します。

## 免責

これは投資助言ではありません。
Nansenデータに基づく調査補助・Paper Pick・振り返り用Botです。
実際の売買判断はユーザー自身の責任です。

## 今後の改善

- Narrative Resolver強化
- Nansen token info / flow-intelligence / holders / who-bought-sold連携
- Nansen agentによる深掘り調査
- 本番用scheduler
- PostgreSQL移行
- より高度なNansen Signal Review
- Monthly report強化
