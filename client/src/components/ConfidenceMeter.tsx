import { Brain, TrendingUp } from "lucide-react";

export interface ConfidenceData {
    score: number; // 0.0 to 1.0
    orderbookStrength: "Strong" | "Moderate" | "Weak";
    tradeFlow: "BUY" | "SELL" | "NEUTRAL";
    spreadStable: boolean;
    momentum: "HIGH" | "MEDIUM" | "LOW";
}

interface ConfidenceMeterProps {
    data: ConfidenceData | null;
}

function getScoreColor(score: number) {
    if (score >= 0.7) return { bar: "from-green-500 to-emerald-400", text: "text-green-400", bg: "bg-green-500/10 border-green-500/30", label: "HIGH" };
    if (score >= 0.5) return { bar: "from-amber-500 to-yellow-400", text: "text-amber-400", bg: "bg-amber-500/10 border-amber-500/30", label: "MEDIUM" };
    return { bar: "from-red-500 to-red-400", text: "text-red-400", bg: "bg-red-500/10 border-red-500/30", label: "LOW" };
}

export function ConfidenceMeter({ data }: ConfidenceMeterProps) {
    const score = data?.score ?? 0;
    const pct = Math.round(score * 100);
    const colors = getScoreColor(score);
    const blocks = 10;
    const filledBlocks = Math.round(score * blocks);

    return (
        <div className="rounded-xl border border-border bg-card/60 backdrop-blur-sm p-4 space-y-3">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${data ? colors.bg.split(" ")[0] : "bg-muted/30"}`}>
                        <Brain className={`w-4 h-4 ${data ? colors.text : "text-muted-foreground"}`} />
                    </div>
                    <div>
                        <p className="text-xs font-bold text-white tracking-wide uppercase">Confidence Engine</p>
                        <p className="text-[10px] text-muted-foreground">AI Trade Quality Score</p>
                    </div>
                </div>
                <div className={`text-sm font-black font-mono ${colors.text}`}>
                    {pct}%
                </div>
            </div>

            {/* Block Bar (████░░░░) */}
            <div className="space-y-1.5">
                <div className="flex gap-0.5">
                    {Array.from({ length: blocks }).map((_, i) => (
                        <div
                            key={i}
                            className={`h-3 flex-1 rounded-sm transition-all duration-500 ${i < filledBlocks
                                    ? `bg-gradient-to-r ${colors.bar}`
                                    : "bg-white/10"
                                }`}
                        />
                    ))}
                </div>
                <div className="flex justify-between text-[9px] font-mono text-muted-foreground">
                    <span>0%</span>
                    <span className={`font-bold ${colors.text}`}>{colors.label}</span>
                    <span>100%</span>
                </div>
            </div>

            {/* Metrics */}
            <div className="grid grid-cols-2 gap-1.5">
                <MetricPill label="Orderbook" value={data?.orderbookStrength ?? "—"} positive={data?.orderbookStrength === "Strong"} />
                <MetricPill label="Trade Flow" value={data?.tradeFlow ?? "—"} positive={data?.tradeFlow === "BUY"} negative={data?.tradeFlow === "SELL"} />
                <MetricPill label="Spread" value={data?.spreadStable ? "Stable ✓" : "Unstable"} positive={data?.spreadStable === true} />
                <MetricPill label="Momentum" value={data?.momentum ?? "—"} positive={data?.momentum === "HIGH"} neutral={data?.momentum === "MEDIUM"} />
            </div>
        </div>
    );
}

function MetricPill({
    label,
    value,
    positive,
    negative,
    neutral,
}: {
    label: string;
    value: string;
    positive?: boolean;
    negative?: boolean;
    neutral?: boolean;
}) {
    const color = positive
        ? "text-green-400"
        : negative
            ? "text-red-400"
            : neutral
                ? "text-amber-400"
                : "text-muted-foreground";

    return (
        <div className="flex items-center justify-between bg-black/20 rounded-lg px-2 py-1.5 border border-white/5">
            <span className="text-[9px] text-muted-foreground uppercase tracking-wide">{label}</span>
            <span className={`text-[10px] font-bold font-mono ${color}`}>{value}</span>
        </div>
    );
}
