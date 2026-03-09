import { useState, useEffect } from "react";
import { Radio, RefreshCw, TrendingUp, TrendingDown, Activity } from "lucide-react";

const fmt = (n: number, d = 2) => n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });

function useLiveData() {
    const [ticker, setTicker] = useState<any[]>([]);
    const [orderbook, setOB] = useState<any>(null);
    const [trades24, setTrades24] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    const load = async () => {
        try {
            const [tb, ob, tr] = await Promise.all([
                fetch("/api/delta/tickers").then((r) => r.json()),
                fetch("/api/delta/orderbook?symbol=BTCUSD").then((r) => r.json()),
                fetch("/api/delta/trades?symbol=BTCUSD&limit=20").then((r) => r.json()),
            ]);
            if (Array.isArray(tb)) setTicker(tb.slice(0, 8));
            if (ob && (ob.buy || ob.sell)) setOB(ob);
            if (Array.isArray(tr)) setTrades24(tr.slice(0, 20));
        } catch { }
        setLoading(false);
    };

    useEffect(() => { load(); const t = setInterval(load, 5000); return () => clearInterval(t); }, []);
    return { ticker, orderbook, trades24, loading, refresh: load };
}

export default function LiveDataPage() {
    const { ticker, orderbook, trades24, loading, refresh } = useLiveData();
    const [activeTab, setActiveTab] = useState<"tickers" | "orderbook" | "trades">("tickers");

    return (
        <>
            <div className="topbar">
                <div>
                    <div className="topbar-title">Live Data</div>
                    <div className="topbar-sub">Real-time market data from Delta Exchange</div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--green)" }}>
                        <div style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--green)", animation: "_pulse 2s ease-in-out infinite" }} />
                        Live
                    </div>
                    <button className="btn btn-dk" onClick={refresh} style={{ padding: "6px 14px" }}>
                        <RefreshCw size={13} />Refresh
                    </button>
                </div>
            </div>

            <div className="page">
                {/* Tabs */}
                <div style={{ display: "flex", gap: 4, background: "rgba(0,0,0,0.25)", padding: 4, borderRadius: 10, border: "1px solid var(--bdr2)", width: "fit-content" }}>
                    {(["tickers", "orderbook", "trades"] as const).map((t) => (
                        <button key={t} onClick={() => setActiveTab(t)} style={{
                            padding: "7px 18px", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer",
                            border: "none", transition: "all .15s", textTransform: "capitalize",
                            background: activeTab === t ? "linear-gradient(135deg,var(--indigo),var(--violet))" : "transparent",
                            color: activeTab === t ? "#fff" : "var(--tx2)",
                            boxShadow: activeTab === t ? "0 2px 12px var(--indigo-glow)" : "none",
                        }}>{t}</button>
                    ))}
                </div>

                {loading ? (
                    <div className="empty-state"><div className="spinner" /><span>Loading market data…</span></div>
                ) : (
                    <>
                        {/* Tickers */}
                        {activeTab === "tickers" && (
                            <div className="card" style={{ padding: 0, overflow: "hidden" }}>
                                <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--bdr)", display: "flex", alignItems: "center", gap: 8 }}>
                                    <Activity size={14} style={{ color: "var(--indigo)" }} />
                                    <span className="sec-title" style={{ margin: 0 }}>Market Tickers</span>
                                </div>
                                <div className="tbl-wrap">
                                    <table className="tbl">
                                        <thead>
                                            <tr><th>Symbol</th><th>Price</th><th>24h Change</th><th>Volume</th><th>Mark</th></tr>
                                        </thead>
                                        <tbody>
                                            {ticker.map((t: any) => {
                                                const chg = parseFloat(t.change_24h ?? t.price_change_24h ?? "0");
                                                const price = parseFloat(t.close ?? t.last_price ?? "0");
                                                const vol = parseFloat(t.volume ?? "0");
                                                return (
                                                    <tr key={t.symbol}>
                                                        <td><span style={{ fontFamily: "var(--mono)", fontWeight: 700, color: "var(--tx1)" }}>{t.symbol}</span></td>
                                                        <td><span className="mono" style={{ fontWeight: 700 }}>${fmt(price)}</span></td>
                                                        <td>
                                                            <span style={{ display: "flex", alignItems: "center", gap: 5, color: chg >= 0 ? "var(--green)" : "var(--red)", fontFamily: "var(--mono)", fontSize: 12, fontWeight: 700 }}>
                                                                {chg >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                                                                {chg >= 0 ? "+" : ""}{chg.toFixed(2)}%
                                                            </span>
                                                        </td>
                                                        <td><span className="mono" style={{ color: "var(--tx2)" }}>{vol.toFixed(0)}</span></td>
                                                        <td><span className="mono" style={{ color: "var(--tx2)" }}>${fmt(parseFloat(t.mark_price ?? "0"))}</span></td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )}

                        {/* Orderbook */}
                        {activeTab === "orderbook" && (
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                                {(["sell", "buy"] as const).map((side) => (
                                    <div key={side} className="card" style={{ padding: 0, overflow: "hidden" }}>
                                        <div style={{ padding: "12px 18px", borderBottom: "1px solid var(--bdr)", display: "flex", alignItems: "center", gap: 8 }}>
                                            <span className={`bd ${side === "buy" ? "g" : "r"}`} style={{ fontSize: 9 }}>{side === "buy" ? "BIDS" : "ASKS"}</span>
                                            <span style={{ fontSize: 11, color: "var(--tx2)" }}>BTCUSD Orderbook</span>
                                        </div>
                                        <div style={{ padding: "8px 14px" }}>
                                            {!orderbook ? (
                                                <div className="empty-state" style={{ padding: "20px 0" }}>No data</div>
                                            ) : (
                                                (orderbook[side] ?? []).slice(0, 10).map(([price, qty]: string[], i: number) => {
                                                    const p = parseFloat(price), q = parseFloat(qty);
                                                    const maxQ = Math.max(...(orderbook[side] ?? []).slice(0, 10).map(([, v]: string[]) => parseFloat(v)));
                                                    const pct = maxQ > 0 ? (q / maxQ) * 100 : 0;
                                                    return (
                                                        <div key={i} style={{ position: "relative", marginBottom: 4, borderRadius: 6, overflow: "hidden" }}>
                                                            <div style={{ position: "absolute", inset: 0, background: side === "buy" ? "rgba(16,185,129,0.06)" : "rgba(244,63,94,0.06)", width: `${pct}%`, transition: "width .3s" }} />
                                                            <div style={{ position: "relative", display: "flex", justifyContent: "space-between", padding: "6px 10px", fontSize: 12 }}>
                                                                <span style={{ fontFamily: "var(--mono)", fontWeight: 700, color: side === "buy" ? "var(--green)" : "var(--red)" }}>{fmt(p)}</span>
                                                                <span style={{ fontFamily: "var(--mono)", color: "var(--tx2)" }}>{q.toFixed(4)}</span>
                                                            </div>
                                                        </div>
                                                    );
                                                })
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* Recent Trades */}
                        {activeTab === "trades" && (
                            <div className="card" style={{ padding: 0, overflow: "hidden" }}>
                                <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--bdr)" }}>
                                    <div className="sec-title">Recent Trades — BTCUSD</div>
                                </div>
                                <div className="tbl-wrap">
                                    <table className="tbl">
                                        <thead><tr><th>Side</th><th>Price</th><th>Size</th><th>Time</th></tr></thead>
                                        <tbody>
                                            {trades24.length === 0
                                                ? <tr><td colSpan={4} style={{ textAlign: "center", color: "var(--tx3)", padding: "30px 0" }}>No recent trades</td></tr>
                                                : trades24.map((t: any, i: number) => {
                                                    const isBuy = t.side === "buy" || t.buyer_role === "taker";
                                                    return (
                                                        <tr key={i}>
                                                            <td><span className={`bd ${isBuy ? "g" : "r"}`} style={{ fontSize: 9 }}>{isBuy ? "BUY" : "SELL"}</span></td>
                                                            <td><span className="mono" style={{ fontWeight: 700, color: isBuy ? "var(--green)" : "var(--red)" }}>${fmt(parseFloat(t.price ?? t.fill_price ?? "0"))}</span></td>
                                                            <td><span className="mono" style={{ color: "var(--tx2)" }}>{parseFloat(t.size ?? t.qty ?? "0").toFixed(4)}</span></td>
                                                            <td><span style={{ fontSize: 11, color: "var(--tx3)" }}>{t.timestamp ? new Date(t.timestamp * 1000).toLocaleTimeString() : "—"}</span></td>
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
