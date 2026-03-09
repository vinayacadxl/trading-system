import React, { useEffect, useState, useRef } from 'react';
import { io, Socket } from 'socket.io-client';

interface SymbolSignal {
  symbol: string;
  signalStrength: number;
  direction: 'buy' | 'sell' | 'neutral';
  confidence: number;
  regime: string;
  lastPrice: number;
  change24h: number;
  lastUpdate: number;
}

interface MultiSymbolGridProps {
  /** When provided, chart will sync to the symbol at top of the list (sorted by strength) */
  onTopSymbolChange?: (symbol: string) => void;
}

export function MultiSymbolGrid({ onTopSymbolChange }: MultiSymbolGridProps = {}) {
  const [signals, setSignals] = useState<SymbolSignal[]>([]);
  const [loading, setLoading] = useState(true);
  const [livePrices, setLivePrices] = useState<Record<string, number>>({});
  const [retrying, setRetrying] = useState(false);
  const socketRef = useRef<Socket | null>(null);

  const fetchSignals = React.useCallback(async () => {
    try {
      const res = await fetch('/api/multi-symbol/signals');
      const text = await res.text();
      let data: { success?: boolean; signals?: SymbolSignal[] };
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        if (!res.ok) console.error('Multi-symbol signals: server error (invalid response)');
        setLoading(false);
        setRetrying(false);
        return;
      }
      if (data.success && Array.isArray(data.signals)) {
        setSignals(data.signals);
        if (data.signals.length > 0 && onTopSymbolChange) {
          onTopSymbolChange(data.signals[0].symbol);
        }
      }
      setLoading(false);
      setRetrying(false);
    } catch (e) {
      console.error('Failed to fetch multi-symbol signals:', e);
      setLoading(false);
      setRetrying(false);
    }
  }, [onTopSymbolChange]);

  useEffect(() => {
    fetchSignals();
    const interval = setInterval(fetchSignals, 5000);

    // 2. Real-time WebSocket for Prices
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    if (origin) {
      const socket = io(origin, {
        path: "/socket.io/",
        transports: ["websocket", "polling"],
      });
      socketRef.current = socket;

      socket.on("connect", () => {
        // console.log("[MultiGrid] Socket connected for live prices");
      });

      socket.on("live-ticker", (data: any) => {
        if (data && data.symbol && data.lastPrice) {
          setLivePrices(prev => ({
            ...prev,
            [data.symbol]: parseFloat(data.lastPrice)
          }));
        }
      });

      return () => {
        clearInterval(interval);
        if (socket) socket.disconnect();
      };
    }

    return () => clearInterval(interval);
  }, [fetchSignals]);

  const getSignalColor = (strength: number, direction: string) => {
    if (direction === 'neutral') return 'neutral';
    if (strength >= 80) return direction === 'buy' ? 'strong-buy' : 'strong-sell';
    if (strength >= 60) return direction === 'buy' ? 'medium-buy' : 'medium-sell';
    return direction === 'buy' ? 'weak-buy' : 'weak-sell';
  };

  const getDirectionIcon = (direction: string) => {
    if (direction === 'buy') return '📈';
    if (direction === 'sell') return '📉';
    return '➖';
  };

  if (loading) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', color: '#00f5ff' }}>
        Loading multi-symbol signals...
      </div>
    );
  }

  return (
    <div style={{
      background: 'linear-gradient(145deg, #0f1419 0%, #1a1f2e 100%)',
      borderRadius: '12px',
      border: '1px solid rgba(0, 245, 255, 0.1)',
      padding: '12px',
      margin: '20px 0',
      maxHeight: '400px',
      overflow: 'auto'
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '10px',
        paddingBottom: '8px',
        borderBottom: '2px solid rgba(0, 245, 255, 0.2)'
      }}>
        <div>
          <h3 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#00f5ff', margin: 0 }}>
            🎯 Multi-Symbol Signals
          </h3>
          <p style={{ fontSize: '0.7rem', color: '#6ee7b7', margin: '4px 0 0 0', opacity: 0.9 }}>
            Auto-trade: Har symbol independent — jis pe bhi BUY/SELL aata hai (strength ≥42%, confidence ≥45%), usi par trade execute. Thoda profit book → exit → dubara signal pe re-entry (scalp).
          </p>
        </div>
        <span style={{ fontSize: '0.75rem', color: '#888', fontFamily: 'monospace' }}>
          {signals.length > 0 && signals[0].lastUpdate
            ? `Last: ${new Date(signals[0].lastUpdate).toLocaleTimeString()}`
            : 'Last: --'}
        </span>
      </div>

      {signals.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px 20px', color: '#94a3b8' }}>
          <p style={{ marginBottom: '12px' }}>Data abhi load nahi hua. Pehla scan ho raha ho sakta hai.</p>
          <p style={{ fontSize: '0.85rem', marginBottom: '16px', color: '#64748b' }}>Thodi der wait karein — har 5s par dubara try hota hai.</p>
          <button
            type="button"
            onClick={() => { setRetrying(true); fetchSignals(); }}
            disabled={retrying}
            style={{
              padding: '8px 16px',
              borderRadius: '8px',
              border: '1px solid rgba(0, 245, 255, 0.4)',
              background: 'rgba(0, 245, 255, 0.1)',
              color: '#00f5ff',
              cursor: retrying ? 'wait' : 'pointer',
              fontWeight: 600
            }}
          >
            {retrying ? 'Loading…' : 'Retry'}
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {/* Table Header */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: '120px 150px 1fr 100px 130px',
            gap: '12px',
            padding: '8px 12px',
            background: 'rgba(0, 245, 255, 0.05)',
            borderRadius: '8px',
            fontSize: '0.75rem',
            fontWeight: 600,
            color: '#00f5ff',
            textTransform: 'uppercase',
            letterSpacing: '0.5px'
          }}>
            <div>Symbol</div>
            <div>Price</div>
            <div>Signal Strength</div>
            <div>Action</div>
            <div>Regime</div>
          </div>

          {/* Signal Rows */}
          {signals.map((signal) => (
            <div
              key={signal.symbol}
              style={{
                display: 'grid',
                gridTemplateColumns: '120px 150px 1fr 100px 130px',
                gap: '12px',
                padding: '10px 12px',
                background: 'linear-gradient(135deg, rgba(15, 52, 96, 0.4) 0%, rgba(22, 33, 62, 0.4) 100%)',
                borderRadius: '8px',
                alignItems: 'center',
                borderLeft: `3px solid ${signal.direction === 'buy' ? '#22c55e' :
                  signal.direction === 'sell' ? '#ef4444' :
                    '#888'
                  }`,
                transition: 'all 0.3s ease',
                cursor: 'pointer'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'linear-gradient(135deg, rgba(15, 52, 96, 0.6) 0%, rgba(22, 33, 62, 0.6) 100%)';
                e.currentTarget.style.transform = 'translateX(4px)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'linear-gradient(135deg, rgba(15, 52, 96, 0.4) 0%, rgba(22, 33, 62, 0.4) 100%)';
                e.currentTarget.style.transform = 'translateX(0)';
              }}
            >
              {/* Symbol */}
              <div style={{ fontSize: '0.95rem', fontWeight: 700, color: '#fff', fontFamily: 'monospace' }}>
                {signal.symbol}
              </div>

              {/* Price + Change */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <span style={{ fontSize: '1rem', fontWeight: 600, color: '#00f5ff', fontFamily: 'monospace' }}>
                  ${(livePrices[signal.symbol] || signal.lastPrice).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
                </span>
                {signal.change24h !== 0 && (
                  <span style={{
                    fontSize: '0.7rem',
                    padding: '2px 6px',
                    borderRadius: '4px',
                    width: 'fit-content',
                    fontWeight: 600,
                    background: signal.change24h > 0 ? 'rgba(34, 197, 94, 0.2)' : 'rgba(239, 68, 68, 0.2)',
                    color: signal.change24h > 0 ? '#22c55e' : '#ef4444'
                  }}>
                    {signal.change24h > 0 ? '↗' : '↘'} {Math.abs(signal.change24h).toFixed(2)}%
                  </span>
                )}
              </div>

              {/* Signal Strength Bar */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', width: '100%' }}>
                <div style={{
                  flex: 1,
                  height: '10px',
                  background: 'rgba(15, 52, 96, 0.6)',
                  borderRadius: '5px',
                  overflow: 'hidden',
                  border: '1px solid rgba(0, 245, 255, 0.1)'
                }}>
                  <div style={{
                    width: `${signal.signalStrength}%`,
                    height: '100%',
                    transition: 'width 0.5s ease',
                    borderRadius: '5px',
                    background:
                      getSignalColor(signal.signalStrength, signal.direction) === 'strong-buy' ? '#22c55e' :
                        getSignalColor(signal.signalStrength, signal.direction) === 'medium-buy' ? '#4ade80' :
                          getSignalColor(signal.signalStrength, signal.direction) === 'weak-buy' ? '#86efac' :
                            getSignalColor(signal.signalStrength, signal.direction) === 'strong-sell' ? '#ef4444' :
                              getSignalColor(signal.signalStrength, signal.direction) === 'medium-sell' ? '#f87171' :
                                getSignalColor(signal.signalStrength, signal.direction) === 'weak-sell' ? '#fca5a5' :
                                  '#888'
                  }} />
                </div>
                <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#fff', minWidth: '45px', textAlign: 'right', fontFamily: 'monospace' }}>
                  {signal.signalStrength}%
                </span>
              </div>

              {/* Direction Badge */}
              <div style={{ display: 'flex', justifyContent: 'center' }}>
                <span style={{
                  padding: '6px 12px',
                  borderRadius: '6px',
                  fontSize: '0.75rem',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                  border: '1px solid',
                  background:
                    signal.direction === 'buy' ? 'rgba(34, 197, 94, 0.15)' :
                      signal.direction === 'sell' ? 'rgba(239, 68, 68, 0.15)' :
                        'rgba(136, 136, 136, 0.15)',
                  color:
                    signal.direction === 'buy' ? '#22c55e' :
                      signal.direction === 'sell' ? '#ef4444' :
                        '#888',
                  borderColor:
                    signal.direction === 'buy' ? '#22c55e' :
                      signal.direction === 'sell' ? '#ef4444' :
                        '#888'
                }}>
                  {getDirectionIcon(signal.direction)} {signal.direction.toUpperCase()}
                </span>
              </div>

              {/* Regime + Confidence */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <span style={{ fontSize: '0.8rem', fontWeight: 600, color: '#00f5ff', textTransform: 'uppercase' }}>
                  {signal.regime}
                </span>
                <span style={{ fontSize: '0.7rem', color: '#888', fontFamily: 'monospace' }}>
                  Conf: {signal.confidence}%
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
