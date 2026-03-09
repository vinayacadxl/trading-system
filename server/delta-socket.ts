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
  resolution?: string; // Track which timeframe this is
}

export interface LiveTicker {
  symbol: string;
  lastPrice: string;
  markPrice?: string;
  indexPrice?: string;
  change24h?: number;   // percent change
  open24h?: string;     // 24h open price
  volume24h?: string;   // 24h volume
}

export interface OrderBookLevel {
  price: string;
  size: string;
}

export interface LiveOrderBook {
  symbol: string;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  updatedAt: number;
}

export interface LiveTrade {
  symbol: string;
  side: 'buy' | 'sell';
  price: string;
  size: string;
  time: number;
}

export type LiveDataEmitter = (event: "live-candle" | "live-ticker" | "live-orderbook" | "live-trade", payload: any) => void;

interface DeltaSocketConfig {
  candleSymbol?: string;
  candleResolution?: string;
  tickerSymbols?: string[]; // Changed from tickerSymbol to tickerSymbols
  emit?: LiveDataEmitter;
  log?: (msg: string, source?: string) => void;
}

// In-memory store (latest candle per resolution + ticker per symbol)
const latestCandles = new Map<string, LiveCandle>(); // symbol_resolution -> LiveCandle
const latestTicker: { value: LiveTicker | null; updatedAt: number } = { value: null, updatedAt: 0 };
const tickers = new Map<string, LiveTicker>(); // symbol -> LiveTicker
const orderbooks = new Map<string, LiveOrderBook>(); // symbol -> LiveOrderBook
const lastTrades = new Map<string, LiveTrade[]>(); // symbol -> LiveTrade[]

// WebSocket health tracking
let lastTickerUpdate = 0;
let lastCandleUpdate = 0;
const candleUpdateTimes = new Map<string, number>(); // symbol_resolution -> timestamp

let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectDelay = RECONNECT_DELAY_MS;
let subscribed = false;
let config: DeltaSocketConfig = {};
let logFn: (msg: string, source?: string) => void = () => { };

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

  const tickerSyms = config.tickerSymbols || ["BTCUSD"];
  const candleSym = config.candleSymbol || "BTCUSD";

  // Combine all symbols that need real-time data
  const allWatchedSymbols = Array.from(new Set([...tickerSyms, candleSym]));

  // Saare symbols ke liye saari resolutions subscribe – taaki koi bhi chart (LINKUSD, BTCUSD, etc.) ko live candle mile
  const channels: { name: string; symbols: string[] }[] = [
    { name: "v2/ticker", symbols: tickerSyms },
    { name: "l2_orderbook", symbols: allWatchedSymbols },
    { name: "trades", symbols: allWatchedSymbols },
    { name: "candlestick_1m", symbols: allWatchedSymbols },
  ];

  const subscribePayload = {
    type: "subscribe",
    payload: { channels },
  };

  log(`📡 Subscribing to ${subscribePayload.payload.channels.length} channels...`);
  log(`Tickers: ${tickerSyms.join(", ")}`);

  try {
    ws.send(JSON.stringify(subscribePayload));
    subscribed = true;
    log(`Subscribed: v2/ticker + candlesticks 1m/5m/15m/1h for ${allWatchedSymbols.length} symbols.`);
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

function parseCandle(raw: any, type?: string): LiveCandle | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw.payload || raw;

  // Extract resolution from type (e.g., "candlestick_1m" -> "1m")
  const resolution = type?.replace("candlestick_", "");

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
  return { time, open, high, low, close, volume, symbol: o.symbol != null ? String(o.symbol) : undefined, resolution };
}

function parseTicker(raw: any): LiveTicker | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw.payload || raw;
  // v2/ticker: mark_price is current market price; fallback to close, last_price, etc.
  const lastPrice = o.mark_price ?? o.last_price ?? o.lastPrice ?? o.last ?? o.close ?? o.c ?? o.price;
  if (lastPrice == null) return null;
  const symbol = o.symbol != null ? String(o.symbol) : undefined;
  if (!symbol) return null; // Must have symbol or it will overwrite BTCUSD with wrong prices

  // Extract 24h change: Delta sends open (24h open price), compute change ourselves
  const open24h = o.open != null ? String(o.open) : o.open_24h != null ? String(o.open_24h) : undefined;
  let change24h: number | undefined;
  if (open24h != null) {
    const openVal = parseFloat(open24h);
    const lastVal = parseFloat(String(lastPrice));
    if (openVal > 0) {
      change24h = ((lastVal - openVal) / openVal) * 100;
    }
  } else if (o.change_24h != null) {
    change24h = parseFloat(String(o.change_24h));
  } else if (o.change != null) {
    change24h = parseFloat(String(o.change));
  }

  return {
    symbol,
    lastPrice: String(lastPrice),
    markPrice: o.mark_price != null ? String(o.mark_price) : o.markPrice != null ? String(o.markPrice) : undefined,
    indexPrice: o.index_price != null ? String(o.index_price) : o.indexPrice != null ? String(o.indexPrice) : undefined,
    change24h,
    open24h,
    volume24h: o.volume != null ? String(o.volume) : o.volume_24h != null ? String(o.volume_24h) : undefined,
  };
}

