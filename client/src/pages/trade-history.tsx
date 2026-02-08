import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { mockTrades } from "@/lib/mockData";
import { format } from "date-fns";
import { Download, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export default function TradeHistory() {
  return (
    <div className="space-y-6 max-w-[1600px] mx-auto animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col md:flex-row justify-between md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white tracking-tight">Trade History</h1>
          <p className="text-muted-foreground mt-1">Review past performance and execution details.</p>
        </div>
        <div className="flex gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input placeholder="Search Symbol..." className="pl-9 w-[200px] bg-card border-border" />
          </div>
          <Button variant="outline" size="icon">
            <Download className="w-4 h-4" />
          </Button>
        </div>
      </div>

      <Card className="glass-card">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <TableHead className="text-muted-foreground font-mono">ID</TableHead>
                <TableHead className="text-muted-foreground font-mono">Time</TableHead>
                <TableHead className="text-muted-foreground font-mono">Symbol</TableHead>
                <TableHead className="text-muted-foreground font-mono">Side</TableHead>
                <TableHead className="text-muted-foreground font-mono text-right">Entry</TableHead>
                <TableHead className="text-muted-foreground font-mono text-right">Exit</TableHead>
                <TableHead className="text-muted-foreground font-mono text-right">Size</TableHead>
                <TableHead className="text-muted-foreground font-mono text-right">PNL</TableHead>
                <TableHead className="text-muted-foreground font-mono text-center">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {mockTrades.map((trade) => (
                <TableRow key={trade.id} className="border-border hover:bg-white/5 transition-colors">
                  <TableCell className="font-mono text-xs text-muted-foreground">{trade.id}</TableCell>
                  <TableCell className="font-mono text-sm">{trade.timestamp}</TableCell>
                  <TableCell className="font-bold">{trade.symbol}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={`h-5 border-${trade.side === 'BUY' ? 'profit' : 'loss'} text-${trade.side === 'BUY' ? 'profit' : 'loss'}`}>
                      {trade.side}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono text-right">${trade.entryPrice.toFixed(2)}</TableCell>
                  <TableCell className="font-mono text-right">${trade.exitPrice.toFixed(2)}</TableCell>
                  <TableCell className="font-mono text-right">{trade.size.toFixed(3)}</TableCell>
                  <TableCell className={`font-mono font-bold text-right ${trade.pnl >= 0 ? 'text-profit' : 'text-loss'}`}>
                    {trade.pnl >= 0 ? '+' : ''}{trade.pnl.toFixed(2)}
                  </TableCell>
                  <TableCell className="text-center">
                    <Badge className={trade.status === 'WIN' ? 'bg-profit/20 text-profit hover:bg-profit/30' : 'bg-loss/20 text-loss hover:bg-loss/30'}>
                      {trade.status}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
