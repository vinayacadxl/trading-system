/**
 * Pro Sniper AI – Adaptive Hybrid Futures Engine
 * Types and config for BTCUSD 15m.
 */

export type MarketMode = "TREND_UP" | "TREND_DOWN" | "SIDEWAYS" | "VOLATILITY";

export type ActiveEngine = "TREND" | "INSTITUTIONAL_PULLBACK" | "SCALPING" | "NONE";

export interface ProSniperConfig {
  /** Risk per trade 1–2% */
  riskPct: number;
  /** Daily max loss 4% */
  maxDailyLossPct: number;
  /** Stop after N consecutive losses */
  maxConsecutiveLosses: number;
  /** Min candles between trades (trend engine) */
  cooldownCandles: number;
  /** Scalping: max trades per hour */
  scalpingMaxTradesPerHour: number;
  /** Commission per side (e.g. 0.0004 = 0.04%) */
  commissionPct: number;
  /** Slippage in price (e.g. 0.0002 = 0.02%) */
  slippagePct: number;
}

export const DEFAULT_PRO_SNIPER_CONFIG: ProSniperConfig = {
  riskPct: 1.5,
  maxDailyLossPct: 4,
  maxConsecutiveLosses: 3,
  cooldownCandles: 5,
  scalpingMaxTradesPerHour: 2,
  commissionPct: 0.0004,
  slippagePct: 0.0002,
};

export interface MarketConditionState {
  mode: MarketMode;
  engine: ActiveEngine;
  reason: string;
  adx: number;
  atr: number;
  atrAvg20: number;
  ema200: number;
  ema50: number;
  ema20: number;
  rsi: number;
  volumeAvg: number;
  volumeRatio: number;
}

export interface ProSniperSignal {
  side: "buy" | "sell";
  engine: ActiveEngine;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  /** R multiple for position sizing */
  riskR: number;
  /** Optional partial close at 1.5R (institutional) */
  partialCloseR?: number;
  reason: string;
}

export interface BacktestTrade {
  barIndex: number;
  side: "buy" | "sell";
  engine: ActiveEngine;
  entryPrice: number;
  exitPrice: number;
  stopLoss: number;
  takeProfit: number;
  pnlPct: number;
  pnlR: number;
  exitReason: "sl" | "tp" | "trail" | "holdBars";
  commissionPct: number;
}

export interface ProSniperBacktestResult {
  totalPnlPct: number;
  netProfitPct: number;
  winRatePct: number;
  profitFactor: number;
  avgRR: number;
  maxDrawdownPct: number;
  sharpeRatio: number;
  totalTrades: number;
  wins: number;
  losses: number;
  longTrades: number;
  shortTrades: number;
  longWinRate: number;
  shortWinRate: number;
  monthlyPnl: { month: string; pnlPct: number }[];
  equityCurve: number[];
  tradeLog: BacktestTrade[];
  marketModeBreakdown: { mode: MarketMode; trades: number; winRate: number; pnlPct: number }[];
}
