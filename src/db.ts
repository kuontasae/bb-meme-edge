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
      UNIQUE(token_address, threshold_x)
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

function buildAlertSqliteStore(db: SqliteDatabase) {
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
      id, alert_run_id, token_address, snapshot_label, snapshot_time, mcap, price,
      liquidity, volume_24h, return_x, created_at
    ) VALUES (
      @id, @alert_run_id, @token_address, @snapshot_label, @snapshot_time, @mcap, @price,
      @liquidity, @volume_24h, @return_x, @created_at
    )
  `);
  const upsertPeak = db.prepare(`
    INSERT INTO alert_peak_performance (
      id, alert_run_id, token_address, entry_mcap, peak_mcap, peak_return_x,
      time_to_peak_hours, drawdown_after_peak, best_snapshot_label, updated_at
    ) VALUES (
      @id, @alert_run_id, @token_address, @entry_mcap, @peak_mcap, @peak_return_x,
      @time_to_peak_hours, NULL, @best_snapshot_label, @updated_at
    )
    ON CONFLICT(alert_run_id, token_address) DO UPDATE SET
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
    savePerformanceSnapshot(snapshot: AlertSnapshotRecord): Promise<void> {
      insertSnapshot.run({ id: `${snapshot.alert_run_id}:${snapshot.token_address}:${snapshot.snapshot_label}`, ...snapshot });
      upsertPeak.run({
        id: `${snapshot.alert_run_id}:${snapshot.token_address}:peak`,
        alert_run_id: snapshot.alert_run_id,
        token_address: snapshot.token_address,
        entry_mcap: snapshot.entry_mcap,
        peak_mcap: snapshot.mcap,
        peak_return_x: snapshot.return_x,
        time_to_peak_hours: snapshotLabelToHours(snapshot.snapshot_label),
        best_snapshot_label: snapshot.snapshot_label,
        updated_at: snapshot.created_at,
      });
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
        UNIQUE(token_address, threshold_x)
      );
      ALTER TABLE alert_candidates ADD COLUMN IF NOT EXISTS price DOUBLE PRECISION;
      ALTER TABLE alert_candidates ADD COLUMN IF NOT EXISTS volume_24h DOUBLE PRECISION;
      ALTER TABLE alert_candidates ADD COLUMN IF NOT EXISTS market_data_source TEXT;
      ALTER TABLE alert_candidates ADD COLUMN IF NOT EXISTS market_data_warning TEXT;
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
    async savePerformanceSnapshot(snapshot: AlertSnapshotRecord): Promise<void> {
      if (!pool) return;

      await ready;
      await pool.query(
        `INSERT INTO alert_performance_snapshots (
          id, alert_run_id, token_address, snapshot_label, snapshot_time, mcap, price,
          liquidity, volume_24h, return_x, created_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          `${snapshot.alert_run_id}:${snapshot.token_address}:${snapshot.snapshot_label}`,
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
          id, alert_run_id, token_address, entry_mcap, peak_mcap, peak_return_x,
          time_to_peak_hours, drawdown_after_peak, best_snapshot_label, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,NULL,$8,$9)
        ON CONFLICT(alert_run_id, token_address) DO UPDATE SET
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
          `${snapshot.alert_run_id}:${snapshot.token_address}:peak`,
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
