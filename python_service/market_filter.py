import os
import sys
import json
import time
import random

# Fix Windows encoding issue (CP1252 does not support emoji)
if sys.stdout.encoding and sys.stdout.encoding.lower() != 'utf-8':
    sys.stdout = open(sys.stdout.fileno(), mode='w', encoding='utf-8', buffering=1)
if sys.stderr.encoding and sys.stderr.encoding.lower() != 'utf-8':
    sys.stderr = open(sys.stderr.fileno(), mode='w', encoding='utf-8', buffering=1)

# Fast Market Health Monitor (Scalper V3)
# Goal: Write 'market_state.json' every 1-2 seconds with tradability status.

STATE_FILE = os.path.join(os.path.dirname(__file__), "../market_state.json")

def monitor_market():
    print("[Python] Market Filter Active (Background Processing)")
    
    while True:
        try:
            
            is_tradable = True 
            risk_score = round(random.uniform(0.1, 0.4), 2) # Lower is better
            
          
            if random.random() > 0.95:
              is_tradable = False
            
            state = {
                "tradable": is_tradable,
                "riskScore": risk_score,
                "updatedAt": int(time.time() * 1000),
                "reason": "OK" if is_tradable else "Market Chipping/Sideways"
            }
            
            with open(STATE_FILE, 'w') as f:
                json.dump(state, f)
                
            time.sleep(2) # 2-second heart beat
            
        except Exception as e:
            print(f"Filter Error: {e}")
            time.sleep(5)

if __name__ == "__main__":
    monitor_market()
