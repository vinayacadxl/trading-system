import { botPositionSize, botRecordSignal, botRecordTrade } from './bot-store';
import { log } from './index';
import { getProductBySymbol, setLeverage, getPositions, placeOrder, getPortfolioValueUsd } from './delta';
import { saveEntryContext, getDailyTradeCount, incrementDailyTradeCount, getDailyPnl, setPositionEntryTime } from './position-storage';
import { getMultiSymbolManager } from './multi-symbol-manager';
import { canOpenNewTrade, getConsecutiveLossSizeMultiplier, exposureOk, type PositionForExposure } from './risk-gate';
import { getScalperSignal } from './strategy-engine';
import { getLocalPositions } from './position-manager';
import { getOrderBook } from './delta-socket';
import { updateEngineState } from './engine-status';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * 🧠 SCALPING BRAIN (Python Filter)
 */
let marketState = { tradable: true, riskScore: 0, reason: 'OK' };
const STATE_FILE = path.join(__dirname, '../market_state.json');

// --- ⚡ LIGHTNING STATE CACHE ---
let cachedBalance = 0;
let lastSuccessfulBalance = 0;  // ← Remember last good balance even if API fails
let balanceFetchFailed = false;
let cachedDailyPnl = 0;
let cachedDailyTradeCount = 0;
const pidCache = new Map<string, number>();
const leverageCache = new Map<number, number>();
const processingMap = new Map<string, boolean>();

// --- Fallback balance from environment (for when API is temporarily unreachable) ---
const FALLBACK_BALANCE_USD = parseFloat(process.env.FALLBACK_BALANCE_USD || '0');

setInterval(async () => {
    try {
        if (fs.existsSync(STATE_FILE)) {
            const data = fs.readFileSync(STATE_FILE, 'utf8');
            marketState = JSON.parse(data);
        }
        const fetched = await getPortfolioValueUsd();
        if (fetched > 0) {
            cachedBalance = fetched;
            lastSuccessfulBalance = fetched;
            balanceFetchFailed = false;
        } else {
            // API failed – use last known balance or env fallback
            balanceFetchFailed = true;
            if (lastSuccessfulBalance > 0) {
                cachedBalance = lastSuccessfulBalance;
                log(`[MULTI-TRADE] Balance fetch failed, using last known: $${lastSuccessfulBalance.toFixed(2)}`, 'trader');
            } else if (FALLBACK_BALANCE_USD > 0) {
                cachedBalance = FALLBACK_BALANCE_USD;
                log(`[MULTI-TRADE] Balance fetch failed, using env fallback: $${FALLBACK_BALANCE_USD}`, 'trader');
            }
        }
        cachedDailyPnl = await getDailyPnl();
        cachedDailyTradeCount = await getDailyTradeCount();
        if (pidCache.size === 0) {
            const manager = getMultiSymbolManager();
            for (const sym of manager.getConfig().symbols) {
                const pid = await getProductBySymbol(sym);
                if (pid) pidCache.set(sym, pid.id ?? pid);
            }
        }
    } catch (e) { }
}, 2000);

export interface MultiSymbolSignal {
    symbol: string;
    strength: number;
    direction: 'buy' | 'sell' | 'neutral';
    confidence: number;
    regime: string;
    price: number;
    lastUpdate?: string;
    volatility?: 'LOW_SQUEEZE' | 'NORMAL' | 'HIGH_EXPANSION' | 'EXTREME_VOLATILITY';
}

export interface TradeDecision {
    symbol: string;
    signal: 'buy' | 'sell';
    strength: number;
    confidence: number;
    score: number;
    price: number;
    volatility?: 'LOW_SQUEEZE' | 'NORMAL' | 'HIGH_EXPANSION' | 'EXTREME_VOLATILITY';
}

const MULTI_SYMBOL_CONFIG = {
    MIN_STRENGTH: 35,
    MIN_CONFIDENCE: 40,
    MAX_CONCURRENT: 2,
    CAPITAL_PER_TRADE: 0.15,
    SL_PCT: 0.25,
    TP_PCT: 0.35,
    DAILY_LOSS_LIMIT_USD: 5.0,   // ← Increased from $2 to $5 (was blocking too many trades)
    COOLDOWN_MS: 90000,
    TRADE_MODE: 'all',
    MAX_LOSS_PER_TRADE_PCT: 3,
};

const symbolCooldowns = new Map<string, number>();

