import { useState, useEffect } from "react";
import { usePortfolio } from "@/hooks/use-portfolio";
import { usePositions } from "@/hooks/use-positions";
import { useLiveDelta } from "@/hooks/use-live-delta";
import { useEngineStatus } from "@/hooks/use-engine-status";
import { CandlestickChart, type CandleInput } from "@/components/CandlestickChart";
import { Wifi, WifiOff, Activity, BarChart3, Target, Cpu, Zap, AlertTriangle, TrendingUp, TrendingDown } from "lucide-react";


const fmt = (n: number, d = 2) =>
    n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const ago = (ts: number) => {
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60) return `${s}s`;
    if (s < 3600) return `${Math.floor(s / 60)}m`;
    return `${Math.floor(s / 3600)}h`;
};

function useSignals() {
    const [sigs, setSigs] = useState<any[]>([]);
    useEffect(() => {
        const load = () =>
            fetch("/api/bot/signals")
                .then((r) => r.json())
                .then((d) => { if (Array.isArray(d)) setSigs(d.slice(0, 8)); })
                .catch(() => { });
        load();
        const t = setInterval(load, 5000);
        return () => clearInterval(t);
    }, []);
    return sigs;
}

function useCandles(sym: string, tf: string) {
    const [c, setC] = useState<CandleInput[]>([]);
    useEffect(() => {
        fetch(`/api/delta/candles?symbol=${sym}&resolution=${tf}&count=200`)
            .then((r) => r.json())
            .then((d) => { if (Array.isArray(d)) setC(d); })
            .catch(() => { });
    }, [sym, tf]);
    return c;
}

type Tone = "g" | "r" | "p" | "a" | undefined;

