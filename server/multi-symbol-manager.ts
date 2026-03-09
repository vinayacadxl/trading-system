/**
 * Multi-Symbol Trading Manager
 * Monitors multiple symbols simultaneously and tracks signal strength
 */

export interface SymbolSignal {
    symbol: string;
    signalStrength: number; // 0-100
    direction: "buy" | "sell" | "neutral";
    confidence: number;
    regime: string;
    lastPrice: number;
    change24h: number;
    lastUpdate: number;
    aiProbability?: number;
    /** For volatility-based size reduction (e.g. HIGH_EXPANSION => 0.5x size) */
    volatility?: "LOW_SQUEEZE" | "NORMAL" | "HIGH_EXPANSION" | "EXTREME_VOLATILITY";
}

export interface MultiSymbolConfig {
    symbols: string[];
    scanInterval: number; // milliseconds
    enableAutoTrade: boolean;
    maxConcurrentPositions: number;
    capitalPerSymbol: number; // percentage
}

class MultiSymbolManager {
    private config: MultiSymbolConfig;
    private signalCache: Map<string, SymbolSignal>;
    private activePositions: Set<string>;
    private lastScanTime: number;

    constructor(config?: Partial<MultiSymbolConfig>) {
        this.config = {
            symbols: ["BTCUSD", "ETHUSD", "SOLUSD", "XRPUSD", "LINKUSD", "BCHUSD", "LTCUSD"],
            scanInterval: parseInt(process.env.MULTI_SYMBOL_SCAN_INTERVAL_MS || "5000", 10), // fast mode default 5s
            enableAutoTrade: false,
            maxConcurrentPositions: 5, // Flow: Max 5 positions
            capitalPerSymbol: 20, // ~20% per symbol for 5 positions
            ...config,
        };
        this.signalCache = new Map();
        this.activePositions = new Set();
        this.lastScanTime = 0;
    }

    getConfig(): MultiSymbolConfig {
        return { ...this.config };
    }

    updateConfig(updates: Partial<MultiSymbolConfig>): void {
        this.config = { ...this.config, ...updates };
    }

    updateSignal(symbol: string, signal: SymbolSignal): void {
        this.signalCache.set(symbol, {
            ...signal,
            lastUpdate: Date.now(),
        });
    }

    getSignal(symbol: string): SymbolSignal | undefined {
        return this.signalCache.get(symbol);
    }

    getAllSignals(): SymbolSignal[] {
        return Array.from(this.signalCache.values())
            .sort((a, b) => b.signalStrength - a.signalStrength); // Sort by strength
    }

    getTopOpportunities(count: number = 3): SymbolSignal[] {
        return this.getAllSignals()
            .filter(s => s.direction !== "neutral")
            .slice(0, count);
    }

    canTrade(symbol: string): boolean {
        // Can't trade if already have position
        if (this.activePositions.has(symbol)) return false;

        // Can't trade if max positions reached
        if (this.activePositions.size >= this.config.maxConcurrentPositions) return false;

        return true;
    }

    addPosition(symbol: string): void {
        this.activePositions.add(symbol);
    }

    removePosition(symbol: string): void {
        this.activePositions.delete(symbol);
    }

    getActivePositions(): string[] {
        return Array.from(this.activePositions);
    }

    setLastScanTime(time: number): void {
        this.lastScanTime = time;
    }

    getLastScanTime(): number {
        return this.lastScanTime;
    }

    /**
     * Optimized for VISIBILITY and PRECISION.
     * 100% now only possible if: Confidence is high (>90%) AND Regime is trending/breakout AND AI/Technical alignment.
     */
    calculateSignalStrength(
        direction: "buy" | "sell" | "neutral",
        confidence: number,
        aiProbability: number,
        regime: string
    ): number {
        if (direction === "neutral") return 0;

        let strength = 0;
        const useTechnicalFallback = !aiProbability || aiProbability === 0.5;

        // 1. BASE LOGIC (Max 60 points)
        if (useTechnicalFallback) {
            // Confidence 100% = 60 strength base
            strength += Math.min(confidence * 0.60, 60);
        } else {
            // Split between confidence and AI prob
            strength += Math.min(confidence * 0.30, 30);
            strength += Math.min(aiProbability * 100 * 0.30, 30);
        }

        // 2. REGIME & TREND CONFIRMATION (Max 30 points)
        // High quality signals need market structure support
        const isStrongRegime = regime.includes("TRENDING") || regime.includes("BREAKOUT");
        if (isStrongRegime) {
            strength += 20;
        } else if (regime.includes("TREND") || regime.includes("RANGE")) {
            strength += 10;
        }

        // 3. MOMENTUM & VOLATILITY GATE (Max 10 points)
        // Only get the final 10 points if confidence is very high (execution ready)
        if (confidence >= 90) {
            strength += 10;
        }

        // 4. CAPS & FINAL ROUNDING
        const rounded = Math.round(strength);

        // VISIBILITY RULE: 100% should only appear when actually ready to execute
        // If it's a weak regime or low confidence, cap it at 85%
        if (rounded >= 95 && (!isStrongRegime || confidence < 90)) {
            return 85;
        }

        return Math.min(rounded, 100);
    }
}

// Singleton instance
let instance: MultiSymbolManager | null = null;

export function getMultiSymbolManager(): MultiSymbolManager {
    if (!instance) {
        instance = new MultiSymbolManager();
    }
    return instance;
}

export function initMultiSymbolManager(config?: Partial<MultiSymbolConfig>): MultiSymbolManager {
    instance = new MultiSymbolManager(config);
    return instance;
}
