import crypto from "crypto";
import "dotenv/config";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";

// Force load .env from project root (fresh on every import)
dotenv.config({ path: path.resolve(process.cwd(), ".env"), override: true });

// India: api.india.delta.exchange | Global: api.delta.exchange (set DELTA_BASE_URL in .env to switch)
const DELTA_BASE_URL = (process.env.DELTA_BASE_URL || "https://api.india.delta.exchange").replace(/\/$/, "");

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
function reloadKeysFromEnv() {
  const envApiKey = process.env.DELTA_API_KEY;
  const envSecretKey = process.env.DELTA_SECRET_KEY;

  if (envApiKey && envSecretKey) {
    const apiKey = envApiKey.trim();
    const secretKey = envSecretKey.trim();
    if (apiKey && secretKey) {
      storedKeys = { apiKey, secretKey };
      return true;
    }
  }
  return false;
}

export function setDeltaKeys(keys: DeltaKeys) {
  storedKeys = keys;
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
): Promise<{ success: boolean; result?: T; error?: { code?: string; message?: string } }> {
  const keys = storedKeys;
  if (!keys?.apiKey || !keys?.secretKey) {
    return { success: false, error: { code: "no_api_keys", message: "API keys not configured" } };
  }

  const queryParams = new URLSearchParams(query).toString();
  const queryString = queryParams ? "?" + queryParams : "";
  const bodyStr = body ? JSON.stringify(body) : "";
  const timestamp = Math.floor(Date.now() / 1000).toString();

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
    return {
      success: false,
      error: { code: "invalid_response", message: "Delta Exchange returned invalid response." },
    };
  }

  if (!res.ok) {
    const err = data?.error;
    const code = typeof err === "string" ? err : (err && typeof err === "object" && "code" in err) ? (err as { code: string }).code : "request_failed";
    const message = (err && typeof err === "object" && "message" in err && (err as { message: string }).message) ||
      (data as { message?: string })?.message ||
      (typeof err === "string" ? err : "") ||
      res.statusText;
    return { success: false, error: { code: String(code), message: String(message) } };
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

export async function getHistory(symbol: string, resolution: string, start: number, end: number) {
  // Official endpoint: GET /v2/history/candles
  const query = {
    symbol,
    resolution,
    start: String(start),
    end: String(end),
  };
  const queryParams = new URLSearchParams(query).toString();
  const url = `${DELTA_BASE_URL}/v2/history/candles?${queryParams}`;

  const res = await fetch(url, { headers: TICKER_FETCH_HEADERS });
  if (!res.ok) {
    throw new Error(`Delta History API failed: ${res.statusText}`);
  }
  const data = await res.json();
  // Delta V2 history API returns data in the 'result' field
  return (data.result || []) as Candle[];
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

export async function getPositions() {
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

export async function placeOrder(params: {
  symbol: string;
  side: "buy" | "sell";
  size: number;
  order_type: "market" | "limit";
  limit_price?: string;
}) {
  const body = {
    product_id: 0,
    symbol: params.symbol,
    side: params.side,
    order_type: params.order_type,
    size: params.size,
    limit_price: params.limit_price,
  };
  return deltaRequest<DeltaOrderResponse>("POST", "/v2/orders", {}, body);
}

export interface DeltaTicker {
  symbol: string;
  last_price: string;
  mark_price: string;
  index_price: string;
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
  if (last_price == null) return null;
  return {
    symbol: String(o.symbol ?? symbol),
    last_price: String(last_price),
    mark_price: mark_price != null ? String(mark_price) : "",
    index_price: index_price != null ? String(index_price) : "",
  };
}

const TICKER_FETCH_OPTIONS: RequestInit = {
  headers: { ...TICKER_FETCH_HEADERS, "Cache-Control": "no-cache", "Pragma": "no-cache" },
  cache: "no-store",
};

export async function getTicker(symbol: string): Promise<DeltaTicker | null> {
  const cacheBust = `_t=${Date.now()}`;
  // 1) Try single-symbol endpoint (path param)
  const singleUrl = `${DELTA_BASE_URL}/v2/tickers/${encodeURIComponent(symbol)}?${cacheBust}`;
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


