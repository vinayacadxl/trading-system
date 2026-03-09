/**
 * Engine Status Broadcaster
 * Collects live engine metrics and broadcasts via Socket.IO to frontend.
 * Runs every 2 seconds to push real-time engine state.
 */

import type { Server as SocketIOServer } from "socket.io";
import { getMultiSymbolManager } from "./multi-symbol-manager";

// Simple flag set by index.ts when delta socket connects
let _wsConnected = false;
export function setWsConnected(v: boolean) { _wsConnected = v; }

export interface EngineStatusPayload {
    // Scalping Engine
    symbol: string;
    imbalance: number;
    spread: string;
    tradeFlow: "BUY Dominant" | "SELL Dominant" | "Balanced";
    entrySignal: boolean;
    cooldown: boolean;
    activeTrades: number;
    maxTrades: number;
    lastPrice: number;

    // Confidence Engine
    confidence: number;        // 0.0–1.0
    orderbookStrength: "Strong" | "Moderate" | "Weak";
    momentum: "HIGH" | "MEDIUM" | "LOW";
    spreadStable: boolean;

    // Dynamic Exit
    dynamicExitActive: boolean;
    tpRemoved: boolean;
    trailingSL: boolean;
    slTrailPct: number;
    holdTimeSec: number;
    maxHoldSec: number;

    // Multi Symbol
    symbolScan: {
        symbol: string;
        status: "ENTRY_SIGNAL" | "NO_SIGNAL" | "COOLING_DOWN" | "TRADABLE" | "SPREAD_HIGH" | "IN_POSITION";
        direction?: "buy" | "sell";
        strength?: number;
        confidence?: number;
        lastPrice?: number;
        change24h?: number;
    }[];

    /** Why trade was not executed (so user sees reason when ENTRY SIGNAL but no trade) */
    noTradeReason: string;

    wsConnected: boolean;
    updatedAt: number;
}

// In-memory engine state that strategy-engine.ts and position-manager.ts can mutate
const engineState: Partial<EngineStatusPayload> = {
    symbol: "BTCUSD",
    imbalance: 1.0,
    spread: "OK",
    tradeFlow: "Balanced",
    entrySignal: false,
    cooldown: false,
    activeTrades: 0,
    maxTrades: 2,
    lastPrice: 0,
    confidence: 0,
    orderbookStrength: "Moderate",
    momentum: "MEDIUM",
    spreadStable: true,
    dynamicExitActive: false,
    tpRemoved: false,
    trailingSL: false,
    slTrailPct: 0.15,
    holdTimeSec: 0,
    maxHoldSec: 60,
    symbolScan: [],
    noTradeReason: "",
};

/**
 * Merge partial updates from any engine module into the shared state.
 * Call this from strategy-engine.ts, position-manager.ts, etc.
 */
export function updateEngineState(updates: Partial<EngineStatusPayload>): void {
    Object.assign(engineState, updates);
}

export function getEngineState(): Partial<EngineStatusPayload> {
    return engineState;
}

/**
 * Build payload from engine state + live multi-symbol signals
 */
function buildPayload(): EngineStatusPayload {
    const manager = getMultiSymbolManager();
    const allSignals = manager.getAllSignals();
    const activePositions = new Set(manager.getActivePositions());

    const symbolScan = allSignals.map((sig) => {
        let status: EngineStatusPayload["symbolScan"][number]["status"] = "NO_SIGNAL";

        if (activePositions.has(sig.symbol)) {
            status = "IN_POSITION";
        } else if (sig.direction !== "neutral" && sig.signalStrength >= 45) {
            status = "ENTRY_SIGNAL";
        } else if (sig.direction !== "neutral" && sig.signalStrength >= 30) {
            status = "TRADABLE";
        } else {
            status = "NO_SIGNAL";
        }

        return {
            symbol: sig.symbol,
            status,
            direction: sig.direction === "neutral" ? undefined : sig.direction,
            strength: sig.signalStrength,
            confidence: Math.round(sig.confidence * 100),
            lastPrice: sig.lastPrice,
            change24h: sig.change24h,
        };
    });

    return {
        symbol: engineState.symbol ?? "BTCUSD",
        imbalance: engineState.imbalance ?? 1.0,
        spread: engineState.spread ?? "OK",
        tradeFlow: engineState.tradeFlow ?? "Balanced",
        entrySignal: engineState.entrySignal ?? false,
        cooldown: engineState.cooldown ?? false,
        activeTrades: activePositions.size,
        maxTrades: manager.getConfig().maxConcurrentPositions,
        lastPrice: engineState.lastPrice ?? 0,
        confidence: engineState.confidence ?? 0,
        orderbookStrength: engineState.orderbookStrength ?? "Moderate",
        momentum: engineState.momentum ?? "MEDIUM",
        spreadStable: engineState.spreadStable ?? true,
        dynamicExitActive: engineState.dynamicExitActive ?? false,
        tpRemoved: engineState.tpRemoved ?? false,
        trailingSL: engineState.trailingSL ?? false,
        slTrailPct: engineState.slTrailPct ?? 0.15,
        holdTimeSec: engineState.holdTimeSec ?? 0,
        maxHoldSec: engineState.maxHoldSec ?? 60,
        symbolScan,
        noTradeReason: engineState.noTradeReason ?? "",
        wsConnected: _wsConnected,
        updatedAt: Date.now(),
    };
}

/**
 * Start broadcasting engine_status events every 2 seconds.
 * Call this from index.ts after Socket.IO server is created.
 */
export function startEngineStatusBroadcast(io: SocketIOServer): void {
    const broadcast = () => {
        try {
            const payload = buildPayload();
            io.emit("engine_status", payload);
        } catch (e) {
            // Silent – don't crash the main process
        }
    };

    // Broadcast immediately + every 2 seconds
    broadcast();
    setInterval(broadcast, 2000);
}
