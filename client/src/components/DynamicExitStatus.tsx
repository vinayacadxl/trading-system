import { TrendingDown, Timer, Shield } from "lucide-react";
import { useEffect, useState } from "react";

export interface DynamicExitData {
    active: boolean;
    tpRemoved: boolean;
    trailingSL: boolean;
    slTrailPct: number;   // e.g. 0.15
    holdTimeSec: number;
    maxHoldSec: number;
    pnlPct?: number;
}

interface DynamicExitStatusProps {
    data: DynamicExitData | null;
}

export function DynamicExitStatus({ data }: DynamicExitStatusProps) {
    const [elapsed, setElapsed] = useState(0);

    useEffect(() => {
        if (!data?.active) { setElapsed(0); return; }
        setElapsed(data.holdTimeSec);
        const interval = setInterval(() => setElapsed(prev => prev + 1), 1000);
        return () => clearInterval(interval);
    }, [data?.active, data?.holdTimeSec]);

    const holdPct = data ? Math.min(100, (elapsed / data.maxHoldSec) * 100) : 0;
    const isWarning = holdPct > 75;
    const isUrgent = holdPct > 90;

    return (
        <div className={`rounded-xl border bg-card/60 backdrop-blur-sm p-4 space-y-3 relative overflow-hidden transition-all duration-300 ${data?.active
                ? "border-purple-500/40 shadow-[0_0_20px_rgba(168,85,247,0.08)]"
                : "border-border"
            }`}>
            {data?.active && (
                <div className="absolute top-0 right-0 w-20 h-20 bg-purple-500/5 rounded-full -translate-y-10 translate-x-10 pointer-events-none" />
            )}

            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${data?.active ? "bg-purple-500/20" : "bg-muted/30"}`}>
                        <TrendingDown className={`w-4 h-4 ${data?.active ? "text-purple-400" : "text-muted-foreground"}`} />
                    </div>
                    <div>
                        <p className="text-xs font-bold text-white tracking-wide uppercase">Dynamic Exit</p>
                        <p className="text-[10px] text-muted-foreground">Smart TP/SL Control</p>
                    </div>
                </div>
                <div className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${data?.active
                        ? "bg-purple-500/20 text-purple-400 border-purple-500/30 animate-pulse"
                        : "bg-muted/30 text-muted-foreground border-border"
                    }`}>
                    {data?.active ? "ACTIVE" : "IDLE"}
                </div>
            </div>

            {/* Status Flags */}
            <div className="grid grid-cols-2 gap-2">
                <FlagRow icon={<Shield className="w-3 h-3" />} label="Dynamic Exit" active={data?.active} />
                <FlagRow icon={<Shield className="w-3 h-3" />} label="TP Removed" active={data?.tpRemoved} />
                <FlagRow icon={<TrendingDown className="w-3 h-3" />} label="Trailing SL" active={data?.trailingSL} />
                <div className="bg-black/20 rounded-lg px-2.5 py-1.5 border border-white/5 flex items-center justify-between">
                    <span className="text-[9px] text-muted-foreground uppercase">SL Trail</span>
                    <span className="text-[10px] font-mono font-bold text-purple-400">
                        {data ? `${data.slTrailPct.toFixed(2)}%` : "—"}
                    </span>
                </div>
            </div>

            {/* Hold Time Progress */}
            <div className="space-y-1.5">
                <div className="flex items-center justify-between text-[10px] font-mono">
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                        <Timer className="w-3 h-3" />
                        <span>Hold Time</span>
                    </div>
                    <span className={`font-bold ${isUrgent ? "text-red-400 animate-pulse" : isWarning ? "text-amber-400" : "text-white"}`}>
                        {elapsed}s / {data?.maxHoldSec ?? 60}s
                    </span>
                </div>
                <div className="h-1.5 w-full bg-white/10 rounded-full overflow-hidden">
                    <div
                        className={`h-full rounded-full transition-all duration-1000 ${isUrgent ? "bg-red-500" : isWarning ? "bg-amber-500" : "bg-purple-500"
                            }`}
                        style={{ width: `${holdPct}%` }}
                    />
                </div>
            </div>
        </div>
    );
}

function FlagRow({
    icon,
    label,
    active,
}: {
    icon: React.ReactNode;
    label: string;
    active?: boolean;
}) {
    return (
        <div className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border ${active
                ? "bg-green-500/10 border-green-500/20"
                : "bg-black/20 border-white/5"
            }`}>
            <span className={active ? "text-green-400" : "text-muted-foreground"}>{icon}</span>
            <span className="text-[9px] text-muted-foreground flex-1">{label}</span>
            <span className={`text-[9px] font-bold ${active ? "text-green-400" : "text-muted-foreground"}`}>
                {active ? "ON" : "OFF"}
            </span>
        </div>
    );
}
