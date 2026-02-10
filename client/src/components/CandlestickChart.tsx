import { useEffect, useRef, useState } from "react";
import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  ColorType,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
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
    textColor: "#888",
    fontFamily: "system-ui, sans-serif",
    fontSize: 11,
  },
  grid: {
    vertLines: { color: "rgba(255,255,255,0.06)" },
    horzLines: { color: "rgba(255,255,255,0.06)" },
  },
  rightPriceScale: {
    borderColor: "#333",
    scaleMargins: { top: 0.1, bottom: 0.2 },
  },
  timeScale: {
    borderColor: "#333",
    timeVisible: true,
    secondsVisible: false,
  },
  crosshair: {
    vertLine: { labelBackgroundColor: "#00f2fe" },
    horzLine: { labelBackgroundColor: "#00f2fe" },
  },
};

export function CandlestickChart({
  candles,
  height = CHART_HEIGHT,
  className = "",
  emptyMessage = "Loading chart…",
  currentPrice,
  resolution,
}: CandlestickChartProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
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

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    volumeSeriesRef.current = volumeSeries;
    priceLineRef.current = null;

    return () => {
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
      priceLineRef.current = null;
    };
  }, [hasCandles, containerSize.w, containerSize.h]);

  // Resize
  useEffect(() => {
    if (!chartRef.current || containerSize.w <= 0) return;
    chartRef.current.applyOptions({ width: containerSize.w, height: containerSize.h });
  }, [containerSize.w, containerSize.h]);

  // 1) Full data – ONLY when historical candles change (new candle / symbol / resolution). No currentPrice here.
  useEffect(() => {
    if (!candleSeriesRef.current || !volumeSeriesRef.current || candles.length === 0) return;

    const ohlcRaw = candles.map((c) => ({
      time: c.time as UTCTimestamp,
      open: parseFloat(c.open),
      high: parseFloat(c.high),
      low: parseFloat(c.low),
      close: parseFloat(c.close),
    }));

    const volData = candles.map((c) => {
      const close = parseFloat(c.close);
      const open = parseFloat(c.open);
      const v = parseFloat(c.volume ?? "0");
      return {
        time: c.time as UTCTimestamp,
        value: v,
        color: close >= open ? "rgba(34, 197, 94, 0.5)" : "rgba(239, 68, 68, 0.5)",
      };
    });

    candleSeriesRef.current.setData(ohlcRaw);
    volumeSeriesRef.current.setData(volData);
  }, [candles]);

  // 2) Real-time: only update() last/current bar – no setData, so no lag. Chart owns current-period bar.
  useEffect(() => {
    const series = candleSeriesRef.current;
    if (!series || candles.length === 0) return;

    const last = candles[candles.length - 1]!;
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
          time: last.time as UTCTimestamp,
          open: lastOpen,
          high: Math.max(lastHigh, price),
          low: Math.min(lastLow, price),
          close: price,
        };
      }
    } else {
      bar = {
        time: last.time as UTCTimestamp,
        open: lastOpen,
        high: Math.max(lastHigh, price),
        low: Math.min(lastLow, price),
        close: price,
      };
    }

    series.update(bar);
  }, [candles, currentPrice, resolution]);

  // 3) Current price line
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
