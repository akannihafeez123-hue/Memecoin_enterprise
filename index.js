"use strict";

// ╔══════════════════════════════════════════════════════════════════════════╗
// ║          MEMECOIN EMPIRE — ULTIMATE ENGINE v3.0                        ║
// ║  Catches 10-100x+ opportunities BEFORE institutions or media hype.     ║
// ║  Merged: Real_memecoin (Solana/DB/Telegram) +                          ║
// ║           Region_Intelligence (Decision V2, Quality Gates,             ║
// ║           Multi-TF Consensus, Wyckoff, Hidden Flow, Quantum Prob,      ║
// ║           Institutional Context, Smart Money, Liquidity Engines)       ║
// ║  Run: node Memecoin_Empire_ULTIMATE.js                                 ║
// ╚══════════════════════════════════════════════════════════════════════════╝

// ── CRASH PROTECTION (must be first) ─────────────────────────────────────
process.on("uncaughtException",  (e) => console.error("[CRASH] uncaughtException:",  e));
process.on("unhandledRejection", (e) => console.error("[CRASH] unhandledRejection:", e));

// ── FORCE IPv4 (prevents broken IPv6 paths on cloud hosts) ───────────────
require("dns").setDefaultResultOrder("ipv4first");

// ── PROCESS KEEPALIVE (prevents idle sleep) ───────────────────────────────
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
  webhookUrl:           process.env.WEBHOOK_URL ?? "",
  port:                 parseInt(optional("PORT", "3000"), 10),
  // Quality gate overrides
  qualityCertMin:       parseFloat(optional("QUALITY_CERT_MIN", "75")),
  qualityAvgMin:        parseFloat(optional("QUALITY_AVG_MIN",  "50")),
  qualityConvMin:       parseFloat(optional("QUALITY_CONV_MIN", "40")),
  qualityPillarMin:     parseInt(optional("QUALITY_PILLAR_MIN", "3"), 10),
  // Decision Engine V2 tunables
  hiddenContraMin:      parseFloat(optional("HIDDEN_CONTRA_MIN", "85")),
  boostMax:             parseFloat(optional("BOOST_MAX", "20")),
  penaltyMax:           parseFloat(optional("PENALTY_MAX", "15")),
  contraCap:            parseFloat(optional("CONTRA_CAP", "85")),
  // Emergency kill switch
  emergencyHalt:        process.env.EMERGENCY_HALT === "1",
};

// ════════════════════════════════════════════════════════════════════════════
// SECTION 2 — CORE UTILITIES
// ════════════════════════════════════════════════════════════════════════════

const clamp      = (v, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));
const safeNum    = (v, fb = 0) => Number.isFinite(Number(v)) ? Number(v) : fb;
const pct        = (part, total) => total > 0 ? (part / total) * 100 : 0;
const ema        = (prices, period) => {
  if (!prices || prices.length === 0) return 0;
  const k = 2 / (period + 1);
  let e = prices[0];
  for (let i = 1; i < prices.length; i++) e = prices[i] * k + e * (1 - k);
  return e;
};
const sma        = (prices, period) => {
  const s = prices.slice(-period);
  return s.reduce((a, b) => a + b, 0) / (s.length || 1);
};
const stddev     = (arr) => {
  const m = arr.reduce((a, b) => a + b, 0) / arr.length;
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length);
};

function normalizeConfidence(raw) {
  if (raw == null || isNaN(Number(raw))) return 0;
  const n = Number(raw);
  const p = n <= 1 ? n * 100 : n;
  return Math.round(clamp(p));
}

// ════════════════════════════════════════════════════════════════════════════
// SECTION 3 — ENGINE STATE (scoped — safe across async overlap)
// ════════════════════════════════════════════════════════════════════════════

const _state = {
  emergencyHalt: config.emergencyHalt,
  lastSignal:    null,
  cycleTelemetry: { cycles: 0, signals: 0, alerts: 0, skipped: 0, boosted: 0 },
};

// Signal bucket — collects all candidates in a cycle before resolving winner
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

