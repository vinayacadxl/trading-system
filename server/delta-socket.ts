/**
 * Delta Exchange WebSocket client – official docs implementation.
 * URL: wss://socket.india.delta.exchange
 * Subscribe: single message with type "subscribe", payload.channels[].name + symbols[].
 * v2/ticker: symbols required; response has mark_price (current), close, open, high, low.
 * candlestick_${resolution}: symbols required; response has candle_start_time (microseconds), open, high, low, close, volume.
 * Heartbeat: send {"type": "enable_heartbeat"} after connect; server sends heartbeat every 30s.
 */

import WebSocket from "ws";

const DELTA_WS_URL = process.env.DELTA_WS_URL || "wss://socket.india.delta.exchange";
const RECONNECT_DELAY_MS = 3000;
const RECONNECT_MAX_DELAY_MS = 60_000;
const LOG_SOURCE = "delta-socket";
const DEBUG_WS = process.env.DELTA_WS_DEBUG === "1" || process.env.DELTA_WS_DEBUG === "true";

const RESOLUTIONS = ["1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "12h", "1d", "1w"] as const;

// --- Types (strict) ---

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

export type LiveDataEmitter = (event: "live-candle" | "live-ticker", payload: LiveCandle | LiveTicker) => void;

interface DeltaSocketConfig {
  candleSymbol?: string;
  candleResolution?: string;
  tickerSymbol?: string;
  emit?: LiveDataEmitter;
  log?: (msg: string, source?: string) => void;
}

// In-memory store (single latest candle + ticker per symbol – memory-efficient)
const latestCandle: { value: LiveCandle | null; updatedAt: number } = { value: null, updatedAt: 0 };
const latestTicker: { value: LiveTicker | null; updatedAt: number } = { value: null, updatedAt: 0 };

let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectDelay = RECONNECT_DELAY_MS;
let subscribed = false;
let config: DeltaSocketConfig = {};
let logFn: (msg: string, source?: string) => void = () => {};

function log(msg: string): void {
  logFn(msg, LOG_SOURCE);
}

function clearReconnect(): void {
  if (reconnectTimer != null) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function scheduleReconnect(): void {
  clearReconnect();
  log(`Reconnecting in ${reconnectDelay}ms...`);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    reconnectDelay = Math.min(reconnectDelay * 1.5, RECONNECT_MAX_DELAY_MS);
    connect();
  }, reconnectDelay);
}

function subscribe(): void {
  if (!ws || ws.readyState !== WebSocket.OPEN || subscribed) return;

  const subscribePayload = {
    type: "subscribe",
    payload: {
      channels: [
        { name: "v2/ticker", symbols: ["BTCUSD"] },
        { name: "candlestick_15m", symbols: ["BTCUSD"] },
      ],
    },
  };
  try {
    ws.send(JSON.stringify(subscribePayload));
    subscribed = true;
    log("Subscribed: v2/ticker + candlestick_15m [BTCUSD].");
  } catch (e) {
    log(`Subscribe send error: ${e instanceof Error ? e.message : String(e)}`);
    return;
  }

  try {
    ws.send(JSON.stringify({ type: "enable_heartbeat" }));
    log("Heartbeat enabled.");
  } catch {
    /* ignore */
  }
}

function parseCandle(raw: unknown): LiveCandle | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  // Delta candlestick: candle_start_time in microseconds → chart uses seconds
  let time: number | undefined;
  if (o.candle_start_time != null) {
    const us = Number(o.candle_start_time);
    time = Number.isFinite(us) ? Math.floor(us / 1_000_000) : undefined;
  } else if (typeof o.time === "number" && Number.isFinite(o.time)) {
    time = o.time > 1e12 ? Math.floor(o.time / 1000) : o.time; // ms → s if needed
  } else if (typeof o.timestamp === "number" && Number.isFinite(o.timestamp)) {
    time = o.timestamp > 1e12 ? Math.floor(o.timestamp / 1000) : o.timestamp;
  }
  const open = o.open != null ? String(o.open) : o.o != null ? String(o.o) : undefined;
  const high = o.high != null ? String(o.high) : o.h != null ? String(o.h) : undefined;
  const low = o.low != null ? String(o.low) : o.l != null ? String(o.l) : undefined;
  const close = o.close != null ? String(o.close) : o.c != null ? String(o.c) : undefined;
  const volume = o.volume != null ? String(o.volume) : o.v != null ? String(o.v) : "0";
  if (time == null || open == null || high == null || low == null || close == null) return null;
  return { time, open, high, low, close, volume, symbol: o.symbol != null ? String(o.symbol) : undefined };
}

