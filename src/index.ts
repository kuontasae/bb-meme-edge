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
const { readFileSync } = require("node:fs") as typeof import("node:fs");
const { readFile } = require("node:fs/promises") as typeof import("node:fs/promises");
const path = require("node:path") as typeof import("node:path");
const { promisify } = require("node:util") as typeof import("node:util");
const {
  DB_PATH,
  buildAlertPostgresStore,
  buildAlertSqliteStore,
  buildFreshScanPostgresStore,
  buildFreshScanSqliteStore,
  initDatabase,
} = require("./db") as typeof import("./db");

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
const NANSEN_NETFLOW_PAGE_LIMIT = 1000;
const AUTO_TUNING_VERSION = "auto-tuning-v1";
const AUTO_TUNING_DATA_WINDOW_HOURS = 24 * 30;
const MEME_EDGE_CHANNEL_ID = process.env.MEME_EDGE_CHANNEL_ID;
const AUTO_POST_RESULTS_ENABLED = process.env.AUTO_POST_RESULTS === "true";
const SOLANA_NETFLOW_SAMPLE_PATH = path.join(
  process.cwd(),
  "data",
  "solana-netflow-sample.json",
);
const SCORING_CONFIG_PATH = path.join(process.cwd(), "config", "scoring.json");

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;

if (!token || !clientId) {
  throw new Error(".env に DISCORD_TOKEN と DISCORD_CLIENT_ID を設定してください。");
}

// Discord に登録する Slash Command はここで定義します。
const commands = [
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
    .setName("my")
    .setDescription("自分のPick履歴と成績をまとめて表示します")
    .toJSON(),
  new SlashCommandBuilder()
    .setName("leaderboard")
    .setDescription("エアIN / Convictionのコミュニティランキングを表示します")
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
  dexscreener_url?: unknown;
  dexscreenerUrl?: unknown;
  metadata?: unknown;
  token_metadata?: unknown;
};

type NansenDataSource = "mock" | "cache" | "live";
type NansenFetchMode = "mock" | "live";
type MemeStatus = "🟢 強め" | "🟡 監視候補" | "🟠 高リスク・様子見" | "🔴 弱い";

type NansenFetchMetadata = {
  requestedCandidatePoolSize: number;
  actualCandidatePoolSize: number;
  nansenPageLimit: number;
  nansenPaginationUsed: boolean;
  nansenFetchWarning: string | null;
};

type CachedNansenResult = {
  rows: NetflowRow[];
  metadata: NansenFetchMetadata;
  mode: NansenFetchMode;
  expiresAt: number;
};

type CachedTokenInformationResult = {
  value: TokenInformationSnapshot | null;
  mode: NansenFetchMode;
  expiresAt: number;
};

type NarrativeConfidence = "High" | "Medium" | "Low";
type NarrativeType =
  | "animal"
  | "celebrity"
  | "ai"
  | "gaming"
  | "political"
  | "sports"
  | "anime"
  | "brand"
  | "space"
  | "aquatic"
  | "pump_fun"
  | "abstract"
  | "flow_driven"
  | "unknown";

type NarrativeSocialLinks = {
  website?: string | undefined;
  twitter?: string | undefined;
  telegram?: string | undefined;
  dexscreener?: string | undefined;
  gmgn?: string | undefined;
  universalx?: string | undefined;
  xSearch?: string | undefined;
};

type TokenInformationSnapshot = {
  tokenAddress: string;
  name: string | null;
  symbol: string | null;
  description: string | null;
  logoUrl: string | null;
  deploymentDate: string | null;
  websiteUrl: string | null;
  twitterUrl: string | null;
  telegramUrl: string | null;
  marketCap: number | null;
  fdv: number | null;
  volume: number | null;
  buys: number | null;
  sells: number | null;
  uniqueTraders: number | null;
  liquidity: number | null;
  holders: number | null;
  raw: unknown;
};

type TokenProfileContext = {
  source: "DexScreener" | "GMGN" | "token metadata";
  description: string | null;
  imageUrl: string | null;
  links: NarrativeSocialLinks;
};

type TokenNarrative = {
  narrativeSummary: string;
  narrativeType: NarrativeType;
  narrativeSources: string[];
  narrativeEvidence: string[];
  narrativeTags: string[];
  socialLinks: NarrativeSocialLinks;
  internalConfidence: NarrativeConfidence;
};

function createHiddenTokenNarrative(): TokenNarrative {
  return {
    narrativeSummary: "",
    narrativeType: "unknown",
    narrativeSources: [],
    narrativeEvidence: [],
    narrativeTags: [],
    socialLinks: {},
    internalConfidence: "Low",
  };
}

type ScoreBreakdown = {
  flowMcap: number;
  smartMoney: number;
  mcapSweetSpot: number;
  earlyness: number;
  traderConfirmation: number;
  flowIntelligenceQuality: number;
  holderQuality: number;
  riskAdjustment: number;
  riskLabel: "Low" | "Medium" | "High";
};

type ScoringBucket = {
  label: string;
  min: number;
  max: number | null;
  score: number;
};

type McapScoringBucket = ScoringBucket & {
  freshScanAllowed: boolean;
  alertAllowed: boolean;
};

type AgeScoringBucket = {
  label: string;
  minDays: number;
  maxDays: number | null;
  score: number;
};

type ScoringConfig = {
  scoreWeights: {
    flowMcap: number;
    smartMoneyFlow: number;
    mcapSweetSpot: number;
    freshnessAge: number;
    traderConfirmation: number;
    flowIntelligenceQuality: number;
    holderQuality: number;
    riskAdjustmentMaxPenalty: number;
  };
  mcapBuckets: McapScoringBucket[];
  ageBuckets: AgeScoringBucket[];
  flowMcapBuckets: ScoringBucket[];
  alertRules: {
    intervalMinutes: number;
    candidatePoolSize: number;
    nansenCandidateSize: number;
    freshScanDbCandidateSize: number;
    watchCandidateSize: number;
    preFilterSize: number;
    cliOracleCheckSize: number;
    cliOracleDedupeHours: number;
    minMcap: number;
    maxMcap: number;
    minLiquidityUsd: number;
    thinLiquidityThresholdUsd: number;
    minScore: number;
    minFlowMcap: number;
    min24hFlowUsd: number;
    minTraders: number;
    min1hFlowUsd: number;
    min4hFlowUsd: number;
    shortTermFlowOptional: boolean;
    maxMarketDataAgeMinutes: number;
    freshScanLookbackHours: number;
    watchCandidateLookbackHours: number;
    maxFreshScanDbCandidatesInPreFilter: number;
    maxWatchCandidatesInPreFilter: number;
    requireCliDeepCheck: boolean;
    requireDexTradesCheck: boolean;
    requireQualityGatePass: boolean;
    preferMaxAgeDays: number;
    dedupeHours: number;
    maxRiskSignalsPerRun: number;
    saveAllCandidates: boolean;
    trackAllCandidates: boolean;
    freshnessScore: {
      maxPoints: number;
      buckets: Array<{ maxMinutes: number | null; score: number }>;
    };
    reaccelerationRules: {
      enabled: boolean;
      minMcapMultipleFromSource: number;
      minFlow24hMultipleFromSource: number;
      minTradersMultipleFromSource: number;
      allowCliGradeImprovement: boolean;
    };
    reAlert: {
      enabled: boolean;
      minHoursSinceLastAlert: number;
      mcapMultipleFromLastAlert: number;
      flow24hMultipleFromLastAlert: number;
      tradersMultipleFromLastAlert: number;
      allowCliGradeImprovement: boolean;
    };
    maxAlertsPerRun: number;
  };
  freshScanRules: {
    mode: "posting" | "data_collection";
    postTopSignals: boolean;
    candidatePoolSize: number;
    momentumGateSize: number;
    preFilterSize: number;
    cliOracleCheckSize: number;
    dedupeHours: number;
    useCliOracle: boolean;
    maxCliCreditsPerRun: number;
    minMcap: number;
    maxSignalsPerRun: number;
    allowAboveMaxMcapIfStrong: boolean;
    minLiquidityUsd: number;
    min24hFlowUsd: number;
    minFlowMcap: number;
    minTraders: number;
    largeMcapThreshold: number;
    maxLargeMcapPerRun: number;
    maxPerSignalType: number;
    maxRiskSignalsPerRun: number;
    replacementScoreTolerance: number;
    forceDiversity: boolean;
    saveAllCandidates: boolean;
    trackAllCandidates: boolean;
    excludeClusterRiskHigh: boolean;
    maxMcap: number;
    preferMaxMcap: number;
    preferMaxAgeDays: number;
    allowReFlowIfStrong: boolean;
  };
  qualityGate: {
    rejectHolderRisk: string[];
    rejectSellPressure: string[];
    rejectBuyerSellerBalance: string[];
    rejectClusterRisk: string[];
    allowFlowQuality: string[];
    rejectIfConfidenceLowAndFlowWeak: boolean;
    mockFallbackGrade: AlertQualityGateGrade;
  };
  riskPenalties: {
    thinLiquidity: number;
    clusterRiskMedium: number;
    clusterRiskHigh: number;
    microArbHeavy: number;
    mirrorLikeHeavy: number;
    reFlowPenalty: number;
    highMcapPenalty: number;
  };
};

type SignalType =
  | "alert_edge"
  | "flow_watch"
  | "whale_flow"
  | "thin_liquidity"
  | "bot_like_flow";

type MemeResearchCard = {
  signalId: string;
  scanId: string;
  tokenAddress: string;
  symbol: string;
  name: string;
  narrative: string;
  narrativeSummary: string;
  narrativeType: NarrativeType;
  narrativeSources: string;
  narrativeEvidence: string;
  narrativeTags: string;
  narrativeConfidence: NarrativeConfidence;
  signalType: SignalType;
  edgeScore: number;
  status: MemeStatus;
  cliGrade: CliGrade;
  scoreBreakdown: string;
  summary: string;
  scanTime: string;
  marketCap: number | null;
  price: number | null;
  liquidity: number | null;
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
  ageDays: number | null;
  isReFlow: boolean;
};

