import crypto from "crypto";
import "dotenv/config";
import fs from "fs";
import { resolve as pathResolve } from "path";
import dotenv from "dotenv";

// Force load .env from project root (fresh on every import)
dotenv.config({ path: pathResolve(process.cwd(), ".env"), override: true });

// India: api.india.delta.exchange | Global: api.delta.exchange (set DELTA_BASE_URL in .env to switch)
const DELTA_BASE_URL = (process.env.DELTA_BASE_URL || "https://api.india.delta.exchange").replace(/\/$/, "");

let timeOffset = 0; // ms difference (Server - Local)

async function syncTime() {
  try {
    const start = Date.now();
    // Use Delta's dedicated time endpoint for precise server time (returns seconds, not coarse Date header)
    const res = await fetch(`${DELTA_BASE_URL}/v2/time`);
    const end = Date.now();
    if (res.ok) {
      const data = await res.json();
      // Delta /v2/time returns { result: { server_time: <unix_seconds> } } or { server_time: ... }
      const serverTimeSec: number =
        data?.result?.server_time ?? data?.server_time ?? data?.result ?? null;
      if (serverTimeSec) {
        const serverTimeMs = serverTimeSec * 1000;
        // Adjust for round-trip delay (approx end-start / 2)
        const rtt = (end - start) / 2;
        timeOffset = serverTimeMs - (start + rtt);
        console.log(`[Delta] Time synchronized. Offset: ${timeOffset.toFixed(1)}ms`);
        return;
      }
    }
    // Fallback: use HTTP Date header if /v2/time is unavailable
    const dateHeader = res.headers.get('date');
    if (dateHeader) {
      const serverTime = new Date(dateHeader).getTime();
      const rtt = (end - start) / 2;
      timeOffset = serverTime - (start + rtt);
      console.log(`[Delta] Time synchronized (fallback header). Offset: ${timeOffset.toFixed(1)}ms`);
    }
  } catch (e) {
    console.warn(`[Delta] Failed to sync time: ${e}`);
  }
}

// Initial sync
syncTime();
// Sync every 10 minutes
setInterval(syncTime, 600_000);

// Delta: message = method + timestamp + path + queryString + body (queryString = "?" + params when GET with params)
function signRequest(apiSecret: string, timestamp: string, method: string, path: string, queryString: string, body: string): string {
  const message = method + timestamp + path + queryString + body;
  return crypto.createHmac("sha256", apiSecret).update(message).digest("hex");
}

export interface DeltaKeys {
  apiKey: string;
  secretKey: string;
}

let storedKeys: DeltaKeys | null = null;

// Function to reload API keys from environment
export function reloadKeysFromEnv() {
  // Re-read .env file to pick up changes
  dotenv.config({ path: pathResolve(process.cwd(), ".env"), override: true });

  const envApiKey = process.env.DELTA_API_KEY;
  const envSecretKey = process.env.DELTA_SECRET_KEY;

  if (envApiKey && envSecretKey) {
    const apiKey = envApiKey.trim();
    const secretKey = envSecretKey.trim();
    if (apiKey && secretKey) {
      storedKeys = { apiKey, secretKey };
      console.log(`[Delta] API Keys loaded from .env (Key starting with: ${apiKey.slice(0, 4)}...)`);
      return true;
    }
  }
  console.log("[Delta] No API Keys found in .env");
  return false;
}

export function setDeltaKeys(keys: DeltaKeys) {
  storedKeys = keys;
  console.log(`[Delta] API Keys updated in memory (Key starting with: ${keys.apiKey.slice(0, 4)}...)`);
}

export function getDeltaKeys(): DeltaKeys | null {
  return storedKeys;
}

// Call on module load
reloadKeysFromEnv();

// .env se data fetch ho raha hai ya nahi – ek baar startup pe log
(function logEnvCheck() {
  // Silent check
})();