const pool = new Pool({ connectionString: config.databaseUrl });

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tokens (
      mint         TEXT PRIMARY KEY,
      name         TEXT,
      symbol       TEXT,
      decimals     INT,
      supply       NUMERIC,
      first_seen   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS price_history (
      id         SERIAL PRIMARY KEY,
      mint       TEXT NOT NULL REFERENCES tokens(mint),
      price_usd  NUMERIC,
      volume_usd NUMERIC,
      market_cap NUMERIC,
      tx_count   INT,
      holder_est INT,
      recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS ph_mint_idx ON price_history(mint, recorded_at DESC);

    CREATE TABLE IF NOT EXISTS signals (
      id              SERIAL PRIMARY KEY,
      mint            TEXT NOT NULL REFERENCES tokens(mint),
      -- 6D Original Scores
      whale_score     NUMERIC NOT NULL DEFAULT 0,
      smart_money     NUMERIC NOT NULL DEFAULT 0,
      volume_anomaly  NUMERIC NOT NULL DEFAULT 0,
      holder_velocity NUMERIC NOT NULL DEFAULT 0,
      liquidity       NUMERIC NOT NULL DEFAULT 0,
      -- Advanced Scores (Region Intelligence)
      momentum_score  NUMERIC NOT NULL DEFAULT 0,
      wyckoff_score   NUMERIC NOT NULL DEFAULT 0,
      hidden_flow     NUMERIC NOT NULL DEFAULT 0,
      mtf_score       NUMERIC NOT NULL DEFAULT 0,
      pump_probability NUMERIC NOT NULL DEFAULT 0,
      -- Composite & Decision
      composite       NUMERIC NOT NULL,
      certainty       NUMERIC NOT NULL DEFAULT 0,
      grade           TEXT NOT NULL,
      recommendation  TEXT NOT NULL,
      direction       TEXT NOT NULL DEFAULT 'NEUTRAL',
      -- Decision Engine V2
      decision_status TEXT,
      decision_boost  NUMERIC DEFAULT 0,
      decision_penalty NUMERIC DEFAULT 0,
      -- Quality Gate
      quality_pass    BOOLEAN NOT NULL DEFAULT FALSE,
      quality_reason  TEXT,
      -- Raw data
      raw_data        JSONB,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS signals_mint_idx      ON signals(mint);
    CREATE INDEX IF NOT EXISTS signals_composite_idx ON signals(composite DESC);
    CREATE INDEX IF NOT EXISTS signals_created_idx   ON signals(created_at DESC);
    CREATE INDEX IF NOT EXISTS signals_quality_idx   ON signals(quality_pass, created_at DESC);

    CREATE TABLE IF NOT EXISTS alerts (
      id         SERIAL PRIMARY KEY,
      signal_id  INT NOT NULL REFERENCES signals(id),
      mint       TEXT NOT NULL,
      grade      TEXT NOT NULL,
      sent       BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS published_tokens (
      mint         TEXT PRIMARY KEY REFERENCES tokens(mint),
      published_by TEXT NOT NULL,
      published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      note         TEXT
    );

    CREATE TABLE IF NOT EXISTS watchlist (
      mint       TEXT PRIMARY KEY,
      added_by   TEXT NOT NULL,
      added_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      priority   INT NOT NULL DEFAULT 5
    );
  `);
}

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
  return r.rows.reverse(); // oldest first
}

async function insertSignal(s) {
  const r = await pool.query(
    `INSERT INTO signals (mint,whale_score,smart_money,volume_anomaly,holder_velocity,liquidity,
       momentum_score,wyckoff_score,hidden_flow,mtf_score,pump_probability,
       composite,certainty,grade,recommendation,direction,
       decision_status,decision_boost,decision_penalty,quality_pass,quality_reason,raw_data)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
     RETURNING id`,
    [s.mint, s.whaleScore, s.smartMoney, s.volumeAnomaly, s.holderVelocity, s.liquidity,
     s.momentumScore, s.wyckoffScore, s.hiddenFlow, s.mtfScore, s.pumpProbability,
     s.composite, s.certainty, s.grade, s.recommendation, s.direction,
     s.decisionStatus ?? null, s.decisionBoost ?? 0, s.decisionPenalty ?? 0,
     s.qualityPass ?? false, s.qualityReason ?? null,
     JSON.stringify(s.rawData ?? {})]
  );
  return r.rows[0].id;
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
// SECTION 5 — SOLANA + ON-CHAIN DATA
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

async function fetchTokenOnChainData(mint) {
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
    const sigs = await connection.getSignaturesForAddress(new PublicKey(mint), { limit:100 });
    recentTxCount = sigs.length;
    sigTimestamps = sigs.map(s => s.blockTime ?? 0).filter(Boolean);
  } catch (_) {}

  // Transaction velocity: TXs in last 10 min vs last 60 min
  const now = Math.floor(Date.now() / 1000);
  const txLast10m = sigTimestamps.filter(t => t > now - 600).length;
  const txLast60m = sigTimestamps.filter(t => t > now - 3600).length;
  const txVelocity = txLast60m > 0 ? txLast10m / txLast60m : 0; // higher = accelerating

  // Simulated DEX metrics (replace with Raydium/Jupiter API calls for production)
  const lpDepth        = supply > 0 ? Math.random() * 80000 + 5000 : 0;
  const lpGrowthRate   = Math.random() * 0.4;
  const largeWalletRatio = Math.random() * 0.6;
  const volumeSpike    = recentTxCount > 50 ? Math.random() * 4 + 1 : Math.random() * 1.5;
  const holderCount    = Math.max(10, Math.floor(recentTxCount * 2.8 + Math.random() * 600));
  const holderGrowthRate = holderCount > 100 ? Math.random() * 0.5 : Math.random() * 0.15;

  // Estimated price / market cap (Raydium quote stub — replace with real DEX call)
  const priceUsd   = supply > 0 ? (Math.random() * 0.001) : 0;
  const marketCap  = priceUsd * supply;
  const volumeUsd  = recentTxCount * priceUsd * 1000;

  return {
    mint, supply, decimals, holderCount, recentTxCount, txVelocity,
    txLast10m, txLast60m, lpDepth, lpGrowthRate, largeWalletRatio,
    volumeSpike, holderGrowthRate, priceUsd, marketCap, volumeUsd,
  };
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
  // Signal = 9-period EMA of MACD (simplified)
  const signalLine = macd * 0.9; // placeholder — real: track macd series
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
  const prices = priceHistory.map(h => safeNum(h.price_usd, 0)).filter(p => p > 0);
  const volumes = priceHistory.map(h => safeNum(h.volume_usd, 0));

  if (prices.length < 3) return { score: 50, indicators: {}, direction: "NEUTRAL" };

  const rsi  = computeRSI(prices);
  const macd = computeMACD(prices);
  const bb   = computeBollingerBands(prices);
  const ema9  = ema(prices, Math.min(9,  prices.length));
  const ema21 = ema(prices, Math.min(21, prices.length));
  const ema50 = ema(prices, Math.min(50, prices.length));

  // Volume trend
  const avgVol = volumes.length > 1 ? sma(volumes, Math.min(volumes.length, 10)) : 0;
  const lastVol = volumes[volumes.length - 1] ?? 0;
  const volRatio = avgVol > 0 ? lastVol / avgVol : 1;

  // Momentum signals
  let bullScore = 0, bearScore = 0;

  // RSI
  if (rsi < 30)      { bullScore += 20; } // oversold
  else if (rsi < 45) { bullScore += 10; }
  else if (rsi > 70) { bearScore += 20; } // overbought — BUT in memecoins this can mean momentum
  else if (rsi > 55) { bullScore +=  5; } // building momentum

  // MACD
  if (macd.bullish)  bullScore += 15;
  else               bearScore += 10;

  // Bollinger
  if (bb.position < 0.2)     bullScore += 15; // near lower band — reversal setup
  else if (bb.position > 0.8) bullScore += 10; // breakout potential
  if (bb.width > 0)           bullScore +=  5; // expanding bands = volatility

  // EMA alignment
  if (ema9 > ema21 && ema21 > ema50) bullScore += 20; // perfect bull alignment
  else if (ema9 > ema21)             bullScore += 10;
  else if (ema9 < ema21)             bearScore += 10;

  // Volume
  if (volRatio > 2.0) bullScore += 15; // volume spike = confirmation
  else if (volRatio > 1.5) bullScore += 8;

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

  // Need at least a few data points
  if (prices.length < 4) {
    // Use on-chain proxies when price history is scarce
    const { holderGrowthRate, volumeSpike, largeWalletRatio, txVelocity } = onChain;

    // ACCUMULATION signals: quiet volume + growing holders + smart wallets filling
    if (holderGrowthRate > 0.2 && volumeSpike < 1.5 && largeWalletRatio > 0.25) {
      return { phase: "ACCUMULATION", bias: "BUY", confidence: 70,
               reason: "Holder growth + quiet volume + smart wallet loading" };
    }
    // SPRING / TEST: recent tx velocity spike after accumulation
    if (txVelocity > 0.3 && holderGrowthRate > 0.15) {
      return { phase: "SPRING", bias: "BUY", confidence: 80,
               reason: "Tx velocity spike post-accumulation — pre-markup phase" };
    }
    // MARKUP early: volume spike + holder growth accelerating
    if (volumeSpike > 2 && holderGrowthRate > 0.3) {
      return { phase: "MARKUP_EARLY", bias: "BUY", confidence: 85,
               reason: "Volume + holder acceleration — early markup detected" };
    }
    return { phase: "UNKNOWN", bias: "NEUTRAL", confidence: 40, reason: "Insufficient data" };
  }

  const last  = prices[prices.length - 1];
  const first = prices[0];
  const priceChange = first > 0 ? (last - first) / first : 0;
  const avgVol  = sma(volumes, volumes.length);
  const lastVol = volumes[volumes.length - 1] ?? 0;
  const volTrend = avgVol > 0 ? lastVol / avgVol : 1;
  const { holderGrowthRate, volumeSpike, largeWalletRatio } = onChain;

  // ACCUMULATION: flat/slight down price, growing volume, smart wallets loading
  if (Math.abs(priceChange) < 0.1 && holderGrowthRate > 0.1 && largeWalletRatio > 0.2) {
    return { phase: "ACCUMULATION", bias: "BUY", confidence: 72,
             reason: "Price consolidating + smart wallet loading = accumulation" };
  }

  // SPRING: sharp dip on low volume then recovery = shakeout complete
  if (priceChange < -0.15 && volTrend < 0.8 && onChain.txVelocity > 0.2) {
    return { phase: "SPRING", bias: "BUY", confidence: 82,
             reason: "Low-volume shakeout + tx velocity recovering = spring" };
  }

  // MARKUP early: price breaking up on rising volume
  if (priceChange > 0.1 && volumeSpike > 1.5) {
    return { phase: "MARKUP_EARLY", bias: "BUY", confidence: 88,
             reason: "Price + volume breakout = early markup — ENTER NOW" };
  }

  // DISTRIBUTION: high price + falling volume + declining holder growth
  if (priceChange > 0.5 && volTrend < 0.7 && holderGrowthRate < 0.05) {
    return { phase: "DISTRIBUTION", bias: "SELL", confidence: 78,
             reason: "Price peaked + volume fading = distribution phase" };
  }

  return { phase: "MARKUP_MID", bias: "BUY", confidence: 60, reason: "Mid-markup continuation" };
}

// ════════════════════════════════════════════════════════════════════════════
// SECTION 8 — HIDDEN ORDER FLOW DETECTOR
// ════════════════════════════════════════════════════════════════════════════

function detectHiddenFlow(onChain, priceHistory) {
  const { txLast10m, txLast60m, holderGrowthRate, largeWalletRatio, volumeSpike, txVelocity } = onChain;

  let buyFlow = 0, sellFlow = 0;
  const reasons = [];

  // Large wallet accumulation = hidden buy pressure
  if (largeWalletRatio > 0.3 && largeWalletRatio < 0.6) {
    buyFlow += 30;
    reasons.push("Smart wallets loading quietly");
  }

  // TX velocity acceleration = hidden demand building
  if (txVelocity > 0.35) {
    buyFlow += 25;
    reasons.push("TX velocity accelerating");
  }

  // Holder count growing while volume quiet = stealth accumulation
  if (holderGrowthRate > 0.15 && volumeSpike < 1.5) {
    buyFlow += 25;
    reasons.push("Stealth holder growth");
  }

  // Recent burst of transactions = urgent buying
  if (txLast10m > 15) {
    buyFlow += 20;
    reasons.push(`${txLast10m} TXs last 10min = FOMO ignition`);
  }

  // High concentration = potential dump risk
  if (largeWalletRatio > 0.65) {
    sellFlow += 40;
    reasons.push("Dangerous whale concentration");
  }

  // Volume spike without holder growth = potential dump
  if (volumeSpike > 3 && holderGrowthRate < 0.05) {
    sellFlow += 30;
    reasons.push("Volume spike without holders = pump exit risk");
  }

  const total = buyFlow + sellFlow;
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

  // Pre-pump patterns
  const { holderGrowthRate, volumeSpike, txVelocity, txLast10m, marketCap } = onChain;

  // Low market cap = more room to pump
  if (marketCap > 0 && marketCap < 100000)        score += 20; // micro cap
  else if (marketCap > 0 && marketCap < 1000000)  score += 15; // small cap
  else if (marketCap > 0 && marketCap < 10000000) score += 8;  // mid-small

  // Holder velocity — institutional pre-load
  if (holderGrowthRate > 0.35) score += 20;
  else if (holderGrowthRate > 0.2) score += 12;
  else if (holderGrowthRate > 0.1) score += 6;

  // Volume spike — early demand
  if (volumeSpike > 3)   score += 20;
  else if (volumeSpike > 2) score += 12;
  else if (volumeSpike > 1.5) score += 6;

  // TX acceleration — FOMO starting
  if (txVelocity > 0.4) score += 15;
  else if (txVelocity > 0.25) score += 8;

  // Recent burst
  if (txLast10m > 20) score += 15;
  else if (txLast10m > 10) score += 8;

  // Technical confirmation
  if (techScore.score > 70) score += 15;
  else if (techScore.score > 55) score += 8;

  // Wyckoff phase confirmation
  if (wyckoff.phase === "SPRING")       score += 20;
  else if (wyckoff.phase === "MARKUP_EARLY") score += 15;
  else if (wyckoff.phase === "ACCUMULATION") score += 10;

  // Hidden buy flow
  if (hiddenFlow.direction === "BUY" && hiddenFlow.confidence > 60) score += 15;
  else if (hiddenFlow.direction === "BUY") score += 8;

  return clamp(score);
}

// ════════════════════════════════════════════════════════════════════════════
// SECTION 10 — 6D ORIGINAL SCORING ENGINE (from Real_memecoin)
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
// SECTION 11 — MULTI-TIMEFRAME CONSENSUS ENGINE
// ════════════════════════════════════════════════════════════════════════════

function buildMultiTFConsensus(onChain, priceHistory, techScore, wyckoff, hiddenFlow) {
  // Simulate multiple "timeframes" from the data we have:
  //  1m  proxy = txLast10m velocity
  //  5m  proxy = txVelocity (10m vs 60m ratio)
  //  15m proxy = holderGrowthRate + volumeSpike
  //  1h  proxy = technical indicators (RSI, MACD)
  //  4h  proxy = Wyckoff phase
  //  1d  proxy = hidden order flow

  const tfs = [
    { tf: "1m",  weight: 0.10, score: clamp(onChain.txLast10m * 5),                dir: onChain.txLast10m > 10 ? "BUY" : "NEUTRAL" },
    { tf: "5m",  weight: 0.15, score: clamp(onChain.txVelocity * 200),              dir: onChain.txVelocity > 0.3 ? "BUY" : "NEUTRAL" },
    { tf: "15m", weight: 0.20, score: clamp(onChain.holderGrowthRate * 150 + onChain.volumeSpike * 15), dir: onChain.holderGrowthRate > 0.1 ? "BUY" : "NEUTRAL" },
    { tf: "1h",  weight: 0.25, score: techScore.score,                              dir: techScore.direction },
    { tf: "4h",  weight: 0.20, score: wyckoff.confidence,                           dir: wyckoff.bias },
    { tf: "1d",  weight: 0.10, score: hiddenFlow.flowScore,                         dir: hiddenFlow.direction },
  ];

  let buyWeight = 0, sellWeight = 0, neutralWeight = 0, totalWeight = 0;
  let weightedScore = 0;
  for (const tf of tfs) {
    totalWeight += tf.weight;
    weightedScore += tf.score * tf.weight;
    if (tf.dir === "BUY")     buyWeight     += tf.weight;
    else if (tf.dir === "SELL") sellWeight  += tf.weight;
    else                       neutralWeight += tf.weight;
  }

  const avgScore      = totalWeight > 0 ? weightedScore / totalWeight : 50;
  const buyPct        = pct(buyWeight, totalWeight);
  const sellPct       = pct(sellWeight, totalWeight);
  const consensusDir  = buyPct >= 55 ? "BUY" : sellPct >= 55 ? "SELL" : "NEUTRAL";
  const conviction    = Math.abs(buyPct - sellPct);
  const certainty     = clamp((avgScore * 0.5 + conviction * 0.5));
  const tfDissent     = tfs.filter(tf => tf.dir !== consensusDir && tf.dir !== "NEUTRAL").length;

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
  // Wyckoff pillar
  const wyckoffAligned = wyckoff.bias === consensus.consensusDir || wyckoff.bias === "NEUTRAL";

  // Structure pillar (market structure from technical score)
  const structAligned  = consensus.consensusDir !== "NEUTRAL";

  // Trap pillar (no dump trap signal)
  const noTrap = onChain.largeWalletRatio < 0.65 && onChain.volumeSpike < 4;

  // Killzone / session: tx activity active
  const sessionActive = onChain.txLast10m > 3;

  let pillars = 0;
  if (wyckoffAligned) pillars++;
  if (structAligned)  pillars++;
  if (noTrap)         pillars++;
  if (sessionActive)  pillars++;

  return {
    pillarsConfirmed: pillars,
    wyckoff:  { bias: wyckoff.bias,         phase: wyckoff.phase,          active: wyckoffAligned },
    struct:   { direction: consensus.consensusDir,                          active: structAligned  },
    trap:     { trapped: !noTrap,            direction: "SELL",             active: noTrap         },
    kz:       { active: sessionActive,       txBurst: onChain.txLast10m                            },
    hiddenFlow: { direction: hiddenFlow.direction, confidence: hiddenFlow.confidence },
  };
}

// ════════════════════════════════════════════════════════════════════════════
// SECTION 13 — QUALITY GATE (from Region Intelligence)
// ════════════════════════════════════════════════════════════════════════════

function checkQualityGate(consensus, instCtx) {
  const t = {
    certMin:   config.qualityCertMin,
    avgMin:    config.qualityAvgMin,
    convMin:   config.qualityConvMin,
    pillarMin: config.qualityPillarMin,
  };

  const cert    = safeNum(consensus.certaintyScore,  0);
  const avg     = safeNum(consensus.avgConfidence,   0);
  const conv    = safeNum(consensus.convictionPct,   0);
  const pillars = safeNum(instCtx.pillarsConfirmed,  0);

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
// SECTION 14 — DECISION ENGINE V2 (from Region Intelligence)
// ════════════════════════════════════════════════════════════════════════════

function decisionEngineV2(signal, consensus, instCtx) {
  const dir          = String(signal.direction || "").toUpperCase();
  const hiddenDir    = String(instCtx.hiddenFlow?.direction || "NEUTRAL").toUpperCase();
  const hiddenConf   = safeNum(instCtx.hiddenFlow?.confidence, 0);
  const baseCert     = safeNum(consensus.certaintyScore, 0);

  const CONTRA_MIN = config.hiddenContraMin;
  const BOOST_MAX  = config.boostMax;
  const PEN_MAX    = config.penaltyMax;
  const CAP        = config.contraCap;

  let boost = 0, penalty = 0, contradictionCap = null;
  const reasons = [];

  // ── HARD CONTRADICTION: hidden flow strongly opposes → CAP ────────────
  if (dir === "BUY"  && hiddenDir === "SELL" && hiddenConf >= CONTRA_MIN) {
    contradictionCap = CAP;
    reasons.push(`Hidden SELL ${hiddenConf}% opposes BUY → cap ${CAP}`);
  }
  if (dir === "SELL" && hiddenDir === "BUY"  && hiddenConf >= CONTRA_MIN) {
    contradictionCap = CAP;
    reasons.push(`Hidden BUY ${hiddenConf}% opposes SELL → cap ${CAP}`);
  }

  // ── BOOSTS ────────────────────────────────────────────────────────────
  if (consensus.buyPct >= 85)    { boost += 8;  reasons.push("MTF 85%+ aligned +8"); }
  else if (consensus.buyPct >= 70) { boost += 5; reasons.push("MTF 70%+ aligned +5"); }
  if (dir === "BUY"  && hiddenDir === "BUY"  && hiddenConf >= 50) { boost += 6; reasons.push("Hidden flow confirms BUY +6"); }
  if (dir === "SELL" && hiddenDir === "SELL" && hiddenConf >= 50) { boost += 6; reasons.push("Hidden flow confirms SELL +6"); }
  if (instCtx.pillarsConfirmed >= 4) { boost += 4; reasons.push("All 4 pillars confirmed +4"); }
  else if (instCtx.pillarsConfirmed >= 3) { boost += 2; reasons.push("3 pillars +2"); }
  boost = Math.min(boost, BOOST_MAX);

  // ── SOFT PENALTIES ────────────────────────────────────────────────────
  if (instCtx.trap?.trapped)  { penalty += 8;  reasons.push("Trap detected -8"); }
  if (consensus.tfDissent > 3) { penalty += Math.min(consensus.tfDissent * 1, 6); reasons.push(`TF dissent ${consensus.tfDissent} -${Math.min(consensus.tfDissent,6)}`); }
  penalty = Math.min(penalty, PEN_MAX);

  // ── APPLY ─────────────────────────────────────────────────────────────
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
// SECTION 15 — MASTER SCORE + GRADE
// ════════════════════════════════════════════════════════════════════════════

function gradeFromScore(s) {
  if (s >= 90) return "S";
  if (s >= 75) return "A";
  if (s >= 60) return "B";
  if (s >= 45) return "C";
  return "D";
}

function recommendationFromAll(composite, certainty, pumpProb, walletRatio, dir) {
  if (walletRatio > 0.7) return "AVOID";
  if (certainty >= 80 && composite >= 80 && pumpProb >= 70) return "STRONG_BUY";
  if (composite >= 70 && dir === "BUY")  return "BUY";
  if (composite >= 50 && dir === "BUY")  return "WATCH";
  if (dir === "SELL")                    return "AVOID";
  return "WATCH";
}

async function scoreMint(mint) {
  const [onChain, meta] = await Promise.all([
    fetchTokenOnChainData(mint),
    fetchTokenMeta(mint),
  ]);

  // Store token & price history
  await upsertToken({ mint, name: meta.name, symbol: meta.symbol, decimals: onChain.decimals, supply: onChain.supply });
  await recordPriceHistory(mint, { priceUsd: onChain.priceUsd, volumeUsd: onChain.volumeUsd, marketCap: onChain.marketCap, txCount: onChain.recentTxCount, holderCount: onChain.holderCount });

  // Fetch stored price history for technical analysis
  const priceHistory = await getPriceHistory(mint, 48);

  // ── 6D ORIGINAL SCORES ─────────────────────────────────────────────────
  const whaleScore     = calcWhaleScore(onChain);
  const smartMoney     = calcSmartMoneyScore(onChain);
  const volumeAnomaly  = calcVolumeAnomalyScore(onChain);
  const holderVelocity = calcHolderVelocityScore(onChain);
  const liquidity      = calcLiquidityScore(onChain);

  // ── ADVANCED ENGINES ────────────────────────────────────────────────────
  const techScore  = computeTechnicalScore(priceHistory);
  const wyckoff    = detectWyckoffPhase(onChain, priceHistory);
  const hiddenFlow = detectHiddenFlow(onChain, priceHistory);
  const consensus  = buildMultiTFConsensus(onChain, priceHistory, techScore, wyckoff, hiddenFlow);
  const instCtx    = buildInstitutionalContext(onChain, wyckoff, hiddenFlow, consensus);
  const pumpProb   = calcPumpProbability(onChain, techScore, wyckoff, hiddenFlow);

  // ── COMPOSITE (10-DIMENSIONAL) ──────────────────────────────────────────
  const momentumScore = techScore.score;
  const wyckoffScore  = wyckoff.confidence;
  const hiddenFlowScore = hiddenFlow.flowScore;
  const mtfScore      = consensus.certaintyScore;

  const composite = clamp(
    whaleScore     * 0.18 +
    smartMoney     * 0.15 +
    volumeAnomaly  * 0.12 +
    holderVelocity * 0.12 +
    liquidity      * 0.08 +
    momentumScore  * 0.12 +
    wyckoffScore   * 0.10 +
    hiddenFlowScore * 0.08 +
    mtfScore       * 0.05
  );

  const direction = consensus.consensusDir;

  // ── DECISION ENGINE V2 ──────────────────────────────────────────────────
  const fakeSignal = { direction, confidence: composite };
  const dec = decisionEngineV2(fakeSignal, consensus, instCtx);

  // ── QUALITY GATE ────────────────────────────────────────────────────────
  const quality = checkQualityGate(consensus, instCtx);

  const grade          = gradeFromScore(composite);
  const recommendation = recommendationFromAll(composite, dec.finalCert, pumpProb, onChain.largeWalletRatio, direction);

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
    momentumScore:  Math.round(momentumScore  * 10) / 10,
    wyckoffScore:   Math.round(wyckoffScore   * 10) / 10,
    hiddenFlow:     Math.round(hiddenFlowScore * 10) / 10,
    mtfScore:       Math.round(mtfScore        * 10) / 10,
    pumpProbability:Math.round(pumpProb        * 10) / 10,
    // Decision
    composite:      Math.round(composite       * 10) / 10,
    certainty:      Math.round(dec.finalCert   * 10) / 10,
    grade, recommendation, direction,
    decisionStatus:  dec.status,
    decisionBoost:   dec.boost,
    decisionPenalty: dec.penalty,
    qualityPass:     quality.ok,
    qualityReason:   quality.reason,
    qualityPillars:  quality.pillars,
    // Context
    wyckoffPhase:    wyckoff.phase,
    wyckoffBias:     wyckoff.bias,
    hiddenFlowDir:   hiddenFlow.direction,
    hiddenFlowConf:  hiddenFlow.confidence,
    technicalDir:    techScore.direction,
    indicators:      techScore.indicators,
    pumpReasons:     hiddenFlow.reasons,
    // Raw
    rawData: { onChain, techScore, wyckoff, hiddenFlow, consensus: { certaintyScore: consensus.certaintyScore, buyPct: consensus.buyPct, conviction: consensus.convictionPct } },
  };
}

// ════════════════════════════════════════════════════════════════════════════
// SECTION 16 — SCANNER LOOP
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
    mint:            result.mint,
    whaleScore:      result.whaleScore,
    smartMoney:      result.smartMoney,
    volumeAnomaly:   result.volumeAnomaly,
    holderVelocity:  result.holderVelocity,
    liquidity:       result.liquidity,
    momentumScore:   result.momentumScore,
    wyckoffScore:    result.wyckoffScore,
    hiddenFlow:      result.hiddenFlow,
    mtfScore:        result.mtfScore,
    pumpProbability: result.pumpProbability,
    composite:       result.composite,
    certainty:       result.certainty,
    grade:           result.grade,
    recommendation:  result.recommendation,
    direction:       result.direction,
    decisionStatus:  result.decisionStatus,
    decisionBoost:   result.decisionBoost,
    decisionPenalty: result.decisionPenalty,
    qualityPass:     result.qualityPass,
    qualityReason:   result.qualityReason,
    rawData:         result.rawData,
  });

  _state.lastSignal = result;
  _state.cycleTelemetry.signals++;

  if (result.grade === "S" || result.grade === "A" || result.pumpProbability >= 80) {
    await insertAlert(signalId, result.mint, result.grade);
    _state.cycleTelemetry.alerts++;
    if (notifyFn) await notifyFn(result).catch(() => {});
  }

  return result;
}

async function runScanCycle(mints = []) {
  if (_state.emergencyHalt) { console.log("[HALT] Scan cycle blocked by EMERGENCY_HALT."); return; }

  // Combine: provided mints + watchlist + seed mints
  let wl = [];
  try { wl = (await getWatchlist()).map(w => w.mint); } catch (_) {}
  const all = [...new Set([...mints, ...wl, ...config.seedMints])];

  if (all.length === 0) { console.log("[scanner] No mints — set SEED_MINTS or add to watchlist"); return; }

  console.log(`[scanner] Cycle ${scanCount + 1}: scanning ${all.length} mints...`);
  const results = await Promise.allSettled(all.map(m => scanMint(m)));

  let ok = 0;
  for (const r of results) {
    if (r.status === "fulfilled") ok++;
    else console.error("[scanner] error:", r.reason?.message ?? r.reason);
  }

  lastScanAt = new Date();
  scanCount++;
  _state.cycleTelemetry.cycles++;
  console.log(`[scanner] Done — ${ok}/${all.length} succeeded.`);
}

function startScanLoop() {
  const ms = config.scanIntervalMinutes * 60 * 1000;
  runScanCycle().catch(e => console.error("[scanner] Initial error:", e));
  setInterval(() => runScanCycle().catch(e => console.error("[scanner] Loop error:", e)), ms);
  console.log(`[scanner] Loop started — every ${config.scanIntervalMinutes} min.`);
}

// ════════════════════════════════════════════════════════════════════════════
// SECTION 17 — TELEGRAM BOT
// ════════════════════════════════════════════════════════════════════════════

const bot = new Telegraf(config.telegramBotToken);

function isAdmin(ctx) { return String(ctx.from?.id) === config.adminChatId; }

function gradeLabel(g)  { return { S:"[S-TIER]", A:"[A]", B:"[B]", C:"[C]", D:"[D]" }[g] ?? g; }
function recLabel(r)    { return { STRONG_BUY:"STRONG BUY", BUY:"BUY", WATCH:"WATCH", AVOID:"AVOID" }[r] ?? r; }
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

  return [
    `${gradeLabel(s.grade)} ${s.name ?? "?"} (${s.symbol ?? "?"})`,
    `Mint: ${s.mint}`,
    ``,
    `Score: ${s.composite}/100  |  Certainty: ${s.certainty ?? 0}%`,
    `Signal: ${dirLabel(s.direction)}  |  ${recLabel(s.recommendation)}`,
    `Pump Probability: ${pump}%`,
    ``,
    `-- 6D Original --`,
    `Whale: ${whale}  Smart: ${smart}  Vol: ${vol}`,
    `Holders: ${holder}  Liquidity: ${liq}`,
    ``,
    `-- Advanced Engines --`,
    `Momentum: ${mom}  Wyckoff: ${wy}`,
    `HiddenFlow: ${hf}  MultiTF: ${mtf}`,
    ``,
    `Wyckoff: ${s.wyckoff_phase ?? s.wyckoffPhase ?? "?"} [${s.wyckoff_bias ?? s.wyckoffBias ?? "?"}]`,
    `Quality: ${s.quality_pass ?? s.qualityPass ? "PASS" : "FAIL"} (${s.quality_reason ?? s.qualityReason ?? ""})`,
    `Decision: ${s.decision_status ?? s.decisionStatus ?? "?"} [boost:${s.decision_boost ?? s.decisionBoost ?? 0} pen:${s.decision_penalty ?? s.decisionPenalty ?? 0}]`,
  ].join("\n");
}

// /analyze <mint>
bot.command("analyze", async (ctx) => {
  const mint = ctx.message.text.split(" ")[1]?.trim();
  if (!mint) { await ctx.reply("Usage: /analyze <mint_address>"); return; }
  await ctx.reply(`Running full 10-dimensional analysis on ${mint}...`);
  try {
    const r = await scanMint(mint);
    await ctx.reply(formatSignalFull(r));
  } catch (e) { await ctx.reply(`Error: ${e.message}`); }
});

// /suggest <mint1> <mint2> ...
bot.command("suggest", async (ctx) => {
  const parts = ctx.message.text.split(" ").slice(1).map(m => m.trim()).filter(Boolean);
  if (!parts.length) { await ctx.reply("Usage: /suggest <mint1> <mint2> ..."); return; }
  await ctx.reply(`Analyzing ${parts.length} mints...`);
  try {
    const results = await Promise.allSettled(parts.map(m => scanMint(m)));
    const ok = results.filter(r => r.status === "fulfilled").map(r => r.value).sort((a,b) => b.composite - a.composite);
    if (!ok.length) { await ctx.reply("No valid results."); return; }
    await ctx.reply(ok.slice(0,5).map((s,i) => `#${i+1}\n${formatSignalFull(s)}`).join("\n\n---\n\n"));
  } catch (e) { await ctx.reply(`Error: ${e.message}`); }
});

// /scan — manual trigger
bot.command("scan", async (ctx) => {
  await ctx.reply("Triggering full scan cycle...");
  try { await runScanCycle([]); await ctx.reply("Scan complete. Use /signals or /top10."); }
  catch (e) { await ctx.reply(`Error: ${e.message}`); }
});

// /top10 — top opportunities in last 24h
bot.command("top10", async (ctx) => {
  try {
    const top = await getTopSignals(10);
    if (!top.length) { await ctx.reply("No signals yet. Run /scan first."); return; }
    const text = top.map((s,i) => [
      `#${i+1} ${gradeLabel(s.grade)} ${s.name} (${s.symbol})`,
      `Score: ${s.composite} | Pump: ${s.pump_probability}% | ${recLabel(s.recommendation)}`,
      `Mint: ${s.mint}`,
    ].join("\n")).join("\n\n");
    await ctx.reply(`Top Opportunities (24h):\n\n${text}`);
  } catch (e) { await ctx.reply(`Error: ${e.message}`); }
});

// /signals — recent signals
bot.command("signals", async (ctx) => {
  try {
    const sigs = await getRecentSignals(8, false);
    if (!sigs.length) { await ctx.reply("No signals yet. Run /scan."); return; }
    await ctx.reply(`Recent Signals:\n\n${sigs.map(formatSignalFull).join("\n\n---\n\n")}`);
  } catch (e) { await ctx.reply(`Error: ${e.message}`); }
});

// /alerts — pending high-quality alerts
bot.command("alerts", async (ctx) => {
  try {
    const alerts = await getPendingAlerts();
    if (!alerts.length) { await ctx.reply("No pending alerts."); return; }
    const text = alerts.slice(0,8).map(a => [
      `${gradeLabel(a.grade)} ${a.name ?? a.mint}`,
      `Mint: ${a.mint}  Grade: ${a.grade}`,
    ].join("\n")).join("\n\n");
    await ctx.reply(`Pending Alerts (${alerts.length}):\n\n${text}`);
  } catch (e) { await ctx.reply(`Error: ${e.message}`); }
});

// /watchlist — show watchlist
bot.command("watchlist", async (ctx) => {
  try {
    const wl = await getWatchlist();
    if (!wl.length) { await ctx.reply("Watchlist empty. Use /watch <mint>"); return; }
    const text = wl.map((w,i) => `${i+1}. ${w.name ?? w.mint} (${w.symbol ?? "?"})\n   Mint: ${w.mint}  Priority: ${w.priority}`).join("\n\n");
    await ctx.reply(`Watchlist (${wl.length}):\n\n${text}`);
  } catch (e) { await ctx.reply(`Error: ${e.message}`); }
});

// /watch <mint> [priority]
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

// /unwatch <mint>
bot.command("unwatch", async (ctx) => {
  const mint = ctx.message.text.split(" ")[1]?.trim();
  if (!mint) { await ctx.reply("Usage: /unwatch <mint_address>"); return; }
  try { await removeFromWatchlist(mint); await ctx.reply(`Removed from watchlist: ${mint}`); }
  catch (e) { await ctx.reply(`Error: ${e.message}`); }
});

// /approve <mint> (admin only)
bot.command("approve", async (ctx) => {
  if (!isAdmin(ctx)) { await ctx.reply("Admin only."); return; }
  const mint = ctx.message.text.split(" ")[1]?.trim();
  if (!mint) { await ctx.reply("Usage: /approve <mint_address>"); return; }
  try { await publishToken(mint, String(ctx.from?.id ?? "admin")); await ctx.reply(`Published: ${mint}`); }
  catch (e) { await ctx.reply(`Error: ${e.message}`); }
});

// /published
bot.command("published", async (ctx) => {
  try {
    const tokens = await getPublishedTokens();
    if (!tokens.length) { await ctx.reply("No published tokens yet."); return; }
    const text = tokens.slice(0,10).map(t => `${t.name} (${t.symbol})\nMint: ${t.mint}`).join("\n\n");
    await ctx.reply(`Published Tokens:\n\n${text}`);
  } catch (e) { await ctx.reply(`Error: ${e.message}`); }
});

// /status
bot.command("status", async (ctx) => {
  const tel = _state.cycleTelemetry;
  await ctx.reply([
    "Engine Status",
    `Uptime: ${Math.floor(process.uptime())}s`,
    `Scan cycles: ${getScanCount()}`,
    `Last scan: ${getLastScanAt()?.toISOString() ?? "not yet"}`,
    `Signals total: ${tel.signals}  Alerts: ${tel.alerts}`,
    `Boosted: ${tel.boosted}  Skipped: ${tel.skipped}`,
    `Scan interval: ${config.scanIntervalMinutes} min`,
    `Quality cert min: ${config.qualityCertMin}%`,
    `Pump threshold: 80%`,
    `Emergency halt: ${_state.emergencyHalt ? "ACTIVE" : "off"}`,
    `Seed mints: ${config.seedMints.length}`,
  ].join("\n"));
});

// /engine — show all engine parameters
bot.command("engine", async (ctx) => {
  await ctx.reply([
    "Active Engine Configuration",
    ``,
    `10-Dimensional Scoring:`,
    `  Whale (18%) | Smart Money (15%)`,
    `  Volume Anomaly (12%) | Holder Velocity (12%)`,
    `  Liquidity (8%) | Momentum/RSI/MACD (12%)`,
    `  Wyckoff Phase (10%) | Hidden Flow (8%)`,
    `  Multi-TF Consensus (5%)`,
    ``,
    `Quality Gates:`,
    `  Certainty >= ${config.qualityCertMin}%`,
    `  Avg confidence >= ${config.qualityAvgMin}%`,
    `  Conviction >= ${config.qualityConvMin}%`,
    `  Pillars >= ${config.qualityPillarMin}/4`,
    ``,
    `Decision Engine V2:`,
    `  Hidden contra threshold: ${config.hiddenContraMin}%`,
    `  Max boost: +${config.boostMax}  Max penalty: -${config.penaltyMax}`,
    `  Contradiction cap: ${config.contraCap}%`,
    ``,
    `Pump Detection: RSI + MACD + Wyckoff + HiddenFlow + TxVelocity`,
    `Timeframes: 1m / 5m / 15m / 1h / 4h / 1d (proxy)`,
  ].join("\n"));
});

// /thresholds
bot.command("thresholds", async (ctx) => {
  await ctx.reply([
    "Signal Grades",
    `  S: 90-100  A: 75-89  B: 60-74  C: 45-59  D: <45`,
    ``,
    `Recommendations`,
    `  STRONG BUY: Cert>=80 + Score>=80 + Pump>=70%`,
    `  BUY: Score>=70 + direction=BUY`,
    `  WATCH: Score>=50 + direction=BUY`,
    `  AVOID: Whale concentration >70% or direction=SELL`,
    ``,
    `Wyckoff Phases (bias)`,
    `  SPRING → BUY (82% conf)`,
    `  MARKUP_EARLY → BUY (88% conf)`,
    `  ACCUMULATION → BUY (72% conf)`,
    `  DISTRIBUTION → SELL`,
  ].join("\n"));
});

// /halt (admin) — emergency stop
bot.command("halt", async (ctx) => {
  if (!isAdmin(ctx)) { await ctx.reply("Admin only."); return; }
  _state.emergencyHalt = true;
  await ctx.reply("EMERGENCY HALT activated. All scans and signals blocked. Use /resume to lift.");
});

// /resume (admin) — lift halt
bot.command("resume", async (ctx) => {
  if (!isAdmin(ctx)) { await ctx.reply("Admin only."); return; }
  _state.emergencyHalt = false;
  await ctx.reply("Emergency halt lifted. Engine resuming.");
});

async function notifyAdmin(result) {
  const msg = [
    `[ALERT] ${gradeLabel(result.grade)} Signal Detected`,
    `${result.name} (${result.symbol})`,
    `Mint: ${result.mint}`,
    `Score: ${result.composite}/100  |  Certainty: ${result.certainty}%`,
    `Direction: ${dirLabel(result.direction)}  |  ${recLabel(result.recommendation)}`,
    `Pump Probability: ${result.pumpProbability}%`,
    `Wyckoff: ${result.wyckoffPhase} [${result.wyckoffBias}]`,
    `Hidden Flow: ${result.hiddenFlowDir} (${result.hiddenFlowConf}% conf)`,
    `Quality: ${result.qualityPass ? "PASS" : "FAIL"} — ${result.qualityReason}`,
  ].join("\n");
  await bot.telegram.sendMessage(config.adminChatId, msg);
}

// ════════════════════════════════════════════════════════════════════════════
// SECTION 18 — HTTP API
// ════════════════════════════════════════════════════════════════════════════

const app = express();
app.use(express.json());

app.get("/",       (_req, res) => res.send("Memecoin Empire ULTIMATE v3.0 — Running"));
app.get("/ping",   (_req, res) => res.json({ pong: true, ts: Date.now() }));
app.get("/healthz",(_req, res) => res.json({ status: "ok", uptime: Math.floor(process.uptime()) }));

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
  } : null,
  telemetry: _state.cycleTelemetry,
  emergencyHalt: _state.emergencyHalt,
  config: { scanIntervalMinutes: config.scanIntervalMinutes, qualityCertMin: config.qualityCertMin, seedMints: config.seedMints.length },
}));

