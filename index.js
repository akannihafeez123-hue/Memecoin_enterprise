"use strict";

// ╔══════════════════════════════════════════════════════════════════════════╗
// ║   MEMECOIN EMPIRE — GEM HUNTER v8.1 (WORLDWIDE FIRST)                 ║
// ║                                                                          ║
// ║  v8 Core (5 real fixes): no random, wallet cluster, Hurst fractal,    ║
// ║  true learning loop, capital protection gate                           ║
// ║                                                                          ║
// ║  v8.1 Pre-Momentum Layer (5 engines): detectPrePumpSignature,         ║
// ║  detectStealthAccumulation, calcLiquidityVacuumScore,                  ║
// ║  scienceConsensusGate, calcPreMomentumScore                            ║
// ║                                                                          ║
// ║  GEM HUNTER (v8.2): AutoScanner broadcast system — subscribe via      ║
// ║  /autoscanner apex or /autoscanner early and receive real-time alerts  ║
// ║  the moment a hidden gem is detected, BEFORE the crowd moves.          ║
// ║  Rarity tiers: LEGENDARY / EPIC / RARE / UNCOMMON                      ║
// ║  Moon potential: estimated 2x–50x range based on LP vacuum + momentum  ║
// ║                                                                          ║
// ║  + 12 Region__ Science Engines (RQA, Thermo, LZ76, Kuramoto, VCR...) ║
// ║  Data: DexScreener (free) + Birdeye (opt) + Helius (opt)              ║
// ║  Run: node Meme_hunter_v8.js                                            ║
// ╚══════════════════════════════════════════════════════════════════════════╝

process.on("uncaughtException",  (e) => console.error("[CRASH] uncaughtException:",  e));
process.on("unhandledRejection", (e) => console.error("[CRASH] unhandledRejection:", e));

require("dns").setDefaultResultOrder("ipv4first");
setInterval(() => {}, 1 << 30);
require("dotenv").config();

const { Connection, PublicKey } = require("@solana/web3.js");
const axios   = require("axios");
const express = require("express");
const { Pool }    = require("pg");
const { Telegraf } = require("telegraf");

// ════════════════════════════════════════════════════════════════════════════
// SECTION 1 — CONFIG
// ════════════════════════════════════════════════════════════════════════════

const DEBUG = process.env.DEBUG === "true";
const dbg   = (...a) => { if (DEBUG) console.log("[DBG]", ...a); };

function required(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}
function optional(name, fallback) { return process.env[name] ?? fallback; }

const config = {
  databaseUrl:          required("DATABASE_URL"),
  telegramBotToken:     required("TELEGRAM_BOT_TOKEN"),
  adminChatId:          required("ADMIN_CHAT_ID"),
  seedMints: optional("SEED_MINTS", "").split(",").map(m => m.trim()).filter(Boolean),
  rpcUrl:               optional("RPC_URL", "https://api.mainnet-beta.solana.com"),
  scanIntervalMinutes:  parseInt(optional("SCAN_INTERVAL_MINUTES", "10"), 10),
  signalCertMin:        parseInt(optional("SIGNAL_CERT_MIN", "75"), 10),
  port:                 parseInt(optional("PORT", "3000"), 10),
  // Quality gate
  qualityCertMin:       parseFloat(optional("QUALITY_CERT_MIN", "75")),
  qualityAvgMin:        parseFloat(optional("QUALITY_AVG_MIN",  "50")),
  qualityConvMin:       parseFloat(optional("QUALITY_CONV_MIN", "40")),
  qualityPillarMin:     parseInt(optional("QUALITY_PILLAR_MIN", "3"), 10),
  // Decision Engine V2
  hiddenContraMin:      parseFloat(optional("HIDDEN_CONTRA_MIN", "85")),
  boostMax:             parseFloat(optional("BOOST_MAX", "20")),
  penaltyMax:           parseFloat(optional("PENALTY_MAX", "15")),
  contraCap:            parseFloat(optional("CONTRA_CAP", "85")),
  // Capital protection
  distributionSkipMin:  parseFloat(optional("DISTRIBUTION_SKIP_MIN", "60")),
  reversalSkipMin:      parseFloat(optional("REVERSAL_SKIP_MIN", "0.7")),
  // Emergency kill switch
  emergencyHalt:        process.env.EMERGENCY_HALT === "1",
  // DEX Auto-Discovery
  minLiquidityUsd:      parseFloat(optional("MIN_LIQUIDITY_USD",    "500000")),
  minVolume24hUsd:      parseFloat(optional("MIN_VOLUME_24H_USD",   "200000")),
  maxMarketCapUsd:      parseFloat(optional("MAX_MARKET_CAP_USD",   "50000000")),
  minMarketCapUsd:      parseFloat(optional("MIN_MARKET_CAP_USD",   "100000")),
  maxTokensPerCycle:    parseInt(optional("MAX_TOKENS_PER_CYCLE",   "80"), 10),
  minTokenAgeHours:     parseFloat(optional("MIN_TOKEN_AGE_HOURS",  "1")),
  maxTokenAgeHours:     parseFloat(optional("MAX_TOKEN_AGE_HOURS",  "72")),
  minPriceChange1h:     parseFloat(optional("MIN_PRICE_CHANGE_1H",  "2")),
  maxPriceChange24h:    parseFloat(optional("MAX_PRICE_CHANGE_24H", "400")),
  // Optional API keys
  birdeyeKey:           optional("BIRDEYE_API_KEY", ""),
  heliusKey:            optional("HELIUS_API_KEY", ""),
  // Learning loop windows (minutes)
  predictionWindow1h:   parseInt(optional("PREDICTION_WINDOW_1H", "60"), 10),
  predictionWindow4h:   parseInt(optional("PREDICTION_WINDOW_4H", "240"), 10),
  // Sniper bot detection threshold
  sniperTxThreshold:    parseInt(optional("SNIPER_TX_THRESHOLD", "3"), 10),
  // Pre-Momentum Intelligence (execute before crowd notices)
  preMomentumScoreMin:  parseFloat(optional("PRE_MOMENTUM_SCORE_MIN", "58")),
  scienceConsensusMin:  parseInt(optional("SCIENCE_CONSENSUS_MIN", "3"), 10),
  apexEntryMin:         parseFloat(optional("APEX_ENTRY_MIN", "85")),
  strongEntryMin:       parseFloat(optional("STRONG_ENTRY_MIN", "72")),
  earlyEntryMin:        parseFloat(optional("EARLY_ENTRY_MIN", "58")),
};

// ════════════════════════════════════════════════════════════════════════════
// SECTION 2 — CORE UTILITIES
// ════════════════════════════════════════════════════════════════════════════

const clamp   = (v, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));
const safeNum = (v, fb = 0) => Number.isFinite(Number(v)) ? Number(v) : fb;
const pct     = (part, total) => total > 0 ? (part / total) * 100 : 0;

const ema = (prices, period) => {
  if (!prices || prices.length === 0) return 0;
  const k = 2 / (period + 1);
  let e = prices[0];
  for (let i = 1; i < prices.length; i++) e = prices[i] * k + e * (1 - k);
  return e;
};
const sma = (prices, period) => {
  const s = prices.slice(-period);
  return s.reduce((a, b) => a + b, 0) / (s.length || 1);
};
const stddev = (arr) => {
  if (!arr.length) return 0;
  const m = arr.reduce((a, b) => a + b, 0) / arr.length;
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length);
};

// Statistical confidence — derived purely from signal strength, no randomness
function calcStatConfidence(signals) {
  // signals: array of 0..1 values
  if (!signals.length) return 0.5;
  const mean = signals.reduce((a, b) => a + b, 0) / signals.length;
  const sd   = stddev(signals);
  // Penalise high variance (conflicting signals), reward high mean
  const coherence = Math.max(0, 1 - sd);
  return clamp(mean * coherence * 100);
}

function normalizeConfidence(raw) {
  if (raw == null || isNaN(Number(raw))) return 0;
  const n = Number(raw);
  const p = n <= 1 ? n * 100 : n;
  return Math.round(clamp(p));
}

// ════════════════════════════════════════════════════════════════════════════
// SECTION 3 — ENGINE STATE
// ════════════════════════════════════════════════════════════════════════════

const _state = {
  emergencyHalt: config.emergencyHalt,
  lastSignal:    null,
  cycleTelemetry: { cycles: 0, signals: 0, alerts: 0, skipped: 0, boosted: 0, skippedCapital: 0, gems: 0 },
};

// GEM HUNTER: in-memory autoscanner subscriber registry
// Map<chatId, { mode: "apex"|"early", username: string, since: Date, streak: number, lastGemAt: Date|null }>
const _autoScanSubs = new Map();

const signalBucket      = [];
const SIGNAL_BUCKET_MAX = parseInt(optional("SIGNAL_BUCKET_MAX", "500"), 10);

function captureSignal(signal) {
  if (!signal || !signal.direction || signal.direction === "NEUTRAL") return;
  if (_state.emergencyHalt) { console.log("[HALT] signal refused:", signal.symbol); return; }
  if (signalBucket.length >= SIGNAL_BUCKET_MAX) { _state.cycleTelemetry.skipped++; return; }
  signal.confidence = normalizeConfidence(signal.confidence);
  signalBucket.push(signal);
}

// ════════════════════════════════════════════════════════════════════════════
// SECTION 4 — DATABASE
// ════════════════════════════════════════════════════════════════════════════

const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
});

