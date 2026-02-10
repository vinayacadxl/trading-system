import "dotenv/config";
import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";

const app = express();
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      const logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      log(logLine);
    }
  });

  next();
});

(async () => {
  // 1) Mount API routes FIRST so /api/* is always handled by Express and returns JSON.
  //    This must run before Vite/static so API requests are never served HTML.
  await registerRoutes(httpServer, app);
  log("Routes registered and Delta API keys initialization checked.");

  // 2) Error handler (for errors thrown from API routes).
  app.use((err: any, req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    const path = req.path || "";
    if (path.startsWith("/api/delta/")) {
      res.status(200);
      if (path.startsWith("/api/delta/fills")) {
        return res.json({ success: true, fills: [], meta: {}, errorMessage: message });
      }
      return res.json({ success: true, balances: [], portfolioValue: "0.00", currency: "USD", errorMessage: message });
    }
    return res.status(status).json({ message });
  });

  // 3) Vite (dev) or static (prod) ONLY for non-API requests. API routes above handle /api/*.
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // 4) Fallback: if an /api request was not handled above, return JSON 404 (never HTML).
  app.use((req, res, next) => {
    if ((req.originalUrl || req.path || "").startsWith("/api")) {
      return res.status(404).set("Content-Type", "application/json").json({ success: false, error: "API route not found" });
    }
    next();
  });

  // Socket.IO for live data (delta-socket forwards here)
  const { Server: SocketServer } = await import("socket.io");
  const io = new SocketServer(httpServer, {
    cors: { origin: process.env.NODE_ENV === "production" ? false : "*" },
    path: "/socket.io/",
  });
  io.on("connection", (socket) => {
    log(`Socket.IO client connected: ${socket.id} (chart should get live-ticker now).`);
  });

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  const isWindows = process.platform === "win32";
  httpServer.listen(
    {
      port,
      host: isWindows ? "127.0.0.1" : "0.0.0.0",
      ...(isWindows ? {} : { reusePort: true }),
    },
    async () => {
      log(`serving on port ${port}`);
      startBotLoop();
      // Delta WebSocket (live candle + ticker); forward to socket.io
      const { startDeltaSocket } = await import("./delta-socket");
      startDeltaSocket({
        candleSymbol: "BTCUSD",
        tickerSymbol: "BTCUSD",
        emit: (event, payload) => {
          io.emit(event, payload);
        },
        log: log,
      });
      log("Delta WebSocket started (live-candle, live-ticker).");

      // Server-side: har 400ms ticker bhejo – chart fast update (REST fallback; WS se bhi emit hota hai jab Delta bhejta hai)
      const { getTicker } = await import("./delta");
      let lastPayload: { symbol: string; lastPrice: string; markPrice?: string; indexPrice?: string } | null = null;
      let emitCount = 0;

      const sendTicker = (payload: { symbol: string; lastPrice: string; markPrice?: string; indexPrice?: string }) => {
        lastPayload = payload;
        io.emit("live-ticker", payload);
        emitCount++;
        if (emitCount === 1) log("live-ticker first emit (chart should update).");
      };

      const runTickerEmit = async () => {
        try {
          for (const sym of ["BTCUSD", "BTCUSDT"]) {
            let payload: { symbol: string; lastPrice: string; markPrice?: string; indexPrice?: string } | null = null;
            const t = await getTicker(sym);
            const price = t?.last_price ?? t?.mark_price;
            if (t && price) {
              payload = {
                symbol: t.symbol,
                lastPrice: String(price),
                markPrice: t.mark_price ? String(t.mark_price) : undefined,
                indexPrice: t.index_price ? String(t.index_price) : undefined,
              };
            }
            if (!payload) {
              const base = `http://127.0.0.1:${port}`;
              const res = await fetch(`${base}/api/delta/ticker?symbol=${encodeURIComponent(sym)}&_t=${Date.now()}`);
              const data = await res.json().catch(() => null);
              if (data?.success && (data?.lastPrice != null || data?.markPrice != null)) {
                const p = data.lastPrice ?? data.markPrice;
                payload = {
                  symbol: data.symbol || sym,
                  lastPrice: String(p),
                  markPrice: data.markPrice != null ? String(data.markPrice) : undefined,
                  indexPrice: data.indexPrice != null ? String(data.indexPrice) : undefined,
                };
              }
            }
            if (payload) {
              sendTicker(payload);
              return;
            }
          }
          if (!lastPayload && emitCount === 0) {
            log("live-ticker: no ticker data (check Delta API keys in Settings).");
          } else if (lastPayload) {
            io.emit("live-ticker", lastPayload);
          }
        } catch {
          if (lastPayload) io.emit("live-ticker", lastPayload);
        }
      };

      runTickerEmit(); // first run immediately so chart gets data on load
      setInterval(runTickerEmit, 400); // 400ms = ~2.5 updates/sec for snappy chart
    },
  );
})();

