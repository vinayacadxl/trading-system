
import type { Candle } from "./delta";
export type { Candle };

export type StrategyType = "ema_crossover" | "rsi";

/** Available strategy presets */
export type StrategyPreset = "pro_sniper_v3" | "momentum_master" | "trend_rider" | "lightning_scalper";

/** Adaptive regime types for dynamic strategy switching */
export type AdaptiveRegime = "TRENDING_UP" | "TRENDING_DOWN" | "SIDEWAYS" | "HIGH_VOLATILITY";

/** Active strategy name per regime (for logging) */
export type ActiveStrategyName = "EMA_TREND" | "RSI_MEAN_REVERSION" | "BREAKOUT" | "SCALPING";

/** Strategy configuration */
export interface StrategyConfig {
  name: string;
  description: string;
  adxTrendThreshold: number;
  adxSidewaysThreshold: number;
  cooldownBars: number;
  rsiOversold: number;
  rsiOverbought: number;
  leverage: number;
  volumeMultiplier: number;
  riskRewardRatio: number;
  atrStopMultiplier: number;
  maxHoldingBars: number;
}

/** Predefined strategy configurations */
export const STRATEGY_PRESETS: Record<StrategyPreset, StrategyConfig> = {
  pro_sniper_v3: {
    name: "Pro Sniper V3",
    description: "Balanced quality trades with 3:1 RR - Best for consistent profits",
    adxTrendThreshold: 25,
    adxSidewaysThreshold: 25,
    cooldownBars: 2,
    rsiOversold: 30,
    rsiOverbought: 70,
    leverage: 25,
    volumeMultiplier: 1.1,
    riskRewardRatio: 3.0,
    atrStopMultiplier: 2.0,
    maxHoldingBars: 30,
  },
  momentum_master: {
    name: "Momentum Master",
    description: "Aggressive momentum trading - Higher risk, higher reward",
    adxTrendThreshold: 30,
    adxSidewaysThreshold: 20,
    cooldownBars: 1,
    rsiOversold: 35,
    rsiOverbought: 65,
    leverage: 35,
    volumeMultiplier: 1.3,
    riskRewardRatio: 4.0,
    atrStopMultiplier: 1.5,
    maxHoldingBars: 20,
  },
  trend_rider: {
    name: "Trend Rider",
    description: "Conservative trend following - Lower risk, steady gains",
    adxTrendThreshold: 22,
    adxSidewaysThreshold: 28,
    cooldownBars: 3,
    rsiOversold: 25,
    rsiOverbought: 75,
    leverage: 15,
    volumeMultiplier: 1.0,
    riskRewardRatio: 2.5,
    atrStopMultiplier: 2.5,
    maxHoldingBars: 40,
  },
  lightning_scalper: {
    name: "Lightning Scalper",
    description: "Golden Scalp - Triple Trend Filter, 15x leverage",
    adxTrendThreshold: 22,
    adxSidewaysThreshold: 25,
    cooldownBars: 2,
    rsiOversold: 30,
    rsiOverbought: 70,
    leverage: 15,
    volumeMultiplier: 1.4,
    riskRewardRatio: 3.0,
    atrStopMultiplier: 2.5,
    maxHoldingBars: 20,
  },
};

/**
 * Basic Exponential Moving Average calculation
 */
export function calculateEMA(data: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const ema: number[] = [data[0]];
  for (let i = 1; i < data.length; i++) {
    ema.push(data[i] * k + ema[i - 1] * (1 - k));
  }
  return ema;
}

/**
 * Standard Moving Average (SMA)
 */
export function calculateSMA(data: number[], period: number): number[] {
  const sma: number[] = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      sma.push(data[i]); // rough init
    } else {
      const sum = data.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
      sma.push(sum / period);
    }
  }
  return sma;
}

/**
 * MACD Calculation
 */
export function calculateMACD(closes: number[], fast: number = 12, slow: number = 26, signalLen: number = 9): { macdLine: number[], signalLine: number[], histogram: number[] } {
  const emaFast = calculateEMA(closes, fast);
  const emaSlow = calculateEMA(closes, slow);
  const macdLine = emaFast.map((v, i) => v - emaSlow[i]);
  const signalLine = calculateEMA(macdLine, signalLen);
  const histogram = macdLine.map((v, i) => v - signalLine[i]);
  return { macdLine, signalLine, histogram };
}

/**
 * Bollinger Bands
 */
export function calculateBollingerBands(closes: number[], period: number = 20, stdDevMult: number = 2): { upper: number[], lower: number[], middle: number[] } {
  const mid = calculateSMA(closes, period);
  const upper: number[] = [];
  const lower: number[] = [];

  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) {
      upper.push(mid[i]);
      lower.push(mid[i]);
      continue;
    }
    const slice = closes.slice(i - period + 1, i + 1);
    const mean = mid[i];
    const variance = slice.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / period;
    const stdDev = Math.sqrt(variance);
    upper.push(mean + stdDev * stdDevMult);
    lower.push(mean - stdDev * stdDevMult);
  }
  return { upper, lower, middle: mid };
}

/**
 * ATR (Average True Range) per bar, period 14. First `period` bars filled with 0 then valid ATR.
 */
export function calculateATR(candles: Candle[], period: number = 14): number[] {
  if (candles.length < 2) return candles.map(() => 0);
  const tr: number[] = [0];
  for (let i = 1; i < candles.length; i++) {
    const high = parseFloat(candles[i].high);
    const low = parseFloat(candles[i].low);
    const prevClose = parseFloat(candles[i - 1].close);
    tr.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
  }
  const atr: number[] = Array(period).fill(0);
  let smoothed = tr.slice(1, period + 1).reduce((a, b) => a + b, 0) / period;
  atr.push(smoothed);
  for (let i = period + 1; i < tr.length; i++) {
    smoothed = (smoothed * (period - 1) + tr[i]!) / period;
    atr.push(smoothed);
  }
  return atr;
}

