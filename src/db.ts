const fs = require("node:fs") as typeof import("node:fs");
const path = require("node:path") as typeof import("node:path");
const Database = require("better-sqlite3") as typeof import("better-sqlite3");

type SqliteDatabase = import("better-sqlite3").Database;
type FreshScanDbProvider = "postgres" | "sqlite";

type FreshScanCandidateRecord = {
  scan_id: string;
  token_address: string;
  symbol: string | null;
  name: string | null;
  candidate_rank: number;
  candidate_sources: string;
  mcap: number | null;
  price?: number | null;
  entry_price?: number | null;
  age_days: number | null;
  liquidity: number | null;
  volume_24h?: number | null;
  market_data_refreshed_at?: string | null;
  market_data_age_minutes?: number | null;
  market_data_source?: string | null;
  market_data_warning?: string | null;
  raw_dexscreener_snapshot?: string | null;
  flow_24h: number | null;
  flow_7d: number | null;
  flow_mcap: number | null;
  traders: number | null;
  gate_0_status: string | null;
  gate_0_reason: string | null;
  hard_reject_status: string | null;
  hard_reject_reason: string | null;
  risk_flags: string;
  momentum_score: number | null;
  momentum_gate_status: string | null;
  momentum_gate_reason: string | null;
  fresh_scan_rank_score: number | null;
  fresh_scan_rank_components: string;
  pre_filter_status: string | null;
  pre_filter_rank: number | null;
  pre_filter_reason: string | null;
  cli_candidate_score: number | null;
  why_selected_for_cli: string | null;
  cli_checked: number;
  cli_grade: string | null;
  cli_oracle_status: string | null;
  cli_reject_reason: string | null;
  final_rank: number | null;
  final_rank_reason: string | null;
  posted: number;
  posted_message_id: string | null;
  score: number | null;
  signal_type: string | null;
  exclusion_reason: string | null;
  rank_bucket?: string | null;
  positive_flags?: string | null;
  warning_flags?: string | null;
  pass_reason_codes?: string | null;
  reject_reason_codes?: string | null;
  created_at: string;
};

type FreshScanRunRecord = {
  scan_id: string;
  label: string;
  source: string;
  candidate_pool_size: number;
  requested_candidate_pool_size?: number | null;
  actual_candidate_pool_size?: number | null;
  nansen_page_limit?: number | null;
  nansen_pagination_used?: number | null;
  nansen_fetch_warning?: string | null;
  gate_0_count: number;
  hard_reject_count: number;
  momentum_gate_count: number;
  pre_filter_count: number;
  cli_checked_count: number;
  final_count: number;
  config_snapshot?: string | null;
  market_context?: string | null;
  credits_by_step?: string | null;
  created_at: string;
};

type AlertRunRecord = {
  alert_run_id: string;
  started_at: string;
  finished_at: string | null;
  candidate_pool_size: number;
  nansen_candidate_size: number;
  fresh_scan_db_candidate_size: number;
  watch_candidate_size: number;
  pre_filter_size: number;
  cli_oracle_check_size: number;
  posted_count: number;
  used_credits: number | null;
  credits_by_step: string | null;
  status: string;
  error_message: string | null;
  config_snapshot: string;
  market_context: string | null;
  created_at: string;
};

type AlertCandidateRecord = Record<string, unknown> & {
  alert_run_id: string;
  token_address: string;
  candidate_rank: number;
};

type CandidatePerformanceSnapshotRecord = {
  scan_id: string;
  token_address: string;
  snapshot_label: string;
  snapshot_time: string;
  mcap: number | null;
  price: number | null;
  liquidity: number | null;
  volume_24h: number | null;
  return_x: number | null;
  entry_mcap: number | null;
  created_at: string;
};

type SmartWalletObservationRecord = {
  id: string;
  wallet_address: string;
  token_address: string;
  symbol: string | null;
  source_type: string;
  alert_run_id: string | null;
  alert_candidate_id: string | null;
  scan_id: string | null;
  scan_candidate_id: string | null;
  observed_at: string;
  side: string;
  amount_usd: number | null;
  token_mcap_at_observation: number | null;
  token_price_at_observation: number | null;
  flow_quality: string | null;
  wallet_quality: string | null;
  buyer_seller_balance: string | null;
  sell_pressure: string | null;
  holder_risk: string | null;
  cluster_risk: string | null;
  raw_context: string | null;
  created_at: string;
};

type SmartWalletProfileAggregateRow = {
  wallet_address: string;
  observed_tokens_count: number;
  observed_alert_tokens_count: number;
  avg_return_1h: number | null;
  avg_return_4h: number | null;
  avg_return_24h: number | null;
  avg_peak_return: number | null;
  hit_2x_count: number;
  hit_5x_count: number;
  hit_10x_count: number;
  early_entry_count: number;
  bad_result_count: number;
  bot_like_count: number;
  high_risk_count: number;
  last_seen_at: string | null;
};

const DB_PATH = path.join(process.cwd(), "data", "meme-edge.sqlite");

