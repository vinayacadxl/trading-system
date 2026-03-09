import { getPortfolioValueUsd, reloadKeysFromEnv } from './delta.js';
import { getDailyPnl, getDailyTradeCount } from './position-storage.js';

async function check() {
    reloadKeysFromEnv();
    const balance = await getPortfolioValueUsd();
    const dailyPnl = await getDailyPnl();
    const tradeCount = await getDailyTradeCount();
    console.log(`BALANCE: $${balance}`);
    console.log(`DAILY_PNL: $${dailyPnl}`);
    console.log(`TRADE_COUNT: ${tradeCount}`);
    process.exit(0);
}

check();
