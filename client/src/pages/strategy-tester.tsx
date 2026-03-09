import { useState, useEffect } from "react";
import { Play, BarChart2, AlertTriangle, RefreshCw, Clock, Wallet } from "lucide-react";

const SYMBOLS = ["BTCUSD", "ETHUSD", "SOLUSD", "XRPUSD", "BNBUSD"];
const TIMEFRAMES = ["5m", "15m", "30m", "1h", "4h", "1d"];
const STRATS = [
    { id: "alpha_one", name: "🎯 ALPHA ONE (AI Brain)", desc: "High-conviction setups, 60%+ win-rate target" },
    { id: "scalp", name: "⚡ Fast Scalper", desc: "Order flow imbalance, 1-5 minute holds" },
    { id: "momentum", name: "📈 Momentum Rider", desc: "Trend following with ADX filter" },
];

interface BacktestResult {
    totalTrades: number;
    winRate: number;
    profitFactor: number;
    totalPnl: number;
    maxDrawdown: number;
    avgWin: number;
    avgLoss: number;
    sharpe: number;
    trades: any[];
    initialBalance?: number;
}

export default function StrategyTester() {
    const [symbol, setSymbol] = useState("BTCUSD");
    const [tf, setTf] = useState("15m");
    const [strategy, setStrategy] = useState("alpha_one");
    const [startDate, setStart] = useState(() => {
        const d = new Date(); d.setDate(d.getDate() - 195); return d.toISOString().split("T")[0];
    });
    const [endDate, setEnd] = useState(() => new Date().toISOString().split("T")[0]);
    const [riskPct, setRiskPct] = useState(1.5);
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState<BacktestResult | null>(null);
    const [error, setError] = useState("");
    const [liveBalance, setLiveBalance] = useState<number | null>(null);

    // Fetch real account balance on mount
    useEffect(() => {
        fetch("/api/delta/balance")
            .then(r => r.json())
            .then(d => {
                const bal = parseFloat(d.portfolioValue);
                if (bal > 0) setLiveBalance(bal);
            })
            .catch(() => { });
    }, []);

    const fmt = (n: number, d = 2) => n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });

    async function runBacktest() {
        setLoading(true); setError(""); setResult(null);
        try {
            // Use real account balance if available, else 1000
            const initialBalance = liveBalance && liveBalance > 0 ? liveBalance : 1000;
            const r = await fetch("/api/backtest/run", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ symbol, resolution: tf, strategy, startDate, endDate, riskPercent: riskPct, initialBalance }),
            });
            const d = await r.json();
            if (!r.ok) { setError(d?.message ?? d?.error ?? "Backtest failed"); }
            else { setResult(d); }
        } catch (e: any) { setError(e.message ?? "Network error"); }
        setLoading(false);
    }

    const usedBalance = result?.initialBalance ?? liveBalance ?? 1000;

    return (
        <>
            <div className="topbar">
                <div>
                    <div className="topbar-title">Strategy Tester</div>
                    <div className="topbar-sub">Backtest trading strategies on historical data</div>
                </div>
                {/* Live balance badge in topbar */}
                {liveBalance !== null && (
                    <div style={{ display: "flex", alignItems: "center", gap: 8, background: "rgba(129,140,248,0.1)", border: "1px solid rgba(129,140,248,0.25)", borderRadius: 10, padding: "6px 14px" }}>
                        <Wallet size={13} style={{ color: "var(--indigo)" }} />
                        <span style={{ fontSize: 12, color: "var(--tx2)", fontWeight: 600 }}>
                            Backtest Balance:&nbsp;<span style={{ color: "var(--indigo)", fontFamily: "var(--mono)" }}>${fmt(liveBalance)}</span>
                            <span style={{ color: "var(--tx3)", fontWeight: 400, marginLeft: 6 }}>(live account)</span>
                        </span>
                    </div>
                )}
            </div>

            <div className="page">
                {/* Config */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
                    {/* Left: strategy + symbols */}
                    <div className="card">
                        <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".8px", color: "var(--tx3)", marginBottom: 16 }}>Strategy & Market</div>
                        <div className="form-group" style={{ marginBottom: 14 }}>
                            <label className="form-label">Strategy</label>
                            <select className="form-input" value={strategy} onChange={(e) => setStrategy(e.target.value)}>
                                {STRATS.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                            </select>
                            <div style={{ fontSize: 11, color: "var(--tx3)", marginTop: 6, lineHeight: 1.5 }}>
                                {STRATS.find((s) => s.id === strategy)?.desc}
                            </div>
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                            <div className="form-group">
                                <label className="form-label">Symbol</label>
                                <select className="form-input" value={symbol} onChange={(e) => setSymbol(e.target.value)}>
                                    {SYMBOLS.map((s) => <option key={s}>{s}</option>)}
                                </select>
                            </div>
                            <div className="form-group">
                                <label className="form-label">Timeframe</label>
                                <select className="form-input" value={tf} onChange={(e) => setTf(e.target.value)}>
                                    {TIMEFRAMES.map((t) => <option key={t}>{t}</option>)}
                                </select>
                            </div>
                        </div>
                    </div>

                    {/* Right: date range + risk */}
                    <div className="card">
                        <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".8px", color: "var(--tx3)", marginBottom: 16 }}>Date Range & Risk</div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
                            <div className="form-group">
                                <label className="form-label">From</label>
                                <input type="date" className="form-input" value={startDate} onChange={(e) => setStart(e.target.value)} />
                            </div>
                            <div className="form-group">
                                <label className="form-label">To</label>
                                <input type="date" className="form-input" value={endDate} onChange={(e) => setEnd(e.target.value)} />
                            </div>
                        </div>
                        <div className="form-group">
                            <label className="form-label">Risk per Trade — {riskPct.toFixed(1)}%</label>
                            <input type="range" min={0.5} max={5} step={0.5} value={riskPct}
                                onChange={(e) => setRiskPct(parseFloat(e.target.value))}
                                style={{ width: "100%", accentColor: "var(--indigo)" }} />
                            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--tx3)", marginTop: 4 }}>
                                <span>0.5%</span><span>5.0%</span>
                            </div>
                        </div>

                        {/* Balance info box */}
                        <div style={{ background: "rgba(129,140,248,0.07)", border: "1px solid rgba(129,140,248,0.2)", borderRadius: 8, padding: "8px 12px", marginTop: 10, fontSize: 11, color: "var(--tx2)" }}>
                            <Wallet size={11} style={{ color: "var(--indigo)", verticalAlign: "middle", marginRight: 5 }} />
                            Simulating with:&nbsp;
                            <strong style={{ color: "var(--indigo)", fontFamily: "var(--mono)" }}>
                                ${fmt(liveBalance ?? 1000)}
                            </strong>
                            <span style={{ color: "var(--tx3)", marginLeft: 4 }}>
                                {liveBalance ? "(your live balance)" : "(default – balance not fetched yet)"}
                            </span>
                        </div>

                        <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
                            <button className="btn btn-p" onClick={runBacktest} disabled={loading} style={{ flex: 1, justifyContent: "center" }}>
                                {loading ? <><div className="spinner" style={{ width: 14, height: 14 }} /> Running…</> : <><Play size={13} />Run Backtest</>}
                            </button>
                            {result && (
                                <button className="btn btn-dk" onClick={() => setResult(null)}>
                                    <RefreshCw size={13} />Reset
                                </button>
                            )}
                        </div>
                    </div>
                </div>

                {/* Error */}
                {error && (
                    <div className="card r" style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <AlertTriangle size={16} style={{ color: "var(--red)", flexShrink: 0 }} />
                        <span style={{ fontSize: 13, color: "var(--tx1)" }}>{error}</span>
                    </div>
                )}

                {/* Loading */}
                {loading && (
                    <div className="card" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14, padding: "36px 20px" }}>
                        <div className="spinner" style={{ width: 32, height: 32, borderWidth: 3 }} />
                        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--tx2)" }}>Running backtest on {symbol} {tf}…</div>
                        <div style={{ fontSize: 11, color: "var(--tx3)" }}>This may take 15–30 seconds</div>
                    </div>
                )}

                {/* Results */}
                {result && (
                    <>
                        {/* Balance used banner */}
                        <div style={{ display: "flex", alignItems: "center", gap: 10, background: "rgba(16,185,129,0.07)", border: "1px solid rgba(16,185,129,0.2)", borderRadius: 10, padding: "10px 16px" }}>
                            <Wallet size={14} style={{ color: "var(--green)" }} />
                            <span style={{ fontSize: 12, color: "var(--tx2)" }}>
                                Backtest simulated with&nbsp;
                                <strong style={{ color: "var(--green)", fontFamily: "var(--mono)", fontSize: 14 }}>${fmt(usedBalance)}</strong>
                                &nbsp;starting balance — PnL dollar amounts are based on this capital
                            </span>
                        </div>

                        {/* Summary stats */}
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14 }}>
                            <ResBox label="Total PNL" value={`${result.totalPnl >= 0 ? "+" : ""}$${fmt(result.totalPnl)}`} tone={result.totalPnl >= 0 ? "g" : "r"} />
                            <ResBox label="Win Rate" value={`${result.winRate.toFixed(1)}%`} sub={`${result.totalTrades} trades`} tone={result.winRate >= 55 ? "g" : result.winRate >= 45 ? "p" : "r"} />
                            <ResBox label="Profit Factor" value={fmt(result.profitFactor)} tone={result.profitFactor >= 1.5 ? "g" : result.profitFactor >= 1 ? "p" : "r"} />
                            <ResBox label="Max Drawdown" value={`${result.maxDrawdown.toFixed(1)}%`} tone={result.maxDrawdown < 10 ? "g" : result.maxDrawdown < 20 ? "a" : "r"} />
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14 }}>
                            <ResBox label="Avg Win" value={`$${fmt(result.avgWin)}`} tone="g" />
                            <ResBox label="Avg Loss" value={`-$${fmt(Math.abs(result.avgLoss))}`} tone="r" />
                            <ResBox label="Sharpe" value={fmt(result.sharpe, 3)} tone={result.sharpe > 1 ? "g" : result.sharpe > 0 ? "p" : "r"} />
                            <ResBox label="Total Trades" value={String(result.totalTrades)} tone="p" />
                        </div>

                        {/* Trade list */}
                        {result.trades && result.trades.length > 0 && (
                            <div className="card" style={{ padding: 0, overflow: "hidden" }}>
                                <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--bdr)" }}>
                                    <div className="sec-title"><BarChart2 size={12} />Trade Breakdown</div>
                                </div>
                                <div className="tbl-wrap">
                                    <table className="tbl">
                                        <thead><tr><th>#</th><th>Side</th><th>Entry</th><th>Exit</th><th>PNL</th><th>Duration</th></tr></thead>
                                        <tbody>
                                            {result.trades.slice(0, 50).map((t: any, i: number) => {
                                                const pnl = t.pnl ?? t.profit ?? 0;
                                                const dur = t.durationMins ? `${t.durationMins}m` : "—";
                                                return (
                                                    <tr key={i}>
                                                        <td><span style={{ fontSize: 11, color: "var(--tx3)" }}>#{i + 1}</span></td>
                                                        <td><span className={`bd ${t.side === "buy" ? "g" : "r"}`} style={{ fontSize: 9 }}>{t.side === "buy" ? "LONG" : "SHORT"}</span></td>
                                                        <td><span className="mono">${fmt(t.entry)}</span></td>
                                                        <td><span className="mono" style={{ color: "var(--tx2)" }}>${fmt(t.exit)}</span></td>
                                                        <td><span className="mono" style={{ fontWeight: 700, color: pnl >= 0 ? "var(--green)" : "var(--red)" }}>{pnl >= 0 ? "+" : ""}${fmt(pnl)}</span></td>
                                                        <td><span style={{ fontSize: 11, color: "var(--tx3)", display: "flex", alignItems: "center", gap: 4 }}><Clock size={10} />{dur}</span></td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )}
                    </>
                )}
            </div>
        </>
    );
}

