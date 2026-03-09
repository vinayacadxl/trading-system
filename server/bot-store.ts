import type { Candle } from "./strategy-engine";
import { StrategyPreset } from "./strategy-engine";
import fs from "fs";
import path from "path";

/**
 * Persisted state: bot status and config.
 */
const STATE_FILE = path.resolve(process.cwd(), "bot-state.json");
const BOT_DATA_DIR = path.resolve(process.cwd(), ".bot-data");

function ensureBotDataDir(): void {
  if (!fs.existsSync(BOT_DATA_DIR)) {
    fs.mkdirSync(BOT_DATA_DIR, { recursive: true });
  }
}

export interface BotConfig {
  symbol: string;
  resolution: string;
  strategyType: "ema_crossover" | "rsi" | "pro_sniper" | "adaptive";
  strategyPreset: StrategyPreset;
  holdBars: number;
  riskPct: number;
  maxDailyLossPct: number;
  cooldownMs: number;
}

export interface StoredTrade {
  id: string;
  symbol: string;
  side: "buy" | "sell";
  size: number;
  price: string;
  at: number;
  confidence?: number;
  status: "executed" | "filled" | "rejected";
  orderId?: number;
}

function todayKey(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

let running = false;
let startedAt: number | undefined;
let config: BotConfig = {
  symbol: "BTCUSD",
  resolution: "15m",
  strategyType: "adaptive" as const,
  strategyPreset: "alpha_one" as const,
  holdBars: 6,
  riskPct: 3,           // 3% risk per trade (was 10% – zyada aggressive)
  maxDailyLossPct: 10,  // 10% daily loss limit (was 20%)
  cooldownMs: 60_000,
};

function saveState() {
  try {
    const data = JSON.stringify({ running, config, startedAt }, null, 2);
    fs.writeFileSync(STATE_FILE, data);
  } catch (e) {
    console.error("Failed to save bot state:", e);
  }
}

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const data = JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
      if (typeof data.running === "boolean") running = data.running;
      if (data.config) config = { ...config, ...data.config };
      if (data.startedAt) startedAt = data.startedAt;
      console.log(`Bot state loaded: running=${running}, symbol=${config.symbol}`);
    }
  } catch (e) {
    console.error("Failed to load bot state:", e);
  }
}

const trades: StoredTrade[] = [];
let dailyPnL = 0;
let dayStart = todayKey();
let lastTradeAt: number | undefined;
let lastSignalConfidence: number = 0;
let lastExecutionMessage: string = "Waiting for next signal...";
let currentRegime: { regime: string; strategy: string; reason: string; adx?: number } | undefined;

function resetDailyIfNewDay(): void {
  const today = todayKey();
  if (today !== dayStart) {
    dayStart = today;
    dailyPnL = 0;
  }
}

export function botStart(newConfig?: Partial<BotConfig>): void {
  if (newConfig) {
    config = { ...config, ...newConfig };
    config.riskPct = Math.max(0.5, Math.min(5, config.riskPct));
    config.maxDailyLossPct = Math.max(3, Math.min(15, config.maxDailyLossPct));
    config.cooldownMs = Math.max(10_000, Math.min(600_000, config.cooldownMs));
    config.holdBars = Math.max(1, Math.min(50, config.holdBars));
  }
  running = true;
  startedAt = Date.now();
  resetDailyIfNewDay();
  saveState();
}

export function botStop(): void {
  running = false;
  startedAt = undefined;
  saveState();
}

export function botIsRunning(): boolean {
  return running;
}

export function botGetConfig(): BotConfig {
  return { ...config };
}

export function botUpdateConfig(partial: Partial<BotConfig>): void {
  config = { ...config, ...partial };
  config.riskPct = Math.max(0.5, Math.min(5, config.riskPct));
  config.maxDailyLossPct = Math.max(3, Math.min(15, config.maxDailyLossPct));
  config.cooldownMs = Math.max(10_000, Math.min(600_000, config.cooldownMs));
  config.holdBars = Math.max(1, Math.min(50, config.holdBars));
  saveState();
}

export function botSetCurrentRegime(regime: { regime: string; strategy: string; reason: string; adx?: number } | undefined, confidence: number = 0, message?: string): void {
  currentRegime = regime;
  lastSignalConfidence = confidence;
  if (message) lastExecutionMessage = message;
}

let lastAnalyzedCandle: { time: number; close: number } | undefined;

