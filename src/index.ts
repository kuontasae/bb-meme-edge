import type {
  ActionRowBuilder as DiscordActionRowBuilder,
  ButtonBuilder as DiscordButtonBuilder,
  ChatInputCommandInteraction,
  Guild,
  Interaction,
  Message,
} from "discord.js";

require("dotenv/config");

const { execFile } = require("node:child_process") as typeof import("node:child_process");
const { randomUUID } = require("node:crypto") as typeof import("node:crypto");
const { readFile } = require("node:fs/promises") as typeof import("node:fs/promises");
const path = require("node:path") as typeof import("node:path");
const { promisify } = require("node:util") as typeof import("node:util");
const { DB_PATH, initDatabase } = require("./db") as typeof import("./db");

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  EmbedBuilder,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
} = require("discord.js") as typeof import("discord.js");

const execFileAsync = promisify(execFile);
const NANSEN_CACHE_TTL_MS = 5 * 60 * 1000;
const MEME_EDGE_CHANNEL_ID = process.env.MEME_EDGE_CHANNEL_ID;
const SOLANA_NETFLOW_SAMPLE_PATH = path.join(
  process.cwd(),
  "data",
  "solana-netflow-sample.json",
);

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;

if (!token || !clientId) {
  throw new Error(".env に DISCORD_TOKEN と DISCORD_CLIENT_ID を設定してください。");
}

