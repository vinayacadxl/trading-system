import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Play, Square, Settings2, ShieldAlert, Cpu, Wallet, BarChart3 } from "lucide-react";
import { useState, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import { usePortfolio } from "@/hooks/use-portfolio";
import { Link } from "wouter";

const ALL_MODELS = [
  { id: "pro_sniper_v3", name: "Pro Sniper V3", leverage: 25, rr: "3:1", type: "adaptive", desc: "Balanced quality trades with 3:1 RR" },
  { id: "lightning_scalper", name: "Lightning Scalper", leverage: 15, rr: "3:1", type: "adaptive", desc: "Golden Scalp - Triple Trend Filter & High Frequency" },
  { id: "momentum_master", name: "Momentum Master", leverage: 35, rr: "4:1", type: "adaptive", desc: "Aggressive momentum trading - High Risk" },
  { id: "trend_rider", name: "Trend Rider", leverage: 15, rr: "2.5:1", type: "adaptive", desc: "Conservative trend following - Steady Gains" },
  { id: "ema_crossover", name: "Basic EMA Crossover", leverage: 10, rr: "Dynamic", type: "legacy", desc: "Simple trend following using EMA20" },
  { id: "rsi", name: "Basic RSI Reversal", leverage: 10, rr: "Dynamic", type: "legacy", desc: "Mean reversion based on overbought/oversold" }
];

export default function BotControl() {
  const [isRunning, setIsRunning] = useState(false);
  const [symbol, setSymbol] = useState("BTCUSD");
  const [resolution, setResolution] = useState("15m");
  const [selectedModel, setSelectedModel] = useState("lightning_scalper");
  const [riskPct, setRiskPct] = useState(1.5);
  const [maxDailyLossPct, setMaxDailyLossPct] = useState(5);
  const { toast } = useToast();
  const { data: portfolio } = usePortfolio(60_000);

  useEffect(() => {
    fetch("/api/bot/status")
      .then((res) => res.json())
      .then((data) => {
        if (data.success && data.config) {
          setIsRunning(!!data.running);
          if (data.config.symbol) setSymbol(data.config.symbol);
          if (data.config.resolution) setResolution(data.config.resolution);
          if (data.config.strategyType === "adaptive") {
            setSelectedModel(data.config.strategyPreset || "pro_sniper_v3");
          } else {
            setSelectedModel(data.config.strategyType || "ema_crossover");
          }
          if (data.config.riskPct != null) setRiskPct(Number(data.config.riskPct));
          if (data.config.maxDailyLossPct != null) setMaxDailyLossPct(Number(data.config.maxDailyLossPct));
        }
      })
      .catch(() => { });
  }, []);

  const saveConfig = () => {
    const modelInfo = ALL_MODELS.find(m => m.id === selectedModel);
    fetch("/api/bot/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        symbol,
        resolution,
        strategyType: modelInfo?.type === "adaptive" ? "adaptive" : selectedModel as any,
        strategyPreset: modelInfo?.type === "adaptive" ? selectedModel : "pro_sniper_v3",
        riskPct,
        maxDailyLossPct,
      }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          toast({ title: "Configuration saved", description: "Strategy Tester will use this symbol and timeframe.", variant: "default" });
        } else toast({ title: "Save failed", description: data.error, variant: "destructive" });
      })
      .catch(() => toast({ title: "Save failed", description: "Network error", variant: "destructive" }));
  };

  const handleToggle = () => {
    if (isRunning) {
      fetch("/api/bot/stop", { method: "POST" })
        .then((res) => res.json())
        .then((data) => {
          if (data.success) {
            setIsRunning(false);
            toast({ title: "Bot Stopped", description: "Trading operations halted.", variant: "destructive" });
          }
        })
        .catch(() => { });
    } else {
      const modelInfo = ALL_MODELS.find(m => m.id === selectedModel);
      fetch("/api/bot/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol,
          resolution,
          strategyType: modelInfo?.type === "adaptive" ? "adaptive" : selectedModel as any,
          strategyPreset: modelInfo?.type === "adaptive" ? selectedModel : "pro_sniper_v3",
          riskPct,
          maxDailyLossPct
        }),
      })
        .then((res) => res.json())
        .then((data) => {
          if (data.success) {
            setIsRunning(true);
            toast({ title: "Bot Started", description: "Bot is now active and scanning markets.", variant: "default" });
          } else toast({ title: "Start failed", description: data.error, variant: "destructive" });
        })
        .catch(() => { });
    }
  };

  const strategyTesterUrl = `/tester?symbol=${encodeURIComponent(symbol)}&resolution=${encodeURIComponent(resolution)}`;

  return (
    <div className="max-w-4xl mx-auto space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-white tracking-tight">Bot Configuration</h1>
          <p className="text-muted-foreground mt-1">Manage strategy parameters and risk controls.</p>
        </div>
        <div className="flex items-center space-x-4">
          <div className={`px-4 py-1.5 rounded-full text-sm font-mono font-bold flex items-center border ${isRunning ? 'bg-green-500/10 text-green-500 border-green-500/20' : 'bg-red-500/10 text-red-500 border-red-500/20'}`}>
            <div className={`w-2 h-2 rounded-full mr-2 ${isRunning ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
            {isRunning ? 'RUNNING' : 'STOPPED'}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

        {/* Strategy Configuration */}
        <Card className="glass-card border-t-4 border-t-primary">
          <CardHeader>
            <div className="flex items-center space-x-2">
              <Cpu className="w-5 h-5 text-primary" />
              <CardTitle>Strategy Engine</CardTitle>
            </div>
            <CardDescription>Select and configure trading logic. Trades scale with account balance.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {portfolio?.suggestedMaxPositionUsd != null && Number(portfolio.suggestedMaxPositionUsd) > 0 && (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-primary/10 border border-primary/20 text-sm font-mono">
                <Wallet className="w-4 h-4 text-primary" />
                <span className="text-muted-foreground">Auto sizing:</span>
                <span className="text-white font-bold">max ${Number(portfolio.suggestedMaxPositionUsd).toFixed(2)} per trade</span>
                <span className="text-muted-foreground">(5% of balance)</span>
              </div>
            )}
            <div className="space-y-2">
              <Label>Trading Symbol</Label>
              <Select value={symbol} onValueChange={setSymbol}>
                <SelectTrigger className="font-mono">
                  <SelectValue placeholder="Select Pair" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="BTCUSD">BTC/USD</SelectItem>
                  <SelectItem value="ETHUSD">ETH/USD</SelectItem>
                  <SelectItem value="SOLUSD">SOL/USD</SelectItem>
                  <SelectItem value="XRPUSD">XRP/USD</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Timeframe</Label>
              <Select value={resolution} onValueChange={setResolution}>
                <SelectTrigger className="font-mono">
                  <SelectValue placeholder="Select Timeframe" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1m">1 Minute</SelectItem>
                  <SelectItem value="5m">5 Minutes</SelectItem>
                  <SelectItem value="15m">15 Minutes</SelectItem>
                  <SelectItem value="1h">1 Hour</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Trends differ by timeframe. See Strategy Tester for backtest on this resolution.</p>
            </div>

            <div className="space-y-2">
              <Label>Trading Model</Label>
              <Select value={selectedModel} onValueChange={setSelectedModel}>
                <SelectTrigger className="border-primary/40 bg-primary/5">
                  <SelectValue placeholder="Select Model" />
                </SelectTrigger>
                <SelectContent>
                  <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Smart Models</div>
                  {ALL_MODELS.filter(m => m.type === 'adaptive').map(m => (
                    <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                  ))}
                  <div className="px-2 py-1.5 mt-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Basic Indicators</div>
                  {ALL_MODELS.filter(m => m.type === 'legacy').map(m => (
                    <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {selectedModel && (
              <div className="p-3 rounded-lg bg-black/40 border border-white/5 space-y-2 animate-in fade-in zoom-in-95 duration-300">
                <div className="flex justify-between items-start">
                  <span className="text-[10px] font-bold text-primary uppercase">Model Profile</span>
                  <span className="text-[10px] font-mono text-muted-foreground italic">v2.4.0-stable</span>
                </div>
                <p className="text-sm font-medium text-white">{ALL_MODELS.find(m => m.id === selectedModel)?.name}</p>
                <p className="text-xs text-muted-foreground line-clamp-2">{ALL_MODELS.find(m => m.id === selectedModel)?.desc}</p>
                <div className="grid grid-cols-2 gap-2 mt-2 pt-2 border-t border-white/5">
                  <div>
                    <p className="text-[10px] text-muted-foreground">Est. RR Ratio</p>
                    <p className="text-xs font-mono text-green-500 font-bold">{ALL_MODELS.find(m => m.id === selectedModel)?.rr}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground">Default Lev.</p>
                    <p className="text-xs font-mono text-primary font-bold">{ALL_MODELS.find(m => m.id === selectedModel)?.leverage}x</p>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Risk Management */}
        <Card className="glass-card border-t-4 border-t-destructive">
          <CardHeader>
            <div className="flex items-center space-x-2">
              <ShieldAlert className="w-5 h-5 text-destructive" />
              <CardTitle>Risk Management</CardTitle>
            </div>
            <CardDescription>Capital protection safeguards.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-4">
              <div className="flex justify-between">
                <Label>Risk per Trade</Label>
                <span className="text-sm font-mono text-muted-foreground">{riskPct}%</span>
              </div>
              <Slider value={[riskPct]} onValueChange={([v]) => setRiskPct(v ?? 1.5)} max={5} step={0.1} className="[&>.relative>.absolute]:bg-primary" />
            </div>

            <div className="space-y-4">
              <div className="flex justify-between">
                <Label>Max Daily Loss</Label>
                <span className="text-sm font-mono text-muted-foreground">{maxDailyLossPct}%</span>
              </div>
              <Slider value={[maxDailyLossPct]} onValueChange={([v]) => setMaxDailyLossPct(v ?? 5)} max={10} step={0.5} className="[&>.relative>.absolute]:bg-destructive" />
            </div>

            <div className="space-y-4">
              <div className="flex justify-between">
                <Label>Leverage</Label>
                <span className="text-sm font-mono text-muted-foreground">
                  {ALL_MODELS.find(m => m.id === selectedModel)?.leverage || 10}x
                </span>
              </div>
              <Slider
                value={[ALL_MODELS.find(m => m.id === selectedModel)?.leverage || 10]}
                disabled={true}
                max={50}
                step={1}
              />
              <p className="text-[10px] text-muted-foreground mt-1 italic text-center">Auto-managed by {ALL_MODELS.find(m => m.id === selectedModel)?.name}</p>
            </div>

            <div className="flex items-center justify-between border rounded-lg p-3 border-border bg-black/20">
              <div className="space-y-0.5">
                <Label className="text-base">Auto-Stop</Label>
                <p className="text-xs text-muted-foreground">Halt on Max Drawdown</p>
              </div>
              <Switch checked={true} />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Control Actions */}
      <Card className="glass-card bg-secondary/30">
        <CardFooter className="py-6 flex flex-wrap justify-end gap-4">
          <Button variant="outline" className="border-border hover:bg-white/5" onClick={saveConfig}>
            <Settings2 className="w-4 h-4 mr-2" />
            Save Configuration
          </Button>
          <Button variant="outline" className="border-primary/50 hover:bg-primary/10" asChild>
            <Link href={strategyTesterUrl}>
              <BarChart3 className="w-4 h-4 mr-2" />
              Preview in Strategy Tester
            </Link>
          </Button>
          {isRunning ? (
            <Button
              variant="destructive"
              onClick={handleToggle}
              className="w-40 font-bold tracking-wide shadow-[0_0_20px_rgba(239,68,68,0.3)] hover:shadow-[0_0_30px_rgba(239,68,68,0.5)] transition-all"
            >
              <Square className="w-4 h-4 mr-2 fill-current" />
              STOP BOT
            </Button>
          ) : (
            <Button
              onClick={handleToggle}
              className="w-40 bg-profit hover:bg-profit/90 text-white font-bold tracking-wide shadow-[0_0_20px_rgba(34,197,94,0.3)] hover:shadow-[0_0_30px_rgba(34,197,94,0.5)] transition-all"
            >
              <Play className="w-4 h-4 mr-2 fill-current" />
              START BOT
            </Button>
          )}
        </CardFooter>
      </Card>
    </div>
  );
}