function parseOrderBook(msg: any): LiveOrderBook | null {
  if (!msg || msg.type !== "l2_orderbook") return null;
  const p = msg.payload || msg;
  return {
    symbol: p.symbol || "BTCUSD",
    bids: (p.bids || []).map((b: any) => ({ price: String(b[0]), size: String(b[1]) })),
    asks: (p.asks || []).map((a: any) => ({ price: String(a[0]), size: String(a[1]) })),
    updatedAt: Date.now()
  };
}

function parseTrade(msg: any): LiveTrade | null {
  if (!msg || msg.type !== "trades") return null;
  const p = msg.payload || msg;
  return {
    symbol: p.symbol || "BTCUSD",
    side: String(p.side).toLowerCase() === "buy" ? "buy" : "sell",
    price: String(p.price),
    size: String(p.size),
    time: Date.now()
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

  // DEBUG: Log all incoming messages
  if (DEBUG_WS && type !== "subscriptions" && type !== "heartbeat") {
    log(`📩 WS: type="${type}" ${JSON.stringify(msg).substring(0, 150)}`);
  }

  // ignore control messages
  if (type === "subscriptions" || type === "heartbeat" || type === "pong") return;

  // ===== CANDLE =====
  if (type.startsWith("candlestick_")) {
    const candle = parseCandle(msg, type);
    if (candle) {
      const now = Date.now();
      const symbol = candle.symbol || config.candleSymbol || "BTCUSD";
      const key = `${symbol}_${candle.resolution}`;

      latestCandles.set(key, candle);
      candleUpdateTimes.set(key, now);

      lastCandleUpdate = now;
      config.emit?.("live-candle", candle);
    }
    return;
  }

  // ===== TICKER =====
  if (type === "v2/ticker") {
    const ticker = parseTicker(msg);
    if (ticker) {
      const now = Date.now();
      latestTicker.value = ticker;
      latestTicker.updatedAt = now;
      tickers.set(ticker.symbol, ticker); // Update symbol-specific map

      lastTickerUpdate = now;
      config.emit?.("live-ticker", ticker);
    }
    return;
  }

  // ===== ORDERBOOK =====
  if (type === "l2_orderbook") {
    const ob = parseOrderBook(msg);
    if (ob) {
      orderbooks.set(ob.symbol, ob);
      config.emit?.("live-orderbook", ob);
    }
    return;
  }

  // ===== TRADES =====
  if (type === "trades") {
    const trade = parseTrade(msg);
    if (trade) {
      const history = lastTrades.get(trade.symbol) || [];
      history.push(trade);
      if (history.length > 10) history.shift();
      lastTrades.set(trade.symbol, history);
      config.emit?.("live-trade", trade);
    }
    return;
  }
}

function connect(): void {
  log(`Attempting to connect to WS: ${DELTA_WS_URL}`);
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
    log(`WS Connected to ${DELTA_WS_URL}`);
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
    tickerSymbols: options.tickerSymbols ?? ["BTCUSD"],
    emit: options.emit,
    log: options.log,
  };
  logFn = config.log ?? (() => { });
  log(`Initializing Delta WebSocket for symbols: ${config.tickerSymbols?.join(", ")}`);
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

/**
 * Returns latest candle for a symbol and resolution.
 */
export function getLatestCandle(symbol: string, res: string): LiveCandle | null {
  const key = `${symbol}_${res}`;
  return latestCandles.get(key) ?? null;
}

export function getLatestTicker(): LiveTicker | null {
  return latestTicker.value;
}

export function getTickerForSymbol(symbol: string): LiveTicker | null {
  return tickers.get(symbol) ?? null;
}

export function getOrderBook(symbol: string): LiveOrderBook | null {
  return orderbooks.get(symbol) ?? null;
}

export function getLastTradesHistory(symbol: string): LiveTrade[] {
  return lastTrades.get(symbol) ?? [];
}

export function isDeltaSocketConnected(): boolean {
  return ws != null && ws.readyState === WebSocket.OPEN;
}

/**
 * Get WebSocket health status including data freshness
 */
export function getWebSocketHealth(): {
  connected: boolean;
  tickerAge: number;
  candleAge: number;
  isStale: boolean;
  candleAgeByResolution: Record<string, number>;
} {
  const now = Date.now();
  const connected = isDeltaSocketConnected();
  const tickerAge = lastTickerUpdate > 0 ? now - lastTickerUpdate : Infinity;
  const candleAge = lastCandleUpdate > 0 ? now - lastCandleUpdate : Infinity;
  const STALE_THRESHOLD_MS = 5000; // 5 seconds

  // Check age by resolution
  const candleAgeByResolution: Record<string, number> = {};
  for (const [resolution, updateTime] of Array.from(candleUpdateTimes.entries())) {
    candleAgeByResolution[resolution] = now - updateTime;
  }

  return {
    connected,
    tickerAge: Number.isFinite(tickerAge) ? tickerAge : -1,
    candleAge: Number.isFinite(candleAge) ? candleAge : -1,
    isStale: tickerAge > STALE_THRESHOLD_MS || candleAge > STALE_THRESHOLD_MS,
    candleAgeByResolution,
  };
}
