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
            maxConcurrentPositions: Math.min(5, Math.max(1, parseInt(process.env.MULTI_SYMBOL_MAX_CONCURRENT || "2", 10))), // default 2
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
     * 🧠 DYNAMIC AI Scoring — Regime-Aware Weight System
     *
     * Market har time same behave nahi karta, isliye weights dynamically
     * adjust hote hain based on detected regime:
     *
     *  TRENDING/BREAKOUT → AI Probability reliable, high regime bonus
     *  RANGE             → Technical Confidence reliable, moderate bonus
     *  HIGH_VOLATILITY   → AI heavy, lower caps to reduce risk
     *  Default/Unknown   → Balanced split
     */
    calculateSignalStrength(
        direction: "buy" | "sell" | "neutral",
        confidence: number,
        aiProbability: number,
        regime: string
    ): number {
        if (direction === "neutral") return 0;

        // --- Step 1: Pick dynamic weights based on market regime ---
        const weights = this._getDynamicWeights(regime);

        // --- Step 2: Base Score (0–60 pts) ---
        const useTechnicalFallback = !aiProbability || aiProbability === 0.5;
        let strength = 0;

        if (useTechnicalFallback) {
            // No AI probability available → use confidence only
            strength += Math.min(confidence * weights.confOnlyWt, 60);
        } else {
            strength += Math.min(confidence * weights.confWt, 30);
            strength += Math.min(aiProbability * 100 * weights.aiWt, 30);
        }

        // --- Step 3: Regime Confirmation Bonus (0–20 pts) ---
        const isStrongRegime = regime.includes("TRENDING") || regime.includes("BREAKOUT");
        strength += isStrongRegime ? weights.regimeBonusStrong : weights.regimeBonusWeak;

        // --- Step 4: Momentum Gate (0–10 pts) ---
        // Only full points if confidence meets the dynamic threshold
        if (confidence >= weights.momentumThreshold) {
            strength += weights.momentumPts;
        } else if (confidence >= weights.momentumThreshold * 0.8) {
            // Partial credit for near-threshold confidence
            strength += weights.momentumPts * 0.5;
        }

        // --- Step 5: Final cap & visibility rule ---
        const rounded = Math.round(strength);

        // Cap at 95 if regime is weak to keep 100% for premium signals
        if (rounded >= 98 && (!isStrongRegime || confidence < weights.momentumThreshold - 5)) {
            return 95;
        }

        return Math.min(rounded, 100);
    }

    /**
     * Returns dynamic scoring weights based on the current market regime.
     *
     * | Regime           | confWt | aiWt | regimeBonus | momentumThreshold |
     * |------------------|--------|------|-------------|-------------------|
     * | TRENDING/BREAKOUT| 0.25   | 0.35 | 20 / 12     | 80                |
     * | RANGE            | 0.40   | 0.20 | 15 / 8      | 85                |
     * | HIGH_VOLATILITY  | 0.15   | 0.45 | 10 / 5      | 90                |
     * | Default          | 0.30   | 0.30 | 12 / 8      | 85                |
     */
    private _getDynamicWeights(regime: string): {
        confWt: number;
        aiWt: number;
        confOnlyWt: number;
        regimeBonusStrong: number;
        regimeBonusWeak: number;
        momentumThreshold: number;
        momentumPts: number;
    } {
        const isTrending = regime.includes("TRENDING") || regime.includes("BREAKOUT");
        const isRange = regime.includes("RANGE");
        const isHighVol = regime.includes("VOLATILITY") || regime.includes("HIGH");

        if (isTrending) {
            // TREND market: AI probability tracks momentum well
            return {
                confWt: 0.25,       // 25% weight to technical confidence
                aiWt: 0.35,         // 35% weight to AI probability (trend-reliable)
                confOnlyWt: 0.60,   // fallback without AI
                regimeBonusStrong: 20,
                regimeBonusWeak: 12,
                momentumThreshold: 75,  // lower bar — trend gives extra conviction
                momentumPts: 10,
            };
        }

        if (isRange) {
            // RANGE market: Technical indicators (RSI, BB) more reliable than AI trend models
            return {
                confWt: 0.45,       // higher technical weight
                aiWt: 0.15,         // AI less useful in choppy markets
                confOnlyWt: 0.65,
                regimeBonusStrong: 15,
                regimeBonusWeak: 10,
                momentumThreshold: 80, // need higher confidence before executing
                momentumPts: 8,
            };
        }

        if (isHighVol) {
            // HIGH VOLATILITY: AI can catch spike direction, but overall score capped lower
            return {
                confWt: 0.15,       // technical indicators unreliable in spikes
                aiWt: 0.45,         // AI probability drives the score
                confOnlyWt: 0.50,   // lower fallback cap
                regimeBonusStrong: 10,
                regimeBonusWeak: 5,
                momentumThreshold: 85, // stricter gate — volatility = higher risk
                momentumPts: 5,     // smaller momentum bonus
            };
        }

        // Default / unknown regime: balanced
        return {
            confWt: 0.35,
            aiWt: 0.25,
            confOnlyWt: 0.60,
            regimeBonusStrong: 12,
            regimeBonusWeak: 8,
            momentumThreshold: 80,
            momentumPts: 8,
        };
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
