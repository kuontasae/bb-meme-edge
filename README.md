# bb Meme Edge

## 概要

bb Meme Edge は、NansenのSmart Moneyデータを使ってSolana小型ミーム候補を発見し、Discord上でResearch Cardとして表示するBotです。

ユーザーは Conviction / エアIN / Watch でPaper Pickでき、Botは候補投稿時のMCapとユーザーがボタンを押した瞬間のMCapを記録します。

その後、1h / 6h / 24h Result、Leaderboard、Daily / Weekly / Monthly Recapで、Botとコミュニティの成績を可視化します。

## Demo Flow

審査員がデモで確認しやすい基本フローです。

1. `/meme-scan`
2. Research Cardを確認
3. Conviction / エアIN / Watch を押す
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
- Conviction / エアIN / Watch
- ボタン押下人数表示
- Fresh Scan 最大5件
- Meme Edge Alert
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
- Conviction / エアIN / Watch buttons

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
- エアIN: 1pt、ランキング対象
- Conviction: 3pt、ランキング対象、1日1回まで
- Daily Budget: 5pt
- Score = Σ((return_x - 1) × used_points × 100)

例:

2.0x の エアIN:

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

`USE_MOCK_NANSEN=false` ではlive Nansen CLI / APIを使うため、Nansen creditsを消費します。本番テスト時は `/nansen-credits` で実行前の残量を確認し、`/meme-scan` / `/meme-deep-check` / `/dev-run-alert-check` などの実行後に本人向け表示と `/nansen-credit-logs` で差分を必ず確認してください。mock modeではlive Nansenを叩かないためcreditsは消費されません。

## Fresh Scan と Alert

定時スキャンと `/meme-scan` は、固定ランキングではなく Fresh Scan 最大5件として投稿します。直近24時間以内に同じ `token_address` が `signals` に保存されている場合は原則再掲せず、条件を満たす候補が5件未満ならその件数だけ表示します。候補が0件の場合は、Fresh Scanでは強い新規候補がなかった旨をチャンネルに投稿します。

Fresh Scanは小型初動を優先します。MCap $50K〜$2Mを中心に評価し、$2M〜$5Mは軽い減点、$5M〜$10Mは強めに減点、$10M以上は定時Fresh Scanでは原則除外します。Age 180日以上の古い銘柄は初動ではなく Re-Flow として扱い、Smart Money flowが明確に戻った場合だけ優先度を下げて検出します。

Meme Edge Alertは、定時スキャンとは別に条件を満たした小型候補だけを投稿する仕組みです。Alert対象は必ず MCap $2M以下で、Meme Edge Score 75以上、Flow/MCap 3%以上、24h Flow $5K以上、Traders 3人以上を目安にします。同じ `token_address` は `alerts` を見て24時間以内に再Alertしません。

`/dev-run-alert-check` は開発・デモ用の手動Alert確認コマンドです。実行したチャンネルにAlert対象があれば投稿し、なければ実行者だけに「Alert条件を満たす候補はありませんでした」と返します。本番では1時間ごとのAlert Checkを想定していますが、Nansenクレジットを消費し得るため、頻度・キャッシュ・運用時間を確認してください。

AlertはMCap $2M以下などの一次条件だけでは投稿されません。候補ごとに自動Deep Checkを実行し、Quality Gateを通過したものだけ `🚨 Meme Edge Alert` として投稿します。Quality Gateでは Flow Quality / Holder Risk / Buyer-Seller Balance / Sell Pressure / Wallet Quality / Cluster Risk Lite を確認します。

Quality Gateの基本方針:

- Flow QualityがStrongまたはMedium
- Holder RiskがHighではない
- Buyer/Seller BalanceがBearishではない
- Sell PressureがHighではない
- Wallet QualityがMicro-arb偏重ではない
- Cluster Risk LiteがHighではない
- MCap $2M以下

Quality Gateで落ちた候補はAlert投稿しません。`/dev-run-alert-check` ではDeep Check件数、通過件数、除外件数、主な除外理由を本人だけに返します。live Nansen利用時はAlert候補の自動Deep Check分も追加クレジットを消費する可能性があります。Quality Gateは投資助言ではなく、調査優先度を整理するための補助判定です。

Signal Typeは、Scoreだけでは見えにくいシグナルの種類をカード上部とDBに保存する分類です。

