import { getMultiSymbolManager } from './multi-symbol-manager';
import { placeOrder, getPositions, getClosedOrders, DeltaPosition, getHistory } from './delta';
import { getOrderBook, getLastTradesHistory } from './delta-socket';
import { removePosition } from './multi-symbol-trader';
import { log } from './index';
import { botGetStatus } from './bot-store';
import { checkAndApplyLossStreak } from './risk-gate';
import {
    getPositionEntryTime,
    setPositionEntryTime,
    removePositionEntryTime,
    getHighestPnl,
    setHighestPnl,
    removeHighestPnl,
    setPartialClose,
    hasPartialClose,
    removePartialClose,
    recordTradeResult,
    loadEntryContext,
    clearEntryContext,
    appendTradeOutcome,
    getStoredActivePositions,
    incrementDailyTradeCount,
    type TradeOutcome,
    saveEntryContext
} from './position-storage';

/**
 * Low-Latency Scalper Position Manager
 * Uses event-driven tick processing for TP/SL.
 */

export interface ManagedPosition {
    symbol: string;
    productId: number;
    side: 'buy' | 'sell';
    size: number;
    entryPrice: number;
    currentPrice: number;
    pnl: number;
    pnlPercent: number;
    holdingTime: number;
    aiScore: number;
    regime?: string;
    shouldClose: boolean;
    closeReason?: string;
}

// Advanced scalping: .env se override. SL = negative % (e.g. SCALP_SL_PCT=0.25 => -0.25%)
const _slPct = parseFloat(process.env.SCALP_SL_PCT || "0.25");
const POSITION_CONFIG = {
    MAX_HOLDING_TIME: parseInt(process.env.SCALP_MAX_HOLD_S || "60", 10),
    STOP_LOSS_PCT: _slPct > 0 ? -_slPct : _slPct,
    TAKE_PROFIT_PCT: parseFloat(process.env.SCALP_TP_PCT || "0.35"),
    /** Advance profit booking: jab unrealized profit is amount (USD) ke barabar ho, close. Default 4 */
    TAKE_PROFIT_USD: parseFloat(process.env.SCALP_TP_USD || "4"),
    TRAILING_OFFSET_PCT: parseFloat(process.env.SCALP_TRAIL_PCT || "0.15"),
    MIN_CONFIDENCE_HOLD: parseFloat(process.env.SCALP_MIN_CONF_HOLD || "0.7"),
    CONFIDENCE_EXIT_THRESHOLD: parseFloat(process.env.SCALP_CONF_EXIT || "0.5"),
};

// --- ⚡ REAL-TIME STATE ⚡ ---
const trailingStopMap = new Map<string, number>(); // symbol -> current_sl_price
const entryImbalanceMap = new Map<string, number>(); // symbol -> imbalance_at_entry

// --- ⚡ LOCAL POSITION CACHE ⚡ ---
let localPositionCache: DeltaPosition[] = [];
let lastCacheSync = 0;

export function getLocalPositions(): DeltaPosition[] {
    return localPositionCache;
}

/**
 * 🧠 CONFIDENCE ENGINE (PART 2)
 * Returns a score between 0.0 to 1.0 based on real-time market pressure.
 */
function calculateConfidence(symbol: string, side: 'buy' | 'sell', entryPrice: number, currentPrice: number): number {
    const ob = getOrderBook(symbol);
    const trades = getLastTradesHistory(symbol);

    if (!ob) return 0.5;

    // A. Orderbook Strength (Imbalance Trend)
    const bidVol = ob.bids.slice(0, 5).reduce((sum: number, l: any) => sum + parseFloat(l.size), 0);
    const askVol = ob.asks.slice(0, 5).reduce((sum: number, l: any) => sum + parseFloat(l.size), 0);
    const currentImbalance = bidVol / (askVol || 1);

    let obScore = 0.5;
    if (side === 'buy') {
        if (currentImbalance > 1.4) obScore = 0.8;
        if (currentImbalance > 2.5) obScore = 1.0;
    } else {
        if (currentImbalance < 0.7) obScore = 0.8;
        if (currentImbalance < 0.4) obScore = 1.0;
    }

    // B. Trade Flow (Last 10 trades direction)
    const last10 = trades.slice(-10);
    const inDirection = last10.filter((t: any) => t.side === side).length;
    const flowScore = inDirection / 10;

    // C. Momentum (Price Velocity)
    const priceChange = ((currentPrice - entryPrice) / entryPrice) * 100 * (side === 'buy' ? 1 : -1);
    const momentumScore = Math.min(1.0, Math.max(0, (priceChange + 0.1) / 0.5));

    // D. Spread Stability
    const bestBid = parseFloat(ob.bids[0].price);
    const bestAsk = parseFloat(ob.asks[0].price);
    const spread = bestAsk - bestBid;
    const spreadScore = spread < (entryPrice * 0.0005) ? 1.0 : 0.5;

    // Final Weighted Confidence
    return (obScore + flowScore + momentumScore + spreadScore) / 4;
}