export async function deltaRequest<T>(
  method: "GET" | "POST",
  path: string,
  query: Record<string, string> = {},
  body?: object
): Promise<{ success: boolean; result?: T; error?: { code?: string; message?: string }; _rawErrorData?: any }> {
  const keys = storedKeys;
  if (!keys?.apiKey || !keys?.secretKey) {
    return { success: false, error: { code: "no_api_keys", message: "API keys not configured" } };
  }

  const queryParams = new URLSearchParams(query).toString();
  const queryString = queryParams ? "?" + queryParams : "";
  const bodyStr = body ? JSON.stringify(body) : "";

  // Use synced time for signature
  const timestamp = Math.floor((Date.now() + timeOffset) / 1000).toString();

  const signature = signRequest(keys.secretKey, timestamp, method, path, queryString, bodyStr);

  const url = `${DELTA_BASE_URL}${path}${queryString}`;
  const headers: Record<string, string> = {
    "api-key": keys.apiKey,
    signature,
    timestamp,
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
    "Content-Type": "application/json",
  };

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: bodyStr || undefined,
    });
  } catch (e) {
    return {
      success: false,
      error: { code: "network_error", message: e instanceof Error ? e.message : "unknown" },
    };
  }

  const text = await res.text();
  let data: { success?: boolean; result?: T; error?: string | { code?: string; message?: string } };
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    console.error(`[delta] Invalid JSON response from ${url}. Raw Response: ${text.slice(0, 500)}`);
    return {
      success: false,
      error: { code: "invalid_response", message: "Delta Exchange returned invalid response." },
    };
  }

  // Enhanced error logging
  if (!res.ok) {
    const err = data?.error as any;
    const code = typeof err === "string" ? err : (err && typeof err === "object" && "code" in err) ? String(err.code) : "request_failed";

    // Auto-sync time and retry ONCE if signature expired
    if (code === "expired_signature") {
      console.warn("[Delta] Signature expired. Syncing time and retrying...");
      await syncTime();
      // Retry the request once with the corrected timestamp
      const retryTimestamp = Math.floor((Date.now() + timeOffset) / 1000).toString();
      const retrySignature = signRequest(keys.secretKey, retryTimestamp, method, path, queryString, bodyStr);
      try {
        const retryRes = await fetch(url, {
          method,
          headers: { ...headers, signature: retrySignature, timestamp: retryTimestamp },
          body: bodyStr || undefined,
        });
        const retryText = await retryRes.text();
        let retryData: any;
        try { retryData = retryText ? JSON.parse(retryText) : {}; } catch { retryData = {}; }
        if (retryRes.ok) {
          console.log(`[Delta] Retry succeeded after time sync.`);
          return retryData as { success: boolean; result?: T; error?: { code?: string; message?: string } };
        }
        console.error(`[Delta] Retry also failed: ${JSON.stringify(retryData)}`);
      } catch (retryErr) {
        console.error(`[Delta] Retry network error: ${retryErr}`);
      }
    }
    const message = (err && typeof err === "object" && "message" in err && (err as { message: string }).message) ||
      (data as { message?: string })?.message ||
      (typeof err === "string" ? err : "") ||
      res.statusText;

    const errorDetail = `[delta-debug] API Failure | Status: ${res.status} | URL: ${url} | Payload: ${bodyStr} | Error Body: ${JSON.stringify(data, null, 2)}`;
    console.error(errorDetail);

    // Emergency file logging for visibility
    try {
      fs.appendFileSync(pathResolve(process.cwd(), "delta_debug.log"), `${new Date().toISOString()} ${errorDetail}\n`);
    } catch (e) { }

    return { success: false, error: { code: String(code), message: String(message) + ` (Details: ${JSON.stringify(data)})` }, _rawErrorData: data };
  }

  return data as { success: boolean; result?: T; error?: { code?: string; message?: string } };
}

export interface Candle {
  time: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
}

// Module-level flag for debugging
let hasLoggedDeltaStructure = false;