/**
 * Wilder-smoothed ADX series: returns adx[], plusDI[], minusDI[] per bar.
 */
export function calculateADXSeries(candles: Candle[], period: number = 14): { adx: number[]; plusDI: number[]; minusDI: number[] } {
  const len = candles.length;
  // Initialize with 'period' zeros to align with 'i' loop starting at 'period'
  const adx: number[] = Array(period).fill(0);
  const plusDI: number[] = Array(period + 1).fill(0);
  const minusDI: number[] = Array(period + 1).fill(0);
  if (len < period + 2) return { adx, plusDI, minusDI };

  const tr: number[] = [0];
  const plusDM: number[] = [0];
  const minusDM: number[] = [0];
  for (let i = 1; i < len; i++) {
    const high = parseFloat(candles[i].high);
    const low = parseFloat(candles[i].low);
    const prevHigh = parseFloat(candles[i - 1].high);
    const prevLow = parseFloat(candles[i - 1].low);
    const prevClose = parseFloat(candles[i - 1].close);
    tr.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
    const upMove = high - prevHigh;
    const downMove = prevLow - low;
    plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
  }
  let smoothTR = tr.slice(1, period + 1).reduce((a, b) => a + b, 0);
  let smoothPlus = plusDM.slice(1, period + 1).reduce((a, b) => a + b, 0);
  let smoothMinus = minusDM.slice(1, period + 1).reduce((a, b) => a + b, 0);
  for (let i = period; i < len; i++) {
    if (i > period) {
      smoothTR = smoothTR - smoothTR / period + tr[i]!;
      smoothPlus = smoothPlus - smoothPlus / period + plusDM[i]!;
      smoothMinus = smoothMinus - smoothMinus / period + minusDM[i]!;
    }
    const diPlus = 100 * (smoothPlus / (smoothTR || 1));
    const diMinus = 100 * (smoothMinus / (smoothTR || 1));
    plusDI.push(diPlus);
    minusDI.push(diMinus);
    const dx = 100 * Math.abs(diPlus - diMinus) / (diPlus + diMinus || 1);
    if (i === period) adx.push(dx);
    else {
      const lastADX = adx[adx.length - 1] ?? 0;
      adx.push((lastADX * (period - 1) + dx) / period);
    }
  }
  return { adx, plusDI, minusDI };
}

/**
 * EMA slope (% change over lookback bars). First `lookback` bars = 0.
 */
function emaSlopePct(ema: number[], lookback: number = 5): number[] {
  const out: number[] = [];
  for (let i = 0; i < ema.length; i++) {
    if (i < lookback) out.push(0);
    else {
      const diff = ema[i] - ema[i - lookback];
      const pct = (diff / ema[i - lookback]) * 100;
      out.push(pct);
    }
  }
  return out;
}

/**
 * RSI calculation with alignment padding
 */
export function calculateRSI(closes: number[], period: number = 14): number[] {
  // Align with input array by padding with neutral 50
  const rsis: number[] = Array(period).fill(50);

  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) avgGain += diff;
    else avgLoss -= diff;
  }
  avgGain /= period;
  avgLoss /= period;

  // RSI for index 'period'
  rsis.push(100 - 100 / (1 + avgGain / (avgLoss || 1e-10)));

  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + (diff > 0 ? diff : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (diff < 0 ? -diff : 0)) / period;
    rsis.push(100 - 100 / (1 + avgGain / (avgLoss || 1e-10)));
  }
  return rsis;
}

/**
 * Volume average calculation
 */
function calculateVolumeAvg(volumes: number[], period: number = 20): number[] {
  const avg: number[] = [];
  for (let i = 0; i < volumes.length; i++) {
    if (i < period) {
      avg.push(volumes.slice(0, i + 1).reduce((a, b) => a + b, 0) / (i + 1));
    } else {
      avg.push(volumes.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0) / period);
    }
  }
  return avg;
}

export interface MarketRegime {
  regime: "Up" | "Down" | "Side";
  adx: number;
  reason: string;
}

export function detectMarketRegime(candles: Candle[]): MarketRegime {
  if (candles.length < 50) {
    return { regime: "Side", adx: 0, reason: "Insufficient data" };
  }

  const closes = candles.map((c) => parseFloat(c.close));
  const currentPrice = closes[closes.length - 1];
  const ema200List = calculateEMA(closes, 200);
  const ema200 = ema200List[ema200List.length - 1];
  const adx = calculateADX(candles, 14);

  const TREND_STRENGTH = 25; // RESTORED to 25 to avoid noise
  const SIDEWAYS_STRENGTH = 20;

  if (adx > TREND_STRENGTH) {
    if (currentPrice > ema200) {
      return { regime: "Up", adx, reason: `ADX ${adx.toFixed(1)} > ${TREND_STRENGTH} and Price above EMA200` };
    }
    return { regime: "Down", adx, reason: `ADX ${adx.toFixed(1)} > ${TREND_STRENGTH} and Price below EMA200` };
  }
  if (adx < SIDEWAYS_STRENGTH) {
    return { regime: "Side", adx, reason: `ADX ${adx.toFixed(1)} < ${SIDEWAYS_STRENGTH} (Low Volatility)` };
  }
  return { regime: "Side", adx, reason: "In-between trend strength" };
}

// Helper needed because calculateADX above is not exported properly or implemented separately
function calculateADX(candles: Candle[], p: number): number {
  const { adx } = calculateADXSeries(candles, p);
  return adx[adx.length - 1];
}