// Discord に登録する Slash Command はここで定義します。
const commands = [
  new SlashCommandBuilder()
    .setName("ping")
    .setDescription("pong と返します")
    .toJSON(),
  new SlashCommandBuilder()
    .setName("desk-test")
    .setDescription("Nansen CLI の smart-money netflow をテストします")
    .toJSON(),
  new SlashCommandBuilder()
    .setName("meme-scan")
    .setDescription("Solana meme候補のResearch Cardを表示します")
    .toJSON(),
  new SlashCommandBuilder()
    .setName("meme-rules")
    .setDescription("Paper Pickのルールを表示します")
    .toJSON(),
  new SlashCommandBuilder()
    .setName("meme-results")
    .setDescription("保存済みのMeme Edge成績を表示します")
    .addStringOption((option) =>
      option
        .setName("period")
        .setDescription("表示する集計期間")
        .setRequired(false)
        .addChoices(
          { name: "latest", value: "latest" },
          { name: "daily", value: "daily" },
          { name: "weekly", value: "weekly" },
          { name: "monthly", value: "monthly" },
        ),
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName("meme-recap")
    .setDescription("Daily / Weekly / Monthly のMeme Edge振り返りを表示します")
    .addStringOption((option) =>
      option
        .setName("period")
        .setDescription("振り返り期間")
        .setRequired(false)
        .addChoices(
          { name: "daily", value: "daily" },
          { name: "weekly", value: "weekly" },
          { name: "monthly", value: "monthly" },
        ),
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName("my-picks")
    .setDescription("自分のPaper Pick履歴を表示します")
    .addStringOption((option) =>
      option
        .setName("period")
        .setDescription("表示する期間")
        .setRequired(false)
        .addChoices(
          { name: "today", value: "today" },
          { name: "weekly", value: "weekly" },
          { name: "monthly", value: "monthly" },
        ),
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName("leaderboard")
    .setDescription("Paper IN / Convictionのコミュニティランキングを表示します")
    .addStringOption((option) =>
      option
        .setName("period")
        .setDescription("集計期間")
        .setRequired(false)
        .addChoices(
          { name: "daily", value: "daily" },
          { name: "weekly", value: "weekly" },
          { name: "monthly", value: "monthly" },
        ),
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName("my-performance")
    .setDescription("自分のPaper Pick成績を表示します")
    .addStringOption((option) =>
      option
        .setName("period")
        .setDescription("集計期間")
        .setRequired(false)
        .addChoices(
          { name: "daily", value: "daily" },
          { name: "weekly", value: "weekly" },
          { name: "monthly", value: "monthly" },
        ),
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName("dev-reset-me")
    .setDescription("開発用: 自分の本日使用ポイントをリセットします")
    .toJSON(),
  new SlashCommandBuilder()
    .setName("dev-post-result")
    .setDescription("開発用: 最新スキャンのResult投稿を指定windowでチャンネルに再投稿します")
    .addStringOption((option) =>
      option
        .setName("window")
        .setDescription("投稿するResult window")
        .setRequired(true)
        .addChoices(
          { name: "1h", value: "1h" },
          { name: "6h", value: "6h" },
          { name: "24h", value: "24h" },
        ),
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName("dev-run-scheduled-scan")
    .setDescription("開発用: 定時スキャンと同じ処理をこのチャンネルで実行します")
    .addStringOption((option) =>
      option
        .setName("label")
        .setDescription("実行するスキャン枠")
        .setRequired(false)
        .addChoices(
          { name: "morning", value: "morning" },
          { name: "eu", value: "eu" },
          { name: "us", value: "us" },
          { name: "manual", value: "manual" },
        ),
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName("dev-run-recap")
    .setDescription("開発用: 定時Recapと同じ処理をこのチャンネルで実行します")
    .addStringOption((option) =>
      option
        .setName("period")
        .setDescription("実行するRecap期間")
        .setRequired(true)
        .addChoices(
          { name: "daily", value: "daily" },
          { name: "weekly", value: "weekly" },
          { name: "monthly", value: "monthly" },
        ),
    )
    .toJSON(),
];

type NetflowRow = {
  token_address?: unknown;
  token_symbol?: unknown;
  token_name?: unknown;
  name?: unknown;
  price_usd?: unknown;
  token_price_usd?: unknown;
  net_flow_24h_usd?: unknown;
  net_flow_7d_usd?: unknown;
  trader_count?: unknown;
  market_cap_usd?: unknown;
  token_age_days?: unknown;
  token_age?: unknown;
  token_sectors?: unknown;
  token_icon_url?: unknown;
  token_image_url?: unknown;
  icon_url?: unknown;
  image_url?: unknown;
  image?: unknown;
  logo_url?: unknown;
  logoURI?: unknown;
  metadata?: unknown;
  token_metadata?: unknown;
};

type NansenDataSource = "mock" | "cache" | "live";
type NansenFetchMode = "mock" | "live";
type MemeStatus = "🟢 Strong Edge" | "🟡 Watch" | "🟠 High-risk Speculative" | "🔴 Weak";

type CachedNansenResult = {
  rows: NetflowRow[];
  mode: NansenFetchMode;
  expiresAt: number;
};

type ScoreBreakdown = {
  flowMcap: number;
  smartMoney: number;
  earlyness: number;
  traderConfirmation: number;
  riskAdjustment: number;
  riskLabel: "Low" | "Medium" | "High";
};

type MemeResearchCard = {
  signalId: string;
  scanId: string;
  tokenAddress: string;
  symbol: string;
  name: string;
  narrative: string;
  edgeScore: number;
  status: MemeStatus;
  scoreBreakdown: string;
  summary: string;
  scanTime: string;
  marketCap: number | null;
  price: number | null;
  flow24h: number | null;
  flow7d: number | null;
  flowMcapRatio: number | null;
  traderCount: number | null;
  tokenAge: string;
  whyFlagged: string;
  risk: string;
  tokenIconUrl: string | null;
  dexscreenerUrl: string;
  gmgnUrl: string;
  universalxUrl: string;
  nansenUrl: string;
};

type DexScreenerTokenPair = {
  info?: {
    imageUrl?: unknown;
  };
  baseToken?: {
    address?: unknown;
    symbol?: unknown;
    name?: unknown;
  };
  liquidity?: {
    usd?: unknown;
  };
  marketCap?: unknown;
  fdv?: unknown;
  priceUsd?: unknown;
};

type DexScreenerTokenResponse = {
  pairs?: DexScreenerTokenPair[] | null;
};

type MemeScanReply = {
  content?: string;
  embeds: [InstanceType<typeof EmbedBuilder>];
  components?: Array<DiscordActionRowBuilder<DiscordButtonBuilder>>;
};

type PickAction = "watch" | "paper_in" | "conviction";
type MemeResultsPeriod = "latest" | "daily" | "weekly" | "monthly";
type MemeRecapPeriod = "daily" | "weekly" | "monthly";
type MemeScanLabel = "Morning Scan" | "EU Open Scan" | "US Prime Scan" | "Manual Scan";
type DevScanLabelChoice = "morning" | "eu" | "us" | "manual";
type ResultWindow = "1h" | "6h" | "24h";
type SnapshotWindow = MemeResultsPeriod | ResultWindow;
type MyPicksPeriod = "today" | "weekly" | "monthly";
type PerformancePeriod = "daily" | "weekly" | "monthly";

type SignalRecord = {
  signal_id: string;
  token_address: string;
  symbol: string | null;
  scan_mcap: number | null;
  scan_price: number | null;
  message_id: string | null;
  channel_id: string | null;
};

type ResultSignalRecord = SignalRecord & {
  scan_id: string;
  name: string | null;
  narrative: string | null;
  edge_score: number | null;
  status: string | null;
  scan_time: string | null;
  flow_24h: number | null;
  flow_7d: number | null;
  flow_mcap_ratio: number | null;
  trader_count: number | null;
  token_age: string | null;
};

type ScanRecord = {
  scan_id: string;
  channel_id: string;
  guild_id: string | null;
  scan_time: string;
  source: string | null;
  result_1h_posted: number;
  result_6h_posted: number;
  result_24h_posted: number;
};

type UserRecord = {
  user_id: string;
  has_seen_guide: number;
  daily_points_used: number;
  last_reset_date: string | null;
};

type UserPickRecord = {
  pick_id: string;
  signal_id: string;
  user_id: string;
  action: string;
  used_points: number;
  clicked_at: string;
  entry_mcap: number | null;
  entry_price: number | null;
};

type UserPickWithSignalRecord = UserPickRecord & {
  token_address: string;
  symbol: string | null;
  scan_id: string;
  scan_time: string | null;
  scan_mcap: number | null;
  scan_price: number | null;
};

type DexScreenerMarketData = {
  marketCap: number | null;
  price: number | null;
};

type SignalPerformance = {
  signal: ResultSignalRecord;
  currentMcap: number | null;
  currentPrice: number | null;
  botReturnX: number | null;
  paperInAvg: number | null;
  convictionAvg: number | null;
  userPickReturns: UserPickReturn[];
};

type PickPerformance = UserPickWithSignalRecord & {
  normalizedAction: PickAction;
  currentMcap: number | null;
  returnX: number | null;
  pickScore: number | null;
};

type BestPerformancePick = {
  symbol: string | null;
  tokenAddress: string;
  returnX: number;
  pickScore: number;
};

type UserPerformance = {
  userId: string;
  totalScore: number;
  totalUsedPoints: number;
  totalReturnValue: number;
  roi: number | null;
  bestPick: BestPerformancePick | null;
  averageReturn: number | null;
  hitRate: number | null;
  convictionCount: number;
  paperInCount: number;
  watchCount: number;
  scorePickCount: number;
  recentPicks: PickPerformance[];
};

type UserPickReturn = {
  userId: string;
  action: Extract<PickAction, "paper_in" | "conviction">;
  signal: ResultSignalRecord;
  returnX: number;
  usedPoints: number;
  clickedAt: string;
};

type MemeResultsReply = {
  content?: string;
  embeds?: Array<InstanceType<typeof EmbedBuilder>>;
};

type MemeRecapSummary = {
  botSummary: string;
  communitySummary: string;
  leaderboardSummary: string;
  narrativeSummary: string;
  nansenSignalReview: string;
  nextAdjustment: string;
};

type MemeScanResult = {
  replies: MemeScanReply[];
  scanId: string;
  scanTime: string;
  source: NansenDataSource;
  signalIds: string[];
};

type SendableChannel = {
  id?: string;
  guildId?: string | null;
  send(options: {
    content?: string;
    embeds?: Array<InstanceType<typeof EmbedBuilder>>;
    components?: Array<DiscordActionRowBuilder<DiscordButtonBuilder>>;
  }): Promise<Message>;
};

type MemeScanPostContext = {
  channelId: string;
  guildId: string | null;
  sendFirst(reply: MemeScanReply): Promise<Message>;
  sendNext(reply: MemeScanReply): Promise<Message>;
};

let cachedNansenResult: CachedNansenResult | undefined;
const db = initDatabase();
const insertSignal = db.prepare(`
  INSERT INTO signals (
    signal_id,
    scan_id,
    token_address,
    symbol,
    name,
    chain,
    narrative,
    edge_score,
    status,
    score_breakdown,
    scan_time,
    scan_mcap,
    scan_price,
    flow_24h,
    flow_7d,
    flow_mcap_ratio,
    trader_count,
    token_age,
    why_flagged,
    risk,
    dexscreener_url,
    gmgn_url,
    universalx_url,
    nansen_url,
    message_id,
    channel_id
  ) VALUES (
    @signalId,
    @scanId,
    @tokenAddress,
    @symbol,
    @name,
    'solana',
    @narrative,
    @edgeScore,
    @status,
    @scoreBreakdown,
    @scanTime,
    @marketCap,
    @price,
    @flow24h,
    @flow7d,
    @flowMcapRatio,
    @traderCount,
    @tokenAge,
    @whyFlagged,
    @risk,
    @dexscreenerUrl,
    @gmgnUrl,
    @universalxUrl,
    @nansenUrl,
    NULL,
    NULL
  )
`);
const upsertScan = db.prepare(`
  INSERT INTO scans (
    scan_id,
    channel_id,
    guild_id,
    scan_time,
    source
  ) VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(scan_id) DO UPDATE SET
    channel_id = excluded.channel_id,
    guild_id = excluded.guild_id,
    scan_time = excluded.scan_time,
    source = excluded.source
`);
const getScanById = db.prepare(`
  SELECT
    scan_id,
    channel_id,
    guild_id,
    scan_time,
    source,
    result_1h_posted,
    result_6h_posted,
    result_24h_posted
  FROM scans
  WHERE scan_id = ?
`);
const getLatestScan = db.prepare(`
  SELECT
    scan_id,
    channel_id,
    guild_id,
    scan_time,
    source,
    result_1h_posted,
    result_6h_posted,
    result_24h_posted
  FROM scans
  ORDER BY scan_time DESC
  LIMIT 1
`);
const markScanResultPosted = db.prepare(`
  UPDATE scans
  SET result_1h_posted = CASE WHEN ? = '1h' THEN 1 ELSE result_1h_posted END,
      result_6h_posted = CASE WHEN ? = '6h' THEN 1 ELSE result_6h_posted END,
      result_24h_posted = CASE WHEN ? = '24h' THEN 1 ELSE result_24h_posted END
  WHERE scan_id = ?
`);
const getSignalById = db.prepare(`
  SELECT signal_id, token_address, symbol, scan_mcap, scan_price, message_id, channel_id
  FROM signals
  WHERE signal_id = ?
`);
const updateSignalMessage = db.prepare(`
  UPDATE signals
  SET message_id = ?, channel_id = ?
  WHERE signal_id = ?
`);
const getUserById = db.prepare(`
  SELECT user_id, has_seen_guide, daily_points_used, last_reset_date
  FROM users
  WHERE user_id = ?
`);
const insertUser = db.prepare(`
  INSERT INTO users (user_id, first_seen_at, has_seen_guide, daily_points_used, last_reset_date)
  VALUES (?, ?, 0, 0, ?)
`);
const updateUserDailyBudget = db.prepare(`
  UPDATE users
  SET daily_points_used = ?, last_reset_date = ?
  WHERE user_id = ?
`);
const markUserGuideSeen = db.prepare(`
  UPDATE users
  SET has_seen_guide = 1
  WHERE user_id = ?
`);
const getUserPickForSignal = db.prepare(`
  SELECT pick_id, signal_id, user_id, action, used_points, clicked_at, entry_mcap, entry_price
  FROM user_picks
  WHERE user_id = ? AND signal_id = ?
  ORDER BY clicked_at DESC
  LIMIT 1
`);
const getUserPicks = db.prepare(`
  SELECT pick_id, signal_id, user_id, action, used_points, clicked_at, entry_mcap, entry_price
  FROM user_picks
  WHERE user_id = ?
`);
const deleteUserPicksBetween = db.prepare(`
  DELETE FROM user_picks
  WHERE user_id = ? AND clicked_at >= ? AND clicked_at < ?
`);
const insertUserPick = db.prepare(`
  INSERT INTO user_picks (
    pick_id,
    signal_id,
    user_id,
    action,
    used_points,
    clicked_at,
    entry_mcap,
    entry_price
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);
const updateUserPick = db.prepare(`
  UPDATE user_picks
  SET action = ?,
      used_points = ?,
      clicked_at = ?,
      entry_mcap = ?,
      entry_price = ?
  WHERE pick_id = ?
`);
const getLatestScanId = db.prepare(`
  SELECT scan_id
  FROM signals
  WHERE scan_id IS NOT NULL
  ORDER BY scan_time DESC
  LIMIT 1
`);
const getSignalsByScanId = db.prepare(`
  SELECT
    signal_id,
    scan_id,
    token_address,
    symbol,
    name,
    narrative,
    edge_score,
    status,
    scan_time,
    scan_mcap,
    scan_price,
    flow_24h,
    flow_7d,
    flow_mcap_ratio,
    trader_count,
    token_age,
    message_id,
    channel_id
  FROM signals
  WHERE scan_id = ?
  ORDER BY edge_score DESC
`);
const getSignalsSince = db.prepare(`
  SELECT signal_id, scan_id, token_address, symbol, name, narrative, edge_score, status, scan_time, scan_mcap, scan_price, flow_24h, flow_7d, flow_mcap_ratio, trader_count, token_age, message_id, channel_id
  FROM signals
  WHERE scan_time >= ?
  ORDER BY scan_time DESC, edge_score DESC
`);
const getSignalsBetween = db.prepare(`
  SELECT signal_id, scan_id, token_address, symbol, name, narrative, edge_score, status, scan_time, scan_mcap, scan_price, flow_24h, flow_7d, flow_mcap_ratio, trader_count, token_age, message_id, channel_id
  FROM signals
  WHERE scan_time >= ? AND scan_time < ?
  ORDER BY scan_time DESC, edge_score DESC
`);
const getResultPicksForSignal = db.prepare(`
  SELECT pick_id, signal_id, user_id, action, used_points, clicked_at, entry_mcap, entry_price
  FROM user_picks
  WHERE signal_id = ?
`);
const getUserPicksSince = db.prepare(`
  SELECT
    user_picks.pick_id,
    user_picks.signal_id,
    user_picks.user_id,
    user_picks.action,
    user_picks.used_points,
    user_picks.clicked_at,
    user_picks.entry_mcap,
    user_picks.entry_price,
    signals.token_address,
    signals.symbol,
    signals.scan_id,
    signals.scan_time,
    signals.scan_mcap,
    signals.scan_price
  FROM user_picks
  INNER JOIN signals ON signals.signal_id = user_picks.signal_id
  WHERE user_picks.user_id = ? AND user_picks.clicked_at >= ?
  ORDER BY user_picks.clicked_at DESC
`);
const getUserPicksBetween = db.prepare(`
  SELECT
    user_picks.pick_id,
    user_picks.signal_id,
    user_picks.user_id,
    user_picks.action,
    user_picks.used_points,
    user_picks.clicked_at,
    user_picks.entry_mcap,
    user_picks.entry_price,
    signals.token_address,
    signals.symbol,
    signals.scan_id,
    signals.scan_time,
    signals.scan_mcap,
    signals.scan_price
  FROM user_picks
  INNER JOIN signals ON signals.signal_id = user_picks.signal_id
  WHERE user_picks.user_id = ? AND user_picks.clicked_at >= ? AND user_picks.clicked_at < ?
  ORDER BY user_picks.clicked_at DESC
`);
const getAllUserPicksBetween = db.prepare(`
  SELECT
    user_picks.pick_id,
    user_picks.signal_id,
    user_picks.user_id,
    user_picks.action,
    user_picks.used_points,
    user_picks.clicked_at,
    user_picks.entry_mcap,
    user_picks.entry_price,
    signals.token_address,
    signals.symbol,
    signals.scan_id,
    signals.scan_time,
    signals.scan_mcap,
    signals.scan_price
  FROM user_picks
  INNER JOIN signals ON signals.signal_id = user_picks.signal_id
  WHERE user_picks.clicked_at >= ? AND user_picks.clicked_at < ?
  ORDER BY user_picks.clicked_at DESC
`);
const insertPerformanceSnapshot = db.prepare(`
  INSERT INTO performance_snapshots (
    snapshot_id,
    signal_id,
    window,
    snapshot_time,
    current_mcap,
    current_price,
    max_mcap,
    bot_return_x
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);
const insertRecap = db.prepare(`
  INSERT INTO recaps (
    recap_id,
    period,
    start_time,
    end_time,
    bot_summary,
    community_summary,
    narrative_summary,
    nansen_signal_review,
    created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

function findNetflowRows(value: unknown): NetflowRow[] {
  if (Array.isArray(value)) {
    return value as NetflowRow[];
  }

  if (!value || typeof value !== "object") {
    return [];
  }

  const record = value as Record<string, unknown>;

  // Nansen CLI の実際の形:
  // { success: true, data: { data: [...] } }
  const nestedData = record.data;

  if (Array.isArray(nestedData)) {
    return nestedData as NetflowRow[];
  }

  if (nestedData && typeof nestedData === "object") {
    const nestedRecord = nestedData as Record<string, unknown>;

    if (Array.isArray(nestedRecord.data)) {
      return nestedRecord.data as NetflowRow[];
    }

    if (Array.isArray(nestedRecord.results)) {
      return nestedRecord.results as NetflowRow[];
    }

    if (Array.isArray(nestedRecord.items)) {
      return nestedRecord.items as NetflowRow[];
    }

    if (Array.isArray(nestedRecord.rows)) {
      return nestedRecord.rows as NetflowRow[];
    }
  }

  for (const key of ["results", "items", "rows"]) {
    const rows = record[key];

    if (Array.isArray(rows)) {
      return rows as NetflowRow[];
    }
  }

  return [];
}

function formatCompactUsd(value: unknown): string {
  if (value === null || value === undefined) {
    return "N/A";
  }

  const numberValue = Number(value);

  if (!Number.isFinite(numberValue)) {
    return "N/A";
  }

  const absValue = Math.abs(numberValue);
  const formatScaled = (divisor: number, suffix: "K" | "M" | "B"): string => {
    const scaled = numberValue / divisor;
    // Kは短く、M/Bは比較しやすいよう2桁で揃えます。
    const fractionDigits = suffix === "K" ? 1 : 2;
    const text = scaled.toFixed(fractionDigits);

    return `$${text}${suffix}`;
  };

  if (absValue >= 1_000_000_000) {
    return formatScaled(1_000_000_000, "B");
  }

  if (absValue >= 1_000_000) {
    return formatScaled(1_000_000, "M");
  }

  if (absValue >= 1_000) {
    return formatScaled(1_000, "K");
  }

  return `$${Math.round(numberValue).toLocaleString("en-US")}`;
}

function formatReturnX(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return "N/A";
  }

  return `${value.toFixed(2)}x`;
}

function formatScore(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return "N/A";
  }

  const rounded = Math.round(value * 10) / 10;
  const text = Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1);

  return `${rounded > 0 ? "+" : ""}${text} pts`;
}

function formatHitRate(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return "N/A";
  }

  return `${Math.round(value * 100)}%`;
}

function getJstDateString(date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function getJstDayRangeIso(date = new Date()): { startIso: string; endIso: string; label: string } {
  const label = getJstDateString(date);
  const start = new Date(`${label}T00:00:00+09:00`);
  const end = new Date(start);

  // JSTの「今日」をSQLで扱いやすいUTC ISO範囲に変換します。
  end.setUTCDate(end.getUTCDate() + 1);

  return {
    startIso: start.toISOString(),
    endIso: end.toISOString(),
    label,
  };
}

function addUtcDays(date: Date, days: number): Date {
  const next = new Date(date);

  next.setUTCDate(next.getUTCDate() + days);

  return next;
}

function getJstStartOfDay(date = new Date()): Date {
  return new Date(`${getJstDateString(date)}T00:00:00+09:00`);
}

function getPeriodRange(
  period: PerformancePeriod,
  now = new Date(),
): { startIso: string; endIso: string } {
  const todayStart = getJstStartOfDay(now);

  // 集計期間はDiscord利用者に合わせてJSTで切ります。
  if (period === "daily") {
    return {
      startIso: todayStart.toISOString(),
      endIso: addUtcDays(todayStart, 1).toISOString(),
    };
  }

  if (period === "weekly") {
    const dayIndexByName: Record<string, number> = {
      Sun: 0,
      Mon: 1,
      Tue: 2,
      Wed: 3,
      Thu: 4,
      Fri: 5,
      Sat: 6,
    };
    const weekdayName = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Tokyo",
      weekday: "short",
    }).format(now);
    const daysSinceMonday = (dayIndexByName[weekdayName] ?? 0) === 0
      ? 6
      : (dayIndexByName[weekdayName] ?? 1) - 1;
    const start = addUtcDays(todayStart, -daysSinceMonday);

    return {
      startIso: start.toISOString(),
      endIso: addUtcDays(start, 7).toISOString(),
    };
  }

  const monthLabel = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
  }).format(now);
  const start = new Date(`${monthLabel}-01T00:00:00+09:00`);
  const end = new Date(start);

  end.setUTCMonth(end.getUTCMonth() + 1);

  return {
    startIso: start.toISOString(),
    endIso: end.toISOString(),
  };
}

function isSameJstDate(isoText: string, jstDate: string): boolean {
  const date = new Date(isoText);

  if (Number.isNaN(date.getTime())) {
    return false;
  }

  return getJstDateString(date) === jstDate;
}

function pointsForAction(action: PickAction): number {
  if (action === "conviction") {
    return 3;
  }

  if (action === "paper_in") {
    return 1;
  }

  return 0;
}

function formatPickActionTitle(action: PickAction): string {
  if (action === "conviction") {
    return "🔥 Convictionを記録しました";
  }

  if (action === "paper_in") {
    return "🧪 Paper INを記録しました";
  }

  return "👀 Watchを記録しました";
}

function normalizeDailyBudget(user: UserRecord, todayJst: string): UserRecord {
  if (user.last_reset_date === todayJst) {
    return user;
  }

  // JSTの日付が変わったら、その日のPaper Budgetを新しくします。
  updateUserDailyBudget.run(0, todayJst, user.user_id);

  return {
    ...user,
    daily_points_used: 0,
    last_reset_date: todayJst,
  };
}

function formatCount(value: unknown): string {
  if (value === null || value === undefined) {
    return "-";
  }

  const numberValue = Number(value);

  if (!Number.isFinite(numberValue)) {
    return "-";
  }

  return new Intl.NumberFormat("ja-JP").format(numberValue);
}

function toFiniteNumber(value: unknown): number | null {
  const numberValue = Number(value);

  return Number.isFinite(numberValue) ? numberValue : null;
}

function toDisplayText(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

function toOptionalText(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function normalizeAction(value: unknown): PickAction | null {
  if (typeof value !== "string") {
    return null;
  }

  // 古いDBに表示名やemoji付きの値が残っていても、内部値に寄せて扱います。
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, "_")
    .replace(/^_+|_+$/g, "");

  if (normalized === "watch") {
    return "watch";
  }

  if (normalized === "paper_in" || normalized === "paper") {
    return "paper_in";
  }

  if (normalized === "conviction") {
    return "conviction";
  }

  return null;
}

function actionLabel(action: PickAction): string {
  if (action === "conviction") {
    return "🔥 Conviction";
  }

  if (action === "paper_in") {
    return "🧪 Paper IN";
  }

  return "👀 Watch";
}

function actionPlainLabel(action: PickAction): string {
  if (action === "conviction") {
    return "Conviction";
  }

  if (action === "paper_in") {
    return "Paper IN";
  }

  return "Watch";
}

function getNestedRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isValidHttpImageUrl(value: string | null): value is string {
  if (!value) {
    return false;
  }

  try {
    const url = new URL(value);

    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function formatPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return "N/A";
  }

  return `${(value * 100).toFixed(2)}%`;
}

function formatAge(row: NetflowRow): string {
  const ageDays = toFiniteNumber(row.token_age_days);

  if (ageDays !== null) {
    return `${Math.round(ageDays)}日`;
  }

  return toDisplayText(row.token_age, "不明");
}

function formatDeskTestMessage(rows: NetflowRow[], source: NansenDataSource): string {
  const topRows = rows.slice(0, 5);

  if (topRows.length === 0) {
    throw new Error("Nansen CLI のJSONに表示できるデータがありません。");
  }

  const lines = topRows.map((row, index) => {
    const symbol = typeof row.token_symbol === "string" ? row.token_symbol : "UNKNOWN";

    return [
      `${index + 1}. ${symbol}`,
      `24時間: ${formatCompactUsd(row.net_flow_24h_usd)}`,
      `7日: ${formatCompactUsd(row.net_flow_7d_usd)}`,
      `トレーダー: ${formatCount(row.trader_count)}人`,
      `時価総額: ${formatCompactUsd(row.market_cap_usd)}`,
    ].join(" | ");
  });

  return ["Nansen Smart Money Netflow Top5（Solana）", ...lines, `Data source: ${source}`].join("\n");
}

function scoreFlowMcap(flowMcapRatio: number | null): number {
  if (flowMcapRatio === null || flowMcapRatio <= 0) {
    return 0;
  }

  return Math.min(30, Math.round((flowMcapRatio / 0.02) * 30));
}

function scoreSmartMoney(flow24h: number | null, flow7d: number | null): number {
  const positiveFlow24h = Math.max(flow24h ?? 0, 0);
  const flow24hScore = Math.min(18, Math.round((Math.log10(positiveFlow24h + 1) / 5) * 18));
  const flow7dScore = (flow7d ?? 0) > 0 ? 7 : (flow7d ?? 0) > -10_000 ? 3 : 0;

  return flow24hScore + flow7dScore;
}

function scoreEarlyness(ageDays: number | null): number {
  if (ageDays === null) {
    return 8;
  }

  if (ageDays <= 3) {
    return 20;
  }

  if (ageDays <= 7) {
    return 18;
  }

  if (ageDays <= 30) {
    return 16;
  }

  if (ageDays <= 90) {
    return 10;
  }

  if (ageDays <= 180) {
    return 6;
  }

  return 3;
}

function scoreTraderConfirmation(traderCount: number | null): number {
  if (traderCount === null) {
    return 5;
  }

  if (traderCount >= 50) {
    return 15;
  }

  if (traderCount >= 25) {
    return 12;
  }

  if (traderCount >= 10) {
    return 8;
  }

  if (traderCount >= 5) {
    return 5;
  }

  return 2;
}

function scoreRiskAdjustment(
  marketCap: number | null,
  flow7d: number | null,
  traderCount: number | null,
  ageDays: number | null,
): number {
  let score = 10;

  if (marketCap !== null && marketCap < 500_000) {
    score -= 3;
  }

  if (traderCount !== null && traderCount < 10) {
    score -= 3;
  }

  if ((flow7d ?? 0) < 0) {
    score -= 3;
  }

  if (ageDays !== null && ageDays <= 2) {
    score -= 1;
  }

  return Math.max(0, score);
}

function riskLabelFromScore(riskAdjustment: number): ScoreBreakdown["riskLabel"] {
  if (riskAdjustment >= 8) {
    return "Low";
  }

  if (riskAdjustment >= 5) {
    return "Medium";
  }

  return "High";
}

function getStatus(edgeScore: number): MemeStatus {
  if (edgeScore >= 80) {
    return "🟢 Strong Edge";
  }

  if (edgeScore >= 65) {
    return "🟡 Watch";
  }

  if (edgeScore >= 50) {
    return "🟠 High-risk Speculative";
  }

  return "🔴 Weak";
}

function buildNarrative(row: NetflowRow, symbol: string, name: string): string {
  const sectors = Array.isArray(row.token_sectors)
    ? row.token_sectors.filter((sector): sector is string => typeof sector === "string")
    : [];
  const rawText = [symbol, name, ...sectors].join(" ");
  const text = rawText.toLowerCase();
  const sectorText = sectors.length > 0 ? sectors.join(" / ") : "セクター未分類";
  const displayName = `${symbol} / ${name}`;

  // 名前やsymbolから読めるモチーフを優先し、一般論だけにならないようにします。
  if (/\bscam\b|rug|fraud|詐欺/i.test(rawText)) {
    return `${displayName} は「SCAM」や詐欺ワードをあえて前面に出すブラックユーモア系ミーム候補です。ネガティブな言葉を逆張りでネタ化し、危うさそのものを話題にして拡散を狙う文脈があります。短期勢は「言葉の強さ」とSNSでのいじりやすさに期待して買う可能性があります。`;
  }

  if (/asteroid|meteor|space|moon|mars|cosmo|宇宙|月|惑星/i.test(rawText)) {
    return `${displayName} は宇宙・SFモチーフのミーム候補です。ASTEROIDのような名前は隕石、月面、宇宙船などのビジュアル文脈と相性がよく、見た目で拡散されるタイプに寄せやすいです。買い手は「宇宙へ飛ぶ」系の価格上昇メタファーや、画像映えするテーマ性に期待している可能性があります。`;
  }

  if (/maga|trump|biden|politic|president|election|america|usa|政治|選挙/i.test(rawText)) {
    return `${displayName} は政治・選挙ネタをミーム化した候補です。特にMAGAやTrump系の言葉は支持、反発、皮肉のどれでも会話量を作りやすく、ニュースや選挙イベントに反応して物色される文脈があります。短期勢は政治ニュースに連動したSNS拡散と回転売買を期待して買う可能性があります。`;
  }

  if (/belief|faith|god|jesus|church|pray|religion|信念|信仰|神/i.test(rawText)) {
    return `${displayName} は「信念」「信仰」「祈り」のような精神性をネタにしたミーム候補です。BELIEFのような抽象ワードは、コミュニティが合言葉として使いやすく、ホルダーの結束やストーリー作りに向いています。買い手は価格だけでなく「信じる」文脈の一体感が広がることに期待している可能性があります。`;
  }

  if (/henry|nikita|bier|founder|ceo|elon|vitalik|人物|創業者/i.test(rawText)) {
    return `${displayName} は人物名やインフルエンサー文脈を使ったキャラクター系ミーム候補です。実在人物、創業者、界隈の有名人を連想させる名前は、内輪ネタや引用ポストで広がりやすい特徴があります。買い手はその人物ネタがSolanaミーム界隈で再利用されることを期待している可能性があります。`;
  }

  if (/\bai\b|agent|bot|gpt|robot|人工知能/i.test(rawText)) {
    return `${displayName} はAIやagentブームに寄せたミーム候補です。単なるAI系というより、bot、agent、自動化への期待をミーム化し、テック銘柄の熱量を低時価総額トークンに移した文脈と見られます。買い手はAIテーマへの回転物色と、名前の分かりやすさによる短期拡散を期待している可能性があります。`;
  }

  if (/dog|cat|frog|pepe|inu|shib|wif|犬|猫|カエル/i.test(rawText)) {
    return `${displayName} は動物・キャラクターを前面にしたミーム候補です。犬猫やPepe系の名前は、画像、スタンプ、短いキャッチコピーに落とし込みやすく、コミュニティが二次創作で広げやすい文脈があります。買い手はキャラの覚えやすさとSolana上の動物ミーム循環に期待している可能性があります。`;
  }

  if (/unc\b|uncle|unicorn|uni/i.test(text)) {
    return `${displayName} は短いtickerの語感で押すタイプのミーム候補です。UNCは略称として解釈の余地があり、コミュニティ側が後から意味付けやキャラクターを足していく余白があります。買い手は低い説明コスト、短いsymbolの覚えやすさ、Smart Money流入をきっかけにした初動形成に期待している可能性があります。`;
  }

  if (/meme|memecoin|memecoins/i.test(rawText)) {
    return `${displayName} は${sectorText}に分類されるSolanaミーム候補です。名前やsymbolの具体的な元ネタはまだ限定しにくいものの、ミームセクター内で回転資金が向かった銘柄として検出されています。買い手は明確なファンダより、初動のフロー、tickerの覚えやすさ、コミュニティの後付けストーリーに期待している可能性があります。`;
  }

  return `${displayName} は${sectorText}周辺で拾われた、名前先行のミーム候補です。symbolとnameからは強いジャンル断定はしにくい一方、短い名前や抽象ワードはコミュニティが後から意味付けしやすい余白があります。買い手はSmart Money flowを初動サインとして見て、テーマ化される前の早い段階に期待している可能性があります。`;
}

function buildWhyFlagged(
  marketCap: number | null,
  flow24h: number | null,
  flow7d: number | null,
  flowMcapRatio: number | null,
  traderCount: number | null,
  ageDays: number | null,
): string {
  const reasons: string[] = [];

  if (flowMcapRatio !== null && flowMcapRatio > 0.002) {
    reasons.push(`Flow/MCap ${formatPercent(flowMcapRatio)}: MCapに対して流入インパクトが大きい`);
  }

  if ((flow24h ?? 0) > 0) {
    reasons.push(`24h Flow ${formatCompactUsd(flow24h)}: 直近でSmart Moneyが流入`);
  }

  if ((flow7d ?? 0) > 0) {
    reasons.push(`7d Flow ${formatCompactUsd(flow7d)}: 短期だけでなく週次でもプラス`);
  }

  if (ageDays !== null && ageDays <= 30) {
    reasons.push(`Age ${Math.round(ageDays)}日: まだ初動として見られやすい`);
  }

  if ((traderCount ?? 0) >= 10) {
    reasons.push(`Traders ${formatCount(traderCount)}人: 単独walletではなく参加者が一定数いる`);
  }

  if (marketCap !== null && marketCap < 5_000_000) {
    reasons.push(`MCap ${formatCompactUsd(marketCap)}: 小型でflowが価格に反映されやすい`);
  }

  return reasons.length > 0
    ? reasons.map((reason) => `- ${reason}`).join("\n")
    : "- Smart Money netflow Top5として検出";
}

function buildRisk(
  marketCap: number | null,
  flow7d: number | null,
  traderCount: number | null,
): string {
  const risks: string[] = [];

  if (marketCap === null || marketCap < 1_000_000) {
    risks.push("超小型でボラティリティが高い");
  } else if (marketCap < 5_000_000) {
    risks.push("小型でボラティリティが高い");
  }

  if (traderCount === null || traderCount < 20) {
    risks.push("Trader数が少ない");
  }

  risks.push("同名トークン注意");
  risks.push("Holder構造は未確認");

  if ((flow7d ?? 0) <= 0) {
    risks.push("7d flowが弱く短期流入の可能性");
  }

  return risks.map((risk) => `- ${risk}`).join("\n");
}

function extractTokenIconUrlFromRow(row: NetflowRow): string | null {
  const directCandidates = [
    row.token_icon_url,
    row.token_image_url,
    row.icon_url,
    row.image_url,
    row.image,
    row.logo_url,
    row.logoURI,
  ];

  for (const candidate of directCandidates) {
    const url = toOptionalText(candidate);

    if (isValidHttpImageUrl(url)) {
      return url;
    }
  }

  const metadata = getNestedRecord(row.metadata) ?? getNestedRecord(row.token_metadata);

  if (!metadata) {
    return null;
  }

  for (const key of ["image", "image_url", "imageUrl", "icon", "icon_url", "logoURI", "logo_url"]) {
    const url = toOptionalText(metadata[key]);

    if (isValidHttpImageUrl(url)) {
      return url;
    }
  }

  return null;
}

async function fetchDexScreenerIconUrl(tokenAddress: string): Promise<string | null> {
  if (tokenAddress === "UNKNOWN") {
    return null;
  }

  try {
    const response = await fetch(
      `https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(tokenAddress)}`,
    );

    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as DexScreenerTokenResponse;
    const pairs = data.pairs ?? [];

    // 複数pairがある場合は流動性が大きいpairの画像を優先します。
    const bestPair = pairs
      .filter((pair) => isValidHttpImageUrl(toOptionalText(pair.info?.imageUrl)))
      .sort((a, b) => (Number(b.liquidity?.usd) || 0) - (Number(a.liquidity?.usd) || 0))[0];
    const imageUrl = toOptionalText(bestPair?.info?.imageUrl);

    return isValidHttpImageUrl(imageUrl) ? imageUrl : null;
  } catch {
    return null;
  }
}

async function fetchDexScreenerMarketData(
  tokenAddress: string,
): Promise<DexScreenerMarketData | null> {
  if (tokenAddress === "UNKNOWN") {
    return null;
  }

  try {
    const response = await fetch(
      `https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(tokenAddress)}`,
    );

    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as DexScreenerTokenResponse;
    const pairs = data.pairs ?? [];
    const bestPair = pairs
      .filter((pair) => toFiniteNumber(pair.priceUsd) !== null || toFiniteNumber(pair.marketCap) !== null)
      .sort((a, b) => (Number(b.liquidity?.usd) || 0) - (Number(a.liquidity?.usd) || 0))[0];

    if (!bestPair) {
      return null;
    }

    return {
      marketCap: toFiniteNumber(bestPair.marketCap) ?? toFiniteNumber(bestPair.fdv),
      price: toFiniteNumber(bestPair.priceUsd),
    };
  } catch {
    return null;
  }
}

async function getEntryMarketData(signal: SignalRecord): Promise<DexScreenerMarketData> {
  const liveData = await fetchDexScreenerMarketData(signal.token_address);

  return {
    marketCap: liveData?.marketCap ?? signal.scan_mcap,
    price: liveData?.price ?? signal.scan_price,
  };
}

async function resolveTokenIconUrl(row: NetflowRow, tokenAddress: string): Promise<string | null> {
  const metadataIconUrl = extractTokenIconUrlFromRow(row);

  if (metadataIconUrl) {
    return metadataIconUrl;
  }

  return fetchDexScreenerIconUrl(tokenAddress);
}

function calculateScoreBreakdown(row: NetflowRow, flowMcapRatio: number | null): ScoreBreakdown {
  const flow24h = toFiniteNumber(row.net_flow_24h_usd);
  const flow7d = toFiniteNumber(row.net_flow_7d_usd);
  const marketCap = toFiniteNumber(row.market_cap_usd);
  const traderCount = toFiniteNumber(row.trader_count);
  const ageDays = toFiniteNumber(row.token_age_days);
  const riskAdjustment = scoreRiskAdjustment(marketCap, flow7d, traderCount, ageDays);

  return {
    flowMcap: scoreFlowMcap(flowMcapRatio),
    smartMoney: scoreSmartMoney(flow24h, flow7d),
    earlyness: scoreEarlyness(ageDays),
    traderConfirmation: scoreTraderConfirmation(traderCount),
    riskAdjustment,
    riskLabel: riskLabelFromScore(riskAdjustment),
  };
}

async function buildMemeResearchCards(rows: NetflowRow[]): Promise<MemeResearchCard[]> {
  const scanId = randomUUID();
  const scanTime = new Date().toISOString();

  const cards = await Promise.all(rows.slice(0, 5).map(async (row): Promise<MemeResearchCard> => {
    const tokenAddress = toDisplayText(row.token_address, "UNKNOWN");
    const symbol = toDisplayText(row.token_symbol, "UNKNOWN");
    const name = toDisplayText(row.token_name ?? row.name, symbol);
    const marketCap = toFiniteNumber(row.market_cap_usd);
    const price = toFiniteNumber(row.price_usd ?? row.token_price_usd);
    const flow24h = toFiniteNumber(row.net_flow_24h_usd);
    const flow7d = toFiniteNumber(row.net_flow_7d_usd);
    const traderCount = toFiniteNumber(row.trader_count);
    const ageDays = toFiniteNumber(row.token_age_days);
    const flowMcapRatio = marketCap && flow24h !== null ? flow24h / marketCap : null;
    const breakdown = calculateScoreBreakdown(row, flowMcapRatio);
    const edgeScore =
      breakdown.flowMcap +
      breakdown.smartMoney +
      breakdown.earlyness +
      breakdown.traderConfirmation +
      breakdown.riskAdjustment;
    const narrative = buildNarrative(row, symbol, name);
    const scoreBreakdown =
      `Flow/MCap: ${breakdown.flowMcap}/30 | ` +
      `Smart Money: ${breakdown.smartMoney}/25 | ` +
      `Earlyness: ${breakdown.earlyness}/20 | ` +
      `Traders: ${breakdown.traderConfirmation}/15 | ` +
      `Risk Adj: ${breakdown.riskAdjustment}/10 (${breakdown.riskLabel})`;
    const whyFlagged = buildWhyFlagged(
      marketCap,
      flow24h,
      flow7d,
      flowMcapRatio,
      traderCount,
      ageDays,
    );
    const risk = buildRisk(marketCap, flow7d, traderCount);
    const dexscreenerUrl = `https://dexscreener.com/solana/${tokenAddress}`;
    const gmgnUrl = `https://gmgn.ai/sol/token/${tokenAddress}`;
    const universalxUrl = `https://universalx.app/trade?assetId=101_${tokenAddress}`;
    const nansenUrl = `Nansen deep dive: /meme-token ${tokenAddress}`;
    const tokenIconUrl = await resolveTokenIconUrl(row, tokenAddress);

    return {
      signalId: randomUUID(),
      scanId,
      tokenAddress,
      symbol,
      name,
      narrative,
      edgeScore,
      status: getStatus(edgeScore),
      scoreBreakdown,
      summary:
        `${formatCompactUsd(flow24h)}の24h Smart Money flowでTop5入り。` +
        `MCap ${formatCompactUsd(marketCap)}、Flow/MCap ${formatPercent(flowMcapRatio)}、` +
        `Traders ${formatCount(traderCount)}人。`,
      scanTime,
      marketCap,
      price,
      flow24h,
      flow7d,
      flowMcapRatio,
      traderCount,
      tokenAge: formatAge(row),
      whyFlagged,
      risk,
      tokenIconUrl,
      dexscreenerUrl,
      gmgnUrl,
      universalxUrl,
      nansenUrl,
    };
  }));

  return cards.sort((a, b) => b.edgeScore - a.edgeScore);
}

function saveMemeSignals(cards: MemeResearchCard[]): void {
  const transaction = db.transaction((signals: MemeResearchCard[]) => {
    for (const signal of signals) {
      insertSignal.run(signal);
    }
  });

  transaction(cards);
}

function formatDataSource(source: NansenDataSource): string {
  if (source === "live") {
    return "live Nansen CLI";
  }

  return source;
}

function getStatusColor(status: MemeStatus): number {
  if (status === "🟢 Strong Edge") {
    return 0x2ecc71;
  }

  if (status === "🟡 Watch") {
    return 0xf1c40f;
  }

  if (status === "🟠 High-risk Speculative") {
    return 0xe67e22;
  }

  return 0xe74c3c;
}

function shortenAddress(address: string): string {
  if (address.length <= 12) {
    return address;
  }

  return `${address.slice(0, 6)}...${address.slice(-6)}`;
}

function buildResearchCardEmbed(
  card: MemeResearchCard,
  index: number,
  source: NansenDataSource,
): InstanceType<typeof EmbedBuilder> {
  const description = [
    `**Meme Edge Score:** ${card.edgeScore}/100`,
    `**ステータス:** ${card.status}`,
    `**サマリー:** ${card.summary}`,
    `**ナラティブ:** ${card.narrative}`,
    `**検出理由:**\n${card.whyFlagged}`,
  ].join("\n\n");

  const embed = new EmbedBuilder()
    .setTitle(`#${index + 1} ${card.symbol} / ${card.name}`)
    .setColor(getStatusColor(card.status))
    .setDescription(description)
    .addFields(
      {
        name: "エントリーデータ",
        value: [
          `MCap: ${formatCompactUsd(card.marketCap)}`,
          `24h Flow: ${formatCompactUsd(card.flow24h)}`,
          `7d Flow: ${formatCompactUsd(card.flow7d)}`,
          `Flow/MCap: ${formatPercent(card.flowMcapRatio)}`,
          `Traders: ${formatCount(card.traderCount)}人`,
          `Age: ${card.tokenAge}`,
          `Score内訳: ${card.scoreBreakdown}`,
        ].join("\n"),
      },
      {
        name: "コントラクト",
        value: `\`${shortenAddress(card.tokenAddress)}\``,
        inline: true,
      },
      {
        name: "関連リンク",
        value: [
          `[DexScreener](${card.dexscreenerUrl})`,
          `[GMGN](${card.gmgnUrl})`,
          `[UniversalX](${card.universalxUrl})`,
          card.nansenUrl,
        ].join(" | "),
      },
    )
    .setFooter({ text: `データソース: ${formatDataSource(source)}` })
    .setTimestamp(new Date(card.scanTime));

  if (card.tokenIconUrl) {
    embed.setThumbnail(card.tokenIconUrl);
  }

  return embed;
}

type PickActionCounts = Record<PickAction, number>;

function getZeroPickActionCounts(): PickActionCounts {
  return {
    watch: 0,
    paper_in: 0,
    conviction: 0,
  };
}

function getPickActionCounts(signalId: string): PickActionCounts {
  const picks = getResultPicksForSignal.all(signalId) as UserPickRecord[];
  const latestByUser = new Map<string, UserPickRecord>();

  for (const pick of picks) {
    const existing = latestByUser.get(pick.user_id);

    if (!existing || new Date(pick.clicked_at).getTime() > new Date(existing.clicked_at).getTime()) {
      latestByUser.set(pick.user_id, pick);
    }
  }

  const counts = getZeroPickActionCounts();

  for (const pick of latestByUser.values()) {
    const action = normalizeAction(pick.action);

    if (action) {
      counts[action] += 1;
    }
  }

  return counts;
}

function buildPaperPickButtons(
  signalId: string,
  counts: PickActionCounts = getPickActionCounts(signalId),
): DiscordActionRowBuilder<DiscordButtonBuilder> {
  return new ActionRowBuilder<DiscordButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`meme_pick:watch:${signalId}`)
      .setLabel(`Watch (${counts.watch})`)
      .setEmoji("👀")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`meme_pick:paper_in:${signalId}`)
      .setLabel(`Paper IN (${counts.paper_in})`)
      .setEmoji("🧪")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`meme_pick:conviction:${signalId}`)
      .setLabel(`Conviction (${counts.conviction})`)
      .setEmoji("🔥")
      .setStyle(ButtonStyle.Danger),
  );
}

