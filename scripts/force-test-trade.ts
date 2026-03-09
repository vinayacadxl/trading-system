import "dotenv/config";
import { debugLog } from "../server/debug-logger";
import { placeOrder, getProductBySymbol, setLeverage, getTicker, getPortfolioValueUsd } from "../server/delta";

/**
 * FORCE TEST TRADE
 * 
 * Executes a single real market order with:
 * - Minimum order size
 * - Low leverage (2x)
 * - BTCUSD symbol
 * - Bypass AI filter
 * - Bypass risk engine
 * 
 * ⚠️ WARNING: This will execute a REAL TRADE with REAL MONEY
 */

async function forceTestTrade() {
    console.log("=".repeat(80));
    console.log("⚠️  FORCE TEST TRADE - REAL ORDER EXECUTION");
    console.log("=".repeat(80));
    console.log();

    const SYMBOL = "BTCUSD";
    const LEVERAGE = 2;
    const SIDE: "buy" | "sell" = "buy"; // Change to "sell" if you want to test sell

    debugLog("order_execution", {
        message: "🚀 Starting force test trade",
        symbol: SYMBOL,
        side: SIDE,
        leverage: LEVERAGE,
        bypassed: ["AI filter", "risk engine"],
    }, "INFO");

    try {
        // STEP 1: Get Account Balance
        console.log("\n📊 STEP 1: Fetching Account Balance...");
        const balance = await getPortfolioValueUsd();
        console.log(`   Balance: $${balance.toFixed(2)} USD`);

        if (balance <= 0) {
            throw new Error("Insufficient balance. Add funds to your Delta Exchange account.");
        }

        debugLog("order_execution", {
            message: "Account balance fetched",
            balance,
        }, "INFO");

        // STEP 2: Get Current Price
        console.log("\n💰 STEP 2: Fetching Current Price...");
        const ticker = await getTicker(SYMBOL);

        if (!ticker) {
            throw new Error(`Failed to fetch ticker for ${SYMBOL}`);
        }

        const currentPrice = parseFloat(ticker.last_price || ticker.mark_price || "0");
        console.log(`   Current Price: $${currentPrice.toFixed(2)}`);

        debugLog("order_execution", {
            message: "Current price fetched",
            symbol: SYMBOL,
            lastPrice: ticker.last_price,
            markPrice: ticker.mark_price,
        }, "INFO");

        // STEP 3: Get Product ID
        console.log("\n🔍 STEP 3: Getting Product ID...");
        const productId = await getProductBySymbol(SYMBOL);

        if (!productId) {
            throw new Error(`Product ID not found for ${SYMBOL}`);
        }

        console.log(`   Product ID: ${productId}`);

        debugLog("order_execution", {
            message: "Product ID resolved",
            symbol: SYMBOL,
            productId,
        }, "INFO");

        // STEP 4: Set Leverage
        console.log(`\n⚙️  STEP 4: Setting Leverage to ${LEVERAGE}x...`);
        const leverageResult = await setLeverage(productId, LEVERAGE);

        if (!leverageResult.success) {
            console.warn(`   ⚠️  Leverage setting failed: ${leverageResult.error?.message || "Unknown error"}`);
            console.warn(`   Continuing anyway - leverage may already be set...`);
        } else {
            console.log(`   ✅ Leverage set to ${LEVERAGE}x`);
        }

        debugLog("order_execution", {
            message: "Leverage setting attempted",
            productId,
            leverage: LEVERAGE,
            success: leverageResult.success,
            error: leverageResult.error?.message,
        }, leverageResult.success ? "INFO" : "WARN");

        // STEP 5: Calculate Minimum Order Size
        console.log("\n📏 STEP 5: Calculating Minimum Order Size...");

        // For BTCUSD (inverse contract), minimum is 1 USD contract
        // For BTCUSDT (linear), minimum is 0.001 BTC
        let orderSize: number;

        if (SYMBOL === "BTCUSD") {
            // Inverse contract - size in USD contracts
            orderSize = 1; // Minimum 1 USD contract
            console.log(`   Order Size: ${orderSize} USD contracts`);
        } else {
            // Linear contract - size in BTC
            orderSize = 0.001; // Minimum 0.001 BTC
            console.log(`   Order Size: ${orderSize} BTC`);
        }

        debugLog("order_execution", {
            message: "Order size calculated",
            symbol: SYMBOL,
            orderSize,
            estimatedValue: SYMBOL === "BTCUSD" ? orderSize : orderSize * currentPrice,
        }, "INFO");

        // STEP 6: Log Pre-Order Details
        console.log("\n📋 STEP 6: Pre-Order Summary");
        console.log("=".repeat(80));
        console.log(`   Symbol:        ${SYMBOL}`);
        console.log(`   Side:          ${SIDE.toUpperCase()}`);
        console.log(`   Order Type:    MARKET`);
        console.log(`   Size:          ${orderSize}`);
        console.log(`   Product ID:    ${productId}`);
        console.log(`   Leverage:      ${LEVERAGE}x`);
        console.log(`   Current Price: $${currentPrice.toFixed(2)}`);
        console.log(`   Balance:       $${balance.toFixed(2)}`);
        console.log("=".repeat(80));

        // Confirmation prompt
        console.log("\n⚠️  THIS IS A REAL TRADE! Press Ctrl+C to cancel...");
        console.log("⏳ Executing in 5 seconds...\n");

        await new Promise(resolve => setTimeout(resolve, 5000));

        // STEP 7: Execute Order
        console.log("\n🚀 STEP 7: Placing Market Order...");
        const orderStartTime = Date.now();

        const orderPayload = {
            symbol: SYMBOL,
            side: SIDE,
            size: orderSize,
            order_type: "market" as const,
            product_id: productId,
        };

        debugLog("order_execution", {
            message: "Placing order",
            payload: orderPayload,
            timestamp: new Date().toISOString(),
        }, "INFO");

        const orderResult = await placeOrder(orderPayload);
        const orderLatency = Date.now() - orderStartTime;

        // STEP 8: Log Result
        console.log("\n📊 STEP 8: Order Result");
        console.log("=".repeat(80));

        if (orderResult.success) {
            console.log("✅ ORDER EXECUTED SUCCESSFULLY!");
            console.log(`   Order ID:     ${orderResult.result?.id || "N/A"}`);
            console.log(`   Symbol:       ${orderResult.result?.symbol || SYMBOL}`);
            console.log(`   Side:         ${orderResult.result?.side || SIDE}`);
            console.log(`   Size:         ${orderResult.result?.size || orderSize}`);
            console.log(`   State:        ${orderResult.result?.state || "unknown"}`);
            console.log(`   Latency:      ${orderLatency}ms`);

            debugLog("order_execution", {
                message: "✅ Order executed successfully",
                orderId: orderResult.result?.id,
                symbol: orderResult.result?.symbol,
                side: orderResult.result?.side,
                size: orderResult.result?.size,
                state: orderResult.result?.state,
                latency: orderLatency,
                fullResponse: orderResult.result,
            }, "INFO");
        } else {
            console.log("❌ ORDER FAILED!");
            console.log(`   Error Code:    ${orderResult.error?.code || "unknown"}`);
            console.log(`   Error Message: ${orderResult.error?.message || "Unknown error"}`);
            console.log(`   Latency:       ${orderLatency}ms`);

            // Error categorization
            const errorMsg = (orderResult.error?.message || "").toLowerCase();
            const errorCode = (orderResult.error?.code || "").toLowerCase();

            let errorCategory = "UNKNOWN";
            let suggestion = "Check Delta Exchange API documentation";

            if (errorMsg.includes("signature") || errorCode.includes("signature")) {
                errorCategory = "SIGNATURE_MISMATCH";
                suggestion = "Check if system time is correct. Verify API secret key.";
            } else if (errorMsg.includes("insufficient") || errorMsg.includes("margin")) {
                errorCategory = "INSUFFICIENT_MARGIN";
                suggestion = "Increase leverage or reduce order size.";
            } else if (errorMsg.includes("size") || errorMsg.includes("quantity")) {
                errorCategory = "INVALID_SIZE";
                suggestion = "Check minimum order size requirements for this product.";
            } else if (errorMsg.includes("leverage")) {
                errorCategory = "LEVERAGE_ERROR";
                suggestion = "Set leverage manually on Delta Exchange before retrying.";
            } else if (errorMsg.includes("ip") || errorMsg.includes("whitelist")) {
                errorCategory = "IP_NOT_WHITELISTED";
                suggestion = "Add your server IP to Delta Exchange whitelist.";
            }

            console.log(`   Category:      ${errorCategory}`);
            console.log(`   Suggestion:    ${suggestion}`);

            debugLog("error", {
                message: "❌ Order execution failed",
                errorCategory,
                errorCode: orderResult.error?.code,
                errorMessage: orderResult.error?.message,
                suggestion,
                payload: orderPayload,
                latency: orderLatency,
            }, "ERROR");
        }

        console.log("=".repeat(80));
        console.log("\n✅ Test trade completed. Check debug-logs/order_execution.json for details.");

    } catch (error) {
        console.error("\n❌ CRITICAL ERROR:");
        console.error(error);

        debugLog("error", {
            message: "Critical error during force test trade",
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
        }, "ERROR");
    }
}

// Execute
forceTestTrade().catch(console.error);