/** Per-candle adaptive regime using ADX, EMA slope, ATR, RSI range */
export interface RegimeAtCandle {
  regime: AdaptiveRegime;
  strategy: ActiveStrategyName;
  reason: string;
  adx: number;
  atr: number;
  atrAvg: number;
  /** True when ATR >= atrAvg * ATR_EXTREME – skip new entries in live. */
  isExtremeVolatility?: boolean;
}

// ============================================================================
// BALANCED PARAMETERS - Quality + Quantity
// ============================================================================
const ADX_TREND_THRESHOLD = 25; // BALANCED: Good trend strength without being too strict
const ADX_SIDEWAYS_THRESHOLD = 25;
const EMA_SLOPE_STRONG_PCT = 0.05;
const ATR_SPIKE_MULTIPLIER = 1.5;
const ATR_EXTREME_MULTIPLIER = 2.0;
const ATR_AVG_PERIOD = 20;
const MIN_CANDLES_BEFORE_TRADING = 100;
const COOLDOWN_BARS = 2; // BALANCED: Avoid overtrading but allow opportunities
const RISK_PCT_PER_TRADE = 10;
const STOP_LOSS_PCT = 2;
const TAKE_PROFIT_PCT = 10;
const RSI_OVERSOLD = 30; // BALANCED: Good oversold level
const RSI_OVERBOUGHT = 70; // BALANCED: Good overbought level
const SIDEWAYS_MIN_ATR_RATIO = 0.35;
const BREAKOUT_LOOKBACK = 15;
const LEVERAGE = 25; // Conservative 25x leverage for stability

export function detectRegimeAtCandle(
  i: number,
  closes: number[],
  highs: number[],
  lows: number[],
  ema20: number[],
  ema200: number[],
  rsi: number[],
  adxSeries: number[],
  atrSeries: number[],
  emaSlopePctSeries: number[],
  config: StrategyConfig = STRATEGY_PRESETS.pro_sniper_v3
): RegimeAtCandle {
  const adx = adxSeries[i] ?? 0;
  const atr = atrSeries[i] ?? 0;
  const atrAvg = i >= ATR_AVG_PERIOD
    ? atrSeries.slice(i - ATR_AVG_PERIOD, i).reduce((a, b) => a + b, 0) / ATR_AVG_PERIOD
    : atr;
  const slope = emaSlopePctSeries[i] ?? 0;
  const price = closes[i] ?? 0;
  const ev200 = ema200[i] ?? price;

  if (atrAvg > 0 && atr >= atrAvg * ATR_EXTREME_MULTIPLIER) {
    return {
      regime: "HIGH_VOLATILITY",
      strategy: "BREAKOUT",
      reason: `ATR spike ${(atr / atrAvg).toFixed(2)}x avg (extreme – avoid new entries)`,
      adx,
      atr,
      atrAvg,
      isExtremeVolatility: true,
    };
  }
  if (atrAvg > 0 && atr > atrAvg * ATR_SPIKE_MULTIPLIER) {
    return {
      regime: "HIGH_VOLATILITY",
      strategy: "SCALPING",
      reason: `[SCALPER] High volatility detected (${(atr / atrAvg).toFixed(2)}x)`,
      adx,
      atr,
      atrAvg,
    };
  }

  // Sideways Detection
  if (adx < config.adxSidewaysThreshold || isRSIRanging(rsi, i, 5)) {
    return {
      regime: "SIDEWAYS",
      strategy: rsi[i]! < 35 || rsi[i]! > 65 ? "SCALPING" : "RSI_MEAN_REVERSION",
      reason: `[SCALPER] Sideways scalp potential (RSI ${rsi[i]!.toFixed(1)})`,
      adx,
      atr,
      atrAvg,
    };
  }

  // Trend Detection
  if (adx > config.adxTrendThreshold) {
    if (price > ev200) {
      return {
        regime: "TRENDING_UP",
        strategy: "EMA_TREND",
        reason: `[TREND] Up (EMA Crossover Mode): ADX ${adx.toFixed(1)}`,
        adx,
        atr,
        atrAvg,
      };
    }
    if (price < ev200) {
      return {
        regime: "TRENDING_DOWN",
        strategy: "EMA_TREND",
        reason: `[TREND] Down (EMA Crossover Mode): ADX ${adx.toFixed(1)}`,
        adx,
        atr,
        atrAvg,
      };
    }
  }

  // Fallback
  if (price > ev200) {
    return { regime: "TRENDING_UP", strategy: "EMA_TREND", reason: `[V3] Price > EMA200, adx ${adx.toFixed(1)}`, adx, atr, atrAvg };
  }
  if (price < ev200) {
    return { regime: "TRENDING_DOWN", strategy: "EMA_TREND", reason: `[V3] Price < EMA200, adx ${adx.toFixed(1)}`, adx, atr, atrAvg };
  }

  return {
    regime: "SIDEWAYS",
    strategy: "RSI_MEAN_REVERSION",
    reason: `[V3] Market neutral`,
    adx,
    atr,
    atrAvg,
  };
}

// Helper to detect ranging RSI market
function isRSIRanging(rsi: number[], i: number, lookback: number): boolean {
  if (i < lookback) return false;
  const slice = rsi.slice(i - lookback, i + 1);
  return slice.every(v => v > 40 && v < 60);
}

export interface BacktestResult extends MarketRegime {
  strategyType: StrategyType;
  holdBars: number;
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  profitFactor: number;
  totalReturnPct: number;
  maxDrawdown: number;
  stats: {
    winRate: string;
    totalTrades: number;
    profitFactor: string;
  };
}

export interface RegimePerformanceEntry {
  regime: AdaptiveRegime;
  strategy: ActiveStrategyName;
  trades: number;
  wins: number;
  totalReturnPct: number;
  winRate: number;
  profitFactor: number;
  maxDrawdown: number;
}