export function botSetLastAnalyzedCandle(candle: { time: number; close: number }) {
  lastAnalyzedCandle = candle;
}

export function botUpdateHeartbeat() {
  // placeholder
}

let lastLoopTime = 0;
export function botSetLastLoopTime(time: number) {
  lastLoopTime = time;
}

// Update getStatus to use the real loop time
export function botGetStatus(): {
  running: boolean;
  startedAt?: number;
  config: BotConfig;
  tradesCount: number;
  dailyPnL: number;
  dayStart: string;
  lastTradeAt?: number;
  currentRegime?: { regime: string; strategy: string; reason: string; adx?: number };
  lastSignalConfidence: number;
  lastExecutionMessage: string;
  lastAnalyzedCandle?: { time: number; close: number };
  trades: StoredTrade[];
  signals: StoredSignal[];
  lastScanTime: number;
} {
  resetDailyIfNewDay();
  return {
    running,
    startedAt,
    config: botGetConfig(),
    tradesCount: trades.length,
    dailyPnL,
    dayStart,
    lastTradeAt,
    currentRegime,
    lastSignalConfidence,
    lastExecutionMessage,
    lastAnalyzedCandle,
    trades: trades.slice(-50),
    signals: signals.slice(-50).reverse(),
    lastScanTime: lastLoopTime || Date.now(),
  };
}

