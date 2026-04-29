const fs = require("node:fs") as typeof import("node:fs");
const path = require("node:path") as typeof import("node:path");
const Database = require("better-sqlite3") as typeof import("better-sqlite3");

type SqliteDatabase = import("better-sqlite3").Database;

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
  `);

  // 既存DBにもResearch Cardの元メッセージ情報を後付けします。
  ensureColumn(db, "signals", "signal_type", "TEXT");
  ensureColumn(db, "signals", "message_id", "TEXT");
  ensureColumn(db, "signals", "channel_id", "TEXT");
  ensureColumn(db, "alerts", "quality_gate_grade", "TEXT");
  ensureColumn(db, "alerts", "quality_gate_reasons", "TEXT");
  ensureColumn(db, "alerts", "quality_gate_warnings", "TEXT");
  ensureColumn(db, "alerts", "deep_check_id", "TEXT");
  ensureColumn(db, "deep_checks", "wallet_quality_summary", "TEXT");
  ensureColumn(db, "deep_checks", "wallet_behavior_counts", "TEXT");
  ensureColumn(db, "deep_checks", "estimated_independent_wallets", "INTEGER");
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
  initDatabase,
};
