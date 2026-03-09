import { useState, useEffect } from "react";
import { History, TrendingUp, TrendingDown, Filter, RefreshCw } from "lucide-react";

interface Trade {
    id: string | number;
    symbol: string;
    side: "buy" | "sell";
    size: number;
    avgFillPrice: string | number;
    closePrice?: string | number;
    pnl?: number;
    status: string;
    createdAt: number;
    closedAt?: number;
}

const fmt = (n: number, d = 2) => n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const date = (ts: number) => new Date(ts).toLocaleString("en-US", { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });

export default function TradeHistory() {
    const [trades, setTrades] = useState<Trade[]>([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState<"all" | "profit" | "loss">("all");

    const load = () => {
        setLoading(true);
        fetch("/api/trades/history")
            .then((r) => r.json())
            .then((d) => { setTrades(Array.isArray(d) ? d : (d?.trades ?? [])); })
            .catch(() => { })
            .finally(() => setLoading(false));
    };

    useEffect(() => { load(); }, []);

    const filtered = trades.filter((t) => {
        if (filter === "profit") return (t.pnl ?? 0) >= 0;
        if (filter === "loss") return (t.pnl ?? 0) < 0;
        return true;
    });

    const totalPnl = trades.reduce((a, t) => a + (t.pnl ?? 0), 0);
    const wins = trades.filter((t) => (t.pnl ?? 0) >= 0).length;
    const winRate = trades.length ? Math.round((wins / trades.length) * 100) : 0;
    const bestTrade = trades.reduce((best, t) => Math.max(best, t.pnl ?? 0), 0);
    const worstTrade = trades.reduce((worst, t) => Math.min(worst, t.pnl ?? 0), 0);

    return (
        <>
            <div className="topbar">
                <div>
                    <div className="topbar-title">Trade History</div>
                    <div className="topbar-sub">Complete record of all executed trades</div>
                </div>
                <button className="btn btn-dk" onClick={load} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <RefreshCw size={13} />Refresh
                </button>
            </div>

            <div className="page">
                {/* Stats */}
                <div className="stats-grid">
                    <StatBox label="Total PNL" value={`${totalPnl >= 0 ? "+" : ""}$${fmt(totalPnl)}`} tone={totalPnl >= 0 ? "g" : "r"} />
                    <StatBox label="Win Rate" value={`${winRate}%`} sub={`${wins}/${trades.length} trades`} tone={winRate >= 55 ? "g" : winRate >= 45 ? "p" : "r"} />
                    <StatBox label="Best Trade" value={`+$${fmt(bestTrade)}`} tone="g" />
                    <StatBox label="Worst Trade" value={`$${fmt(worstTrade)}`} tone="r" />
                </div>

                {/* Filter */}
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {(["all", "profit", "loss"] as const).map((f) => (
                        <button key={f} onClick={() => setFilter(f)} style={{
                            padding: "6px 14px", borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: "pointer",
                            border: `1px solid ${filter === f ? "var(--indigo)" : "var(--bdr2)"}`,
                            background: filter === f ? "var(--indigo-dim)" : "transparent",
                            color: filter === f ? "var(--indigo)" : "var(--tx2)",
                            transition: "all .15s", textTransform: "capitalize",
                        }}>{f}</button>
                    ))}
                    <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--tx3)" }}>{filtered.length} records</span>
                </div>

                {/* Table */}
                <div className="card" style={{ padding: 0, overflow: "hidden" }}>
                    {loading ? (
                        <div className="empty-state"><div className="spinner" /><span>Loading trades…</span></div>
                    ) : filtered.length === 0 ? (
                        <div className="empty-state"><History size={32} /><span>No trades found</span></div>
                    ) : (
                        <div className="tbl-wrap">
                            <table className="tbl">
                                <thead>
                                    <tr>
                                        <th>Symbol</th>
                                        <th>Side</th>
                                        <th>Size</th>
                                        <th>Entry</th>
                                        <th>Exit</th>
                                        <th>PNL</th>
                                        <th>Status</th>
                                        <th>Time</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filtered.map((t) => {
                                        const pnl = t.pnl ?? 0;
                                        return (
                                            <tr key={t.id}>
                                                <td><span style={{ fontFamily: "var(--mono)", fontWeight: 700, color: "var(--tx1)" }}>{t.symbol}</span></td>
                                                <td>
                                                    <span className={`bd ${t.side === "buy" ? "g" : "r"}`} style={{ fontSize: 9 }}>
                                                        {t.side === "buy" ? <TrendingUp size={9} /> : <TrendingDown size={9} />}
                                                        {t.side.toUpperCase()}
                                                    </span>
                                                </td>
                                                <td><span className="mono" style={{ color: "var(--tx2)" }}>{t.size}</span></td>
                                                <td><span className="mono">${fmt(Number(t.avgFillPrice))}</span></td>
                                                <td><span className="mono" style={{ color: "var(--tx2)" }}>{t.closePrice ? `$${fmt(Number(t.closePrice))}` : "—"}</span></td>
                                                <td>
                                                    <span className="mono" style={{ fontWeight: 700, color: pnl >= 0 ? "var(--green)" : "var(--red)" }}>
                                                        {pnl >= 0 ? "+" : ""}${fmt(pnl)}
                                                    </span>
                                                </td>
                                                <td>
                                                    <span className={`bd ${t.status === "closed" ? "g" : t.status === "open" ? "p" : "dk"}`} style={{ fontSize: 9 }}>
                                                        {t.status}
                                                    </span>
                                                </td>
                                                <td><span style={{ fontSize: 11, color: "var(--tx3)" }}>{date(t.createdAt)}</span></td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            </div>
        </>
    );
}

function StatBox({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "g" | "r" | "p" }) {
    return (
        <div className={`card${tone ? " " + tone : ""}`}>
            <div className="card-label">{label}</div>
            <div className={`card-val${tone ? " " + tone : ""}`} style={{ fontSize: 22, marginTop: 8 }}>{value}</div>
            {sub && <div className="card-sub">{sub}</div>}
        </div>
    );
}