export async function botRecordTrade(trade: Omit<StoredTrade, "id" | "at">, pnlUsd?: number): Promise<void> {
  const { recordTradeResult } = await import("./position-storage");
  lastTradeAt = Date.now();
  trades.push({
    confidence: lastSignalConfidence,
    ...trade,
    id: `t-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    at: lastTradeAt,
    status: "executed"
  });
  if (pnlUsd != null) {
    await recordTradeResult(pnlUsd);
    // Sync local dailyPnL for legacy UI if needed, but best is to rely on DB
    dailyPnL += pnlUsd;
  }
}

export function botGetTrades(): StoredTrade[] {
  return [...trades];
}

/** Returns true if daily loss limit exceeded – bot should stop. */
export function botDailyLossExceeded(balanceUsd: number): boolean {
  if (balanceUsd <= 0) return true;
  resetDailyIfNewDay();
  const limit = balanceUsd * (config.maxDailyLossPct / 100);
  return dailyPnL <= -limit;
}

/** Returns true if cooldown has passed since last trade. */
export function botCanTrade(): boolean {
  if (lastTradeAt == null) return true;
  return Date.now() - lastTradeAt >= config.cooldownMs;
}

/** Max loss in one trade = 5% of balance (SL 1.2% hit). Ek trade me zyada nuksan nahi. */
const MAX_LOSS_PER_TRADE_PCT = 5;
const SL_PCT_FOR_CAP = 1.2;

/** Position size in quote: (balanceUsd * riskPct/100 * leverage) / price. */
export function botPositionSize(balanceUsd: number, price: number, leverage: number = 1, availableUsd?: number, sizeMultiplier: number = 1.0): number {
  if (price <= 0) return 0;

  const effectiveBalance = availableUsd !== undefined ? availableUsd : balanceUsd;

  // CAP: Koi bhi ek trade me max 5% balance loss na ho (SL hit par)
  // size * price * (SL%/100) <= balance * (MAX_LOSS_PER_TRADE_PCT/100)
  const maxLossUsd = balanceUsd * (MAX_LOSS_PER_TRADE_PCT / 100);
  const maxSizeByLoss = maxLossUsd / (price * (SL_PCT_FOR_CAP / 100));
  const MIN_BTC_SIZE = 0.0005; // ~ $35 notional @ 70k. Even smaller is possible on Delta India (1 contract = $1).

  if (balanceUsd < 100) {
    // Calculated Size: use slightly more conservative leverage for small accounts
    // but ensure it meets the $1 minimum contract requirement
    let size = (balanceUsd * 15 * sizeMultiplier) / price;

    const maxSafeNotional = balanceUsd * 20; // Max 20x for absolute safety
    if (size * price > maxSafeNotional) size = maxSafeNotional / price;

    // Ek trade me 5% se zyada loss na ho (at 1.2% SL)
    if (size > maxSizeByLoss) size = maxSizeByLoss;

    if (size < MIN_BTC_SIZE) {
      // Final fallback: if even 15x leverage is too small for 0.0005 BTC, try to just take 0.001 BTC if risk allows
      const absoluteMinSize = 1.1 / price; // ~1 USD notional (1 contract)
      if (size < absoluteMinSize && balanceUsd >= 10) {
        size = absoluteMinSize || size;
      } else if (size < absoluteMinSize) {
        console.log(`[BOT] Skip: Even minimum 1 contract would risk too much. Need balance > $10.`);
        return 0;
      }
    }

    const requiredMargin = (size * price) / leverage;
    if (requiredMargin > effectiveBalance * 0.95) {
      console.log(`[BOT] Insufficient margin. Need $${requiredMargin.toFixed(2)}, Have $${effectiveBalance.toFixed(2)}`);
      return 0;
    }

    console.log(`[BOT] SMALL ACCOUNT (Calculated): Bal=$${balanceUsd.toFixed(2)}, Size=${size.toFixed(4)} BTC, Leverage=${leverage}x`);
    return Math.round(size * 1000) / 1000;
  }

  // Normal calculation for higher balances
  const marginUsd = balanceUsd * (config.riskPct / 100);
  const actualMarginUsd = Math.min(marginUsd, effectiveBalance * 0.95);
  const notionalUsd = actualMarginUsd * leverage;
  let size = notionalUsd / price;

  const MIN_NOTIONAL = 25;

  if (notionalUsd < MIN_NOTIONAL && balanceUsd >= 2) {
    size = MIN_NOTIONAL / price;
    console.log(`[BOT] Size boosted to meet $${MIN_NOTIONAL} minimum notional. Size: ${size.toFixed(4)} BTC`);
  }
  if (size < MIN_BTC_SIZE && balanceUsd >= 2) {
    size = MIN_BTC_SIZE;
    console.log(`[BOT] Size set to minimum ${MIN_BTC_SIZE} BTC to meet exchange requirements`);
  }

  // CAP: Ek trade me max 5% loss (SL 1.2% hit) – kabhi bhi isse zyada size mat lo
  if (size > maxSizeByLoss) {
    size = maxSizeByLoss;
    console.log(`[BOT] Size capped so one SL hit = max ${MAX_LOSS_PER_TRADE_PCT}% of balance. Size: ${size.toFixed(4)} BTC`);
  }

  const roundedSize = Math.round(size * 100) / 100;

  if (roundedSize < MIN_BTC_SIZE && balanceUsd >= 5) {
    const aggressiveSize = (balanceUsd * 0.2 * leverage) / price;
    const finalSize = Math.max(MIN_BTC_SIZE, Math.round(aggressiveSize * 100) / 100);
    const cappedSize = Math.min(finalSize, maxSizeByLoss);
    if (cappedSize < MIN_BTC_SIZE) return 0;
    console.log(`[BOT] AGGRESSIVE MODE (capped by max loss). Final size: ${cappedSize.toFixed(2)} BTC`);
    return Math.round(cappedSize * 100) / 100;
  }

  const checkMargin = (roundedSize * price) / leverage;
  if (checkMargin > effectiveBalance * 0.98) {
    console.log(`[BOT] Insufficient available margin. Need $${checkMargin.toFixed(2)}, Have $${effectiveBalance.toFixed(2)}`);
    return 0;
  }

  return Math.max(0, roundedSize);
}

export interface StoredSignal {
  id: string;
  time: number;
  symbol: string;
  signal: string;
  confidence: number;
  action: "executed" | "skipped" | "failed";
  reason: string;
  price?: string;
}

// In-memory cache for live display (limited to 100 items)
const signals: StoredSignal[] = [];

export function botRecordSignal(signal: Omit<StoredSignal, "id" | "time">) {
  const last = signals[signals.length - 1];
  // Deduplicate: same symbol/signal/action/reason within 90s so Signal History stays readable but not empty
  if (last &&
    last.symbol === signal.symbol &&
    last.signal === signal.signal &&
    last.action === signal.action &&
    last.reason === signal.reason &&
    Date.now() - last.time < 90_000) {
    return;
  }

  signals.push({
    id: `s-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    time: Date.now(),
    ...signal
  });
  if (signals.length > 100) signals.shift();
}

export function botGetSignals(): StoredSignal[] {
  return [...signals].reverse();
}


function loadPersistedTradesAndSignals(): void {
  // Now handled by DB, in-memory caches start fresh or optionally could be hydrated from DB
}

// Auto-load state on module start (after signals/trades are defined)
loadState();
loadPersistedTradesAndSignals();

