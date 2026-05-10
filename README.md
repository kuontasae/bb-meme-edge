# bb Meme Edge

Nansen Smart Money flowを使った、Solana memeの早期発見・答え合わせ・参加型ランキングBot。

bb Meme Edgeは、Nansen Smart Money flowを使ってSolana meme coinの早期兆候を検出し、Alertでユーザーに通知し、ユーザーPickと後追い成績を保存し、Recapで答え合わせしながら改善していくDiscord Botです。

## 1. 概要

bb Meme Edgeは、Nansen Smart Money flowを使ってSolana meme coinの早期兆候を検出するDiscord Botです。

特徴:

- NansenでSmart Money flowを検出
- Alertで今見るべき候補を通知
- Fresh Scanで市場データを収集
- 全候補を後追いしてPDCA
- ユーザーは Conviction / エアIN / Watch でPick参加
- `/my` と `/leaderboard` で成績確認
- `/meme-recap` で日次・週次・月次の答え合わせ

投資助言や自動売買ではありません。オンチェーンデータをもとに候補を見つけ、Paper Pickと振り返りで学習するための調査補助Botです。

## 2. Botの全体像

```text
Fresh Scan
  ↓
市場候補を広く保存
  ↓
Alert
  ↓
強候補だけ通知
  ↓
User Pick
  ↓
Conviction / エアIN / Watch
  ↓
Performance Tracking
  ↓
1h / 4h / 12h / 24h / 48h / 7d
  ↓
Recap / Leaderboard / My
  ↓
PDCA
```

Fresh Scanは通知ではなく、Botを賢くするための市場観測です。Alertがユーザー向け通知の主役で、Recapが答え合わせ、User Picksが参加型要素です。

通常のユーザー体験では、Alertで強候補を見て、Conviction / エアIN / Watchを押し、あとで `/my`、`/leaderboard`、`/meme-recap` で結果を確認します。裏側ではFresh Scanと後追いtrackingがPDCA用データを蓄積します。

## 3. Fresh Scan

Fresh Scanはデータ収集・PDCA用です。通常はTop5 Research Cardを投稿しません。

現在の設定:

- `mode`: `data_collection`
- `postTopSignals`: `false`
- `cliOracleCheckSize`: `0`
- `candidatePoolSize`: `1500`
- Nansen limitは `1000` にclamp

やること:

- Nansen Broad Scan / Candidate Fetcher
- `candidatePoolSize` 1500
- Nansen limit 1000 clamp
- Gate 0
- Hard Reject
- Momentum Gate
- Pre-filter
- 全候補保存
- 後追いperformance対象化
- Alert候補ソース化
- Recap / PDCA用データ保存

やらないこと:

- 通常の定時Top5投稿
- 通常のCLI Oracle
- 通常のDiscord Result通知

`/meme-scan` は手動でFresh Scanを実行します。デフォルトでは投稿せず、候補保存・Gate集計・完了サマリーを返します。Research Cardを見たい場合だけ `post:true` を指定します。

表示例:

```text
Fresh Scan完了。
候補1000件を保存しました。
Gate 0通過: 68件
Momentum Gate通過: 44件
Pre-filter通過: 25件
投稿: OFF
通知はAlertで行います。
```

Fresh ScanでCLI Oracleを回さない候補は、`cli_checked=0` / `cli_oracle_status=skipped_data_collection_mode` として保存されます。CLI Gradeがなくても、候補保存・後追い・Recap集計・PDCAは継続します。

## 4. Alert

Alertはユーザー向け通知の主役です。

現在のAlert v2:

- `candidatePoolSize`: 300
- Nansen候補: 240
- Fresh Scan DB候補: 40
- Watch / near-miss候補: 20
- Pre-filter: 15
- CLI Oracle: 最大5
- `maxAlertsPerRun`: 3
- DexScreener market data補完
- Alert Quality Gate
- Freshness / Reacceleration
- 全候補保存
- Alert後追い

Alertの目的:

- Fresh Scanの定時では拾いにくいタイミングの候補を拾う
- 今見るべき候補だけ通知する
- Alert後2x到達時はPump Hit通知する

AlertはMCap上限・下限で機械的に候補を除外しません。MCapは保存・表示・スコア・Recap分析の文脈として使い、Hard Rejectは欠損データ、flowなし、最低Liquidity、最低Traders、鮮度、重複Alert、明確なbot-like / cluster riskを中心にします。