export async function getHistory(symbol: string, resolution: string, start: number, end: number): Promise<Candle[]> {
  // Auto-map BTCUSDT to BTCUSD for Delta India compatibility
  let effectiveSymbol = symbol;
  if (symbol.toUpperCase() === "BTCUSDT" && DELTA_BASE_URL.includes("india")) {
    effectiveSymbol = "BTCUSD";
  }

  const query = {
    symbol: effectiveSymbol,
    resolution,
    start: String(start),
    end: String(end),
  };
  const queryParams = new URLSearchParams(query).toString();
  const url = `${DELTA_BASE_URL}/v2/history/candles?${queryParams}`;

  // Ensure headers are defined
  const TICKER_FETCH_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
    "Accept": "application/json"
  };

  console.log(`[Delta] Fetching history: ${url}`);
  const res = await fetch(url, { headers: TICKER_FETCH_HEADERS });
  if (!res.ok) {
    console.error(`[Delta Error] Status: ${res.status} URL: ${url}`);
    return [];
  }
  const data = await res.json();
  const rawList = (data.result || []) as any[];
  console.log(`[Delta] Received ${rawList.length} candles for ${symbol}`);

  // Map Delta V2 fields to our Candle interface (time in seconds)
  // DEBUG: log first raw candle to understand structure if needed
  if (rawList.length > 0 && !hasLoggedDeltaStructure) {
    console.log("[Delta API] Sample raw history candle:", rawList[0]);
    hasLoggedDeltaStructure = true;
  }

  const mapped = rawList.map(c => {
    // Delta sometimes returns 'time' (seconds) or 'start_time' (microseconds) or 'timestamp'
    let t = c.time;
    if (t === undefined) t = c.timestamp;
    if (t === undefined && c.start_time) t = Number(c.start_time) / 1_000_000;

    return {
      time: Math.floor(Number(t)),
      open: String(c.open || "0"),
      high: String(c.high || "0"),
      low: String(c.low || "0"),
      close: String(c.close || "0"),
      volume: String(c.volume || "0")
    };
  });
  // Ensure ascending (oldest first) so 24h change = last 96 bars is correct everywhere
  mapped.sort((a, b) => a.time - b.time);
  return mapped;
}



export interface DeltaWalletBalance {
  available_balance: string;
  balance: string;
  coin: string;
  conversion_rate?: string;
  [key: string]: unknown;
}

export async function getWalletBalancesRaw(): Promise<{
  success: boolean;
  result?: unknown;
  error?: { code?: string; message?: string };
  _usedPath?: string;
  _rawErrorData?: any;
}> {
  const balances = await deltaRequest<unknown>("GET", "/v2/wallet/balances");
  return { ...balances, _usedPath: "/v2/wallet/balances" };
}

export function getDeltaBaseUrl() {
  return DELTA_BASE_URL;
}

export async function getWalletBalances(): Promise<{
  success: boolean;
  result?: DeltaWalletBalance[] | Record<string, unknown>;
  error?: { code?: string; message?: string };
}> {
  const out = await getWalletBalancesRaw();
  const { _usedPath, ...rest } = out;
  return rest as { success: boolean; result?: DeltaWalletBalance[] | Record<string, unknown>; error?: { code?: string; message?: string } };
}

/** Returns USD-equivalent portfolio value for bot position sizing. Returns 0 on error or no keys. */
export async function getPortfolioValueUsd(): Promise<number> {
  const out = await getWalletBalancesRaw();
  if (!out.success || !out.result) return 0;
  const raw = out.result;
  const list: Array<Record<string, unknown>> = Array.isArray(raw)
    ? raw
    : (raw && typeof raw === "object" && Array.isArray((raw as { balance?: unknown }).balance))
      ? ((raw as { balance: unknown[] }).balance as Array<Record<string, unknown>>)
      : (raw && typeof raw === "object" && Array.isArray((raw as { balances?: unknown }).balances))
        ? ((raw as { balances: unknown[] }).balances as Array<Record<string, unknown>>)
        : [];
  const getCoin = (b: Record<string, unknown>) =>
    String(b.asset_symbol ?? b.coin ?? (b.asset && typeof b.asset === "object" && (b.asset as { symbol?: string }).symbol) ?? "").toUpperCase();
  const getBal = (b: Record<string, unknown>) => parseFloat(String(b.balance ?? b.available_balance ?? b.availableBalance ?? 0)) || 0;
  const usd = list.find((b) => getCoin(b) === "USD" || Number(b.asset_id) === 14);
  if (usd) return getBal(usd);
  const usdt = list.find((b) => getCoin(b) === "USDT");
  if (usdt) return getBal(usdt);
  if (list.length > 0) return getBal(list[0]!);
  return 0;
}

