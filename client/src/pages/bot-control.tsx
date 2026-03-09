import { useState, useEffect } from "react";
import { Play, Square, Settings2, ShieldAlert, Cpu, Wallet, BarChart3, AlertTriangle, RotateCcw, Trash2 } from "lucide-react";
import { usePortfolio } from "@/hooks/use-portfolio";
import { useToast } from "@/hooks/use-toast";

const ALL_MODELS = [
    {
        id: "alpha_one",
        name: "🎯 ALPHA ONE — Profit Mode (AI Brain)",
        leverage: 20,
        rr: "1:3.3 R:R (Golden Ratio)",
        type: "adaptive",
        desc: "Sniper: 60%+ win-rate target. High-conviction setups only. Elite trend alignment (EMA200), accelerators (ADX 25+) & adaptive filters.",
    },
];

export default function BotControl() {
    const [isRunning, setIsRunning] = useState(false);
    const [symbol, setSymbol] = useState("BTCUSD");
    const [resolution, setResolution] = useState("15m");
    const [selectedModel] = useState("alpha_one");
    const [riskPct, setRiskPct] = useState(1.5);
    const [maxPositions, setMaxPositions] = useState(2);
    const [loading, setLoading] = useState(false);
    const [botStatus, setBotStatus] = useState<any>(null);
    const { data: portfolio } = usePortfolio(20_000);
    const { toast } = useToast();

    const model = ALL_MODELS.find((m) => m.id === selectedModel) ?? ALL_MODELS[0];
    const bal = portfolio ? parseFloat(String(portfolio.portfolioValue ?? "0")) : 0;

    useEffect(() => {
        fetch("/api/bot/status").then((r) => r.json()).then((d) => { setBotStatus(d); setIsRunning(d?.running ?? false); }).catch(() => { });
        const t = setInterval(() => {
            fetch("/api/bot/status").then((r) => r.json()).then((d) => setBotStatus(d)).catch(() => { });
        }, 5000);
        return () => clearInterval(t);
    }, []);

    async function startBot() {
        setLoading(true);
        try {
            const r = await fetch("/api/bot/start", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ symbol, resolution, strategy: selectedModel, riskPercent: riskPct, maxPositions }),
            });
            const d = await r.json();
            if (r.ok) { setIsRunning(true); toast({ title: "Bot started ✅", description: `Trading ${symbol} on ${resolution}` }); }
            else { toast({ title: "Error", description: d?.message ?? "Could not start bot", variant: "destructive" }); }
        } catch { toast({ title: "Network error", variant: "destructive" }); }
        setLoading(false);
    }

    async function stopBot() {
        setLoading(true);
        try {
            const r = await fetch("/api/bot/stop", { method: "POST" });
            if (r.ok) { setIsRunning(false); toast({ title: "Bot stopped", description: "All active monitors stopped" }); }
            else { toast({ title: "Error stopping bot", variant: "destructive" }); }
        } catch { toast({ title: "Network error", variant: "destructive" }); }
        setLoading(false);
    }

    async function resetBotState() {
        try {
            const r = await fetch("/api/bot/reset", { method: "POST" });
            if (r.ok) { toast({ title: "Bot state reset ✅" }); }
            else { toast({ title: "Reset failed", variant: "destructive" }); }
        } catch { toast({ title: "Network error", variant: "destructive" }); }
    }

    async function closeAllPositions() {
        if (!confirm("Close ALL open positions? This cannot be undone.")) return;
        try {
            const r = await fetch("/api/bot/close-all", { method: "POST" });
            const d = await r.json();
            toast({ title: r.ok ? "Positions closed ✅" : "Error", description: d?.message, variant: r.ok ? "default" : "destructive" });
        } catch { toast({ title: "Network error", variant: "destructive" }); }
    }

    const inputCls = "form-input";

    return (
        <>
            <div className="topbar">
                <div>
                    <div className="topbar-title">Bot Control</div>
                    <div className="topbar-sub">Configure and manage your trading bot</div>
                </div>
                <div className="topbar-right">
                    <div title={bal > 0 ? "Live account balance" : "Estimated balance"}
                        className="price-pill"
                        style={{
                            background: "rgba(255,255,255,0.03)",
                            border: '1px solid var(--bdr)',
                            color: "var(--green)",
                            cursor: "help",
                        }}>
                        <Wallet size={11} />
                        ${bal.toFixed(2)}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 16px", borderRadius: 99, border: `1px solid ${isRunning ? "var(--brand-dim)" : "var(--bdr)"}`, background: "rgba(255,255,255,0.03)" }}>
                        <div style={{ width: 6, height: 6, borderRadius: "50%", background: isRunning ? "var(--brand)" : "var(--tx3)", boxShadow: isRunning ? "0 0 10px var(--brand-glow)" : "none" }} />
                        <span style={{ fontSize: 11, fontWeight: 800, color: isRunning ? "var(--brand)" : "var(--tx2)", textTransform: 'uppercase', letterSpacing: '0.5px' }}>{isRunning ? "RUNNING" : "STOPPED"}</span>
                    </div>
                </div>
            </div>

            <div className="page">
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
                    {/* Strategy */}
                    <div className="card">
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 18 }}>
                            <div style={{ width: 32, height: 32, borderRadius: 9, background: "var(--indigo-dim)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--indigo)" }}><Cpu size={15} /></div>
                            <div><div style={{ fontSize: 13, fontWeight: 700, color: "var(--tx1)" }}>Strategy</div><div style={{ fontSize: 10, color: "var(--tx3)" }}>AI Brain Config</div></div>
                        </div>
                        <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid var(--bdr)", borderRadius: 10, padding: "16px", marginBottom: 16 }}>
                            <div style={{ fontSize: 14, fontWeight: 800, color: "var(--tx1)", marginBottom: 8 }}>{model.name}</div>
                            <div style={{ fontSize: 11, color: "var(--tx2)", lineHeight: 1.6, marginBottom: 14 }}>{model.desc}</div>
                            <div style={{ display: "flex", gap: 8 }}>
                                <span className="bd ip" style={{ fontSize: 9 }}>Lev {model.leverage}x</span>
                                <span className="bd c" style={{ fontSize: 9 }}>{model.rr}</span>
                                <span className="bd p" style={{ fontSize: 9 }}>{model.type}</span>
                            </div>
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                            <div className="form-group">
                                <label className="form-label">Symbol</label>
                                <select className={inputCls} value={symbol} onChange={(e) => setSymbol(e.target.value)}>
                                    {["BTCUSD", "ETHUSD", "SOLUSD", "XRPUSD", "BNBUSD"].map((s) => <option key={s}>{s}</option>)}
                                </select>
                            </div>
                            <div className="form-group">
                                <label className="form-label">Timeframe</label>
                                <select className={inputCls} value={resolution} onChange={(e) => setResolution(e.target.value)}>
                                    {["1m", "3m", "5m", "15m", "30m", "1h"].map((s) => <option key={s}>{s}</option>)}
                                </select>
                            </div>
                        </div>
                    </div>

                    {/* Risk */}
                    <div className="card">
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 18 }}>
                            <div style={{ width: 32, height: 32, borderRadius: 9, background: "rgba(16,185,129,0.10)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--green)" }}><ShieldAlert size={15} /></div>
                            <div><div style={{ fontSize: 13, fontWeight: 700, color: "var(--tx1)" }}>Risk Management</div><div style={{ fontSize: 10, color: "var(--tx3)" }}>Position sizing</div></div>
                        </div>
                        <div className="form-group" style={{ marginBottom: 16 }}>
                            <label className="form-label">Risk per Trade — {riskPct.toFixed(1)}% of balance</label>
                            <input type="range" min={0.5} max={5} step={0.5} value={riskPct}
                                onChange={(e) => setRiskPct(parseFloat(e.target.value))}
                                style={{ width: "100%", accentColor: "var(--indigo)" }}
                            />
                            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--tx3)", marginTop: 4 }}>
                                <span>0.5%</span><span>5.0%</span>
                            </div>
                        </div>
                        <div className="form-group" style={{ marginBottom: 16 }}>
                            <label className="form-label">Max simultaneous positions</label>
                            <input type="range" min={1} max={5} step={1} value={maxPositions}
                                onChange={(e) => setMaxPositions(parseInt(e.target.value))}
                                style={{ width: "100%", accentColor: "var(--indigo)" }}
                            />
                            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--tx3)", marginTop: 4 }}>
                                <span>1</span><span>5</span>
                            </div>
                            <div style={{ textAlign: "center", fontSize: 12, fontWeight: 700, color: "var(--indigo)", marginTop: 4 }}>{maxPositions} positions</div>
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                            <ValBox label="Risk Amount" value={`$${(bal * riskPct / 100).toFixed(2)}`} tone="g" />
                            <ValBox label="Max Positions" value={String(maxPositions)} tone="p" />
                        </div>
                    </div>
                </div>

                {/* Controls */}
                <div className="card">
                    <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".8px", color: "var(--tx3)", marginBottom: 14 }}>Bot Controls</div>
                    <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                        <button className="btn btn-g" onClick={startBot} disabled={isRunning || loading}
                            style={{ opacity: isRunning ? 0.45 : 1, pointerEvents: isRunning ? "none" : "auto" }}>
                            <Play size={14} />{loading && !isRunning ? "Starting…" : "Start Bot"}
                        </button>
                        <button className="btn btn-r" onClick={stopBot} disabled={!isRunning || loading}
                            style={{ opacity: !isRunning ? 0.45 : 1, pointerEvents: !isRunning ? "none" : "auto" }}>
                            <Square size={14} />{loading && isRunning ? "Stopping…" : "Stop Bot"}
                        </button>
                        <button className="btn btn-dk" onClick={resetBotState}>
                            <RotateCcw size={14} />Reset State
                        </button>
                        <button className="btn btn-r" onClick={closeAllPositions}
                            style={{ background: "transparent", border: "1px solid var(--red-dim)", color: "var(--red)", boxShadow: "none" }}>
                            <Trash2 size={14} />Close All Positions
                        </button>
                    </div>
                </div>

                {/* Status */}
                {botStatus && (
                    <div className="card">
                        <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".8px", color: "var(--tx3)", marginBottom: 14 }}>Live Status</div>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12 }}>
                            <ValBox label="Active Monitors" value={String(botStatus?.activeMonitors ?? 0)} tone="p" />
                            <ValBox label="Trade Count" value={String(botStatus?.tradeCount ?? 0)} tone="g" />
                            <ValBox label="Open Positions" value={String(botStatus?.openPositions ?? 0)} tone="p" />
                            <ValBox label="Daily PNL" value={`${botStatus?.dailyPnl >= 0 ? "+" : ""}$${(botStatus?.dailyPnl ?? 0).toFixed(2)}`} tone={botStatus?.dailyPnl >= 0 ? "g" : "r"} />
                        </div>
                    </div>
                )}

                {/* Risk Warning */}
                <div className="card r" style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                    <AlertTriangle size={18} style={{ color: "var(--red)", flexShrink: 0, marginTop: 2 }} />
                    <div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--red)", marginBottom: 4 }}>Risk Disclaimer</div>
                        <div style={{ fontSize: 12, color: "var(--tx2)", lineHeight: 1.7 }}>
                            Algorithmic trading involves significant risk. Past performance does not guarantee future results.
                            Only trade with funds you can afford to lose. Always monitor your positions and set appropriate stop losses.
                        </div>
                    </div>
                </div>
            </div>
        </>
    );
}

function ValBox({ label, value, tone }: { label: string; value: string; tone?: "g" | "r" | "p" }) {
    const vc = tone === "g" ? "var(--green)" : tone === "r" ? "var(--red)" : tone === "p" ? "var(--brand)" : "var(--tx1)";
    return (
        <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid var(--bdr)", borderRadius: 8, padding: "10px 14px" }}>
            <div style={{ fontSize: 9, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".8px", color: "var(--tx3)", marginBottom: 6 }}>{label}</div>
            <div style={{ fontFamily: "var(--mono)", fontSize: 14, fontWeight: 800, color: vc }}>{value}</div>
        </div>
    );
}
