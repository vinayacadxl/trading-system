import { Zap, Activity } from "lucide-react";

export interface ScalpingEngineData {
    symbol: string;
    imbalance: number;
    spread: string;
    tradeFlow: "BUY Dominant" | "SELL Dominant" | "Balanced";
    entrySignal: boolean;
    cooldown: boolean;
    activeTrades: number;
    maxTrades: number;
    lastPrice?: number;
}

interface ScalpingEngineCardProps {
    data: ScalpingEngineData | null;
}

export function ScalpingEngineCard({ data }: ScalpingEngineCardProps) {
    const isActive = data?.entrySignal && !data?.cooldown;

    return (
        <div className="rounded-xl border border-border bg-card/60 backdrop-blur-sm p-4 space-y-3 relative overflow-hidden">
            {/* Glow effect when signal active */}
            {isActive && (
                <div className="absolute inset-0 bg-primary/5 rounded-xl pointer-events-none animate-pulse" />
            )}

            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${isActive ? "bg-orange-500/20" : "bg-muted/30"}`}>
                        <Zap className={`w-4 h-4 ${isActive ? "text-orange-400" : "text-muted-foreground"}`} />
                    </div>
                    <div>
                        <p className="text-xs font-bold text-white tracking-wide uppercase">Fast Scalping Engine</p>
                        <p className="text-[10px] text-muted-foreground font-mono">{data?.symbol ?? "—"}</p>
                    </div>
                </div>
                <div className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${isActive ? "bg-orange-500/20 text-orange-400 border border-orange-500/30" :
                        data?.cooldown ? "bg-amber-500/20 text-amber-400 border border-amber-500/30" :
                            "bg-muted/30 text-muted-foreground border border-border"
                    }`}>
                    {isActive ? "SIGNAL ✓" : data?.cooldown ? "COOLDOWN" : "SCANNING"}
                </div>
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-2 gap-2">
                <StatRow
                    label="Imbalance"
                    value={data ? data.imbalance.toFixed(2) : "—"}
                    highlight={data ? data.imbalance > 1.5 : false}
                    highlightColor="text-orange-400"
                />
                <StatRow
                    label="Spread"
                    value={data?.spread ?? "—"}
                    highlight={data?.spread === "1 Tick" || data?.spread === "OK"}
                    highlightColor="text-green-400"
                />
                <StatRow
                    label="Trade Flow"
                    value={data?.tradeFlow ?? "—"}
                    highlight={data?.tradeFlow === "BUY Dominant"}
                    highlightColor="text-green-400"
                    negativeHighlight={data?.tradeFlow === "SELL Dominant"}
                    negativeColor="text-red-400"
                />
                <StatRow
                    label="Active Trades"
                    value={data ? `${data.activeTrades}/${data.maxTrades}` : "—"}
                    highlight={data ? data.activeTrades > 0 : false}
                    highlightColor="text-primary"
                />
            </div>

            {/* Entry Signal Indicator */}
            <div className={`flex items-center justify-between px-3 py-2 rounded-lg border ${data?.entrySignal
                    ? "bg-green-500/10 border-green-500/30"
                    : "bg-muted/20 border-border"
                }`}>
                <div className="flex items-center gap-2">
                    <Activity className={`w-3 h-3 ${data?.entrySignal ? "text-green-400" : "text-muted-foreground"}`} />
                    <span className="text-[10px] font-mono text-muted-foreground">Entry Signal</span>
                </div>
                <span className={`text-[10px] font-bold ${data?.entrySignal ? "text-green-400" : "text-muted-foreground"}`}>
                    {data?.entrySignal ? "DETECTED ✓" : "WAITING..."}
                </span>
            </div>
        </div>
    );
}

function StatRow({
    label,
    value,
    highlight,
    highlightColor,
    negativeHighlight,
    negativeColor,
}: {
    label: string;
    value: string;
    highlight: boolean;
    highlightColor: string;
    negativeHighlight?: boolean;
    negativeColor?: string;
}) {
    const valueColor = negativeHighlight && negativeColor
        ? negativeColor
        : highlight
            ? highlightColor
            : "text-white";

    return (
        <div className="bg-black/20 rounded-lg px-2.5 py-1.5 border border-white/5">
            <p className="text-[9px] text-muted-foreground uppercase tracking-wider mb-0.5">{label}</p>
            <p className={`text-xs font-mono font-bold ${valueColor}`}>{value}</p>
        </div>
    );
}