function ResBox({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "g" | "r" | "p" | "a" }) {
    const col = tone === "g" ? "var(--green)" : tone === "r" ? "var(--red)" : tone === "p" ? "var(--indigo)" : tone === "a" ? "var(--amber)" : "var(--tx1)";
    const bg = tone === "g" ? "rgba(16,185,129,0.06)" : tone === "r" ? "rgba(244,63,94,0.06)" : tone === "p" ? "rgba(129,140,248,0.06)" : tone === "a" ? "rgba(245,158,11,0.06)" : "rgba(0,0,0,0.15)";
    return (
        <div style={{ background: bg, border: `1px solid ${tone === "g" ? "rgba(16,185,129,0.15)" : tone === "r" ? "rgba(244,63,94,0.15)" : tone === "p" ? "rgba(129,140,248,0.15)" : "var(--bdr2)"}`, borderRadius: 12, padding: "16px 18px" }}>
            <div style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".8px", color: "var(--tx3)", marginBottom: 8 }}>{label}</div>
            <div style={{ fontFamily: "var(--mono)", fontSize: 22, fontWeight: 800, color: col, lineHeight: 1 }}>{value}</div>
            {sub && <div style={{ fontSize: 10, color: "var(--tx3)", marginTop: 6 }}>{sub}</div>}
        </div>
    );
}
