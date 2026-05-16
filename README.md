# dd Signal Bot

Nansen Smart Money flowを使った、Solana memeの早期発見・答え合わせ・参加型ランキングBot。

dd Signal Botは、Nansen Smart Money flowを使ってSolana meme coinの早期兆候を検出し、Alertでユーザーに通知し、エアトレード参加と後追い成績を保存し、Recapで答え合わせしながら改善していくDiscord Botです。

## 提出用概要

dd Signal Bot は、Nansen Smart Money flowを使って、Solana meme coinの早期兆候を検出するDiscord Botです。Fresh Scanで市場候補を裏側に保存し、Alertで今見るべき候補だけを自動通知します。

Alertでは、Nansen CLIで取得したSmart Moneyの流入、Flow/MCap、Traders数、Liquidity、Risk、CLI Gradeなどを組み合わせて候補を評価します。Alert後は1h / 4h / 12h / 24h / 48h / 7dで成績を追跡し、`/meme-recap` で答え合わせできます。

ユーザーはAlert Cardの Conviction / エアIN / Watch でエアトレード参加でき、`/my` や `/leaderboard` で成績確認できます。特徴は、Nansen CLIで得たwallet情報を保存し、後追い成績と紐づけてSmart Wallet Qualityを育てる点です。さらにAuto-Tuningで過去に強かった特徴を次回AlertのFinal Scoreへ安全に反映し、検出 → 後追い → 学習 → 改善のPDCAが回る設計にしています。

## 1. 概要

dd Signal Botは、Nansen Smart Money flowを使ってSolana meme coinの早期兆候を検出するDiscord Botです。

特徴:

- NansenでSmart Money flowを検出
- Alertで今見るべき候補を通知
- Fresh Scanで市場データを裏側に収集
- 全候補を後追いしてPDCA
- ユーザーは Conviction / エアIN / Watch でエアトレード参加
- `/my` と `/leaderboard` で自分とコミュニティの成績確認
- `/meme-recap` と `/meme-results` で日次・週次・月次の答え合わせ

投資助言や自動売買ではありません。オンチェーンデータをもとに候補を見つけ、エアトレードと振り返りで学習するための調査補助Botです。

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

通常のユーザー体験では、Alertで強候補を見て、Conviction / エアIN / Watchを押し、あとで `/my`、`/leaderboard`、`/meme-recap`、`/meme-results` で結果を確認します。裏側ではFresh Scan、Alert tracking、Smart Wallet PDCA、Auto-TuningがPDCA用データを蓄積します。

## 3. Fresh Scan

Fresh Scanはデータ収集・PDCA用です。

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

提出版ではFresh Scanはユーザー向けSlash Commandではなく、裏側の市場データ収集・PDCA用処理として扱います。ユーザーは直接Fresh Scanを触らず、自動AlertとRecap / Resultsで結果を確認します。

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
- 実行間隔: 20分
- CLI Oracle: 最大3
- 同一tokenのCLI Oracle再実行禁止: 12時間
- `maxAlertsPerRun`: 2
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
- Smart Money Quality
- Risk Flags

Smart Money Qualityは追加Nansen取得を増やさず、既存CLI Oracle / Deep Check結果から評価します。`flow_quality`、`wallet_quality`、`buyer_seller_balance`、`sell_pressure`、`holder_risk`、`cluster_risk` をスコア化し、Final SelectionでAlert Momentum Scoreに加味します。Cluster Risk High、Sell Pressure High、Holder Risk High、bot-like / mirror-like / micro-arb疑いは強く減点します。CLI未検証の場合は未検証扱いで、過剰に良く見せません。

### Smart Wallet PDCA

Smart Wallet PDCAは、Nansen CLI / Deep Checkで得たwallet情報を使い捨てにしないための内部学習レイヤーです。追加でwallet履歴をNansenへ取りに行かず、取得済みの `raw_nansen_who_bought_sold`、`raw_nansen_dex_trades`、`raw_nansen_holders`、`raw_cli_summary` 相当の情報からwallet観測を抽出し、DBに保存します。

保存したwallet観測は、そのwalletが関わったtokenの後追いperformanceとtoken address単位で紐づけます。1h / 4h / 24h return、peak return、2x / 5x / 10x hit、bad result、bot-like / high-risk傾向を集計し、walletごとの独自 `Wallet Quality Score` を0〜100で育てます。観測数が少ないwalletは `Unknown` 扱いにして過剰評価しません。

次回Alertでは、過去に良いtokenに関わったStrong / Medium walletを少し優遇し、Weak walletやbot-like / high-risk walletが多い候補は減点します。Alert Cardにはデータが十分な場合だけ「Smart Wallet実績あり」を短く出し、判定4行のシンプルな構成は維持します。