function StatCard({
    label, value, sub, tone, Icon,
}: {
    label: string; value: string; sub?: string; tone?: Tone; Icon: React.ElementType;
}) {
    const ic =
        tone === "g" ? "var(--green)" :
            tone === "r" ? "var(--red)" :
                tone === "p" ? "var(--brand)" :
                    tone === "a" ? "var(--amber)" :
                        "var(--tx2)";

    return (
        <div className="card" style={{ padding: '20px' }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
                <span style={{
                    width: 32, height: 32, borderRadius: 8,
                    background: "rgba(255,255,255,0.03)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    color: ic,
                    border: '1px solid var(--bdr)',
                }}>
                    <Icon size={14} />
                </span>
                <span style={{ fontSize: 11, fontWeight: 700, color: "var(--tx2)", textTransform: 'uppercase', letterSpacing: '0.5px' }}>{label}</span>
            </div>
            <div style={{ fontSize: 24, fontWeight: 800, color: "#fff", letterSpacing: '-0.5px' }}>{value}</div>
            {sub && <div style={{ fontSize: 11, color: "var(--tx3)", marginTop: 4 }}>{sub}</div>}
        </div>
    );
}

function ECell({ lbl, val, t }: { lbl: string; val: string; t?: "g" | "r" | "a" | "p" }) {
    return (
        <div className="eng-cell">
            <div className="eng-cell-lbl">{lbl}</div>
            <div className={`eng-cell-val${t ? " " + t : ""}`}>{val ?? "—"}</div>
        </div>
    );
}

export default function Dashboard() {
    const { data: port, error: portError } = usePortfolio(15_000);
    const { positions, unrealizedPnl } = usePositions(8_000);
    const { tickers, connected } = useLiveDelta();
    const e = useEngineStatus();
    const sigs = useSignals();

    const [sym, setSym] = useState("BTCUSD");
    const [tf, setTf] = useState("15m");
    const candles = useCandles(sym, tf);

    const bal = port ? parseFloat(String(port.portfolioValue ?? "0")) : 0;
    const isFallback = port?.isFallback ?? false;

    const currentTicker = tickers[sym];
    const price = currentTicker?.lastPrice ? Number(currentTicker.lastPrice) : null;
    const score = e.confidence?.score ?? 0;
    const posArr = positions ?? [];
    const unPnl = unrealizedPnl ?? 0;

    return (
        <>
            {/* ── Topbar ───────────────────────────────── */}
            <div className="topbar">
                <div>
                    <div className="topbar-title">Dashboard</div>
                    <div className="topbar-sub">Real-time trading overview</div>
                </div>
                <div className="topbar-right">
                    {tickers["BTCUSD"] && (
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <span style={{ fontSize: 10, fontWeight: 700, color: "var(--tx3)", letterSpacing: 1 }}>BTC</span>
                            <span style={{ fontFamily: "var(--mono)", fontSize: 16, fontWeight: 700, color: "var(--tx1)" }}>
                                ${fmt(Number(tickers["BTCUSD"].lastPrice))}
                            </span>
                        </div>
                    )}
                    <div title={isFallback ? "⚠️ Estimated balance — whitelist IP on Delta Exchange" : "Live account balance"}
                        className="price-pill"
                        style={{
                            background: "rgba(255,255,255,0.03)",
                            border: `1px solid var(--bdr)`,
                            color: isFallback ? "var(--amber)" : "var(--green)",
                            cursor: "help",
                        }}>
                        {isFallback && <AlertTriangle size={11} />}
                        {isFallback ? "~" : ""}{fmt(bal)}
                    </div>

                    <span style={{
                        display: "flex", alignItems: "center", justifyContent: "center",
                        width: 34, height: 34, borderRadius: 10,
                        background: "rgba(255,255,255,0.03)",
                        border: `1px solid var(--bdr)`,
                        color: connected ? "var(--green)" : "var(--red)",
                    }}>
                        {connected ? <Wifi size={15} /> : <WifiOff size={15} />}
                    </span>
                </div>
            </div>

            {/* IP Whitelisting Error Alert */}
            {portError && (portError.includes("ip_not_whitelisted") || portError.includes("whitelist")) && (
                <div style={{ margin: "0 24px 16px", padding: "12px 20px", background: "rgba(255,77,109,0.08)", border: "1px solid rgba(255,77,109,0.28)", borderRadius: 12, display: "flex", alignItems: "center", gap: 12 }}>
                    <div style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--red)", boxShadow: "0 0 6px var(--red-glow)" }} />
                    <div style={{ flex: 1, fontSize: 13, color: "var(--red)", fontWeight: 500 }}>
                        IP Not Whitelisted: Please add your IP to Delta API settings.
                    </div>
                    <button
                        onClick={() => fetch("/api/debug/setup-status").then(r => r.json()).then(d => {
                            if (d.serverIp) {
                                navigator.clipboard.writeText(d.serverIp);
                                alert(`IP Copied: ${d.serverIp}`);
                            }
                        })}
                        className="btn btn-dk" style={{ padding: "4px 12px", fontSize: 11 }}>Copy IP</button>
                </div>
            )}

            {/* ── Page ─────────────────────────────────── */}
            <div className="page">
                {/* Stats row */}
                <div className="stats-grid">
                    <StatCard label="Portfolio Balance" value={`${isFallback ? "~" : ""}$${fmt(bal)}`}
                        sub={isFallback ? "⚠️ Estimated — IP not whitelisted" : "Live USDT Balance"}
                        tone={isFallback ? "a" : bal > 0 ? "g" : undefined} Icon={isFallback ? AlertTriangle : BarChart3} />

                    <StatCard label="Unrealised PNL" value={`${unPnl >= 0 ? "+" : ""}$${fmt(unPnl)}`}
                        sub={`${posArr.length} open position${posArr.length !== 1 ? "s" : ""}`}
                        tone={unPnl >= 0 ? "g" : "r"} Icon={unPnl >= 0 ? TrendingUp : TrendingDown} />
                    <StatCard label="Bot Status" value={(e as any).wsConnected ? "LIVE" : "OFFLINE"}
                        sub={(e as any).wsConnected ? "Scanning markets" : "No connection"}
                        tone={(e as any).wsConnected ? "g" : "r"} Icon={Cpu} />
                    <StatCard label="AI Confidence" value={`${Math.round(score * 100)}%`}
                        sub="Signal quality"
                        tone={score >= 0.65 ? "g" : score >= 0.4 ? "p" : "r"} Icon={Target} />
                </div>

                {/* Chart + Side panel */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 360px", gap: 14 }}>
                    {/* Chart */}
                    <div className="chart-box">
                        <div className="chart-hd">
                            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                <span style={{ fontWeight: 800, fontSize: 15, color: "var(--tx1)", letterSpacing: "-.3px" }}>{sym}</span>
                                {price && <span style={{ fontFamily: "var(--mono)", fontSize: 20, fontWeight: 700, color: "var(--tx1)" }}>${fmt(price)}</span>}
                            </div>
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                <select value={sym} onChange={(ev) => setSym(ev.target.value)}
                                    style={{ background: "transparent", border: "1px solid var(--bdr)", borderRadius: 8, padding: "5px 12px", fontSize: 12, color: "var(--tx1)", cursor: "pointer", outline: "none" }}>
                                    {["BTCUSD", "ETHUSD", "SOLUSD", "XRPUSD", "BCHUSD", "LTCUSD", "LINKUSD"].map((s) => <option key={s} style={{ background: '#000' }}>{s}</option>)}
                                </select>
                                <div style={{ display: "flex", gap: 4, background: "rgba(255,255,255,0.03)", borderRadius: 8, padding: 3, border: "1px solid var(--bdr)" }}>
                                    {["5m", "15m", "1h"].map((t) => (
                                        <button key={t} onClick={() => setTf(t)} style={{
                                            padding: "4px 12px", borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: "pointer",
                                            border: 'none',
                                            background: tf === t ? "var(--brand-dim)" : "transparent",
                                            color: tf === t ? "var(--brand)" : "var(--tx2)",
                                            transition: "all .2s",
                                        }}>{t}</button>
                                    ))}
                                </div>
                            </div>
                        </div>
                        <div style={{ height: 350 }}>
                            <CandlestickChart candles={candles} currentPrice={price ?? undefined} resolution={tf} height={350} />
                        </div>
                    </div>

                    {/* Positions + Signals column */}
                    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                        {/* Open Positions */}
                        <div className="card" style={{ flex: 1, padding: 0, overflow: "hidden" }}>
                            <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--bdr)", display: "flex", alignItems: "center", gap: 8 }}>
                                <div className="sec-title">Open Positions</div>
                                {posArr.length > 0 && (
                                    <span className="bd p" style={{ marginLeft: "auto" }}>{posArr.length}</span>
                                )}
                            </div>
                            <div style={{ padding: "10px 14px", display: "flex", flexDirection: "column", gap: 8, maxHeight: 210, overflowY: "auto" }}>
                                {posArr.length === 0 ? (
                                    <div className="empty-state" style={{ padding: "26px 0" }}>
                                        <BarChart3 size={28} />
                                        <span>No open positions</span>
                                    </div>
                                ) : posArr.map((p: any, i: number) => {
                                    const pnl = parseFloat(String(p.unrealized_pnl ?? 0)) || 0;
                                    return (
                                        <div key={i} className="pos-card">
                                            <div className={`pos-badge ${p.size > 0 ? "long" : "short"}`}>
                                                {p.size > 0 ? "LONG" : "SHORT"}
                                            </div>
                                            <div style={{ flex: 1 }}>
                                                <div style={{ fontSize: 13, fontWeight: 700, color: "var(--tx1)" }}>{p.symbol}</div>
                                                <div style={{ fontSize: 11, color: "var(--tx2)", marginTop: 2 }}>
                                                    {Math.abs(p.size)} @ ${fmt(parseFloat(p.entry_price ?? "0"))}
                                                </div>
                                            </div>
                                            <div style={{ textAlign: "right" }}>
                                                <div style={{ fontFamily: "var(--mono)", fontSize: 13, fontWeight: 700, color: pnl >= 0 ? "var(--green)" : "var(--red)" }}>
                                                    {pnl >= 0 ? "+" : ""}${fmt(pnl)}
                                                </div>
                                                <div style={{ fontSize: 10, color: "var(--tx3)", marginTop: 2 }}>PNL</div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Signals */}
                        <div className="card" style={{ flex: 1, padding: 0, overflow: "hidden" }}>
                            <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--bdr)", display: "flex", alignItems: "center", gap: 8 }}>
                                <div className="sec-title">Signal History</div>
                                {sigs.length > 0 && (
                                    <span className="bd c" style={{ marginLeft: "auto" }}>{sigs.length}</span>
                                )}
                            </div>
                            <div style={{ padding: "10px 14px", display: "flex", flexDirection: "column", gap: 6, maxHeight: 210, overflowY: "auto" }}>
                                {sigs.length === 0 ? (
                                    <div className="empty-state" style={{ padding: "26px 0" }}>
                                        <Activity size={28} />
                                        <span>No signals yet</span>
                                    </div>
                                ) : sigs.map((s: any) => (
                                    <div key={s.id} style={{
                                        display: "flex", alignItems: "center", justifyContent: "space-between",
                                        padding: "8px 10px", borderRadius: 9,
                                        background: s.action === "executed"
                                            ? "rgba(74,222,128,0.08)"
                                            : "rgba(0,0,0,0.20)",
                                        border: `1px solid ${s.action === "executed" ? "rgba(74,222,128,0.18)" : "var(--bdr)"}`,
                                        transition: "all .15s",
                                    }}>
                                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                            <span style={{
                                                width: 6, height: 6, borderRadius: "50%",
                                                background: s.signal === "buy" ? "var(--green)" : "var(--red)",
                                                boxShadow: `0 0 6px ${s.signal === "buy" ? "var(--green-glow)" : "var(--red-glow)"}`,
                                                flexShrink: 0,
                                            }} />
                                            <span style={{ fontFamily: "var(--mono)", fontSize: 11, fontWeight: 700, color: s.signal === "buy" ? "var(--green)" : "var(--red)" }}>
                                                {s.signal?.toUpperCase()}
                                            </span>
                                            <span style={{ fontSize: 11, color: "var(--tx2)" }}>{s.symbol}</span>
                                        </div>
                                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                            <span style={{ fontSize: 10, color: "var(--tx3)", fontFamily: "var(--mono)" }}>{s.confidence}%</span>
                                            <span className={`bd ${s.action === "executed" ? "g" : s.action === "failed" ? "r" : "dk"}`}>{s.action}</span>
                                            <span style={{ fontSize: 10, color: "var(--tx3)" }}>{ago(s.time)}</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Engine Status */}
                <div>
                    <div className="sec-hd">
                        <div className="sec-title"><Cpu size={12} />Live Engine Status</div>
                        <span className={`bd ${(e as any).wsConnected ? "g" : "dk"}`}>
                            <span className="dot" />{(e as any).wsConnected ? "Live" : "Offline"}
                        </span>
                    </div>
                    <div className="engine-grid">
                        <ScalpPanel e={e} />
                        <ConfPanel e={e} />
                        <ExitPanel e={e} />
                        <ScanPanel e={e} />
                    </div>
                </div>
            </div>
        </>
    );
}

/* ─── Engine sub‑panels ─────────────────────────────────── */

function ScalpPanel({ e }: { e: any }) {
    const d = e.scalpingEngine;
    if (!d) return <EngEmpty title="⚡ Fast Scalping" />;
    const active = d.entrySignal && !d.cooldown;
    const noTradeReason = (d.noTradeReason || "").trim();
    return (
        <div className="card" style={{ padding: '16px' }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                <div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: "var(--tx3)", textTransform: 'uppercase', letterSpacing: '0.5px' }}>⚡ Fast Scalping</div>
                    <div style={{ fontSize: 16, fontWeight: 800, color: "var(--tx1)", marginTop: 2 }}>{d.symbol}</div>
                </div>
                <span className={`bd ${active ? "g" : d.cooldown ? "a" : "dk"}`} style={{ fontSize: 10 }}>{active ? "SIGNAL" : d.cooldown ? "COOL" : "IDLE"}</span>
            </div>
            {!active && noTradeReason && (
                <div style={{ fontSize: 10, color: "var(--amber)", marginBottom: 10, padding: "6px 8px", background: "rgba(245,158,11,0.08)", borderRadius: 6 }}>
                    <strong>No trade:</strong> {noTradeReason}
                </div>
            )}
            <div className="eng-grid2">
                <ECell lbl="Imbalance" val={`${d.imbalance?.toFixed(2)}x`} t={d.imbalance > 1.2 ? "g" : d.imbalance < 0.8 ? "r" : undefined} />
                <ECell lbl="Spread" val={d.spread} t={d.spread === "OK" ? "g" : "a"} />
                <ECell lbl="TradeFlow" val={d.tradeFlow?.split(" ")[0]} t={d.tradeFlow?.includes("BUY") ? "g" : d.tradeFlow?.includes("SELL") ? "r" : undefined} />
                <ECell lbl="Trades" val={`${d.activeTrades}/${d.maxTrades}`} t={d.activeTrades > 0 ? "p" : undefined} />
            </div>
        </div>
    );
}

function ConfPanel({ e }: { e: any }) {
    const d = e.confidence;
    const pct = Math.round((d?.score ?? 0) * 100);
    const bc = "var(--brand)";
    return (
        <div className="card" style={{ padding: '16px' }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                <div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: "var(--tx3)", textTransform: 'uppercase', letterSpacing: '0.5px' }}>🎯 AI Confidence</div>
                    <div style={{ fontSize: 24, fontWeight: 800, marginTop: 4, color: pct >= 65 ? "var(--green)" : pct >= 40 ? "var(--amber)" : "var(--red)" }}>
                        {pct}%
                    </div>
                </div>
                <span className={`bd ${pct >= 65 ? "g" : pct >= 40 ? "a" : "r"}`} style={{ fontSize: 10 }}>{pct >= 65 ? "HIGH" : pct >= 40 ? "MED" : "LOW"}</span>
            </div>
            <div className="bar-track" style={{ height: 4, background: 'rgba(255,255,255,0.03)', marginBottom: 16 }}>
                <div className="bar-fill" style={{ width: `${pct}%`, background: bc, boxShadow: `0 0 10px ${bc}` }} />
            </div>
            <div className="eng-grid2">
                <ECell lbl="OB Strength" val={d?.orderbookStrength ?? "—"} t={d?.orderbookStrength === "Strong" ? "g" : d?.orderbookStrength === "Weak" ? "r" : undefined} />
                <ECell lbl="Momentum" val={d?.momentum ?? "—"} t={d?.momentum === "HIGH" ? "g" : d?.momentum === "LOW" ? "r" : undefined} />
                <ECell lbl="Flow" val={d?.tradeFlow ?? "—"} t={d?.tradeFlow === "BUY" ? "g" : d?.tradeFlow === "SELL" ? "r" : undefined} />
                <ECell lbl="Spread" val={d?.spreadStable ? "Stable" : "Volatile"} t={d?.spreadStable ? "g" : "a"} />
            </div>
        </div>
    );
}

function ExitPanel({ e }: { e: any }) {
    const d = e.dynamicExit;
    const hp = d?.maxHoldSec > 0 ? Math.min(100, (d.holdTimeSec / d.maxHoldSec) * 100) : 0;
    const hc = hp > 80 ? "var(--red)" : hp > 50 ? "var(--amber)" : "var(--brand)";
    return (
        <div className="card" style={{ padding: '16px' }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                <div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: "var(--tx3)", textTransform: 'uppercase', letterSpacing: '0.5px' }}>🔁 Dynamic Exit</div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "var(--tx1)", marginTop: 4 }}>
                        {d?.active ? "Active Monitor" : "Monitoring Idle"}
                    </div>
                </div>
                <span className={`bd ${d?.active ? "p" : "dk"}`} style={{ fontSize: 10 }}>{d?.active ? "LIVE" : "IDLE"}</span>
            </div>
            {d?.active && (
                <div style={{ marginBottom: 16 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                        <span style={{ fontSize: 9, color: "var(--tx3)", fontWeight: 800, textTransform: "uppercase" }}>Time Decay</span>
                        <span style={{ fontFamily: "var(--mono)", fontSize: 10, color: hc, fontWeight: 700 }}>
                            {d.holdTimeSec}s / {d.maxHoldSec}s
                        </span>
                    </div>
                    <div className="bar-track" style={{ height: 3, background: 'rgba(255,255,255,0.03)' }}>
                        <div className="bar-fill" style={{ width: `${hp}%`, background: hc }} />
                    </div>
                </div>
            )}
            <div className="eng-grid2">
                <ECell lbl="TP Removed" val={d?.tpRemoved ? "Yes" : "No"} t={d?.tpRemoved ? "a" : undefined} />
                <ECell lbl="Trailing SL" val={d?.trailingSL ? "ON" : "OFF"} t={d?.trailingSL ? "g" : undefined} />
                <ECell lbl="SL Trail %" val={`${d?.slTrailPct ?? 0}%`} />
                <ECell lbl="Status" val={d?.active ? "Running" : "Idle"} t={d?.active ? "p" : undefined} />
            </div>
        </div>
    );
}

function ScanPanel({ e }: { e: any }) {
    const syms: any[] = e.symbolScan ?? [];
    const sc: Record<string, string> = {
        ENTRY_SIGNAL: "var(--brand)", IN_POSITION: "var(--brand2)",
        COOLING_DOWN: "var(--amber)", SPREAD_HIGH: "var(--red)",
        TRADABLE: "var(--cyan)", NO_SIGNAL: "var(--tx3)"
    };
    if (!syms.length) return <EngEmpty title="📡 Scanner" />;
    return (
        <div className="card" style={{ padding: '16px' }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "var(--tx3)", textTransform: 'uppercase', marginBottom: 16, letterSpacing: '0.5px' }}>📡 Multi-Symbol Scanner</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, maxHeight: 180, overflowY: "auto" }}>
                {syms.map((s: any) => (
                    <div key={s.symbol} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', background: 'rgba(255,255,255,0.02)', borderRadius: 8, border: '1px solid rgba(255,255,255,0.03)' }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <div style={{ width: 6, height: 6, borderRadius: "50%", background: sc[s.status] ?? "var(--tx3)", boxShadow: `0 0 10px ${sc[s.status] ?? "transparent"}` }} />
                            <span style={{ fontSize: 12, fontWeight: 800, fontFamily: "var(--mono)", color: "var(--tx1)" }}>
                                {s.symbol?.replace("USD", "")}
                            </span>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ fontSize: 10, color: "var(--tx3)", fontFamily: "var(--mono)" }}>
                                ${Number(s.lastPrice).toLocaleString()}
                            </span>
                            <span style={{ fontSize: 9, fontWeight: 800, color: sc[s.status] ?? "var(--tx3)", textTransform: 'uppercase' }}>
                                {s.status?.replace("_", " ")}
                            </span>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

function EngEmpty({ title }: { title: string }) {
    return (
        <div className="card" style={{ padding: '16px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 120 }}>
            <Zap size={20} color="var(--tx3)" style={{ marginBottom: 12 }} />
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--tx3)", textTransform: 'uppercase' }}>{title}</div>
            <div style={{ fontSize: 10, color: "var(--tx3)", marginTop: 4 }}>Awaiting engine data...</div>
        </div>
    );
}