function buildMemeScanReplies(
  cards: MemeResearchCard[],
  source: NansenDataSource,
  label: MemeScanLabel,
): MemeScanReply[] {
  const replies = cards.map((card, index): MemeScanReply => {
    const reply: MemeScanReply = {
      embeds: [buildResearchCardEmbed(card, index, source)],
      components: [buildPaperPickButtons(card.signalId)],
    };

    if (index === 0) {
      reply.content = `**🔥 bb Meme Edge Scan - ${label}**\nSolana Smart Money Netflow Top5`;
    }

    return reply;
  });

  if (replies.length === 0) {
    throw new Error("Nansen CLI のJSONに表示できるデータがありません。");
  }

  return replies;
}

async function readMockNetflowRows(): Promise<NetflowRow[]> {
  let rawJson: string;

  try {
    rawJson = await readFile(SOLANA_NETFLOW_SAMPLE_PATH, "utf8");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      throw new Error(
        `モック用サンプルが見つかりません: ${SOLANA_NETFLOW_SAMPLE_PATH}`,
      );
    }

    throw error;
  }

  const json = JSON.parse(rawJson);

  return findNetflowRows(json);
}

async function readLiveNetflowRows(): Promise<NetflowRow[]> {
  // shellを使わず引数を配列で渡すと、コマンドの実行内容が分かりやすく安全です。
  const { stdout } = await execFileAsync(
    "nansen",
    ["research", "smart-money", "netflow", "--chain", "solana", "--limit", "5"],
    { timeout: 30_000, maxBuffer: 1024 * 1024 },
  );

  const json = JSON.parse(stdout);

  return findNetflowRows(json);
}

