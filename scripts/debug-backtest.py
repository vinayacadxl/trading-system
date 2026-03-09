#!/usr/bin/env python3
"""
Debug script: Run backtest and show WHY each signal was taken/rejected.
Reveals what quality_score each trade got, and what the typical values are.
"""
import sys, os, json, requests
from datetime import datetime

# API
DELTA_BASE = os.getenv("DELTA_BASE_URL", "https://api.india.delta.exchange")
SYM = "BTCUSD"
RES = "15m"
N = 2688  # 28 days of 15m data (2688 = 28 * 24 * 4) - covers multiple market regimes

# Fetch candles
end = int(__import__("time").time())
start = end - N * 15 * 60
url = f"{DELTA_BASE}/v2/history/candles?symbol={SYM}&resolution={RES}&start={start}&end={end}"
r = requests.get(url, timeout=15)
raw_json = r.json()

# Delta API returns: {"result": {"rows": [[time, close, high, low, open, volume], ...]}}
# Note: order is time, close, high, low, open, volume  
result = raw_json if isinstance(raw_json, list) else raw_json.get("result", raw_json)
rows = result.get("rows", []) if isinstance(result, dict) else result

candles = []
for c in rows:
    if isinstance(c, (list, tuple)):
        candles.append({
            "time": int(c[0]),
            "open": str(c[4]),   # Delta: [time, close, high, low, open, volume]
            "high": str(c[2]),
            "low": str(c[3]),
            "close": str(c[1]),
            "volume": str(c[5]) if len(c) > 5 else "0"
        })
    else:
        candles.append({
            "time": int(c.get("time", 0)),
            "open": str(c.get("open", 0)),
            "high": str(c.get("high", 0)),
            "low": str(c.get("low", 0)),
            "close": str(c.get("close", 0)),
            "volume": str(c.get("volume", 0))
        })

candles = sorted(candles, key=lambda x: x["time"])
print(f"Fetched {len(candles)} candles")

# Run backtest
payload = {
    "candles": candles,
    "leverage": 25,
    "nominalCapital": 41,
    "qualityThreshold": 70,
    "maxTradesPerDay": 60,
    "minBarsBetweenTrades": 1,
    # Fast micro-scalp config: small TP/SL = realistic 15m targets, R:R = 2:1
    "tpHigh": 0.008,        # 0.8% TP for impulse
    "slHigh": 0.004,        # 0.4% SL for impulse
    "tpMid":  0.006,        # 0.6% TP for scalp
    "slMid":  0.003,        # 0.3% SL for scalp
    "leverageCapHigh": 15,  # max 15x on impulse
    "leverageCapMid":  12,  # max 12x on scalp
}
res = requests.post("http://127.0.0.1:5006/backtest/universal", json=payload, timeout=90)
data = res.json()

if not data.get("success"):
    print("ERROR:", data.get("error"))
    sys.exit(1)

trades = data.get("tradeLog", [])
wins = [t for t in trades if t["pnlUsd"] > 0]
losses = [t for t in trades if t["pnlUsd"] <= 0]

print(f"\n== BACKTEST RESULT ==")
print(f"Total Trades: {len(trades)}")
print(f"Win Rate: {len(wins)/len(trades)*100:.1f}% ({len(wins)}W / {len(losses)}L)")
print(f"Total P&L: ${sum(t['pnlUsd'] for t in trades):.2f}")
print(f"Debug Stats: {data.get('debugStats')}")

print(f"\n== TRADE BREAKDOWN ==")
print(f"{'#':>3} {'side':>4} {'score':>6} {'tier':>8} {'move%':>6} {'tp%':>5} {'sl%':>5} {'bars':>5} {'reason':>16} {'pnl$':>8}")
for i, t in enumerate(trades[:50]):
    pnl = t['pnlUsd']
    mark = "✅" if pnl > 0 else "❌"
    move = t.get('rawMovePct', 0)
    tp_pct = t.get('tpPct', '?')
    sl_pct = t.get('slPct', '?')
    print(f"{i+1:>3} {t['signal']:>4} {t.get('confidenceScore',0):>6.0f} {t.get('regime','?'):>8} {move:>6.3f} {tp_pct:>5} {sl_pct:>5} {t.get('holdBars',0):>5} {t['exitReason']:>16} {mark}{pnl:>7.2f}")

# Analyze win vs loss avg entry quality
if wins:
    avg_win_score = sum(t.get('confidenceScore', 0) for t in wins) / len(wins)
    avg_loss_score = sum(t.get('confidenceScore', 0) for t in losses) / len(losses) if losses else 0
    print(f"\nAvg Quality Score → Wins: {avg_win_score:.1f} | Losses: {avg_loss_score:.1f}")

    impulse_trades = [t for t in trades if t.get('regime') == 'IMPULSE']
    scalp_trades = [t for t in trades if t.get('regime') == 'SCALP']
    if impulse_trades:
        imp_wr = sum(1 for t in impulse_trades if t['pnlUsd'] > 0) / len(impulse_trades) * 100
        print(f"IMPULSE trades: {len(impulse_trades)} | WR: {imp_wr:.1f}%")
    if scalp_trades:
        sc_wr = sum(1 for t in scalp_trades if t['pnlUsd'] > 0) / len(scalp_trades) * 100
        print(f"SCALP trades:   {len(scalp_trades)} | WR: {sc_wr:.1f}%")

# Exit reason breakdown
reasons = {}
for t in trades:
    r = t['exitReason']
    if r not in reasons: reasons[r] = {'n': 0, 'pnl': 0}
    reasons[r]['n'] += 1
    reasons[r]['pnl'] += t['pnlUsd']
print(f"\nExit Reason Breakdown:")
for reason, s in sorted(reasons.items(), key=lambda x:-abs(x[1]['pnl'])):
    print(f"  {reason:>20}: {s['n']:>3} trades | P&L ${s['pnl']:>7.2f}")
