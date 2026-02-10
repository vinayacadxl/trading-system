import { useState, useEffect, useCallback } from "react";

export interface DeltaPosition {
  product_id: number;
  symbol: string;
  size: number;
  entry_price: string;
  mark_price: string;
  liquidation_price?: string;
  margin?: string;
  [key: string]: unknown;
}

export function usePositions(refreshIntervalMs = 60_000) {
  const [positions, setPositions] = useState<DeltaPosition[]>([]);
  const [unrealizedPnl, setUnrealizedPnl] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPositions = useCallback(async () => {
    try {
      setError(null);
      const res = await fetch("/api/delta/positions");
      const text = await res.text();
      let json: Record<string, unknown>;
      try {
        json = JSON.parse(text);
      } catch {
        setError("Failed to load positions");
        setPositions([]);
        setUnrealizedPnl(0);
        setLoading(false);
        return;
      }
      if (!res.ok) {
        setError((json?.error as { message?: string })?.message || "Failed to load positions");
        setPositions([]);
        setUnrealizedPnl(0);
        setLoading(false);
        return;
      }
      const errMsg = (json as { errorMessage?: string }).errorMessage;
      if (errMsg) setError(errMsg);
      const list = (json.positions as DeltaPosition[]) ?? [];
      setPositions(list);
      // Unrealized PnL: (mark_price - entry_price) * size (size sign: long +, short -)
      let pnl = 0;
      for (const p of list) {
        const entry = parseFloat(p.entry_price) || 0;
        const mark = parseFloat(p.mark_price) || 0;
        const size = Number(p.size) || 0;
        pnl += (mark - entry) * size;
      }
      setUnrealizedPnl(pnl);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
      setPositions([]);
      setUnrealizedPnl(0);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPositions();
    if (refreshIntervalMs > 0) {
      const id = setInterval(fetchPositions, refreshIntervalMs);
      return () => clearInterval(id);
    }
  }, [fetchPositions, refreshIntervalMs]);

  return { positions, unrealizedPnl, loading, error, refresh: fetchPositions };
}