Liquidityは `$15K` 未満をRejectし、`$15K〜$40K` は通過可能ですが「⚠️ 流動性薄め」のRiskとして表示・保存します。`$40K` 以上は通常扱いです。

Alert選定で重視する軸:

- Flow/MCap
- 24h Flow
- 1h / 4h Flow
- Traders
- Re-Acceleration
- Liquidity
- CLI Grade
- Quality Gate
- Risk Flags

Alert Cardに出すもの:

- 判定（4行）
- 評価（日本語Status + Score）
- 検出理由
- 注意点
- Nansen評価
- MCap
- Liquidity
- Flow
- Traders
- token icon / logo / DexScreener image
- CA
- DexScreener / GMGN / UniversalXリンク
- Conviction / エアIN / Watchボタン
- Grokナラティブ導線がある場合は補助導線として表示

カード本文の表示順:

1. 判定
2. Stats
3. 検出理由
4. CA
5. 関連リンク

表示例:

```text
判定
├ 評価　🟠 高リスク・様子見｜52/100
├ 検出理由　🚨 強シグナル
├ 注意点　なし
└ Nansen評価　B

Stats
├ 時価総額　$456.3K
├ 流動性　$38.2K
├ 経過日数　15.0日
├ Flow/MCap　3.01%
├ 24h流入　$13.8K
└ Traders　33人

検出理由
├ Flow/MCap 3.01%　MCap比で流入強め
├ Traders 33人　複数walletが反応
└ Risk Highなし　Holder / Sell / Cluster確認済み

CA
`xxxxxxxxxxxxxxxxxxxxxxxx`

関連リンク
DexScreener｜GMGN｜UniversalX
```

Quality Gate、candidate source、Fresh Re-Accelerationなどは内部保存や詳細確認には残しますが、カードのデフォルト判定セクションには出しません。

AlertはMCapやflowの一次条件だけでは投稿されません。候補をPre-filterで絞ったあと、CLI Oracle、DexScreener補完、Wallet Quality、Alert Quality Gateを通して、強候補だけを最大3件投稿します。

## 5. Signal / Risk 表示

ユーザー向けUIでは、内部の `signal_type` をそのまま出さず、カード上では「検出理由」と「注意点」に分けます。

Signal:

- 🚨 強シグナル
- 📈 資金流入あり
- 🐋 大口流入

Risk:

- ⚠️ 流動性薄め
- 🤖 不自然flow疑い
- 👥 Holder集中
- 🔻 売り圧強め

検出理由は「なぜ検出されたか」。注意点は「何に注意すべきか」です。

内部の `signal_type` 値は互換性のため維持します。

- `alert_edge`
- `flow_watch`
- `whale_flow`
- `thin_liquidity`
- `bot_like_flow`

ただしUIでは、Thin LiquidityやBot-like FlowはSignalではなくRiskとして表示します。

MemeStatusは日本語で表示します。

- 🟢 強め
- 🟡 監視候補
- 🟠 高リスク・様子見
- 🔴 弱い

## 6. User Picks

ユーザーは各候補に対してボタンで反応できます。

ボタン:

- Conviction: 強く見ている
- エアIN: 実際には買わないが仮想IN
- Watch: 監視

`/my` では自分のPick履歴・成績を確認できます。

表示例:

```text
👤 My Meme Edge

📊 成績サマリー
├ Picks　5
├ 勝率　75.0%
├ 平均　1.04x
└ 最高Pick　$ASTEROID 1.74x

📌 最近のPick
├ Conviction　$MAGA 1.00x｜$DIVINE N/A｜$ASTEROID 1.30x
├ エアIN　$EWON 0.15x
└ Watch　$ASTEROID 1.74x

🧠 ボタン別成績
├ Conviction　3 picks｜平均 1.15x
├ エアIN　1 pick｜平均 0.15x
└ Watch　1 pick｜平均 1.74x
```

`/leaderboard` では全体ランキングを確認できます。表示では「Best」ではなく「最高Pick」に統一し、倍率は原則小数2桁、装飾emoji付きsymbolは表示時にcleanします。

Paper Pickは実取引ではありません。Discord上でMeme発見ゲームとして参加し、あとから結果を検証するための仕組みです。

## 7. Performance Tracking / Result

後追い保存は維持します。

保存タイミング:

