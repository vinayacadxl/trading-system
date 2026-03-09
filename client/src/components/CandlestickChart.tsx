import { useEffect, useRef, useState } from "react";
import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  ColorType,
  createSeriesMarkers,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
  type SeriesMarker,
} from "lightweight-charts";

export type CandleInput = {
  time: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume?: string;
};

type CandlestickChartProps = {
  candles: CandleInput[];
  height?: number;
  className?: string;
  emptyMessage?: string;
  /** Live price – updates last/current bar and price line in real time (no full setData) */
  currentPrice?: number | null;
  /** e.g. "15m", "1h" – used to show current-period bar so chart doesn't look stuck */
  resolution?: string;
  /** Trade signals to display as arrows on chart */
  markers?: SeriesMarker<UTCTimestamp>[];
};

const CHART_HEIGHT = 280;

function resolutionToSeconds(resolution: string): number {
  const n = parseInt(resolution, 10) || 15;
  if (resolution.endsWith("d")) return n * 86400;
  if (resolution.endsWith("h")) return n * 3600;
  if (resolution.endsWith("m")) return n * 60;
  return n * 60;
}

const CHART_OPTIONS = {
  layout: {
    background: { type: ColorType.Solid as const, color: "transparent" },
    textColor: "#a3a3a3",
    fontFamily: "var(--sans)",
    fontSize: 10,
  },
  grid: {
    vertLines: { visible: false },
    horzLines: { color: "rgba(255,255,255,0.03)" },
  },
  rightPriceScale: {
    borderColor: "rgba(255,255,255,0.05)",
    scaleMargins: { top: 0.1, bottom: 0.2 },
  },
  timeScale: {
    borderColor: "rgba(255,255,255,0.05)",
    timeVisible: true,
    secondsVisible: false,
  },
  crosshair: {
    vertLine: { labelBackgroundColor: "var(--brand)" },
    horzLine: { labelBackgroundColor: "var(--brand)" },
  },
};

