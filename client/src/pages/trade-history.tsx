import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { RefreshCw, AlertCircle, ChevronLeft, ChevronRight, TrendingUp, TrendingDown, DollarSign, Activity } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState, useEffect, useCallback, useMemo } from "react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";

const PAGE_SIZE = 20;

interface DeltaFill {
  id: number;
  order_id: number;
  product_id: number;
  symbol?: string;
  product_symbol?: string;
  side: string;
  size: number;
  price: string;
  fee?: string;
  fee_currency?: string;
  realized_pnl?: string;
  created_at: string;
  [key: string]: unknown;
}

export default function TradeHistory() {
  const [fills, setFills] = useState<DeltaFill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [prevCursor, setPrevCursor] = useState<string | null>(null);

  const fetchFills = useCallback(async (cursor?: { after?: string; before?: string }) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
      if (cursor?.after) params.set("after", cursor.after);
      if (cursor?.before) params.set("before", cursor.before);
      const res = await fetch(`/api/delta/fills?${params.toString()}`);
      const text = await res.text();
      let json: {
        success?: boolean;
        fills?: DeltaFill[];
        meta?: { after?: string; before?: string };
        error?: { message?: string; code?: string };
        errorMessage?: string;
      };
      try {
        json = JSON.parse(text);
      } catch {
        setError("Backend not running. See steps below.");
        setFills([]);
        setNextCursor(null);
        setPrevCursor(null);
        setLoading(false);
        return;
      }
      // Process API response

      const fillsErrorMsg = json.errorMessage ?? (json.success === false && json.error != null
        ? (json.error?.message ?? json.error?.code)
        : undefined);
      if (fillsErrorMsg) {
        setError(fillsErrorMsg);
        setFills([]);
        setNextCursor(null);
        setPrevCursor(null);
        setLoading(false);
        return;
      }
      if (!res.ok) {
        const err = json?.error;
        const msg = err?.message || (err?.code ? String(err.code) : "Failed to load fills");
        setError(msg);
        setFills([]);
        setNextCursor(null);
        setPrevCursor(null);
        setLoading(false);
        return;
      }
      if (json.success && Array.isArray(json.fills)) {
        setFills(json.fills);
        setNextCursor(json.meta?.after ?? null);
        setPrevCursor(json.meta?.before ?? null);
      } else {
        setFills([]);
        setNextCursor(null);
        setPrevCursor(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
      setFills([]);
      setNextCursor(null);
      setPrevCursor(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadNext = useCallback(() => {
    if (nextCursor) fetchFills({ after: nextCursor });
  }, [nextCursor, fetchFills]);

  const loadPrev = useCallback(() => {
    if (prevCursor) fetchFills({ before: prevCursor });
  }, [prevCursor, fetchFills]);

  useEffect(() => {
    fetchFills();
  }, [fetchFills]);

  const analysis = useMemo(() => {
    let buyCount = 0;
    let sellCount = 0;
    let totalFee = 0;
    let totalVolume = 0;
    let wins = 0;
    let losses = 0;
    let totalPnl = 0;
    const byDate: Record<string, { count: number; fee: number }> = {};
    for (const f of fills) {
      if ((f.side || "").toLowerCase() === "buy") buyCount++;
      else sellCount++;
      const fee = parseFloat(String(f.fee ?? 0)) || 0;
      totalFee += fee;
      totalVolume += Math.abs(Number(f.size) || 0) * (parseFloat(String(f.price)) || 0);
      const pnl = parseFloat(String((f as { realized_pnl?: string }).realized_pnl ?? 0)) || 0;
      if (pnl > 0) { wins++; totalPnl += pnl; }
      else if (pnl < 0) { losses++; totalPnl += pnl; }
      const iso = format(new Date(f.created_at), "yyyy-MM-dd");
      if (!byDate[iso]) byDate[iso] = { count: 0, fee: 0 };
      byDate[iso].count += 1;
      byDate[iso].fee += fee;
    }
    const chartData = Object.entries(byDate)
      .map(([iso, d]) => ({ date: format(new Date(iso + "T12:00:00"), "dd MMM"), iso, trades: d.count, fee: Number(d.fee.toFixed(4)) }))
      .sort((a, b) => a.iso.localeCompare(b.iso));
    return {
      totalTrades: fills.length,
      buyCount,
      sellCount,
      totalFee,
      totalVolume,
      wins,
      losses,
      totalPnl,
      chartData,
    };
  }, [fills]);

  const displaySymbol = (fill: DeltaFill) =>
    fill.symbol ?? (fill as { product_symbol?: string }).product_symbol ?? `#${fill.product_id}`;
  const displayFee = (fill: DeltaFill) => {
    const fee = fill.fee ?? (fill as { fee_paid?: string }).fee_paid;
    const curr = fill.fee_currency ?? (fill as { fee_currency?: string }).fee_currency ?? "";
    return fee != null && fee !== "" ? `${fee} ${curr}`.trim() : "—";
  };

  return (
    <div className="space-y-6 max-w-[1600px] mx-auto animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col md:flex-row justify-between md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white tracking-tight">Trade History</h1>
          <p className="text-muted-foreground mt-1">Order fills from your Delta Exchange account (for auto trading).</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => fetchFills()} disabled={loading} title="Refresh">
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-lg border border-border bg-destructive/10 text-destructive space-y-2">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-5 h-5 shrink-0" />
            <span className="font-medium">{error}</span>
          </div>
          {error.includes("Backend not running") && (
            <ol className="list-decimal list-inside text-sm text-muted-foreground space-y-1 ml-7">
              <li>Terminal / CMD kholo (project folder me)</li>
              <li><code className="bg-black/20 px-1 rounded">npm run dev</code> chalao</li>
              <li>Jab tak <code className="bg-black/20 px-1 rounded">serving on port 5000</code> na dikhe, wait karo</li>
              <li>Browser me <code className="bg-black/20 px-1 rounded">http://127.0.0.1:5000</code> kholo (refresh karo)</li>
            </ol>
          )}
          {(error.toLowerCase().includes("ip_not_whitelisted") || error.toLowerCase().includes("ip not whitelisted")) && (
            <p className="text-xs text-muted-foreground ml-7">Balance aur fills dono same API key use karte hain. Delta Exchange → API Management me apna IP (IPv4 + IPv6 dono) whitelist karo, Save karo, phir yahan Refresh karo.</p>
          )}
          {!error.includes("Backend not running") && !error.toLowerCase().includes("ip_not_whitelisted") && !error.toLowerCase().includes("ip not whitelisted") && (
            <p className="text-xs text-muted-foreground ml-7">API keys se load hokar server ko bhej di jaati hain. Agar phir bhi error aaye to Delta Exchange → API Management → IP whitelist karo; API key me Read + Trading dono enable karo, phir Refresh karo.</p>
          )}
        </div>
      )}

      {/* Analysis summary – based on current page */}
      {fills.length > 0 && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
            <Card className="glass-card border-l-4 border-l-primary">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-wider">
                  <Activity className="w-4 h-4" />
                  Total Trades
                </div>
                <p className="text-xl font-mono font-bold text-white mt-1">{analysis.totalTrades}</p>
                <p className="text-xs text-muted-foreground mt-0.5">on this page</p>
              </CardContent>
            </Card>
            <Card className="glass-card border-l-4 border-l-green-500">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-wider">
                  <TrendingUp className="w-4 h-4 text-profit" />
                  Buy
                </div>
                <p className="text-xl font-mono font-bold text-profit mt-1">{analysis.buyCount}</p>
              </CardContent>
            </Card>
            <Card className="glass-card border-l-4 border-l-red-500">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-wider">
                  <TrendingDown className="w-4 h-4 text-loss" />
                  Sell
                </div>
                <p className="text-xl font-mono font-bold text-loss mt-1">{analysis.sellCount}</p>
              </CardContent>
            </Card>
            <Card className="glass-card border-l-4 border-l-amber-500">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-wider">
                  <DollarSign className="w-4 h-4" />
                  Total Fees
                </div>
                <p className="text-xl font-mono font-bold text-white mt-1">{analysis.totalFee.toFixed(4)}</p>
              </CardContent>
            </Card>
            <Card className="glass-card border-l-4 border-l-blue-500">
              <CardContent className="p-4">
                <div className="text-muted-foreground text-xs uppercase tracking-wider">Wins / Losses</div>
                <p className="text-lg font-mono font-bold mt-1">
                  <span className="text-profit">{analysis.wins}</span>
                  <span className="text-muted-foreground mx-1">/</span>
                  <span className="text-loss">{analysis.losses}</span>
                </p>
              </CardContent>
            </Card>
            <Card className="glass-card border-l-4 border-l-purple-500">
              <CardContent className="p-4">
                <div className="text-muted-foreground text-xs uppercase tracking-wider">Realized PnL</div>
                <p className={`text-xl font-mono font-bold mt-1 ${analysis.totalPnl >= 0 ? "text-profit" : "text-loss"}`}>
                  {analysis.totalPnl >= 0 ? "+" : ""}{analysis.totalPnl.toFixed(2)}
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Chart – trades per day */}
          {analysis.chartData.length > 0 && (
            <Card className="glass-card">
              <CardHeader className="border-b border-border pb-2">
                <CardTitle className="text-lg font-bold text-white">Trades &amp; fees by date</CardTitle>
                <p className="text-xs text-muted-foreground">Based on fills on this page</p>
              </CardHeader>
              <CardContent className="pt-4">
                <div className="h-[260px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={analysis.chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#222" vertical={false} />
                      <XAxis dataKey="date" stroke="#555" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                      <YAxis stroke="#555" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} />
                      <Tooltip
                        contentStyle={{ backgroundColor: "#111", borderColor: "#333", borderRadius: "6px", fontFamily: "monospace" }}
                        labelStyle={{ color: "#fff" }}
                        formatter={(value: number, name: string) => [name === "trades" ? value : value.toFixed(4), name === "trades" ? "Trades" : "Fee"]}
                        labelFormatter={(label) => `Date: ${label}`}
                      />
                      <Bar dataKey="trades" fill="#F97316" radius={[4, 4, 0, 0]} name="Trades" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}

      <Card className="glass-card">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <TableHead className="text-muted-foreground font-mono">Time</TableHead>
                <TableHead className="text-muted-foreground font-mono">Symbol</TableHead>
                <TableHead className="text-muted-foreground font-mono">Side</TableHead>
                <TableHead className="text-muted-foreground font-mono text-right">Price</TableHead>
                <TableHead className="text-muted-foreground font-mono text-right">Size</TableHead>
                <TableHead className="text-muted-foreground font-mono text-right">Fee</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && fills.length === 0 ? (
                <TableRow className="border-border">
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    Loading fills…
                  </TableCell>
                </TableRow>
              ) : fills.length === 0 ? (
                <TableRow className="border-border">
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    No fills yet. Connect API keys in Settings and place orders to see data.
                  </TableCell>
                </TableRow>
              ) : (
                fills.map((fill) => (
                  <TableRow key={fill.id} className="border-border hover:bg-white/5 transition-colors">
                    <TableCell className="font-mono text-sm text-muted-foreground">
                      {format(new Date(fill.created_at), "dd MMM yyyy, HH:mm:ss")}
                    </TableCell>
                    <TableCell className="font-bold">{displaySymbol(fill)}</TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={
                          (fill.side || "").toLowerCase() === "buy"
                            ? "border-profit text-profit"
                            : "border-loss text-loss"
                        }
                      >
                        {(fill.side || "").toUpperCase()}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-right">{fill.price}</TableCell>
                    <TableCell className="font-mono text-right">{fill.size}</TableCell>
                    <TableCell className="font-mono text-right text-muted-foreground">
                      {displayFee(fill)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
        {(nextCursor || prevCursor) && (
          <div className="flex items-center justify-between border-t border-border px-4 py-3">
            <Button
              variant="outline"
              size="sm"
              onClick={loadPrev}
              disabled={!prevCursor || loading}
              className="gap-1"
            >
              <ChevronLeft className="w-4 h-4" />
              Previous
            </Button>
            <span className="text-xs text-muted-foreground">
              {PAGE_SIZE} per page · Use Next/Previous for more
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={loadNext}
              disabled={!nextCursor || loading}
              className="gap-1"
            >
              Next
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