/** Returns available USD-equivalent balance for NEW trades (excludes used margin). */
export async function getAvailableBalanceUsd(): Promise<number> {
  const out = await getWalletBalancesRaw();
  if (!out.success || !out.result) return 0;
  const raw = out.result;
  const list: Array<Record<string, unknown>> = Array.isArray(raw)
    ? raw
    : (raw && typeof raw === "object" && Array.isArray((raw as { balance?: unknown }).balance))
      ? ((raw as { balance: unknown[] }).balance as Array<Record<string, unknown>>)
      : (raw && typeof raw === "object" && Array.isArray((raw as { balances?: unknown }).balances))
        ? ((raw as { balances: unknown[] }).balances as Array<Record<string, unknown>>)
        : [];

  const getCoin = (b: Record<string, unknown>) =>
    String(b.asset_symbol ?? b.coin ?? (b.asset && typeof b.asset === "object" && (b.asset as { symbol?: string }).symbol) ?? "").toUpperCase();

  // Prioritize available_balance
  const getBal = (b: Record<string, unknown>) => parseFloat(String(b.available_balance ?? b.availableBalance ?? b.balance ?? 0)) || 0;

  const usd = list.find((b) => getCoin(b) === "USD" || Number(b.asset_id) === 14);
  if (usd) return getBal(usd);
  const usdt = list.find((b) => getCoin(b) === "USDT");
  if (usdt) return getBal(usdt);

  return 0;
}

export interface DeltaFill {
  id: number;
  order_id: number;
  product_id: number;
  symbol: string;
  side: string;
  size: number;
  price: string;
  fee: string;
  fee_currency: string;
  created_at: string;
  [key: string]: unknown;
}

export async function getFills(query: { limit?: number; after?: string; before?: string } = {}) {
  const params: Record<string, string> = {};
  if (query.limit) params.page_size = String(query.limit);
  if (query.after) params.after = query.after;
  if (query.before) params.before = query.before;
  return deltaRequest<DeltaFill[]>("GET", "/v2/fills", params);
}

export interface DeltaHistoryOrder {
  id: number;
  product_id: number;
  symbol: string;
  side: string;
  order_type: string;
  limit_price: string;
  avg_fill_price: string;
  size: number;
  filled_size: number;
  state: string;
  realized_pnl: string;
  created_at: string;
  updated_at: string;
  commission: string;
}

export async function getClosedOrders(query: { limit?: number; after?: string; before?: string } = {}) {
  const params: Record<string, string> = {};
  if (query.limit) params.page_size = String(query.limit);
  if (query.after) params.after = query.after;
  if (query.before) params.before = query.before;
  // Use /v2/orders/history to get closed/filled orders with PNL
  return deltaRequest<DeltaHistoryOrder[]>("GET", "/v2/orders/history", params);
}

export interface DeltaPosition {
  product_id: number;
  symbol: string;
  size: number;
  entry_price: string;
  mark_price: string;
  liquidation_price: string;
  margin: string;
  [key: string]: unknown;
}

export async function getPositions(): Promise<{ success: boolean; result?: DeltaPosition[]; error?: { code?: string; message?: string } }> {
  return deltaRequest<DeltaPosition[]>("GET", "/v2/positions/margined");
}

export interface DeltaProduct {
  id: number;
  symbol: string;
  description: string;
  underlying_asset: {
    symbol: string;
  };
  quoting_asset: {
    symbol: string;
  };
  product_type: string;
  contract_type: string;
}