export interface TradeLogEntry {
  barIndex: number;
  signal: "buy" | "sell";
  entryPrice: number;
  exitPrice: number;
  pnlPct: number;
  regime: AdaptiveRegime;
  strategy: ActiveStrategyName;
  exitReason: "holdBars" | "sl" | "tp" | "trailing";
}

export interface AdaptiveBacktestResult {
  totalReturn: number;
  winRate: number;
  profitFactor: number;
  maxDrawdown: number;
  totalTrades: number;
  wins: number;
  losses: number;
  regimePerformance: RegimePerformanceEntry[];
  tradeLog: TradeLogEntry[];
  equityCurve: number[];
  regime: AdaptiveRegime | "Up" | "Down" | "Side";
  reason: string;
  adx: number;
  stats: { winRate: string; totalTrades: number; profitFactor: string };
  totalReturnPct: number;
}

/**
 * PRO-LEVEL Adaptive Signal Generator
 * Uses EMA CROSSOVER (Golden/Death Cross) + V7 TRIPLE CONFIRMATION
 */
function getAdaptiveSignalAt(
  closes: number[],
  highs: number[],
  lows: number[],
  opens: number[],
  volumes: number[],
  volAvg: number[],
  ema9: number[],
  ema20: number[],
  ema50: number[],
  ema200: number[],
  rsi: number[],
  macdHist: number[],
  bbLower: number[],
  bbUpper: number[],
  regime: AdaptiveRegime,
  strategy: ActiveStrategyName,
  i: number,
  config: StrategyConfig = STRATEGY_PRESETS.pro_sniper_v3,
  presetName?: StrategyPreset
): "buy" | "sell" | null {
  if (i < 2 || i >= closes.length) return null;
  const c = closes[i]!;
  const o = opens[i]!;
  const vol = volumes[i]!;
  const vAvg = volAvg[i]!;
  const mHist = macdHist[i]!;
  const mHistPrev = macdHist[i - 1]!;

  // ============================================================================
  // BALANCED FILTERS - Quality with Reasonable Quantity
  // ============================================================================

  // PRO FILTER 1: Volume Confirmation (BALANCED - Use config multiplier)
  const isVolValid = vol > vAvg * config.volumeMultiplier;

  // PRO FILTER 2: Trend Alignment (RELAXED - EMA200 primary, EMA50 optional)
  const isUptrend = c > ema200[i]!;
  const isDowntrend = c < ema200[i]!;
  const ema9AboveEma50 = ema9[i]! > ema50[i]!;
  const ema9BelowEma50 = ema9[i]! < ema50[i]!;

  // PRO FILTER 3: MACD Momentum Confirmation
  const isMacdBullish = mHist > 0 && mHist > mHistPrev;
  const isMacdBearish = mHist < 0 && mHist < mHistPrev;

  // ------------------------------------------------------------------
  // SPECIAL STRATEGY: LIGHTNING SCALPER (Triple-Trend Golden Scalp)
  // ------------------------------------------------------------------
  if (presetName === "lightning_scalper") {
    // 1. TRIPLE TREND FILTER: High conviction trend alignment
    // Only buy if EMA20 > EMA50 AND EMA50 > EMA200
    const superBullish = ema20[i]! > ema50[i]! && ema50[i]! > ema200[i]!;
    const superBearish = ema20[i]! < ema50[i]! && ema50[i]! < ema200[i]!;

    // 2. ENTRY A: Momentum Pullback (Wait for RSI to cool off in a strong trend)
    // Buy if trend is strong and RSI drops below 40 (slight cooling)
    if (superBullish && rsi[i]! < 40 && c > o && vol > vAvg * 1.4) return "buy";
    // Sell if trend is weak and RSI rises above 60
    if (superBearish && rsi[i]! > 60 && c < o && vol > vAvg * 1.4) return "sell";

    // 3. ENTRY B: Direct Breakout Confirmation
    if (superBullish && c > ema9[i]! && opens[i]! <= ema9[i]! && isMacdBullish && vol > vAvg * 1.3) return "buy";
    if (superBearish && c < ema9[i]! && opens[i]! >= ema9[i]! && isMacdBearish && vol > vAvg * 1.3) return "sell";

    return null;
  }

  // ------------------------------------------------------------------
  // STRATEGY 1: SIDEWAYS - Trade RSI Extremes with Good Confirmation
  // ------------------------------------------------------------------
  if (regime === "SIDEWAYS") {
    // BALANCED: Trade RSI extremes with volume and candle confirmation
    if (rsi[i]! < config.rsiOversold && c > o && isVolValid) return "buy";
    if (rsi[i]! > config.rsiOverbought && c < o && isVolValid) return "sell";
    return null;
  }

  // ------------------------------------------------------------------
  // STRATEGY 2: TREND FOLLOWING - BALANCED CONFIRMATION
  // ------------------------------------------------------------------

  // EMA Crossovers
  const goldenCross = ema9[i]! > ema20[i]! && ema9[i - 1]! <= ema20[i - 1]!;
  const deathCross = ema9[i]! < ema20[i]! && ema9[i - 1]! >= ema20[i - 1]!;

  // UPTREND: Take Golden Cross or Dip WITH GOOD CONFIRMATIONS
  if (isUptrend && regime === "TRENDING_UP") {
    const bounce20 = lows[i]! <= ema20[i]! && c > ema9[i]! && c > o;

    // BALANCED CONFIRMATION:
    // 1. RSI must be in bullish zone (40-70) - wider range
    // 2. MACD must be green (direction check optional)
    // 3. Volume confirmation OR strong EMA alignment
    const bullishMomentum = rsi[i]! > 40 && rsi[i]! < 70 && mHist > 0;
    const hasGoodSetup = isVolValid || ema9AboveEma50;

    if ((goldenCross || bounce20) && bullishMomentum && hasGoodSetup) {
      return "buy";
    }
  }

  // DOWNTREND: Take Death Cross or Resistance WITH GOOD CONFIRMATIONS
  if (isDowntrend && regime === "TRENDING_DOWN") {
    const reject20 = highs[i]! >= ema20[i]! && c < ema9[i]! && c < o;

    // BALANCED CONFIRMATION:
    // 1. RSI must be in bearish zone (30-60) - wider range
    // 2. MACD must be red (direction check optional)
    // 3. Volume confirmation OR strong EMA alignment
    const bearishMomentum = rsi[i]! < 60 && rsi[i]! > 30 && mHist < 0;
    const hasGoodSetup = isVolValid || ema9BelowEma50;

    if ((deathCross || reject20) && bearishMomentum && hasGoodSetup) {
      return "sell";
    }
  }

  return null;
}

