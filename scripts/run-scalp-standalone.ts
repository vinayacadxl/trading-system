/**
 * Backtest – Python AI Engine Only
 * Usage:
 *   npm run backtest
 *   npx tsx scripts/run-scalp-standalone.ts BTCUSD
 *   npx tsx scripts/run-scalp-standalone.ts BTCUSD,ETHUSD,SOLUSD
 */
import "dotenv/config";

const symbolArg = process.argv.slice(2).join(",") || "BTCUSD,ETHUSD,SOLUSD,DOGEUSD,XRPUSD";
const symbols = symbolArg.split(",").map(s => s.trim().toUpperCase()).filter(Boolean);
const resolution = "15m";
const CANDLES_PER_SYMBOL = 2688; // 28 days of 15m data (matches debug-backtest)
const MINUTES = 15;

type CandleLike = { time: number; open: string; high: string; low: string; close: string; volume: string };
type TradeLog = { pnlUsd: number; signal: string; entryPrice: number; exitPrice: number; exitReason: string; regime: string };

async function main() {
  console.log("\n═══════════════════════════════════════════");
  console.log("  BACKTEST – Python AI Engine  [5-Layer V20]");
  console.log("  Symbols: " + symbols.join(", ") + "  |  " + resolution);
  console.log("═══════════════════════════════════════════\n");

  const { getHistory, getPortfolioValueUsd } = await import("../server/delta");

  // --- Capital ---
  let capital = 41; // default
  try {
    const b = await getPortfolioValueUsd();
    if (b > 0) capital = b;
  } catch (_) { }
  console.log("  Capital : $" + capital.toFixed(2) + "\n");

  // ─────────────────────────────────────────────────────────────────────
  // Config: 5-Layer V20 Advanced Strategy
  //  TRENDING : TP 1.5% / SL 0.7%  (R:R 2.1)
  //  NEUTRAL  : TP 0.8% / SL 0.4%  (R:R 2.0)
  //  REGIME_CFG in Python will use these as defaults per regime
  //  Pass 0 (null) to let Python use its per-regime defaults
  // ─────────────────────────────────────────────────────────────────────
  const cfg = {
    leverage: 20,          // Max leverage cap
    nominalCapital: capital,
    qualityThreshold: 70,          // Quality gate: 70+ required
    confidenceGate: 0.56,
    maxTradesPerDay: 60,
    minBarsBetweenTrades: 1,
    // TP/SL: 0 = let Python use regime defaults (TRENDING/NEUTRAL/VOLATILE)
    tpHigh: 0,           // → Python uses 0.015 (TRENDING)
    slHigh: 0,           // → Python uses 0.007 (TRENDING)
    tpMid: 0,           // → Python uses 0.008 (NEUTRAL)
    slMid: 0,           // → Python uses 0.004 (NEUTRAL)
    leverageCapHigh: 20,          // Max 20x for TRENDING
    leverageCapMid: 15,          // Max 15x for NEUTRAL
  };


  // --- Check Python is alive ---
  try {
    const health = await fetch("http://127.0.0.1:5006/health", { signal: AbortSignal.timeout(3000) });
    if (!health.ok) throw new Error("not ok");
    console.log("  ✅ Python AI (port 5006) is online\n");
  } catch (_) {
    console.error("  ❌ Python AI (port 5006) is OFFLINE.");
    console.error("     Start it: cd python_service && python main.py\n");
    process.exit(1);
  }

  // --- Run per symbol ---
  const allTrades: TradeLog[] = [];
  let totalPnl = 0;
  let totalWins = 0;
  let totalLosses = 0;
  let symbolsRan = 0;

  for (const symbol of symbols) {
    process.stdout.write(`  [${symbol}] Fetching candles (15m + 1h)... `);

    const end = Math.floor(Date.now() / 1000);
    const start15m = end - CANDLES_PER_SYMBOL * 15 * 60;
    const start1h = end - (CANDLES_PER_SYMBOL / 4) * 60 * 60; // Fetch proportional 1h data

    let candles15m: any[] = [];
    let candles1h: any[] = [];

    try {
      const res15 = await getHistory(symbol, "15m", start15m, end);
      candles15m = (res15 || []).sort((a: any, b: any) => a.time - b.time);

      const res1h = await getHistory(symbol, "1h", start1h, end);
      candles1h = (res1h || []).sort((a: any, b: any) => a.time - b.time);
    } catch (e) {
      console.log(`FAILED (${(e as Error).message})`);
      continue;
    }

    if (candles15m.length < 500) {
      console.log(`SKIPPED (too few candles)`);
      continue;
    }
    console.log(`OK (15m: ${candles15m.length}, 1h: ${candles1h.length})`);

    // --- Send to Python with MTF Support ---
    process.stdout.write(`  [${symbol}] Running AI Backtest [MTF Mode]... `);
    try {
      const res = await fetch("http://127.0.0.1:5006/backtest/universal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol,
          candles: candles15m,
          candles_1h: candles1h,
          ...cfg
        }),

        signal: AbortSignal.timeout(120000),
      });


      if (!res.ok) {
        console.log(`FAILED (HTTP ${res.status})`);
        continue;
      }

      const data = await res.json();
      if (!data.success) {
        console.log(`FAILED (${data.error || "unknown error"})`);
        continue;
      }

      const trades: TradeLog[] = data.tradeLog || [];
      const wins = trades.filter(t => t.pnlUsd > 0).length;
      const losses = trades.filter(t => t.pnlUsd <= 0).length;
      const symPnl = trades.reduce((s, t) => s + t.pnlUsd, 0);
      const wr = trades.length > 0 ? (wins / trades.length * 100).toFixed(1) : "0";

      console.log(`DONE → ${trades.length} trades | WR ${wr}% | P&L ${symPnl >= 0 ? "+" : ""}${symPnl.toFixed(2)} USD`);

      allTrades.push(...trades);
      totalPnl += symPnl;
      totalWins += wins;
      totalLosses += losses;
      symbolsRan++;

    } catch (e) {
      console.log(`TIMEOUT/ERROR (${(e as Error).message})`);
    }

    // Small delay between symbols
    if (symbols.indexOf(symbol) < symbols.length - 1) {
      await new Promise(r => setTimeout(r, 500));
    }
  }

  // --- Final Report ---
  console.log("\n═══════════════════ COMBINED RESULT ═══════════════════");

  if (allTrades.length === 0) {
    console.log("  No trades generated.");
    console.log("  Reasons: market sideways, Python AI too strict, or data issue.");
    process.exit(0); // Exit 0 = not an error, just no signals
  }

  const totalTrades = allTrades.length;
  const wr = (totalWins / totalTrades * 100);
  const grossWin = allTrades.filter(t => t.pnlUsd > 0).reduce((s, t) => s + t.pnlUsd, 0);
  const grossLoss = Math.abs(allTrades.filter(t => t.pnlUsd <= 0).reduce((s, t) => s + t.pnlUsd, 0));
  const pf = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? 999 : 0;
  const avgWin = totalWins > 0 ? grossWin / totalWins : 0;
  const avgLoss = totalLosses > 0 ? grossLoss / totalLosses : 0;

  const f = (n: number) => (n >= 0 ? "+" : "") + n.toFixed(2);

  console.log(`  Symbols Tested:    ${symbolsRan} / ${symbols.length}`);
  console.log(`  Total Trades:      ${totalTrades}  (Wins: ${totalWins}, Losses: ${totalLosses})`);
  console.log(`  Win Rate:          ${wr.toFixed(1)}%`);
  console.log(`  Profit Factor:     ${pf.toFixed(2)}`);
  console.log(`  Total P&L:         ${f(totalPnl)} USD`);
  console.log(`  Avg Win / Trade:   +${avgWin.toFixed(2)} USD`);
  console.log(`  Avg Loss / Trade:  -${avgLoss.toFixed(2)} USD`);
  console.log("───────────────────────────────────────────────────────");

  // Tier breakdown
  const tiers: Record<string, { t: number; w: number; pnl: number }> = {};
  for (const t of allTrades) {
    const tier = t.regime || "UNKNOWN";
    if (!tiers[tier]) tiers[tier] = { t: 0, w: 0, pnl: 0 };
    tiers[tier].t++;
    tiers[tier].pnl += t.pnlUsd;
    if (t.pnlUsd > 0) tiers[tier].w++;
  }
  console.log("  TIER BREAKDOWN:");
  for (const [tier, s] of Object.entries(tiers)) {
    const twr = s.t > 0 ? (s.w / s.t * 100).toFixed(0) : "0";
    console.log(`    ${tier.padEnd(10)}: ${String(s.t).padStart(3)} trades | WR ${twr}% | P&L ${f(s.pnl)} USD`);
  }

  console.log("═══════════════════════════════════════════════════════\n");
}

main().catch(e => { console.error(e); process.exit(1); });