const ORDER_SLICE_NOTIONAL_THRESHOLD = parseFloat(process.env.ORDER_SLICE_NOTIONAL_THRESHOLD || "0");
const ORDER_SLICE_COUNT = Math.max(2, Math.min(5, parseInt(process.env.ORDER_SLICE_COUNT || "3", 10)));
const ORDER_SLICE_DELAY_MS = Math.max(2000, parseInt(process.env.ORDER_SLICE_DELAY_MS || "10000", 10));

const activePositions = new Map<string, {
    symbol: string;
    side: 'buy' | 'sell';
    size: number;
    entryPrice: number;
    timestamp: number;
}>();

function calculateSignalScore(signal: MultiSymbolSignal): number {
    let regimeBonus = 1.0;
    if (signal.regime.includes('trending')) {
        regimeBonus = 1.2;
    } else if (signal.regime.includes('range')) {
        regimeBonus = 0.9;
    }
    return (signal.strength / 100) * (signal.confidence / 100) * regimeBonus * 100;
}

export function selectBestSignals(signals: MultiSymbolSignal[]): TradeDecision[] {


    const validSignals = signals.filter(s => {
        const isAboveMin = s.strength >= MULTI_SYMBOL_CONFIG.MIN_STRENGTH &&
            s.confidence >= MULTI_SYMBOL_CONFIG.MIN_CONFIDENCE;
        const isNotNeutral = s.direction !== 'neutral';
        const noPosition = !activePositions.has(s.symbol);

        if (!isAboveMin && isNotNeutral) {
            botRecordSignal({
                symbol: s.symbol, signal: s.direction, confidence: s.confidence,
                action: 'skipped', reason: `Weak Signal (S:${s.strength}%, C:${s.confidence}%)`, price: String(s.price)
            });
        } else if (isNotNeutral && activePositions.has(s.symbol)) {
            botRecordSignal({
                symbol: s.symbol, signal: s.direction, confidence: s.confidence,
                action: 'skipped', reason: 'Position Already Open', price: String(s.price)
            });
        }
        return isAboveMin && isNotNeutral && noPosition;
    });

    if (validSignals.length === 0) return [];

    const decisions: TradeDecision[] = validSignals.map(signal => ({
        symbol: signal.symbol,
        signal: signal.direction as 'buy' | 'sell',
        strength: signal.strength,
        confidence: signal.confidence,
        score: calculateSignalScore(signal),
        price: signal.price,
        volatility: signal.volatility,
    }));

    decisions.sort((a, b) => b.score - a.score);

    if (MULTI_SYMBOL_CONFIG.TRADE_MODE === 'best') return decisions.slice(0, 1);
    else if (MULTI_SYMBOL_CONFIG.TRADE_MODE === 'top3') return decisions.slice(0, 3);
    return decisions;
}

export async function canOpenPosition(balanceUsd: number): Promise<{ success: boolean; error?: { message: string } }> {
    const positionsRes = await getPositions();
    const riskGate = await canOpenNewTrade(balanceUsd);
    if (!riskGate.ok) {
        const reason = riskGate.reason || 'Risk gate blocked entry';
        log(`[MULTI-TRADE] Risk gate: ${reason}`, 'trader');
        return { success: false, error: { message: reason } };
    }
    const currentPositions = positionsRes.success && positionsRes.result ? positionsRes.result.length : activePositions.size;
    if (currentPositions >= MULTI_SYMBOL_CONFIG.MAX_CONCURRENT) {
        return { success: false, error: { message: 'Max concurrent positions reached' } };
    }
    const minBalanceRequired = 5;
    if (balanceUsd < minBalanceRequired) {
        log(`[MULTI-TRADE] Insufficient balance: $${balanceUsd.toFixed(2)} < $${minBalanceRequired}`, 'trader');
        return { success: false, error: { message: 'Insufficient balance' } };
    }
    return { success: true };
}

