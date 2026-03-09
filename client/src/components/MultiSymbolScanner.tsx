import { Globe, TrendingUp, TrendingDown, Minus, X } from "lucide-react";

export type SymbolStatus =
    | "ENTRY_SIGNAL"
    | "NO_SIGNAL"
    | "COOLING_DOWN"
    | "TRADABLE"
    | "SPREAD_HIGH"
    | "IN_POSITION";

export interface SymbolScanData {
    symbol: string;
    status: SymbolStatus;
    direction?: "buy" | "sell";
    strength?: number;
    confidence?: number;
    lastPrice?: number;
    change24h?: number;
}

interface MultiSymbolScannerProps {
    symbols: SymbolScanData[];
}

function getStatusConfig(status: SymbolStatus) {
    switch (status) {
        case "ENTRY_SIGNAL":
            return { label: "ENTRY SIGNAL ✓", bg: "bg-green-500/15", border: "border-green-500/40", text: "text-green-400", dot: "bg-green-400 animate-pulse" };
        case "IN_POSITION":
            return { label: "IN POSITION", bg: "bg-blue-500/15", border: "border-blue-500/40", text: "text-blue-400", dot: "bg-blue-400 animate-pulse" };
        case "COOLING_DOWN":
            return { label: "COOLING DOWN", bg: "bg-amber-500/10", border: "border-amber-500/30", text: "text-amber-400", dot: "bg-amber-400" };
        case "TRADABLE":
            return { label: "TRADABLE", bg: "bg-primary/10", border: "border-primary/30", text: "text-primary", dot: "bg-primary" };
        case "SPREAD_HIGH":
            return { label: "SPREAD HIGH ✗", bg: "bg-red-500/10", border: "border-red-500/30", text: "text-red-400", dot: "bg-red-400" };
        case "NO_SIGNAL":
        default:
            return { label: "NO SIGNAL", bg: "bg-muted/10", border: "border-border", text: "text-muted-foreground", dot: "bg-muted-foreground" };
    }
}

export function MultiSymbolScanner({ symbols }: MultiSymbolScannerProps) {
    return (
        <div className="rounded-xl border border-border bg-card/60 backdrop-blur-sm p-4 space-y-3">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-lg flex items-center justify-center bg-cyan-500/20">
                        <Globe className="w-4 h-4 text-cyan-400" />
                    </div>
                    <div>
                        <p className="text-xs font-bold text-white tracking-wide uppercase">Multi Symbol Scanner</p>
                        <p className="text-[10px] text-muted-foreground">{symbols.length} symbols monitored</p>
                    </div>
                </div>
                <div className="text-[10px] font-mono text-muted-foreground">
                    {symbols.filter(s => s.status === "ENTRY_SIGNAL").length} signals
                </div>
            </div>

            {/* Symbol List */}
            <div className="space-y-1.5 max-h-[280px] overflow-y-auto pr-0.5">
                {symbols.length === 0 ? (
                    <div className="text-center text-xs text-muted-foreground py-6">
                        Scanning symbols...
                    </div>
                ) : (
                    symbols.map((sym) => {
                        const cfg = getStatusConfig(sym.status);
                        return (
                            <div
                                key={sym.symbol}
                                className={`flex items-center justify-between px-3 py-2 rounded-lg border ${cfg.bg} ${cfg.border} transition-all duration-300`}
                            >
                                <div className="flex items-center gap-2.5 min-w-0">
                                    <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${cfg.dot}`} />
                                    <div className="min-w-0">
                                        <div className="flex items-center gap-1.5">
                                            <span className="text-xs font-bold text-white font-mono">
                                                {sym.symbol.replace("USD", "")}
                                            </span>
                                            {sym.direction === "buy" && <TrendingUp className="w-3 h-3 text-green-400" />}
                                            {sym.direction === "sell" && <TrendingDown className="w-3 h-3 text-red-400" />}
                                            {!sym.direction && <Minus className="w-3 h-3 text-muted-foreground" />}
                                        </div>
                                        {sym.lastPrice && (
                                            <p className="text-[9px] text-muted-foreground font-mono">
                                                ${sym.lastPrice.toLocaleString("en-US", { maximumFractionDigits: 2 })}
                                                {sym.change24h !== undefined && (
                                                    <span className={`ml-1 ${sym.change24h >= 0 ? "text-green-400" : "text-red-400"}`}>
                                                        {sym.change24h >= 0 ? "+" : ""}{sym.change24h.toFixed(2)}%
                                                    </span>
                                                )}
                                            </p>
                                        )}
                                    </div>
                                </div>

                                <div className="flex items-center gap-2 flex-shrink-0">
                                    {sym.strength !== undefined && sym.status === "ENTRY_SIGNAL" && (
                                        <span className="text-[9px] font-mono text-muted-foreground">
                                            {sym.strength}%
                                        </span>
                                    )}
                                    <span className={`text-[9px] font-bold uppercase tracking-wide ${cfg.text}`}>
                                        {cfg.label}
                                    </span>
                                </div>
                            </div>
                        );
                    })
                )}
            </div>

            {/* Summary Bar */}
            {symbols.length > 0 && (
                <div className="flex items-center gap-3 pt-1 border-t border-border/50">
                    <SummaryDot color="bg-green-400" label={`${symbols.filter(s => s.status === "ENTRY_SIGNAL").length} Signal`} />
                    <SummaryDot color="bg-blue-400" label={`${symbols.filter(s => s.status === "IN_POSITION").length} Position`} />
                    <SummaryDot color="bg-muted-foreground" label={`${symbols.filter(s => s.status === "NO_SIGNAL").length} Idle`} />
                </div>
            )}
        </div>
    );
}

function SummaryDot({ color, label }: { color: string; label: string }) {
    return (
        <div className="flex items-center gap-1">
            <div className={`w-1.5 h-1.5 rounded-full ${color}`} />
            <span className="text-[9px] text-muted-foreground">{label}</span>
        </div>
    );
}
