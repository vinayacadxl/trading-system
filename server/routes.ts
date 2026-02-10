import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import {
  setDeltaKeys,
  getWalletBalances,
  getWalletBalancesRaw,
  getFills,
  getPositions,
  getDeltaBaseUrl,
  getDeltaKeys,
  type DeltaWalletBalance,
} from "./delta";

/** Delta error code se exact reason – docs ke hisaab se */
function deltaErrorReason(code: string | undefined, message: string | undefined): string {
  const c = (code || "").toLowerCase().replace(/_/g, "");
  const m = message || "";
  if (c === "invalidapikey" || c === "invalid_api_key" || m.toLowerCase().includes("api key not found")) {
    return "Invalid API key. 1) India keys → api.india.delta.exchange; Global keys → api.delta.exchange. 2) Delta pe API key me 'Trading' permission enable karo (sirf Read Data nahi). 3) Server IP whitelist karo: browser me http://127.0.0.1:5000/api/debug/my-ip kholo, jo IP dikhe wahi Delta whitelist me add karo.";
  }
  if (c === "ip_not_whitelisted_for_api_key" || m.toLowerCase().includes("ip") && m.toLowerCase().includes("whitelist")) {
    return "IP whitelist. Reason: Delta pe API Management → apna IP add karo (server ka public IP).";
  }
  if (c === "unauthorizedapiaccess" || (m.toLowerCase().includes("not authorised") || m.toLowerCase().includes("permission"))) {
    return "Permission. Reason: API key me Read Data + Trading dono enable karo (Delta → API Management).";
  }
  if (c === "signature mismatch" || m.toLowerCase().includes("signature")) {
    return "Signature mismatch. Reason: Server time sync karo, ya key/secret sahi hai confirm karo.";
  }
  if (c === "signatureexpired" || m.toLowerCase().includes("signature has expired")) {
    return "Signature expired. Reason: System time sahi hai? 5 sec ke andar request Delta tak pahunchni chahiye.";
  }
  return m || code || "Delta API error";
}

/** Balance history for Daily ROI – in-memory, last 48h */
const BALANCE_HISTORY_MAX_MS = 48 * 60 * 60 * 1000;
const balanceHistory: { ts: number; value: number }[] = [];

function recordBalanceHistory(value: number) {
  const ts = Date.now();
  balanceHistory.push({ ts, value });
  const cutoff = ts - BALANCE_HISTORY_MAX_MS;
  while (balanceHistory.length > 0 && balanceHistory[0]!.ts < cutoff) balanceHistory.shift();
}

function getDailyRoi(currentValue: number): { dailyRoiPct: number | null; balance24hAgo: number | null } {
  if (balanceHistory.length < 2) return { dailyRoiPct: null, balance24hAgo: null };
  const targetTs = Date.now() - 24 * 60 * 60 * 1000;
  let best = balanceHistory[0]!;
  for (const p of balanceHistory) {
    if (Math.abs(p.ts - targetTs) < Math.abs(best.ts - targetTs)) best = p;
  }
  if (best.value <= 0) return { dailyRoiPct: null, balance24hAgo: null };
  const pct = ((currentValue - best.value) / best.value) * 100;
  return { dailyRoiPct: pct, balance24hAgo: best.value };
}

