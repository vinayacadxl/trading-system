/**
 * Institutional-style risk gate: daily drawdown limit and consecutive-loss rule.
 * Used by multi-symbol-trader and any other execution path before opening trades.
 */

import { getDailyPnl, getConsecutiveLosses } from './position-storage';

const CONSECUTIVE_LOSS_LIMIT = parseInt(process.env.RISK_CONSECUTIVE_LOSS_LIMIT || '3', 10);
/** When consecutive losses >= this, we reduce position size (e.g. 0.5% risk instead of 5%). */
const SIZE_MULTIPLIER_AFTER_CONSECUTIVE_LOSSES = parseFloat(process.env.RISK_SIZE_MULTIPLIER_AFTER_LOSSES || '0.1');

/**
 * Returns true if we are allowed to open new trades from a daily drawdown perspective.
 * Uses bot config maxDailyLossPct (and optional maxDailyLossUsd) if available.
 */
export async function dailyDrawdownOk(balanceUsd: number): Promise<{ ok: boolean; dailyPnl: number; reason?: string }> {
  const dailyPnl = await getDailyPnl();
  let maxLossUsd: number;
  const maxDailyLossUsdEnv = process.env.RISK_MAX_DAILY_LOSS_USD;
  if (maxDailyLossUsdEnv != null && maxDailyLossUsdEnv !== '') {
    const val = parseFloat(maxDailyLossUsdEnv);
    if (Number.isFinite(val)) maxLossUsd = Math.abs(val);
    else maxLossUsd = balanceUsd * 0.10;
  } else {
    const { botGetConfig } = require('./bot-store');
    const config = typeof botGetConfig === 'function' ? botGetConfig() : null;
    const pct = config?.maxDailyLossPct ?? 10;
    maxLossUsd = Math.abs(balanceUsd * (pct / 100));
  }
  if (dailyPnl <= -maxLossUsd) {
    return { ok: false, dailyPnl, reason: `Daily loss limit ($${dailyPnl.toFixed(2)} <= -$${maxLossUsd.toFixed(2)})` };
  }
  return { ok: true, dailyPnl };
}

/**
 * Returns size multiplier for position sizing when we have consecutive losses.
 * 1.0 = normal size; < 1.0 = reduced (e.g. 0.1 = 10% of normal ≈ 0.5% capital).
 */
export async function getConsecutiveLossSizeMultiplier(): Promise<number> {
  const n = await getConsecutiveLosses();
  if (n >= CONSECUTIVE_LOSS_LIMIT) return SIZE_MULTIPLIER_AFTER_CONSECUTIVE_LOSSES;
  return 1.0;
}

/** True if we have hit consecutive loss limit (used to log or pause). */
export async function isInConsecutiveLossMode(): Promise<boolean> {
  return (await getConsecutiveLosses()) >= CONSECUTIVE_LOSS_LIMIT;
}

/**
 * PRO SCALPER V3: Call this after every trade result is recorded.
 * If 3 consecutive losses just hit, triggers a hard 30-min no-trade pause.
 * Returns the pause-until timestamp (ms) if paused, null otherwise.
 */
export async function checkAndApplyLossStreak(): Promise<number | null> {
  const n = await getConsecutiveLosses();
  if (n >= CONSECUTIVE_LOSS_LIMIT && noTradeUntilTimestamp === null) {
    const pauseUntil = Date.now() + 30 * 60 * 1000; // 30 minutes
    setNoTradeUntil(pauseUntil);
    const resumeTime = new Date(pauseUntil).toLocaleTimeString();
    console.warn(`[RISK-GATE] 🚨 ${n} CONSECUTIVE LOSSES — Trading PAUSED until ${resumeTime} (30 min cooling-off)`);
    return pauseUntil;
  }
  // Auto-clear the pause if it has expired
  if (noTradeUntilTimestamp !== null && noTradeUntilTimestamp !== 0 && Date.now() > noTradeUntilTimestamp) {
    setNoTradeUntil(null);
    console.info(`[RISK-GATE] ✅ 30-min loss-streak pause ended. Trading RESUMED.`);
  }
  return null;
}

/** Optional news/event window: no new trades between these times (ISO strings). Set via env RISK_NO_TRADE_FROM / RISK_NO_TRADE_TO. */
function isInsideNoTradeWindow(): boolean {
  const fromStr = process.env.RISK_NO_TRADE_FROM;
  const toStr = process.env.RISK_NO_TRADE_TO;
  if (!fromStr || !toStr) return false;
  const from = Date.parse(fromStr);
  const to = Date.parse(toStr);
  if (Number.isNaN(from) || Number.isNaN(to)) return false;
  const now = Date.now();
  return now >= from && now <= to;
}