/** Simulate exit: bar-by-bar check SL/TP then holdBars. Returns { exitIndex, exitPrice, pnlPct, exitReason }. */
function simulateExit(
  signal: "buy" | "sell",
  entryIndex: number,
  entryPrice: number,
  closes: number[],
  highs: number[],
  lows: number[],
  maxBars: number,
  stopLossPct: number,
  takeProfitPct: number,
  trailing: boolean = true
): { exitIndex: number; exitPrice: number; pnlPct: number; exitReason: "holdBars" | "sl" | "tp" | "trailing" } {
  const slPct = stopLossPct / 100;
  const tpPct = takeProfitPct / 100;
  let currentSL = signal === "buy" ? entryPrice * (1 - slPct) : entryPrice * (1 + slPct);
  const targetTP = signal === "buy" ? entryPrice * (1 + tpPct) : entryPrice * (1 - tpPct);

  for (let k = 1; k <= maxBars; k++) {
    const j = entryIndex + k;
    if (j >= closes.length) {
      const pnlRaw = signal === "buy" ? ((closes[closes.length - 1]! - entryPrice) / entryPrice) * 100 : ((entryPrice - closes[closes.length - 1]!) / entryPrice) * 100;
      return { exitIndex: j - 1, exitPrice: closes[closes.length - 1]!, pnlPct: pnlRaw * LEVERAGE, exitReason: "holdBars" };
    }

    const high = parseFloat(String(highs[j]));
    const low = parseFloat(String(lows[j]));
    const close = closes[j]!;

    if (signal === "buy") {
      // IMPROVED TRAILING: Lock profit earlier and more aggressively
      // Move to breakeven after just 0.4% gain (was 0.6%)
      if (trailing && close > entryPrice * 1.004) {
        const newSL = Math.max(currentSL, entryPrice * 1.002); // Lock 0.2% profit minimum
        currentSL = newSL;
      }

      // Additional trailing: If price moves 1% in profit, trail at 50% of gain
      if (trailing && close > entryPrice * 1.01) {
        const gainPct = (close - entryPrice) / entryPrice;
        const trailLevel = entryPrice * (1 + gainPct * 0.5); // Trail at 50% of gain
        currentSL = Math.max(currentSL, trailLevel);
      }

      if (low <= currentSL) {
        // Recalculate PnL based on exact hit
        const pnl = ((currentSL - entryPrice) / entryPrice) * 100 * LEVERAGE;
        const isTrailing = currentSL !== entryPrice * (1 - slPct);
        return { exitIndex: j, exitPrice: currentSL, pnlPct: pnl, exitReason: isTrailing ? "trailing" : "sl" };
      }
      if (high >= targetTP) return { exitIndex: j, exitPrice: targetTP, pnlPct: takeProfitPct * LEVERAGE, exitReason: "tp" };
    } else {
      // IMPROVED TRAILING for SELL: Lock profit earlier
      if (trailing && close < entryPrice * 0.996) {
        const newSL = Math.min(currentSL, entryPrice * 0.998); // Lock 0.2% profit minimum
        currentSL = newSL;
      }

      // Additional trailing: If price moves 1% in profit, trail at 50% of gain
      if (trailing && close < entryPrice * 0.99) {
        const gainPct = (entryPrice - close) / entryPrice;
        const trailLevel = entryPrice * (1 - gainPct * 0.5); // Trail at 50% of gain
        currentSL = Math.min(currentSL, trailLevel);
      }

      if (high >= currentSL) {
        const pnl = ((entryPrice - currentSL) / entryPrice) * 100 * LEVERAGE;
        const isTrailing = currentSL !== entryPrice * (1 + slPct);
        return { exitIndex: j, exitPrice: currentSL, pnlPct: pnl, exitReason: isTrailing ? "trailing" : "sl" };
      }
      if (low <= targetTP) return { exitIndex: j, exitPrice: targetTP, pnlPct: takeProfitPct * LEVERAGE, exitReason: "tp" };
    }

    if (k === maxBars) {
      const pnlRaw = signal === "buy" ? ((close - entryPrice) / entryPrice) * 100 : ((entryPrice - close) / entryPrice) * 100;
      return { exitIndex: j, exitPrice: close, pnlPct: pnlRaw * LEVERAGE, exitReason: "holdBars" };
    }
  }
  return { exitIndex: entryIndex + maxBars, exitPrice: closes[entryIndex + maxBars]!, pnlPct: 0, exitReason: "holdBars" };
}

/**
 * Adaptive backtest
 */
