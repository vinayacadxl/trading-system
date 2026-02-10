/**
 * Pro Sniper – Indicators: EMA20, EMA50, EMA200, ADX(14), ATR(14), RSI(14), Volume avg.
 * Reuses strategy-engine where possible.
 */

import type { Candle } from "../delta";
import {
  calculateEMA,
  calculateATR,
  calculateADXSeries,
} from "../strategy-engine";

function calculateRSI(closes: number[], period: number = 14): number[] {
  if (closes.length <= period) return closes.map(() => 50);
  const rsis: number[] = Array(period).fill(50);
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i]! - closes[i - 1]!;
    if (diff >= 0) avgGain += diff;
    else avgLoss -= diff;
  }
  avgGain /= period;
  avgLoss /= period;
  rsis.push(100 - 100 / (1 + avgGain / (avgLoss || 1e-10)));
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i]! - closes[i - 1]!;
    avgGain = (avgGain * (period - 1) + (diff > 0 ? diff : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (diff < 0 ? -diff : 0)) / period;
    rsis.push(100 - 100 / (1 + avgGain / (avgLoss || 1e-10)));
  }
  return rsis;
}

/** Volume series (parsed) and 20-period average */
function volumeSeries(candles: Candle[]): { vol: number[]; volAvg20: number[] } {
  const vol = candles.map((c) => parseFloat(c.volume || "0"));
  const volAvg20: number[] = [];
  const period = 20;
  for (let i = 0; i < vol.length; i++) {
    if (i < period - 1) {
      volAvg20.push(vol.slice(0, i + 1).reduce((a, b) => a + b, 0) / (i + 1));
    } else {
      volAvg20.push(
        vol.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0) / period
      );
    }
  }
  return { vol, volAvg20 };
}

export interface IndicatorSeries {
  opens: number[];
  closes: number[];
  highs: number[];
  lows: number[];
  ema20: number[];
  ema50: number[];
  ema200: number[];
  adx: number[];
  atr: number[];
  rsi: number[];
  vol: number[];
  volAvg20: number[];
}

const ADX_PERIOD = 14;
const ATR_PERIOD = 14;
const RSI_PERIOD = 14;

export function computeIndicators(candles: Candle[]): IndicatorSeries {
  const opens = candles.map((c) => parseFloat(c.open));
  const closes = candles.map((c) => parseFloat(c.close));
  const highs = candles.map((c) => parseFloat(c.high));
  const lows = candles.map((c) => parseFloat(c.low));

  const ema20 = calculateEMA(closes, 20);
  const ema50 = calculateEMA(closes, 50);
  const ema200 = calculateEMA(closes, 200);
  const { adx: adxSeries } = calculateADXSeries(candles, ADX_PERIOD);
  const atr = calculateATR(candles, ATR_PERIOD);
  const rsi = calculateRSI(closes, RSI_PERIOD);
  const { vol, volAvg20 } = volumeSeries(candles);

  return {
    opens,
    closes,
    highs,
    lows,
    ema20,
    ema50,
    ema200,
    adx: adxSeries,
    atr,
    rsi,
    vol,
    volAvg20,
  };
}

/** EMA slope over last N bars (percent change). Used for trend alignment. */
export function emaSlopePct(ema: number[], lookback: number = 5): number[] {
  const out: number[] = [];
  for (let i = 0; i < ema.length; i++) {
    if (i < lookback) out.push(0);
    else {
      const prev = ema[i - lookback] ?? ema[i];
      const change = prev ? ((ema[i]! - prev) / prev) * 100 : 0;
      out.push(change);
    }
  }
  return out;
}
