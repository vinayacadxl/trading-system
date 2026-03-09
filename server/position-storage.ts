import { db } from './db';
import { trades, dailyStats, activePositions, type Trade, type DailyStats, type ActivePosition } from '@shared/schema';
import { eq, sql, and, desc } from 'drizzle-orm';

/**
 * Persistent Position Tracking (PostgreSQL)
 * Saves trade data and active position metadata to DB.
 * Falls back to in-memory mode when DB is unavailable.
 */

function todayKey(): string {
    return new Date().toISOString().slice(0, 10);
}

/** Helper: check if DB is available */
function isDbAvailable(): boolean {
    return db != null;
}

// === IN-MEMORY FALLBACK STATE ===
let memDailyPnl = 0;
let memTradeCount = 0;
let memConsecutiveLosses = 0;
const memActivePositions: Map<string, { symbol: string; productId: number; side: string; entryPrice: number; entryTime: Date }> = new Map();
const memTradeHistory: Trade[] = []; // In-memory buffer for recent trades
const MAX_MEM_TRADES = 100;

export interface EntryContext {
    side: 'buy' | 'sell';
    entryPrice: number;
    entryTime: number;
    regime?: string;
    confidence?: number;
    rsi?: number;
    adx?: number;
    volume_ratio?: number;
    indicators?: Record<string, any>;
}

export interface TradeOutcome {
    symbol: string;
    side: 'buy' | 'sell';
    entryPrice: number;
    exitPrice: number;
    pnlUsd: number;
    entryTime: number;
    exitTime: number;
    exitReason: 'tp' | 'sl' | 'time' | 'other';
    context?: EntryContext;
}

// --- Active Positions (Survive Restarts) ---

/** Set entry time and metadata for a position */
export async function setPositionEntryTime(symbol: string, productId: number, timestamp: number, side: 'buy' | 'sell', entryPrice: number): Promise<void> {
    const entryTime = new Date(timestamp);
    const key = `${symbol}-${productId}`;
    memActivePositions.set(key, { symbol, productId, side, entryPrice, entryTime });
    if (!isDbAvailable()) return;
    try {
        await db.insert(activePositions).values({
            symbol, productId, side, entryPrice, entryTime,
        }).onConflictDoUpdate({
            target: [activePositions.symbol, activePositions.productId],
            set: { entryTime, entryPrice, side }
        });
    } catch (e) { /* DB unavailable, mem fallback used */ }
}

/** Get entry time (ms) for a position */
export async function getPositionEntryTime(symbol: string, productId: number): Promise<number | null> {
    if (!isDbAvailable()) {
        const mem = memActivePositions.get(`${symbol}-${productId}`);
        return mem ? mem.entryTime.getTime() : null;
    }
    try {
        const [pos] = await db.select().from(activePositions)
            .where(and(eq(activePositions.symbol, symbol), eq(activePositions.productId, productId)));
        return pos ? pos.entryTime.getTime() : null;
    } catch { return null; }
}

/** Remove active position metadata (on close) */
export async function removePositionEntryTime(symbol: string, productId: number): Promise<void> {
    memActivePositions.delete(`${symbol}-${productId}`);
    if (!isDbAvailable()) return;
    try {
        await db.delete(activePositions)
            .where(and(eq(activePositions.symbol, symbol), eq(activePositions.productId, productId)));
    } catch { }
}

/** Set highest PNL for trailing stop */
export async function setHighestPnl(symbol: string, productId: number, pnl: number): Promise<void> {
    if (!isDbAvailable()) return;
    try {
        await db.update(activePositions).set({ highestPnl: pnl })
            .where(and(eq(activePositions.symbol, symbol), eq(activePositions.productId, productId)));
    } catch { }
}

export async function getHighestPnl(symbol: string, productId: number): Promise<number | null> {
    if (!isDbAvailable()) return null;
    try {
        const [pos] = await db.select().from(activePositions)
            .where(and(eq(activePositions.symbol, symbol), eq(activePositions.productId, productId)));
        return pos?.highestPnl ?? null;
    } catch { return null; }
}

export async function removeHighestPnl(symbol: string, productId: number): Promise<void> {
    if (!isDbAvailable()) return;
    try {
        await db.update(activePositions).set({ highestPnl: 0 })
            .where(and(eq(activePositions.symbol, symbol), eq(activePositions.productId, productId)));
    } catch { }
}

/** Update partial TP status */
export async function setPartialClose(symbol: string, productId: number): Promise<void> {
    if (!isDbAvailable()) return;
    try {
        await db.update(activePositions).set({ hasPartialClose: true })
            .where(and(eq(activePositions.symbol, symbol), eq(activePositions.productId, productId)));
    } catch { }
}

export async function hasPartialClose(symbol: string, productId: number): Promise<boolean> {
    if (!isDbAvailable()) return false;
    try {
        const [pos] = await db.select().from(activePositions)
            .where(and(eq(activePositions.symbol, symbol), eq(activePositions.productId, productId)));
        return !!pos?.hasPartialClose;
    } catch { return false; }
}

export async function removePartialClose(symbol: string, productId: number): Promise<void> {
    if (!isDbAvailable()) return;
    try {
        await db.update(activePositions).set({ hasPartialClose: false })
            .where(and(eq(activePositions.symbol, symbol), eq(activePositions.productId, productId)));
    } catch { }
}

/** Get all active positions stored in DB (for reconciling externally closed positions) */
export async function getStoredActivePositions(): Promise<Array<{ symbol: string; productId: number; side: string; entryPrice: number; entryTime: Date }>> {
    if (!isDbAvailable()) return Array.from(memActivePositions.values());
    try {
        return await db.select({
            symbol: activePositions.symbol,
            productId: activePositions.productId,
            side: activePositions.side,
            entryPrice: activePositions.entryPrice,
            entryTime: activePositions.entryTime,
        }).from(activePositions);
    } catch { return Array.from(memActivePositions.values()); }
}