/** Bot loop: every 15s, fetch candles, run strategy, place order if signal (with risk checks). */
function startBotLoop(): void {
  const INTERVAL_MS = 15_000;
  setInterval(async () => {
    try {
      const { botIsRunning, botGetConfig, botStop, botRecordTrade, botDailyLossExceeded, botCanTrade, botPositionSize, botSetCurrentRegime } = await import("./bot-store");
      if (!botIsRunning()) return;

      const config = botGetConfig();
      const { getHistory, getPositions, getTicker, placeOrder, getPortfolioValueUsd } = await import("./delta");
      const { getCurrentSignalAdaptive, getCurrentSignal } = await import("./strategy-engine");

      const balanceUsd = await getPortfolioValueUsd();
      if (balanceUsd <= 0) return;

      if (botDailyLossExceeded(balanceUsd)) {
        botStop();
        log("Bot stopped: daily loss limit exceeded.", "bot");
        return;
      }

      if (!botCanTrade()) return;

      let minutes = parseInt(config.resolution, 10) || 15;
      if (config.resolution.includes("h")) minutes *= 60;
      if (config.resolution.includes("d")) minutes *= 1440;
      const end = Math.floor(Date.now() / 1000);
      const start = end - 250 * minutes * 60;
      let candles = await getHistory(config.symbol, config.resolution, start, end);
      candles = [...candles].sort((a, b) => a.time - b.time);

      const positionsOut = await getPositions();
      const positions = positionsOut.success && Array.isArray(positionsOut.result) ? positionsOut.result : [];
      const openForSymbol = positions.filter((p: { symbol?: string }) => p.symbol === config.symbol);
      const hasLong = openForSymbol.some((p: { size?: number }) => (p.size ?? 0) > 0);
      const hasShort = openForSymbol.some((p: { size?: number }) => (p.size ?? 0) < 0);
      const hasOpenPosition = hasLong || hasShort;

      let signal: "buy" | "sell" | null;
      let price: number;
      let size: number;

      if (config.strategyType === "pro_sniper") {
        const minCandles = 220;
        if (candles.length < minCandles) return;
        const { getLatestCandle } = await import("./delta-socket");
        const { getProSniperSignal, mergeCandlesWithLive } = await import("./pro-sniper");
        candles = mergeCandlesWithLive(candles, getLatestCandle());
        const result = getProSniperSignal(candles, balanceUsd, hasOpenPosition);
        if (result.marketState) {
          botSetCurrentRegime({
            regime: result.marketState.mode,
            strategy: result.marketState.engine,
            reason: result.marketState.reason,
            adx: result.marketState.adx,
          });
        }
        if (!result.signal || !result.canTrade) return;
        signal = result.signal.side;
        price = result.signal.entryPrice;
        size = result.positionSize;
      } else if (config.strategyType === "adaptive") {
        const minCandles = 201;
        if (candles.length < minCandles) return;
        const adaptiveResult = getCurrentSignalAdaptive(candles, config.strategyPreset);
        if (adaptiveResult.regime) {
          let statusMsg = `Scanning ${adaptiveResult.regime.regime}...`;
          if (adaptiveResult.signal) {
            statusMsg = `Signal Detected: ${adaptiveResult.signal.toUpperCase()} (${adaptiveResult.confidence}% confidence)`;
          } else if (adaptiveResult.regime.strategy === "SCALPING") {
            statusMsg = "Targeting scalp on volume spike";
          } else if (adaptiveResult.regime.strategy === "EMA_TREND") {
            statusMsg = "Riding trend - waiting for pullback";
          }

          botSetCurrentRegime({
            regime: adaptiveResult.regime.regime,
            strategy: adaptiveResult.regime.strategy,
            reason: adaptiveResult.regime.reason,
            adx: adaptiveResult.regime.adx
          }, adaptiveResult.confidence, statusMsg);

          if (adaptiveResult.regime.isExtremeVolatility) return;
          signal = adaptiveResult.signal;
        } else {
          botSetCurrentRegime(undefined, 0, "Initializing strategy...");
          signal = null;
        }
        if (!signal) return;
        if (signal === "buy" && hasLong) return;
        if (signal === "sell" && hasShort) return;
        const ticker = await getTicker(config.symbol);
        price = ticker ? parseFloat(ticker.last_price) : parseFloat(candles[candles.length - 1]!.close);
        size = botPositionSize(balanceUsd, price);
      } else {
        const minCandles = 100;
        if (candles.length < minCandles) return;
        signal = getCurrentSignal(candles, config.strategyType);
        botSetCurrentRegime(undefined);
        if (!signal) return;
        if (signal === "buy" && hasLong) return;
        if (signal === "sell" && hasShort) return;
        const ticker = await getTicker(config.symbol);
        price = ticker ? parseFloat(ticker.last_price) : parseFloat(candles[candles.length - 1]!.close);
        size = botPositionSize(balanceUsd, price);
      }

      if (!price || price <= 0) return;
      if (size <= 0) return;

      const order = await placeOrder({
        symbol: config.symbol,
        side: signal,
        size,
        order_type: "market",
      });

      if (order.success && order.result) {
        const res = order.result as { id?: number; symbol?: string; side?: string; size?: number };
        botRecordTrade({
          symbol: config.symbol,
          side: signal,
          size,
          price: String(price),
          orderId: res.id,
          status: "executed",
        });
        log(`Bot placed ${signal} ${size} ${config.symbol} @ ${price}`, "bot");
      }
    } catch (e) {
      console.error("Bot loop error:", e);
    }
  }, INTERVAL_MS);
  log("Bot loop started (every 15s).", "bot");
}