type CandleLike = { time: number; close: string; high: string; low: string; open: string; volume: string };
async function fetchCandlesForBacktest(
  symbol: string,
  resolution: string,
  getHistory: (s: string, r: string, start: number, end: number) => Promise<CandleLike[]>
): Promise<CandleLike[]> {
  let minutes = parseInt(resolution, 10) || 15;
  if (resolution.includes("h")) minutes *= 60;
  if (resolution.includes("d")) minutes *= 1440;
  const end = Math.floor(Date.now() / 1000);
  const start = end - 1000 * minutes * 60;
  let candles = await getHistory(symbol, resolution, start, end);
  if (candles.length === 0) {
    const fallbackStart = end - 500 * minutes * 60;
    candles = await getHistory(symbol, resolution, fallbackStart, end);
  }
  return [...candles].sort((a, b) => a.time - b.time);
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // Debug config
  app.get("/api/delta/debug-config", (_req, res) => {
    const keys = getDeltaKeys();
    res.json({
      baseUrl: getDeltaBaseUrl(),
      hasApiKey: !!keys?.apiKey,
      hasSecretKey: !!keys?.secretKey,
      apiKeyPrefix: keys?.apiKey ? keys.apiKey.slice(0, 4) : null,
      env: process.env.NODE_ENV,
    });
  });
  // Store Delta API keys (from Settings) and proxy Delta Exchange API
  app.post("/api/settings/keys", (req, res) => {
    const { apiKey, secretKey } = req.body || {};
    if (!apiKey || !secretKey) {
      return res.status(400).json({ error: "apiKey and secretKey required" });
    }
    setDeltaKeys({ apiKey: String(apiKey).trim(), secretKey: String(secretKey).trim() });
    return res.json({ ok: true });
  });

  app.get("/api/delta/balance", async (_req, res) => {
    res.status(200);
    let out;
    try {
      out = await getWalletBalances();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Delta balance request failed";
      return res.json({ success: true, balances: [], portfolioValue: "0.00", currency: "USD", errorMessage: msg });
    }
    if (!out.success) {
      if (out.error?.code === "no_api_keys") {
        return res.json({
          success: true,
          balances: [],
          portfolioValue: "0.00",
          currency: "USD",
          errorMessage: "API keys are not configured. Go to Settings or .env to add them.",
        });
      }
      const msg = deltaErrorReason(out.error?.code, out.error?.message);
      return res.json({
        success: true,
        balances: [],
        portfolioValue: "0.00",
        currency: "USD",
        errorMessage: msg,
      });
    }
    // Delta can return result as array or as object with balance/wallets/balances key
    const raw = out.result as unknown;
    let list: Array<Record<string, unknown>> = [];
    const looksLikeWallet = (x: unknown): x is Record<string, unknown> =>
      x != null && typeof x === "object" && !Array.isArray(x) &&
      ("balance" in x || "available_balance" in x || "total" in x || "equity" in x || "withdrawable_balance" in x || "asset_symbol" in x);
    const findWalletArray = (obj: Record<string, unknown>): Array<Record<string, unknown>> | null => {
      for (const key of ["balance", "balances", "wallets", "assets", "wallet_balances", "accounts", "data"]) {
        const val = obj[key];
        if (Array.isArray(val) && val.length > 0 && val.every(looksLikeWallet))
          return val as Array<Record<string, unknown>>;
      }
      for (const val of Object.values(obj)) {
        if (Array.isArray(val) && val.length > 0 && val.every(looksLikeWallet))
          return val as Array<Record<string, unknown>>;
      }
      return null;
    };
    if (Array.isArray(raw)) list = raw as Array<Record<string, unknown>>;
    else if (raw && typeof raw === "object" && Array.isArray((raw as { balance?: unknown }).balance)) list = (raw as { balance: unknown[] }).balance as Array<Record<string, unknown>>;
    else if (raw && typeof raw === "object" && Array.isArray((raw as { balances?: unknown }).balances)) list = (raw as { balances: unknown[] }).balances as Array<Record<string, unknown>>;
    else if (raw && typeof raw === "object" && Array.isArray((raw as { wallets?: unknown }).wallets)) list = (raw as { wallets: unknown[] }).wallets as Array<Record<string, unknown>>;
    else if (raw && typeof raw === "object" && Array.isArray((raw as { assets?: unknown }).assets)) list = (raw as { assets: unknown[] }).assets as Array<Record<string, unknown>>;
    else if (raw && typeof raw === "object") {
      const r = raw as Record<string, unknown>;
      const data = r.data as Record<string, unknown> | undefined;
      const wallet = r.wallet as Record<string, unknown> | undefined;
      if (data && Array.isArray(data.balance) && (data.balance as unknown[]).every(looksLikeWallet)) list = data.balance as Array<Record<string, unknown>>;
      else if (wallet && Array.isArray(wallet.balance) && (wallet.balance as unknown[]).every(looksLikeWallet)) list = wallet.balance as Array<Record<string, unknown>>;
      else {
        const found = findWalletArray(r);
        if (found) list = found;
        else if (looksLikeWallet(raw)) list = [raw as Record<string, unknown>];
      }
    }

    // Delta India: asset_symbol "USD", asset_id 14, balance/available_balance as string
    const getCoin = (b: Record<string, unknown>) => {
      if (b.asset_symbol != null) return String(b.asset_symbol);
      if (Number(b.asset_id) === 14) return "USD";
      const asset = b.asset;
      if (asset && typeof asset === "object" && asset !== null && "symbol" in asset) return String((asset as { symbol?: string }).symbol ?? "");
      return (b.coin ?? (typeof asset === "string" ? asset : null) ?? b.currency ?? b.symbol ?? "") as string;
    };
    const getBalance = (b: Record<string, unknown>) => {
      const v = b.balance ?? b.available_balance ?? (b as { availableBalance?: string }).availableBalance ?? b.total ?? b.equity ?? b.margin_balance ?? b.withdrawable_balance ?? b.available ?? 0;
      return parseFloat(String(v)) || 0;
    };

    let portfolioValue = 0;
    let currency = "USD";

    // 1) Delta India: explicitly pick USD by asset_id 14 or asset_symbol "USD" (pakka show ke liye)
    // asset_id can be number 14 or string "14" from JSON
    const usdEntry = list.find((b) => Number(b.asset_id) === 14 || String(b.asset_symbol || "").toUpperCase() === "USD");
    if (usdEntry) {
      const bal = getBalance(usdEntry);
      portfolioValue = bal;
      currency = "USD";
      if (process.env.NODE_ENV === "development") {
        // picking USD
      }
    } else if (process.env.NODE_ENV === "development" && list.length > 0) {
      // not found
    }

    // 2) Else prefer USDT/USD/USDC/INR with non-zero balance
    if (portfolioValue === 0) {
      const preferredCoins = ["USDT", "USD", "USDC", "INR"];
      for (const c of preferredCoins) {
        const w = list.find((b) => getCoin(b).toUpperCase() === c);
        if (w && getBalance(w) > 0) {
          portfolioValue = getBalance(w);
          currency = getCoin(w).toUpperCase() || c;
          break;
        }
      }
    }
    if (portfolioValue === 0) {
      const preferredCoins = ["USDT", "USD", "USDC", "INR"];
      for (const c of preferredCoins) {
        const w = list.find((b) => getCoin(b).toUpperCase() === c);
        if (w) {
          portfolioValue = getBalance(w);
          currency = getCoin(w).toUpperCase() || c;
          break;
        }
      }
    }
    if (portfolioValue === 0 && list.length > 0) {
      const first = list.find((b) => getBalance(b) > 0);
      if (first) {
        portfolioValue = getBalance(first);
        currency = getCoin(first).toUpperCase() || "USD";
      }
    }

    // For bot: available balance and suggested max position (e.g. 5% of equity per trade)
    const availableBalance = portfolioValue;
    const suggestedMaxPositionPct = 0.05;
    const suggestedMaxPositionUsd = Math.max(0, portfolioValue * suggestedMaxPositionPct);

    // Daily ROI: record snapshot and compute vs balance ~24h ago
    recordBalanceHistory(portfolioValue);
    const { dailyRoiPct, balance24hAgo } = getDailyRoi(portfolioValue);

    return res.json({
      success: true,
      balances: list,
      portfolioValue: portfolioValue.toFixed(2),
      currency,
      availableBalance: availableBalance.toFixed(2),
      suggestedMaxPositionUsd: suggestedMaxPositionUsd.toFixed(2),
      dailyRoiPct: dailyRoiPct != null ? Math.round(dailyRoiPct * 100) / 100 : null,
      balance24hAgo: balance24hAgo != null ? balance24hAgo.toFixed(2) : null,
    });
  });

  app.get("/api/delta/fills", async (req, res) => {
    res.status(200);
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const after = req.query.after as string | undefined;
    const before = req.query.before as string | undefined;
    let out;
    try {
      out = await getFills({ limit, after, before });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Delta fills request failed";
      return res.json({ success: true, fills: [], meta: {}, errorMessage: msg });
    }
    if (!out.success) {
      if (out.error?.code === "no_api_keys") {
        return res.json({ success: true, fills: [], meta: {} });
      }
      const msg = deltaErrorReason(out.error?.code, out.error?.message);
      return res.json({ success: true, fills: [], meta: {}, errorMessage: msg });
    }
    const meta = (out as { meta?: { after?: string; before?: string } }).meta ?? {};
    return res.json({ success: true, fills: out.result || [], meta: { after: meta.after, before: meta.before } });
  });

  app.get("/api/delta/positions", async (_req, res) => {
    const out = await getPositions();
    if (!out.success) {
      const msg = deltaErrorReason(out.error?.code, out.error?.message);
      return res.json({ success: true, positions: [], errorMessage: msg });
    }
    return res.json({ success: true, positions: out.result || [] });
  });

  // Adaptive Strategy Tester API – GET (kept for existing frontend)
  app.get("/api/delta/test-strategy", async (req, res) => {
    const symbol = (req.query.symbol as string) || "BTCUSD";
    const resolution = (req.query.resolution as string) || "15m";
    const strategyType = ((req.query.strategyType as string) || "ema_crossover") as "ema_crossover" | "rsi";
    const holdBars = Math.max(1, Math.min(50, parseInt(String(req.query.holdBars || "6"), 10) || 6));

    try {
      const { getHistory, getTicker } = await import("./delta");
      const { runBacktest } = await import("./strategy-engine");
      const actualCandles = await fetchCandlesForBacktest(symbol, resolution, getHistory);

      const results = runBacktest(actualCandles, strategyType, holdBars);
      const ticker = await getTicker(symbol);

      return res.json({
        success: true,
        ...results,
        candles: actualCandles,
        lastPrice: ticker ? ticker.last_price : (actualCandles.length > 0 ? actualCandles[actualCandles.length - 1]!.close : null),
      });
    } catch (e) {
      return res.status(500).json({
        success: false,
        error: e instanceof Error ? e.message : "Strategy test failed",
      });
    }
  });

  // POST /api/delta/test-strategy – adaptive backtest (regime detection, SL/TP, regimePerformance)
  app.post("/api/delta/test-strategy", async (req, res) => {
    const body = (req.body || {}) as {
      symbol?: string;
      resolution?: string;
      strategyType?: string;
      holdBars?: number;
      adaptive?: boolean,
      preset?: string
    };
    const symbol = body.symbol || "BTCUSD";
    const resolution = body.resolution || "15m";
    const useAdaptive = body.adaptive !== false;
    const holdBars = Math.max(1, Math.min(50, Number(body.holdBars) || 6));
    const preset = (body.preset || "pro_sniper_v3") as any;

    try {
      const { getHistory, getTicker } = await import("./delta");
      const { runAdaptiveBacktest, runBacktest, getCurrentRegime } = await import("./strategy-engine");
      const actualCandles = await fetchCandlesForBacktest(symbol, resolution, getHistory);
      const nominalCapital = 100;

      if (useAdaptive) {
        const results = runAdaptiveBacktest(actualCandles, holdBars, {
          stopLossPct: 2,
          takeProfitPct: 5,
          cooldownBars: 2,
          minCandles: 100,
          skipExtremeVolatility: true,
          preset: preset
        });
        const totalPnlUsd = (results.totalReturn / 100) * nominalCapital;
        const maxDrawdownUsd = (results.maxDrawdown / 100) * nominalCapital;
        const currentRegime = getCurrentRegime(actualCandles);
        const ticker = await getTicker(symbol);
        const lastPrice = ticker ? ticker.last_price : (actualCandles.length > 0 ? actualCandles[actualCandles.length - 1]!.close : null);

        res.setHeader("Content-Type", "application/json; charset=utf-8");
        return res.json({
          success: true,
          symbol,
          resolution,
          adaptive: true,
          holdBars,
          regime: results.regime,
          reason: results.reason,
          adx: results.adx,
          currentRegime: currentRegime ? { regime: currentRegime.regime, strategy: currentRegime.strategy, reason: currentRegime.reason, adx: currentRegime.adx } : null,
          totalReturn: results.totalReturn,
          totalReturnPct: results.totalReturnPct,
          totalTrades: results.totalTrades,
          wins: results.wins,
          losses: results.losses,
          winRate: results.winRate,
          profitFactor: results.profitFactor,
          maxDrawdown: results.maxDrawdown,
          totalPnlUsd,
          maxDrawdownUsd,
          regimePerformance: results.regimePerformance,
          tradeLog: results.tradeLog,
          stats: results.stats,
          candles: actualCandles,
          lastPrice,
          dataFetchedAt: Date.now(),
        });
      }

      const strategyType = (body.strategyType === "rsi" ? "rsi" : "ema_crossover") as "ema_crossover" | "rsi";
      const results = runBacktest(actualCandles, strategyType, holdBars);
      const ticker = await getTicker(symbol);
      const totalPnlUsd = (results.totalReturnPct / 100) * nominalCapital;
      const maxDrawdownUsd = (results.maxDrawdown / 100) * nominalCapital;

      res.setHeader("Content-Type", "application/json; charset=utf-8");
      return res.json({
        success: true,
        symbol,
        resolution,
        adaptive: false,
        strategyType,
        holdBars,
        regime: results.regime,
        reason: results.reason,
        adx: results.adx,
        totalTrades: results.totalTrades,
        wins: results.wins,
        losses: results.losses,
        winRate: results.winRate,
        profitFactor: results.profitFactor,
        totalReturnPct: results.totalReturnPct,
        totalPnlUsd,
        maxDrawdown: results.maxDrawdown,
        maxDrawdownUsd,
        stats: results.stats,
        candles: actualCandles,
        lastPrice: ticker ? ticker.last_price : (actualCandles.length > 0 ? actualCandles[actualCandles.length - 1]!.close : null),
        dataFetchedAt: Date.now(),
      });
    } catch (e) {
      return res.status(500).json({
        success: false,
        error: e instanceof Error ? e.message : "Strategy test failed",
      });
    }
  });

  app.get("/api/delta/ticker", async (req, res) => {
    try {
      const symbol = (req.query.symbol as string) || "BTCUSD";
      const { getTicker, getHistory } = await import("./delta");
      let ticker = await getTicker(symbol);
      // Fallback: if ticker API fails, use last candle close from history (same API used in backtest)
      if (!ticker) {
        const end = Math.floor(Date.now() / 1000);
        const start = end - 300; // last 5 min for 1m candles
        try {
          const candles = await getHistory(symbol, "1m", start, end);
          const last = candles.length > 0 ? candles[candles.length - 1] : null;
          if (last?.close) {
            return res.json({
              success: true,
              symbol,
              lastPrice: last.close,
              markPrice: null,
              indexPrice: null,
              fetchedAt: Date.now(),
              source: "candles",
            });
          }
        } catch (_) {
          // ignore
        }
        return res.json({ success: false, error: "Ticker not found" });
      }
      return res.json({
        success: true,
        symbol: ticker.symbol,
        lastPrice: ticker.last_price,
        markPrice: ticker.mark_price || null,
        indexPrice: ticker.index_price || null,
        fetchedAt: Date.now(),
      });
    } catch (e) {
      return res.status(500).json({ success: false, error: e instanceof Error ? e.message : "Ticker fetch failed" });
    }
  });

  /** Live candles – no backtest, latest OHLC for chart (fast, no delay) */
  app.get("/api/delta/candles", async (req, res) => {
    try {
      const symbol = (req.query.symbol as string) || "BTCUSD";
      const resolution = (req.query.resolution as string) || "15m";
      const limit = Math.min(Math.max(Number(req.query.limit) || 300, 50), 1000);
      const { getHistory } = await import("./delta");
      const candles = await fetchCandlesForBacktest(symbol, resolution, getHistory);
      const sliced = candles.slice(-limit);
      return res.json({ success: true, candles: sliced, fetchedAt: Date.now() });
    } catch (e) {
      return res.status(500).json({ success: false, error: e instanceof Error ? e.message : "Candles fetch failed" });
    }
  });

  /** Pro Sniper AI backtest – BTCUSD 15m, full metrics */
  app.get("/api/pro-sniper/backtest", async (req, res) => {
    try {
      const symbol = (req.query.symbol as string) || "BTCUSD";
      const resolution = (req.query.resolution as string) || "15m";
      const { getHistory } = await import("./delta");
      const candles = await fetchCandlesForBacktest(symbol, resolution, getHistory);
      const { runProSniperBacktest } = await import("./pro-sniper/backtest");
      const { DEFAULT_PRO_SNIPER_CONFIG } = await import("./pro-sniper/types");
      const result = runProSniperBacktest(candles, DEFAULT_PRO_SNIPER_CONFIG);
      return res.json({
        success: true,
        ...result,
        config: DEFAULT_PRO_SNIPER_CONFIG,
      });
    } catch (e) {
      return res.status(500).json({
        success: false,
        error: e instanceof Error ? e.message : "Pro Sniper backtest failed",
      });
    }
  });

  /** Pro Sniper live status – current market mode and signal (uses REST candles; merge WebSocket on client/bot) */
  app.get("/api/pro-sniper/status", async (req, res) => {
    try {
      const symbol = (req.query.symbol as string) || "BTCUSD";
      const resolution = (req.query.resolution as string) || "15m";
      const { getHistory } = await import("./delta");
      const { getLatestCandle } = await import("./delta-socket");
      const { getProSniperSignal, mergeCandlesWithLive } = await import("./pro-sniper");
      let candles = await fetchCandlesForBacktest(symbol, resolution, getHistory);
      const liveCandle = getLatestCandle();
      candles = mergeCandlesWithLive(candles, liveCandle);
      const balanceUsd = 100;
      const result = getProSniperSignal(candles, balanceUsd, false);
      return res.json({
        success: true,
        marketState: result.marketState,
        signal: result.signal,
        canTrade: result.canTrade,
        reason: result.reason,
        candlesUsed: candles.length,
      });
    } catch (e) {
      return res.status(500).json({
        success: false,
        error: e instanceof Error ? e.message : "Pro Sniper status failed",
      });
    }
  });

  /** Live data from Delta WebSocket (in-memory); fallback when socket.io not used */
  app.get("/api/delta/live", async (_req, res) => {
    try {
      const { getLatestCandle, getLatestTicker, isDeltaSocketConnected } = await import("./delta-socket");
      const candle = getLatestCandle();
      const ticker = getLatestTicker();
      return res.json({
        success: true,
        candle: candle ?? null,
        ticker: ticker ?? null,
        wsConnected: isDeltaSocketConnected(),
      });
    } catch (e) {
      return res.status(500).json({ success: false, error: e instanceof Error ? e.message : "Live data failed" });
    }
  });

  app.get("/api/delta/products", async (_req, res) => {
    try {
      const { getProducts } = await import("./delta");
      const products = await getProducts();
      // Only keep futures and filter only active ones if possible, but let's return all for now
      return res.json({ success: true, products });
    } catch (e) {
      return res.status(500).json({ success: false, error: e instanceof Error ? e.message : "Failed to fetch products" });
    }
  });

  // Bot lifecycle (in-memory state)
  const {
    botStart,
    botStop,
    botGetStatus,
    botIsRunning,
    botUpdateConfig,
  } = await import("./bot-store");

  app.post("/api/bot/start", (req, res) => {
    try {
      const body = (req.body || {}) as {
        symbol?: string;
        resolution?: string;
        strategyType?: "ema_crossover" | "rsi" | "pro_sniper" | "adaptive";
        strategyPreset?: string;
        holdBars?: number;
        riskPct?: number;
        maxDailyLossPct?: number;
        cooldownMs?: number;
      };
      const st = body.strategyType;
      botStart({
        symbol: body.symbol || "BTCUSD",
        resolution: body.resolution || "15m",
        strategyType: st === "rsi" ? "rsi" : st === "pro_sniper" ? "pro_sniper" : st === "adaptive" ? "adaptive" : "ema_crossover",
        strategyPreset: (body.strategyPreset || "pro_sniper_v3") as any,
        holdBars: Math.max(1, Math.min(50, Number(body.holdBars) || 6)),
        riskPct: Math.max(0.1, Math.min(10, Number(body.riskPct) || 2)),
        maxDailyLossPct: Math.max(1, Math.min(50, Number(body.maxDailyLossPct) || 5)),
        cooldownMs: Math.max(10_000, Math.min(600_000, Number(body.cooldownMs) || 60_000)),
      });
      return res.json({ success: true, message: "Bot started", status: botGetStatus() });
    } catch (e) {
      return res.status(500).json({ success: false, error: e instanceof Error ? e.message : "Bot start failed" });
    }
  });

  app.post("/api/bot/stop", (_req, res) => {
    try {
      botStop();
      return res.json({ success: true, message: "Bot stopped", status: botGetStatus() });
    } catch (e) {
      return res.status(500).json({ success: false, error: e instanceof Error ? e.message : "Bot stop failed" });
    }
  });

  app.get("/api/bot/status", (_req, res) => {
    try {
      return res.json({ success: true, ...botGetStatus() });
    } catch (e) {
      return res.status(500).json({ success: false, error: e instanceof Error ? e.message : "Status failed" });
    }
  });

  app.put("/api/bot/config", (req, res) => {
    try {
      const body = (req.body || {}) as Record<string, unknown>;
      const partial: Record<string, unknown> = {};
      if (typeof body.symbol === "string") partial.symbol = body.symbol;
      if (typeof body.resolution === "string") partial.resolution = body.resolution;
      if (body.strategyType === "rsi" || body.strategyType === "ema_crossover" || body.strategyType === "pro_sniper" || body.strategyType === "adaptive") partial.strategyType = body.strategyType;
      if (typeof body.strategyPreset === "string") partial.strategyPreset = body.strategyPreset;
      if (body.holdBars != null) partial.holdBars = Math.max(1, Math.min(50, Number(body.holdBars) || 6));
      if (body.riskPct != null) partial.riskPct = Math.max(0.1, Math.min(10, Number(body.riskPct) || 2));
      if (body.maxDailyLossPct != null) partial.maxDailyLossPct = Math.max(1, Math.min(50, Number(body.maxDailyLossPct) || 5));
      if (body.cooldownMs != null) partial.cooldownMs = Math.max(10_000, Math.min(600_000, Number(body.cooldownMs) || 60_000));
      botUpdateConfig(partial as { symbol?: string; resolution?: string; strategyType?: "ema_crossover" | "rsi" | "pro_sniper"; holdBars?: number; riskPct?: number; maxDailyLossPct?: number; cooldownMs?: number });
      return res.json({ success: true, message: "Config saved", status: botGetStatus() });
    } catch (e) {
      return res.status(500).json({ success: false, error: e instanceof Error ? e.message : "Config update failed" });
    }
  });

  // Debug: raw Delta wallet response – fetch from Dashboard or open in new tab
  app.get("/api/debug/delta-balance", async (_req, res) => {
    const out = await getWalletBalancesRaw();
    return res.json(out);
  });

  // Debug: Delta API call karo
  app.get("/api/debug/call-delta", async (_req, res) => {
    const baseUrl = getDeltaBaseUrl();
    const balanceOut = await getWalletBalancesRaw();
    return res.json({
      message: "Delta API call ho chuki. Neeche jo data hai wahi Delta se aaya hai.",
      baseUrl,
      balanceResponse: balanceOut,
    });
  });

  // Debug: Test Delta API connection with detailed error
  app.get("/api/debug/test-delta", async (_req, res) => {
    const keys = getDeltaKeys();
    if (!keys) {
      return res.json({
        error: "No API keys configured",
        help: "Set DELTA_API_KEY and DELTA_SECRET_KEY in .env file",
      });
    }

    try {
      const out = await getWalletBalancesRaw();
      return res.json({
        baseUrl: getDeltaBaseUrl(),
        hasKeys: true,
        apiKeyPrefix: keys.apiKey.substring(0, 8) + "...",
        response: out,
        instruction: out.success
          ? "✅ Connection successful!"
          : `❌ Error: ${out.error?.message || "Unknown error"}\n\n` +
          `Common fixes:\n` +
          `1. Check if your IP is whitelisted in Delta Exchange API settings\n` +
          `2. Verify API keys are correct\n` +
          `3. For India API, make sure DELTA_BASE_URL=https://api.india.delta.exchange\n` +
          `4. Check if API keys have proper permissions (Read access minimum)`,
      });
    } catch (e) {
      return res.json({
        error: "Exception occurred",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  });

  // Full setup check: keys source, server IP, one Delta call result
  app.get("/api/debug/setup-status", async (_req, res) => {
    const keys = getDeltaKeys();
    let serverIp: string | null = null;
    try {
      const r = await fetch("https://api.ipify.org?format=json");
      const d = (await r.json()) as { ip?: string };
      serverIp = d?.ip ?? null;
    } catch {
      // ignore
    }
    const keysSource = process.env.DELTA_API_KEY && process.env.DELTA_SECRET_KEY
      ? "env"
      : keys
        ? "client_sync"
        : "none";
    if (!keys) {
      return res.json({
        ok: false,
        keysSource: "none",
        message: "No API keys. Add DELTA_API_KEY + DELTA_SECRET_KEY in .env or save keys from Settings.",
        serverIp,
        deltaBaseUrl: getDeltaBaseUrl(),
      });
    }
    const balanceOut = await getWalletBalances();
    const deltaOk = balanceOut.success;
    const deltaError = balanceOut.error?.message || balanceOut.error?.code || null;
    const deltaErrorCode = balanceOut.error?.code;
    const deltaErrorFriendly = deltaErrorReason(deltaErrorCode, deltaError ?? undefined);
    return res.json({
      ok: deltaOk,
      keysSource,
      apiKeyPrefix: keys?.apiKey ? keys.apiKey.substring(0, 4) : undefined,
      serverIp,
      deltaBaseUrl: getDeltaBaseUrl(),
      deltaBalanceTest: deltaOk ? "success" : "failed",
      deltaError: deltaError || undefined,
      deltaErrorFriendly: deltaOk ? undefined : deltaErrorFriendly,
      checklist: [
        "1. API calls ho rahi hain: Client → Server → Delta (yes)",
        keysSource === "none" ? "2. Keys: .env ya Settings se set karo" : "2. Keys: set (" + keysSource + ")",
        serverIp ? `3. Delta pe ye IP whitelist karo: ${serverIp}` : "3. Server IP: fetch failed",
        "4. Delta Exchange → API Management → Read + Trading enable karo",
        deltaOk ? "5. Delta API: OK" : "5. Delta API: " + (deltaError || "Unauthorized – IP/permissions check karo"),
      ],
    });
  });

  // Get user's public IP for whitelisting
  app.get("/api/debug/my-ip", async (_req, res) => {
    try {
      const response = await fetch("https://api.ipify.org?format=json");
      const data = await response.json() as { ip: string };
      return res.json({
        yourPublicIP: data.ip,
        instruction:
          "⚠️ Add this IP address to Delta Exchange API whitelist:\n\n" +
          `1. Go to https://www.delta.exchange/app/account/api\n` +
          `2. Find your API key settings\n` +
          `3. Add IP: ${data.ip} to the whitelist\n` +
          `4. Save and try again`,
      });
    } catch (e) {
      return res.json({
        error: "Could not fetch IP",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  });

  return httpServer;
}