export function calculateMultiSymbolSize(
    balanceUsd: number, price: number, leverage: number, symbol: string,
    volatility?: 'LOW_SQUEEZE' | 'NORMAL' | 'HIGH_EXPANSION' | 'EXTREME_VOLATILITY',
    sizeMultiplier: number = 1.0
): number {
    const volMultiplier = (volatility === 'HIGH_EXPANSION' || volatility === 'EXTREME_VOLATILITY') ? 0.5 : 1.0;
    let allocatedCapital = balanceUsd * MULTI_SYMBOL_CONFIG.CAPITAL_PER_TRADE * sizeMultiplier * volMultiplier;
    if (balanceUsd < 100) {
        allocatedCapital = balanceUsd * 0.12 * sizeMultiplier * volMultiplier;
    }
    let notional = allocatedCapital * leverage;
    const maxLossUsd = balanceUsd * (MULTI_SYMBOL_CONFIG.MAX_LOSS_PER_TRADE_PCT / 100);
    const maxNotionalByLoss = maxLossUsd / (MULTI_SYMBOL_CONFIG.SL_PCT / 100);
    if (notional > maxNotionalByLoss) notional = maxNotionalByLoss;
    if (symbol.startsWith('BTC')) { if (notional < 70) notional = 70; }
    else if (symbol.startsWith('ETH')) { if (notional < 30) notional = 30; }
    if (!price || !isFinite(price) || price <= 0) return 0;
    let size = notional / price;
    const maxSizeByLoss = maxNotionalByLoss / price;
    if (size > maxSizeByLoss) size = maxSizeByLoss;

    const finalSize = Math.round(size * 1000) / 1000;
    return isFinite(finalSize) ? finalSize : 0;
}

const MAX_DAILY_TRADES = parseInt(process.env.MULTI_SYMBOL_MAX_DAILY_TRADES || "22", 10);

export async function executeMultiSymbolTrade(
    decision: TradeDecision, balanceUsd: number
): Promise<{ success: boolean; error?: any }> {
    try {
        const dailyCount = await getDailyTradeCount();
        if (dailyCount >= MAX_DAILY_TRADES) {
            return { success: false, error: { message: 'Daily trade cap reached' } };
        }

        const sizeMultiplier = await getConsecutiveLossSizeMultiplier();
        if (cachedDailyPnl <= -MULTI_SYMBOL_CONFIG.DAILY_LOSS_LIMIT_USD) {
            return { success: false, error: { message: 'Daily loss limit hit' } };
        }

        log(`[MULTI-TRADE] EXECUTE: ${decision.signal.toUpperCase()} ${decision.symbol}`, 'trader');

        const productObj = pidCache.has(decision.symbol)
            ? { id: pidCache.get(decision.symbol)! }
            : await getProductBySymbol(decision.symbol);
        if (!productObj) return { success: false, error: { message: `PID not found` } };
        const pid: number = productObj.id ?? productObj;
        if (!pidCache.has(decision.symbol)) pidCache.set(decision.symbol, pid);

        let leverage = 30;
        if (decision.confidence > 90) leverage = 35;

        if (leverageCache.get(pid) !== leverage) {
            const levRes = await setLeverage(pid, leverage);
            if (levRes.success) leverageCache.set(pid, leverage);
        }

        const size = calculateMultiSymbolSize(balanceUsd, decision.price, leverage, decision.symbol, decision.volatility, sizeMultiplier);
        if (size < 0.0001) {
            return { success: false, error: { message: `Size too small: ${size.toFixed(4)}` } };
        }

        // Use MARKET order for reliable execution (not limit which may not fill)
        const order = await placeOrder({
            symbol: decision.symbol, side: decision.signal, size,
            order_type: 'market', product_id: pid,
        });

        if (order.success) {
            await incrementDailyTradeCount();
            await setPositionEntryTime(decision.symbol, pid, Date.now(), decision.signal, decision.price);
            await saveEntryContext(decision.symbol, {
                side: decision.signal, entryPrice: decision.price,
                entryTime: Date.now(), confidence: decision.confidence
            });
            activePositions.set(decision.symbol, {
                symbol: decision.symbol, side: decision.signal,
                size, entryPrice: decision.price, timestamp: Date.now()
            });
            symbolCooldowns.set(decision.symbol, Date.now());
            getMultiSymbolManager().addPosition(decision.symbol);

            // Update engine state
            updateEngineState({
                symbol: decision.symbol,
                entrySignal: true,
                confidence: decision.confidence / 100,
                tradeFlow: decision.signal === 'buy' ? 'BUY Dominant' : 'SELL Dominant',
                lastPrice: decision.price,
                activeTrades: activePositions.size,
                cooldown: false,
            });

            botRecordSignal({
                symbol: decision.symbol, signal: decision.signal, confidence: decision.confidence,
                action: 'executed', reason: `Multi-Symbol Trade (Score: ${decision.score.toFixed(1)})`,
                price: String(decision.price)
            });
            botRecordTrade({
                symbol: decision.symbol, side: decision.signal, size,
                price: String(decision.price), status: 'executed', confidence: decision.confidence
            });

            log(`[MULTI-TRADE] ✅ SUCCESS: ${decision.signal.toUpperCase()} ${size.toFixed(4)} ${decision.symbol} @ $${decision.price}`, 'trader');
            return { success: true };
        } else {

            botRecordSignal({
                symbol: decision.symbol, signal: decision.signal, confidence: decision.confidence,
                action: 'failed', reason: `Order Failed: ${order.error?.message || 'Unknown error'}`,
                price: String(decision.price)
            });
            log(`[MULTI-TRADE] ❌ FAILED: ${order.error?.message || 'Unknown error'}`, 'trader');
            return { success: false, error: order.error };
        }
    } catch (error) {
        log(`[MULTI-TRADE] Exception: ${error}`, 'trader');
        return { success: false, error };
    }
}

