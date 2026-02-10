/**
 * Pro Sniper AI – Adaptive Hybrid Futures Engine
 * Main entry: get candles (REST + WebSocket latest), detect mode, run engines, risk check, return signal.
 */

import type { Candle } from "../delta";
import type { ProSniperConfig, ProSniperSignal, MarketConditionState } from "./types";
import { DEFAULT_PRO_SNIPER_CONFIG } from "./types";
import { computeIndicators } from "./indicators";
import { detectMarketCondition, getCurrentMarketState } from "./market-condition";
import { getTrendSignal } from "./trend-engine";
import { getInstitutionalPullbackSignal } from "./institutional-pullback";
import { getScalpingSignal } from "./scalping-engine";
import {
  canTrade,
  positionSize,
  getRiskState,
  getTradesThisHour,
  getLastTradeBar,
  resetRiskState,
  recordTradeOutcome,
} from "./risk-manager";

export * from "./types";
export * from "./indicators";
export * from "./market-condition";
export * from "./trend-engine";
export * from "./institutional-pullback";
export * from "./scalping-engine";
export * from "./risk-manager";
export * from "./backtest";

/**
 * Merge REST candles with latest WebSocket candle if available (same symbol/resolution).
 * WebSocket candle (live) replaces or appends to last bar so strategy sees real-time close.
 */
export function mergeCandlesWithLive(
  candles: Candle[],
  liveCandle: { time: number; open: string; high: string; low: string; close: string; volume: string; symbol?: string } | null
): Candle[] {
  if (!liveCandle || candles.length === 0) return candles;
  const t = liveCandle.time;
  const last = candles[candles.length - 1];
  if (!last) return candles;
  const lastTime = typeof last.time === "number" ? last.time : parseInt(String(last.time), 10);
  if (t === lastTime) {
    return [
      ...candles.slice(0, -1),
      {
        time: t,
        open: last.open,
        high: liveCandle.high,
        low: liveCandle.low,
        close: liveCandle.close,
        volume: liveCandle.volume ?? last.volume,
      },
    ];
  }
  if (t > lastTime) {
    return [
      ...candles,
      {
        time: t,
        open: liveCandle.open,
        high: liveCandle.high,
        low: liveCandle.low,
        close: liveCandle.close,
        volume: liveCandle.volume ?? "0",
      },
    ];
  }
  return candles;
}

export interface ProSniperLiveResult {
  signal: ProSniperSignal | null;
  marketState: MarketConditionState | null;
  positionSize: number;
  canTrade: boolean;
  reason?: string;
}

/**
 * Get live signal for BTCUSD 15m using candles (REST + optional WebSocket merge).
 * Caller should pass candles from getHistory and optionally merge with getLatestCandle() from delta-socket.
 */
export function getProSniperSignal(
  candles: Candle[],
  balanceUsd: number,
  hasOpenPosition: boolean,
  config: ProSniperConfig = DEFAULT_PRO_SNIPER_CONFIG
): ProSniperLiveResult {
  const minCandles = 220;
  if (candles.length < minCandles) {
    return {
      signal: null,
      marketState: getCurrentMarketState(),
      positionSize: 0,
      canTrade: false,
      reason: "Insufficient candles",
    };
  }

  const ind = computeIndicators(candles);
  const i = ind.closes.length - 1;
  const state = detectMarketCondition(ind, i);

  const can = canTrade(config, balanceUsd, hasOpenPosition);
  if (!can.ok) {
    return {
      signal: null,
      marketState: state,
      positionSize: 0,
      canTrade: false,
      reason: can.reason,
    };
  }

  const lastTradeBar = getLastTradeBar();
  let signal: ProSniperSignal | null = null;

  if (state.engine === "TREND") {
    signal = getTrendSignal(ind, state, i, lastTradeBar);
  }
  if (!signal && (state.mode === "TREND_UP" || state.mode === "TREND_DOWN")) {
    signal = getInstitutionalPullbackSignal(ind, state, i);
  }
  if (!signal && state.engine === "SCALPING") {
    signal = getScalpingSignal(ind, state, i, getTradesThisHour(), config.scalpingMaxTradesPerHour);
  }

  if (!signal) {
    return {
      signal: null,
      marketState: state,
      positionSize: 0,
      canTrade: true,
    };
  }

  const size = positionSize(balanceUsd, signal.entryPrice, signal.stopLoss, config);
  return {
    signal,
    marketState: state,
    positionSize: size,
    canTrade: true,
  };
}

/**
 * Record trade outcome (call after close for live/backtest).
 */
export function recordProSniperTrade(pnlPct: number, barIndex: number, engine: "TREND" | "INSTITUTIONAL_PULLBACK" | "SCALPING"): void {
  recordTradeOutcome(pnlPct, barIndex, engine);
}

export { getCurrentMarketState, resetRiskState, getRiskState };