async function fetchNansenNetflowRows(): Promise<{ rows: NetflowRow[]; source: NansenDataSource }> {
  const now = Date.now();
  const mode: NansenFetchMode = process.env.USE_MOCK_NANSEN === "true" ? "mock" : "live";

  // 5分以内ならmock/liveそれぞれの前回結果を使います。
  if (
    cachedNansenResult &&
    cachedNansenResult.mode === mode &&
    cachedNansenResult.expiresAt > now
  ) {
    return { rows: cachedNansenResult.rows, source: "cache" };
  }

  const rows = mode === "mock" ? await readMockNetflowRows() : await readLiveNetflowRows();

  cachedNansenResult = {
    rows,
    mode,
    expiresAt: now + NANSEN_CACHE_TTL_MS,
  };

  return { rows, source: mode };
}

async function getDeskTestMessage(): Promise<string> {
  const { rows, source } = await fetchNansenNetflowRows();

  return formatDeskTestMessage(rows, source);
}

async function getMemeScanResult(label: MemeScanLabel): Promise<MemeScanResult> {
  const { rows, source } = await fetchNansenNetflowRows();
  const cards = await buildMemeResearchCards(rows);

  saveMemeSignals(cards);

  const firstCard = cards[0];

  if (!firstCard) {
    throw new Error("Nansen CLI のJSONに表示できるデータがありません。");
  }

  return {
    replies: buildMemeScanReplies(cards, source, label),
    scanId: firstCard.scanId,
    scanTime: firstCard.scanTime,
    source,
    signalIds: cards.map((card) => card.signalId),
  };
}

function getMemeRulesMessage(): string {
  return [
    "**bb Meme Edge Paper Pick ルール**",
    "",
    "このBotでは、気になったトークンに対して",
    "「Watch / Paper IN / Conviction」の3つの方法で",
    "エア判断を記録できます。",
    "",
    "1日に使えるポイントは 5pt です。",
    "ポイントの使い方によって、ランキングや成績に反映されます。",
    "",
    "【各アクション】",
    "👀 Watch",
    "気になるトークンを保存します。",
    "消費ポイント: 0pt",
    "ランキング: 対象外",
    "",
    "🧪 Paper IN",
    "軽めのエアINとして記録します。",
    "消費ポイント: 1pt",
    "ランキング: 対象",
    "",
    "🔥 Conviction",
    "本命のPaper Pickとして記録します。",
    "消費ポイント: 3pt",
    "ランキング: 対象",
    "制限: 1日1回まで",
    "",
    "【ポイント制】",
    "1日に使えるポイントは合計 5pt です。",
    "例:",
    "- Paper INを2回 = 2pt消費",
    "- Convictionを1回 = 3pt消費",
    "- その日の合計が5ptまで使えます",
    "",
    "【スコア】",
    "スコアは、エントリー後の値動きと使用ポイントをもとに計算されます。",
    "大きく伸びたトークンを、より強い判断で選べていたほど高評価になります。",
    "",
    "【注意】",
    "これは実際の売買ではありません。",
    "調査・学習・振り返りのためのPaper Pick機能です。",
    "投資助言ではありません。",
  ].join("\n");
}

