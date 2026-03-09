import { useEffect, useState } from "react";
import { io, type Socket } from "socket.io-client";

export interface ScalpingEngineData {
    symbol: string;
    imbalance: number;
    spread: string;
    tradeFlow: "BUY Dominant" | "SELL Dominant" | "Balanced";
    entrySignal: boolean;
    cooldown: boolean;
    activeTrades: number;
    maxTrades: number;
    lastPrice?: number;
    /** Why trade was not executed (when ENTRY SIGNAL but no trade) */
    noTradeReason?: string;
}

export interface ConfidenceData {
    score: number;          // 0.0 – 1.0
    orderbookStrength: "Strong" | "Moderate" | "Weak";
    tradeFlow: "BUY" | "SELL" | "NEUTRAL";
    spreadStable: boolean;
    momentum: "HIGH" | "MEDIUM" | "LOW";
}

export interface DynamicExitData {
    active: boolean;
    tpRemoved: boolean;
    trailingSL: boolean;
    slTrailPct: number;
    holdTimeSec: number;
    maxHoldSec: number;
}

export interface SymbolScanData {
    symbol: string;
    status: "ENTRY_SIGNAL" | "NO_SIGNAL" | "COOLING_DOWN" | "TRADABLE" | "SPREAD_HIGH" | "IN_POSITION";
    direction?: "buy" | "sell";
    strength?: number;
    confidence?: number;
    lastPrice?: number;
    change24h?: number;
}

export interface EngineStatus {
    scalpingEngine: ScalpingEngineData | null;
    confidence: ConfidenceData | null;
    dynamicExit: DynamicExitData | null;
    symbolScan: SymbolScanData[];
    wsConnected: boolean;
}

// Singleton socket so we don't open a new connection for each hook mount
let sharedSocket: Socket | null = null;
function getSharedSocket(): Socket {
    if (!sharedSocket || !sharedSocket.connected) {
        const origin = typeof window !== "undefined" ? window.location.origin : "";
        sharedSocket = io(origin, {
            path: "/socket.io/",
            transports: ["websocket", "polling"],
            autoConnect: true,
        });
    }
    return sharedSocket;
}

export function useEngineStatus(): EngineStatus {
    const [status, setStatus] = useState<EngineStatus>({
        scalpingEngine: null,
        confidence: null,
        dynamicExit: null,
        symbolScan: [],
        wsConnected: false,
    });

    useEffect(() => {
        const socket = getSharedSocket();

        const handler = (data: any) => {
            if (!data) return;

            const tradeFlowRaw: string = data.tradeFlow ?? "Balanced";
            const tradeFlowConf: "BUY" | "SELL" | "NEUTRAL" =
                tradeFlowRaw === "BUY Dominant" ? "BUY"
                    : tradeFlowRaw === "SELL Dominant" ? "SELL"
                        : "NEUTRAL";

            setStatus({
                scalpingEngine: {
                    symbol: data.symbol ?? "BTCUSD",
                    imbalance: data.imbalance ?? 1.0,
                    spread: data.spread ?? "OK",
                    tradeFlow: tradeFlowRaw as any,
                    entrySignal: data.entrySignal ?? false,
                    cooldown: data.cooldown ?? false,
                    activeTrades: data.activeTrades ?? 0,
                    maxTrades: data.maxTrades ?? 2,
                    lastPrice: data.lastPrice,
                    noTradeReason: data.noTradeReason ?? "",
                },
                confidence: {
                    score: data.confidence ?? 0,
                    orderbookStrength: data.orderbookStrength ?? "Moderate",
                    tradeFlow: tradeFlowConf,
                    spreadStable: data.spreadStable ?? true,
                    momentum: data.momentum ?? "MEDIUM",
                },
                dynamicExit: {
                    active: data.dynamicExitActive ?? false,
                    tpRemoved: data.tpRemoved ?? false,
                    trailingSL: data.trailingSL ?? false,
                    slTrailPct: data.slTrailPct ?? 0.15,
                    holdTimeSec: data.holdTimeSec ?? 0,
                    maxHoldSec: data.maxHoldSec ?? 60,
                },
                symbolScan: Array.isArray(data.symbolScan) ? data.symbolScan : [],
                wsConnected: data.wsConnected ?? false,
            });
        };

        socket.on("engine_status", handler);
        return () => { socket.off("engine_status", handler); };
    }, []);

    return status;
}