export function runAdaptiveBacktest(
  candles: Candle[],
  holdBars: number = 6,
  options: {
    stopLossPct?: number;
    takeProfitPct?: number;
    cooldownBars?: number;
    minCandles?: number;
    skipExtremeVolatility?: boolean;
    preset?: StrategyPreset;
  } = {}
): AdaptiveBacktestResult {
  const selectedPreset = options.preset ?? "pro_sniper_v3";
  const config = STRATEGY_PRESETS[selectedPreset] || STRATEGY_PRESETS.pro_sniper_v3;

  const stopLossPct = options.stopLossPct ?? STOP_LOSS_PCT;
  const takeProfitPct = options.takeProfitPct ?? TAKE_PROFIT_PCT;
  const cooldownBars = options.cooldownBars ?? config.cooldownBars;
  const minCandles = options.minCandles ?? MIN_CANDLES_BEFORE_TRADING;
  const skipExtremeVol = options.skipExtremeVolatility !== false;
  const leverageVal = config.leverage;

  const opens = candles.map((c) => parseFloat(c.open));
  const closes = candles.map((c) => parseFloat(c.close));
  const highs = candles.map((c) => parseFloat(c.high));
  const lows = candles.map((c) => parseFloat(c.low));
  const volumes = candles.map((c) => parseFloat(c.volume || "0"));
  const len = closes.length;

  const ema9 = calculateEMA(closes, 9);
  const ema20 = calculateEMA(closes, 20);
  const ema50 = calculateEMA(closes, 50);
  const ema200 = calculateEMA(closes, 200);
  const rsi = calculateRSI(closes, 14);
  const { adx: adxSeries } = calculateADXSeries(candles, 14);
  const atrSeries = calculateATR(candles, 14);
  const emaSlopePctSeries = emaSlopePct(ema20, 5);
  const volAvg = calculateVolumeAvg(volumes, 20);

  // New indicators
  const { histogram: macdHist } = calculateMACD(closes);
  const { upper: bbUpper, lower: bbLower } = calculateBollingerBands(closes);

  const regimePerf = new Map<AdaptiveRegime, { trades: number; wins: number; totalProfitPct: number; totalLossPct: number; equityPeak: number; maxDd: number }>();
  (["TRENDING_UP", "TRENDING_DOWN", "SIDEWAYS", "HIGH_VOLATILITY"] as AdaptiveRegime[]).forEach(r => regimePerf.set(r, { trades: 0, wins: 0, totalProfitPct: 0, totalLossPct: 0, equityPeak: 100, maxDd: 0 }));

  const tradeLog: TradeLogEntry[] = [];
  const startBar = Math.max(minCandles, 201); // Wait for EMA200
  const lastIndex = len - 1 - holdBars;
  const equityCurve: number[] = [...Array(startBar).fill(100)];
  let lastTradeExitBar = -999;
  let totalTrades = 0;
  let wins = 0;
  let totalProfitPct = 0;
  let totalLossPct = 0;

  for (let i = startBar; i <= lastIndex; i++) {
    const regimeInfo = detectRegimeAtCandle(i, closes, highs, lows, ema20, ema200, rsi, adxSeries, atrSeries, emaSlopePctSeries, config);

    // Check for extreme volatility (skip)
    if (skipExtremeVol && regimeInfo.atrAvg > 0 && regimeInfo.atr >= regimeInfo.atrAvg * ATR_EXTREME_MULTIPLIER) {
      equityCurve.push(equityCurve[equityCurve.length - 1]!);
      continue;
    }

    // Cooldown check
    if (i - lastTradeExitBar < cooldownBars) {
      equityCurve.push(equityCurve[equityCurve.length - 1]!);
      continue;
    }

    const signal = getAdaptiveSignalAt(closes, highs, lows, opens, volumes, volAvg, ema9, ema20, ema50, ema200, rsi, macdHist, bbLower, bbUpper, regimeInfo.regime, regimeInfo.strategy, i, config, selectedPreset);
    if (!signal) {
      equityCurve.push(equityCurve[equityCurve.length - 1]!);
      continue;
    }

    const entryPrice = closes[i]!;
    const currentAtr = atrSeries[i] ?? (entryPrice * 0.012);

    let usedSL: number;
    let usedTP: number;

    const atrPct = (currentAtr / entryPrice) * 100;

    // Use config values
    usedSL = Math.max(0.6, atrPct * config.atrStopMultiplier);
    usedTP = usedSL * config.riskRewardRatio;

    const exitResult = simulateExit(signal, i, entryPrice, closes, highs, lows, config.maxHoldingBars, usedSL, usedTP, true);
    lastTradeExitBar = exitResult.exitIndex;
    totalTrades++;

    // Scale PnL by current config leverage (leverageVal is from config)
    // Note: pnlPct from simulateExit is raw % movement * LEVERAGE (default 25)
    // So we scale it to match our current config's leverage
    const scaleFactor = leverageVal / LEVERAGE;
    const leveragedPnl = exitResult.pnlPct * scaleFactor;

    if (leveragedPnl > 0) wins++;
    totalProfitPct += leveragedPnl > 0 ? leveragedPnl : 0;
    totalLossPct += leveragedPnl < 0 ? Math.abs(leveragedPnl) : 0;

    const prevEquity = equityCurve[equityCurve.length - 1] ?? 100;
    for (let k = i + 1; k < exitResult.exitIndex; k++) equityCurve.push(prevEquity);
    equityCurve.push(prevEquity + leveragedPnl);

    const perf = regimePerf.get(regimeInfo.regime)!;
    perf.trades++;
    if (leveragedPnl > 0) {
      perf.wins++;
      perf.totalProfitPct += leveragedPnl;
    } else perf.totalLossPct += Math.abs(leveragedPnl);
    const newEquity = prevEquity + leveragedPnl;
    if (newEquity > perf.equityPeak) perf.equityPeak = newEquity;
    const dd = perf.equityPeak - newEquity;
    if (dd > perf.maxDd) perf.maxDd = dd;

    tradeLog.push({
      barIndex: i,
      signal,
      entryPrice,
      exitPrice: exitResult.exitPrice,
      pnlPct: leveragedPnl,
      regime: regimeInfo.regime,
      strategy: regimeInfo.strategy,
      exitReason: exitResult.exitReason,
    });

    i = exitResult.exitIndex;
  }

  const totalReturnPct = equityCurve.length > 1 ? (equityCurve[equityCurve.length - 1] ?? 100) - 100 : 0;
  const winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;
  const profitFactor = totalLossPct > 0 ? totalProfitPct / totalLossPct : totalProfitPct > 0 ? 999 : 0;
  let maxDrawdown = 0;
  let peak = 100;
  for (const eq of equityCurve) {
    if (eq > peak) peak = eq;
    const dd = peak - eq;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }

  const strategyByRegime: Record<AdaptiveRegime, ActiveStrategyName> = {
    TRENDING_UP: "EMA_TREND",
    TRENDING_DOWN: "EMA_TREND",
    SIDEWAYS: "SCALPING",
    HIGH_VOLATILITY: "SCALPING",
  };
  const regimePerformance: RegimePerformanceEntry[] = [];
  regimePerf.forEach((p, regime) => {
    if (p.trades === 0) return;
    const totalReturnPct = p.totalProfitPct - p.totalLossPct;
    const pf = p.totalLossPct > 0 ? p.totalProfitPct / p.totalLossPct : (p.totalProfitPct > 0 ? 999 : 0);
    regimePerformance.push({
      regime,
      strategy: strategyByRegime[regime],
      trades: p.trades,
      wins: p.wins,
      totalReturnPct,
      winRate: p.trades > 0 ? (p.wins / p.trades) * 100 : 0,
      profitFactor: pf,
      maxDrawdown: p.maxDd,
    });
  });

  const lastRegime = len > startBar
    ? detectRegimeAtCandle(len - 1, closes, highs, lows, ema20, ema200, rsi, adxSeries, atrSeries, emaSlopePctSeries)
    : { regime: "SIDEWAYS" as AdaptiveRegime, reason: "Insufficient data", adx: 0, atr: 0, atrAvg: 0, strategy: "RSI_MEAN_REVERSION" as ActiveStrategyName };

  return {
    totalReturn: totalReturnPct,
    winRate,
    profitFactor,
    maxDrawdown,
    totalTrades,
    wins,
    losses: totalTrades - wins,
    regimePerformance,
    tradeLog,
    equityCurve,
    regime: lastRegime.regime,
    reason: lastRegime.reason,
    adx: lastRegime.adx,
    stats: {
      winRate: winRate.toFixed(1),
      totalTrades,
      profitFactor: profitFactor >= 999 ? "MAX" : profitFactor.toFixed(2),
    },
    totalReturnPct, // Keep redundant property if needed by consumer
  };
}