function average(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function calculateReturnX(currentMcap: number | null, entryMcap: number | null): number | null {
  if (currentMcap === null || entryMcap === null || entryMcap <= 0) {
    return null;
  }

  return currentMcap / entryMcap;
}

function calculatePickScore(returnX: number | null, usedPoints: number): number | null {
  if (returnX === null || !Number.isFinite(returnX) || usedPoints <= 0) {
    return null;
  }

  return (returnX - 1) * usedPoints * 100;
}

function calculatePickReturn(
  pick: UserPickWithSignalRecord & { normalizedAction: PickAction },
  marketData: DexScreenerMarketData | null,
): PickPerformance {
  const currentMcap = marketData?.marketCap ?? null;
  const returnX = pick.normalizedAction === "watch"
    ? null
    : calculateReturnX(currentMcap, pick.entry_mcap);

  return {
    ...pick,
    currentMcap,
    returnX,
    pickScore: calculatePickScore(returnX, pick.used_points),
  };
}

async function buildPickPerformances(rows: UserPickWithSignalRecord[]): Promise<PickPerformance[]> {
  const normalizedPicks = rows
    .map((pick) => ({ ...pick, normalizedAction: normalizeAction(pick.action) }))
    .filter((pick): pick is UserPickWithSignalRecord & { normalizedAction: PickAction } =>
      pick.normalizedAction !== null,
    );
  const marketDataByToken = new Map<string, DexScreenerMarketData | null>();

  // 同じトークンを複数人がPickしていても、DexScreener取得は1回にまとめます。
  for (const pick of normalizedPicks) {
    if (!marketDataByToken.has(pick.token_address)) {
      marketDataByToken.set(pick.token_address, await fetchDexScreenerMarketData(pick.token_address));
    }
  }

  return normalizedPicks.map((pick) =>
    calculatePickReturn(pick, marketDataByToken.get(pick.token_address) ?? null),
  );
}

function calculateUserPerformance(userId: string, picks: PickPerformance[]): UserPerformance {
  const userPicks = picks.filter((pick) => pick.user_id === userId);
  const scoredPicks = userPicks.filter((pick) =>
    (pick.normalizedAction === "paper_in" || pick.normalizedAction === "conviction") &&
    pick.entry_mcap !== null &&
    pick.pickScore !== null &&
    pick.returnX !== null,
  );
  const totalScore = scoredPicks.reduce((sum, pick) => sum + (pick.pickScore ?? 0), 0);
  const totalUsedPoints = scoredPicks.reduce((sum, pick) => sum + pick.used_points, 0);
  const totalReturnValue = scoredPicks.reduce(
    (sum, pick) => sum + (pick.returnX ?? 0) * pick.used_points,
    0,
  );
  const returns = scoredPicks.map((pick) => pick.returnX).filter((value): value is number => value !== null);
  const bestScoredPick = scoredPicks
    .slice()
    .sort((a, b) => (b.returnX ?? 0) - (a.returnX ?? 0))[0] ?? null;

  return {
    userId,
    totalScore,
    totalUsedPoints,
    totalReturnValue,
    roi: totalUsedPoints > 0 ? totalReturnValue / totalUsedPoints : null,
    bestPick: bestScoredPick && bestScoredPick.returnX !== null && bestScoredPick.pickScore !== null
      ? {
        symbol: bestScoredPick.symbol,
        tokenAddress: bestScoredPick.token_address,
        returnX: bestScoredPick.returnX,
        pickScore: bestScoredPick.pickScore,
      }
      : null,
    averageReturn: average(returns),
    hitRate: returns.length > 0
      ? returns.filter((returnX) => returnX > 1).length / returns.length
      : null,
    convictionCount: userPicks.filter((pick) => pick.normalizedAction === "conviction").length,
    paperInCount: userPicks.filter((pick) => pick.normalizedAction === "paper_in").length,
    watchCount: userPicks.filter((pick) => pick.normalizedAction === "watch").length,
    scorePickCount: scoredPicks.length,
    recentPicks: userPicks
      .slice()
      .sort((a, b) => new Date(b.clicked_at).getTime() - new Date(a.clicked_at).getTime()),
  };
}

function getPerformancePeriodLabel(period: PerformancePeriod): string {
  if (period === "daily") {
    return "今日";
  }

  if (period === "weekly") {
    return "今週";
  }

  return "今月";
}

function getSymbolLabel(signal: ResultSignalRecord): string {
  return signal.symbol ? `$${signal.symbol}` : shortenAddress(signal.token_address);
}

function getPeriodStartIso(period: Exclude<MemeResultsPeriod, "latest">): string {
  const daysByPeriod: Record<Exclude<MemeResultsPeriod, "latest">, number> = {
    daily: 1,
    weekly: 7,
    monthly: 30,
  };
  const start = new Date();

  start.setUTCDate(start.getUTCDate() - daysByPeriod[period]);

  return start.toISOString();
}

async function resolveUserLabelById(userId: string): Promise<string> {
  try {
    const user = await client.users.fetch(userId);

    return user.globalName ?? user.username;
  } catch {
    return userId;
  }
}

async function resolveGuildUserLabel(guild: Guild | null, userId: string): Promise<string | null> {
  if (!guild) {
    return null;
  }

  try {
    const member = await guild.members.fetch(userId);

    return member.displayName;
  } catch {
    return null;
  }
}

async function resolveUserLabel(
  interaction: ChatInputCommandInteraction,
  userId: string,
): Promise<string> {
  const guildLabel = await resolveGuildUserLabel(interaction.guild, userId);

  if (guildLabel) {
    return guildLabel;
  }

  try {
    const user = await interaction.client.users.fetch(userId);

    return user.globalName ?? user.username;
  } catch {
    return resolveUserLabelById(userId);
  }
}

async function formatBestUserPick(
  interaction: ChatInputCommandInteraction,
  pick: UserPickReturn | null,
): Promise<string> {
  if (!pick) {
    return "N/A";
  }

  const userLabel = await resolveUserLabel(interaction, pick.userId);

  return `${userLabel} | ${actionPlainLabel(pick.action)} | ${getSymbolLabel(pick.signal)} ${formatReturnX(pick.returnX)}`;
}

function savePerformanceSnapshot(
  signal: ResultSignalRecord,
  window: SnapshotWindow,
  marketData: DexScreenerMarketData | null,
  botReturnX: number | null,
  snapshotTime: string,
): void {
  // 最新値を保存しておくと、あとから自動投稿や履歴集計に再利用できます。
  insertPerformanceSnapshot.run(
    randomUUID(),
    signal.signal_id,
    window,
    snapshotTime,
    marketData?.marketCap ?? null,
    marketData?.price ?? null,
    marketData?.marketCap ?? null,
    botReturnX,
  );
}

async function buildSignalPerformance(
  signal: ResultSignalRecord,
  window: SnapshotWindow,
  snapshotTime: string,
): Promise<SignalPerformance> {
  const marketData = await fetchDexScreenerMarketData(signal.token_address);
  const currentMcap = marketData?.marketCap ?? null;
  const currentPrice = marketData?.price ?? null;
  const botReturnX = calculateReturnX(currentMcap, signal.scan_mcap);
  const picks = getResultPicksForSignal.all(signal.signal_id) as UserPickRecord[];
  const userPickReturns: UserPickReturn[] = [];

  for (const pick of picks) {
    const returnX = calculateReturnX(currentMcap, pick.entry_mcap);
    const action = normalizeAction(pick.action);

    if (returnX !== null && (action === "paper_in" || action === "conviction")) {
      userPickReturns.push({
        userId: pick.user_id,
        action,
        signal,
        returnX,
        usedPoints: pick.used_points,
        clickedAt: pick.clicked_at,
      });
    }
  }

  savePerformanceSnapshot(signal, window, marketData, botReturnX, snapshotTime);

  return {
    signal,
    currentMcap,
    currentPrice,
    botReturnX,
    paperInAvg: average(
      userPickReturns
        .filter((pick) => pick.action === "paper_in")
        .map((pick) => pick.returnX),
    ),
    convictionAvg: average(
      userPickReturns
        .filter((pick) => pick.action === "conviction")
        .map((pick) => pick.returnX),
    ),
    userPickReturns,
  };
}

async function buildSignalPerformances(
  signals: ResultSignalRecord[],
  window: SnapshotWindow,
): Promise<SignalPerformance[]> {
  const snapshotTime = new Date().toISOString();
  const performances: SignalPerformance[] = [];

  for (const signal of signals) {
    performances.push(await buildSignalPerformance(signal, window, snapshotTime));
  }

  return performances;
}

function getBestBotPerformance(performances: SignalPerformance[]): SignalPerformance | null {
  const valid = performances.filter((performance) => performance.botReturnX !== null);

  return valid.sort((a, b) => (b.botReturnX ?? 0) - (a.botReturnX ?? 0))[0] ?? null;
}

function getBestUserPick(performances: SignalPerformance[]): UserPickReturn | null {
  // ユーザー最高Pickは return_x、使用ポイント、クリック時刻の順で決めます。
  return performances
    .flatMap((performance) => performance.userPickReturns)
    .sort((a, b) => {
      const returnDiff = b.returnX - a.returnX;

      if (returnDiff !== 0) {
        return returnDiff;
      }

      const pointDiff = b.usedPoints - a.usedPoints;

      if (pointDiff !== 0) {
        return pointDiff;
      }

      return new Date(a.clickedAt).getTime() - new Date(b.clickedAt).getTime();
    })[0] ?? null;
}

async function formatBestUserPickPlain(
  interaction: ChatInputCommandInteraction,
  pick: UserPickReturn | null,
): Promise<string> {
  if (!pick) {
    return "N/A";
  }

  const userLabel = await resolveUserLabel(interaction, pick.userId);

  return `${userLabel} | ${actionPlainLabel(pick.action)} | ${getSymbolLabel(pick.signal)} ${formatReturnX(pick.returnX)}`;
}

async function formatBestUserPickWithoutMention(pick: UserPickReturn | null): Promise<string> {
  if (!pick) {
    return "N/A";
  }

  const userLabel = await resolveUserLabelById(pick.userId);

  return `${userLabel} | ${actionPlainLabel(pick.action)} | ${getSymbolLabel(pick.signal)} ${formatReturnX(pick.returnX)}`;
}

function getPickAverage(
  performances: SignalPerformance[],
  action: Extract<PickAction, "paper_in" | "conviction">,
): number | null {
  return average(
    performances
      .flatMap((performance) => performance.userPickReturns)
      .filter((pick) => pick.action === action)
      .map((pick) => pick.returnX),
  );
}

function getResultWindowTitle(window: ResultWindow): string {
  if (window === "1h") {
    return "⚡ 1h Result - bb Meme Edge";
  }

  if (window === "6h") {
    return "📈 6h Result - bb Meme Edge";
  }

  return "📊 24h Result - bb Meme Edge";
}

function getPostedFlagName(window: ResultWindow): keyof Pick<
  ScanRecord,
  "result_1h_posted" | "result_6h_posted" | "result_24h_posted"
> {
  if (window === "1h") {
    return "result_1h_posted";
  }

  if (window === "6h") {
    return "result_6h_posted";
  }

  return "result_24h_posted";
}

function isScanResultPosted(scan: ScanRecord, window: ResultWindow): boolean {
  return scan[getPostedFlagName(window)] === 1;
}

function saveScanRecord(
  scanId: string,
  channelId: string,
  guildId: string | null,
  scanTime: string,
  source: NansenDataSource,
): void {
  upsertScan.run(scanId, channelId, guildId, scanTime, source);
}

function saveSignalMessage(signalId: string, message: Message): void {
  updateSignalMessage.run(message.id, message.channelId, signalId);
}

async function runMemeScanWithPoster(
  label: MemeScanLabel,
  context: MemeScanPostContext,
): Promise<MemeScanResult> {
  const scanResult = await getMemeScanResult(label);
  const firstReply = scanResult.replies[0];

  if (!firstReply) {
    throw new Error("表示できるResearch Cardがありません。");
  }

  saveScanRecord(
    scanResult.scanId,
    context.channelId,
    context.guildId,
    scanResult.scanTime,
    scanResult.source,
  );
  scheduleScanResultJobs(scanResult.scanId);

  const firstMessage = await context.sendFirst(firstReply);
  const firstSignalId = scanResult.signalIds[0];

  if (firstSignalId) {
    saveSignalMessage(firstSignalId, firstMessage);
  }

  for (const [index, reply] of scanResult.replies.slice(1).entries()) {
    const message = await context.sendNext(reply);
    const signalId = scanResult.signalIds[index + 1];

    if (signalId) {
      saveSignalMessage(signalId, message);
    }
  }

  return scanResult;
}

async function runMemeScan(channel: SendableChannel, label: MemeScanLabel): Promise<MemeScanResult> {
  if (!channel.id) {
    throw new Error("投稿先チャンネルIDを取得できませんでした。");
  }

  return runMemeScanWithPoster(label, {
    channelId: channel.id,
    guildId: channel.guildId ?? null,
    sendFirst: (reply) => channel.send(reply),
    sendNext: (reply) => channel.send(reply),
  });
}

function markPosted(scanId: string, window: ResultWindow): void {
  markScanResultPosted.run(window, window, window, scanId);
}

function buildPostResultTokenField(performance: SignalPerformance, index: number): { name: string; value: string } {
  return buildResultTokenField(performance, index);
}

function buildNansenSignalReview(performances: SignalPerformance[]): string {
  const bestBot = getBestBotPerformance(performances);
  const botReturns = performances
    .map((performance) => performance.botReturnX)
    .filter((value): value is number => value !== null);
  const averageReturn = average(botReturns);

  if (!bestBot || averageReturn === null) {
    return "今回はDexScreenerで取得できる現在値が少なく、傾向判断は保留です。";
  }

  const flowMcap = bestBot.signal.flow_mcap_ratio;
  const scanMcap = bestBot.signal.scan_mcap;

  if (bestBot.botReturnX !== null && bestBot.botReturnX >= 2) {
    return "今回伸びた候補は、初期MCapが比較的小さく、Smart Money流入に対する反応が強いものに集中しました。";
  }

  if (flowMcap !== null && flowMcap > 0.05) {
    return "Flow/MCapが高い候補は注目されましたが、現時点では大きな上昇にはつながっていません。";
  }

  if (scanMcap !== null && scanMcap > 10_000_000) {
    return "大型寄りの候補が多く、短期では値動きが比較的落ち着いた結果になりました。";
  }

  return "今回はTop5全体でばらつきがあり、MCapとSmart Money flowの強さを次回も比較して見る必要があります。";
}

async function buildScanResultEmbed(
  interaction: ChatInputCommandInteraction | null,
  scan: ScanRecord,
  window: ResultWindow,
  performances: SignalPerformance[],
): Promise<InstanceType<typeof EmbedBuilder>> {
  const botReturns = performances
    .map((performance) => performance.botReturnX)
    .filter((value): value is number => value !== null);
  const bestBot = getBestBotPerformance(performances);
  const bestUserPick = getBestUserPick(performances);
  const averageReturn = average(botReturns);
  const paperInAvg = getPickAverage(performances, "paper_in");
  const convictionAvg = getPickAverage(performances, "conviction");
  const bestUserPickText = interaction
    ? await formatBestUserPickPlain(interaction, bestUserPick)
    : await formatBestUserPickWithoutMention(bestUserPick);

  return new EmbedBuilder()
    .setTitle(getResultWindowTitle(window))
    .setColor(0x3498db)
    .setDescription(`スキャン日時: ${formatJstResultDateTime(scan.scan_time)} JST`)
    .addFields(
      ...performances.map((performance, index) => buildPostResultTokenField(performance, index)),
      {
        name: "サマリー",
        value: [
          `Bot最高成績: ${
            bestBot ? `${getSymbolLabel(bestBot.signal)} ${formatReturnX(bestBot.botReturnX)}` : "N/A"
          }`,
          `平均成績: ${formatReturnX(averageReturn)}`,
          `1x超え: ${botReturns.filter((value) => value >= 1).length}/${performances.length}`,
          `2x超え: ${botReturns.filter((value) => value >= 2).length}/${performances.length}`,
          `Paper IN平均: ${formatReturnX(paperInAvg)}`,
          `Conviction平均: ${formatReturnX(convictionAvg)}`,
          `ユーザー最高Pick: ${bestUserPickText}`,
        ].join("\n"),
      },
      {
        name: "Nansenシグナル振り返り",
        value: buildNansenSignalReview(performances),
      },
    )
    .setFooter({ text: "データソース: DexScreener + SQLite" })
    .setTimestamp(new Date());
}

async function postScanResult(
  scanId: string,
  window: ResultWindow,
  channel: SendableChannel,
): Promise<void> {
  const scan = getScanById.get(scanId) as ScanRecord | undefined;

  if (!scan) {
    throw new Error(`scan_id が見つかりません: ${scanId}`);
  }

  const signals = getSignalsByScanId.all(scanId) as ResultSignalRecord[];

  if (signals.length === 0) {
    throw new Error(`scan_id に紐づくsignalsがありません: ${scanId}`);
  }

  const performances = await buildSignalPerformances(signals, window);
  const embed = await buildScanResultEmbed(null, scan, window, performances);

  await channel.send({ embeds: [embed] });
  markPosted(scanId, window);
}

function isSendableChannel(channel: unknown): channel is SendableChannel {
  return Boolean(
    channel &&
    typeof channel === "object" &&
    "send" in channel &&
    typeof (channel as { send?: unknown }).send === "function",
  );
}

async function postScheduledScanResult(scanId: string, window: ResultWindow): Promise<void> {
  const scan = getScanById.get(scanId) as ScanRecord | undefined;

  if (!scan) {
    console.warn(`Result投稿をスキップしました。scan_idが見つかりません: ${scanId}`);
    return;
  }

  if (isScanResultPosted(scan, window)) {
    console.log(`Result投稿をスキップしました。投稿済み: ${scanId} ${window}`);
    return;
  }

  const channel = await client.channels.fetch(scan.channel_id);

  if (!isSendableChannel(channel)) {
    console.warn(`Result投稿をスキップしました。投稿可能なチャンネルではありません: ${scan.channel_id}`);
    return;
  }

  await postScanResult(scanId, window, channel);
}

function scheduleScanResultJobs(scanId: string): void {
  const jobs: Array<{ window: ResultWindow; delayMs: number }> = [
    { window: "1h", delayMs: 60 * 60 * 1000 },
    { window: "6h", delayMs: 6 * 60 * 60 * 1000 },
    { window: "24h", delayMs: 24 * 60 * 60 * 1000 },
  ];

  for (const job of jobs) {
    // 開発版はNode.jsのsetTimeoutだけで予約します。Bot再起動で消えるため、
    // 本番ではcronや永続schedulerへ移行して未投稿scanを復元します。
    setTimeout(() => {
      void postScheduledScanResult(scanId, job.window).catch((error) => {
        console.error(`Result自動投稿に失敗しました: ${scanId} ${job.window}`, error);
      });
    }, job.delayMs);
  }
}

function chunkArray<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];

  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }

  return chunks;
}

function buildResultTokenField(performance: SignalPerformance, index: number): { name: string; value: string } {
  return {
    name: `${index + 1}. ${getSymbolLabel(performance.signal)}`,
    value: [
      `スキャン時：${formatCompactUsd(performance.signal.scan_mcap)} → 現在：${formatCompactUsd(performance.currentMcap)}`,
      `Bot成績: ${formatReturnX(performance.botReturnX)}`,
      `Paper IN平均: ${formatReturnX(performance.paperInAvg)}`,
      `Conviction平均: ${formatReturnX(performance.convictionAvg)}`,
    ].join("\n"),
  };
}

async function buildResultsSummaryLines(
  interaction: ChatInputCommandInteraction,
  performances: SignalPerformance[],
  period: MemeResultsPeriod,
): Promise<string[]> {
  const botReturns = performances
    .map((performance) => performance.botReturnX)
    .filter((value): value is number => value !== null);
  const bestBot = getBestBotPerformance(performances);
  const averageReturn = average(botReturns);
  const bestUserPick = await formatBestUserPick(interaction, getBestUserPick(performances));
  const paperInAvg = getPickAverage(performances, "paper_in");
  const convictionAvg = getPickAverage(performances, "conviction");

  return [
    period === "daily"
      ? `今日のBot候補数: ${formatCount(performances.length)}`
      : `Bot候補数: ${formatCount(performances.length)}`,
    `Bot最高成績: ${
      bestBot ? `${getSymbolLabel(bestBot.signal)} ${formatReturnX(bestBot.botReturnX)}` : "N/A"
    }`,
    `平均成績: ${formatReturnX(averageReturn)}`,
    `1x超え: ${botReturns.filter((value) => value >= 1).length}/${performances.length}`,
    `2x超え: ${botReturns.filter((value) => value >= 2).length}/${performances.length}`,
    `Paper IN平均: ${formatReturnX(paperInAvg)}`,
    `Conviction平均: ${formatReturnX(convictionAvg)}`,
    `ユーザー最高Pick: ${bestUserPick}`,
    "データソース: DexScreener + SQLite",
  ];
}

async function buildLatestResultsEmbed(
  interaction: ChatInputCommandInteraction,
): Promise<InstanceType<typeof EmbedBuilder> | string> {
  const latestScan = getLatestScanId.get() as { scan_id: string } | undefined;

  if (!latestScan) {
    return "まだ保存されたスキャン結果がありません。先に /meme-scan を実行してください。";
  }

  const signals = getSignalsByScanId.all(latestScan.scan_id) as ResultSignalRecord[];

  if (signals.length === 0) {
    return "まだ保存されたスキャン結果がありません。先に /meme-scan を実行してください。";
  }

  const performances = await buildSignalPerformances(signals, "latest");
  const summaryLines = await buildResultsSummaryLines(interaction, performances, "latest");

  return new EmbedBuilder()
    .setTitle("📊 bb Meme Edge Results - 最新スキャン")
    .setColor(0x3498db)
    .setDescription([
      "最新スキャンの候補が現在どれくらい動いたかを表示します。",
      "",
      "この結果は最新スキャン内のPickだけを集計しています。",
      "今日の全Pick結果を見る場合は /meme-results period:daily を使ってください。",
      "過去の自分のPickは /my-picks で確認できます。",
    ].join("\n"))
    .addFields(
      ...performances.map((performance, index) => buildResultTokenField(performance, index)),
      {
        name: "サマリー",
        value: summaryLines.join("\n"),
      },
    )
    .setTimestamp(new Date());
}

function formatPeriodLabel(period: Exclude<MemeResultsPeriod, "latest">): string {
  if (period === "daily") {
    return "今日";
  }

  if (period === "weekly") {
    return "直近7日";
  }

  return "直近30日";
}

function getResultSignalsForPeriod(period: Exclude<MemeResultsPeriod, "latest">): ResultSignalRecord[] {
  if (period === "daily") {
    const { startIso, endIso } = getJstDayRangeIso();

    return getSignalsBetween.all(startIso, endIso) as ResultSignalRecord[];
  }

  return getSignalsSince.all(getPeriodStartIso(period)) as ResultSignalRecord[];
}

