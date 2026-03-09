/**
 * Strategy engine: alpha_one = scalp mode (per-symbol, small TP/SL).
 * Live multi-symbol exit rules: position-manager TP 1.2%, SL 1.2%, re-entry on next signal.
 */
import type { Candle } from "./delta";
import { getOrderBook, getLastTradesHistory } from "./delta-socket";
export type { Candle };

export type StrategyType = "ema_crossover" | "rsi";

/** Available strategy presets */
export type StrategyPreset = "alpha_one" | "pro_sniper_v3" | "momentum_master" | "trend_rider" | "lightning_scalper" | "xtreme_all_weather" | "universal_auto" | "pro_scalper_v2" | "pro_scalper_v3";

/** Adaptive regime types for dynamic strategy switching */
export type AdaptiveRegime = "TRENDING_UP" | "TRENDING_DOWN" | "SIDEWAYS" | "HIGH_VOLATILITY";

/** Active strategy name per regime (for logging) */
export type ActiveStrategyName = "EMA_TREND" | "RSI_MEAN_REVERSION" | "BREAKOUT" | "SCALPING" | "SMC_SMART_MONEY" | "SMC_HUMAN_ALPHA";

// ============================================================================
// SMART MONEY CONCEPTS (SMC) & PATTERN RECOGNITION
// ============================================================================

/** Detect Bullish/Bearish Fair Value Gap (FVG) */
export function calculateFVG(candles: Candle[], i: number): "bull" | "bear" | null {
  if (i < 2) return null;
  const c1 = candles[i - 2];
  const c2 = candles[i - 1]; // The big move candle
  const c3 = candles[i];     // The current confirmation/retest candle

  const high1 = parseFloat(c1.high);
  const low1 = parseFloat(c1.low);
  const high3 = parseFloat(c3.high);
  const low3 = parseFloat(c3.low);

  // Bullish FVG: Gap between High of Candle 1 and Low of Candle 3
  if (low3 > high1 && parseFloat(c2.close) > parseFloat(c2.open)) {
    return "bull";
  }

  // Bearish FVG: Gap between Low of Candle 1 and High of Candle 3
  if (high3 < low1 && parseFloat(c2.close) < parseFloat(c2.open)) {
    return "bear";
  }

  return null;
}

/** Detect Order Block (Last opposite color candle before strong move) */
export function calculateOrderBlock(candles: Candle[], i: number): "bull" | "bear" | null {
  if (i < 5) return null;

  // Look for a strong move in the last 3 candles
  const c = candles[i];
  const prev = candles[i - 1];
  const pprev = candles[i - 2];

  const isStrongBull = parseFloat(c.close) > parseFloat(c.open) && parseFloat(prev.close) > parseFloat(prev.open);
  const isStrongBear = parseFloat(c.close) < parseFloat(c.open) && parseFloat(prev.close) < parseFloat(prev.open);

  if (isStrongBull) {
    // Find last red candle
    for (let k = 1; k <= 4; k++) {
      const check = candles[i - k];
      if (parseFloat(check.close) < parseFloat(check.open)) return "bull";
    }
  }

  if (isStrongBear) {
    // Find last green candle
    for (let k = 1; k <= 4; k++) {
      const check = candles[i - k];
      if (parseFloat(check.close) > parseFloat(check.open)) return "bear";
    }
  }

  return null;
}

/** Detect Classic Candle Patterns (Engulfing, Pinbar) */
export function detectCandlePatterns(candles: Candle[], i: number): "bull_engulfing" | "bear_engulfing" | "bull_pinbar" | "bear_pinbar" | null {
  if (i < 1) return null;
  const curr = candles[i];
  const prev = candles[i - 1];

  const cOpen = parseFloat(curr.open);
  const cClose = parseFloat(curr.close);
  const cHigh = parseFloat(curr.high);
  const cLow = parseFloat(curr.low);
  const cBody = Math.abs(cClose - cOpen);
  const cRange = cHigh - cLow;

  const pOpen = parseFloat(prev.open);
  const pClose = parseFloat(prev.close);
  const pBody = Math.abs(pClose - pOpen);

  // Engulfing
  const isBullEngulfing = cClose > cOpen && pClose < pOpen && cClose > pOpen && cOpen < pClose;
  const isBearEngulfing = cClose < cOpen && pClose > pOpen && cClose < pOpen && cOpen > pClose;

  if (isBullEngulfing) return "bull_engulfing";
  if (isBearEngulfing) return "bear_engulfing";

  // Pinbar (Hammer/Shooting Star)
  const upperWick = cHigh - Math.max(cOpen, cClose);
  const lowerWick = Math.min(cOpen, cClose) - cLow;
  const bodySize = Math.abs(cClose - cOpen);

  // Bullish Pinbar (Hammer)
  if (lowerWick > 2 * bodySize && upperWick < bodySize) return "bull_pinbar";

  // Bearish Pinbar (Shooting Star)
  if (upperWick > 2 * bodySize && lowerWick < bodySize) return "bear_pinbar";

  return null;
}

/**
 * ⚡ LOW-LATENCY SCALPER BRAIN ⚡
 * Implementation of Orderbook Imbalance Strategy
 */
export function getScalperSignal(symbol: string): { signal: "buy" | "sell" | null; reason: string } {
  const ob = getOrderBook(symbol);
  const trades = getLastTradesHistory(symbol);

  if (!ob || ob.bids.length < 3 || ob.asks.length < 3) {
    return { signal: null, reason: "Waiting for orderbook data..." };
  }

  // 1. Calculate Imbalance (Top 5 levels)
  const bidVol = ob.bids.slice(0, 5).reduce((sum, l) => sum + parseFloat(l.size), 0);
  const askVol = ob.asks.slice(0, 5).reduce((sum, l) => sum + parseFloat(l.size), 0);
  const imbalance = bidVol / (askVol || 1);

  // 2. Spread Check (relaxed: <= 5 ticks)
  const bestBid = parseFloat(ob.bids[0].price);
  const bestAsk = parseFloat(ob.asks[0].price);
  const spread = bestAsk - bestBid;

  // Estimate tick size (handle case with < 2 bid levels)
  const tickSize = ob.bids.length >= 2
    ? Math.max(0.0001, Math.abs(parseFloat(ob.bids[0].price) - parseFloat(ob.bids[1].price)))
    : Math.max(0.0001, bestBid * 0.0001);
  const spreadTicks = spread / tickSize;

  // 3. Trade Momentum (Last 5 trades)
  const last5 = trades.slice(-5);
  const buyTrades = last5.filter((t: any) => t.side === 'buy').length;
  const sellTrades = last5.filter((t: any) => t.side === 'sell').length;
  const hasTrades = last5.length >= 2;

  // --- BUY CONDITION (relaxed: imbalance > 1.2, spread <= 5 ticks, >= 2/5 buys) ---
  if (imbalance > 1.2 && spreadTicks <= 5.0 && (!hasTrades || buyTrades >= 2)) {
    return {
      signal: 'buy',
      reason: `IMBALANCE: ${imbalance.toFixed(2)} | SPREAD: ${spreadTicks.toFixed(1)} ticks | MOMENTUM: ${buyTrades}/5 BUY`
    };
  }

  // --- SELL CONDITION (relaxed: imbalance < 0.83, spread <= 5 ticks, >= 2/5 sells) ---
  if (imbalance < 0.83 && spreadTicks <= 5.0 && (!hasTrades || sellTrades >= 2)) {
    return {
      signal: 'sell',
      reason: `IMBALANCE: ${imbalance.toFixed(2)} | SPREAD: ${spreadTicks.toFixed(1)} ticks | MOMENTUM: ${sellTrades}/5 SELL`
    };
  }

  // --- PURE IMBALANCE FALLBACK (strong imbalance even without trade history) ---
  if (imbalance >= 1.5 && spreadTicks <= 8.0) {
    return { signal: 'buy', reason: `STRONG IMBALANCE BUY: ${imbalance.toFixed(2)}` };
  }
  if (imbalance <= 0.67 && spreadTicks <= 8.0) {
    return { signal: 'sell', reason: `STRONG IMBALANCE SELL: ${imbalance.toFixed(2)}` };
  }

  return { signal: null, reason: `Neutral (Imb: ${imbalance.toFixed(2)}, Spread: ${spreadTicks.toFixed(1)}t)` };
}


// ... (existing code) ...

/**
 * SCALPING MODULE (1m - 5m)
 * Optimized for noise, mean reversion, and quick momentum bursts.
 */
function getScalpSignal(
  i: number,
  c: number, o: number, h: number, l: number,
  ema20: number, ema50: number, ema200: number,
  rsi: number, mHist: number, mHistPrev: number,
  bbLower: number, bbUpper: number,
  vol: number, vAvg: number,
  regime: RegimeAnalysisV2
): "buy" | "sell" | null {
  // V9 ALL-WEATHER SCALP: Opportunistic Logic
  const isSideways = regime.regime === "RANGE" || regime.adx < 22;
  const isTrending = regime.adx >= 22;

  // 1. SIDEWAYS BAND-FADER (Profit in Range - More Strict)
  if (isSideways) {
    // Buy: Touched Lower BB + Bullish Candle + RSI < 35 (Tightened)
    if (l <= bbLower && c > o && rsi < 35) return "buy";
    // Sell: Touched Upper BB + Bearish Candle + RSI > 65 (Tightened)
    if (h >= bbUpper && c < o && rsi > 65) return "sell";
  }

  // 2. TREND ACCELERATOR (Trend Following - High Precision)
  if (isTrending) {
    const isBull = regime.trend.includes("BULL");
    const macroBull = c > ema200; // MACRO TREND FILTER
    const macroBear = c < ema200;

    // Buy on Strength: PRICE > EMA20 + MACRO TREND + RSI Trending
    if (isBull && macroBull && c > ema20 && rsi > 52 && rsi < 72 && mHist > mHistPrev) return "buy";
    if (!isBull && macroBear && c < ema20 && rsi < 48 && rsi > 28 && mHist < mHistPrev) return "sell";
  }

  return null;
}

