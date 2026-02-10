import type { Candle } from "./strategy-engine";
import { StrategyPreset } from "./strategy-engine";
/**
 * In-memory bot state (no database).
 * Risk: position size = balance × risk %, stop if daily loss > maxDailyLoss, cooldown between trades.
 */

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
  strategyPreset: "lightning_scalper" as const,
  holdBars: 6,
  riskPct: 10, // Increased to 10% for much higher daily profit
  maxDailyLossPct: 20, // Increased limit to allow for higher volatility
  cooldownMs: 60_000,
};
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
    config.riskPct = Math.max(0.1, Math.min(10, config.riskPct));
    config.maxDailyLossPct = Math.max(1, Math.min(50, config.maxDailyLossPct));
    config.cooldownMs = Math.max(10_000, Math.min(600_000, config.cooldownMs));
    config.holdBars = Math.max(1, Math.min(50, config.holdBars));
  }
  running = true;
  startedAt = Date.now();
  resetDailyIfNewDay();
}

export function botStop(): void {
  running = false;
  startedAt = undefined;
}

export function botIsRunning(): boolean {
  return running;
}

export function botGetConfig(): BotConfig {
  return { ...config };
}

/** Update config only (does not start the bot). */
export function botUpdateConfig(partial: Partial<BotConfig>): void {
  config = { ...config, ...partial };
  config.riskPct = Math.max(0.1, Math.min(10, config.riskPct));
  config.maxDailyLossPct = Math.max(1, Math.min(50, config.maxDailyLossPct));
  config.cooldownMs = Math.max(10_000, Math.min(600_000, config.cooldownMs));
  config.holdBars = Math.max(1, Math.min(50, config.holdBars));
}

export function botSetCurrentRegime(regime: { regime: string; strategy: string; reason: string; adx?: number } | undefined, confidence: number = 0, message?: string): void {
  currentRegime = regime;
  lastSignalConfidence = confidence;
  if (message) lastExecutionMessage = message;
}

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
  };
}

export function botRecordTrade(trade: Omit<StoredTrade, "id" | "at">, pnlUsd?: number): void {
  lastTradeAt = Date.now();
  trades.push({
    ...trade,
    id: `t-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    at: lastTradeAt,
    confidence: lastSignalConfidence,
    status: "executed"
  });
  if (pnlUsd != null) {
    resetDailyIfNewDay();
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

/** Position size in quote (contract size): (balanceUsd * riskPct/100) / price. */
export function botPositionSize(balanceUsd: number, price: number): number {
  const riskUsd = balanceUsd * (config.riskPct / 100);
  if (price <= 0) return 0;
  const size = riskUsd / price;
  return Math.max(0, Math.round(size * 1e6) / 1e6);
}