export function CandlestickChart({
  candles,
  height = CHART_HEIGHT,
  className = "",
  emptyMessage = "Loading chart…",
  currentPrice,
  resolution,
  markers,
}: CandlestickChartProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const seriesMarkersRef = useRef<any>(null); // Using any for the plugin reference to avoid type complexity
  const priceLineRef = useRef<ReturnType<ISeriesApi<"Candlestick">["createPriceLine"]> | null>(null);
  const [containerSize, setContainerSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });

  const hasCandles = candles.length > 0;

  // Measure container
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const rect = el.getBoundingClientRect();
      setContainerSize({ w: Math.floor(rect.width), h: Math.floor(rect.height) });
    });
    ro.observe(el);
    const rect = el.getBoundingClientRect();
    setContainerSize({ w: Math.floor(rect.width), h: Math.floor(rect.height) });
    return () => ro.disconnect();
  }, []);

  // Create chart when we have size + data
  useEffect(() => {
    if (!hasCandles || containerSize.w <= 0 || containerSize.h <= 0 || !wrapperRef.current) return;

    const container = wrapperRef.current;
    const chart = createChart(container, {
      ...CHART_OPTIONS,
      width: containerSize.w,
      height: containerSize.h,
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#22c55e",
      downColor: "#ef4444",
      borderUpColor: "#22c55e",
      borderDownColor: "#ef4444",
      wickUpColor: "#22c55e",
      wickDownColor: "#ef4444",
    });

    const volumeSeries = chart.addSeries(HistogramSeries, {
      color: "#26a69a",
      priceFormat: { type: "volume" },
      priceScaleId: "",
    });
    volumeSeries.priceScale().applyOptions({
      scaleMargins: { top: 0.85, bottom: 0 },
      borderVisible: false,
    });

    // Initialize markers plugin
    const seriesMarkers = createSeriesMarkers(candleSeries, []);
    seriesMarkersRef.current = seriesMarkers;

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    volumeSeriesRef.current = volumeSeries;
    priceLineRef.current = null;

    // Reset tracking refs
    // lastCandleCountRef.current = 0; // REMOVED
    // lastFirstTimeRef.current = null; // REMOVED

    return () => {
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
      priceLineRef.current = null;
      seriesMarkersRef.current = null;
    };
  }, [hasCandles, containerSize.w, containerSize.h]);

  // Resize
  useEffect(() => {
    if (!chartRef.current || containerSize.w <= 0) return;
    chartRef.current.applyOptions({ width: containerSize.w, height: containerSize.h });
  }, [containerSize.w, containerSize.h]);

  // SIMPLIFIED RENDERING LOGIC: Always process full dataset
  useEffect(() => {
    if (!candleSeriesRef.current || !volumeSeriesRef.current) return;

    // Safety check for empty data
    if (!candles || candles.length === 0) {
      console.log("[Chart] No candles data to render");
      return;
    }

    console.log(`[Chart] Rendering ${candles.length} candles...`);

    const validData: { time: UTCTimestamp; open: number; high: number; low: number; close: number }[] = [];
    const volData: { time: UTCTimestamp; value: number; color: string }[] = [];

    candles.forEach((c, idx) => {
      if (!c) return;

      // Robust time parsing
      let time: UTCTimestamp | null = null;
      if (typeof c.time === 'number') {
        time = c.time as UTCTimestamp;
      } else if (typeof c.time === 'string') {
        const parsed = parseInt(c.time, 10);
        if (!isNaN(parsed)) time = parsed as UTCTimestamp;
      }

      // Robust price parsing
      const open = parseFloat(String(c.open));
      const high = parseFloat(String(c.high));
      const low = parseFloat(String(c.low));
      const close = parseFloat(String(c.close));

      // Validate
      if (time !== null && !isNaN(open) && !isNaN(high) && !isNaN(low) && !isNaN(close)) {
        validData.push({ time, open, high, low, close });

        // Volume
        const vol = parseFloat(String(c.volume || 0));
        if (!isNaN(vol)) {
          volData.push({
            time,
            value: vol,
            color: close >= open ? "rgba(34, 197, 94, 0.5)" : "rgba(239, 68, 68, 0.5)",
          });
        }
      } else {
        if (idx < 5) console.warn(`[Chart] Invalid candle at index ${idx}:`, c, { time, open, high, low, close });
      }
    });

    // Sort by time (crucial for Lightweight Charts)
    validData.sort((a, b) => (a.time as number) - (b.time as number));
    volData.sort((a, b) => (a.time as number) - (b.time as number));

    // Deduplicate (Lightweight Charts requires strictly ascending time)
    // We keep the LAST occurrence for each timestamp to ensure we have the most recent data
    const deduplicate = <T extends { time: UTCTimestamp }>(arr: T[]): T[] => {
      if (arr.length <= 1) return arr;
      const result: T[] = [];
      for (let i = 0; i < arr.length; i++) {
        if (i === arr.length - 1 || (arr[i].time as number) < (arr[i + 1].time as number)) {
          result.push(arr[i]);
        }
      }
      return result;
    };

    const finalData = deduplicate(validData);
    const finalVolData = deduplicate(volData);

    if (finalData.length > 0) {
      console.log(`[Chart] Setting data: ${validData.length} valid items (after dedupe: ${finalData.length}). Range: ${finalData[0].time} to ${finalData[finalData.length - 1].time}`);
      if (candleSeriesRef.current) {
        candleSeriesRef.current.setData(finalData);
      }
    } else {
      console.error("[Chart] No valid data found after parsing!");
    }

    if (finalVolData.length > 0) {
      if (volumeSeriesRef.current) {
        volumeSeriesRef.current.setData(finalVolData);
      }
    }

    // If we have data, ensure chart fits content
    if (validData.length > 0 && chartRef.current) {
      // Optional: chartRef.current.timeScale().fitContent(); 
      // Don't auto-fit every update as it disrupts user scrolling, but maybe on first load?
    }

  }, [candles]);

  // 2) Real-time: only update() last/current bar – no setData, so no lag. Chart owns current-period bar.
  useEffect(() => {
    const series = candleSeriesRef.current;
    if (!series) return;
    const validCandles = candles.filter(c => c != null && c.time != null);
    if (validCandles.length === 0) return;

    const last = validCandles[validCandles.length - 1]!;
    const lastTime = typeof last.time === "number" ? last.time : parseInt(String(last.time), 10);
    const lastClose = parseFloat(last.close);
    const lastOpen = parseFloat(last.open);
    const lastHigh = parseFloat(last.high);
    const lastLow = parseFloat(last.low);

    const price = currentPrice != null && Number.isFinite(currentPrice) ? currentPrice : lastClose;

    let bar: { time: UTCTimestamp; open: number; high: number; low: number; close: number };

    if (resolution) {
      const periodSec = resolutionToSeconds(resolution);
      const nowSec = Math.floor(Date.now() / 1000);
      const currentPeriodStart = Math.floor(nowSec / periodSec) * periodSec;

      if (lastTime < currentPeriodStart) {
        // Current period bar (append via update)
        bar = {
          time: currentPeriodStart as UTCTimestamp,
          open: lastClose,
          high: Math.max(lastClose, price),
          low: Math.min(lastClose, price),
          close: price,
        };
      } else {
        // Last bar is current period – update with live price
        bar = {
          time: lastTime as UTCTimestamp,
          open: lastOpen,
          high: Math.max(lastHigh, price),
          low: Math.min(lastLow, price),
          close: price,
        };
      }
    } else {
      bar = {
        time: lastTime as UTCTimestamp,
        open: lastOpen,
        high: Math.max(lastHigh, price),
        low: Math.min(lastLow, price),
        close: price,
      };
    }

    // Safety: and only update if time is valid and not backward
    if (bar.time && Number.isFinite(bar.time)) {
      try {
        if (candleSeriesRef.current) {
          candleSeriesRef.current.update(bar);
        }
      } catch (e) {
        // Ignore "Cannot update oldest data" errors to keep charts smooth
        if (!(e instanceof Error && e.message.includes("oldest data"))) {
          console.warn("[Chart] Update error:", e);
        }
      }
    }
  }, [candles, currentPrice, resolution]);

  // 3) Signal Markers (Orders) - Updates plugin
  useEffect(() => {
    const plugin = seriesMarkersRef.current;
    if (!plugin) return;

    // Safety check for plugin method
    if (typeof plugin.setMarkers === 'function') {
      if (markers && markers.length > 0) {
        plugin.setMarkers(markers);
      } else {
        plugin.setMarkers([]);
      }
    }
  }, [markers]);

  // ... (rest of code)


  // 4) Current price line
  useEffect(() => {
    const series = candleSeriesRef.current;
    if (!series) return;
    if (currentPrice == null || !Number.isFinite(currentPrice)) {
      if (priceLineRef.current) {
        series.removePriceLine(priceLineRef.current);
        priceLineRef.current = null;
      }
      return;
    }
    if (priceLineRef.current) {
      priceLineRef.current.applyOptions({ price: currentPrice });
      return;
    }
    priceLineRef.current = series.createPriceLine({
      price: currentPrice,
      color: "#ef4444",
      lineWidth: 2,
      lineStyle: 2,
      axisLabelVisible: true,
      title: "Current",
    });
    return () => {
      if (priceLineRef.current && series) {
        series.removePriceLine(priceLineRef.current);
        priceLineRef.current = null;
      }
    };
  }, [currentPrice]);

  const showEmpty = !hasCandles;

  return (
    <div
      ref={wrapperRef}
      className={className}
      style={{ width: "100%", minWidth: 0, height, minHeight: height }}
    >
      {showEmpty ? (
        <div className="flex items-center justify-center bg-black/20 rounded border border-border/50 text-muted-foreground text-sm w-full h-full">
          {emptyMessage}
        </div>
      ) : null}
    </div>
  );
}
