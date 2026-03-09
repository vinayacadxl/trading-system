import type { Express } from "express";
import { createServer, type Server } from "http";
import {
    getPortfolioValueUsd,
    getPositions,
    getHistory,
    getProducts,
    getWalletBalances,
    getTickers,
    getOrderBook,
    getTrades,
    getDeltaKeys,
    reloadKeysFromEnv,
    setDeltaKeys
} from "./delta";
import { getMultiSymbolManager } from "./multi-symbol-manager";
import { getDailyPnl, getDailyTradeCount, getStoredActivePositions, getRecentTrades } from "./position-storage";
import {
    botGetStatus,
    botGetConfig,
    botUpdateConfig,
    botStart,
    botStop,
    botGetSignals
} from "./bot-store";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function registerRoutes(app: Express): Promise<Server> {

    // --- 💹 DELTA EXCHANGE ROUTES ---

    app.get("/api/delta/balance", async (_req, res) => {
        try {
            const out = await getWalletBalances();
            let pv = await getPortfolioValueUsd();
            let isFallback = false;

            // ⚡ Fallback: if API fails (IP whitelist etc), use env fallback
            if (pv <= 0) {
                const fallback = parseFloat(process.env.FALLBACK_BALANCE_USD || "0");
                if (fallback > 0) { pv = fallback; isFallback = true; }
            }

            // Format for use-portfolio.ts
            const balances = Array.isArray(out.result) ? out.result : [];

            res.json({
                success: true,
                portfolioValue: pv.toFixed(2),
                currency: "USD",
                balances,
                isFallback,
                suggestedMaxPositionUsd: (pv * 0.05).toFixed(2),
                dailyRoiPct: 0,
                balance24hAgo: pv.toFixed(2)
            });
        } catch (e) {
            // Even on total failure, return fallback balance so UI shows something
            const fallback = parseFloat(process.env.FALLBACK_BALANCE_USD || "0");
            if (fallback > 0) {
                res.json({
                    success: true,
                    portfolioValue: fallback.toFixed(2),
                    currency: "USD",
                    balances: [],
                    isFallback: true,
                    suggestedMaxPositionUsd: (fallback * 0.05).toFixed(2),
                    dailyRoiPct: 0,
                    balance24hAgo: fallback.toFixed(2)
                });
            } else {
                res.status(500).json({ success: false, error: String(e) });
            }
        }
    });

    app.get("/api/delta/positions", async (_req, res) => {
        try {
            const out = await getPositions();

            if (out.success && Array.isArray(out.result)) {
                // Fetch internal metadata to augment positions
                const storedMetadata = await getStoredActivePositions();
                const positions = out.result.map((p: any) => {
                    const meta = storedMetadata.find(m => m.symbol === p.symbol || m.productId === p.product_id);
                    return {
                        ...p,
                        entry_time: meta ? meta.entryTime.getTime() : null,
                        internal_side: meta ? meta.side : null,
                    };
                });
                res.json({ success: true, result: positions });
            } else {
                res.json(out);
            }
        } catch (e) {
            res.status(500).json({ success: false, error: String(e) });
        }
    });

    app.get("/api/delta/products", async (_req, res) => {
        try {
            const products = await getProducts();
            res.json(products);
        } catch (e) {
            res.status(500).json({ success: false, error: String(e) });
        }
    });

    app.get("/api/delta/orders-history", async (req, res) => {
        try {
            const history = await getHistory("BTCUSD", "1h", Date.now() - 86400000, Date.now());
            res.json(history);
        } catch (e) {
            res.status(500).json({ success: false, error: String(e) });
        }
    });

    app.get("/api/delta/candles", async (req, res) => {
        try {
            const { symbol, resolution, limit } = req.query;
            const resVal = resolution as string || "15m";
            const limitVal = parseInt(limit as string) || 100;

            // Delta v2 API expects SECONDS for start/end
            const end = Math.floor(Date.now() / 1000);
            const multiplier = resVal === '1h' ? 3600 : resVal === '5m' ? 300 : 900; // default 15m = 900s
            const start = end - (limitVal * multiplier);

            const candles = await getHistory(symbol as string || "BTCUSD", resVal, start, end);
            res.json(candles);
        } catch (e) {
            res.status(500).json({ success: false, error: String(e) });
        }
    });

    app.get("/api/delta/tickers", async (_req, res) => {
        try {
            console.log("[Route] Fetching tickers...");
            const tickers = await getTickers();
            res.json(tickers);
        } catch (e) {
            console.error("[Route] Tickers failure:", e);
            res.status(500).json({ success: false, error: String(e) });
        }
    });

    app.get("/api/delta/orderbook", async (req, res) => {
        try {
            const { symbol } = req.query;
            console.log(`[Route] Fetching orderbook for ${symbol || "BTCUSD"}...`);
            const ob = await getOrderBook(symbol as string || "BTCUSD");
            res.json(ob);
        } catch (e) {
            console.error("[Route] Orderbook failure:", e);
            res.status(500).json({ success: false, error: String(e) });
        }
    });

    app.get("/api/delta/trades", async (req, res) => {
        try {
            const { symbol, limit } = req.query;
            console.log(`[Route] Fetching trades for ${symbol || "BTCUSD"}...`);
            const tr = await getTrades(symbol as string || "BTCUSD", parseInt(limit as string) || 20);
            res.json(tr);
        } catch (e) {
            console.error("[Route] Trades failure:", e);
            res.status(500).json({ success: false, error: String(e) });
        }
    });

    // --- 🤖 BOT CONTROL ROUTES ---

    app.get("/api/bot/status", async (_req, res) => {
        try {
            const status = botGetStatus();
            res.json({ success: true, ...status });
        } catch (e) {
            res.status(500).json({ success: false, error: String(e) });
        }
    });

    app.get("/api/bot/risk-status", async (_req, res) => {
        try {
            const pnl = await getDailyPnl();
            const count = await getDailyTradeCount();
            res.json({
                success: true,
                dailyPnl: pnl,
                tradeCount: count,
                tradingHalted: false,
                noTradeUntil: null
            });
        } catch (e) {
            res.status(500).json({ success: false, error: String(e) });
        }
    });

    app.get("/api/bot/config", async (_req, res) => {
        try {
            const config = botGetConfig();
            res.json({ success: true, config });
        } catch (e) {
            res.status(500).json({ success: false, error: String(e) });
        }
    });

    app.put("/api/bot/config", async (req, res) => {
        try {
            botUpdateConfig(req.body);
            res.json({ success: true });
        } catch (e) {
            res.status(500).json({ success: false, error: String(e) });
        }
    });

    app.post("/api/bot/start", async (req, res) => {
        try {
            botStart(req.body);
            res.json({ success: true });
        } catch (e) {
            res.status(500).json({ success: false, error: String(e) });
        }
    });

    app.post("/api/bot/stop", async (_req, res) => {
        try {
            botStop();
            res.json({ success: true });
        } catch (e) {
            res.status(500).json({ success: false, error: String(e) });
        }
    });

    app.post("/api/bot/halt", async (_req, res) => {
        res.json({ success: true });
    });

    app.post("/api/bot/resume", async (_req, res) => {
        res.json({ success: true });
    });

    app.get("/api/bot/signals", (_req, res) => {
        try {
            res.json(botGetSignals());
        } catch (e) {
            res.status(500).json([]);
        }
    });

    app.get("/api/settings", async (_req, res) => {
        try {
            reloadKeysFromEnv();
            const keys = getDeltaKeys();
            const config = botGetConfig();
            res.json({
                apiKey: keys?.apiKey || "",
                apiSecret: keys?.secretKey || "",
                testnet: process.env.DELTA_BASE_URL?.includes("testnet") || false,
                riskPercent: config.riskPct
            });
        } catch (e) {
            res.status(500).json({ success: false, error: String(e) });
        }
    });

    app.post("/api/settings", async (req, res) => {
        try {
            const { apiKey, apiSecret, testnet, riskPercent } = req.body;

            // 1. Update In-Memory Bot Config
            botUpdateConfig({ riskPct: riskPercent });

            // 2. Update Delta Keys in memory
            if (apiKey && apiSecret) {
                setDeltaKeys({ apiKey, secretKey: apiSecret });
            }

            res.json({ success: true });
        } catch (e) {
            res.status(500).json({ success: false, error: String(e) });
        }
    });

    app.get("/api/trades/history", async (req, res) => {
        try {
            const limit = parseInt(req.query.limit as string) || 50;
            const trades = await getRecentTrades(limit);

            // Format for UI (TradeHistory.tsx)
            const formatted = trades.map(t => ({
                id: t.id,
                symbol: t.symbol,
                side: t.side as "buy" | "sell",
                size: 0, // Not stored in schema yet, but needed for UI
                avgFillPrice: t.entryPrice,
                closePrice: t.exitPrice,
                pnl: t.pnlUsd,
                status: "closed",
                createdAt: t.entryTime.getTime(),
                closedAt: t.exitTime.getTime(),
            }));

            res.json(formatted);
        } catch (e) {
            res.status(500).json({ success: false, error: String(e) });
        }
    });

    // --- 📊 ANALYSIS & MISC ---

    app.get("/api/multi-symbol/signals", async (_req, res) => {
        try {
            const manager = getMultiSymbolManager();
            const signals = manager.getAllSignals();
            res.json({ success: true, signals });
        } catch (e) {
            res.status(500).json({ success: false, error: String(e) });
        }
    });

    app.get("/api/python-health", async (_req, res) => {
        const stateFile = path.join(__dirname, "../market_state.json");
        const exists = fs.existsSync(stateFile);
        const stats = exists ? fs.statSync(stateFile) : null;
        res.json({
            success: true,
            online: exists,
            lastUpdate: stats ? stats.mtime : null
        });
    });

    app.get("/api/debug/setup-status", async (_req, res) => {
        try {
            const { getWalletBalancesRaw } = await import("./delta");
            const out = await getWalletBalancesRaw();
            const keys = getDeltaKeys();

            const data: any = {
                success: true,
                initialized: true,
                ok: out.success,
                ip_whitelisted: out.success,
                apiKeyPrefix: keys?.apiKey ? keys.apiKey.slice(0, 6) : ""
            };

            if (!out.success) {
                const err: any = out.error || {};
                const rawErrData: any = out._rawErrorData || {};
                data.deltaError = err.code || "unknown";
                data.message = err.message || "Connection failed";

                const clientIp =
                    rawErrData?.error?.context?.client_ip ||
                    rawErrData?.context?.client_ip ||
                    rawErrData?.client_ip ||
                    null;

                const errorCode = err.code || rawErrData?.error?.code || rawErrData?.code || "";

                if (errorCode === "ip_not_whitelisted_for_api_key") {
                    data.deltaErrorFriendly = "IP not whitelisted. Please add the IP below to your Delta API key settings.";
                    data.serverIp = clientIp || "Could not detect IP – check delta_debug.log";
                } else if (errorCode === "authorization_failed") {
                    data.deltaErrorFriendly = "Invalid API Keys or Secret. Please check your .env file.";
                } else if (errorCode === "no_api_keys") {
                    data.deltaErrorFriendly = "API Keys not configured. Please add DELTA_API_KEY and DELTA_SECRET_KEY to .env file.";
                } else {
                    data.deltaErrorFriendly = `Delta Error: ${err.message || 'Unknown'}`;
                }
            }

            res.json(data);
        } catch (e) {
            res.status(500).json({ success: false, ok: false, message: String(e) });
        }
    });

    // --- 🧪 STRATEGY TESTER BACKTEST ROUTE ---
    app.post("/api/backtest/run", async (req, res) => {
        try {
            const { symbol, resolution, strategy, startDate, endDate, riskPercent } = req.body;

            if (!symbol || !resolution) {
                return res.status(400).json({ success: false, message: "symbol and resolution are required" });
            }

            // Convert date strings to Unix seconds
            const start = startDate
                ? Math.floor(new Date(startDate).getTime() / 1000)
                : Math.floor(Date.now() / 1000) - 30 * 24 * 3600;
            const end = endDate
                ? Math.floor(new Date(endDate).getTime() / 1000)
                : Math.floor(Date.now() / 1000);

            // Fetch candles from Delta Exchange (public endpoint — no API key required)
            const candles = await getHistory(symbol, resolution, start, end);
            if (!candles || candles.length < 10) {
                return res.status(422).json({
                    success: false,
                    message: `Not enough candle data for ${symbol} ${resolution}. Got ${candles?.length ?? 0} candles. Try a wider date range or different timeframe.`
                });
            }

            const { runAdaptiveBacktest, runBacktest } = await import("./strategy-engine");
            // Use provided balance (from frontend/actual account), fallback to 1000
            const initialBalance = (typeof req.body.initialBalance === 'number' && req.body.initialBalance > 0)
                ? req.body.initialBalance
                : 1000;

            // Minutes per bar for duration display
            const barsToMins: Record<string, number> = { "5m": 5, "15m": 15, "30m": 30, "1h": 60, "4h": 240, "1d": 1440 };
            const minsPerBar = barsToMins[resolution] ?? 15;

            if (strategy === "alpha_one") {
                // ✅ ALPHA ONE: Full AI adaptive engine — uses tradeLog (with capital L)
                const result = runAdaptiveBacktest(candles, 8, {
                    minAiScoreOverride: 80,
                });

                const tradeList = (result.tradeLog ?? []).map((t: any) => {
                    const pnlUsd = (t.pnlPct ?? 0) * initialBalance / 100;
                    return {
                        side: (t.signal === "buy" ? "buy" : "sell") as "buy" | "sell",
                        entry: parseFloat((t.entryPrice ?? 0).toFixed(4)),
                        exit: parseFloat((t.exitPrice ?? 0).toFixed(4)),
                        pnl: parseFloat(pnlUsd.toFixed(2)),
                        durationMins: (t.holdBars ?? 8) * minsPerBar,
                    };
                });

                const wins = tradeList.filter(t => t.pnl > 0).length;
                const losses = tradeList.filter(t => t.pnl <= 0).length;
                const totalPnl = tradeList.reduce((s, t) => s + t.pnl, 0);
                const avgWin = wins > 0 ? tradeList.filter(t => t.pnl > 0).reduce((s, t) => s + t.pnl, 0) / wins : 0;
                const avgLoss = losses > 0 ? Math.abs(tradeList.filter(t => t.pnl < 0).reduce((s, t) => s + t.pnl, 0) / losses) : 0;

                return res.json({
                    success: true, symbol, resolution, strategy,
                    initialBalance,
                    candlesUsed: candles.length,
                    totalTrades: result.totalTrades,
                    winRate: parseFloat(result.winRate.toFixed(2)),
                    profitFactor: parseFloat(result.profitFactor.toFixed(3)),
                    totalPnl: parseFloat(totalPnl.toFixed(2)),
                    maxDrawdown: parseFloat(result.maxDrawdown.toFixed(2)),
                    avgWin: parseFloat(avgWin.toFixed(2)),
                    avgLoss: parseFloat(avgLoss.toFixed(2)),
                    sharpe: parseFloat((result.sharpeRatio ?? 0).toFixed(3)),
                    trades: tradeList,
                });

            } else {
                // ✅ SCALPER / MOMENTUM: Fixed-hold backtest — uses (candles, strategyType, holdBars)
                const holdBars = strategy === "scalp" ? 3 : 8;
                const strategyType = strategy === "scalp" ? "ema_crossover" : "rsi" as any;
                const result = runBacktest(candles, strategyType, holdBars);

                const totalPnl = (result.totalReturnPct / 100) * initialBalance;
                const winRate = result.winRate;
                const wins = result.wins ?? Math.round(result.totalTrades * winRate / 100);
                const losses = result.losses ?? (result.totalTrades - wins);
                const grossWin = wins > 0 ? (totalPnl > 0 ? totalPnl : 0) : 0;
                const grossLoss = losses > 0 ? (result.maxDrawdown / 100) * initialBalance : 0;
                const avgWin = wins > 0 ? grossWin / wins : 0;
                const avgLoss = losses > 0 ? grossLoss / losses : 0;

                return res.json({
                    success: true, symbol, resolution, strategy,
                    candlesUsed: candles.length,
                    totalTrades: result.totalTrades,
                    winRate: parseFloat(winRate.toFixed(2)),
                    profitFactor: parseFloat(result.profitFactor.toFixed(3)),
                    totalPnl: parseFloat(totalPnl.toFixed(2)),
                    maxDrawdown: parseFloat(result.maxDrawdown.toFixed(2)),
                    avgWin: parseFloat(avgWin.toFixed(2)),
                    avgLoss: parseFloat(avgLoss.toFixed(2)),
                    sharpe: 0,
                    trades: [],
                });
            }

        } catch (e: any) {
            console.error("[backtest] Error:", e);
            res.status(500).json({ success: false, message: e?.message ?? String(e) });
        }
    });

    const httpServer = createServer(app);
    return httpServer;
}
