/**
 * Pro Sniper – Market Condition Detection Engine
 * TREND (up/down), SIDEWAYS, VOLATILITY. Stores current mode, updates dynamically.
 */

import type { MarketMode, MarketConditionState, ActiveEngine } from "./types";
import type { IndicatorSeries } from "./indicators";
import { emaSlopePct } from "./indicators";

const ADX_TREND_MIN = 20;
const ADX_SIDEWAYS_MAX = 18;
const EMA200_SLOPE_LOOKBACK = 5;
const ATR_AVG_PERIOD = 20;
const VOLUME_SPIKE_MULT = 1.5;
const ATR_EXPANSION_MULT = 1.0; // ATR above 20-period avg
const BREAKOUT_LOOKBACK = 5;
const PRICE_INSIDE_EMA200_PCT = 0.003; // price within 0.3% of EMA200 = "inside zone"

let currentState: MarketConditionState | null = null;

function getAtrAvg20(atr: number[], i: number): number {
  if (i < ATR_AVG_PERIOD) return atr[Math.max(0, i)] ?? 0;
  let sum = 0;
  for (let k = i - ATR_AVG_PERIOD; k < i; k++) sum += atr[k] ?? 0;
  return sum / ATR_AVG_PERIOD;
}

/**
 * Detect market mode at bar i using EMA200, EMA50, EMA20, ADX(14), ATR(14), RSI(14), Volume.
 */