- 🌱 Fresh Edge: Age 30日以内、MCap $2M以下、Flow/MCapが強い初動候補
- 🚨 Alert Edge: Alert条件を満たした小型候補
- 🔁 Re-Flow: Age 180日以上の古い銘柄に再びSmart Money flowが入った候補
- 🐋 Whale Flow: 大型MCapに大きなflowが入った候補
- ⚠️ Thin Liquidity: 少数TraderでFlow/MCapだけが高い薄い候補
- 🤖 Bot-like Flow: 少数Traderかつ短期flow偏重の機械的な動きが疑われる候補
- ❔ Unknown: まだ明確な分類に入らない候補

RecapのNansen Signal Reviewでは、Fresh Edge / Alert Edge / Re-Flow / Thin Liquidityの件数と平均成績を表示し、Signal Typeごとの傾向を振り返ります。

`/meme-recap` は単なる結果レポートではなく、次回スコア改善のためのLearning Layerとしても使います。過去の `signals` と `performance_snapshots` をもとに、条件別のreturn_xを集計し、Learning Summaryとして表示します。

Learning Summaryで見る条件:

- Signal Type別: Fresh Edge / Alert Edge / Re-Flow / Whale Flow / Thin Liquidity / Bot-like Flow / Unknown
- MCap帯別: $50K未満、$50K〜$500K、$500K〜$2M、$2M〜$5M、$5M〜$10M、$10M以上
- Age帯別: 0〜1日、2〜7日、8〜30日、31〜180日、180日以上
- Flow/MCap帯別: 0〜0.3%、0.3〜1%、1〜3%、3〜5%、5%以上
- Cluster Risk別: Low / Medium / High / 未検証
- Wallet Behavior別: Fresh Sniper / Accumulator / Fast Flipper / Micro-arb / Mirror-like / Unknown

Learning Summaryでは平均return_x、中央値、2x超え件数、Best tokenを短く表示します。Next Score Adjustmentでは、勝ちやすかった条件を優先し、弱かった条件の減点を強めるためのルールベース提案を出します。結果は `learning_summaries` table にJSON文字列として保存されます。これは自動売買判断ではなく、調査優先度とスコア改善の補助です。

## Scoring Config

`config/scoring.json` で、Meme Edge Score、Fresh Scan、Alert、Quality Gateの主要条件をコード変更なしで調整できます。このファイルは秘密情報を含まないためGitHubに含めてOKです。`.env` は引き続きGitHubに含めません。

調整できる主な項目:

- `scoreWeights`: Flow/MCap、Smart Money Flow、MCap sweet spot、Freshness、Trader確認、Deep Check品質、Risk penaltyの重み
- `mcapBuckets`: MCap帯ごとのscore、Fresh Scan許可、Alert許可
- `ageBuckets`: Age帯ごとのscore、Fresh Edge / Re-Flowのヒント
- `flowMcapBuckets`: Flow/MCap帯ごとのscore
- `alertRules`: MCap上限、Score下限、Flow/MCap下限、24h Flow下限、Trader下限、dedupe時間、1回あたりAlert数
- `freshScanRules`: Fresh Scanのdedupe時間、最大件数、MCap上限、Re-Flow許可
- `qualityGate`: Holder Risk / Sell Pressure / Buyer-Seller / Cluster Risk / Flow Qualityの通過条件
- `riskPenalties`: Thin Liquidity、Cluster Risk、Micro-arb、Mirror-like、Re-Flow、高MCapの減点

運用では、`/meme-recap` の Learning Summary と Next Score Adjustment を見て、`config/scoring.json` を少しずつ調整します。設定ファイルが存在しない、または壊れている場合でもBotは落ちず、コード内の安全なデフォルト設定で動きます。これは自動売買ではなく、調査優先度とスコア改善を調整する仕組みです。

## Meme Deep Check

`/meme-deep-check token:<CA>` は、GH2012Telefe型の「CLI深掘り」に対応する精査用コマンドです。Research CardやAlertで気になったSolana token addressを指定すると、Nansenの `flow-intelligence` / `holders` / `who-bought-sold` / `dex-trades` を可能な範囲で取得し、候補の質を公開Embedで表示します。

表示内容:

- Flow Quality: Smart Money / Whale / Fresh Wallet flowの質
- Holder Risk: Top holder集中、未売却holder、含み益holder、売り圧力
- Buyer/Seller Balance: 買い手優勢か売り手優勢か
- Sell Pressure: holders / who-bought-soldから見た売り圧力
- Cluster Risk Lite: smart-money/dex-tradesから見た簡易cluster疑い
- Wallet Quality Summary: Smart Money walletごとの行動品質
- Final Note: 総合コメント
- Confidence: High / Medium / Low