async function buildPeriodResultsEmbed(
  interaction: ChatInputCommandInteraction,
  period: Exclude<MemeResultsPeriod, "latest">,
): Promise<Array<InstanceType<typeof EmbedBuilder>> | string> {
  const signals = getResultSignalsForPeriod(period);

  if (signals.length === 0) {
    return "まだ保存されたスキャン結果がありません。先に /meme-scan を実行してください。";
  }

  const performances = await buildSignalPerformances(signals, period);
  const summaryLines = await buildResultsSummaryLines(interaction, performances, period);
  const description = period === "daily"
    ? "JST基準の今日に作成された全signalsと、それに紐づくPaper IN / ConvictionのPickを集計します。"
    : "対象期間の保存済みシグナル全体のBot Performanceを表示します。";

  if (period !== "daily") {
    return [
      new EmbedBuilder()
        .setTitle(`📊 bb Meme Edge Results - ${formatPeriodLabel(period)}`)
        .setColor(0x3498db)
        .setDescription(description)
        .addFields({
          name: "サマリー",
          value: summaryLines.join("\n"),
        })
        .setTimestamp(new Date()),
    ];
  }

  // DiscordのEmbed上限に余裕を持たせるため、dailyは10トークンごとに分けます。
  const chunks = chunkArray(performances, 10);

  return chunks.map((chunk, chunkIndex) => {
    const startIndex = chunkIndex * 10;
    const embed = new EmbedBuilder()
      .setTitle(`📊 bb Meme Edge Results - ${formatPeriodLabel(period)} ${chunkIndex + 1}/${chunks.length}`)
      .setColor(0x3498db)
      .setDescription(description)
      .addFields(
        ...chunk.map((performance, index) => buildResultTokenField(performance, startIndex + index)),
      )
      .setTimestamp(new Date());

    if (chunkIndex === chunks.length - 1) {
      embed.addFields({
        name: "サマリー",
        value: summaryLines.join("\n"),
      });
    }

    return embed;
  });
}

async function getMemeResultsReply(
  interaction: ChatInputCommandInteraction,
): Promise<MemeResultsReply> {
  const period = (interaction.options.getString("period") ?? "latest") as MemeResultsPeriod;
  const result = period === "latest"
    ? await buildLatestResultsEmbed(interaction)
    : await buildPeriodResultsEmbed(interaction, period);

  if (typeof result === "string") {
    return { content: result };
  }

  return { embeds: Array.isArray(result) ? result : [result] };
}

function median(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }

  const sorted = values.slice().sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : sorted[middle] ?? null;
}

function getRecapTitle(period: MemeRecapPeriod): string {
  if (period === "daily") {
    return "🏆 Daily bb Meme Edge Recap";
  }

  if (period === "weekly") {
    return "🏆 Weekly bb Meme Edge Recap";
  }

  return "📅 Monthly bb Meme Edge Report";
}

function getRecapPeriodLabel(period: MemeRecapPeriod): string {
  if (period === "daily") {
    return "今日";
  }

  if (period === "weekly") {
    return "今週";
  }

  return "今月";
}

function getRecapSignals(period: MemeRecapPeriod, now = new Date()): ResultSignalRecord[] {
  const { startIso, endIso } = getPeriodRange(period, now);

  return getSignalsBetween.all(startIso, endIso) as ResultSignalRecord[];
}

function buildBotPerformanceSummary(performances: SignalPerformance[]): string {
  const botReturns = performances
    .map((performance) => performance.botReturnX)
    .filter((value): value is number => value !== null);
  const bestBot = getBestBotPerformance(performances);

  return [
    `Signals: ${formatCount(performances.length)}`,
    `1x超え: ${botReturns.filter((value) => value >= 1).length}`,
    `2x超え: ${botReturns.filter((value) => value >= 2).length}`,
    `5x超え: ${botReturns.filter((value) => value >= 5).length}`,
    `10x超え: ${botReturns.filter((value) => value >= 10).length}`,
    `平均成績: ${formatReturnX(average(botReturns))}`,
    `中央値: ${formatReturnX(median(botReturns))}`,
    `Bot最高成績: ${
      bestBot ? `${getSymbolLabel(bestBot.signal)} ${formatReturnX(bestBot.botReturnX)}` : "N/A"
    }`,
  ].join("\n");
}

function compareBestPick(a: PickPerformance, b: PickPerformance): number {
  const returnDiff = (b.returnX ?? 0) - (a.returnX ?? 0);

  if (returnDiff !== 0) {
    return returnDiff;
  }

  const pointDiff = b.used_points - a.used_points;

  if (pointDiff !== 0) {
    return pointDiff;
  }

  return new Date(a.clicked_at).getTime() - new Date(b.clicked_at).getTime();
}

async function buildCommunityPerformanceSummary(
  interaction: ChatInputCommandInteraction | null,
  picks: PickPerformance[],
): Promise<string> {
  const paperIns = picks.filter((pick) => pick.normalizedAction === "paper_in");
  const convictions = picks.filter((pick) => pick.normalizedAction === "conviction");
  const scoredPicks = [...paperIns, ...convictions].filter((pick) => pick.returnX !== null);
  const bestPick = scoredPicks.slice().sort(compareBestPick)[0] ?? null;
  const bestPickLabel = bestPick
    ? interaction
      ? await resolveUserLabel(interaction, bestPick.user_id)
      : resolveUserLabelById(bestPick.user_id)
    : null;
  const bestPickText = bestPick
    ? `${bestPickLabel} | ${actionPlainLabel(bestPick.normalizedAction)} | ${
      bestPick.symbol ? `$${bestPick.symbol}` : shortenAddress(bestPick.token_address)
    } ${formatReturnX(bestPick.returnX)}`
    : "N/A";

  return [
    `👀 Watch: ${picks.filter((pick) => pick.normalizedAction === "watch").length}`,
    `🧪 Paper IN: ${paperIns.length}`,
    `🔥 Conviction: ${convictions.length}`,
    `Paper IN平均: ${formatReturnX(average(paperIns.map((pick) => pick.returnX).filter((value): value is number => value !== null)))}`,
    `Conviction平均: ${formatReturnX(average(convictions.map((pick) => pick.returnX).filter((value): value is number => value !== null)))}`,
    `ユーザー最高Pick: ${bestPickText}`,
  ].join("\n");
}

async function buildLeaderboardTop3Summary(
  interaction: ChatInputCommandInteraction | null,
  picks: PickPerformance[],
): Promise<string> {
  const userIds = Array.from(new Set(picks.map((pick) => pick.user_id)));
  const performances = userIds
    .map((userId) => calculateUserPerformance(userId, picks))
    .filter((performance) => performance.scorePickCount > 0 && performance.totalUsedPoints > 0)
    .sort((a, b) => b.totalScore - a.totalScore)
    .slice(0, 3);

  if (performances.length === 0) {
    return "ランキング対象のPickはまだありません。";
  }

  const lines: string[] = [];

  for (const [index, performance] of performances.entries()) {
    const userLabel = interaction
      ? await resolveUserLabel(interaction, performance.userId)
      : resolveUserLabelById(performance.userId);

    lines.push(
      `${index + 1}. ${userLabel}`,
      `Score: ${formatScore(performance.totalScore)}`,
      `ROI: ${formatReturnX(performance.roi)}`,
      "",
    );
  }

  return lines.join("\n").trim();
}

type NarrativeCategory =
  | "Founder / person meme"
  | "AI / agent meme"
  | "Animal / character meme"
  | "Space / sci-fi meme"
  | "Political meme"
  | "Dark humor / irony meme"
  | "Unknown / other";

function classifyNarrative(signal: ResultSignalRecord): NarrativeCategory {
  const text = [
    signal.symbol,
    signal.name,
    signal.narrative,
    signal.status,
  ].filter(Boolean).join(" ").toLowerCase();

  if (/\bscam\b|rug|fraud|irony|皮肉|詐欺|ブラックユーモア/.test(text)) {
    return "Dark humor / irony meme";
  }

  if (/\bai\b|agent|bot|gpt|robot|人工知能/.test(text)) {
    return "AI / agent meme";
  }

  if (/dog|cat|frog|pepe|inu|shib|wif|character|犬|猫|カエル|キャラクター/.test(text)) {
    return "Animal / character meme";
  }

  if (/asteroid|meteor|space|moon|mars|cosmo|sci-fi|宇宙|月|惑星/.test(text)) {
    return "Space / sci-fi meme";
  }

  if (/maga|trump|biden|politic|president|election|america|usa|政治|選挙/.test(text)) {
    return "Political meme";
  }

  if (/founder|ceo|elon|vitalik|henry|nikita|bier|person|人物|創業者/.test(text)) {
    return "Founder / person meme";
  }

  return "Unknown / other";
}

function buildNarrativeSummary(period: MemeRecapPeriod, performances: SignalPerformance[]): string {
  if (performances.length === 0) {
    return "対象期間のsignalsがないため、ナラティブ集計はN/Aです。";
  }

  const stats = new Map<NarrativeCategory, { count: number; best: SignalPerformance | null }>();

  for (const performance of performances) {
    const category = classifyNarrative(performance.signal);
    const current = stats.get(category) ?? { count: 0, best: null };
    const currentBest = current.best?.botReturnX ?? -Infinity;
    const nextBest = performance.botReturnX ?? -Infinity;

    stats.set(category, {
      count: current.count + 1,
      best: nextBest > currentBest ? performance : current.best,
    });
  }

  const ranked = Array.from(stats.entries()).sort((a, b) => b[1].count - a[1].count);
  const topCategories = ranked.slice(0, 2).map(([category]) => category);
  const bestCategory = Array.from(stats.entries())
    .sort((a, b) => (b[1].best?.botReturnX ?? -Infinity) - (a[1].best?.botReturnX ?? -Infinity))[0];
  const bestPerformance = bestCategory?.[1].best ?? null;
  const periodLabel = getRecapPeriodLabel(period);

  if (!bestCategory || !bestPerformance) {
    return `${periodLabel}は ${topCategories.join(" と ")} が多く検出されました。現在値が取れた候補が少ないため、伸びたナラティブ判断はN/Aです。`;
  }

  const lead = `${periodLabel}は ${topCategories.join(" と ")} が多く検出されました。`;
  const bestLine = `最も成績が良かったのは ${bestCategory[0]} で、${getSymbolLabel(bestPerformance.signal)} が ${formatReturnX(bestPerformance.botReturnX)} まで伸びました。`;

  if (period === "daily") {
    return [lead, bestLine].join("\n");
  }

  const detail = ranked
    .slice(0, 3)
    .map(([category, value]) => `${category}: ${value.count}件`)
    .join(" / ");

  return [lead, bestLine, `内訳: ${detail}`].join("\n");
}

function parseTokenAgeDays(tokenAge: string | null): number | null {
  if (!tokenAge) {
    return null;
  }

  const match = tokenAge.match(/(\d+(?:\.\d+)?)/);

  return match ? Number(match[1]) : null;
}

function buildRecapNansenSignalReview(period: MemeRecapPeriod, performances: SignalPerformance[]): string {
  if (performances.length === 0) {
    return "対象期間のsignalsがないため、Nansen Signal ReviewはN/Aです。";
  }

  const signals = performances.map((performance) => performance.signal);
  const bothFlowPositive = signals.filter((signal) => (signal.flow_24h ?? 0) > 0 && (signal.flow_7d ?? 0) > 0).length;
  const highFlowMcap = signals.filter((signal) => (signal.flow_mcap_ratio ?? 0) >= 0.02).length;
  const shortOnly = signals.filter((signal) => (signal.flow_24h ?? 0) > 0 && (signal.flow_7d ?? 0) <= 0).length;
  const lowMcap = signals.filter((signal) => (signal.scan_mcap ?? Infinity) < 500_000).length;
  const highMcap = signals.filter((signal) => (signal.scan_mcap ?? 0) >= 10_000_000).length;
  const activeTraders = signals.filter((signal) => (signal.trader_count ?? 0) >= 25).length;
  const youngTokens = signals.filter((signal) => {
    const ageDays = parseTokenAgeDays(signal.token_age);

    return ageDays !== null && ageDays <= 30;
  }).length;
  const bestBot = getBestBotPerformance(performances);
  const lines = [
    `Flow/MCapが高い候補: ${highFlowMcap}件 / 24hと7d Flowが両方プラス: ${bothFlowPositive}件`,
    `24h Flowだけ強く7d Flowが弱い候補: ${shortOnly}件`,
    `MCap $500K未満: ${lowMcap}件 / MCap $10.00M以上: ${highMcap}件`,
    `Trader 25人以上: ${activeTraders}件 / token age 30日以内: ${youngTokens}件`,
  ];

  if (bestBot) {
    lines.push(`今回のBot最高は ${getSymbolLabel(bestBot.signal)} ${formatReturnX(bestBot.botReturnX)} で、検出時MCapは ${formatCompactUsd(bestBot.signal.scan_mcap)} でした。`);
  }

  if (period === "daily") {
    lines.push("Flow/MCapと7d Flowが両方強い候補は相対的に強めに見ます。24h Flow単独の候補は短期反応で終わる可能性があります。");
  } else {
    lines.push("Smart Money flowが24hだけでなく7dでも継続している候補は、短期の一発流入よりも振り返り上の信頼度を高めに見ます。小型MCapは上振れが大きい一方、失敗率も高めです。");
  }

  return lines.join("\n");
}

function buildNextAdjustment(performances: SignalPerformance[]): string {
  if (performances.length === 0) {
    return "次回はsignals蓄積後にFlow/MCap、7d Flow、MCap帯を見直します。";
  }

  const signals = performances.map((performance) => performance.signal);
  const weak7dCount = signals.filter((signal) => (signal.flow_24h ?? 0) > 0 && (signal.flow_7d ?? 0) <= 0).length;
  const highMcapCount = signals.filter((signal) => (signal.scan_mcap ?? 0) >= 10_000_000).length;
  const lowMcapCount = signals.filter((signal) => (signal.scan_mcap ?? Infinity) < 500_000).length;
  const lines = ["次回は Flow/MCap と 7d Flowの継続性をやや重視します。"];

  if (weak7dCount > 0) {
    lines.push("24h Flowだけ強い候補はスコアを少し抑えます。");
  }

  if (highMcapCount > 0) {
    lines.push("MCapが高すぎる候補は短期余地を見てスコアを少し下げます。");
  }

  if (lowMcapCount > 0) {
    lines.push("MCap $500K未満は上振れ候補として残しつつ、リスク調整を強めます。");
  }

  return lines.join("\n");
}

async function buildMemeRecapReply(
  period: MemeRecapPeriod,
  interaction: ChatInputCommandInteraction | null = null,
): Promise<{ embeds: [InstanceType<typeof EmbedBuilder>] } | { content: string }> {
  const now = new Date();
  const { startIso, endIso } = getPeriodRange(period, now);
  const signals = getRecapSignals(period, now);

  if (signals.length === 0) {
    return { content: `${getRecapPeriodLabel(period)}のsignalsがまだありません。先に /meme-scan を実行してください。` };
  }

  const performances = await buildSignalPerformances(signals, period);
  const pickRows = getAllUserPicksBetween.all(startIso, endIso) as UserPickWithSignalRecord[];
  const pickPerformances = await buildPickPerformances(pickRows);
  const summary: MemeRecapSummary = {
    botSummary: buildBotPerformanceSummary(performances),
    communitySummary: await buildCommunityPerformanceSummary(interaction, pickPerformances),
    leaderboardSummary: await buildLeaderboardTop3Summary(interaction, pickPerformances),
    narrativeSummary: buildNarrativeSummary(period, performances),
    nansenSignalReview: buildRecapNansenSignalReview(period, performances),
    nextAdjustment: buildNextAdjustment(performances),
  };
  const createdAt = now.toISOString();

  // Recapはあとから履歴表示できるよう、表示した要約テキストをそのまま保存します。
  insertRecap.run(
    randomUUID(),
    period,
    startIso,
    endIso,
    summary.botSummary,
    summary.communitySummary,
    summary.narrativeSummary,
    summary.nansenSignalReview,
    createdAt,
  );

  return {
    embeds: [
      new EmbedBuilder()
        .setTitle(getRecapTitle(period))
        .setColor(period === "monthly" ? 0x9b59b6 : 0xf1c40f)
        .setDescription([
          `対象期間: ${formatJstResultDateTime(startIso)} - ${formatJstResultDateTime(endIso)} JST`,
          "データソース: DexScreener + SQLite",
        ].join("\n"))
        .addFields(
          { name: "Bot Performance", value: summary.botSummary },
          { name: "Community Performance", value: summary.communitySummary },
          { name: "Leaderboard Top3", value: summary.leaderboardSummary },
          { name: "Narrative Summary", value: summary.narrativeSummary },
          { name: "Nansen Signal Review", value: summary.nansenSignalReview },
          { name: "Next Adjustment", value: summary.nextAdjustment },
        )
        .setTimestamp(now),
    ],
  };
}

