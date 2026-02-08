import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowUpRight, ArrowDownRight, Activity, DollarSign, Wallet } from "lucide-react";
import { mockTicker, mockPositions, generateCandles } from "@/lib/mockData";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { useState, useEffect } from "react";

const candles = generateCandles(50);

export default function Dashboard() {
  const [ticker, setTicker] = useState(mockTicker);

  // Simulate live price updates
  useEffect(() => {
    const interval = setInterval(() => {
      setTicker(prev => ({
        ...prev,
        price: prev.price + (Math.random() - 0.5) * 10
      }));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="space-y-6 max-w-[1600px] mx-auto animate-in fade-in slide-in-from-bottom-4 duration-500">
      
      {/* Top Stats Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="glass-card border-l-4 border-l-primary">
          <CardContent className="p-4">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wider">Balance</p>
                <h3 className="text-2xl font-mono font-bold text-white mt-1">$12,450.00</h3>
              </div>
              <Wallet className="w-5 h-5 text-primary/50" />
            </div>
            <div className="flex items-center mt-2 text-green-500 text-xs font-mono">
              <ArrowUpRight className="w-3 h-3 mr-1" />
              +2.5% today
            </div>
          </CardContent>
        </Card>

        <Card className="glass-card border-l-4 border-l-green-500">
          <CardContent className="p-4">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wider">Unrealized PNL</p>
                <h3 className="text-2xl font-mono font-bold text-profit mt-1">+$104.85</h3>
              </div>
              <Activity className="w-5 h-5 text-green-500/50" />
            </div>
            <div className="flex items-center mt-2 text-green-500 text-xs font-mono">
              <span className="text-muted-foreground mr-1">Open Positions:</span> 1
            </div>
          </CardContent>
        </Card>

        <Card className="glass-card border-l-4 border-l-blue-500">
          <CardContent className="p-4">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wider">Bot Status</p>
                <h3 className="text-2xl font-mono font-bold text-white mt-1">RUNNING</h3>
              </div>
              <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse mt-1" />
            </div>
            <div className="flex items-center mt-2 text-xs font-mono text-muted-foreground">
              Strategy: EMA Crossover
            </div>
          </CardContent>
        </Card>

        <Card className="glass-card border-l-4 border-l-purple-500">
          <CardContent className="p-4">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wider">Daily ROI</p>
                <h3 className="text-2xl font-mono font-bold text-white mt-1">1.2%</h3>
              </div>
              <DollarSign className="w-5 h-5 text-purple-500/50" />
            </div>
            <div className="flex items-center mt-2 text-xs font-mono text-muted-foreground">
              Target: 2.0%
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Chart Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="glass-card lg:col-span-2 min-h-[500px] flex flex-col">
          <CardHeader className="border-b border-border pb-2 flex flex-row items-center justify-between">
            <div className="flex items-center space-x-4">
              <CardTitle className="text-lg font-bold text-white flex items-center">
                <span className="mr-2">{ticker.symbol}</span>
                <span className={`text-sm font-mono ${ticker.change24h >= 0 ? 'text-profit' : 'text-loss'}`}>
                  ${ticker.price.toFixed(2)}
                </span>
              </CardTitle>
              <div className="flex space-x-1">
                {['15m', '1h', '4h', '1d'].map((tf) => (
                  <Badge 
                    key={tf} 
                    variant="secondary" 
                    className="cursor-pointer hover:bg-primary/20 hover:text-primary transition-colors bg-secondary/50"
                  >
                    {tf}
                  </Badge>
                ))}
              </div>
            </div>
            <div className="flex items-center space-x-4 text-xs font-mono text-muted-foreground">
              <span>H: {ticker.high24h.toFixed(2)}</span>
              <span>L: {ticker.low24h.toFixed(2)}</span>
            </div>
          </CardHeader>
          <CardContent className="flex-1 p-0 pt-4">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={candles}>
                <defs>
                  <linearGradient id="colorPrice" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#F97316" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#F97316" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#222" vertical={false} />
                <XAxis 
                  dataKey="time" 
                  stroke="#555" 
                  tick={{fontSize: 12, fontFamily: 'JetBrains Mono'}}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis 
                  domain={['auto', 'auto']} 
                  stroke="#555" 
                  orientation="right"
                  tick={{fontSize: 12, fontFamily: 'JetBrains Mono'}}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(val) => `$${val}`}
                />
                <Tooltip 
                  contentStyle={{
                    backgroundColor: '#111', 
                    borderColor: '#333',
                    borderRadius: '4px',
                    fontFamily: 'JetBrains Mono'
                  }}
                  itemStyle={{color: '#fff'}}
                />
                <Area 
                  type="monotone" 
                  dataKey="close" 
                  stroke="#F97316" 
                  strokeWidth={2}
                  fillOpacity={1} 
                  fill="url(#colorPrice)" 
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Order Book / Right Panel */}
        <div className="space-y-6">
          <Card className="glass-card h-full flex flex-col">
            <CardHeader className="border-b border-border py-3">
              <CardTitle className="text-sm font-medium">Active Positions</CardTitle>
            </CardHeader>
            <CardContent className="p-0 flex-1">
              {mockPositions.map((pos) => (
                <div key={pos.id} className="p-4 border-b border-border last:border-0 hover:bg-white/5 transition-colors cursor-pointer group">
                  <div className="flex justify-between mb-2">
                    <span className="font-bold text-white flex items-center">
                      {pos.symbol}
                      <Badge variant="outline" className={`ml-2 text-[10px] h-4 border-${pos.side === 'LONG' ? 'profit' : 'loss'} text-${pos.side === 'LONG' ? 'profit' : 'loss'}`}>
                        {pos.side} {pos.leverage}x
                      </Badge>
                    </span>
                    <span className={`font-mono font-bold ${pos.pnl >= 0 ? 'text-profit' : 'text-loss'}`}>
                      {pos.pnl >= 0 ? '+' : ''}{pos.pnl} USDT
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground font-mono">
                    <div>Entry: <span className="text-white">{pos.entryPrice}</span></div>
                    <div className="text-right">Mark: <span className="text-white">{ticker.price.toFixed(1)}</span></div>
                    <div>Size: <span className="text-white">{pos.size}</span></div>
                    <div className="text-right">ROE: <span className={pos.pnlPercent >= 0 ? 'text-profit' : 'text-loss'}>{pos.pnlPercent}%</span></div>
                  </div>
                </div>
              ))}
              
              {/* Empty state filler */}
              {mockPositions.length === 0 && (
                <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
                  No active positions
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