export function detectMarketCondition(
  ind: IndicatorSeries,
  i: number
): MarketConditionState {
  const {
    closes,
    highs,
    lows,
    ema20,
    ema50,
    ema200,
    adx,
    atr,
    rsi,
    vol,
    volAvg20,
  } = ind;

  const price = closes[i] ?? 0;
  const ema200Val = ema200[i] ?? 0;
  const ema50Val = ema50[i] ?? 0;
  const ema20Val = ema20[i] ?? 0;
  const adxVal = adx[i] ?? 0;
  const atrVal = atr[i] ?? 0;
  const rsiVal = rsi[i] ?? 50;
  const volVal = vol[i] ?? 0;
  const volAvg = volAvg20[i] ?? volVal;

  const atrAvg20 = getAtrAvg20(atr, i);
  const ema200Slope = emaSlopePct(ema200, EMA200_SLOPE_LOOKBACK)[i] ?? 0;

  // Price "inside EMA200 zone" = within small % of EMA200
  const distToEma200 = ema200Val > 0 ? Math.abs(price - ema200Val) / ema200Val : 0;
  const priceInsideEma200Zone = distToEma200 <= PRICE_INSIDE_EMA200_PCT;

  // EMA50 "aligned" with EMA200 = same side (both above or both below for trend)
  const ema50AboveEma200 = ema50Val >= ema200Val;
  const priceAboveEma200 = price >= ema200Val;

  // Breakout of previous 5 candle high/low
  let breakoutHigh = false;
  let breakoutLow = false;
  if (i >= BREAKOUT_LOOKBACK) {
    const prevHigh = Math.max(...highs.slice(i - BREAKOUT_LOOKBACK, i).map((h) => h));
    const prevLow = Math.min(...lows.slice(i - BREAKOUT_LOOKBACK, i).map((l) => l));
    const c = closes[i]!;
    breakoutHigh = c >= prevHigh * 0.999;
    breakoutLow = c <= prevLow * 1.001;
  }

  const volumeSpike = volAvg > 0 && volVal >= volAvg * VOLUME_SPIKE_MULT;
  const atrExpanding = atrAvg20 > 0 && atrVal >= atrAvg20 * ATR_EXPANSION_MULT;

  // ---- VOLATILITY MODE ----
  if (
    atrExpanding &&
    volumeSpike &&
    (breakoutHigh || breakoutLow)
  ) {
    const state: MarketConditionState = {
      mode: "VOLATILITY",
      engine: "SCALPING",
      reason: `ATR expanding, volume spike ${(volVal / (volAvg || 1)).toFixed(2)}x, breakout 5-candle`,
      adx: adxVal,
      atr: atrVal,
      atrAvg20,
      ema200: ema200Val,
      ema50: ema50Val,
      ema20: ema20Val,
      rsi: rsiVal,
      volumeAvg: volAvg,
      volumeRatio: volAvg > 0 ? volVal / volAvg : 1,
    };
    currentState = state;
    return state;
  }

  // ---- TREND MODE ----
  if (adxVal > ADX_TREND_MIN) {
    const slopePositive = ema200Slope > 0;
    const slopeNegative = ema200Slope < 0;
    const alignedUp = priceAboveEma200 && ema50AboveEma200;
    const alignedDown = !priceAboveEma200 && !ema50AboveEma200;

    if ((slopePositive || slopeNegative) && (alignedUp || alignedDown)) {
      const mode: MarketMode = alignedUp ? "TREND_UP" : "TREND_DOWN";
      const state: MarketConditionState = {
        mode,
        engine: "TREND",
        reason: `ADX ${adxVal.toFixed(1)} > ${ADX_TREND_MIN}, EMA200 slope ${ema200Slope.toFixed(2)}%, aligned`,
        adx: adxVal,
        atr: atrVal,
        atrAvg20,
        ema200: ema200Val,
        ema50: ema50Val,
        ema20: ema20Val,
        rsi: rsiVal,
        volumeAvg: volAvg,
        volumeRatio: volAvg > 0 ? volVal / volAvg : 1,
      };
      currentState = state;
      return state;
    }
  }

  // ---- SIDEWAYS MODE ----
  if (
    adxVal < ADX_SIDEWAYS_MAX &&
    priceInsideEma200Zone &&
    atrAvg20 > 0 &&
    atrVal < atrAvg20 * 1.2
  ) {
    const state: MarketConditionState = {
      mode: "SIDEWAYS",
      engine: "NONE",
      reason: `ADX ${adxVal.toFixed(1)} < ${ADX_SIDEWAYS_MAX}, price in EMA200 zone, low ATR`,
      adx: adxVal,
      atr: atrVal,
      atrAvg20,
      ema200: ema200Val,
      ema50: ema50Val,
      ema20: ema20Val,
      rsi: rsiVal,
      volumeAvg: volAvg,
      volumeRatio: volAvg > 0 ? volVal / volAvg : 1,
    };
    currentState = state;
    return state;
  }

  // Default: if ADX suggests trend, use trend; else sideways
  if (adxVal > ADX_TREND_MIN) {
    const mode: MarketMode = priceAboveEma200 ? "TREND_UP" : "TREND_DOWN";
    const state: MarketConditionState = {
      mode,
      engine: "TREND",
      reason: `ADX ${adxVal.toFixed(1)} > ${ADX_TREND_MIN}`,
      adx: adxVal,
      atr: atrVal,
      atrAvg20,
      ema200: ema200Val,
      ema50: ema50Val,
      ema20: ema20Val,
      rsi: rsiVal,
      volumeAvg: volAvg,
      volumeRatio: volAvg > 0 ? volVal / volAvg : 1,
    };
    currentState = state;
    return state;
  }

  const state: MarketConditionState = {
    mode: "SIDEWAYS",
    engine: "NONE",
    reason: `ADX ${adxVal.toFixed(1)}`,
    adx: adxVal,
    atr: atrVal,
    atrAvg20,
    ema200: ema200Val,
    ema50: ema50Val,
    ema20: ema20Val,
    rsi: rsiVal,
    volumeAvg: volAvg,
    volumeRatio: volAvg > 0 ? volVal / volAvg : 1,
  };
  currentState = state;
  return state;
}

export function getCurrentMarketState(): MarketConditionState | null {
  return currentState;
}

export function clearMarketState(): void {
  currentState = null;
}
