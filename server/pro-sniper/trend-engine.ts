/**
 * Pro Sniper – Controlled Trend Engine
 * Long: price > EMA200, EMA20 > EMA50, pullback to EMA20, bullish candle, RSI > 50.
 * Short: opposite. SL = 1×ATR, TP = 2×ATR, trail after 1R. Cooldown 5 candles.
 */

import type { ProSniperSignal } from "./types";
import type { IndicatorSeries } from "./indicators";
import type { MarketConditionState } from "./types";

const RSI_LONG_MIN = 50;
const RSI_SHORT_MAX = 50;
const COOLDOWN_CANDLES = 5;

function isBullishCandle(open: number, close: number): boolean {
  return close > open;
}
function isBearishCandle(open: number, close: number): boolean {
  return close < open;
}

/** Pullback to EMA20: price was above EMA20, touched or went below, now back above (long); or opposite (short). */
function pullbackToEma20Long(
  closes: number[],
  lows: number[],
  ema20: number[],
  i: number
): boolean {
  if (i < 2) return false;
  const c = closes[i]!;
  const prevLow = lows[i - 1] ?? lows[i];
  const emaNow = ema20[i]!;
  const emaPrev = ema20[i - 1]!;
  const prevClose = closes[i - 1]!;
  // Had to be above EMA20 before; at least one low touched EMA20 zone; close back above
  const wasAbove = (closes[i - 2] ?? prevClose) > (ema20[i - 2] ?? emaPrev);
  const touchedZone = prevLow <= emaNow * 1.002;
  const closeAbove = c > emaNow;
  return wasAbove && touchedZone && closeAbove;
}

function pullbackToEma20Short(
  closes: number[],
  highs: number[],
  ema20: number[],
  i: number
): boolean {
  if (i < 2) return false;
  const c = closes[i]!;
  const prevHigh = highs[i - 1] ?? highs[i];
  const emaNow = ema20[i]!;
  const prevClose = closes[i - 1]!;
  const wasBelow = (closes[i - 2] ?? prevClose) < (ema20[i - 2] ?? emaNow);
  const touchedZone = prevHigh >= emaNow * 0.998;
  const closeBelow = c < emaNow;
  return wasBelow && touchedZone && closeBelow;
}

export function getTrendSignal(
  ind: IndicatorSeries,
  state: MarketConditionState,
  i: number,
  lastTradeBar: number
): ProSniperSignal | null {
  if (state.mode !== "TREND_UP" && state.mode !== "TREND_DOWN") return null;
  if (i - lastTradeBar < COOLDOWN_CANDLES) return null;

  const { opens, closes, highs, lows, ema20, ema50, ema200, atr, rsi } = ind;
  const open = opens[i] ?? closes[i]!;
  const c = closes[i]!;
  const ema20Val = ema20[i]!;
  const ema50Val = ema50[i]!;
  const ema200Val = ema200[i]!;
  const atrVal = atr[i] ?? 0;
  const rsiVal = rsi[i] ?? 50;

  if (atrVal <= 0) return null;

  // Long
  if (state.mode === "TREND_UP") {
    if (c <= ema200Val) return null;
    if (ema20Val <= ema50Val) return null;
    if (rsiVal <= RSI_LONG_MIN) return null;
    if (!pullbackToEma20Long(closes, lows, ema20, i)) return null;
    if (!isBullishCandle(open, c)) return null;

    const entryPrice = c;
    const stopLoss = entryPrice - atrVal;
    const takeProfit = entryPrice + 2 * atrVal;
    return {
      side: "buy",
      engine: "TREND",
      entryPrice,
      stopLoss,
      takeProfit,
      riskR: 1,
      reason: "Trend long: pullback EMA20, bullish, RSI>50",
    };
  }

  // Short
  if (state.mode === "TREND_DOWN") {
    if (c >= ema200Val) return null;
    if (ema20Val >= ema50Val) return null;
    if (rsiVal >= RSI_SHORT_MAX) return null;
    if (!pullbackToEma20Short(closes, highs, ema20, i)) return null;
    if (!isBearishCandle(open, c)) return null;

    const entryPrice = c;
    const stopLoss = entryPrice + atrVal;
    const takeProfit = entryPrice - 2 * atrVal;
    return {
      side: "sell",
      engine: "TREND",
      entryPrice,
      stopLoss,
      takeProfit,
      riskR: 1,
      reason: "Trend short: pullback EMA20, bearish, RSI<50",
    };
  }

  return null;
}