/**
 * SWING MODULE (15m - 4h)
 * V10 PROFITABLE: Ultra-strict quality filters for 60-70% win rate
 */
function getSwingSignal(
  i: number,
  c: number, o: number, h: number, l: number,
  ema20: number, ema50: number, ema200: number,
  rsi: number, mHist: number, mHistPrev: number,
  bbLower: number, bbUpper: number,
  vol: number, vAvg: number,
  regime: RegimeAnalysisV2
): "buy" | "sell" | null {
  // V10 PROFITABLE: ONLY STRONG TRENDS - NO RANGE TRADING
  const isStrongTrend = regime.adx >= 30; // MUCH STRICTER from 18

  if (!isStrongTrend) return null; // Skip everything else if trend not strong enough

  // PROFITABLE FILTER 1: Volume must be SIGNIFICANT
  const hasStrongVolume = vol > vAvg * 1.5; // STRICTER from 1.3

  // PROFITABLE FILTER 2: MACD must be expanding (momentum building)
  const mHistExpanding = Math.abs(mHist) > Math.abs(mHistPrev);

  // PROFITABLE FILTER 3: Perfect EMA stack for trend quality
  const perfectBullStack = c > ema20 && ema20 > ema50 && ema50 > ema200;
  const perfectBearStack = c < ema20 && ema20 < ema50 && ema50 < ema200;

  const isBull = regime.trend.includes("BULL");

  // LONG SETUP - ALL CONDITIONS MUST BE MET
  if (isBull && perfectBullStack && mHistExpanding && hasStrongVolume) {
    // Entry Type A: Pullback to EMA20 (value entry)
    const pullback = l <= ema20 * 1.003 && c > ema20 && c > o; // Bullish candle bounce

    // Entry Type B: Breakout with momentum
    const breakout = c > bbUpper && vol > vAvg * 1.8; // Even stronger volume for breakouts

    // RSI must be in HEALTHY trending zone (not overbought)
    const healthyRsi = rsi > 50 && rsi < 68; // STRICTER: Must be trending up but not overbought

    // MACD must be positive AND increasing
    const strongMacd = mHist > 0 && mHist > mHistPrev;

    if ((pullback || breakout) && healthyRsi && strongMacd) {
      return "buy";
    }
  }

  // SHORT SETUP - ALL CONDITIONS MUST BE MET
  if (!isBull && perfectBearStack && mHistExpanding && hasStrongVolume) {
    // Entry Type A: Rejection at EMA20 (value entry)
    const rejection = h >= ema20 * 0.997 && c < ema20 && c < o; // Bearish candle rejection

    // Entry Type B: Breakdown with momentum  
    const breakdown = c < bbLower && vol > vAvg * 1.8; // Stronger volume for breakdowns

    // RSI must be in HEALTHY trending zone (not oversold)
    const healthyRsi = rsi < 50 && rsi > 32; // STRICTER: Must be trending down but not oversold

    // MACD must be negative AND decreasing
    const strongMacd = mHist < 0 && mHist < mHistPrev;

    if ((rejection || breakdown) && healthyRsi && strongMacd) {
      return "sell";
    }
  }

  // NO MORE RANGE TRADING - Only high quality trends
  return null;
}

/**
 * UNIVERSAL ORCHESTRATOR
 * Automatically selects the best logic based on Timeframe and Market Regime.
 */
function getUniversalSignal(
  i: number,
  candles: Candle[],
  closes: number[],
  highs: number[],
  lows: number[],
  ema20: number[],
  ema50: number[],
  ema200: number[],
  rsi: number[],
  macdHist: number[],
  bbUpper: number[],
  bbLower: number[],
  adxSeries: number[],
  atrSeries: number[],
  vAvg: number[]
): { signal: "buy" | "sell" | null; regime: RegimeAnalysisV2 } {
  const c = closes[i];
  const o = parseFloat(candles[i].open);
  const h = highs[i];
  const l = lows[i];
  const vol = parseFloat(candles[i].volume || "0");

  const regimeV2 = detectRegimeV2(i, closes, ema20, ema50, ema200, adxSeries, atrSeries, bbUpper, bbLower);

  let resolutionMin = 15;
  if (i > 0) {
    const diffMs = (candles[i].time - candles[i - 1].time) / 60;
    resolutionMin = Math.round(diffMs / 60);
  }

  // V10 DEEP KNOWLEDGE INTEGRATION
  const fvg = calculateFVG(candles, i);
  const ob = calculateOrderBlock(candles, i);
  const pattern = detectCandlePatterns(candles, i);

  // Default signal from existing logic
  let signal: "buy" | "sell" | null = null;
  if (resolutionMin < 15) {
    signal = getScalpSignal(i, c, o, h, l, ema20[i], ema50[i], ema200[i], rsi[i], macdHist[i], macdHist[i - 1], bbLower[i], bbUpper[i], vol, vAvg[i], regimeV2);
  } else {
    signal = getSwingSignal(i, c, o, h, l, ema20[i], ema50[i], ema200[i], rsi[i], macdHist[i], macdHist[i - 1], bbLower[i], bbUpper[i], vol, vAvg[i], regimeV2);
  }

  // 4. DEEP KNOWLEDGE OVERRIDE (Human-Like Institutional Flow)
  if (!signal) {
    const isBullTrend = regimeV2.trend.includes("BULL");

    // HUMAN LOGIC: Price sweeps liquidity (recent high/low) and shifts structure
    const recentCandles = candles.slice(Math.max(0, i - 10), i);
    const localHigh = Math.max(...recentCandles.map(c => parseFloat(c.high)));
    const localLow = Math.min(...recentCandles.map(c => parseFloat(c.low)));

    const sweptLow = parseFloat(candles[i - 1].low) < localLow && c > parseFloat(candles[i - 1].high);
    const sweptHigh = parseFloat(candles[i - 1].high) > localHigh && c < parseFloat(candles[i - 1].low);

    if (isBullTrend && (sweptLow || fvg === "bull" || ob === "bull")) {
      // Confluence check like a human trader
      if (rsi[i] > 45 && rsi[i] < 68) {
        regimeV2.reason = sweptLow ? "[HUMAN] Liquidity Sweep + Rejection" : "[SMC] Value Area Entry";
        regimeV2.strategy = "SMC_HUMAN_ALPHA";
        return { signal: "buy", regime: regimeV2 };
      }
    }
    else if (!isBullTrend && (sweptHigh || fvg === "bear" || ob === "bear")) {
      if (rsi[i] < 55 && rsi[i] > 32) {
        regimeV2.reason = sweptHigh ? "[HUMAN] Liquidity Sweep + Rejection" : "[SMC] Value Area Entry";
        regimeV2.strategy = "SMC_HUMAN_ALPHA";
        return { signal: "sell", regime: regimeV2 };
      }
    }
  }

  return { signal, regime: regimeV2 };
}