type DexScreenerTokenPair = {
  info?: {
    imageUrl?: unknown;
    header?: unknown;
    openGraph?: unknown;
    websites?: unknown;
    socials?: unknown;
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
  volume?: {
    h24?: unknown;
  };
  url?: unknown;
};

type DeepCheckSourceName = "flow-intelligence" | "holders" | "who-bought-sold" | "dex-trades";
type DeepCheckGrade = "Strong" | "Medium" | "Weak" | "N/A";
type DeepCheckRisk = "Low" | "Medium" | "High" | "N/A";
type DeepCheckBalance = "Bullish" | "Neutral" | "Bearish" | "N/A";
type DeepCheckClusterRisk = "Low" | "Medium" | "High" | "未検証";
type DeepCheckConfidence = "High" | "Medium" | "Low";
type AlertQualityGateGrade = "Strong" | "Moderate" | "Rejected";
type WalletBehaviorType =
  | "Fresh Sniper"
  | "Accumulator"
  | "Fast Flipper"
  | "Micro-arb"
  | "Mirror-like"
  | "Unknown";

type WalletQualityLevel = "High" | "Medium" | "Low" | "N/A";

type DeepCheckSourceResult = {
  source: DeepCheckSourceName;
  success: boolean;
  data: unknown;
  error?: string;
};

type DeepCheckTextResult<T extends string> = {
  label: T;
  text: string;
};

type DeepCheckReply = {
  tokenAddress: string;
  symbol: string | null;
  name: string | null;
  marketCap: number | null;
  signalId: string | null;
  flowQuality: DeepCheckTextResult<DeepCheckGrade>;
  holderQuality: DeepCheckTextResult<DeepCheckRisk>;
  buyerSellerBalance: DeepCheckTextResult<DeepCheckBalance>;
  sellPressure: DeepCheckTextResult<DeepCheckRisk>;
  clusterRisk: DeepCheckTextResult<DeepCheckClusterRisk>;
  walletQuality: WalletQualityAnalysis;
  narrative: TokenNarrative;
  finalNote: string;
  confidence: DeepCheckConfidence;
  rawSummary: string;
  rawSources?: Partial<Record<DeepCheckSourceName, unknown>>;
};

type WalletQualitySnapshot = {
  walletAddress: string;
  behaviorType: WalletBehaviorType;
  buyCount: number;
  sellCount: number;
  touchedTokenCount: number;
  avgTradeSize: number | null;
  wsolTradeRatio: number | null;
  mirrorGroupId: string | null;
};

type WalletQualityAnalysis = {
  walletCount: number;
  estimatedIndependentWallets: number | null;
  behaviorCounts: Record<WalletBehaviorType, number>;
  clusterRisk: DeepCheckClusterRisk;
  clusterReasons: string[];
  walletQualityLevel: WalletQualityLevel;
  walletQualitySummary: string;
  snapshots: WalletQualitySnapshot[];
};

type AlertQualityGateResult = {
  passed: boolean;
  grade: AlertQualityGateGrade;
  reasons: string[];
  warnings: string[];
};

type AlertCheckOptions = {
  isDev: boolean;
  allowMockFallback: boolean;
  maxAlerts: number;
};

type AlertCheckPosted = {
  card: MemeResearchCard;
  deepCheck: DeepCheckReply;
  gate: AlertQualityGateResult;
  candidate?: AlertV2Candidate;
};

type AlertCheckResult = {
  checkedCount: number;
  posted: AlertCheckPosted[];
  rejected: Array<{
    card: MemeResearchCard;
    deepCheck: DeepCheckReply;
    gate: AlertQualityGateResult;
  }>;
  cliExecuted: number;
  cliSkippedRecentDedupe: number;
  cliReusedRecentResult: number;
};

type AlertCandidateSourceType =
  | "nansen_new"
  | "fresh_scan_reaccelerated"
  | "watch_reaccelerated"
  | "cli_near_miss_recheck";

type AlertV2Candidate = {
  alertRunId: string;
  tokenAddress: string;
  symbol: string;
  name: string;
  candidateRank: number;
  candidateSourceType: AlertCandidateSourceType;
  candidateSources: AlertCandidateSourceType[];
  sourceQuotaBucket: string;
  sourcePriority: number;
  sourceDetectedAt: string;
  candidateFreshnessMinutes: number;
  marketDataRefreshedAt: string;
  marketDataAgeMinutes: number;
  marketDataSource: string | null;
  marketDataWarning: string | null;
  fromFreshScanId: string | null;
  fromScanCandidateId: string | null;
  fromPreviousAlertRunId: string | null;
  fromWatchPickId: string | null;
  isReaccelerated: boolean;
  reaccelerationReason: string | null;
  marketCap: number | null;
  price: number | null;
  ageDays: number | null;
  liquidity: number | null;
  volume24h: number | null;
  flow1h: number | null;
  flow4h: number | null;
  flow24h: number | null;
  flow7d: number | null;
  flowMcapRatio: number | null;
  traderCount: number | null;
  gate0Status: "pass" | "reject";
  gate0Reason: string;
  alertMomentumScore: number;
  alertMomentumComponents: Record<string, number>;
  smartMoneyQualityScore: number | null;
  smartWalletQualityScore: number | null;
  smartWalletQualityLabel: "Strong" | "Medium" | "Weak" | "Unknown" | null;
  strongWalletCount: number;
  mediumWalletCount: number;
  weakWalletCount: number;
  knownWalletCount: number;
  walletPdcaSummary: Record<string, unknown> | null;
  autoTuningAdjustment: number;
  autoTuningReasons: string[];
  autoTuningVersion: string | null;
  preFilterStatus: "pass" | "fail";
  preFilterRank: number | null;
  preFilterReason: string;
  cliChecked: boolean;
  cliGrade: CliGrade;
  cliOracleStatus: string;
  rawCliSummary: string | null;
  flowQuality: string | null;
  holderRisk: string | null;
  buyerSellerBalance: string | null;
  sellPressure: string | null;
  walletQuality: string | null;
  clusterRisk: string | null;
  qualityGateGrade: AlertQualityGateGrade | null;
  qualityGateReasons: string[];
  qualityGateWarnings: string[];
  positiveFlags: string[];
  riskFlags: string[];
  warningFlags: string[];
  passReasonCodes: string[];
  rejectReasonCodes: string[];
  rankBucket: string | null;
  finalRank: number | null;
  posted: boolean;
  postedMessageId: string | null;
  entryMcap: number | null;
  entryPrice: number | null;
  tokenIconUrl: string | null;
  rawDexscreenerSnapshot: unknown;
  createdAt: string;
  card: MemeResearchCard;
  deepCheck?: DeepCheckReply;
  gate?: AlertQualityGateResult;
  isRealert: boolean;
  realertReason: string | null;
};

const DEFAULT_SCORING_CONFIG: ScoringConfig = {
  scoreWeights: {
    flowMcap: 20,
    smartMoneyFlow: 15,
    mcapSweetSpot: 15,
    freshnessAge: 15,
    traderConfirmation: 10,
    flowIntelligenceQuality: 10,
    holderQuality: 10,
    riskAdjustmentMaxPenalty: 15,
  },
  mcapBuckets: [
    { label: "$50K未満", min: 0, max: 50_000, score: 6, freshScanAllowed: false, alertAllowed: false },
    { label: "$50K〜$500K", min: 50_000, max: 500_000, score: 15, freshScanAllowed: true, alertAllowed: true },
    { label: "$500K〜$2M", min: 500_000, max: 2_000_000, score: 15, freshScanAllowed: true, alertAllowed: true },
    { label: "$2M〜$5M", min: 2_000_000, max: 5_000_000, score: 8, freshScanAllowed: true, alertAllowed: false },
    { label: "$5M〜$10M", min: 5_000_000, max: 10_000_000, score: 3, freshScanAllowed: true, alertAllowed: false },
    { label: "$10M以上", min: 10_000_000, max: null, score: 0, freshScanAllowed: false, alertAllowed: false },
  ],
  ageBuckets: [
    { label: "0〜1日", minDays: 0, maxDays: 1, score: 10 },
    { label: "1〜5日", minDays: 1, maxDays: 5, score: 8 },
    { label: "5日以上", minDays: 5, maxDays: null, score: 4 },
  ],
  flowMcapBuckets: [
    { label: "0〜0.3%", min: 0, max: 0.003, score: 2 },
    { label: "0.3〜1%", min: 0.003, max: 0.01, score: 6 },
    { label: "1〜3%", min: 0.01, max: 0.03, score: 12 },
    { label: "3〜5%", min: 0.03, max: 0.05, score: 17 },
    { label: "5%以上", min: 0.05, max: null, score: 20 },
  ],
  alertRules: {
    intervalMinutes: 20,
    candidatePoolSize: 300,
    nansenCandidateSize: 240,
    freshScanDbCandidateSize: 40,
    watchCandidateSize: 20,
    preFilterSize: 15,
    cliOracleCheckSize: 3,
    cliOracleDedupeHours: 12,
    minMcap: 30_000,
    maxMcap: 2_000_000,
    minLiquidityUsd: 15_000,
    thinLiquidityThresholdUsd: 40_000,
    minScore: 75,
    minFlowMcap: 0.03,
    min24hFlowUsd: 5_000,
    minTraders: 2,
    min1hFlowUsd: 1_500,
    min4hFlowUsd: 3_000,
    shortTermFlowOptional: true,
    maxMarketDataAgeMinutes: 10,
    freshScanLookbackHours: 24,
    watchCandidateLookbackHours: 48,
    maxFreshScanDbCandidatesInPreFilter: 5,
    maxWatchCandidatesInPreFilter: 3,
    requireCliDeepCheck: true,
    requireDexTradesCheck: true,
    requireQualityGatePass: true,
    preferMaxAgeDays: 30,
    dedupeHours: 24,
    maxRiskSignalsPerRun: 0,
    saveAllCandidates: true,
    trackAllCandidates: true,
    freshnessScore: {
      maxPoints: 10,
      buckets: [
        { maxMinutes: 15, score: 10 },
        { maxMinutes: 60, score: 7 },
        { maxMinutes: 360, score: 4 },
        { maxMinutes: 1440, score: 2 },
        { maxMinutes: null, score: 0 },
      ],
    },
    reaccelerationRules: {
      enabled: true,
      minMcapMultipleFromSource: 1.5,
      minFlow24hMultipleFromSource: 1.5,
      minTradersMultipleFromSource: 1.5,
      allowCliGradeImprovement: true,
    },
    reAlert: {
      enabled: true,
      minHoursSinceLastAlert: 4,
      mcapMultipleFromLastAlert: 2,
      flow24hMultipleFromLastAlert: 2,
      tradersMultipleFromLastAlert: 2,
      allowCliGradeImprovement: true,
    },
    maxAlertsPerRun: 2,
  },
  freshScanRules: {
    mode: "data_collection",
    postTopSignals: false,
    candidatePoolSize: 1500,
    momentumGateSize: 150,
    preFilterSize: 25,
    cliOracleCheckSize: 0,
    dedupeHours: 24,
    useCliOracle: true,
    maxCliCreditsPerRun: 150,
    minMcap: 30_000,
    maxSignalsPerRun: 5,
    maxMcap: 50_000_000,
    allowAboveMaxMcapIfStrong: true,
    minLiquidityUsd: 20_000,
    min24hFlowUsd: 1_000,
    minFlowMcap: 0.003,
    minTraders: 2,
    largeMcapThreshold: 10_000_000,
    maxLargeMcapPerRun: 2,
    maxPerSignalType: 4,
    maxRiskSignalsPerRun: 1,
    replacementScoreTolerance: 5,
    forceDiversity: false,
    saveAllCandidates: true,
    trackAllCandidates: true,
    excludeClusterRiskHigh: true,
    preferMaxMcap: 2_000_000,
    preferMaxAgeDays: 30,
    allowReFlowIfStrong: true,
  },
  qualityGate: {
    rejectHolderRisk: ["High"],
    rejectSellPressure: ["High"],
    rejectBuyerSellerBalance: ["Bearish"],
    rejectClusterRisk: ["High"],
    allowFlowQuality: ["Strong", "Medium"],
    rejectIfConfidenceLowAndFlowWeak: true,
    mockFallbackGrade: "Moderate",
  },
  riskPenalties: {
    thinLiquidity: 8,
    clusterRiskMedium: 5,
    clusterRiskHigh: 15,
    microArbHeavy: 10,
    mirrorLikeHeavy: 12,
    reFlowPenalty: 4,
    highMcapPenalty: 10,
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function loadScoringConfig(): ScoringConfig {
  try {
    const raw = readFileSync(SCORING_CONFIG_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<ScoringConfig>;

    if (!isRecord(parsed)) {
      throw new Error("scoring config root is not an object");
    }

    // 不足キーは安全なデフォルトで埋め、壊れた配列は丸ごとデフォルトに戻します。
    return {
      ...DEFAULT_SCORING_CONFIG,
      ...parsed,
      scoreWeights: { ...DEFAULT_SCORING_CONFIG.scoreWeights, ...(isRecord(parsed.scoreWeights) ? parsed.scoreWeights : {}) },
      alertRules: { ...DEFAULT_SCORING_CONFIG.alertRules, ...(isRecord(parsed.alertRules) ? parsed.alertRules : {}) },
      freshScanRules: { ...DEFAULT_SCORING_CONFIG.freshScanRules, ...(isRecord(parsed.freshScanRules) ? parsed.freshScanRules : {}) },
      qualityGate: { ...DEFAULT_SCORING_CONFIG.qualityGate, ...(isRecord(parsed.qualityGate) ? parsed.qualityGate : {}) },
      riskPenalties: { ...DEFAULT_SCORING_CONFIG.riskPenalties, ...(isRecord(parsed.riskPenalties) ? parsed.riskPenalties : {}) },
      mcapBuckets: Array.isArray(parsed.mcapBuckets) ? parsed.mcapBuckets : DEFAULT_SCORING_CONFIG.mcapBuckets,
      ageBuckets: Array.isArray(parsed.ageBuckets) ? parsed.ageBuckets : DEFAULT_SCORING_CONFIG.ageBuckets,
      flowMcapBuckets: Array.isArray(parsed.flowMcapBuckets) ? parsed.flowMcapBuckets : DEFAULT_SCORING_CONFIG.flowMcapBuckets,
    } as ScoringConfig;
  } catch (error) {
    const message = error instanceof Error ? error.message : "不明なエラー";

    console.warn(`config/scoring.json を読めないためデフォルト設定で起動します: ${message}`);
    return DEFAULT_SCORING_CONFIG;
  }
}

const scoringConfig = loadScoringConfig();

type DexScreenerTokenResponse = {
  pairs?: DexScreenerTokenPair[] | null;
};

type MemeScanReply = {
  content?: string;
  embeds?: [InstanceType<typeof EmbedBuilder>];
  components?: Array<DiscordActionRowBuilder<DiscordButtonBuilder>>;
};

type PickAction = "watch" | "paper_in" | "conviction";
type AlertType = "alert_edge";
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
  scan_id?: string | null;
  token_address: string;
  symbol: string | null;
  name?: string | null;
  signal_type?: string | null;
  scan_time?: string | null;
  scan_mcap: number | null;
  scan_price: number | null;
  flow_24h?: number | null;
  flow_7d?: number | null;
  flow_mcap_ratio?: number | null;
  trader_count?: number | null;
  token_age?: string | null;
  message_id: string | null;
  channel_id: string | null;
};

type ResultSignalRecord = SignalRecord & {
  scan_id: string;
  name: string | null;
  narrative: string | null;
  signal_type: string | null;
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
  liquidity: number | null;
  volume24h: number | null;
  pairUrl: string | null;
  raw?: unknown;
};

type MarketDataEnrichment = {
  marketCap: number | null;
  price: number | null;
  entryPrice: number | null;
  liquidity: number | null;
  volume24h: number | null;
  pairUrl: string | null;
  refreshedAt: string;
  ageMinutes: number;
  source: string | null;
  warning: string | null;
  warningFlags: string[];
  rawSnapshot: unknown;
};

type SignalPerformance = {
  signal: ResultSignalRecord;
  currentMcap: number | null;
  currentPrice: number | null;
  botReturnX: number | null;
  paperInAvg: number | null;
  paperInAvgCount: number;
  convictionAvg: number | null;
  convictionAvgCount: number;
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
  nansenSignalReview: string;
  learningSummary: string;
};

type DeepCheckRecord = {
  signal_id: string | null;
  cluster_risk: string | null;
  created_at: string;
};

type WalletQualitySnapshotRecord = {
  signal_id: string | null;
  behavior_type: string | null;
  cluster_risk: string | null;
  created_at: string;
};

type PerformanceSnapshotRecord = {
  current_mcap: number | null;
  current_price: number | null;
  bot_return_x: number | null;
};

type NansenCreditTrackingResult<T> = {
  result: T;
  beforeCredits: number | null;
  afterCredits: number | null;
  usedCredits: number | null;
};

type NansenCreditLogRecord = {
  command_name: string;
  before_credits: number | null;
  after_credits: number | null;
  used_credits: number | null;
  use_mock_nansen: number;
  created_at: string;
};

type LearningBucketStats = {
  label: string;
  count: number;
  average: number | null;
  median: number | null;
  above1x: number;
  above2x: number;
  bestSymbol: string | null;
  bestReturn: number | null;
};

type LearningSummaryData = {
  signalType: LearningBucketStats[];
  mcap: LearningBucketStats[];
  age: LearningBucketStats[];
  flowMcap: LearningBucketStats[];
  clusterRisk: LearningBucketStats[];
  walletBehavior: LearningBucketStats[];
  nextScoreAdjustment: string;
};

type MemeScanResult = {
  replies: MemeScanReply[];
  scanId: string;
  scanTime: string;
  source: NansenDataSource;
  signalIds: string[];
  candidateCount: number;
  gate0PassCount: number;
  momentumGatePassCount: number;
  preFilterPassCount: number;
  postTopSignals: boolean;
};

type CliGrade = "A" | "B" | "C" | "Reject" | "Unchecked";

type FreshScanCandidate = {
  scanId: string;
  candidateRank: number;
  row: NetflowRow;
  tokenAddress: string;
  symbol: string;
  name: string;
  candidateSources: string[];
  marketCap: number | null;
  price: number | null;
  liquidity: number | null;
  volume24h: number | null;
  marketDataRefreshedAt: string | null;
  marketDataAgeMinutes: number | null;
  marketDataSource: string | null;
  marketDataWarning: string | null;
  flow24h: number | null;
  flow7d: number | null;
  flowMcapRatio: number | null;
  traderCount: number | null;
  ageDays: number | null;
  warningFlags: string[];
  rawDexscreenerSnapshot: unknown;
  gate0Status: "pass" | "reject";
  gate0Reason: string;
  hardRejectStatus: "pass" | "reject" | "penalized";
  hardRejectReason: string;
  riskFlags: string[];
  momentumScore: number;
  momentumGateStatus: "pass" | "fail";
  momentumGateReason: string;
  rankComponents: Record<string, number>;
  preFilterStatus: "pass" | "fail";
  preFilterRank: number | null;
  preFilterReason: string;
  cliCandidateScore: number;
  whySelectedForCli: string | null;
  cliChecked: boolean;
  cliGrade: CliGrade;
  cliOracleStatus: string;
  cliRejectReason: string | null;
  finalRank: number | null;
  finalRankReason: string | null;
  posted: boolean;
  postedMessageId: string | null;
  score: number;
  signalType: SignalType;
  exclusionReason: string | null;
  createdAt: string;
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
const cachedTokenInformation = new Map<string, CachedTokenInformationResult>();
const db = initDatabase();
const sqliteFreshScanStore = buildFreshScanSqliteStore(db);
const postgresFreshScanStore = process.env.DATABASE_URL ? buildFreshScanPostgresStore(process.env.DATABASE_URL) : null;
const sqliteAlertStore = buildAlertSqliteStore(db);
const postgresAlertStore = process.env.DATABASE_URL ? buildAlertPostgresStore(process.env.DATABASE_URL) : null;
const freshScanStore = {
  provider: postgresFreshScanStore?.provider ?? sqliteFreshScanStore.provider,
  async saveRun(run: Parameters<typeof sqliteFreshScanStore.saveRun>[0], candidates: Parameters<typeof sqliteFreshScanStore.saveRun>[1]): Promise<void> {
    if (postgresFreshScanStore?.provider === "postgres") {
      try {
        await postgresFreshScanStore.saveRun(run, candidates);
      } catch (error) {
        const message = error instanceof Error ? error.message : "不明なエラー";

        console.warn(`Postgres Fresh Scan保存に失敗しました。SQLite fallbackを使います: ${message}`);
      }
    }

    await sqliteFreshScanStore.saveRun(run, candidates);
  },
  async savePerformanceSnapshot(snapshot: Parameters<typeof sqliteFreshScanStore.savePerformanceSnapshot>[0]): Promise<void> {
    if (postgresFreshScanStore?.provider === "postgres") {
      try {
        await postgresFreshScanStore.savePerformanceSnapshot(snapshot);
      } catch (error) {
        const message = error instanceof Error ? error.message : "不明なエラー";

        console.warn(`Postgres Fresh Scan snapshot保存に失敗しました。SQLite fallbackを使います: ${message}`);
      }
    }

    await sqliteFreshScanStore.savePerformanceSnapshot(snapshot);
  },
  async refreshSmartWalletProfiles(): Promise<void> {
    if (postgresFreshScanStore?.provider === "postgres" && "refreshSmartWalletProfiles" in postgresFreshScanStore) {
      try {
        await postgresFreshScanStore.refreshSmartWalletProfiles();
      } catch (error) {
        const message = error instanceof Error ? error.message : "不明なエラー";

        console.warn(`Postgres Smart Wallet profile更新に失敗しました。SQLite fallbackを使います: ${message}`);
      }
    }

    if ("refreshSmartWalletProfiles" in sqliteFreshScanStore) {
      await sqliteFreshScanStore.refreshSmartWalletProfiles();
    }
  },
};
const alertStore = {
  provider: postgresAlertStore?.provider ?? sqliteAlertStore.provider,
  async saveRun(run: Parameters<typeof sqliteAlertStore.saveRun>[0], candidates: Parameters<typeof sqliteAlertStore.saveRun>[1]): Promise<void> {
    if (postgresAlertStore?.provider === "postgres") {
      try {
        await postgresAlertStore.saveRun(run, candidates);
      } catch (error) {
        const message = error instanceof Error ? error.message : "不明なエラー";

        console.warn(`Postgres Alert保存に失敗しました。SQLite fallbackを使います: ${message}`);
      }
    }

    await sqliteAlertStore.saveRun(run, candidates);
  },
  async savePerformanceSnapshot(snapshot: Parameters<typeof sqliteAlertStore.savePerformanceSnapshot>[0]): Promise<void> {
    if (postgresAlertStore?.provider === "postgres") {
      try {
        await postgresAlertStore.savePerformanceSnapshot(snapshot);
      } catch (error) {
        const message = error instanceof Error ? error.message : "不明なエラー";

        console.warn(`Postgres Alert snapshot保存に失敗しました。SQLite fallbackを使います: ${message}`);
      }
    }

    await sqliteAlertStore.savePerformanceSnapshot(snapshot);
  },
  async saveSmartWalletObservations(observations: Parameters<typeof sqliteAlertStore.saveSmartWalletObservations>[0]): Promise<void> {
    if (postgresAlertStore?.provider === "postgres" && "saveSmartWalletObservations" in postgresAlertStore) {
      try {
        await postgresAlertStore.saveSmartWalletObservations(observations);
      } catch (error) {
        const message = error instanceof Error ? error.message : "不明なエラー";

        console.warn(`Postgres Smart Wallet observations保存に失敗しました。SQLite fallbackを使います: ${message}`);
      }
    }

    await sqliteAlertStore.saveSmartWalletObservations(observations);
  },
  async refreshSmartWalletProfiles(): Promise<void> {
    if (postgresAlertStore?.provider === "postgres" && "refreshSmartWalletProfiles" in postgresAlertStore) {
      try {
        await postgresAlertStore.refreshSmartWalletProfiles();
      } catch (error) {
        const message = error instanceof Error ? error.message : "不明なエラー";

        console.warn(`Postgres Smart Wallet profile更新に失敗しました。SQLite fallbackを使います: ${message}`);
      }
    }

    await sqliteAlertStore.refreshSmartWalletProfiles();
  },
};
const insertAlertPumpNotification = db.prepare(`
  INSERT OR IGNORE INTO alert_pump_notifications (
    notification_id,
    alert_candidate_id,
    alert_run_id,
    token_address,
    threshold_x,
    return_x,
    entry_mcap,
    peak_mcap,
    time_to_peak_hours,
    snapshot_label,
    channel_id,
    message_id,
    notified_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
`);
const updateAlertPumpNotificationMessage = db.prepare(`
  UPDATE alert_pump_notifications
  SET message_id = ?
  WHERE alert_candidate_id = ? AND threshold_x = ?
`);
const insertSignal = db.prepare(`
  INSERT INTO signals (
    signal_id,
    scan_id,
    token_address,
    symbol,
    name,
    chain,
    narrative,
    narrative_summary,
    narrative_type,
    narrative_sources,
    narrative_evidence,
    narrative_tags,
    narrative_confidence,
    signal_type,
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
    @narrativeSummary,
    @narrativeType,
    @narrativeSources,
    @narrativeEvidence,
    @narrativeTags,
    @narrativeConfidence,
    @signalType,
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
  SELECT signal_id, scan_id, token_address, symbol, signal_type, scan_time, scan_mcap, scan_price, message_id, channel_id
  FROM signals
  WHERE signal_id = ?
`);
const getRecentSignalByToken = db.prepare(`
  SELECT signal_id
  FROM signals
  WHERE token_address = ? AND scan_time >= ?
  LIMIT 1
`);
const getRecentAlertByToken = db.prepare(`
  SELECT alert_id
  FROM alerts
  WHERE token_address = ? AND triggered_at >= ?
  LIMIT 1
`);
const getLatestAlertByToken = db.prepare(`
  SELECT alert_id, alert_run_id, token_address, mcap, flow_24h, traders, cli_grade, triggered_at
  FROM alerts
  WHERE token_address = ?
  ORDER BY triggered_at DESC
  LIMIT 1
`);
const getRecentAlertCliCandidate = db.prepare(`
  SELECT
    token_address,
    cli_checked,
    cli_grade,
    cli_oracle_status,
    raw_cli_summary,
    flow_quality,
    holder_risk,
    buyer_seller_balance,
    sell_pressure,
    wallet_quality,
    cluster_risk,
    quality_gate_grade,
    quality_gate_reasons,
    quality_gate_warnings,
    created_at
  FROM alert_candidates
  WHERE token_address = ?
    AND created_at >= ?
    AND cli_checked = 1
  ORDER BY created_at DESC
  LIMIT 1
`);
const getSmartWalletProfilesByAddresses = db.prepare(`
  SELECT
    wallet_address,
    observed_tokens_count,
    observed_alert_tokens_count,
    avg_return_1h,
    avg_return_4h,
    avg_return_24h,
    avg_peak_return,
    hit_2x_count,
    hit_5x_count,
    hit_10x_count,
    bad_result_count,
    bot_like_count,
    high_risk_count,
    wallet_quality_score,
    wallet_quality_label,
    raw_stats
  FROM smart_wallet_profiles
  WHERE wallet_address IN (
    SELECT value FROM json_each(?)
  )
`);
const getSmartWalletLearningStats = db.prepare(`
  SELECT
    COUNT(*) AS total_profiles,
    SUM(CASE WHEN wallet_quality_label = 'Strong' THEN 1 ELSE 0 END) AS strong_count,
    SUM(CASE WHEN wallet_quality_label = 'Medium' THEN 1 ELSE 0 END) AS medium_count,
    SUM(CASE WHEN wallet_quality_label = 'Weak' THEN 1 ELSE 0 END) AS weak_count,
    SUM(CASE WHEN wallet_quality_label = 'Unknown' THEN 1 ELSE 0 END) AS unknown_count,
    SUM(CASE WHEN hit_2x_count > 0 OR hit_5x_count > 0 THEN 1 ELSE 0 END) AS hit_wallet_count,
    SUM(CASE WHEN bot_like_count > 0 OR high_risk_count > 0 THEN 1 ELSE 0 END) AS risky_wallet_count
  FROM smart_wallet_profiles
`);
const getAutoTuningCandidateRows = db.prepare(`
  SELECT
    ac.id,
    ac.token_address,
    ac.candidate_source_type,
    ac.mcap,
    ac.age_days,
    ac.liquidity,
    ac.flow_mcap,
    ac.traders,
    ac.cli_grade,
    ac.flow_quality,
    ac.holder_risk,
    ac.buyer_seller_balance,
    ac.sell_pressure,
    ac.wallet_quality,
    ac.cluster_risk,
    ac.risk_flags,
    ac.warning_flags,
    ac.smart_wallet_quality_label,
    ac.created_at,
    COALESCE(
      (
        SELECT app.peak_return_x
        FROM alert_peak_performance app
        WHERE app.alert_candidate_id = ac.id
          AND app.peak_return_x IS NOT NULL
        ORDER BY app.updated_at DESC
        LIMIT 1
      ),
      (
        SELECT MAX(app.peak_return_x)
        FROM alert_peak_performance app
        WHERE app.alert_run_id = ac.alert_run_id
          AND app.token_address = ac.token_address
          AND app.peak_return_x IS NOT NULL
      ),
      (
        SELECT MAX(app.peak_return_x)
        FROM alert_peak_performance app
        WHERE app.token_address = ac.token_address
          AND app.peak_return_x IS NOT NULL
      )
    ) AS peak_return_x
  FROM alert_candidates ac
  WHERE ac.created_at >= ?
`);
const insertAutoTuningResult = db.prepare(`
  INSERT INTO auto_tuning_results (
    auto_tuning_run_id,
    created_at,
    sample_size,
    data_window_hours,
    bucket_type,
    bucket_name,
    avg_peak_return,
    hit_2x_rate,
    hit_5x_rate,
    bad_result_rate,
    best_peak_return,
    adjustment,
    reason,
    version
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const getLatestAutoTuningResults = db.prepare(`
  SELECT
    bucket_type,
    bucket_name,
    sample_size,
    avg_peak_return,
    hit_2x_rate,
    hit_5x_rate,
    bad_result_rate,
    best_peak_return,
    adjustment,
    reason,
    version
  FROM auto_tuning_results
  WHERE version = ?
    AND auto_tuning_run_id = (
      SELECT auto_tuning_run_id
      FROM auto_tuning_results
      WHERE version = ?
      ORDER BY created_at DESC
      LIMIT 1
    )
`);
const getRecentFreshScanCandidatesForAlert = db.prepare(`
  SELECT id, scan_id, token_address, symbol, name, candidate_rank, candidate_sources,
    mcap, age_days, liquidity, flow_24h, flow_7d, flow_mcap, traders, cli_grade, created_at
  FROM scan_candidates
  WHERE created_at >= ?
  ORDER BY COALESCE(fresh_scan_rank_score, momentum_score, score, 0) DESC
  LIMIT ?
`);
const getRecentWatchCandidatesForAlert = db.prepare(`
  SELECT
    user_picks.pick_id,
    user_picks.signal_id,
    user_picks.action,
    user_picks.clicked_at,
    signals.token_address,
    signals.symbol,
    signals.name,
    signals.scan_mcap,
    signals.scan_price,
    signals.flow_24h,
    signals.flow_7d,
    signals.flow_mcap_ratio,
    signals.trader_count,
    signals.token_age
  FROM user_picks
  INNER JOIN signals ON signals.signal_id = user_picks.signal_id
  WHERE user_picks.clicked_at >= ? AND user_picks.action IN ('watch', 'paper_in', 'conviction')
  ORDER BY user_picks.clicked_at DESC
  LIMIT ?
`);
const getLatestSignalByToken = db.prepare(`
  SELECT signal_id, token_address, symbol, name, signal_type, scan_mcap, scan_price, flow_24h, flow_7d, flow_mcap_ratio, trader_count, token_age, message_id, channel_id
  FROM signals
  WHERE token_address = ?
  ORDER BY scan_time DESC
  LIMIT 1
`);
const insertAlert = db.prepare(`
  INSERT INTO alerts (
    alert_id,
    token_address,
    signal_id,
    alert_type,
    alert_score,
    triggered_at,
    channel_id,
    reason,
    quality_gate_grade,
    quality_gate_reasons,
    quality_gate_warnings,
    deep_check_id
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const updateAlertV2Details = db.prepare(`
  UPDATE alerts
  SET alert_run_id = ?,
      message_id = ?,
      mcap = ?,
      age_days = ?,
      liquidity = ?,
      flow_1h = ?,
      flow_4h = ?,
      flow_24h = ?,
      flow_mcap = ?,
      traders = ?,
      score = ?,
      cli_grade = ?,
      candidate_source_type = ?,
      is_realert = ?,
      realert_reason = ?,
      created_at = ?
  WHERE alert_id = ?
`);
const insertDeepCheck = db.prepare(`
  INSERT INTO deep_checks (
    deep_check_id,
    token_address,
    signal_id,
    flow_quality,
    holder_quality,
    buyer_seller_balance,
    sell_pressure,
    cluster_risk,
    final_note,
    raw_summary,
    narrative_summary,
    narrative_type,
    narrative_sources,
    narrative_evidence,
    narrative_tags,
    narrative_confidence,
    wallet_quality_summary,
    wallet_behavior_counts,
    estimated_independent_wallets,
    created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const insertTokenInfoSnapshot = db.prepare(`
  INSERT INTO token_info_snapshots (
    id,
    token_address,
    name,
    symbol,
    description,
    logo_url,
    website_url,
    twitter_url,
    telegram_url,
    dexscreener_url,
    gmgn_url,
    x_search_url,
    raw_json,
    created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const insertWalletQualitySnapshot = db.prepare(`
  INSERT INTO wallet_quality_snapshots (
    id,
    token_address,
    signal_id,
    wallet_address,
    behavior_type,
    buy_count,
    sell_count,
    touched_token_count,
    avg_trade_size,
    wsol_trade_ratio,
    mirror_group_id,
    cluster_risk,
    created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    entry_price,
    button_type,
    time_since_signal_minutes,
    mcap_at_click,
    price_at_click,
    signal_source,
    signal_type
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const updateUserPick = db.prepare(`
  UPDATE user_picks
  SET action = ?,
      used_points = ?,
      clicked_at = ?,
      entry_mcap = ?,
      entry_price = ?,
      button_type = ?,
      time_since_signal_minutes = ?,
      mcap_at_click = ?,
      price_at_click = ?,
      signal_source = ?,
      signal_type = ?
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
    signal_type,
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
  SELECT signal_id, scan_id, token_address, symbol, name, narrative, signal_type, edge_score, status, scan_time, scan_mcap, scan_price, flow_24h, flow_7d, flow_mcap_ratio, trader_count, token_age, message_id, channel_id
  FROM signals
  WHERE scan_time >= ?
  ORDER BY scan_time DESC, edge_score DESC
`);
const getSignalsBetween = db.prepare(`
  SELECT signal_id, scan_id, token_address, symbol, name, narrative, signal_type, edge_score, status, scan_time, scan_mcap, scan_price, flow_24h, flow_7d, flow_mcap_ratio, trader_count, token_age, message_id, channel_id
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
const getUserPicksWithSignals = db.prepare(`
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
  WHERE user_picks.user_id = ?
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
const getLatestPerformanceSnapshot = db.prepare(`
  SELECT current_mcap, current_price, bot_return_x
  FROM performance_snapshots
  WHERE signal_id = ?
  ORDER BY snapshot_time DESC
  LIMIT 1
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
const insertLearningSummary = db.prepare(`
  INSERT INTO learning_summaries (
    learning_summary_id,
    period,
    start_time,
    end_time,
    signal_type_summary,
    mcap_bucket_summary,
    age_bucket_summary,
    flow_mcap_bucket_summary,
    cluster_risk_summary,
    wallet_behavior_summary,
    next_score_adjustment,
    created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const insertNansenCreditLog = db.prepare(`
  INSERT INTO nansen_credit_logs (
    credit_log_id,
    command_name,
    before_credits,
    after_credits,
    used_credits,
    use_mock_nansen,
    created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?)
`);
const getRecentNansenCreditLogs = db.prepare(`
  SELECT
    command_name,
    before_credits,
    after_credits,
    used_credits,
    use_mock_nansen,
    created_at
  FROM nansen_credit_logs
  ORDER BY created_at DESC
  LIMIT ?
`);
const getDeepChecksForLearning = db.prepare(`
  SELECT signal_id, cluster_risk, created_at
  FROM deep_checks
  WHERE signal_id IS NOT NULL
  ORDER BY created_at DESC
`);
const getWalletSnapshotsForLearning = db.prepare(`
  SELECT signal_id, behavior_type, cluster_risk, created_at
  FROM wallet_quality_snapshots
  WHERE signal_id IS NOT NULL
  ORDER BY created_at DESC
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

function getNetflowTokenAddress(row: NetflowRow): string | null {
  const tokenAddress = row.token_address;

  if (typeof tokenAddress !== "string") return null;

  const normalized = tokenAddress.trim();

  return normalized.length > 0 ? normalized : null;
}

function dedupeNetflowRowsByTokenAddress(rows: NetflowRow[]): NetflowRow[] {
  const seen = new Set<string>();
  const deduped: NetflowRow[] = [];

  for (const row of rows) {
    const tokenAddress = getNetflowTokenAddress(row);

    if (!tokenAddress) {
      deduped.push(row);
      continue;
    }

    const key = tokenAddress.toLowerCase();

    if (seen.has(key)) continue;

    seen.add(key);
    deduped.push(row);
  }

  return deduped;
}

function formatMemeScanError(error: unknown): string {
  const message = error instanceof Error ? error.message : "不明なエラー";

  if (
    message.includes("body -> pagination -> per_page") ||
    message.includes("allowed range") ||
    message.includes("--limit 1500")
  ) {
    return [
      "Nansenの1回取得上限1000を超えたため、limitを1000にclampして再取得する必要があります。",
      "このBotではFresh ScanのcandidatePoolSizeは1500のまま維持し、Nansenへの1回あたりlimitだけ1000に制限します。",
      `詳細: ${message}`,
    ].join("\n");
  }

  if (message.startsWith("Command failed: nansen")) {
    return [
      "Nansen CLIの実行に失敗しました。CLI認証、credits、または一時的なNansen側エラーを確認してください。",
      `詳細: ${message}`,
    ].join("\n");
  }

  return message;
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

function formatTreeRows(rows: Array<[string, string]>): string[] {
  return rows.map(([label, value], index) => {
    const branch = index === rows.length - 1 ? "└" : "├";

    return `${branch} ${label}　${value}`;
  });
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
    return "🧪 エアINを記録しました";
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
    return "🧪 エアIN";
  }

  return "👀 Watch";
}

function actionPlainLabel(action: PickAction): string {
  if (action === "conviction") {
    return "Conviction";
  }

  if (action === "paper_in") {
    return "エアIN";
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

function formatDeskTestMessage(rows: NetflowRow[]): string {
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
    ].join("｜");
  });

  return ["Nansen Smart Money Netflow確認（Solana）", ...lines].join("\n");
}

function clampScore(value: number, min = 0, max = 100): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

function findRangeBucket<T extends { min: number; max: number | null }>(value: number | null, buckets: T[]): T | null {
  if (value === null) {
    return null;
  }

  return buckets.find((bucket) => value >= bucket.min && (bucket.max === null || value < bucket.max)) ?? null;
}

function findAgeScoringBucket(ageDays: number | null): AgeScoringBucket | null {
  if (ageDays === null) {
    return null;
  }

  return scoringConfig.ageBuckets.find((bucket) => (
    ageDays >= bucket.minDays && (bucket.maxDays === null || ageDays <= bucket.maxDays)
  )) ?? null;
}

function scoreFlowMcap(flowMcapRatio: number | null): number {
  if (flowMcapRatio === null || flowMcapRatio <= 0) {
    return 0;
  }

  const bucket = findRangeBucket(flowMcapRatio, scoringConfig.flowMcapBuckets);

  return clampScore(bucket?.score ?? 0, 0, scoringConfig.scoreWeights.flowMcap);
}

function scoreSmartMoney(flow24h: number | null, flow7d: number | null): number {
  const positiveFlow24h = Math.max(flow24h ?? 0, 0);
  const maxScore = scoringConfig.scoreWeights.smartMoneyFlow;
  const flow24hScore = Math.min(Math.round(maxScore * 0.72), Math.round((Math.log10(positiveFlow24h + 1) / 5) * maxScore * 0.72));
  const flow7dScore = (flow7d ?? 0) > 0 ? Math.round(maxScore * 0.28) : (flow7d ?? 0) > -10_000 ? Math.round(maxScore * 0.12) : 0;

  return clampScore(flow24hScore + flow7dScore, 0, maxScore);
}

function scoreEarlyness(ageDays: number | null): number {
  return clampScore(findAgeScoringBucket(ageDays)?.score ?? Math.round(scoringConfig.scoreWeights.freshnessAge * 0.4), 0, scoringConfig.scoreWeights.freshnessAge);
}

function isThinLiquidity(params: {
  marketCap: number | null;
  flow24h: number | null;
  flowMcapRatio: number | null;
  traderCount: number | null;
}): boolean {
  const { marketCap, flow24h, flowMcapRatio, traderCount } = params;

  if ((traderCount ?? Infinity) <= 2 && (flowMcapRatio ?? 0) >= 0.01) {
    return true;
  }

  if ((flow24h ?? Infinity) < 2_000 && (flowMcapRatio ?? 0) >= 0.03) {
    return true;
  }

  return marketCap !== null && marketCap < 50_000 && (flow24h ?? 0) > 0 && (flowMcapRatio ?? 0) >= 0.01;
}

function scoreMcapSweetSpot(marketCap: number | null): number {
  return clampScore(findRangeBucket(marketCap, scoringConfig.mcapBuckets)?.score ?? 0, 0, scoringConfig.scoreWeights.mcapSweetSpot);
}

function scoreTraderConfirmation(traderCount: number | null): number {
  const maxScore = scoringConfig.scoreWeights.traderConfirmation;

  if (traderCount === null) {
    return Math.round(maxScore * 0.33);
  }

  if (traderCount >= 50) {
    return maxScore;
  }

  if (traderCount >= 25) {
    return Math.round(maxScore * 0.8);
  }

  if (traderCount >= 10) {
    return Math.round(maxScore * 0.55);
  }

  if (traderCount >= 5) {
    return Math.round(maxScore * 0.35);
  }

  return Math.round(maxScore * 0.15);
}

function scoreRiskAdjustment(
  marketCap: number | null,
  flow7d: number | null,
  traderCount: number | null,
  ageDays: number | null,
): number {
  const maxPenalty = scoringConfig.scoreWeights.riskAdjustmentMaxPenalty;
  let penalty = 0;

  if (marketCap !== null) {
    const bucket = findRangeBucket(marketCap, scoringConfig.mcapBuckets);

    if (bucket && !bucket.freshScanAllowed) {
      penalty += scoringConfig.riskPenalties.highMcapPenalty;
    }
  }

  if (traderCount !== null && traderCount < 10) {
    penalty += Math.min(3, scoringConfig.riskPenalties.thinLiquidity);
  }

  if ((flow7d ?? 0) < 0) {
    penalty += 3;
  }

  if (ageDays !== null && ageDays <= 2) {
    penalty += 1;
  }

  if (ageDays !== null && ageDays >= 180) {
    penalty += scoringConfig.riskPenalties.reFlowPenalty;
  }

  return -Math.min(maxPenalty, penalty);
}

function getFreshScanMcapRank(marketCap: number | null): number {
  const bucket = findRangeBucket(marketCap, scoringConfig.mcapBuckets);

  if (!bucket) {
    return 3;
  }

  if (marketCap !== null && marketCap <= scoringConfig.freshScanRules.preferMaxMcap && bucket.freshScanAllowed) {
    return 0;
  }

  return bucket.freshScanAllowed ? 2 : 5;
}

function riskLabelFromScore(riskAdjustment: number): ScoreBreakdown["riskLabel"] {
  if (riskAdjustment >= -3) {
    return "Low";
  }

  if (riskAdjustment >= -8) {
    return "Medium";
  }

  return "High";
}

function getStatus(edgeScore: number): MemeStatus {
  if (edgeScore >= 80) {
    return "🟢 強め";
  }

  if (edgeScore >= 65) {
    return "🟡 監視候補";
  }

  if (edgeScore >= 50) {
    return "🟠 高リスク・様子見";
  }

  return "🔴 弱い";
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

type ResolveTokenNarrativeContext = {
  row: NetflowRow | null;
  tokenAddress: string;
  symbol: string;
  name: string;
  signalType: SignalType;
  marketCap: number | null;
  flow24h: number | null;
  flow7d: number | null;
  flowMcapRatio: number | null;
  traderCount: number | null;
  ageDays: number | null;
  tokenInfo: TokenInformationSnapshot | null;
  dexProfile: Awaited<ReturnType<typeof fetchDexScreenerTokenProfile>> | null;
  tokenIconUrl: string | null;
};

function compactText(value: string | null, maxLength = 220): string | null {
  if (!value) {
    return null;
  }

  const compacted = value.replace(/\s+/g, " ").trim();

  if (compacted.length <= maxLength) {
    return compacted;
  }

  return `${compacted.slice(0, maxLength - 1)}…`;
}

function inferNarrativeType(text: string, hasPumpFun: boolean, hasFlow: boolean): NarrativeType {
  const normalized = text.toLowerCase();

  if (hasPumpFun) return "pump_fun";
  if (/dog|cat|shiba|frog|pepe|inu|wif|bonk|犬|猫|カエル/.test(normalized)) return "animal";
  if (/trump|biden|maga|politic|president|election|senate|america|usa|政治|選挙/.test(normalized)) return "political";
  if (/musk|elon|tate|vitalik|celebrity|founder|ceo|人物/.test(normalized)) return "celebrity";
  if (/\bai\b|gpt|robot|agent|人工知能/.test(normalized)) return "ai";
  if (/game|gaming|play|quest|arcade|ゲーム/.test(normalized)) return "gaming";
  if (/sport|football|soccer|nba|nfl|mlb|athlete|スポーツ/.test(normalized)) return "sports";
  if (/anime|manga|waifu|アニメ|漫画/.test(normalized)) return "anime";
  if (/brand|nike|tesla|spacex|apple|google|mascot|logo|ブランド/.test(normalized)) return "brand";
  if (/asteroid|meteor|space|moon|mars|rocket|spacex|cosmo|宇宙|月|惑星/.test(normalized)) return "space";
  if (/scuba|fish|whale|ocean|shark|water|aqua|sea|水中|海/.test(normalized)) return "aquatic";
  if (/belief|faith|god|jesus|church|pray|abstract|信念|信仰|神/.test(normalized)) return "abstract";
  if (hasFlow) return "flow_driven";

  return "unknown";
}

function getNarrativeTypeLabel(type: NarrativeType): string {
  const labels: Record<NarrativeType, string> = {
    animal: "動物・キャラクター系",
    celebrity: "人物・インフルエンサー系",
    ai: "AI・agent系",
    gaming: "ゲーム系",
    political: "政治・イベント系",
    sports: "スポーツ系",
    anime: "アニメ・キャラ系",
    brand: "ブランド・マスコット系",
    space: "宇宙・SF系",
    aquatic: "水中・海洋系",
    pump_fun: "pump.fun初動系",
    abstract: "抽象ワード系",
    flow_driven: "flow主導",
    unknown: "テーマ薄め",
  };

  return labels[type];
}

function formatSignalTypeLabel(signalType: SignalType): string {
  const labels: Record<SignalType, string> = {
    alert_edge: "🚨 強シグナル",
    flow_watch: "📈 資金流入あり",
    whale_flow: "🐋 大口流入",
    thin_liquidity: "📈 資金流入あり",
    bot_like_flow: "📈 資金流入あり",
  };

  return labels[signalType];
}

function normalizeRiskToken(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function collectDisplayRiskLabels(values: Array<string | null | undefined>): string[] {
  const riskLabels = new Set<string>();

  for (const rawValue of values) {
    if (!rawValue) continue;

    const value = normalizeRiskToken(rawValue);

    if (
      value.includes("liquidity_missing") ||
      value.includes("thin_liquidity") ||
      value.includes("liquidity_below_threshold")
    ) {
      riskLabels.add("⚠️ 流動性薄め");
    }

    if (
      value.includes("bot_like_flow") ||
      value.includes("micro_arb_heavy") ||
      value.includes("mirror_like_heavy") ||
      value.includes("cluster_risk_high") ||
      value.includes("cluster_risk_medium")
    ) {
      riskLabels.add("🤖 不自然flow疑い");
    }

    if (
      value.includes("holder_risk_high") ||
      value.includes("holder_concentration") ||
      value.includes("concentrated_holders")
    ) {
      riskLabels.add("👥 Holder集中");
    }

    if (
      value.includes("sell_pressure_high") ||
      value.includes("buyer_seller_bearish") ||
      value === "sell_pressure" ||
      value.includes("sell_pressure_")
    ) {
      riskLabels.add("🔻 売り圧強め");
    }
  }

  return Array.from(riskLabels);
}

function getResearchCardRiskLabels(card: MemeResearchCard): string[] {
  return collectDisplayRiskLabels([card.signalType]);
}

function getSignalRiskLabels(signalType: SignalType): string[] {
  return collectDisplayRiskLabels([signalType]);
}

function getAlertCardRiskLabels(
  card: MemeResearchCard,
  deepCheck?: DeepCheckReply,
  gate?: AlertQualityGateResult,
  candidate?: AlertV2Candidate,
): string[] {
  return collectDisplayRiskLabels([
    card.signalType,
    ...(candidate?.riskFlags ?? []),
    ...(candidate?.warningFlags ?? []),
    ...(candidate?.qualityGateWarnings ?? []),
    ...(gate?.warnings ?? []),
    candidate?.holderRisk === "High" ? "holder_risk_high" : null,
    candidate?.sellPressure === "High" ? "sell_pressure_high" : null,
    candidate?.clusterRisk === "High" ? "cluster_risk_high" : null,
    candidate?.clusterRisk === "Medium" ? "cluster_risk_medium" : null,
    candidate?.walletQuality === "Low" ? "bot_like_flow" : null,
    deepCheck?.holderQuality.label === "High" ? "holder_risk_high" : null,
    deepCheck?.sellPressure.label === "High" ? "sell_pressure_high" : null,
    deepCheck?.buyerSellerBalance.label === "Bearish" ? "buyer_seller_bearish" : null,
    deepCheck?.clusterRisk.label === "High" ? "cluster_risk_high" : null,
    deepCheck?.clusterRisk.label === "Medium" ? "cluster_risk_medium" : null,
    deepCheck && (
      deepCheck.walletQuality.behaviorCounts["Micro-arb"] > 0 ||
      deepCheck.walletQuality.behaviorCounts["Mirror-like"] > 0
    ) ? "micro_arb_heavy" : null,
  ]);
}

function formatDisplayRiskLine(labels: string[]): string {
  return labels.length > 0 ? labels.join("｜") : "なし";
}

function getSignalNarrativeSentence(context: ResolveTokenNarrativeContext): string {
  const flowText = `MCap ${formatCompactUsd(context.marketCap)}、24h Flow ${formatCompactUsd(context.flow24h)}、Flow/MCap ${formatPercent(context.flowMcapRatio)}`;

  switch (context.signalType) {
    case "alert_edge":
      return `${flowText}に加え、Alert条件を満たす強さがあるため、テーマだけでなく資金流入の質も見る候補です。`;
    case "thin_liquidity":
      return `流動性が薄い候補なので、テーマ性よりも少額flowが大きく見えやすい点を織り込んで見ます。`;
    case "bot_like_flow":
      return `wallet行動が主材料で、mirror / micro-arb寄りの短期flowかどうかを優先して確認する候補です。`;
    case "whale_flow":
      return `コミュニティ発の広がりより、大口flow主導で動いているかを中心に見る候補です。`;
    case "flow_watch":
    default:
      return `${flowText}を起点に、Smart Money flowの継続を監視するFlow Watchです。`;
  }
}

function getThemeSentence(
  context: ResolveTokenNarrativeContext,
  narrativeType: NarrativeType,
  description: string | null,
  hasImage: boolean,
): string {
  const displayName = `${context.symbol} / ${context.name}`;
  const theme = getNarrativeTypeLabel(narrativeType);

  if (description) {
    return `${displayName}は、profile / token information上の「${compactText(description, 120)}」を文脈に持つ${theme}ミーム候補です。`;
  }

  if (narrativeType === "flow_driven" || narrativeType === "unknown") {
    return `${displayName}は、明確なキャラクター性よりも小型MCapとSmart Money flowを軸に監視するタイプです。`;
  }

  if (hasImage) {
    return `${displayName}は、tickerとtoken imageの方向性を合わせて見たい${theme}ミーム候補です。`;
  }

  return `${displayName}は、tickerの覚えやすさとSmart Money flowを先に見る${theme}寄りの候補です。`;
}

function getNarrativeEvidence(context: ResolveTokenNarrativeContext, socialLinks: NarrativeSocialLinks, description: string | null): string[] {
  const evidence: string[] = [];

  if (description) evidence.push("profile / token information由来の説明文あり");
  if (context.tokenInfo?.deploymentDate) evidence.push(`deployment: ${context.tokenInfo.deploymentDate}`);
  if (context.tokenInfo?.logoUrl || context.dexProfile?.imageUrl || context.tokenIconUrl) evidence.push("token image / logoを取得");
  if (socialLinks.twitter) evidence.push("X / Twitter linkあり");
  if (socialLinks.website) evidence.push("website linkあり");
  if (context.marketCap !== null) evidence.push(`MCap ${formatCompactUsd(context.marketCap)}`);
  if ((context.flow24h ?? 0) > 0) evidence.push(`24h Smart Money flow ${formatCompactUsd(context.flow24h)}`);
  if (context.traderCount !== null) evidence.push(`Traders ${formatCount(context.traderCount)}人`);

  return evidence.slice(0, 6);
}

function buildNarrativePoints(context: ResolveTokenNarrativeContext, narrativeType: NarrativeType, evidence: string[]): string[] {
  const points: string[] = [];

  if (evidence.some((item) => /説明文|X|website|image/.test(item))) {
    points.push(evidence.find((item) => /説明文|X|website|image/.test(item)) ?? "");
  }

  if (context.marketCap !== null && context.flowMcapRatio !== null) {
    points.push(`MCap ${formatCompactUsd(context.marketCap)}に対してFlow/MCap ${formatPercent(context.flowMcapRatio)}が反応`);
  } else if ((context.flow24h ?? 0) > 0) {
    points.push(`24h Smart Money flow ${formatCompactUsd(context.flow24h)}を検出`);
  }

  if (context.signalType === "flow_watch") {
    points.push("SignalはFlow Watchで、テーマよりflow継続を優先して監視");
  } else if (context.signalType === "thin_liquidity") {
    points.push("薄商いのため、少額flowでも大きく見えやすい");
  } else if (context.signalType === "bot_like_flow") {
    points.push("wallet behavior主導のflowとしてCluster Riskを確認");
  } else {
    points.push(`${formatSignalTypeLabel(context.signalType)}として、Signal Typeと${getNarrativeTypeLabel(narrativeType)}の噛み合いを確認`);
  }

  return points.filter(Boolean).slice(0, 3);
}

// Narrative Resolver is retained for future use, currently hidden from UI.
function resolveTokenNarrative(context: ResolveTokenNarrativeContext): TokenNarrative {
  const rowMetadata = getNestedRecord(context.row?.metadata) ?? getNestedRecord(context.row?.token_metadata);
  const metadataProfile: TokenProfileContext = {
    source: "token metadata",
    description: getFirstTextFromRecords(rowMetadata, [/description|about|profile|bio|summary/]),
    imageUrl: extractTokenIconUrlFromRow(context.row ?? {}),
    links: extractSocialLinks(rowMetadata),
  };
  const dexProfile: TokenProfileContext = {
    source: "DexScreener",
    description: context.dexProfile?.description ?? null,
    imageUrl: context.dexProfile?.imageUrl ?? null,
    links: context.dexProfile?.links ?? {},
  };
  const tokenInfoLinks: NarrativeSocialLinks = {
    website: context.tokenInfo?.websiteUrl ?? undefined,
    twitter: context.tokenInfo?.twitterUrl ?? undefined,
    telegram: context.tokenInfo?.telegramUrl ?? undefined,
  };
  const baseLinks: NarrativeSocialLinks = {
    dexscreener: `https://dexscreener.com/solana/${context.tokenAddress}`,
    gmgn: `https://gmgn.ai/sol/token/${context.tokenAddress}`,
    universalx: `https://universalx.app/trade?assetId=101_${context.tokenAddress}`,
    xSearch: getXSearchUrl(context.symbol, context.tokenAddress),
  };
  const socialLinks = mergeSocialLinks(tokenInfoLinks, dexProfile.links, metadataProfile.links, baseLinks);
  const description =
    context.tokenInfo?.description ??
    dexProfile.description ??
    metadataProfile.description ??
    null;
  const sourceCandidates = [
    context.tokenInfo ? "Nansen token info" : null,
    dexProfile.description || dexProfile.imageUrl || Object.keys(dexProfile.links).length > 0 ? "DexScreener profile" : null,
    metadataProfile.description || metadataProfile.imageUrl || Object.keys(metadataProfile.links).length > 0 ? "token metadata" : null,
    socialLinks.twitter ? "X / Twitter link" : "X search",
    "Signal Type / MCap / Flow",
  ].filter((value): value is string => Boolean(value));
  const rawText = [
    context.symbol,
    context.name,
    description,
    context.tokenInfo?.logoUrl,
    dexProfile.imageUrl,
    metadataProfile.imageUrl,
    socialLinks.website,
    socialLinks.twitter,
    ...((Array.isArray(context.row?.token_sectors) ? context.row?.token_sectors : []) as unknown[]).filter((item): item is string => typeof item === "string"),
  ].filter(Boolean).join(" ");
  const hasPumpFun = /pump\.fun|pumpfun|\bpump\b/i.test(rawText);
  const hasFlow = (context.flow24h ?? 0) > 0 || (context.flowMcapRatio ?? 0) > 0;
  const narrativeType = inferNarrativeType(rawText, hasPumpFun, hasFlow);
  const hasConcreteContext = Boolean(description || socialLinks.twitter || socialLinks.website);
  const hasImage = Boolean(context.tokenInfo?.logoUrl || dexProfile.imageUrl || metadataProfile.imageUrl || context.tokenIconUrl);
  const themeSentence = getThemeSentence(context, narrativeType, description, hasImage);
  const signalSentence = getSignalNarrativeSentence(context);
  const perspectiveSentence = hasConcreteContext
    ? `単なるname / symbolの連想ではなく、social / profile / imageとflowが同じ方向を向いているかを見ます。`
    : narrativeType === "flow_driven" || narrativeType === "unknown"
      ? `テーマ主導というより、tickerの覚えやすさと短期flowが先行している形として整理します。`
      : `具体的な発祥より、ticker・画像テーマ・低MCap flowの組み合わせで整理します。`;
  const evidence = getNarrativeEvidence(context, socialLinks, description);
  const points = buildNarrativePoints(context, narrativeType, evidence);
  const narrativeSummary = [
    "Theme context:",
    themeSentence,
    signalSentence,
    perspectiveSentence,
    "",
    "見るポイント:",
    ...points.map((point) => `• ${point}`),
  ].join("\n");
  const narrativeTags = [
    narrativeType,
    context.signalType,
    hasPumpFun ? "pump_fun" : null,
    hasImage ? "image" : null,
    hasConcreteContext ? "profile_context" : "flow_context",
  ].filter((value): value is string => Boolean(value));
  const internalConfidence: NarrativeConfidence = hasConcreteContext && context.tokenInfo ? "High" : hasConcreteContext || hasImage ? "Medium" : "Low";

  return {
    narrativeSummary,
    narrativeType,
    narrativeSources: sourceCandidates,
    narrativeEvidence: evidence,
    narrativeTags,
    socialLinks,
    internalConfidence,
  };
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

  if (ageDays !== null && ageDays >= 180 && ((flow24h ?? 0) >= 5_000 || (flowMcapRatio ?? 0) >= 0.03)) {
    reasons.push("🔁 再流入: 古い銘柄に再びSmart Money flowが入った候補です");
  }

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
    : "- Smart Money netflow Fresh Scanで検出";
}

function buildDetectionReasons(params: {
  marketCap: number | null;
  flow24h: number | null;
  flowMcapRatio: number | null;
  traderCount: number | null;
  ageDays: number | null;
  cliGrade?: CliGrade;
}): string {
  const reasons: string[] = [];

  if (params.marketCap !== null && params.flowMcapRatio !== null) {
    reasons.push([
      "• 小型MCapに対して資金流入あり",
      `  MCap ${formatCompactUsd(params.marketCap)} / Flow/MCap ${formatPercent(params.flowMcapRatio)}。少額flowでも価格に反映されやすい帯か確認します。`,
    ].join("\n"));
  }

  if ((params.flow24h ?? 0) > 0) {
    const alertText = (params.flow24h ?? 0) >= scoringConfig.alertRules.min24hFlowUsd
      ? "Alert級のflow水準に近く、継続流入を見たい段階です。"
      : "Alert条件には未満ですが、Flow Watchとして監視価値があります。";

    reasons.push([
      "• 直近Smart Money flowを検出",
      `  24h Flow ${formatCompactUsd(params.flow24h)}。${alertText}`,
    ].join("\n"));
  }

  if (params.traderCount !== null) {
    reasons.push([
      "• 参加者数",
      `  Traders ${formatCount(params.traderCount)}人。単独ではないものの、追加参加者の増加を確認したい段階です。`,
    ].join("\n"));
  }

  if (params.ageDays !== null) {
    const ageMeaning = params.ageDays <= 1
      ? "Solanaミームでは超初動として見る時間帯です。"
      : params.ageDays <= 5
        ? "Solanaミームでは初動後の継続flowを見る時間帯です。"
        : "Freshではなく既存銘柄への再流入として見ます。";

    reasons.push([
      "• Age",
      `  ${params.ageDays.toFixed(1)}日。${ageMeaning}`,
    ].join("\n"));
  }

  if (params.cliGrade && params.cliGrade !== "Unchecked") {
    reasons.push([
      "• CLI Quality Gate",
      `  Grade ${params.cliGrade}。Nansen CLI検証をスコア加点ではなくQuality Gateとして反映しています。`,
    ].join("\n"));
  }

  return reasons.length > 0
    ? reasons.slice(0, 5).join("\n")
    : "• Smart Money flow\n  Fresh Scan v2の市場レーダーで検出しました。";
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
      liquidity: toFiniteNumber(bestPair.liquidity?.usd),
      volume24h: toFiniteNumber(bestPair.volume?.h24),
      pairUrl: toOptionalText(bestPair.url) ?? `https://dexscreener.com/solana/${tokenAddress}`,
      raw: bestPair,
    };
  } catch {
    return null;
  }
}

async function enrichMarketDataForToken(
  tokenAddress: string,
  existingCandidate: {
    marketCap?: number | null;
    price?: number | null;
    entryPrice?: number | null;
    liquidity?: number | null;
    volume24h?: number | null;
    warningFlags?: string[];
    rawDexscreenerSnapshot?: unknown;
  },
): Promise<MarketDataEnrichment> {
  const refreshedAt = new Date().toISOString();
  const warningFlags = new Set(existingCandidate.warningFlags ?? []);
  let market: DexScreenerMarketData | null = null;
  let warning: string | null = null;

  try {
    market = await fetchDexScreenerMarketData(tokenAddress);
  } catch (error) {
    warning = error instanceof Error ? error.message : "market data補完に失敗";
  }

  if (!market) {
    warningFlags.add("market_data_missing");
    if (existingCandidate.price === null || existingCandidate.price === undefined) warningFlags.add("price_missing");
    if (existingCandidate.liquidity === null || existingCandidate.liquidity === undefined) warningFlags.add("liquidity_missing");
  }

  const price = market?.price ?? existingCandidate.price ?? null;
  const liquidity = market?.liquidity ?? existingCandidate.liquidity ?? null;
  const volume24h = market?.volume24h ?? existingCandidate.volume24h ?? null;

  if (price === null) warningFlags.add("price_missing");
  if (liquidity === null) warningFlags.add("liquidity_missing");

  return {
    marketCap: existingCandidate.marketCap ?? market?.marketCap ?? null,
    price,
    entryPrice: existingCandidate.entryPrice ?? price,
    liquidity,
    volume24h,
    pairUrl: market?.pairUrl ?? null,
    refreshedAt,
    ageMinutes: 0,
    source: market ? "dexscreener" : null,
    warning,
    warningFlags: Array.from(warningFlags),
    rawSnapshot: market?.raw ?? existingCandidate.rawDexscreenerSnapshot ?? null,
  };
}

function getXSearchUrl(symbol: string | null, tokenAddress: string): string {
  const query = [symbol, tokenAddress].filter(Boolean).join(" ");

  return `https://x.com/search?q=${encodeURIComponent(query)}&src=typed_query`;
}

function isValidHttpUrl(value: string | null): value is string {
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

function getFirstTextFromRecords(value: unknown, patterns: RegExp[]): string | null {
  for (const record of collectRecords(value)) {
    const text = findTextByKey(record, patterns);

    if (text) {
      return text;
    }
  }

  return null;
}

function getFirstNumberFromRecords(value: unknown, patterns: RegExp[]): number | null {
  for (const record of collectRecords(value)) {
    const numberValue = findNumberByKey(record, patterns);

    if (numberValue !== null) {
      return numberValue;
    }
  }

  return null;
}

function getBestImageUrlFromValue(value: unknown): string | null {
  for (const record of collectRecords(value)) {
    for (const key of ["image", "image_url", "imageUrl", "icon", "icon_url", "logoURI", "logo_url", "logo", "header"]) {
      const url = toOptionalText(record[key]);

      if (isValidHttpImageUrl(url)) {
        return url;
      }
    }
  }

  return null;
}

function mergeSocialLinks(...links: NarrativeSocialLinks[]): NarrativeSocialLinks {
  return links.reduce<NarrativeSocialLinks>((merged, current) => ({
    website: merged.website ?? current.website,
    twitter: merged.twitter ?? current.twitter,
    telegram: merged.telegram ?? current.telegram,
    dexscreener: merged.dexscreener ?? current.dexscreener,
    gmgn: merged.gmgn ?? current.gmgn,
    universalx: merged.universalx ?? current.universalx,
    xSearch: merged.xSearch ?? current.xSearch,
  }), {});
}

function extractSocialLinks(value: unknown): NarrativeSocialLinks {
  const links: NarrativeSocialLinks = {};

  for (const record of collectRecords(value)) {
    const label = [
      toOptionalText(record.type),
      toOptionalText(record.label),
      toOptionalText(record.name),
      toOptionalText(record.platform),
    ].filter(Boolean).join(" ").toLowerCase();
    const url = toOptionalText(record.url ?? record.href ?? record.link ?? record.website ?? record.twitter ?? record.telegram);

    if (!isValidHttpUrl(url)) {
      continue;
    }

    if (/twitter|x\.com|\bx\b/.test(label) || /(?:twitter\.com|x\.com)\//i.test(url)) {
      links.twitter ??= url;
    } else if (/telegram|tg\b/.test(label) || /(?:t\.me|telegram\.me)\//i.test(url)) {
      links.telegram ??= url;
    } else if (/web|site|homepage|official/.test(label)) {
      links.website ??= url;
    } else if (!links.website && !/dexscreener|gmgn|universalx/i.test(url)) {
      links.website = url;
    }
  }

  const directWebsite = getFirstTextFromRecords(value, [/website|site|homepage/]);
  const directTwitter = getFirstTextFromRecords(value, [/twitter|x_url|xurl|x_link|xlink/]);
  const directTelegram = getFirstTextFromRecords(value, [/telegram|tg_url|tgurl|tg_link|tglink/]);

  if (isValidHttpUrl(directWebsite)) links.website ??= directWebsite;
  if (isValidHttpUrl(directTwitter)) links.twitter ??= directTwitter;
  if (isValidHttpUrl(directTelegram)) links.telegram ??= directTelegram;

  return links;
}

function normalizeTokenInformation(
  tokenAddress: string,
  raw: unknown,
): TokenInformationSnapshot {
  return {
    tokenAddress,
    name: getFirstTextFromRecords(raw, [/^name$|token.*name/]),
    symbol: getFirstTextFromRecords(raw, [/^symbol$|ticker|token.*symbol/]),
    description: getFirstTextFromRecords(raw, [/description|about|profile|bio|summary/]),
    logoUrl: getBestImageUrlFromValue(raw),
    deploymentDate: getFirstTextFromRecords(raw, [/deploy|created|launch|pair.*created/]),
    websiteUrl: extractSocialLinks(raw).website ?? null,
    twitterUrl: extractSocialLinks(raw).twitter ?? null,
    telegramUrl: extractSocialLinks(raw).telegram ?? null,
    marketCap: getFirstNumberFromRecords(raw, [/market.*cap|mcap/]),
    fdv: getFirstNumberFromRecords(raw, [/^fdv$|fully.*diluted/]),
    volume: getFirstNumberFromRecords(raw, [/volume/]),
    buys: getFirstNumberFromRecords(raw, [/buys|buy.*count/]),
    sells: getFirstNumberFromRecords(raw, [/sells|sell.*count/]),
    uniqueTraders: getFirstNumberFromRecords(raw, [/unique.*trader|trader.*count|traders/]),
    liquidity: getFirstNumberFromRecords(raw, [/liquidity/]),
    holders: getFirstNumberFromRecords(raw, [/holders|holder.*count/]),
    raw,
  };
}

async function fetchNansenTokenInformation(tokenAddress: string): Promise<TokenInformationSnapshot | null> {
  if (tokenAddress === "UNKNOWN") {
    return null;
  }

  const mode: NansenFetchMode = isMockNansenEnabled() ? "mock" : "live";
  const cacheKey = `${mode}:${tokenAddress}`;
  const cached = cachedTokenInformation.get(cacheKey);

  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  if (mode === "mock") {
    cachedTokenInformation.set(cacheKey, {
      value: null,
      mode,
      expiresAt: Date.now() + NANSEN_CACHE_TTL_MS,
    });
    return null;
  }

  try {
    const raw = await runNansenJsonCommand([
      "research",
      "tgm",
      "token-information",
      "--token",
      tokenAddress,
      "--chain",
      "solana",
      "--output",
      "json",
    ]);
    const normalized = normalizeTokenInformation(tokenAddress, raw);

    cachedTokenInformation.set(cacheKey, {
      value: normalized,
      mode,
      expiresAt: Date.now() + NANSEN_CACHE_TTL_MS,
    });

    return normalized;
  } catch (error) {
    const message = error instanceof Error ? error.message : "不明なエラー";

    console.warn(`[Nansen token-information] ${tokenAddress} の取得に失敗しました: ${message}`);
    cachedTokenInformation.set(cacheKey, {
      value: null,
      mode,
      expiresAt: Date.now() + NANSEN_CACHE_TTL_MS,
    });
    return null;
  }
}

function saveTokenInfoSnapshot(
  tokenAddress: string,
  tokenInfo: TokenInformationSnapshot | null,
  socialLinks: NarrativeSocialLinks,
  rawProfile: unknown,
): void {
  if (!tokenInfo && !rawProfile) {
    return;
  }

  const rawJson = JSON.stringify({
    nansen: tokenInfo?.raw ?? null,
    profile: rawProfile ?? null,
  });

  insertTokenInfoSnapshot.run(
    randomUUID(),
    tokenAddress,
    tokenInfo?.name ?? null,
    tokenInfo?.symbol ?? null,
    tokenInfo?.description ?? null,
    tokenInfo?.logoUrl ?? null,
    socialLinks.website ?? null,
    socialLinks.twitter ?? null,
    socialLinks.telegram ?? null,
    socialLinks.dexscreener ?? null,
    socialLinks.gmgn ?? null,
    socialLinks.xSearch ?? null,
    rawJson,
    new Date().toISOString(),
  );
}

async function getEntryMarketData(signal: SignalRecord): Promise<DexScreenerMarketData> {
  const liveData = await fetchDexScreenerMarketData(signal.token_address);

  return {
    marketCap: liveData?.marketCap ?? signal.scan_mcap,
    price: liveData?.price ?? signal.scan_price,
    liquidity: liveData?.liquidity ?? null,
    volume24h: liveData?.volume24h ?? null,
    pairUrl: liveData?.pairUrl ?? null,
    raw: liveData?.raw ?? null,
  };
}

async function fetchDexScreenerTokenProfile(tokenAddress: string): Promise<{
  symbol: string | null;
  name: string | null;
  marketCap: number | null;
  description: string | null;
  imageUrl: string | null;
  links: NarrativeSocialLinks;
  raw: unknown;
}> {
  if (tokenAddress === "UNKNOWN") {
    return { symbol: null, name: null, marketCap: null, description: null, imageUrl: null, links: {}, raw: null };
  }

  try {
    const response = await fetch(
      `https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(tokenAddress)}`,
    );

    if (!response.ok) {
      return { symbol: null, name: null, marketCap: null, description: null, imageUrl: null, links: {}, raw: null };
    }

    const data = (await response.json()) as DexScreenerTokenResponse;
    const bestPair = (data.pairs ?? [])
      .filter((pair) => toFiniteNumber(pair.marketCap) !== null || toFiniteNumber(pair.fdv) !== null)
      .sort((a, b) => (Number(b.liquidity?.usd) || 0) - (Number(a.liquidity?.usd) || 0))[0];

    return {
      symbol: toOptionalText(bestPair?.baseToken?.symbol),
      name: toOptionalText(bestPair?.baseToken?.name),
      marketCap: toFiniteNumber(bestPair?.marketCap) ?? toFiniteNumber(bestPair?.fdv),
      description: getFirstTextFromRecords(bestPair?.info, [/description|about|profile|bio|summary/]),
      imageUrl: getBestImageUrlFromValue(bestPair?.info),
      links: {
        ...extractSocialLinks(bestPair?.info),
        dexscreener: toOptionalText(bestPair?.url) ?? `https://dexscreener.com/solana/${tokenAddress}`,
      },
      raw: data,
    };
  } catch {
    return { symbol: null, name: null, marketCap: null, description: null, imageUrl: null, links: {}, raw: null };
  }
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
    mcapSweetSpot: scoreMcapSweetSpot(marketCap),
    earlyness: scoreEarlyness(ageDays),
    traderConfirmation: scoreTraderConfirmation(traderCount),
    // Deep Check前の通常scanでは未知なので、中立点を入れてスコアのレンジを保ちます。
    flowIntelligenceQuality: Math.round(scoringConfig.scoreWeights.flowIntelligenceQuality * 0.6),
    holderQuality: Math.round(scoringConfig.scoreWeights.holderQuality * 0.6),
    riskAdjustment,
    riskLabel: riskLabelFromScore(riskAdjustment),
  };
}

function getRecentCutoffIso(hours: number): string {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

function hasRecentSignal(tokenAddress: string, cutoffIso = getRecentCutoffIso(24)): boolean {
  if (tokenAddress === "UNKNOWN") {
    return false;
  }

  return Boolean(getRecentSignalByToken.get(tokenAddress, cutoffIso));
}

function hasRecentAlert(tokenAddress: string, cutoffIso = getRecentCutoffIso(24)): boolean {
  if (tokenAddress === "UNKNOWN") {
    return false;
  }

  return Boolean(getRecentAlertByToken.get(tokenAddress, cutoffIso));
}

function classifySignalType(params: {
  marketCap: number | null;
  flow24h: number | null;
  flow7d: number | null;
  flowMcapRatio: number | null;
  traderCount: number | null;
  liquidity?: number | null;
  forceAlert?: boolean;
}): SignalType {
  const {
    marketCap,
    flow24h,
    flow7d,
    flowMcapRatio,
    traderCount,
    liquidity = null,
    forceAlert = false,
  } = params;
  const positiveFlow24h = (flow24h ?? 0) > 0;
  const thinLiquidity = liquidity !== null && liquidity < scoringConfig.freshScanRules.minLiquidityUsd
    ? true
    : isThinLiquidity({ marketCap, flow24h, flowMcapRatio, traderCount });
  const likelyBotLikeFlow = (traderCount ?? Infinity) <= 2 && positiveFlow24h && (flow7d ?? 0) <= 0;

  if (likelyBotLikeFlow) {
    return "bot_like_flow";
  }

  if (thinLiquidity) {
    return "thin_liquidity";
  }

  if (forceAlert) {
    return "alert_edge";
  }

  if (marketCap !== null && marketCap >= scoringConfig.freshScanRules.largeMcapThreshold && (flow24h ?? 0) >= 50_000) {
    return "whale_flow";
  }

  return "flow_watch";
}

async function buildMemeResearchCards(rows: NetflowRow[]): Promise<MemeResearchCard[]> {
  const scanId = randomUUID();
  const scanTime = new Date().toISOString();

  const cards = await Promise.all(rows.map(async (row): Promise<MemeResearchCard> => {
    const tokenAddress = toDisplayText(row.token_address, "UNKNOWN");
    const symbol = toDisplayText(row.token_symbol, "UNKNOWN");
    const name = toDisplayText(row.token_name ?? row.name, symbol);
    const marketCap = toFiniteNumber(row.market_cap_usd);
    const price = toFiniteNumber(row.price_usd ?? row.token_price_usd);
    const liquidity = getFirstNumberFromRecords(row, [/liquidity/]);
    const flow24h = toFiniteNumber(row.net_flow_24h_usd);
    const flow7d = toFiniteNumber(row.net_flow_7d_usd);
    const traderCount = toFiniteNumber(row.trader_count);
    const ageDays = toFiniteNumber(row.token_age_days);
    const flowMcapRatio = marketCap && flow24h !== null ? flow24h / marketCap : null;
    const isReFlow = ageDays !== null && (ageDays >= 180 || (ageDays >= 31 && (flow24h ?? 0) > 0));
    const breakdown = calculateScoreBreakdown(row, flowMcapRatio);
    const edgeScore =
      clampScore(
        breakdown.flowMcap +
        breakdown.smartMoney +
        breakdown.mcapSweetSpot +
        breakdown.earlyness +
        breakdown.traderConfirmation +
        breakdown.flowIntelligenceQuality +
        breakdown.holderQuality +
        breakdown.riskAdjustment,
      );
    const signalType = classifySignalType({
      marketCap,
      flow24h,
      flow7d,
      flowMcapRatio,
      traderCount,
      liquidity,
    });
    const scoreBreakdown =
      `Flow/MCap: ${breakdown.flowMcap}/${scoringConfig.scoreWeights.flowMcap} | ` +
      `Smart Money: ${breakdown.smartMoney}/${scoringConfig.scoreWeights.smartMoneyFlow} | ` +
      `MCap: ${breakdown.mcapSweetSpot}/${scoringConfig.scoreWeights.mcapSweetSpot} | ` +
      `Earlyness: ${breakdown.earlyness}/${scoringConfig.scoreWeights.freshnessAge} | ` +
      `Traders: ${breakdown.traderConfirmation}/${scoringConfig.scoreWeights.traderConfirmation} | ` +
      `Flow IQ: ${breakdown.flowIntelligenceQuality}/${scoringConfig.scoreWeights.flowIntelligenceQuality} | ` +
      `Holder: ${breakdown.holderQuality}/${scoringConfig.scoreWeights.holderQuality} | ` +
      `Risk Adj: ${breakdown.riskAdjustment} (${breakdown.riskLabel})`;
    const whyFlagged = buildWhyFlagged(
      marketCap,
      flow24h,
      flow7d,
      flowMcapRatio,
      traderCount,
      ageDays,
    );
    const risk = buildRisk(marketCap, flow7d, traderCount);
    const dexscreenerUrl =
      toOptionalText(row.dexscreener_url) ??
      toOptionalText(row.dexscreenerUrl) ??
      `https://dexscreener.com/solana/${tokenAddress}`;
    const gmgnUrl = `https://gmgn.ai/sol/token/${tokenAddress}`;
    const universalxUrl = `https://universalx.app/trade?assetId=101_${tokenAddress}`;
    const nansenUrl = `Nansen deep dive: /meme-token ${tokenAddress}`;
    const tokenIconUrl = await resolveTokenIconUrl(row, tokenAddress);
    const hiddenNarrative = createHiddenTokenNarrative();

    return {
      signalId: randomUUID(),
      scanId,
      tokenAddress,
      symbol,
      name,
      narrative: hiddenNarrative.narrativeSummary,
      narrativeSummary: hiddenNarrative.narrativeSummary,
      narrativeType: hiddenNarrative.narrativeType,
      narrativeSources: JSON.stringify(hiddenNarrative.narrativeSources),
      narrativeEvidence: JSON.stringify(hiddenNarrative.narrativeEvidence),
      narrativeTags: JSON.stringify(hiddenNarrative.narrativeTags),
      narrativeConfidence: hiddenNarrative.internalConfidence,
      signalType,
      edgeScore,
      status: getStatus(edgeScore),
      cliGrade: "Unchecked",
      scoreBreakdown,
      summary:
        `${formatCompactUsd(flow24h)}の24h Smart Money flowでFresh Scan入り。` +
        `MCap ${formatCompactUsd(marketCap)}、Flow/MCap ${formatPercent(flowMcapRatio)}、` +
        `Traders ${formatCount(traderCount)}人。`,
      scanTime,
      marketCap,
      price,
      liquidity,
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
      ageDays,
      isReFlow,
    };
  }));

  return cards.sort((a, b) => b.edgeScore - a.edgeScore);
}

function getCandidateSources(row: NetflowRow): string[] {
  const rawSources = [
    "smart-money/netflow",
    ...collectRecords(row)
      .flatMap((record) => [record.source, record.sources, record.candidate_sources])
      .flatMap((value) => Array.isArray(value) ? value : [value])
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0),
  ];

  return Array.from(new Set(rawSources.map((source) => source.trim()))).slice(0, 5);
}

function calculateMomentumComponents(candidate: Pick<FreshScanCandidate, "marketCap" | "flow24h" | "flow7d" | "flowMcapRatio" | "traderCount" | "ageDays" | "liquidity" | "candidateSources" | "riskFlags">): Record<string, number> {
  const flow24h = Math.min(25, Math.round((Math.log10(Math.max(candidate.flow24h ?? 0, 0) + 1) / 6) * 25));
  const flowMcap = Math.min(25, Math.round(((candidate.flowMcapRatio ?? 0) / 0.05) * 25));
  const traders = candidate.traderCount === null
    ? 0
    : candidate.traderCount >= 10 ? 15 : candidate.traderCount >= 5 ? 11 : candidate.traderCount >= 3 ? 7 : candidate.traderCount >= 2 ? 4 : 0;
  const flow7d = (candidate.flow7d ?? 0) > 0 ? Math.min(15, Math.round((Math.log10(Math.max(candidate.flow7d ?? 0, 0) + 1) / 6) * 15)) : 0;
  const liquidity = candidate.liquidity === null
    ? 4
    : candidate.liquidity >= scoringConfig.freshScanRules.minLiquidityUsd ? 10 : candidate.liquidity >= 10_000 ? 5 : 0;
  const age = candidate.ageDays === null
    ? 4
    : candidate.ageDays <= 1 ? 10 : candidate.ageDays <= 5 ? 8 : candidate.ageDays <= 30 ? 5 : 2;
  const sourceConfirmation = Math.min(10, Math.max(0, (candidate.candidateSources.length - 1) * 5));
  let riskPenalty = 0;

  if (candidate.riskFlags.includes("thin_liquidity")) riskPenalty -= 10;
  if (candidate.riskFlags.includes("bot_like")) riskPenalty -= 15;
  if (candidate.riskFlags.includes("micro_mcap")) riskPenalty -= 8;
  if (candidate.riskFlags.includes("negative_7d_flow")) riskPenalty -= 5;

  return {
    flow24h,
    flowMcap,
    traders,
    flow7d,
    liquidity,
    age,
    sourceConfirmation,
    riskPenalty: Math.max(-30, riskPenalty),
  };
}

function buildFreshScanCandidate(row: NetflowRow, scanId: string, candidateRank: number, createdAt: string): FreshScanCandidate {
  const tokenAddress = toDisplayText(row.token_address, "UNKNOWN");
  const symbol = toDisplayText(row.token_symbol, "UNKNOWN");
  const name = toDisplayText(row.token_name ?? row.name, symbol);
  const marketCap = toFiniteNumber(row.market_cap_usd);
  const price = toFiniteNumber(row.price_usd ?? row.token_price_usd);
  const flow24h = toFiniteNumber(row.net_flow_24h_usd);
  const flow7d = toFiniteNumber(row.net_flow_7d_usd);
  const traderCount = toFiniteNumber(row.trader_count);
  const ageDays = toFiniteNumber(row.token_age_days);
  const liquidity = getFirstNumberFromRecords(row, [/liquidity/]);
  const warningFlags: string[] = [];

  if (price === null) warningFlags.push("price_missing");
  if (liquidity === null) warningFlags.push("liquidity_missing");
  if (ageDays === null) warningFlags.push("age_missing");

  const flowMcapRatio = marketCap && flow24h !== null ? flow24h / marketCap : null;
  const candidateSources = getCandidateSources(row);
  const riskFlags: string[] = [];

  if (marketCap !== null && marketCap < scoringConfig.freshScanRules.minMcap) riskFlags.push("micro_mcap");
  if (liquidity !== null && liquidity < scoringConfig.freshScanRules.minLiquidityUsd) riskFlags.push("thin_liquidity");
  if ((traderCount ?? 0) <= 2 && (flow24h ?? 0) > 0 && (flow7d ?? 0) <= 0) riskFlags.push("bot_like");
  if ((flow7d ?? 0) < 0) riskFlags.push("negative_7d_flow");

  const components = calculateMomentumComponents({
    marketCap,
    flow24h,
    flow7d,
    flowMcapRatio,
    traderCount,
    ageDays,
    liquidity,
    candidateSources,
    riskFlags,
  });
  const momentumScore = clampScore(Object.values(components).reduce((sum, value) => sum + value, 0));
  const signalType = classifySignalType({
    marketCap,
    flow24h,
    flow7d,
    flowMcapRatio,
    traderCount,
    liquidity,
  });

  return {
    scanId,
    candidateRank,
    row,
    tokenAddress,
    symbol,
    name,
    candidateSources,
    marketCap,
    price,
    liquidity,
    volume24h: null,
    marketDataRefreshedAt: null,
    marketDataAgeMinutes: null,
    marketDataSource: null,
    marketDataWarning: null,
    flow24h,
    flow7d,
    flowMcapRatio,
    traderCount,
    ageDays,
    gate0Status: "pass",
    gate0Reason: "Gate 0通過",
    hardRejectStatus: "pass",
    hardRejectReason: "Hard Rejectなし",
    riskFlags,
    warningFlags,
    rawDexscreenerSnapshot: null,
    momentumScore,
    momentumGateStatus: "fail",
    momentumGateReason: "Momentum Gate未通過",
    rankComponents: components,
    preFilterStatus: "fail",
    preFilterRank: null,
    preFilterReason: "Pre-filter未通過",
    cliCandidateScore: momentumScore,
    whySelectedForCli: null,
    cliChecked: false,
    cliGrade: "Unchecked",
    cliOracleStatus: "not_checked",
    cliRejectReason: null,
    finalRank: null,
    finalRankReason: null,
    posted: false,
    postedMessageId: null,
    score: momentumScore,
    signalType,
    exclusionReason: null,
    createdAt,
  };
}

function applyFreshScanGate0(candidate: FreshScanCandidate, cutoffIso: string, seen: Set<string>): void {
  const reasons: string[] = [];

  if (candidate.tokenAddress === "UNKNOWN") reasons.push("token addressなし");
  if (seen.has(candidate.tokenAddress)) reasons.push("重複token");
  if (candidate.marketCap === null) reasons.push("MCapなし");
  if (candidate.flow24h === null || candidate.flow24h <= 0) reasons.push("24h Flowなし");
  if ((candidate.traderCount ?? 0) < scoringConfig.freshScanRules.minTraders) reasons.push(`Traders ${formatCount(candidate.traderCount)}人`);
  if (hasRecentSignal(candidate.tokenAddress, cutoffIso)) reasons.push(`${scoringConfig.freshScanRules.dedupeHours}h以内に投稿済み`);

  seen.add(candidate.tokenAddress);

  if (reasons.length > 0) {
    candidate.gate0Status = "reject";
    candidate.gate0Reason = reasons.join(" / ");
    candidate.exclusionReason = candidate.gate0Reason;
  }
}

function refreshFreshScanCandidateScoring(candidate: FreshScanCandidate): void {
  const components = calculateMomentumComponents({
    marketCap: candidate.marketCap,
    flow24h: candidate.flow24h,
    flow7d: candidate.flow7d,
    flowMcapRatio: candidate.flowMcapRatio,
    traderCount: candidate.traderCount,
    ageDays: candidate.ageDays,
    liquidity: candidate.liquidity,
    candidateSources: candidate.candidateSources,
    riskFlags: candidate.riskFlags,
  });

  candidate.rankComponents = components;
  candidate.momentumScore = clampScore(Object.values(components).reduce((sum, value) => sum + value, 0));
  candidate.score = candidate.momentumScore;
  candidate.signalType = classifySignalType({
    marketCap: candidate.marketCap,
    flow24h: candidate.flow24h,
    flow7d: candidate.flow7d,
    flowMcapRatio: candidate.flowMcapRatio,
    traderCount: candidate.traderCount,
    liquidity: candidate.liquidity,
  });
}

async function enrichFreshScanCandidates(candidates: FreshScanCandidate[]): Promise<void> {
  for (const candidate of candidates) {
    if (candidate.tokenAddress === "UNKNOWN") continue;

    const enrichment = await enrichMarketDataForToken(candidate.tokenAddress, candidate);

    candidate.marketCap = candidate.marketCap ?? enrichment.marketCap;
    candidate.price = enrichment.price;
    candidate.liquidity = enrichment.liquidity;
    candidate.volume24h = enrichment.volume24h;
    candidate.marketDataRefreshedAt = enrichment.refreshedAt;
    candidate.marketDataAgeMinutes = enrichment.ageMinutes;
    candidate.marketDataSource = enrichment.source;
    candidate.marketDataWarning = enrichment.warning;
    candidate.warningFlags = enrichment.warningFlags;
    candidate.rawDexscreenerSnapshot = enrichment.rawSnapshot;
    candidate.row.price_usd = candidate.row.price_usd ?? enrichment.price;
    candidate.row.token_price_usd = candidate.row.token_price_usd ?? enrichment.price;
    candidate.row.market_cap_usd = candidate.row.market_cap_usd ?? enrichment.marketCap;
    candidate.row.dexscreener_url = candidate.row.dexscreener_url ?? enrichment.pairUrl;

    if (candidate.liquidity !== null && candidate.liquidity < scoringConfig.freshScanRules.minLiquidityUsd && !candidate.riskFlags.includes("thin_liquidity")) {
      candidate.riskFlags.push("thin_liquidity");
    }

    refreshFreshScanCandidateScoring(candidate);
  }
}

function applyFreshScanHardReject(candidate: FreshScanCandidate): void {
  if (candidate.gate0Status === "reject") return;

  const reasons: string[] = [];
  const rules = scoringConfig.freshScanRules;

  if ((candidate.marketCap ?? 0) < rules.minMcap && (candidate.flow24h ?? 0) < rules.min24hFlowUsd) reasons.push("極小MCapかつflow不足");
  if ((candidate.traderCount ?? 0) < rules.minTraders) reasons.push("単独flowに近い");
  if (candidate.liquidity !== null && candidate.liquidity < 10_000) reasons.push("Liquidity $10K未満");
  if ((candidate.flowMcapRatio ?? 0) >= rules.minFlowMcap && (candidate.flow24h ?? 0) < rules.min24hFlowUsd) reasons.push("Flow/MCapだけ高く24h Flowが小さい");
  if (candidate.riskFlags.includes("bot_like")) reasons.push("bot-like / micro-arb疑い");
  if (candidate.marketCap !== null && candidate.marketCap > rules.maxMcap && !rules.allowAboveMaxMcapIfStrong) reasons.push("MCap上限超え");

  if (reasons.length > 0) {
    candidate.hardRejectStatus = "reject";
    candidate.hardRejectReason = reasons.join(" / ");
    candidate.exclusionReason = candidate.hardRejectReason;
  }
}

function applyFreshScanMomentumGate(candidates: FreshScanCandidate[]): FreshScanCandidate[] {
  const passed = candidates
    .filter((candidate) => candidate.gate0Status === "pass" && candidate.hardRejectStatus !== "reject")
    .sort((a, b) => b.momentumScore - a.momentumScore)
    .slice(0, scoringConfig.freshScanRules.momentumGateSize);

  const passedSet = new Set(passed.map((candidate) => candidate.tokenAddress));

  for (const candidate of candidates) {
    if (passedSet.has(candidate.tokenAddress)) {
      candidate.momentumGateStatus = "pass";
      candidate.momentumGateReason = `Momentum Score ${candidate.momentumScore}/100で上位${scoringConfig.freshScanRules.momentumGateSize}入り`;
    }
  }

  return passed;
}

function applyFreshScanPreFilter(momentumCandidates: FreshScanCandidate[]): FreshScanCandidate[] {
  const ranked = [...momentumCandidates]
    .map((candidate) => {
      let score = candidate.momentumScore;

      if ((candidate.flow24h ?? 0) >= scoringConfig.freshScanRules.min24hFlowUsd) score += 8;
      if ((candidate.flowMcapRatio ?? 0) >= scoringConfig.freshScanRules.minFlowMcap) score += 8;
      if ((candidate.traderCount ?? 0) >= 3) score += 5;
      if ((candidate.flow7d ?? 0) > 0) score += 5;
      if ((candidate.liquidity ?? 0) >= scoringConfig.freshScanRules.minLiquidityUsd) score += 4;
      if (candidate.candidateSources.length > 1) score += 4;
      if (candidate.riskFlags.length === 0) score += 3;
      if ((candidate.traderCount ?? 0) <= 2) score -= 6;
      if (candidate.liquidity !== null && candidate.liquidity < scoringConfig.freshScanRules.minLiquidityUsd) score -= 6;
      if ((candidate.marketCap ?? 0) < scoringConfig.freshScanRules.minMcap) score -= 8;
      if (candidate.marketCap !== null && candidate.marketCap > scoringConfig.freshScanRules.maxMcap) score -= 8;
      if ((candidate.ageDays ?? 0) >= 5 && (candidate.flow24h ?? 0) < scoringConfig.freshScanRules.min24hFlowUsd) score -= 4;
      if ((candidate.flow7d ?? 0) < 0) score -= 4;
      if (candidate.riskFlags.includes("bot_like") || candidate.riskFlags.includes("thin_liquidity")) score -= 8;

      candidate.cliCandidateScore = clampScore(score, 0, 120);

      return candidate;
    })
    .sort((a, b) => b.cliCandidateScore - a.cliCandidateScore)
    .slice(0, scoringConfig.freshScanRules.preFilterSize);

  ranked.forEach((candidate, index) => {
    candidate.preFilterStatus = "pass";
    candidate.preFilterRank = index + 1;
    candidate.preFilterReason = `CLI検証前スコア ${candidate.cliCandidateScore}/120`;
  });

  return ranked;
}

function gradeCliQuality(deepCheck: DeepCheckReply): { grade: CliGrade; reason: string | null; status: string } {
  const flow = deepCheck.flowQuality.label;
  const balance = deepCheck.buyerSellerBalance.label;
  const holder = deepCheck.holderQuality.label;
  const sell = deepCheck.sellPressure.label;
  const cluster = deepCheck.clusterRisk.label;
  const botLike = deepCheck.walletQuality.behaviorCounts["Micro-arb"] + deepCheck.walletQuality.behaviorCounts["Mirror-like"] >= 3;

  if (balance === "Bearish" || sell === "High" || cluster === "High" || botLike || (holder === "High" && flow === "Weak")) {
    return { grade: "Reject", reason: "CLI Quality Gate Reject", status: "checked" };
  }

  if (flow === "Strong" && balance === "Bullish") {
    return { grade: "A", reason: null, status: "checked" };
  }

  if (flow === "Medium") {
    return { grade: "B", reason: null, status: "checked" };
  }

  return { grade: "C", reason: null, status: "checked" };
}

async function applyFreshScanCliOracle(preFiltered: FreshScanCandidate[]): Promise<void> {
  if (
    scoringConfig.freshScanRules.mode === "data_collection" ||
    !scoringConfig.freshScanRules.useCliOracle ||
    scoringConfig.freshScanRules.cliOracleCheckSize <= 0
  ) {
    for (const candidate of preFiltered) {
      candidate.cliChecked = false;
      candidate.cliGrade = "Unchecked";
      candidate.cliOracleStatus = "skipped_data_collection_mode";
    }
    return;
  }

  const candidates = preFiltered.slice(0, scoringConfig.freshScanRules.cliOracleCheckSize);

  for (const candidate of candidates) {
    candidate.whySelectedForCli = `Pre-filter #${candidate.preFilterRank ?? "-"} / score ${candidate.cliCandidateScore}`;
    candidate.cliChecked = true;

    try {
      const tracking = await withNansenCreditTracking(`fresh-scan-cli-oracle:${candidate.tokenAddress}`, () => buildDeepCheckReply(candidate.tokenAddress));

      if ((tracking.usedCredits ?? 0) > scoringConfig.freshScanRules.maxCliCreditsPerRun) {
        candidate.cliOracleStatus = "skipped_credit_guard";
        candidate.cliGrade = "C";
        continue;
      }

      const gate = gradeCliQuality(tracking.result);

      candidate.cliGrade = gate.grade;
      candidate.cliOracleStatus = gate.status;
      candidate.cliRejectReason = gate.reason;
      saveDeepCheckResult(tracking.result, null, {
        sourceType: "fresh_scan",
        scanId: candidate.scanId,
        scanCandidateId: `${candidate.scanId}:${candidate.tokenAddress}:${candidate.candidateRank}`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "不明なエラー";

      candidate.cliGrade = "C";
      candidate.cliOracleStatus = `failed: ${message}`;
    }
  }
}

function selectFreshScanFinalCandidates(candidates: FreshScanCandidate[]): FreshScanCandidate[] {
  const gradeWeight: Record<CliGrade, number> = { A: 4, B: 3, C: 2, Unchecked: 1, Reject: 0 };
  const eligible = candidates
    .filter((candidate) => candidate.preFilterStatus === "pass")
    .filter((candidate) => candidate.cliGrade !== "Reject")
    .sort((a, b) => {
      const gradeDiff = gradeWeight[b.cliGrade] - gradeWeight[a.cliGrade];

      if (gradeDiff !== 0) return gradeDiff;

      return b.score - a.score;
    });
  const selected: FreshScanCandidate[] = [];
  const signalCounts = new Map<SignalType, number>();
  let largeMcapCount = 0;
  let riskCount = 0;

  for (const candidate of eligible) {
    if (selected.length >= scoringConfig.freshScanRules.maxSignalsPerRun) break;

    const signalCount = signalCounts.get(candidate.signalType) ?? 0;
    const isLargeMcap = (candidate.marketCap ?? 0) >= scoringConfig.freshScanRules.largeMcapThreshold;
    const isRisk = candidate.signalType === "thin_liquidity" || candidate.signalType === "bot_like_flow";

    if (signalCount >= scoringConfig.freshScanRules.maxPerSignalType && scoringConfig.freshScanRules.forceDiversity) continue;
    if (isLargeMcap && largeMcapCount >= scoringConfig.freshScanRules.maxLargeMcapPerRun) continue;
    if (isRisk && riskCount >= scoringConfig.freshScanRules.maxRiskSignalsPerRun) continue;

    selected.push(candidate);
    signalCounts.set(candidate.signalType, signalCount + 1);
    if (isLargeMcap) largeMcapCount += 1;
    if (isRisk) riskCount += 1;
  }

  selected.forEach((candidate, index) => {
    candidate.finalRank = index + 1;
    candidate.finalRankReason = `CLI Grade ${candidate.cliGrade} / score ${candidate.score}`;
  });

  for (const candidate of candidates) {
    if (candidate.finalRank === null && !candidate.exclusionReason) {
      candidate.exclusionReason = candidate.cliGrade === "Reject" ? candidate.cliRejectReason : "Final Selection外";
    }
  }

  return selected;
}

function serializeFreshScanCandidate(candidate: FreshScanCandidate) {
  return {
    scan_id: candidate.scanId,
    token_address: candidate.tokenAddress,
    symbol: candidate.symbol,
    name: candidate.name,
    candidate_rank: candidate.candidateRank,
    candidate_sources: JSON.stringify(candidate.candidateSources),
    mcap: candidate.marketCap,
    price: candidate.price,
    entry_price: candidate.price,
    age_days: candidate.ageDays,
    liquidity: candidate.liquidity,
    volume_24h: candidate.volume24h,
    market_data_refreshed_at: candidate.marketDataRefreshedAt,
    market_data_age_minutes: candidate.marketDataAgeMinutes,
    market_data_source: candidate.marketDataSource,
    market_data_warning: candidate.marketDataWarning,
    raw_dexscreener_snapshot: JSON.stringify(candidate.rawDexscreenerSnapshot ?? null),
    flow_24h: candidate.flow24h,
    flow_7d: candidate.flow7d,
    flow_mcap: candidate.flowMcapRatio,
    traders: candidate.traderCount,
    gate_0_status: candidate.gate0Status,
    gate_0_reason: candidate.gate0Reason,
    hard_reject_status: candidate.hardRejectStatus,
    hard_reject_reason: candidate.hardRejectReason,
    risk_flags: JSON.stringify(candidate.riskFlags),
    momentum_score: candidate.momentumScore,
    momentum_gate_status: candidate.momentumGateStatus,
    momentum_gate_reason: candidate.momentumGateReason,
    fresh_scan_rank_score: candidate.score,
    fresh_scan_rank_components: JSON.stringify(candidate.rankComponents),
    pre_filter_status: candidate.preFilterStatus,
    pre_filter_rank: candidate.preFilterRank,
    pre_filter_reason: candidate.preFilterReason,
    cli_candidate_score: candidate.cliCandidateScore,
    why_selected_for_cli: candidate.whySelectedForCli,
    cli_checked: candidate.cliChecked ? 1 : 0,
    cli_grade: candidate.cliGrade,
    cli_oracle_status: candidate.cliOracleStatus,
    cli_reject_reason: candidate.cliRejectReason,
    final_rank: candidate.finalRank,
    final_rank_reason: candidate.finalRankReason,
    posted: candidate.posted ? 1 : 0,
    posted_message_id: candidate.postedMessageId,
    score: candidate.score,
    signal_type: candidate.signalType,
    exclusion_reason: candidate.exclusionReason,
    rank_bucket: candidate.score >= 85 ? "top" : candidate.score >= 70 ? "strong" : candidate.score >= 50 ? "watch" : "low",
    positive_flags: JSON.stringify([
      candidate.flowMcapRatio !== null && candidate.flowMcapRatio >= scoringConfig.freshScanRules.minFlowMcap ? "flow_mcap_pass" : null,
      (candidate.traderCount ?? 0) >= scoringConfig.freshScanRules.minTraders ? "traders_pass" : null,
    ].filter(Boolean)),
    warning_flags: JSON.stringify(Array.from(new Set([...candidate.warningFlags, ...candidate.riskFlags]))),
    pass_reason_codes: JSON.stringify([
      candidate.gate0Status === "pass" ? "fresh_gate_0_pass" : null,
      candidate.preFilterStatus === "pass" ? "fresh_pre_filter_pass" : null,
      candidate.finalRank !== null ? "fresh_final_selected" : null,
    ].filter(Boolean)),
    reject_reason_codes: JSON.stringify(candidate.exclusionReason ? [candidate.exclusionReason.toLowerCase().replace(/[^a-z0-9]+/g, "_")] : []),
    created_at: candidate.createdAt,
  };
}

async function buildFreshScanV2(
  rows: NetflowRow[],
  source: NansenDataSource,
  label: MemeScanLabel,
  fetchMetadata: NansenFetchMetadata,
): Promise<{ candidates: FreshScanCandidate[]; selectedRows: NetflowRow[]; scanId: string; scanTime: string }> {
  const scanId = randomUUID();
  const scanTime = new Date().toISOString();
  const pool = rows.slice(0, scoringConfig.freshScanRules.candidatePoolSize);
  const candidates = pool.map((row, index) => buildFreshScanCandidate(row, scanId, index + 1, scanTime));
  const cutoffIso = getRecentCutoffIso(scoringConfig.freshScanRules.dedupeHours);
  const seen = new Set<string>();

  for (const candidate of candidates) {
    applyFreshScanGate0(candidate, cutoffIso, seen);
    applyFreshScanHardReject(candidate);
  }

  const momentumCandidates = applyFreshScanMomentumGate(candidates);
  await enrichFreshScanCandidates(momentumCandidates);
  const preFiltered = applyFreshScanPreFilter(momentumCandidates);
  await enrichFreshScanCandidates(preFiltered);

  await applyFreshScanCliOracle(preFiltered);
  if (scoringConfig.freshScanRules.mode === "data_collection") {
    for (const candidate of candidates) {
      if (!candidate.cliChecked) {
        candidate.cliOracleStatus = "skipped_data_collection_mode";
        candidate.cliGrade = "Unchecked";
      }
    }
  }

  const selected = selectFreshScanFinalCandidates(candidates);
  await enrichFreshScanCandidates(selected);

  try {
    await freshScanStore.saveRun(
      {
        scan_id: scanId,
        label,
        source,
        candidate_pool_size: candidates.length,
        requested_candidate_pool_size: fetchMetadata.requestedCandidatePoolSize,
        actual_candidate_pool_size: fetchMetadata.actualCandidatePoolSize,
        nansen_page_limit: fetchMetadata.nansenPageLimit,
        nansen_pagination_used: fetchMetadata.nansenPaginationUsed ? 1 : 0,
        nansen_fetch_warning: fetchMetadata.nansenFetchWarning,
        gate_0_count: candidates.filter((candidate) => candidate.gate0Status === "pass").length,
        hard_reject_count: candidates.filter((candidate) => candidate.hardRejectStatus === "reject").length,
        momentum_gate_count: momentumCandidates.length,
        pre_filter_count: preFiltered.length,
        cli_checked_count: candidates.filter((candidate) => candidate.cliChecked).length,
        final_count: selected.length,
        config_snapshot: JSON.stringify(scoringConfig.freshScanRules),
        market_context: JSON.stringify({ source, label }),
        credits_by_step: JSON.stringify({ cli_checked_count: candidates.filter((candidate) => candidate.cliChecked).length }),
        created_at: scanTime,
      },
      candidates.map(serializeFreshScanCandidate),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "不明なエラー";

    console.warn(`Fresh Scan v2候補保存に失敗しました (${freshScanStore.provider}): ${message}`);
  }

  return {
    candidates,
    selectedRows: selected.map((candidate) => candidate.row),
    scanId,
    scanTime,
  };
}

async function saveFreshCandidateTrackingSnapshot(
  candidates: FreshScanCandidate[],
  snapshotLabel: "1h" | "4h" | "12h" | "24h" | "48h" | "7d",
): Promise<void> {
  const snapshotTime = new Date().toISOString();

  for (const candidate of candidates) {
    if (candidate.tokenAddress === "UNKNOWN") continue;

    try {
      const data = await fetchDexScreenerMarketData(candidate.tokenAddress);
      const currentMcap = data?.marketCap ?? null;
      const returnX = candidate.marketCap && currentMcap ? currentMcap / candidate.marketCap : null;

      await freshScanStore.savePerformanceSnapshot({
        scan_id: candidate.scanId,
        token_address: candidate.tokenAddress,
        snapshot_label: snapshotLabel,
        snapshot_time: snapshotTime,
        mcap: currentMcap,
        price: data?.price ?? null,
        liquidity: data?.liquidity ?? null,
        volume_24h: data?.volume24h ?? null,
        return_x: returnX,
        entry_mcap: candidate.marketCap,
        created_at: snapshotTime,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "不明なエラー";

      console.warn(`Fresh Scan candidate snapshotに失敗しました: ${candidate.tokenAddress} ${snapshotLabel} ${message}`);
    }
  }
}

function scheduleFreshCandidateTracking(candidates: FreshScanCandidate[]): void {
  if (!scoringConfig.freshScanRules.trackAllCandidates || candidates.length === 0) return;

  const jobs: Array<{ label: "1h" | "4h" | "12h" | "24h" | "48h" | "7d"; delayMs: number }> = [
    { label: "1h", delayMs: 60 * 60 * 1000 },
    { label: "4h", delayMs: 4 * 60 * 60 * 1000 },
    { label: "12h", delayMs: 12 * 60 * 60 * 1000 },
    { label: "24h", delayMs: 24 * 60 * 60 * 1000 },
    { label: "48h", delayMs: 48 * 60 * 60 * 1000 },
    { label: "7d", delayMs: 7 * 24 * 60 * 60 * 1000 },
  ];

  for (const job of jobs) {
    setTimeout(() => {
      void saveFreshCandidateTrackingSnapshot(candidates, job.label);
    }, job.delayMs);
  }
}

function formatPumpReturnX(value: number): string {
  return `${value.toFixed(2)}x`;
}

function getTokenLinks(tokenAddress: string): string {
  return [
    `[DexScreener](https://dexscreener.com/solana/${tokenAddress})`,
    `[GMGN](https://gmgn.ai/sol/token/${tokenAddress})`,
    `[UniversalX](https://universalx.app/trade?assetId=101_${tokenAddress})`,
  ].join("｜");
}

function trackingSnapshotLabelToHours(label: "1h" | "4h" | "12h" | "24h" | "48h" | "7d"): number {
  return Number(label.replace("h", "").replace("d", "")) * (label.endsWith("d") ? 24 : 1);
}

function getAlertCandidateId(candidate: AlertV2Candidate): string {
  return `${candidate.alertRunId}:${candidate.tokenAddress}:${candidate.candidateRank}`;
}

async function maybePostAlertPumpNotification(
  candidate: AlertV2Candidate,
  snapshotLabel: "1h" | "4h" | "12h" | "24h" | "48h" | "7d",
  marketData: DexScreenerMarketData | null,
  returnX: number | null,
  channel: SendableChannel,
  notifiedAt: string,
): Promise<void> {
  const threshold = 2;

  if (!candidate.posted || returnX === null || returnX < threshold) {
    return;
  }

  const currentMcap = marketData?.marketCap ?? null;
  const timeToPeakHours = trackingSnapshotLabelToHours(snapshotLabel);
  const insertResult = insertAlertPumpNotification.run(
    randomUUID(),
    getAlertCandidateId(candidate),
    candidate.alertRunId,
    candidate.tokenAddress,
    threshold,
    returnX,
    candidate.entryMcap,
    currentMcap,
    timeToPeakHours,
    snapshotLabel,
    channel.id ?? null,
    notifiedAt,
  ) as { changes: number };

  if (insertResult.changes === 0) {
    return;
  }

  const symbol = candidate.symbol && candidate.symbol !== "UNKNOWN"
    ? formatDisplaySymbol(candidate.symbol)
    : shortenAddress(candidate.tokenAddress);
  const message = await channel.send({
    embeds: [
      new EmbedBuilder()
        .setTitle("🚀 Alert Pump Hit")
        .setDescription(`${symbol} が Alert後に ${formatPumpReturnX(returnX)} 到達`)
        .addFields(
          { name: "検出時MCap", value: formatCompactUsd(candidate.entryMcap), inline: true },
          { name: "現在MCap", value: formatCompactUsd(currentMcap), inline: true },
          { name: "到達時間", value: `${timeToPeakHours}h`, inline: true },
          { name: "Source", value: "Alert", inline: true },
          { name: "CA", value: `\`${candidate.tokenAddress}\`` },
          { name: "Links", value: getTokenLinks(candidate.tokenAddress) },
        )
        .setTimestamp(new Date(notifiedAt)),
    ],
  });

  updateAlertPumpNotificationMessage.run(message.id, getAlertCandidateId(candidate), threshold);
}

async function saveAlertCandidateTrackingSnapshot(
  candidates: AlertV2Candidate[],
  snapshotLabel: "1h" | "4h" | "12h" | "24h" | "48h" | "7d",
  channel: SendableChannel,
): Promise<void> {
  const snapshotTime = new Date().toISOString();

  for (const candidate of candidates) {
    if (candidate.tokenAddress === "UNKNOWN") continue;

    try {
      const data = await fetchDexScreenerMarketData(candidate.tokenAddress);
      const currentMcap = data?.marketCap ?? null;
      const returnX = candidate.entryMcap && currentMcap ? currentMcap / candidate.entryMcap : null;

      await alertStore.savePerformanceSnapshot({
        alert_candidate_id: getAlertCandidateId(candidate),
        alert_run_id: candidate.alertRunId,
        token_address: candidate.tokenAddress,
        snapshot_label: snapshotLabel,
        snapshot_time: snapshotTime,
        mcap: currentMcap,
        price: data?.price ?? null,
        liquidity: data?.liquidity ?? null,
        volume_24h: data?.volume24h ?? null,
        return_x: returnX,
        entry_mcap: candidate.entryMcap,
        created_at: snapshotTime,
      });
      await maybePostAlertPumpNotification(candidate, snapshotLabel, data, returnX, channel, snapshotTime);
    } catch (error) {
      const message = error instanceof Error ? error.message : "不明なエラー";

      console.warn(`Alert candidate snapshotに失敗しました: ${candidate.tokenAddress} ${snapshotLabel} ${message}`);
    }
  }
}

function scheduleAlertCandidateTracking(candidates: AlertV2Candidate[], channel: SendableChannel): void {
  const trackingTargets = candidates.filter((candidate) => candidate.posted);

  if (!scoringConfig.alertRules.trackAllCandidates || trackingTargets.length === 0) return;

  const jobs: Array<{ label: "1h" | "4h" | "12h" | "24h" | "48h" | "7d"; delayMs: number }> = [
    { label: "1h", delayMs: 60 * 60 * 1000 },
    { label: "4h", delayMs: 4 * 60 * 60 * 1000 },
    { label: "12h", delayMs: 12 * 60 * 60 * 1000 },
    { label: "24h", delayMs: 24 * 60 * 60 * 1000 },
    { label: "48h", delayMs: 48 * 60 * 60 * 1000 },
    { label: "7d", delayMs: 7 * 24 * 60 * 60 * 1000 },
  ];

  for (const job of jobs) {
    setTimeout(() => {
      void saveAlertCandidateTrackingSnapshot(trackingTargets, job.label, channel);
    }, job.delayMs);
  }
}

function getFreshScanCards(cards: MemeResearchCard[]): MemeResearchCard[] {
  const rules = scoringConfig.freshScanRules;
  const cutoffIso = getRecentCutoffIso(rules.dedupeHours);
  const seen = new Set<string>();

  return cards
    .filter((card) => {
      if (card.tokenAddress === "UNKNOWN" || seen.has(card.tokenAddress)) {
        return false;
      }

      seen.add(card.tokenAddress);

      if (hasRecentSignal(card.tokenAddress, cutoffIso)) {
        return false;
      }

      const mcapBucket = findRangeBucket(card.marketCap, scoringConfig.mcapBuckets);

      // 定時Fresh Scanでは設定上限を超える大型候補を出さず、小型初動に寄せます。
      if (
        card.marketCap !== null &&
        (card.marketCap >= rules.maxMcap || mcapBucket?.freshScanAllowed === false)
      ) {
        return false;
      }

      if ((card.flow24h ?? 0) <= 0 || card.edgeScore < 50) {
        return false;
      }

      return true;
    })
    .sort((a, b) => {
      const reFlowDiff = Number(a.isReFlow) - Number(b.isReFlow);

      if (reFlowDiff !== 0) {
        return reFlowDiff;
      }

      const mcapDiff = getFreshScanMcapRank(a.marketCap) - getFreshScanMcapRank(b.marketCap);

      if (mcapDiff !== 0) {
        return mcapDiff;
      }

      return b.edgeScore - a.edgeScore;
    })
    .slice(0, rules.maxSignalsPerRun);
}

function saveMemeSignals(cards: MemeResearchCard[]): void {
  const transaction = db.transaction((signals: MemeResearchCard[]) => {
    for (const signal of signals) {
      insertSignal.run(signal);
    }
  });

  transaction(cards);
}

function getStatusColor(status: MemeStatus): number {
  if (status === "🟢 強め") {
    return 0x2ecc71;
  }

  if (status === "🟡 監視候補") {
    return 0xf1c40f;
  }

  if (status === "🟠 高リスク・様子見") {
    return 0xe67e22;
  }

  return 0xe74c3c;
}

function formatNansenGrade(grade: CliGrade | null | undefined): string {
  return grade && grade !== "Unchecked" ? grade : "未検証";
}

function buildCardStatsRows(card: MemeResearchCard): Array<[string, string]> {
  return [
    ["時価総額", formatCompactUsd(card.marketCap)],
    ["流動性", formatCompactUsd(card.liquidity)],
    ["経過日数", card.ageDays !== null ? `${card.ageDays.toFixed(1)}日` : card.tokenAge],
    ["Flow/MCap", formatPercent(card.flowMcapRatio)],
    ["24h流入", formatCompactUsd(card.flow24h)],
    ["Traders", `${formatCount(card.traderCount)}人`],
  ];
}

function buildCardDetectionRows(
  card: MemeResearchCard,
  deepCheck?: DeepCheckReply,
  candidate?: AlertV2Candidate,
): Array<[string, string]> {
  const rows: Array<[string, string]> = [];

  if (card.flowMcapRatio !== null) {
    rows.push([`Flow/MCap ${formatPercent(card.flowMcapRatio)}`, "MCap比で流入強め"]);
  }

  if (card.traderCount !== null) {
    const traderNote = card.traderCount >= 3 ? "複数walletが反応" : "少数walletの反応";
    rows.push([`Traders ${formatCount(card.traderCount)}人`, traderNote]);
  }

  if (deepCheck) {
    const hasHighRisk = (
      deepCheck.holderQuality.label === "High" ||
      deepCheck.sellPressure.label === "High" ||
      deepCheck.clusterRisk.label === "High"
    );

    if (!hasHighRisk) {
      rows.push(["Risk Highなし", "Holder / Sell / Cluster確認済み"]);
    }

    if (rows.length < 3 && deepCheck.buyerSellerBalance.label === "Bullish") {
      rows.push(["売買バランス", "買い優勢"]);
    } else if (rows.length < 3 && deepCheck.buyerSellerBalance.label === "Neutral") {
      rows.push(["売買バランス", "中立"]);
    }
  }

  if (
    rows.length < 3 &&
    candidate &&
    candidate.knownWalletCount > 0 &&
    (candidate.strongWalletCount > 0 || candidate.mediumWalletCount > 0)
  ) {
    rows.push(["Smart Wallet実績あり", "過去Hit walletを確認"]);
  }

  if (rows.length < 3 && (card.flow24h ?? 0) > 0) {
    rows.push([`24h流入 ${formatCompactUsd(card.flow24h)}`, "Smart Money flowあり"]);
  }

  if (rows.length === 0) {
    rows.push(["Smart Money flow", "検出済み"]);
  }

  return rows.slice(0, 3);
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
): InstanceType<typeof EmbedBuilder> {
  const relatedLinks = [
    `[DexScreener](${card.dexscreenerUrl})`,
    `[GMGN](${card.gmgnUrl})`,
    `[UniversalX](${card.universalxUrl})`,
  ].join("｜");
  const riskLabels = getResearchCardRiskLabels(card);
  const description = [
    "**判定**",
    ...formatTreeRows([
      ["評価", `${card.status}｜${card.edgeScore}/100`],
      ["検出理由", formatSignalTypeLabel(card.signalType)],
      ["注意点", formatDisplayRiskLine(riskLabels)],
      ["Nansen評価", formatNansenGrade(card.cliGrade)],
    ]),
    "",
    "**Stats**",
    ...formatTreeRows(buildCardStatsRows(card)),
    "",
    "**検出理由**",
    ...formatTreeRows(buildCardDetectionRows(card)),
    "",
    "**CA**",
    `\`${card.tokenAddress}\``,
    "",
    "**関連リンク**",
    relatedLinks,
  ].join("\n");

  const embed = new EmbedBuilder()
    .setTitle(`#${index + 1} ${cleanDisplaySymbol(card.symbol)} / ${card.name}`)
    .setColor(getStatusColor(card.status))
    .setDescription(description)
    .setTimestamp(new Date(card.scanTime));

  if (card.tokenIconUrl) {
    embed.setThumbnail(card.tokenIconUrl);
  }

  return embed;
}

function getAlertType(): AlertType {
  return "alert_edge";
}

function calculateFreshnessMinutes(sourceDetectedAt: string, now = Date.now()): number {
  const detected = new Date(sourceDetectedAt).getTime();

  return Number.isFinite(detected) ? Math.max(0, Math.round((now - detected) / 60_000)) : 999_999;
}

function scoreAlertFreshness(minutes: number): number {
  for (const bucket of scoringConfig.alertRules.freshnessScore.buckets) {
    if (bucket.maxMinutes === null || minutes <= bucket.maxMinutes) {
      return Math.min(scoringConfig.alertRules.freshnessScore.maxPoints, bucket.score);
    }
  }

  return 0;
}

function sourceTypeLabel(sourceType: AlertCandidateSourceType): string {
  switch (sourceType) {
    case "fresh_scan_reaccelerated":
      return "Fresh Re-Acceleration";
    case "watch_reaccelerated":
      return "Watch Re-Acceleration";
    case "cli_near_miss_recheck":
      return "CLI Near-Miss Recheck";
    case "nansen_new":
    default:
      return "Nansen New";
  }
}

function buildAlertMomentumComponents(candidate: AlertV2Candidate): Record<string, number> {
  const shortTermFlow = Math.max(candidate.flow1h ?? 0, candidate.flow4h ?? 0);
  const flowMcap = candidate.flowMcapRatio ?? 0;
  const flow24h = candidate.flow24h ?? 0;
  const traders = candidate.traderCount ?? 0;
  const liquidity = candidate.liquidity ?? 0;
  const riskPenalty = Math.max(-30, -(
    (candidate.riskFlags.includes("thin_liquidity") ? 8 : 0) +
    (candidate.riskFlags.includes("old_without_reacceleration") ? 10 : 0) +
    (candidate.riskFlags.includes("recent_alert_dedupe") ? 12 : 0)
  ));

  return {
    shortTermFlowAcceleration: Math.min(25, Math.round((Math.log10(shortTermFlow + 1) / 5) * 25)),
    flowMcapImpact: Math.min(25, Math.round((flowMcap / 0.08) * 25)),
    flow24hStrength: Math.min(15, Math.round((Math.log10(flow24h + 1) / 5) * 15)),
    tradersConfirmation: traders >= 12 ? 15 : traders >= 8 ? 12 : traders >= 5 ? 9 : traders >= 3 ? 6 : 0,
    liquidityQuality: liquidity >= 100_000 ? 10 : liquidity >= scoringConfig.alertRules.thinLiquidityThresholdUsd ? 7 : liquidity >= scoringConfig.alertRules.minLiquidityUsd ? 4 : liquidity > 0 ? 1 : 0,
    freshnessScore: scoreAlertFreshness(candidate.candidateFreshnessMinutes),
    ageRelevance: candidate.ageDays === null ? 2 : candidate.ageDays <= 1 ? 5 : candidate.ageDays <= 5 ? 4 : candidate.ageDays <= 30 ? 2 : 0,
    flow7dContinuity: (candidate.flow7d ?? 0) > 0 ? 5 : 0,
    sourceConfirmation: Math.min(5, Math.max(0, candidate.candidateSources.length - 1) * 3),
    riskPenalty,
  };
}

function calculateSmartMoneyQualityScore(deepCheck: DeepCheckReply, gate: AlertQualityGateResult): number {
  let score = 50;

  if (deepCheck.flowQuality.label === "Strong") score += 18;
  if (deepCheck.flowQuality.label === "Medium") score += 10;
  if (deepCheck.flowQuality.label === "Weak") score -= 12;

  if (deepCheck.walletQuality.walletQualityLevel === "High") score += 14;
  if (deepCheck.walletQuality.walletQualityLevel === "Medium") score += 7;
  if (deepCheck.walletQuality.walletQualityLevel === "Low") score -= 18;

  if (deepCheck.buyerSellerBalance.label === "Bullish") score += 10;
  if (deepCheck.buyerSellerBalance.label === "Bearish") score -= 16;

  if (deepCheck.sellPressure.label === "High") score -= 25;
  if (deepCheck.holderQuality.label === "High") score -= 25;
  if (deepCheck.clusterRisk.label === "High") score -= 30;
  if (deepCheck.clusterRisk.label === "Medium") score -= 10;

  const botLikeWarnings = [
    deepCheck.walletQuality.behaviorCounts["Micro-arb"] > 0,
    deepCheck.walletQuality.behaviorCounts["Mirror-like"] > 0,
    gate.warnings.some((warning) => /micro-arb|mirror|独立wallet/i.test(warning)),
  ].filter(Boolean).length;

  score -= botLikeWarnings * 8;

  if (!gate.passed) score -= 35;

  return clampScore(score);
}

function getSmartWalletProfiles(walletAddresses: string[]): SmartWalletProfileRecord[] {
  const uniqueWallets = Array.from(new Set(walletAddresses.filter(Boolean)));

  if (uniqueWallets.length === 0) {
    return [];
  }

  return getSmartWalletProfilesByAddresses.all(JSON.stringify(uniqueWallets)) as SmartWalletProfileRecord[];
}

function applySmartWalletProfilesToAlertCandidate(candidate: AlertV2Candidate, deepCheck: DeepCheckReply): void {
  const walletAddresses = deepCheck.walletQuality.snapshots.map((snapshot) => snapshot.walletAddress);
  const profiles = getSmartWalletProfiles(walletAddresses);

  if (profiles.length === 0) {
    candidate.smartWalletQualityScore = null;
    candidate.smartWalletQualityLabel = "Unknown";
    candidate.knownWalletCount = 0;
    candidate.walletPdcaSummary = null;
    return;
  }

  const strong = profiles.filter((profile) => profile.wallet_quality_label === "Strong");
  const medium = profiles.filter((profile) => profile.wallet_quality_label === "Medium");
  const weak = profiles.filter((profile) => profile.wallet_quality_label === "Weak");
  const provenHitWallets = profiles.filter((profile) => profile.hit_2x_count > 0 || profile.hit_5x_count > 0);
  const riskyWallets = profiles.filter((profile) => profile.bot_like_count > 0 || profile.high_risk_count > 0);
  const weightedScore = averageNumber(profiles.map((profile) => profile.wallet_quality_score).filter((value) => value > 0));
  let score = weightedScore ?? 45;

  score += Math.min(16, strong.length * 8);
  score += Math.min(8, medium.length * 3);
  score += Math.min(12, provenHitWallets.length * 4);
  score -= Math.min(18, weak.length * 5);
  score -= Math.min(22, riskyWallets.length * 6);

  const clamped = clampScore(score);
  const label = clamped >= 75 ? "Strong" : clamped >= 50 ? "Medium" : "Weak";

  candidate.smartWalletQualityScore = clamped;
  candidate.smartWalletQualityLabel = label;
  candidate.strongWalletCount = strong.length;
  candidate.mediumWalletCount = medium.length;
  candidate.weakWalletCount = weak.length;
  candidate.knownWalletCount = profiles.length;
  candidate.walletPdcaSummary = {
    score: clamped,
    label,
    known_wallet_count: profiles.length,
    strong_wallet_count: strong.length,
    medium_wallet_count: medium.length,
    weak_wallet_count: weak.length,
    proven_hit_wallet_count: provenHitWallets.length,
    risky_wallet_count: riskyWallets.length,
    avg_wallet_quality_score: weightedScore,
  };
}

function parseStringArrayJson(raw: string | null | undefined): string[] {
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);

    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function getFlowMcapAutoTuningBucket(value: number | null | undefined): string {
  if (value === null || value === undefined) return "unknown";
  if (value < 0.01) return "0-1%";
  if (value < 0.03) return "1-3%";
  if (value < 0.10) return "3-10%";
  return "10%+";
}

function getLiquidityAutoTuningBucket(value: number | null | undefined): string {
  if (value === null || value === undefined) return "unknown";
  if (value < 40_000) return "$15K-$40K";
  if (value < 100_000) return "$40K-$100K";
  return "$100K+";
}

function getTradersAutoTuningBucket(value: number | null | undefined): string {
  if (value === null || value === undefined) return "unknown";
  if (value <= 4) return "2-4";
  if (value <= 9) return "5-9";
  if (value <= 29) return "10-29";
  return "30+";
}

function getMcapAutoTuningBucket(value: number | null | undefined): string {
  if (value === null || value === undefined) return "unknown";
  if (value < 500_000) return "$50K-$500K";
  if (value < 2_000_000) return "$500K-$2M";
  if (value < 10_000_000) return "$2M-$10M";
  return "$10M+";
}

function getAgeAutoTuningBucket(value: number | null | undefined): string {
  if (value === null || value === undefined) return "unknown";
  if (value <= 1) return "0-1d";
  if (value <= 5) return "1-5d";
  if (value <= 30) return "5-30d";
  return "30d+";
}

function getAutoTuningBucketsForCandidate(candidate: AlertV2Candidate): Array<[string, string]> {
  const buckets: Array<[string, string]> = [
    ["flow_mcap", getFlowMcapAutoTuningBucket(candidate.flowMcapRatio)],
    ["liquidity", getLiquidityAutoTuningBucket(candidate.liquidity)],
    ["traders", getTradersAutoTuningBucket(candidate.traderCount)],
    ["mcap", getMcapAutoTuningBucket(candidate.marketCap)],
    ["age", getAgeAutoTuningBucket(candidate.ageDays)],
    ["source_type", candidate.candidateSourceType],
    ["cli_grade", candidate.cliGrade ?? "Unchecked"],
    ["flow_quality", candidate.flowQuality ?? "N/A"],
    ["holder_risk", candidate.holderRisk ?? "N/A"],
    ["buyer_seller_balance", candidate.buyerSellerBalance ?? "N/A"],
    ["sell_pressure", candidate.sellPressure ?? "N/A"],
    ["wallet_quality", candidate.walletQuality ?? "N/A"],
    ["cluster_risk", candidate.clusterRisk ?? "未検証"],
    ["smart_wallet_quality", candidate.smartWalletQualityLabel ?? "Unknown"],
  ];

  const riskFlags = candidate.riskFlags.length > 0 ? candidate.riskFlags : ["risk_none"];
  const warningFlags = candidate.warningFlags.length > 0 ? candidate.warningFlags : [];

  return [
    ...buckets,
    ...riskFlags.map((flag): [string, string] => ["risk_flag", flag]),
    ...warningFlags.map((flag): [string, string] => ["warning_flag", flag]),
  ];
}

function getAutoTuningBucketsForRow(row: AutoTuningCandidateRow): Array<[string, string]> {
  const riskFlags = parseStringArrayJson(row.risk_flags);
  const warningFlags = parseStringArrayJson(row.warning_flags);
  const buckets: Array<[string, string]> = [
    ["flow_mcap", getFlowMcapAutoTuningBucket(row.flow_mcap)],
    ["liquidity", getLiquidityAutoTuningBucket(row.liquidity)],
    ["traders", getTradersAutoTuningBucket(row.traders)],
    ["mcap", getMcapAutoTuningBucket(row.mcap)],
    ["age", getAgeAutoTuningBucket(row.age_days)],
    ["source_type", row.candidate_source_type ?? "unknown"],
    ["cli_grade", row.cli_grade ?? "Unchecked"],
    ["flow_quality", row.flow_quality ?? "N/A"],
    ["holder_risk", row.holder_risk ?? "N/A"],
    ["buyer_seller_balance", row.buyer_seller_balance ?? "N/A"],
    ["sell_pressure", row.sell_pressure ?? "N/A"],
    ["wallet_quality", row.wallet_quality ?? "N/A"],
    ["cluster_risk", row.cluster_risk ?? "未検証"],
    ["smart_wallet_quality", row.smart_wallet_quality_label ?? "Unknown"],
    ...(riskFlags.length > 0 ? riskFlags : ["risk_none"]).map((flag): [string, string] => ["risk_flag", flag]),
    ...warningFlags.map((flag): [string, string] => ["warning_flag", flag]),
  ];

  return buckets;
}

function getAutoTuningMaxAdjustment(sampleSize: number): number {
  if (sampleSize < 30) return 0;
  if (sampleSize < 100) return 2;
  if (sampleSize < 300) return 3;
  return 5;
}

function isNeutralAutoTuningBucket(bucketType: string, bucketName: string): boolean {
  return (
    bucketName === "N/A" ||
    bucketName === "Unknown" ||
    bucketName === "Unchecked" ||
    bucketName === "未検証" ||
    bucketName === "unknown" ||
    bucketName === "risk_none" ||
    (bucketType === "smart_wallet_quality" && bucketName === "Unknown")
  );
}

function isProtectedPositiveAutoTuningBucket(bucketType: string, bucketName: string): boolean {
  return (
    (bucketType === "cli_grade" && (bucketName === "A" || bucketName === "B")) ||
    (bucketType === "flow_quality" && bucketName === "Strong") ||
    (bucketType === "risk_flag" && bucketName === "risk_none")
  );
}

function isAllowedNegativeAutoTuningBucket(bucketType: string, bucketName: string): boolean {
  const text = `${bucketType}:${bucketName}`.toLowerCase();

  return (
    text.includes("thin_liquidity") ||
    text.includes("holder") ||
    text.includes("sell_pressure") ||
    text.includes("cluster_risk:high") ||
    text.includes("cluster_risk:medium") ||
    text.includes("bot") ||
    text.includes("mirror") ||
    text.includes("micro") ||
    text.includes("arb") ||
    (bucketType === "liquidity" && bucketName === "$15K-$40K")
  );
}

function isRiskNoPositiveAutoTuningBucket(bucketType: string, bucketName: string): boolean {
  const text = `${bucketType}:${bucketName}`.toLowerCase();
  const rawText = `${bucketType}:${bucketName}`;

  return (
    text.includes("holder_risk:high") ||
    text.includes("holder_risk:medium") ||
    text.includes("sell_pressure:high") ||
    text.includes("sell_pressure:medium") ||
    text.includes("cluster_risk:high") ||
    text.includes("cluster_risk:medium") ||
    text.includes("bot") ||
    text.includes("mirror") ||
    text.includes("micro") ||
    text.includes("arb") ||
    rawText.includes("holder集中") ||
    rawText.includes("売り圧") ||
    rawText.includes("不自然flow") ||
    rawText.includes("不自然Flow")
  );
}

function calculateAutoTuningBucketAdjustment(params: {
  bucketType: string;
  bucketName: string;
  sampleSize: number;
  avgPeakReturn: number | null;
  hit2xRate: number;
  hit5xRate: number;
  badResultRate: number;
  baseline: AutoTuningBaseline;
}): { adjustment: number; reason: string } {
  const maxAdjustment = getAutoTuningMaxAdjustment(params.sampleSize);

  if (maxAdjustment === 0) {
    return { adjustment: 0, reason: "sample_size < 30" };
  }

  if (isNeutralAutoTuningBucket(params.bucketType, params.bucketName)) {
    return { adjustment: 0, reason: "neutral or unverified bucket" };
  }

  const avgPeak = params.avgPeakReturn ?? 0;
  const baselineAvgPeak = params.baseline.avgPeakReturn ?? 0;
  const avgPeakLift = avgPeak - baselineAvgPeak;
  const hit2xLift = params.hit2xRate - params.baseline.hit2xRate;
  const hit5xLift = params.hit5xRate - params.baseline.hit5xRate;
  const badRateLift = params.badResultRate - params.baseline.badResultRate;
  const protectedPositive = isProtectedPositiveAutoTuningBucket(params.bucketType, params.bucketName);
  let rawAdjustment = 0;
  const reasons: string[] = [];

  if (hit2xLift >= 0.03 && avgPeakLift >= 0.05) {
    rawAdjustment += 2;
    reasons.push("hit_2x_rate and avg_peak_return above baseline");
  }
  if (hit2xLift >= 0.08 && avgPeakLift >= 0.12) {
    rawAdjustment += 2;
    reasons.push("clear 2x hit rate lift");
  }
  if (hit5xLift >= 0.01) {
    rawAdjustment += 1;
    reasons.push("5x hit rate above baseline");
  }
  if (badRateLift <= -0.05) {
    rawAdjustment += 1;
    reasons.push("bad_result_rate below baseline");
  }

  const allowNegative = isAllowedNegativeAutoTuningBucket(params.bucketType, params.bucketName);
  const hit2xAtOrAboveBaseline = hit2xLift >= 0;

  if (allowNegative && !(protectedPositive && hit2xAtOrAboveBaseline)) {
    if (badRateLift >= 0.08) {
      rawAdjustment -= 2;
      reasons.push("bad_result_rate above baseline");
    }
    if (avgPeakLift <= -0.12 && hit2xLift <= -0.02) {
      rawAdjustment -= 2;
      reasons.push("avg_peak_return and hit_2x_rate below baseline");
    }
    if (hit2xLift <= -0.06 && avgPeakLift <= -0.05) {
      rawAdjustment -= 1;
      reasons.push("low hit rate versus baseline");
    }
  }

  if (protectedPositive && rawAdjustment < 0 && hit2xAtOrAboveBaseline) {
    rawAdjustment = 0;
    reasons.push("protected positive bucket with hit_2x_rate at or above baseline");
  }

  if (isRiskNoPositiveAutoTuningBucket(params.bucketType, params.bucketName) && rawAdjustment > 0) {
    rawAdjustment = 0;
    reasons.push("risk bucket capped at 0 for safety");
  }

  return {
    adjustment: clampScore(rawAdjustment, -maxAdjustment, maxAdjustment),
    reason: reasons.join("; ") || "neutral bucket",
  };
}

function refreshAutoTuningResults(): AutoTuningBucketResult[] {
  const cutoff = new Date(Date.now() - AUTO_TUNING_DATA_WINDOW_HOURS * 3_600_000).toISOString();
  const rows = (getAutoTuningCandidateRows.all(cutoff) as AutoTuningCandidateRow[])
    .filter((row) => row.peak_return_x !== null && Number.isFinite(row.peak_return_x));
  const groups = new Map<string, { bucketType: string; bucketName: string; returns: number[] }>();
  const globalReturns = rows
    .map((row) => row.peak_return_x)
    .filter((value): value is number => value !== null && Number.isFinite(value));
  const baseline: AutoTuningBaseline = {
    sampleSize: globalReturns.length,
    avgPeakReturn: averageNumber(globalReturns),
    hit2xRate: globalReturns.length > 0 ? globalReturns.filter((value) => value >= 2).length / globalReturns.length : 0,
    hit5xRate: globalReturns.length > 0 ? globalReturns.filter((value) => value >= 5).length / globalReturns.length : 0,
    badResultRate: globalReturns.length > 0 ? globalReturns.filter((value) => value < 0.7).length / globalReturns.length : 0,
  };

  for (const row of rows) {
    const peakReturn = row.peak_return_x;

    if (peakReturn === null) continue;

    for (const [bucketType, bucketName] of getAutoTuningBucketsForRow(row)) {
      const key = `${bucketType}:${bucketName}`;
      const group = groups.get(key) ?? { bucketType, bucketName, returns: [] };

      group.returns.push(peakReturn);
      groups.set(key, group);
    }
  }

  const results = Array.from(groups.values()).map((group): AutoTuningBucketResult => {
    const sampleSize = group.returns.length;
    const avgPeakReturn = averageNumber(group.returns);
    const hit2xRate = group.returns.filter((value) => value >= 2).length / sampleSize;
    const hit5xRate = group.returns.filter((value) => value >= 5).length / sampleSize;
    const badResultRate = group.returns.filter((value) => value < 0.7).length / sampleSize;
    const bestPeakReturn = Math.max(...group.returns);
    const tuning = calculateAutoTuningBucketAdjustment({
      bucketType: group.bucketType,
      bucketName: group.bucketName,
      sampleSize,
      avgPeakReturn,
      hit2xRate,
      hit5xRate,
      badResultRate,
      baseline,
    });

    return {
      bucketType: group.bucketType,
      bucketName: group.bucketName,
      sampleSize,
      avgPeakReturn,
      hit2xRate,
      hit5xRate,
      badResultRate,
      bestPeakReturn,
      adjustment: tuning.adjustment,
      reason: tuning.reason,
    };
  });

  const runId = randomUUID();
  const createdAt = new Date().toISOString();
  const write = db.transaction((items: AutoTuningBucketResult[]) => {
    for (const item of items) {
      insertAutoTuningResult.run(
        runId,
        createdAt,
        item.sampleSize,
        AUTO_TUNING_DATA_WINDOW_HOURS,
        item.bucketType,
        item.bucketName,
        item.avgPeakReturn,
        item.hit2xRate,
        item.hit5xRate,
        item.badResultRate,
        item.bestPeakReturn,
        item.adjustment,
        item.reason,
        AUTO_TUNING_VERSION,
      );
    }
  });

  if (results.length > 0) {
    write(results);
  }

  return results;
}

function getLatestAutoTuningMap(): Map<string, AutoTuningResultRecord> {
  const rows = getLatestAutoTuningResults.all(AUTO_TUNING_VERSION, AUTO_TUNING_VERSION) as AutoTuningResultRecord[];

  return new Map(rows.map((row) => [`${row.bucket_type}:${row.bucket_name}`, row]));
}

function applyAutoTuningToAlertCandidate(
  candidate: AlertV2Candidate,
  tuningMap: Map<string, AutoTuningResultRecord>,
): void {
  const reasons: string[] = [];
  let adjustment = 0;

  for (const [bucketType, bucketName] of getAutoTuningBucketsForCandidate(candidate)) {
    const bucket = tuningMap.get(`${bucketType}:${bucketName}`);

    if (!bucket || bucket.sample_size < 30 || bucket.adjustment === 0) {
      continue;
    }

    adjustment += bucket.adjustment;
    reasons.push(`${bucketType}:${bucketName} ${bucket.adjustment > 0 ? "+" : ""}${bucket.adjustment} (${bucket.reason ?? "auto-tuning"})`);
  }

  candidate.autoTuningAdjustment = clampScore(adjustment, -10, 10);
  candidate.autoTuningReasons = reasons.slice(0, 8);
  candidate.autoTuningVersion = reasons.length > 0 ? AUTO_TUNING_VERSION : null;
}

function getAlertFinalSelectionScore(candidate: AlertV2Candidate): number {
  const quality = candidate.smartMoneyQualityScore ?? 35;
  const smartWalletBonus = candidate.smartWalletQualityScore !== null
    ? (candidate.smartWalletQualityScore - 50) * 0.35
    : 0;
  const gradeBonus: Record<CliGrade, number> = {
    A: 18,
    B: 10,
    C: -8,
    Reject: -80,
    Unchecked: -15,
  };
  const riskPenalty = Math.min(35, candidate.riskFlags.length * 6 + candidate.qualityGateWarnings.length * 5);

  return clampScore(candidate.alertMomentumScore + quality + smartWalletBonus + candidate.autoTuningAdjustment + gradeBonus[candidate.cliGrade] - riskPenalty);
}

function createAlertCardFromCandidate(candidate: AlertV2Candidate): MemeResearchCard {
  const signalId = randomUUID();
  const tokenAddress = candidate.tokenAddress;
  const pairUrl = getFirstTextFromRecords(candidate.rawDexscreenerSnapshot, [/^url$/]);

  return {
    signalId,
    scanId: candidate.alertRunId,
    tokenAddress,
    symbol: candidate.symbol,
    name: candidate.name,
    narrative: "",
    narrativeSummary: "",
    narrativeType: "flow_driven",
    narrativeSources: "[]",
    narrativeEvidence: "[]",
    narrativeTags: "[]",
    narrativeConfidence: "Low",
    signalType: "alert_edge",
    edgeScore: candidate.alertMomentumScore,
    status: getStatus(candidate.alertMomentumScore),
    cliGrade: candidate.cliGrade,
    scoreBreakdown: JSON.stringify(candidate.alertMomentumComponents),
    summary: `Alert v2: MCap ${formatCompactUsd(candidate.marketCap)} / Flow/MCap ${formatPercent(candidate.flowMcapRatio)}`,
    scanTime: candidate.createdAt,
    marketCap: candidate.marketCap,
    price: candidate.price,
    liquidity: candidate.liquidity,
    flow24h: candidate.flow24h,
    flow7d: candidate.flow7d,
    flowMcapRatio: candidate.flowMcapRatio,
    traderCount: candidate.traderCount,
    tokenAge: candidate.ageDays === null ? "不明" : `${candidate.ageDays.toFixed(1)}日`,
    whyFlagged: candidate.preFilterReason,
    risk: candidate.riskFlags.join(" / ") || "Quality Gateで確認",
    tokenIconUrl: candidate.tokenIconUrl ?? getBestImageUrlFromValue(candidate.rawDexscreenerSnapshot),
    dexscreenerUrl: isValidHttpUrl(pairUrl) ? pairUrl : `https://dexscreener.com/solana/${tokenAddress}`,
    gmgnUrl: `https://gmgn.ai/sol/token/${tokenAddress}`,
    universalxUrl: `https://universalx.app/trade?assetId=101_${tokenAddress}`,
    nansenUrl: "",
    ageDays: candidate.ageDays,
    isReFlow: candidate.isReaccelerated,
  };
}

function buildAlertV2Candidate(params: {
  alertRunId: string;
  tokenAddress: string;
  symbol: string | null;
  name: string | null;
  sourceType: AlertCandidateSourceType;
  sourceDetectedAt: string;
  marketCap: number | null;
  price: number | null;
  ageDays: number | null;
  liquidity: number | null;
  flow1h?: number | null;
  flow4h?: number | null;
  flow24h: number | null;
  flow7d: number | null;
  traderCount: number | null;
  sourceMarketCap?: number | null;
  sourceFlow24h?: number | null;
  sourceTraders?: number | null;
  fromFreshScanId?: string | null;
  fromScanCandidateId?: string | null;
  fromWatchPickId?: string | null;
  rawDexscreenerSnapshot?: unknown;
  candidateRank: number;
}): AlertV2Candidate {
  const nowIso = new Date().toISOString();
  const candidateFreshnessMinutes = calculateFreshnessMinutes(params.sourceDetectedAt);
  const marketDataAgeMinutes = 0;
  const flowMcapRatio = params.marketCap && params.flow24h !== null ? params.flow24h / params.marketCap : null;
  const reaccelerationReasons: string[] = [];
  const rules = scoringConfig.alertRules.reaccelerationRules;

  if (rules.enabled) {
    if (params.sourceMarketCap && params.marketCap && params.marketCap >= params.sourceMarketCap * rules.minMcapMultipleFromSource) {
      reaccelerationReasons.push("mcap_1_5x");
    }
    if (params.sourceFlow24h && params.flow24h && params.flow24h >= params.sourceFlow24h * rules.minFlow24hMultipleFromSource) {
      reaccelerationReasons.push("flow24h_1_5x");
    }
    if (params.sourceTraders && params.traderCount && params.traderCount >= params.sourceTraders * rules.minTradersMultipleFromSource) {
      reaccelerationReasons.push("traders_1_5x");
    }
    if ((flowMcapRatio ?? 0) >= scoringConfig.alertRules.minFlowMcap) {
      reaccelerationReasons.push("flow_mcap_alert_threshold");
    }
  }

  const isOldSource = candidateFreshnessMinutes > 60;
  const isReaccelerated = params.sourceType === "nansen_new" ? false : reaccelerationReasons.length > 0;
  const riskFlags: string[] = [];

  if (
    params.liquidity !== null &&
    params.liquidity >= scoringConfig.alertRules.minLiquidityUsd &&
    params.liquidity < scoringConfig.alertRules.thinLiquidityThresholdUsd
  ) riskFlags.push("thin_liquidity");
  if (isOldSource && !isReaccelerated) riskFlags.push("old_without_reacceleration");

  const candidate: AlertV2Candidate = {
    alertRunId: params.alertRunId,
    tokenAddress: params.tokenAddress,
    symbol: params.symbol ?? "UNKNOWN",
    name: params.name ?? params.symbol ?? "UNKNOWN",
    candidateRank: params.candidateRank,
    candidateSourceType: params.sourceType,
    candidateSources: [params.sourceType],
    sourceQuotaBucket: params.sourceType,
    sourcePriority: params.sourceType === "nansen_new" ? 1 : params.sourceType === "fresh_scan_reaccelerated" ? 2 : 3,
    sourceDetectedAt: params.sourceDetectedAt,
    candidateFreshnessMinutes,
    marketDataRefreshedAt: nowIso,
    marketDataAgeMinutes,
    marketDataSource: params.rawDexscreenerSnapshot ? "dexscreener" : null,
    marketDataWarning: null,
    fromFreshScanId: params.fromFreshScanId ?? null,
    fromScanCandidateId: params.fromScanCandidateId ?? null,
    fromPreviousAlertRunId: null,
    fromWatchPickId: params.fromWatchPickId ?? null,
    isReaccelerated,
    reaccelerationReason: reaccelerationReasons.join(", ") || null,
    marketCap: params.marketCap,
    price: params.price,
    ageDays: params.ageDays,
    liquidity: params.liquidity,
    volume24h: null,
    flow1h: params.flow1h ?? null,
    flow4h: params.flow4h ?? null,
    flow24h: params.flow24h,
    flow7d: params.flow7d,
    flowMcapRatio,
    traderCount: params.traderCount,
    gate0Status: "pass",
    gate0Reason: "未判定",
    alertMomentumScore: 0,
    alertMomentumComponents: {},
    smartMoneyQualityScore: null,
    smartWalletQualityScore: null,
    smartWalletQualityLabel: null,
    strongWalletCount: 0,
    mediumWalletCount: 0,
    weakWalletCount: 0,
    knownWalletCount: 0,
    walletPdcaSummary: null,
    autoTuningAdjustment: 0,
    autoTuningReasons: [],
    autoTuningVersion: null,
    preFilterStatus: "fail",
    preFilterRank: null,
    preFilterReason: "Pre-filter未通過",
    cliChecked: false,
    cliGrade: "Unchecked",
    cliOracleStatus: "not_checked",
    rawCliSummary: null,
    flowQuality: null,
    holderRisk: null,
    buyerSellerBalance: null,
    sellPressure: null,
    walletQuality: null,
    clusterRisk: null,
    qualityGateGrade: null,
    qualityGateReasons: [],
    qualityGateWarnings: [],
    positiveFlags: [],
    riskFlags,
    warningFlags: [],
    passReasonCodes: [],
    rejectReasonCodes: [],
    rankBucket: null,
    finalRank: null,
    posted: false,
    postedMessageId: null,
    entryMcap: params.marketCap,
    entryPrice: params.price,
    tokenIconUrl: getBestImageUrlFromValue(params.rawDexscreenerSnapshot),
    rawDexscreenerSnapshot: params.rawDexscreenerSnapshot ?? null,
    createdAt: nowIso,
    card: {} as MemeResearchCard,
    isRealert: false,
    realertReason: null,
  };

  candidate.alertMomentumComponents = buildAlertMomentumComponents(candidate);
  candidate.alertMomentumScore = clampScore(Object.values(candidate.alertMomentumComponents).reduce((sum, value) => sum + value, 0));
  candidate.rankBucket = candidate.alertMomentumScore >= 85 ? "top" : candidate.alertMomentumScore >= 75 ? "strong" : candidate.alertMomentumScore >= 60 ? "watch" : "low";
  if (candidate.price === null) candidate.warningFlags.push("price_missing");
  if (candidate.liquidity === null) candidate.warningFlags.push("liquidity_missing");
  if (candidate.ageDays === null) candidate.warningFlags.push("age_missing");
  candidate.card = createAlertCardFromCandidate(candidate);

  return candidate;
}

function getAlertReasonLines(card: MemeResearchCard): string[] {
  return [
    `MCap ${formatCompactUsd(card.marketCap)}`,
    `Flow/MCap ${formatPercent(card.flowMcapRatio)}`,
    `24h Flow ${formatCompactUsd(card.flow24h)}`,
    `Traders ${formatCount(card.traderCount)}人`,
    `Age ${card.tokenAge}`,
  ];
}

function isAlertCandidate(card: MemeResearchCard): boolean {
  const rules = scoringConfig.alertRules;

  if (card.marketCap === null) {
    return false;
  }

  if (card.edgeScore < rules.minScore) {
    return false;
  }

  if ((card.flow24h ?? 0) <= 0) {
    return false;
  }

  if ((card.traderCount ?? 0) < rules.minTraders) {
    return false;
  }

  return true;
}

function applyAlertGate0(candidate: AlertV2Candidate, seen: Set<string>): void {
  const rules = scoringConfig.alertRules;
  const reasons: string[] = [];

  if (candidate.tokenAddress === "UNKNOWN") reasons.push("token_addressなし");
  if (seen.has(candidate.tokenAddress)) reasons.push("重複token");
  if (candidate.marketCap === null) reasons.push("MCapなし");
  if (candidate.liquidity === null) {
    reasons.push("liquidity_missing");
    if (!candidate.warningFlags.includes("liquidity_missing")) candidate.warningFlags.push("liquidity_missing");
    if (!candidate.riskFlags.includes("liquidity_missing")) candidate.riskFlags.push("liquidity_missing");
  } else if (candidate.liquidity < rules.minLiquidityUsd) {
    reasons.push("Liquidity不足");
  } else if (candidate.liquidity < rules.thinLiquidityThresholdUsd && !candidate.riskFlags.includes("thin_liquidity")) {
    candidate.riskFlags.push("thin_liquidity");
  }
  if (candidate.flow24h === null || candidate.flow24h <= 0) reasons.push("24h Flowなし");
  if ((candidate.traderCount ?? 0) < rules.minTraders) reasons.push("Traders不足");
  if (candidate.marketDataAgeMinutes > rules.maxMarketDataAgeMinutes) reasons.push("market dataが古い");
  if (candidate.riskFlags.includes("old_without_reacceleration")) reasons.push("古いsourceで再加速なし");

  const latestAlert = getLatestAlertByToken.get(candidate.tokenAddress) as {
    alert_id: string;
    alert_run_id: string | null;
    mcap: number | null;
    flow_24h: number | null;
    traders: number | null;
    cli_grade: string | null;
    triggered_at: string;
  } | undefined;

  if (latestAlert) {
    const hoursSince = (Date.now() - new Date(latestAlert.triggered_at).getTime()) / 3_600_000;
    const withinDedupe = hoursSince < rules.dedupeHours;
    const canRealert = rules.reAlert.enabled &&
      hoursSince >= rules.reAlert.minHoursSinceLastAlert &&
      (
        (latestAlert.mcap && candidate.marketCap && candidate.marketCap >= latestAlert.mcap * rules.reAlert.mcapMultipleFromLastAlert) ||
        (latestAlert.flow_24h && candidate.flow24h && candidate.flow24h >= latestAlert.flow_24h * rules.reAlert.flow24hMultipleFromLastAlert) ||
        (latestAlert.traders && candidate.traderCount && candidate.traderCount >= latestAlert.traders * rules.reAlert.tradersMultipleFromLastAlert)
      );

    if (withinDedupe && !canRealert) {
      reasons.push(`${rules.dedupeHours}h以内にAlert済み`);
      candidate.riskFlags.push("recent_alert_dedupe");
    } else if (canRealert) {
      candidate.isRealert = true;
      candidate.realertReason = "二段目条件を満たしたため再Alert候補";
    }
  }

  seen.add(candidate.tokenAddress);

  if (reasons.length > 0) {
    candidate.gate0Status = "reject";
    candidate.gate0Reason = reasons.join(" / ");
    candidate.rejectReasonCodes = reasons.map((reason) => reason.toLowerCase().replace(/[^a-z0-9]+/g, "_")).filter(Boolean);
  } else {
    candidate.gate0Status = "pass";
    candidate.gate0Reason = "Alert Gate 0通過";
    candidate.passReasonCodes.push("alert_gate_0_pass");
  }
}

async function enrichAlertCandidatesBeforeGate(candidates: AlertV2Candidate[]): Promise<void> {
  for (const candidate of candidates) {
    if (candidate.tokenAddress === "UNKNOWN") continue;

    const enrichment = await enrichMarketDataForToken(candidate.tokenAddress, candidate);

    candidate.marketCap = candidate.marketCap ?? enrichment.marketCap;
    candidate.price = enrichment.price;
    candidate.entryPrice = candidate.entryPrice ?? enrichment.entryPrice;
    candidate.liquidity = enrichment.liquidity;
    candidate.volume24h = enrichment.volume24h;
    candidate.marketDataRefreshedAt = enrichment.refreshedAt;
    candidate.marketDataAgeMinutes = enrichment.ageMinutes;
    candidate.marketDataSource = enrichment.source;
    candidate.marketDataWarning = enrichment.warning;
    candidate.warningFlags = enrichment.warningFlags;
    candidate.rawDexscreenerSnapshot = enrichment.rawSnapshot;
    candidate.tokenIconUrl = getBestImageUrlFromValue(enrichment.rawSnapshot) ?? candidate.tokenIconUrl;
    candidate.flowMcapRatio = candidate.marketCap && candidate.flow24h !== null ? candidate.flow24h / candidate.marketCap : null;

    if (
      candidate.liquidity !== null &&
      candidate.liquidity >= scoringConfig.alertRules.minLiquidityUsd &&
      candidate.liquidity < scoringConfig.alertRules.thinLiquidityThresholdUsd &&
      !candidate.riskFlags.includes("thin_liquidity")
    ) {
      candidate.riskFlags.push("thin_liquidity");
    }

    candidate.alertMomentumComponents = buildAlertMomentumComponents(candidate);
    candidate.alertMomentumScore = clampScore(Object.values(candidate.alertMomentumComponents).reduce((sum, value) => sum + value, 0));
    candidate.rankBucket = candidate.alertMomentumScore >= 85 ? "top" : candidate.alertMomentumScore >= 75 ? "strong" : candidate.alertMomentumScore >= 60 ? "watch" : "low";
    candidate.card = createAlertCardFromCandidate(candidate);
  }
}

function mergeAlertCandidates(candidates: AlertV2Candidate[]): AlertV2Candidate[] {
  const merged = new Map<string, AlertV2Candidate>();

  for (const candidate of candidates) {
    const existing = merged.get(candidate.tokenAddress);

    if (!existing) {
      merged.set(candidate.tokenAddress, candidate);
      continue;
    }

    existing.candidateSources = Array.from(new Set([...existing.candidateSources, ...candidate.candidateSources]));
    existing.positiveFlags.push("source_confirmation");
    existing.alertMomentumScore = clampScore(existing.alertMomentumScore + 5);
    existing.card.edgeScore = existing.alertMomentumScore;
    existing.card.status = getStatus(existing.alertMomentumScore);
  }

  return Array.from(merged.values());
}

async function buildAlertV2CandidatesFromSources(alertRunId: string): Promise<{
  candidates: AlertV2Candidate[];
  nansenCount: number;
  freshCount: number;
  watchCount: number;
}> {
  const { rows } = await fetchNansenAlertLightRows();
  const rules = scoringConfig.alertRules;
  const nowIso = new Date().toISOString();
  const nansen = rows.slice(0, rules.nansenCandidateSize).map((row, index) => {
    const marketCap = toFiniteNumber(row.market_cap_usd);
    const flow24h = toFiniteNumber(row.net_flow_24h_usd);

    return buildAlertV2Candidate({
      alertRunId,
      tokenAddress: toDisplayText(row.token_address, "UNKNOWN"),
      symbol: toDisplayText(row.token_symbol, "UNKNOWN"),
      name: toDisplayText(row.token_name ?? row.name, toDisplayText(row.token_symbol, "UNKNOWN")),
      sourceType: "nansen_new",
      sourceDetectedAt: nowIso,
      marketCap,
      price: toFiniteNumber(row.price_usd ?? row.token_price_usd),
      ageDays: toFiniteNumber(row.token_age_days),
      liquidity: getFirstNumberFromRecords(row, [/liquidity/]),
      flow24h,
      flow7d: toFiniteNumber(row.net_flow_7d_usd),
      traderCount: toFiniteNumber(row.trader_count),
      candidateRank: index + 1,
    });
  });
  const freshRows = getRecentFreshScanCandidatesForAlert.all(
    getRecentCutoffIso(rules.freshScanLookbackHours),
    rules.freshScanDbCandidateSize,
  ) as Array<Record<string, unknown>>;
  const fresh: AlertV2Candidate[] = [];

  for (const [index, row] of freshRows.entries()) {
    const tokenAddress = toDisplayText(row.token_address, "UNKNOWN");
    const market = await fetchDexScreenerMarketData(tokenAddress);
    const sourceMcap = toFiniteNumber(row.mcap);
    const sourceFlow = toFiniteNumber(row.flow_24h);
    const marketCap = market?.marketCap ?? sourceMcap;
    const flow24h = sourceFlow;

    fresh.push(buildAlertV2Candidate({
      alertRunId,
      tokenAddress,
      symbol: toOptionalText(row.symbol) ?? "UNKNOWN",
      name: toOptionalText(row.name) ?? toOptionalText(row.symbol) ?? "UNKNOWN",
      sourceType: "fresh_scan_reaccelerated",
      sourceDetectedAt: toOptionalText(row.created_at) ?? nowIso,
      marketCap,
      price: market?.price ?? null,
      ageDays: toFiniteNumber(row.age_days),
      liquidity: market?.liquidity ?? toFiniteNumber(row.liquidity),
      flow24h,
      flow7d: toFiniteNumber(row.flow_7d),
      traderCount: toFiniteNumber(row.traders),
      sourceMarketCap: sourceMcap,
      sourceFlow24h: sourceFlow,
      sourceTraders: toFiniteNumber(row.traders),
      fromFreshScanId: toOptionalText(row.scan_id),
      fromScanCandidateId: toOptionalText(row.id),
      rawDexscreenerSnapshot: market?.raw ?? null,
      candidateRank: nansen.length + index + 1,
    }));
  }

  const watchRows = getRecentWatchCandidatesForAlert.all(
    getRecentCutoffIso(rules.watchCandidateLookbackHours),
    rules.watchCandidateSize,
  ) as Array<Record<string, unknown>>;
  const watch: AlertV2Candidate[] = [];

  for (const [index, row] of watchRows.entries()) {
    const tokenAddress = toDisplayText(row.token_address, "UNKNOWN");
    const market = await fetchDexScreenerMarketData(tokenAddress);
    const sourceMcap = toFiniteNumber(row.scan_mcap);
    const sourceFlow = toFiniteNumber(row.flow_24h);
    const marketCap = market?.marketCap ?? sourceMcap;

    watch.push(buildAlertV2Candidate({
      alertRunId,
      tokenAddress,
      symbol: toOptionalText(row.symbol) ?? "UNKNOWN",
      name: toOptionalText(row.name) ?? toOptionalText(row.symbol) ?? "UNKNOWN",
      sourceType: toOptionalText(row.action) === "watch" ? "watch_reaccelerated" : "cli_near_miss_recheck",
      sourceDetectedAt: toOptionalText(row.clicked_at) ?? nowIso,
      marketCap,
      price: market?.price ?? toFiniteNumber(row.scan_price),
      ageDays: parseTokenAgeDays(toOptionalText(row.token_age)),
      liquidity: market?.liquidity ?? null,
      flow24h: sourceFlow,
      flow7d: toFiniteNumber(row.flow_7d),
      traderCount: toFiniteNumber(row.trader_count),
      sourceMarketCap: sourceMcap,
      sourceFlow24h: sourceFlow,
      sourceTraders: toFiniteNumber(row.trader_count),
      fromWatchPickId: toOptionalText(row.pick_id),
      rawDexscreenerSnapshot: market?.raw ?? null,
      candidateRank: nansen.length + fresh.length + index + 1,
    }));
  }

  const merged = mergeAlertCandidates([...nansen, ...fresh, ...watch])
    .sort((a, b) => b.alertMomentumScore - a.alertMomentumScore)
    .slice(0, rules.candidatePoolSize);

  merged.forEach((candidate, index) => {
    candidate.candidateRank = index + 1;
  });

  return {
    candidates: merged,
    nansenCount: nansen.length,
    freshCount: fresh.length,
    watchCount: watch.length,
  };
}

function applyAlertPreFilter(candidates: AlertV2Candidate[]): AlertV2Candidate[] {
  const rules = scoringConfig.alertRules;
  const gatePassed = candidates
    .filter((candidate) => candidate.gate0Status === "pass")
    .sort((a, b) => {
      const sourceDiff = (a.candidateSourceType === "nansen_new" ? 1 : 0) - (b.candidateSourceType === "nansen_new" ? 1 : 0);

      if (sourceDiff !== 0) return -sourceDiff;
      return b.alertMomentumScore - a.alertMomentumScore;
    });
  const selected: AlertV2Candidate[] = [];
  let freshCount = 0;
  let watchCount = 0;

  for (const candidate of gatePassed) {
    const isFresh = candidate.candidateSourceType === "fresh_scan_reaccelerated";
    const isWatch = candidate.candidateSourceType === "watch_reaccelerated" || candidate.candidateSourceType === "cli_near_miss_recheck";

    if (selected.length >= rules.preFilterSize) break;
    if (isFresh && freshCount >= rules.maxFreshScanDbCandidatesInPreFilter) continue;
    if (isWatch && watchCount >= rules.maxWatchCandidatesInPreFilter) continue;

    selected.push(candidate);
    if (isFresh) freshCount += 1;
    if (isWatch) watchCount += 1;
  }

  selected.forEach((candidate, index) => {
    candidate.preFilterStatus = "pass";
    candidate.preFilterRank = index + 1;
    candidate.preFilterReason = `Alert Momentum ${candidate.alertMomentumScore}/100 / ${sourceTypeLabel(candidate.candidateSourceType)}`;
    candidate.passReasonCodes.push("alert_pre_filter_pass");
  });

  return selected;
}

function buildDeepCheckAlertSummary(deepCheck: DeepCheckReply): string {
  return [
    `Flow Quality: ${deepCheck.flowQuality.label}`,
    `Holder Risk: ${deepCheck.holderQuality.label}`,
    `Buyer/Seller: ${deepCheck.buyerSellerBalance.label}`,
    `Sell Pressure: ${deepCheck.sellPressure.label}`,
    `Wallet Quality: ${deepCheck.walletQuality.walletQualityLevel}`,
    `Cluster Risk: ${deepCheck.clusterRisk.label}`,
  ].join("\n");
}

function buildQualityGateSummary(gate: AlertQualityGateResult): string {
  const label = gate.passed ? "通過" : "除外";
  const reasonText = gate.reasons.slice(0, 2).join("｜") || "Quality Gate判定を記録しました。";
  const warningText = gate.warnings.length > 0 ? `\n注意: ${gate.warnings.slice(0, 2).join("｜")}` : "";

  return `${label} - ${reasonText}${warningText}`;
}

function buildAlertEmbed(
  card: MemeResearchCard,
  index: number,
  deepCheck?: DeepCheckReply,
  gate?: AlertQualityGateResult,
  candidate?: AlertV2Candidate,
): InstanceType<typeof EmbedBuilder> {
  const relatedLinks = [
    `[DexScreener](${card.dexscreenerUrl})`,
    `[GMGN](${card.gmgnUrl})`,
    `[UniversalX](${card.universalxUrl})`,
  ].join("｜");
  const riskLabels = getAlertCardRiskLabels(card, deepCheck, gate, candidate);
  const description = [
    "**判定**",
    ...formatTreeRows([
      ["評価", `${card.status}｜${card.edgeScore}/100`],
      ["検出理由", formatSignalTypeLabel(card.signalType)],
      ["注意点", formatDisplayRiskLine(riskLabels)],
      ["Nansen評価", formatNansenGrade(candidate?.cliGrade ?? card.cliGrade)],
    ]),
    "",
    "**Stats**",
    ...formatTreeRows(buildCardStatsRows(card)),
    "",
    "**検出理由**",
    ...formatTreeRows(buildCardDetectionRows(card, deepCheck, candidate)),
    "",
    "**CA**",
    `\`${card.tokenAddress}\``,
    "",
    "**関連リンク**",
    relatedLinks,
  ].join("\n");

  const embed = new EmbedBuilder()
    .setTitle(`#${index + 1} ${cleanDisplaySymbol(card.symbol)} / ${card.name}`)
    .setColor(0xe74c3c)
    .setDescription(description)
    .setTimestamp(new Date(card.scanTime));

  if (card.tokenIconUrl) {
    embed.setThumbnail(card.tokenIconUrl);
  }

  return embed;
}

function saveAlert(
  card: MemeResearchCard,
  channelId: string | null,
  gate?: AlertQualityGateResult,
  deepCheckId?: string | null,
  candidate?: AlertV2Candidate,
  messageId?: string | null,
): string {
  const alertId = randomUUID();
  const createdAt = new Date().toISOString();

  insertAlert.run(
    alertId,
    card.tokenAddress,
    card.signalId,
    getAlertType(),
    card.edgeScore,
    createdAt,
    channelId,
    getAlertReasonLines(card).join(" / "),
    gate?.grade ?? null,
    gate?.reasons.join(" / ") ?? null,
    gate?.warnings.join(" / ") ?? null,
    deepCheckId ?? null,
  );

  if (candidate) {
    updateAlertV2Details.run(
      candidate.alertRunId,
      messageId ?? null,
      candidate.marketCap,
      candidate.ageDays,
      candidate.liquidity,
      candidate.flow1h,
      candidate.flow4h,
      candidate.flow24h,
      candidate.flowMcapRatio,
      candidate.traderCount,
      candidate.alertMomentumScore,
      candidate.cliGrade,
      candidate.candidateSourceType,
      candidate.isRealert ? 1 : 0,
      candidate.realertReason,
      createdAt,
      alertId,
    );
  }

  return alertId;
}

function normalizeTokenAddress(value: string): string {
  return value.trim();
}

function collectNumericValues(value: unknown, path = "", output: Array<{ path: string; value: number }> = []): Array<{ path: string; value: number }> {
  if (typeof value === "number" && Number.isFinite(value)) {
    output.push({ path, value });
    return output;
  }

  if (typeof value === "string") {
    const parsed = Number(value.replace(/[$,%_,]/g, ""));

    if (Number.isFinite(parsed) && value.trim() !== "") {
      output.push({ path, value: parsed });
    }

    return output;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => collectNumericValues(item, `${path}.${index}`, output));
    return output;
  }

  const record = getNestedRecord(value);

  if (record) {
    for (const [key, item] of Object.entries(record)) {
      collectNumericValues(item, path ? `${path}.${key}` : key, output);
    }
  }

  return output;
}

function sumNumbersByPath(value: unknown, patterns: RegExp[]): number {
  return collectNumericValues(value)
    .filter((item) => patterns.some((pattern) => pattern.test(item.path.toLowerCase())))
    .reduce((sum, item) => sum + item.value, 0);
}

function maxNumberByPath(value: unknown, patterns: RegExp[]): number | null {
  const values = collectNumericValues(value)
    .filter((item) => patterns.some((pattern) => pattern.test(item.path.toLowerCase())))
    .map((item) => item.value);

  return values.length > 0 ? Math.max(...values) : null;
}

function countObjects(value: unknown): number {
  if (Array.isArray(value)) {
    return value.length + value.reduce((sum, item) => sum + countObjects(item), 0);
  }

  const record = getNestedRecord(value);

  if (!record) {
    return 0;
  }

  return 1 + Object.values(record).reduce<number>((sum, item) => sum + countObjects(item), 0);
}

function getZeroWalletBehaviorCounts(): Record<WalletBehaviorType, number> {
  return {
    "Fresh Sniper": 0,
    Accumulator: 0,
    "Fast Flipper": 0,
    "Micro-arb": 0,
    "Mirror-like": 0,
    Unknown: 0,
  };
}

function collectRecords(value: unknown, output: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectRecords(item, output);
    }

    return output;
  }

  const record = getNestedRecord(value);

  if (!record) {
    return output;
  }

  output.push(record);

  for (const item of Object.values(record)) {
    if (item && typeof item === "object") {
      collectRecords(item, output);
    }
  }

  return output;
}

function findTextByKey(record: Record<string, unknown>, patterns: RegExp[]): string | null {
  for (const [key, value] of Object.entries(record)) {
    if (typeof value === "string" && patterns.some((pattern) => pattern.test(key.toLowerCase()))) {
      return value;
    }
  }

  return null;
}

function findNumberByKey(record: Record<string, unknown>, patterns: RegExp[]): number | null {
  for (const [key, value] of Object.entries(record)) {
    if (!patterns.some((pattern) => pattern.test(key.toLowerCase()))) {
      continue;
    }

    const numberValue = toFiniteNumber(value);

    if (numberValue !== null) {
      return numberValue;
    }
  }

  return null;
}

function looksLikeWalletAddress(value: string, tokenAddress: string): boolean {
  const trimmed = value.trim();

  return trimmed !== tokenAddress && /^[1-9A-HJ-NP-Za-km-z]{32,64}$/.test(trimmed);
}

function findWalletByKey(record: Record<string, unknown>, tokenAddress: string): string | null {
  for (const [key, value] of Object.entries(record)) {
    if (
      typeof value === "string" &&
      /wallet|trader|maker|owner|buyer|seller|holder|address|account/i.test(key) &&
      looksLikeWalletAddress(value, tokenAddress)
    ) {
      return value.trim();
    }
  }

  return null;
}

function parseTradeTime(record: Record<string, unknown>): number | null {
  const rawTime = findTextByKey(record, [/timestamp|block.*time|time|date/]);
  const numericTime = findNumberByKey(record, [/timestamp|block.*time|time/]);

  if (numericTime !== null) {
    return numericTime > 10_000_000_000 ? numericTime : numericTime * 1000;
  }

  if (!rawTime) {
    return null;
  }

  const parsed = new Date(rawTime).getTime();

  return Number.isFinite(parsed) ? parsed : null;
}

function inferTradeSide(record: Record<string, unknown>): "buy" | "sell" | "unknown" {
  const sideText = [
    findTextByKey(record, [/side|type|action|direction/]),
    findTextByKey(record, [/event|trade/]),
  ].filter(Boolean).join(" ").toLowerCase();

  if (/buy|bought|in/.test(sideText)) {
    return "buy";
  }

  if (/sell|sold|out/.test(sideText)) {
    return "sell";
  }

  const isBuy = record.is_buy ?? record.isBuy;

  if (typeof isBuy === "boolean") {
    return isBuy ? "buy" : "sell";
  }

  return "unknown";
}

function inferTradeToken(record: Record<string, unknown>, targetTokenAddress: string): string {
  const direct = findTextByKey(record, [/token.*address|mint|asset|contract|base.*address/]);
  const joined = Object.values(record)
    .filter((value): value is string => typeof value === "string")
    .join(" ");

  if (joined.includes(targetTokenAddress)) {
    return targetTokenAddress;
  }

  return direct ?? "UNKNOWN";
}

function isWsolTrade(record: Record<string, unknown>): boolean {
  const text = Object.values(record)
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();

  return /\bwsol\b|\bsol\b/.test(text);
}

type ParsedDexTrade = {
  wallet: string;
  token: string;
  side: "buy" | "sell" | "unknown";
  amountUsd: number;
  timestampMs: number | null;
  isWsol: boolean;
  tokenAgeDays: number | null;
};

function parseDexTrades(value: unknown, targetTokenAddress: string): ParsedDexTrade[] {
  return collectRecords(value)
    .map((record): ParsedDexTrade | null => {
      const wallet = findTextByKey(record, [/wallet|trader|maker|owner|address/]);

      if (!wallet || wallet === targetTokenAddress) {
        return null;
      }

      const amountUsd = findNumberByKey(record, [/amount.*usd|volume.*usd|value.*usd|usd|amount|size/]) ?? 0;

      return {
        wallet,
        token: inferTradeToken(record, targetTokenAddress),
        side: inferTradeSide(record),
        amountUsd,
        timestampMs: parseTradeTime(record),
        isWsol: isWsolTrade(record),
        tokenAgeDays: findNumberByKey(record, [/token.*age|age.*day/]),
      };
    })
    .filter((trade): trade is ParsedDexTrade => trade !== null);
}

function extractWalletObservationsFromSource(params: {
  result: DeepCheckReply;
  sourceName: DeepCheckSourceName;
  sourceData: unknown;
  sourceType: "alert" | "fresh_scan" | "deep_check";
  alertRunId?: string | null | undefined;
  alertCandidateId?: string | null | undefined;
  scanId?: string | null | undefined;
  scanCandidateId?: string | null | undefined;
  observedAt?: string;
}): SmartWalletObservationInput[] {
  const now = new Date().toISOString();
  const observedAt = params.observedAt ?? now;
  const observations: SmartWalletObservationInput[] = [];
  const seen = new Set<string>();
  const pushObservation = (input: {
    walletAddress: string;
    side: "buy" | "sell" | "holder" | "unknown";
    amountUsd: number | null;
    rawContext: unknown;
  }) => {
    const walletAddress = input.walletAddress.trim();

    if (!looksLikeWalletAddress(walletAddress, params.result.tokenAddress)) {
      return;
    }

    const key = `${walletAddress}:${input.side}:${input.amountUsd ?? ""}:${params.sourceName}`;

    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    observations.push({
      id: randomUUID(),
      wallet_address: walletAddress,
      token_address: params.result.tokenAddress,
      symbol: params.result.symbol,
      source_type: params.sourceType,
      alert_run_id: params.alertRunId ?? null,
      alert_candidate_id: params.alertCandidateId ?? null,
      scan_id: params.scanId ?? null,
      scan_candidate_id: params.scanCandidateId ?? null,
      observed_at: observedAt,
      side: input.side,
      amount_usd: input.amountUsd,
      token_mcap_at_observation: params.result.marketCap,
      token_price_at_observation: null,
      flow_quality: params.result.flowQuality.label,
      wallet_quality: params.result.walletQuality.walletQualityLevel,
      buyer_seller_balance: params.result.buyerSellerBalance.label,
      sell_pressure: params.result.sellPressure.label,
      holder_risk: params.result.holderQuality.label,
      cluster_risk: params.result.clusterRisk.label,
      raw_context: JSON.stringify({
        source: params.sourceName,
        context: input.rawContext,
      }),
      created_at: now,
    });
  };

  if (params.sourceName === "dex-trades") {
    for (const trade of parseDexTrades(params.sourceData, params.result.tokenAddress)) {
      pushObservation({
        walletAddress: trade.wallet,
        side: trade.side,
        amountUsd: trade.amountUsd > 0 ? trade.amountUsd : null,
        rawContext: trade,
      });
    }

    return observations;
  }

  for (const record of collectRecords(params.sourceData)) {
    const walletAddress = findWalletByKey(record, params.result.tokenAddress);

    if (!walletAddress) {
      continue;
    }

    const side = params.sourceName === "holders"
      ? "holder"
      : inferTradeSide(record);
    const amountUsd = findNumberByKey(record, [/amount.*usd|volume.*usd|value.*usd|usd|buy.*amount|sell.*amount|balance/]);

    pushObservation({
      walletAddress,
      side,
      amountUsd,
      rawContext: record,
    });
  }

  return observations;
}

function buildSmartWalletObservations(params: {
  result: DeepCheckReply;
  sourceType: "alert" | "fresh_scan" | "deep_check";
  alertRunId?: string | null | undefined;
  alertCandidateId?: string | null | undefined;
  scanId?: string | null | undefined;
  scanCandidateId?: string | null | undefined;
  observedAt?: string;
}): SmartWalletObservationInput[] {
  const rawSources = params.result.rawSources;

  if (!rawSources) {
    return [];
  }

  return (["who-bought-sold", "holders", "dex-trades"] as DeepCheckSourceName[])
    .flatMap((sourceName) => {
      const sourceData = rawSources[sourceName];

      if (sourceData === null || sourceData === undefined) {
        return [];
      }

      return extractWalletObservationsFromSource({ ...params, sourceName, sourceData });
    });
}

function averageNumber(values: number[]): number | null {
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function detectMirrorGroups(trades: ParsedDexTrade[]): Map<string, string> {
  const mirrorWalletGroups = new Map<string, string>();
  const buyTrades = trades
    .filter((trade) => trade.side === "buy" && trade.timestampMs !== null && trade.amountUsd > 0)
    .sort((a, b) => (a.timestampMs ?? 0) - (b.timestampMs ?? 0));
  let groupIndex = 1;

  for (let index = 0; index < buyTrades.length; index += 1) {
    const base = buyTrades[index];

    if (!base || base.timestampMs === null) {
      continue;
    }

    const baseTimestampMs = base.timestampMs;
    const group = buyTrades.filter((trade) => (
      trade.wallet !== base.wallet &&
      trade.token === base.token &&
      trade.timestampMs !== null &&
      Math.abs(trade.timestampMs - baseTimestampMs) <= 2_000 &&
      Math.abs(trade.amountUsd - base.amountUsd) / Math.max(base.amountUsd, trade.amountUsd, 1) <= 0.2
    ));

    if (group.length === 0) {
      continue;
    }

    const groupId = `mirror-${groupIndex}`;
    groupIndex += 1;

    mirrorWalletGroups.set(base.wallet, groupId);

    for (const trade of group) {
      mirrorWalletGroups.set(trade.wallet, groupId);
    }
  }

  return mirrorWalletGroups;
}

function hasFastFlip(walletTrades: ParsedDexTrade[]): boolean {
  const buys = walletTrades.filter((trade) => trade.side === "buy" && trade.timestampMs !== null);
  const sells = walletTrades.filter((trade) => trade.side === "sell" && trade.timestampMs !== null);

  return buys.some((buy) => sells.some((sell) => (
    sell.token === buy.token &&
    sell.timestampMs !== null &&
    buy.timestampMs !== null &&
    sell.timestampMs > buy.timestampMs &&
    sell.timestampMs - buy.timestampMs <= 10 * 60 * 1000
  )));
}

function classifyWalletBehavior(params: {
  buyCount: number;
  sellCount: number;
  touchedTokenCount: number;
  avgTradeSize: number | null;
  wsolTradeRatio: number | null;
  earlyTokenBuys: number;
  targetBuyCount: number;
  targetSellCount: number;
  isMirror: boolean;
  fastFlip: boolean;
}): WalletBehaviorType {
  if (params.isMirror) {
    return "Mirror-like";
  }

  if (
    (params.wsolTradeRatio ?? 0) >= 0.7 &&
    (params.avgTradeSize ?? 0) <= 1_000 &&
    params.buyCount + params.sellCount >= 8
  ) {
    return "Micro-arb";
  }

  if (params.fastFlip || params.sellCount > params.buyCount) {
    return "Fast Flipper";
  }

  if (params.targetBuyCount > params.targetSellCount && params.buyCount > params.sellCount) {
    return "Accumulator";
  }

  if (params.earlyTokenBuys >= 2 && params.buyCount >= params.sellCount) {
    return "Fresh Sniper";
  }

  return "Unknown";
}

function analyzeWalletQualityFromDexTrades(
  source: DeepCheckSourceResult,
  targetTokenAddress: string,
): WalletQualityAnalysis {
  const zeroCounts = getZeroWalletBehaviorCounts();

  if (!sourceSucceeded(source)) {
    return {
      walletCount: 0,
      estimatedIndependentWallets: null,
      behaviorCounts: zeroCounts,
      clusterRisk: "未検証",
      clusterReasons: ["smart-money/dex-tradesを取得できないため、Wallet QualityはN/Aです。"],
      walletQualityLevel: "N/A",
      walletQualitySummary: "Wallet Quality: N/A",
      snapshots: [],
    };
  }

  const trades = parseDexTrades(source.data, targetTokenAddress);
  const tradesByWallet = new Map<string, ParsedDexTrade[]>();

  for (const trade of trades) {
    const walletTrades = tradesByWallet.get(trade.wallet) ?? [];

    walletTrades.push(trade);
    tradesByWallet.set(trade.wallet, walletTrades);
  }

  const mirrorGroups = detectMirrorGroups(trades);
  const snapshots: WalletQualitySnapshot[] = [];
  const behaviorCounts = getZeroWalletBehaviorCounts();

  for (const [wallet, walletTrades] of tradesByWallet.entries()) {
    const buyCount = walletTrades.filter((trade) => trade.side === "buy").length;
    const sellCount = walletTrades.filter((trade) => trade.side === "sell").length;
    const touchedTokenCount = new Set(walletTrades.map((trade) => trade.token)).size;
    const avgTradeSize = averageNumber(walletTrades.map((trade) => trade.amountUsd).filter((value) => value > 0));
    const wsolTradeRatio = walletTrades.length > 0
      ? walletTrades.filter((trade) => trade.isWsol).length / walletTrades.length
      : null;
    const earlyTokenBuys = walletTrades.filter((trade) => trade.side === "buy" && (trade.tokenAgeDays ?? Infinity) <= 1).length;
    const targetBuyCount = walletTrades.filter((trade) => trade.side === "buy" && trade.token === targetTokenAddress).length;
    const targetSellCount = walletTrades.filter((trade) => trade.side === "sell" && trade.token === targetTokenAddress).length;
    const mirrorGroupId = mirrorGroups.get(wallet) ?? null;
    const behaviorType = classifyWalletBehavior({
      buyCount,
      sellCount,
      touchedTokenCount,
      avgTradeSize,
      wsolTradeRatio,
      earlyTokenBuys,
      targetBuyCount,
      targetSellCount,
      isMirror: mirrorGroupId !== null,
      fastFlip: hasFastFlip(walletTrades),
    });

    behaviorCounts[behaviorType] += 1;
    snapshots.push({
      walletAddress: wallet,
      behaviorType,
      buyCount,
      sellCount,
      touchedTokenCount,
      avgTradeSize,
      wsolTradeRatio,
      mirrorGroupId,
    });
  }

  const walletCount = snapshots.length;
  const mirrorLikeCount = behaviorCounts["Mirror-like"];
  const microArbCount = behaviorCounts["Micro-arb"];
  const estimatedIndependentWallets = walletCount > 0
    ? Math.max(1, walletCount - mirrorLikeCount - Math.floor(microArbCount / 2))
    : null;
  const clusterReasons: string[] = [];

  if (mirrorLikeCount >= 3 || (estimatedIndependentWallets !== null && walletCount >= 3 && estimatedIndependentWallets <= Math.ceil(walletCount / 2))) {
    clusterReasons.push("3 wallet以上で同期buyまたはmirror-like行動が確認されています。");
  } else if (mirrorLikeCount >= 2) {
    clusterReasons.push("2 walletが近い時間帯に似たサイズで同一tokenをbuyしています。");
  }

  if (microArbCount >= Math.max(2, Math.ceil(walletCount / 2))) {
    clusterReasons.push("Micro-arb疑いwalletの比率が高く、Smart Money数が水増しされている可能性があります。");
  } else if (microArbCount > 0) {
    clusterReasons.push("Micro-arb疑いwalletが一部含まれます。");
  }

  const clusterRisk: DeepCheckClusterRisk = walletCount === 0
    ? "未検証"
    : mirrorLikeCount >= 3 || microArbCount >= Math.max(3, Math.ceil(walletCount * 0.6))
      ? "High"
      : mirrorLikeCount >= 2 || microArbCount > 0
        ? "Medium"
        : "Low";
  const constructiveCount = behaviorCounts["Fresh Sniper"] + behaviorCounts.Accumulator;
  const walletQualityLevel: WalletQualityLevel = walletCount === 0
    ? "N/A"
    : clusterRisk === "High" || microArbCount > constructiveCount
      ? "Low"
      : clusterRisk === "Medium"
        ? "Medium"
        : "High";
  const summaryLines = [
    `Smart Wallets: ${walletCount}`,
    `推定独立度: ${estimatedIndependentWallets === null ? "N/A" : `${estimatedIndependentWallets}/${walletCount}`}`,
    `Fresh Sniper: ${behaviorCounts["Fresh Sniper"]}`,
    `Accumulator: ${behaviorCounts.Accumulator}`,
    `Fast Flipper: ${behaviorCounts["Fast Flipper"]}`,
    `Micro-arb疑い: ${behaviorCounts["Micro-arb"]}`,
    `Mirror-like: ${behaviorCounts["Mirror-like"]}`,
    `Unknown: ${behaviorCounts.Unknown}`,
  ];

  return {
    walletCount,
    estimatedIndependentWallets,
    behaviorCounts,
    clusterRisk,
    clusterReasons: clusterReasons.length > 0 ? clusterReasons : ["wallet間の行動は比較的ばらけています。"],
    walletQualityLevel,
    walletQualitySummary: summaryLines.join("\n"),
    snapshots,
  };
}

function sourceSucceeded(source: DeepCheckSourceResult): boolean {
  return source.success && source.data !== null && source.data !== undefined;
}

async function runNansenJsonCommand(args: string[]): Promise<unknown> {
  const { stdout } = await execFileAsync("nansen", args, {
    timeout: 45_000,
    maxBuffer: 1024 * 1024 * 4,
  });

  return JSON.parse(stdout);
}

function isMockNansenEnabled(): boolean {
  return process.env.USE_MOCK_NANSEN === "true";
}

function readCreditsRemaining(value: unknown): number | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const toCreditNumber = (input: unknown): number | null => {
    if (typeof input === "number" && Number.isFinite(input)) {
      return input;
    }

    if (typeof input === "string" && input.trim() !== "") {
      const parsed = Number(input);

      return Number.isFinite(parsed) ? parsed : null;
    }

    return null;
  };
  const record = value as Record<string, unknown>;
  const directCredits = toCreditNumber(record.credits_remaining);

  if (directCredits !== null) {
    return directCredits;
  }

  const data = record.data;

  if (!data || typeof data !== "object") {
    return null;
  }

  const dataCredits = toCreditNumber((data as Record<string, unknown>).credits_remaining);

  return dataCredits;
}

async function getNansenCreditsRemaining(): Promise<number | null> {
  if (isMockNansenEnabled()) {
    return null;
  }

  try {
    // nansen account は現在のplanとcredits残量を返す確認用コマンドです。
    const result = await runNansenJsonCommand(["account"]);
    const credits = readCreditsRemaining(result);

    if (credits === null) {
      console.warn("[Nansen Credits] nansen account の credits_remaining を読み取れませんでした。");
    }

    return credits;
  } catch (error) {
    const message = error instanceof Error ? error.message : "不明なエラー";

    console.warn(`[Nansen Credits] nansen account の取得に失敗しました: ${message}`);
    return null;
  }
}

function saveNansenCreditLog<T>(
  commandName: string,
  tracking: Omit<NansenCreditTrackingResult<T>, "result">,
): void {
  insertNansenCreditLog.run(
    randomUUID(),
    commandName,
    tracking.beforeCredits,
    tracking.afterCredits,
    tracking.usedCredits,
    isMockNansenEnabled() ? 1 : 0,
    new Date().toISOString(),
  );
}

function logNansenCreditUsage<T>(
  label: string,
  tracking: Omit<NansenCreditTrackingResult<T>, "result">,
): void {
  if (
    tracking.beforeCredits === null ||
    tracking.afterCredits === null ||
    tracking.usedCredits === null
  ) {
    console.log(`[Nansen Credits] ${label} credits unavailable`);
    return;
  }

  console.log(
    `[Nansen Credits] ${label} before=${tracking.beforeCredits} after=${tracking.afterCredits} used=${tracking.usedCredits}`,
  );
}

async function withNansenCreditTracking<T>(
  label: string,
  fn: () => Promise<T>,
): Promise<NansenCreditTrackingResult<T>> {
  if (isMockNansenEnabled()) {
    const tracking = { beforeCredits: null, afterCredits: null, usedCredits: null };

    try {
      const result = await fn();

      saveNansenCreditLog(label, tracking);
      console.log(`[Nansen Credits] ${label} mock mode`);

      return { result, ...tracking };
    } catch (error) {
      saveNansenCreditLog(label, tracking);
      console.log(`[Nansen Credits] ${label} mock mode`);
      throw error;
    }
  }

  const beforeCredits = await getNansenCreditsRemaining();

  try {
    const result = await fn();
    const afterCredits = await getNansenCreditsRemaining();
    const usedCredits = beforeCredits !== null && afterCredits !== null
      ? beforeCredits - afterCredits
      : null;
    const tracking = { beforeCredits, afterCredits, usedCredits };

    logNansenCreditUsage(label, tracking);
    saveNansenCreditLog(label, tracking);

    return { result, ...tracking };
  } catch (error) {
    const afterCredits = await getNansenCreditsRemaining();
    const usedCredits = beforeCredits !== null && afterCredits !== null
      ? beforeCredits - afterCredits
      : null;
    const tracking = { beforeCredits, afterCredits, usedCredits };

    logNansenCreditUsage(label, tracking);
    saveNansenCreditLog(label, tracking);

    throw error;
  }
}

async function fetchLiveDeepCheckSource(
  source: DeepCheckSourceName,
  tokenAddress: string,
): Promise<DeepCheckSourceResult> {
  const argsBySource: Record<DeepCheckSourceName, string[]> = {
    "flow-intelligence": ["research", "tgm", "flow-intelligence", "--token", tokenAddress, "--chain", "solana", "--output", "json"],
    holders: ["research", "tgm", "holders", "--token", tokenAddress, "--chain", "solana", "--output", "json"],
    "who-bought-sold": ["research", "tgm", "who-bought-sold", "--token", tokenAddress, "--chain", "solana", "--output", "json"],
    "dex-trades": ["research", "smart-money", "dex-trades", "--chain", "solana", "--output", "json"],
  };

  try {
    return {
      source,
      success: true,
      data: await runNansenJsonCommand(argsBySource[source]),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "不明なエラー";

    return { source, success: false, data: null, error: message };
  }
}

async function buildMockDeepCheckSources(tokenAddress: string): Promise<DeepCheckSourceResult[]> {
  const rows = await readMockNetflowRows().catch(() => []);
  const row = rows.find((item) => toDisplayText(item.token_address, "") === tokenAddress) ?? rows[0];
  const marketCap = toFiniteNumber(row?.market_cap_usd) ?? 420_000;
  const flow24h = Math.max(toFiniteNumber(row?.net_flow_24h_usd) ?? 12_500, 0);
  const traderCount = toFiniteNumber(row?.trader_count) ?? 8;

  return [
    {
      source: "flow-intelligence",
      success: true,
      data: {
        smart_money_flow_usd: flow24h * 0.55,
        fresh_wallet_flow_usd: flow24h * 0.35,
        whale_flow_usd: flow24h * 0.1,
        market_cap_usd: marketCap,
      },
    },
    {
      source: "holders",
      success: true,
      data: {
        top_holder_concentration_pct: 18,
        top100_holder_pct: 54,
        unsold_holders: Math.max(5, traderCount),
        unrealized_profit_holders_pct: 42,
      },
    },
    {
      source: "who-bought-sold",
      success: true,
      data: {
        buyer_count: Math.max(4, traderCount),
        seller_count: 2,
        buy_volume_usd: flow24h * 1.2,
        sell_volume_usd: flow24h * 0.35,
        smart_money_buy_usd: flow24h * 0.6,
        smart_money_sell_usd: flow24h * 0.15,
      },
    },
    {
      source: "dex-trades",
      success: true,
      data: [
        { wallet_address: "mock-wallet-1", token_address: tokenAddress, side: "buy", amount_usd: 1_200, timestamp: "2026-01-01T00:00:01Z", token_age_days: 1 },
        { wallet_address: "mock-wallet-2", token_address: tokenAddress, side: "buy", amount_usd: 1_150, timestamp: "2026-01-01T00:00:02Z", token_age_days: 1 },
        { wallet_address: "mock-wallet-3", token_address: tokenAddress, side: "buy", amount_usd: 2_400, timestamp: "2026-01-01T00:02:00Z", token_age_days: 1 },
        { wallet_address: "mock-wallet-3", token_address: tokenAddress, side: "sell", amount_usd: 900, timestamp: "2026-01-01T00:20:00Z", token_age_days: 1 },
      ],
    },
  ];
}

async function fetchDeepCheckSources(tokenAddress: string): Promise<DeepCheckSourceResult[]> {
  if (process.env.USE_MOCK_NANSEN === "true") {
    return buildMockDeepCheckSources(tokenAddress);
  }

  const sources: DeepCheckSourceName[] = [
    "flow-intelligence",
    "holders",
    "who-bought-sold",
    "dex-trades",
  ];
  const results: DeepCheckSourceResult[] = [];

  // Deep Checkは失敗しても全体を止めず、取れたデータだけで判定します。
  for (const source of sources) {
    results.push(await fetchLiveDeepCheckSource(source, tokenAddress));
  }

  return results;
}

function getSourceResult(sources: DeepCheckSourceResult[], source: DeepCheckSourceName): DeepCheckSourceResult {
  return sources.find((item) => item.source === source) ?? { source, success: false, data: null };
}

function judgeFlowQuality(source: DeepCheckSourceResult): DeepCheckTextResult<DeepCheckGrade> {
  if (!sourceSucceeded(source)) {
    return {
      label: "N/A",
      text: "Nansen flow-intelligenceの取得に失敗しました。",
    };
  }

  const data = source.data;
  const smartMoneyFlow = sumNumbersByPath(data, [/smart.*flow|smart.*net|smart.*buy/]);
  const freshWalletFlow = sumNumbersByPath(data, [/fresh.*flow|fresh.*net|fresh.*buy/]);
  const whaleFlow = sumNumbersByPath(data, [/whale.*flow|whale.*net|whale.*buy/]);
  const positiveTypes = [smartMoneyFlow, freshWalletFlow, whaleFlow].filter((value) => value > 0).length;
  const negativeFlow = Math.abs(sumNumbersByPath(data, [/outflow|sell|sold/]));

  if (smartMoneyFlow > 0 && freshWalletFlow > 0 && positiveTypes >= 2 && smartMoneyFlow + freshWalletFlow > negativeFlow) {
    return {
      label: "Strong",
      text: "Smart MoneyとFresh Walletの両方から流入が確認されています。",
    };
  }

  if (smartMoneyFlow > 0 || whaleFlow > 0 || positiveTypes >= 1) {
    return {
      label: "Medium",
      text: "Smart MoneyまたはWhale系の流入はありますが、流入元はやや偏っています。",
    };
  }

  return {
    label: "Weak",
    text: "Smart Money flowは弱く、流入の質はまだ強くありません。",
  };
}

function judgeHolderQuality(source: DeepCheckSourceResult): DeepCheckTextResult<DeepCheckRisk> {
  if (!sourceSucceeded(source)) {
    return {
      label: "N/A",
      text: "Nansen holdersの取得に失敗しました。",
    };
  }

  const data = source.data;
  const topConcentration = maxNumberByPath(data, [/top.*holder.*pct|top.*holder.*percent|concentration|top100/]);
  const unsoldHolders = sumNumbersByPath(data, [/unsold|not.*sold|diamond/]);
  const profitHolders = maxNumberByPath(data, [/unrealized.*profit|pnl|profit.*holder/]);
  const sellingWhales = sumNumbersByPath(data, [/whale.*sell|top.*sell|sold.*holder/]);

  if ((topConcentration ?? 0) >= 70 || sellingWhales > 0) {
    return {
      label: "High",
      text: "Top holder集中または大口売りが強く、Holder Riskは高めです。",
    };
  }

  if ((topConcentration ?? 0) >= 35 || (profitHolders ?? 0) >= 60) {
    return {
      label: "Medium",
      text: "Top holder集中がやや高く、短期の売り圧力には注意が必要です。",
    };
  }

  if (unsoldHolders > 0 || topConcentration !== null) {
    return {
      label: "Low",
      text: "Top holder集中は低〜中程度で、大口の未売却も一部確認できます。",
    };
  }

  return {
    label: "Medium",
    text: "Holder構造は一部確認できますが、偏りには注意が必要です。",
  };
}

function judgeBuyerSellerBalance(source: DeepCheckSourceResult): DeepCheckTextResult<DeepCheckBalance> {
  if (!sourceSucceeded(source)) {
    return {
      label: "N/A",
      text: "Nansen who-bought-soldの取得に失敗しました。",
    };
  }

  const data = source.data;
  const buyers = sumNumbersByPath(data, [/buyer.*count|buyers$/]);
  const sellers = sumNumbersByPath(data, [/seller.*count|sellers$/]);
  const buyVolume = sumNumbersByPath(data, [/buy.*volume|buy.*usd|bought.*usd/]);
  const sellVolume = sumNumbersByPath(data, [/sell.*volume|sell.*usd|sold.*usd/]);
  const smartBuy = sumNumbersByPath(data, [/smart.*buy|smart.*bought/]);
  const smartSell = sumNumbersByPath(data, [/smart.*sell|smart.*sold/]);

  if ((buyers > sellers && buyVolume >= sellVolume) || smartBuy > smartSell * 1.2) {
    return {
      label: "Bullish",
      text: "買い手優勢で、Smart Moneyの売り抜けは目立ちません。",
    };
  }

  if ((sellers > buyers && sellVolume > buyVolume) || smartSell > smartBuy * 1.2) {
    return {
      label: "Bearish",
      text: "売り手が優勢で、Smart Moneyの売り越しに注意が必要です。",
    };
  }

  return {
    label: "Neutral",
    text: "買いと売りは拮抗しており、強い方向感はまだ限定的です。",
  };
}

function judgeSellPressure(
  holders: DeepCheckSourceResult,
  buyerSeller: DeepCheckSourceResult,
): DeepCheckTextResult<DeepCheckRisk> {
  if (!sourceSucceeded(holders) && !sourceSucceeded(buyerSeller)) {
    return {
      label: "N/A",
      text: "Sell Pressure判定に必要なholders / who-bought-soldを取得できませんでした。",
    };
  }

  const holderData = holders.data;
  const buyerSellerData = buyerSeller.data;
  const unsoldHolders = sumNumbersByPath(holderData, [/unsold|not.*sold|diamond/]);
  const profitHolders = maxNumberByPath(holderData, [/unrealized.*profit|pnl|profit.*holder/]);
  const sellVolume = sumNumbersByPath(buyerSellerData, [/sell.*volume|sell.*usd|sold.*usd/]);
  const buyVolume = sumNumbersByPath(buyerSellerData, [/buy.*volume|buy.*usd|bought.*usd/]);
  const smartBuy = sumNumbersByPath(buyerSellerData, [/smart.*buy|smart.*bought/]);
  const smartSell = sumNumbersByPath(buyerSellerData, [/smart.*sell|smart.*sold/]);

  if (smartSell > smartBuy || (sellVolume > 0 && sellVolume > buyVolume * 1.2)) {
    return {
      label: "High",
      text: "大口またはSmart Moneyの売りが目立ち、売り圧力は高めです。",
    };
  }

  if ((profitHolders ?? 0) >= 60 || (sellVolume > 0 && sellVolume >= buyVolume * 0.5)) {
    return {
      label: "Medium",
      text: "含み益ホルダーや一部売りがあり、上昇時の売り圧力に注意が必要です。",
    };
  }

  if (unsoldHolders > 0 || sellVolume <= buyVolume * 0.5) {
    return {
      label: "Low",
      text: "未売却holderが比較的多く、直近の売りは限定的です。",
    };
  }

  return {
    label: "Medium",
    text: "明確な売り抜けは限定的ですが、データはまだ十分ではありません。",
  };
}

function judgeClusterRisk(source: DeepCheckSourceResult): DeepCheckTextResult<DeepCheckClusterRisk> {
  if (!sourceSucceeded(source)) {
    return {
      label: "未検証",
      text: "smart-money/dex-tradesを取得できないため、Cluster Risk Liteは未検証です。",
    };
  }

  const data = source.data;
  const syncedBuys = sumNumbersByPath(data, [/sync.*buy|same.*time|near.*buy/]);
  const similarSizeBuys = sumNumbersByPath(data, [/similar.*size|same.*amount|amount.*band/]);
  const objectCount = countObjects(data);

  if (syncedBuys >= 3 || (similarSizeBuys >= 3 && objectCount >= 10)) {
    return {
      label: "High",
      text: "3wallet以上の同期buyまたは似たサイズのbuyが目立ち、bot cluster疑いが強めです。",
    };
  }

  if (syncedBuys >= 2 || similarSizeBuys >= 2 || objectCount >= 20) {
    return {
      label: "Medium",
      text: "複数walletが近い時間帯に似たサイズで買っており、同一clusterの可能性があります。",
    };
  }

  return {
    label: "Low",
    text: "同期buyは目立たず、wallet行動の偏りは限定的です。",
  };
}

function buildDeepCheckFinalNote(
  flowQuality: DeepCheckTextResult<DeepCheckGrade>,
  holderQuality: DeepCheckTextResult<DeepCheckRisk>,
  buyerSellerBalance: DeepCheckTextResult<DeepCheckBalance>,
  sellPressure: DeepCheckTextResult<DeepCheckRisk>,
  clusterRisk: DeepCheckTextResult<DeepCheckClusterRisk>,
  confidence: DeepCheckConfidence,
): string {
  if (confidence === "Low") {
    return "Fresh ScanやAlertの補助情報として、Flow Quality、Holder Risk、Buyer/Seller Balanceの取れた項目を中心に見ます。追加データが入ればAlert判定を更新します。";
  }

  if (clusterRisk.label === "High") {
    return "Flowは検出されていますが、Cluster Riskが高く、質の低いflowである可能性があります。Alert対象としては慎重に扱うべきです。";
  }

  if (holderQuality.label === "High" || sellPressure.label === "High") {
    return "Smart Money flowは確認できますが、Holder RiskまたはSell Pressureが高く、短期の売り抜けには注意が必要です。";
  }

  if (
    flowQuality.label === "Strong" &&
    buyerSellerBalance.label === "Bullish" &&
    (holderQuality.label === "Low" || holderQuality.label === "Medium")
  ) {
    return "Flow Watchとして見る価値はあります。Smart MoneyとFresh Walletの流入が確認されており、買い手優勢です。ただし、Holder Riskには注意してください。";
  }

  return "一部のflowは確認できますが、方向感はまだ限定的です。Flow Quality、Holder Risk、Buyer/Seller Balanceを合わせて継続確認してください。";
}

function getDeepCheckConfidence(
  sources: DeepCheckSourceResult[],
  walletQuality: WalletQualityAnalysis,
): DeepCheckConfidence {
  if (process.env.USE_MOCK_NANSEN === "true") {
    return "Low";
  }

  const coreSuccessCount = sources
    .filter((source) => source.source !== "dex-trades")
    .filter(sourceSucceeded).length;

  const hasWalletQuality = walletQuality.walletCount > 0;

  if (coreSuccessCount >= 2 && hasWalletQuality) {
    return "High";
  }

  if (coreSuccessCount >= 1) {
    return "Medium";
  }

  return "Low";
}

function buildDeepCheckRawSummary(sources: DeepCheckSourceResult[]): string {
  return sources
    .map((source) => `${source.source}: ${source.success ? "ok" : `failed${source.error ? ` (${source.error.slice(0, 120)})` : ""}`}`)
    .join(" / ");
}

async function buildDeepCheckReply(tokenAddress: string): Promise<DeepCheckReply> {
  const signal = getLatestSignalByToken.get(tokenAddress) as SignalRecord | undefined;
  const [profile, sources] = await Promise.all([
    fetchDexScreenerTokenProfile(tokenAddress),
    fetchDeepCheckSources(tokenAddress),
  ]);
  const flowSource = getSourceResult(sources, "flow-intelligence");
  const holderSource = getSourceResult(sources, "holders");
  const buyerSellerSource = getSourceResult(sources, "who-bought-sold");
  const dexTradesSource = getSourceResult(sources, "dex-trades");
  const walletQuality = analyzeWalletQualityFromDexTrades(dexTradesSource, tokenAddress);
  const flowQuality = judgeFlowQuality(flowSource);
  const holderQuality = judgeHolderQuality(holderSource);
  const buyerSellerBalance = judgeBuyerSellerBalance(buyerSellerSource);
  const sellPressure = judgeSellPressure(holderSource, buyerSellerSource);
  const clusterRisk: DeepCheckTextResult<DeepCheckClusterRisk> = {
    label: walletQuality.clusterRisk,
    text: walletQuality.clusterReasons.join(" "),
  };
  const confidence = getDeepCheckConfidence(sources, walletQuality);
  const ageDays = parseTokenAgeDays(signal?.token_age ?? null);
  const marketCap = profile.marketCap ?? signal?.scan_mcap ?? null;
  const flow24h = signal?.flow_24h ?? null;
  const flow7d = signal?.flow_7d ?? null;
  const flowMcapRatio = signal?.flow_mcap_ratio ?? (marketCap && flow24h !== null ? flow24h / marketCap : null);
  const finalNote = buildDeepCheckFinalNote(
    flowQuality,
    holderQuality,
    buyerSellerBalance,
    sellPressure,
    clusterRisk,
    confidence,
  );

  return {
    tokenAddress,
    symbol: signal?.symbol ?? profile.symbol,
    name: signal?.name ?? profile.name,
    marketCap,
    signalId: signal?.signal_id ?? null,
    flowQuality,
    holderQuality,
    buyerSellerBalance,
    sellPressure,
    clusterRisk,
    walletQuality,
    narrative: createHiddenTokenNarrative(),
    finalNote,
    confidence,
    rawSummary: buildDeepCheckRawSummary(sources),
    rawSources: Object.fromEntries(sources.map((source) => [source.source, source.data])),
  };
}

function saveDeepCheckResult(
  result: DeepCheckReply,
  signalIdOverride?: string | null,
  context: {
    sourceType?: "alert" | "fresh_scan" | "deep_check";
    alertRunId?: string | null;
    alertCandidateId?: string | null;
    scanId?: string | null;
    scanCandidateId?: string | null;
  } = {},
): string {
  const deepCheckId = randomUUID();
  const signalId = signalIdOverride ?? result.signalId;

  insertDeepCheck.run(
    deepCheckId,
    result.tokenAddress,
    signalId,
    result.flowQuality.label,
    result.holderQuality.label,
    result.buyerSellerBalance.label,
    result.sellPressure.label,
    result.clusterRisk.label,
    result.finalNote,
    result.rawSummary,
    result.narrative.narrativeSummary,
    result.narrative.narrativeType,
    JSON.stringify(result.narrative.narrativeSources),
    JSON.stringify(result.narrative.narrativeEvidence),
    JSON.stringify(result.narrative.narrativeTags),
    result.narrative.internalConfidence,
    result.walletQuality.walletQualitySummary,
    JSON.stringify(result.walletQuality.behaviorCounts),
    result.walletQuality.estimatedIndependentWallets,
    new Date().toISOString(),
  );

  for (const snapshot of result.walletQuality.snapshots) {
    insertWalletQualitySnapshot.run(
      randomUUID(),
      result.tokenAddress,
      signalId,
      snapshot.walletAddress,
      snapshot.behaviorType,
      snapshot.buyCount,
      snapshot.sellCount,
      snapshot.touchedTokenCount,
      snapshot.avgTradeSize,
      snapshot.wsolTradeRatio,
      snapshot.mirrorGroupId,
      result.walletQuality.clusterRisk,
      new Date().toISOString(),
    );
  }

  const observations = buildSmartWalletObservations({
    result,
    sourceType: context.sourceType ?? "deep_check",
    alertRunId: context.alertRunId,
    alertCandidateId: context.alertCandidateId,
    scanId: context.scanId,
    scanCandidateId: context.scanCandidateId,
  });

  if (observations.length > 0) {
    void alertStore.saveSmartWalletObservations(observations).catch((error) => {
      const message = error instanceof Error ? error.message : "不明なエラー";

      console.warn(`Smart Wallet observations保存に失敗しました: ${message}`);
    });
  }

  return deepCheckId;
}

function buildDeepCheckEmbed(result: DeepCheckReply): InstanceType<typeof EmbedBuilder> {
  const relatedLinks = [
    `[DexScreener](https://dexscreener.com/solana/${result.tokenAddress})`,
    `[GMGN](https://gmgn.ai/sol/token/${result.tokenAddress})`,
    `[UniversalX](https://universalx.app/trade?assetId=101_${result.tokenAddress})`,
  ].join("｜");
  const displayName = [
    result.symbol ? formatDisplaySymbol(result.symbol) : "$UNKNOWN",
    result.name,
  ].filter(Boolean).join("｜");

  return new EmbedBuilder()
    .setTitle("🔎 Meme Deep Check")
    .setColor(0x3498db)
    .setDescription([
      `**${displayName}**`,
      `**MCap:** ${formatCompactUsd(result.marketCap)}`,
      `**CA:** \`${result.tokenAddress}\``,
      `**関連リンク:**\n${relatedLinks}`,
      "",
      `**Flow Quality:**\n${result.flowQuality.text}\nFlow Quality: ${result.flowQuality.label}`,
      "",
      `**Holder Quality:**\n${result.holderQuality.text}\nHolder Risk: ${result.holderQuality.label}`,
      "",
      `**Buyer/Seller Balance:**\n${result.buyerSellerBalance.text}\nBalance: ${result.buyerSellerBalance.label}`,
      "",
      `**Sell Pressure:**\n${result.sellPressure.text}\nSell Pressure: ${result.sellPressure.label}`,
      "",
      `**Wallet Quality:**\n${result.walletQuality.walletQualitySummary}`,
      "",
      `**Cluster Risk Lite:**\n${result.clusterRisk.label}。${result.clusterRisk.text}`,
      "",
      `**Final Note:**\n${result.finalNote}`,
      "",
      `**Confidence:** ${result.confidence}`,
    ].join("\n"))
    .setTimestamp(new Date());
}

function evaluateAlertQualityGate(
  deepCheck: DeepCheckReply,
  candidate: MemeResearchCard,
  options: Pick<AlertCheckOptions, "allowMockFallback">,
): AlertQualityGateResult {
  const reasons: string[] = [];
  const warnings: string[] = [];
  const gateConfig = scoringConfig.qualityGate;

  const candidateLiquidity = candidate.liquidity;
  if (candidateLiquidity !== null && candidateLiquidity < scoringConfig.alertRules.minLiquidityUsd) {
    reasons.push("Liquidity不足");
  }
  if ((candidate.traderCount ?? 0) < scoringConfig.alertRules.minTraders) {
    reasons.push("Traders不足");
  }

  if (gateConfig.rejectHolderRisk.includes(deepCheck.holderQuality.label)) {
    reasons.push("Holder Risk High");
  }

  if (gateConfig.rejectSellPressure.includes(deepCheck.sellPressure.label)) {
    reasons.push("Sell Pressure High");
  }

  if (gateConfig.rejectBuyerSellerBalance.includes(deepCheck.buyerSellerBalance.label)) {
    reasons.push("Buyer/Seller Bearish");
  }

  if (gateConfig.rejectClusterRisk.includes(deepCheck.clusterRisk.label)) {
    reasons.push("Cluster Risk High");
  }

  const walletQuality = deepCheck.walletQuality;
  const behaviorCounts = walletQuality.behaviorCounts;
  const microArbCount = behaviorCounts["Micro-arb"];
  const mirrorLikeCount = behaviorCounts["Mirror-like"];
  const constructiveCount = behaviorCounts["Fresh Sniper"] + behaviorCounts.Accumulator;

  if (
    scoringConfig.alertRules.requireDexTradesCheck &&
    !options.allowMockFallback &&
    (walletQuality.walletCount === 0 || deepCheck.clusterRisk.label === "未検証")
  ) {
    reasons.push("dex-trades未検証");
  }

  if (walletQuality.walletCount > 0 && constructiveCount <= 1 && (candidate.traderCount ?? 0) <= 3) {
    reasons.push("Whale 1人だけの小型買い");
  }

  if (walletQuality.walletCount > 0 && microArbCount > constructiveCount && microArbCount >= 2) {
    reasons.push("Micro-arb wallet偏重");
  }

  if (
    walletQuality.estimatedIndependentWallets !== null &&
    walletQuality.walletCount >= 3 &&
    walletQuality.estimatedIndependentWallets <= Math.ceil(walletQuality.walletCount / 2) &&
    mirrorLikeCount >= 2
  ) {
    reasons.push("Mirror-like walletが多く独立性が低い");
  }

  const flowOk = gateConfig.allowFlowQuality.includes(deepCheck.flowQuality.label);
  const dataTooThin =
    deepCheck.confidence === "Low" &&
    (deepCheck.flowQuality.label === "N/A" || deepCheck.flowQuality.label === "Weak");

  if (!flowOk && !options.allowMockFallback) {
    reasons.push(`Flow Quality ${deepCheck.flowQuality.label}`);
  }

  if (dataTooThin && gateConfig.rejectIfConfidenceLowAndFlowWeak && !options.allowMockFallback) {
    reasons.push("Deep Checkのデータ不足");
  }

  if (reasons.length > 0) {
    return {
      passed: false,
      grade: "Rejected",
      reasons,
      warnings,
    };
  }

  if (deepCheck.confidence === "Low" && options.allowMockFallback) {
    warnings.push("mock/fallback環境のためModerate扱い");
  }

  if (deepCheck.clusterRisk.label === "Medium") {
    warnings.push("Cluster Risk Medium");
  }

  if (microArbCount > 0) {
    warnings.push("Micro-arb疑いwalletを含みます");
  }

  if (
    walletQuality.estimatedIndependentWallets !== null &&
    walletQuality.estimatedIndependentWallets < walletQuality.walletCount
  ) {
    warnings.push(`推定独立wallet ${walletQuality.estimatedIndependentWallets}/${walletQuality.walletCount}`);
  }

  if (
    deepCheck.flowQuality.label === "Strong" &&
    deepCheck.buyerSellerBalance.label === "Bullish" &&
    (deepCheck.holderQuality.label === "Low" || deepCheck.holderQuality.label === "Medium") &&
    (deepCheck.sellPressure.label === "Low" || deepCheck.sellPressure.label === "Medium") &&
    (deepCheck.clusterRisk.label === "Low" || deepCheck.clusterRisk.label === "Medium") &&
    walletQuality.walletQualityLevel !== "Low" &&
    candidate.edgeScore >= 75
  ) {
    return {
      passed: true,
      grade: "Strong",
      reasons: ["Smart Money/Fresh Wallet flowが確認され、売り圧力は過度ではありません。"],
      warnings,
    };
  }

  return {
    passed: true,
      grade: gateConfig.mockFallbackGrade,
    reasons: ["Alert条件とDeep Checkの基本Quality Gateを通過しました。"],
    warnings,
  };
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
      .setCustomId(`meme_pick:conviction:${signalId}`)
      .setLabel(`Conviction (${counts.conviction})`)
      .setEmoji("🔥")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`meme_pick:paper_in:${signalId}`)
      .setLabel(`エアIN (${counts.paper_in})`)
      .setEmoji("🧪")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`meme_pick:watch:${signalId}`)
      .setLabel(`Watch (${counts.watch})`)
      .setEmoji("👀")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`meme_ca:${signalId}`)
      .setLabel("CA")
      .setEmoji("📋")
      .setStyle(ButtonStyle.Secondary),
  );
}

function buildMemeScanReplies(
  cards: MemeResearchCard[],
  label: MemeScanLabel,
): MemeScanReply[] {
  if (cards.length === 0) {
    return [{
      content: [
        `**🔥 bb Meme Edge Fresh Scan - ${label}**`,
        "",
        "今回のFresh Scanでは、新規条件を満たす強い候補はありませんでした。",
        "次回スキャンまたはAlertで検出します。",
      ].join("\n"),
    }];
  }

  const replies = cards.map((card, index): MemeScanReply => {
    const reply: MemeScanReply = {
      embeds: [buildResearchCardEmbed(card, index)],
      components: [buildPaperPickButtons(card.signalId)],
    };

    if (index === 0) {
      reply.content = `**🔥 bb Meme Edge Fresh Scan - ${label}**\nSolana Smart Money Netflow Fresh Scan 最大5件`;
    }

    return reply;
  });

  return replies;
}

function buildFreshScanDataCollectionReply(result: {
  candidateCount: number;
  gate0PassCount: number;
  momentumGatePassCount: number;
  preFilterPassCount: number;
}): MemeScanReply {
  return {
    content: [
      "Fresh Scan完了。",
      `候補${result.candidateCount}件を保存しました。`,
      `Gate 0通過: ${result.gate0PassCount}件`,
      `Momentum Gate通過: ${result.momentumGatePassCount}件`,
      `Pre-filter通過: ${result.preFilterPassCount}件`,
      "投稿: OFF",
      "通知はAlertで行います。",
    ].join("\n"),
  };
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

async function readLiveNetflowRows(requestedCandidatePoolSize: number): Promise<{ rows: NetflowRow[]; metadata: NansenFetchMetadata }> {
  const limit = Math.min(requestedCandidatePoolSize, NANSEN_NETFLOW_PAGE_LIMIT);
  const warning = requestedCandidatePoolSize > NANSEN_NETFLOW_PAGE_LIMIT
    ? `Nansenの1回取得上限${NANSEN_NETFLOW_PAGE_LIMIT}を超えたため、limitを${NANSEN_NETFLOW_PAGE_LIMIT}にclampして取得しました。CLIでpagination指定を確認できないため、取得できた件数でFresh Scanを続行します。`
    : null;

  // shellを使わず引数を配列で渡すと、コマンドの実行内容が分かりやすく安全です。
  const { stdout } = await execFileAsync(
    "nansen",
    ["research", "smart-money", "netflow", "--chain", "solana", "--limit", String(limit)],
    { timeout: 30_000, maxBuffer: 1024 * 1024 },
  );

  const json = JSON.parse(stdout);
  const rows = dedupeNetflowRowsByTokenAddress(findNetflowRows(json)).slice(0, requestedCandidatePoolSize);

  return {
    rows,
    metadata: {
      requestedCandidatePoolSize,
      actualCandidatePoolSize: rows.length,
      nansenPageLimit: limit,
      nansenPaginationUsed: false,
      nansenFetchWarning: warning ?? (rows.length < requestedCandidatePoolSize
        ? `requested_candidate_pool_size=${requestedCandidatePoolSize}に対してactual_candidate_pool_size=${rows.length}件でFresh Scanを続行しました。`
        : null),
    },
  };
}

async function fetchNansenNetflowRows(): Promise<{ rows: NetflowRow[]; source: NansenDataSource; metadata: NansenFetchMetadata }> {
  const now = Date.now();
  const mode: NansenFetchMode = process.env.USE_MOCK_NANSEN === "true" ? "mock" : "live";
  const requestedCandidatePoolSize = scoringConfig.freshScanRules.candidatePoolSize;

  // 5分以内ならmock/liveそれぞれの前回結果を使います。
  if (
    cachedNansenResult &&
    cachedNansenResult.mode === mode &&
    cachedNansenResult.expiresAt > now
  ) {
    return { rows: cachedNansenResult.rows, source: "cache", metadata: cachedNansenResult.metadata };
  }

  const rowsWithMetadata = mode === "mock"
    ? await (async (): Promise<{ rows: NetflowRow[]; metadata: NansenFetchMetadata }> => {
        const rows = dedupeNetflowRowsByTokenAddress(await readMockNetflowRows()).slice(0, requestedCandidatePoolSize);

        return {
          rows,
          metadata: {
            requestedCandidatePoolSize,
            actualCandidatePoolSize: rows.length,
            nansenPageLimit: Math.min(requestedCandidatePoolSize, NANSEN_NETFLOW_PAGE_LIMIT),
            nansenPaginationUsed: false,
            nansenFetchWarning: rows.length < requestedCandidatePoolSize
              ? `mockデータがrequested_candidate_pool_size=${requestedCandidatePoolSize}未満の${rows.length}件だったため、取得できた件数でFresh Scanを続行しました。`
              : null,
          },
        };
      })()
    : await readLiveNetflowRows(requestedCandidatePoolSize);

  cachedNansenResult = {
    rows: rowsWithMetadata.rows,
    metadata: rowsWithMetadata.metadata,
    mode,
    expiresAt: now + NANSEN_CACHE_TTL_MS,
  };

  return { rows: rowsWithMetadata.rows, source: mode, metadata: rowsWithMetadata.metadata };
}

async function fetchNansenAlertLightRows(): Promise<{ rows: NetflowRow[]; source: NansenDataSource }> {
  const mode: NansenFetchMode = process.env.USE_MOCK_NANSEN === "true" ? "mock" : "live";

  if (mode === "mock") {
    const rows = await readMockNetflowRows();

    return { rows: rows.slice(0, scoringConfig.alertRules.nansenCandidateSize), source: "mock" };
  }

  try {
    const { stdout } = await execFileAsync(
      "nansen",
      ["research", "smart-money", "netflow", "--chain", "solana", "--limit", String(scoringConfig.alertRules.nansenCandidateSize)],
      { timeout: 30_000, maxBuffer: 1024 * 1024 },
    );
    const json = JSON.parse(stdout);

    return { rows: findNetflowRows(json), source: "live" };
  } catch (error) {
    const message = error instanceof Error ? error.message : "不明なエラー";

    console.warn(`[Alert v2] Nansen light scanに失敗したため通常cacheへfallbackします: ${message}`);
    const fallback = await fetchNansenNetflowRows();

    return { rows: fallback.rows.slice(0, scoringConfig.alertRules.nansenCandidateSize), source: fallback.source };
  }
}

async function getDeskTestMessage(): Promise<string> {
  const { rows } = await fetchNansenNetflowRows();

  return formatDeskTestMessage(rows);
}

async function getMemeScanResult(label: MemeScanLabel, options: { postTopSignals?: boolean } = {}): Promise<MemeScanResult> {
  const { rows, source, metadata } = await fetchNansenNetflowRows();
  const freshScan = await buildFreshScanV2(rows, source, label, metadata);
  scheduleFreshCandidateTracking(freshScan.candidates);
  const summary = {
    candidateCount: freshScan.candidates.length,
    gate0PassCount: freshScan.candidates.filter((candidate) => candidate.gate0Status === "pass").length,
    momentumGatePassCount: freshScan.candidates.filter((candidate) => candidate.momentumGateStatus === "pass").length,
    preFilterPassCount: freshScan.candidates.filter((candidate) => candidate.preFilterStatus === "pass").length,
  };
  const postTopSignals = options.postTopSignals ?? scoringConfig.freshScanRules.postTopSignals;

  if (!postTopSignals) {
    return {
      replies: [buildFreshScanDataCollectionReply(summary)],
      scanId: freshScan.scanId,
      scanTime: freshScan.scanTime,
      source,
      signalIds: [],
      postTopSignals,
      ...summary,
    };
  }

  const cards = await buildMemeResearchCards(freshScan.selectedRows);

  for (const card of cards) {
    const candidate = freshScan.candidates.find((item) => item.tokenAddress === card.tokenAddress);

    if (!candidate) continue;

    card.scanId = freshScan.scanId;
    card.scanTime = freshScan.scanTime;
    card.edgeScore = candidate.score;
    card.status = getStatus(candidate.score);
    card.signalType = candidate.signalType;
    card.cliGrade = candidate.cliGrade;
    card.whyFlagged = buildDetectionReasons({
      marketCap: card.marketCap,
      flow24h: card.flow24h,
      flowMcapRatio: card.flowMcapRatio,
      traderCount: card.traderCount,
      ageDays: card.ageDays,
      cliGrade: candidate.cliGrade,
    });
  }

  saveMemeSignals(cards);

  const firstCard = cards[0];

  return {
    replies: buildMemeScanReplies(cards, label),
    scanId: firstCard?.scanId ?? freshScan.scanId,
    scanTime: firstCard?.scanTime ?? freshScan.scanTime,
    source,
    signalIds: cards.map((card) => card.signalId),
    postTopSignals,
    ...summary,
  };
}

async function getMemeAlertCards(): Promise<{ cards: MemeResearchCard[]; source: NansenDataSource }> {
  const { rows, source } = await fetchNansenNetflowRows();
  const cards = await buildMemeResearchCards(rows);
  const cutoffIso = getRecentCutoffIso(scoringConfig.alertRules.dedupeHours);
  const candidates = cards
    .filter((card) => isAlertCandidate(card))
    .filter((card) => !hasRecentAlert(card.tokenAddress, cutoffIso))
    .map((card) => ({
      ...card,
      signalType: "alert_edge" as SignalType,
    }))
    .sort((a, b) => {
      const alertTypeDiff = Number(a.isReFlow) - Number(b.isReFlow);

      if (alertTypeDiff !== 0) {
        return alertTypeDiff;
      }

      const ageDiff = (a.ageDays ?? Number.MAX_SAFE_INTEGER) - (b.ageDays ?? Number.MAX_SAFE_INTEGER);

      if (ageDiff !== 0) {
        return ageDiff;
      }

      return b.edgeScore - a.edgeScore;
    })
    .slice(0, scoringConfig.alertRules.maxAlertsPerRun);

  return { cards: candidates, source };
}

function serializeAlertCandidate(candidate: AlertV2Candidate): Parameters<typeof sqliteAlertStore.saveRun>[1][number] {
  const rawSources = candidate.deepCheck?.rawSources ?? {};

  return {
    alert_run_id: candidate.alertRunId,
    token_address: candidate.tokenAddress,
    symbol: candidate.symbol,
    name: candidate.name,
    candidate_rank: candidate.candidateRank,
    candidate_source_type: candidate.candidateSourceType,
    candidate_sources: JSON.stringify(candidate.candidateSources),
    source_quota_bucket: candidate.sourceQuotaBucket,
    source_priority: candidate.sourcePriority,
    source_detected_at: candidate.sourceDetectedAt,
    candidate_freshness_minutes: candidate.candidateFreshnessMinutes,
    market_data_refreshed_at: candidate.marketDataRefreshedAt,
    market_data_age_minutes: candidate.marketDataAgeMinutes,
    market_data_source: candidate.marketDataSource,
    market_data_warning: candidate.marketDataWarning,
    from_fresh_scan_id: candidate.fromFreshScanId,
    from_scan_candidate_id: candidate.fromScanCandidateId,
    from_previous_alert_run_id: candidate.fromPreviousAlertRunId,
    from_watch_pick_id: candidate.fromWatchPickId,
    is_reaccelerated: candidate.isReaccelerated ? 1 : 0,
    reacceleration_reason: candidate.reaccelerationReason,
    mcap: candidate.marketCap,
    price: candidate.price,
    age_days: candidate.ageDays,
    liquidity: candidate.liquidity,
    volume_24h: candidate.volume24h,
    flow_1h: candidate.flow1h,
    flow_4h: candidate.flow4h,
    flow_24h: candidate.flow24h,
    flow_7d: candidate.flow7d,
    flow_mcap: candidate.flowMcapRatio,
    traders: candidate.traderCount,
    gate_0_status: candidate.gate0Status,
    gate_0_reason: candidate.gate0Reason,
    alert_momentum_score: candidate.alertMomentumScore,
    alert_momentum_components: JSON.stringify(candidate.alertMomentumComponents),
    pre_filter_status: candidate.preFilterStatus,
    pre_filter_rank: candidate.preFilterRank,
    pre_filter_reason: candidate.preFilterReason,
    cli_checked: candidate.cliChecked ? 1 : 0,
    cli_grade: candidate.cliGrade,
    cli_oracle_status: candidate.cliOracleStatus,
    raw_cli_summary: candidate.rawCliSummary,
    raw_nansen_flow_intelligence: JSON.stringify(rawSources["flow-intelligence"] ?? null),
    raw_nansen_who_bought_sold: JSON.stringify(rawSources["who-bought-sold"] ?? null),
    raw_nansen_holders: JSON.stringify(rawSources.holders ?? null),
    raw_nansen_dex_trades: JSON.stringify(rawSources["dex-trades"] ?? null),
    flow_quality: candidate.flowQuality,
    holder_risk: candidate.holderRisk,
    buyer_seller_balance: candidate.buyerSellerBalance,
    sell_pressure: candidate.sellPressure,
    wallet_quality: candidate.walletQuality,
    cluster_risk: candidate.clusterRisk,
    smart_wallet_quality_score: candidate.smartWalletQualityScore,
    smart_wallet_quality_label: candidate.smartWalletQualityLabel,
    strong_wallet_count: candidate.strongWalletCount,
    medium_wallet_count: candidate.mediumWalletCount,
    weak_wallet_count: candidate.weakWalletCount,
    known_wallet_count: candidate.knownWalletCount,
    wallet_pdca_summary: JSON.stringify(candidate.walletPdcaSummary ?? null),
    auto_tuning_adjustment: candidate.autoTuningAdjustment,
    auto_tuning_reasons: JSON.stringify(candidate.autoTuningReasons),
    auto_tuning_version: candidate.autoTuningVersion,
    quality_gate_grade: candidate.qualityGateGrade,
    quality_gate_reasons: JSON.stringify(candidate.qualityGateReasons),
    quality_gate_warnings: JSON.stringify(candidate.qualityGateWarnings),
    positive_flags: JSON.stringify(candidate.positiveFlags),
    risk_flags: JSON.stringify(candidate.riskFlags),
    warning_flags: JSON.stringify(candidate.warningFlags),
    pass_reason_codes: JSON.stringify(candidate.passReasonCodes),
    reject_reason_codes: JSON.stringify(candidate.rejectReasonCodes),
    rank_bucket: candidate.rankBucket,
    final_rank: candidate.finalRank,
    posted: candidate.posted ? 1 : 0,
    posted_message_id: candidate.postedMessageId,
    entry_mcap: candidate.entryMcap,
    entry_price: candidate.entryPrice,
    raw_dexscreener_snapshot: JSON.stringify(candidate.rawDexscreenerSnapshot ?? null),
    created_at: candidate.createdAt,
  };
}

type RecentAlertCliCandidateRecord = {
  token_address: string;
  cli_checked: number;
  cli_grade: string | null;
  cli_oracle_status: string | null;
  raw_cli_summary: string | null;
  flow_quality: string | null;
  holder_risk: string | null;
  buyer_seller_balance: string | null;
  sell_pressure: string | null;
  wallet_quality: string | null;
  cluster_risk: string | null;
  quality_gate_grade: string | null;
  quality_gate_reasons: string | null;
  quality_gate_warnings: string | null;
  created_at: string;
};

type SmartWalletObservationInput = Parameters<typeof sqliteAlertStore.saveSmartWalletObservations>[0][number];

type SmartWalletProfileRecord = {
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
  bad_result_count: number;
  bot_like_count: number;
  high_risk_count: number;
  wallet_quality_score: number;
  wallet_quality_label: "Strong" | "Medium" | "Weak" | "Unknown";
  raw_stats: string | null;
};

type SmartWalletLearningStats = {
  total_profiles: number | null;
  strong_count: number | null;
  medium_count: number | null;
  weak_count: number | null;
  unknown_count: number | null;
  hit_wallet_count: number | null;
  risky_wallet_count: number | null;
};

type AutoTuningCandidateRow = {
  id: string;
  token_address: string;
  candidate_source_type: string | null;
  mcap: number | null;
  age_days: number | null;
  liquidity: number | null;
  flow_mcap: number | null;
  traders: number | null;
  cli_grade: string | null;
  flow_quality: string | null;
  holder_risk: string | null;
  buyer_seller_balance: string | null;
  sell_pressure: string | null;
  wallet_quality: string | null;
  cluster_risk: string | null;
  risk_flags: string | null;
  warning_flags: string | null;
  smart_wallet_quality_label: string | null;
  created_at: string;
  peak_return_x: number | null;
};

type AutoTuningBucketResult = {
  bucketType: string;
  bucketName: string;
  sampleSize: number;
  avgPeakReturn: number | null;
  hit2xRate: number | null;
  hit5xRate: number | null;
  badResultRate: number | null;
  bestPeakReturn: number | null;
  adjustment: number;
  reason: string;
};

type AutoTuningBaseline = {
  sampleSize: number;
  avgPeakReturn: number | null;
  hit2xRate: number;
  hit5xRate: number;
  badResultRate: number;
};

type AutoTuningResultRecord = {
  bucket_type: string;
  bucket_name: string;
  sample_size: number;
  avg_peak_return: number | null;
  hit_2x_rate: number | null;
  hit_5x_rate: number | null;
  bad_result_rate: number | null;
  best_peak_return: number | null;
  adjustment: number;
  reason: string | null;
  version: string;
};

function normalizeCliGrade(value: string | null | undefined): CliGrade {
  return value === "A" || value === "B" || value === "C" || value === "Reject" ? value : "Unchecked";
}

function normalizeDeepCheckGrade(value: string | null | undefined): DeepCheckGrade {
  return value === "Strong" || value === "Medium" || value === "Weak" ? value : "N/A";
}

function normalizeDeepCheckRisk(value: string | null | undefined): DeepCheckRisk {
  return value === "Low" || value === "Medium" || value === "High" ? value : "N/A";
}

function normalizeDeepCheckBalance(value: string | null | undefined): DeepCheckBalance {
  return value === "Bullish" || value === "Neutral" || value === "Bearish" ? value : "N/A";
}

function normalizeDeepCheckClusterRisk(value: string | null | undefined): DeepCheckClusterRisk {
  return value === "Low" || value === "Medium" || value === "High" ? value : "未検証";
}

function normalizeWalletQualityLevel(value: string | null | undefined): WalletQualityLevel {
  return value === "High" || value === "Medium" || value === "Low" ? value : "N/A";
}

function getRecentCliCandidate(tokenAddress: string): RecentAlertCliCandidateRecord | undefined {
  const cutoff = new Date(Date.now() - scoringConfig.alertRules.cliOracleDedupeHours * 3_600_000).toISOString();

  return getRecentAlertCliCandidate.get(tokenAddress, cutoff) as RecentAlertCliCandidateRecord | undefined;
}

function recentCliResultIsReusable(row: RecentAlertCliCandidateRecord): boolean {
  return Boolean(
    row.flow_quality &&
    row.holder_risk &&
    row.buyer_seller_balance &&
    row.sell_pressure &&
    row.cluster_risk,
  );
}

function buildReusedDeepCheckReply(
  candidate: AlertV2Candidate,
  row: RecentAlertCliCandidateRecord,
): DeepCheckReply {
  const flowQuality = normalizeDeepCheckGrade(row.flow_quality);
  const holderRisk = normalizeDeepCheckRisk(row.holder_risk);
  const buyerSellerBalance = normalizeDeepCheckBalance(row.buyer_seller_balance);
  const sellPressure = normalizeDeepCheckRisk(row.sell_pressure);
  const clusterRisk = normalizeDeepCheckClusterRisk(row.cluster_risk);
  const walletQualityLevel = normalizeWalletQualityLevel(row.wallet_quality);

  return {
    tokenAddress: candidate.tokenAddress,
    symbol: candidate.symbol,
    name: candidate.name,
    marketCap: candidate.marketCap,
    signalId: candidate.card.signalId,
    flowQuality: { label: flowQuality, text: `前回CLI結果を再利用: Flow Quality ${flowQuality}` },
    holderQuality: { label: holderRisk, text: `前回CLI結果を再利用: Holder Risk ${holderRisk}` },
    buyerSellerBalance: { label: buyerSellerBalance, text: `前回CLI結果を再利用: Buyer/Seller ${buyerSellerBalance}` },
    sellPressure: { label: sellPressure, text: `前回CLI結果を再利用: Sell Pressure ${sellPressure}` },
    clusterRisk: { label: clusterRisk, text: `前回CLI結果を再利用: Cluster Risk ${clusterRisk}` },
    walletQuality: {
      walletCount: 0,
      estimatedIndependentWallets: null,
      behaviorCounts: getZeroWalletBehaviorCounts(),
      clusterRisk,
      clusterReasons: [`前回CLI結果を再利用: ${row.created_at}`],
      walletQualityLevel,
      walletQualitySummary: `Wallet Quality: ${walletQualityLevel}（前回CLI結果を再利用）`,
      snapshots: [],
    },
    narrative: createHiddenTokenNarrative(),
    finalNote: "直近12時間以内のCLI Oracle結果を再利用しました。",
    confidence: "Medium",
    rawSummary: row.raw_cli_summary ?? "reused_recent_cli_result",
    rawSources: {},
  };
}

function applyDeepCheckToAlertCandidate(
  candidate: AlertV2Candidate,
  deepCheck: DeepCheckReply,
  gate: AlertQualityGateResult,
  status: string,
): void {
  const cliGate = gradeCliQuality(deepCheck);

  candidate.cliChecked = true;
  candidate.cliGrade = cliGate.grade;
  candidate.cliOracleStatus = status;
  candidate.rawCliSummary = deepCheck.rawSummary;
  candidate.flowQuality = deepCheck.flowQuality.label;
  candidate.holderRisk = deepCheck.holderQuality.label;
  candidate.buyerSellerBalance = deepCheck.buyerSellerBalance.label;
  candidate.sellPressure = deepCheck.sellPressure.label;
  candidate.walletQuality = deepCheck.walletQuality.walletQualityLevel;
  candidate.clusterRisk = deepCheck.clusterRisk.label;
  candidate.qualityGateGrade = gate.grade;
  candidate.qualityGateReasons = gate.reasons;
  candidate.qualityGateWarnings = gate.warnings;
  candidate.smartMoneyQualityScore = calculateSmartMoneyQualityScore(deepCheck, gate);
  applySmartWalletProfilesToAlertCandidate(candidate, deepCheck);
  candidate.alertMomentumComponents.smartMoneyQuality = candidate.smartMoneyQualityScore;
  if (candidate.smartWalletQualityScore !== null) {
    candidate.alertMomentumComponents.smartWalletPdca = candidate.smartWalletQualityScore;
  }
  candidate.deepCheck = deepCheck;
  candidate.gate = gate;
  candidate.card.cliGrade = candidate.cliGrade;
  candidate.card.edgeScore = clampScore(Math.round((candidate.alertMomentumScore * 0.65) + (candidate.smartMoneyQualityScore * 0.35)));
  candidate.card.status = getStatus(candidate.card.edgeScore);
}

async function runAlertCheck(
  channel: SendableChannel,
  options: AlertCheckOptions,
): Promise<AlertCheckResult> {
  if (!channel.id) {
    throw new Error("投稿先チャンネルIDを取得できませんでした。");
  }

  const alertRunId = randomUUID();
  const startedAt = new Date().toISOString();
  const sourceBuild = await buildAlertV2CandidatesFromSources(alertRunId);
  const candidates = sourceBuild.candidates;
  const seen = new Set<string>();

  await enrichAlertCandidatesBeforeGate(candidates);

  for (const candidate of candidates) {
    applyAlertGate0(candidate, seen);
  }

  const preFiltered = applyAlertPreFilter(candidates);
  const recentCliByToken = new Map<string, RecentAlertCliCandidateRecord>();
  for (const candidate of preFiltered) {
    const recentCli = getRecentCliCandidate(candidate.tokenAddress);
    if (recentCli) {
      recentCliByToken.set(candidate.tokenAddress, recentCli);
    }
  }
  const cliTargets = preFiltered
    .filter((candidate) => !recentCliByToken.has(candidate.tokenAddress))
    .slice(0, scoringConfig.alertRules.cliOracleCheckSize);
  let alertUsedCredits = 0;
  const result: AlertCheckResult = {
    checkedCount: candidates.length,
    posted: [],
    rejected: [],
    cliExecuted: 0,
    cliSkippedRecentDedupe: 0,
    cliReusedRecentResult: 0,
  };

  if (candidates.length === 0) {
    return result;
  }

  const passedCards: Array<{
    card: MemeResearchCard;
    deepCheck: DeepCheckReply;
    gate: AlertQualityGateResult;
    deepCheckId: string;
    candidate: AlertV2Candidate;
  }> = [];

  for (const candidate of preFiltered) {
    const recentCli = recentCliByToken.get(candidate.tokenAddress);
    if (!recentCli) continue;

    result.cliSkippedRecentDedupe += 1;

    if (!recentCliResultIsReusable(recentCli)) {
      candidate.cliOracleStatus = "skipped_recent_cli_dedupe";
      candidate.warningFlags.push("skipped_recent_cli_dedupe");
      continue;
    }

    const card = candidate.card;
    const deepCheck = buildReusedDeepCheckReply(candidate, recentCli);
    const gate = evaluateAlertQualityGate(deepCheck, card, {
      allowMockFallback: options.allowMockFallback,
    });
    const deepCheckId = saveDeepCheckResult(deepCheck, card.signalId, {
      sourceType: "alert",
      alertRunId: candidate.alertRunId,
      alertCandidateId: `${candidate.alertRunId}:${candidate.tokenAddress}:${candidate.candidateRank}`,
    });

    applyDeepCheckToAlertCandidate(candidate, deepCheck, gate, "reused_recent_cli_result");
    const reusedGrade = normalizeCliGrade(recentCli.cli_grade);
    if (reusedGrade !== "Unchecked") {
      candidate.cliGrade = reusedGrade;
      candidate.card.cliGrade = reusedGrade;
    }
    result.cliReusedRecentResult += 1;

    if (!gate.passed) {
      candidate.rejectReasonCodes.push(...gate.reasons.map((reason) => reason.toLowerCase().replace(/[^a-z0-9]+/g, "_")).filter(Boolean));
      result.rejected.push({ card, deepCheck, gate });
      continue;
    }

    candidate.passReasonCodes.push("alert_quality_gate_pass", "reused_recent_cli_result");
    passedCards.push({ card, deepCheck, gate, deepCheckId, candidate });
  }

  for (const candidate of cliTargets) {
    const card = candidate.card;

    try {
      result.cliExecuted += 1;
      const tracking = await withNansenCreditTracking(`alert-v2-cli-oracle:${card.tokenAddress}`, () => buildDeepCheckReply(card.tokenAddress));
      const deepCheck = tracking.result;
      alertUsedCredits += tracking.usedCredits ?? 0;
      const gate = evaluateAlertQualityGate(deepCheck, card, {
        allowMockFallback: options.allowMockFallback,
      });
      const cliGate = gradeCliQuality(deepCheck);

      applyDeepCheckToAlertCandidate(candidate, deepCheck, gate, cliGate.status);

      if (!gate.passed) {
        saveDeepCheckResult(deepCheck, card.signalId, {
          sourceType: "alert",
          alertRunId: candidate.alertRunId,
          alertCandidateId: `${candidate.alertRunId}:${candidate.tokenAddress}:${candidate.candidateRank}`,
        });
        candidate.rejectReasonCodes.push(...gate.reasons.map((reason) => reason.toLowerCase().replace(/[^a-z0-9]+/g, "_")).filter(Boolean));
        result.rejected.push({ card, deepCheck, gate });
        console.log(`Rejected Meme Edge Alert: ${card.symbol} ${gate.reasons.join(" / ")}`);
        continue;
      }

      const deepCheckId = saveDeepCheckResult(deepCheck, card.signalId, {
        sourceType: "alert",
        alertRunId: candidate.alertRunId,
        alertCandidateId: `${candidate.alertRunId}:${candidate.tokenAddress}:${candidate.candidateRank}`,
      });

      candidate.passReasonCodes.push("alert_quality_gate_pass");
      passedCards.push({ card, deepCheck, gate, deepCheckId, candidate });
    } catch (error) {
      const message = error instanceof Error ? error.message : "不明なエラー";
      const fallbackDeepCheck: DeepCheckReply = {
        tokenAddress: card.tokenAddress,
        symbol: card.symbol,
        name: card.name,
        marketCap: card.marketCap,
        signalId: null,
        flowQuality: { label: "N/A", text: "Deep Checkの取得に失敗しました。" },
        holderQuality: { label: "N/A", text: "Deep Checkの取得に失敗しました。" },
        buyerSellerBalance: { label: "N/A", text: "Deep Checkの取得に失敗しました。" },
        sellPressure: { label: "N/A", text: "Deep Checkの取得に失敗しました。" },
        clusterRisk: { label: "未検証", text: "Deep Checkの取得に失敗しました。" },
        walletQuality: {
          walletCount: 0,
          estimatedIndependentWallets: null,
          behaviorCounts: getZeroWalletBehaviorCounts(),
          clusterRisk: "未検証",
          clusterReasons: ["Deep Checkの取得に失敗しました。"],
          walletQualityLevel: "N/A",
          walletQualitySummary: "Wallet Quality: N/A",
          snapshots: [],
        },
        narrative: createHiddenTokenNarrative(),
        finalNote: "Deep Checkの取得に失敗したため、Alert投稿は見送りました。",
        confidence: "Low",
        rawSummary: message,
        rawSources: {},
      };
      const gate = evaluateAlertQualityGate(fallbackDeepCheck, card, {
        allowMockFallback: options.allowMockFallback,
      });

      candidate.cliChecked = true;
      candidate.cliGrade = "C";
      candidate.cliOracleStatus = `failed: ${message}`;
      candidate.rawCliSummary = message;
      candidate.qualityGateGrade = gate.grade;
      candidate.qualityGateReasons = gate.reasons;
      candidate.qualityGateWarnings = gate.warnings;
      candidate.rejectReasonCodes.push("cli_oracle_failed");
      saveDeepCheckResult(fallbackDeepCheck, card.signalId, {
        sourceType: "alert",
        alertRunId: candidate.alertRunId,
        alertCandidateId: `${candidate.alertRunId}:${candidate.tokenAddress}:${candidate.candidateRank}`,
      });
      result.rejected.push({ card, deepCheck: fallbackDeepCheck, gate });
      console.warn(`Deep Check failed for alert candidate: ${card.symbol}`, error);
    }
  }

  let autoTuningMap = new Map<string, AutoTuningResultRecord>();
  try {
    const tuningResults = refreshAutoTuningResults();

    autoTuningMap = tuningResults.length > 0 ? getLatestAutoTuningMap() : new Map<string, AutoTuningResultRecord>();
  } catch (error) {
    const message = error instanceof Error ? error.message : "不明なエラー";

    console.warn(`Auto-Tuning更新に失敗しました。補正なしでAlert選定します: ${message}`);
  }

  for (const item of passedCards) {
    applyAutoTuningToAlertCandidate(item.candidate, autoTuningMap);
  }

  const selected = passedCards
    .filter((item) => item.candidate.cliGrade !== "Reject")
    .sort((a, b) => getAlertFinalSelectionScore(b.candidate) - getAlertFinalSelectionScore(a.candidate))
    .slice(0, options.maxAlerts);

  selected.forEach((item, index) => {
    item.candidate.finalRank = index + 1;
    item.candidate.posted = true;
  });

  if (selected.length > 0) {
    saveMemeSignals(selected.map((item) => item.card));
  }

  for (const [index, item] of selected.entries()) {
    const { card, deepCheck, gate, deepCheckId, candidate } = item;
    const reply: MemeScanReply = {
      embeds: [buildAlertEmbed(card, index, deepCheck, gate, candidate)],
      components: [buildPaperPickButtons(card.signalId)],
    };

    if (index === 0) {
      reply.content = "**🚨 Meme Edge Alert**";
    }

    const message = await channel.send(reply);

    saveSignalMessage(card.signalId, message);
    candidate.postedMessageId = message.id;
    saveAlert(card, channel.id, gate, deepCheckId, candidate, message.id);
    result.posted.push({ card, deepCheck, gate, candidate });
  }

  try {
    await alertStore.saveRun(
      {
        alert_run_id: alertRunId,
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        candidate_pool_size: candidates.length,
        nansen_candidate_size: sourceBuild.nansenCount,
        fresh_scan_db_candidate_size: sourceBuild.freshCount,
        watch_candidate_size: sourceBuild.watchCount,
        pre_filter_size: preFiltered.length,
        cli_oracle_check_size: result.cliExecuted,
        posted_count: selected.length,
        used_credits: alertUsedCredits,
        credits_by_step: JSON.stringify({
          candidates_processed: candidates.length,
          cli_checks_count: result.cliExecuted,
          cli_skipped_recent_dedupe: result.cliSkippedRecentDedupe,
          cli_reused_recent_result: result.cliReusedRecentResult,
          posted_count: selected.length,
          winners_count: null,
          cli_oracle_used_credits: alertUsedCredits,
          cost_per_posted_signal: selected.length > 0 ? alertUsedCredits / selected.length : null,
          cost_per_winner: null,
        }),
        status: "completed",
        error_message: null,
        config_snapshot: JSON.stringify(scoringConfig.alertRules),
        market_context: JSON.stringify({
          nansen_candidate_size: sourceBuild.nansenCount,
          fresh_scan_db_candidate_size: sourceBuild.freshCount,
          watch_candidate_size: sourceBuild.watchCount,
        }),
        created_at: startedAt,
      },
      candidates.map(serializeAlertCandidate),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "不明なエラー";

    console.warn(`Alert v2候補保存に失敗しました (${alertStore.provider}): ${message}`);
  }

  console.log([
    "Alert credit summary:",
    `- cli_executed: ${result.cliExecuted}`,
    `- cli_skipped_recent_dedupe: ${result.cliSkippedRecentDedupe}`,
    `- cli_reused_recent_result: ${result.cliReusedRecentResult}`,
    `- posted: ${selected.length}`,
    `- cli_used_credits: ${alertUsedCredits}`,
  ].join("\n"));

  scheduleAlertCandidateTracking(candidates, channel);

  return result;
}

async function runMemeAlertCheck(channel: SendableChannel): Promise<AlertCheckResult> {
  const tracking = await withNansenCreditTracking(
    "auto-alert-check",
    () => runAlertCheck(channel, {
      isDev: false,
      allowMockFallback: process.env.USE_MOCK_NANSEN === "true",
      maxAlerts: scoringConfig.alertRules.maxAlertsPerRun,
    }),
  );

  return tracking.result;
}

function getMemeRulesMessage(): string {
  return [
    "**bb Meme Edge Paper Pick ルール**",
    "",
    "このBotでは、気になったトークンに対して",
    "「Conviction / エアIN / Watch」の3つの方法で",
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
    "🧪 エアIN",
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
    "- エアINを2回 = 2pt消費",
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
  return signal.symbol ? formatDisplaySymbol(signal.symbol) : shortenAddress(signal.token_address);
}

function cleanDisplaySymbol(symbol: string | null | undefined): string {
  const cleaned = String(symbol ?? "UNKNOWN")
    .trim()
    .replace(/^\$+/, "")
    .replace(/^[\p{Emoji_Presentation}\p{Extended_Pictographic}\uFE0F\s]+/u, "")
    .trim()
    .replace(/^\$+/, "")
    .trim();

  return cleaned || "UNKNOWN";
}

function formatDisplaySymbol(symbol: string | null | undefined): string {
  return `$${cleanDisplaySymbol(symbol)}`;
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

  return `${userLabel}｜${actionPlainLabel(pick.action)}｜${getSymbolLabel(pick.signal)} ${formatReturnX(pick.returnX)}`;
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
  const latestSnapshot = getLatestPerformanceSnapshot.get(signal.signal_id) as PerformanceSnapshotRecord | undefined;
  const marketData = latestSnapshot?.current_mcap !== null && latestSnapshot?.current_mcap !== undefined
    ? {
      marketCap: latestSnapshot.current_mcap,
      price: latestSnapshot.current_price,
      liquidity: null,
      volume24h: null,
      pairUrl: null,
    }
    : await fetchDexScreenerMarketData(signal.token_address);
  const currentMcap = marketData?.marketCap ?? null;
  const currentPrice = marketData?.price ?? null;
  const botReturnX = latestSnapshot?.bot_return_x ?? calculateReturnX(currentMcap, signal.scan_mcap);
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
  // 平均の横に出す件数は、return_xを計算できたPickだけを数えます。
  const paperInReturns = userPickReturns
    .filter((pick) => pick.action === "paper_in")
    .map((pick) => pick.returnX);
  const convictionReturns = userPickReturns
    .filter((pick) => pick.action === "conviction")
    .map((pick) => pick.returnX);

  return {
    signal,
    currentMcap,
    currentPrice,
    botReturnX,
    paperInAvg: average(paperInReturns),
    paperInAvgCount: paperInReturns.length,
    convictionAvg: average(convictionReturns),
    convictionAvgCount: convictionReturns.length,
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

  return `${userLabel}｜${actionPlainLabel(pick.action)}｜${getSymbolLabel(pick.signal)} ${formatReturnX(pick.returnX)}`;
}

async function formatBestUserPickWithoutMention(pick: UserPickReturn | null): Promise<string> {
  if (!pick) {
    return "N/A";
  }

  const userLabel = await resolveUserLabelById(pick.userId);

  return `${userLabel}｜${actionPlainLabel(pick.action)}｜${getSymbolLabel(pick.signal)} ${formatReturnX(pick.returnX)}`;
}

function getPickAverage(
  performances: SignalPerformance[],
  action: Extract<PickAction, "paper_in" | "conviction">,
): { average: number | null; count: number } {
  const returns = performances
    .flatMap((performance) => performance.userPickReturns)
    .filter((pick) => pick.action === action)
    .map((pick) => pick.returnX);

  return {
    average: average(returns),
    count: returns.length,
  };
}

function formatReturnXWithCount(value: number | null, count: number): string {
  return `${formatReturnX(value)}（${count}件）`;
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
  options: { postTopSignals?: boolean; sendDataCollectionSummary?: boolean } = {},
): Promise<MemeScanResult> {
  const scanResult = await getMemeScanResult(label, options);

  saveScanRecord(
    scanResult.scanId,
    context.channelId,
    context.guildId,
    scanResult.scanTime,
    scanResult.source,
  );
  if (scanResult.signalIds.length > 0) {
    scheduleScanResultJobs(scanResult.scanId);
  }

  if (!scanResult.postTopSignals && options.sendDataCollectionSummary === false) {
    return scanResult;
  }

  const firstReply = scanResult.replies[0];

  if (!firstReply) {
    throw new Error("表示できるResearch Cardがありません。");
  }

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
  }, { sendDataCollectionSummary: false });
}

function markPosted(scanId: string, window: ResultWindow): void {
  markScanResultPosted.run(window, window, window, scanId);
}

function buildPostResultTokenField(performance: SignalPerformance, index: number): { name: string; value: string } {
  return buildResultTokenField(performance, index);
}

function normalizeSignalType(value: string | null | undefined): SignalType {
  const allowed: SignalType[] = [
    "alert_edge",
    "flow_watch",
    "thin_liquidity",
    "bot_like_flow",
    "whale_flow",
  ];

  if (allowed.includes(value as SignalType)) {
    return value as SignalType;
  }

  const normalized = value?.trim().toLowerCase();
  const normalizedKey = normalized?.replace(/^[^a-z0-9]+/i, "").replace(/[\s-]+/g, "_");

  if (normalizedKey === "alert_edge") return "alert_edge";
  if (normalizedKey === "flow_watch") return "flow_watch";
  if (
    normalizedKey === "fresh_launch" ||
    normalizedKey === "early_edge" ||
    normalizedKey === "watch_candidate" ||
    normalizedKey === "unknown" ||
    normalizedKey === "re_flow" ||
    normalizedKey === "fresh_edge"
  ) return "flow_watch";
  if (normalizedKey === "thin_liquidity") return "thin_liquidity";
  if (normalizedKey === "bot_like_flow") return "bot_like_flow";
  if (normalizedKey === "whale_flow") return "whale_flow";

  if (value === "❔ Unknown" || value === "🌱 Fresh Edge" || value === "🔁 Re-Flow") {
    return "flow_watch";
  }

  return "flow_watch";
}

function normalizePerformanceSignalType(performance: SignalPerformance): SignalType {
  return normalizeSignalType(performance.signal.signal_type);
}

function buildSignalTypeReview(performances: SignalPerformance[]): string {
  const trackedTypes: SignalType[] = [
    "alert_edge",
    "flow_watch",
    "thin_liquidity",
    "bot_like_flow",
    "whale_flow",
  ];
  const lines: string[] = [];
  const stats = trackedTypes.map((signalType) => {
    const typed = performances.filter((performance) => normalizePerformanceSignalType(performance) === signalType);
    const returns = typed
      .map((performance) => performance.botReturnX)
      .filter((value): value is number => value !== null);

    return {
      signalType,
      count: typed.length,
      average: average(returns),
    };
  });
  const topType = stats
    .filter((stat) => stat.count > 0)
    .sort((a, b) => b.count - a.count)[0] ?? null;

  if (!topType) {
    return "Signal別の傾向はまだN/Aです。";
  }

  lines.push(`今日は ${formatSignalTypeLabel(topType.signalType)} が中心でした。`);

  for (const stat of stats) {
    lines.push(`${formatSignalTypeLabel(stat.signalType)}: ${stat.count}件｜平均 ${formatReturnX(stat.average)}`);
  }

  const flowWatch = stats.find((stat) => stat.signalType === "flow_watch");

  if ((flowWatch?.count ?? 0) > 0 && (flowWatch?.average ?? 0) > 1) {
    lines.push("資金流入あり候補は相対的に反応が良好でした。Ageは別軸で確認します。");
  }

  return lines.join("\n");
}

function buildNansenSignalReview(performances: SignalPerformance[]): string {
  const bestBot = getBestBotPerformance(performances);
  const botReturns = performances
    .map((performance) => performance.botReturnX)
    .filter((value): value is number => value !== null);
  const averageReturn = average(botReturns);

  if (!bestBot || averageReturn === null) {
    return [
      "今回はDexScreenerで取得できる現在値が少なく、傾向判断は保留です。",
      buildSignalTypeReview(performances),
    ].join("\n");
  }

  const flowMcap = bestBot.signal.flow_mcap_ratio;
  const scanMcap = bestBot.signal.scan_mcap;

  if (bestBot.botReturnX !== null && bestBot.botReturnX >= 2) {
    return [
      "今回伸びた候補は、初期MCapが比較的小さく、Smart Money流入に対する反応が強いものに集中しました。",
      buildSignalTypeReview(performances),
    ].join("\n");
  }

  if (flowMcap !== null && flowMcap > 0.05) {
    return [
      "Flow/MCapが高い候補は注目されましたが、現時点では大きな上昇にはつながっていません。",
      buildSignalTypeReview(performances),
    ].join("\n");
  }

  if (scanMcap !== null && scanMcap > 10_000_000) {
    return [
      "大型寄りの候補が多く、短期では値動きが比較的落ち着いた結果になりました。",
      buildSignalTypeReview(performances),
    ].join("\n");
  }

  return [
    "今回は候補全体でばらつきがあり、MCapとSmart Money flowの強さを次回も比較して見る必要があります。",
    buildSignalTypeReview(performances),
  ].join("\n");
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
        name: "📊 Bot成績",
        value: formatTreeRows([
          ["候補数", formatCount(performances.length)],
          ["2x", String(botReturns.filter((value) => value >= 2).length)],
          ["5x", String(botReturns.filter((value) => value >= 5).length)],
          ["10x", String(botReturns.filter((value) => value >= 10).length)],
          ["平均成績", formatReturnX(averageReturn)],
          ["中央値", formatReturnX(median(botReturns))],
          ["Bot最高", bestBot ? `${getSymbolLabel(bestBot.signal)} ${formatReturnX(bestBot.botReturnX)}` : "N/A"],
        ]).join("\n"),
      },
      {
        name: "📌 補足",
        value: [
          `ユーザー最高: ${bestUserPickText}`,
        ].join("\n"),
      },
      {
        name: "Nansenシグナル振り返り",
        value: buildNansenSignalReview(performances),
      },
    )
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
  if (!AUTO_POST_RESULTS_ENABLED) {
    console.log(`Result自動投稿はデフォルトOFFです。scan_id=${scanId}`);
    return;
  }

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
  const signalType = normalizePerformanceSignalType(performance);

  return {
    name: `${index + 1}. ${getSymbolLabel(performance.signal)}`,
    value: [
      "**判定**",
      ...formatTreeRows([
        ["Signal", formatSignalTypeLabel(signalType)],
        ["Risk", formatDisplayRiskLine(getSignalRiskLabels(signalType))],
      ]),
      "**Stats**",
      ...formatTreeRows([
        ["スキャン時", formatCompactUsd(performance.signal.scan_mcap)],
        ["現在", formatCompactUsd(performance.currentMcap)],
        ["Bot成績", formatReturnX(performance.botReturnX)],
        ["Conviction平均", formatReturnXWithCount(performance.convictionAvg, performance.convictionAvgCount)],
        ["エアIN平均", formatReturnXWithCount(performance.paperInAvg, performance.paperInAvgCount)],
      ]),
    ].join("\n"),
  };
}

function formatSignalTypeCounts(performances: SignalPerformance[]): string {
  const counts = new Map<string, number>();

  for (const performance of performances) {
    const signalLabel = formatSignalTypeLabel(normalizePerformanceSignalType(performance));

    counts.set(signalLabel, (counts.get(signalLabel) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([signalLabel, count]) => `${signalLabel} ${count}`)
    .join("｜") || "N/A";
}

function buildResultsSummaryLines(
  performances: SignalPerformance[],
): string[] {
  const botReturns = performances
    .map((performance) => performance.botReturnX)
    .filter((value): value is number => value !== null);
  const bestBot = getBestBotPerformance(performances);

  return formatTreeRows([
    ["候補数", formatCount(performances.length)],
    ["2x", String(botReturns.filter((value) => value >= 2).length)],
    ["5x", String(botReturns.filter((value) => value >= 5).length)],
    ["10x", String(botReturns.filter((value) => value >= 10).length)],
    ["平均成績", formatReturnX(average(botReturns))],
    ["中央値", formatReturnX(median(botReturns))],
    ["Bot最高", bestBot ? `${getSymbolLabel(bestBot.signal)} ${formatReturnX(bestBot.botReturnX)}` : "N/A"],
  ]);
}

async function buildResultsSupplementLines(
  interaction: ChatInputCommandInteraction,
  performances: SignalPerformance[],
): Promise<string[]> {
  const bestUserPick = await formatBestUserPick(interaction, getBestUserPick(performances));

  return [
    `ユーザー最高: ${bestUserPick}`,
    `Signal: ${formatSignalTypeCounts(performances)}`,
  ];
}

async function buildLatestResultsEmbed(
  interaction: ChatInputCommandInteraction,
): Promise<InstanceType<typeof EmbedBuilder> | string> {
  const latestScan = getLatestScanId.get() as { scan_id: string } | undefined;

  if (!latestScan) {
    return "まだ保存された候補結果がありません。自動Alertの投稿後にもう一度確認してください。";
  }

  const signals = getSignalsByScanId.all(latestScan.scan_id) as ResultSignalRecord[];

  if (signals.length === 0) {
    return "まだ保存された候補結果がありません。自動Alertの投稿後にもう一度確認してください。";
  }

  const performances = await buildSignalPerformances(signals, "latest");
  const summaryLines = buildResultsSummaryLines(performances);
  const supplementLines = await buildResultsSupplementLines(interaction, performances);

  return new EmbedBuilder()
    .setTitle("📊 bb Meme Edge Results - 最新スキャン")
    .setColor(0x3498db)
    .setDescription([
      "最新スキャンの成績です。",
      "全期間の結果は /meme-results period:daily、個人成績は /my。",
    ].join("\n"))
    .addFields(
      ...performances.map((performance, index) => buildResultTokenField(performance, index)),
      {
        name: "📊 サマリー",
        value: summaryLines.join("\n"),
      },
      {
        name: "📌 補足",
        value: supplementLines.join("\n"),
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
    return "まだ保存された候補結果がありません。自動Alertの投稿後にもう一度確認してください。";
  }

  const performances = await buildSignalPerformances(signals, period);
  const summaryLines = buildResultsSummaryLines(performances);
  const supplementLines = await buildResultsSupplementLines(interaction, performances);
  const description = `${formatPeriodLabel(period)}の保存済み候補の成績です。個人成績は /my。`;

  if (period !== "daily") {
    return [
      new EmbedBuilder()
        .setTitle(`📊 bb Meme Edge Results - ${formatPeriodLabel(period)}`)
        .setColor(0x3498db)
        .setDescription(description)
        .addFields(
          {
            name: "📊 サマリー",
            value: summaryLines.join("\n"),
          },
          {
            name: "📌 補足",
            value: supplementLines.join("\n"),
          },
        )
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
        name: "📊 サマリー",
        value: summaryLines.join("\n"),
      }, {
        name: "📌 補足",
        value: supplementLines.join("\n"),
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

  return "🏆 Monthly bb Meme Edge Recap";
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

  return formatTreeRows([
    ["候補数", formatCount(performances.length)],
    ["2x", String(botReturns.filter((value) => value >= 2).length)],
    ["5x", String(botReturns.filter((value) => value >= 5).length)],
    ["10x", String(botReturns.filter((value) => value >= 10).length)],
    ["平均成績", formatReturnX(average(botReturns))],
    ["中央値", formatReturnX(median(botReturns))],
    ["Bot最高", bestBot ? `${getSymbolLabel(bestBot.signal)} ${formatReturnX(bestBot.botReturnX)}` : "N/A"],
  ]).join("\n");
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
  void interaction;

  return `Conviction: ${convictions.length}｜エアIN: ${paperIns.length}｜Watch: ${picks.filter((pick) => pick.normalizedAction === "watch").length}`;
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
    return "Leaderboard: まだ対象なし";
  }

  const lines: string[] = [];

  for (const [index, performance] of performances.entries()) {
    const userLabel = interaction
      ? await resolveUserLabel(interaction, performance.userId)
      : resolveUserLabelById(performance.userId);

    lines.push(`${index + 1}. ${userLabel} ${formatScore(performance.totalScore)}｜ROI ${formatReturnX(performance.roi)}`);
  }

  return `Leaderboard: ${lines.join("｜")}`;
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
    return "対象期間のsignalsがないため、テーマ別の内部集計はN/Aです。";
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
    return `${periodLabel}は ${topCategories.join(" と ")} が多く検出されました。現在値が取れた候補が少ないため、テーマ別の伸びはN/Aです。`;
  }

  const lead = `${periodLabel}は ${topCategories.join(" と ")} が多く検出されました。`;
  const bestLine = `最も成績が良かったのは ${bestCategory[0]} で、${getSymbolLabel(bestPerformance.signal)} が ${formatReturnX(bestPerformance.botReturnX)} まで伸びました。`;

  if (period === "daily") {
    return [lead, bestLine].join("\n");
  }

  const detail = ranked
    .slice(0, 3)
    .map(([category, value]) => `${category}: ${value.count}件`)
    .join("｜");

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
  const freshWindowTokens = signals.filter((signal) => {
    const ageDays = parseTokenAgeDays(signal.token_age);

    return ageDays !== null && ageDays <= 3;
  }).length;
  const watchWindowTokens = signals.filter((signal) => {
    const ageDays = parseTokenAgeDays(signal.token_age);

    return ageDays !== null && ageDays > 3 && ageDays <= 30;
  }).length;
  const bestBot = getBestBotPerformance(performances);
  const lines = [
    `Flow/MCapが高い候補: ${highFlowMcap}件 / 24hと7d Flowが両方プラス: ${bothFlowPositive}件`,
    `24h Flowだけ強く7d Flowが弱い候補: ${shortOnly}件`,
    `MCap $500K未満: ${lowMcap}件 / MCap $10.00M以上: ${highMcap}件`,
    `Trader 25人以上: ${activeTraders}件 / 0〜3日: ${freshWindowTokens}件 / 4〜30日: ${watchWindowTokens}件`,
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

function getLearningReturnX(performance: SignalPerformance): number | null {
  return calculateReturnX(performance.currentMcap, performance.signal.scan_mcap);
}

function getLearningBestSymbol(performance: SignalPerformance): string {
  return performance.signal.symbol ? formatDisplaySymbol(performance.signal.symbol) : shortenAddress(performance.signal.token_address);
}

function buildLearningBucketStats(
  label: string,
  performances: SignalPerformance[],
): LearningBucketStats {
  const rows = performances
    .map((performance) => ({ performance, returnX: getLearningReturnX(performance) }))
    .filter((row): row is { performance: SignalPerformance; returnX: number } => row.returnX !== null);
  const returns = rows.map((row) => row.returnX);
  const best = rows.slice().sort((a, b) => b.returnX - a.returnX)[0] ?? null;

  return {
    label,
    count: rows.length,
    average: average(returns),
    median: median(returns),
    above1x: returns.filter((value) => value >= 1).length,
    above2x: returns.filter((value) => value >= 2).length,
    bestSymbol: best ? getLearningBestSymbol(best.performance) : null,
    bestReturn: best?.returnX ?? null,
  };
}

function formatLearningStat(stat: LearningBucketStats, includeMedian = false): string {
  if (stat.count === 0) {
    return `${stat.label}: N/A`;
  }

  const best = stat.bestSymbol && stat.bestReturn !== null
    ? ` / Best ${stat.bestSymbol} ${formatReturnX(stat.bestReturn)}`
    : "";
  const medianText = includeMedian ? ` / med ${formatReturnX(stat.median)}` : "";

  return `${stat.label}: ${formatReturnX(stat.average)} avg${medianText} / 2x超え ${stat.above2x}/${stat.count}${best}`;
}

function groupLearningStats(
  labels: string[],
  performances: SignalPerformance[],
  getLabel: (performance: SignalPerformance) => string,
): LearningBucketStats[] {
  return labels.map((label) =>
    buildLearningBucketStats(label, performances.filter((performance) => getLabel(performance) === label)),
  );
}

function getMcapBucket(mcap: number | null): string {
  if (mcap === null) return "Unknown";
  if (mcap < 50_000) return "$50K未満";
  if (mcap < 500_000) return "$50K〜$500K";
  if (mcap < 2_000_000) return "$500K〜$2M";
  if (mcap < 5_000_000) return "$2M〜$5M";
  if (mcap < 10_000_000) return "$5M〜$10M";
  return "$10M以上";
}

function getAgeBucket(tokenAge: string | null): string {
  const ageDays = parseTokenAgeDays(tokenAge);

  if (ageDays === null) return "Unknown";
  return findAgeScoringBucket(ageDays)?.label ?? "Unknown";
}

function getFlowMcapBucket(flowMcapRatio: number | null): string {
  if (flowMcapRatio === null) return "Unknown";
  if (flowMcapRatio < 0.003) return "0〜0.3%";
  if (flowMcapRatio < 0.01) return "0.3〜1%";
  if (flowMcapRatio < 0.03) return "1〜3%";
  if (flowMcapRatio < 0.05) return "3〜5%";
  return "5%以上";
}

function getLatestDeepCheckBySignal(): Map<string, DeepCheckRecord> {
  const rows = getDeepChecksForLearning.all() as DeepCheckRecord[];
  const map = new Map<string, DeepCheckRecord>();

  for (const row of rows) {
    if (row.signal_id && !map.has(row.signal_id)) {
      map.set(row.signal_id, row);
    }
  }

  return map;
}

function getWalletBehaviorsBySignal(): Map<string, Set<string>> {
  const rows = getWalletSnapshotsForLearning.all() as WalletQualitySnapshotRecord[];
  const map = new Map<string, Set<string>>();

  for (const row of rows) {
    if (!row.signal_id || !row.behavior_type) {
      continue;
    }

    const behaviors = map.get(row.signal_id) ?? new Set<string>();

    behaviors.add(row.behavior_type);
    map.set(row.signal_id, behaviors);
  }

  return map;
}

function findLearningStat(stats: LearningBucketStats[], label: string): LearningBucketStats | undefined {
  return stats.find((stat) => stat.label === label);
}

function statAverage(stats: LearningBucketStats[], label: string): number | null {
  return findLearningStat(stats, label)?.average ?? null;
}

function buildLearningNextScoreAdjustment(data: LearningSummaryData, sampleCount: number): string {
  if (sampleCount < 3) {
    return "まだ十分な結果データが少ないため、現行のスコア設定を維持します。";
  }

  const lines: string[] = [];
  const flowWatchAvg = statAverage(data.signalType, "flow_watch");
  const alertAvg = statAverage(data.signalType, "alert_edge");
  const thinAvg = statAverage(data.signalType, "thin_liquidity");
  const lowMcapAvg = average([
    statAverage(data.mcap, "$50K〜$500K"),
    statAverage(data.mcap, "$500K〜$2M"),
  ].filter((value): value is number => value !== null));
  const highMcapAvg = average([
    statAverage(data.mcap, "$5M〜$10M"),
    statAverage(data.mcap, "$10M以上"),
  ].filter((value): value is number => value !== null));
  const youngAgeLabels = scoringConfig.ageBuckets.slice(0, 2).map((bucket) => bucket.label);
  const youngAgeAvg = average(youngAgeLabels
    .map((label) => statAverage(data.age, label))
    .filter((value): value is number => value !== null));
  const clusterHighAvg = statAverage(data.clusterRisk, "High");
  const microArbAvg = statAverage(data.walletBehavior, "Micro-arb");
  const mirrorAvg = statAverage(data.walletBehavior, "Mirror-like");

  if ((flowWatchAvg ?? 0) >= 1.2 || (alertAvg ?? 0) >= 1.2) {
    lines.push("Flow Watch / Alert Edgeの反応が良いため、Quality Gate通過候補を引き続き優先します。");
  }

  if ((lowMcapAvg ?? 0) >= 1.2) {
    lines.push("MCap $50K〜$2Mの候補を優先します。");
  }

  if ((youngAgeAvg ?? 0) >= 1.2) {
    lines.push("Ageの若いbucketをスコア上は引き続き重視します。");
  }

  if ((thinAvg ?? 1) < 1) {
    lines.push("Thin Liquidityは優先度を下げ、条件が強い時だけ残します。");
  }

  if ((highMcapAvg ?? 1) < 1) {
    lines.push("MCap $5M以上の大型候補は減点を維持します。");
  }

  if ((clusterHighAvg ?? 1) < 1 || (microArbAvg ?? 1) < 1 || (mirrorAvg ?? 1) < 1) {
    lines.push("Cluster Risk HighとMicro-arb / Mirror-like偏重の候補は減点を強めます。");
  }

  return lines.length > 0
    ? lines.join("\n")
    : "現時点では明確な勝ちパターンが薄いため、現行のスコア設定を維持します。";
}

function buildLearningSummaryData(performances: SignalPerformance[]): LearningSummaryData {
  const deepChecksBySignal = getLatestDeepCheckBySignal();
  const walletBehaviorsBySignal = getWalletBehaviorsBySignal();
  const validPerformances = performances.filter((performance) => getLearningReturnX(performance) !== null);
  const signalTypeLabels: SignalType[] = [
    "alert_edge",
    "flow_watch",
    "thin_liquidity",
    "bot_like_flow",
    "whale_flow",
  ];
  const mcapLabels = ["$50K未満", "$50K〜$500K", "$500K〜$2M", "$2M〜$5M", "$5M〜$10M", "$10M以上", "Unknown"];
  const ageLabels = [...scoringConfig.ageBuckets.map((bucket) => bucket.label), "Unknown"];
  const flowLabels = ["0〜0.3%", "0.3〜1%", "1〜3%", "3〜5%", "5%以上", "Unknown"];
  const clusterLabels = ["Low", "Medium", "High", "未検証 / N/A"];
  const behaviorLabels: WalletBehaviorType[] = ["Fresh Sniper", "Accumulator", "Fast Flipper", "Micro-arb", "Mirror-like", "Unknown"];
  const data: LearningSummaryData = {
    signalType: groupLearningStats(signalTypeLabels, validPerformances, (performance) => normalizePerformanceSignalType(performance)),
    mcap: groupLearningStats(mcapLabels, validPerformances, (performance) => getMcapBucket(performance.signal.scan_mcap)),
    age: groupLearningStats(ageLabels, validPerformances, (performance) => getAgeBucket(performance.signal.token_age)),
    flowMcap: groupLearningStats(flowLabels, validPerformances, (performance) => getFlowMcapBucket(performance.signal.flow_mcap_ratio)),
    clusterRisk: groupLearningStats(clusterLabels, validPerformances, (performance) => {
      const clusterRisk = deepChecksBySignal.get(performance.signal.signal_id)?.cluster_risk;

      return clusterRisk === "Low" || clusterRisk === "Medium" || clusterRisk === "High"
        ? clusterRisk
        : "未検証 / N/A";
    }),
    walletBehavior: behaviorLabels.map((label) =>
      buildLearningBucketStats(
        label,
        validPerformances.filter((performance) => walletBehaviorsBySignal.get(performance.signal.signal_id)?.has(label)),
      ),
    ),
    nextScoreAdjustment: "",
  };

  data.nextScoreAdjustment = buildLearningNextScoreAdjustment(data, validPerformances.length);

  return data;
}

function formatLearningSection(title: string, stats: LearningBucketStats[], limit: number, includeMedian = false): string {
  const lines = stats
    .filter((stat) => stat.count > 0)
    .slice(0, limit)
    .map((stat) => formatLearningStat(stat, includeMedian));

  return [`${title}:`, ...(lines.length > 0 ? lines : ["N/A"])].join("\n");
}

function bulletize(lines: string[]): string {
  return lines.map((line) => `• ${line}`).join("\n");
}

function statByLabel(stats: LearningBucketStats[], label: string): LearningBucketStats | null {
  return stats.find((stat) => stat.label === label) ?? null;
}

function buildAutoTuningLearningLine(): string | null {
  const rows = (getLatestAutoTuningResults.all(AUTO_TUNING_VERSION, AUTO_TUNING_VERSION) as AutoTuningResultRecord[])
    .filter((row) => row.sample_size >= 30 && row.adjustment !== 0)
    .sort((a, b) => Math.abs(b.adjustment) - Math.abs(a.adjustment));
  const top = rows[0];

  if (!top) {
    return null;
  }

  const direction = top.adjustment > 0 ? "やや優遇" : "慎重評価";

  return `Auto-Tuning: ${top.bucket_type} ${top.bucket_name} を${direction}`;
}

function buildLearningSummaryText(data: LearningSummaryData, performances: SignalPerformance[]): string {
  const returns = performances
    .map((performance) => performance.botReturnX)
    .filter((value): value is number => value !== null);
  const twoXCount = returns.filter((value) => value >= 2).length;
  const averageReturn = average(returns);
  const signals = performances.map((performance) => performance.signal);
  const shortOnlyCount = signals.filter((signal) => (signal.flow_24h ?? 0) > 0 && (signal.flow_7d ?? 0) <= 0).length;
  const unverifiedCluster = statByLabel(data.clusterRisk, "未検証 / N/A")?.count ?? 0;
  const walletSampleCount = data.walletBehavior.reduce((sum, stat) => sum + stat.count, 0);
  const lines: string[] = [];

  if (twoXCount === 0) {
    lines.push("今回は全体的に弱め。2x超えなし。");
  } else if ((averageReturn ?? 0) >= 1) {
    lines.push(`平均は${formatReturnX(averageReturn)}で、2x超えが${twoXCount}件ありました。`);
  } else {
    lines.push(`2x超えは${twoXCount}件ありましたが、平均は${formatReturnX(averageReturn)}に留まりました。`);
  }

  if (shortOnlyCount > 0) {
    lines.push("24h Flow単独の候補は伸び切らず、継続flow確認が必要。");
  }

  if (unverifiedCluster > 0 || walletSampleCount === 0) {
    lines.push("Cluster / Wallet Quality未検証が多く、追加検証サンプルが必要。");
  }

  const autoTuningLine = buildAutoTuningLearningLine();
  if (autoTuningLine) {
    lines.push(autoTuningLine);
  }

  const smartWalletStats = getSmartWalletLearningStats.get() as SmartWalletLearningStats | undefined;
  const knownSmartWallets = (smartWalletStats?.strong_count ?? 0) + (smartWalletStats?.medium_count ?? 0) + (smartWalletStats?.weak_count ?? 0);
  if (knownSmartWallets >= 3 && (smartWalletStats?.hit_wallet_count ?? 0) > 0) {
    lines.push("Smart Wallet実績がある候補は次回Alertで少し優遇。");
  } else if ((smartWalletStats?.unknown_count ?? 0) > knownSmartWallets && (smartWalletStats?.total_profiles ?? 0) >= 3) {
    lines.push("Unknown wallet中心の候補はサンプル不足として過剰評価しない。");
  } else if ((smartWalletStats?.risky_wallet_count ?? 0) >= 2) {
    lines.push("High-risk walletが多い候補は弱めに補正。");
  }

  if (lines.length < 3) {
    lines.push("次回もMCap、継続flow、Wallet Qualityを優先して確認。");
  }

  return bulletize(lines.slice(0, 3));
}

function buildPatternSummaryText(data: LearningSummaryData, performances: SignalPerformance[]): string {
  const bestBot = getBestBotPerformance(performances);
  const lowMcapStat = statByLabel(data.mcap, "$50K〜$500K");
  const highFlowStats = ["3〜5%", "5%以上"]
    .map((label) => statByLabel(data.flowMcap, label))
    .filter((stat): stat is LearningBucketStats => stat !== null && stat.count > 0);
  const highFlowAverage = average(
    highFlowStats
      .map((stat) => stat.average)
      .filter((value): value is number => value !== null),
  );
  const lines: string[] = [];

  if (bestBot) {
    lines.push(`Bot最高: ${getSymbolLabel(bestBot.signal)} ${formatReturnX(bestBot.botReturnX)}｜MCap ${formatCompactUsd(bestBot.signal.scan_mcap)}`);
  }

  if (lowMcapStat && lowMcapStat.count > 0) {
    lines.push(
      (lowMcapStat.average ?? 0) >= 1
        ? "MCap $50K〜$500K枠に反応あり。"
        : "MCap $50K〜$500K枠は弱め。",
    );
  }

  if (highFlowStats.length > 0) {
    lines.push(
      (highFlowAverage ?? 0) >= 1
        ? "Flow/MCapが高い候補は相対的に反応あり。"
        : "Flow/MCapが高くても継続flowがない候補は弱め。",
    );
  }

  if (lines.length === 0) {
    lines.push("注目できるパターンはまだ不足。次回以降のサンプルを蓄積。");
  }

  return bulletize(lines.slice(0, 3));
}

function saveLearningSummary(
  period: MemeRecapPeriod,
  startIso: string,
  endIso: string,
  data: LearningSummaryData,
  createdAt: string,
): void {
  insertLearningSummary.run(
    randomUUID(),
    period,
    startIso,
    endIso,
    JSON.stringify(data.signalType),
    JSON.stringify(data.mcap),
    JSON.stringify(data.age),
    JSON.stringify(data.flowMcap),
    JSON.stringify(data.clusterRisk),
    JSON.stringify(data.walletBehavior),
    data.nextScoreAdjustment,
    createdAt,
  );
}

async function buildMemeRecapReply(
  period: MemeRecapPeriod,
  interaction: ChatInputCommandInteraction | null = null,
): Promise<{ embeds: [InstanceType<typeof EmbedBuilder>] } | { content: string }> {
  const now = new Date();
  const { startIso, endIso } = getPeriodRange(period, now);
  const signals = getRecapSignals(period, now);

  if (signals.length === 0) {
    return { content: `${getRecapPeriodLabel(period)}のsignalsがまだありません。自動Alertの投稿後にもう一度確認してください。` };
  }

  const performances = await buildSignalPerformances(signals, period);
  const pickRows = getAllUserPicksBetween.all(startIso, endIso) as UserPickWithSignalRecord[];
  const pickPerformances = await buildPickPerformances(pickRows);
  const learningData = buildLearningSummaryData(performances);
  try {
    refreshAutoTuningResults();
  } catch (error) {
    const message = error instanceof Error ? error.message : "不明なエラー";

    console.warn(`Recap Auto-Tuning更新に失敗しました: ${message}`);
  }
  const summary: MemeRecapSummary = {
    botSummary: buildBotPerformanceSummary(performances),
    communitySummary: await buildCommunityPerformanceSummary(interaction, pickPerformances),
    leaderboardSummary: await buildLeaderboardTop3Summary(interaction, pickPerformances),
    nansenSignalReview: buildPatternSummaryText(learningData, performances),
    learningSummary: buildLearningSummaryText(learningData, performances),
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
    "",
    summary.learningSummary,
    createdAt,
  );
  saveLearningSummary(period, startIso, endIso, learningData, createdAt);

  return {
    embeds: [
      new EmbedBuilder()
        .setTitle(getRecapTitle(period))
        .setColor(period === "monthly" ? 0x9b59b6 : 0xf1c40f)
        .setDescription(`期間: ${formatJstResultDateTime(startIso)} - ${formatJstResultDateTime(endIso)} JST`)
        .addFields(
          { name: "📊 Bot成績", value: summary.botSummary },
          { name: "🧠 学び", value: summary.learningSummary },
          { name: "🔍 注目パターン", value: summary.nansenSignalReview },
          { name: "👥 Community", value: [summary.communitySummary, summary.leaderboardSummary].join("\n") },
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
  return bestPick.symbol ? formatDisplaySymbol(bestPick.symbol) : shortenAddress(bestPick.tokenAddress);
}

function formatMyReturnX(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return "N/A";
  }

  return `${value.toFixed(2)}x`;
}

function formatMyAverageReturnX(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return "N/A";
  }

  return `${value.toFixed(2)}x`;
}

function formatPickSymbol(symbol: string | null, tokenAddress: string): string {
  void tokenAddress;
  return formatDisplaySymbol(symbol);
}

function formatWinRate(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return "N/A";
  }

  return `${(value * 100).toFixed(1)}%`;
}

function averagePickDisplayReturn(picks: PickPerformance[]): number | null {
  return average(
    picks
      .map((pick) => calculateReturnX(pick.currentMcap, pick.entry_mcap))
      .filter((value): value is number => value !== null),
  );
}

function formatMyActionStatsValue(action: PickAction, picks: PickPerformance[]): string {
  const actionPicks = picks.filter((pick) => pick.normalizedAction === action);
  const averageReturn = averagePickDisplayReturn(actionPicks);
  const pickText = actionPicks.length === 1 ? "pick" : "picks";

  return `${actionPicks.length} ${pickText}｜平均 ${formatMyAverageReturnX(averageReturn)}`;
}

function formatMyRecentPickGroups(
  rows: Array<{ pick: PickPerformance; displayReturnX: number | null }>,
): Array<[string, string]> {
  const recentRows = rows
    .slice()
    .sort((a, b) => new Date(b.pick.clicked_at).getTime() - new Date(a.pick.clicked_at).getTime())
    .slice(0, 5);

  return (["conviction", "paper_in", "watch"] as const)
    .map((action) => {
      const items = recentRows
        .filter((row) => row.pick.normalizedAction === action)
        .map((row) =>
          `${formatPickSymbol(row.pick.symbol, row.pick.token_address)} ${formatMyReturnX(row.displayReturnX)}`,
        );

      return items.length > 0 ? ([actionPlainLabel(action), items.join("｜")] as [string, string]) : null;
    })
    .filter((line): line is [string, string] => line !== null);
}

async function getMyReply(
  interaction: ChatInputCommandInteraction,
): Promise<{ embeds: [InstanceType<typeof EmbedBuilder>] } | { content: string }> {
  const now = new Date();
  const todayJst = getJstDateString(now);

  getOrCreateUser(interaction.user.id, now.toISOString(), todayJst);

  const rows = getUserPicksWithSignals.all(interaction.user.id) as UserPickWithSignalRecord[];
  const pickPerformances = await buildPickPerformances(rows);
  const displayRows = pickPerformances.map((pick) => ({
    pick,
    displayReturnX: calculateReturnX(pick.currentMcap, pick.entry_mcap),
  }));
  const displayReturns = displayRows
    .map((row) => row.displayReturnX)
    .filter((value): value is number => value !== null);
  const displayWinRate = displayReturns.length > 0
    ? displayReturns.filter((value) => value > 1).length / displayReturns.length
    : null;
  const bestDisplayPick = displayRows
    .filter((row): row is { pick: PickPerformance; displayReturnX: number } => row.displayReturnX !== null)
    .sort((a, b) => b.displayReturnX - a.displayReturnX)[0] ?? null;
  const recentLines = formatMyRecentPickGroups(displayRows);
  const summaryLines = formatTreeRows([
    ["Picks", String(pickPerformances.length)],
    ["勝率", formatWinRate(displayWinRate)],
    ["平均", formatMyReturnX(average(displayReturns))],
    [
      "最高Pick",
      bestDisplayPick
        ? `${formatPickSymbol(bestDisplayPick.pick.symbol, bestDisplayPick.pick.token_address)} ${formatMyReturnX(bestDisplayPick.displayReturnX)}`
        : "N/A",
    ],
  ]);
  const actionStatsLines = formatTreeRows([
    ["Conviction", formatMyActionStatsValue("conviction", pickPerformances)],
    ["エアIN", formatMyActionStatsValue("paper_in", pickPerformances)],
    ["Watch", formatMyActionStatsValue("watch", pickPerformances)],
  ]);

  if (pickPerformances.length === 0) {
    return { content: "まだPaper Pickはありません。Conviction / エアIN / Watch を押すと、ここに履歴と成績がまとまります。" };
  }

  return {
    embeds: [
      new EmbedBuilder()
        .setTitle("👤 My Meme Edge")
        .setColor(0x9b59b6)
        .setDescription([
          "📊 成績サマリー",
          ...summaryLines,
          "",
          "📌 最近のPick",
          ...formatTreeRows(recentLines),
          "",
          "🧠 ボタン別成績",
          ...actionStatsLines,
        ].join("\n"))
        .setTimestamp(now),
    ],
  };
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
      content: "まだランキング対象のPickがありません。エアIN または Conviction を使ってください。",
    };
  }

  const lines: string[] = [];

  for (const [index, performance] of performances.entries()) {
    const userLabel = await resolveUserLabel(interaction, performance.userId);

    lines.push(
      `${index + 1}. ${userLabel}`,
      `Score: ${formatScore(performance.totalScore)}`,
      `ROI: ${formatReturnX(performance.roi)}`,
      `最高Pick: ${
        performance.bestPick
          ? `${getSymbolFromBestPick(performance.bestPick)} ${formatReturnX(performance.bestPick.returnX)}`
          : "N/A"
      }`,
      `Hit Rate: ${formatHitRate(performance.hitRate)}`,
      `使用ポイント: ${performance.totalUsedPoints}pt`,
      `内訳: Conviction ${performance.convictionCount}｜エアIN ${performance.paperInCount}｜Watch ${performance.watchCount}`,
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
      const symbol = pick.symbol ? formatDisplaySymbol(pick.symbol) : shortenAddress(pick.token_address);

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
          `🧪 エアIN: ${performance.paperInCount}件`,
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

function formatNullableCredits(value: number | null): string {
  return value === null ? "N/A" : String(value);
}

function buildNansenCreditTrackingMessage<T>(
  tracking: Omit<NansenCreditTrackingResult<T>, "result">,
): string {
  if (isMockNansenEnabled()) {
    return [
      "Nansen Credits:",
      "mock mode のため消費なし",
    ].join("\n");
  }

  if (
    tracking.beforeCredits === null ||
    tracking.afterCredits === null ||
    tracking.usedCredits === null
  ) {
    return [
      "Nansen Credits:",
      "取得できませんでした。ターミナルログを確認してください。",
    ].join("\n");
  }

  return [
    "Nansen Credits:",
    `実行前: ${tracking.beforeCredits}`,
    `実行後: ${tracking.afterCredits}`,
    `今回消費: ${tracking.usedCredits} credits`,
  ].join("\n");
}

function buildNansenCreditLogsMessage(limit: number): string {
  const safeLimit = Math.min(Math.max(limit, 1), 20);
  const rows = getRecentNansenCreditLogs.all(safeLimit) as NansenCreditLogRecord[];

  if (rows.length === 0) {
    return "Nansen Credits使用履歴はまだありません。";
  }

  const lines = ["直近のNansen Credits使用履歴:", ""];

  for (const [index, row] of rows.entries()) {
    const used = row.use_mock_nansen === 1
      ? "mock"
      : formatNullableCredits(row.used_credits);

    lines.push(
      `${index + 1}. ${row.command_name}`,
      `実行前: ${formatNullableCredits(row.before_credits)}`,
      `実行後: ${formatNullableCredits(row.after_credits)}`,
      `消費: ${used}`,
      `時刻: ${formatJstResultDateTime(row.created_at)}`,
      "",
    );
  }

  return lines.join("\n").trim();
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
        const symbol = pick.symbol ? formatDisplaySymbol(pick.symbol) : shortenAddress(pick.token_address);
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
              ? `${bestPick.symbol ? formatDisplaySymbol(bestPick.symbol) : shortenAddress(bestPick.token_address)} ${formatReturnX(bestPick.returnX)}`
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

function parseMemeCaCustomId(customId: string): { signalId: string } | null {
  const parts = customId.split(":");

  if (parts.length !== 2 || parts[0] !== "meme_ca" || !parts[1]) {
    return null;
  }

  return { signalId: parts[1] };
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
  const symbol = signal.symbol ? formatDisplaySymbol(signal.symbol) : shortenAddress(signal.token_address);
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
    lines.push("あとで /my と /leaderboard から成績を確認できます。");
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
      content: "このシグナルがDBに見つかりませんでした。次の自動Alertを待ってもう一度試してください。",
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
  const signalTimeMs = signal.scan_time ? new Date(signal.scan_time).getTime() : NaN;
  const timeSinceSignalMinutes = Number.isFinite(signalTimeMs)
    ? Math.max(0, Math.round((now.getTime() - signalTimeMs) / 60_000))
    : null;
  const signalSource = signal.scan_id?.startsWith("alert") ? "alert" : signal.signal_type === "alert_edge" ? "alert" : "fresh_scan";
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
        parsed.action,
        timeSinceSignalMinutes,
        nextEntryMcap,
        nextEntryPrice,
        signalSource,
        signal.signal_type ?? null,
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
        parsed.action,
        timeSinceSignalMinutes,
        nextEntryMcap,
        nextEntryPrice,
        signalSource,
        signal.signal_type ?? null,
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
      { marketCap: nextEntryMcap, price: nextEntryPrice, liquidity: null, volume24h: null, pairUrl: null },
      usedPoints,
      5 - nextDailyPointsUsed,
      includeGuide,
    ),
    ephemeral: true,
  });
}

async function handleMemeCaButton(interaction: Interaction): Promise<void> {
  if (!interaction.isButton()) {
    return;
  }

  const parsed = parseMemeCaCustomId(interaction.customId);

  if (!parsed) {
    return;
  }

  const signal = getSignalById.get(parsed.signalId) as SignalRecord | undefined;

  if (!signal) {
    await interaction.reply({
      content: "このシグナルがDBに見つかりませんでした。次の自動Alertを待ってもう一度試してください。",
      ephemeral: true,
    });
    return;
  }

  await interaction.reply({
    content: `CA: \`${signal.token_address}\``,
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
          await withNansenCreditTracking(
            "auto-scan:morning",
            () => runMemeScan(channel, "Morning Scan"),
          );
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
          await withNansenCreditTracking(
            "auto-scan:eu-open",
            () => runMemeScan(channel, "EU Open Scan"),
          );
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
          await withNansenCreditTracking(
            "auto-scan:us-prime",
            () => runMemeScan(channel, "US Prime Scan"),
          );
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

  if (parts.minute % scoringConfig.alertRules.intervalMinutes === 0) {
    const alertRunKey = `${parts.date}T${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}:alert-check`;

    if (!scheduledJobRunKeys.has(alertRunKey)) {
      scheduledJobRunKeys.add(alertRunKey);

      try {
        const channel = await getScheduledMemeEdgeChannel();

        if (channel) {
          const alertResult = await runMemeAlertCheck(channel);

          if (alertResult.posted.length > 0) {
            console.log(`Posted scheduled Meme Edge Alert: ${alertResult.posted.length}`);
          }
        }
      } catch (error) {
        console.error("Meme Edge Alert Checkに失敗しました", error);
      }
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
  if (interaction.isButton() && interaction.customId.startsWith("meme_ca:")) {
    try {
      await handleMemeCaButton(interaction);
    } catch (error) {
      console.error(error);

      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: "CAの表示に失敗しました。少し後でもう一度試してください。",
          ephemeral: true,
        });
      }
    }

    return;
  }

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

  if (interaction.commandName === "my") {
    await interaction.deferReply({ ephemeral: true });

    try {
      const reply = await getMyReply(interaction);

      await interaction.editReply(reply);
    } catch (error) {
      console.error(error);
      const message = error instanceof Error ? error.message : "不明なエラー";

      await interaction.editReply(`/my に失敗しました: ${message}`);
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

  await interaction.reply({
    content: "このコマンドは提出版では公開していません。AlertとPDCAは裏側で自動実行されます。",
    ephemeral: true,
  });
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
