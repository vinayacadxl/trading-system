import { addMinutes, subDays, format } from "date-fns";

// Types
export interface Candle {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Position {
  id: string;
  symbol: string;
  side: "LONG" | "SHORT";
  entryPrice: number;
  markPrice: number;
  size: number;
  leverage: number;
  pnl: number;
  pnlPercent: number;
}

export interface Trade {
  id: string;
  symbol: string;
  side: "BUY" | "SELL";
  entryPrice: number;
  exitPrice: number;
  size: number;
  pnl: number;
  status: "WIN" | "LOSS";
  timestamp: string;
}

export interface BotState {
  status: "RUNNING" | "STOPPED" | "WAITING";
  strategy: string;
  symbol: string;
  timeframe: string;
}

// Generators
export const generateCandles = (count: number = 100, startPrice: number = 50000): Candle[] => {
  let candles: Candle[] = [];
  let currentPrice = startPrice;
  let currentTime = subDays(new Date(), 1);

  for (let i = 0; i < count; i++) {
    const volatility = currentPrice * 0.005; // 0.5% volatility
    const change = (Math.random() - 0.5) * volatility;
    
    const open = currentPrice;
    const close = currentPrice + change;
    const high = Math.max(open, close) + Math.random() * volatility * 0.5;
    const low = Math.min(open, close) - Math.random() * volatility * 0.5;
    const volume = Math.floor(Math.random() * 1000) + 100;

    candles.push({
      time: format(currentTime, "HH:mm"),
      open,
      high,
      low,
      close,
      volume,
    });

    currentPrice = close;
    currentTime = addMinutes(currentTime, 15);
  }
  return candles;
};

// Static Mock Data
export const mockPositions: Position[] = [
  {
    id: "pos-1",
    symbol: "BTCUSDT",
    side: "LONG",
    entryPrice: 42350.5,
    markPrice: 42560.2,
    size: 0.5,
    leverage: 10,
    pnl: 104.85,
    pnlPercent: 2.45,
  },
];

export const mockTrades: Trade[] = Array.from({ length: 20 }).map((_, i) => ({
  id: `trd-${1000 + i}`,
  symbol: Math.random() > 0.5 ? "BTCUSDT" : "ETHUSDT",
  side: Math.random() > 0.5 ? "BUY" : "SELL",
  entryPrice: 40000 + Math.random() * 5000,
  exitPrice: 40000 + Math.random() * 5000,
  size: Math.random() * 2,
  pnl: (Math.random() - 0.4) * 500, // Slightly biased to win
  status: Math.random() > 0.4 ? "WIN" : "LOSS",
  timestamp: format(subDays(new Date(), i), "yyyy-MM-dd HH:mm"),
}));

export const mockTicker = {
  symbol: "BTCUSDT",
  price: 42560.20,
  change24h: 2.45,
  high24h: 43100.00,
  low24h: 41800.00,
  volume24h: 12500.50,
};