async function buildMemeRecapEmbed(
  interaction: ChatInputCommandInteraction,
): Promise<{ embeds: [InstanceType<typeof EmbedBuilder>] } | { content: string }> {
  const period = (interaction.options.getString("period") ?? "daily") as MemeRecapPeriod;

  return buildMemeRecapReply(period, interaction);
}

async function runMemeRecap(
  channel: SendableChannel,
  period: MemeRecapPeriod,
): Promise<{ embeds: [InstanceType<typeof EmbedBuilder>] } | { content: string }> {
  const reply = await buildMemeRecapReply(period);

  await channel.send(reply);

  return reply;
}

function getSymbolFromBestPick(bestPick: BestPerformancePick): string {
  return bestPick.symbol ? `$${bestPick.symbol}` : shortenAddress(bestPick.tokenAddress);
}

async function getLeaderboardReply(
  interaction: ChatInputCommandInteraction,
): Promise<{ embeds: [InstanceType<typeof EmbedBuilder>] } | { content: string }> {
  const period = (interaction.options.getString("period") ?? "daily") as PerformancePeriod;
  const { startIso, endIso } = getPeriodRange(period);
  const rows = getAllUserPicksBetween.all(startIso, endIso) as UserPickWithSignalRecord[];
  const pickPerformances = await buildPickPerformances(rows);
  const userIds = Array.from(new Set(pickPerformances.map((pick) => pick.user_id)));
  const performances = userIds
    .map((userId) => calculateUserPerformance(userId, pickPerformances))
    .filter((performance) => performance.scorePickCount > 0 && performance.totalUsedPoints > 0)
    .sort((a, b) => b.totalScore - a.totalScore)
    .slice(0, 10);

  if (performances.length === 0) {
    return {
      content: "まだランキング対象のPickがありません。Paper IN または Conviction を使ってください。",
    };
  }

  const lines: string[] = [];

  for (const [index, performance] of performances.entries()) {
    const userLabel = await resolveUserLabel(interaction, performance.userId);

    lines.push(
      `${index + 1}. ${userLabel}`,
      `Score: ${formatScore(performance.totalScore)}`,
      `ROI: ${formatReturnX(performance.roi)}`,
      `Best Pick: ${
        performance.bestPick
          ? `${getSymbolFromBestPick(performance.bestPick)} ${formatReturnX(performance.bestPick.returnX)}`
          : "N/A"
      }`,
      `Hit Rate: ${formatHitRate(performance.hitRate)}`,
      `Used Points: ${performance.totalUsedPoints}pt`,
      `内訳: Paper IN ${performance.paperInCount}件 / Conviction ${performance.convictionCount}件`,
      "",
    );
  }

  return {
    embeds: [
      new EmbedBuilder()
        .setTitle(`🏆 bb Meme Edge ランキング - ${getPerformancePeriodLabel(period)}`)
        .setColor(0xf1c40f)
        .setDescription(lines.join("\n").trim())
        .setFooter({ text: "Score = (return_x - 1) × used_points × 100" })
        .setTimestamp(new Date()),
    ],
  };
}

async function getMyPerformanceReply(
  interaction: ChatInputCommandInteraction,
): Promise<{ embeds: [InstanceType<typeof EmbedBuilder>] } | { content: string }> {
  const period = (interaction.options.getString("period") ?? "daily") as PerformancePeriod;
  const now = new Date();
  const todayJst = getJstDateString(now);
  const user = getOrCreateUser(interaction.user.id, now.toISOString(), todayJst);
  const { startIso, endIso } = getPeriodRange(period, now);
  const rows = getUserPicksBetween.all(
    interaction.user.id,
    startIso,
    endIso,
  ) as UserPickWithSignalRecord[];
  const pickPerformances = await buildPickPerformances(rows);
  const performance = calculateUserPerformance(interaction.user.id, pickPerformances);
  const recentScoredPicks = performance.recentPicks
    .filter((pick) => pick.normalizedAction === "paper_in" || pick.normalizedAction === "conviction")
    .slice(0, 5);

  if (performance.recentPicks.length === 0) {
    return { content: `${getPerformancePeriodLabel(period)}のPaper Pickはまだありません。` };
  }

  const recentLines = recentScoredPicks.length > 0
    ? recentScoredPicks.map((pick) => {
      const symbol = pick.symbol ? `$${pick.symbol}` : shortenAddress(pick.token_address);

      return `${pick.normalizedAction === "conviction" ? "🔥" : "🧪"} ${symbol} → ${formatReturnX(pick.returnX)} / ${formatScore(pick.pickScore)}`;
    })
    : ["Score対象のRecent Pickはまだありません。"];

  return {
    embeds: [
      new EmbedBuilder()
        .setTitle(`📈 あなたのPaper Pick成績 - ${getPerformancePeriodLabel(period)}`)
        .setColor(0x2ecc71)
        .setDescription([
          `Score: ${formatScore(performance.totalScore)}`,
          `ROI: ${formatReturnX(performance.roi)}`,
          `使用ポイント: ${performance.totalUsedPoints}pt`,
          `本日の残りポイント: ${Math.max(0, 5 - user.daily_points_used)}pt`,
          "",
          "ベストPick:",
          performance.bestPick
            ? `${getSymbolFromBestPick(performance.bestPick)} ${formatReturnX(performance.bestPick.returnX)}`
            : "N/A",
          "",
          "Pick内訳:",
          `👀 Watch: ${performance.watchCount}件`,
          `🧪 Paper IN: ${performance.paperInCount}件`,
          `🔥 Conviction: ${performance.convictionCount}件`,
          "",
          "最近のPick:",
          ...recentLines,
          "",
          "Score計算:",
          "(return_x - 1) × used_points × 100",
        ].join("\n"))
        .setTimestamp(now),
    ],
  };
}

function getMyPicksPeriodLabel(period: MyPicksPeriod): string {
  if (period === "today") {
    return "今日";
  }

  if (period === "weekly") {
    return "直近7日";
  }

  return "直近30日";
}

function getMyPicksPeriodStartIso(period: MyPicksPeriod, now = new Date()): string {
  if (period === "today") {
    return new Date(`${getJstDateString(now)}T00:00:00+09:00`).toISOString();
  }

  const days = period === "weekly" ? 7 : 30;
  const start = new Date(now);

  start.setUTCDate(start.getUTCDate() - days);

  return start.toISOString();
}

function formatJstDateTime(isoText: string | null): string {
  if (!isoText) {
    return "N/A";
  }

  const date = new Date(isoText);

  if (Number.isNaN(date.getTime())) {
    return "N/A";
  }

  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatJstResultDateTime(isoText: string | null): string {
  if (!isoText) {
    return "N/A";
  }

  const date = new Date(isoText);

  if (Number.isNaN(date.getTime())) {
    return "N/A";
  }

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const partMap = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return `${partMap.year}-${partMap.month}-${partMap.day} ${partMap.hour}:${partMap.minute}`;
}

function sortMyPicks(picks: Array<UserPickWithSignalRecord & { normalizedAction: PickAction }>) {
  const priority: Record<PickAction, number> = {
    conviction: 0,
    paper_in: 1,
    watch: 2,
  };

  return picks.sort((a, b) => {
    const priorityDiff = priority[a.normalizedAction] - priority[b.normalizedAction];

    if (priorityDiff !== 0) {
      return priorityDiff;
    }

    return new Date(b.clicked_at).getTime() - new Date(a.clicked_at).getTime();
  });
}

async function buildMyPicksEmbed(
  interaction: ChatInputCommandInteraction,
): Promise<InstanceType<typeof EmbedBuilder> | string> {
  const period = (interaction.options.getString("period") ?? "today") as MyPicksPeriod;
  const now = new Date();
  const todayJst = getJstDateString(now);
  const user = getOrCreateUser(interaction.user.id, now.toISOString(), todayJst);
  const rows = getUserPicksSince.all(
    interaction.user.id,
    getMyPicksPeriodStartIso(period, now),
  ) as UserPickWithSignalRecord[];
  const normalizedPicks = rows
    .map((pick) => ({ ...pick, normalizedAction: normalizeAction(pick.action) }))
    .filter((pick): pick is UserPickWithSignalRecord & { normalizedAction: PickAction } =>
      pick.normalizedAction !== null,
    );

  if (normalizedPicks.length === 0) {
    return `${getMyPicksPeriodLabel(period)}のPaper Pickはまだありません。`;
  }

  const marketDataByToken = new Map<string, DexScreenerMarketData | null>();

  for (const pick of normalizedPicks) {
    if (!marketDataByToken.has(pick.token_address)) {
      marketDataByToken.set(pick.token_address, await fetchDexScreenerMarketData(pick.token_address));
    }
  }

  const picksWithReturn = sortMyPicks(normalizedPicks).map((pick) => {
    const currentMcap = marketDataByToken.get(pick.token_address)?.marketCap ?? null;
    const returnX = pick.normalizedAction === "watch"
      ? null
      : calculateReturnX(currentMcap, pick.entry_mcap);

    return {
      ...pick,
      currentMcap,
      returnX,
    };
  });
  const rankedPicks = picksWithReturn.filter((pick) =>
    pick.normalizedAction !== "watch" && pick.returnX !== null,
  );
  const bestPick = rankedPicks.sort((a, b) => (b.returnX ?? 0) - (a.returnX ?? 0))[0] ?? null;
  const displayedPicks = picksWithReturn.slice(0, 15);

  return new EmbedBuilder()
    .setTitle(`📌 ${getMyPicksPeriodLabel(period)}のあなたのPaper Picks`)
    .setColor(0x9b59b6)
    .addFields(
      ...displayedPicks.map((pick) => {
        const symbol = pick.symbol ? `$${pick.symbol}` : shortenAddress(pick.token_address);
        const lines = pick.normalizedAction === "watch"
          ? [
            "ランキング対象外",
            `エントリーMCap: ${formatCompactUsd(pick.entry_mcap)}`,
            `現在MCap: ${formatCompactUsd(pick.currentMcap)}`,
            `使用: ${pick.used_points}pt`,
            `Pick日時: ${formatJstDateTime(pick.clicked_at)}`,
            `Scan日時: ${formatJstDateTime(pick.scan_time)}`,
          ]
          : [
            `エントリーMCap: ${formatCompactUsd(pick.entry_mcap)}`,
            `現在MCap: ${formatCompactUsd(pick.currentMcap)}`,
            `結果: ${formatReturnX(pick.returnX)}`,
            `使用: ${pick.used_points}pt`,
            `Pick日時: ${formatJstDateTime(pick.clicked_at)}`,
            `Scan日時: ${formatJstDateTime(pick.scan_time)}`,
          ];

        return {
          name: `${actionLabel(pick.normalizedAction)}\n${symbol}`,
          value: lines.join("\n"),
        };
      }),
      {
        name: "サマリー",
        value: [
          `使用ポイント: ${normalizedPicks.reduce((sum, pick) => sum + pick.used_points, 0)}pt`,
          `本日の残りポイント: ${Math.max(0, 5 - user.daily_points_used)}pt`,
          `ベストPick: ${
            bestPick
              ? `${bestPick.symbol ? `$${bestPick.symbol}` : shortenAddress(bestPick.token_address)} ${formatReturnX(bestPick.returnX)}`
              : "N/A"
          }`,
          normalizedPicks.length > displayedPicks.length
            ? `表示: 最新15件 / 全${normalizedPicks.length}件`
            : `表示: ${displayedPicks.length}件`,
        ].join("\n"),
      },
    )
    .setTimestamp(now);
}

async function getMyPicksReply(
  interaction: ChatInputCommandInteraction,
): Promise<{ content?: string; embeds?: [InstanceType<typeof EmbedBuilder>] }> {
  const result = await buildMyPicksEmbed(interaction);

  if (typeof result === "string") {
    return { content: result };
  }

  return { embeds: [result] };
}

function parseMemePickCustomId(customId: string): { action: PickAction; signalId: string } | null {
  const parts = customId.split(":");

  if (parts.length !== 3 || parts[0] !== "meme_pick") {
    return null;
  }

  const action = parts[1];
  const signalId = parts[2];

  if ((action !== "watch" && action !== "paper_in" && action !== "conviction") || !signalId) {
    return null;
  }

  return { action, signalId };
}

function getOrCreateUser(userId: string, nowIso: string, todayJst: string): UserRecord {
  const existingUser = getUserById.get(userId) as UserRecord | undefined;

  if (existingUser) {
    return normalizeDailyBudget(existingUser, todayJst);
  }

  insertUser.run(userId, nowIso, todayJst);

  return {
    user_id: userId,
    has_seen_guide: 0,
    daily_points_used: 0,
    last_reset_date: todayJst,
  };
}

function resetOwnDailyPointsForDevelopment(userId: string, now = new Date()): UserRecord {
  const todayJst = getJstDateString(now);
  const { startIso, endIso } = getJstDayRangeIso(now);
  const user = getOrCreateUser(userId, now.toISOString(), todayJst);

  const resetForDevelopment = db.transaction(() => {
    updateUserDailyBudget.run(0, todayJst, user.user_id);
    // JST基準の今日のPickを消すと、Convictionの1日1回制限も再テストできます。
    deleteUserPicksBetween.run(user.user_id, startIso, endIso);
  });

  resetForDevelopment();

  return {
    ...user,
    daily_points_used: 0,
    last_reset_date: todayJst,
  };
}

function hasConvictionToday(userId: string, todayJst: string, currentPickId?: string): boolean {
  const picks = getUserPicks.all(userId) as UserPickRecord[];

  return picks.some((pick) => (
    pick.pick_id !== currentPickId &&
    normalizeAction(pick.action) === "conviction" &&
    isSameJstDate(pick.clicked_at, todayJst)
  ));
}

function buildPickReply(
  action: PickAction,
  signal: SignalRecord,
  entryData: DexScreenerMarketData,
  usedPoints: number,
  remainingToday: number,
  includeGuide: boolean,
): string {
  const symbol = signal.symbol ? `$${signal.symbol}` : shortenAddress(signal.token_address);
  const lines = [formatPickActionTitle(action)];

  if (action === "watch") {
    lines.push(symbol);
    lines.push("このPickはランキング対象外です。");
  } else {
    lines.push(symbol);
    lines.push("");
    lines.push(`エントリー時MCap: ${formatCompactUsd(entryData.marketCap)}`);
    lines.push(`使用ポイント: ${usedPoints}pt`);
    lines.push(`本日の残りポイント: ${remainingToday}pt`);
  }

  if (includeGuide) {
    lines.push("");
    lines.push("初めてのPaper Pickです。");
    lines.push("このBotは実取引ではなく、エア判断を記録して成績を見る仕組みです。");
    lines.push("ルールは /meme-rules で確認できます。");
  }

  return lines.join("\n");
}

async function updatePickButtonCounts(interaction: Interaction, signalId: string): Promise<void> {
  if (!interaction.isButton()) {
    return;
  }

  try {
    await interaction.message.edit({
      components: [buildPaperPickButtons(signalId)],
    });
  } catch (error) {
    console.warn(`Pickボタン人数の更新に失敗しました: ${signalId}`, error);
  }
}

async function handleMemePickButton(interaction: Interaction): Promise<void> {
  if (!interaction.isButton()) {
    return;
  }

  const parsed = parseMemePickCustomId(interaction.customId);

  if (!parsed) {
    return;
  }

  const signal = getSignalById.get(parsed.signalId) as SignalRecord | undefined;

  if (!signal) {
    await interaction.reply({
      content: "このシグナルがDBに見つかりませんでした。もう一度 /meme-scan してください。",
      ephemeral: true,
    });
    return;
  }

  const now = new Date();
  const nowIso = now.toISOString();
  const todayJst = getJstDateString(now);
  const user = getOrCreateUser(interaction.user.id, nowIso, todayJst);
  const existingPick = getUserPickForSignal.get(
    interaction.user.id,
    signal.signal_id,
  ) as UserPickRecord | undefined;
  const existingAction = normalizeAction(existingPick?.action);
  const usedPoints = pointsForAction(parsed.action);
  const oldPointsToday = existingPick && isSameJstDate(existingPick.clicked_at, todayJst)
    ? existingPick.used_points
    : 0;
  const pointDiff = usedPoints - oldPointsToday;

  if (
    parsed.action === "conviction" &&
    existingAction !== "conviction" &&
    hasConvictionToday(interaction.user.id, todayJst, existingPick?.pick_id)
  ) {
    await interaction.reply({
      content: "Convictionは1日1回までです。",
      ephemeral: true,
    });
    return;
  }

  if (user.daily_points_used + pointDiff > 5) {
    await interaction.reply({
      content: [
        "今日のポイントが足りません。",
        "1日に使えるポイント: 5pt",
        `使用済みポイント: ${user.daily_points_used}pt`,
        `必要ポイント: ${usedPoints}pt`,
      ].join("\n"),
      ephemeral: true,
    });
    return;
  }

  const hasStoredEntry =
    existingPick?.entry_mcap !== null &&
    existingPick?.entry_mcap !== undefined &&
    existingPick?.entry_price !== null &&
    existingPick?.entry_price !== undefined;
  const upgradesFromWatch = existingAction === "watch" && parsed.action !== "watch";
  const needsEntryData =
    !existingPick ||
    upgradesFromWatch ||
    (parsed.action !== "watch" && !hasStoredEntry);
  const entryData = needsEntryData
    ? await getEntryMarketData(signal)
    : {
      marketCap: existingPick?.entry_mcap ?? null,
      price: existingPick?.entry_price ?? null,
    };
  const nextEntryMcap = parsed.action === "watch" && existingPick
    ? existingPick.entry_mcap
    : entryData.marketCap;
  const nextEntryPrice = parsed.action === "watch" && existingPick
    ? existingPick.entry_price
    : entryData.price;
  const nextDailyPointsUsed = Math.max(0, user.daily_points_used + pointDiff);
  const includeGuide = user.has_seen_guide === 0;

  const savePick = db.transaction(() => {
    if (existingPick) {
      updateUserPick.run(
        parsed.action,
        usedPoints,
        nowIso,
        nextEntryMcap,
        nextEntryPrice,
        existingPick.pick_id,
      );
    } else {
      insertUserPick.run(
        randomUUID(),
        signal.signal_id,
        interaction.user.id,
        parsed.action,
        usedPoints,
        nowIso,
        nextEntryMcap,
        nextEntryPrice,
      );
    }

    updateUserDailyBudget.run(nextDailyPointsUsed, todayJst, interaction.user.id);

    if (includeGuide) {
      markUserGuideSeen.run(interaction.user.id);
    }
  });

  savePick();
  await updatePickButtonCounts(interaction, signal.signal_id);

  await interaction.reply({
    content: buildPickReply(
      parsed.action,
      signal,
      { marketCap: nextEntryMcap, price: nextEntryPrice },
      usedPoints,
      5 - nextDailyPointsUsed,
      includeGuide,
    ),
    ephemeral: true,
  });
}

// Bot 本体です。今回は Slash Command だけなので最小の intents で起動します。
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const rest = new REST({ version: "10" }).setToken(token);
const scheduledJobRunKeys = new Set<string>();

type JstDateTimeParts = {
  date: string;
  day: number;
  weekday: string;
  hour: number;
  minute: number;
};

type ScheduledMemeEdgeJob = {
  id: string;
  hour: number;
  minute: number;
  run(): Promise<void>;
  shouldRun?: (parts: JstDateTimeParts) => boolean;
};

function getJstDateTimeParts(now = new Date()): JstDateTimeParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? "";
  const year = value("year");
  const month = value("month");
  const day = value("day");

  return {
    date: `${year}-${month}-${day}`,
    day: Number(day),
    weekday: value("weekday"),
    hour: Number(value("hour")),
    minute: Number(value("minute")),
  };
}