/** In-memory override: no new trades until this timestamp (e.g. set by kill-switch or event). */
let noTradeUntilTimestamp: number | null = null;

export function setNoTradeUntil(epochMs: number | null): void {
  noTradeUntilTimestamp = epochMs;
}

export function getNoTradeUntil(): number | null {
  return noTradeUntilTimestamp;
}

function isInsideNoTradeOverride(): boolean {
  if (noTradeUntilTimestamp == null) return false;
  if (noTradeUntilTimestamp === 0) return true; // 0 = halt indefinitely until cleared
  return Date.now() < noTradeUntilTimestamp;
}

/**
 * Combined check: can we open a new trade? (daily drawdown + news window + optional hard pause).
 * Does NOT include max positions or balance – caller still checks those.
 */
export async function canOpenNewTrade(balanceUsd: number): Promise<{ ok: boolean; reason?: string; dailyPnl?: number }> {
  if (isInsideNoTradeOverride()) {
    return { ok: false, reason: 'Trading halted (no-trade until or kill switch)' };
  }
  if (isInsideNoTradeWindow()) {
    return { ok: false, reason: 'Inside configured news/event window (RISK_NO_TRADE_FROM/TO)' };
  }
  const dd = await dailyDrawdownOk(balanceUsd);
  if (!dd.ok) return { ok: false, reason: dd.reason, dailyPnl: dd.dailyPnl };
  return { ok: true, dailyPnl: dd.dailyPnl };
}

// --- Correlation / max exposure (institutional-style) ---

/** Correlated buckets: don't open too many positions in same bucket (e.g. majors = BTC+ETH). */
const CORRELATED_BUCKETS: Record<string, string[]> = {
  majors: ['BTCUSD', 'ETHUSD', 'BTCUSDT', 'ETHUSDT'],
  // alts can be one bucket or separate; for now we only limit majors
};

const MAX_POSITIONS_PER_DIRECTION = parseInt(process.env.RISK_MAX_POSITIONS_PER_DIRECTION || '3', 10);
const MAX_POSITIONS_PER_BUCKET = parseInt(process.env.RISK_MAX_POSITIONS_PER_BUCKET || '2', 10);

export interface PositionForExposure {
  symbol: string;
  side: 'buy' | 'sell';
  size: number;
}

function getBucket(symbol: string): string | null {
  const sym = symbol.toUpperCase();
  for (const [bucket, symbols] of Object.entries(CORRELATED_BUCKETS)) {
    if (symbols.some(s => s.toUpperCase() === sym)) return bucket;
  }
  return null;
}

/**
 * Returns true if we are allowed to open this decision (symbol + side) given current positions.
 * Enforces: max N positions per direction (long/short), max 1 per correlated bucket (e.g. one long in majors).
 */
export function exposureOk(
  currentPositions: PositionForExposure[],
  newSymbol: string,
  newSide: 'buy' | 'sell'
): { ok: boolean; reason?: string } {
  const longs = currentPositions.filter(p => p.side === 'buy' && Math.abs(p.size) > 0);
  const shorts = currentPositions.filter(p => p.side === 'sell' && Math.abs(p.size) > 0);

  if (newSide === 'buy' && longs.length >= MAX_POSITIONS_PER_DIRECTION) {
    return { ok: false, reason: `Max longs (${MAX_POSITIONS_PER_DIRECTION}) reached` };
  }
  if (newSide === 'sell' && shorts.length >= MAX_POSITIONS_PER_DIRECTION) {
    return { ok: false, reason: `Max shorts (${MAX_POSITIONS_PER_DIRECTION}) reached` };
  }

  const bucket = getBucket(newSymbol);
  if (bucket) {
    const sameBucketSameSide = currentPositions.filter(p => {
      const b = getBucket(p.symbol);
      return b === bucket && p.side === newSide && Math.abs(p.size) > 0;
    });
    if (sameBucketSameSide.length >= MAX_POSITIONS_PER_BUCKET) {
      return { ok: false, reason: `Max positions in bucket "${bucket}" (${MAX_POSITIONS_PER_BUCKET}) reached` };
    }
  }

  return { ok: true };
}