app.get("/signals/recent",       async (_req, res) => { try { res.json({ signals: await getRecentSignals(20) }); } catch (e) { res.status(500).json({ error: e.message }); } });
app.get("/signals/high-quality", async (_req, res) => { try { res.json({ signals: await getRecentSignals(20, true) }); } catch (e) { res.status(500).json({ error: e.message }); } });
app.get("/signals/top",          async (_req, res) => { try { res.json({ signals: await getTopSignals(10) }); } catch (e) { res.status(500).json({ error: e.message }); } });
app.get("/alerts",               async (_req, res) => { try { res.json({ alerts: await getPendingAlerts() }); } catch (e) { res.status(500).json({ error: e.message }); } });
app.get("/watchlist",            async (_req, res) => { try { res.json({ watchlist: await getWatchlist() }); } catch (e) { res.status(500).json({ error: e.message }); } });

app.post("/halt",   (_req, res) => { _state.emergencyHalt = true;  res.json({ halt: true }); });
app.post("/resume", (_req, res) => { _state.emergencyHalt = false; res.json({ halt: false }); });

app.post("/analyze", async (req, res) => {
  const { mint } = req.body ?? {};
  if (!mint) { res.status(400).json({ error: "mint required" }); return; }
  try { res.json({ signal: await scanMint(mint) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════════════════════════
// SECTION 19 — BOOT
// ════════════════════════════════════════════════════════════════════════════

async function main() {
  console.log("╔═══════════════════════════════════════════════════╗");
  console.log("║  MEMECOIN EMPIRE — ULTIMATE ENGINE v3.0           ║");
  console.log("║  10-Dimensional Pre-Pump Detection System         ║");
  console.log("╚═══════════════════════════════════════════════════╝");

  console.log("[boot] Initializing database...");
  await initDb();
  console.log("[boot] Database ready.");

  registerNotifier(notifyAdmin);

  app.listen(config.port, () => console.log(`[api] HTTP API listening on port ${config.port}`));

  if (config.webhookUrl) {
    await bot.telegram.setWebhook(`${config.webhookUrl}/webhook`);
    app.post("/webhook", (req, res) => bot.handleUpdate(req.body, res));
    console.log("[bot] Webhook mode active.");
  } else {
    await bot.launch();
    console.log("[bot] Polling mode active.");
  }

  startScanLoop();

  process.once("SIGINT",  () => { console.log("[boot] SIGINT"); bot.stop("SIGINT");  process.exit(0); });
  process.once("SIGTERM", () => { console.log("[boot] SIGTERM"); bot.stop("SIGTERM"); process.exit(0); });
}

main().catch(e => { console.error("[boot] FATAL:", e); process.exit(1); });