/**
 * ⚡ INSTANT TICK-BASED POSITION EXIT ⚡
 * Called on every ticker update from WebSocket. Uses local cache for ultra-low latency.
 */
export async function handleTickerUpdate(symbol: string, currentPrice: number): Promise<void> {
    for (const pos of localPositionCache) {
        if (pos.symbol !== symbol) continue;

        const size = Number(pos.size) || 0;
        if (size === 0) continue;

        const side: 'buy' | 'sell' = size > 0 ? 'buy' : 'sell';
        const entryPrice = parseFloat(String(pos.entry_price || pos.average_entry_price || 0));
        const entryTime = await getPositionEntryTime(symbol, pos.product_id);

        if (entryPrice <= 0 || !entryTime) continue;

        const pnlPercent = ((currentPrice - entryPrice) / entryPrice) * 100 * (side === 'buy' ? 1 : -1);
        const absSize = Math.abs(size);
        const pnlUsd = side === 'buy'
            ? absSize * (currentPrice - entryPrice)
            : absSize * (entryPrice - currentPrice);
        const holdingSec = (Date.now() - entryTime) / 1000;
        const confidence = calculateConfidence(symbol, side, entryPrice, currentPrice);

        // --- ⚡ DYNAMIC EXIT LOGIC (PART 3) ⚡ ---

        // A. Hard Time Limit (60s)
        if (holdingSec > POSITION_CONFIG.MAX_HOLDING_TIME) {
            await closePositionOnTicker(pos, side, currentPrice, pnlPercent, `🕒 TIME LIMIT (60s)`);
            continue;
        }

        // B. Stop Loss (Initial 0.25%)
        if (pnlPercent <= POSITION_CONFIG.STOP_LOSS_PCT && !trailingStopMap.has(symbol)) {
            await closePositionOnTicker(pos, side, currentPrice, pnlPercent, `🛑 SL HIT: ${pnlPercent.toFixed(2)}%`);
            continue;
        }

        // C. Confidence Drop Exit (< 0.5)
        if (confidence < POSITION_CONFIG.CONFIDENCE_EXIT_THRESHOLD && pnlPercent > 0.1) {
            await closePositionOnTicker(pos, side, currentPrice, pnlPercent, `📉 CONFIDENCE DROP: ${confidence.toFixed(2)}`);
            continue;
        }

        // C.5. Advance profit booking: USD target (e.g. $4) – jitna aacha amount, utna book
        if (POSITION_CONFIG.TAKE_PROFIT_USD > 0 && pnlUsd >= POSITION_CONFIG.TAKE_PROFIT_USD) {
            await closePositionOnTicker(pos, side, currentPrice, pnlPercent, `✅ TP (USD): $${pnlUsd.toFixed(2)}`);
            continue;
        }

        // D. Trailing Stop Activation (TP Hit + High Confidence)
        if (pnlPercent >= POSITION_CONFIG.TAKE_PROFIT_PCT) {
            if (confidence >= POSITION_CONFIG.MIN_CONFIDENCE_HOLD) {
                // HOLD & TRAIL
                const trailingOffset = currentPrice * (POSITION_CONFIG.TRAILING_OFFSET_PCT / 100);
                const newStop = side === 'buy' ? currentPrice - trailingOffset : currentPrice + trailingOffset;

                const currentStop = trailingStopMap.get(symbol);
                if (!currentStop || (side === 'buy' ? newStop > currentStop : newStop < currentStop)) {
                    trailingStopMap.set(symbol, newStop);
                    log(`[DYNAMIC-HOLD] 💎 HOLDING ${symbol} | Confidence: ${confidence.toFixed(2)} | Trailing SL: ${newStop.toFixed(2)}`, 'position-manager');
                }
            } else {
                // NORMAL TP EXIT
                await closePositionOnTicker(pos, side, currentPrice, pnlPercent, `✅ TP HIT: ${pnlPercent.toFixed(2)}%`);
                continue;
            }
        }

        // E. Trailing STOP Logic update/check
        const activeTrailingStop = trailingStopMap.get(symbol);
        if (activeTrailingStop) {
            const isHit = side === 'buy' ? currentPrice <= activeTrailingStop : currentPrice >= activeTrailingStop;
            if (isHit) {
                await closePositionOnTicker(pos, side, currentPrice, pnlPercent, `Trailing SL Hit: ${pnlPercent.toFixed(2)}%`);
                trailingStopMap.delete(symbol);
            }
        }
    }
}