function ensureColumn(db: SqliteDatabase, tableName: string, columnName: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;

  if (!columns.some((column) => column.name === columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
}

function runSchema(db: SqliteDatabase): void {
  // IF NOT EXISTS なので、Botを再起動しても既存データは消えません。
  db.exec(`
    CREATE TABLE IF NOT EXISTS signals (
      signal_id TEXT PRIMARY KEY,
      scan_id TEXT NOT NULL,
      token_address TEXT NOT NULL,
      symbol TEXT,
      name TEXT,
      chain TEXT,
      narrative TEXT,
      narrative_summary TEXT,
      narrative_type TEXT,
      narrative_sources TEXT,
      narrative_evidence TEXT,
      narrative_tags TEXT,
      narrative_confidence TEXT,
      signal_type TEXT,
      edge_score INTEGER,
      status TEXT,
      score_breakdown TEXT,
      scan_time TEXT,
      scan_mcap REAL,
      scan_price REAL,
      flow_24h REAL,
      flow_7d REAL,
      flow_mcap_ratio REAL,
      trader_count INTEGER,
      token_age TEXT,
      why_flagged TEXT,
      risk TEXT,
      dexscreener_url TEXT,
      gmgn_url TEXT,
      universalx_url TEXT,
      nansen_url TEXT,
      message_id TEXT,
      channel_id TEXT
    );

    CREATE TABLE IF NOT EXISTS scans (
      scan_id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL,
      guild_id TEXT,
      scan_time TEXT NOT NULL,
      source TEXT,
      result_1h_posted INTEGER NOT NULL DEFAULT 0,
      result_6h_posted INTEGER NOT NULL DEFAULT 0,
      result_24h_posted INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS user_picks (
      pick_id TEXT PRIMARY KEY,
      signal_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      action TEXT NOT NULL,
      used_points INTEGER NOT NULL,
      clicked_at TEXT NOT NULL,
      entry_mcap REAL,
      entry_price REAL
    );

    CREATE TABLE IF NOT EXISTS performance_snapshots (
      snapshot_id TEXT PRIMARY KEY,
      signal_id TEXT NOT NULL,
      window TEXT NOT NULL,
      snapshot_time TEXT NOT NULL,
      current_mcap REAL,
      current_price REAL,
      max_mcap REAL,
      bot_return_x REAL
    );

    CREATE TABLE IF NOT EXISTS users (
      user_id TEXT PRIMARY KEY,
      first_seen_at TEXT NOT NULL,
      has_seen_guide INTEGER NOT NULL DEFAULT 0,
      daily_points_used INTEGER NOT NULL DEFAULT 0,
      last_reset_date TEXT
    );

    CREATE TABLE IF NOT EXISTS recaps (
      recap_id TEXT PRIMARY KEY,
      period TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      bot_summary TEXT,
      community_summary TEXT,
      narrative_summary TEXT,
      nansen_signal_review TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS alerts (
      alert_id TEXT PRIMARY KEY,
      token_address TEXT NOT NULL,
      signal_id TEXT,
      alert_type TEXT NOT NULL,
      alert_score INTEGER,
      triggered_at TEXT NOT NULL,
      channel_id TEXT,
      reason TEXT,
      quality_gate_grade TEXT,
      quality_gate_reasons TEXT,
      quality_gate_warnings TEXT,
      deep_check_id TEXT
    );

    CREATE TABLE IF NOT EXISTS deep_checks (
      deep_check_id TEXT PRIMARY KEY,
      token_address TEXT NOT NULL,
      signal_id TEXT,
      flow_quality TEXT,
      holder_quality TEXT,
      buyer_seller_balance TEXT,
      sell_pressure TEXT,
      cluster_risk TEXT,
      final_note TEXT,
      raw_summary TEXT,
      narrative_summary TEXT,
      narrative_type TEXT,
      narrative_sources TEXT,
      narrative_evidence TEXT,
      narrative_tags TEXT,
      narrative_confidence TEXT,
      wallet_quality_summary TEXT,
      wallet_behavior_counts TEXT,
      estimated_independent_wallets INTEGER,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS wallet_quality_snapshots (
      id TEXT PRIMARY KEY,
      token_address TEXT NOT NULL,
      signal_id TEXT,
      wallet_address TEXT,
      behavior_type TEXT,
      buy_count INTEGER,
      sell_count INTEGER,
      touched_token_count INTEGER,
      avg_trade_size REAL,
      wsol_trade_ratio REAL,
      mirror_group_id TEXT,
      cluster_risk TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS smart_wallet_observations (
      id TEXT PRIMARY KEY,
      wallet_address TEXT NOT NULL,
      token_address TEXT NOT NULL,
      symbol TEXT,
      source_type TEXT NOT NULL,
      alert_run_id TEXT,
      alert_candidate_id TEXT,
      scan_id TEXT,
      scan_candidate_id TEXT,
      observed_at TEXT NOT NULL,
      side TEXT,
      amount_usd REAL,
      token_mcap_at_observation REAL,
      token_price_at_observation REAL,
      flow_quality TEXT,
      wallet_quality TEXT,
      buyer_seller_balance TEXT,
      sell_pressure TEXT,
      holder_risk TEXT,
      cluster_risk TEXT,
      raw_context TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS smart_wallet_profiles (
      wallet_address TEXT PRIMARY KEY,
      observed_tokens_count INTEGER NOT NULL DEFAULT 0,
      observed_alert_tokens_count INTEGER NOT NULL DEFAULT 0,
      avg_return_1h REAL,
      avg_return_4h REAL,
      avg_return_24h REAL,
      avg_peak_return REAL,
      hit_2x_count INTEGER NOT NULL DEFAULT 0,
      hit_5x_count INTEGER NOT NULL DEFAULT 0,
      hit_10x_count INTEGER NOT NULL DEFAULT 0,
      early_entry_count INTEGER NOT NULL DEFAULT 0,
      bad_result_count INTEGER NOT NULL DEFAULT 0,
      bot_like_count INTEGER NOT NULL DEFAULT 0,
      high_risk_count INTEGER NOT NULL DEFAULT 0,
      last_seen_at TEXT,
      last_updated_at TEXT NOT NULL,
      wallet_quality_score REAL NOT NULL DEFAULT 0,
      wallet_quality_label TEXT NOT NULL DEFAULT 'Unknown',
      raw_stats TEXT
    );

    CREATE TABLE IF NOT EXISTS learning_summaries (
      learning_summary_id TEXT PRIMARY KEY,
      period TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      signal_type_summary TEXT,
      mcap_bucket_summary TEXT,
      age_bucket_summary TEXT,
      flow_mcap_bucket_summary TEXT,
      cluster_risk_summary TEXT,
      wallet_behavior_summary TEXT,
      next_score_adjustment TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS nansen_credit_logs (
      credit_log_id TEXT PRIMARY KEY,
      command_name TEXT NOT NULL,
      before_credits INTEGER,
      after_credits INTEGER,
      used_credits INTEGER,
      use_mock_nansen INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS token_info_snapshots (
      id TEXT PRIMARY KEY,
      token_address TEXT NOT NULL,
      name TEXT,
      symbol TEXT,
      description TEXT,
      logo_url TEXT,
      website_url TEXT,
      twitter_url TEXT,
      telegram_url TEXT,
      dexscreener_url TEXT,
      gmgn_url TEXT,
      x_search_url TEXT,
      raw_json TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS scan_runs (
      scan_id TEXT PRIMARY KEY,
      label TEXT,
      source TEXT,
      candidate_pool_size INTEGER,
      requested_candidate_pool_size INTEGER,
      actual_candidate_pool_size INTEGER,
      nansen_page_limit INTEGER,
      nansen_pagination_used INTEGER,
      nansen_fetch_warning TEXT,
      gate_0_count INTEGER,
      hard_reject_count INTEGER,
      momentum_gate_count INTEGER,
      pre_filter_count INTEGER,
      cli_checked_count INTEGER,
      final_count INTEGER,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS scan_candidates (
      id TEXT PRIMARY KEY,
      scan_id TEXT NOT NULL,
      token_address TEXT NOT NULL,
      symbol TEXT,
      name TEXT,
      candidate_rank INTEGER,
      candidate_sources TEXT,
      mcap REAL,
      price REAL,
      entry_price REAL,
      age_days REAL,
      liquidity REAL,
      volume_24h REAL,
      market_data_refreshed_at TEXT,
      market_data_age_minutes REAL,
      market_data_source TEXT,
      market_data_warning TEXT,
      raw_dexscreener_snapshot TEXT,
      flow_24h REAL,
      flow_7d REAL,
      flow_mcap REAL,
      traders INTEGER,
      gate_0_status TEXT,
      gate_0_reason TEXT,
      hard_reject_status TEXT,
      hard_reject_reason TEXT,
      risk_flags TEXT,
      momentum_score REAL,
      momentum_gate_status TEXT,
      momentum_gate_reason TEXT,
      fresh_scan_rank_score REAL,
      fresh_scan_rank_components TEXT,
      pre_filter_status TEXT,
      pre_filter_rank INTEGER,
      pre_filter_reason TEXT,
      cli_candidate_score REAL,
      why_selected_for_cli TEXT,
      cli_checked INTEGER NOT NULL DEFAULT 0,
      cli_grade TEXT,
      cli_oracle_status TEXT,
      cli_reject_reason TEXT,
      final_rank INTEGER,
      final_rank_reason TEXT,
      posted INTEGER NOT NULL DEFAULT 0,
      posted_message_id TEXT,
      score REAL,
      signal_type TEXT,
      exclusion_reason TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS candidate_performance_snapshots (
      id TEXT PRIMARY KEY,
      scan_id TEXT NOT NULL,
      token_address TEXT NOT NULL,
      snapshot_label TEXT NOT NULL,
      snapshot_time TEXT NOT NULL,
      mcap REAL,
      price REAL,
      liquidity REAL,
      volume_24h REAL,
      return_x REAL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS candidate_peak_performance (
      id TEXT PRIMARY KEY,
      scan_id TEXT NOT NULL,
      token_address TEXT NOT NULL,
      entry_mcap REAL,
      peak_mcap REAL,
      peak_return_x REAL,
      time_to_peak_hours REAL,
      drawdown_after_peak REAL,
      best_snapshot_label TEXT,
      updated_at TEXT NOT NULL,
      UNIQUE(scan_id, token_address)
    );

    CREATE TABLE IF NOT EXISTS alert_runs (
      alert_run_id TEXT PRIMARY KEY,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      candidate_pool_size INTEGER,
      nansen_candidate_size INTEGER,
      fresh_scan_db_candidate_size INTEGER,
      watch_candidate_size INTEGER,
      pre_filter_size INTEGER,
      cli_oracle_check_size INTEGER,
      posted_count INTEGER,
      used_credits INTEGER,
      credits_by_step TEXT,
      status TEXT,
      error_message TEXT,
      config_snapshot TEXT,
      market_context TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS alert_candidates (
      id TEXT PRIMARY KEY,
      alert_run_id TEXT NOT NULL,
      token_address TEXT NOT NULL,
      symbol TEXT,
      name TEXT,
      candidate_rank INTEGER,
      candidate_source_type TEXT,
      candidate_sources TEXT,
      source_quota_bucket TEXT,
      source_priority INTEGER,
      source_detected_at TEXT,
      candidate_freshness_minutes REAL,
      market_data_refreshed_at TEXT,
      market_data_age_minutes REAL,
      market_data_source TEXT,
      market_data_warning TEXT,
      from_fresh_scan_id TEXT,
      from_scan_candidate_id TEXT,
      from_previous_alert_run_id TEXT,
      from_watch_pick_id TEXT,
      is_reaccelerated INTEGER,
      reacceleration_reason TEXT,
      mcap REAL,
      price REAL,
      age_days REAL,
      liquidity REAL,
      volume_24h REAL,
      flow_1h REAL,
      flow_4h REAL,
      flow_24h REAL,
      flow_7d REAL,
      flow_mcap REAL,
      traders INTEGER,
      gate_0_status TEXT,
      gate_0_reason TEXT,
      alert_momentum_score REAL,
      alert_momentum_components TEXT,
      pre_filter_status TEXT,
      pre_filter_rank INTEGER,
      pre_filter_reason TEXT,
      cli_checked INTEGER NOT NULL DEFAULT 0,
      cli_grade TEXT,
      cli_oracle_status TEXT,
      raw_cli_summary TEXT,
      raw_nansen_flow_intelligence TEXT,
      raw_nansen_who_bought_sold TEXT,
      raw_nansen_holders TEXT,
      raw_nansen_dex_trades TEXT,
      flow_quality TEXT,
      holder_risk TEXT,
      buyer_seller_balance TEXT,
      sell_pressure TEXT,
      wallet_quality TEXT,
      cluster_risk TEXT,
      smart_wallet_quality_score REAL,
      smart_wallet_quality_label TEXT,
      strong_wallet_count INTEGER,
      medium_wallet_count INTEGER,
      weak_wallet_count INTEGER,
      known_wallet_count INTEGER,
      wallet_pdca_summary TEXT,
      auto_tuning_adjustment REAL,
      auto_tuning_reasons TEXT,
      auto_tuning_version TEXT,
      quality_gate_grade TEXT,
      quality_gate_reasons TEXT,
      quality_gate_warnings TEXT,
      positive_flags TEXT,
      risk_flags TEXT,
      warning_flags TEXT,
      pass_reason_codes TEXT,
      reject_reason_codes TEXT,
      rank_bucket TEXT,
      final_rank INTEGER,
      posted INTEGER NOT NULL DEFAULT 0,
      posted_message_id TEXT,
      entry_mcap REAL,
      entry_price REAL,
      raw_dexscreener_snapshot TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS alert_performance_snapshots (
      id TEXT PRIMARY KEY,
      alert_candidate_id TEXT,
      alert_run_id TEXT NOT NULL,
      token_address TEXT NOT NULL,
      snapshot_label TEXT NOT NULL,
      snapshot_time TEXT NOT NULL,
      mcap REAL,
      price REAL,
      liquidity REAL,
      volume_24h REAL,
      return_x REAL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS alert_peak_performance (
      id TEXT PRIMARY KEY,
      alert_candidate_id TEXT,
      alert_run_id TEXT NOT NULL,
      token_address TEXT NOT NULL,
      entry_mcap REAL,
      peak_mcap REAL,
      peak_return_x REAL,
      time_to_peak_hours REAL,
      drawdown_after_peak REAL,
      best_snapshot_label TEXT,
      updated_at TEXT NOT NULL,
      UNIQUE(alert_run_id, token_address)
    );

    CREATE TABLE IF NOT EXISTS alert_pump_notifications (
      notification_id TEXT PRIMARY KEY,
      alert_candidate_id TEXT,
      alert_run_id TEXT NOT NULL,
      token_address TEXT NOT NULL,
      threshold_x REAL NOT NULL,
      return_x REAL,
      entry_mcap REAL,
      peak_mcap REAL,
      time_to_peak_hours REAL,
      snapshot_label TEXT,
      channel_id TEXT,
      message_id TEXT,
      notified_at TEXT NOT NULL,
      UNIQUE(alert_candidate_id, threshold_x)
    );

    CREATE TABLE IF NOT EXISTS optimization_suggestions (
      suggestion_id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      target_area TEXT,
      target_key TEXT,
      current_value TEXT,
      suggested_value TEXT,
      reason TEXT,
      evidence_summary TEXT,
      sample_size INTEGER,
      confidence TEXT,
      expected_impact TEXT,
      risk_note TEXT,
      status TEXT,
      linked_experiment_id TEXT
    );

    CREATE TABLE IF NOT EXISTS auto_tuning_results (
      auto_tuning_run_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      sample_size INTEGER NOT NULL,
      data_window_hours INTEGER NOT NULL,
      bucket_type TEXT NOT NULL,
      bucket_name TEXT NOT NULL,
      avg_peak_return REAL,
      hit_2x_rate REAL,
      hit_5x_rate REAL,
      bad_result_rate REAL,
      best_peak_return REAL,
      adjustment REAL NOT NULL,
      reason TEXT,
      version TEXT NOT NULL,
      PRIMARY KEY(auto_tuning_run_id, bucket_type, bucket_name)
    );

    CREATE TABLE IF NOT EXISTS optimization_experiments (
      experiment_id TEXT PRIMARY KEY,
      name TEXT,
      target_area TEXT,
      status TEXT,
      created_at TEXT NOT NULL,
      started_at TEXT,
      ended_at TEXT,
      baseline_config_snapshot TEXT,
      experiment_config_snapshot TEXT,
      traffic_split TEXT,
      success_criteria TEXT,
      failure_criteria TEXT,
      sample_size_required INTEGER,
      decision TEXT,
      decision_reason TEXT
    );

    CREATE TABLE IF NOT EXISTS optimization_results (
      result_id TEXT PRIMARY KEY,
      experiment_id TEXT,
      variant TEXT,
      sample_size INTEGER,
      win_rate REAL,
      avg_peak_return_x REAL,
      median_peak_return_x REAL,
      missed_winner_rate REAL,
      false_positive_rate REAL,
      avg_time_to_peak REAL,
      avg_drawdown_after_peak REAL,
      used_credits INTEGER,
      cost_per_winner REAL,
      evaluated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS config_versions (
      config_version TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      source TEXT,
      status TEXT,
      config_snapshot TEXT,
      change_summary TEXT,
      promoted_from_experiment_id TEXT,
      rollback_from_version TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_scan_candidates_scan_id ON scan_candidates(scan_id);
    CREATE INDEX IF NOT EXISTS idx_scan_candidates_token_address ON scan_candidates(token_address);
    CREATE INDEX IF NOT EXISTS idx_scan_candidates_created_at ON scan_candidates(created_at);
    CREATE INDEX IF NOT EXISTS idx_scan_candidates_posted ON scan_candidates(posted);
    CREATE INDEX IF NOT EXISTS idx_candidate_snapshots_scan_token ON candidate_performance_snapshots(scan_id, token_address);
    CREATE INDEX IF NOT EXISTS idx_candidate_snapshots_label ON candidate_performance_snapshots(snapshot_label);
    CREATE INDEX IF NOT EXISTS idx_candidate_peak_scan_token ON candidate_peak_performance(scan_id, token_address);
    CREATE INDEX IF NOT EXISTS idx_alert_candidates_run_id ON alert_candidates(alert_run_id);
    CREATE INDEX IF NOT EXISTS idx_alert_candidates_token_address ON alert_candidates(token_address);
    CREATE INDEX IF NOT EXISTS idx_alert_candidates_created_at ON alert_candidates(created_at);
    CREATE INDEX IF NOT EXISTS idx_alert_candidates_posted ON alert_candidates(posted);
    CREATE INDEX IF NOT EXISTS idx_alert_snapshots_run_token ON alert_performance_snapshots(alert_run_id, token_address);
    CREATE INDEX IF NOT EXISTS idx_auto_tuning_results_version_created ON auto_tuning_results(version, created_at);
    CREATE INDEX IF NOT EXISTS idx_smart_wallet_obs_wallet ON smart_wallet_observations(wallet_address);
    CREATE INDEX IF NOT EXISTS idx_smart_wallet_obs_token ON smart_wallet_observations(token_address);
    CREATE INDEX IF NOT EXISTS idx_smart_wallet_obs_alert_run ON smart_wallet_observations(alert_run_id);
    CREATE INDEX IF NOT EXISTS idx_smart_wallet_obs_scan ON smart_wallet_observations(scan_id);
    CREATE INDEX IF NOT EXISTS idx_smart_wallet_obs_created_at ON smart_wallet_observations(created_at);
  `);

  // 既存DBにもResearch Cardの元メッセージ情報を後付けします。
  ensureColumn(db, "signals", "signal_type", "TEXT");
  ensureColumn(db, "signals", "narrative_summary", "TEXT");
  ensureColumn(db, "signals", "narrative_type", "TEXT");
  ensureColumn(db, "signals", "narrative_sources", "TEXT");
  ensureColumn(db, "signals", "narrative_evidence", "TEXT");
  ensureColumn(db, "signals", "narrative_tags", "TEXT");
  ensureColumn(db, "signals", "narrative_confidence", "TEXT");
  ensureColumn(db, "signals", "message_id", "TEXT");
  ensureColumn(db, "signals", "channel_id", "TEXT");
  ensureColumn(db, "alerts", "quality_gate_grade", "TEXT");
  ensureColumn(db, "alerts", "quality_gate_reasons", "TEXT");
  ensureColumn(db, "alerts", "quality_gate_warnings", "TEXT");
  ensureColumn(db, "alerts", "deep_check_id", "TEXT");
  ensureColumn(db, "alerts", "alert_run_id", "TEXT");
  ensureColumn(db, "alerts", "message_id", "TEXT");
  ensureColumn(db, "alerts", "mcap", "REAL");
  ensureColumn(db, "alerts", "age_days", "REAL");
  ensureColumn(db, "alerts", "liquidity", "REAL");
  ensureColumn(db, "alerts", "flow_1h", "REAL");
  ensureColumn(db, "alerts", "flow_4h", "REAL");
  ensureColumn(db, "alerts", "flow_24h", "REAL");
  ensureColumn(db, "alerts", "flow_mcap", "REAL");
  ensureColumn(db, "alerts", "traders", "INTEGER");
  ensureColumn(db, "alerts", "score", "REAL");
  ensureColumn(db, "alerts", "cli_grade", "TEXT");
  ensureColumn(db, "alerts", "candidate_source_type", "TEXT");
  ensureColumn(db, "alerts", "is_realert", "INTEGER");
  ensureColumn(db, "alerts", "realert_reason", "TEXT");
  ensureColumn(db, "alerts", "created_at", "TEXT");
  ensureColumn(db, "deep_checks", "wallet_quality_summary", "TEXT");
  ensureColumn(db, "deep_checks", "narrative_summary", "TEXT");
  ensureColumn(db, "deep_checks", "narrative_type", "TEXT");
  ensureColumn(db, "deep_checks", "narrative_sources", "TEXT");
  ensureColumn(db, "deep_checks", "narrative_evidence", "TEXT");
  ensureColumn(db, "deep_checks", "narrative_tags", "TEXT");
  ensureColumn(db, "deep_checks", "narrative_confidence", "TEXT");
  ensureColumn(db, "deep_checks", "wallet_behavior_counts", "TEXT");
  ensureColumn(db, "deep_checks", "estimated_independent_wallets", "INTEGER");
  ensureColumn(db, "user_picks", "button_type", "TEXT");
  ensureColumn(db, "user_picks", "time_since_signal_minutes", "REAL");
  ensureColumn(db, "user_picks", "mcap_at_click", "REAL");
  ensureColumn(db, "user_picks", "price_at_click", "REAL");
  ensureColumn(db, "user_picks", "signal_source", "TEXT");
  ensureColumn(db, "user_picks", "signal_type", "TEXT");
  ensureColumn(db, "scan_runs", "config_snapshot", "TEXT");
  ensureColumn(db, "scan_runs", "market_context", "TEXT");
  ensureColumn(db, "scan_runs", "credits_by_step", "TEXT");
  ensureColumn(db, "scan_runs", "requested_candidate_pool_size", "INTEGER");
  ensureColumn(db, "scan_runs", "actual_candidate_pool_size", "INTEGER");
  ensureColumn(db, "scan_runs", "nansen_page_limit", "INTEGER");
  ensureColumn(db, "scan_runs", "nansen_pagination_used", "INTEGER");
  ensureColumn(db, "scan_runs", "nansen_fetch_warning", "TEXT");
  ensureColumn(db, "scan_candidates", "rank_bucket", "TEXT");
  ensureColumn(db, "scan_candidates", "positive_flags", "TEXT");
  ensureColumn(db, "scan_candidates", "warning_flags", "TEXT");
  ensureColumn(db, "scan_candidates", "pass_reason_codes", "TEXT");
  ensureColumn(db, "scan_candidates", "reject_reason_codes", "TEXT");
  ensureColumn(db, "scan_candidates", "price", "REAL");
  ensureColumn(db, "scan_candidates", "entry_price", "REAL");
  ensureColumn(db, "scan_candidates", "volume_24h", "REAL");
  ensureColumn(db, "scan_candidates", "market_data_refreshed_at", "TEXT");
  ensureColumn(db, "scan_candidates", "market_data_age_minutes", "REAL");
  ensureColumn(db, "scan_candidates", "market_data_source", "TEXT");
  ensureColumn(db, "scan_candidates", "market_data_warning", "TEXT");
  ensureColumn(db, "scan_candidates", "raw_dexscreener_snapshot", "TEXT");
  ensureColumn(db, "alert_candidates", "price", "REAL");
  ensureColumn(db, "alert_candidates", "volume_24h", "REAL");
  ensureColumn(db, "alert_candidates", "market_data_source", "TEXT");
  ensureColumn(db, "alert_candidates", "market_data_warning", "TEXT");
  ensureColumn(db, "alert_candidates", "smart_wallet_quality_score", "REAL");
  ensureColumn(db, "alert_candidates", "smart_wallet_quality_label", "TEXT");
  ensureColumn(db, "alert_candidates", "strong_wallet_count", "INTEGER");
  ensureColumn(db, "alert_candidates", "medium_wallet_count", "INTEGER");
  ensureColumn(db, "alert_candidates", "weak_wallet_count", "INTEGER");
  ensureColumn(db, "alert_candidates", "known_wallet_count", "INTEGER");
  ensureColumn(db, "alert_candidates", "wallet_pdca_summary", "TEXT");
  ensureColumn(db, "alert_candidates", "auto_tuning_adjustment", "REAL");
  ensureColumn(db, "alert_candidates", "auto_tuning_reasons", "TEXT");
  ensureColumn(db, "alert_candidates", "auto_tuning_version", "TEXT");
  ensureColumn(db, "alert_performance_snapshots", "alert_candidate_id", "TEXT");
  ensureColumn(db, "alert_peak_performance", "alert_candidate_id", "TEXT");
  ensureColumn(db, "alert_pump_notifications", "alert_candidate_id", "TEXT");

  db.exec(`
    CREATE TABLE IF NOT EXISTS alert_pump_notifications_v2 (
      notification_id TEXT PRIMARY KEY,
      alert_candidate_id TEXT,
      alert_run_id TEXT NOT NULL,
      token_address TEXT NOT NULL,
      threshold_x REAL NOT NULL,
      return_x REAL,
      entry_mcap REAL,
      peak_mcap REAL,
      time_to_peak_hours REAL,
      snapshot_label TEXT,
      channel_id TEXT,
      message_id TEXT,
      notified_at TEXT NOT NULL,
      UNIQUE(alert_candidate_id, threshold_x)
    );
    INSERT OR IGNORE INTO alert_pump_notifications_v2 (
      notification_id, alert_candidate_id, alert_run_id, token_address, threshold_x,
      return_x, entry_mcap, peak_mcap, time_to_peak_hours, snapshot_label,
      channel_id, message_id, notified_at
    )
    SELECT
      notification_id, alert_candidate_id, alert_run_id, token_address, threshold_x,
      return_x, entry_mcap, peak_mcap, time_to_peak_hours, snapshot_label,
      channel_id, message_id, notified_at
    FROM alert_pump_notifications;
    DROP TABLE alert_pump_notifications;
    ALTER TABLE alert_pump_notifications_v2 RENAME TO alert_pump_notifications;

    CREATE INDEX IF NOT EXISTS idx_alert_snapshots_candidate_id ON alert_performance_snapshots(alert_candidate_id);
    CREATE INDEX IF NOT EXISTS idx_alert_peak_candidate_id ON alert_peak_performance(alert_candidate_id);
    CREATE INDEX IF NOT EXISTS idx_alert_pump_candidate_id ON alert_pump_notifications(alert_candidate_id);

    UPDATE alert_performance_snapshots
    SET alert_candidate_id = (
      SELECT ac.id
      FROM alert_candidates ac
      WHERE ac.posted = 1
        AND ac.token_address = alert_performance_snapshots.token_address
        AND (
          ac.alert_run_id = alert_performance_snapshots.alert_run_id
          OR ac.created_at <= alert_performance_snapshots.created_at
        )
      ORDER BY
        CASE WHEN ac.alert_run_id = alert_performance_snapshots.alert_run_id THEN 0 ELSE 1 END,
        ABS(strftime('%s', alert_performance_snapshots.created_at) - strftime('%s', ac.created_at))
      LIMIT 1
    )
    WHERE alert_candidate_id IS NULL;

    UPDATE alert_peak_performance
    SET alert_candidate_id = (
      SELECT ac.id
      FROM alert_candidates ac
      WHERE ac.posted = 1
        AND ac.token_address = alert_peak_performance.token_address
        AND (
          ac.alert_run_id = alert_peak_performance.alert_run_id
          OR ac.created_at <= alert_peak_performance.updated_at
        )
      ORDER BY
        CASE WHEN ac.alert_run_id = alert_peak_performance.alert_run_id THEN 0 ELSE 1 END,
        ABS(strftime('%s', alert_peak_performance.updated_at) - strftime('%s', ac.created_at))
      LIMIT 1
    )
    WHERE alert_candidate_id IS NULL;

    UPDATE alert_pump_notifications
    SET alert_candidate_id = (
      SELECT ac.id
      FROM alert_candidates ac
      WHERE ac.posted = 1
        AND ac.token_address = alert_pump_notifications.token_address
        AND (
          ac.alert_run_id = alert_pump_notifications.alert_run_id
          OR ac.created_at <= alert_pump_notifications.notified_at
        )
      ORDER BY
        CASE WHEN ac.alert_run_id = alert_pump_notifications.alert_run_id THEN 0 ELSE 1 END,
        ABS(strftime('%s', alert_pump_notifications.notified_at) - strftime('%s', ac.created_at))
      LIMIT 1
    )
    WHERE alert_candidate_id IS NULL;
  `);
}

function buildFreshScanSqliteStore(db: SqliteDatabase) {
  const insertRun = db.prepare(`
    INSERT INTO scan_runs (
      scan_id, label, source, candidate_pool_size, gate_0_count, hard_reject_count,
      momentum_gate_count, pre_filter_count, cli_checked_count, final_count,
      config_snapshot, market_context, credits_by_step, requested_candidate_pool_size,
      actual_candidate_pool_size, nansen_page_limit, nansen_pagination_used,
      nansen_fetch_warning, created_at
    ) VALUES (
      @scan_id, @label, @source, @candidate_pool_size, @gate_0_count, @hard_reject_count,
      @momentum_gate_count, @pre_filter_count, @cli_checked_count, @final_count,
      @config_snapshot, @market_context, @credits_by_step, @requested_candidate_pool_size,
      @actual_candidate_pool_size, @nansen_page_limit, @nansen_pagination_used,
      @nansen_fetch_warning, @created_at
    )
  `);
  const insertCandidate = db.prepare(`
    INSERT INTO scan_candidates (
      id, scan_id, token_address, symbol, name, candidate_rank, candidate_sources,
      mcap, price, entry_price, age_days, liquidity, volume_24h, market_data_refreshed_at,
      market_data_age_minutes, market_data_source, market_data_warning, raw_dexscreener_snapshot,
      flow_24h, flow_7d, flow_mcap, traders,
      gate_0_status, gate_0_reason, hard_reject_status, hard_reject_reason, risk_flags,
      momentum_score, momentum_gate_status, momentum_gate_reason, fresh_scan_rank_score,
      fresh_scan_rank_components, pre_filter_status, pre_filter_rank, pre_filter_reason,
      cli_candidate_score, why_selected_for_cli, cli_checked, cli_grade, cli_oracle_status,
      cli_reject_reason, final_rank, final_rank_reason, posted, posted_message_id,
      score, signal_type, exclusion_reason, rank_bucket, positive_flags, warning_flags,
      pass_reason_codes, reject_reason_codes, created_at
    ) VALUES (
      @id, @scan_id, @token_address, @symbol, @name, @candidate_rank, @candidate_sources,
      @mcap, @price, @entry_price, @age_days, @liquidity, @volume_24h, @market_data_refreshed_at,
      @market_data_age_minutes, @market_data_source, @market_data_warning, @raw_dexscreener_snapshot,
      @flow_24h, @flow_7d, @flow_mcap, @traders,
      @gate_0_status, @gate_0_reason, @hard_reject_status, @hard_reject_reason, @risk_flags,
      @momentum_score, @momentum_gate_status, @momentum_gate_reason, @fresh_scan_rank_score,
      @fresh_scan_rank_components, @pre_filter_status, @pre_filter_rank, @pre_filter_reason,
      @cli_candidate_score, @why_selected_for_cli, @cli_checked, @cli_grade, @cli_oracle_status,
      @cli_reject_reason, @final_rank, @final_rank_reason, @posted, @posted_message_id,
      @score, @signal_type, @exclusion_reason, @rank_bucket, @positive_flags, @warning_flags,
      @pass_reason_codes, @reject_reason_codes, @created_at
    )
  `);
  const saveCandidates = db.transaction((run: FreshScanRunRecord, candidates: FreshScanCandidateRecord[]) => {
    insertRun.run(run);

    for (const candidate of candidates) {
      insertCandidate.run({ id: `${candidate.scan_id}:${candidate.token_address}:${candidate.candidate_rank}`, ...candidate });
    }
  });
  const insertSnapshot = db.prepare(`
    INSERT INTO candidate_performance_snapshots (
      id, scan_id, token_address, snapshot_label, snapshot_time, mcap, price,
      liquidity, volume_24h, return_x, created_at
    ) VALUES (
      @id, @scan_id, @token_address, @snapshot_label, @snapshot_time, @mcap, @price,
      @liquidity, @volume_24h, @return_x, @created_at
    )
  `);
  const upsertPeak = db.prepare(`
    INSERT INTO candidate_peak_performance (
      id, scan_id, token_address, entry_mcap, peak_mcap, peak_return_x,
      time_to_peak_hours, drawdown_after_peak, best_snapshot_label, updated_at
    ) VALUES (
      @id, @scan_id, @token_address, @entry_mcap, @peak_mcap, @peak_return_x,
      @time_to_peak_hours, NULL, @best_snapshot_label, @updated_at
    )
    ON CONFLICT(scan_id, token_address) DO UPDATE SET
      peak_mcap = CASE
        WHEN excluded.peak_return_x > COALESCE(candidate_peak_performance.peak_return_x, 0)
        THEN excluded.peak_mcap ELSE candidate_peak_performance.peak_mcap END,
      peak_return_x = CASE
        WHEN excluded.peak_return_x > COALESCE(candidate_peak_performance.peak_return_x, 0)
        THEN excluded.peak_return_x ELSE candidate_peak_performance.peak_return_x END,
      time_to_peak_hours = CASE
        WHEN excluded.peak_return_x > COALESCE(candidate_peak_performance.peak_return_x, 0)
        THEN excluded.time_to_peak_hours ELSE candidate_peak_performance.time_to_peak_hours END,
      best_snapshot_label = CASE
        WHEN excluded.peak_return_x > COALESCE(candidate_peak_performance.peak_return_x, 0)
        THEN excluded.best_snapshot_label ELSE candidate_peak_performance.best_snapshot_label END,
      updated_at = excluded.updated_at
  `);

  return {
    provider: "sqlite" as FreshScanDbProvider,
    saveRun(run: FreshScanRunRecord, candidates: FreshScanCandidateRecord[]): Promise<void> {
      saveCandidates(run, candidates);
      return Promise.resolve();
    },
    savePerformanceSnapshot(snapshot: CandidatePerformanceSnapshotRecord): Promise<void> {
      insertSnapshot.run({ id: `${snapshot.scan_id}:${snapshot.token_address}:${snapshot.snapshot_label}`, ...snapshot });
      upsertPeak.run({
        id: `${snapshot.scan_id}:${snapshot.token_address}:peak`,
        scan_id: snapshot.scan_id,
        token_address: snapshot.token_address,
        entry_mcap: snapshot.entry_mcap,
        peak_mcap: snapshot.mcap,
        peak_return_x: snapshot.return_x,
        time_to_peak_hours: Number(snapshot.snapshot_label.replace("h", "").replace("d", "")) * (snapshot.snapshot_label.endsWith("d") ? 24 : 1),
        best_snapshot_label: snapshot.snapshot_label,
        updated_at: snapshot.created_at,
      });
      upsertSmartWalletProfilesSqlite(db, aggregateSmartWalletProfilesSqlite(db));
      return Promise.resolve();
    },
    refreshSmartWalletProfiles(): Promise<void> {
      upsertSmartWalletProfilesSqlite(db, aggregateSmartWalletProfilesSqlite(db));
      return Promise.resolve();
    },
    close(): Promise<void> {
      return Promise.resolve();
    },
  };
}

const alertCandidateColumns = [
  "alert_run_id",
  "token_address",
  "symbol",
  "name",
  "candidate_rank",
  "candidate_source_type",
  "candidate_sources",
  "source_quota_bucket",
  "source_priority",
  "source_detected_at",
  "candidate_freshness_minutes",
  "market_data_refreshed_at",
  "market_data_age_minutes",
  "market_data_source",
  "market_data_warning",
  "from_fresh_scan_id",
  "from_scan_candidate_id",
  "from_previous_alert_run_id",
  "from_watch_pick_id",
  "is_reaccelerated",
  "reacceleration_reason",
  "mcap",
  "price",
  "age_days",
  "liquidity",
  "volume_24h",
  "flow_1h",
  "flow_4h",
  "flow_24h",
  "flow_7d",
  "flow_mcap",
  "traders",
  "gate_0_status",
  "gate_0_reason",
  "alert_momentum_score",
  "alert_momentum_components",
  "pre_filter_status",
  "pre_filter_rank",
  "pre_filter_reason",
  "cli_checked",
  "cli_grade",
  "cli_oracle_status",
  "raw_cli_summary",
  "raw_nansen_flow_intelligence",
  "raw_nansen_who_bought_sold",
  "raw_nansen_holders",
  "raw_nansen_dex_trades",
  "flow_quality",
  "holder_risk",
  "buyer_seller_balance",
  "sell_pressure",
  "wallet_quality",
  "cluster_risk",
  "smart_wallet_quality_score",
  "smart_wallet_quality_label",
  "strong_wallet_count",
  "medium_wallet_count",
  "weak_wallet_count",
  "known_wallet_count",
  "wallet_pdca_summary",
  "auto_tuning_adjustment",
  "auto_tuning_reasons",
  "auto_tuning_version",
  "quality_gate_grade",
  "quality_gate_reasons",
  "quality_gate_warnings",
  "positive_flags",
  "risk_flags",
  "warning_flags",
  "pass_reason_codes",
  "reject_reason_codes",
  "rank_bucket",
  "final_rank",
  "posted",
  "posted_message_id",
  "entry_mcap",
  "entry_price",
  "raw_dexscreener_snapshot",
  "created_at",
] as const;

type AlertSnapshotRecord = {
  alert_candidate_id?: string | null;
  alert_run_id: string;
  token_address: string;
  snapshot_label: string;
  snapshot_time: string;
  mcap: number | null;
  price: number | null;
  liquidity: number | null;
  volume_24h: number | null;
  return_x: number | null;
  entry_mcap: number | null;
  created_at: string;
};

function snapshotLabelToHours(label: string): number {
  return Number(label.replace("h", "").replace("d", "")) * (label.endsWith("d") ? 24 : 1);
}

function clampScore(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function calculateWalletProfileQuality(row: SmartWalletProfileAggregateRow): { score: number; label: string; rawStats: string } {
  const observedCount = Number(row.observed_tokens_count) || 0;
  const hit2x = Number(row.hit_2x_count) || 0;
  const hit5x = Number(row.hit_5x_count) || 0;
  const hit10x = Number(row.hit_10x_count) || 0;
  const bad = Number(row.bad_result_count) || 0;
  const botLike = Number(row.bot_like_count) || 0;
  const highRisk = Number(row.high_risk_count) || 0;
  const avgPeak = row.avg_peak_return ?? null;

  if (observedCount < 3) {
    return {
      score: 0,
      label: "Unknown",
      rawStats: JSON.stringify({ ...row, reason: "observed_tokens_count < 3" }),
    };
  }

  const confidence = Math.min(1, observedCount / 10);
  const hit2Rate = hit2x / observedCount;
  const hit5Rate = hit5x / observedCount;
  const badRate = bad / observedCount;
  let score = 35;

  score += hit2Rate * 28;
  score += hit5Rate * 32;
  score += hit10x * 4;
  score += Math.min(18, Math.max(0, ((avgPeak ?? 1) - 1) * 7));
  score += confidence * 12;
  score -= badRate * 30;
  score -= Math.min(20, botLike * 5);
  score -= Math.min(22, highRisk * 6);
  score = 35 + (score - 35) * confidence;

  const clamped = clampScore(score);
  const label = clamped >= 75 ? "Strong" : clamped >= 50 ? "Medium" : "Weak";

  return {
    score: clamped,
    label,
    rawStats: JSON.stringify({
      ...row,
      confidence,
      hit_2x_rate: hit2Rate,
      hit_5x_rate: hit5Rate,
      bad_result_rate: badRate,
      scoring_version: "smart-wallet-pdca-v1",
    }),
  };
}

function aggregateSmartWalletProfilesSqlite(db: SqliteDatabase): SmartWalletProfileAggregateRow[] {
  return db.prepare(`
    WITH observed_tokens AS (
      SELECT
        wallet_address,
        token_address,
        MAX(CASE WHEN source_type = 'alert' THEN 1 ELSE 0 END) AS is_alert_token,
        MIN(token_mcap_at_observation) AS first_mcap,
        MAX(CASE WHEN cluster_risk = 'High' OR sell_pressure = 'High' OR holder_risk = 'High' THEN 1 ELSE 0 END) AS high_risk_seen,
        MAX(CASE WHEN wallet_quality = 'Low' OR cluster_risk IN ('High', 'Medium') THEN 1 ELSE 0 END) AS bot_like_seen,
        MAX(observed_at) AS last_seen_at
      FROM smart_wallet_observations
      GROUP BY wallet_address, token_address
    ),
    snapshot_returns AS (
      SELECT token_address, snapshot_label, MAX(return_x) AS return_x
      FROM candidate_performance_snapshots
      WHERE return_x IS NOT NULL
      GROUP BY token_address, snapshot_label
      UNION ALL
      SELECT token_address, snapshot_label, MAX(return_x) AS return_x
      FROM alert_performance_snapshots
      WHERE return_x IS NOT NULL
      GROUP BY token_address, snapshot_label
    ),
    token_returns AS (
      SELECT
        token_address,
        MAX(CASE WHEN snapshot_label = '1h' THEN return_x END) AS return_1h,
        MAX(CASE WHEN snapshot_label = '4h' THEN return_x END) AS return_4h,
        MAX(CASE WHEN snapshot_label = '24h' THEN return_x END) AS return_24h
      FROM snapshot_returns
      GROUP BY token_address
    ),
    token_peaks AS (
      SELECT token_address, MAX(peak_return_x) AS peak_return_x
      FROM (
        SELECT token_address, peak_return_x FROM candidate_peak_performance WHERE peak_return_x IS NOT NULL
        UNION ALL
        SELECT token_address, peak_return_x FROM alert_peak_performance WHERE peak_return_x IS NOT NULL
      )
      GROUP BY token_address
    )
    SELECT
      ot.wallet_address,
      COUNT(*) AS observed_tokens_count,
      SUM(ot.is_alert_token) AS observed_alert_tokens_count,
      AVG(tr.return_1h) AS avg_return_1h,
      AVG(tr.return_4h) AS avg_return_4h,
      AVG(tr.return_24h) AS avg_return_24h,
      AVG(tp.peak_return_x) AS avg_peak_return,
      SUM(CASE WHEN COALESCE(tp.peak_return_x, 0) >= 2.0 THEN 1 ELSE 0 END) AS hit_2x_count,
      SUM(CASE WHEN COALESCE(tp.peak_return_x, 0) >= 5.0 THEN 1 ELSE 0 END) AS hit_5x_count,
      SUM(CASE WHEN COALESCE(tp.peak_return_x, 0) >= 10.0 THEN 1 ELSE 0 END) AS hit_10x_count,
      SUM(CASE WHEN ot.first_mcap IS NOT NULL AND ot.first_mcap < 500000 THEN 1 ELSE 0 END) AS early_entry_count,
      SUM(CASE WHEN tp.peak_return_x IS NOT NULL AND tp.peak_return_x < 0.7 THEN 1 ELSE 0 END) AS bad_result_count,
      SUM(ot.bot_like_seen) AS bot_like_count,
      SUM(ot.high_risk_seen) AS high_risk_count,
      MAX(ot.last_seen_at) AS last_seen_at
    FROM observed_tokens ot
    LEFT JOIN token_returns tr ON tr.token_address = ot.token_address
    LEFT JOIN token_peaks tp ON tp.token_address = ot.token_address
    GROUP BY ot.wallet_address
  `).all() as SmartWalletProfileAggregateRow[];
}

function upsertSmartWalletProfilesSqlite(db: SqliteDatabase, rows: SmartWalletProfileAggregateRow[]): void {
  const now = new Date().toISOString();
  const upsert = db.prepare(`
    INSERT INTO smart_wallet_profiles (
      wallet_address, observed_tokens_count, observed_alert_tokens_count,
      avg_return_1h, avg_return_4h, avg_return_24h, avg_peak_return,
      hit_2x_count, hit_5x_count, hit_10x_count, early_entry_count,
      bad_result_count, bot_like_count, high_risk_count, last_seen_at,
      last_updated_at, wallet_quality_score, wallet_quality_label, raw_stats
    ) VALUES (
      @wallet_address, @observed_tokens_count, @observed_alert_tokens_count,
      @avg_return_1h, @avg_return_4h, @avg_return_24h, @avg_peak_return,
      @hit_2x_count, @hit_5x_count, @hit_10x_count, @early_entry_count,
      @bad_result_count, @bot_like_count, @high_risk_count, @last_seen_at,
      @last_updated_at, @wallet_quality_score, @wallet_quality_label, @raw_stats
    )
    ON CONFLICT(wallet_address) DO UPDATE SET
      observed_tokens_count = excluded.observed_tokens_count,
      observed_alert_tokens_count = excluded.observed_alert_tokens_count,
      avg_return_1h = excluded.avg_return_1h,
      avg_return_4h = excluded.avg_return_4h,
      avg_return_24h = excluded.avg_return_24h,
      avg_peak_return = excluded.avg_peak_return,
      hit_2x_count = excluded.hit_2x_count,
      hit_5x_count = excluded.hit_5x_count,
      hit_10x_count = excluded.hit_10x_count,
      early_entry_count = excluded.early_entry_count,
      bad_result_count = excluded.bad_result_count,
      bot_like_count = excluded.bot_like_count,
      high_risk_count = excluded.high_risk_count,
      last_seen_at = excluded.last_seen_at,
      last_updated_at = excluded.last_updated_at,
      wallet_quality_score = excluded.wallet_quality_score,
      wallet_quality_label = excluded.wallet_quality_label,
      raw_stats = excluded.raw_stats
  `);
  const write = db.transaction((items: SmartWalletProfileAggregateRow[]) => {
    for (const row of items) {
      const quality = calculateWalletProfileQuality(row);

      upsert.run({
        ...row,
        last_updated_at: now,
        wallet_quality_score: quality.score,
        wallet_quality_label: quality.label,
        raw_stats: quality.rawStats,
      });
    }
  });

  write(rows);
}

async function aggregateSmartWalletProfilesPostgres(
  pool: { query: (text: string, params?: unknown[]) => Promise<{ rows?: unknown[] } | unknown> },
): Promise<SmartWalletProfileAggregateRow[]> {
  const result = await pool.query(`
    WITH observed_tokens AS (
      SELECT
        wallet_address,
        token_address,
        MAX(CASE WHEN source_type = 'alert' THEN 1 ELSE 0 END) AS is_alert_token,
        MIN(token_mcap_at_observation) AS first_mcap,
        MAX(CASE WHEN cluster_risk = 'High' OR sell_pressure = 'High' OR holder_risk = 'High' THEN 1 ELSE 0 END) AS high_risk_seen,
        MAX(CASE WHEN wallet_quality = 'Low' OR cluster_risk IN ('High', 'Medium') THEN 1 ELSE 0 END) AS bot_like_seen,
        MAX(observed_at) AS last_seen_at
      FROM smart_wallet_observations
      GROUP BY wallet_address, token_address
    ),
    snapshot_returns AS (
      SELECT token_address, snapshot_label, MAX(return_x) AS return_x
      FROM candidate_performance_snapshots
      WHERE return_x IS NOT NULL
      GROUP BY token_address, snapshot_label
      UNION ALL
      SELECT token_address, snapshot_label, MAX(return_x) AS return_x
      FROM alert_performance_snapshots
      WHERE return_x IS NOT NULL
      GROUP BY token_address, snapshot_label
    ),
    token_returns AS (
      SELECT
        token_address,
        MAX(CASE WHEN snapshot_label = '1h' THEN return_x END) AS return_1h,
        MAX(CASE WHEN snapshot_label = '4h' THEN return_x END) AS return_4h,
        MAX(CASE WHEN snapshot_label = '24h' THEN return_x END) AS return_24h
      FROM snapshot_returns
      GROUP BY token_address
    ),
    token_peaks AS (
      SELECT token_address, MAX(peak_return_x) AS peak_return_x
      FROM (
        SELECT token_address, peak_return_x FROM candidate_peak_performance WHERE peak_return_x IS NOT NULL
        UNION ALL
        SELECT token_address, peak_return_x FROM alert_peak_performance WHERE peak_return_x IS NOT NULL
      ) peaks
      GROUP BY token_address
    )
    SELECT
      ot.wallet_address,
      COUNT(*)::int AS observed_tokens_count,
      COALESCE(SUM(ot.is_alert_token), 0)::int AS observed_alert_tokens_count,
      AVG(tr.return_1h) AS avg_return_1h,
      AVG(tr.return_4h) AS avg_return_4h,
      AVG(tr.return_24h) AS avg_return_24h,
      AVG(tp.peak_return_x) AS avg_peak_return,
      COALESCE(SUM(CASE WHEN COALESCE(tp.peak_return_x, 0) >= 2.0 THEN 1 ELSE 0 END), 0)::int AS hit_2x_count,
      COALESCE(SUM(CASE WHEN COALESCE(tp.peak_return_x, 0) >= 5.0 THEN 1 ELSE 0 END), 0)::int AS hit_5x_count,
      COALESCE(SUM(CASE WHEN COALESCE(tp.peak_return_x, 0) >= 10.0 THEN 1 ELSE 0 END), 0)::int AS hit_10x_count,
      COALESCE(SUM(CASE WHEN ot.first_mcap IS NOT NULL AND ot.first_mcap < 500000 THEN 1 ELSE 0 END), 0)::int AS early_entry_count,
      COALESCE(SUM(CASE WHEN tp.peak_return_x IS NOT NULL AND tp.peak_return_x < 0.7 THEN 1 ELSE 0 END), 0)::int AS bad_result_count,
      COALESCE(SUM(ot.bot_like_seen), 0)::int AS bot_like_count,
      COALESCE(SUM(ot.high_risk_seen), 0)::int AS high_risk_count,
      MAX(ot.last_seen_at)::text AS last_seen_at
    FROM observed_tokens ot
    LEFT JOIN token_returns tr ON tr.token_address = ot.token_address
    LEFT JOIN token_peaks tp ON tp.token_address = ot.token_address
    GROUP BY ot.wallet_address
  `);

  return ((result as { rows?: unknown[] }).rows ?? []) as SmartWalletProfileAggregateRow[];
}

async function refreshSmartWalletProfilesPostgres(
  pool: { query: (text: string, params?: unknown[]) => Promise<unknown> },
): Promise<void> {
  const rows = await aggregateSmartWalletProfilesPostgres(pool);
  const now = new Date().toISOString();

  for (const row of rows) {
    const quality = calculateWalletProfileQuality(row);

    await pool.query(
      `INSERT INTO smart_wallet_profiles (
        wallet_address, observed_tokens_count, observed_alert_tokens_count,
        avg_return_1h, avg_return_4h, avg_return_24h, avg_peak_return,
        hit_2x_count, hit_5x_count, hit_10x_count, early_entry_count,
        bad_result_count, bot_like_count, high_risk_count, last_seen_at,
        last_updated_at, wallet_quality_score, wallet_quality_label, raw_stats
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19::jsonb)
      ON CONFLICT(wallet_address) DO UPDATE SET
        observed_tokens_count = excluded.observed_tokens_count,
        observed_alert_tokens_count = excluded.observed_alert_tokens_count,
        avg_return_1h = excluded.avg_return_1h,
        avg_return_4h = excluded.avg_return_4h,
        avg_return_24h = excluded.avg_return_24h,
        avg_peak_return = excluded.avg_peak_return,
        hit_2x_count = excluded.hit_2x_count,
        hit_5x_count = excluded.hit_5x_count,
        hit_10x_count = excluded.hit_10x_count,
        early_entry_count = excluded.early_entry_count,
        bad_result_count = excluded.bad_result_count,
        bot_like_count = excluded.bot_like_count,
        high_risk_count = excluded.high_risk_count,
        last_seen_at = excluded.last_seen_at,
        last_updated_at = excluded.last_updated_at,
        wallet_quality_score = excluded.wallet_quality_score,
        wallet_quality_label = excluded.wallet_quality_label,
        raw_stats = excluded.raw_stats`,
      [
        row.wallet_address,
        row.observed_tokens_count,
        row.observed_alert_tokens_count,
        row.avg_return_1h,
        row.avg_return_4h,
        row.avg_return_24h,
        row.avg_peak_return,
        row.hit_2x_count,
        row.hit_5x_count,
        row.hit_10x_count,
        row.early_entry_count,
        row.bad_result_count,
        row.bot_like_count,
        row.high_risk_count,
        row.last_seen_at,
        now,
        quality.score,
        quality.label,
        quality.rawStats,
      ],
    );
  }
}

function buildAlertSqliteStore(db: SqliteDatabase) {
  const insertSmartWalletObservation = db.prepare(`
    INSERT OR IGNORE INTO smart_wallet_observations (
      id, wallet_address, token_address, symbol, source_type, alert_run_id,
      alert_candidate_id, scan_id, scan_candidate_id, observed_at, side,
      amount_usd, token_mcap_at_observation, token_price_at_observation,
      flow_quality, wallet_quality, buyer_seller_balance, sell_pressure,
      holder_risk, cluster_risk, raw_context, created_at
    ) VALUES (
      @id, @wallet_address, @token_address, @symbol, @source_type, @alert_run_id,
      @alert_candidate_id, @scan_id, @scan_candidate_id, @observed_at, @side,
      @amount_usd, @token_mcap_at_observation, @token_price_at_observation,
      @flow_quality, @wallet_quality, @buyer_seller_balance, @sell_pressure,
      @holder_risk, @cluster_risk, @raw_context, @created_at
    )
  `);
  const insertRun = db.prepare(`
    INSERT INTO alert_runs (
      alert_run_id, started_at, finished_at, candidate_pool_size, nansen_candidate_size,
      fresh_scan_db_candidate_size, watch_candidate_size, pre_filter_size, cli_oracle_check_size,
      posted_count, used_credits, credits_by_step, status, error_message, config_snapshot,
      market_context, created_at
    ) VALUES (
      @alert_run_id, @started_at, @finished_at, @candidate_pool_size, @nansen_candidate_size,
      @fresh_scan_db_candidate_size, @watch_candidate_size, @pre_filter_size, @cli_oracle_check_size,
      @posted_count, @used_credits, @credits_by_step, @status, @error_message, @config_snapshot,
      @market_context, @created_at
    )
  `);
  const insertCandidate = db.prepare(`
    INSERT INTO alert_candidates (
      id, ${alertCandidateColumns.join(", ")}
    ) VALUES (
      @id, ${alertCandidateColumns.map((column) => `@${column}`).join(", ")}
    )
  `);
  const saveCandidates = db.transaction((run: AlertRunRecord, candidates: AlertCandidateRecord[]) => {
    insertRun.run(run);

    for (const candidate of candidates) {
      insertCandidate.run({
        id: `${candidate.alert_run_id}:${candidate.token_address}:${candidate.candidate_rank}`,
        ...candidate,
      });
    }
  });
  const insertSnapshot = db.prepare(`
    INSERT INTO alert_performance_snapshots (
      id, alert_candidate_id, alert_run_id, token_address, snapshot_label, snapshot_time, mcap, price,
      liquidity, volume_24h, return_x, created_at
    ) VALUES (
      @id, @alert_candidate_id, @alert_run_id, @token_address, @snapshot_label, @snapshot_time, @mcap, @price,
      @liquidity, @volume_24h, @return_x, @created_at
    )
  `);
  const upsertPeak = db.prepare(`
    INSERT INTO alert_peak_performance (
      id, alert_candidate_id, alert_run_id, token_address, entry_mcap, peak_mcap, peak_return_x,
      time_to_peak_hours, drawdown_after_peak, best_snapshot_label, updated_at
    ) VALUES (
      @id, @alert_candidate_id, @alert_run_id, @token_address, @entry_mcap, @peak_mcap, @peak_return_x,
      @time_to_peak_hours, NULL, @best_snapshot_label, @updated_at
    )
    ON CONFLICT(alert_run_id, token_address) DO UPDATE SET
      alert_candidate_id = COALESCE(alert_peak_performance.alert_candidate_id, excluded.alert_candidate_id),
      peak_mcap = CASE
        WHEN excluded.peak_return_x > COALESCE(alert_peak_performance.peak_return_x, 0)
        THEN excluded.peak_mcap ELSE alert_peak_performance.peak_mcap END,
      peak_return_x = CASE
        WHEN excluded.peak_return_x > COALESCE(alert_peak_performance.peak_return_x, 0)
        THEN excluded.peak_return_x ELSE alert_peak_performance.peak_return_x END,
      time_to_peak_hours = CASE
        WHEN excluded.peak_return_x > COALESCE(alert_peak_performance.peak_return_x, 0)
        THEN excluded.time_to_peak_hours ELSE alert_peak_performance.time_to_peak_hours END,
      best_snapshot_label = CASE
        WHEN excluded.peak_return_x > COALESCE(alert_peak_performance.peak_return_x, 0)
        THEN excluded.best_snapshot_label ELSE alert_peak_performance.best_snapshot_label END,
      updated_at = excluded.updated_at
  `);

  return {
    provider: "sqlite" as FreshScanDbProvider,
    saveRun(run: AlertRunRecord, candidates: AlertCandidateRecord[]): Promise<void> {
      saveCandidates(run, candidates);
      return Promise.resolve();
    },
    saveSmartWalletObservations(observations: SmartWalletObservationRecord[]): Promise<void> {
      const write = db.transaction((items: SmartWalletObservationRecord[]) => {
        for (const observation of items) {
          insertSmartWalletObservation.run(observation);
        }
      });

      write(observations);
      upsertSmartWalletProfilesSqlite(db, aggregateSmartWalletProfilesSqlite(db));
      return Promise.resolve();
    },
    refreshSmartWalletProfiles(): Promise<void> {
      upsertSmartWalletProfilesSqlite(db, aggregateSmartWalletProfilesSqlite(db));
      return Promise.resolve();
    },
    savePerformanceSnapshot(snapshot: AlertSnapshotRecord): Promise<void> {
      const alertCandidateId = snapshot.alert_candidate_id ?? `${snapshot.alert_run_id}:${snapshot.token_address}`;
      insertSnapshot.run({
        id: `${alertCandidateId}:${snapshot.snapshot_label}`,
        alert_candidate_id: snapshot.alert_candidate_id ?? null,
        ...snapshot,
      });
      upsertPeak.run({
        id: `${alertCandidateId}:peak`,
        alert_candidate_id: snapshot.alert_candidate_id ?? null,
        alert_run_id: snapshot.alert_run_id,
        token_address: snapshot.token_address,
        entry_mcap: snapshot.entry_mcap,
        peak_mcap: snapshot.mcap,
        peak_return_x: snapshot.return_x,
        time_to_peak_hours: snapshotLabelToHours(snapshot.snapshot_label),
        best_snapshot_label: snapshot.snapshot_label,
        updated_at: snapshot.created_at,
      });
      upsertSmartWalletProfilesSqlite(db, aggregateSmartWalletProfilesSqlite(db));
      return Promise.resolve();
    },
  };
}

function buildFreshScanPostgresStore(databaseUrl: string) {
  let pool: { query: (text: string, params?: unknown[]) => Promise<unknown>; end: () => Promise<void> } | null = null;
  let ready: Promise<void> = Promise.resolve();

  try {
    const pg = require("pg") as { Pool: new (config: { connectionString: string }) => { query: (text: string, params?: unknown[]) => Promise<unknown>; end: () => Promise<void> } };

    pool = new pg.Pool({ connectionString: databaseUrl });
    ready = pool.query(`
      CREATE TABLE IF NOT EXISTS scan_runs (
        scan_id TEXT PRIMARY KEY,
        label TEXT,
        source TEXT,
        candidate_pool_size INTEGER,
        requested_candidate_pool_size INTEGER,
        actual_candidate_pool_size INTEGER,
        nansen_page_limit INTEGER,
        nansen_pagination_used BOOLEAN,
        nansen_fetch_warning TEXT,
        gate_0_count INTEGER,
        hard_reject_count INTEGER,
        momentum_gate_count INTEGER,
        pre_filter_count INTEGER,
        cli_checked_count INTEGER,
        final_count INTEGER,
        config_snapshot JSONB,
        market_context JSONB,
        credits_by_step JSONB,
        created_at TIMESTAMPTZ NOT NULL
      );
      CREATE TABLE IF NOT EXISTS scan_candidates (
        id TEXT PRIMARY KEY,
        scan_id TEXT NOT NULL,
        token_address TEXT NOT NULL,
        symbol TEXT,
        name TEXT,
        candidate_rank INTEGER,
        candidate_sources JSONB,
        mcap DOUBLE PRECISION,
        price DOUBLE PRECISION,
        entry_price DOUBLE PRECISION,
        age_days DOUBLE PRECISION,
        liquidity DOUBLE PRECISION,
        volume_24h DOUBLE PRECISION,
        market_data_refreshed_at TIMESTAMPTZ,
        market_data_age_minutes DOUBLE PRECISION,
        market_data_source TEXT,
        market_data_warning TEXT,
        raw_dexscreener_snapshot JSONB,
        flow_24h DOUBLE PRECISION,
        flow_7d DOUBLE PRECISION,
        flow_mcap DOUBLE PRECISION,
        traders INTEGER,
        gate_0_status TEXT,
        gate_0_reason TEXT,
        hard_reject_status TEXT,
        hard_reject_reason TEXT,
        risk_flags JSONB,
        momentum_score DOUBLE PRECISION,
        momentum_gate_status TEXT,
        momentum_gate_reason TEXT,
        fresh_scan_rank_score DOUBLE PRECISION,
        fresh_scan_rank_components JSONB,
        pre_filter_status TEXT,
        pre_filter_rank INTEGER,
        pre_filter_reason TEXT,
        cli_candidate_score DOUBLE PRECISION,
        why_selected_for_cli TEXT,
        cli_checked BOOLEAN NOT NULL DEFAULT FALSE,
        cli_grade TEXT,
        cli_oracle_status TEXT,
        cli_reject_reason TEXT,
        final_rank INTEGER,
        final_rank_reason TEXT,
        posted BOOLEAN NOT NULL DEFAULT FALSE,
        posted_message_id TEXT,
        score DOUBLE PRECISION,
        signal_type TEXT,
        exclusion_reason TEXT,
        rank_bucket TEXT,
        positive_flags JSONB,
        warning_flags JSONB,
        pass_reason_codes JSONB,
        reject_reason_codes JSONB,
        created_at TIMESTAMPTZ NOT NULL
      );
      CREATE TABLE IF NOT EXISTS candidate_performance_snapshots (
        id TEXT PRIMARY KEY,
        scan_id TEXT NOT NULL,
        token_address TEXT NOT NULL,
        snapshot_label TEXT NOT NULL,
        snapshot_time TIMESTAMPTZ NOT NULL,
        mcap DOUBLE PRECISION,
        price DOUBLE PRECISION,
        liquidity DOUBLE PRECISION,
        volume_24h DOUBLE PRECISION,
        return_x DOUBLE PRECISION,
        created_at TIMESTAMPTZ NOT NULL
      );
      CREATE TABLE IF NOT EXISTS candidate_peak_performance (
        id TEXT PRIMARY KEY,
        scan_id TEXT NOT NULL,
        token_address TEXT NOT NULL,
        entry_mcap DOUBLE PRECISION,
        peak_mcap DOUBLE PRECISION,
        peak_return_x DOUBLE PRECISION,
        time_to_peak_hours DOUBLE PRECISION,
        drawdown_after_peak DOUBLE PRECISION,
        best_snapshot_label TEXT,
        updated_at TIMESTAMPTZ NOT NULL,
        UNIQUE(scan_id, token_address)
      );
      CREATE TABLE IF NOT EXISTS smart_wallet_observations (
        id TEXT PRIMARY KEY,
        wallet_address TEXT NOT NULL,
        token_address TEXT NOT NULL,
        symbol TEXT,
        source_type TEXT NOT NULL,
        alert_run_id TEXT,
        alert_candidate_id TEXT,
        scan_id TEXT,
        scan_candidate_id TEXT,
        observed_at TIMESTAMPTZ NOT NULL,
        side TEXT,
        amount_usd DOUBLE PRECISION,
        token_mcap_at_observation DOUBLE PRECISION,
        token_price_at_observation DOUBLE PRECISION,
        flow_quality TEXT,
        wallet_quality TEXT,
        buyer_seller_balance TEXT,
        sell_pressure TEXT,
        holder_risk TEXT,
        cluster_risk TEXT,
        raw_context JSONB,
        created_at TIMESTAMPTZ NOT NULL
      );
      CREATE TABLE IF NOT EXISTS smart_wallet_profiles (
        wallet_address TEXT PRIMARY KEY,
        observed_tokens_count INTEGER NOT NULL DEFAULT 0,
        observed_alert_tokens_count INTEGER NOT NULL DEFAULT 0,
        avg_return_1h DOUBLE PRECISION,
        avg_return_4h DOUBLE PRECISION,
        avg_return_24h DOUBLE PRECISION,
        avg_peak_return DOUBLE PRECISION,
        hit_2x_count INTEGER NOT NULL DEFAULT 0,
        hit_5x_count INTEGER NOT NULL DEFAULT 0,
        hit_10x_count INTEGER NOT NULL DEFAULT 0,
        early_entry_count INTEGER NOT NULL DEFAULT 0,
        bad_result_count INTEGER NOT NULL DEFAULT 0,
        bot_like_count INTEGER NOT NULL DEFAULT 0,
        high_risk_count INTEGER NOT NULL DEFAULT 0,
        last_seen_at TIMESTAMPTZ,
        last_updated_at TIMESTAMPTZ NOT NULL,
        wallet_quality_score DOUBLE PRECISION NOT NULL DEFAULT 0,
        wallet_quality_label TEXT NOT NULL DEFAULT 'Unknown',
        raw_stats JSONB
      );
      ALTER TABLE scan_runs ADD COLUMN IF NOT EXISTS requested_candidate_pool_size INTEGER;
      ALTER TABLE scan_runs ADD COLUMN IF NOT EXISTS actual_candidate_pool_size INTEGER;
      ALTER TABLE scan_runs ADD COLUMN IF NOT EXISTS nansen_page_limit INTEGER;
      ALTER TABLE scan_runs ADD COLUMN IF NOT EXISTS nansen_pagination_used BOOLEAN;
      ALTER TABLE scan_runs ADD COLUMN IF NOT EXISTS nansen_fetch_warning TEXT;
      ALTER TABLE scan_candidates ADD COLUMN IF NOT EXISTS price DOUBLE PRECISION;
      ALTER TABLE scan_candidates ADD COLUMN IF NOT EXISTS entry_price DOUBLE PRECISION;
      ALTER TABLE scan_candidates ADD COLUMN IF NOT EXISTS volume_24h DOUBLE PRECISION;
      ALTER TABLE scan_candidates ADD COLUMN IF NOT EXISTS market_data_refreshed_at TIMESTAMPTZ;
      ALTER TABLE scan_candidates ADD COLUMN IF NOT EXISTS market_data_age_minutes DOUBLE PRECISION;
      ALTER TABLE scan_candidates ADD COLUMN IF NOT EXISTS market_data_source TEXT;
      ALTER TABLE scan_candidates ADD COLUMN IF NOT EXISTS market_data_warning TEXT;
      ALTER TABLE scan_candidates ADD COLUMN IF NOT EXISTS raw_dexscreener_snapshot JSONB;
      CREATE INDEX IF NOT EXISTS idx_scan_candidates_scan_id ON scan_candidates(scan_id);
      CREATE INDEX IF NOT EXISTS idx_scan_candidates_token_address ON scan_candidates(token_address);
      CREATE INDEX IF NOT EXISTS idx_scan_candidates_created_at ON scan_candidates(created_at);
      CREATE INDEX IF NOT EXISTS idx_scan_candidates_posted ON scan_candidates(posted);
      CREATE INDEX IF NOT EXISTS idx_candidate_snapshots_scan_token ON candidate_performance_snapshots(scan_id, token_address);
      CREATE INDEX IF NOT EXISTS idx_candidate_snapshots_label ON candidate_performance_snapshots(snapshot_label);
      CREATE INDEX IF NOT EXISTS idx_candidate_peak_scan_token ON candidate_peak_performance(scan_id, token_address);
      CREATE INDEX IF NOT EXISTS idx_smart_wallet_obs_wallet ON smart_wallet_observations(wallet_address);
      CREATE INDEX IF NOT EXISTS idx_smart_wallet_obs_token ON smart_wallet_observations(token_address);
      CREATE INDEX IF NOT EXISTS idx_smart_wallet_obs_alert_run ON smart_wallet_observations(alert_run_id);
      CREATE INDEX IF NOT EXISTS idx_smart_wallet_obs_scan ON smart_wallet_observations(scan_id);
      CREATE INDEX IF NOT EXISTS idx_smart_wallet_obs_created_at ON smart_wallet_observations(created_at);

      UPDATE alert_performance_snapshots aps
      SET alert_candidate_id = (
        SELECT id
        FROM alert_candidates
        WHERE posted = TRUE
          AND token_address = aps.token_address
          AND (alert_run_id = aps.alert_run_id OR created_at <= aps.created_at)
        ORDER BY
          CASE WHEN alert_run_id = aps.alert_run_id THEN 0 ELSE 1 END,
          ABS(EXTRACT(EPOCH FROM (aps.created_at::timestamptz - created_at::timestamptz)))
        LIMIT 1
      )
      WHERE aps.alert_candidate_id IS NULL;

      UPDATE alert_peak_performance app
      SET alert_candidate_id = (
        SELECT id
        FROM alert_candidates
        WHERE posted = TRUE
          AND token_address = app.token_address
          AND (alert_run_id = app.alert_run_id OR created_at <= app.updated_at)
        ORDER BY
          CASE WHEN alert_run_id = app.alert_run_id THEN 0 ELSE 1 END,
          ABS(EXTRACT(EPOCH FROM (app.updated_at::timestamptz - created_at::timestamptz)))
        LIMIT 1
      )
      WHERE app.alert_candidate_id IS NULL;

      UPDATE alert_pump_notifications apn
      SET alert_candidate_id = (
        SELECT id
        FROM alert_candidates
        WHERE posted = TRUE
          AND token_address = apn.token_address
          AND (alert_run_id = apn.alert_run_id OR created_at <= apn.notified_at)
        ORDER BY
          CASE WHEN alert_run_id = apn.alert_run_id THEN 0 ELSE 1 END,
          ABS(EXTRACT(EPOCH FROM (apn.notified_at::timestamptz - created_at::timestamptz)))
        LIMIT 1
      )
      WHERE apn.alert_candidate_id IS NULL;
    `).then(() => undefined).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "unknown error";

      console.warn(`Postgres Fresh Scan schema 初期化に失敗しました。SQLite fallbackを使います: ${message}`);
      pool = null;
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";

    console.warn(`Postgres Fresh Scan store を初期化できませんでした。SQLite fallbackを使います: ${message}`);
    pool = null;
  }

  return {
    provider: pool ? "postgres" as FreshScanDbProvider : "sqlite" as FreshScanDbProvider,
    async saveRun(run: FreshScanRunRecord, candidates: FreshScanCandidateRecord[]): Promise<void> {
      if (!pool) return;

      await ready;
      await pool.query("BEGIN");
      try {
        await pool.query(
          `INSERT INTO scan_runs (
            scan_id, label, source, candidate_pool_size, gate_0_count, hard_reject_count,
            momentum_gate_count, pre_filter_count, cli_checked_count, final_count,
            config_snapshot, market_context, credits_by_step, requested_candidate_pool_size,
            actual_candidate_pool_size, nansen_page_limit, nansen_pagination_used,
            nansen_fetch_warning, created_at
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13::jsonb,$14,$15,$16,$17,$18,$19)`,
          [
            run.scan_id,
            run.label,
            run.source,
            run.candidate_pool_size,
            run.gate_0_count,
            run.hard_reject_count,
            run.momentum_gate_count,
            run.pre_filter_count,
            run.cli_checked_count,
            run.final_count,
            run.config_snapshot ?? null,
            run.market_context ?? null,
            run.credits_by_step ?? null,
            run.requested_candidate_pool_size ?? null,
            run.actual_candidate_pool_size ?? null,
            run.nansen_page_limit ?? null,
            run.nansen_pagination_used === null || run.nansen_pagination_used === undefined ? null : Boolean(run.nansen_pagination_used),
            run.nansen_fetch_warning ?? null,
            run.created_at,
          ],
        );

        for (const candidate of candidates) {
          await pool.query(
            `INSERT INTO scan_candidates (
              id, scan_id, token_address, symbol, name, candidate_rank, candidate_sources,
              mcap, price, entry_price, age_days, liquidity, volume_24h, market_data_refreshed_at,
              market_data_age_minutes, market_data_source, market_data_warning, raw_dexscreener_snapshot,
              flow_24h, flow_7d, flow_mcap, traders,
              gate_0_status, gate_0_reason, hard_reject_status, hard_reject_reason, risk_flags,
              momentum_score, momentum_gate_status, momentum_gate_reason, fresh_scan_rank_score,
              fresh_scan_rank_components, pre_filter_status, pre_filter_rank, pre_filter_reason,
              cli_candidate_score, why_selected_for_cli, cli_checked, cli_grade, cli_oracle_status,
              cli_reject_reason, final_rank, final_rank_reason, posted, posted_message_id,
              score, signal_type, exclusion_reason, rank_bucket, positive_flags, warning_flags,
              pass_reason_codes, reject_reason_codes, created_at
            ) VALUES (
              $1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb,
              $19,$20,$21,$22,$23,$24,$25,$26,$27::jsonb,$28,$29,$30,$31,$32::jsonb,$33,$34,$35,$36,$37,$38,
              $39,$40,$41,$42,$43,$44,$45,$46,$47,$48,$49,$50::jsonb,$51::jsonb,$52::jsonb,$53::jsonb,$54
            )`,
            [
              `${candidate.scan_id}:${candidate.token_address}:${candidate.candidate_rank}`,
              candidate.scan_id,
              candidate.token_address,
              candidate.symbol,
              candidate.name,
              candidate.candidate_rank,
              candidate.candidate_sources,
              candidate.mcap,
              candidate.price ?? null,
              candidate.entry_price ?? null,
              candidate.age_days,
              candidate.liquidity,
              candidate.volume_24h ?? null,
              candidate.market_data_refreshed_at ?? null,
              candidate.market_data_age_minutes ?? null,
              candidate.market_data_source ?? null,
              candidate.market_data_warning ?? null,
              candidate.raw_dexscreener_snapshot ?? null,
              candidate.flow_24h,
              candidate.flow_7d,
              candidate.flow_mcap,
              candidate.traders,
              candidate.gate_0_status,
              candidate.gate_0_reason,
              candidate.hard_reject_status,
              candidate.hard_reject_reason,
              candidate.risk_flags,
              candidate.momentum_score,
              candidate.momentum_gate_status,
              candidate.momentum_gate_reason,
              candidate.fresh_scan_rank_score,
              candidate.fresh_scan_rank_components,
              candidate.pre_filter_status,
              candidate.pre_filter_rank,
              candidate.pre_filter_reason,
              candidate.cli_candidate_score,
              candidate.why_selected_for_cli,
              Boolean(candidate.cli_checked),
              candidate.cli_grade,
              candidate.cli_oracle_status,
              candidate.cli_reject_reason,
              candidate.final_rank,
              candidate.final_rank_reason,
              Boolean(candidate.posted),
              candidate.posted_message_id,
              candidate.score,
              candidate.signal_type,
              candidate.exclusion_reason,
              candidate.rank_bucket ?? null,
              candidate.positive_flags ?? null,
              candidate.warning_flags ?? null,
              candidate.pass_reason_codes ?? null,
              candidate.reject_reason_codes ?? null,
              candidate.created_at,
            ],
          );
        }

        await pool.query("COMMIT");
      } catch (error) {
        await pool.query("ROLLBACK");
        throw error;
      }
    },
    async savePerformanceSnapshot(snapshot: CandidatePerformanceSnapshotRecord): Promise<void> {
      if (!pool) return;

      await ready;
      await pool.query(
        `INSERT INTO candidate_performance_snapshots (
          id, scan_id, token_address, snapshot_label, snapshot_time, mcap, price,
          liquidity, volume_24h, return_x, created_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          `${snapshot.scan_id}:${snapshot.token_address}:${snapshot.snapshot_label}`,
          snapshot.scan_id,
          snapshot.token_address,
          snapshot.snapshot_label,
          snapshot.snapshot_time,
          snapshot.mcap,
          snapshot.price,
          snapshot.liquidity,
          snapshot.volume_24h,
          snapshot.return_x,
          snapshot.created_at,
        ],
      );
      await pool.query(
        `INSERT INTO candidate_peak_performance (
          id, scan_id, token_address, entry_mcap, peak_mcap, peak_return_x,
          time_to_peak_hours, drawdown_after_peak, best_snapshot_label, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,NULL,$8,$9)
        ON CONFLICT(scan_id, token_address) DO UPDATE SET
          peak_mcap = CASE WHEN excluded.peak_return_x > COALESCE(candidate_peak_performance.peak_return_x, 0)
            THEN excluded.peak_mcap ELSE candidate_peak_performance.peak_mcap END,
          peak_return_x = CASE WHEN excluded.peak_return_x > COALESCE(candidate_peak_performance.peak_return_x, 0)
            THEN excluded.peak_return_x ELSE candidate_peak_performance.peak_return_x END,
          time_to_peak_hours = CASE WHEN excluded.peak_return_x > COALESCE(candidate_peak_performance.peak_return_x, 0)
            THEN excluded.time_to_peak_hours ELSE candidate_peak_performance.time_to_peak_hours END,
          best_snapshot_label = CASE WHEN excluded.peak_return_x > COALESCE(candidate_peak_performance.peak_return_x, 0)
            THEN excluded.best_snapshot_label ELSE candidate_peak_performance.best_snapshot_label END,
          updated_at = excluded.updated_at`,
        [
          `${snapshot.scan_id}:${snapshot.token_address}:peak`,
          snapshot.scan_id,
          snapshot.token_address,
          snapshot.entry_mcap,
          snapshot.mcap,
          snapshot.return_x,
          Number(snapshot.snapshot_label.replace("h", "").replace("d", "")) * (snapshot.snapshot_label.endsWith("d") ? 24 : 1),
          snapshot.snapshot_label,
          snapshot.created_at,
        ],
      );
      await refreshSmartWalletProfilesPostgres(pool);
    },
    async refreshSmartWalletProfiles(): Promise<void> {
      if (!pool) return;

      await ready;
      await refreshSmartWalletProfilesPostgres(pool);
    },
    async close(): Promise<void> {
      await pool?.end();
    },
  };
}

function buildAlertPostgresStore(databaseUrl: string) {
  let pool: { query: (text: string, params?: unknown[]) => Promise<unknown>; end: () => Promise<void> } | null = null;
  let ready: Promise<void> = Promise.resolve();

  try {
    const pg = require("pg") as { Pool: new (config: { connectionString: string }) => { query: (text: string, params?: unknown[]) => Promise<unknown>; end: () => Promise<void> } };

    pool = new pg.Pool({ connectionString: databaseUrl });
    ready = pool.query(`
      CREATE TABLE IF NOT EXISTS alert_runs (
        alert_run_id TEXT PRIMARY KEY,
        started_at TIMESTAMPTZ NOT NULL,
        finished_at TIMESTAMPTZ,
        candidate_pool_size INTEGER,
        nansen_candidate_size INTEGER,
        fresh_scan_db_candidate_size INTEGER,
        watch_candidate_size INTEGER,
        pre_filter_size INTEGER,
        cli_oracle_check_size INTEGER,
        posted_count INTEGER,
        used_credits INTEGER,
        credits_by_step JSONB,
        status TEXT,
        error_message TEXT,
        config_snapshot JSONB,
        market_context JSONB,
        created_at TIMESTAMPTZ NOT NULL
      );
      CREATE TABLE IF NOT EXISTS alert_candidates (
        id TEXT PRIMARY KEY,
        alert_run_id TEXT NOT NULL,
        token_address TEXT NOT NULL,
        symbol TEXT,
        name TEXT,
        candidate_rank INTEGER,
        candidate_source_type TEXT,
        candidate_sources JSONB,
        source_quota_bucket TEXT,
        source_priority INTEGER,
        source_detected_at TIMESTAMPTZ,
        candidate_freshness_minutes DOUBLE PRECISION,
        market_data_refreshed_at TIMESTAMPTZ,
        market_data_age_minutes DOUBLE PRECISION,
        market_data_source TEXT,
        market_data_warning TEXT,
        from_fresh_scan_id TEXT,
        from_scan_candidate_id TEXT,
        from_previous_alert_run_id TEXT,
        from_watch_pick_id TEXT,
        is_reaccelerated BOOLEAN,
        reacceleration_reason TEXT,
        mcap DOUBLE PRECISION,
        price DOUBLE PRECISION,
        age_days DOUBLE PRECISION,
        liquidity DOUBLE PRECISION,
        volume_24h DOUBLE PRECISION,
        flow_1h DOUBLE PRECISION,
        flow_4h DOUBLE PRECISION,
        flow_24h DOUBLE PRECISION,
        flow_7d DOUBLE PRECISION,
        flow_mcap DOUBLE PRECISION,
        traders INTEGER,
        gate_0_status TEXT,
        gate_0_reason TEXT,
        alert_momentum_score DOUBLE PRECISION,
        alert_momentum_components JSONB,
        pre_filter_status TEXT,
        pre_filter_rank INTEGER,
        pre_filter_reason TEXT,
        cli_checked BOOLEAN NOT NULL DEFAULT FALSE,
        cli_grade TEXT,
        cli_oracle_status TEXT,
        raw_cli_summary TEXT,
        raw_nansen_flow_intelligence JSONB,
        raw_nansen_who_bought_sold JSONB,
        raw_nansen_holders JSONB,
        raw_nansen_dex_trades JSONB,
        flow_quality TEXT,
        holder_risk TEXT,
        buyer_seller_balance TEXT,
        sell_pressure TEXT,
        wallet_quality TEXT,
        cluster_risk TEXT,
        smart_wallet_quality_score DOUBLE PRECISION,
        smart_wallet_quality_label TEXT,
        strong_wallet_count INTEGER,
        medium_wallet_count INTEGER,
        weak_wallet_count INTEGER,
        known_wallet_count INTEGER,
        wallet_pdca_summary JSONB,
        auto_tuning_adjustment DOUBLE PRECISION,
        auto_tuning_reasons JSONB,
        auto_tuning_version TEXT,
        quality_gate_grade TEXT,
        quality_gate_reasons JSONB,
        quality_gate_warnings JSONB,
        positive_flags JSONB,
        risk_flags JSONB,
        warning_flags JSONB,
        pass_reason_codes JSONB,
        reject_reason_codes JSONB,
        rank_bucket TEXT,
        final_rank INTEGER,
        posted BOOLEAN NOT NULL DEFAULT FALSE,
        posted_message_id TEXT,
        entry_mcap DOUBLE PRECISION,
        entry_price DOUBLE PRECISION,
        raw_dexscreener_snapshot JSONB,
        created_at TIMESTAMPTZ NOT NULL
      );
      CREATE TABLE IF NOT EXISTS alert_performance_snapshots (
        id TEXT PRIMARY KEY,
        alert_candidate_id TEXT,
        alert_run_id TEXT NOT NULL,
        token_address TEXT NOT NULL,
        snapshot_label TEXT NOT NULL,
        snapshot_time TIMESTAMPTZ NOT NULL,
        mcap DOUBLE PRECISION,
        price DOUBLE PRECISION,
        liquidity DOUBLE PRECISION,
        volume_24h DOUBLE PRECISION,
        return_x DOUBLE PRECISION,
        created_at TIMESTAMPTZ NOT NULL
      );
      CREATE TABLE IF NOT EXISTS alert_peak_performance (
        id TEXT PRIMARY KEY,
        alert_candidate_id TEXT,
        alert_run_id TEXT NOT NULL,
        token_address TEXT NOT NULL,
        entry_mcap DOUBLE PRECISION,
        peak_mcap DOUBLE PRECISION,
        peak_return_x DOUBLE PRECISION,
        time_to_peak_hours DOUBLE PRECISION,
        drawdown_after_peak DOUBLE PRECISION,
        best_snapshot_label TEXT,
        updated_at TIMESTAMPTZ NOT NULL,
        UNIQUE(alert_run_id, token_address)
      );
      CREATE TABLE IF NOT EXISTS alert_pump_notifications (
        notification_id TEXT PRIMARY KEY,
        alert_candidate_id TEXT,
        alert_run_id TEXT NOT NULL,
        token_address TEXT NOT NULL,
        threshold_x DOUBLE PRECISION NOT NULL,
        return_x DOUBLE PRECISION,
        entry_mcap DOUBLE PRECISION,
        peak_mcap DOUBLE PRECISION,
        time_to_peak_hours DOUBLE PRECISION,
        snapshot_label TEXT,
        channel_id TEXT,
        message_id TEXT,
        notified_at TIMESTAMPTZ NOT NULL,
        UNIQUE(alert_candidate_id, threshold_x)
      );
      ALTER TABLE alert_candidates ADD COLUMN IF NOT EXISTS price DOUBLE PRECISION;
      ALTER TABLE alert_candidates ADD COLUMN IF NOT EXISTS volume_24h DOUBLE PRECISION;
      ALTER TABLE alert_candidates ADD COLUMN IF NOT EXISTS market_data_source TEXT;
      ALTER TABLE alert_candidates ADD COLUMN IF NOT EXISTS market_data_warning TEXT;
      ALTER TABLE alert_candidates ADD COLUMN IF NOT EXISTS smart_wallet_quality_score DOUBLE PRECISION;
      ALTER TABLE alert_candidates ADD COLUMN IF NOT EXISTS smart_wallet_quality_label TEXT;
      ALTER TABLE alert_candidates ADD COLUMN IF NOT EXISTS strong_wallet_count INTEGER;
      ALTER TABLE alert_candidates ADD COLUMN IF NOT EXISTS medium_wallet_count INTEGER;
      ALTER TABLE alert_candidates ADD COLUMN IF NOT EXISTS weak_wallet_count INTEGER;
      ALTER TABLE alert_candidates ADD COLUMN IF NOT EXISTS known_wallet_count INTEGER;
      ALTER TABLE alert_candidates ADD COLUMN IF NOT EXISTS wallet_pdca_summary JSONB;
      ALTER TABLE alert_candidates ADD COLUMN IF NOT EXISTS auto_tuning_adjustment DOUBLE PRECISION;
      ALTER TABLE alert_candidates ADD COLUMN IF NOT EXISTS auto_tuning_reasons JSONB;
      ALTER TABLE alert_candidates ADD COLUMN IF NOT EXISTS auto_tuning_version TEXT;
      ALTER TABLE alert_performance_snapshots ADD COLUMN IF NOT EXISTS alert_candidate_id TEXT;
      ALTER TABLE alert_peak_performance ADD COLUMN IF NOT EXISTS alert_candidate_id TEXT;
      ALTER TABLE alert_pump_notifications ADD COLUMN IF NOT EXISTS alert_candidate_id TEXT;
      ALTER TABLE alert_pump_notifications DROP CONSTRAINT IF EXISTS alert_pump_notifications_token_address_threshold_x_key;
      CREATE TABLE IF NOT EXISTS smart_wallet_observations (
        id TEXT PRIMARY KEY,
        wallet_address TEXT NOT NULL,
        token_address TEXT NOT NULL,
        symbol TEXT,
        source_type TEXT NOT NULL,
        alert_run_id TEXT,
        alert_candidate_id TEXT,
        scan_id TEXT,
        scan_candidate_id TEXT,
        observed_at TIMESTAMPTZ NOT NULL,
        side TEXT,
        amount_usd DOUBLE PRECISION,
        token_mcap_at_observation DOUBLE PRECISION,
        token_price_at_observation DOUBLE PRECISION,
        flow_quality TEXT,
        wallet_quality TEXT,
        buyer_seller_balance TEXT,
        sell_pressure TEXT,
        holder_risk TEXT,
        cluster_risk TEXT,
        raw_context JSONB,
        created_at TIMESTAMPTZ NOT NULL
      );
      CREATE TABLE IF NOT EXISTS smart_wallet_profiles (
        wallet_address TEXT PRIMARY KEY,
        observed_tokens_count INTEGER NOT NULL DEFAULT 0,
        observed_alert_tokens_count INTEGER NOT NULL DEFAULT 0,
        avg_return_1h DOUBLE PRECISION,
        avg_return_4h DOUBLE PRECISION,
        avg_return_24h DOUBLE PRECISION,
        avg_peak_return DOUBLE PRECISION,
        hit_2x_count INTEGER NOT NULL DEFAULT 0,
        hit_5x_count INTEGER NOT NULL DEFAULT 0,
        hit_10x_count INTEGER NOT NULL DEFAULT 0,
        early_entry_count INTEGER NOT NULL DEFAULT 0,
        bad_result_count INTEGER NOT NULL DEFAULT 0,
        bot_like_count INTEGER NOT NULL DEFAULT 0,
        high_risk_count INTEGER NOT NULL DEFAULT 0,
        last_seen_at TIMESTAMPTZ,
        last_updated_at TIMESTAMPTZ NOT NULL,
        wallet_quality_score DOUBLE PRECISION NOT NULL DEFAULT 0,
        wallet_quality_label TEXT NOT NULL DEFAULT 'Unknown',
        raw_stats JSONB
      );
      CREATE TABLE IF NOT EXISTS optimization_suggestions (
        suggestion_id TEXT PRIMARY KEY,
        created_at TIMESTAMPTZ NOT NULL,
        target_area TEXT,
        target_key TEXT,
        current_value TEXT,
        suggested_value TEXT,
        reason TEXT,
        evidence_summary TEXT,
        sample_size INTEGER,
        confidence TEXT,
        expected_impact TEXT,
        risk_note TEXT,
        status TEXT,
        linked_experiment_id TEXT
      );
      CREATE TABLE IF NOT EXISTS auto_tuning_results (
        auto_tuning_run_id TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL,
        sample_size INTEGER NOT NULL,
        data_window_hours INTEGER NOT NULL,
        bucket_type TEXT NOT NULL,
        bucket_name TEXT NOT NULL,
        avg_peak_return DOUBLE PRECISION,
        hit_2x_rate DOUBLE PRECISION,
        hit_5x_rate DOUBLE PRECISION,
        bad_result_rate DOUBLE PRECISION,
        best_peak_return DOUBLE PRECISION,
        adjustment DOUBLE PRECISION NOT NULL,
        reason TEXT,
        version TEXT NOT NULL,
        PRIMARY KEY(auto_tuning_run_id, bucket_type, bucket_name)
      );
      CREATE TABLE IF NOT EXISTS optimization_experiments (
        experiment_id TEXT PRIMARY KEY,
        name TEXT,
        target_area TEXT,
        status TEXT,
        created_at TIMESTAMPTZ NOT NULL,
        started_at TIMESTAMPTZ,
        ended_at TIMESTAMPTZ,
        baseline_config_snapshot JSONB,
        experiment_config_snapshot JSONB,
        traffic_split JSONB,
        success_criteria JSONB,
        failure_criteria JSONB,
        sample_size_required INTEGER,
        decision TEXT,
        decision_reason TEXT
      );
      CREATE TABLE IF NOT EXISTS optimization_results (
        result_id TEXT PRIMARY KEY,
        experiment_id TEXT,
        variant TEXT,
        sample_size INTEGER,
        win_rate DOUBLE PRECISION,
        avg_peak_return_x DOUBLE PRECISION,
        median_peak_return_x DOUBLE PRECISION,
        missed_winner_rate DOUBLE PRECISION,
        false_positive_rate DOUBLE PRECISION,
        avg_time_to_peak DOUBLE PRECISION,
        avg_drawdown_after_peak DOUBLE PRECISION,
        used_credits INTEGER,
        cost_per_winner DOUBLE PRECISION,
        evaluated_at TIMESTAMPTZ NOT NULL
      );
      CREATE TABLE IF NOT EXISTS config_versions (
        config_version TEXT PRIMARY KEY,
        created_at TIMESTAMPTZ NOT NULL,
        source TEXT,
        status TEXT,
        config_snapshot JSONB,
        change_summary TEXT,
        promoted_from_experiment_id TEXT,
        rollback_from_version TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_alert_candidates_run_id ON alert_candidates(alert_run_id);
      CREATE INDEX IF NOT EXISTS idx_alert_candidates_token_address ON alert_candidates(token_address);
      CREATE INDEX IF NOT EXISTS idx_alert_candidates_created_at ON alert_candidates(created_at);
      CREATE INDEX IF NOT EXISTS idx_alert_candidates_posted ON alert_candidates(posted);
      CREATE INDEX IF NOT EXISTS idx_alert_snapshots_run_token ON alert_performance_snapshots(alert_run_id, token_address);
      CREATE INDEX IF NOT EXISTS idx_alert_snapshots_candidate_id ON alert_performance_snapshots(alert_candidate_id);
      CREATE INDEX IF NOT EXISTS idx_alert_peak_candidate_id ON alert_peak_performance(alert_candidate_id);
      CREATE INDEX IF NOT EXISTS idx_alert_pump_candidate_id ON alert_pump_notifications(alert_candidate_id);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_alert_pump_candidate_threshold ON alert_pump_notifications(alert_candidate_id, threshold_x);
      CREATE INDEX IF NOT EXISTS idx_auto_tuning_results_version_created ON auto_tuning_results(version, created_at);
      CREATE INDEX IF NOT EXISTS idx_smart_wallet_obs_wallet ON smart_wallet_observations(wallet_address);
      CREATE INDEX IF NOT EXISTS idx_smart_wallet_obs_token ON smart_wallet_observations(token_address);
      CREATE INDEX IF NOT EXISTS idx_smart_wallet_obs_alert_run ON smart_wallet_observations(alert_run_id);
      CREATE INDEX IF NOT EXISTS idx_smart_wallet_obs_scan ON smart_wallet_observations(scan_id);
      CREATE INDEX IF NOT EXISTS idx_smart_wallet_obs_created_at ON smart_wallet_observations(created_at);
    `).then(() => undefined).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "unknown error";

      console.warn(`Postgres Alert schema 初期化に失敗しました。SQLite fallbackを使います: ${message}`);
      pool = null;
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";

    console.warn(`Postgres Alert store を初期化できませんでした。SQLite fallbackを使います: ${message}`);
    pool = null;
  }

  return {
    provider: pool ? "postgres" as FreshScanDbProvider : "sqlite" as FreshScanDbProvider,
    async saveRun(run: AlertRunRecord, candidates: AlertCandidateRecord[]): Promise<void> {
      if (!pool) return;

      await ready;
      await pool.query("BEGIN");
      try {
        await pool.query(
          `INSERT INTO alert_runs (
            alert_run_id, started_at, finished_at, candidate_pool_size, nansen_candidate_size,
            fresh_scan_db_candidate_size, watch_candidate_size, pre_filter_size, cli_oracle_check_size,
            posted_count, used_credits, credits_by_step, status, error_message, config_snapshot,
            market_context, created_at
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14,$15::jsonb,$16::jsonb,$17)`,
          [
            run.alert_run_id,
            run.started_at,
            run.finished_at,
            run.candidate_pool_size,
            run.nansen_candidate_size,
            run.fresh_scan_db_candidate_size,
            run.watch_candidate_size,
            run.pre_filter_size,
            run.cli_oracle_check_size,
            run.posted_count,
            run.used_credits,
            run.credits_by_step,
            run.status,
            run.error_message,
            run.config_snapshot,
            run.market_context,
            run.created_at,
          ],
        );

        const placeholders = alertCandidateColumns.map((column, index) => {
          const jsonbColumns = new Set([
            "candidate_sources",
            "alert_momentum_components",
            "raw_nansen_flow_intelligence",
            "raw_nansen_who_bought_sold",
            "raw_nansen_holders",
            "raw_nansen_dex_trades",
            "wallet_pdca_summary",
            "auto_tuning_reasons",
            "quality_gate_reasons",
            "quality_gate_warnings",
            "positive_flags",
            "risk_flags",
            "warning_flags",
            "pass_reason_codes",
            "reject_reason_codes",
            "raw_dexscreener_snapshot",
          ]);

          return jsonbColumns.has(column) ? `$${index + 2}::jsonb` : `$${index + 2}`;
        });

        for (const candidate of candidates) {
          await pool.query(
            `INSERT INTO alert_candidates (id, ${alertCandidateColumns.join(", ")})
             VALUES ($1, ${placeholders.join(", ")})`,
            [
              `${candidate.alert_run_id}:${candidate.token_address}:${candidate.candidate_rank}`,
              ...alertCandidateColumns.map((column) => candidate[column]),
            ],
          );
        }

        await pool.query("COMMIT");
      } catch (error) {
        await pool.query("ROLLBACK");
        throw error;
      }
    },
    async saveSmartWalletObservations(observations: SmartWalletObservationRecord[]): Promise<void> {
      if (!pool || observations.length === 0) return;

      await ready;
      await pool.query("BEGIN");
      try {
        for (const observation of observations) {
          await pool.query(
            `INSERT INTO smart_wallet_observations (
              id, wallet_address, token_address, symbol, source_type, alert_run_id,
              alert_candidate_id, scan_id, scan_candidate_id, observed_at, side,
              amount_usd, token_mcap_at_observation, token_price_at_observation,
              flow_quality, wallet_quality, buyer_seller_balance, sell_pressure,
              holder_risk, cluster_risk, raw_context, created_at
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21::jsonb,$22)
            ON CONFLICT(id) DO NOTHING`,
            [
              observation.id,
              observation.wallet_address,
              observation.token_address,
              observation.symbol,
              observation.source_type,
              observation.alert_run_id,
              observation.alert_candidate_id,
              observation.scan_id,
              observation.scan_candidate_id,
              observation.observed_at,
              observation.side,
              observation.amount_usd,
              observation.token_mcap_at_observation,
              observation.token_price_at_observation,
              observation.flow_quality,
              observation.wallet_quality,
              observation.buyer_seller_balance,
              observation.sell_pressure,
              observation.holder_risk,
              observation.cluster_risk,
              observation.raw_context,
              observation.created_at,
            ],
          );
        }
        await refreshSmartWalletProfilesPostgres(pool);
        await pool.query("COMMIT");
      } catch (error) {
        await pool.query("ROLLBACK");
        throw error;
      }
    },
    async refreshSmartWalletProfiles(): Promise<void> {
      if (!pool) return;

      await ready;
      await refreshSmartWalletProfilesPostgres(pool);
    },
    async savePerformanceSnapshot(snapshot: AlertSnapshotRecord): Promise<void> {
      if (!pool) return;

      await ready;
      await pool.query(
        `INSERT INTO alert_performance_snapshots (
          id, alert_candidate_id, alert_run_id, token_address, snapshot_label, snapshot_time, mcap, price,
          liquidity, volume_24h, return_x, created_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          `${snapshot.alert_candidate_id ?? `${snapshot.alert_run_id}:${snapshot.token_address}`}:${snapshot.snapshot_label}`,
          snapshot.alert_candidate_id ?? null,
          snapshot.alert_run_id,
          snapshot.token_address,
          snapshot.snapshot_label,
          snapshot.snapshot_time,
          snapshot.mcap,
          snapshot.price,
          snapshot.liquidity,
          snapshot.volume_24h,
          snapshot.return_x,
          snapshot.created_at,
        ],
      );
      await pool.query(
        `INSERT INTO alert_peak_performance (
          id, alert_candidate_id, alert_run_id, token_address, entry_mcap, peak_mcap, peak_return_x,
          time_to_peak_hours, drawdown_after_peak, best_snapshot_label, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NULL,$9,$10)
        ON CONFLICT(alert_run_id, token_address) DO UPDATE SET
          alert_candidate_id = COALESCE(alert_peak_performance.alert_candidate_id, excluded.alert_candidate_id),
          peak_mcap = CASE WHEN excluded.peak_return_x > COALESCE(alert_peak_performance.peak_return_x, 0)
            THEN excluded.peak_mcap ELSE alert_peak_performance.peak_mcap END,
          peak_return_x = CASE WHEN excluded.peak_return_x > COALESCE(alert_peak_performance.peak_return_x, 0)
            THEN excluded.peak_return_x ELSE alert_peak_performance.peak_return_x END,
          time_to_peak_hours = CASE WHEN excluded.peak_return_x > COALESCE(alert_peak_performance.peak_return_x, 0)
            THEN excluded.time_to_peak_hours ELSE alert_peak_performance.time_to_peak_hours END,
          best_snapshot_label = CASE WHEN excluded.peak_return_x > COALESCE(alert_peak_performance.peak_return_x, 0)
            THEN excluded.best_snapshot_label ELSE alert_peak_performance.best_snapshot_label END,
          updated_at = excluded.updated_at`,
        [
          `${snapshot.alert_candidate_id ?? `${snapshot.alert_run_id}:${snapshot.token_address}`}:peak`,
          snapshot.alert_candidate_id ?? null,
          snapshot.alert_run_id,
          snapshot.token_address,
          snapshot.entry_mcap,
          snapshot.mcap,
          snapshot.return_x,
          snapshotLabelToHours(snapshot.snapshot_label),
          snapshot.snapshot_label,
          snapshot.created_at,
        ],
      );
      await refreshSmartWalletProfilesPostgres(pool);
    },
    async close(): Promise<void> {
      await pool?.end();
    },
  };
}

function initDatabase(): SqliteDatabase {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

  const db = new Database(DB_PATH);

  // WALはBot稼働中の読み書きを少し扱いやすくするSQLiteの標準設定です。
  db.pragma("journal_mode = WAL");
  runSchema(db);

  return db;
}

export = {
  DB_PATH,
  buildAlertPostgresStore,
  buildAlertSqliteStore,
  buildFreshScanPostgresStore,
  buildFreshScanSqliteStore,
  initDatabase,
};
