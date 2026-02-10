import { useState, useEffect, useCallback } from "react";

export interface PortfolioBalance {
  coin: string;
  balance: string;
  available_balance?: string;
  [key: string]: unknown;
}

export interface PortfolioData {
  portfolioValue: string;
  currency: string;
  balances: PortfolioBalance[];
  /** Max position size (5% of balance) for bot – balance-based sizing */
  suggestedMaxPositionUsd?: string;
  /** Daily ROI % vs balance ~24h ago; null until we have 24h of history */
  dailyRoiPct?: number | null;
  /** Balance used for daily ROI (24h ago snapshot) */
  balance24hAgo?: string | null;
}

export function usePortfolio(refreshIntervalMs = 60_000) {
  const [data, setData] = useState<PortfolioData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchBalance = useCallback(async () => {
    try {
      setError(null);
      const res = await fetch("/api/delta/balance");
      const text = await res.text();
      let json: Record<string, unknown>;
      try {
        json = JSON.parse(text);
      } catch {
        setError("Backend not running. See steps below.");
        setData(null);
        setLoading(false);
        return;
      }
      // Process API response

      const errorMessage = (json?.errorMessage as string | undefined) ?? (json?.success === false && json?.error != null
        ? (json.error as { message?: string; code?: string }).message ?? (json.error as { message?: string; code?: string }).code
        : undefined);
      if (errorMessage) {
        setError(errorMessage);
        setData({ portfolioValue: "0.00", currency: "USD", balances: [] });
        setLoading(false);
        return;
      }
      if (!res.ok) {
        const err = json?.error as { message?: string; code?: string } | undefined;
        const msg = err?.message || (err?.code ? String(err.code) : "Failed to fetch balance");
        setError(msg);
        setData({ portfolioValue: "0.00", currency: "USD", balances: [] });
        setLoading(false);
        return;
      }
      if ((json as { success?: boolean }).success && (json as { portfolioValue?: string }).portfolioValue != null) {
        const j = json as { portfolioValue: string; currency?: string; balances?: PortfolioBalance[]; suggestedMaxPositionUsd?: string; dailyRoiPct?: number | null; balance24hAgo?: string | null };
        let pv = j.portfolioValue;
        let suggested = j.suggestedMaxPositionUsd;
        // Fallback: agar backend 0 bheje but balances mein USD non-zero hai to client pe compute karo
        const balances = j.balances || [];
        if (pv === "0.00" && balances.length > 0) {
          const usd = balances.find((b: Record<string, unknown>) => Number(b.asset_id) === 14 || String(b.asset_symbol || "").toUpperCase() === "USD");
          if (usd) {
            const bal = parseFloat(String(usd.balance ?? usd.available_balance ?? 0)) || 0;
            if (bal > 0) {
              pv = bal.toFixed(2);
              suggested = (bal * 0.05).toFixed(2);
            }
          }
        }
        setData({
          portfolioValue: pv,
          currency: j.currency || "USD",
          balances,
          suggestedMaxPositionUsd: suggested,
          dailyRoiPct: j.dailyRoiPct ?? null,
          balance24hAgo: j.balance24hAgo ?? null,
        });
      } else {
        setData(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBalance();
    if (refreshIntervalMs > 0) {
      const id = setInterval(fetchBalance, refreshIntervalMs);
      return () => clearInterval(id);
    }
  }, [fetchBalance, refreshIntervalMs]);

  return { data, loading, error, refresh: fetchBalance };
}