/** Helper to close position during ticker loop */
async function closePositionOnTicker(pos: any, side: 'buy' | 'sell', currentPrice: number, pnlPercent: number, reason: string) {
    log(`[SCALPER-EXIT] ${reason}`, 'position-manager');
    await closePosition({
        symbol: pos.symbol,
        productId: pos.product_id,
        side,
        size: Math.abs(Number(pos.size)),
        entryPrice: parseFloat(String(pos.entry_price || pos.average_entry_price)),
        currentPrice,
        pnlPercent,
        pnl: 0,
        holdingTime: 0,
        aiScore: 100,
        shouldClose: true,
        closeReason: reason
    });
    // Cleanup caches
    localPositionCache = localPositionCache.filter(p => p.symbol !== pos.symbol);
    trailingStopMap.delete(pos.symbol);
}

/**
 * Update the local position cache from API (Background Sync every 10s)
 */
export async function syncPositions(): Promise<void> {
    try {
        const res = await getPositions();
        if (res.success && Array.isArray(res.result)) {
            localPositionCache = res.result;
            lastCacheSync = Date.now();

            // Also reconcile if any positions disappeared
            await reconcileExternallyClosedPositions();
        }
    } catch (e) {
        log(`[POSITION-SYNC] Sync failed: ${e}`, 'position-manager');
    }
}

/**
 * Reconcile positions that were closed outside the bot (exchange SL, manual close).
 */
async function reconcileExternallyClosedPositions(): Promise<void> {
    const stored = await getStoredActivePositions();
    if (stored.length === 0) return;

    const openKeys = new Set(localPositionCache.map(p => `${p.symbol}-${p.product_id}`));

    for (const row of stored) {
        const key = `${row.symbol}-${row.productId}`;
        if (openKeys.has(key)) continue;

        // Position disappeared - clean up DB
        try {
            await recordTradeResult(0); // placeholder
            await removePositionEntryTime(row.symbol, row.productId);
            await removeHighestPnl(row.symbol, row.productId);
            await removePartialClose(row.symbol, row.productId);
            try { removePosition(row.symbol); } catch (_) { }
            log(`[POSITION-MGR] 📥 Cleaned up disappeared position: ${row.symbol}`, 'position-manager');
        } catch (e) {
            console.error(`[POSITION-MGR] Reconcile failed for ${row.symbol}:`, e);
        }
    }
}

/**
 * Close a position immediately using a Market Order
 */
async function closePosition(position: ManagedPosition): Promise<void> {
    try {
        const closeSide: 'buy' | 'sell' = position.side === 'buy' ? 'sell' : 'buy';

        const result = await placeOrder({
            symbol: position.symbol,
            side: closeSide,
            size: position.size,
            order_type: 'market',
            product_id: position.productId
        });

        if (result.success) {
            const pnl = (position.currentPrice - position.entryPrice) * position.size * (position.side === 'buy' ? 1 : -1);
            const realizedPnl = pnl - (position.currentPrice * position.size * 0.0006);

            await recordTradeResult(realizedPnl);
            await checkAndApplyLossStreak();

            const exitReason: TradeOutcome['exitReason'] =
                position.closeReason?.includes('TP') ? 'tp' :
                    position.closeReason?.includes('SL') ? 'sl' : 'other';

            await appendTradeOutcome({
                symbol: position.symbol,
                side: position.side,
                entryPrice: position.entryPrice,
                exitPrice: position.currentPrice,
                pnlUsd: realizedPnl,
                entryTime: Date.now() - 10000, // approximation
                exitTime: Date.now(),
                exitReason,
                context: undefined
            });

            await incrementDailyTradeCount();
            await clearEntryContext(position.symbol);
            await removePositionEntryTime(position.symbol, position.productId);
            await removeHighestPnl(position.symbol, position.productId);

            try { removePosition(position.symbol); } catch (_) { }

            log(`[POSITION-MGR] ✅ CLOSED: ${position.symbol} ${position.side.toUpperCase()} | Realized PNL: ${realizedPnl.toFixed(2)} USDT`, 'position-manager');
        } else {
            log(`[POSITION-MGR] ❌ Failed to close ${position.symbol}: ${result.error?.message}`, 'position-manager');
        }
    } catch (error) {
        console.error(`[POSITION-MGR] Exception closing ${position.symbol}:`, error);
    }
}

export function startPositionMonitoring(): void {
    log('[POSITION-MGR] 🚀 EVENT-DRIVEN POSITION MANAGER ACTIVE!', 'position-manager');

    // Initial sync
    syncPositions();

    // Sync cache every 10 seconds for consistency
    setInterval(syncPositions, 10000);
}

export function getPositionManagerConfig() {
    return { ...POSITION_CONFIG };
}