function parseTicker(raw: unknown): LiveTicker | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  // v2/ticker: mark_price is current market price; fallback to close, last_price, etc.
  const lastPrice = o.mark_price ?? o.last_price ?? o.lastPrice ?? o.last ?? o.close ?? o.c ?? o.price;
  if (lastPrice == null) return null;
  const symbol = o.symbol != null ? String(o.symbol) : "BTCUSD";
  return {
    symbol,
    lastPrice: String(lastPrice),
    markPrice: o.mark_price != null ? String(o.mark_price) : o.markPrice != null ? String(o.markPrice) : undefined,
    indexPrice: o.index_price != null ? String(o.index_price) : o.indexPrice != null ? String(o.indexPrice) : undefined,
  };
}

function handleMessage(data: WebSocket.RawData): void {
  let msg: Record<string, unknown>;
  try {
    msg = JSON.parse(typeof data === "string" ? data : data.toString("utf8"));
  } catch {
    return;
  }

  if (!msg || typeof msg !== "object") return;

  const type = (msg.type as string) || "";

  // ignore control messages
  if (type === "subscriptions" || type === "heartbeat" || type === "pong") return;

  // ===== CANDLE =====
  if (type.startsWith("candlestick_")) {
    const candle = parseCandle(msg);
    if (candle) {
      latestCandle.value = candle;
      latestCandle.updatedAt = Date.now();
      config.emit?.("live-candle", candle);
    }
    return;
  }

  // ===== TICKER =====
  if (type === "v2/ticker") {
    const ticker = parseTicker(msg);
    if (ticker) {
      latestTicker.value = ticker;
      latestTicker.updatedAt = Date.now();
      config.emit?.("live-ticker", ticker);
    }
    return;
  }
}

function connect(): void {
  if (ws != null) {
    try {
      ws.removeAllListeners();
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close();
    } catch {
      /* ignore */
    }
    ws = null;
  }
  subscribed = false;

  try {
    ws = new WebSocket(DELTA_WS_URL);
  } catch (e) {
    log(`Connect error: ${e instanceof Error ? e.message : String(e)}`);
    scheduleReconnect();
    return;
  }

  ws.on("open", () => {
    reconnectDelay = RECONNECT_DELAY_MS;
    log("Connected.");
    subscribe();
  });

  ws.on("message", (data: WebSocket.RawData) => {
    handleMessage(data);
  });

  ws.on("ping", () => {
    try {
      if (ws && ws.readyState === WebSocket.OPEN) ws.pong();
    } catch {
      /* ignore */
    }
  });

  ws.on("error", (err: Error) => {
    log(`WebSocket error: ${err.message}`);
  });

  ws.on("close", () => {
    log("Disconnected.");
    ws = null;
    subscribed = false;
    scheduleReconnect();
  });
}

export function startDeltaSocket(options: DeltaSocketConfig): void {
  config = {
    candleSymbol: options.candleSymbol ?? "BTCUSD",
    candleResolution: options.candleResolution ?? "15m",
    tickerSymbol: options.tickerSymbol ?? "BTCUSD",
    emit: options.emit,
    log: options.log,
  };
  logFn = config.log ?? (() => {});
  clearReconnect();
  connect();
}

export function stopDeltaSocket(): void {
  clearReconnect();
  if (ws != null) {
    try {
      ws.removeAllListeners();
      ws.close();
    } catch {
      /* ignore */
    }
    ws = null;
  }
  subscribed = false;
  log("Stopped.");
}

export function getLatestCandle(): LiveCandle | null {
  return latestCandle.value;
}

export function getLatestTicker(): LiveTicker | null {
  return latestTicker.value;
}

export function isDeltaSocketConnected(): boolean {
  return ws != null && ws.readyState === WebSocket.OPEN;
}
