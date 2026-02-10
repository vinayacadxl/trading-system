/**
 * Pro Sniper – Backtest Engine
 * Commission 0.04%, slippage, ATR-based SL/TP, trail after 1R (trend).
 * Output: P&L, Winrate, Profit Factor, R:R, Max DD, Sharpe, Trades, Long/Short, Monthly.
 */

import type { Candle } from "../delta";
import type {
  ProSniperConfig,
  ProSniperBacktestResult,
  BacktestTrade,
  ProSniperSignal,
} from "./types";
import { DEFAULT_PRO_SNIPER_CONFIG } from "./types";
import { computeIndicators } from "./indicators";
import { detectMarketCondition } from "./market-condition";
import { getTrendSignal } from "./trend-engine";
import { getInstitutionalPullbackSignal } from "./institutional-pullback";
import { getScalpingSignal } from "./scalping-engine";
import {
  canTrade,
  recordTradeOutcome,
  resetRiskState,
} from "./risk-manager";

const MIN_CANDLES = 220; // need 200+ for EMA200
const MAX_BARS_HOLD = 50;

function simulateExit(
  side: "buy" | "sell",
  entryIndex: number,
  entryPrice: number,
  stopLoss: number,
  takeProfit: number,
  closes: number[],
  highs: number[],
  lows: number[],
  trailAfterR: boolean
): { exitIndex: number; exitPrice: number; pnlPct: number; exitReason: "sl" | "tp" | "trail" | "holdBars"; pnlR: number } {
  const risk = side === "buy" ? entryPrice - stopLoss : stopLoss - entryPrice;
  if (risk <= 0) {
    const exitPrice = closes[entryIndex]!;
    const pnlPct = 0;
    return { exitIndex: entryIndex, exitPrice, pnlPct, exitReason: "holdBars", pnlR: 0 };
  }

  for (let k = 1; k <= MAX_BARS_HOLD; k++) {
    const j = entryIndex + k;
    if (j >= closes.length) {
      const exitPrice = closes[closes.length - 1]!;
      const pnlPct = side === "buy"
        ? ((exitPrice - entryPrice) / entryPrice) * 100
        : ((entryPrice - exitPrice) / entryPrice) * 100;
      const pnlR = side === "buy" ? (exitPrice - entryPrice) / risk : (entryPrice - exitPrice) / risk;
      return { exitIndex: closes.length - 1, exitPrice, pnlPct, exitReason: "holdBars", pnlR };
    }
    const high = highs[j]!;
    const low = lows[j]!;
    const close = closes[j]!;

    if (side === "buy") {
      if (low <= stopLoss) {
        const pnlPct = ((stopLoss - entryPrice) / entryPrice) * 100;
        const pnlR = (stopLoss - entryPrice) / risk;
        return { exitIndex: j, exitPrice: stopLoss, pnlPct, exitReason: "sl", pnlR };
      }
      if (high >= takeProfit) {
        const pnlPct = ((takeProfit - entryPrice) / entryPrice) * 100;
        const pnlR = (takeProfit - entryPrice) / risk;
        return { exitIndex: j, exitPrice: takeProfit, pnlPct, exitReason: "tp", pnlR };
      }
      if (trailAfterR && high >= entryPrice + risk) {
        const trailSl = entryPrice;
        if (low <= trailSl) {
          const pnlPct = ((trailSl - entryPrice) / entryPrice) * 100;
          const pnlR = (trailSl - entryPrice) / risk;
          return { exitIndex: j, exitPrice: trailSl, pnlPct, exitReason: "trail", pnlR };
        }
      }
    } else {
      if (high >= stopLoss) {
        const pnlPct = ((entryPrice - stopLoss) / entryPrice) * 100;
        const pnlR = (entryPrice - stopLoss) / risk;
        return { exitIndex: j, exitPrice: stopLoss, pnlPct, exitReason: "sl", pnlR };
      }
      if (low <= takeProfit) {
        const pnlPct = ((entryPrice - takeProfit) / entryPrice) * 100;
        const pnlR = (entryPrice - takeProfit) / risk;
        return { exitIndex: j, exitPrice: takeProfit, pnlPct, exitReason: "tp", pnlR };
      }
      if (trailAfterR && low <= entryPrice - risk) {
        const trailSl = entryPrice;
        if (high >= trailSl) {
          const pnlPct = ((entryPrice - trailSl) / entryPrice) * 100;
          const pnlR = (entryPrice - trailSl) / risk;
          return { exitIndex: j, exitPrice: trailSl, pnlPct, exitReason: "trail", pnlR };
        }
      }
    }

    if (k === MAX_BARS_HOLD) {
      const pnlPct = side === "buy"
        ? ((close - entryPrice) / entryPrice) * 100
        : ((entryPrice - close) / entryPrice) * 100;
      const pnlR = side === "buy" ? (close - entryPrice) / risk : (entryPrice - close) / risk;
      return { exitIndex: j, exitPrice: close, pnlPct, exitReason: "holdBars", pnlR };
    }
  }

  const j = entryIndex + MAX_BARS_HOLD;
  const exitPrice = closes[j]!;
  const pnlPct = side === "buy"
    ? ((exitPrice - entryPrice) / entryPrice) * 100
    : ((entryPrice - exitPrice) / entryPrice) * 100;
  const pnlR = side === "buy" ? (exitPrice - entryPrice) / risk : (entryPrice - exitPrice) / risk;
  return { exitIndex: j, exitPrice, pnlPct, exitReason: "holdBars", pnlR };
}