この設計はNansen creditsを増やさず、既存CLI結果をdd Signal Bot独自のSmart Wallet Qualityへ変換するものです。将来的には、dd Signal Bot独自のSmart Walletランキングへ発展できます。

### Auto-Tuning

Auto-Tuningは、保存済みの後追いperformanceから過去に強かった特徴を学習し、次回AlertのFinal Scoreへ小幅に反映する仕組みです。`alert_candidates`、`alert_peak_performance`、`alert_performance_snapshots`、Smart Wallet PDCAの保存済みデータを使い、Flow/MCap帯、Liquidity帯、Traders帯、MCap帯、Age帯、CLI Grade、Risk Flags、Smart Wallet Qualityなどのbucket別成績を集計します。

Auto-TuningはHard GateやReject条件を自動変更しません。Liquidity下限、Flow必須、token address必須、High Risk Rejectなどは固定のままです。反映するのはFinal Selection用Scoreへの安全な微調整だけで、bucketのsampleが30件未満なら補正しません。補正は全体baselineとの比較で行い、N/A / Unknown / Unchecked / 未検証 / risk_none は原則neutralとして扱います。holder risk、sell pressure、cluster risk、bot-like / mirror-like / micro-arbなどのRisk系bucketは安全のため加点せず、弱い場合のみ減点します。補正幅はsample数に応じて最大±2〜±5点、合計でも±10点に制限し、補正後scoreも0〜100にclampします。

これにより、検出 → 後追い → 学習 → 次回Alert改善 のPDCAをBot内で回します。Auto-Tuningは保存済みDBだけを使うため、追加Nansen取得やwallet履歴取得は不要です。`config/scoring.json` を自動で書き換えるものではなく、学習結果は `auto_tuning_results` とAlert candidateの補正情報として保存します。

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

AlertはMCapやflowの一次条件だけでは投稿されません。候補をPre-filterで絞ったあと、最大3件だけCLI Oracleを実行し、DexScreener補完、Wallet Quality、Alert Quality Gateを通して、強候補だけを最大2件投稿します。同一tokenが直近12時間以内にCLI済みの場合はNansenを再実行せず、使える前回結果を再利用してcredits消費を抑えます。

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

ユーザーはAlert Card上のボタンから、実取引ではないエアトレードとして参加できます。1日の使用ポイントは5ptまでです。

ボタン:

- Conviction: 強く見ているPick。3ptを使用
- エアIN: 実際には買わないが仮想IN。1ptを使用
- Watch: 監視用。0ptで、Leaderboard Scoreには影響しません

`/my` では自分のPick履歴・成績を確認できます。Watchは観察履歴として残りますが、ランキングのScore対象はConvictionとエアINです。

表示例:

```text
👤 My dd Signal

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

`/leaderboard` では全体ランキングを確認できます。daily / weekly / monthly ごとに集計し、各期間内に押されたPickを、その同じ期間内に記録された最高倍率 `period_peak_return_x` で評価します。現在値ではなく期間内Peakを見るため、一度大きく伸びたmeme coinのチャンスを取り逃がしにくい採点です。

Leaderboard Score:

```text
Score = max(0, period_peak_return_x - 1) ÷ expected_move_by_mcap × used_points × 10
```

- `period_peak_return_x`: Pick対象期間と同じleaderboard期間内に記録された最高倍率
- dailyなら今日押されたPickを今日の期間内Peakで評価し、weekly / monthlyも同じ考え方で評価
- 期間内snapshotの `return_x` 最大値を優先し、なければ保存済みpeakをfallback
- 1.0x以下は0点で、マイナスはありません
- `used_points`: Conviction = 3、エアIN = 1、Watch = 0
- Watchは観察用で、Leaderboard Scoreには影響しません

`expected_move_by_mcap` はPick時点MCap帯で補正します。

| Pick時点MCap | expected_move |
| --- | ---: |
| <$100K | 3.0 |
| $100K-$500K | 2.0 |
| $500K-$2M | 1.5 |
| $2M-$10M | 1.0 |
| $10M+ | 0.75 |

表示では「Best」ではなく「最高Pick」に統一し、倍率は原則小数2桁、装飾emoji付きsymbolは表示時にcleanします。

エアトレードは実取引ではありません。Discord上でMeme発見ゲームとして参加し、あとから結果を検証するための仕組みです。

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

提出版でDiscord上に表示するSlash Commandは4つだけです。

- `/my`: 自分のPick履歴・成績確認。
- `/leaderboard`: コミュニティランキング確認。
- `/meme-recap`: Bot成績・学び・注目パターン・Communityを確認する短縮レポート。
- `/meme-results`: 候補やPickの結果確認。

Fresh Scan、Alert自動実行、Deep Check、Smart Wallet PDCA、Auto-Tuning、Nansen credit logging、開発用リセットなどはユーザー向けコマンドではありません。裏側の自動処理・運用機能として残し、提出版では初見ユーザーが結果確認・参加・答え合わせに集中できる構成にしています。

## 10. Demo Flow

1. 自動投稿されたAlert Cardを見る  
   Nansen Smart Money flowを使って候補を検出し、判定 / Stats / 検出理由 / CA / 関連リンクを表示します。

2. Alert Cardの Conviction / エアIN / Watch を押す  
   ユーザーは実取引ではなくエアトレードとして参加できます。

3. `/my`  
   自分のPick履歴と成績を確認します。

4. `/leaderboard`  
   コミュニティランキングを確認します。

5. `/meme-recap period:daily`  
   Bot成績、学び、注目パターン、Communityを短く確認します。

6. `/meme-results`  
   候補やPickの結果を確認します。

Fresh Scan、Alert、Smart Wallet PDCA、Auto-Tuning、credit loggingは裏側で動くため、ユーザーがコマンドで直接触る必要はありません。

## 11. Data Storage

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

Smart Wallet PDCA:

- `smart_wallet_observations`
- `smart_wallet_profiles`

Auto-Tuning:

- `auto_tuning_results`

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

## 12. Market Data補完

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

## 13. Nansen Credit運用

Nansen取得モード:

- `USE_MOCK_NANSEN=true`: mock / fallbackで動作。開発・UI確認用。
- `USE_MOCK_NANSEN=false`: live Nansenを叩く。creditsを消費。

クレジット消費の主な要因:

- Broad Scan / Light Scan は比較的軽い
- CLI Oracle / Deep Check は重い
- Fresh ScanではCLI Oracleを通常OFF
- AlertではPre-filter上位から最大3件のみCLI Oracleを使用
- 同一tokenのCLI Oracle再実行は12時間禁止

実測から見えたこと:

- 以前はFresh ScanのCLI Oracle 10件で大きくcreditsを消費していた
- 現在はFresh ScanのCLI OracleをOFFにし、Alert側も20分間隔・最大3件・12時間dedupeで使う設計
- `nansen_credit_logs` で消費を保存する

今後はCredit Budget Gateを追加し、1日あたり・1runあたりの消費上限、CLI Oracle実行可否、Deep Check対象数をより明確に制御する予定です。

## 14. Environment / Setup

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

開発・UI確認では `USE_MOCK_NANSEN=true` を推奨します。本番確認では `USE_MOCK_NANSEN=false` にします。Nansen creditsの使用履歴はユーザー向けSlash Commandではなく、内部の `nansen_credit_logs` テーブルと運用ログで確認します。

## 15. Current UX Summary

現在ユーザーが見る主な体験:

- Alertが強候補を通知
- ユーザーは Conviction / エアIN / Watch を押す
- `/my` で自分の成績を見る
- `/leaderboard` でランキングを見る
- `/meme-recap` で日次・週次・月次の答え合わせを見る
- `/meme-results` で候補やPickの結果を見る

裏側:

- Fresh Scanが市場データを保存
- 後追いtrackingが成績を更新
- PDCA用データを蓄積
- Alert精度改善に使う

Fresh Scanは裏側のPDCA、Alertは表側の通知です。Recapは答え合わせ、User Picksは参加型の発見ゲームです。

## 16. Safety / Notes

- 投資助言として表示しない
- 実取引を実行しない
- ウォレット接続なし
- 秘密鍵なし
- APIキーは `.env` で管理し、コードに直書きしない
- `.env` はGitに含めない
- データ不足時もBot全体を落とさず、取れた材料から表示・保存する
- エアトレードは調査・学習・振り返り用

開発AI:

- OpenAI ChatGPT / Codexを仕様整理、実装支援、UI文言調整、TypeScript修正に使用

ランタイムAI:

- 現時点では必須ではありません。
- 将来的にNarrative ResolverやNansen Signal Reviewの要約でAIを使う場合は、プロバイダー、モデル、ガードレール、フォールバックを明記します。

## 17. 今後の改善

- Credit Budget Gate
- 本番用persistent scheduler
- Optimization Suggestionsの評価UI
- Alert Quality Gateの継続改善
- Dune / raw traceによるcluster確認強化
- Nansen agentによる深掘り調査
- Monthly report強化

## 免責

これは投資助言ではありません。
Nansenデータに基づく調査補助・エアトレード・振り返り用Botです。
実際の売買判断はユーザー自身の責任です。
