import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CandlestickChart } from "@/components/CandlestickChart";
import { Activity, DollarSign, Wallet, Maximize2, X } from "lucide-react";
import { useState, useRef, useLayoutEffect, useEffect } from "react";
import { usePortfolio } from "@/hooks/use-portfolio";
import { usePositions } from "@/hooks/use-positions";
import { useLiveDelta } from "@/hooks/use-live-delta";

const CHART_TIMEFRAMES = [
  { label: "1m", value: "1m" },
  { label: "3m", value: "3m" },
  { label: "5m", value: "5m" },
  { label: "15m", value: "15m" },
  { label: "30m", value: "30m" },
  { label: "1h", value: "1h" },
  { label: "2h", value: "2h" },
  { label: "4h", value: "4h" },
  { label: "1d", value: "1d" },
];


export default function Dashboard() {
  const [chartSymbol, setChartSymbol] = useState("BTCUSD");
  const [chartResolution, setChartResolution] = useState("15m");
  const [chartCandles, setChartCandles] = useState<{ time: number; open: string; high: string; low: string; close: string; volume?: string }[]>([]);
  const [chartLivePrice, setChartLivePrice] = useState<number | null>(null);
  const [chartFullscreen, setChartFullscreen] = useState(false);
  const [fullscreenChartHeight, setFullscreenChartHeight] = useState(600);
  const [botRunning, setBotRunning] = useState(false);
  const [botRegime, setBotRegime] = useState<{ regime: string; strategy: string; reason: string } | null>(null);
  const [activeModel, setActiveModel] = useState<string>("lightning_scalper");
  const [signalConfidence, setSignalConfidence] = useState(0);
  const [statusMessage, setStatusMessage] = useState<string>("Initializing...");
  const fullscreenChartRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!chartFullscreen || !fullscreenChartRef.current) return;
    const el = fullscreenChartRef.current;
    const onResize = () => setFullscreenChartHeight(el.getBoundingClientRect().height);
    onResize();
    const ro = new ResizeObserver(onResize);
    ro.observe(el);
    return () => ro.disconnect();
  }, [chartFullscreen]);

  useEffect(() => {
    const fetchStatus = () => {
      fetch("/api/bot/status")
        .then((res) => res.json())
        .then((data) => {
          if (data.success) {
            if (data.config?.symbol) setChartSymbol(data.config.symbol);
            setBotRunning(!!data.running);
            setBotRegime(data.currentRegime || null);
            setSignalConfidence(data.lastSignalConfidence || 0);
            setStatusMessage(data.lastExecutionMessage || "Scanning...");
            if (data.config?.strategyType === "adaptive") {
              setActiveModel(data.config.strategyPreset || "pro_sniper_v3");
            } else {
              setActiveModel(data.config?.strategyType || "ema_crossover");
            }
          }
        })
        .catch(() => { });
    };
    fetchStatus();
    const interval = setInterval(fetchStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  // Candles: sirf initial load + symbol/resolution change pe REST. Live updates direct WebSocket (live-candle) – no REST poll, real-time.
  useEffect(() => {
    let cancelled = false;
    const url = `/api/delta/candles?symbol=${encodeURIComponent(chartSymbol)}&resolution=${encodeURIComponent(chartResolution)}&limit=300&_t=${Date.now()}`;
    fetch(url, { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        if (cancelled || !data.success || !Array.isArray(data.candles)) return;
        setChartCandles(data.candles);
      })
      .catch(() => { });
    return () => {
      cancelled = true;
    };
  }, [chartSymbol, chartResolution]);

  const { data: portfolio, loading: balanceLoading } = usePortfolio(60_000);
  const { positions, unrealizedPnl, loading: positionsLoading } = usePositions(60_000);
  const { liveCandle, liveTicker, connected: liveWsConnected } = useLiveDelta();

  // Ticker: WebSocket primary (real-time). REST sirf jab WS disconnected ho – 1s fallback. Auto-trading ke liye fast data.
  useEffect(() => {
    if (liveWsConnected) return; // WebSocket se live aayega – REST poll mat karo
    let cancelled = false;
    const fetchTicker = () => {
      fetch(`/api/delta/ticker?symbol=${encodeURIComponent(chartSymbol)}&_t=${Date.now()}`, { cache: "no-store" })
        .then((res) => res.json())
        .then((data) => {
          if (cancelled || !data.success || data.lastPrice == null) return;
          const p = Number(data.lastPrice);
          if (Number.isFinite(p)) setChartLivePrice(p);
        })
        .catch(() => { });
    };
    fetchTicker();
    const interval = setInterval(fetchTicker, 1000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [chartSymbol, liveWsConnected]);

  // Apply live ticker to chart price when symbol matches (Delta socket sends BTCUSDT)
  useEffect(() => {
    if (!liveTicker) return;
    const sym = liveTicker.symbol?.toUpperCase() ?? "";
    if (chartSymbol !== "BTCUSDT" && chartSymbol !== "BTCUSD") return;
    if (sym !== "BTCUSDT" && sym !== "BTCUSD") return;
    const p = Number(liveTicker.lastPrice);
    if (Number.isFinite(p)) setChartLivePrice(p);
  }, [liveTicker, chartSymbol]);

  // Merge live 15m candle into chart when symbol and resolution match
  useEffect(() => {
    if (!liveCandle || chartResolution !== "15m") return;
    if (chartSymbol !== "BTCUSDT" && chartSymbol !== "BTCUSD") return;
    setChartCandles((prev) => {
      const c = liveCandle;
      const newCandle = {
        time: c.time,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume ?? "",
      };
      const idx = prev.findIndex((x) => x.time === c.time);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = newCandle;
        return next;
      }
      const next = [...prev, newCandle].sort((a, b) => a.time - b.time);
      return next.slice(-500);
    });
  }, [liveCandle, chartSymbol, chartResolution]);

  const balanceDisplay = balanceLoading || !portfolio
    ? "—"
    : `$${Number(portfolio.portfolioValue).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const pnlDisplay = positionsLoading
    ? "—"
    : `${unrealizedPnl >= 0 ? "+" : ""}$${unrealizedPnl.toFixed(2)}`;
  const openCount = positions.length;

  return (
    <div className="space-y-6 max-w-[1600px] mx-auto animate-in fade-in slide-in-from-bottom-4 duration-500">

      {/* Top Stats Row – all from actual account */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="glass-card border-l-4 border-l-primary">
          <CardContent className="p-4">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wider">Balance</p>
                <h3 className="text-2xl font-mono font-bold text-white mt-1">{balanceDisplay}</h3>
              </div>
              <Wallet className="w-5 h-5 text-primary/50" />
            </div>
            <div className="flex items-center mt-2 text-muted-foreground text-xs font-mono flex-wrap gap-y-1">
              From Delta Exchange
              {portfolio?.suggestedMaxPositionUsd && Number(portfolio.suggestedMaxPositionUsd) > 0 && (
                <span className="block w-full text-primary/80">Bot: max ~${Number(portfolio.suggestedMaxPositionUsd).toFixed(2)} per trade (5% of balance)</span>
              )}
              {balanceDisplay === "$0.00" && portfolio && (
                <span className="block mt-1 text-amber-500/90">Check API keys in Settings.</span>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="glass-card border-l-4 border-l-green-500">
          <CardContent className="p-4">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wider">Unrealized PNL</p>
                <h3 className={`text-2xl font-mono font-bold mt-1 ${unrealizedPnl >= 0 ? "text-profit" : "text-loss"}`}>
                  {pnlDisplay}
                </h3>
              </div>
              <Activity className="w-5 h-5 text-green-500/50" />
            </div>
            <div className="flex items-center mt-2 text-muted-foreground text-xs font-mono">
              <span className="mr-1">Open Positions:</span> {openCount}
            </div>
          </CardContent>
        </Card>

        <Card className={`glass-card border-l-4 ${botRunning ? "border-l-profit shadow-[0_0_15px_rgba(34,197,94,0.1)]" : "border-l-muted"}`}>
          <CardContent className="p-4">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wider">Bot Status</p>
                <h3 className={`text-2xl font-mono font-bold mt-1 ${botRunning ? "text-profit" : "text-muted-foreground"}`}>
                  {botRunning ? "Running" : "Stopped"}
                </h3>
              </div>
              <div className={`w-3 h-3 rounded-full mt-1 ${botRunning ? "bg-profit animate-pulse" : "bg-muted"}`} />
            </div>
            <div className="flex flex-col mt-2 space-y-2">
              {botRunning ? (
                <>
                  <div className="flex justify-between items-center text-[10px] font-mono leading-relaxed">
                    <span className="text-primary font-bold uppercase tracking-tight">{activeModel.replace(/_/g, ' ')}</span>
                    <span className="text-muted-foreground truncate ml-2">{botRegime ? botRegime.regime : 'Scanning...'}</span>
                  </div>
                  <div className="text-[9px] text-muted-foreground italic truncate">
                    {statusMessage}
                  </div>
                  {signalConfidence > 0 && (
                    <div className="space-y-1 animate-in fade-in slide-in-from-left-2 duration-500">
                      <div className="flex justify-between text-[10px] uppercase font-bold tracking-tighter">
                        <span className="text-muted-foreground">Signal Strength</span>
                        <span className={signalConfidence > 75 ? "text-profit" : signalConfidence > 40 ? "text-amber-500" : "text-loss"}>
                          {signalConfidence}%
                        </span>
                      </div>
                      <div className="h-1 w-full bg-white/5 rounded-full overflow-hidden">
                        <div
                          className={`h-full transition-all duration-1000 ${signalConfidence > 75 ? "bg-profit" : signalConfidence > 40 ? "bg-amber-500" : "bg-loss"}`}
                          style={{ width: `${signalConfidence}%` }}
                        />
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <span className="text-muted-foreground text-[10px] font-mono capitalize">Configure in Bot Control</span>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="glass-card border-l-4 border-l-purple-500">
          <CardContent className="p-4">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wider">Daily ROI</p>
                <h3 className={`text-2xl font-mono font-bold mt-1 ${portfolio?.dailyRoiPct != null ? (portfolio.dailyRoiPct >= 0 ? "text-profit" : "text-loss") : "text-muted-foreground"}`}>
                  {portfolio?.dailyRoiPct != null
                    ? `${portfolio.dailyRoiPct >= 0 ? "+" : ""}${portfolio.dailyRoiPct.toFixed(2)}%`
                    : "—"}
                </h3>
              </div>
              <DollarSign className="w-5 h-5 text-purple-500/50" />
            </div>
            <div className="flex items-center mt-2 text-xs font-mono text-muted-foreground">
              {portfolio?.dailyRoiPct != null
                ? "Based on balance 24h ago"
                : "Collecting balance history (~24h needed)"}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Chart Section – Delta-style: OHLC strip + live candlestick */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="glass-card lg:col-span-2 flex flex-col overflow-hidden">
          <CardHeader className="border-b border-border pb-2 flex flex-row items-center justify-between flex-shrink-0 flex-wrap gap-2">
            <div>
              <CardTitle className="text-lg font-bold text-white flex items-center gap-2">
                Live Chart (Delta)
                {liveWsConnected && (chartSymbol === "BTCUSDT" || chartSymbol === "BTCUSD") && (
                  <Badge variant="outline" className="text-[10px] border-green-500/60 text-green-400 bg-green-500/10">
                    Live
                  </Badge>
                )}
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">{chartSymbol} · Real-time OHLC from Delta Exchange</p>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              {chartLivePrice != null && Number.isFinite(chartLivePrice) && (
                <span className="font-mono text-base font-bold text-white">
                  ${chartLivePrice.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
                </span>
              )}
              <span className="text-[10px] text-muted-foreground uppercase font-semibold">Timeframe</span>
              <Select value={chartResolution} onValueChange={setChartResolution}>
                <SelectTrigger className="w-[80px] h-8 text-xs font-mono border-border bg-secondary/30 text-foreground">
                  <SelectValue placeholder="15m" />
                </SelectTrigger>
                <SelectContent>
                  {CHART_TIMEFRAMES.map((tf) => (
                    <SelectItem key={tf.value} value={tf.value} className="text-xs font-mono">
                      {tf.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <button
                type="button"
                onClick={() => setChartFullscreen(true)}
                className="p-2 rounded-md border border-border bg-secondary/50 hover:bg-primary/20 hover:text-primary transition-colors"
                title="Full screen"
              >
                <Maximize2 className="w-4 h-4" />
              </button>
            </div>
          </CardHeader>
          {/* OHLC strip – real Delta style above chart */}
          {chartCandles.length > 0 && (
            <div className="px-3 py-1.5 border-b border-border/50 bg-black/20 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-mono">
              {(() => {
                const last = chartCandles[chartCandles.length - 1]!;
                const o = parseFloat(last.open);
                const h = parseFloat(last.high);
                const l = parseFloat(last.low);
                const c = chartLivePrice != null && Number.isFinite(chartLivePrice) ? chartLivePrice : parseFloat(last.close);
                const liveH = chartLivePrice != null ? Math.max(h, chartLivePrice) : h;
                const liveL = chartLivePrice != null ? Math.min(l, chartLivePrice) : l;
                const change = c - o;
                const changePct = o !== 0 ? (change / o) * 100 : 0;
                const up = change >= 0;
                return (
                  <>
                    <span className="text-muted-foreground">O <span className="text-white">{o.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</span></span>
                    <span className="text-muted-foreground">H <span className="text-white">{liveH.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</span></span>
                    <span className="text-muted-foreground">L <span className="text-white">{liveL.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</span></span>
                    <span className="text-muted-foreground">C <span className="text-white">{c.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</span></span>
                    <span className={up ? "text-green-500" : "text-red-500"}>
                      {up ? "+" : ""}{change.toFixed(1)} ({up ? "+" : ""}{changePct.toFixed(2)}%)
                    </span>
                  </>
                );
              })()}
            </div>
          )}
          <CardContent className="p-0 flex-1 flex flex-col min-h-0">
            {!chartFullscreen && (
              <div
                className="w-full overflow-hidden rounded-b-lg border-t border-border"
                style={{ width: "100%", height: 520, minHeight: 520 }}
              >
                <CandlestickChart candles={chartCandles} height={520} className="w-full min-w-0" currentPrice={chartLivePrice} resolution={chartResolution} />
              </div>
            )}
            {chartFullscreen && (
              <div className="flex items-center justify-center rounded-b-lg bg-muted/30" style={{ height: 520 }}>
                <p className="text-muted-foreground text-sm">Chart is in full screen. Click X there to close.</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Fullscreen chart overlay – Delta candlestick when open */}
        {chartFullscreen && (
          <div className="fixed inset-0 z-[100] flex flex-col bg-background">
            <div className="flex-shrink-0 flex items-center justify-between px-4 py-2 border-b border-border bg-card flex-wrap gap-2">
              <span className="font-semibold text-white">Live Chart (Delta) — {chartSymbol} · {chartResolution}</span>
              {chartLivePrice != null && Number.isFinite(chartLivePrice) && (
                <span className="font-mono font-bold text-white">
                  ${chartLivePrice.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
                </span>
              )}
              <button
                type="button"
                onClick={() => setChartFullscreen(false)}
                className="p-2 rounded-md border border-border hover:bg-destructive/20 hover:text-destructive transition-colors"
                title="Close full screen"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            {chartCandles.length > 0 && (
              <div className="flex-shrink-0 px-4 py-1.5 border-b border-border/50 bg-black/20 flex flex-wrap items-center gap-x-4 text-xs font-mono">
                {(() => {
                  const last = chartCandles[chartCandles.length - 1]!;
                  const o = parseFloat(last.open);
                  const h = parseFloat(last.high);
                  const l = parseFloat(last.low);
                  const c = chartLivePrice != null && Number.isFinite(chartLivePrice) ? chartLivePrice : parseFloat(last.close);
                  const liveH = chartLivePrice != null ? Math.max(h, chartLivePrice) : h;
                  const liveL = chartLivePrice != null ? Math.min(l, chartLivePrice) : l;
                  const change = c - o;
                  const changePct = o !== 0 ? (change / o) * 100 : 0;
                  const up = change >= 0;
                  return (
                    <>
                      <span className="text-muted-foreground">O <span className="text-white">{o.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</span></span>
                      <span className="text-muted-foreground">H <span className="text-white">{liveH.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</span></span>
                      <span className="text-muted-foreground">L <span className="text-white">{liveL.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</span></span>
                      <span className="text-muted-foreground">C <span className="text-white">{c.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</span></span>
                      <span className={up ? "text-green-500" : "text-red-500"}>{up ? "+" : ""}{change.toFixed(1)} ({up ? "+" : ""}{changePct.toFixed(2)}%)</span>
                    </>
                  );
                })()}
              </div>
            )}
            <div
              ref={fullscreenChartRef}
              className="w-full flex-1 min-h-0 p-2"
              style={{ minHeight: 400, height: "calc(100vh - 52px)" }}
            >
              <CandlestickChart candles={chartCandles} height={fullscreenChartHeight} className="w-full min-w-0 rounded border border-border" currentPrice={chartLivePrice} resolution={chartResolution} />
            </div>
          </div>
        )}

        {/* Active Positions – from Delta account */}
        <div className="space-y-6">
          <Card className="glass-card h-full flex flex-col">
            <CardHeader className="border-b border-border py-3">
              <CardTitle className="text-sm font-medium">Active Positions</CardTitle>
            </CardHeader>
            <CardContent className="p-0 flex-1">
              {positionsLoading && positions.length === 0 ? (
                <div className="h-full flex items-center justify-center text-muted-foreground text-sm py-8">
                  Loading…
                </div>
              ) : positions.length === 0 ? (
                <div className="h-full flex items-center justify-center text-muted-foreground text-sm py-8">
                  No active positions
                </div>
              ) : (
                positions.map((pos) => {
                  const entry = parseFloat(pos.entry_price) || 0;
                  const mark = parseFloat(pos.mark_price) || 0;
                  const size = Number(pos.size) || 0;
                  const pnl = (mark - entry) * size;
                  const notional = entry * Math.abs(size) || 1;
                  const pnlPercent = (pnl / notional) * 100;
                  const side = size >= 0 ? "LONG" : "SHORT";
                  return (
                    <div key={`${pos.product_id}-${pos.symbol}`} className="p-4 border-b border-border last:border-0 hover:bg-white/5 transition-colors group">
                      <div className="flex justify-between mb-2">
                        <span className="font-bold text-white flex items-center">
                          {pos.symbol}
                          <Badge variant="outline" className={`ml-2 text-[10px] h-4 ${side === "LONG" ? "border-profit text-profit" : "border-loss text-loss"}`}>
                            {side}
                          </Badge>
                        </span>
                        <span className={`font-mono font-bold ${pnl >= 0 ? "text-profit" : "text-loss"}`}>
                          {pnl >= 0 ? "+" : ""}{pnl.toFixed(2)} USDT
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground font-mono">
                        <div>Entry: <span className="text-white">{pos.entry_price}</span></div>
                        <div className="text-right">Mark: <span className="text-white">{pos.mark_price}</span></div>
                        <div>Size: <span className="text-white">{Math.abs(size)}</span></div>
                        <div className="text-right">ROE: <span className={pnlPercent >= 0 ? "text-profit" : "text-loss"}>{pnlPercent.toFixed(2)}%</span></div>
                      </div>
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>
        </div>
      </div>

    </div>
  );
}