/**
 * Reusable backtest: entry at close, exit after holdBars.
 * Supports ema_crossover and rsi strategies.
 */
export function runBacktest(
  candles: Candle[],
  strategyType: StrategyType,
  holdBars: number
): BacktestResult {
  const regimeData = detectMarketRegime(candles);
  const closes = candles.map((c) => parseFloat(c.close));

  const ema20 = calculateEMA(closes, 20);
  const rsi = calculateRSI(closes, 14);

  const lastIndex = closes.length - 1 - holdBars;
  let totalTrades = 0;
  let wins = 0;
  let losses = 0;
  let totalProfitPct = 0;
  let totalLossPct = 0;
  const equityCurve: number[] = [100];

  for (let i = 50; i <= lastIndex; i++) {
    const signal = getSignalAt(closes, ema20, rsi, regimeData.regime, strategyType, i);
    if (!signal) {
      equityCurve.push(equityCurve[equityCurve.length - 1]!);
      continue;
    }

    totalTrades++;
    const entry = closes[i]!;
    const exitPrice = closes[i + holdBars]!;
    const pnlPct =
      signal === "buy"
        ? ((exitPrice - entry) / entry) * 100
        : ((entry - exitPrice) / entry) * 100;

    const prevEquity = equityCurve[equityCurve.length - 1] ?? 100;
    equityCurve.push(prevEquity + pnlPct);

    if (pnlPct > 0) {
      wins++;
      totalProfitPct += pnlPct;
    } else {
      losses++;
      totalLossPct += Math.abs(pnlPct);
    }
  }

  const winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;
  const profitFactor = totalLossPct > 0 ? totalProfitPct / totalLossPct : totalProfitPct > 0 ? 999 : 0;
  const totalReturnPct = equityCurve.length > 1 ? (equityCurve[equityCurve.length - 1] ?? 100) - 100 : 0;

  let maxDrawdown = 0;
  let peak = 100;
  for (const eq of equityCurve) {
    if (eq > peak) peak = eq;
    const dd = peak - eq;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }

  return {
    ...regimeData,
    strategyType,
    holdBars,
    totalTrades,
    wins,
    losses,
    winRate,
    profitFactor,
    totalReturnPct,
    maxDrawdown,
    stats: {
      winRate: winRate.toFixed(1),
      totalTrades,
      profitFactor: profitFactor >= 999 ? "MAX" : profitFactor.toFixed(2),
    },
  };
}

/**
 * Regime-appropriate signals (legacy): Up/Down/Side with ema_crossover | rsi.
 */