async function getScheduledMemeEdgeChannel(): Promise<SendableChannel | null> {
  if (!MEME_EDGE_CHANNEL_ID) {
    return null;
  }

  const channel = await client.channels.fetch(MEME_EDGE_CHANNEL_ID);

  if (!isSendableChannel(channel)) {
    console.warn(`定時投稿先が投稿可能なチャンネルではありません: ${MEME_EDGE_CHANNEL_ID}`);
    return null;
  }

  return channel;
}

function getScheduledJobs(): ScheduledMemeEdgeJob[] {
  return [
    {
      id: "morning-scan",
      hour: 9,
      minute: 0,
      run: async () => {
        console.log("Running scheduled scan: Morning Scan");
        const channel = await getScheduledMemeEdgeChannel();

        if (channel) {
          await runMemeScan(channel, "Morning Scan");
        }
      },
    },
    {
      id: "eu-open-scan",
      hour: 16,
      minute: 0,
      run: async () => {
        console.log("Running scheduled scan: EU Open Scan");
        const channel = await getScheduledMemeEdgeChannel();

        if (channel) {
          await runMemeScan(channel, "EU Open Scan");
        }
      },
    },
    {
      id: "us-prime-scan",
      hour: 23,
      minute: 0,
      run: async () => {
        console.log("Running scheduled scan: US Prime Scan");
        const channel = await getScheduledMemeEdgeChannel();

        if (channel) {
          await runMemeScan(channel, "US Prime Scan");
        }
      },
    },
    {
      id: "daily-recap",
      hour: 9,
      minute: 30,
      run: async () => {
        console.log("Running scheduled recap: daily");
        const channel = await getScheduledMemeEdgeChannel();

        if (channel) {
          await runMemeRecap(channel, "daily");
        }
      },
    },
    {
      id: "weekly-recap",
      hour: 21,
      minute: 0,
      shouldRun: (parts) => parts.weekday === "Sun",
      run: async () => {
        console.log("Running scheduled recap: weekly");
        const channel = await getScheduledMemeEdgeChannel();

        if (channel) {
          await runMemeRecap(channel, "weekly");
        }
      },
    },
    {
      id: "monthly-recap",
      hour: 21,
      minute: 0,
      shouldRun: (parts) => parts.day === 1,
      run: async () => {
        console.log("Running scheduled recap: monthly");
        const channel = await getScheduledMemeEdgeChannel();

        if (channel) {
          await runMemeRecap(channel, "monthly");
        }
      },
    },
  ];
}

async function runScheduledMemeEdgeJobs(now = new Date()): Promise<void> {
  const parts = getJstDateTimeParts(now);

  for (const job of getScheduledJobs()) {
    if (parts.hour !== job.hour || parts.minute !== job.minute) {
      continue;
    }

    if (job.shouldRun && !job.shouldRun(parts)) {
      continue;
    }

    const runKey = `${parts.date}T${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}:${job.id}`;

    if (scheduledJobRunKeys.has(runKey)) {
      continue;
    }

    scheduledJobRunKeys.add(runKey);

    try {
      await job.run();
    } catch (error) {
      console.error(`定時ジョブに失敗しました: ${job.id}`, error);
    }
  }
}

function startMemeEdgeScheduler(): void {
  if (!MEME_EDGE_CHANNEL_ID) {
    console.log("MEME_EDGE_CHANNEL_ID が未設定のため定時投稿は無効です");
    console.log("Skipped scheduled jobs: MEME_EDGE_CHANNEL_ID is not set");
    return;
  }

  console.log(`Scheduler enabled for channel: ${MEME_EDGE_CHANNEL_ID}`);

  // この簡易schedulerはBotプロセスが動いている間だけ有効です。
  // 再起動中の予定は実行されません。
  // 本番ではcron / persistent scheduler / job queueへの移行が望ましいです。
  void runScheduledMemeEdgeJobs();
  setInterval(() => {
    void runScheduledMemeEdgeJobs();
  }, 60 * 1000);
}

client.once("ready", async () => {
  if (!client.user) {
    return;
  }

  // 起動時に Slash Command を登録します。グローバル登録なので反映に少し時間がかかる場合があります。
  await rest.put(Routes.applicationCommands(clientId), { body: commands });

  console.log(`Logged in as ${client.user.tag}`);
  console.log("Registered slash commands");
  console.log(`Meme Edge DB ready: ${DB_PATH}`);
  startMemeEdgeScheduler();
});

client.on("interactionCreate", async (interaction: Interaction) => {
  if (interaction.isButton() && interaction.customId.startsWith("meme_pick:")) {
    try {
      await handleMemePickButton(interaction);
    } catch (error) {
      console.error(error);

      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: "Paper Pickの保存に失敗しました。少し後でもう一度試してください。",
          ephemeral: true,
        });
      }
    }

    return;
  }

  if (!interaction.isChatInputCommand()) {
    return;
  }

  if (interaction.commandName === "ping") {
    await interaction.reply("pong");
    return;
  }

  if (interaction.commandName === "desk-test") {
    await interaction.deferReply();

    try {
      const message = await getDeskTestMessage();
      await interaction.editReply(message);
    } catch (error) {
      console.error(error);
      const message = error instanceof Error ? error.message : "不明なエラー";

      await interaction.editReply(`Nansenデータの取得に失敗しました: ${message}`);
    }
  }

  if (interaction.commandName === "meme-rules") {
    await interaction.reply({
      content: getMemeRulesMessage(),
      ephemeral: true,
    });
    return;
  }

  if (interaction.commandName === "meme-results") {
    await interaction.deferReply();

    try {
      const reply = await getMemeResultsReply(interaction);
      const [firstEmbed, ...remainingEmbeds] = reply.embeds ?? [];
      const firstReply = firstEmbed ? { embeds: [firstEmbed] } : { embeds: [] };

      await interaction.editReply(
        reply.content ? { ...firstReply, content: reply.content } : firstReply,
      );

      for (const embed of remainingEmbeds) {
        await interaction.followUp({ embeds: [embed] });
      }
    } catch (error) {
      console.error(error);
      const message = error instanceof Error ? error.message : "不明なエラー";

      await interaction.editReply(`meme-results に失敗しました: ${message}`);
    }

    return;
  }

  if (interaction.commandName === "meme-recap") {
    await interaction.deferReply();

    try {
      const reply = await buildMemeRecapEmbed(interaction);

      await interaction.editReply(reply);
    } catch (error) {
      console.error(error);
      const message = error instanceof Error ? error.message : "不明なエラー";

      await interaction.editReply(`/meme-recap に失敗しました: ${message}`);
    }

    return;
  }

  if (interaction.commandName === "my-picks") {
    await interaction.deferReply({ ephemeral: true });

    try {
      const reply = await getMyPicksReply(interaction);

      await interaction.editReply(reply);
    } catch (error) {
      console.error(error);
      const message = error instanceof Error ? error.message : "不明なエラー";

      await interaction.editReply(`/my-picks に失敗しました: ${message}`);
    }

    return;
  }

  if (interaction.commandName === "leaderboard") {
    await interaction.deferReply();

    try {
      const reply = await getLeaderboardReply(interaction);

      await interaction.editReply(reply);
    } catch (error) {
      console.error(error);
      const message = error instanceof Error ? error.message : "不明なエラー";

      await interaction.editReply(`/leaderboard に失敗しました: ${message}`);
    }

    return;
  }

  if (interaction.commandName === "my-performance") {
    await interaction.deferReply({ ephemeral: true });

    try {
      const reply = await getMyPerformanceReply(interaction);

      await interaction.editReply(reply);
    } catch (error) {
      console.error(error);
      const message = error instanceof Error ? error.message : "不明なエラー";

      await interaction.editReply(`/my-performance に失敗しました: ${message}`);
    }

    return;
  }

  if (interaction.commandName === "dev-reset-me") {
    try {
      resetOwnDailyPointsForDevelopment(interaction.user.id);

      await interaction.reply({
        content: [
          "開発用リセットを実行しました。",
          "本日の使用ポイントと今日のPick履歴をリセットしました。",
          "Convictionも再テストできます。",
        ].join("\n"),
        ephemeral: true,
      });
    } catch (error) {
      console.error(error);
      const message = error instanceof Error ? error.message : "不明なエラー";

      await interaction.reply({
        content: `/dev-reset-me に失敗しました: ${message}`,
        ephemeral: true,
      });
    }

    return;
  }

  if (interaction.commandName === "dev-post-result") {
    await interaction.deferReply({ ephemeral: true });

    try {
      const window = interaction.options.getString("window", true) as ResultWindow;
      const latestScan = getLatestScan.get() as ScanRecord | undefined;

      if (!latestScan) {
        await interaction.editReply("まだ保存されたスキャンがありません。先に /meme-scan を実行してください。");
        return;
      }

      const channel = interaction.channel;

      if (!isSendableChannel(channel)) {
        await interaction.editReply("このチャンネルにはResultを投稿できません。テキストチャンネルで実行してください。");
        return;
      }

      await postScanResult(latestScan.scan_id, window, channel);
      await interaction.editReply([
        "開発用のため再投稿しました。",
        `scan_id: ${latestScan.scan_id}`,
        `window: ${window}`,
      ].join("\n"));
    } catch (error) {
      console.error(error);
      const message = error instanceof Error ? error.message : "不明なエラー";

      await interaction.editReply(`/dev-post-result に失敗しました: ${message}`);
    }

    return;
  }

  if (interaction.commandName === "dev-run-scheduled-scan") {
    await interaction.deferReply({ ephemeral: true });

    try {
      const labelChoice = (interaction.options.getString("label") ?? "manual") as DevScanLabelChoice;
      const labels: Record<DevScanLabelChoice, MemeScanLabel> = {
        morning: "Morning Scan",
        eu: "EU Open Scan",
        us: "US Prime Scan",
        manual: "Manual Scan",
      };
      const channel = interaction.channel;

      if (!isSendableChannel(channel)) {
        await interaction.editReply("このチャンネルにはスキャンを投稿できません。テキストチャンネルで実行してください。");
        return;
      }

      await interaction.editReply([
        "開発用コマンドを受け付けました。",
        `スキャン本体をこのチャンネルに投稿します: ${labels[labelChoice]}`,
      ].join("\n"));
      await runMemeScan(channel, labels[labelChoice]);
    } catch (error) {
      console.error(error);
      const message = error instanceof Error ? error.message : "不明なエラー";

      await interaction.editReply(`/dev-run-scheduled-scan に失敗しました: ${message}`);
    }

    return;
  }

  if (interaction.commandName === "dev-run-recap") {
    await interaction.deferReply({ ephemeral: true });

    try {
      const period = interaction.options.getString("period", true) as MemeRecapPeriod;
      const channel = interaction.channel;

      if (!isSendableChannel(channel)) {
        await interaction.editReply("このチャンネルにはRecapを投稿できません。テキストチャンネルで実行してください。");
        return;
      }

      await interaction.editReply([
        "開発用コマンドを受け付けました。",
        `Recap本体をこのチャンネルに投稿します: ${period}`,
      ].join("\n"));
      await runMemeRecap(channel, period);
    } catch (error) {
      console.error(error);
      const message = error instanceof Error ? error.message : "不明なエラー";

      await interaction.editReply(`/dev-run-recap に失敗しました: ${message}`);
    }

    return;
  }

  if (interaction.commandName === "meme-scan") {
    await interaction.deferReply();

    try {
      await runMemeScanWithPoster("Manual Scan", {
        channelId: interaction.channelId,
        guildId: interaction.guildId,
        sendFirst: (reply) => interaction.editReply(reply),
        sendNext: (reply) => interaction.followUp(reply),
      });
    } catch (error) {
      console.error(error);
      const message = error instanceof Error ? error.message : "不明なエラー";

      await interaction.editReply(`meme-scan に失敗しました: ${message}`);
    }
  }
});

client.login(token);

process.once("SIGINT", () => {
  db.close();
  process.exit(0);
});

process.once("SIGTERM", () => {
  db.close();
  process.exit(0);
});
