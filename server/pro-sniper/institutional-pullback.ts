/**
 * Pro Sniper – Institutional Pullback Model
 * Strong trend: liquidity sweep (wick break then close inside), rejection candle, volume spike.
 * SL at swing high/low, TP = 2.5R, partial at 1.5R, trail remaining.
 */

import type { ProSniperSignal } from "./types";
import type { IndicatorSeries } from "./indicators";
import type { MarketConditionState } from "./types";

const SWING_LOOKBACK = 10;
const VOLUME_SPIKE_MULT = 1.2;
const REJECTION_BODY_RATIO = 0.5; // body < 50% of range = rejection

/** Long: wick below recent low then close back above (sweep then reject). */
function liquiditySweepLong(
  opens: number[],
  closes: number[],
  highs: number[],
  lows: number[],
  i: number
): { swingLow: number } | null {
  if (i < SWING_LOOKBACK + 1) return null;
  const low = lows[i]!;
  const close = closes[i]!;
  const open = opens[i]!;
  const recentLows = lows.slice(i - SWING_LOOKBACK, i).map((l) => l);
  const swingLow = Math.min(...recentLows);
  const prevLow = Math.min(...lows.slice(i - 5, i));
  if (low <= prevLow * 1.001 && close > open && close > (low + (highs[i]! - low) * 0.6)) {
    const body = Math.abs(close - open);
    const range = highs[i]! - low;
    if (range > 0 && body / range <= REJECTION_BODY_RATIO) return { swingLow };
  }
  return null;
}

/** Short: wick above recent high then close back below. */
function liquiditySweepShort(
  opens: number[],
  closes: number[],
  highs: number[],
  lows: number[],
  i: number
): { swingHigh: number } | null {
  if (i < SWING_LOOKBACK + 1) return null;
  const high = highs[i]!;
  const close = closes[i]!;
  const open = opens[i]!;
  const recentHighs = highs.slice(i - SWING_LOOKBACK, i).map((h) => h);
  const swingHigh = Math.max(...recentHighs);
  const prevHigh = Math.max(...highs.slice(i - 5, i));
  if (high >= prevHigh * 0.999 && close < open && close < (high - (high - lows[i]!) * 0.6)) {
    const body = Math.abs(close - open);
    const range = high - lows[i]!;
    if (range > 0 && body / range <= REJECTION_BODY_RATIO) return { swingHigh };
  }
  return null;
}

export function getInstitutionalPullbackSignal(
  ind: IndicatorSeries,
  state: MarketConditionState,
  i: number
): ProSniperSignal | null {
  if (state.mode !== "TREND_UP" && state.mode !== "TREND_DOWN") return null;
  if (state.volumeAvg <= 0 || state.volumeRatio < VOLUME_SPIKE_MULT) return null;

  const { opens, closes, highs, lows, atr } = ind;
  const atrVal = atr[i] ?? 0;
  if (atrVal <= 0) return null;

  if (state.mode === "TREND_UP") {
    const sweep = liquiditySweepLong(opens, closes, highs, lows, i);
    if (!sweep) return null;
    const entryPrice = closes[i]!;
    const stopLoss = Math.min(sweep.swingLow, entryPrice - atrVal);
    const risk = entryPrice - stopLoss;
    if (risk <= 0) return null;
    const takeProfit = entryPrice + 2.5 * risk;
    return {
      side: "buy",
      engine: "INSTITUTIONAL_PULLBACK",
      entryPrice,
      stopLoss,
      takeProfit,
      riskR: 1,
      partialCloseR: 1.5,
      reason: "Institutional long: liquidity sweep + rejection, volume spike",
    };
  }

  if (state.mode === "TREND_DOWN") {
    const sweep = liquiditySweepShort(opens, closes, highs, lows, i);
    if (!sweep) return null;
    const entryPrice = closes[i]!;
    const stopLoss = Math.max(sweep.swingHigh, entryPrice + atrVal);
    const risk = stopLoss - entryPrice;
    if (risk <= 0) return null;
    const takeProfit = entryPrice - 2.5 * risk;
    return {
      side: "sell",
      engine: "INSTITUTIONAL_PULLBACK",
      entryPrice,
      stopLoss,
      takeProfit,
      riskR: 1,
      partialCloseR: 1.5,
      reason: "Institutional short: liquidity sweep + rejection, volume spike",
    };
  }

  return null;
}