- 1h
- 4h
- 12h
- 24h
- 48h
- 7d

保存するもの:

- `entry_mcap`
- `current_mcap`
- `return_x`
- `peak_return_x`
- `time_to_peak`
- `drawdown_after_peak`
- `snapshot_label`

通常の個別Result通知は出しません。Daily / Weekly / Monthly Recapに集約します。

例外として、Alert投稿済みtokenがAlert後に `return_x >= 2.0` へ初到達した場合のみ、Alert Pump Hit通知を出します。Fresh Scan由来の2x到達は個別通知せず、Recapに集約します。

Alert Pump Hit表示例:

```text
🚀 Alert Pump Hit

$TOKEN が Alert後に 2.10x 到達

検出時MCap: $66.7K
現在MCap: $140.2K
到達時間: 4h
Source: Alert
CA: `xxxxxxxxxxxxxxxxxxxxxxxx`

DexScreener / GMGN / UniversalX
```

同じtoken / 同じthresholdでは重複通知しません。5x / 10xは将来拡張用に判定・保存できますが、現時点の通知は2x到達が中心です。

## 8. Recap

`/meme-recap` は短縮レポートです。

period:

- `daily`
- `weekly`
- `monthly`

表示セクション:

- 📊 Bot成績
- 🧠 学び
- 🔍 注目パターン
- 👥 Community

Optimizationはユーザー向けRecapには出しません。裏側のPDCAとして保存します。

Bot成績の表示形式:

```text
📊 Bot成績
候補数: 5
2x: 0
5x: 0
10x: 0
平均成績: 0.61x
中央値: 0.80x
Bot最高: $UNC 1.01x
```

Community表示:

```text
Conviction: 1 / エアIN: 0 / Watch: 0
```

Leaderboard対象なしの場合は1行だけにします。

## 9. Commands

ユーザー向け:

- `/meme-scan`: Fresh Scanを手動実行。通常は投稿せず、候補保存とサマリー表示。`post:true` の時だけResearch Card投稿。
- `/dev-run-alert-check`: Alertを手動実行。現状の手動Alert導線です。`/meme-alert` は未実装です。
- `/meme-deep-check`: CA指定でDeep Check。
- `/meme-results`: Bot候補の答え合わせ。
- `/meme-recap`: daily / weekly / monthly の短縮レポート。
- `/my`: 自分のPick履歴・成績。
- `/leaderboard`: 全体ランキング。
- `/nansen-credits`: Nansen credits確認。
- `/nansen-credit-logs`: credits消費ログ。
- `/meme-rules`: Conviction / エアIN / Watch のルール確認。
- `/ping`: Bot疎通確認。

開発・検証用:

- `/desk-test`: Nansen CLIのSmart Money netflow取得テスト。
- `/dev-run-scheduled-scan`: 定時Fresh Scan相当を手動実行。
- `/dev-run-alert-check`: Alert条件を手動確認。
- `/dev-run-recap`: 定時Recap相当を手動実行。
- `/dev-post-result`: 最新スキャンのResult投稿を手動再投稿。
- `/dev-reset-me`: 自分の本日使用ポイントをリセット。

dev系は開発・検証用で、通常ユーザー向けのメイン導線ではありません。

## 10. Data Storage

主な保存テーブル:

Fresh Scan:

- `scan_runs`
- `scan_candidates`
- `candidate_performance_snapshots`
- `candidate_peak_performance`

Alert:

- `alert_runs`
- `alert_candidates`
- `alert_performance_snapshots`
- `alert_peak_performance`

User:

- `users`
- `user_picks`

Results / Learning:

- `signals`
- `recaps`
- `learning_summaries`
- `optimization_suggestions`
- `optimization_experiments`
- `optimization_results`
- `config_versions`

Nansen:

- `nansen_credit_logs`
- `deep_checks`
- `wallet_quality_snapshots`

Postgresを基本にしつつ、SQLite fallbackもあります。Nansen取得失敗やPostgres接続失敗でもBot全体を落とさない設計です。

Fresh ScanとAlertは保存先を分けますが、`token_address` で横断分析できます。Fresh Scan only、Alert only、Both Fresh + Alert、Fresh rejected → Alert passed、Fresh Top候補 → Alert later、Alert first → Fresh laterなどを後から検証できます。

## 11. Market Data補完

