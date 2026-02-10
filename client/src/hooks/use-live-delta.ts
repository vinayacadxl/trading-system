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
export function useLiveDelta(): UseLiveDeltaResult {
  const [liveCandle, setLiveCandle] = useState<LiveCandle | null>(null);
  const [liveTicker, setLiveTicker] = useState<LiveTicker | null>(null);
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

    socket.onAny((event, ...args) => {
      console.log("[Live Delta] event:", event, args.length ? args : "");
    });

    let lastTickerLog = 0;
    socket.on("live-candle", (payload: LiveCandle) => {
      console.log("[Live Delta] live-candle", payload);
      if (payload && typeof payload.time === "number") setLiveCandle(payload);
    });
    socket.on("live-ticker", (payload: LiveTicker) => {
      const now = Date.now();
      if (now - lastTickerLog >= 2000) {
        lastTickerLog = now;
        console.log("[Live Delta] live-ticker", payload);
      }
      if (!payload) return;
      const lastPrice = payload.lastPrice != null ? String(payload.lastPrice) : "";
      if (lastPrice) setLiveTicker({ ...payload, lastPrice });
    });

    return () => {
      socket.off("connect");
      socket.off("disconnect");
      socket.offAny();
      socket.off("live-candle");
      socket.off("live-ticker");
      socket.disconnect();
    };
  }, []);

  return { liveCandle, liveTicker, connected };
}
