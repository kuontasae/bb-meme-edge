# bb Meme Edge

## 概要

bb Meme Edge は、NansenのSmart Moneyデータを使ってSolana小型ミーム候補を発見し、Discord上でResearch Cardとして表示するBotです。

ユーザーは Watch / Paper IN / Conviction でPaper Pickでき、Botは候補投稿時のMCapとユーザーがボタンを押した瞬間のMCapを記録します。

その後、1h / 6h / 24h Result、Leaderboard、Daily / Weekly / Monthly Recapで、Botとコミュニティの成績を可視化します。

## 解決する課題

- Solanaミーム候補を探す時間がかかる
- 何のトークンか、なぜ見るべきか分かりにくい
- Smart Money flowを人間向けに解釈するのが難しい
- あとで本当に伸びたか振り返りにくい
- コミュニティ内で誰のPaper Pickが良かったか見えにくい

## 主な機能

- `/meme-scan`
- Research Card
- Watch / Paper IN / Conviction
- `/meme-results`
- `/my-picks`
- `/my-performance`
- `/leaderboard`
- `/meme-recap`
- 自動 1h / 6h / 24h Result
- 定時スキャン
- Daily / Weekly / Monthly Recap

## コマンド一覧

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

## Paper Pick ルール

- Watch: 0pt、ランキング対象外
- Paper IN: 1pt、ランキング対象
- Conviction: 3pt、ランキング対象、1日1回まで
- Daily Budget: 5pt
- Score計算式:

```text
Score = Σ((return_x - 1) × used_points × 100)
```

## Nansen活用

- Nansen CLI / API を使ってSmart Money netflowを取得します。
- Smart Money Flow、Flow/MCap、24h / 7d Flow、Trader数、Token ageなどを使ってMeme Edge Scoreを計算します。
- Nansen Signal Reviewで、どのシグナルが強かったかをDaily / Weekly / Monthlyで振り返ります。
- 将来的に token info / flow-intelligence / holders / who-bought-sold / agent を組み合わせて、ナラティブと精査精度を強化します。

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

## データソース

- Nansen: Smart Money / Flow / Signal
- DexScreener: price / MCap / token icon / chart link
- GMGN: Solana token research link
- UniversalX: trade link

UniversalXのSolanaリンク形式:

```text
https://universalx.app/trade?assetId=101_<TOKEN_ADDRESS>
```

開発中は `data/solana-netflow-sample.json` を保存済みサンプルとして使えます。このファイルは `USE_MOCK_NANSEN=true` のときにNansenクレジットを消費せずに動作確認するためのものです。

## セットアップ

1. Node.jsをインストールします。
2. 依存関係をインストールします。

```bash
npm install
```

3. `.env.example` を参考に `.env` を作成します。
4. Discord Bot token / client id を設定します。
5. Nansen API key を設定します。
6. 開発サーバーを起動します。

```bash
npm run dev
```

7. Discordで `/ping` や `/meme-scan` などのコマンドを試します。

## 環境変数

`.env.example` に合わせて設定します。

- `DISCORD_TOKEN`: Discord Bot token。
- `DISCORD_CLIENT_ID`: Discord application client id。
- `NANSEN_API_KEY`: Nansen CLI / APIで使うAPI key。
- `USE_MOCK_NANSEN`: Nansen取得モードの切替。
- `MEME_EDGE_CHANNEL_ID`: 定時スキャン・定時Recapの投稿先チャンネルID。

`USE_MOCK_NANSEN=true` の場合、開発中は保存済みサンプルJSONを使い、Nansenクレジットを消費しません。

`USE_MOCK_NANSEN=false` の場合、本物のNansen CLI/APIを使います。

## Mock / Cache 設計

- 開発中は mock JSON を使います。
- Nansen結果は5分キャッシュします。
- クレジット消費を抑えながら開発できます。
- 本番確認時だけlive Nansenを使います。

## 自動投稿

JST基準で以下の定時投稿を行います。

- 09:00 Morning Scan
- 16:00 EU Open Scan
- 23:00 US Prime Scan
- 09:30 Daily Recap
- 日曜21:00 Weekly Recap
- 毎月1日21:00 Monthly Recap

setInterval簡易スケジューラーの制限:

Botが起動している間だけ有効です。再起動中の予定は実行されません。本番ではcron / persistent scheduler / job queueへの移行が望ましいです。

## AI利用開示

開発AI:

- OpenAI ChatGPT / Codex を仕様整理、実装支援、UI文言調整、TypeScript修正に使用

ランタイムAI:

- 現時点では必須ではありません。
- 将来的にNarrative ResolverやNansen Signal Reviewの要約でAIを使う場合は、プロバイダー、モデル、ガードレール、フォールバックを明記します。

ガードレール:

- 投資助言として表示しない
- 実取引を実行しない
- 秘密鍵やウォレット接続を扱わない
- 取得データが不足する場合はN/Aや低confidenceとして扱う

## 安全性

- APIキーは`.env`で管理し、直書きしません。
- `.env`はGitに含めません。
- 実取引なし
- ウォレット接続なし
- 秘密鍵なし
- Paper Pickは調査・学習用

## 免責

これは投資助言ではありません。
Nansenデータに基づく調査補助・Paper Pick・振り返り用Botです。
実際の売買判断はユーザー自身の責任です。

## 今後の改善

- Narrative Resolver強化
- Nansen token info / flow-intelligence / holders / who-bought-sold連携
- 本番用scheduler
- PostgreSQL移行
- より高度なNansen Signal Review
- Monthly report強化
