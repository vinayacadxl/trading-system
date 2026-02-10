import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useLiveDelta, type LiveCandle, type LiveTicker } from "@/hooks/use-live-delta";
import { Radio, Wifi, WifiOff, Clock, TrendingUp } from "lucide-react";
import { useEffect, useRef, useState } from "react";

const MAX_EVENTS = 80;

type LogEntry = {
  type: "ticker" | "candle";
  at: string;
  payload: LiveTicker | LiveCandle;
};

export default function LiveDataPage() {
  const { liveCandle, liveTicker, connected } = useLiveDelta();
  const [eventLog, setEventLog] = useState<LogEntry[]>([]);
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!liveTicker) return;
    setEventLog((prev) => {
      const next = [...prev, { type: "ticker", at: new Date().toISOString(), payload: liveTicker }];
      return next.slice(-MAX_EVENTS);
    });
  }, [liveTicker]);

  useEffect(() => {
    if (!liveCandle) return;
    setEventLog((prev) => {
      const next = [...prev, { type: "candle", at: new Date().toISOString(), payload: liveCandle }];
      return next.slice(-MAX_EVENTS);
    });
  }, [liveCandle]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [eventLog]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Radio className="w-6 h-6 text-primary" />
          Live Data (WebSocket)
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          Delta Exchange se real-time ticker aur candlestick – Socket.IO pe kya aa raha hai.
        </p>
      </div>

      {/* Connection + latest values */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              {connected ? (
                <Wifi className="w-4 h-4 text-green-500" />
              ) : (
                <WifiOff className="w-4 h-4 text-muted-foreground" />
              )}
              Connection
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <Badge variant={connected ? "default" : "secondary"} className={connected ? "bg-green-600 hover:bg-green-600" : ""}>
                {connected ? "Connected" : "Disconnected"}
              </Badge>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-primary" />
              Live Ticker (v2/ticker)
            </CardTitle>
            <CardDescription>Sabse latest price – mark_price / last_price</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1 font-mono text-sm">
            {liveTicker ? (
              <>
                <div><span className="text-muted-foreground">Symbol:</span> {liveTicker.symbol}</div>
                <div><span className="text-muted-foreground">Last:</span> {liveTicker.lastPrice}</div>
                {liveTicker.markPrice != null && <div><span className="text-muted-foreground">Mark:</span> {liveTicker.markPrice}</div>}
                {liveTicker.indexPrice != null && <div><span className="text-muted-foreground">Index:</span> {liveTicker.indexPrice}</div>}
              </>
            ) : (
              <span className="text-muted-foreground">— Waiting for data…</span>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Clock className="w-4 h-4 text-primary" />
              Live Candle (candlestick_15m)
            </CardTitle>
            <CardDescription>Current 15m OHLC</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1 font-mono text-sm">
            {liveCandle ? (
              <>
                <div><span className="text-muted-foreground">O:</span> {liveCandle.open} <span className="text-muted-foreground">H:</span> {liveCandle.high}</div>
                <div><span className="text-muted-foreground">L:</span> {liveCandle.low} <span className="text-muted-foreground">C:</span> {liveCandle.close}</div>
                <div><span className="text-muted-foreground">Vol:</span> {liveCandle.volume} {liveCandle.symbol != null && ` · ${liveCandle.symbol}`}</div>
              </>
            ) : (
              <span className="text-muted-foreground">— Waiting for data…</span>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Event log */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Event log (last {MAX_EVENTS})</CardTitle>
          <CardDescription>WebSocket se aane wale live-ticker / live-candle events – neeche sabse naya.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg border border-border bg-muted/20 font-mono text-xs max-h-[400px] overflow-y-auto p-3 space-y-2">
            {eventLog.length === 0 ? (
              <div className="text-muted-foreground py-4 text-center">Koi event nahi aaya. Connection check karo.</div>
            ) : (
              eventLog.map((entry, i) => (
                <div key={`${entry.at}-${i}`} className="flex gap-3 items-start border-b border-border/50 pb-2 last:border-0">
                  <span className="text-muted-foreground shrink-0">{new Date(entry.at).toLocaleTimeString()}</span>
                  <Badge variant="outline" className="shrink-0 text-[10px]">
                    {entry.type === "ticker" ? "ticker" : "candle"}
                  </Badge>
                  <pre className="break-all whitespace-pre-wrap text-muted-foreground flex-1 min-w-0">
                    {(() => {
                      const s = JSON.stringify(entry.payload);
                      return s.length > 280 ? s.slice(0, 280) + "…" : s;
                    })()}
                  </pre>
                </div>
              ))
            )}
            <div ref={logEndRef} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
