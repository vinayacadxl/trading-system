/**
 * Pro Sniper – Full Risk Management Engine
 * Risk per trade 1–2%, daily max 4%, stop after 3 consecutive losses.
 * Position size = (balance × risk%) / stop_loss_distance. One open position, cooldown after loss.
 */

import type { ProSniperConfig } from "./types";

export interface RiskState {
  dailyPnLPct: number;
  consecutiveLosses: number;
  lastTradeBar: number;
  lastTradeHour: number;
  tradesThisHour: number;
}

const defaultRiskState: RiskState = {
  dailyPnLPct: 0,
  consecutiveLosses: 0,
  lastTradeBar: -999,
  lastTradeHour: -1,
  tradesThisHour: 0,
};

let riskState: RiskState = { ...defaultRiskState };
let dayStart = "";

function todayKey(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function resetDailyIfNewDay(): void {
  const today = todayKey();
  if (today !== dayStart) {
    dayStart = today;
    riskState.dailyPnLPct = 0;
    riskState.consecutiveLosses = 0;
    riskState.tradesThisHour = 0;
    riskState.lastTradeHour = -1;
  }
}

function currentHour(): number {
  return Math.floor(Date.now() / (60 * 60 * 1000));
}

export function resetRiskState(): void {
  riskState = { ...defaultRiskState };
  dayStart = todayKey();
}

export function getRiskState(): RiskState {
  resetDailyIfNewDay();
  const hour = currentHour();
  if (hour !== riskState.lastTradeHour) {
    riskState.tradesThisHour = 0;
    riskState.lastTradeHour = hour;
  }
  return { ...riskState };
}

/** Can we take a new trade? (daily loss, consecutive losses, one position enforced by caller). */
export function canTrade(
  config: ProSniperConfig,
  balanceUsd: number,
  hasOpenPosition: boolean
): { ok: boolean; reason?: string } {
  resetDailyIfNewDay();
  if (hasOpenPosition) return { ok: false, reason: "One position at a time" };
  const limitPct = balanceUsd * (config.maxDailyLossPct / 100);
  const dailyLoss = Math.abs(Math.min(0, riskState.dailyPnLPct / 100 * balanceUsd));
  if (dailyLoss >= limitPct) return { ok: false, reason: "Daily max loss exceeded" };
  if (riskState.consecutiveLosses >= config.maxConsecutiveLosses)
    return { ok: false, reason: "Max consecutive losses" };
  return { ok: true };
}

/** Position size in quote: (balance × risk%) / stop_loss_distance. stopLossDistance = |entry - stopLoss|. */
export function positionSize(
  balanceUsd: number,
  entryPrice: number,
  stopLoss: number,
  config: ProSniperConfig
): number {
  const riskUsd = balanceUsd * (config.riskPct / 100);
  const stopDistance = Math.abs(entryPrice - stopLoss);
  if (stopDistance <= 0) return 0;
  const size = riskUsd / stopDistance;
  return Math.max(0, Math.round(size * 1e6) / 1e6);
}

/** Call after a trade is closed (for backtest or live). */
export function recordTradeOutcome(
  pnlPct: number,
  barIndex: number,
  engine: "SCALPING" | "TREND" | "INSTITUTIONAL_PULLBACK"
): void {
  resetDailyIfNewDay();
  riskState.dailyPnLPct += pnlPct;
  riskState.lastTradeBar = barIndex;
  const hour = currentHour();
  if (hour === riskState.lastTradeHour) {
    riskState.tradesThisHour++;
  } else {
    riskState.lastTradeHour = hour;
    riskState.tradesThisHour = 1;
  }
  if (pnlPct < 0) {
    riskState.consecutiveLosses++;
  } else {
    riskState.consecutiveLosses = 0;
  }
}

/** Number of trades in the current hour (for scalping limit). */
export function getTradesThisHour(): number {
  resetDailyIfNewDay();
  const hour = currentHour();
  if (hour !== riskState.lastTradeHour) return 0;
  return riskState.tradesThisHour;
}

export function getLastTradeBar(): number {
  return riskState.lastTradeBar;
}