export async function getProducts(): Promise<DeltaProduct[]> {
  const url = `${DELTA_BASE_URL}/v2/products`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Delta Products API failed: ${res.statusText}`);
  }
  const data = await res.json();
  return (data.result || []) as DeltaProduct[];
}

export interface DeltaOrderResponse {
  id: number;
  product_id: number;
  symbol: string;
  side: string;
  order_type: string;
  limit_price?: string;
  size: number;
  state: string;
}

const productCache: Record<string, any> = {};

/** Finds product ID for a symbol (caching result). */
export async function getProductBySymbol(symbol: string): Promise<any | null> {
  if (productCache[symbol]) return productCache[symbol];
  try {
    const products = await getProducts();
    let p = products.find((x) => x.symbol === symbol);

    if (!p) {
      const upper = symbol.toUpperCase();
      p = products.find(x => x.symbol.toUpperCase() === upper);
      if (!p && upper === "BTCUSD") {
        p = products.find(x => x.symbol === "BTCUSDT");
      }
    }

    if (p) {
      productCache[symbol] = p;
      return p;
    }
  } catch (e) {
    console.error("getProductBySymbol error:", e);
  }
  return null;
}

/** Sets leverage for a specific product. */
export async function setLeverage(productId: number, leverage: number) {
  if (!productId || productId <= 0) {
    return { success: false, error: { code: "invalid_product_id", message: "Invalid product ID for leverage" } };
  }
  return deltaRequest<{ leverage: string }>(
    "POST",
    `/v2/products/${productId}/orders/leverage`,
    {},
    { leverage: String(leverage) }
  );
}

export async function placeOrder(params: {
  symbol: string;
  side: "buy" | "sell";
  size: number;
  order_type: "market" | "limit";
  limit_price?: string;
  product_id?: number;
  post_only?: boolean;
  bracket_take_profit_price?: string;
  bracket_stop_loss_price?: string;
}) {
  // ✅ Use provided product_id first (avoids extra IP-blocked API call)
  let pid: number | undefined = params.product_id;
  let contractValue = 0.001; // default for BTC

  if (!pid) {
    // Only fetch product if not already provided
    const product = await getProductBySymbol(params.symbol);
    if (!product) {
      return { success: false, error: { code: "product_not_found", message: `Product not found for symbol ${params.symbol}` } };
    }
    pid = product.id;
    contractValue = parseFloat(String((product as any).contract_value || 0.001));
  } else {
    // Estimate contract value from symbol when product_id is known
    // BTC contracts on Delta India = 0.001 BTC each
    // ETH contracts = 0.01 ETH each, others vary
    if (params.symbol.startsWith("BTC")) contractValue = 0.001;
    else if (params.symbol.startsWith("ETH")) contractValue = 0.01;
    else if (params.symbol.startsWith("SOL")) contractValue = 0.1;
    else if (params.symbol.startsWith("XRP")) contractValue = 10;
    else if (params.symbol.startsWith("BCH")) contractValue = 0.01;
    else if (params.symbol.startsWith("LTC")) contractValue = 0.1;
    else contractValue = 0.001;
  }

  let finalSize = params.size;

  // IMPORTANT: On Delta India, size in /v2/orders is NUMBER OF CONTRACTS.
  // params.size is usually BTC amount (e.g. 0.01 BTC).
  // 1 contract = contractValue BTC.
  // So: contracts = requested_btc / contractValue.

  if (params.size < 2) {
    // Input looks like BTC/Asset amount (e.g. 0.01 BTC)
    finalSize = params.size / contractValue;
    console.log(`[delta] Converting ${params.size} ${params.symbol} to ${finalSize.toFixed(4)} contracts (1 contract = ${contractValue})`);
  } else if (contractValue < 1 && params.size > 10) {
    // Input looks like USD value (e.g. 700 USD)
    try {
      const ticker = await getTicker(params.symbol);
      const price = parseFloat(ticker?.mark_price || ticker?.last_price || "0");
      if (price > 0) {
        const btcSize = params.size / price;
        finalSize = btcSize / contractValue;
        console.log(`[delta] Normalized ${params.size} USD to ${finalSize.toFixed(4)} contracts @ $${price}`);
      }
    } catch (e) { }
  }

  // Final rounding to nearest integer (Delta India contracts must be integers), minimum 1
  finalSize = Math.round(finalSize);

  // Extra safety: handle NaN or Infinity
  if (isNaN(finalSize) || !isFinite(finalSize)) {
    console.error(`[delta] CRITICAL: Calculated size is ${finalSize}. Defaulting to 1.`);
    finalSize = 1;
  }

  finalSize = Math.max(1, finalSize);

  // Ensure it is a pure integer
  finalSize = Math.floor(finalSize);


  // EXTRA SAFETY for small accounts: If value > $35 (50% of balance) and leverage is low,
  // we might still hit margin limits if we don't have enough leverage.
  console.log(`[delta-debug] Final Size for Delta India: ${finalSize} contracts`);

  // Safety: valid product_id check
  if (!pid || isNaN(Number(pid)) || Number(pid) <= 0) {
    return { success: false, error: { code: "invalid_product_id", message: "Invalid Product ID" } };
  }

  const body: any = {
    product_id: Number(pid),
    size: Number(finalSize),   // Must be plain integer - Delta India v2 API
    side: params.side,
    order_type: params.order_type === "market" ? "market_order" : "limit_order",
    time_in_force: params.order_type === "market" ? "ioc" : "gtc",
    post_only: false,
  };

  // FIXED: Delta API bracket order syntax (v2 API)
  if (params.bracket_take_profit_price || params.bracket_stop_loss_price) {
    if (params.bracket_stop_loss_price) {
      body.bracket_stop_loss_limit_price = String(params.bracket_stop_loss_price);
    }
    if (params.bracket_take_profit_price) {
      body.bracket_take_profit_limit_price = String(params.bracket_take_profit_price);
    }
  }

  if (params.order_type === "limit" && params.limit_price) {
    body.limit_price = params.limit_price;
    if (params.post_only) {
      body.post_only = true;
    }
  }

  // Debug: log exact payload
  console.log(`[delta] Placing Order: ${params.side.toUpperCase()} ${finalSize} ${params.symbol} (${pid})`);
  console.log("[delta] Order Payload:", JSON.stringify(body));

  const result = await deltaRequest<DeltaOrderResponse>("POST", "/v2/orders", {}, body);

  // Enhanced error logging
  if (!result.success && result.error) {
    console.error("[DELTA ORDER FAILED]", {
      error: result.error,
      payload: body,
      symbol: params.symbol,
      size: finalSize,
      productId: pid,
    });
  }

  return result;
}

export interface DeltaTicker {
  symbol: string;
  last_price: string;
  mark_price: string;
  index_price: string;
  change_24h?: string;
  volume?: string;
}

const TICKER_FETCH_HEADERS: HeadersInit = {
  "Accept": "application/json",
  "User-Agent": "CryptoBotTrade/1.0 (Node)",
};

function parseTickerRaw(raw: unknown, symbol: string): DeltaTicker | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const last_price = o.last_price ?? o.lastPrice ?? o.mark_price ?? o.markPrice ?? o.close ?? o.c ?? o.price;
  const mark_price = o.mark_price ?? o.markPrice;
  const index_price = o.index_price ?? o.indexPrice;
  const change_24h = o.change_24h ?? o.price_change_24h ?? o.change24h;
  const volume = o.volume ?? o.v;

  if (last_price == null) return null;
  return {
    symbol: String(o.symbol ?? symbol),
    last_price: String(last_price),
    mark_price: mark_price != null ? String(mark_price) : "",
    index_price: index_price != null ? String(index_price) : "",
    change_24h: change_24h != null ? String(change_24h) : "0",
    volume: volume != null ? String(volume) : "0",
  };
}

const TICKER_FETCH_OPTIONS: RequestInit = {
  headers: { ...TICKER_FETCH_HEADERS, "Cache-Control": "no-cache", "Pragma": "no-cache" },
  cache: "no-store",
};

export async function getTicker(symbol: string): Promise<DeltaTicker | null> {
  let effectiveSymbol = symbol;
  if (symbol.toUpperCase() === "BTCUSDT" && DELTA_BASE_URL.includes("india")) {
    effectiveSymbol = "BTCUSD";
  }

  const cacheBust = `_t=${Date.now()}`;
  // 1) Try single-symbol endpoint (path param)
  const singleUrl = `${DELTA_BASE_URL}/v2/tickers/${encodeURIComponent(effectiveSymbol)}?${cacheBust}`;
  const singleRes = await fetch(singleUrl, TICKER_FETCH_OPTIONS);
  if (singleRes.ok) {
    const data = await singleRes.json();
    const raw = data.result != null ? data.result : data;
    const ticker = parseTickerRaw(raw, symbol);
    if (ticker) return ticker;
  }

  // 2) Fallback: fetch all tickers and find by symbol
  const allUrl = `${DELTA_BASE_URL}/v2/tickers`;
  const allRes = await fetch(allUrl, { headers: TICKER_FETCH_HEADERS });
  if (!allRes.ok) return null;
  const allData = await allRes.json();
  const list = allData.result != null ? allData.result : allData;
  if (Array.isArray(list)) {
    const symUpper = symbol.toUpperCase();
    const found = list.find(
      (t: unknown) =>
        t && typeof t === "object" && String((t as Record<string, unknown>).symbol ?? "").toUpperCase() === symUpper
    );
    if (found) return parseTickerRaw(found, symbol);
  }
  if (list && typeof list === "object" && !Array.isArray(list)) {
    const bySymbol = list[symbol] ?? list[symbol.toUpperCase()] ?? list[symbol.toLowerCase()];
    if (bySymbol) return parseTickerRaw(bySymbol, symbol);
  }
  return null;
}

export async function getTickers(): Promise<DeltaTicker[]> {
  const url = `${DELTA_BASE_URL}/v2/tickers`;
  try {
    const res = await fetch(url, { headers: TICKER_FETCH_HEADERS });
    if (!res.ok) {
      console.error(`[Delta] Tickers API failed: ${res.status}`);
      return [];
    }
    const data = await res.json();
    const list = data.result || data;
    if (!Array.isArray(list)) return [];
    return list.map((t: any) => parseTickerRaw(t, t.symbol)).filter(Boolean) as DeltaTicker[];
  } catch (e) {
    console.error(`[Delta] Tickers Network Error: ${e}`);
    return [];
  }
}

export async function getOrderBook(symbol: string) {
  const url = `${DELTA_BASE_URL}/v2/l2orderbook/${symbol}`;
  try {
    const res = await fetch(url, { headers: TICKER_FETCH_HEADERS });
    if (!res.ok) {
      console.error(`[Delta] Orderbook API failed: ${res.status} for ${symbol}`);
      return null;
    }
    const data = await res.json();
    const raw = data.result || data;

    // Normalize bids/asks to buy/sell and ensure elements are arrays [price, size]
    const normalize = (list: any[]) => (list || []).map(item => {
      if (Array.isArray(item)) return item;
      if (item && typeof item === 'object') return [item.price || item.p, item.size || item.s || item.limit_price || item.qty];
      return [0, 0];
    });

    return {
      buy: normalize(raw.bids || raw.buy),
      sell: normalize(raw.asks || raw.sell)
    };
  } catch (e) {
    console.error(`[Delta] Orderbook Network Error: ${e}`);
    return null;
  }
}

export async function getTrades(symbol: string, limit = 20) {
  const url = `${DELTA_BASE_URL}/v2/trades/${symbol}?page_size=${limit}`;
  try {
    const res = await fetch(url, { headers: TICKER_FETCH_HEADERS });
    if (!res.ok) {
      console.error(`[Delta] Trades API failed: ${res.status} for ${symbol}`);
      return [];
    }
    const data = await res.json();
    return data.result || data;
  } catch (e) {
    console.error(`[Delta] Trades Network Error: ${e}`);
    return [];
  }
}
