# Scalping ko advance kaise banayein

Bot me already **orderbook imbalance**, **regime-based strength**, **trailing stop**, aur **confidence-based exit** hai. Neeche options se aap scalping ko aur advanced bana sakte ho.

---

## 1. **Entry quality (orderbook scalper)**

| Env variable | Default | Advance tip |
|--------------|---------|-------------|
| `SCALP_IMBALANCE_BUY` | 1.10 | **1.15–1.25** = kam entries, zyada strong buy imbalance |
| `SCALP_IMBALANCE_SELL` | 0.90 | **0.85–0.80** = kam entries, zyada strong sell imbalance |
| `SCALP_IMBALANCE_STRONG_BUY` | 1.25 | **1.30** = sirf bahut strong imbalance pe buy |
| `SCALP_IMBALANCE_STRONG_SELL` | 0.80 | **0.75** = sirf bahut strong imbalance pe sell |
| `SCALP_SPREAD_MAX_PCT` | 0.2 | **0.15** = tight spread = better fill, thode kam signals |

**Example (stricter entries):**
```env
SCALP_IMBALANCE_BUY=1.20
SCALP_IMBALANCE_SELL=0.82
SCALP_SPREAD_MAX_PCT=0.15
```

---

## 2. **TP / SL / Trailing (position exit)**

| Env variable | Default | Advance tip |
|--------------|---------|-------------|
| `SCALP_TP_PCT` | 0.35 | **0.45–0.6** = bada target, R:R improve (SL same rakh kar) |
| `SCALP_SL_PCT` | -0.25 | **-0.2** = tight SL (fast cut), **-0.35** = thoda room |
| `SCALP_TRAIL_PCT` | 0.15 | **0.12** = jaldi trail lock, **0.2** = zyada room |
| `SCALP_MAX_HOLD_S` | 60 | **90–120** = hold longer for TP; **45** = quick scalp only |

**Example (better R:R):**
```env
SCALP_TP_PCT=0.5
SCALP_SL_PCT=-0.25
SCALP_TRAIL_PCT=0.12
SCALP_MAX_HOLD_S=90
```

---

## 3. **Confidence exit (position-manager)**

| Env variable | Default | Advance tip |
|--------------|---------|-------------|
| `SCALP_MIN_CONF_HOLD` | 0.7 | **0.75** = TP ke baad sirf high confidence pe hold |
| `SCALP_CONF_EXIT` | 0.5 | **0.55** = thoda jaldi exit jab confidence girne lage |

---

## 4. **Capital & risk (multi-symbol)**

| Env variable | Default | Advance tip |
|--------------|---------|-------------|
| `SCALP_CAPITAL_PER_TRADE` | 0.20 | **0.15** = chota size = kam risk |
| `MULTI_SYMBOL_MAX_CONCURRENT` | 1 | **2** agar 2 positions chahiye; 1 = minimal risk |
| `SCANNER_TICK_MS` | 8000 | **5000** = faster reaction to scanner signals |

---

## 5. **Quick “advanced” preset (stricter + better R:R)**

`.env` me add karo:

```env
# Stricter entries (orderbook)
SCALP_IMBALANCE_BUY=1.18
SCALP_IMBALANCE_SELL=0.85
SCALP_IMBALANCE_STRONG_BUY=1.28
SCALP_IMBALANCE_STRONG_SELL=0.78
SCALP_SPREAD_MAX_PCT=0.18

# Better TP/SL and hold
SCALP_TP_PCT=0.45
SCALP_SL_PCT=-0.22
SCALP_TRAIL_PCT=0.12
SCALP_MAX_HOLD_S=75

# Slightly stricter confidence exit
SCALP_CONF_EXIT=0.52
```

---

## 6. **Trend filter (ulti trade avoid)**

| Env variable | Default | Description |
|--------------|---------|-------------|
| `TREND_FILTER` | `1` (on) | `0` = band; `1` = BUY sirf jab short-term trend up/neutral, SELL sirf jab trend down/neutral. Ulti trade kam. |

Trend last **8** prices se nikalta hai: current vs pehle 8 ka avg. **0.04%** se zyada move = up/down.

---

## 7. **Aur advance (future ideas)**

- **ATR-based SL:** Volatility ke hisaab se SL (abhi fixed %).
- **Partial TP:** Pehle 50% at 0.3%, baaki trailing (code me structure hai, full wiring alag).
- **Time filter:** Sirf high liquidity hours me trade (e.g. 9–11 UTC).
- **Correlation filter:** Ek saath BTC + ETH long na khule (risk reduce).

Ab jo bhi env values set karo, server restart ke baad apply ho jayengi.
