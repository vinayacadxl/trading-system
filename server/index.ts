import "dotenv/config";
import express from "express";
import { createServer } from "http";
import { Server as SocketIOServer } from "socket.io";
import * as path from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { registerRoutes } from "./routes";
import { setupVite } from "./vite";
import { serveStatic } from "./static";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * 🚀 SCALPER BOT RUNNER with DASHBOARD
 * Optimized execution path + isolated monitoring UI.
 */

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

export function log(message: string, source = "bot") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

(async () => {
  log("Starting Scalper Engine & Dashboard...");

  // --- 🌐 START HTTP SERVER (DASHBOARD) ---
  const httpServer = await registerRoutes(app);

  // --- 📡 SOCKET.IO SETUP (Frontend Live Data) ---
  const io = new SocketIOServer(httpServer, {
    cors: { origin: "*", methods: ["GET", "POST"] },
    path: "/socket.io/",
  });

  io.on("connection", (socket) => {
    log(`Frontend client connected: ${socket.id}`, "socket");
    socket.on("disconnect", () => {
      log(`Frontend client disconnected: ${socket.id}`, "socket");
    });
  });

  // --- 🔥 ENGINE STATUS BROADCASTER (every 2s to frontend) ---
  const { startEngineStatusBroadcast } = await import("./engine-status");
  startEngineStatusBroadcast(io);

  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    await setupVite(app, httpServer);
  }

  const port = Number(process.env.PORT) || 5001;
  httpServer.listen(port, "0.0.0.0", () => {
    log(`📊 Dashboard ready at http://0.0.0.0:${port}`);
  });

  // --- 🧠 START PYTHON BRAIN LAYER (MARKET FILTER) ---
  const spawnPythonFilter = (cmd = process.platform === 'win32' ? "python" : "python3") => {
    const pyPath = path.join(__dirname, "../python_service/market_filter.py");
    log(`Launching Python Market Filter: ${pyPath} (using ${cmd})`);

    // -X utf8 flag: Force Python to use UTF-8 (fixes emoji/unicode issues)
    const pyProcess = spawn(cmd, ["-X", "utf8", pyPath], {
      env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" },
      shell: process.platform === 'win32' // Use shell on Windows to find python in PATH
    });

    pyProcess.on("error", (err: any) => {
      if (err.code === 'ENOENT') {
        log(`Python command '${cmd}' not found.`, "filter");
        // Add a small delay before retrying to ensure we don't hit a tight loop
        setTimeout(() => {
          if (cmd === "python3") {
            log("Retrying with 'python'...", "filter");
            spawnPythonFilter("python");
          } else if (cmd === "python") {
            log("Retrying with 'py'...", "filter");
            spawnPythonFilter("py");
          } else {
            log("Critical: Python is not installed or not in PATH.", "filter");
          }
        }, 1000);
      } else {
        log(`Python filter process error: ${err.message}`, "filter");
      }
    });

    pyProcess.stdout.on("data", (data) => log(`[PYTHON-STDOUT] ${data.toString("utf8").trim()}`, "filter"));
    pyProcess.stderr.on("data", (data) => log(`[PYTHON-STDERR] ${data.toString("utf8").trim()}`, "filter"));

    pyProcess.on("close", (code) => {
      if (code !== 0 && code !== null) {
        log(`Python filter exited with code ${code}. Re-spawning in 5s...`);
        setTimeout(() => spawnPythonFilter(cmd), 5000);
      }
    });
  };

  spawnPythonFilter(); // Automatically picks based on platform

  // --- ⚡ DELTA WEBSOCKET & TRADER INITIALIZATION ---
  const { startDeltaSocket } = await import("./delta-socket");
  const { getMultiSymbolManager } = await import("./multi-symbol-manager");
  const manager = getMultiSymbolManager();
  const allSymbols = manager.getConfig().symbols;

  const { handleOrderbookUpdate } = await import("./multi-symbol-trader");
  const { handleTickerUpdate } = await import("./position-manager");
  const { updateEngineState, setWsConnected } = await import("./engine-status");

  log(`Initializing WebSocket for ${allSymbols.length} symbols...`);

  // --- 📊 Per-symbol price history for real-time direction detection ---
  // Since Delta WS v2/ticker may not always include change24h, we track price ourselves
  const priceHistory = new Map<string, Array<{ price: number; time: number }>>();

  function getPriceDirection(symbol: string, currentPrice: number): {
    direction: "buy" | "sell" | "neutral";
    changePct: number;
  } {
    const history = priceHistory.get(symbol) || [];
    history.push({ price: currentPrice, time: Date.now() });
    if (history.length > 30) history.shift();
    priceHistory.set(symbol, history);

    if (history.length < 3) return { direction: "neutral", changePct: 0 };

    // Compare vs ~10 ticks ago for short-term momentum
    const refIndex = Math.max(0, history.length - 10);
    const refPrice = history[refIndex].price;
    const changePct = refPrice > 0 ? ((currentPrice - refPrice) / refPrice) * 100 : 0;

    // Very sensitive: 0.03% move = directional signal
    const direction: "buy" | "sell" | "neutral" =
      changePct > 0.03 ? "buy" : changePct < -0.03 ? "sell" : "neutral";

    return { direction, changePct };
  }

  startDeltaSocket({
    candleSymbol: "BTCUSD",
    tickerSymbols: allSymbols,
    emit: (event, payload) => {
      // --- 📡 BROADCAST TO FRONTEND via Socket.IO ---
      io.emit(event, payload);

      // --- ⚡ LIGHTNING SCALPER EVENT BUS (PARALLEL EXECUTION) ⚡ ---
      if (event === 'live-orderbook') {
        const bestBid = parseFloat(payload.bids[0]?.price || "0");
        if (bestBid > 0) {
          handleOrderbookUpdate(payload.symbol, bestBid);
        }

        // ✅ Update scanner direction from orderbook imbalance (real-time signal)
        const mgr = manager;
        const bids: any[] = payload.bids || [];
        const asks: any[] = payload.asks || [];
        const bidVol = bids.slice(0, 5).reduce((s: number, b: any) => s + parseFloat(b.size || "0"), 0);
        const askVol = asks.slice(0, 5).reduce((s: number, a: any) => s + parseFloat(a.size || "0"), 0);
        const imbalance = askVol > 0 ? bidVol / askVol : 1.0;

        const existing = mgr.getSignal(payload.symbol);
        if (existing && existing.lastPrice > 0) {
          let obDirection: "buy" | "sell" | "neutral" = existing.direction;
          if (imbalance > 1.25) obDirection = "buy";
          else if (imbalance < 0.80) obDirection = "sell";
          const obConfidence = Math.min(1.0, Math.abs(imbalance - 1) * 2.5 + 0.35);
          const obStrength = mgr.calculateSignalStrength(obDirection, obConfidence * 100, 0.5, existing.regime);
          mgr.updateSignal(payload.symbol, {
            ...existing,
            direction: obDirection,
            confidence: Math.max(existing.confidence, obConfidence),
            signalStrength: Math.max(existing.signalStrength, obStrength),
            lastUpdate: Date.now(),
          });
        }

      } else if (event === 'live-ticker') {
        const price = parseFloat(payload.lastPrice || "0");
        if (price <= 0) return;

        // Mark WS as connected
        setWsConnected(true);

        // ✅ Real direction from price movement tracking
        const { direction: movDir, changePct: movChange } = getPriceDirection(payload.symbol, price);

        // Also check if parseTicker extracted change24h (from open price field)
        const tickerChange24h: number = typeof payload.change24h === "number" ? payload.change24h : 0;

        // Prefer ticker 24h change if substantial; else use short-term movement
        let direction: "buy" | "sell" | "neutral";
        let effectiveChangePct: number;
        if (Math.abs(tickerChange24h) > 0.05) {
          direction = tickerChange24h > 0 ? "buy" : "sell";
          effectiveChangePct = Math.abs(tickerChange24h);
        } else {
          direction = movDir;
          // Scale movChange (tiny %) to appear like a bigger % for regime detection
          effectiveChangePct = Math.abs(movChange) * 20;
        }

        const mgr = manager;
        const regime = effectiveChangePct > 2 ? "TRENDING" : effectiveChangePct > 0.5 ? "TREND" : "RANGE";
        // Always at least 35% confidence so scanner doesn't sit empty
        const confidence = Math.max(0.35, Math.min(1.0, effectiveChangePct / 4));
        const strength = mgr.calculateSignalStrength(direction, confidence * 100, 0.5, regime);

        mgr.updateSignal(payload.symbol, {
          symbol: payload.symbol,
          signalStrength: strength,
          direction,
          confidence,
          regime,
          lastPrice: price,
          change24h: tickerChange24h || movChange,
          lastUpdate: Date.now(),
        });

        // ✅ Dynamic Confidence: Use the strongest signal from the scanner for the dashboard meter
        const allSignals = mgr.getAllSignals();
        const topSignal = allSignals.length > 0 ? allSignals[0] : null;

        let dashboardConfidence = 0.15; // default idle
        let dashboardMomentum: "HIGH" | "MEDIUM" | "LOW" = "LOW";

        if (topSignal && topSignal.signalStrength > 30) {
          dashboardConfidence = topSignal.signalStrength / 100;
          dashboardMomentum = topSignal.signalStrength > 75 ? "HIGH" : topSignal.signalStrength > 45 ? "MEDIUM" : "LOW";
        } else {
          // fallback to momentum if no scanner signals
          dashboardConfidence = Math.max(0.15, Math.min(0.85, effectiveChangePct / 4));
          dashboardMomentum = effectiveChangePct > 3 ? "HIGH" : effectiveChangePct > 1 ? "MEDIUM" : "LOW";
        }

        updateEngineState({ momentum: dashboardMomentum, lastPrice: price, confidence: dashboardConfidence });

        handleTickerUpdate(payload.symbol, price);
      }
    },
    log,
  });

  log("✅ System is ONLINE. Bot is scalping, Dashboard is live.");
})();