`USE_MOCK_NANSEN=true` の場合はlive Nansenを叩かずmock / fallbackで動作します。`USE_MOCK_NANSEN=false` の場合、Deep Checkは追加のlive Nansen取得を行うためクレジットを消費する可能性があります。取得に失敗した項目はN/Aまたは未検証として扱い、コマンド全体は落とさずに表示します。

Wallet Quality Summaryでは、smart-money/dex-tradesからwalletごとのbuy/sell回数、触ったtoken数、平均trade size、WSOL/SOL関連trade比率、target tokenの売買、近い時間帯のmirror buyを集計します。behavior_typeは以下のルールベース分類です。

- Fresh Sniper: token age 0〜1日のtokenを早期にbuyしやすいwallet
- Accumulator: buyがsellより多く、target tokenを保有寄りに見えるwallet
- Fast Flipper: buy後すぐsellする傾向、またはsell countが多いwallet
- Micro-arb: WSOL/SOL関連trade比率が高く、平均trade sizeが小さく、trade countが多いwallet
- Mirror-like: 他walletと近い時刻に似た金額で同じtokenをbuyするwallet
- Unknown: 判定材料が少ないwallet

Cluster Risk Liteは、2つ以上のwalletが同じtokenを同時刻または±2秒以内にbuyし、trade size差が20%以内のmirror buy / synchronized buyを簡易的に見ます。Mediumは2wallet程度の同期buy疑い、Highは3wallet以上やMicro-arb偏重が強い状態です。Sybil / bot cluster疑いを完全に確定するものではなく、Nansen dex-tradesからの簡易判定です。Duneやraw traceでのfunder一致確認までは行いません。将来的にDune/rawでfunder一致、同一sequence、bot / sybil cluster確認を追加予定です。

live Nansen利用時は、Deep Check本体に加えてdex-trades / Wallet Quality解析分の追加クレジットを消費する可能性があります。

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
- `/meme-deep-check`: token addressを指定して、Flow Quality / Holder Risk / Buyer-Seller Balance / Cluster Risk Liteを深掘りします。
- `/meme-rules`: Conviction / エアIN / Watch のPaper Pickルールを表示します。
- `/meme-results`: 保存済みシグナルの成績を latest / daily / weekly / monthly で表示します。
- `/my-picks`: 自分のPaper Pick履歴を today / weekly / monthly で確認します。
- `/my-performance`: 自分のPaper Pick成績を daily / weekly / monthly で確認します。
- `/leaderboard`: エアIN / Conviction のコミュニティランキングを表示します。
- `/meme-recap`: Daily / Weekly / Monthly のBot・コミュニティ・Nansen Signal Reviewを表示します。
- `/dev-reset-me`: 開発・デモ用。自分の本日使用ポイントをリセットします。
- `/dev-post-result`: 開発・デモ用。最新スキャンの 1h / 6h / 24h Result を再投稿します。
- `/dev-run-scheduled-scan`: 開発・デモ用。定時スキャンと同じ処理を任意チャンネルで実行します。
- `/dev-run-alert-check`: 開発・デモ用。MCap $2M以下のMeme Edge Alert条件を手動確認します。
- `/dev-run-recap`: 開発・デモ用。定時Recapと同じ処理を任意チャンネルで実行します。
- `/nansen-credits`: 現在のNansen credits残量を本人だけに表示します。
- `/nansen-credit-logs`: 直近のNansen credits使用履歴を本人だけに表示します。`limit` は最大20件です。

## 自動運用

JST基準で以下の定時投稿を行います。

- 09:00 Morning Scan
- 16:00 EU Open Scan
- 23:00 US Prime Scan
- 毎時05分 Alert Check
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

開発・デモ時は `USE_MOCK_NANSEN=true` でmock/cacheを使えます。本番確認時は `USE_MOCK_NANSEN=false` にしてlive Nansenを使います。live modeでは `/desk-test`、`/meme-scan`、`/dev-run-scheduled-scan`、`/dev-run-alert-check`、`/meme-deep-check`、定時スキャン、定時Alert Checkの実行前後にcredits残量を記録します。記録はSQLiteの `nansen_credit_logs` に保存され、実行前credits、実行後credits、今回消費credits、mock/live区分、実行時刻を確認できます。

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
- Deep Check強化: Dune/rawでfunder一致、同一sequence、bot / sybil cluster確認を追加
- Nansen agentによる深掘り調査
- 本番用scheduler
- PostgreSQL移行
- より高度なNansen Signal Review
- Monthly report強化
