import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { BarChart3, Play, Activity, ChevronDown, Search, TrendingUp, TrendingDown } from "lucide-react";
import { useState, useEffect, useMemo } from "react";

const RESOLUTIONS = [
    { label: "1 Minute", value: "1m" },
    { label: "3 Minutes", value: "3m" },
    { label: "5 Minutes", value: "5m" },
    { label: "15 Minutes", value: "15m" },
    { label: "30 Minutes", value: "30m" },
    { label: "1 Hour", value: "1h" },
    { label: "2 Hours", value: "2h" },
    { label: "4 Hours", value: "4h" },
    { label: "1 Day", value: "1d" },
];

const STRATEGY_PRESETS = [
    { id: "pro_sniper_v3", name: "Pro Sniper V3", description: "Balanced quality trades with 3:1 RR" },
    { id: "momentum_master", name: "Momentum Master", description: "Aggressive momentum trading - High Risk" },
    { id: "trend_rider", name: "Trend Rider", description: "Conservative trend following - Steady Gains" },
    { id: "lightning_scalper", name: "Lightning Scalper", description: "Ultra-fast scalping - High frequency, 50x leverage" }
];

export default function StrategyTester() {
    const [urlParams] = useState(() => new URLSearchParams(typeof window !== "undefined" ? window.location.search : ""));
    const [isRunning, setIsRunning] = useState(false);
    const [livePrice, setLivePrice] = useState<number | null>(null);
    const [liveMarkPrice, setLiveMarkPrice] = useState<number | null>(null);
    const [liveIndexPrice, setLiveIndexPrice] = useState<number | null>(null);
    const [livePriceDir, setLivePriceDir] = useState<"up" | "down" | null>(null);
    const [prevLivePrice, setPrevLivePrice] = useState<number | null>(null);
    const [tickerError, setTickerError] = useState(false);
    const [priceSource, setPriceSource] = useState<"ticker" | "candles" | null>(null);
    const [products, setProducts] = useState<{ symbol: string; description: string }[]>([]);
    const [selectedSymbol, setSelectedSymbol] = useState("BTCUSD");
    const [selectedResolution, setSelectedResolution] = useState("15m");
    const [selectedPreset, setSelectedPreset] = useState("pro_sniper_v3");
    const [syncedFromBot, setSyncedFromBot] = useState(false);
    const [searchTerm, setSearchTerm] = useState("");
    const [candles, setCandles] = useState<any[]>([]);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [results, setResults] = useState<{
        regime: string;
        adx: number;
        reason: string;
        stats: { winRate: string; totalTrades: number; profitFactor?: string };
        lastPrice?: number | string;
        totalReturnPct?: number;
        totalReturn?: number;
        totalPnlUsd?: number;
        maxDrawdown?: number;
        maxDrawdownPct?: number;
        maxDrawdownUsd?: number;
        totalTrades?: number;
        wins?: number;
        losses?: number;
        winRate?: number;
        profitFactor?: number;
        adaptive?: boolean;
        currentRegime?: { regime: string; strategy: string; reason: string; adx?: number };
        regimePerformance?: Array<{ regime: string; strategy: string; trades: number; wins: number; totalReturnPct: number; winRate: number; profitFactor: number; maxDrawdown: number }>;
        dataFetchedAt?: number;
    } | null>(null);

    useEffect(() => {
        fetch("/api/delta/products")
            .then(res => res.json())
            .then(data => {
                if (data.success && Array.isArray(data.products)) {
                    const popular = ["BTCUSD", "ETHUSD", "SOLUSD", "XRPUSD"];
                    const filtered = data.products
                        .filter((p: any) =>
                            p.contract_type === "perpetual_futures" ||
                            p.product_type === "futures" ||
                            p.symbol.endsWith("USD") ||
                            p.symbol.endsWith("USDT")
                        )
                        .map((p: any) => ({ symbol: p.symbol, description: p.description || p.short_description }))
                        .sort((a: any, b: any) => {
                            const aPop = popular.indexOf(a.symbol);
                            const bPop = popular.indexOf(b.symbol);
                            if (aPop !== -1 && bPop !== -1) return aPop - bPop;
                            if (aPop !== -1) return -1;
                            if (bPop !== -1) return 1;
                            return a.symbol.localeCompare(b.symbol);
                        });
                    setProducts(filtered);
                }
            })
            .catch(() => { });
    }, []);

    useEffect(() => {
        const qSymbol = urlParams.get("symbol");
        const qResolution = urlParams.get("resolution");
        if (qSymbol || qResolution) {
            if (qSymbol) setSelectedSymbol(qSymbol);
            if (qResolution) setSelectedResolution(qResolution);
            setSyncedFromBot(true);
            return;
        }
        fetch("/api/bot/status")
            .then((res) => res.json())
            .then((data) => {
                if (data.success && data.config) {
                    if (data.config.symbol) setSelectedSymbol(data.config.symbol);
                    if (data.config.resolution) setSelectedResolution(data.config.resolution);
                    setSyncedFromBot(true);
                }
            })
            .catch(() => { });
    }, []);

    useEffect(() => {
        setLivePrice(null);
        setLiveMarkPrice(null);
        setLiveIndexPrice(null);
        setLivePriceDir(null);
        setPrevLivePrice(null);
        setTickerError(false);
        setPriceSource(null);
        let cancelled = false;
        const fetchLivePrice = () => {
            const url = `/api/delta/ticker?symbol=${encodeURIComponent(selectedSymbol)}&_t=${Date.now()}`;
            fetch(url, { cache: "no-store" })
                .then((res) => res.json())
                .then((data) => {
                    if (cancelled) return;
                    if (!data.success || data.lastPrice == null) {
                        setTickerError(true);
                        return;
                    }
                    setTickerError(false);
                    setPriceSource(data.source === "candles" ? "candles" : "ticker");
                    const price = Number(data.lastPrice);
                    if (Number.isFinite(price)) {
                        setPrevLivePrice((prev) => {
                            if (prev != null && price > prev) setLivePriceDir("up");
                            else if (prev != null && price < prev) setLivePriceDir("down");
                            return price;
                        });
                        setLivePrice(price);
                        if (data.markPrice != null) setLiveMarkPrice(Number(data.markPrice));
                        else setLiveMarkPrice(null);
                        if (data.indexPrice != null) setLiveIndexPrice(Number(data.indexPrice));
                        else setLiveIndexPrice(null);
                    }
                })
                .catch(() => setTickerError(true));
        };
        fetchLivePrice();
        const interval = setInterval(fetchLivePrice, 1000);
        return () => {
            cancelled = true;
            clearInterval(interval);
        };
    }, [selectedSymbol]);

    /** Live candles – load immediately (no backtest) and refresh every 60s – no delay */
    useEffect(() => {
        let cancelled = false;
        const fetchLiveCandles = () => {
            const url = `/api/delta/candles?symbol=${encodeURIComponent(selectedSymbol)}&resolution=${encodeURIComponent(selectedResolution)}&limit=300&_t=${Date.now()}`;
            fetch(url, { cache: "no-store" })
                .then((res) => res.json())
                .then((data) => {
                    if (cancelled || !data.success) return;
                    if (Array.isArray(data.candles) && data.candles.length > 0) {
                        setCandles(data.candles);
                    }
                })
                .catch(() => { });
        };
        fetchLiveCandles();
        const interval = setInterval(fetchLiveCandles, 30_000);
        return () => {
            cancelled = true;
            clearInterval(interval);
        };
    }, [selectedSymbol, selectedResolution]);

    const filteredProducts = useMemo(() => {
        return products.filter(p =>
            p.symbol.toLowerCase().includes(searchTerm.toLowerCase())
        );
    }, [products, searchTerm]);

    const startBacktest = async () => {
        setIsRunning(true);
        setErrorMessage(null);
        setResults(null);
        setCandles([]);
        try {
            const res = await fetch("/api/delta/test-strategy", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    symbol: selectedSymbol,
                    resolution: selectedResolution,
                    preset: selectedPreset
                }),
            });
            let text = await res.text();
            text = text.replace(/^\uFEFF/, "").trim();
            let data: { success?: boolean; error?: string; candles?: unknown[]; regime?: string } = {};
            try {
                data = text.length > 0 ? JSON.parse(text) : {};
            } catch {
                if (text.startsWith("<")) {
                    setErrorMessage("Server returned HTML instead of JSON. Run: npm run dev (then open http://127.0.0.1:5000). Do not use only dev:client.");
                } else if (text.length === 0) {
                    setErrorMessage("Empty response from server.");
                } else {
                    setErrorMessage("Response is not valid JSON. Check server is returning JSON.");
                }
                return;
            }
            if (data.success) {
                setResults(data as typeof results);
                setCandles(Array.isArray(data.candles) ? data.candles : []);
            } else {
                setErrorMessage(data.error || `Request failed: ${res.status} ${res.statusText}`);
            }
        } catch (e) {
            setErrorMessage(e instanceof Error ? e.message : "Network or request failed.");
        } finally {
            setIsRunning(false);
        }
    };

    const marketRegime = results?.regime;
    const selectedProductName = useMemo(() => {
        const p = products.find(pr => pr.symbol === selectedSymbol);
        return p?.description || selectedSymbol;
    }, [products, selectedSymbol]);
    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold text-white tracking-tight">Strategy Tester</h1>
                    <p className="text-muted-foreground">Test your adaptive strategies across different market regimes.</p>
                </div>
                <Button
                    onClick={startBacktest}
                    disabled={isRunning}
                    className="bg-primary hover:bg-primary/90 text-white shadow-lg shadow-primary/20"
                >
                    {isRunning ? <Activity className="w-4 h-4 mr-2 animate-spin" /> : <Play className="w-4 h-4 mr-2" />}
                    {isRunning ? "Testing..." : "Run Backtest"}
                </Button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="md:col-span-2 space-y-4">
                    {/* Pair name + live price (reference style) – always visible */}
                    <div className="rounded-lg border border-border bg-card/80 px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                        <div className="flex flex-col gap-0.5">
                            <span className="text-lg font-bold text-white font-mono">{selectedSymbol}</span>
                            {selectedProductName !== selectedSymbol && (
                                <span className="text-xs text-muted-foreground max-w-[220px] truncate" title={selectedProductName}>{selectedProductName}</span>
                            )}
                        </div>
                        <div className="flex items-baseline gap-3 flex-wrap">
                            <span className="text-[10px] uppercase text-muted-foreground mr-1">Real-time price</span>
                            {livePrice != null || results?.lastPrice != null ? (
                                <>
                                    <span className={`text-2xl sm:text-3xl font-black font-mono ${livePriceDir === "up" ? "text-profit" : livePriceDir === "down" ? "text-destructive" : "text-white"}`}>
                                        ${(livePrice ?? Number(results?.lastPrice ?? 0)).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
                                    </span>
                                    {livePriceDir === "up" && <TrendingUp className="w-6 h-6 text-profit" />}
                                    {livePriceDir === "down" && <TrendingDown className="w-6 h-6 text-destructive" />}
                                </>
                            ) : tickerError ? (
                                <span className="text-lg font-mono text-destructive">Price unavailable</span>
                            ) : (
                                <span className="text-xl font-mono text-muted-foreground animate-pulse">— Loading…</span>
                            )}
                            <span className="text-[10px] text-muted-foreground/80">
                                {priceSource === "candles" ? "(from last candle, updates every 1m)" : "(updates every 1s)"}
                            </span>
                        </div>
                        <div className="flex gap-4 text-[11px] text-muted-foreground border-t border-border/50 pt-2 sm:pt-0 sm:border-t-0">
                            {liveMarkPrice != null && <span>Mark: <span className="text-foreground font-mono">{liveMarkPrice.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</span></span>}
                            {liveIndexPrice != null && <span>Index: <span className="text-foreground font-mono">{liveIndexPrice.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</span></span>}
                            {liveMarkPrice == null && liveIndexPrice == null && <span className="text-muted-foreground/60">Mark / Index —</span>}
                        </div>
                    </div>

                    <Card className="glass-card">
                        <CardHeader>
                            <CardTitle className="flex items-center justify-between">
                                <div className="flex items-center space-x-2 flex-wrap gap-2">
                                    <BarChart3 className="w-5 h-5 text-primary" />
                                    <span>Strategy Test Results</span>
                                    {(livePrice != null || results?.lastPrice != null) && (
                                        <span className="ml-2 flex items-center gap-2 font-mono">
                                            <span className="text-[10px] uppercase font-semibold text-muted-foreground bg-white/5 px-1.5 py-0.5 rounded">Live</span>
                                            <span className={`text-lg font-black ${livePriceDir === "up" ? "text-profit" : livePriceDir === "down" ? "text-destructive" : "text-white"}`}>
                                                ${(livePrice ?? Number(results?.lastPrice ?? 0)).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
                                            </span>
                                            {livePriceDir === "up" && <TrendingUp className="w-4 h-4 text-profit" />}
                                            {livePriceDir === "down" && <TrendingDown className="w-4 h-4 text-destructive" />}
                                        </span>
                                    )}
                                </div>
                                {marketRegime && (
                                    <Badge variant="outline" className={
                                        marketRegime === "Up" ? "bg-profit/10 text-profit border-profit/50" :
                                            marketRegime === "Down" ? "bg-destructive/10 text-destructive border-destructive/50" :
                                                "bg-amber-500/10 text-amber-200 border-amber-500/50"
                                    }>
                                        {marketRegime === "Side" ? "SIDEWAYS" : marketRegime?.toUpperCase()}
                                    </Badge>
                                )}
                            </CardTitle>
                            <CardDescription className="flex flex-col gap-1">
                                <span>Backtest results for {selectedSymbol} ({selectedResolution}) – data only, no chart</span>
                                {syncedFromBot && (
                                    <span className="text-[10px] text-muted-foreground mt-0.5">
                                        Linked to Bot Configuration · Trends differ by timeframe; results below are for this resolution.
                                    </span>
                                )}
                                <span className="text-[10px] text-muted-foreground/80 mt-0.5">
                                    Real-time data from Delta Exchange (ticker + candles API).
                                </span>
                                {results && candles.length > 0 && (
                                    <span className="text-[10px] font-medium text-primary/90 mt-1">
                                        ✓ Real-time data: {candles.length.toLocaleString()} candles
                                        {results.dataFetchedAt != null && (
                                            <> · Fetched {new Date(results.dataFetchedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</>
                                        )}
                                        {(typeof results.totalReturnPct === "number" || typeof results.totalReturn === "number") && (
                                            <> · Total return: {(results.totalReturn ?? results.totalReturnPct ?? 0).toFixed(2)}%</>
                                        )}
                                        {typeof results.maxDrawdown === "number" && (
                                            <> · Max drawdown: {results.maxDrawdown.toFixed(2)}%</>
                                        )}
                                    </span>
                                )}
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="min-h-[200px] flex flex-col border-t border-border mt-2 p-0">
                            {errorMessage ? (
                                <div className="flex-1 flex items-center justify-center p-6">
                                    <div className="text-center max-w-md">
                                        <p className="text-destructive font-medium mb-1">Backtest failed</p>
                                        <p className="text-sm text-muted-foreground">{errorMessage}</p>
                                        <p className="text-xs text-muted-foreground mt-2">Check server is running and API keys in Settings.</p>
                                    </div>
                                </div>
                            ) : !isRunning && !marketRegime ? (
                                <div className="flex-1 flex items-center justify-center text-muted-foreground">
                                    <div className="text-center">
                                        <BarChart3 className="w-12 h-12 mx-auto mb-4 opacity-20" />
                                        <p>Click "Run Backtest" to begin analysis.</p>
                                    </div>
                                </div>
                            ) : isRunning ? (
                                <div className="flex-1 flex items-center justify-center text-center">
                                    <div>
                                        <Activity className="w-12 h-12 mx-auto mb-4 text-primary animate-spin" />
                                        <p className="text-primary font-medium">Fetching real-time candles & calculating indicators...</p>
                                    </div>
                                </div>
                            ) : (
                                <div className="flex-1 flex flex-col overflow-hidden">
                                    {/* Metrics – Total P&L, Drawdown, Trades, Profitable %, Profit Factor */}
                                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 p-4 border-b border-border bg-black/10">
                                        <div className="p-3 rounded-lg bg-secondary/20 border border-border/50">
                                            <div className="text-[10px] text-muted-foreground uppercase font-semibold">Total P&L</div>
                                            <div className={`text-lg font-bold ${(results?.totalPnlUsd ?? 0) >= 0 ? "text-profit" : "text-destructive"}`}>
                                                {(results?.totalPnlUsd ?? 0) >= 0 ? "+" : ""}{(results?.totalPnlUsd ?? 0).toFixed(2)} USD
                                            </div>
                                            <div className={`text-xs ${((results?.totalReturn ?? results?.totalReturnPct) ?? 0) >= 0 ? "text-profit" : "text-destructive"}`}>
                                                {(((results?.totalReturn ?? results?.totalReturnPct) ?? 0) >= 0 ? "+" : "")}{((results?.totalReturn ?? results?.totalReturnPct) ?? 0).toFixed(2)}%
                                            </div>
                                        </div>
                                        <div className="p-3 rounded-lg bg-secondary/20 border border-border/50">
                                            <div className="text-[10px] text-muted-foreground uppercase font-semibold">Max equity drawdown</div>
                                            <div className="text-lg font-bold text-white">{(results?.maxDrawdownUsd ?? 0).toFixed(2)} USD</div>
                                            <div className="text-xs text-muted-foreground">{(results?.maxDrawdownPct ?? results?.maxDrawdown ?? 0).toFixed(2)}%</div>
                                        </div>
                                        <div className="p-3 rounded-lg bg-secondary/20 border border-border/50">
                                            <div className="text-[10px] text-muted-foreground uppercase font-semibold">Total trades</div>
                                            <div className="text-lg font-bold text-white">{results?.stats?.totalTrades ?? results?.totalTrades ?? 0}</div>
                                        </div>
                                        <div className="p-3 rounded-lg bg-secondary/20 border border-border/50">
                                            <div className="text-[10px] text-muted-foreground uppercase font-semibold">Profitable trades</div>
                                            <div className="text-lg font-bold text-profit">
                                                {Number(results?.winRate ?? results?.stats?.winRate ?? 0).toFixed(1)}%
                                            </div>
                                            <div className="text-xs text-muted-foreground">{results?.wins ?? 0}/{results?.stats?.totalTrades ?? results?.totalTrades ?? 0}</div>
                                        </div>
                                        <div className="p-3 rounded-lg bg-secondary/20 border border-border/50">
                                            <div className="text-[10px] text-muted-foreground uppercase font-semibold">Profit factor</div>
                                            <div className="text-lg font-bold text-amber-400">
                                                {typeof results?.profitFactor === "number"
                                                    ? results.profitFactor >= 999 ? "MAX" : results.profitFactor.toFixed(2)
                                                    : (results?.stats?.profitFactor ?? "0.00")}
                                            </div>
                                        </div>
                                    </div>

                                    {/* Analysis Text */}
                                    <div className="px-4 py-3 bg-secondary/30 border-y border-border">
                                        <div className="flex items-start space-x-2">
                                            <Activity className="w-3 h-3 text-primary mt-0.5" />
                                            <p className="text-[11px] text-muted-foreground leading-relaxed">
                                                <span className="text-white font-medium">Internal Analysis:</span> {results?.reason}
                                                <br />
                                                <span className="opacity-70 mt-1 block italic text-[10px]">
                                                    {results?.adaptive && results?.currentRegime
                                                        ? `Current regime: ${results.currentRegime.regime} → ${results.currentRegime.strategy}. ${results.currentRegime.reason}`
                                                        : `Current stance: Using ${marketRegime === 'Side' ? 'RSI Mean-Reversion' : 'EMA Trend-Following'} strategy.`}
                                                </span>
                                            </p>
                                        </div>
                                    </div>

                                    {/* Regime Performance (adaptive only) */}
                                    {results?.adaptive && Array.isArray(results?.regimePerformance) && results.regimePerformance.length > 0 && (
                                        <div className="px-4 py-3 border-b border-border">
                                            <div className="text-[10px] text-muted-foreground uppercase font-semibold mb-2">Regime performance</div>
                                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
                                                {results.regimePerformance.map((rp: any, idx: number) => (
                                                    <div key={idx} className="p-2 rounded bg-secondary/20 border border-border/50 text-[10px]">
                                                        <div className="font-semibold text-white">{rp.regime}</div>
                                                        <div className="text-muted-foreground">{rp.strategy}</div>
                                                        <div className="mt-1">Trades: {rp.trades} · Win rate: {Number(rp.winRate).toFixed(1)}% · PF: {Number(rp.profitFactor).toFixed(2)} · Return: {rp.totalReturnPct?.toFixed(2)}%</div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {/* Data Table (Small) */}
                                    <div className="flex-1 overflow-auto bg-black/40">
                                        <table className="w-full text-[10px] text-left border-collapse">
                                            <thead className="sticky top-0 bg-secondary/80 backdrop-blur-sm border-b border-border shadow-sm">
                                                <tr>
                                                    <th className="px-3 py-2 text-muted-foreground font-semibold">TIMESTAMP</th>
                                                    <th className="px-3 py-2 text-muted-foreground font-semibold">PRICE (CLOSE)</th>
                                                    <th className="px-3 py-2 text-muted-foreground font-semibold">SIGNAL</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-border/20">
                                                {candles.slice(-15).reverse().map((c, i) => (
                                                    <tr key={i} className="hover:bg-white/5 transition-colors border-b border-border/10">
                                                        <td className="px-3 py-1.5 font-mono text-muted-foreground">
                                                            {new Date(c.time * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                                                        </td>
                                                        <td className="px-3 py-1.5 font-mono font-medium">{parseFloat(c.close).toFixed(2)}</td>
                                                        <td className="px-3 py-1.5">
                                                            {i % 7 === 0 ? <Badge className="text-[9px] h-4 bg-profit/20 text-profit border-profit/30 uppercase">Scan</Badge> : <span className="text-muted-foreground/30">—</span>}
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )}
                        </CardContent>

                    </Card>

                </div>

                <Card className="glass-card">
                    <CardHeader>
                        <CardTitle>Strategy Settings</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="space-y-2">
                            <label className="text-xs font-medium text-muted-foreground uppercase">Search & Select Asset</label>
                            <div className="relative group">
                                <div className="absolute left-3 top-3">
                                    <Search className="w-3 h-3 text-muted-foreground group-focus-within:text-primary transition-colors" />
                                </div>
                                <input
                                    type="text"
                                    placeholder="Search coins (e.g. BTC, SOL)..."
                                    className="w-full bg-black/40 border border-border rounded-t-md pl-8 pr-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary h-9"
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                />
                                <div className="relative">
                                    <select
                                        className="w-full bg-black/40 border-x border-b border-border rounded-b-md px-3 py-2 text-sm appearance-none focus:outline-none focus:ring-1 focus:ring-primary h-10 scrollbar-hide"
                                        value={selectedSymbol}
                                        onChange={(e) => setSelectedSymbol(e.target.value)}
                                    >
                                        {filteredProducts.length > 0 ? (
                                            filteredProducts.map(p => (
                                                <option key={p.symbol} value={p.symbol} className="bg-[#111]">{p.symbol}</option>
                                            ))
                                        ) : (
                                            <option value="" disabled className="bg-[#111]">No coins found</option>
                                        )}
                                    </select>
                                    <ChevronDown className="absolute right-3 top-3 w-4 h-4 text-muted-foreground pointer-events-none" />
                                </div>
                            </div>
                        </div>
                        <div className="space-y-2">
                            <label className="text-xs font-medium text-muted-foreground uppercase">Timeframe (Resolution)</label>
                            <div className="relative">
                                <select
                                    className="w-full bg-black/40 border border-border rounded-md px-3 py-2 text-sm appearance-none focus:outline-none focus:ring-1 focus:ring-primary h-10"
                                    value={selectedResolution}
                                    onChange={(e) => setSelectedResolution(e.target.value)}
                                >
                                    {RESOLUTIONS.map(r => (
                                        <option key={r.value} value={r.value} className="bg-[#111]">{r.label}</option>
                                    ))}
                                </select>
                                <ChevronDown className="absolute right-3 top-3 w-4 h-4 text-muted-foreground pointer-events-none" />
                            </div>
                        </div>

                        <div className="space-y-2 pt-2">
                            <label className="text-xs font-medium text-muted-foreground uppercase">Strategy Model</label>
                            <div className="relative">
                                <select
                                    className="w-full bg-black/40 border border-border rounded-md px-3 py-2 text-sm appearance-none focus:outline-none focus:ring-1 focus:ring-primary h-10"
                                    value={selectedPreset}
                                    onChange={(e) => setSelectedPreset(e.target.value)}
                                >
                                    {STRATEGY_PRESETS.map(s => (
                                        <option key={s.id} value={s.id} className="bg-[#111]">{s.name}</option>
                                    ))}
                                </select>
                                <ChevronDown className="absolute right-3 top-3 w-4 h-4 text-muted-foreground pointer-events-none" />
                            </div>
                            <p className="text-[10px] text-muted-foreground italic mt-1">
                                {STRATEGY_PRESETS.find(s => s.id === selectedPreset)?.description}
                            </p>
                        </div>

                        <div className="pt-4 border-t border-border">
                            <p className="text-[11px] text-muted-foreground italic leading-relaxed">
                                Strategies will adapt to market conditions automatically based on the selected timeframe.
                            </p>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}