async function initDb() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query(`
      CREATE TABLE IF NOT EXISTS tokens (
        mint         TEXT PRIMARY KEY,
        name         TEXT,
        symbol       TEXT,
        decimals     INT,
        supply       NUMERIC,
        first_seen   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS price_history (
        id          SERIAL PRIMARY KEY,
        mint        TEXT NOT NULL REFERENCES tokens(mint),
        price_usd   NUMERIC,
        volume_usd  NUMERIC,
        market_cap  NUMERIC,
        tx_count    INT,
        holder_est  INT,
        recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS ph_mint_idx ON price_history(mint, recorded_at DESC)`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS signals (
        id                   SERIAL PRIMARY KEY,
        mint                 TEXT NOT NULL REFERENCES tokens(mint),
        whale_score          NUMERIC NOT NULL DEFAULT 0,
        smart_money          NUMERIC NOT NULL DEFAULT 0,
        volume_anomaly       NUMERIC NOT NULL DEFAULT 0,
        holder_velocity      NUMERIC NOT NULL DEFAULT 0,
        liquidity            NUMERIC NOT NULL DEFAULT 0,
        momentum_score       NUMERIC NOT NULL DEFAULT 0,
        wyckoff_score        NUMERIC NOT NULL DEFAULT 0,
        hidden_flow          NUMERIC NOT NULL DEFAULT 0,
        mtf_score            NUMERIC NOT NULL DEFAULT 0,
        pump_probability     NUMERIC NOT NULL DEFAULT 0,
        fractal_score        NUMERIC NOT NULL DEFAULT 0,
        wallet_cluster_score NUMERIC NOT NULL DEFAULT 0,
        institutional_score  NUMERIC NOT NULL DEFAULT 0,
        capital_gate         TEXT    NOT NULL DEFAULT 'PASS',
        composite            NUMERIC NOT NULL,
        certainty            NUMERIC NOT NULL DEFAULT 0,
        grade                TEXT    NOT NULL,
        recommendation       TEXT    NOT NULL,
        direction            TEXT    NOT NULL DEFAULT 'NEUTRAL',
        decision_status      TEXT,
        decision_boost       NUMERIC DEFAULT 0,
        decision_penalty     NUMERIC DEFAULT 0,
        quality_pass         BOOLEAN NOT NULL DEFAULT FALSE,
        quality_reason       TEXT,
        raw_data             JSONB,
        created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS signals_mint_idx      ON signals(mint)`);
    await client.query(`CREATE INDEX IF NOT EXISTS signals_composite_idx ON signals(composite DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS signals_created_idx   ON signals(created_at DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS signals_quality_idx   ON signals(quality_pass, created_at DESC)`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS alerts (
        id         SERIAL PRIMARY KEY,
        signal_id  INT  NOT NULL REFERENCES signals(id),
        mint       TEXT NOT NULL,
        grade      TEXT NOT NULL,
        sent       BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS published_tokens (
        mint         TEXT PRIMARY KEY REFERENCES tokens(mint),
        published_by TEXT NOT NULL,
        published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        note         TEXT
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS watchlist (
        mint      TEXT PRIMARY KEY,
        added_by  TEXT NOT NULL,
        added_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        priority  INT NOT NULL DEFAULT 5
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS prediction_ledger (
        id                SERIAL PRIMARY KEY,
        signal_id         INT  NOT NULL REFERENCES signals(id),
        mint              TEXT NOT NULL,
        predicted_dir     TEXT NOT NULL,
        composite_at_pred NUMERIC NOT NULL,
        price_at_pred     NUMERIC,
        price_at_1h       NUMERIC,
        price_at_4h       NUMERIC,
        outcome_1h        TEXT,
        outcome_4h        TEXT,
        pct_change_1h     NUMERIC,
        pct_change_4h     NUMERIC,
        accuracy_1h       BOOLEAN,
        accuracy_4h       BOOLEAN,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        resolved_1h_at    TIMESTAMPTZ,
        resolved_4h_at    TIMESTAMPTZ
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS pl_mint_idx    ON prediction_ledger(mint)`);
    await client.query(`CREATE INDEX IF NOT EXISTS pl_pending_idx ON prediction_ledger(outcome_1h) WHERE outcome_1h = 'PENDING'`);
    await client.query(`CREATE INDEX IF NOT EXISTS pl_created_idx ON prediction_ledger(created_at DESC)`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS autoscanner_subs (
        chat_id     TEXT PRIMARY KEY,
        mode        TEXT NOT NULL DEFAULT 'early',
        username    TEXT,
        streak      INT  NOT NULL DEFAULT 0,
        last_gem_at TIMESTAMPTZ,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

// ── AutoScanner DB helpers ────────────────────────────────────────────────
async function saveAutoScannerSub(chatId, mode, username) {
  await pool.query(
    `INSERT INTO autoscanner_subs (chat_id, mode, username)
     VALUES ($1, $2, $3)
     ON CONFLICT (chat_id) DO UPDATE SET mode=EXCLUDED.mode, username=EXCLUDED.username`,
    [String(chatId), mode, username ?? null]
  );
}

async function removeAutoScannerSub(chatId) {
  await pool.query(`DELETE FROM autoscanner_subs WHERE chat_id=$1`, [String(chatId)]);
}

async function loadAutoScannerSubs() {
  const r = await pool.query(`SELECT chat_id, mode, username, streak, last_gem_at FROM autoscanner_subs`);
  _autoScanSubs.clear();
  for (const row of r.rows) {
    _autoScanSubs.set(row.chat_id, {
      mode:      row.mode,
      username:  row.username,
      since:     row.created_at ?? new Date(),
      streak:    row.streak     ?? 0,
      lastGemAt: row.last_gem_at ?? null,
    });
  }
  console.log(`[autoscanner] Loaded ${_autoScanSubs.size} subscriber(s) from DB.`);
}

async function updateSubStreak(chatId, streak) {
  await pool.query(
    `UPDATE autoscanner_subs SET streak=$2, last_gem_at=NOW() WHERE chat_id=$1`,
    [String(chatId), streak]
  ).catch(() => {});
}
// ─────────────────────────────────────────────────────────────────────────────

async function upsertToken(t) {
  await pool.query(
    `INSERT INTO tokens (mint, name, symbol, decimals, supply)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (mint) DO UPDATE
       SET name=EXCLUDED.name, symbol=EXCLUDED.symbol,
           decimals=EXCLUDED.decimals, supply=EXCLUDED.supply, updated_at=NOW()`,
    [t.mint, t.name, t.symbol, t.decimals, t.supply]
  );
}

async function recordPriceHistory(mint, data) {
  await pool.query(
    `INSERT INTO price_history (mint, price_usd, volume_usd, market_cap, tx_count, holder_est)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [mint, data.priceUsd ?? null, data.volumeUsd ?? null, data.marketCap ?? null,
     data.txCount ?? null, data.holderCount ?? null]
  );
}

async function getPriceHistory(mint, limit = 48) {
  const r = await pool.query(
    `SELECT price_usd, volume_usd, tx_count, holder_est, recorded_at
     FROM price_history WHERE mint=$1 ORDER BY recorded_at DESC LIMIT $2`,
    [mint, limit]
  );
  return r.rows.reverse();
}

async function insertSignal(s) {
  const r = await pool.query(
    `INSERT INTO signals (mint,whale_score,smart_money,volume_anomaly,holder_velocity,liquidity,
       momentum_score,wyckoff_score,hidden_flow,mtf_score,pump_probability,
       fractal_score,wallet_cluster_score,institutional_score,capital_gate,
       composite,certainty,grade,recommendation,direction,
       decision_status,decision_boost,decision_penalty,quality_pass,quality_reason,raw_data)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)
     RETURNING id`,
    [s.mint, s.whaleScore, s.smartMoney, s.volumeAnomaly, s.holderVelocity, s.liquidity,
     s.momentumScore, s.wyckoffScore, s.hiddenFlow, s.mtfScore, s.pumpProbability,
     s.fractalScore ?? 0, s.walletClusterScore ?? 0, s.institutionalScore ?? 0,
     s.capitalGate ?? "PASS",
     s.composite, s.certainty, s.grade, s.recommendation, s.direction,
     s.decisionStatus ?? null, s.decisionBoost ?? 0, s.decisionPenalty ?? 0,
     s.qualityPass ?? false, s.qualityReason ?? null,
     JSON.stringify(s.rawData ?? {})]
  );
  return r.rows[0].id;
}

async function insertPrediction(signalId, mint, direction, composite, priceAtPred) {
  await pool.query(
    `INSERT INTO prediction_ledger (signal_id, mint, predicted_dir, composite_at_pred, price_at_pred, outcome_1h, outcome_4h)
     VALUES ($1,$2,$3,$4,$5,'PENDING','PENDING')`,
    [signalId, mint, direction, composite, priceAtPred]
  );
}

async function resolvePendingPredictions() {
  const now = new Date();
  const r1 = await pool.query(
    `SELECT pl.id, pl.mint, pl.predicted_dir, pl.price_at_pred, pl.created_at
     FROM prediction_ledger pl
     WHERE pl.outcome_1h = 'PENDING'
       AND pl.created_at < NOW() - ($1 * interval '1 minute')`,
    [config.predictionWindow1h]
  );
  for (const row of r1.rows) {
    try {
      const dex = await fetchDexPairData(row.mint);
      const currentPrice = dex?.priceUsd ?? 0;
      if (currentPrice <= 0 || !row.price_at_pred || row.price_at_pred <= 0) continue;
      const pctChange = ((currentPrice - row.price_at_pred) / row.price_at_pred) * 100;
      const win = row.predicted_dir === "BUY" ? pctChange > 2 : pctChange < -2;
      const outcome = Math.abs(pctChange) < 2 ? "NEUTRAL" : win ? "WIN" : "LOSS";
      await pool.query(
        `UPDATE prediction_ledger SET price_at_1h=$1, pct_change_1h=$2, outcome_1h=$3, accuracy_1h=$4, resolved_1h_at=NOW()
         WHERE id=$5`,
        [currentPrice, pctChange, outcome, win, row.id]
      );
    } catch (e) { dbg("[ledger] 1h resolve error:", e.message); }
  }

  const r4 = await pool.query(
    `SELECT pl.id, pl.mint, pl.predicted_dir, pl.price_at_pred, pl.created_at
     FROM prediction_ledger pl
     WHERE pl.outcome_4h = 'PENDING'
       AND pl.created_at < NOW() - ($1 * interval '1 minute')`,
    [config.predictionWindow4h]
  );
  for (const row of r4.rows) {
    try {
      const dex = await fetchDexPairData(row.mint);
      const currentPrice = dex?.priceUsd ?? 0;
      if (currentPrice <= 0 || !row.price_at_pred || row.price_at_pred <= 0) continue;
      const pctChange = ((currentPrice - row.price_at_pred) / row.price_at_pred) * 100;
      const win = row.predicted_dir === "BUY" ? pctChange > 5 : pctChange < -5;
      const outcome = Math.abs(pctChange) < 2 ? "NEUTRAL" : win ? "WIN" : "LOSS";
      await pool.query(
        `UPDATE prediction_ledger SET price_at_4h=$1, pct_change_4h=$2, outcome_4h=$3, accuracy_4h=$4, resolved_4h_at=NOW()
         WHERE id=$5`,
        [currentPrice, pctChange, outcome, win, row.id]
      );
    } catch (e) { dbg("[ledger] 4h resolve error:", e.message); }
  }
}

async function getPredictionAccuracy() {
  const r = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE outcome_1h != 'PENDING' AND outcome_1h != 'NEUTRAL') AS total_1h,
       COUNT(*) FILTER (WHERE accuracy_1h = TRUE) AS wins_1h,
       COUNT(*) FILTER (WHERE outcome_4h != 'PENDING' AND outcome_4h != 'NEUTRAL') AS total_4h,
       COUNT(*) FILTER (WHERE accuracy_4h = TRUE) AS wins_4h
     FROM prediction_ledger
     WHERE created_at > NOW() - INTERVAL '7 days'`
  );
  const row = r.rows[0];
  return {
    accuracy1h: row.total_1h > 0 ? Math.round((row.wins_1h / row.total_1h) * 100) : null,
    accuracy4h: row.total_4h > 0 ? Math.round((row.wins_4h / row.total_4h) * 100) : null,
    total1h: parseInt(row.total_1h, 10),
    total4h: parseInt(row.total_4h, 10),
    wins1h:  parseInt(row.wins_1h, 10),
    wins4h:  parseInt(row.wins_4h, 10),
  };
}

// Confidence boost/penalty derived from actual historical accuracy
async function getLearningConfidenceMultiplier() {
  const acc = await getPredictionAccuracy();
  if (acc.total1h < 10) return 1.0; // not enough data yet — no adjustment
  const accuracy = (acc.accuracy1h ?? 50) / 100;
  // > 60% accurate: small boost, < 40%: penalty to discourage over-confidence
  if (accuracy > 0.6) return Math.min(1.2, 1 + (accuracy - 0.6) * 0.5);
  if (accuracy < 0.4) return Math.max(0.8, 1 - (0.4 - accuracy) * 0.5);
  return 1.0;
}

async function getRecentSignals(limit = 20, qualityOnly = false) {
  const where = qualityOnly ? "WHERE s.quality_pass = TRUE" : "";
  const r = await pool.query(
    `SELECT s.*, t.name, t.symbol FROM signals s JOIN tokens t ON t.mint=s.mint
     ${where} ORDER BY s.created_at DESC LIMIT $1`, [limit]
  );
  return r.rows;
}

async function getTopSignals(limit = 10) {
  const r = await pool.query(
    `SELECT s.*, t.name, t.symbol FROM signals s JOIN tokens t ON t.mint=s.mint
     WHERE s.created_at > NOW() - INTERVAL '24 hours'
     ORDER BY s.composite DESC LIMIT $1`, [limit]
  );
  return r.rows;
}

async function getPendingAlerts() {
  const r = await pool.query(
    `SELECT a.*, t.name, t.symbol FROM alerts a JOIN tokens t ON t.mint=a.mint
     WHERE a.sent=FALSE ORDER BY a.created_at DESC`
  );
  return r.rows;
}

async function markAlertSent(id) {
  await pool.query(`UPDATE alerts SET sent=TRUE WHERE id=$1`, [id]);
}

async function insertAlert(signalId, mint, grade) {
  await pool.query(`INSERT INTO alerts (signal_id,mint,grade) VALUES ($1,$2,$3)`, [signalId, mint, grade]);
}

async function publishToken(mint, by, note) {
  await pool.query(
    `INSERT INTO published_tokens (mint,published_by,note) VALUES ($1,$2,$3) ON CONFLICT(mint) DO NOTHING`,
    [mint, by, note ?? null]
  );
}

async function getPublishedTokens() {
  const r = await pool.query(
    `SELECT pt.*, t.name, t.symbol FROM published_tokens pt JOIN tokens t ON t.mint=pt.mint ORDER BY pt.published_at DESC`
  );
  return r.rows;
}

async function addToWatchlist(mint, by, priority = 5) {
  await pool.query(
    `INSERT INTO watchlist (mint, added_by, priority) VALUES ($1,$2,$3)
     ON CONFLICT (mint) DO UPDATE SET priority=EXCLUDED.priority, added_by=EXCLUDED.added_by`,
    [mint, by, priority]
  );
}

async function removeFromWatchlist(mint) {
  await pool.query(`DELETE FROM watchlist WHERE mint=$1`, [mint]);
}

async function getWatchlist() {
  const r = await pool.query(
    `SELECT w.*, t.name, t.symbol FROM watchlist w
     LEFT JOIN tokens t ON t.mint=w.mint ORDER BY w.priority DESC, w.added_at DESC`
  );
  return r.rows;
}

// ════════════════════════════════════════════════════════════════════════════
// SECTION 5 — SOLANA ON-CHAIN DATA
// ════════════════════════════════════════════════════════════════════════════

const connection = new Connection(config.rpcUrl, "confirmed");

async function fetchTokenMeta(mint) {
  try {
    const r = await axios.post(config.rpcUrl,
      { jsonrpc:"2.0", id:1, method:"getAsset", params:{ id:mint } }, { timeout:5000 });
    const res = r.data?.result;
    return {
      name:   res?.content?.metadata?.name   ?? `Token-${mint.slice(0,6)}`,
      symbol: res?.content?.metadata?.symbol ?? mint.slice(0,4).toUpperCase(),
    };
  } catch (_) {
    return { name:`Token-${mint.slice(0,6)}`, symbol:mint.slice(0,4).toUpperCase() };
  }
}

async function fetchTokenOnChainData(mint, dexHint = null) {
  let supply = 0, decimals = 0;
  try {
    const info = await connection.getParsedAccountInfo(new PublicKey(mint));
    if (info.value?.data?.parsed) {
      supply   = parseInt(info.value.data.parsed.info.supply, 10);
      decimals = info.value.data.parsed.info.decimals;
    }
  } catch (_) {}

  let recentTxCount = 0;
  let sigTimestamps = [];
  try {
    const sigs = await connection.getSignaturesForAddress(new PublicKey(mint), { limit: 100 });
    recentTxCount = sigs.length;
    sigTimestamps = sigs.map(s => s.blockTime ?? 0).filter(Boolean);
  } catch (_) {}

  const now        = Math.floor(Date.now() / 1000);
  const txLast10m  = sigTimestamps.filter(t => t > now - 600).length;
  const txLast60m  = sigTimestamps.filter(t => t > now - 3600).length;
  const txVelocity = txLast60m > 0 ? txLast10m / txLast60m : 0;

  let dex = dexHint;
  if (!dex) dex = await fetchDexPairData(mint);

  const holderData = await fetchHolderData(mint);

  const priceUsd  = dex?.priceUsd  ?? 0;
  const marketCap = dex?.marketCap ?? (priceUsd > 0 && supply > 0 ? priceUsd * supply : 0);
  const volumeUsd = dex?.volumeUsd ?? 0;
  const lpDepth   = dex?.lpDepth   ?? 0;
  const lpGrowthRate = dex?.lpGrowthRate ?? 0.05;

  const volumeSpike = dex?.volumeSpike != null
    ? dex.volumeSpike
    : recentTxCount > 50 ? 2.0 : 1.0;

  const holderCount = holderData.holderCount > 0
    ? holderData.holderCount
    : Math.max(10, Math.floor(recentTxCount * 2.8));

  const largeWalletRatio = holderData.largeWalletRatio > 0
    ? holderData.largeWalletRatio
    : 0.3;

  // holderGrowthRate derived from DEX tx-buy acceleration — no randomness
  const holderGrowthRate = dex?.holderGrowthProxy
    ?? (holderCount > 100 ? 0.08 : 0.04);

  return {
    mint, supply, decimals,
    holderCount, recentTxCount, txVelocity,
    txLast10m, txLast60m,
    lpDepth, lpGrowthRate,
    largeWalletRatio,
    volumeSpike, holderGrowthRate,
    priceUsd, marketCap, volumeUsd,
    creatorPct: holderData.creatorPct ?? 0,
    dexSource: dex ? (dexHint ? "cache" : "fresh") : "none",
    holderSource: holderData.source ?? "estimated",
    dexRaw: dex,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// SECTION 5A — DEX DATA (DexScreener + Birdeye)
// ════════════════════════════════════════════════════════════════════════════

const _dexCache = new Map();

async function fetchDexPairData(mint) {
  try {
    const res = await axios.get(
      `https://api.dexscreener.com/latest/dex/tokens/${mint}`,
      { timeout: 6000 }
    );
    const pairs = (res.data?.pairs ?? []).filter(p => p.chainId === "solana");
    if (!pairs.length) return null;

    const best = pairs.sort(
      (a, b) => parseFloat(b.liquidity?.usd ?? 0) - parseFloat(a.liquidity?.usd ?? 0)
    )[0];

    const vol1h  = parseFloat(best.volume?.h1  ?? 0);
    const vol6h  = parseFloat(best.volume?.h6  ?? 0);
    const vol24h = parseFloat(best.volume?.h24 ?? 0);

    const avgHourlyVol = vol24h / 24;
    const volumeSpike  = avgHourlyVol > 0 ? vol1h / avgHourlyVol : 1;

    const lpGrowthRate = vol24h > 0
      ? clamp((((vol6h * 4) / vol24h) - 1), -1, 2)
      : 0;

    const txBuys1h   = best.txns?.h1?.buys   ?? 0;
    const txSells1h  = best.txns?.h1?.sells  ?? 0;
    const txBuys24h  = best.txns?.h24?.buys  ?? 0;
    const txSells24h = best.txns?.h24?.sells ?? 0;
    const txns1h     = txBuys1h + txSells1h;
    const txns24h    = txBuys24h + txSells24h;
    const avgHourlyTxns    = txns24h / 24;
    const holderGrowthProxy = avgHourlyTxns > 0
      ? clamp(txBuys1h / avgHourlyTxns / 8, 0, 1)
      : 0.1;

    const priceChange1h  = parseFloat(best.priceChange?.h1  ?? 0);
    const priceChange6h  = parseFloat(best.priceChange?.h6  ?? 0);
    const priceChange24h = parseFloat(best.priceChange?.h24 ?? 0);

    // First liquidity add detection: pairCreatedAt freshness
    const pairCreatedAt = best.pairCreatedAt ?? null;
    const ageHours = pairCreatedAt ? (Date.now() - pairCreatedAt) / 3_600_000 : null;
    const isFirstLiquidityWindow = ageHours !== null && ageHours < 2; // under 2h old

    return {
      priceUsd:          parseFloat(best.priceUsd ?? 0),
      marketCap:         parseFloat(best.fdv ?? best.marketCap ?? 0),
      volumeUsd:         vol24h,
      lpDepth:           parseFloat(best.liquidity?.usd ?? 0),
      vol1h, vol6h, vol24h,
      volumeSpike:       Math.max(0, volumeSpike),
      lpGrowthRate:      Math.max(0, lpGrowthRate),
      holderGrowthProxy: Math.max(0, holderGrowthProxy),
      txns1h, txns24h, txBuys1h, txSells1h, txBuys24h, txSells24h,
      priceChange1h, priceChange6h, priceChange24h,
      dexId:             best.dexId,
      pairAddress:       best.pairAddress,
      isFirstLiquidityWindow,
      ageHours,
    };
  } catch (e) {
    dbg("[dex] fetchDexPairData failed:", mint, e.message);
    return null;
  }
}

async function fetchHolderData(mint) {
  if (!config.birdeyeKey) {
    return { holderCount: 0, largeWalletRatio: 0.3, creatorPct: 0, source: "estimated" };
  }
  try {
    const res = await axios.get(
      `https://public-api.birdeye.so/defi/token_security?address=${mint}`,
      { headers: { "X-API-KEY": config.birdeyeKey }, timeout: 5000 }
    );
    const d = res.data?.data;
    if (!d) return { holderCount: 0, largeWalletRatio: 0.3, creatorPct: 0, source: "birdeye_empty" };

    const top10Pct    = parseFloat(d.top10HolderPercent ?? d.ownerPercent ?? 30);
    const holderCount = parseInt(d.uniqueWalletH24 ?? d.holderCount ?? 0, 10);
    const creatorPct  = parseFloat(d.creatorPercentage ?? 0);

    return {
      holderCount,
      largeWalletRatio: clamp(top10Pct / 100, 0, 0.99),
      creatorPct,
      source: "birdeye",
    };
  } catch (e) {
    dbg("[birdeye] fetchHolderData failed:", mint, e.message);
    return { holderCount: 0, largeWalletRatio: 0.3, creatorPct: 0, source: "error" };
  }
}

// ════════════════════════════════════════════════════════════════════════════
// SECTION 5B — HELIUS TX ENRICHMENT (v8: wallet clustering + sniper detect)
// ════════════════════════════════════════════════════════════════════════════

async function fetchHeliusTxData(mint) {
  if (!config.heliusKey) {
    return { recentTxs: [], sniperCount: 0, uniqueBuyers: 0, uniqueSellers: 0, devWalletActive: false };
  }
  try {
    const res = await axios.get(
      `https://api.helius.xyz/v0/addresses/${mint}/transactions?apiKey=${config.heliusKey}&limit=100`,
      { timeout: 6000 }
    );
    const txs = res.data ?? [];

    // Identify unique wallets and their tx frequency
    const walletMap = new Map(); // wallet → { buys, sells, firstSeen }
    for (const tx of txs) {
      const feePayer = tx.feePayer;
      if (!feePayer) continue;
      const isBuy  = tx.type === "SWAP" && tx.tokenTransfers?.some(t => t.toUserAccount === feePayer);
      const isSell = tx.type === "SWAP" && tx.tokenTransfers?.some(t => t.fromUserAccount === feePayer);
      if (!walletMap.has(feePayer)) walletMap.set(feePayer, { buys: 0, sells: 0, firstSeen: tx.timestamp });
      if (isBuy)  walletMap.get(feePayer).buys++;
      if (isSell) walletMap.get(feePayer).sells++;
    }

    // Sniper bots: wallets that bought within the first N seconds of the token existing
    // Proxy: wallets whose first tx was very close to the earliest tx in the set
    const timestamps = txs.map(t => t.timestamp).filter(Boolean).sort((a,b) => a - b);
    const firstTxTime = timestamps[0] ?? 0;
    const sniperWindow = firstTxTime + 30; // 30 seconds after first tx
    const sniperCount = [...walletMap.values()].filter(w => w.firstSeen <= sniperWindow && w.buys > 0).length;

    // Unique buyers vs sellers
    const uniqueBuyers  = [...walletMap.values()].filter(w => w.buys > 0).length;
    const uniqueSellers = [...walletMap.values()].filter(w => w.sells > 0).length;

    // Dev wallet activity heuristic: look for high-frequency sell wallet
    // (dev wallets tend to sell large amounts early)
    const devWalletActive = [...walletMap.values()].some(w => w.sells >= 3 && w.buys === 0);

    return { recentTxs: txs, sniperCount, uniqueBuyers, uniqueSellers, devWalletActive, walletMap };
  } catch (e) {
    dbg("[helius] fetchHeliusTxData failed:", mint, e.message);
    return { recentTxs: [], sniperCount: 0, uniqueBuyers: 0, uniqueSellers: 0, devWalletActive: false };
  }
}

// ════════════════════════════════════════════════════════════════════════════
// SECTION 6 — TECHNICAL INDICATORS
// ════════════════════════════════════════════════════════════════════════════

function computeRSI(prices, period = 14) {
  if (prices.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = prices.length - period; i < prices.length; i++) {
    const diff = prices[i] - prices[i - 1];
    if (diff > 0) gains  += diff;
    else          losses -= diff;
  }
  const rs = losses === 0 ? 100 : gains / losses;
  return 100 - (100 / (1 + rs));
}

function computeMACD(prices) {
  if (prices.length < 26) return { macd: 0, signal: 0, histogram: 0, bullish: false };
  const ema12 = ema(prices, 12);
  const ema26 = ema(prices, 26);
  const macd  = ema12 - ema26;
  const signalLine = macd * 0.9;
  const histogram  = macd - signalLine;
  return { macd, signal: signalLine, histogram, bullish: histogram > 0 };
}

function computeBollingerBands(prices, period = 20, multiplier = 2) {
  if (prices.length < period) return { upper: 0, middle: 0, lower: 0, width: 0, position: 0.5 };
  const slice  = prices.slice(-period);
  const middle = sma(slice, period);
  const sd     = stddev(slice);
  const upper  = middle + multiplier * sd;
  const lower  = middle - multiplier * sd;
  const width  = upper - lower;
  const last   = prices[prices.length - 1];
  const position = width > 0 ? (last - lower) / width : 0.5;
  return { upper, middle, lower, width, position };
}

function computeTechnicalScore(priceHistory) {
  const prices  = priceHistory.map(h => safeNum(h.price_usd, 0)).filter(p => p > 0);
  const volumes = priceHistory.map(h => safeNum(h.volume_usd, 0));

  if (prices.length < 3) return { score: 50, indicators: {}, direction: "NEUTRAL" };

  const rsi  = computeRSI(prices);
  const macd = computeMACD(prices);
  const bb   = computeBollingerBands(prices);
  const ema9  = ema(prices, Math.min(9,  prices.length));
  const ema21 = ema(prices, Math.min(21, prices.length));
  const ema50 = ema(prices, Math.min(50, prices.length));

  const avgVol  = volumes.length > 1 ? sma(volumes, Math.min(volumes.length, 10)) : 0;
  const lastVol = volumes[volumes.length - 1] ?? 0;
  const volRatio = avgVol > 0 ? lastVol / avgVol : 1;

  let bullScore = 0, bearScore = 0;

  if (rsi < 30)      { bullScore += 20; }
  else if (rsi < 45) { bullScore += 10; }
  else if (rsi > 70) { bearScore += 20; }
  else if (rsi > 55) { bullScore +=  5; }

  if (macd.bullish)  bullScore += 15;
  else               bearScore += 10;

  if (bb.position < 0.2)     bullScore += 15;
  else if (bb.position > 0.8) bullScore += 10;
  if (bb.width > 0)           bullScore +=  5;

  if (ema9 > ema21 && ema21 > ema50) bullScore += 20;
  else if (ema9 > ema21)             bullScore += 10;
  else if (ema9 < ema21)             bearScore += 10;

  if (volRatio > 2.0)      bullScore += 15;
  else if (volRatio > 1.5) bullScore +=  8;

  const total = bullScore + bearScore;
  const score = total > 0 ? clamp((bullScore / total) * 100) : 50;
  const direction = score >= 60 ? "BUY" : score <= 40 ? "SELL" : "NEUTRAL";

  return { score, direction, indicators: { rsi, macd: macd.macd, bbPosition: bb.position, ema9, ema21, ema50, volRatio } };
}

// ════════════════════════════════════════════════════════════════════════════
// SECTION 7 — WYCKOFF PHASE DETECTOR
// ════════════════════════════════════════════════════════════════════════════

function detectWyckoffPhase(onChain, priceHistory) {
  const prices  = priceHistory.map(h => safeNum(h.price_usd, 0)).filter(p => p > 0);
  const volumes = priceHistory.map(h => safeNum(h.volume_usd, 0));

  if (prices.length < 4) {
    const { holderGrowthRate, volumeSpike, largeWalletRatio, txVelocity } = onChain;
    if (holderGrowthRate > 0.2 && volumeSpike < 1.5 && largeWalletRatio > 0.25)
      return { phase: "ACCUMULATION", bias: "BUY", confidence: 70, reason: "Holder growth + quiet volume + smart wallet loading" };
    if (txVelocity > 0.3 && holderGrowthRate > 0.15)
      return { phase: "SPRING", bias: "BUY", confidence: 80, reason: "Tx velocity spike post-accumulation" };
    if (volumeSpike > 2 && holderGrowthRate > 0.3)
      return { phase: "MARKUP_EARLY", bias: "BUY", confidence: 85, reason: "Volume + holder acceleration" };
    return { phase: "UNKNOWN", bias: "NEUTRAL", confidence: 40, reason: "Insufficient data" };
  }

  const last  = prices[prices.length - 1];
  const first = prices[0];
  const priceChange = first > 0 ? (last - first) / first : 0;
  const avgVol  = sma(volumes, volumes.length);
  const lastVol = volumes[volumes.length - 1] ?? 0;
  const volTrend = avgVol > 0 ? lastVol / avgVol : 1;
  const { holderGrowthRate, volumeSpike, largeWalletRatio } = onChain;

  if (Math.abs(priceChange) < 0.1 && holderGrowthRate > 0.1 && largeWalletRatio > 0.2)
    return { phase: "ACCUMULATION", bias: "BUY", confidence: 72, reason: "Price consolidating + smart wallet loading" };
  if (priceChange < -0.15 && volTrend < 0.8 && onChain.txVelocity > 0.2)
    return { phase: "SPRING", bias: "BUY", confidence: 82, reason: "Low-volume shakeout + tx velocity recovering" };
  if (priceChange > 0.1 && volumeSpike > 1.5)
    return { phase: "MARKUP_EARLY", bias: "BUY", confidence: 88, reason: "Price + volume breakout" };
  if (priceChange > 0.5 && volTrend < 0.7 && holderGrowthRate < 0.05)
    return { phase: "DISTRIBUTION", bias: "SELL", confidence: 78, reason: "Price peaked + volume fading" };

  return { phase: "MARKUP_MID", bias: "BUY", confidence: 60, reason: "Mid-markup continuation" };
}

// ════════════════════════════════════════════════════════════════════════════
// SECTION 8 — HIDDEN ORDER FLOW DETECTOR
// ════════════════════════════════════════════════════════════════════════════

function detectHiddenFlow(onChain, priceHistory) {
  const { txLast10m, txLast60m, holderGrowthRate, largeWalletRatio, volumeSpike, txVelocity } = onChain;

  let buyFlow = 0, sellFlow = 0;
  const reasons = [];

  if (largeWalletRatio > 0.3 && largeWalletRatio < 0.6) { buyFlow  += 30; reasons.push("Smart wallets loading quietly"); }
  if (txVelocity > 0.35)                                  { buyFlow  += 25; reasons.push("TX velocity accelerating"); }
  if (holderGrowthRate > 0.15 && volumeSpike < 1.5)       { buyFlow  += 25; reasons.push("Stealth holder growth"); }
  if (txLast10m > 15)                                      { buyFlow  += 20; reasons.push(`${txLast10m} TXs last 10min`); }
  if (largeWalletRatio > 0.65)                             { sellFlow += 40; reasons.push("Dangerous whale concentration"); }
  if (volumeSpike > 3 && holderGrowthRate < 0.05)          { sellFlow += 30; reasons.push("Volume spike without holders"); }

  const total     = buyFlow + sellFlow;
  const flowScore = total > 0 ? clamp((buyFlow / total) * 100) : 50;
  const direction = flowScore >= 65 ? "BUY" : flowScore <= 35 ? "SELL" : "NEUTRAL";
  const confidence = Math.abs(flowScore - 50) * 2;

  return { direction, confidence, flowScore, reasons };
}

// ════════════════════════════════════════════════════════════════════════════
// SECTION 9 — PUMP PROBABILITY ENGINE
// ════════════════════════════════════════════════════════════════════════════

function calcPumpProbability(onChain, techScore, wyckoff, hiddenFlow) {
  let score = 0;
  const { holderGrowthRate, volumeSpike, txVelocity, txLast10m, marketCap } = onChain;

  if (marketCap > 0 && marketCap < 100000)       score += 20;
  else if (marketCap > 0 && marketCap < 1000000) score += 15;
  else if (marketCap > 0 && marketCap < 10000000) score += 8;

  if (holderGrowthRate > 0.35)      score += 20;
  else if (holderGrowthRate > 0.2)  score += 12;
  else if (holderGrowthRate > 0.1)  score +=  6;

  if (volumeSpike > 3)      score += 20;
  else if (volumeSpike > 2) score += 12;
  else if (volumeSpike > 1.5) score += 6;

  if (txVelocity > 0.4)      score += 15;
  else if (txVelocity > 0.25) score += 8;

  if (txLast10m > 20) score += 15;
  else if (txLast10m > 10) score += 8;

  if (techScore.score > 70)      score += 15;
  else if (techScore.score > 55) score +=  8;

  if (wyckoff.phase === "SPRING")            score += 20;
  else if (wyckoff.phase === "MARKUP_EARLY") score += 15;
  else if (wyckoff.phase === "ACCUMULATION") score += 10;

  if (hiddenFlow.direction === "BUY" && hiddenFlow.confidence > 60) score += 15;
  else if (hiddenFlow.direction === "BUY")                           score +=  8;

  return clamp(score);
}

// ════════════════════════════════════════════════════════════════════════════
// SECTION 10 — 6D SCORING ENGINE
// ════════════════════════════════════════════════════════════════════════════

function calcWhaleScore(data) {
  const pen = data.largeWalletRatio > 0.5 ? (data.largeWalletRatio - 0.5) * 60 : 0;
  const acc = clamp((1 - data.largeWalletRatio) * 100 + data.holderCount * 0.05);
  return clamp(acc - pen);
}

function calcSmartMoneyScore(data) {
  const tx  = clamp(data.recentTxCount * 0.8);
  const hld = clamp(Math.log10(Math.max(data.holderCount, 1)) * 20);
  const vol = data.volumeSpike > 1.5 ? clamp(data.volumeSpike * 10) : 0;
  return clamp(tx * 0.4 + hld * 0.4 + vol * 0.2);
}

function calcVolumeAnomalyScore(data) {
  if (data.volumeSpike <= 1) return clamp(data.recentTxCount * 0.5);
  return clamp(data.volumeSpike * 25 + data.recentTxCount * 0.3);
}

function calcHolderVelocityScore(data) {
  const g = clamp(data.holderGrowthRate * 200);
  const b = clamp(Math.log10(Math.max(data.holderCount, 1)) * 15);
  return clamp(g * 0.7 + b * 0.3);
}

function calcLiquidityScore(data) {
  const d = clamp(Math.log10(Math.max(data.lpDepth, 1)) * 12);
  const g = clamp(data.lpGrowthRate * 150);
  return clamp(d * 0.6 + g * 0.4);
}

// ════════════════════════════════════════════════════════════════════════════
// SECTION 11 — MULTI-TIMEFRAME CONSENSUS
// ════════════════════════════════════════════════════════════════════════════

function buildMultiTFConsensus(onChain, priceHistory, techScore, wyckoff, hiddenFlow) {
  const tfs = [
    { tf: "1m",  weight: 0.10, score: clamp(onChain.txLast10m * 5),                    dir: onChain.txLast10m > 10 ? "BUY" : "NEUTRAL" },
    { tf: "5m",  weight: 0.15, score: clamp(onChain.txVelocity * 200),                  dir: onChain.txVelocity > 0.3 ? "BUY" : "NEUTRAL" },
    { tf: "15m", weight: 0.20, score: clamp(onChain.holderGrowthRate * 150 + onChain.volumeSpike * 15), dir: onChain.holderGrowthRate > 0.1 ? "BUY" : "NEUTRAL" },
    { tf: "1h",  weight: 0.25, score: techScore.score,                                  dir: techScore.direction },
    { tf: "4h",  weight: 0.20, score: wyckoff.confidence,                               dir: wyckoff.bias },
    { tf: "1d",  weight: 0.10, score: hiddenFlow.flowScore,                             dir: hiddenFlow.direction },
  ];

  let buyWeight = 0, sellWeight = 0, neutralWeight = 0, totalWeight = 0, weightedScore = 0;
  for (const tf of tfs) {
    totalWeight   += tf.weight;
    weightedScore += tf.score * tf.weight;
    if (tf.dir === "BUY")      buyWeight     += tf.weight;
    else if (tf.dir === "SELL") sellWeight   += tf.weight;
    else                        neutralWeight += tf.weight;
  }

  const avgScore     = totalWeight > 0 ? weightedScore / totalWeight : 50;
  const buyPct       = pct(buyWeight, totalWeight);
  const sellPct      = pct(sellWeight, totalWeight);
  const consensusDir = buyPct >= 55 ? "BUY" : sellPct >= 55 ? "SELL" : "NEUTRAL";
  const conviction   = Math.abs(buyPct - sellPct);
  const certainty    = clamp((avgScore * 0.5 + conviction * 0.5));
  const tfDissent    = tfs.filter(tf => tf.dir !== consensusDir && tf.dir !== "NEUTRAL").length;

  return {
    tfs, avgScore, buyPct, sellPct, consensusDir, conviction,
    certaintyScore: certainty, avgConfidence: avgScore,
    convictionPct: conviction, tfDissent,
    direction: consensusDir,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// SECTION 12 — INSTITUTIONAL CONTEXT ENGINE
// ════════════════════════════════════════════════════════════════════════════

function buildInstitutionalContext(onChain, wyckoff, hiddenFlow, consensus) {
  const wyckoffAligned = wyckoff.bias === consensus.consensusDir || wyckoff.bias === "NEUTRAL";
  const structAligned  = consensus.consensusDir !== "NEUTRAL";
  const noTrap         = onChain.largeWalletRatio < 0.65 && onChain.volumeSpike < 4;
  const sessionActive  = onChain.txLast10m > 3;

  let pillars = 0;
  if (wyckoffAligned) pillars++;
  if (structAligned)  pillars++;
  if (noTrap)         pillars++;
  if (sessionActive)  pillars++;

  return {
    pillarsConfirmed: pillars,
    wyckoff:    { bias: wyckoff.bias,         phase: wyckoff.phase,         active: wyckoffAligned },
    struct:     { direction: consensus.consensusDir,                         active: structAligned  },
    trap:       { trapped: !noTrap,            direction: "SELL",            active: noTrap         },
    kz:         { active: sessionActive,       txBurst: onChain.txLast10m                           },
    hiddenFlow: { direction: hiddenFlow.direction, confidence: hiddenFlow.confidence },
  };
}

// ════════════════════════════════════════════════════════════════════════════
// SECTION 13 — QUALITY GATE
// ════════════════════════════════════════════════════════════════════════════

function checkQualityGate(consensus, instCtx) {
  const t = {
    certMin:   config.qualityCertMin,
    avgMin:    config.qualityAvgMin,
    convMin:   config.qualityConvMin,
    pillarMin: config.qualityPillarMin,
  };
  const cert    = safeNum(consensus.certaintyScore, 0);
  const avg     = safeNum(consensus.avgConfidence,  0);
  const conv    = safeNum(consensus.convictionPct,  0);
  const pillars = safeNum(instCtx.pillarsConfirmed, 0);

  const passCert   = cert    >= t.certMin;
  const passAvg    = avg     >= t.avgMin;
  const passConv   = conv    >= t.convMin;
  const passPillar = pillars >= t.pillarMin;
  const ok         = passCert && passAvg && passConv && passPillar;

  const reason = ok ? "PASS" : [
    !passCert   && `cert ${cert.toFixed(0)}<${t.certMin}`,
    !passAvg    && `avg ${avg.toFixed(0)}<${t.avgMin}`,
    !passConv   && `conv ${conv.toFixed(0)}<${t.convMin}`,
    !passPillar && `pillars ${pillars}/${t.pillarMin}`,
  ].filter(Boolean).join(" | ");

  return { ok, cert, avg, conv, pillars, reason };
}

// ════════════════════════════════════════════════════════════════════════════
// SECTION 14 — DECISION ENGINE V2
// ════════════════════════════════════════════════════════════════════════════

function decisionEngineV2(signal, consensus, instCtx) {
  const dir        = String(signal.direction || "").toUpperCase();
  const hiddenDir  = String(instCtx.hiddenFlow?.direction || "NEUTRAL").toUpperCase();
  const hiddenConf = safeNum(instCtx.hiddenFlow?.confidence, 0);
  const baseCert   = safeNum(consensus.certaintyScore, 0);

  const CONTRA_MIN = config.hiddenContraMin;
  const BOOST_MAX  = config.boostMax;
  const PEN_MAX    = config.penaltyMax;
  const CAP        = config.contraCap;

  let boost = 0, penalty = 0, contradictionCap = null;
  const reasons = [];

  if (dir === "BUY"  && hiddenDir === "SELL" && hiddenConf >= CONTRA_MIN) {
    contradictionCap = CAP;
    reasons.push(`Hidden SELL ${hiddenConf}% opposes BUY → cap ${CAP}`);
  }
  if (dir === "SELL" && hiddenDir === "BUY"  && hiddenConf >= CONTRA_MIN) {
    contradictionCap = CAP;
    reasons.push(`Hidden BUY ${hiddenConf}% opposes SELL → cap ${CAP}`);
  }

  if (consensus.buyPct >= 85)      { boost += 8; reasons.push("MTF 85%+ aligned +8"); }
  else if (consensus.buyPct >= 70) { boost += 5; reasons.push("MTF 70%+ aligned +5"); }
  if (dir === "BUY"  && hiddenDir === "BUY"  && hiddenConf >= 50) { boost += 6; reasons.push("Hidden flow confirms BUY +6"); }
  if (dir === "SELL" && hiddenDir === "SELL" && hiddenConf >= 50) { boost += 6; reasons.push("Hidden flow confirms SELL +6"); }
  if (instCtx.pillarsConfirmed >= 4) { boost += 4; reasons.push("All 4 pillars +4"); }
  else if (instCtx.pillarsConfirmed >= 3) { boost += 2; reasons.push("3 pillars +2"); }
  boost = Math.min(boost, BOOST_MAX);

  if (instCtx.trap?.trapped)   { penalty += 8; reasons.push("Trap detected -8"); }
  if (consensus.tfDissent > 3) { penalty += Math.min(consensus.tfDissent * 1, 6); reasons.push(`TF dissent ${consensus.tfDissent}`); }
  penalty = Math.min(penalty, PEN_MAX);

  let finalCert = baseCert + boost - penalty;
  if (contradictionCap !== null) finalCert = Math.min(finalCert, contradictionCap);
  finalCert = clamp(finalCert);

  const netDelta = finalCert - baseCert;
  const status   = finalCert >= 85 ? "STRONG" : finalCert >= 70 ? "CONFIRMED" : "STANDARD";
  const action   = contradictionCap !== null && finalCert < 60 ? "SKIP" : "TRADE";

  _state.cycleTelemetry.boosted += boost > 0 ? 1 : 0;

  return { action, finalCert, baseCert, boost, penalty, netDelta, status, contradictionCap, reasons };
}

// ════════════════════════════════════════════════════════════════════════════
// SECTION 15 — FRACTAL TIME ANALYZER (v8: Hurst exponent only — no random)
// ════════════════════════════════════════════════════════════════════════════

class FractalTimeAnalyzer {
  // Hurst exponent: H > 0.5 = trending, H < 0.5 = mean-reverting, H = 0.5 = random walk
  calculateHurstExponent(prices) {
    if (prices.length < 10) return 0.5;
    const maxLag = Math.floor(prices.length / 2);
    const R = [], S = [];

    for (let lag = 10; lag <= maxLag; lag += 5) {
      const slice    = prices.slice(0, lag);
      const mean     = slice.reduce((a, b) => a + b, 0) / lag;
      const devs     = slice.map(p => p - mean);
      let cumSum = 0;
      const cum  = devs.map(d => (cumSum += d, cumSum));
      const R_val  = Math.max(...cum) - Math.min(...cum);
      const S_val  = stddev(devs);
      if (S_val > 0) {
        R.push(Math.log(R_val / S_val));
        S.push(Math.log(lag));
      }
    }

    if (R.length < 2) return 0.5;
    const n = R.length;
    const sx = S.reduce((a, b) => a + b, 0);
    const sy = R.reduce((a, b) => a + b, 0);
    const sxy = S.reduce((sum, x, i) => sum + x * R[i], 0);
    const sx2 = S.reduce((sum, x) => sum + x * x, 0);
    const hurst = (n * sxy - sx * sy) / (n * sx2 - sx * sx);
    return Math.min(0.99, Math.max(0.01, hurst));
  }

  // Reversal detection via fractal dimension shift
  detectPendingReversal(prices) {
    if (prices.length < 30) return { reversals: [], confidence: 0, hurstExponent: 0.5 };

    const hurst = this.calculateHurstExponent(prices);
    const reversals = [];
    const leftSize = 15, rightSize = 15;

    for (let i = leftSize; i < prices.length - rightSize; i++) {
      const lw  = prices.slice(i - leftSize, i);
      const rw  = prices.slice(i, i + rightSize);
      const lH  = this.calculateHurstExponent(lw);
      const rH  = this.calculateHurstExponent(rw);
      const dimChange = Math.abs((2 - rH) - (2 - lH));

      if (dimChange > 0.3 && hurst > 0.65) {
        const strength = dimChange * (1 + Math.abs(lw[lw.length - 1] - rw[0]) / prices[i]);
        if (strength > 0.15) {
          reversals.push({
            position:  i,
            strength:  Math.min(0.99, strength),
            direction: lw[lw.length - 1] > rw[0] ? "BEARISH" : "BULLISH",
          });
        }
      }
    }

    const latest     = reversals.filter(r => r.position > prices.length - 10);
    const confidence = latest.length > 0 ? latest[0].strength : 0;

    return { reversals: latest, confidence, hurstExponent: hurst,
             trendPersistence: hurst > 0.5 ? "TRENDING" : "MEAN_REVERTING" };
  }

  // Score: 0-100. High score = trend persisting (good for BUY), low = reversal risk
  scoreFractal(prices) {
    if (prices.length < 10) return { score: 50, hurstExponent: 0.5, reversalRisk: 0 };
    const reversal = this.detectPendingReversal(prices);
    const H = reversal.hurstExponent;
    // H > 0.65 = strong trend = high score; reversal risk reduces score
    const trendScore = clamp(H * 100);
    const adjustedScore = clamp(trendScore - reversal.confidence * 50);
    return { score: adjustedScore, hurstExponent: H, reversalRisk: reversal.confidence, reversal };
  }
}

const fractalAnalyzer = new FractalTimeAnalyzer();

// ════════════════════════════════════════════════════════════════════════════
// SECTION 15B — REGION__ SCIENTIFIC ENGINE SUITE
// All 13 algorithmic intelligence engines extracted from Region__intelligence__
// Adapted for memecoin OHLCV-style data. Pure math — no external state.
// ════════════════════════════════════════════════════════════════════════════

// ── Shared math helpers ──────────────────────────────────────────────────────
function _mean(arr)    { return arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : 0; }
function _variance(arr){ const m=_mean(arr); return arr.length ? arr.reduce((a,b)=>a+(b-m)**2,0)/arr.length : 0; }
function _shannonEntropy(series, bins=10) {
  if (!series.length) return 0;
  const mn=Math.min(...series), mx=Math.max(...series), rng=mx-mn||1;
  const counts=new Array(bins).fill(0);
  series.forEach(v=>{ const b=Math.min(bins-1,Math.floor((v-mn)/rng*bins)); counts[b]++; });
  const n=series.length;
  return -counts.filter(c=>c>0).reduce((s,c)=>{ const p=c/n; return s+p*Math.log2(p); },0);
}
function _computeReturns(series) {
  const r=[];
  for (let i=1;i<series.length;i++) r.push((series[i]-series[i-1])/(series[i-1]||1));
  return r;
}
const _rnd2 = v => Math.round(v*100)/100;
const _clamp01 = v => Math.max(0, Math.min(1, v));

// ── Synthetic candle builder from price-history snapshots ────────────────────
function buildSyntheticCandles(priceHistory) {
  return priceHistory
    .filter(h => safeNum(h.price_usd,0) > 0)
    .map((h, i, arr) => {
      const c = safeNum(h.price_usd, 0);
      const prev = i > 0 ? safeNum(arr[i-1].price_usd, c) : c;
      const vol  = safeNum(h.volume_usd, 0);
      const swing = c * 0.012; // 1.2% synthetic H/L swing
      return {
        o: prev,
        h: Math.max(c, prev) + swing,
        l: Math.min(c, prev) - swing,
        c,
        v: vol,
        t: new Date(h.recorded_at).getTime(),
      };
    });
}

// ── ENGINE 1: LIQUIDITY GRAVITY ENGINE (Newton's Law on liquidity pools) ────
function liquidityGravityEngine(candles, currentPrice) {
  if (!candles||candles.length<15||isNaN(currentPrice)||currentPrice<=0)
    return { direction:'NEUTRAL', confidence:0, netForce:0, label:'LiquidityGravity' };

  const slice  = candles.slice(-30);
  const vols   = slice.map(c=>c.v).filter(v=>!isNaN(v));
  const avgVol = _mean(vols) || 1;
  const pools  = [];

  for (let i=2; i<slice.length-2; i++) {
    const c = slice[i];
    if (!c||isNaN(c.h)) continue;
    if (c.h>slice[i-1].h&&c.h>slice[i-2].h&&c.h>slice[i+1].h&&c.h>slice[i+2].h) {
      const mass = ((c.v||1)/avgVol)*((c.h-c.l)/currentPrice);
      pools.push({ price:c.h, mass:mass||0.1, side:'ABOVE' });
    }
    if (c.l<slice[i-1].l&&c.l<slice[i-2].l&&c.l<slice[i+1].l&&c.l<slice[i+2].l) {
      const mass = ((c.v||1)/avgVol)*((c.h-c.l)/currentPrice);
      pools.push({ price:c.l, mass:mass||0.1, side:'BELOW' });
    }
  }

  const magnitude = Math.pow(10, Math.floor(Math.log10(currentPrice)));
  for (let mult=0.5; mult<=2.0; mult+=0.5) {
    const lvl = Math.round(currentPrice/(magnitude*mult))*(magnitude*mult);
    if (lvl>0&&Math.abs(lvl-currentPrice)/currentPrice<0.15)
      pools.push({ price:lvl, mass:0.25, side:lvl>currentPrice?'ABOVE':'BELOW' });
  }

  if (!pools.length) return { direction:'NEUTRAL', confidence:0, netForce:0, label:'LiquidityGravity' };

  let forceUp=0, forceDown=0;
  for (const p of pools) {
    const dist = Math.abs(p.price-currentPrice)/currentPrice;
    if (dist<0.0001) continue;
    const f = p.mass/(dist*dist);
    if (p.side==='ABOVE') forceUp+=f; else forceDown+=f;
  }
  const total = forceUp+forceDown;
  const balance = total>0 ? (forceUp-forceDown)/total : 0;

  let direction='NEUTRAL', confidence=0;
  if (balance>0.25)      { direction='BUY';  confidence=clamp(balance*0.85*100); }
  else if (balance<-0.25) { direction='SELL'; confidence=clamp(Math.abs(balance)*0.85*100); }

  return { direction, confidence, netForce:_rnd2(balance), label:'LiquidityGravity' };
}

// ── ENGINE 2: ENTROPY CASCADE DETECTOR (multi-scale Shannon entropy) ─────────
function entropyCascadeDetector(candles) {
  if (!candles||candles.length<30)
    return { direction:'NEUTRAL', confidence:0, cascade:false, label:'EntropyCascade' };
  const closes = candles.map(c=>c.c).filter(v=>!isNaN(v)&&v>0);
  const returns = _computeReturns(closes);
  if (returns.length<20) return { direction:'NEUTRAL', confidence:0, cascade:false, label:'EntropyCascade' };

  const windows=[8,15,25];
  const compressions=[];
  for (const w of windows) {
    if (returns.length<w*2) continue;
    const cur  = _shannonEntropy(returns.slice(-w));
    const base = _shannonEntropy(returns.slice(-w*2,-w));
    if (base>0) compressions.push(cur/base);
  }
  if (!compressions.length) return { direction:'NEUTRAL', confidence:0, cascade:false, label:'EntropyCascade' };

  const avg = _mean(compressions);
  const allCompressed = compressions.every(r=>r<0.85);
  const deep          = compressions.every(r=>r<0.65);
  const momentumDir   = _mean(returns.slice(-8))>0 ? 'BUY' : 'SELL';
  const level = Math.max(0,1-avg);

  let direction='NEUTRAL', confidence=0;
  if (deep)          { direction=momentumDir; confidence=clamp(level*120); }
  else if (allCompressed) { direction=momentumDir; confidence=clamp(level*90); }

  return { direction, confidence, cascade:deep, compressionLevel:_rnd2(level), label:'EntropyCascade' };
}

// ── ENGINE 3: BIFURCATION DETECTOR (critical slowing down) ───────────────────
function bifurcationDetector(candles) {
  if (!candles||candles.length<30)
    return { direction:'NEUTRAL', confidence:0, autocorr:0, bifurcating:false, label:'Bifurcation' };
  const closes  = candles.map(c=>c.c).filter(v=>!isNaN(v));
  const returns = _computeReturns(closes);
  if (returns.length<20) return { direction:'NEUTRAL', confidence:0, autocorr:0, bifurcating:false, label:'Bifurcation' };

  function lag1AutoCorr(arr) {
    if (arr.length<4) return 0;
    const n=arr.length-1, x=arr.slice(0,n), y=arr.slice(1,n+1);
    const mx=_mean(x), my=_mean(y);
    let cov=0, sx=0, sy=0;
    for (let i=0;i<n;i++) { cov+=(x[i]-mx)*(y[i]-my); sx+=(x[i]-mx)**2; sy+=(y[i]-my)**2; }
    const denom=Math.sqrt(sx*sy);
    return denom>0 ? cov/denom : 0;
  }

  const wSize=10;
  const acorrs=[];
  for (let i=wSize; i<=returns.length; i+=3) acorrs.push(lag1AutoCorr(returns.slice(i-wSize,i)));
  if (acorrs.length<2) return { direction:'NEUTRAL', confidence:0, autocorr:0, bifurcating:false, label:'Bifurcation' };

  const currentAC = acorrs[acorrs.length-1];
  const earlierAC = _mean(acorrs.slice(0,-1));
  const acRise    = currentAC-earlierAC;
  const recentVar = _mean(returns.slice(-10).map(r=>r*r));
  const priorVar  = _mean(returns.slice(-20,-10).map(r=>r*r));
  const varRise   = priorVar>0 ? (recentVar-priorVar)/priorVar : 0;

  const bifurcating = currentAC>0.35&&acRise>0.12&&varRise>0.05;
  const strong      = currentAC>0.55&&acRise>0.20;
  const currentTrend = closes[closes.length-1]>closes[closes.length-10] ? 'BUY':'SELL';
  const reversalDir  = currentTrend==='BUY' ? 'SELL':'BUY';

  let direction='NEUTRAL', confidence=0;
  if (strong)       { direction=reversalDir; confidence=clamp((0.50+acRise+varRise*0.3)*100); }
  else if (bifurcating) { direction=reversalDir; confidence=clamp((0.35+acRise*0.8)*100); }

  return { direction, confidence, autocorr:_rnd2(currentAC), acRise:_rnd2(acRise), bifurcating, label:'Bifurcation' };
}

// ── ENGINE 4: RESONANT FREQUENCY ANALYZER (FFT cycle phases) ─────────────────
function resonantFrequencyAnalyzer(candles) {
  if (!candles||candles.length<32)
    return { direction:'NEUTRAL', confidence:0, dominantCycle:null, label:'ResonantFreq' };
  const prices = candles.slice(-32).map(c=>c.c).filter(v=>!isNaN(v));
  if (prices.length<16) return { direction:'NEUTRAL', confidence:0, dominantCycle:null, label:'ResonantFreq' };

  const n = prices.length;
  const slope = (prices[n-1]-prices[0])/n;
  const det   = prices.map((p,i)=>p-prices[0]-slope*i);
  const N     = det.length;
  const real  = new Array(N).fill(0);
  const imag  = new Array(N).fill(0);

  for (let k=1;k<Math.floor(N/2);k++) {
    for (let t=0;t<N;t++) {
      const a=2*Math.PI*k*t/N;
      real[k]+=det[t]*Math.cos(a);
      imag[k]-=det[t]*Math.sin(a);
    }
  }

  const power=[];
  for (let k=1;k<Math.floor(N/2);k++)
    power.push({ k, period:N/k, power:real[k]*real[k]+imag[k]*imag[k], phase:Math.atan2(imag[k],real[k]) });
  power.sort((a,b)=>b.power-a.power);

  const top3 = power.slice(0,3);
  if (!top3.length) return { direction:'NEUTRAL', confidence:0, dominantCycle:null, label:'ResonantFreq' };

  const phaseScores = top3.map(f=>-f.phase/Math.PI);
  const totalPow = top3.reduce((a,f)=>a+f.power,0);
  const wp = totalPow>0 ? top3.reduce((a,f,i)=>a+phaseScores[i]*(f.power/totalPow),0) : 0;

  const align = phaseScores.every(p=>p>0.25)?'TROUGH':phaseScores.every(p=>p<-0.25)?'PEAK':'MIXED';
  let direction='NEUTRAL', confidence=0;
  if (align==='TROUGH')      { direction='BUY';  confidence=clamp(Math.abs(wp)*80); }
  else if (align==='PEAK')   { direction='SELL'; confidence=clamp(Math.abs(wp)*80); }
  else if (Math.abs(wp)>0.4) { direction=wp>0?'BUY':'SELL'; confidence=clamp(Math.abs(wp)*50); }

  return { direction, confidence, dominantCycle:_rnd2(top3[0].period), phaseAlignment:align, label:'ResonantFreq' };
}

// ── ENGINE 5: VOLATILITY COMPRESSION RATIO (multi-scale squeeze) ─────────────
function volatilityCompressionRatio(candles) {
  if (!candles||candles.length<40)
    return { direction:'NEUTRAL', confidence:0, vcr:1, megaSqueeze:false, label:'VCR' };

  function atrWindow(cs, period) {
    const trs=[];
    for (let i=1;i<cs.length;i++) {
      const c=cs[i],p=cs[i-1];
      if (!isNaN(c.h)&&!isNaN(c.l)&&!isNaN(p.c))
        trs.push(Math.max(c.h-c.l,Math.abs(c.h-p.c),Math.abs(c.l-p.c)));
    }
    return trs.length>=period ? trs.slice(-period).reduce((a,b)=>a+b,0)/period : 0;
  }

  const scales=[{cur:5,base:20},{cur:10,base:30},{cur:15,base:45}];
  const compressions=[];
  for (const s of scales) {
    if (candles.length<s.base+3) continue;
    const cATR = atrWindow(candles.slice(-(s.cur+1)),s.cur);
    const bATR = atrWindow(candles.slice(-(s.base+1)),s.base);
    if (bATR>0) compressions.push(cATR/bATR);
  }
  if (compressions.length<2) return { direction:'NEUTRAL', confidence:0, vcr:1, megaSqueeze:false, label:'VCR' };

  const vcr = compressions.reduce((a,b)=>a*b,1);
  const mega = vcr<0.35&&compressions.every(c=>c<0.7);
  const hard = vcr<0.55&&compressions.every(c=>c<0.85);

  const last5c = candles.slice(-5).map(c=>c.c).filter(v=>!isNaN(v));
  const dir = last5c.length>=2&&last5c[last5c.length-1]>last5c[0] ? 'BUY':'SELL';

  let direction='NEUTRAL', confidence=0;
  if (mega)      { direction=dir; confidence=clamp((0.35-vcr)*300); }
  else if (hard) { direction=dir; confidence=clamp((0.55-vcr)*200); }

  return { direction, confidence, vcr:_rnd2(vcr), megaSqueeze:mega, hardSqueeze:hard, label:'VCR' };
}

// ── ENGINE 6: RECURRENCE QUANTIFICATION ANALYSIS (chaos theory, Eckmann 1987) ─
function recurrenceQuantificationAnalysis(candles) {
  if (!candles||candles.length<25)
    return { rr:0, det:0, lam:0, phase:'UNKNOWN', signal:'NEUTRAL', confidence:0, label:'RQA' };
  const closes = candles.map(c=>c.c).filter(v=>!isNaN(v));
  if (closes.length<20) return { rr:0, det:0, lam:0, phase:'UNKNOWN', signal:'NEUTRAL', confidence:0, label:'RQA' };

  const tau=1, m=2;
  const N=Math.min(25, closes.length-tau*(m-1));
  const pts=[];
  for (let i=0;i<N;i++) pts.push([closes[i],closes[i+tau]]);

  const all=closes.slice(-N-tau*(m-1));
  const mean=_mean(all);
  const std=Math.sqrt(_variance(all))||1;
  const eps=std*0.15;
  if (eps===0) return { rr:0, det:0, lam:0, phase:'UNKNOWN', signal:'NEUTRAL', confidence:0, label:'RQA' };

  const R=[];
  for (let i=0;i<N;i++) {
    R[i]=[];
    for (let j=0;j<N;j++) {
      const dist=Math.sqrt(pts[i].reduce((s,v,k)=>s+(v-pts[j][k])**2,0));
      R[i][j]=dist<eps?1:0;
    }
  }

  let recCount=0;
  for (let i=0;i<N;i++) for (let j=0;j<N;j++) if (i!==j&&R[i][j]) recCount++;
  const rr=recCount/(N*(N-1)||1);

  let diagPts=0;
  for (let diag=-(N-2);diag<=N-2;diag++) {
    let ll=0;
    for (let i=0;i<N;i++) {
      const j=i-diag;
      if (j>=0&&j<N&&i!==j&&R[i][j]) ll++;
      else { if (ll>=2) diagPts+=ll; ll=0; }
    }
    if (ll>=2) diagPts+=ll;
  }
  const det = recCount>0 ? diagPts/recCount : 0;

  let vertPts=0;
  for (let j=0;j<N;j++) {
    let ll=0;
    for (let i=0;i<N;i++) {
      if (i!==j&&R[i][j]) ll++;
      else { if (ll>=2) vertPts+=ll; ll=0; }
    }
    if (ll>=2) vertPts+=ll;
  }
  const lam = recCount>0 ? vertPts/recCount : 0;

  const recentCloses = closes.slice(-8);
  const shortTrend   = (recentCloses[recentCloses.length-1]-recentCloses[0])/recentCloses[0];
  const dir          = shortTrend>=0 ? 'BUY':'SELL';

  let phase='NEUTRAL', signal='NEUTRAL', confidence=0;
  if (lam>0.6&&det<0.45&&rr>0.02) { phase='LAMINAR_COIL'; signal=dir; confidence=clamp((0.55+(lam-0.6)*1.2+(0.45-det)*0.8)*100); }
  else if (det>0.65&&lam<0.50&&rr>0.04) { phase='TRENDING'; signal=dir; confidence=clamp((0.40+(det-0.65)*1.5)*100); }
  else if (rr<0.02) { phase='CHAOTIC'; }

  return { rr:_rnd2(rr), det:_rnd2(det), lam:_rnd2(lam), phase, signal, confidence, label:'RQA' };
}

// ── ENGINE 7: THERMODYNAMIC MARKET STATE (Gibbs Free Energy, Gibbs 1873) ─────
function thermodynamicMarketState(candles) {
  if (!candles||candles.length<25)
    return { G:0, phase:'EQUILIBRIUM', signal:'NEUTRAL', confidence:0, label:'Thermodynamic' };
  const closes = candles.map(c=>c.c).filter(v=>!isNaN(v));
  if (closes.length<20) return { G:0, phase:'EQUILIBRIUM', signal:'NEUTRAL', confidence:0, label:'Thermodynamic' };

  const returns = closes.slice(1).map((p,i)=>(p-closes[i])/(closes[i]||1));
  const shortW  = returns.slice(-6);
  const mS      = _mean(shortW);
  const T       = Math.sqrt(_variance(shortW));

  const longW  = returns.slice(-15);
  const mL     = _mean(longW);
  const longVar = _variance(longW);
  const H      = (mL*mL)/(longVar+0.0001);

  const allRets = returns.slice(-15);
  const mn=Math.min(...allRets), mx=Math.max(...allRets);
  const rng=mx-mn||1e-10;
  const bins=new Array(6).fill(0);
  allRets.forEach(r=>{ const b=Math.min(5,Math.floor((r-mn)/rng*6)); bins[b]++; });
  let S=0;
  bins.forEach(cnt=>{ if(cnt>0){ const p=cnt/allRets.length; S-=p*Math.log(p); } });
  S=S/Math.log(6);

  const G = H - T*S*100;

  const prevRet = returns.slice(0,-5);
  let dG=0;
  if (prevRet.length>=12) {
    const pS=prevRet.slice(-6), pmS=_mean(pS);
    const pT=Math.sqrt(_variance(pS));
    const pL=prevRet.slice(-15), pmL=_mean(pL), plV=_variance(pL);
    const pH=(pmL*pmL)/(plV+0.0001);
    const pbins=new Array(6).fill(0);
    pL.forEach(r=>{ const mn2=Math.min(...pL),mx2=Math.max(...pL),rng2=mx2-mn2||1e-10;
      const b=Math.min(5,Math.floor((r-mn2)/rng2*6)); pbins[b]++; });
    let pS2=0;
    pbins.forEach(c=>{ if(c>0){ const pp=c/pL.length; pS2-=pp*Math.log(pp); } });
    pS2=pS2/Math.log(6);
    const prevG=pH-pT*pS2*100;
    dG=G-prevG;
  }

  const recentDir=(closes[closes.length-1]-closes[closes.length-6])/closes[closes.length-6];
  const dir = recentDir>=0 ? 'BUY':'SELL';

  let phase='EQUILIBRIUM', signal='NEUTRAL', confidence=0;
  if (G<0&&dG<0)       { phase='PHASE_TRANSITION'; signal=dir; confidence=clamp((0.55+Math.abs(G)*0.5+Math.abs(dG)*0.3)*100); }
  else if (G<0&&dG>=0) { phase='POST_TRANSITION';  signal=dir; confidence=clamp((0.42+Math.abs(G)*0.3)*100); }
  else if (G>0&&dG<-0.001) { phase='PRE_TRANSITION'; signal=dir; confidence=clamp((0.38+Math.abs(dG)*5)*100); }

  return { G:_rnd2(G), dG:_rnd2(dG), phase, signal, confidence, label:'Thermodynamic' };
}

// ── ENGINE 8: LEMPEL-ZIV COMPLEXITY (LZ76, institutional script detection) ───
function lempelZivComplexity(candles) {
  if (!candles||candles.length<20)
    return { normalized:0.5, trend:'NEUTRAL', signal:'NEUTRAL', confidence:0, label:'LempelZiv' };
  const closes = candles.map(c=>c.c).filter(v=>!isNaN(v));
  if (closes.length<15) return { normalized:0.5, trend:'NEUTRAL', signal:'NEUTRAL', confidence:0, label:'LempelZiv' };

  const seq=[];
  for (let i=1;i<closes.length;i++) seq.push(closes[i]>=closes[i-1]?'1':'0');

  function lz76(s) {
    if (!s.length) return 0;
    let c=1,i=0,k=1,l=1,kmax=1;
    const n=s.length;
    while (i+k<=n) {
      if (s[i+k-1]===s[l+k-1]) { k++; if(l+k>i+kmax) kmax=i+kmax-l+1; }
      else { if(k>kmax) kmax=k; i+=kmax; l=i; k=1; kmax=1; c++; }
    }
    return c;
  }

  const recent  = seq.slice(-30);
  const prevWin = seq.slice(-40,-10);
  const lzcNow  = lz76(recent.join(''));
  const lzcPrev = prevWin.length>=15 ? lz76(prevWin.join('')) : lzcNow;
  const maxC    = recent.length/Math.log2(recent.length+1);
  const normalized = clamp(lzcNow/maxC*100);

  const rising   = lzcNow>lzcPrev*1.15;
  const falling  = lzcNow<lzcPrev*0.85;
  const recentC  = closes.slice(-6);
  const priceDir = recentC[recentC.length-1]>recentC[0] ? 'BUY':'SELL';
  const buys     = recent.filter((v,i,a)=>i>0&&v==='1'&&a[i-1]==='1').length;
  const sells    = recent.filter((v,i,a)=>i>0&&v==='0'&&a[i-1]==='0').length;
  const bias     = buys>sells ? 'BUY':'SELL';

  let trend='NEUTRAL', signal='NEUTRAL', confidence=0;
  const norm01 = normalized/100;
  if (norm01<0.30)             { trend='INSTITUTIONAL_SCRIPT'; signal=bias;     confidence=clamp((0.55+(0.30-norm01)*200)); }
  else if (norm01<0.45&&rising){ trend='SCRIPT_COMPLETION';   signal=priceDir; confidence=clamp((0.50+(0.45-norm01)*150)); }
  else if (norm01<0.45)        { trend='TREND_CONTINUATION';  signal=bias;     confidence=clamp((0.40+(0.45-norm01)*120)); }
  else if (norm01>0.75)        { trend='RANDOM'; }

  return { normalized:_rnd2(normalized), trend, signal, confidence, label:'LempelZiv' };
}

// ── ENGINE 9: KURAMOTO OSCILLATOR SYNCHRONIZATION (coupled oscillators) ──────
function kuramotoSynchronization(candles) {
  if (!candles||candles.length<25)
    return { r:0, phase_angle:0, synchronized:false, signal:'NEUTRAL', confidence:0, label:'Kuramoto' };

  const closes = candles.map(c=>c.c).filter(v=>!isNaN(v));
  if (closes.length<20) return { r:0, phase_angle:0, synchronized:false, signal:'NEUTRAL', confidence:0, label:'Kuramoto' };

  const toPhase = (val,mn,mx) => ((val-mn)/(mx-mn+1e-10)*2-1)*Math.PI;
  const rsiCalc = (arr,p) => {
    if (arr.length<p+1) return 50;
    let g=0,l=0;
    for (let i=arr.length-p;i<arr.length;i++) {
      const d=arr[i]-arr[i-1]; if(d>0)g+=d; else l-=d;
    }
    const rs=l===0?100:g/l; return 100-100/(1+rs);
  };
  const emaC=(arr,p)=>{ const k=2/(p+1); let e=arr[0]; for(let i=1;i<arr.length;i++) e=arr[i]*k+e*(1-k); return e; };

  const rsi14 = rsiCalc(closes,14);
  const rsi7  = rsiCalc(closes,7);
  const mom8  = closes.length>=9 ? (closes[closes.length-1]-closes[closes.length-9])/closes[closes.length-9]*100 : 0;
  const mom15 = closes.length>=16? (closes[closes.length-1]-closes[closes.length-16])/closes[closes.length-16]*100 : 0;
  const ema10 = emaC(closes.slice(-12),10);
  const ema20 = emaC(closes.slice(-22),20);
  const macd  = closes.length>=26 ? (emaC(closes.slice(-14),12)-emaC(closes.slice(-28),26))/(emaC(closes.slice(-28),26)||1)*100 : 0;
  const bb_pos = (() => {
    const sl=closes.slice(-12); const m=_mean(sl); const sd=Math.sqrt(_variance(sl))||1;
    const up=m+2*sd,lo=m-2*sd; return up>lo ? (closes[closes.length-1]-lo)/(up-lo) : 0.5;
  })();

  const thetas=[
    toPhase(rsi14,0,100), toPhase(rsi7,0,100),
    toPhase(mom8,-15,15), toPhase(mom15,-20,20),
    toPhase(ema10>0?(closes[closes.length-1]-ema10)/ema10*100:0,-8,8),
    toPhase(ema20>0?(closes[closes.length-1]-ema20)/ema20*100:0,-12,12),
    toPhase(macd,-5,5), toPhase(bb_pos*100,0,100)
  ];
  const cosSum=thetas.reduce((s,t)=>s+Math.cos(t),0)/thetas.length;
  const sinSum=thetas.reduce((s,t)=>s+Math.sin(t),0)/thetas.length;
  const r=Math.sqrt(cosSum*cosSum+sinSum*sinSum);
  const angle=Math.atan2(sinSum,cosSum);
  const syncDir = angle>0 ? 'BUY':'SELL';

  let signal='NEUTRAL', confidence=0;
  if (r>0.85)      { signal=syncDir; confidence=clamp((0.65+(r-0.85)*2.5)*100); }
  else if (r>0.70) { signal=syncDir; confidence=clamp((0.45+(r-0.70)*1.5)*100); }
  else if (r>0.50) { signal=syncDir; confidence=clamp((0.30+(r-0.50)*1.0)*100); }

  return { r:_rnd2(r), phase_angle:_rnd2(angle*180/Math.PI), synchronized:r>0.70, signal, confidence, label:'Kuramoto' };
}

// ── ENGINE 10: STOCHASTIC RESONANCE DETECTOR (DFT signal-to-noise ratio) ─────
function stochasticResonanceDetector(candles) {
  if (!candles||candles.length<24)
    return { snr:0, resonance:false, signal:'NEUTRAL', confidence:0, label:'StochasticResonance' };
  const closes = candles.map(c=>c.c).filter(v=>!isNaN(v));
  if (closes.length<16) return { snr:0, resonance:false, signal:'NEUTRAL', confidence:0, label:'StochasticResonance' };

  const n  = Math.min(32, closes.length);
  const arr= closes.slice(-n);
  const mn = _mean(arr);
  const sd = Math.sqrt(_variance(arr))||1;
  const norm= arr.map(x=>(x-mn)/sd);
  const N  = norm.length;
  const Re = new Array(N).fill(0), Im = new Array(N).fill(0);
  for (let k=0;k<N;k++) for (let t=0;t<N;t++) {
    const a=2*Math.PI*k*t/N; Re[k]+=norm[t]*Math.cos(a); Im[k]-=norm[t]*Math.sin(a);
  }
  const P = Re.map((r,i)=>r*r+Im[i]*Im[i]);
  const half = Math.floor(N/2);
  const spec = P.slice(1,half);
  if (!spec.length||spec.every(p=>p===0)) return { snr:0, resonance:false, signal:'NEUTRAL', confidence:0, label:'StochasticResonance' };

  const sigBand  = spec.filter((_,i)=>(i+1)/N<0.15);
  const noiseBand= spec.filter((_,i)=>(i+1)/N>0.25);
  const sigP  = sigBand.length  ? _mean(sigBand)   : 0;
  const noiseP= noiseBand.length ? _mean(noiseBand) : 1;
  const snr   = noiseP>0 ? sigP/noiseP : 0;

  const domIdx  = spec.indexOf(Math.max(...spec))+1;
  const domRe   = Re[domIdx];
  const dir     = domRe>0 ? 'BUY':'SELL';
  const resonance = snr>2.5;

  let signal='NEUTRAL', confidence=0;
  if (resonance)   { signal=dir; confidence=clamp((0.45+(snr-2.5)*0.08)*100); }
  else if (snr>3.5){ signal=dir; confidence=clamp((0.38+(snr-3.5)*0.05)*100); }

  return { snr:_rnd2(snr), resonance, signal, confidence, label:'StochasticResonance' };
}

// ── ENGINE 11: CANDL E DNA SEQUENCER (genomics-inspired pattern matching) ────
function candleDNASequencer(candles) {
  if (!candles||candles.length<20)
    return { direction:'NEUTRAL', confidence:0, sequence:'', label:'CandleDNA' };

  const slice=candles.slice(-40);
  const trs=[];
  for (let i=1;i<slice.length;i++) { const tr=slice[i].h-slice[i].l; if(!isNaN(tr)) trs.push(tr); }
  const avgATR=_mean(trs)||1;

  function encodeC(c) {
    if (!c||isNaN(c.o)||isNaN(c.c)) return 'D';
    const body=Math.abs(c.c-c.o), range=c.h-c.l||0.0001;
    const bodyPct=body/range;
    const upW=c.h-Math.max(c.c,c.o), downW=Math.min(c.c,c.o)-c.l;
    const isBull=c.c>c.o, isStrong=body>avgATR*0.5;
    if (bodyPct<0.1)               return 'D';
    if (upW>body*2&&downW<body)    return 'W';
    if (downW>body*2&&upW<body)    return 'w';
    if (isBull) return isStrong?'B':'b';
    return isStrong?'S':'s';
  }

  const dna = slice.map(encodeC).join('');
  const seqLen=3;
  const freq={};
  for (let i=0;i<=dna.length-seqLen-1;i++) {
    const sq=dna.slice(i,i+seqLen), nx=dna[i+seqLen];
    if (!freq[sq]) freq[sq]={bull:0,bear:0,total:0};
    if ('Bb'.includes(nx)||nx==='w') freq[sq].bull++;
    else if ('Ss'.includes(nx)||nx==='W') freq[sq].bear++;
    freq[sq].total++;
  }

  const cur=dna.slice(-seqLen), stats=freq[cur];
  if (!stats||stats.total<2) return { direction:'NEUTRAL', confidence:0, sequence:cur, label:'CandleDNA' };

  const bullP=stats.bull/stats.total, bearP=stats.bear/stats.total;
  let direction='NEUTRAL', confidence=0;
  if (bullP>0.6)      { direction='BUY';  confidence=clamp((bullP-0.5)*200); }
  else if (bearP>0.6) { direction='SELL'; confidence=clamp((bearP-0.5)*200); }

  return { direction, confidence, sequence:cur, bullProb:_rnd2(bullP), label:'CandleDNA' };
}

// ── ENGINE 12: ADVERSARIAL PATTERN DETECTOR (retail trap fade) ───────────────
function adversarialPatternDetector(candles) {
  if (!candles||candles.length<20)
    return { signal:'NEUTRAL', confidence:0, patterns:[], fadeScore:0, label:'Adversarial' };
  const highs=candles.map(c=>c.h).filter(v=>!isNaN(v));
  const lows =candles.map(c=>c.l).filter(v=>!isNaN(v));
  const vols =candles.map(c=>c.v).filter(v=>!isNaN(v));
  const avgVol=_mean(vols.slice(-15))||1;
  const pats=[];
  let aScore=0;

  const l20H=highs.slice(-20), l20L=lows.slice(-20);
  let mxH=-Infinity,smH=-Infinity,mxI=-1,smI=-1;
  l20H.forEach((h,i)=>{ if(h>mxH){smH=mxH;smI=mxI;mxH=h;mxI=i;}else if(h>smH&&i!==mxI){smH=h;smI=i;}});
  if (mxH>0&&smH>0&&Math.abs(mxI-smI)>3) {
    const sim=1-Math.abs(mxH-smH)/mxH;
    if (sim>0.99) { pats.push({type:'DOUBLE_TOP',bias:'BEARISH_SETUP'}); aScore+=sim*0.4; }
  }

  let mnL=Infinity,smnL=Infinity,mnI=-1,smnI=-1;
  l20L.forEach((l,i)=>{ if(l<mnL){smnL=mnL;smnI=mnI;mnL=l;mnI=i;}else if(l<smnL&&i!==mnI){smnL=l;smnI=i;}});
  if (mnL>0&&smnL>0&&Math.abs(mnI-smnI)>3) {
    const sim=1-Math.abs(mnL-smnL)/mnL;
    if (sim>0.99) { pats.push({type:'DOUBLE_BOTTOM',bias:'BULLISH_SETUP'}); aScore+=sim*0.4; }
  }

  const lVol=vols[vols.length-1]||0;
  aScore*=(lVol>avgVol*2?1.3:lVol>avgVol*1.5?1.15:1.0);

  let signal='NEUTRAL', confidence=0;
  if (aScore>0.35&&pats.length>0) {
    const lp=pats[pats.length-1];
    if (lp.bias==='BEARISH_SETUP')      { signal='BUY';  confidence=clamp(aScore*60); }
    else if (lp.bias==='BULLISH_SETUP') { signal='SELL'; confidence=clamp(aScore*60); }
  }

  return { signal, confidence, patterns:pats.map(p=>p.type), fadeScore:_rnd2(aScore), label:'Adversarial' };
}

// ── ENGINE 13: NEWS SENTIMENT (Fear & Greed index via alternative.me) ────────
const _sentimentCache = { data:null, ts:0 };
async function fetchFearGreedIndex() {
  const CACHE_MS = 15*60*1000; // 15-min cache
  if (_sentimentCache.data && Date.now()-_sentimentCache.ts < CACHE_MS) return _sentimentCache.data;
  try {
    const res = await axios.get('https://api.alternative.me/fng/?limit=1', { timeout:4000 });
    const d   = res.data?.data?.[0];
    if (!d) return null;
    const val = parseInt(d.value, 10);
    const sentiment = {
      fearGreedIndex:   val,
      classification:   d.value_classification,
      signal:           val>=65?'BUY':val<=35?'SELL':'NEUTRAL',
      confidence:       val>=65?clamp((val-65)*2):val<=35?clamp((35-val)*2):0,
    };
    _sentimentCache.data = sentiment;
    _sentimentCache.ts   = Date.now();
    return sentiment;
  } catch (_) { return null; }
}

// ── SMART MONEY COMPOSITE INDEX (aggregate all science engine votes) ──────────
function computeSMCI(engines) {
  const WEIGHTS = {
    LiquidityGravity: 1.6, EntropyCascade: 1.3, Bifurcation: 1.2,
    ResonantFreq:1.3, VCR:1.5, RQA:2.0, Thermodynamic:1.8,
    LempelZiv:1.6, Kuramoto:1.7, StochasticResonance:1.4,
    CandleDNA:1.0, Adversarial:1.2,
  };
  let buyScore=0, sellScore=0, totalW=0;
  for (const eng of engines) {
    if (!eng||eng.signal==='NEUTRAL'||!eng.confidence) continue;
    const label = eng.label || 'Unknown';
    const w     = WEIGHTS[label]||1.0;
    const conf  = eng.confidence/100; // normalise to 0-1
    if (eng.signal==='BUY')       buyScore  +=w*conf;
    else if (eng.signal==='SELL') sellScore +=w*conf;
    totalW+=w;
  }
  if (totalW===0) return { direction:'NEUTRAL', smci:0, confidence:0 };
  const maxPoss = totalW; // each weight×1 max
  const smci    = ((buyScore-sellScore)/maxPoss)*100;
  const direction = smci>20?'BUY':smci<-20?'SELL':'NEUTRAL';
  const confidence= clamp(Math.abs(smci));
  return { direction, smci:_rnd2(smci), confidence };
}

// ════════════════════════════════════════════════════════════════════════════
// SECTION 15C — PRE-MOMENTUM INTELLIGENCE LAYER (v8.1)
// Purpose: Find the token BEFORE the crowd. Detect the 3-minute window where
// volume is building silently while price is still flat — pure accumulation.
// Every function here is about executing BEFORE momentum is publicly visible.
// ════════════════════════════════════════════════════════════════════════════

// ── 1. PRE-PUMP SIGNATURE: Volume/price divergence = stealth accumulation ───
// The single most powerful early-entry signal: volume rising, price still flat.
// Smart money absorbs supply before the move — this catches that window.
function detectPrePumpSignature(onChain, priceHistory) {
  const vols   = priceHistory.map(h => safeNum(h.volume_usd, 0)).filter(v => v > 0);
  const prices = priceHistory.map(h => safeNum(h.price_usd,  0)).filter(p => p > 0);
  let score = 0;
  const signals = [];

  // Core signal: volume rising while price flat (accumulation phase)
  if (vols.length >= 5 && prices.length >= 5) {
    const rv  = vols.slice(-5);
    const rp  = prices.slice(-5);
    const volTrend   = (rv[4] - rv[0]) / (rv[0] || 1);
    const priceDelta = Math.abs((rp[rp.length-1] - rp[0]) / (rp[0] || 1));

    if (volTrend > 0.30 && priceDelta < 0.06) {
      score += 38;
      signals.push(`STEALTH_ACCUM: vol+${(volTrend*100).toFixed(0)}% price flat ${(priceDelta*100).toFixed(1)}%`);
    } else if (volTrend > 0.15 && priceDelta < 0.10) {
      score += 22;
      signals.push(`Early build: vol+${(volTrend*100).toFixed(0)}% low price impact`);
    } else if (volTrend > 0.08 && priceDelta < 0.15) {
      score += 10;
      signals.push(`Vol building with limited price move`);
    }

    // Volume acceleration: each candle bigger than the last = demand curve
    let accel = 0;
    for (let i = 1; i < rv.length; i++) if (rv[i] > rv[i-1]) accel++;
    if (accel >= 4) { score += 15; signals.push(`Volume acceleration: ${accel}/4 rising periods`); }
    else if (accel >= 3) { score += 8; }
  }

  // Holder growth = organic interest, not bots
  const hgr = onChain.holderGrowthRate ?? 0;
  if (hgr > 0.30)      { score += 22; signals.push(`Holder surge: +${(hgr*100).toFixed(0)}%`); }
  else if (hgr > 0.18) { score += 14; signals.push(`Holder growth: +${(hgr*100).toFixed(0)}%`); }
  else if (hgr > 0.08) { score += 6; }

  // Age sweet spot — token survived initial wave, still very early
  const age = onChain.ageHours ?? 999;
  if      (age >= 0.25 && age <= 2)  { score += 22; signals.push(`Prime entry window: ${age.toFixed(2)}h old`); }
  else if (age >  2    && age <= 6)  { score += 16; signals.push(`Early stage: ${age.toFixed(1)}h old`); }
  else if (age >  6    && age <= 16) { score += 8;  signals.push(`Pre-discovery: ${age.toFixed(1)}h old`); }
  else if (age > 48)                 { score -= 10; } // Too old for early entry

  // Micro-cap = explosive upside (small buys move price big)
  const mc = onChain.marketCap ?? 0;
  if      (mc > 0 && mc < 500_000)   { score += 22; signals.push(`Micro-cap: $${(mc/1000).toFixed(0)}k`); }
  else if (mc > 0 && mc < 1_500_000) { score += 14; signals.push(`Low-cap: $${(mc/1000).toFixed(0)}k`); }
  else if (mc > 0 && mc < 4_000_000) { score += 7;  signals.push(`Small-cap: $${(mc/1000).toFixed(0)}k`); }
  else if (mc > 20_000_000)          { score -= 8; } // Large cap = slower moves

  // Tx velocity — healthy demand, not a bot spike
  const tv = onChain.txVelocity ?? 0;
  if (tv > 0.25 && tv < 0.60) { score += 12; signals.push(`Clean tx velocity: ${tv.toFixed(2)}`); }
  else if (tv > 0.60)         { score -= 8;  signals.push(`Velocity too high — possible bots`); }

  const s = Math.min(100, score);
  return {
    score: s, signals,
    isPrepump: s >= 65,
    tier: s >= 85 ? 'APEX' : s >= 70 ? 'STRONG' : s >= 55 ? 'EARLY' : 'WEAK',
  };
}

// ── 2. STEALTH ACCUMULATION FINGERPRINT ──────────────────────────────────────
// Detects quiet multi-wallet buying before any announcement.
// The key: MORE buyers than sellers, dev wallet quiet, volume building in steps.
function detectStealthAccumulation(heliusTx, onChain, priceHistory) {
  let score = 50;
  const signals = [];

  // Net buy pressure (most important signal)
  const buyers  = heliusTx.uniqueBuyers  ?? 0;
  const sellers = heliusTx.uniqueSellers ?? 0;
  const bsRatio = sellers > 0 ? buyers / sellers : (buyers > 0 ? 4 : 1);
  if      (bsRatio >= 3.0) { score += 28; signals.push(`Dominant buyers: ${bsRatio.toFixed(1)}x`); }
  else if (bsRatio >= 2.0) { score += 18; signals.push(`Strong net buy: ${bsRatio.toFixed(1)}x`); }
  else if (bsRatio >= 1.4) { score += 10; signals.push(`Net buy pressure: ${bsRatio.toFixed(1)}x`); }
  else if (bsRatio <  0.8) { score -= 22; signals.push(`Net sell pressure: ${(1/bsRatio).toFixed(1)}x`); }

  // Dev wallet quiet = no pending rug
  if (!heliusTx.devWalletActive) { score += 12; signals.push("Dev wallet quiet"); }
  else                           { score -= 30; signals.push("DEV WALLET SELLING — danger"); }

  // Smart money position (not too concentrated = not a rug setup)
  const lwr = onChain.largeWalletRatio ?? 0;
  if      (lwr > 0.20 && lwr < 0.42) { score += 16; signals.push(`Smart money: ${(lwr*100).toFixed(0)}%`); }
  else if (lwr > 0.42 && lwr < 0.55) { score += 6; }
  else if (lwr >= 0.55)              { score -= 18; signals.push(`Dangerous concentration: ${(lwr*100).toFixed(0)}%`); }

  // Staircase volume build (not a spike = sustainable accumulation)
  const vols = priceHistory.map(h => safeNum(h.volume_usd, 0)).filter(v => v > 0);
  if (vols.length >= 6) {
    const steps = vols.slice(-6);
    let monotonic = 0;
    for (let i = 1; i < steps.length; i++) if (steps[i] >= steps[i-1] * 0.88) monotonic++;
    if      (monotonic >= 5) { score += 18; signals.push(`Staircase build: ${monotonic}/5 ascending`); }
    else if (monotonic >= 4) { score += 10; }
    // Single-spike volume = pump-and-dump start, penalise
    const maxV = Math.max(...steps), avgV = _mean(steps);
    if (maxV > avgV * 3.5 && steps.indexOf(maxV) === steps.length - 1) {
      score -= 15; signals.push("Volume spike — possible P&D start");
    }
  }

  // Low sniper count = fair launch, not pre-sniped
  const sc = heliusTx.sniperCount ?? 0;
  if      (sc === 0)   { score += 10; signals.push("No snipers detected"); }
  else if (sc <= 2)    { score += 4; }
  else if (sc > 5)     { score -= 15; signals.push(`${sc} snipers — unfair distribution`); }

  return {
    score: clamp(score), signals,
    isStealthAccum: score >= 70,
    bsRatio: Math.round(bsRatio * 100) / 100,
  };
}

// ── 3. LIQUIDITY VACUUM SCORE ─────────────────────────────────────────────────
// Thin sell-side liquidity = even a modest buy creates an explosive price move.
// This is the structural reason a token WILL move — not sentiment, physics.
function calcLiquidityVacuumScore(onChain) {
  const liq = onChain.liquidity ?? onChain.lpDepth ?? 0;
  const mc  = onChain.marketCap  ?? 0;
  const vol = onChain.volume24h  ?? onChain.volumeUsd ?? 0;
  if (liq <= 0) return { score: 0, vacuum: false, vlRatio: 0, signals: [] };

  let score = 0;
  const signals = [];

  // Vol/Liquidity ratio — buying pressure vs available exit liquidity
  const vlRatio = vol / liq;
  if      (vlRatio >= 6)  { score += 38; signals.push(`Vol/Liq ${vlRatio.toFixed(1)}x — explosive vacuum`); }
  else if (vlRatio >= 3)  { score += 26; signals.push(`Vol/Liq ${vlRatio.toFixed(1)}x — strong vacuum`); }
  else if (vlRatio >= 1.5){ score += 16; signals.push(`Vol/Liq ${vlRatio.toFixed(1)}x — building`); }
  else if (vlRatio >= 0.5){ score += 6; }

  // Absolute liquidity — smaller book = bigger price impact per dollar
  if      (liq < 300_000)   { score += 30; signals.push(`Micro-liquidity: $${(liq/1000).toFixed(0)}k`); }
  else if (liq < 800_000)   { score += 22; signals.push(`Low-liquidity: $${(liq/1000).toFixed(0)}k`); }
  else if (liq < 2_000_000) { score += 12; signals.push(`Med-liquidity: $${(liq/1000).toFixed(0)}k`); }
  else if (liq > 10_000_000){ score -= 10; } // Deep liquidity mutes moves

  // MC/Liq efficiency — how much price moves per dollar of liquidity
  if (mc > 0 && liq > 0) {
    const mcl = mc / liq;
    if      (mcl < 2)   { score += 22; signals.push(`MC/Liq ${mcl.toFixed(1)}x — ultra-thin book`); }
    else if (mcl < 4)   { score += 14; signals.push(`MC/Liq ${mcl.toFixed(1)}x — thin book`); }
    else if (mcl < 8)   { score += 6; }
    else if (mcl > 20)  { score -= 5; }
  }

  return {
    score: Math.min(100, score), signals,
    vacuum: score >= 65,
    vlRatio: Math.round(vlRatio * 10) / 10,
  };
}

// ── 4. SCIENCE ENGINE CONSENSUS GATE ─────────────────────────────────────────
// Premium weighted vote across all 12 science engines.
// RQA, Kuramoto, Thermodynamic, VCR, LZ = premium (higher weight).
// Requires NET BUY majority before any early-entry alert fires.
function scienceConsensusGate(smci, sciEngines) {
  const PREMIUM = new Set(['RQA','Kuramoto','Thermodynamic','VCR','LempelZiv','StochasticResonance']);
  let buyW = 0, sellW = 0, premiumBuy = 0, premiumSell = 0;

  for (const eng of sciEngines) {
    if (!eng || !eng.signal || eng.signal === 'NEUTRAL' || !eng.confidence) continue;
    const isPrem = PREMIUM.has(eng.label);
    const w      = isPrem ? 1.5 : 1.0;
    if      (eng.signal === 'BUY')  { buyW  += w; if (isPrem) premiumBuy++; }
    else if (eng.signal === 'SELL') { sellW += w; if (isPrem) premiumSell++; }
  }

  const netVotes   = buyW - sellW;
  const rawBuyCount  = sciEngines.filter(e => e?.signal === 'BUY').length;
  const rawSellCount = sciEngines.filter(e => e?.signal === 'SELL').length;

  const level = netVotes >= 10 ? 'OVERWHELMING'
              : netVotes >= 7  ? 'STRONG'
              : netVotes >= 4  ? 'MODERATE'
              : netVotes >= 2  ? 'WEAK'
              : 'NONE';

  const consensus = netVotes > 0 ? 'BUY' : netVotes < 0 ? 'SELL' : 'NEUTRAL';
  const pass      = (level === 'MODERATE' || level === 'STRONG' || level === 'OVERWHELMING') && consensus === 'BUY';

  return {
    buyVotes: Math.round(buyW * 10) / 10,
    sellVotes: Math.round(sellW * 10) / 10,
    netVotes: Math.round(netVotes * 10) / 10,
    rawBuyCount, rawSellCount, premiumBuy, premiumSell,
    consensus, level, pass,
  };
}

// ── 5. PRE-MOMENTUM COMPOSITE SCORE ──────────────────────────────────────────
// Aggregates all early-entry signals into one decisive score.
// APEX_ENTRY (85+) = execute immediately, maximum size.
// STRONG_EARLY_ENTRY (72+) = high conviction, execute.
// EARLY_ENTRY (58+) = confirmed edge, smaller size.
// Below 58 = no clear early-entry edge — skip.
function calcPreMomentumScore(prePump, stealthAccum, liquidityVacuum, sciConsensus, walletCluster) {
  // Consensus multiplier — engines must agree or score is damped
  const CONSENSUS_MULT = { OVERWHELMING:1.00, STRONG:0.85, MODERATE:0.70, WEAK:0.50, NONE:0.25 };
  const cm = CONSENSUS_MULT[sciConsensus.level] ?? 0.25;

  // Premium buy engine bonus (RQA/Kuramoto/Thermo = real institutional signal)
  const premiumBonus = Math.min(15, sciConsensus.premiumBuy * 5);

  const raw =
    prePump.score        * 0.28 +   // volume/price divergence (core signal)
    stealthAccum.score   * 0.24 +   // wallet behavior fingerprint
    liquidityVacuum.score* 0.20 +   // structural explosive potential
    walletCluster.score  * 0.14 +   // clean wallet health
    sciConsensus.netVotes * 3.5 +   // weighted engine vote (up to ~18 pts)
    premiumBonus;                   // premium engine bonus

  const score = clamp(raw * cm);

  const tier = score >= config.apexEntryMin   ? 'APEX_ENTRY'
             : score >= config.strongEntryMin  ? 'STRONG_EARLY_ENTRY'
             : score >= config.earlyEntryMin   ? 'EARLY_ENTRY'
             : score >= 40                     ? 'WATCH'
             : 'SKIP';

  const shouldAlert = (tier === 'APEX_ENTRY' || tier === 'STRONG_EARLY_ENTRY' || tier === 'EARLY_ENTRY')
                   && sciConsensus.consensus === 'BUY'
                   && sciConsensus.pass;

  return {
    score:          Math.round(score * 10) / 10,
    tier,
    shouldAlert,
    consensusLevel: sciConsensus.level,
    premiumBonus,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// SECTION 16 — WALLET CLUSTER ANALYZER (v8: real alpha signals)
// ════════════════════════════════════════════════════════════════════════════

class WalletClusterAnalyzer {
  // Score wallet health: 0-100 (higher = safer/more genuine)
  analyzeWalletCluster(onChain, heliusTxData) {
    let score = 50; // neutral baseline
    const flags = [];

    // Dev wallet selling early = dump risk
    if (heliusTxData.devWalletActive) {
      score -= 25;
      flags.push("Dev wallet active seller — dump risk");
    }

    // Sniper bots: indicate early unfair distribution
    if (heliusTxData.sniperCount > config.sniperTxThreshold) {
      const penalty = Math.min(30, heliusTxData.sniperCount * 5);
      score -= penalty;
      flags.push(`${heliusTxData.sniperCount} sniper wallets detected`);
    }

    // Healthy buyer/seller ratio (more unique buyers than sellers)
    if (heliusTxData.uniqueBuyers > 0 && heliusTxData.uniqueSellers > 0) {
      const ratio = heliusTxData.uniqueBuyers / (heliusTxData.uniqueBuyers + heliusTxData.uniqueSellers);
      if (ratio > 0.65) {
        score += 20;
        flags.push(`Strong buyer dominance (${(ratio * 100).toFixed(0)}% buyers)`);
      } else if (ratio < 0.35) {
        score -= 20;
        flags.push(`Seller dominance (${((1 - ratio) * 100).toFixed(0)}% sellers)`);
      }
    }

    // Creator/dev concentration via Birdeye (high = rug risk)
    if (onChain.creatorPct > 20) {
      score -= 15;
      flags.push(`Creator holds ${onChain.creatorPct.toFixed(1)}% of supply`);
    } else if (onChain.creatorPct > 0 && onChain.creatorPct < 5) {
      score += 10;
      flags.push("Creator concentration healthy (<5%)");
    }

    // First liquidity window: very early tokens can have outsized sniper risk
    if (onChain.dexRaw?.isFirstLiquidityWindow) {
      score -= 10;
      flags.push("Token in first-liquidity window (<2h old)");
    }

    return { score: clamp(score), flags };
  }

  // Institutional footprint: detect smart money accumulation
  detectSmartMoneyFlow(onChain, priceHistory) {
    let flowIndex = 50;
    const signals = [];

    // Whale sweet spot: 25-45% = smart money accumulating, not a rug
    if (onChain.largeWalletRatio > 0.25 && onChain.largeWalletRatio < 0.45) {
      flowIndex += 15;
      signals.push("Whale sweet spot accumulation (25-45%)");
    }
    if (onChain.txVelocity > 0.35) { flowIndex += 12; signals.push("Tx velocity spike"); }
    if (onChain.holderGrowthRate > 0.2) { flowIndex += 18; signals.push("Rapid holder growth"); }
    if (onChain.volumeSpike > 1.2 && onChain.volumeSpike < 2.0) { flowIndex += 10; signals.push("Moderate volume surge"); }

    // Red flags
    if (onChain.largeWalletRatio > 0.55) { flowIndex -= 25; signals.push("Dangerous concentration >55%"); }
    if (onChain.txVelocity > 0.7) { flowIndex -= 15; signals.push("Tx overload — possible bot activity"); }
    if (onChain.volumeSpike > 3.0) { flowIndex -= 20; signals.push("Extreme volume spike — exit risk"); }

    const prices = priceHistory.map(h => h.price_usd).filter(p => p > 0);
    if (prices.length > 5) {
      const priceMomentum = (prices[prices.length - 1] - prices[prices.length - 5]) / prices[prices.length - 5];
      if (flowIndex > 65 && priceMomentum < 0.05) { flowIndex += 10; signals.push("Accumulation with stable price"); }
      if (flowIndex < 35 && priceMomentum > 0.15) { flowIndex -= 15; signals.push("Distribution with pumping price — trap"); }
    }

    return { score: clamp(Math.max(0, Math.min(100, flowIndex))), signals };
  }

  // Distribution detection (exit signal)
  detectDistribution(onChain, priceHistory) {
    let distScore = 0;
    const signals = [];

    if (onChain.largeWalletRatio > 0.55) {
      distScore += Math.min(60, (onChain.largeWalletRatio - 0.5) * 300);
      signals.push(`Critical concentration: ${(onChain.largeWalletRatio * 100).toFixed(1)}%`);
    }
    if (onChain.volumeSpike > 2.5 && onChain.holderGrowthRate < 0.08) {
      distScore += 45;
      signals.push("Volume without holder growth");
    }

    const volumes = priceHistory.map(h => h.volume_usd).filter(v => v > 0);
    const prices  = priceHistory.map(h => h.price_usd).filter(p => p > 0);
    if (volumes.length > 10 && prices.length > 10) {
      const priceChg  = (prices[prices.length - 1] - prices[prices.length - 5]) / prices[prices.length - 5];
      const volChg    = (volumes[volumes.length - 1] - volumes[volumes.length - 5]) / volumes[volumes.length - 5];
      if (priceChg > 0.1 && volChg < -0.2) { distScore += 35; signals.push("Bearish divergence: price up, volume down"); }
    }
    if (onChain.holderGrowthRate < 0.05 && onChain.recentTxCount > 500) {
      distScore += 30;
      signals.push("Holder stagnation at high tx count");
    }

    return {
      score: Math.min(100, distScore),
      isDistributing: distScore > 60,
      signals,
      riskLevel: distScore > 80 ? "EXTREME" : distScore > 60 ? "HIGH" : distScore > 40 ? "MODERATE" : "LOW",
    };
  }
}

const walletAnalyzer = new WalletClusterAnalyzer();

// ════════════════════════════════════════════════════════════════════════════
// SECTION 17 — CAPITAL PROTECTION GATE (v8: hard SKIP_TRADE)
// Fires before any BUY alert is sent. Prevents capital deployment into
// tokens with active distribution or pending reversal.
// ════════════════════════════════════════════════════════════════════════════

function capitalProtectionGate(distribution, fractalResult, walletCluster) {
  const reasons = [];

  // Hard gate 1: distribution score > threshold
  if (distribution.score > config.distributionSkipMin) {
    reasons.push(`Distribution score ${distribution.score.toFixed(0)} > ${config.distributionSkipMin} (${distribution.riskLevel})`);
  }

  // Hard gate 2: fractal reversal confidence > threshold
  if (fractalResult.reversalRisk > config.reversalSkipMin) {
    reasons.push(`Reversal risk ${(fractalResult.reversalRisk * 100).toFixed(0)}% > ${(config.reversalSkipMin * 100).toFixed(0)}%`);
  }

  // Hard gate 3: wallet cluster score very low (sniper/dev risk)
  if (walletCluster.score < 30) {
    reasons.push(`Wallet cluster score ${walletCluster.score} < 30 (${walletCluster.flags.join(", ")})`);
  }

  if (reasons.length > 0) {
    return { action: "SKIP_TRADE", reasons };
  }
  return { action: "PASS", reasons: [] };
}

// ════════════════════════════════════════════════════════════════════════════
// SECTION 18 — MASTER SCORE + GRADE
// ════════════════════════════════════════════════════════════════════════════

function gradeFromScore(s) {
  if (s >= 90) return "S";
  if (s >= 75) return "A";
  if (s >= 60) return "B";
  if (s >= 45) return "C";
  return "D";
}

function recommendationFromAll(composite, certainty, pumpProb, walletRatio, dir, capitalGate, preMomentumTier) {
  if (capitalGate === "SKIP_TRADE") return "AVOID";
  if (walletRatio > 0.7)            return "AVOID";
  // Pre-momentum tiers override standard labels — these are EXECUTE signals
  if (preMomentumTier === "APEX_ENTRY"         && dir === "BUY") return "APEX_ENTRY";
  if (preMomentumTier === "STRONG_EARLY_ENTRY" && dir === "BUY") return "STRONG_EARLY_ENTRY";
  if (preMomentumTier === "EARLY_ENTRY"        && dir === "BUY") return "EARLY_ENTRY";
  if (certainty >= 80 && composite >= 80 && pumpProb >= 70)      return "STRONG_BUY";
  if (composite >= 70 && dir === "BUY")  return "BUY";
  if (composite >= 50 && dir === "BUY")  return "WATCH";
  if (dir === "SELL")                    return "AVOID";
  return "WATCH";
}

async function scoreMint(mint) {
  const dexHint = _dexCache.get(mint) ?? null;

  const [onChain, meta, heliusTx] = await Promise.all([
    fetchTokenOnChainData(mint, dexHint),
    fetchTokenMeta(mint),
    fetchHeliusTxData(mint),
  ]);

  await upsertToken({ mint, name: meta.name, symbol: meta.symbol, decimals: onChain.decimals, supply: onChain.supply });
  await recordPriceHistory(mint, { priceUsd: onChain.priceUsd, volumeUsd: onChain.volumeUsd, marketCap: onChain.marketCap, txCount: onChain.recentTxCount, holderCount: onChain.holderCount });

  const priceHistory = await getPriceHistory(mint, 48);

  // ── 6D ORIGINAL SCORES ────────────────────────────────────────────────
  const whaleScore     = calcWhaleScore(onChain);
  const smartMoney     = calcSmartMoneyScore(onChain);
  const volumeAnomaly  = calcVolumeAnomalyScore(onChain);
  const holderVelocity = calcHolderVelocityScore(onChain);
  const liquidity      = calcLiquidityScore(onChain);

  // ── ADVANCED ENGINES ─────────────────────────────────────────────────
  const techScore  = computeTechnicalScore(priceHistory);
  const wyckoff    = detectWyckoffPhase(onChain, priceHistory);
  const hiddenFlow = detectHiddenFlow(onChain, priceHistory);
  const consensus  = buildMultiTFConsensus(onChain, priceHistory, techScore, wyckoff, hiddenFlow);
  const instCtx    = buildInstitutionalContext(onChain, wyckoff, hiddenFlow, consensus);
  const pumpProb   = calcPumpProbability(onChain, techScore, wyckoff, hiddenFlow);

  // ── V8: FRACTAL ANALYSIS (Hurst exponent — no randomness) ─────────────
  const prices = priceHistory.map(h => safeNum(h.price_usd, 0)).filter(p => p > 0);
  const fractalResult = fractalAnalyzer.scoreFractal(prices);

  // ── V8: WALLET CLUSTER ANALYSIS ───────────────────────────────────────
  const walletCluster  = walletAnalyzer.analyzeWalletCluster(onChain, heliusTx);
  const smartMoneyFlow = walletAnalyzer.detectSmartMoneyFlow(onChain, priceHistory);
  const distribution   = walletAnalyzer.detectDistribution(onChain, priceHistory);

  // Institutional score = blend of smart money flow + accumulation signals
  const institutionalScore = clamp(smartMoneyFlow.score * 0.6 + (100 - distribution.score) * 0.4);

  // ── V8: CAPITAL PROTECTION GATE ───────────────────────────────────────
  const capitalGate = capitalProtectionGate(distribution, fractalResult, walletCluster);

  // ── V8: REGION__ SCIENTIFIC ENGINE SUITE ──────────────────────────────
  // Build synthetic candles from price history for engine suite
  const synCandles = buildSyntheticCandles(priceHistory);
  const currentPx  = prices[prices.length - 1] || 0;

  const sciLiqGrav  = liquidityGravityEngine(synCandles, currentPx);
  const sciEntropy  = entropyCascadeDetector(synCandles);
  const sciBifurc   = bifurcationDetector(synCandles);
  const sciResonant = resonantFrequencyAnalyzer(synCandles);
  const sciVCR      = volatilityCompressionRatio(synCandles);
  const sciRQA      = recurrenceQuantificationAnalysis(synCandles);
  const sciThermo   = thermodynamicMarketState(synCandles);
  const sciLZ       = lempelZivComplexity(synCandles);
  const sciKuramoto = kuramotoSynchronization(synCandles);
  const sciSR       = stochasticResonanceDetector(synCandles);
  const sciDNA      = candleDNASequencer(synCandles);
  const sciAdvers   = adversarialPatternDetector(synCandles);

  // Fear & Greed index (async, non-blocking)
  let sciFearGreed = null;
  try { sciFearGreed = await fetchFearGreedIndex(); } catch (_) {}

  // Aggregate all science engines into Smart Money Composite Index
  const sciEngines = [sciLiqGrav, sciEntropy, sciBifurc, sciResonant, sciVCR,
                      sciRQA, sciThermo, sciLZ, sciKuramoto, sciSR, sciDNA, sciAdvers];
  const smci = computeSMCI(sciEngines);

  // Convert SMCI direction-aware score to a 0-100 boost/penalty value
  const scienceScore = clamp(50 + smci.smci * 0.5);

  // ── V8.1: PRE-MOMENTUM INTELLIGENCE LAYER ─────────────────────────────
  const prePump       = detectPrePumpSignature(onChain, priceHistory);
  const stealthAccum  = detectStealthAccumulation(heliusTx, onChain, priceHistory);
  const liqVacuum     = calcLiquidityVacuumScore(onChain);
  const sciConsensus  = scienceConsensusGate(smci, sciEngines);
  const preMomentum   = calcPreMomentumScore(prePump, stealthAccum, liqVacuum, sciConsensus, walletCluster);

  // ── COMPOSITE (15-DIMENSIONAL, v8.1 final) ────────────────────────────
  const momentumScore   = techScore.score;
  const wyckoffScore    = wyckoff.confidence;
  const hiddenFlowScore = hiddenFlow.flowScore;
  const mtfScore        = consensus.certaintyScore;

  let composite = clamp(
    whaleScore              * 0.10 +
    smartMoney              * 0.09 +
    volumeAnomaly           * 0.08 +
    holderVelocity          * 0.08 +
    liquidity               * 0.05 +
    momentumScore           * 0.08 +
    wyckoffScore            * 0.07 +
    hiddenFlowScore         * 0.05 +
    mtfScore                * 0.04 +
    fractalResult.score     * 0.06 +
    walletCluster.score     * 0.04 +
    institutionalScore      * 0.04 +
    scienceScore            * 0.10 +   // Region__ science suite
    preMomentum.score       * 0.12     // Pre-momentum intelligence (execute before crowd)
  );

  // Apply capital protection penalty (hard floor)
  if (capitalGate.action === "SKIP_TRADE") composite = Math.min(composite, 45);
  // Pre-momentum APEX/STRONG lifts composite floor — these are confirmed edges
  if (preMomentum.tier === "APEX_ENTRY"         && composite < 75) composite = Math.max(composite, 72);
  if (preMomentum.tier === "STRONG_EARLY_ENTRY" && composite < 65) composite = Math.max(composite, 62);

  const direction  = consensus.consensusDir;
  const fakeSignal = { direction, confidence: composite };
  const dec        = decisionEngineV2(fakeSignal, consensus, instCtx);
  const quality    = checkQualityGate(consensus, instCtx);

  // ── V8: LEARNING MULTIPLIER (real accuracy history) ───────────────────
  let learningMultiplier = 1.0;
  try { learningMultiplier = await getLearningConfidenceMultiplier(); } catch (_) {}

  // Statistical confidence — includes pre-momentum as a signal
  const signalStrengths = [
    composite / 100,
    pumpProb / 100,
    dec.finalCert / 100,
    fractalResult.hurstExponent,
    walletCluster.score / 100,
    preMomentum.score   / 100,
    sciConsensus.netVotes / 12,
  ];
  const statConf = calcStatConfidence(signalStrengths);
  const adjustedCertainty = clamp(dec.finalCert * learningMultiplier);

  const grade          = gradeFromScore(composite);
  const recommendation = recommendationFromAll(composite, adjustedCertainty, pumpProb, onChain.largeWalletRatio, direction, capitalGate.action, preMomentum.tier);

  return {
    mint,
    name:  meta.name,
    symbol: meta.symbol,
    // 6D
    whaleScore:     Math.round(whaleScore     * 10) / 10,
    smartMoney:     Math.round(smartMoney     * 10) / 10,
    volumeAnomaly:  Math.round(volumeAnomaly  * 10) / 10,
    holderVelocity: Math.round(holderVelocity * 10) / 10,
    liquidity:      Math.round(liquidity      * 10) / 10,
    // Advanced
    momentumScore:   Math.round(momentumScore  * 10) / 10,
    wyckoffScore:    Math.round(wyckoffScore   * 10) / 10,
    hiddenFlow:      Math.round(hiddenFlowScore * 10) / 10,
    mtfScore:        Math.round(mtfScore        * 10) / 10,
    pumpProbability: Math.round(pumpProb        * 10) / 10,
    // V8 new
    fractalScore:         Math.round(fractalResult.score    * 10) / 10,
    walletClusterScore:   Math.round(walletCluster.score    * 10) / 10,
    institutionalScore:   Math.round(institutionalScore     * 10) / 10,
    hurstExponent:        Math.round(fractalResult.hurstExponent * 1000) / 1000,
    reversalRisk:         Math.round(fractalResult.reversalRisk  * 1000) / 1000,
    distributionScore:    Math.round(distribution.score     * 10) / 10,
    capitalGate:          capitalGate.action,
    capitalGateReasons:   capitalGate.reasons,
    statConfidence:       Math.round(statConf * 10) / 10,
    learningMultiplier:   Math.round(learningMultiplier * 100) / 100,
    sniperCount:          heliusTx.sniperCount,
    devWalletActive:      heliusTx.devWalletActive,
    walletFlags:          walletCluster.flags,
    // Decision
    composite:      Math.round(composite       * 10) / 10,
    certainty:      Math.round(adjustedCertainty * 10) / 10,
    grade, recommendation, direction,
    decisionStatus:  dec.status,
    decisionBoost:   dec.boost,
    decisionPenalty: dec.penalty,
    qualityPass:     quality.ok,
    qualityReason:   quality.reason,
    // Context
    wyckoffPhase:    wyckoff.phase,
    wyckoffBias:     wyckoff.bias,
    hiddenFlowDir:   hiddenFlow.direction,
    hiddenFlowConf:  hiddenFlow.confidence,
    technicalDir:    techScore.direction,
    indicators:      techScore.indicators,
    pumpReasons:     hiddenFlow.reasons,
    distributionSignals: distribution.signals,
    smartMoneySignals:   smartMoneyFlow.signals,
    // ── Pre-Momentum Intelligence (v8.1) ────────────────────────────────
    preMomentumScore:     preMomentum.score,
    preMomentumTier:      preMomentum.tier,
    preMomentumAlert:     preMomentum.shouldAlert,
    preMomentumConsensus: preMomentum.consensusLevel,
    prePumpScore:         prePump.score,
    prePumpTier:          prePump.tier,
    prePumpSignals:       prePump.signals,
    stealthAccumScore:    stealthAccum.score,
    stealthAccumSignals:  stealthAccum.signals,
    liqVacuumScore:       liqVacuum.score,
    liqVacuumVLRatio:     liqVacuum.vlRatio,
    sciConsensusBuy:      sciConsensus.rawBuyCount,
    sciConsensusSell:     sciConsensus.rawSellCount,
    sciConsensusNet:      sciConsensus.netVotes,
    sciConsensusLevel:    sciConsensus.level,
    // ── Region__ Scientific Intelligence ────────────────────────────────
    scienceScore:        Math.round(scienceScore * 10) / 10,
    smciScore:           smci.smci,
    smciDirection:       smci.direction,
    smciConfidence:      smci.confidence,
    fearGreedIndex:      sciFearGreed?.fearGreedIndex  ?? null,
    fearGreedClass:      sciFearGreed?.classification  ?? null,
    sciEngines: {
      liquidityGravity:     { dir: sciLiqGrav.direction,  conf: sciLiqGrav.confidence,  extra: sciLiqGrav.netForce },
      entropyCascade:       { dir: sciEntropy.direction,  conf: sciEntropy.confidence,  extra: sciEntropy.cascade },
      bifurcation:          { dir: sciBifurc.direction,   conf: sciBifurc.confidence,   extra: sciBifurc.autocorr },
      resonantFreq:         { dir: sciResonant.direction, conf: sciResonant.confidence, extra: sciResonant.dominantCycle },
      vcr:                  { dir: sciVCR.direction,      conf: sciVCR.confidence,      extra: sciVCR.vcr, mega: sciVCR.megaSqueeze },
      rqa:                  { phase: sciRQA.phase,        conf: sciRQA.confidence,      rr: sciRQA.rr, det: sciRQA.det, lam: sciRQA.lam },
      thermodynamic:        { phase: sciThermo.phase,     conf: sciThermo.confidence,   G: sciThermo.G, dG: sciThermo.dG },
      lempelZiv:            { trend: sciLZ.trend,         conf: sciLZ.confidence,       norm: sciLZ.normalized },
      kuramoto:             { r: sciKuramoto.r,           conf: sciKuramoto.confidence, sync: sciKuramoto.synchronized },
      stochasticResonance:  { snr: sciSR.snr,             conf: sciSR.confidence,       resonance: sciSR.resonance },
      candleDNA:            { seq: sciDNA.sequence,       conf: sciDNA.confidence,      dir: sciDNA.direction },
      adversarial:          { pats: sciAdvers.patterns,   conf: sciAdvers.confidence,   fade: sciAdvers.fadeScore },
    },
    rawData: {
      onChain, techScore, wyckoff, hiddenFlow,
      fractal: { score: fractalResult.score, hurst: fractalResult.hurstExponent, reversalRisk: fractalResult.reversalRisk },
      walletCluster: { score: walletCluster.score, flags: walletCluster.flags },
      consensus: { certaintyScore: consensus.certaintyScore, buyPct: consensus.buyPct, conviction: consensus.convictionPct },
    },
  };
}

// ════════════════════════════════════════════════════════════════════════════
// SECTION 19 — DEX AUTO-DISCOVERY ENGINE
// ════════════════════════════════════════════════════════════════════════════

function calcEarlyMoverScore({ liquidity, volume24h, marketCap, priceChange1h, priceChange24h, ageHours }) {
  let score = 0;

  if      (marketCap < 500_000)    score += 30;
  else if (marketCap < 2_000_000)  score += 22;
  else if (marketCap < 10_000_000) score += 14;
  else if (marketCap < 50_000_000) score +=  6;

  const vlRatio = liquidity > 0 ? volume24h / liquidity : 0;
  if      (vlRatio > 5) score += 25;
  else if (vlRatio > 2) score += 16;
  else if (vlRatio > 1) score +=  8;

  if      (ageHours < 2)  score += 20;
  else if (ageHours < 6)  score += 14;
  else if (ageHours < 24) score +=  8;
  else if (ageHours < 48) score +=  3;

  if      (priceChange1h > 20) score += 15;
  else if (priceChange1h > 10) score += 10;
  else if (priceChange1h >  3) score +=  5;

  if      (priceChange24h <  20) score += 10;
  else if (priceChange24h <  50) score +=  6;
  else if (priceChange24h < 100) score +=  2;

  return Math.min(score, 100);
}

async function fetchDexScreenerTokens() {
  const cfg = config;

  const addresses = new Set();
  const addToken = (tokenAddress) => {
    if (tokenAddress) addresses.add(String(tokenAddress));
  };
  const addPairs = (pairs = []) => {
    for (const pair of pairs) {
      if (pair?.chainId === "solana" && pair?.baseToken?.address) addToken(pair.baseToken.address);
    }
  };

  const [topRes, latestRes, profileRes, searchResults] = await Promise.allSettled([
    axios.get("https://api.dexscreener.com/token-boosts/top/v1", { timeout: 8000 }),
    axios.get("https://api.dexscreener.com/token-boosts/latest/v1", { timeout: 8000 }),
    axios.get("https://api.dexscreener.com/token-profiles/latest/v1", { timeout: 8000 }),
    Promise.allSettled(["pump", "moon", "pepe", "doge", "cat", "sol"].map(q =>
      axios.get(`https://api.dexscreener.com/latest/dex/search?q=${q}`, { timeout: 6000 })
    )),
  ]);

  if (topRes.status === "fulfilled") {
    for (const item of (Array.isArray(topRes.value.data) ? topRes.value.data : [])) {
      addToken(item.chainId === "solana" ? item.tokenAddress : null);
    }
  } else {
    console.error("[discovery] DexScreener top-boosts failed:", topRes.reason?.message);
  }

  if (latestRes.status === "fulfilled") {
    for (const item of (Array.isArray(latestRes.value.data) ? latestRes.value.data : [])) {
      addToken(item.chainId === "solana" ? item.tokenAddress : null);
    }
  } else {
    console.error("[discovery] DexScreener latest-boosts failed:", latestRes.reason?.message);
  }

  if (profileRes.status === "fulfilled") {
    const profiles = Array.isArray(profileRes.value.data) ? profileRes.value.data : [];
    for (const p of profiles) {
      if (p?.chainId === "solana" && p?.tokenAddress) addToken(p.tokenAddress);
    }
  } else {
    console.error("[discovery] DexScreener token-profiles failed:", profileRes.reason?.message);
  }

  if (searchResults.status === "fulfilled") {
    for (const res of searchResults.value) {
      if (res.status !== "fulfilled") continue;
      addPairs(res.value.data?.pairs ?? []);
    }
  }

  console.log(`[discovery] ${addresses.size} candidate addresses collected`);
  if (addresses.size === 0) return [];

  const discovered = [];
  const allAddresses = [...addresses];
  const BATCH = 30;

  for (let i = 0; i < allAddresses.length; i += BATCH) {
    const batch = allAddresses.slice(i, i + BATCH);
    try {
      const res = await axios.get(
        `https://api.dexscreener.com/tokens/v1/solana/${batch.join(",")}`,
        { timeout: 10000 }
      );

      // Keep only the highest-liquidity pair per token
      const tokenBest = new Map();
      for (const pair of (Array.isArray(res.data) ? res.data : res.data?.pairs ?? [])) {
        if (pair.chainId !== "solana") continue;
        const mint = pair.baseToken?.address;
        if (!mint) continue;
        const liq = parseFloat(pair.liquidity?.usd ?? 0);
        if (!tokenBest.has(mint) || liq > parseFloat(tokenBest.get(mint).liquidity?.usd ?? 0)) {
          tokenBest.set(mint, pair);
        }
      }

      for (const [mint, pair] of tokenBest) {
        const liquidity      = parseFloat(pair.liquidity?.usd    ?? 0);
        const volume24h      = parseFloat(pair.volume?.h24       ?? 0);
        const marketCap      = parseFloat(pair.fdv ?? pair.marketCap ?? 0);
        const priceChange1h  = parseFloat(pair.priceChange?.h1   ?? 0);
        const priceChange24h = parseFloat(pair.priceChange?.h24  ?? 0);
        const ageHours       = pair.pairCreatedAt
          ? (Date.now() - pair.pairCreatedAt) / 3_600_000
          : 9999;

        if (liquidity      < cfg.minLiquidityUsd)            continue;
        if (volume24h      < cfg.minVolume24hUsd)             continue;
        if (marketCap      > cfg.maxMarketCapUsd)             continue;
        if (marketCap > 0 && marketCap < cfg.minMarketCapUsd) continue;
        if (ageHours       < cfg.minTokenAgeHours)            continue;
        if (ageHours       > cfg.maxTokenAgeHours)            continue;
        if (Math.abs(priceChange1h) < cfg.minPriceChange1h)   continue;
        if (priceChange24h > cfg.maxPriceChange24h)           continue;

        discovered.push({
          mint,
          name:     pair.baseToken?.name   ?? `Token-${mint.slice(0, 6)}`,
          symbol:   pair.baseToken?.symbol ?? mint.slice(0, 4).toUpperCase(),
          source:   "dexscreener",
          liquidity, volume24h, marketCap, priceChange1h, priceChange24h,
          ageHours: Math.round(ageHours * 10) / 10,
          priceUsd: parseFloat(pair.priceUsd ?? 0),
          dexId:    pair.dexId,
          earlyScore: calcEarlyMoverScore({ liquidity, volume24h, marketCap, priceChange1h, priceChange24h, ageHours }),
        });
      }
    } catch (e) {
      console.error("[discovery] DexScreener pair-fetch batch failed:", e.message);
    }

    // Small delay between batches to respect rate limits
    if (i + BATCH < allAddresses.length) await new Promise(r => setTimeout(r, 250));
  }

  console.log(`[discovery] ${discovered.length} tokens passed filters`);
  return discovered;
}

async function fetchBirdeyeTokens() {
  if (!config.birdeyeKey) return [];
  const discovered = [];
  try {
    const res = await axios.get("https://public-api.birdeye.so/defi/tokenlist", {
      headers: { "X-API-KEY": config.birdeyeKey },
      params: { sort_by: "v24hUSD", sort_type: "desc", offset: 0, limit: 100, min_liquidity: config.minLiquidityUsd },
      timeout: 8000,
    });
    for (const t of (res.data?.data?.tokens ?? [])) {
      const marketCap      = parseFloat(t.mc           ?? 0);
      const volume24h      = parseFloat(t.v24hUSD      ?? 0);
      const liquidity      = parseFloat(t.liquidity    ?? 0);
      const priceChange24h = parseFloat(t.v24hChangePercent ?? 0);

      if (marketCap > config.maxMarketCapUsd)                        continue;
      if (marketCap > 0 && marketCap < config.minMarketCapUsd)       continue;
      if (volume24h < config.minVolume24hUsd)                        continue;
      if (priceChange24h > config.maxPriceChange24h)                 continue;

      discovered.push({
        mint:          t.address,
        name:          t.name   ?? `Token-${t.address?.slice(0,6)}`,
        symbol:        t.symbol ?? t.address?.slice(0,4).toUpperCase(),
        source:        "birdeye",
        liquidity, volume24h, marketCap,
        priceChange1h: 0, priceChange24h,
        ageHours:      0,
        priceUsd:      parseFloat(t.price ?? 0),
        earlyScore:    calcEarlyMoverScore({ liquidity, volume24h, marketCap, priceChange1h: 0, priceChange24h, ageHours: 12 }),
      });
    }
  } catch (e) { console.error("[discovery] Birdeye failed:", e.message); }
  return discovered;
}

function deduplicateAndRank(tokens) {
  const seen = new Map();
  for (const t of tokens) {
    if (!seen.has(t.mint) || seen.get(t.mint).earlyScore < t.earlyScore) seen.set(t.mint, t);
  }
  return [...seen.values()]
    .sort((a, b) => b.earlyScore - a.earlyScore)
    .slice(0, config.maxTokensPerCycle);
}

async function discoverLiveMints() {
  console.log(
    `[discovery] Live DEX scan — Liq>$${(config.minLiquidityUsd/1000).toFixed(0)}k` +
    ` Vol>$${(config.minVolume24hUsd/1000).toFixed(0)}k` +
    ` MCap<$${(config.maxMarketCapUsd/1_000_000).toFixed(0)}M` +
    ` Age:${config.minTokenAgeHours}h-${config.maxTokenAgeHours}h`
  );
  const [dexResult, birdResult] = await Promise.allSettled([fetchDexScreenerTokens(), fetchBirdeyeTokens()]);
  const all = [
    ...(dexResult.status  === "fulfilled" ? dexResult.value  : []),
    ...(birdResult.status === "fulfilled" ? birdResult.value : []),
  ];
  const ranked = deduplicateAndRank(all);
  console.log(`[discovery] ${all.length} candidates → top ${ranked.length} queued`);
  if (ranked.length > 0) {
    ranked.slice(0, 3).forEach(t =>
      console.log(`  [${t.source}] ${t.symbol} MCap=$${(t.marketCap/1000).toFixed(0)}k EarlyScore=${t.earlyScore}`)
    );
  }
  return ranked;
}

// ════════════════════════════════════════════════════════════════════════════
// SECTION 20 — SCAN LOOP
// ════════════════════════════════════════════════════════════════════════════

let lastScanAt = null;
let scanCount  = 0;
let notifyFn   = null;

function registerNotifier(fn) { notifyFn = fn; }
function getLastScanAt()  { return lastScanAt; }
function getScanCount()   { return scanCount; }

async function scanMint(mint) {
  const result = await scoreMint(mint);

  const signalId = await insertSignal({
    mint:             result.mint,
    whaleScore:       result.whaleScore,
    smartMoney:       result.smartMoney,
    volumeAnomaly:    result.volumeAnomaly,
    holderVelocity:   result.holderVelocity,
    liquidity:        result.liquidity,
    momentumScore:    result.momentumScore,
    wyckoffScore:     result.wyckoffScore,
    hiddenFlow:       result.hiddenFlow,
    mtfScore:         result.mtfScore,
    pumpProbability:  result.pumpProbability,
    fractalScore:     result.fractalScore,
    walletClusterScore: result.walletClusterScore,
    institutionalScore: result.institutionalScore,
    capitalGate:      result.capitalGate,
    composite:        result.composite,
    certainty:        result.certainty,
    grade:            result.grade,
    recommendation:   result.recommendation,
    direction:        result.direction,
    decisionStatus:   result.decisionStatus,
    decisionBoost:    result.decisionBoost,
    decisionPenalty:  result.decisionPenalty,
    qualityPass:      result.qualityPass,
    qualityReason:    result.qualityReason,
    rawData:          result.rawData,
  });

  // TRUE LEARNING LOOP: record prediction for future outcome check
  if (result.direction !== "NEUTRAL" && result.rawData?.onChain?.priceUsd > 0) {
    await insertPrediction(signalId, result.mint, result.direction, result.composite, result.rawData.onChain.priceUsd)
      .catch(e => dbg("[ledger] insert prediction failed:", e.message));
  }

  _state.lastSignal = result;
  _state.cycleTelemetry.signals++;

  // Capital gate tracking
  if (result.capitalGate === "SKIP_TRADE") {
    _state.cycleTelemetry.skippedCapital++;
  }

  // Alert logic — pre-momentum tiers always fire (execute BEFORE crowd)
  const isPreMomentumAlert = result.preMomentumAlert && result.capitalGate !== "SKIP_TRADE";
  const isHighQualityAlert = (result.grade === "S" || result.grade === "A" || result.pumpProbability >= 80) && result.capitalGate !== "SKIP_TRADE";

  if (isPreMomentumAlert || isHighQualityAlert) {
    await insertAlert(signalId, result.mint, result.grade);
    _state.cycleTelemetry.alerts++;
    if (result.preMomentumTier === "APEX_ENTRY" || result.preMomentumTier === "STRONG_EARLY_ENTRY")
      _state.cycleTelemetry.boosted++;
    console.log(
      `[alert] ${result.grade} ${result.symbol} (${result.mint.slice(0, 8)}…)` +
      ` Score:${result.composite} Pump:${result.pumpProbability}%` +
      ` ${result.recommendation} | capitalGate:${result.capitalGate}`
    );
    if (notifyFn) await notifyFn(result).catch(() => {});
  }

  // GEM HUNTER broadcast — fire to all autoscanner subscribers in parallel with admin notify
  if (isPreMomentumAlert) {
    broadcastGemAlert(result).catch(e => dbg("[broadcast] error:", e.message));
  }

  return result;
}

async function runScanCycle(mints = []) {
  if (_state.emergencyHalt) { console.log("[HALT] Scan cycle blocked."); return; }

  // Resolve pending predictions in parallel with discovery
  resolvePendingPredictions().catch(e => dbg("[ledger] resolve error:", e.message));

  let discovered = [];
  try { discovered = await discoverLiveMints(); }
  catch (e) { console.error("[discovery] failed, using seeds:", e.message); }

  _dexCache.clear();
  for (const d of discovered) {
    _dexCache.set(d.mint, {
      priceUsd:          d.priceUsd       ?? 0,
      marketCap:         d.marketCap      ?? 0,
      volumeUsd:         d.volume24h      ?? 0,
      lpDepth:           d.liquidity      ?? 0,
      vol1h: 0, vol6h: 0, vol24h: d.volume24h ?? 0,
      volumeSpike:       d.volume24h > 0 ? Math.max(1, d.priceChange1h / 10 + 1) : 1,
      lpGrowthRate:      Math.max(0, (d.priceChange1h ?? 0) / 100),
      holderGrowthProxy: Math.min(1, Math.abs(d.priceChange1h ?? 0) / 50),
      priceChange1h:     d.priceChange1h  ?? 0,
      priceChange6h:     0,
      priceChange24h:    d.priceChange24h ?? 0,
      txns1h: 0, txns24h: 0, txBuys1h: 0, txSells1h: 0,
      dexId:             d.dexId ?? "",
      isFirstLiquidityWindow: d.ageHours < 2,
      ageHours:          d.ageHours,
    });
  }

  let wl = [];
  try { wl = (await getWatchlist()).map(w => w.mint); } catch (_) {}
  const discoveredMints = discovered.map(d => d.mint);
  const all = [...new Set([...mints, ...wl, ...config.seedMints, ...discoveredMints])];

  if (all.length === 0) { console.log("[scanner] No mints — check network or lower MIN_LIQUIDITY_USD"); return; }

  console.log(
    `[scanner] Cycle ${scanCount + 1}: ${all.length} mints` +
    ` (${discoveredMints.length} auto-discovered, ${wl.length} watchlist, ${config.seedMints.length} seed)`
  );

  const results = await Promise.allSettled(all.map(m => scanMint(m)));

  let ok = 0;
  const highValue = [], skippedCapital = [];
  for (const r of results) {
    if (r.status === "fulfilled") {
      ok++;
      if (r.value.pumpProbability >= 70 || r.value.grade === "S" || r.value.grade === "A") {
        if (r.value.capitalGate === "SKIP_TRADE") skippedCapital.push(r.value);
        else highValue.push(r.value);
      }
    } else {
      console.error("[scanner] error:", r.reason?.message ?? r.reason);
    }
  }

  lastScanAt = new Date();
  scanCount++;
  _state.cycleTelemetry.cycles++;
  console.log(
    `[scanner] Done — ${ok}/${all.length} ok | ${highValue.length} high-value | ${skippedCapital.length} capital-gated`
  );

  if (highValue.length > 0) {
    highValue.sort((a, b) => b.pumpProbability - a.pumpProbability).slice(0, 5).forEach(s => {
      const pmTag = s.preMomentumTier && s.preMomentumTier !== "SKIP" ? ` PM:${s.preMomentumTier}(${s.preMomentumScore})` : "";
      console.log(`  [${s.grade}] ${s.symbol} Score:${s.composite} Pump:${s.pumpProbability}% ${s.recommendation}${pmTag} Wyckoff:${s.wyckoffPhase} H:${s.hurstExponent}`);
    });
  }
  if (skippedCapital.length > 0) {
    skippedCapital.forEach(s =>
      console.log(`  [GATED] ${s.symbol} — ${s.capitalGateReasons.join("; ")}`)
    );
  }
}

function startScanLoop() {
  const ms = config.scanIntervalMinutes * 60 * 1000;
  runScanCycle().catch(e => console.error("[scanner] Initial error:", e));
  setInterval(() => runScanCycle().catch(e => console.error("[scanner] Loop error:", e)), ms);
  console.log(`[scanner] Loop started — every ${config.scanIntervalMinutes} min.`);
}

// ════════════════════════════════════════════════════════════════════════════
// SECTION 21 — TELEGRAM BOT
// ════════════════════════════════════════════════════════════════════════════

const bot = new Telegraf(config.telegramBotToken);

// Log every incoming Telegram message to Render's console
bot.use((ctx, next) => {
  const user = ctx.from?.username
    ? `@${ctx.from.username}`
    : ctx.from?.first_name ?? String(ctx.from?.id ?? "unknown");
  const chatId = ctx.chat?.id ?? ctx.from?.id ?? "?";
  const text   = ctx.message?.text ?? "[no text]";
  console.log(`[bot] ${user} (${chatId}): ${text}`);
  return next();
});

function isAdmin(ctx) { return String(ctx.from?.id) === config.adminChatId; }
function gradeLabel(g)  { return { S:"[S-TIER]", A:"[A]", B:"[B]", C:"[C]", D:"[D]" }[g] ?? g; }
function recLabel(r)    { return {
  APEX_ENTRY:"*** APEX ENTRY ***", STRONG_EARLY_ENTRY:"** EARLY ENTRY **",
  EARLY_ENTRY:"* EARLY *", STRONG_BUY:"STRONG BUY",
  BUY:"BUY", WATCH:"WATCH", AVOID:"AVOID"
}[r] ?? r; }
function dirLabel(d)    { return { BUY:"BUY", SELL:"SELL", NEUTRAL:"NEUTRAL" }[d] ?? d; }

function formatSignalFull(s) {
  const whale  = s.whale_score     ?? s.whaleScore     ?? 0;
  const smart  = s.smart_money     ?? s.smartMoney     ?? 0;
  const vol    = s.volume_anomaly  ?? s.volumeAnomaly  ?? 0;
  const holder = s.holder_velocity ?? s.holderVelocity ?? 0;
  const liq    = s.liquidity       ?? 0;
  const mom    = s.momentum_score  ?? s.momentumScore  ?? 0;
  const wy     = s.wyckoff_score   ?? s.wyckoffScore   ?? 0;
  const hf     = s.hidden_flow     ?? s.hiddenFlow     ?? 0;
  const mtf    = s.mtf_score       ?? s.mtfScore       ?? 0;
  const pump   = s.pump_probability ?? s.pumpProbability ?? 0;
  const frac   = s.fractal_score   ?? s.fractalScore   ?? 0;
  const wc     = s.wallet_cluster_score ?? s.walletClusterScore ?? 0;
  const gate   = s.capital_gate   ?? s.capitalGate    ?? "?";
  const eng    = s.sciEngines ?? {};
  const fgi    = s.fearGreedIndex;

  // Science engine one-liner builder
  const engLine = (label, e) => {
    if (!e) return null;
    const dir  = e.dir ?? e.phase ?? e.trend ?? "?";
    const conf = e.conf != null ? `${Math.round(e.conf)}%` : "";
    const ex   = e.extra != null ? ` [${e.extra}]` : e.G != null ? ` G=${e.G}` : e.snr != null ? ` SNR=${e.snr}` : e.r != null ? ` r=${e.r}` : e.rr != null ? ` RR=${e.rr}` : e.norm != null ? ` LZ=${e.norm}` : e.seq != null ? ` seq=${e.seq}` : e.fade != null ? ` fade=${e.fade}` : "";
    const flag = e.mega ? " MEGA" : e.resonance ? " RESONANCE" : e.sync ? " SYNC" : "";
    return `  ${label}: ${dir} ${conf}${ex}${flag}`;
  };

  const sciLines = [
    engLine("LiqGrav",     eng.liquidityGravity),
    engLine("Entropy",     eng.entropyCascade),
    engLine("Bifurc",      eng.bifurcation),
    engLine("FFTCycle",    eng.resonantFreq),
    engLine("VCR",         eng.vcr),
    engLine("RQA",         eng.rqa),
    engLine("Thermo",      eng.thermodynamic),
    engLine("LempelZiv",   eng.lempelZiv),
    engLine("Kuramoto",    eng.kuramoto),
    engLine("StochRes",    eng.stochasticResonance),
    engLine("CandleDNA",   eng.candleDNA),
    engLine("Adversarial", eng.adversarial),
  ].filter(Boolean);

  // Pre-momentum tier banner
  const pmTier   = s.preMomentumTier ?? s.pre_momentum_tier ?? "SKIP";
  const pmScore  = s.preMomentumScore ?? s.pre_momentum_score ?? 0;
  const pmConsLv = s.sciConsensusLevel ?? s.sci_consensus_level ?? "NONE";
  const pmBuy    = s.sciConsensusBuy  ?? 0;
  const pmSell   = s.sciConsensusSell ?? 0;
  const pmAlert  = s.preMomentumAlert ?? false;

  const tierBanner = {
    APEX_ENTRY:         `*** APEX ENTRY — EXECUTE NOW (Score: ${pmScore}) ***`,
    STRONG_EARLY_ENTRY: `** STRONG EARLY ENTRY (Score: ${pmScore}) **`,
    EARLY_ENTRY:        `* EARLY ENTRY (Score: ${pmScore}) *`,
    WATCH:              `Watch (Pre-mom: ${pmScore})`,
    SKIP:               null,
  }[pmTier] ?? null;

  const prePumpSigs = (s.prePumpSignals ?? []).join("\n  ").trim();
  const stealthSigs = (s.stealthAccumSignals ?? []).join("\n  ").trim();

  return [
    tierBanner ? `${tierBanner}` : null,
    `${gradeLabel(s.grade)} ${s.name ?? "?"} (${s.symbol ?? "?"})`,
    `Mint: ${s.mint}`,
    ``,
    `Score: ${s.composite}/100  |  Certainty: ${s.certainty ?? 0}%`,
    `Signal: ${dirLabel(s.direction)}  |  ${recLabel(s.recommendation)}`,
    `Pump Probability: ${pump}%`,
    `Capital Gate: ${gate}`,
    ``,
    `-- PRE-MOMENTUM INTELLIGENCE --`,
    `Pre-Momentum Score: ${pmScore}  Tier: ${pmTier}`,
    `Science Consensus: ${pmConsLv} (Buy: ${pmBuy} | Sell: ${pmSell})`,
    `PrePump Signals: ${prePumpSigs || "none"}`,
    `Stealth Accum: ${s.stealthAccumScore ?? "?"}  LiqVacuum: ${s.liqVacuumScore ?? "?"}  VL-Ratio: ${s.liqVacuumVLRatio ?? "?"}x`,
    stealthSigs ? `Stealth: ${stealthSigs}` : null,
    ``,
    `-- 6D Original --`,
    `Whale: ${whale}  Smart: ${smart}  Vol: ${vol}`,
    `Holders: ${holder}  Liquidity: ${liq}`,
    ``,
    `-- Advanced Engines --`,
    `Momentum: ${mom}  Wyckoff: ${wy}`,
    `HiddenFlow: ${hf}  MultiTF: ${mtf}`,
    ``,
    `-- v8 Real Edge --`,
    `Fractal (Hurst): ${frac}  WalletCluster: ${wc}`,
    `Hurst: ${s.hurst_exponent ?? s.hurstExponent ?? "?"}  ReversalRisk: ${s.reversal_risk ?? s.reversalRisk ?? "?"}`,
    `Distribution: ${s.distribution_score ?? s.distributionScore ?? "?"}`,
    `Snipers: ${s.sniper_count ?? s.sniperCount ?? 0}  DevWallet: ${s.dev_wallet_active ?? s.devWalletActive ? "ACTIVE" : "clear"}`,
    ``,
    `-- Scientific Intelligence (SMCI: ${s.smciScore ?? "?"} → ${s.smciDirection ?? "?"}) --`,
    `Science Score: ${s.scienceScore ?? "?"}  SMCI Conf: ${s.smciConfidence ?? "?"}%`,
    fgi != null ? `Fear & Greed: ${fgi} (${s.fearGreedClass ?? "?"})` : null,
    ...sciLines,
    ``,
    `Wyckoff: ${s.wyckoff_phase ?? s.wyckoffPhase ?? "?"} [${s.wyckoff_bias ?? s.wyckoffBias ?? "?"}]`,
    `Quality: ${s.quality_pass ?? s.qualityPass ? "PASS" : "FAIL"} (${s.quality_reason ?? s.qualityReason ?? ""})`,
    `Decision: ${s.decision_status ?? s.decisionStatus ?? "?"} [boost:${s.decision_boost ?? s.decisionBoost ?? 0} pen:${s.decision_penalty ?? s.decisionPenalty ?? 0}]`,
    `Data: DEX=${s.rawData?.onChain?.dexSource ?? "?"} Holders=${s.rawData?.onChain?.holderSource ?? "?"}`,
  ].filter(l => l !== null).join("\n");
}

bot.command("top10", async (ctx) => {
  try {
    const top = await getTopSignals(10);
    if (!top.length) { await ctx.reply("No signals yet. Scanner runs every " + config.scanIntervalMinutes + " min."); return; }
    const text = top.map((s, i) => [
      `#${i+1} ${gradeLabel(s.grade)} ${s.name} (${s.symbol})`,
      `Score: ${s.composite} | Pump: ${s.pump_probability}% | ${recLabel(s.recommendation)}`,
      `Gate: ${s.capital_gate ?? "?"} | Wyckoff: ${s.wyckoff_phase ?? "?"} | Dir: ${dirLabel(s.direction)}`,
      `Mint: ${s.mint}`,
    ].join("\n")).join("\n\n");
    await ctx.reply(`Top Opportunities (last 24h):\n\n${text}`);
  } catch (e) { await ctx.reply(`Error: ${e.message}`); }
});

bot.command("accuracy", async (ctx) => {
  try {
    const acc = await getPredictionAccuracy();
    await ctx.reply([
      "Prediction Accuracy (7-day, real outcomes)",
      ``,
      `1-Hour accuracy: ${acc.accuracy1h !== null ? acc.accuracy1h + "%" : "insufficient data"} (${acc.wins1h}/${acc.total1h})`,
      `4-Hour accuracy: ${acc.accuracy4h !== null ? acc.accuracy4h + "%" : "insufficient data"} (${acc.wins4h}/${acc.total4h})`,
      ``,
      `These are REAL outcomes — not self-referential scores.`,
      `Confidence multiplier applied to signals: x${
        acc.accuracy1h !== null
          ? (acc.accuracy1h > 60 ? (1 + (acc.accuracy1h/100 - 0.6) * 0.5).toFixed(2) : acc.accuracy1h < 40 ? (1 - (0.4 - acc.accuracy1h/100) * 0.5).toFixed(2) : "1.00")
          : "1.00 (not enough data)"
      }`,
    ].join("\n"));
  } catch (e) { await ctx.reply(`Error: ${e.message}`); }
});

bot.command("watchlist", async (ctx) => {
  try {
    const wl = await getWatchlist();
    if (!wl.length) { await ctx.reply("Watchlist empty. Use /watch <mint>"); return; }
    const text = wl.map((w, i) => `${i+1}. ${w.name ?? w.mint} (${w.symbol ?? "?"})\n   Mint: ${w.mint}  Priority: ${w.priority}`).join("\n\n");
    await ctx.reply(`Watchlist (${wl.length}):\n\n${text}`);
  } catch (e) { await ctx.reply(`Error: ${e.message}`); }
});

bot.command("watch", async (ctx) => {
  const parts = ctx.message.text.split(" ").slice(1);
  const mint  = parts[0]?.trim();
  const prio  = parseInt(parts[1] ?? "5", 10);
  if (!mint) { await ctx.reply("Usage: /watch <mint_address> [priority 1-10]"); return; }
  try {
    await addToWatchlist(mint, String(ctx.from?.id ?? "user"), prio);
    await ctx.reply(`Added to watchlist: ${mint} (priority ${prio})`);
  } catch (e) { await ctx.reply(`Error: ${e.message}`); }
});

bot.command("unwatch", async (ctx) => {
  const mint = ctx.message.text.split(" ")[1]?.trim();
  if (!mint) { await ctx.reply("Usage: /unwatch <mint_address>"); return; }
  try { await removeFromWatchlist(mint); await ctx.reply(`Removed: ${mint}`); }
  catch (e) { await ctx.reply(`Error: ${e.message}`); }
});

bot.command("approve", async (ctx) => {
  if (!isAdmin(ctx)) { await ctx.reply("Admin only."); return; }
  const mint = ctx.message.text.split(" ")[1]?.trim();
  if (!mint) { await ctx.reply("Usage: /approve <mint_address>"); return; }
  try { await publishToken(mint, String(ctx.from?.id ?? "admin")); await ctx.reply(`Published: ${mint}`); }
  catch (e) { await ctx.reply(`Error: ${e.message}`); }
});

bot.command("published", async (ctx) => {
  try {
    const tokens = await getPublishedTokens();
    if (!tokens.length) { await ctx.reply("No published tokens."); return; }
    const text = tokens.slice(0, 10).map(t => `${t.name} (${t.symbol})\nMint: ${t.mint}`).join("\n\n");
    await ctx.reply(`Published Tokens:\n\n${text}`);
  } catch (e) { await ctx.reply(`Error: ${e.message}`); }
});

bot.command("dex", async (ctx) => {
  const mint = ctx.message.text.split(" ")[1]?.trim();
  if (!mint) { await ctx.reply("Usage: /dex <mint_address>"); return; }
  await ctx.reply(`Fetching live DEX data for ${mint}...`);
  try {
    const [dex, holders] = await Promise.all([fetchDexPairData(mint), fetchHolderData(mint)]);
    if (!dex) { await ctx.reply("No DEX pair found on Solana."); return; }
    await ctx.reply([
      `Live DEX Data — ${mint}`,
      `Price: $${dex.priceUsd.toFixed(8)}`,
      `Market Cap: $${(dex.marketCap / 1000).toFixed(1)}k`,
      `Liquidity: $${(dex.lpDepth / 1000).toFixed(1)}k`,
      `Vol 1h: $${(dex.vol1h / 1000).toFixed(1)}k | 24h: $${(dex.vol24h / 1000).toFixed(1)}k`,
      `Vol Spike: ${dex.volumeSpike.toFixed(2)}x`,
      `1h: ${dex.priceChange1h > 0 ? "+" : ""}${dex.priceChange1h.toFixed(1)}%  24h: ${dex.priceChange24h > 0 ? "+" : ""}${dex.priceChange24h.toFixed(1)}%`,
      `Buys 1h: ${dex.txBuys1h}  Sells 1h: ${dex.txSells1h}`,
      `Holders: ${holders.holderCount > 0 ? holders.holderCount : "n/a (add BIRDEYE_API_KEY)"}`,
      `Top wallet concentration: ${(holders.largeWalletRatio * 100).toFixed(1)}%`,
      `Creator %: ${holders.creatorPct?.toFixed(1) ?? "?"}%`,
      `First Liquidity Window: ${dex.isFirstLiquidityWindow ? "YES (<2h)" : "No"}`,
      `Age: ${dex.ageHours?.toFixed(1) ?? "?"}h`,
    ].join("\n"));
  } catch (e) { await ctx.reply(`Error: ${e.message}`); }
});

bot.command("discover", async (ctx) => {
  await ctx.reply("Running live DEX discovery scan...");
  try {
    const found = await discoverLiveMints();
    if (!found.length) { await ctx.reply("No tokens matched. Try lowering MIN_LIQUIDITY_USD."); return; }
    const text = found.slice(0, 10).map((t, i) => [
      `#${i+1} ${t.symbol} [${t.source}]`,
      `EarlyScore: ${t.earlyScore}  MCap: $${(t.marketCap/1000).toFixed(0)}k`,
      `Vol24h: $${(t.volume24h/1000).toFixed(0)}k  Liq: $${(t.liquidity/1000).toFixed(0)}k`,
      `1h: ${t.priceChange1h > 0 ? "+" : ""}${t.priceChange1h.toFixed(1)}%  Age: ${t.ageHours}h`,
      `Mint: ${t.mint}`,
    ].join("\n")).join("\n\n");
    await ctx.reply(`Live Discovery (${found.length} found, top 10):\n\n${text}`);
  } catch (e) { await ctx.reply(`Error: ${e.message}`); }
});

bot.command("status", async (ctx) => {
  const tel = _state.cycleTelemetry;
  await ctx.reply([
    "Engine Status — v8.1 REAL EDGE + Pre-Momentum",
    `Uptime: ${Math.floor(process.uptime())}s`,
    `Scan cycles: ${getScanCount()}`,
    `Last scan: ${getLastScanAt()?.toISOString() ?? "not yet"}`,
    `Signals total: ${tel.signals}  Alerts: ${tel.alerts}`,
    `Capital-gated: ${tel.skippedCapital}  Skipped: ${tel.skipped}`,
    `Pre-Momentum Boosts (APEX/STRONG): ${tel.boosted}`,
    ``,
    `-- Auto-Discovery --`,
    `Tokens/cycle: up to ${config.maxTokensPerCycle}`,
    `Liquidity min: $${(config.minLiquidityUsd/1000).toFixed(0)}k`,
    `Volume 24h min: $${(config.minVolume24hUsd/1000).toFixed(0)}k`,
    `Market cap: $${(config.minMarketCapUsd/1000).toFixed(0)}k — $${(config.maxMarketCapUsd/1_000_000).toFixed(0)}M`,
    `Age window: ${config.minTokenAgeHours}h — ${config.maxTokenAgeHours}h`,
    `Birdeye: ${config.birdeyeKey ? "connected" : "not set"}`,
    `Helius: ${config.heliusKey ? "connected" : "not set (wallet cluster disabled)"}`,
    ``,
    `-- Capital Protection --`,
    `Distribution skip at: ${config.distributionSkipMin}`,
    `Reversal skip at: ${(config.reversalSkipMin * 100).toFixed(0)}%`,
    `Emergency halt: ${_state.emergencyHalt ? "ACTIVE" : "off"}`,
  ].join("\n"));
});

bot.command("engine", async (ctx) => {
  await ctx.reply([
    "Active Engine — v8.1 REAL EDGE + Region__ Science + Pre-Momentum",
    ``,
    `15-Dimensional Scoring:`,
    `  Whale (10%) | Smart Money (9%) | Volume (8%) | Holder (8%)`,
    `  Liquidity (5%) | Momentum/RSI/MACD (8%) | Wyckoff (7%)`,
    `  Hidden Flow (5%) | Multi-TF (4%)`,
    `  Fractal/Hurst (6%) | Wallet Cluster (4%) | Institutional (4%)`,
    `  Scientific Intelligence Suite (10%)`,
    `  Pre-Momentum Intelligence (12%) ← v8.1 NEW`,
    ``,
    `v8 Core Modules:`,
    `  FractalTimeAnalyzer — Hurst exponent R/S (no random)`,
    `  WalletClusterAnalyzer — sniper detect, dev wallet, buyer/seller ratio`,
    `  CapitalProtectionGate — SKIP_TRADE on distribution/reversal`,
    `  PredictionLedger — 1h/4h real outcomes in DB (learning loop)`,
    `  StatConfidence — signal coherence (no Math.random)`,
    `  LearningMultiplier — real historical accuracy applied`,
    ``,
    `v8.1 Pre-Momentum Intelligence Layer (5 sub-engines):`,
    `  detectPrePumpSignature — volume silence before spike, buy wall, LP growth`,
    `  detectStealthAccumulation — smart wallet buying, sniper quiet, dev lock`,
    `  calcLiquidityVacuumScore — thin LP = rocket fuel ratio`,
    `  scienceConsensusGate — ≥3 engines must agree (STRONG_CONSENSUS)`,
    `  calcPreMomentumScore — APEX(≥85) / STRONG_EARLY(≥72) / EARLY(≥58) tiers`,
    ``,
    `Region__ Scientific Engine Suite (12 engines):`,
    `  1. LiquidityGravity  2. EntropyCascade  3. Bifurcation`,
    `  4. ResonantFreq      5. VCR (squeeze)   6. RQA (chaos)`,
    `  7. Thermodynamic     8. LempelZiv       9. Kuramoto`,
    `  10. StochResonance  11. CandleDNA      12. Adversarial`,
    `  + Fear&Greed Index + SMCI composite vote`,
    ``,
    `Capital Gates:`,
    `  Distribution > ${config.distributionSkipMin} → SKIP_TRADE`,
    `  Reversal risk > ${(config.reversalSkipMin * 100).toFixed(0)}% → SKIP_TRADE`,
    `  Wallet cluster < 30 → SKIP_TRADE`,
    `  Pre-momentum APEX/STRONG fires alert even below grade A`,
  ].join("\n"));
});

bot.command("thresholds", async (ctx) => {
  await ctx.reply([
    "Signal Grades",
    `  S: 90-100  A: 75-89  B: 60-74  C: 45-59  D: <45`,
    ``,
    `Recommendations (v8.1 — Pre-Momentum tiers first)`,
    `  APEX_ENTRY:        preMom≥85 + BUY dir + no cap gate`,
    `  STRONG_EARLY_ENTRY: preMom≥72 + BUY dir + no cap gate`,
    `  EARLY_ENTRY:       preMom≥58 + BUY dir + no cap gate`,
    `  STRONG BUY:        Cert>=80 + Score>=80 + Pump>=70%`,
    `  BUY:               Score>=70 + BUY`,
    `  WATCH:             Score>=50 + BUY`,
    `  AVOID:             Distribution, whale >70%, Gate=SKIP`,
    ``,
    `Pre-Momentum Tiers (execute BEFORE crowd notices)`,
    `  APEX (≥85): Pre-pump sig + stealth accum + liq vacuum`,
    `  STRONG EARLY (≥72): 2 of 3 PM engines aligned`,
    `  EARLY (≥58): Science consensus ≥3 engines agree`,
    ``,
    `Science Consensus Levels`,
    `  STRONG_CONSENSUS: netVotes ≥ 5 (BUY - SELL)`,
    `  CONSENSUS:        netVotes ≥ 3`,
    `  SLIGHT_CONSENSUS: netVotes ≥ 1`,
    `  NEUTRAL / SELL_*: below 0`,
    ``,
    `Wyckoff Phases`,
    `  SPRING → BUY (82%)  MARKUP_EARLY → BUY (88%)`,
    `  ACCUMULATION → BUY (72%)  DISTRIBUTION → SELL`,
    ``,
    `Hurst Exponent`,
    `  H > 0.65 = strong trend  H < 0.5 = mean-reverting  H≈0.5 = random`,
  ].join("\n"));
});

bot.command("early", async (ctx) => {
  try {
    const top = await getTopSignals(30);
    const early = top.filter(s =>
      s.recommendation === "EARLY_ENTRY" ||
      s.recommendation === "STRONG_EARLY_ENTRY" ||
      s.recommendation === "APEX_ENTRY"
    ).slice(0, 10);
    if (!early.length) { await ctx.reply("No EARLY/APEX signals in last 24h. Scanner fires on next cycle."); return; }
    const text = early.map((s, i) => [
      `#${i+1} ${recLabel(s.recommendation)} ${s.name} (${s.symbol})`,
      `Score: ${s.composite} | PreMom: ${s.pre_momentum_score ?? "?"} | Pump: ${s.pump_probability}%`,
      `SciCons: ${s.sci_consensus_level ?? "?"} | Wyckoff: ${s.wyckoff_phase ?? "?"}`,
      `Mint: ${s.mint}`,
    ].join("\n")).join("\n\n");
    await ctx.reply(`Pre-Momentum Alerts (last 24h — before the crowd):\n\n${text}`);
  } catch (e) { await ctx.reply(`Error: ${e.message}`); }
});

bot.command("apex", async (ctx) => {
  try {
    const top = await getTopSignals(30);
    const apex = top.filter(s => s.recommendation === "APEX_ENTRY").slice(0, 5);
    if (!apex.length) { await ctx.reply("No APEX_ENTRY signals in last 24h. Criteria: preMom≥85 + science consensus ≥5 + stealth accumulation confirmed."); return; }
    const text = apex.map((s, i) => [
      `#${i+1} *** APEX ENTRY *** ${s.name} (${s.symbol})`,
      `Score: ${s.composite} | PreMom: ${s.pre_momentum_score ?? "?"} | Certainty: ${s.certainty}%`,
      `SciCons: ${s.sci_consensus_level ?? "?"} Buy:${s.sci_consensus_buy ?? 0} Sell:${s.sci_consensus_sell ?? 0}`,
      `Pump: ${s.pump_probability}% | Wyckoff: ${s.wyckoff_phase ?? "?"}`,
      `Price: $${s.rawData?.onChain?.priceUsd?.toFixed(8) ?? s.price_usd ?? "?"}`,
      `Mint: ${s.mint}`,
    ].join("\n")).join("\n\n");
    await ctx.reply(`APEX ENTRY Signals (highest conviction, execute immediately):\n\n${text}`);
  } catch (e) { await ctx.reply(`Error: ${e.message}`); }
});

bot.command("autoscanner", async (ctx) => {
  const sub  = ctx.message.text.split(" ").slice(1).join(" ").trim().toLowerCase();
  const chatId = String(ctx.chat?.id ?? ctx.from?.id);
  const user   = ctx.from?.username ?? ctx.from?.first_name ?? "user";

  if (sub === "apex") {
    await saveAutoScannerSub(chatId, "apex", user).catch(() => {});
    _autoScanSubs.set(chatId, { mode: "apex", username: user, since: new Date(), streak: 0, lastGemAt: null });
    await ctx.reply([
      `APEX AutoScanner ACTIVATED`,
      ``,
      `You will receive real-time alerts the instant an APEX_ENTRY gem is detected`,
      `— that means ALL of:`,
      `  Pre-Momentum Score >= 85`,
      `  Science Consensus >= 5 engines aligned`,
      `  Stealth accumulation confirmed`,
      `  Liquidity vacuum active`,
      ``,
      `These are the highest-conviction calls the engine produces.`,
      `Rare. When they fire — the window is open.`,
      ``,
      `Use /autoscanner off to unsubscribe.`,
    ].join("\n"));
    return;
  }

  if (sub === "early") {
    await saveAutoScannerSub(chatId, "early", user).catch(() => {});
    _autoScanSubs.set(chatId, { mode: "early", username: user, since: new Date(), streak: 0, lastGemAt: null });
    await ctx.reply([
      `EARLY AutoScanner ACTIVATED`,
      ``,
      `You will receive real-time alerts for ALL pre-momentum tiers:`,
      `  APEX_ENTRY         — highest conviction (score >= 85)`,
      `  STRONG_EARLY_ENTRY — strong early edge (score >= 72)`,
      `  EARLY_ENTRY        — early signal (score >= 58)`,
      ``,
      `More signals, more opportunities. BEFORE the crowd notices.`,
      ``,
      `Alerts include:`,
      `  Gem rarity tier (LEGENDARY / EPIC / RARE / UNCOMMON)`,
      `  Moon potential estimate (e.g. 5x-15x)`,
      `  Live heat bar for pre-momentum + composite + pump`,
      `  Science engine consensus count`,
      `  Pre-pump and stealth signals detected`,
      `  Entry window countdown`,
      ``,
      `Use /autoscanner off to unsubscribe.`,
    ].join("\n"));
    return;
  }

  if (sub === "off" || sub === "stop") {
    if (_autoScanSubs.has(chatId)) {
      const existing = _autoScanSubs.get(chatId);
      _autoScanSubs.delete(chatId);
      await removeAutoScannerSub(chatId).catch(() => {});
      await ctx.reply(`AutoScanner deactivated. You received ${existing.streak} gem alerts. Use /autoscanner apex or /autoscanner early to reactivate.`);
    } else {
      await ctx.reply("AutoScanner is not active for this chat.");
    }
    return;
  }

  if (sub === "status" || sub === "") {
    const existing = _autoScanSubs.get(chatId);
    if (existing) {
      const sinceStr = existing.since ? existing.since.toISOString().slice(0, 16).replace("T", " ") : "?";
      const lastStr  = existing.lastGemAt ? existing.lastGemAt.toISOString().slice(0, 16).replace("T", " ") : "none yet";
      await ctx.reply([
        `AutoScanner Status`,
        ``,
        `Mode:    ${existing.mode.toUpperCase()}`,
        `Active:  since ${sinceStr}`,
        `Gems:    ${existing.streak} alert(s) received`,
        `Last gem: ${lastStr}`,
        ``,
        `Total subscribers: ${_autoScanSubs.size}`,
        `Gems fired this session: ${_state.cycleTelemetry.gems}`,
        ``,
        `Commands:`,
        `  /autoscanner apex   — APEX only (rarest, highest conviction)`,
        `  /autoscanner early  — all tiers (APEX + STRONG + EARLY)`,
        `  /autoscanner off    — unsubscribe`,
      ].join("\n"));
    } else {
      await ctx.reply([
        `AutoScanner is OFF for this chat.`,
        ``,
        `Get real-time gem alerts the moment the scanner fires:`,
        `  /autoscanner apex   — APEX_ENTRY only (highest conviction)`,
        `  /autoscanner early  — all pre-momentum tiers`,
        ``,
        `${_autoScanSubs.size} subscriber(s) currently active.`,
      ].join("\n"));
    }
    return;
  }

  await ctx.reply("Usage: /autoscanner apex | early | off | status");
});

bot.command("halt", async (ctx) => {
  if (!isAdmin(ctx)) { await ctx.reply("Admin only."); return; }
  _state.emergencyHalt = true;
  await ctx.reply("EMERGENCY HALT activated. All scans blocked. Use /resume to lift.");
});

bot.command("resume", async (ctx) => {
  if (!isAdmin(ctx)) { await ctx.reply("Admin only."); return; }
  _state.emergencyHalt = false;
  await ctx.reply("Halt lifted. Engine resuming.");
});

bot.command("start", async (ctx) => {
  await ctx.reply([
    "MEMECOIN EMPIRE — REAL EDGE v8.1 (Pre-Momentum Edition)",
    ``,
    `v8 Core (5 Real Upgrades Over v6/v7):`,
    `1. No Math.random() in scoring — statistical confidence`,
    `2. Wallet clustering, sniper detection, dev wallet analysis`,
    `3. True learning loop — 1h/4h outcomes stored and trained on`,
    `4. Hurst exponent fractal (grounded math, not fake quantum)`,
    `5. Capital protection gate — hard SKIP on distribution/reversal`,
    ``,
    `v8.1 NEW — Pre-Momentum Intelligence Layer:`,
    `6. detectPrePumpSignature — catches silence-before-explosion`,
    `7. detectStealthAccumulation — smart wallets buying quietly`,
    `8. calcLiquidityVacuumScore — thin LP = rocket fuel`,
    `9. scienceConsensusGate — 12 engines must agree before APEX`,
    `10. APEX/STRONG_EARLY/EARLY tiers fire BEFORE the crowd`,
    ``,
    `+ 12 Region__ Scientific Engines (Hurst, LZ, RQA, Thermo...)`,
    `+ 15-dimensional composite with 12% pre-momentum weight`,
    ``,
    `Commands:`,
    `/autoscanner apex  — subscribe: APEX_ENTRY alerts only`,
    `/autoscanner early — subscribe: all pre-momentum tiers`,
    `/autoscanner off   — unsubscribe`,
    `/autoscanner status — see your subscription`,
    ``,
    `/top10 /early /apex /watchlist /watch /unwatch`,
    `/dex /discover /status /engine /thresholds`,
    `/accuracy — real prediction win rate`,
    `/approve /published /halt /resume`,
  ].join("\n"));
});

// ════════════════════════════════════════════════════════════════════════════
// SECTION 21B — GEM HUNTER BROADCAST ENGINE (v8.2)
// Real-time subscriber alerts with rarity tiers and moon potential
// ════════════════════════════════════════════════════════════════════════════

function calcGemRarity(result) {
  const pm   = result.preMomentumScore    ?? 0;
  const net  = result.sciConsensusNet     ?? 0;
  const liq  = result.liqVacuumScore      ?? 0;
  const pump = result.pumpProbability     ?? 0;
  const h    = result.hurstExponent       ?? 0.5;
  const wc   = result.walletClusterScore  ?? 0;

  // Combined rarity score out of 100
  const rarityScore =
    pm   * 0.30 +     // pre-momentum is the heart of the gem signal
    Math.min(net, 12) / 12 * 100 * 0.20 +  // science consensus
    liq  * 0.20 +     // thin LP = biggest move potential
    pump * 0.15 +     // pump model backing
    clamp((h - 0.5) * 200) * 0.10 +  // Hurst trend strength
    wc   * 0.05;

  if (rarityScore >= 82) return { rarity: "LEGENDARY", emoji: "💎", multiplier: "15x–50x", color: "GOLD" };
  if (rarityScore >= 68) return { rarity: "EPIC",      emoji: "🔥", multiplier: "5x–15x",  color: "PURPLE" };
  if (rarityScore >= 52) return { rarity: "RARE",      emoji: "⚡", multiplier: "2x–5x",   color: "BLUE" };
  return                         { rarity: "UNCOMMON",  emoji: "✨", multiplier: "1.5x–2x", color: "GREEN" };
}

function buildHeatBar(score) {
  const filled = Math.round(score / 10);
  const bar    = "█".repeat(filled) + "░".repeat(10 - filled);
  return `[${bar}] ${Math.round(score)}`;
}

function buildGemHunterAlert(result, sub) {
  const gem      = calcGemRarity(result);
  const streak   = sub?.streak ?? 0;
  const streakLine = streak >= 3 ? `STREAK x${streak} — GEM MACHINE RUNNING` : streak >= 2 ? `x${streak} gems in a row` : null;

  const pmTier = result.preMomentumTier ?? "SKIP";
  const tierLabel = {
    APEX_ENTRY:         "APEX ENTRY",
    STRONG_EARLY_ENTRY: "STRONG EARLY ENTRY",
    EARLY_ENTRY:        "EARLY ENTRY",
  }[pmTier] ?? pmTier;

  const sciNet    = result.sciConsensusNet  ?? 0;
  const sciLevel  = result.sciConsensusLevel ?? "NONE";
  const sciLine   = `${sciNet > 0 ? sciNet + "/12 engines aligned" : "mixed signals"}  [${sciLevel}]`;

  const prePumpSigs = (result.prePumpSignals ?? []).slice(0, 3);
  const stealthSigs = (result.stealthAccumSignals ?? []).slice(0, 2);
  const allSigs     = [...prePumpSigs, ...stealthSigs];

  const price    = result.rawData?.onChain?.priceUsd;
  const mcap     = result.rawData?.onChain?.marketCap;
  const volSpike = result.rawData?.onChain?.volumeSpike;

  const windowMin = config.scanIntervalMinutes;

  return [
    `${gem.emoji} ${gem.rarity} GEM DETECTED ${gem.emoji}`,
    streakLine,
    ``,
    `${result.name ?? "?"} (${result.symbol ?? "?"})`,
    `Tier: ${tierLabel}  |  Moon: ${gem.multiplier}`,
    ``,
    `HEAT:  ${buildHeatBar(result.preMomentumScore ?? 0)}`,
    `SCORE: ${buildHeatBar(result.composite ?? 0)}`,
    `PUMP:  ${buildHeatBar(result.pumpProbability ?? 0)}`,
    ``,
    `Science: ${sciLine}`,
    allSigs.length ? `Signals: ${allSigs.join("  |  ")}` : null,
    result.wyckoffPhase ? `Wyckoff: ${result.wyckoffPhase} [${result.wyckoffBias ?? "?"}]` : null,
    ``,
    price   != null ? `Price: $${price.toFixed(8)}` : null,
    mcap    != null && mcap > 0 ? `MCap:  $${(mcap / 1000).toFixed(1)}k  (micro = fuel)` : null,
    volSpike != null ? `Vol Spike: ${volSpike.toFixed(2)}x` : null,
    `LiqVacuum: ${result.liqVacuumScore ?? "?"}  VLRatio: ${result.liqVacuumVLRatio ?? "?"}x`,
    ``,
    `Window: ~${windowMin}min before next scan`,
    `Mint: \`${result.mint}\``,
  ].filter(l => l !== null).join("\n");
}

async function broadcastGemAlert(result) {
  if (_autoScanSubs.size === 0) return;

  const pmTier = result.preMomentumTier ?? "SKIP";
  if (pmTier === "SKIP" || pmTier === "WATCH") return;

  _state.cycleTelemetry.gems++;

  const broadcasts = [];
  for (const [chatId, sub] of _autoScanSubs) {
    // Route by subscription mode
    const wantsApex  = sub.mode === "apex";
    const wantsEarly = sub.mode === "early";

    const isApex   = pmTier === "APEX_ENTRY";
    const isEarly  = pmTier === "EARLY_ENTRY" || pmTier === "STRONG_EARLY_ENTRY" || isApex;

    if (wantsApex  && !isApex)  continue;
    if (wantsEarly && !isEarly) continue;

    // Update streak
    const newStreak = (sub.streak ?? 0) + 1;
    sub.streak    = newStreak;
    sub.lastGemAt = new Date();
    updateSubStreak(chatId, newStreak).catch(() => {});

    const msg = buildGemHunterAlert(result, sub);
    broadcasts.push(
      bot.telegram.sendMessage(chatId, msg, { parse_mode: "Markdown" })
        .catch(e => {
          dbg(`[broadcast] failed chatId ${chatId}:`, e.message);
          // If bot was blocked by user, auto-remove their sub
          if (e.description?.includes("blocked") || e.description?.includes("deactivated")) {
            _autoScanSubs.delete(chatId);
            removeAutoScannerSub(chatId).catch(() => {});
          }
        })
    );
  }
  if (broadcasts.length > 0) await Promise.allSettled(broadcasts);
}

async function notifyAdmin(result) {
  const capitalNote = result.capitalGate === "SKIP_TRADE"
    ? `\nCAP GATE SKIP: ${result.capitalGateReasons?.join(" | ")}`
    : "";

  // Pre-momentum tier header — shown at top of message when relevant
  const pmTier = result.preMomentumTier ?? "SKIP";
  const pmBanner = {
    APEX_ENTRY:         `*** APEX ENTRY — EXECUTE NOW ***`,
    STRONG_EARLY_ENTRY: `** STRONG EARLY ENTRY **`,
    EARLY_ENTRY:        `* EARLY ENTRY *`,
  }[pmTier] ?? null;

  const pmLine = pmTier !== "SKIP" && pmTier !== "WATCH"
    ? `Pre-Momentum: ${pmTier} (${result.preMomentumScore}) | SciCons: ${result.sciConsensusLevel} Buy:${result.sciConsensusBuy} Sell:${result.sciConsensusSell}`
    : null;

  // Top science engine signals (only non-NEUTRAL ones)
  const eng = result.sciEngines ?? {};
  const sciSummary = [
    eng.rqa?.phase !== 'UNKNOWN'     ? `RQA:${eng.rqa?.phase}` : null,
    eng.vcr?.mega                    ? `VCR:MEGA_SQUEEZE` : eng.vcr?.conf > 40 ? `VCR:${eng.vcr?.dir}` : null,
    eng.kuramoto?.sync               ? `KURA:SYNC(r=${eng.kuramoto?.r})` : null,
    eng.thermodynamic?.phase !== 'EQUILIBRIUM' ? `THERMO:${eng.thermodynamic?.phase}` : null,
    eng.stochasticResonance?.resonance ? `SR:RESONANCE(SNR=${eng.stochasticResonance?.snr})` : null,
    eng.lempelZiv?.trend !== 'NEUTRAL' && eng.lempelZiv?.trend !== 'RANDOM'
      ? `LZ:${eng.lempelZiv?.trend}` : null,
    eng.adversarial?.pats?.length    ? `ADVERS:${eng.adversarial.pats.join(",")}` : null,
  ].filter(Boolean).join("  ");

  const fgiLine = result.fearGreedIndex != null
    ? `Fear&Greed: ${result.fearGreedIndex} (${result.fearGreedClass})`
    : "";

  const msg = [
    pmBanner,
    `ALERT ${gradeLabel(result.grade)} ${result.name} (${result.symbol})`,
    `Mint: \`${result.mint}\``,
    ``,
    `Score: ${result.composite}/100  |  Certainty: ${result.certainty}%`,
    `Signal: ${dirLabel(result.direction)}  |  ${recLabel(result.recommendation)}`,
    `Pump Probability: ${result.pumpProbability}%`,
    capitalNote,
    pmLine,
    ``,
    `Price: $${result.rawData?.onChain?.priceUsd?.toFixed(8) ?? "?"}`,
    `MCap: $${result.rawData?.onChain?.marketCap > 0 ? (result.rawData.onChain.marketCap / 1000).toFixed(1) + "k" : "?"}`,
    `Vol Spike: ${result.rawData?.onChain?.volumeSpike?.toFixed(2) ?? "?"}x`,
    ``,
    `Hurst: ${result.hurstExponent}  ReverScore: ${result.reversalRisk}`,
    `Distribution: ${result.distributionScore}  WalletCluster: ${result.walletClusterScore}`,
    `Snipers: ${result.sniperCount}  DevWallet: ${result.devWalletActive ? "ACTIVE" : "clear"}`,
    ``,
    `SMCI: ${result.smciScore ?? "?"} → ${result.smciDirection ?? "?"} (${result.smciConfidence ?? "?"}% conf)`,
    fgiLine,
    sciSummary ? `Sci: ${sciSummary}` : null,
    ``,
    `Wyckoff: ${result.wyckoffPhase} [${result.wyckoffBias}]`,
    `Quality: ${result.qualityPass ? "PASS" : "FAIL"} — ${result.qualityReason}`,
    `Decision: ${result.decisionStatus} [+${result.decisionBoost}/-${result.decisionPenalty}]`,
  ].filter(l => l !== null).join("\n");
  await bot.telegram.sendMessage(config.adminChatId, msg, { parse_mode: "Markdown" });
}

// ════════════════════════════════════════════════════════════════════════════
// SECTION 22 — HTTP API
// ════════════════════════════════════════════════════════════════════════════

const app = express();
app.use(express.json());

app.get("/",        (_req, res) => res.send("Memecoin Empire — REAL EDGE v8.0 — Running"));
app.get("/ping",    (_req, res) => res.json({ pong: true, ts: Date.now() }));
app.get("/healthz", (_req, res) => res.json({ status: "ok", uptime: Math.floor(process.uptime()) }));

app.get("/status", (_req, res) => res.json({
  status: "running",
  uptime: Math.floor(process.uptime()),
  memoryMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
  scanCycles: getScanCount(),
  lastScan: getLastScanAt(),
  lastSignal: _state.lastSignal ? {
    mint: _state.lastSignal.mint, name: _state.lastSignal.name,
    grade: _state.lastSignal.grade, composite: _state.lastSignal.composite,
    pumpProbability: _state.lastSignal.pumpProbability,
    capitalGate: _state.lastSignal.capitalGate,
  } : null,
  telemetry: _state.cycleTelemetry,
  emergencyHalt: _state.emergencyHalt,
  config: {
    scanIntervalMinutes: config.scanIntervalMinutes,
    qualityCertMin: config.qualityCertMin,
    seedMints: config.seedMints.length,
    helius: config.heliusKey ? "connected" : "not set",
    birdeye: config.birdeyeKey ? "connected" : "not set",
    capitalProtection: {
      distributionSkipMin: config.distributionSkipMin,
      reversalSkipMin:     config.reversalSkipMin,
    },
    discovery: {
      maxTokensPerCycle: config.maxTokensPerCycle,
      minLiquidityUsd:   config.minLiquidityUsd,
      minVolume24hUsd:   config.minVolume24hUsd,
      maxMarketCapUsd:   config.maxMarketCapUsd,
    },
  },
}));

app.get("/accuracy",             async (_req, res) => { try { res.json(await getPredictionAccuracy()); } catch (e) { res.status(500).json({ error: e.message }); } });
app.get("/signals/recent",       async (_req, res) => { try { res.json({ signals: await getRecentSignals(20) }); } catch (e) { res.status(500).json({ error: e.message }); } });
app.get("/signals/high-quality", async (_req, res) => { try { res.json({ signals: await getRecentSignals(20, true) }); } catch (e) { res.status(500).json({ error: e.message }); } });
app.get("/signals/top",          async (_req, res) => { try { res.json({ signals: await getTopSignals(10) }); } catch (e) { res.status(500).json({ error: e.message }); } });
app.get("/alerts",               async (_req, res) => { try { res.json({ alerts: await getPendingAlerts() }); } catch (e) { res.status(500).json({ error: e.message }); } });
app.get("/watchlist",            async (_req, res) => { try { res.json({ watchlist: await getWatchlist() }); } catch (e) { res.status(500).json({ error: e.message }); } });

app.post("/halt",   (_req, res) => { _state.emergencyHalt = true;  res.json({ halt: true }); });
app.post("/resume", (_req, res) => { _state.emergencyHalt = false; res.json({ halt: false }); });

app.get("/subscribers", (_req, res) => {
  const subs = [];
  for (const [chatId, sub] of _autoScanSubs) {
    subs.push({ chatId, mode: sub.mode, username: sub.username, streak: sub.streak, lastGemAt: sub.lastGemAt, since: sub.since });
  }
  res.json({ count: subs.length, gemsThisSession: _state.cycleTelemetry.gems, subscribers: subs });
});

app.post("/analyze", async (req, res) => {
  const { mint } = req.body ?? {};
  if (!mint) { res.status(400).json({ error: "mint required" }); return; }
  try { res.json({ signal: await scanMint(mint) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════════════════════════
// SECTION 23 — BOOT
// ════════════════════════════════════════════════════════════════════════════

async function main() {
  console.log("╔════════════════════════════════════════════════════════════════╗");
  console.log("║  MEMECOIN EMPIRE — GEM HUNTER v8.2 (WORLDWIDE FIRST)        ║");
  console.log("║  v8 Core: no random, wallet cluster, Hurst, learning loop,  ║");
  console.log("║  capital protection gate                                     ║");
  console.log("║  v8.1: Pre-Momentum Layer — detectPrePump, stealthAccum,    ║");
  console.log("║  liqVacuum, sciConsensus → APEX/STRONG/EARLY tiers          ║");
  console.log("║  v8.2: AutoScanner broadcast — /autoscanner apex|early      ║");
  console.log("║  Rarity: LEGENDARY/EPIC/RARE/UNCOMMON + moon potential      ║");
  console.log("║  + 12 Region__ science engines — SMCI composite vote        ║");
  console.log("╚════════════════════════════════════════════════════════════════╝");

  console.log("[boot] Initializing database...");
  await initDb();
  console.log("[boot] Database ready.");

  await loadAutoScannerSubs();

  registerNotifier(notifyAdmin);

  app.listen(config.port, () => console.log(`[api] HTTP API on port ${config.port}`));

  await bot.launch();
  console.log("[bot] Polling mode active.");

  startScanLoop();

  // Prediction resolution runs every scan interval
  setInterval(() => resolvePendingPredictions().catch(e => dbg("[ledger] periodic resolve error:", e.message)), config.scanIntervalMinutes * 60 * 1000);

  process.once("SIGINT",  () => { console.log("[boot] SIGINT");  bot.stop("SIGINT");  process.exit(0); });
  process.once("SIGTERM", () => { console.log("[boot] SIGTERM"); bot.stop("SIGTERM"); process.exit(0); });
}

main().catch(e => { console.error("[boot] FATAL:", e); process.exit(1); });
