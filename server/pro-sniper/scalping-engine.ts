/**
 * Pro Sniper – Smart Scalping Engine
 * Volatility mode only. Breakout of previous 5-candle high/low, ADX > 20, ATR expanding, volume spike.
 * SL = 0.6×ATR, TP = 1.2×ATR. Max 2 trades per hour. Disabled during sideways.
 */

import type { ProSniperSignal } from "./types";
import type { IndicatorSeries } from "./indicators";
import type { MarketConditionState } from "./types";

const BREAKOUT_LOOKBACK = 5;
const ADX_MIN = 20;
const VOLUME_SPIKE_MULT = 1.2;
const ATR_EXPANSION_MULT = 1.0;
const SL_ATR_MULT = 0.6;
const TP_ATR_MULT = 1.2;

export function getScalpingSignal(
  ind: IndicatorSeries,
  state: MarketConditionState,
  i: number,
  tradesLastHour: number,
  maxTradesPerHour: number
): ProSniperSignal | null {
  if (state.mode !== "VOLATILITY") return null;
  if (tradesLastHour >= maxTradesPerHour) return null;

  if (state.adx < ADX_MIN) return null;
  if (state.volumeAvg <= 0 || state.volumeRatio < VOLUME_SPIKE_MULT) return null;
  if (state.atrAvg20 <= 0 || state.atr < state.atrAvg20 * ATR_EXPANSION_MULT) return null;

  const { closes, highs, lows, atr } = ind;
  if (i < BREAKOUT_LOOKBACK) return null;

  const c = closes[i]!;
  const prevHigh = Math.max(...highs.slice(i - BREAKOUT_LOOKBACK, i));
  const prevLow = Math.min(...lows.slice(i - BREAKOUT_LOOKBACK, i));
  const atrVal = atr[i] ?? 0;
  if (atrVal <= 0) return null;

  if (c >= prevHigh * 0.999) {
    const entryPrice = c;
    const stopLoss = entryPrice - SL_ATR_MULT * atrVal;
    const takeProfit = entryPrice + TP_ATR_MULT * atrVal;
    return {
      side: "buy",
      engine: "SCALPING",
      entryPrice,
      stopLoss,
      takeProfit,
      riskR: 0.6,
      reason: "Scalp long: 5-candle breakout, ADX>20, ATR expanding, volume spike",
    };
  }

  if (c <= prevLow * 1.001) {
    const entryPrice = c;
    const stopLoss = entryPrice + SL_ATR_MULT * atrVal;
    const takeProfit = entryPrice - TP_ATR_MULT * atrVal;
    return {
      side: "sell",
      engine: "SCALPING",
      entryPrice,
      stopLoss,
      takeProfit,
      riskR: 0.6,
      reason: "Scalp short: 5-candle breakout, ADX>20, ATR expanding, volume spike",
    };
  }

  return null;
}
