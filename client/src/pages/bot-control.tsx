import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Play, Square, Settings2, ShieldAlert, Cpu } from "lucide-react";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";

export default function BotControl() {
  const [isRunning, setIsRunning] = useState(true);
  const { toast } = useToast();

  const handleToggle = () => {
    setIsRunning(!isRunning);
    toast({
      title: isRunning ? "Bot Stopped" : "Bot Started",
      description: isRunning ? "Trading operations halted." : "Bot is now active and scanning markets.",
      variant: isRunning ? "destructive" : "default",
    });
  };

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
            <CardDescription>Select and configure trading logic.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Trading Symbol</Label>
              <Select defaultValue="BTCUSDT">
                <SelectTrigger className="font-mono">
                  <SelectValue placeholder="Select Pair" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="BTCUSDT">BTC/USDT</SelectItem>
                  <SelectItem value="ETHUSDT">ETH/USDT</SelectItem>
                  <SelectItem value="SOLUSDT">SOL/USDT</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Timeframe</Label>
              <Select defaultValue="15m">
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
            </div>

            <div className="space-y-2">
              <Label>Strategy Type</Label>
              <Select defaultValue="ema_cross">
                <SelectTrigger>
                  <SelectValue placeholder="Select Strategy" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ema_cross">EMA Crossover (Trend)</SelectItem>
                  <SelectItem value="rsi_reversal">RSI Reversal (Mean Rev)</SelectItem>
                  <SelectItem value="breakout">Volatility Breakout</SelectItem>
                  <SelectItem value="auto">Auto-Detect (ADX)</SelectItem>
                </SelectContent>
              </Select>
            </div>
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
                <span className="text-sm font-mono text-muted-foreground">1.5%</span>
              </div>
              <Slider defaultValue={[1.5]} max={5} step={0.1} className="[&>.relative>.absolute]:bg-primary" />
            </div>

            <div className="space-y-4">
              <div className="flex justify-between">
                <Label>Max Daily Loss</Label>
                <span className="text-sm font-mono text-muted-foreground">5.0%</span>
              </div>
              <Slider defaultValue={[5]} max={10} step={0.5} className="[&>.relative>.absolute]:bg-destructive" />
            </div>

            <div className="space-y-4">
              <div className="flex justify-between">
                <Label>Leverage</Label>
                <span className="text-sm font-mono text-muted-foreground">10x</span>
              </div>
              <Slider defaultValue={[10]} max={50} step={1} />
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
        <CardFooter className="py-6 flex justify-end space-x-4">
          <Button variant="outline" className="border-border hover:bg-white/5">
            <Settings2 className="w-4 h-4 mr-2" />
            Save Configuration
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