Nansenのnetflowだけではprice / liquidityが不足する場合があります。そのためDexScreenerでmarket data補完を行います。

補完対象:

- `price`
- `entry_price`
- `liquidity`
- `volume_24h`
- `pairUrl`
- `raw_dexscreener_snapshot`
- `market_data_refreshed_at`
- `market_data_warning`

Fresh Scanでは、priceなしだけでGate 0 rejectにしません。warningとして保存し、MCap / Flow / Tradersを使って進めます。

Alertでは、liquidity補完後にGate判定します。liquidity不足はAlertではReject理由になります。

## 12. Nansen Credit運用

Nansen取得モード:

- `USE_MOCK_NANSEN=true`: mock / fallbackで動作。開発・UI確認用。
- `USE_MOCK_NANSEN=false`: live Nansenを叩く。creditsを消費。

クレジット消費の主な要因:

- Broad Scan / Light Scan は比較的軽い
- CLI Oracle / Deep Check は重い
- Fresh ScanではCLI Oracleを通常OFF
- Alertでは強候補のみCLI Oracleを使用

実測から見えたこと:

- 以前はFresh ScanのCLI Oracle 10件で大きくcreditsを消費していた
- 現在はFresh ScanのCLI OracleをOFFにし、Alert側へ優先的に使う設計
- `nansen_credit_logs` で消費を保存する

今後はCredit Budget Gateを追加し、1日あたり・1runあたりの消費上限、CLI Oracle実行可否、Deep Check対象数をより明確に制御する予定です。

## 13. Environment / Setup

必要なもの:

- Node.js
- npm
- Discord Bot Token
- Discord Client ID
- Nansen API Key
- `USE_MOCK_NANSEN`
- `DATABASE_URL` optional
- SQLite fallback

セットアップ:

```bash
npm install
npm run check
npx tsc --noEmit
npm run dev
```

`.env` に設定します。

- `DISCORD_TOKEN`: Discord Bot token
- `DISCORD_CLIENT_ID`: Discord application client id
- `NANSEN_API_KEY`: Nansen CLI / APIで使うAPI key
- `USE_MOCK_NANSEN`: `true` ならmock、`false` ならlive
- `MEME_EDGE_CHANNEL_ID`: 定時Alert / Recapなどの対象チャンネルID
- `DATABASE_URL`: Postgresを使う場合のみ設定。未設定でもSQLite fallbackで動作

開発・UI確認では `USE_MOCK_NANSEN=true` を推奨します。本番確認では `USE_MOCK_NANSEN=false` にし、`/nansen-credits` と `/nansen-credit-logs` で実行前後のcreditsを確認します。

## 14. Current UX Summary

現在ユーザーが見る主な体験:

- Alertが強候補を通知
- ユーザーは Conviction / エアIN / Watch を押す
- `/my` で自分の成績を見る
- `/leaderboard` でランキングを見る
- `/meme-recap` で日次・週次・月次の答え合わせを見る

裏側:

- Fresh Scanが市場データを保存
- 後追いtrackingが成績を更新
- PDCA用データを蓄積
- Alert精度改善に使う

Fresh Scanは裏側のPDCA、Alertは表側の通知です。Recapは答え合わせ、User Picksは参加型の発見ゲームです。

## 15. Safety / Notes

- 投資助言として表示しない
- 実取引を実行しない
- ウォレット接続なし
- 秘密鍵なし
- APIキーは `.env` で管理し、コードに直書きしない
- `.env` はGitに含めない
- データ不足時もBot全体を落とさず、取れた材料から表示・保存する
- Paper Pickは調査・学習・振り返り用

開発AI:

- OpenAI ChatGPT / Codexを仕様整理、実装支援、UI文言調整、TypeScript修正に使用

ランタイムAI:

- 現時点では必須ではありません。
- 将来的にNarrative ResolverやNansen Signal Reviewの要約でAIを使う場合は、プロバイダー、モデル、ガードレール、フォールバックを明記します。

## 16. 今後の改善

- Credit Budget Gate
- 本番用persistent scheduler
- Optimization Suggestionsの評価UI
- Alert Quality Gateの継続改善
- Dune / raw traceによるcluster確認強化
- Nansen agentによる深掘り調査
- Monthly report強化

## 免責

これは投資助言ではありません。
Nansenデータに基づく調査補助・Paper Pick・振り返り用Botです。
実際の売買判断はユーザー自身の責任です。