export function runProSniperBacktest(
  candles: Candle[],
  config: ProSniperConfig = DEFAULT_PRO_SNIPER_CONFIG
): ProSniperBacktestResult {
  resetRiskState();
  const len = candles.length;
  if (len < MIN_CANDLES) {
    return {
      totalPnlPct: 0,
      netProfitPct: 0,
      winRatePct: 0,
      profitFactor: 0,
      avgRR: 0,
      maxDrawdownPct: 0,
      sharpeRatio: 0,
      totalTrades: 0,
      wins: 0,
      losses: 0,
      longTrades: 0,
      shortTrades: 0,
      longWinRate: 0,
      shortWinRate: 0,
      monthlyPnl: [],
      equityCurve: [100],
      tradeLog: [],
      marketModeBreakdown: [],
    };
  }

  const ind = computeIndicators(candles);
  const { closes, highs, lows } = ind;
  const commissionPct = config.commissionPct * 100 * 2; // round trip
  const slippagePct = config.slippagePct * 100 * 2;

  const equityCurve: number[] = [100];
  const tradeLog: BacktestTrade[] = [];
  const monthlyPnl: { month: string; pnlPct: number }[] = [];
  const modeStats = new Map<string, { trades: number; wins: number; pnlPct: number }>();

  let lastExitBar = -999;
  const startBar = MIN_CANDLES - 1;
  const endBar = len - 2;

  for (let i = startBar; i <= endBar; i++) {
    const state = detectMarketCondition(ind, i);
    const can = canTrade(config, 100, false);
    if (!can.ok) {
      equityCurve.push(equityCurve[equityCurve.length - 1]!);
      continue;
    }

    let signal: ProSniperSignal | null = null;

    if (state.engine === "TREND") {
      signal = getTrendSignal(ind, state, i, lastExitBar);
    } else if (state.engine === "INSTITUTIONAL_PULLBACK" || (state.mode === "TREND_UP" || state.mode === "TREND_DOWN")) {
      signal = getInstitutionalPullbackSignal(ind, state, i);
    }
    if (state.engine === "SCALPING" && !signal) {
      const barsPerHour = 4; // 15m
      const tradesLastHour = tradeLog.filter((t) => t.barIndex >= i - barsPerHour).length;
      signal = getScalpingSignal(ind, state, i, tradesLastHour, config.scalpingMaxTradesPerHour);
    }
    if (!signal && state.engine === "TREND") {
      signal = getTrendSignal(ind, state, i, lastExitBar);
    }

    if (!signal) {
      equityCurve.push(equityCurve[equityCurve.length - 1]!);
      continue;
    }

    const entryPrice = signal.entryPrice * (1 + (signal.side === "buy" ? config.slippagePct : -config.slippagePct));
    const exitResult = simulateExit(
      signal.side,
      i,
      entryPrice,
      signal.stopLoss,
      signal.takeProfit,
      closes,
      highs,
      lows,
      signal.engine === "TREND"
    );

    const netPnlPct = exitResult.pnlPct - commissionPct - slippagePct;
    if (signal.engine !== "NONE") {
      recordTradeOutcome(netPnlPct, exitResult.exitIndex, signal.engine);
    }
    lastExitBar = exitResult.exitIndex;

    const prevEquity = equityCurve[equityCurve.length - 1] ?? 100;
    for (let k = i + 1; k < exitResult.exitIndex; k++) equityCurve.push(prevEquity);
    equityCurve.push(prevEquity + netPnlPct);

    const modeKey = state.mode;
    const stat = modeStats.get(modeKey) ?? { trades: 0, wins: 0, pnlPct: 0 };
    stat.trades++;
    if (netPnlPct > 0) stat.wins++;
    stat.pnlPct += netPnlPct;
    modeStats.set(modeKey, stat);

    tradeLog.push({
      barIndex: i,
      side: signal.side,
      engine: signal.engine,
      entryPrice,
      exitPrice: exitResult.exitPrice,
      stopLoss: signal.stopLoss,
      takeProfit: signal.takeProfit,
      pnlPct: netPnlPct,
      pnlR: exitResult.pnlR,
      exitReason: exitResult.exitReason,
      commissionPct,
    });

    i = exitResult.exitIndex;
  }

  const totalTrades = tradeLog.length;
  const wins = tradeLog.filter((t) => t.pnlPct > 0).length;
  const losses = totalTrades - wins;
  const totalPnlPct = equityCurve.length > 1 ? (equityCurve[equityCurve.length - 1] ?? 100) - 100 : 0;
  const grossPnlPct = tradeLog.reduce((s, t) => s + t.pnlPct, 0);
  const netProfitPct = totalPnlPct;
  const winRatePct = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;
  const totalWinPct = tradeLog.filter((t) => t.pnlPct > 0).reduce((s, t) => s + t.pnlPct, 0);
  const totalLossPct = Math.abs(tradeLog.filter((t) => t.pnlPct < 0).reduce((s, t) => s + t.pnlPct, 0));
  const profitFactor = totalLossPct > 0 ? totalWinPct / totalLossPct : totalWinPct > 0 ? 999 : 0;
  const avgRR = tradeLog.length > 0 ? tradeLog.reduce((s, t) => s + t.pnlR, 0) / tradeLog.length : 0;

  let maxDrawdownPct = 0;
  let peak = 100;
  for (const eq of equityCurve) {
    if (eq > peak) peak = eq;
    const dd = peak - eq;
    if (dd > maxDrawdownPct) maxDrawdownPct = dd;
  }

  const returns = [];
  for (let i = 1; i < equityCurve.length; i++) {
    const r = ((equityCurve[i]! - equityCurve[i - 1]!) / (equityCurve[i - 1]! || 1)) * 100;
    returns.push(r);
  }
  const avgReturn = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
  const stdReturn = returns.length > 1
    ? Math.sqrt(returns.reduce((s, r) => s + (r - avgReturn) ** 2, 0) / (returns.length - 1))
    : 0;
  const sharpeRatio = stdReturn > 0 ? (avgReturn / stdReturn) * Math.sqrt(252 * 24 * 4) : 0; // rough annualized for 15m

  const longTrades = tradeLog.filter((t) => t.side === "buy").length;
  const shortTrades = tradeLog.filter((t) => t.side === "sell").length;
  const longWins = tradeLog.filter((t) => t.side === "buy" && t.pnlPct > 0).length;
  const shortWins = tradeLog.filter((t) => t.side === "sell" && t.pnlPct > 0).length;
  const longWinRate = longTrades > 0 ? (longWins / longTrades) * 100 : 0;
  const shortWinRate = shortTrades > 0 ? (shortWins / shortTrades) * 100 : 0;

  const monthMap = new Map<string, number>();
  candles.forEach((c, idx) => {
    if (idx >= len) return;
    const t = c.time;
    const d = new Date(t * 1000);
    const month = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    monthMap.set(month, (monthMap.get(month) ?? 0) + 0);
  });
  tradeLog.forEach((t) => {
    const barTime = candles[t.barIndex]?.time;
    if (barTime == null) return;
    const d = new Date(barTime * 1000);
    const month = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    monthMap.set(month, (monthMap.get(month) ?? 0) + t.pnlPct);
  });
  const monthlyPnlList = Array.from(monthMap.entries()).map(([month, pnlPct]) => ({ month, pnlPct }));

  const marketModeBreakdown = Array.from(modeStats.entries()).map(([mode, s]) => ({
    mode: mode as import("./types").MarketMode,
    trades: s.trades,
    winRate: s.trades > 0 ? (s.wins / s.trades) * 100 : 0,
    pnlPct: s.pnlPct,
  }));

  return {
    totalPnlPct: grossPnlPct,
    netProfitPct,
    winRatePct,
    profitFactor: profitFactor >= 999 ? 999 : profitFactor,
    avgRR,
    maxDrawdownPct,
    sharpeRatio,
    totalTrades,
    wins,
    losses,
    longTrades,
    shortTrades,
    longWinRate,
    shortWinRate,
    monthlyPnl: monthlyPnlList,
    equityCurve,
    tradeLog,
    marketModeBreakdown,
  };
}
