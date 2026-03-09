import "dotenv/config";
import path from "path";
import dotenv from "dotenv";

// Force reload from .env
dotenv.config({ path: path.resolve(process.cwd(), ".env"), override: true });

async function diagnoseConnection() {
    console.log("=".repeat(60));
    console.log("🔍 DELTA EXCHANGE CONNECTION DIAGNOSTICS");
    console.log("=".repeat(60));
    console.log();

    // 1. Check Environment Variables
    console.log("1️⃣  ENVIRONMENT VARIABLES CHECK:");
    console.log("-".repeat(60));
    const apiKey = process.env.DELTA_API_KEY;
    const secretKey = process.env.DELTA_SECRET_KEY;
    const baseUrl = process.env.DELTA_BASE_URL || "https://api.india.delta.exchange";

    console.log(`   Base URL: ${baseUrl}`);
    console.log(`   API Key: ${apiKey ? apiKey.substring(0, 8) + "..." : "❌ NOT SET"}`);
    console.log(`   Secret Key: ${secretKey ? secretKey.substring(0, 8) + "..." : "❌ NOT SET"}`);
    console.log(`   API Key Length: ${apiKey?.length || 0}`);
    console.log(`   Secret Key Length: ${secretKey?.length || 0}`);
    console.log();

    if (!apiKey || !secretKey) {
        console.error("❌ ERROR: API keys are not set in .env file!");
        return;
    }

    // 2. Check Server IP
    console.log("2️⃣  SERVER IP ADDRESS:");
    console.log("-".repeat(60));
    try {
        const ipRes = await fetch("https://api.ipify.org?format=json");
        const ipData = await ipRes.json() as { ip: string };
        console.log(`   🌐 Your Server IP: ${ipData.ip}`);
        console.log(`   ⚠️  WHITELIST THIS IP ON DELTA EXCHANGE!`);
    } catch (e) {
        console.error(`   ❌ Failed to fetch IP: ${e}`);
    }
    console.log();

    // 3. Test Delta API Connection (Simple Public Endpoint - No Auth)
    console.log("3️⃣  PUBLIC API TEST (No Auth Required):");
    console.log("-".repeat(60));
    try {
        const productsUrl = `${baseUrl}/v2/products`;
        console.log(`   Testing: ${productsUrl}`);
        const productsRes = await fetch(productsUrl);
        if (productsRes.ok) {
            const productsData = await productsRes.json();
            console.log(`   ✅ Public API works! Found ${productsData.result?.length || 0} products`);
        } else {
            console.error(`   ❌ Public API failed: ${productsRes.status} ${productsRes.statusText}`);
            const text = await productsRes.text();
            console.error(`   Response: ${text.substring(0, 200)}`);
        }
    } catch (e) {
        console.error(`   ❌ Error: ${e instanceof Error ? e.message : String(e)}`);
    }
    console.log();

    // 4. Test Authenticated API (Balance Check)
    console.log("4️⃣  AUTHENTICATED API TEST (Wallet Balance):");
    console.log("-".repeat(60));
    try {
        const crypto = await import("crypto");
        const timestamp = Math.floor(Date.now() / 1000).toString();
        const method = "GET";
        const path = "/v2/wallet/balances";
        const queryString = "";
        const bodyStr = "";

        const message = method + timestamp + path + queryString + bodyStr;
        const signature = crypto.createHmac("sha256", secretKey!)
            .update(message)
            .digest("hex");

        const url = `${baseUrl}${path}`;
        console.log(`   Testing: ${url}`);
        console.log(`   Timestamp: ${timestamp}`);
        console.log(`   Signature: ${signature.substring(0, 16)}...`);

        const balanceRes = await fetch(url, {
            method: "GET",
            headers: {
                "api-key": apiKey!,
                "signature": signature,
                "timestamp": timestamp,
                "Content-Type": "application/json",
                "User-Agent": "DeltaBot/1.0"
            }
        });

        const responseText = await balanceRes.text();
        let responseData;
        try {
            responseData = JSON.parse(responseText);
        } catch {
            responseData = responseText;
        }

        console.log(`   Status: ${balanceRes.status} ${balanceRes.statusText}`);

        if (balanceRes.ok) {
            console.log(`   ✅ AUTHENTICATED API WORKS!`);
            console.log(`   Response:`, JSON.stringify(responseData, null, 2).substring(0, 300));
        } else {
            console.error(`   ❌ AUTHENTICATION FAILED!`);
            console.error(`   Response:`, JSON.stringify(responseData, null, 2));

            // Parse error and give specific advice
            const errorMsg = JSON.stringify(responseData).toLowerCase();
            console.log();
            console.log("   🔧 DIAGNOSIS:");
            console.log("-".repeat(60));

            if (errorMsg.includes("invalid") && errorMsg.includes("key")) {
                console.error("   ⚠️  Invalid API Key");
                console.error("   Fix: Check your API key in .env file");
                console.error("   Ensure you're using India API for India keys");
            } else if (errorMsg.includes("ip") || errorMsg.includes("whitelist")) {
                console.error("   ⚠️  IP Not Whitelisted");
                console.error("   Fix: Add your server IP to Delta Exchange whitelist");
                console.error("   Go to: Delta Exchange → Settings → API Management");
            } else if (errorMsg.includes("permission") || errorMsg.includes("not authorised")) {
                console.error("   ⚠️  Insufficient Permissions");
                console.error("   Fix: Enable 'Trading' permission on your API key");
                console.error("   Currently it might have only 'Read Data' permission");
            } else if (errorMsg.includes("signature")) {
                console.error("   ⚠️  Signature Mismatch");
                console.error("   Fix: Check if system time is correct");
                console.error("   Secret key might be wrong");
            } else {
                console.error("   ⚠️  Unknown Error");
                console.error(`   Error: ${errorMsg.substring(0, 200)}`);
            }
        }
    } catch (e) {
        console.error(`   ❌ Error: ${e instanceof Error ? e.message : String(e)}`);
    }
    console.log();

    // 5. Summary and Next Steps
    console.log("=".repeat(60));
    console.log("📋 NEXT STEPS:");
    console.log("=".repeat(60));
    console.log("1. Go to Delta Exchange → Settings → API Management");
    console.log("2. Whitelist your server IP (shown above)");
    console.log("3. Ensure API key has 'Read Data' + 'Trading' permissions");
    console.log("4. Wait 1-2 minutes after whitelisting IP");
    console.log("5. Refresh your Settings page in the browser");
    console.log();
}

diagnoseConnection().catch(console.error);