/**
 * PRO-LEVEL Adaptive Signal Generator
 * Uses EMA CROSSOVER (Golden/Death Cross) + V7 TRIPLE CONFIRMATION
 */

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
  // === 🎯 SCALPING: per-symbol independent, thoda profit book → exit → re-entry (position-manager TP 1.2%, SL 1.2%) ===
  alpha_one: {
    name: "🎯 ALPHA ONE - Pro Scalp (Python Match)",
    description: "High Precision: TP 2.4% / SL 0.95%. Matches Python 'flow_scalp_v2' parameters.",
    adxTrendThreshold: 25, // Stricter trend requirement
    adxSidewaysThreshold: 22,
    cooldownBars: 2,
    rsiOversold: 30,
    rsiOverbought: 70,
    leverage: 25, // Matched with Python
    volumeMultiplier: 1.5, // Require significant volume
    riskRewardRatio: 2.5, // Aim for bigger wins
    atrStopMultiplier: 1.5, // 1.5 * ATR is usually ~0.8-1.0% on crypto
    maxHoldingBars: 12, // Give trades time to hit 2.4%
  },

  // === LEGACY (use alpha_one instead) ===
  universal_auto: {
    name: "🤖 AI UNIVERSAL AUTO V11 (Legacy)",
    description: "Legacy - Use ALPHA ONE instead",
    adxTrendThreshold: 35,         // STRICT: Only strongest trends (increased from 32)
    adxSidewaysThreshold: 35,      // NO sideways trades (increased from 32)
    cooldownBars: 5,               // PATIENT: Wait for quality setups (increased from 4)
    rsiOversold: 32,               // TIGHTER: Avoid weak reversals (from 35)
    rsiOverbought: 68,             // TIGHTER: Avoid weak reversals (from 65)
    leverage: 25,                  // CONSERVATIVE: Safer sizing (from 20)
    volumeMultiplier: 1.8,         // HIGHER: Only exceptional volume (from 1.5)
    riskRewardRatio: 4.0,          // BETTER: Asymmetric reward (from 3.5)
    atrStopMultiplier: 2.8,        // MORE ROOM: Survive volatility (from 2.5)
    maxHoldingBars: 60,            // PATIENT: Let winners run (from 50)
  },

  // === 🧠 PRO SCALPER V3: 6-STEP PROFESSIONAL DISCRETIONARY BRAIN ===
  pro_scalper_v3: {
    name: "🧠 PRO SCALPER V3 - Discretionary Brain",
    description: "6-step professional scalping: regime filter, MTF 0.75+ threshold, structure SL, tiered TP (+0.4%→BE, +0.6%→40%, +0.9%→30%, >1%→trail)",
    adxTrendThreshold: 22,         // Accept moderate+ trends only
    adxSidewaysThreshold: 20,      // Skip choppy markets
    cooldownBars: 2,               // Allow quick re-entry after a win
    rsiOversold: 42,               // Long RSI healthy zone: 42–62
    rsiOverbought: 62,             // Short RSI healthy zone: 38–58
    leverage: 12,                  // Lower leverage = manageable drag on small scalps
    volumeMultiplier: 1.1,         // 1.1x volume confirmation
    riskRewardRatio: 1.8,          // 1.8:1 RR – realistic for ATR-tight scalping
    atrStopMultiplier: 1.0,        // ATR × 1.0 SL (tight), capped at 0.8%
    maxHoldingBars: 20,            // 20 bars max hold
  },

  // === 🚀 PRO SCALPER V2: FAST SCALPING (Image-Based Architecture) ===
  pro_scalper_v2: {
    name: "🚀 PRO SCALPER V2 - Fast Profits",
    description: "Image-based: 60%+ WR, 5-8 trades/day, $5-10 profit, AI 73%+ threshold",
    adxTrendThreshold: 18,         // LOWER: More opportunities (from Image 1: ADX > 18)
    adxSidewaysThreshold: 18,      // Accept more setups
    cooldownBars: 1,               // FAST: Quick re-entry for scalping
    rsiOversold: 50,               // RSI 50-70 zone (from Image 1)
    rsiOverbought: 70,             // RSI 50-70 zone
    leverage: 30,                  // 25-35x range (Image 5: Small capital mode)
    volumeMultiplier: 1.3,         // 1.3x volume spike (from Image 1)
    riskRewardRatio: 3.0,          // BOOSTED: 3:1 RR for Profit Factor > 1.5
    atrStopMultiplier: 1.5,        // MORE ROOM: Avoid stop hunts
    maxHoldingBars: 20,            // PATIENT: Let winners run
  },

  // === LEGACY STRATEGIES (For reference/testing only) ===
  pro_sniper_v3: {
    name: "Pro Sniper V3 (Legacy)",
    description: "⚠️ Legacy - Use Universal Auto instead",
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
    name: "Momentum Master (Legacy)",
    description: "⚠️ Legacy - Use Universal Auto instead",
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
    name: "Trend Rider (Legacy)",
    description: "⚠️ Legacy - Use Universal Auto instead",
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
    name: "Lightning Scalper (Legacy)",
    description: "⚠️ Legacy - Use Universal Auto instead",
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
  xtreme_all_weather: {
    name: "X-Treme All Weather (Legacy)",
    description: "⚠️ Legacy - Use Universal Auto instead",
    adxTrendThreshold: 20,
    adxSidewaysThreshold: 20,
    cooldownBars: 1,
    rsiOversold: 30,
    rsiOverbought: 70,
    leverage: 10,
    volumeMultiplier: 1.2,
    riskRewardRatio: 2.5,
    atrStopMultiplier: 2.0,
    maxHoldingBars: 40,
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

// ============================================================================
// REGIME ENGINE V2 - GRANULAR MARKET STATE ANALYSIS
// ============================================================================

export type TrendState = "STRONG_BULL" | "WEAK_BULL" | "NEUTRAL" | "WEAK_BEAR" | "STRONG_BEAR";
export type VolatilityState = "LOW_SQUEEZE" | "NORMAL" | "HIGH_EXPANSION" | "EXTREME_VOLATILITY";

export interface RegimeAnalysisV2 {
  trend: TrendState;
  volatility: VolatilityState;
  regime: "TREND" | "RANGE" | "BREAKOUT";
  strategy?: ActiveStrategyName;
  adx: number;
  atrRatio: number; // Current ATR / Avg ATR (14)
  reason: string;
}

/**
 * Advanced Regime Detection V2
 * Uses multi-factor analysis to determine precise market state.
 */
export function detectRegimeV2(
  i: number,
  closes: number[],
  ema20: number[],
  ema50: number[],
  ema200: number[],
  adxSeries: number[],
  atrSeries: number[],
  upper: number[],
  lower: number[]
): RegimeAnalysisV2 {
  const c = closes[i];
  const curADX = adxSeries[i] ?? 0;
  const curEMA20 = ema20[i] ?? 0;
  const curEMA50 = ema50[i] ?? 0;
  const curEMA200 = ema200[i] ?? 0;
  const curATR = atrSeries[i] ?? 0;

  let sumATR = 0;
  let count = 0;
  for (let k = 1; k <= 20; k++) {
    const idx = i - k;
    if (idx >= 0 && atrSeries[idx]) {
      sumATR += atrSeries[idx];
      count++;
    }
  }
  const avgATR = count > 0 ? sumATR / count : curATR;
  const atrRatio = avgATR > 0 ? curATR / avgATR : 1;

  let volatility: VolatilityState = "NORMAL";
  if (atrRatio < 0.75) volatility = "LOW_SQUEEZE";
  else if (atrRatio > 1.6) volatility = "HIGH_EXPANSION";

  let trend: TrendState = "NEUTRAL";
  let regime: "TREND" | "RANGE" | "BREAKOUT" = "RANGE";

  const bullStack = c > curEMA20 && curEMA20 > curEMA50 && curEMA50 > curEMA200;
  const bearStack = c < curEMA20 && curEMA20 < curEMA50 && curEMA50 < curEMA200;

  // CHOP DETECTION: Count EMA crosses in last 20 bars
  let crosses = 0;
  for (let k = 1; k < 20; k++) {
    const idx = i - k;
    if (idx > 0 && ((closes[idx] > ema20[idx] && closes[idx - 1] < ema20[idx - 1]) || (closes[idx] < ema20[idx] && closes[idx - 1] > ema20[idx - 1]))) {
      crosses++;
    }
  }

  if (crosses > 4) { // Price crossing EMA too much? It's toxic chop.
    trend = "NEUTRAL";
    regime = "RANGE";
  } else if (bullStack && curADX > 20) {
    trend = "STRONG_BULL";
    regime = "TREND";
  } else if (bearStack && curADX > 20) {
    trend = "STRONG_BEAR";
    regime = "TREND";
  } else if (c > curEMA200 && curEMA20 > curEMA50) {
    trend = "WEAK_BULL";
    regime = curADX > 20 ? "TREND" : "RANGE";
  } else if (c < curEMA200 && curEMA20 < curEMA50) {
    trend = "WEAK_BEAR";
    regime = curADX > 20 ? "TREND" : "RANGE";
  }

  const reason = crosses > 4 ? "TOXIC_CHOP" : `Regime: ${regime}`;
  return { trend, volatility, regime, adx: curADX, atrRatio, reason };
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
const ADX_TREND_THRESHOLD = 28; // IMPROVED: Stronger trend required
const ADX_SIDEWAYS_THRESHOLD = 25;
const EMA_SLOPE_STRONG_PCT = 0.05;
const ATR_SPIKE_MULTIPLIER = 1.5;
const ATR_EXTREME_MULTIPLIER = 2.0;
const ATR_AVG_PERIOD = 20;
const MIN_CANDLES_BEFORE_TRADING = 100;
const COOLDOWN_BARS = 3; // IMPROVED: Avoid overtrading
const RISK_PCT_PER_TRADE = 10;
const STOP_LOSS_PCT = 1.5; // Tighter but survivor-ready
const TAKE_PROFIT_PCT = 4.5; // 3:1 RR
const RSI_OVERSOLD = 28; // IMPROVED: More extreme oversold
const RSI_OVERBOUGHT = 72; // IMPROVED: More extreme overbought
const SIDEWAYS_MIN_ATR_RATIO = 0.35;
const BREAKOUT_LOOKBACK = 15;
const LEVERAGE = 25; // Optimized for stability and lot size minimums

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
  // 📊 ADVANCED DETAILS (NEW)
  entryTime?: number; // Unix timestamp
  exitTime?: number; // Unix timestamp
  stopLoss?: number; // SL price level
  takeProfit?: number; // TP price level
  positionSizeUsd?: number; // Position size in USD
  pnlUsd?: number; // Actual profit/loss in USD
  riskRewardRatio?: number; // Actual R:R achieved
  holdBars?: number; // How many bars held
  slPct?: number; // SL percentage
  tpPct?: number; // TP percentage
  partialTakes?: number; // Greedy partial exits taken before final exit
  blockedByGuard?: string; // Optional annotation for diagnostics
}

export interface GreedyPartialStep {
  triggerPct: number;
  closeFraction: number;
}

export interface GreedyExitConfig {
  enabled: boolean;
  partials: readonly GreedyPartialStep[];
  breakEvenBufferPct: number;
  runnerTrailStartPct: number;
  runnerTrailDistancePct: number;
}

export interface TrendGuardConfig {
  enabled: boolean;
  minAdx: number;
  lookbackTrades: number;
  minDirectionalWinRate: number;
  lossStreakPause: number;
  pauseBars: number;
  maxDailyLossPct: number;
}

export interface BacktestDiagnostics {
  guardBlocks: {
    weakTrend: number;
    badDirectionalExpectancy: number;
    lossStreakPause: number;
    dailyLossLimit: number;
  };
  dailyReturns: Array<{ day: string; pnlPct: number; trades: number }>;
  bestDayPct: number;
  worstDayPct: number;
}

export interface AdaptiveBacktestResult {
  totalReturn: number;
  winRate: number;
  profitFactor: number;
  maxDrawdown: number;
  totalTrades: number;
  wins: number;
  losses: number;
  sharpeRatio: number;
  regimePerformance: RegimePerformanceEntry[];
  tradeLog: TradeLogEntry[];
  equityCurve: number[];
  regime: AdaptiveRegime | "Up" | "Down" | "Side";
  reason: string;
  adx: number;
  stats: { winRate: string; totalTrades: number; profitFactor: string };
  totalReturnPct: number;
  diagnostics?: BacktestDiagnostics;
}

export interface PortfolioBacktestResult {
  totalReturnPct: number;
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  profitFactor: number;
  maxDrawdown: number;
  avgDailyReturnPct: number;
  bestDayPct: number;
  worstDayPct: number;
  dailyReturns: Array<{ day: string; pnlPct: number; trades: number }>;
  acceptedTrades: Array<TradeLogEntry & { symbol: string; scaledPnlPct: number }>;
  skippedByConcurrency: number;
  skippedByDailyLoss: number;
}

const DEFAULT_GREEDY_EXIT: GreedyExitConfig = {
  enabled: false,
  partials: [
    { triggerPct: 0.6, closeFraction: 0.4 },
    { triggerPct: 1.0, closeFraction: 0.3 },
  ],
  breakEvenBufferPct: 0.10,
  runnerTrailStartPct: 1.2,
  runnerTrailDistancePct: 0.45,
};

const DEFAULT_TREND_GUARD: TrendGuardConfig = {
  enabled: false,
  minAdx: 18,
  lookbackTrades: 10,
  minDirectionalWinRate: 0.42,
  lossStreakPause: 3,
  pauseBars: 6,
  maxDailyLossPct: 8,
};

/**
 * Portfolio-level concurrent backtest using per-symbol adaptive trade logs.
 * It reuses the same per-symbol entry/exit logic and then applies capital allocator + concurrency constraints.
 */
export function runPortfolioAdaptiveBacktest(
  symbolCandles: Record<string, Candle[]>,
  holdBars: number = 6,
  options: {
    perSymbol?: Parameters<typeof runAdaptiveBacktest>[2];
    maxConcurrentPositions?: number;
    capitalPerPositionPct?: number;
    maxDailyLossPct?: number;
  } = {}
): PortfolioBacktestResult {
  const maxConcurrent = Math.max(1, options.maxConcurrentPositions ?? 3);
  const capitalPerPositionPct = Math.max(1, Math.min(100, options.capitalPerPositionPct ?? (100 / maxConcurrent)));
  const maxDailyLossPct = Math.abs(options.maxDailyLossPct ?? 8);
  const acceptedTrades: Array<TradeLogEntry & { symbol: string; scaledPnlPct: number }> = [];
  let skippedByConcurrency = 0;
  let skippedByDailyLoss = 0;

  const allTrades: Array<TradeLogEntry & { symbol: string }> = [];
  for (const [symbol, candles] of Object.entries(symbolCandles)) {
    if (!candles?.length) continue;
    const res = runAdaptiveBacktest(candles, holdBars, options.perSymbol ?? {});
    for (const t of res.tradeLog) allTrades.push({ ...t, symbol });
  }
  allTrades.sort((a, b) => (a.entryTime ?? 0) - (b.entryTime ?? 0));

  const active: Array<{ symbol: string; exitTime: number }> = [];
  const dayStats = new Map<string, { pnl: number; trades: number }>();
  let totalReturnPct = 0;
  let totalProfit = 0;
  let totalLoss = 0;
  let equity = 100;
  let peak = 100;
  let maxDrawdown = 0;

  for (const trade of allTrades) {
    const entryRaw = trade.entryTime ?? 0;
    const exitRaw = trade.exitTime ?? entryRaw;
    const entryTime = entryRaw > 1e12 ? entryRaw : entryRaw * 1000;
    const exitTime = exitRaw > 1e12 ? exitRaw : exitRaw * 1000;
    // Clean finished positions
    for (let idx = active.length - 1; idx >= 0; idx--) {
      if (active[idx]!.exitTime <= entryTime) active.splice(idx, 1);
    }
    if (active.length >= maxConcurrent) {
      skippedByConcurrency++;
      continue;
    }
    const dayKey = new Date(entryTime).toISOString().slice(0, 10);
    const day = dayStats.get(dayKey) ?? { pnl: 0, trades: 0 };
    if (day.pnl <= -maxDailyLossPct) {
      skippedByDailyLoss++;
      continue;
    }

    const scaledPnlPct = trade.pnlPct * (capitalPerPositionPct / 100);
    acceptedTrades.push({ ...trade, scaledPnlPct });
    active.push({ symbol: trade.symbol, exitTime });
    totalReturnPct += scaledPnlPct;
    if (scaledPnlPct > 0) totalProfit += scaledPnlPct;
    else totalLoss += Math.abs(scaledPnlPct);
    dayStats.set(dayKey, { pnl: day.pnl + scaledPnlPct, trades: day.trades + 1 });
    equity += scaledPnlPct;
    if (equity > peak) peak = equity;
    const dd = peak - equity;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }

  const wins = acceptedTrades.filter((t) => t.scaledPnlPct > 0).length;
  const totalTrades = acceptedTrades.length;
  const winRate = totalTrades ? (wins / totalTrades) * 100 : 0;
  const profitFactor = totalLoss > 0 ? totalProfit / totalLoss : totalProfit > 0 ? 999 : 0;
  const dailyRows = Array.from(dayStats.values());
  const dailyReturns = Array.from(dayStats.entries())
    .map(([day, v]) => ({ day, pnlPct: v.pnl, trades: v.trades }))
    .sort((a, b) => a.day.localeCompare(b.day));
  const avgDailyReturnPct = dailyRows.length ? dailyRows.reduce((a, b) => a + b.pnl, 0) / dailyRows.length : 0;
  const bestDayPct = dailyRows.length ? Math.max(...dailyRows.map((d) => d.pnl)) : 0;
  const worstDayPct = dailyRows.length ? Math.min(...dailyRows.map((d) => d.pnl)) : 0;

  return {
    totalReturnPct,
    totalTrades,
    wins,
    losses: totalTrades - wins,
    winRate,
    profitFactor,
    maxDrawdown,
    avgDailyReturnPct,
    bestDayPct,
    worstDayPct,
    dailyReturns,
    acceptedTrades,
    skippedByConcurrency,
    skippedByDailyLoss,
  };
}

function normalizeGreedyExitConfig(partial?: Partial<GreedyExitConfig>): GreedyExitConfig {
  const merged: GreedyExitConfig = {
    ...DEFAULT_GREEDY_EXIT,
    ...partial,
    partials: partial?.partials?.length ? partial.partials : DEFAULT_GREEDY_EXIT.partials,
  };
  merged.partials = [...merged.partials]
    .filter((x) => x.triggerPct > 0 && x.closeFraction > 0)
    .sort((a, b) => a.triggerPct - b.triggerPct);
  return merged;
}

function normalizeTrendGuardConfig(partial?: Partial<TrendGuardConfig>): TrendGuardConfig {
  return { ...DEFAULT_TREND_GUARD, ...partial };
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
  const high = highs[i]!;
  const low = lows[i]!;
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
  // SPECIAL STRATEGY: TREND SNIPER PRO v2 (Balanced)
  // ------------------------------------------------------------------
  if (presetName === "xtreme_all_weather") {
    // 1. SIDEWAYS STRATEGY: SAFE MEAN REVERSION
    // If the market is chopping, trade the extremes of the Bollinger Bands.
    if (regime === "SIDEWAYS") {
      // Buy Dip: Price below Lower BB + Oversold RSI
      if (c < bbLower[i]! && rsi[i]! < 30 && c > o) return "buy";
      // Sell Rip: Price above Upper BB + Overbought RSI
      if (c > bbUpper[i]! && rsi[i]! > 70 && c < o) return "sell";
      return null;
    }

    // 2. TREND STRATEGY: MOMENTUM SURFING
    // We are in a trend (ADX > 20).
    const isBullishStructure = ema20[i]! > ema50[i]!;
    const isBearishStructure = ema20[i]! < ema50[i]!;
    const validVolume = vol > vAvg * 1.1;

    // 3. ENTRY TRIGGER A: MOMENTUM PULLBACK (Value Entry)
    if (isBullishStructure) {
      // Trend is UP, buy the dip holding EMA support
      if (rsi[i]! < 60 && c > ema50[i]! && mHist > mHistPrev && validVolume) return "buy";

      // Breakout: Price blasting through bands
      if (c > bbUpper[i]! && vol > vAvg * 1.5) return "buy";
    }

    if (isBearishStructure) {
      // Trend is DOWN, sell the rally capping at EMA resistance
      if (rsi[i]! > 40 && c < ema50[i]! && mHist < mHistPrev && validVolume) return "sell";

      // Breakdown: Price crashing through bands
      if (c < bbLower[i]! && vol > vAvg * 1.5) return "sell";
    }

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
    // 1. RSI must be in bullish zone (config.rsiOversold+ - config.rsiOverbought)
    // 2. MACD must be green (direction check optional)
    // 3. Volume confirmation OR strong EMA alignment
    const bullishMomentum = rsi[i]! > config.rsiOversold && rsi[i]! < config.rsiOverbought && mHist > 0;
    const hasGoodSetup = isVolValid || ema9AboveEma50;

    if ((goldenCross || bounce20) && bullishMomentum && hasGoodSetup) {
      return "buy";
    }
  }

  // DOWNTREND: Take Death Cross or Resistance WITH GOOD CONFIRMATIONS
  if (isDowntrend && regime === "TRENDING_DOWN") {
    const reject20 = highs[i]! >= ema20[i]! && c < ema9[i]! && c < o;

    // BALANCED CONFIRMATION:
    // 1. RSI must be in bearish zone (config.rsiOversold - config.rsiOverbought)
    // 2. MACD must be red (direction check optional)
    // 3. Volume confirmation OR strong EMA alignment
    const bearishMomentum = rsi[i]! < config.rsiOverbought && rsi[i]! > config.rsiOversold && mHist < 0;
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
  trailing: boolean = true,
  greedyCfg?: GreedyExitConfig
): { exitIndex: number; exitPrice: number; pnlPct: number; exitReason: "holdBars" | "sl" | "tp" | "trailing"; partialTakes: number } {
  const slPct = stopLossPct / 100;
  const tpPct = takeProfitPct / 100;
  let currentSL = signal === "buy" ? entryPrice * (1 - slPct) : entryPrice * (1 + slPct);
  const targetTP = signal === "buy" ? entryPrice * (1 + tpPct) : entryPrice * (1 - tpPct);
  const greedy = normalizeGreedyExitConfig(greedyCfg);
  let remaining = 1;
  let realizedPnlPct = 0;
  let partialTakes = 0;
  const executedSteps = new Array(greedy.partials.length).fill(false);

  const addPartial = (partialPrice: number, fraction: number) => {
    const qty = Math.max(0, Math.min(remaining, fraction));
    if (qty <= 0) return;
    const pnlRaw = signal === "buy"
      ? ((partialPrice - entryPrice) / entryPrice) * 100
      : ((entryPrice - partialPrice) / entryPrice) * 100;
    realizedPnlPct += pnlRaw * LEVERAGE * qty;
    remaining -= qty;
    partialTakes++;
  };

  for (let k = 1; k <= maxBars; k++) {
    const j = entryIndex + k;
    if (j >= closes.length) {
      const lastClose = closes[closes.length - 1]!;
      const pnlRaw = signal === "buy" ? ((lastClose - entryPrice) / entryPrice) * 100 : ((entryPrice - lastClose) / entryPrice) * 100;
      const maxLossPnl = -stopLossPct * LEVERAGE;
      const slLevel = signal === "buy" ? entryPrice * (1 - slPct) : entryPrice * (1 + slPct);
      const blendedPnl = realizedPnlPct + pnlRaw * LEVERAGE * remaining;
      if (blendedPnl < maxLossPnl) {
        return { exitIndex: j - 1, exitPrice: slLevel, pnlPct: maxLossPnl, exitReason: "holdBars", partialTakes };
      }
      return { exitIndex: j - 1, exitPrice: lastClose, pnlPct: blendedPnl, exitReason: "holdBars", partialTakes };
    }

    const high = parseFloat(String(highs[j]));
    const low = parseFloat(String(lows[j]));
    const close = closes[j]!;

    if (greedy.enabled && remaining > 0) {
      for (let stepIdx = 0; stepIdx < greedy.partials.length; stepIdx++) {
        if (executedSteps[stepIdx]) continue;
        const step = greedy.partials[stepIdx]!;
        const triggerPrice = signal === "buy"
          ? entryPrice * (1 + step.triggerPct / 100)
          : entryPrice * (1 - step.triggerPct / 100);
        const hit = signal === "buy" ? high >= triggerPrice : low <= triggerPrice;
        if (!hit) continue;
        addPartial(triggerPrice, step.closeFraction);
        executedSteps[stepIdx] = true;
        if (partialTakes === 1) {
          const be = signal === "buy"
            ? entryPrice * (1 + greedy.breakEvenBufferPct / 100)
            : entryPrice * (1 - greedy.breakEvenBufferPct / 100);
          currentSL = signal === "buy" ? Math.max(currentSL, be) : Math.min(currentSL, be);
        }
      }
      if (remaining <= 0.0001) {
        return { exitIndex: j, exitPrice: close, pnlPct: realizedPnlPct, exitReason: "tp", partialTakes };
      }
    }

    if (signal === "buy") {
      // SMART TRAILING: Only move to Breakeven after solid 1% move
      if (trailing && close > entryPrice * 1.01) {
        const newSL = Math.max(currentSL, entryPrice * 1.002); // Secure fees (0.2%)
        currentSL = newSL;
      }

      // Greedy runner trailing: after partials, tighten trailing to lock quick scalps.
      const startTrailPct = greedy.enabled ? greedy.runnerTrailStartPct : 2.0;
      const trailDistancePct = greedy.enabled ? greedy.runnerTrailDistancePct : 1.0;
      if (trailing && close > entryPrice * (1 + startTrailPct / 100)) {
        const trailLevel = close * (1 - trailDistancePct / 100);
        currentSL = Math.max(currentSL, trailLevel);
      }

      if (low <= currentSL) {
        const pnl = ((currentSL - entryPrice) / entryPrice) * 100 * LEVERAGE * remaining + realizedPnlPct;
        return { exitIndex: j, exitPrice: currentSL, pnlPct: pnl, exitReason: "sl", partialTakes };
      }
      if (high >= targetTP) {
        const pnl = takeProfitPct * LEVERAGE * remaining + realizedPnlPct;
        return { exitIndex: j, exitPrice: targetTP, pnlPct: pnl, exitReason: "tp", partialTakes };
      }
    } else {
      // SMART TRAILING SELL: Breakeven after 1% drop
      if (trailing && close < entryPrice * 0.99) {
        const newSL = Math.min(currentSL, entryPrice * 0.998); // Secure fees
        currentSL = newSL;
      }

      const startTrailPct = greedy.enabled ? greedy.runnerTrailStartPct : 2.0;
      const trailDistancePct = greedy.enabled ? greedy.runnerTrailDistancePct : 1.0;
      if (trailing && close < entryPrice * (1 - startTrailPct / 100)) {
        const trailLevel = close * (1 + trailDistancePct / 100);
        currentSL = Math.min(currentSL, trailLevel);
      }

      if (high >= currentSL) {
        const pnl = ((entryPrice - currentSL) / entryPrice) * 100 * LEVERAGE * remaining + realizedPnlPct;
        return { exitIndex: j, exitPrice: currentSL, pnlPct: pnl, exitReason: "sl", partialTakes };
      }
      if (low <= targetTP) {
        const pnl = takeProfitPct * LEVERAGE * remaining + realizedPnlPct;
        return { exitIndex: j, exitPrice: targetTP, pnlPct: pnl, exitReason: "tp", partialTakes };
      }
    }

    if (k === maxBars) {
      const pnlRaw = signal === "buy" ? ((close - entryPrice) / entryPrice) * 100 : ((entryPrice - close) / entryPrice) * 100;
      // Cap time-exit loss at SL: never realize worse than -stopLossPct (stops one big loser killing P&L)
      const slLevel = signal === "buy" ? entryPrice * (1 - slPct) : entryPrice * (1 + slPct);
      const maxLossPnl = -stopLossPct * LEVERAGE;
      const blendedPnl = realizedPnlPct + pnlRaw * LEVERAGE * remaining;
      if (blendedPnl < maxLossPnl) {
        return { exitIndex: j, exitPrice: slLevel, pnlPct: maxLossPnl, exitReason: "holdBars", partialTakes };
      }
      return { exitIndex: j, exitPrice: close, pnlPct: blendedPnl, exitReason: "holdBars", partialTakes };
    }
  }
  return { exitIndex: entryIndex + maxBars, exitPrice: closes[entryIndex + maxBars]!, pnlPct: realizedPnlPct, exitReason: "holdBars", partialTakes };
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
    commissionPct?: number;
    slippagePct?: number;
    greedyExit?: Partial<GreedyExitConfig>;
    trendGuard?: Partial<TrendGuardConfig>;
    /** Backtest-only: lower threshold for more trades (e.g. 80). If set, overrides alpha_one 96. */
    minAiScoreOverride?: number;
  } = {}
): AdaptiveBacktestResult {
  const selectedPreset = options.preset ?? "pro_sniper_v3";
  const config = STRATEGY_PRESETS[selectedPreset] || STRATEGY_PRESETS.pro_sniper_v3;

  const stopLossPct = options.stopLossPct ?? STOP_LOSS_PCT;
  const takeProfitPct = options.takeProfitPct ?? TAKE_PROFIT_PCT;
  const cooldownBars = options.cooldownBars ?? config.cooldownBars;
  const minCandles = options.minCandles ?? MIN_CANDLES_BEFORE_TRADING;
  const skipExtremeVol = options.skipExtremeVolatility !== false;
  const greedyExit = normalizeGreedyExitConfig(options.greedyExit);
  const trendGuard = normalizeTrendGuardConfig(options.trendGuard);

  // Real-world drag: Default 0.04% taker fee + 0.01% slippage per side (x2 for roundtrip) -> ~0.1% total
  // PnL impact = (Comm + Slip) * 2 * Leverage
  const commission = options.commissionPct ?? 0.04;
  const slippage = options.slippagePct ?? 0.01;
  const totalDragPerTradePct = (commission + slippage) * 2;

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
  const returns: number[] = []; // For Sharpe Ratio
  let consecutiveLosses = 0;
  let pauseUntilBar = -1;
  let currentDay = "";
  let dayPnlPct = 0;
  const dayStats = new Map<string, { pnlPct: number; trades: number }>();
  const guardBlocks = {
    weakTrend: 0,
    badDirectionalExpectancy: 0,
    lossStreakPause: 0,
    dailyLossLimit: 0,
  };

  for (let i = startBar; i <= lastIndex; i++) {
    const regimeInfo = detectRegimeAtCandle(i, closes, highs, lows, ema20, ema200, rsi, adxSeries, atrSeries, emaSlopePctSeries, config);
    const dayKey = new Date((candles[i]?.time ?? 0) * 1000).toISOString().slice(0, 10);
    if (dayKey !== currentDay) {
      currentDay = dayKey;
      dayPnlPct = dayStats.get(dayKey)?.pnlPct ?? 0;
    }

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
    if (trendGuard.enabled && i < pauseUntilBar) {
      guardBlocks.lossStreakPause++;
      equityCurve.push(equityCurve[equityCurve.length - 1]!);
      continue;
    }
    if (trendGuard.enabled && dayPnlPct <= -Math.abs(trendGuard.maxDailyLossPct)) {
      guardBlocks.dailyLossLimit++;
      equityCurve.push(equityCurve[equityCurve.length - 1]!);
      continue;
    }

    let signal: "buy" | "sell" | null = null;
    let usedRegime = regimeInfo.regime;
    let usedStrategy = regimeInfo.strategy;

    // === Strict AI-style scoring (alpha_one, pro_scalper_v2, universal_auto) ===
    if (selectedPreset === "alpha_one" || selectedPreset === "pro_scalper_v2" || selectedPreset === "universal_auto") {
      // === 🧠 AI BRAIN V2 (Strict) ===
      // === 🧠 ADVANCED AI BRAIN SCORING (High Precision) ===
      let aiScore = 0;

      // 1. Trend Strength (Stricter)
      if (adxSeries[i] > config.adxTrendThreshold) aiScore += 15;
      if (adxSeries[i] > config.adxTrendThreshold + 10) aiScore += 10; // Extra strong trend only

      // 2. Market Structure (Critical)
      const isBull = closes[i] > ema20[i] && ema20[i] > ema50[i] && ema50[i] > ema200[i];
      const isBear = closes[i] < ema20[i] && ema20[i] < ema50[i] && ema50[i] < ema200[i];
      const isPartialBull = !isBull && closes[i] > ema20[i] && ema20[i] > ema50[i];
      const isPartialBear = !isBear && closes[i] < ema20[i] && ema20[i] < ema50[i];

      if (isBull) aiScore += 30; // Full structure is king
      else if (isPartialBull) aiScore += 15; // Partial is okay but needs help

      if (isBear) aiScore += 30;
      else if (isPartialBear) aiScore += 15;

      // 3. Momentum (RSI) - Precision Zones
      // Buy: 40-65 (Sweet spot, not overbought yet)
      if ((isBull || isPartialBull) && rsi[i] >= 40 && rsi[i] <= 68) aiScore += 20;
      // Sell: 35-60
      if ((isBear || isPartialBear) && rsi[i] >= 32 && rsi[i] <= 60) aiScore += 20;

      // 4. Volume Flow (Critical Filter)
      if (volumes[i] > volAvg[i] * config.volumeMultiplier) aiScore += 15;
      else aiScore -= 5; // Penalty for low volume

      // 5. Momentum Drag Penalty
      if (adxSeries[i] < 20) aiScore -= 10; // Chop zone penalty

      // 6. MACD Confirmation
      if (i > 0) {
        if ((isBull || isPartialBull) && macdHist[i] > 0 && macdHist[i] > macdHist[i - 1]) aiScore += 15;
        if ((isBear || isPartialBear) && macdHist[i] < 0 && macdHist[i] < macdHist[i - 1]) aiScore += 15;
      }

      // 7. Impulse
      if (Math.abs(closes[i] - opens[i]) > atrSeries[i] * 1.2) aiScore += 10;

      // Target Score: 75 (High Precision)
      // Needs: Trend(15) + Struct(30) + Mom(20) + Vol(15) = 80 -> Trade.
      // Partial(15) needs almost everything else perfect.
      const minScore = options.minAiScoreOverride ?? 75;

      if (aiScore >= minScore) {
        // Validation: Candle color must match
        const candleAligns = (isBull || isPartialBull) ? (closes[i] > opens[i]) : (closes[i] < opens[i]);
        if (candleAligns) {
          if (isBull || isPartialBull) signal = "buy";
          else if (isBear || isPartialBear) signal = "sell";
        }
      }

      // DISABLE OLD LOGIC
      if (false) {
        const hasVolume = volumes[i] > volAvg[i] * 1.3;
        const hasImpulse = Math.abs(closes[i] - opens[i]) > atrSeries[i] * 2;
        const validAdx = adxSeries[i] > 18;

        let score = 0;
        if (hasVolume) score += 15;
        if (hasImpulse) score += 20;
        if (validAdx) score += 10;

        // BUY
        if (closes[i] > ema20[i] && rsi[i] > 50 && rsi[i] < 75 && macdHist[i] > 0) {
          score += 10; // Momentum
          if (macdHist[i] > macdHist[i - 1]) score += 10; // MACD Accel
          if (ema20[i] > ema50[i] && ema50[i] > ema200[i]) score += 10; // EMA Stack

          if (score >= 40) signal = "buy"; // ~70% equivalent
        }
        // SELL
        else if (closes[i] < ema20[i] && rsi[i] < 50 && rsi[i] > 25 && macdHist[i] < 0) {
          score += 10; // Momentum
          if (macdHist[i] < macdHist[i - 1]) score += 10; // MACD Accel
          if (ema20[i] < ema50[i] && ema50[i] < ema200[i]) score += 10; // EMA Stack

          if (score >= 40) signal = "sell";
        }
      } // End of old logic (disabled)
    } // End of alpha_one / pro_scalper_v2 block

    // ── PRO SCALPER V3: ATR-aware signal, no rigid EMA200 stack required ──────
    else if (selectedPreset === "pro_scalper_v3") {
      let v3Score = 0;

      // 1. Trend strength (ADX) — REQUIRED: at least ADX 18
      const curAdx = adxSeries[i]!;
      if (curAdx < 18) { equityCurve.push(equityCurve[equityCurve.length - 1]!); continue; }
      if (curAdx >= 18) v3Score += 20;
      if (curAdx >= 25) v3Score += 10;

      // 2. EMA alignment (partial counts half)
      const ema20AboveEma50 = ema20[i]! > ema50[i]!;
      const ema20BelowEma50 = ema20[i]! < ema50[i]!;
      const aboveEma200 = closes[i]! > ema200[i]!;
      const belowEma200 = closes[i]! < ema200[i]!;
      const isBullV3 = aboveEma200 && ema20AboveEma50;
      const isBearV3 = belowEma200 && ema20BelowEma50;
      const partialBullV3 = !isBullV3 && ema20AboveEma50;
      const partialBearV3 = !isBearV3 && ema20BelowEma50;

      if (isBullV3) v3Score += 25;
      else if (partialBullV3) v3Score += 12;
      if (isBearV3) v3Score += 25;
      else if (partialBearV3) v3Score += 12;

      // 3. RSI momentum zone — tight zones, extended to 70 for bull momentum
      if ((isBullV3 || partialBullV3) && rsi[i]! >= 44 && rsi[i]! <= 70) v3Score += 18;
      if ((isBearV3 || partialBearV3) && rsi[i]! >= 30 && rsi[i]! <= 56) v3Score += 18;

      // 4. MACD confirmation — score bonus/penalty (not hard skip, to catch early momentum)
      const dirBull = isBullV3 || partialBullV3;
      const dirBear = isBearV3 || partialBearV3;
      const macdBull = i > 0 && macdHist[i]! > 0 && macdHist[i]! > macdHist[i - 1]!;
      const macdBear = i > 0 && macdHist[i]! < 0 && macdHist[i]! < macdHist[i - 1]!;
      const macdCrossOk = (dirBull && macdHist[i]! > macdHist[i - 1]!) || (dirBear && macdHist[i]! < macdHist[i - 1]!);
      if (macdBull && dirBull) v3Score += 18;  // Strong confirm: rising MACD histogram above 0
      else if (macdBear && dirBull) v3Score -= 14; // MACD actively declining during bull setup
      if (macdBear && dirBear) v3Score += 18;  // Strong confirm: falling MACD histogram below 0
      else if (macdBull && dirBear) v3Score -= 14; // MACD actively rising during bear setup
      if (!macdCrossOk && i > 0) v3Score -= 8; // General MACD misalignment penalty

      // 5. Volume confirmation (1.1× for V3)
      if (volumes[i]! > volAvg[i]! * 1.10) v3Score += 12;

      // 6. Candle impulse: body must be > 20% of ATR (filters dojis / weak candles)
      const candleBody = Math.abs(closes[i]! - opens[i]!);
      if (candleBody < atrSeries[i]! * 0.20) { equityCurve.push(equityCurve[equityCurve.length - 1]!); continue; }

      // Gate: needs ADX + partial EMA + RSI + mostly-confirmed MACD
      const minV3Score = options.minAiScoreOverride ?? 62;
      if (v3Score >= minV3Score) {
        const candleGreen = closes[i]! > opens[i]!;
        const candleRed = closes[i]! < opens[i]!;
        if ((isBullV3 || partialBullV3) && candleGreen) signal = "buy";
        else if ((isBearV3 || partialBearV3) && candleRed) signal = "sell";
      }
    } // End pro_scalper_v3 block

    // UNIVERSAL AUTO INTERCEPTION (AI-ENFORCED V11)
    // UNIVERSAL AUTO & PRO SCALPER HANDLED ABOVE
    // LEAVING LEGACY ELSE IF AS FALLBACK for verify
    else {
      // STANDARD LEGACY PATH
      signal = getAdaptiveSignalAt(closes, highs, lows, opens, volumes, volAvg, ema9, ema20, ema50, ema200, rsi, macdHist, bbLower, bbUpper, regimeInfo.regime, regimeInfo.strategy, i, config, selectedPreset);
    }

    if (!signal) {
      equityCurve.push(equityCurve[equityCurve.length - 1]!);
      continue;
    }

    if (trendGuard.enabled) {
      const weakTrend = adxSeries[i] < trendGuard.minAdx && regimeInfo.regime !== "TRENDING_UP" && regimeInfo.regime !== "TRENDING_DOWN";
      if (weakTrend) {
        guardBlocks.weakTrend++;
        equityCurve.push(equityCurve[equityCurve.length - 1]!);
        continue;
      }
      const directionalRecent = tradeLog
        .slice(-trendGuard.lookbackTrades)
        .filter((t) => t.signal === signal);
      if (directionalRecent.length >= 4) {
        const dWins = directionalRecent.filter((t) => t.pnlPct > 0).length;
        const dWinRate = dWins / directionalRecent.length;
        const dAvg = directionalRecent.reduce((acc, t) => acc + t.pnlPct, 0) / directionalRecent.length;
        if (dWinRate < trendGuard.minDirectionalWinRate && dAvg < 0) {
          guardBlocks.badDirectionalExpectancy++;
          equityCurve.push(equityCurve[equityCurve.length - 1]!);
          continue;
        }
      }
    }

    const entryPrice = closes[i]!;
    const currentAtr = atrSeries[i] ?? (entryPrice * 0.012);

    let usedSL: number;
    let usedTP: number;

    // PRO SCALPER V3: ATR-adaptive SL (1×ATR), capped at 0.8% like Python AI
    if (selectedPreset === "pro_scalper_v3") {
      const atrPct = (currentAtr / entryPrice) * 100;
      usedSL = Math.max(0.35, Math.min(0.8, atrPct * 1.0)); // 1×ATR, capped 0.35%–0.8%
      usedTP = usedSL * 1.8;                                 // 1.8:1 RR – realistic target
    } else if (options.stopLossPct != null && options.takeProfitPct != null) {
      // Scalping: user-provided fixed TP/SL (e.g. 2.5% TP, 1.2% SL)
      usedSL = options.stopLossPct;
      usedTP = options.takeProfitPct;
    } else {
      const atrPct = (currentAtr / entryPrice) * 100;
      usedSL = Math.max(0.6, atrPct * config.atrStopMultiplier);
      usedTP = usedSL * config.riskRewardRatio;
    }

    // Scalping with fixed SL: no trailing so loss is always exactly at SL (no surprise big loss)
    const useTrailing = options.stopLossPct == null;
    const exitResult = simulateExit(signal, i, entryPrice, closes, highs, lows, config.maxHoldingBars, usedSL, usedTP, useTrailing, greedyExit);
    lastTradeExitBar = exitResult.exitIndex;
    totalTrades++;

    const scaleFactor = leverageVal / LEVERAGE;
    let leveragedPnl = exitResult.pnlPct * scaleFactor;

    // Hard cap: no single trade can lose more than usedSL * leverageVal (e.g. 1% * 22 = 22%)
    const maxLossPct = usedSL * leverageVal;
    if (leveragedPnl < -maxLossPct) leveragedPnl = -maxLossPct;

    // Apply Commission & Slippage Drag (scaled by leverage)
    const dragOnEquityPct = totalDragPerTradePct * leverageVal;
    leveragedPnl -= dragOnEquityPct;

    if (leveragedPnl > 0) wins++;
    if (leveragedPnl > 0) consecutiveLosses = 0;
    else consecutiveLosses++;
    if (trendGuard.enabled && consecutiveLosses >= trendGuard.lossStreakPause) {
      pauseUntilBar = i + trendGuard.pauseBars;
    }
    totalProfitPct += leveragedPnl > 0 ? leveragedPnl : 0;
    totalLossPct += leveragedPnl < 0 ? Math.abs(leveragedPnl) : 0;
    dayPnlPct += leveragedPnl;
    const prevDay = dayStats.get(dayKey) ?? { pnlPct: 0, trades: 0 };
    dayStats.set(dayKey, {
      pnlPct: prevDay.pnlPct + leveragedPnl,
      trades: prevDay.trades + 1,
    });

    returns.push(leveragedPnl);

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

    // Calculate position size based on 2% risk per trade
    const accountBalance = 100; // Starting capital
    const riskPerTradePct = 2; // 2% risk per trade
    const riskAmount = (accountBalance * riskPerTradePct) / 100;
    const positionSizeUsd = (riskAmount / (usedSL / 100)) * leverageVal;

    // Calculate actual USD P&L
    const pnlUsd = (leveragedPnl / 100) * accountBalance;

    // Calculate actual R:R achieved
    const actualRR = leveragedPnl > 0 ? (leveragedPnl / usedSL) : 0;

    // Calculate SL and TP price levels
    const stopLossPrice = signal === "buy"
      ? entryPrice * (1 - usedSL / 100)
      : entryPrice * (1 + usedSL / 100);
    const takeProfitPrice = signal === "buy"
      ? entryPrice * (1 + usedTP / 100)
      : entryPrice * (1 - usedTP / 100);

    tradeLog.push({
      barIndex: i,
      signal,
      entryPrice,
      exitPrice: exitResult.exitPrice,
      pnlPct: leveragedPnl,
      regime: regimeInfo.regime,
      strategy: regimeInfo.strategy,
      exitReason: exitResult.exitReason,
      // 📊 ADVANCED DETAILS
      entryTime: candles[i]?.time,
      exitTime: candles[exitResult.exitIndex]?.time,
      stopLoss: parseFloat(stopLossPrice.toFixed(2)),
      takeProfit: parseFloat(takeProfitPrice.toFixed(2)),
      positionSizeUsd: parseFloat(positionSizeUsd.toFixed(2)),
      pnlUsd: parseFloat(pnlUsd.toFixed(2)),
      riskRewardRatio: parseFloat(actualRR.toFixed(2)),
      holdBars: exitResult.exitIndex - i,
      slPct: parseFloat(usedSL.toFixed(2)),
      tpPct: parseFloat(usedTP.toFixed(2)),
      partialTakes: exitResult.partialTakes,
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

  // Calculate Sharpe Ratio (Trade-based)
  // Mean Return / Std Dev of Returns
  let sharpeRatio = 0;
  if (returns.length > 1) {
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / (returns.length - 1);
    const stdDev = Math.sqrt(variance);
    sharpeRatio = stdDev > 0 ? mean / stdDev : 0;
  }

  const regimePerformance: RegimePerformanceEntry[] = [];
  regimePerf.forEach((p, regime) => {
    if (p.trades === 0) return;
    const totalReturnPct = p.totalProfitPct - p.totalLossPct;
    const pf = p.totalLossPct > 0 ? p.totalProfitPct / p.totalLossPct : (p.totalProfitPct > 0 ? 999 : 0);
    regimePerformance.push({
      regime,
      strategy: "EMA_TREND", // placeholder
      trades: p.trades,
      wins: p.wins,
      totalReturnPct,
      winRate: p.trades > 0 ? (p.wins / p.trades) * 100 : 0,
      profitFactor: pf,
      maxDrawdown: p.maxDd,
    });
  });

  const lastRegime = len > startBar
    ? detectRegimeAtCandle(len - 1, closes, highs, lows, ema20, ema200, rsi, adxSeries, atrSeries, emaSlopePctSeries, config)
    : { regime: "SIDEWAYS" as AdaptiveRegime, reason: "Insufficient data", adx: 0, atr: 0, atrAvg: 0, strategy: "RSI_MEAN_REVERSION" as ActiveStrategyName };

  const dailyReturns = Array.from(dayStats.entries())
    .map(([day, x]) => ({ day, pnlPct: x.pnlPct, trades: x.trades }))
    .sort((a, b) => a.day.localeCompare(b.day));
  const bestDayPct = dailyReturns.length ? Math.max(...dailyReturns.map((d) => d.pnlPct)) : 0;
  const worstDayPct = dailyReturns.length ? Math.min(...dailyReturns.map((d) => d.pnlPct)) : 0;

  return {
    totalReturn: totalReturnPct,
    winRate,
    profitFactor,
    maxDrawdown,
    totalTrades,
    wins,
    losses: totalTrades - wins,
    sharpeRatio: parseFloat(sharpeRatio.toFixed(3)),
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
    diagnostics: {
      guardBlocks,
      dailyReturns,
      bestDayPct,
      worstDayPct,
    },
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
 * MTF version: uses 1m and 5m for confirmation.
 */
export async function getCurrentSignalAdaptive(
  candles: Candle[],
  preset: StrategyPreset = "pro_sniper_v3",
  mtfData?: { "1m"?: Candle[], "5m"?: Candle[] }
): Promise<{
  signal: "buy" | "sell" | null;
  regime: RegimeAtCandle | null;
  confidence: number;
}> {
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
  let signal: "buy" | "sell" | null = null;
  let regimeInfoUsed = regimeInfo;

  // ALPHA ONE (scalp): accha trend = signal; RANGE/SIDEWAYS me bhi short-term momentum pe signal
  if (preset === "alpha_one") {
    const { adx: adxS } = calculateADXSeries(candles, 14);
    const atrS = calculateATR(candles, 14);
    let aiScore = 0;
    // === 🧠 ADVANCED AI BRAIN SCORING (Python Parity) ===
    if (adxS[i]! > config.adxTrendThreshold) aiScore += 15;
    if (adxS[i]! > config.adxTrendThreshold + 8) aiScore += 10;

    // Structure: Very heavy weighting on trend structure
    const isBull = closes[i]! > ema20[i]! && ema20[i]! > ema50[i]! && ema50[i]! > ema200[i]!;
    const isBear = closes[i]! < ema20[i]! && ema20[i]! < ema50[i]! && ema50[i]! < ema200[i]!;
    const isPartialBull = !isBull && closes[i]! > ema20[i]! && ema20[i]! > ema50[i]!;
    const isPartialBear = !isBear && closes[i]! < ema20[i]! && ema20[i]! < ema50[i]!;

    if (isBull) aiScore += 30;
    else if (isPartialBull) aiScore += 20; // Partial trend gets high score too

    if (isBear) aiScore += 30;
    else if (isPartialBear) aiScore += 20;

    // Momentum & Volume
    if (isBull && rsi[i]! >= config.rsiOversold && rsi[i]! <= config.rsiOverbought + 5) aiScore += 25;
    if (isBear && rsi[i]! >= config.rsiOversold - 5 && rsi[i]! <= config.rsiOverbought) aiScore += 25;

    if (volumes[i]! > volAvg[i]! * config.volumeMultiplier) aiScore += 15;
    if (volumes[i]! > volAvg[i]! * (config.volumeMultiplier * 1.5)) aiScore += 10;

    // MACD Confirmation
    if (i > 0) {
      if (isBull && macdHist[i]! > 0 && macdHist[i]! > macdHist[i - 1]!) aiScore += 15;
      if (isBear && macdHist[i]! < 0 && macdHist[i]! < macdHist[i - 1]!) aiScore += 15;
    }

    // Impulse
    if (Math.abs(closes[i]! - opens[i]!) > atrS[i]! * 1.0) aiScore += 15;

    // Thresholds: 65 is the new "72" (easier to reach with new weights)
    const canTrade = aiScore >= 65;

    if (canTrade) {
      if (isBull || isPartialBull) signal = "buy";
      else if (isBear || isPartialBear) signal = "sell";
    }

    // Backup: Range trading on pure momentum if score is decent (55+)
    const shortBull = closes[i]! > ema20[i]! && ema20[i]! > ema50[i]! && rsi[i]! >= 48 && rsi[i]! <= 74 && macdHist[i]! > 0;
    const shortBear = closes[i]! < ema20[i]! && ema20[i]! < ema50[i]! && rsi[i]! >= 26 && rsi[i]! <= 52 && macdHist[i]! < 0;

    if (!signal && aiScore >= 55 && (shortBull || shortBear)) {
      if (shortBull) signal = "buy";
      else if (shortBear) signal = "sell";
    }
  } else if (preset === "universal_auto") {
    // Universal Auto: Use the new Orchestrator
    const { adx: adxS } = calculateADXSeries(candles, 14);
    const atrS = calculateATR(candles, 14);
    const uResult = getUniversalSignal(i, candles, closes, highs, lows, ema20, ema50, ema200, rsi, macdHist, bbUpper, bbLower, adxS, atrS, volAvg);
    signal = uResult.signal;

    // MTF MOMENTUM OVERLAY
    if (signal && mtfData?.["1m"] && mtfData["1m"].length > 10) {
      const c1m = mtfData["1m"];
      const last1m = parseFloat(c1m[c1m.length - 1].close);
      const prev1m = parseFloat(c1m[c1m.length - 5].close); // 5 mins ago

      const is1mBull = last1m > prev1m;
      const is1mBear = last1m < prev1m;

      if (signal === "buy" && !is1mBull) {
        // console.log("[MTF] Muting BUY signal - 1m not bullish");
        // signal = null; // Mute if lower TF doesn't confirm
      }
      if (signal === "sell" && !is1mBear) {
        // console.log("[MTF] Muting SELL signal - 1m not bearish");
        // signal = null;
      }
    }

    // console.log(`[UNIVERSAL] Mode:${uResult.regime.trend} Vol:${uResult.regime.volatility} -> Signal:${signal}`);
  } else {
    // Standard Presets
    signal = getAdaptiveSignalAt(closes, highs, lows, opens, volumes, volAvg, ema9, ema20, ema50, ema200, rsi, macdHist, bbLower, bbUpper, regimeInfo.regime, regimeInfo.strategy, i, config, preset);
  }

  // Calculate dynamic market alignment score (confidence)
  let score = 0;

  // X-TREME / UNIVERSAL / ALPHA_ONE baseline
  if (preset === "xtreme_all_weather" || preset === "universal_auto" || preset === "alpha_one") score += 10;

  // Base score from Trend/Volume alignment (always active)
  if (volumes[i]! > volAvg[i]!) score += 20;
  if (Math.abs(closes[i]! - ema20[i]!) / ema20[i]! < 0.002) score += 15; // Proximity to EMA (pullback zone)
  if (rsi[i]! > 40 && rsi[i]! < 60) score += 15; // Neutral-ready RSI
  if (closes[i]! > ema200[i]!) score += 10; // Extra points for being in long-term bullish territory

  if (signal === "buy" || signal === "sell") {
    // If we have a signal, push score to high conviction levels
    score = 75; // Initial signal conviction
    if (volumes[i]! > volAvg[i]!) score += 15;
    if (Math.abs(macdHist[i]!) > Math.abs(macdHist[i - 1]!)) score += 10;

    // MTF Confidence Bonus
    if (mtfData?.["1m"] && mtfData["5m"]) {
      const c1m = mtfData["1m"];
      const c5m = mtfData["5m"];
      const last1m = parseFloat(c1m[c1m.length - 1].close);
      const last5m = parseFloat(c5m[c5m.length - 1].close);
      const open1m = parseFloat(c1m[c1m.length - 1].open);
      const open5m = parseFloat(c5m[c5m.length - 1].open);

      if (signal === "buy" && last1m > open1m && last5m > open5m) score += 10;
      if (signal === "sell" && last1m < open1m && last5m < open5m) score += 10;
    }
  } else {
    // No signal yet, but how "hot" is it?
    if (regimeInfo.strategy === "EMA_TREND") {
      if (closes[i]! > ema200[i]! && rsi[i]! < 50) score += 10; // Uptrend pullback setup
    }
  }

  const confidence = Math.min(100, score);
  return { signal, regime: regimeInfo, confidence };
}

/**
 * DEEP SEEKER STRATEGY (High TF Trend + Volume)
 */
export function getDeepSeekerSignal(
  i: number,
  c: number, o: number,
  ema50: number, ema200: number,
  rsi: number,
  vol: number, volAvg: number
): "buy" | "sell" | null {
  // 1. Trend Filter: Stacked EMAs
  const isBullish = c > ema50 && ema50 > ema200;
  const isBearish = c < ema50 && ema50 < ema200;

  // 2. Volume Confirmation (Critical for reliability)
  const isVolumeValid = vol > volAvg * 1.2; // 20% above average

  // 3. Momentum Confirmation
  if (isBullish && rsi > 50 && rsi < 70 && isVolumeValid) {
    return "buy";
  }
  if (isBearish && rsi < 50 && rsi > 30 && isVolumeValid) {
    return "sell";
  }
  return null;
}

/**
 * Deep Seeker Backtest Runner
 */
export function runDeepSeekerBacktest(candles: Candle[]): AdaptiveBacktestResult {
  const closes = candles.map(c => parseFloat(c.close));
  const opens = candles.map(c => parseFloat(c.open));
  const volumes = candles.map(c => parseFloat(c.volume || "0"));

  const ema50 = calculateEMA(closes, 50);
  const ema200 = calculateEMA(closes, 200);
  const rsi = calculateRSI(closes, 14);
  const volAvg = calculateVolumeAvg(volumes, 20);

  let position: "long" | "short" | null = null;
  let entryPrice = 0;
  const tradeLog: any[] = [];
  const equityCurve: number[] = [100]; // Start 100%
  let wins = 0; let losses = 0;

  for (let i = 201; i < candles.length; i++) {
    const c = closes[i];
    const date = new Date(candles[i].time * 1000).toISOString();

    // Signal
    const signal = getDeepSeekerSignal(i, c, opens[i], ema50[i], ema200[i], rsi[i], volumes[i], volAvg[i]);

    // Exit Logic
    if (position === "long") {
      // Exit if RSI overbought reversal or Trend break
      if (rsi[i] > 80 || c < ema50[i]) {
        const pnl = (c - entryPrice) / entryPrice * 100;
        const pnlNet = pnl - 0.12; // Fees
        tradeLog.push({ entryTime: 0, exitTime: candles[i].time, type: "long", entryPrice, exitPrice: c, pnl: pnlNet, reason: "Signal Exit" });
        if (pnlNet > 0) wins++; else losses++;
        equityCurve.push(equityCurve[equityCurve.length - 1] * (1 + pnlNet / 100));
        position = null;
      }
    } else if (position === "short") {
      if (rsi[i] < 20 || c > ema50[i]) {
        const pnl = (entryPrice - c) / entryPrice * 100;
        const pnlNet = pnl - 0.12;
        tradeLog.push({ entryTime: 0, exitTime: candles[i].time, type: "short", entryPrice, exitPrice: c, pnl: pnlNet, reason: "Signal Exit" });
        if (pnlNet > 0) wins++; else losses++;
        equityCurve.push(equityCurve[equityCurve.length - 1] * (1 + pnlNet / 100));
        position = null;
      }
    }

    // Entry Logic
    if (!position) {
      if (signal === "buy") {
        position = "long"; entryPrice = c;
      } else if (signal === "sell") {
        position = "short"; entryPrice = c;
      }
    }
  }

  // Final stats
  const totalTrades = wins + losses;
  const totalReturn = equityCurve[equityCurve.length - 1] - 100;

  return {
    regime: "SIDEWAYS",
    reason: "Deep Seeker Test",
    adx: 0,
    totalReturn,
    totalReturnPct: totalReturn,
    totalTrades,
    wins,
    losses,
    winRate: totalTrades > 0 ? (wins / totalTrades) * 100 : 0,
    profitFactor: 0,
    maxDrawdown: 0,
    sharpeRatio: 0,
    regimePerformance: [],
    tradeLog,
    equityCurve,
    stats: { winRate: "0", totalTrades: 0, profitFactor: "0" }
  };
}