export function removePosition(symbol: string) {
    activePositions.delete(symbol);
    getMultiSymbolManager().removePosition(symbol);
    log(`[MULTI-TRADE] Position removed: ${symbol}. Active: ${activePositions.size}`, 'trader');

    updateEngineState({
        entrySignal: false,
        dynamicExitActive: false,
        trailingSL: false,
        tpRemoved: false,
        holdTimeSec: 0,
        activeTrades: activePositions.size,
    });
}

export function getActivePositions() {
    return Array.from(activePositions.values());
}

export async function startMultiSymbolTrading(_getBalance: () => Promise<number>) {
    log('[MULTI-TRADE] EVENT-DRIVEN SCALPER STARTED! (Listening to l2_orderbook + ticker)', 'trader');
}

/**
 * ⚡ ONE SYMBOL = ONE ENGINE (Parallel Execution)
 * Called on every orderbook update — uses BOTH scalper signal AND scanner signal
 */
export async function handleOrderbookUpdate(symbol: string, price: number) {
    if (processingMap.get(symbol)) return;

    // Update live engine state for UI visibility
    const ob = getOrderBook(symbol);
    if (ob && ob.bids.length > 1 && ob.asks.length > 0) {
        const bestAsk = parseFloat(ob.asks[0]?.price || "0");
        const bestBid = parseFloat(ob.bids[0]?.price || "0");
        const spread = bestAsk - bestBid;
        const spreadTick = spread < 1.5 ? "1 Tick" : spread < 5 ? "2 Ticks" : "WIDE";
        const bidVol = ob.bids.slice(0, 5).reduce((s, b) => s + parseFloat(b.size), 0);
        const askVol = ob.asks.slice(0, 5).reduce((s, a) => s + parseFloat(a.size), 0);
        const imbalance = askVol > 0 ? parseFloat((bidVol / askVol).toFixed(2)) : 1.0;
        const tradeFlow: "BUY Dominant" | "SELL Dominant" | "Balanced" =
            imbalance > 1.3 ? "BUY Dominant" : imbalance < 0.7 ? "SELL Dominant" : "Balanced";
        const onCooldown = (Date.now() - (symbolCooldowns.get(symbol) || 0)) < MULTI_SYMBOL_CONFIG.COOLDOWN_MS;

        updateEngineState({
            symbol, imbalance, spread: spreadTick, tradeFlow,
            lastPrice: price, spreadStable: spread < 3,
            cooldown: onCooldown, activeTrades: activePositions.size,
        });
    }

    try {
        if (!marketState.tradable) {
            updateEngineState({ noTradeReason: "Market not tradable" });
            return;
        }

        // --- ✅ BALANCE CHECK: Use last-known balance if API fails ---
        const effectiveBalance = cachedBalance > 0 ? cachedBalance : FALLBACK_BALANCE_USD;
        if (effectiveBalance < 5) {
            updateEngineState({ noTradeReason: `Balance low: $${effectiveBalance.toFixed(0)}` });
            log(`[MULTI-TRADE] Balance too low or unknown: $${effectiveBalance.toFixed(2)}`, 'trader');
            return;
        }

        if (cachedDailyPnl <= -MULTI_SYMBOL_CONFIG.DAILY_LOSS_LIMIT_USD) {
            updateEngineState({ noTradeReason: `Daily loss limit ($${Math.abs(cachedDailyPnl).toFixed(0)})` });
            return;
        }
        if (cachedDailyTradeCount >= MAX_DAILY_TRADES) {
            updateEngineState({ noTradeReason: `Max daily trades (${cachedDailyTradeCount}/${MAX_DAILY_TRADES})` });
            return;
        }

        // --- ✅ PRICE SAFETY CHECK ---
        if (!price || isNaN(price) || price <= 0) {
            updateEngineState({ noTradeReason: "Invalid price" });
            return;
        }

        const openPositions = getLocalPositions();
        if (openPositions.length >= MULTI_SYMBOL_CONFIG.MAX_CONCURRENT) {
            updateEngineState({ noTradeReason: `Max positions (${openPositions.length}/${MULTI_SYMBOL_CONFIG.MAX_CONCURRENT})` });
            return;
        }

        const lastTradeTime = symbolCooldowns.get(symbol) || 0;
        const cooldownRemain = MULTI_SYMBOL_CONFIG.COOLDOWN_MS - (Date.now() - lastTradeTime);
        if (cooldownRemain > 0) {
            updateEngineState({ noTradeReason: `Cooldown ${Math.ceil(cooldownRemain / 1000)}s` });
            return;
        }

        // --- ✅ DUAL SIGNAL SOURCE: Scalper signal OR Scanner ENTRY SIGNAL ---
        let finalSignal: 'buy' | 'sell' | null = null;
        let signalSource = '';

        // Source 1: Orderbook-based scalper signal
        const scalpResult = getScalperSignal(symbol);
        if (scalpResult.signal) {
            finalSignal = scalpResult.signal;
            signalSource = `SCALPER: ${scalpResult.reason}`;
        }

        // Source 2: Multi-symbol manager ENTRY SIGNAL (scanner signal)
        if (!finalSignal) {
            const manager = getMultiSymbolManager();
            const scannerSig = manager.getSignal(symbol);
            if (scannerSig &&
                scannerSig.direction !== 'neutral' &&
                scannerSig.signalStrength >= 35 &&   // ← Lowered from 45 to 35 (match MIN_STRENGTH)
                scannerSig.lastPrice > 0 &&
                (Date.now() - scannerSig.lastUpdate) < 30000  // ← Relaxed from 10s to 30s old
            ) {
                finalSignal = scannerSig.direction;
                signalSource = `SCANNER: strength=${scannerSig.signalStrength} regime=${scannerSig.regime}`;
            }
        }

        if (!finalSignal) {
            const manager = getMultiSymbolManager();
            const scannerSig = manager.getSignal(symbol);
            let reason = "No BUY/SELL signal";
            if (scannerSig) {
                if (scannerSig.direction === "neutral") reason = "Scanner: neutral";
                else if (scannerSig.signalStrength < 35) reason = `Scanner strength ${scannerSig.signalStrength}% < 35%`;
                else if ((Date.now() - scannerSig.lastUpdate) >= 30000) reason = "Scanner signal >30s old";
            }
            updateEngineState({ entrySignal: false, noTradeReason: reason });
            return;
        }

        log(`[MULTI-TRADE] 🎯 SIGNAL on ${symbol}: ${finalSignal.toUpperCase()} via ${signalSource}`, 'trader');
        updateEngineState({ entrySignal: true });

        processingMap.set(symbol, true);

        const currentPositionsRaw = getLocalPositions();
        const currentPositions: PositionForExposure[] = currentPositionsRaw.map(p => ({
            symbol: p.symbol || '',
            side: (Number(p.size) > 0) ? 'buy' : 'sell',
            size: Math.abs(Number(p.size))
        }));

        const exp = exposureOk(currentPositions, symbol, finalSignal);
        if (!exp.ok) {
            updateEngineState({ noTradeReason: `Exposure: ${exp.reason}` });
            log(`[MULTI-TRADE] Exposure limit: ${exp.reason}`, 'trader');
            processingMap.set(symbol, false);
            return;
        }

        updateEngineState({ noTradeReason: "" });
        const decision: TradeDecision = {
            symbol, signal: finalSignal,
            strength: 90, confidence: 90, score: 100, price,
        };

        await executeMultiSymbolTrade(decision, effectiveBalance);

    } catch (error) {
        console.error(`[SYMBOL-ENGINE:${symbol}] Error:`, error);
    } finally {
        processingMap.set(symbol, false);
    }
}