/** Cleanup positions that are no longer reported by Delta */
export async function cleanupOldEntries(activeKeys: string[]): Promise<void> {
    if (!isDbAvailable()) return;
    try {
        const all = await db.select().from(activePositions);
        for (const pos of all) {
            const key = `${pos.symbol}-${pos.productId}`;
            if (!activeKeys.includes(key)) await removePositionEntryTime(pos.symbol, pos.productId);
        }
    } catch { }
}

// --- Trade Outcomes & Performance ---

/** Record a closed trade result and update daily stats */
export async function recordTradeResult(pnl: number): Promise<void> {
    // Update in-memory fallback
    memDailyPnl += pnl;
    if (pnl < 0) memConsecutiveLosses++; else memConsecutiveLosses = 0;
    if (!isDbAvailable()) return;
    try {
        const today = todayKey();
        const [current] = await db.select().from(dailyStats).where(eq(dailyStats.date, today));
        if (current) {
            await db.update(dailyStats)
                .set({ totalPnlUsd: current.totalPnlUsd + pnl, consecutiveLosses: pnl < 0 ? current.consecutiveLosses + 1 : 0 })
                .where(eq(dailyStats.date, today));
        } else {
            await db.insert(dailyStats).values({ date: today, totalPnlUsd: pnl, consecutiveLosses: pnl < 0 ? 1 : 0 });
        }
    } catch { /* use in-memory */ }
}

export async function getDailyPnl(): Promise<number> {
    if (!isDbAvailable()) return memDailyPnl;
    try {
        const today = todayKey();
        const [stats] = await db.select().from(dailyStats).where(eq(dailyStats.date, today));
        return stats?.totalPnlUsd ?? 0;
    } catch { return memDailyPnl; }
}

export async function getConsecutiveLosses(): Promise<number> {
    if (!isDbAvailable()) return memConsecutiveLosses;
    try {
        const today = todayKey();
        const [stats] = await db.select().from(dailyStats).where(eq(dailyStats.date, today));
        return stats?.consecutiveLosses ?? 0;
    } catch { return memConsecutiveLosses; }
}

export async function getDailyTradeCount(): Promise<number> {
    if (!isDbAvailable()) return memTradeCount;
    try {
        const today = todayKey();
        const [stats] = await db.select().from(dailyStats).where(eq(dailyStats.date, today));
        return stats?.tradeCount ?? 0;
    } catch { return memTradeCount; }
}

export async function incrementDailyTradeCount(): Promise<void> {
    memTradeCount++;
    if (!isDbAvailable()) return;
    try {
        const today = todayKey();
        await db.insert(dailyStats).values({ date: today, tradeCount: 1 })
            .onConflictDoUpdate({ target: [dailyStats.date], set: { tradeCount: sql`trade_count + 1` } });
    } catch { }
}

/** Record full trade details for analysis / Python AI */
export async function appendTradeOutcome(outcome: TradeOutcome): Promise<void> {
    // Save to memory buffer first
    const memTrade: any = {
        id: Math.random().toString(36).substring(7),
        symbol: outcome.symbol,
        side: outcome.side,
        entryPrice: outcome.entryPrice,
        exitPrice: outcome.exitPrice,
        pnlUsd: outcome.pnlUsd,
        entryTime: new Date(outcome.entryTime),
        exitTime: new Date(outcome.exitTime),
        exitReason: outcome.exitReason,
        context: outcome.context || null
    };

    memTradeHistory.unshift(memTrade);
    if (memTradeHistory.length > MAX_MEM_TRADES) memTradeHistory.pop();

    if (!isDbAvailable()) return;
    try {
        await db.insert(trades).values({
            symbol: outcome.symbol, side: outcome.side,
            entryPrice: outcome.entryPrice, exitPrice: outcome.exitPrice,
            pnlUsd: outcome.pnlUsd, entryTime: new Date(outcome.entryTime),
            exitTime: new Date(outcome.exitTime), exitReason: outcome.exitReason,
            context: outcome.context as any
        });
    } catch { }
}

/** Last trade exit time (ms) */
export async function getLastTradeTime(): Promise<number | null> {
    if (!isDbAvailable()) return null;
    try {
        const [last] = await db.select().from(trades).orderBy(desc(trades.exitTime)).limit(1);
        return last ? last.exitTime.getTime() : null;
    } catch { return null; }
}

// --- Entry Context Tracking (Signals) ---

export async function saveEntryContext(symbol: string, context: EntryContext): Promise<void> {
    // We can use a dedicated table or JSON column in active_positions
    // For now, mapping to active_positions metadata if needed, or keeping it separate.
    // Actually, appending to 'signals' table is better for a complete history.
}

export async function loadEntryContext(symbol: string): Promise<EntryContext | null> {
    // For simplicity, we could store this in a 'signals' table and fetch latest for symbol
    return null;
}

export async function clearEntryContext(symbol: string): Promise<void> {
    // No-op for now as we prefer to keep signal history
}

/** Get recent closed trades for history UI */
export async function getRecentTrades(limit = 100): Promise<Trade[]> {
    if (!isDbAvailable()) {
        return memTradeHistory.slice(0, limit) as Trade[];
    }
    try {
        return await db.select()
            .from(trades)
            .orderBy(desc(trades.exitTime))
            .limit(limit);
    } catch {
        return memTradeHistory.slice(0, limit) as Trade[];
    }
}
