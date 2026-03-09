import { useEffect, useState } from "react";
import { io, type Socket } from "socket.io-client";

export interface LiveCandle {
  time: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  symbol?: string;
  resolution?: string;
}

export interface LiveTicker {
  symbol: string;
  lastPrice: string;
  markPrice?: string;
  indexPrice?: string;
}

type UseLiveDeltaResult = {
  liveCandle: LiveCandle | null;
  liveTicker: LiveTicker | null;
  connected: boolean;
};

const SOCKET_PATH = "/socket.io/";

/**
 * Connects to the app's Socket.IO server and listens for live-candle and live-ticker.
 * Console: hamesha connect/disconnect + saare events log (server se kya aa raha hai).
 */
export function useLiveDelta(): UseLiveDeltaResult & { tickers: Record<string, LiveTicker> } {
  const [liveCandle, setLiveCandle] = useState<LiveCandle | null>(null);
  const [liveTicker, setLiveTicker] = useState<LiveTicker | null>(null);
  const [tickers, setTickers] = useState<Record<string, LiveTicker>>({});
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    if (!origin) return;

    const socket: Socket = io(origin, {
      path: SOCKET_PATH,
      transports: ["websocket", "polling"],
      autoConnect: true,
    });

    socket.on("connect", () => {
      setConnected(true);
      console.log("[Live Delta] Socket connected");
    });
    socket.on("disconnect", () => {
      setConnected(false);
      console.log("[Live Delta] Socket disconnected");
    });

    socket.on("live-candle", (payload: LiveCandle) => {
      if (payload && typeof payload.time === "number") setLiveCandle(payload);
    });

    socket.on("live-ticker", (payload: LiveTicker) => {
      if (!payload || !payload.symbol) return;
      const lastPrice = payload.lastPrice != null ? String(payload.lastPrice) : "";
      if (!lastPrice) return;

      const updatedTicker = { ...payload, lastPrice };
      setLiveTicker(updatedTicker);
      setTickers(prev => ({ ...prev, [payload.symbol]: updatedTicker }));
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  return { liveCandle, liveTicker, tickers, connected };
}
