import { type Trade, type DailyStats, type ActivePosition } from '@shared/schema';

/**
 * High-Performance Local-Memory Storage
 * Database has been disabled as per user request.
 * All state is now handled in-memory for zero-latency execution.
 */

function todayKey(): string {
    return new Date().toISOString().slice(0, 10);
}

// === IN-MEMORY STATE ===
let memDailyPnl = 0;
let memTradeCount = 0;
let memConsecutiveLosses = 0;
let lastUpdateDate = todayKey();

const memActivePositions: Map<string, { symbol: string; productId: number; side: string; entryPrice: number; entryTime: Date; highestPnl?: number; hasPartialClose?: boolean }> = new Map();
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

/** Reset daily stats if the date has changed */
function checkDayReset() {
    const today = todayKey();
    if (lastUpdateDate !== today) {
        memDailyPnl = 0;
        memTradeCount = 0;
        memConsecutiveLosses = 0;
        lastUpdateDate = today;
    }
}

// --- Active Positions ---

/** Set entry time and metadata for a position */
export async function setPositionEntryTime(symbol: string, productId: number, timestamp: number, side: 'buy' | 'sell', entryPrice: number): Promise<void> {
    const entryTime = new Date(timestamp);
    const key = `${symbol}-${productId}`;
    memActivePositions.set(key, { symbol, productId, side, entryPrice, entryTime });
}

/** Get entry time (ms) for a position */
export async function getPositionEntryTime(symbol: string, productId: number): Promise<number | null> {
    const mem = memActivePositions.get(`${symbol}-${productId}`);
    return mem ? mem.entryTime.getTime() : null;
}

/** Remove active position metadata (on close) */
export async function removePositionEntryTime(symbol: string, productId: number): Promise<void> {
    memActivePositions.delete(`${symbol}-${productId}`);
}

/** Set highest PNL for trailing stop */
export async function setHighestPnl(symbol: string, productId: number, pnl: number): Promise<void> {
    const key = `${symbol}-${productId}`;
    const pos = memActivePositions.get(key);
    if (pos) {
        pos.highestPnl = pnl;
    }
}

export async function getHighestPnl(symbol: string, productId: number): Promise<number | null> {
    const key = `${symbol}-${productId}`;
    const pos = memActivePositions.get(key);
    return pos?.highestPnl ?? null;
}

export async function removeHighestPnl(symbol: string, productId: number): Promise<void> {
    const key = `${symbol}-${productId}`;
    const pos = memActivePositions.get(key);
    if (pos) {
        delete pos.highestPnl;
    }
}

/** Update partial TP status */
export async function setPartialClose(symbol: string, productId: number): Promise<void> {
    const key = `${symbol}-${productId}`;
    const pos = memActivePositions.get(key);
    if (pos) {
        pos.hasPartialClose = true;
    }
}

export async function hasPartialClose(symbol: string, productId: number): Promise<boolean> {
    const key = `${symbol}-${productId}`;
    const pos = memActivePositions.get(key);
    return !!pos?.hasPartialClose;
}

export async function removePartialClose(symbol: string, productId: number): Promise<void> {
    const key = `${symbol}-${productId}`;
    const pos = memActivePositions.get(key);
    if (pos) {
        pos.hasPartialClose = false;
    }
}

/** Get all active positions stored (for reconciling externally closed positions) */
export async function getStoredActivePositions(): Promise<Array<{ symbol: string; productId: number; side: string; entryPrice: number; entryTime: Date }>> {
    return Array.from(memActivePositions.values()) as any;
}

/** Cleanup positions that are no longer reported by Delta */
export async function cleanupOldEntries(activeKeys: string[]): Promise<void> {
    const keysToDelete: string[] = [];
    for (const key of memActivePositions.keys()) {
        if (!activeKeys.includes(key)) {
            keysToDelete.push(key);
        }
    }
    for (const key of keysToDelete) {
        memActivePositions.delete(key);
    }
}

// --- Trade Outcomes & Performance ---

/** Record a closed trade result and update daily stats */
export async function recordTradeResult(pnl: number): Promise<void> {
    checkDayReset();
    memDailyPnl += pnl;
    if (pnl < 0) memConsecutiveLosses++; else memConsecutiveLosses = 0;
}

export async function getDailyPnl(): Promise<number> {
    checkDayReset();
    return memDailyPnl;
}

export async function getConsecutiveLosses(): Promise<number> {
    checkDayReset();
    return memConsecutiveLosses;
}

export async function getDailyTradeCount(): Promise<number> {
    checkDayReset();
    return memTradeCount;
}

export async function incrementDailyTradeCount(): Promise<void> {
    checkDayReset();
    memTradeCount++;
}

/** Record full trade details for analysis / Python AI */
export async function appendTradeOutcome(outcome: TradeOutcome): Promise<void> {
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
}

/** Last trade exit time (ms) */
export async function getLastTradeTime(): Promise<number | null> {
    if (memTradeHistory.length === 0) return null;
    return memTradeHistory[0].exitTime.getTime();
}

// --- Entry Context Tracking (Signals) ---

export async function saveEntryContext(symbol: string, context: EntryContext): Promise<void> {
    // No-op for now
}

export async function loadEntryContext(symbol: string): Promise<EntryContext | null> {
    return null;
}

export async function clearEntryContext(symbol: string): Promise<void> {
    // No-op
}

/** Get recent closed trades for history UI */
export async function getRecentTrades(limit = 100): Promise<Trade[]> {
    return memTradeHistory.slice(0, limit) as Trade[];
}