function getSignalAt(
  closes: number[],
  ema20: number[],
  rsi: number[],
  regime: MarketRegime["regime"],
  strategyType: StrategyType,
  i: number
): "buy" | "sell" | null {
  if (strategyType === "ema_crossover") {
    if (regime === "Up") {
      if (closes[i]! > ema20[i]! && closes[i - 1]! <= ema20[i - 1]!) return "buy";
      return null;
    }
    if (regime === "Down") {
      if (closes[i]! < ema20[i]! && closes[i - 1]! >= ema20[i - 1]!) return "sell";
      return null;
    }
    if (regime === "Side") {
      if (rsi[i]! < 35) return "buy";
      if (rsi[i]! > 65) return "sell";
    }
    return null;
  }
  if (strategyType === "rsi") {
    if (regime === "Up") {
      if (closes[i]! > ema20[i]! && closes[i - 1]! <= ema20[i - 1]!) return "buy";
      return null;
    }
    if (regime === "Down") {
      if (closes[i]! < ema20[i]! && closes[i - 1]! >= ema20[i - 1]!) return "sell";
      return null;
    }
    if (regime === "Side") {
      if (rsi[i]! < 35) return "buy";
      if (rsi[i]! > 65) return "sell";
    }
    return null;
  }
  return null;
}

/**
 * Current signal from latest candle (for live loop).
 * Uses same logic as backtest at end of series.
 */
export function getCurrentSignal(candles: Candle[], strategyType: StrategyType): "buy" | "sell" | null {
  if (candles.length < 51) return null;

  const regimeData = detectMarketRegime(candles);
  const closes = candles.map((c) => parseFloat(c.close));
  const ema20 = calculateEMA(closes, 20);
  const rsi = calculateRSI(closes, 14);
  const i = closes.length - 1;

  return getSignalAt(closes, ema20, rsi, regimeData.regime, strategyType, i);
}

/**
 * Detect current market regime in real time (for live trading).
 * Returns regime, strategy, reason, adx, atr.
 */
export function getCurrentRegime(candles: Candle[], preset: StrategyPreset = "pro_sniper_v3"): RegimeAtCandle | null {
  const config = STRATEGY_PRESETS[preset] || STRATEGY_PRESETS.pro_sniper_v3;
  const minRequired = Math.max(MIN_CANDLES_BEFORE_TRADING, 201);
  if (candles.length < minRequired) return null;
  const closes = candles.map((c) => parseFloat(c.close));
  const highs = candles.map((c) => parseFloat(c.high));
  const lows = candles.map((c) => parseFloat(c.low));
  const ema20 = calculateEMA(closes, 20);
  const ema200 = calculateEMA(closes, 200);
  const rsi = calculateRSI(closes, 14);
  const { adx: adxSeries } = calculateADXSeries(candles, 14);
  const atrSeries = calculateATR(candles, 14);
  const emaSlopePctSeries = emaSlopePct(ema20, 5);
  const i = closes.length - 1;
  return detectRegimeAtCandle(i, closes, highs, lows, ema20, ema200, rsi, adxSeries, atrSeries, emaSlopePctSeries, config);
}

/**
 * Adaptive signal for live trading: detect regime then get signal.
 * Do not flip strategy during open position (caller must enforce).
 */
export function getCurrentSignalAdaptive(candles: Candle[], preset: StrategyPreset = "pro_sniper_v3"): {
  signal: "buy" | "sell" | null;
  regime: RegimeAtCandle | null;
  confidence: number;
} {
  const config = STRATEGY_PRESETS[preset] || STRATEGY_PRESETS.pro_sniper_v3;
  const regimeInfo = getCurrentRegime(candles, preset);
  const minRequired = Math.max(MIN_CANDLES_BEFORE_TRADING, 201);
  if (!regimeInfo || candles.length < minRequired) return { signal: null, regime: null, confidence: 0 };
  const opens = candles.map((c) => parseFloat(c.open));
  const closes = candles.map((c) => parseFloat(c.close));
  const highs = candles.map((c) => parseFloat(c.high));
  const lows = candles.map((c) => parseFloat(c.low));
  const volumes = candles.map((c) => parseFloat(c.volume || "0"));
  const ema9 = calculateEMA(closes, 9);
  const ema20 = calculateEMA(closes, 20);
  const ema50 = calculateEMA(closes, 50);
  const ema200 = calculateEMA(closes, 200);
  const rsi = calculateRSI(closes, 14);
  const volAvg = calculateVolumeAvg(volumes, 20);

  // New indicators
  const { histogram: macdHist } = calculateMACD(closes);
  const { upper: bbUpper, lower: bbLower } = calculateBollingerBands(closes);

  const i = closes.length - 1;
  const signal = getAdaptiveSignalAt(closes, highs, lows, opens, volumes, volAvg, ema9, ema20, ema50, ema200, rsi, macdHist, bbLower, bbUpper, regimeInfo.regime, regimeInfo.strategy, i, config, preset);

  // Calculate confidence based on passed filters
  let confidence = 0;
  if (signal === "buy") {
    let score = 0;
    if (volumes[i]! > volAvg[i]! * 1.5) score += 30; // Strong volume
    else if (volumes[i]! > volAvg[i]!) score += 15;
    if (rsi[i]! > 45 && rsi[i]! < 55) score += 20; // Sweet spot
    if (macdHist[i]! > macdHist[i - 1]!) score += 25; // Momentum
    if (closes[i]! > ema20[i]!) score += 25; // Trend alignment
    confidence = Math.min(100, score);
  } else if (signal === "sell") {
    let score = 0;
    if (volumes[i]! > volAvg[i]! * 1.5) score += 30;
    else if (volumes[i]! > volAvg[i]!) score += 15;
    if (rsi[i]! < 55 && rsi[i]! > 45) score += 20;
    if (macdHist[i]! < macdHist[i - 1]!) score += 25;
    if (closes[i]! < ema20[i]!) score += 25;
    confidence = Math.min(100, score);
  }

  return { signal, regime: regimeInfo, confidence };
}
