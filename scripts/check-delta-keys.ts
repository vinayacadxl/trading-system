import "dotenv/config";
import path from "path";
import dotenv from "dotenv";
import crypto from "crypto";
import fs from "fs";

// Force load .env
dotenv.config({ path: path.resolve(process.cwd(), ".env"), override: true });

const DELTA_BASE_URL = (process.env.DELTA_BASE_URL || "https://api.india.delta.exchange").replace(/\/$/, "");
const API_KEY = process.env.DELTA_API_KEY;
const SECRET_KEY = process.env.DELTA_SECRET_KEY;

console.log("\n==================================================");
console.log("       DELTA EXCHANGE CONNECTION DIAGNOSTIC       ");
console.log("==================================================\n");

console.log("1. CONFIGURATION");
console.log("   Base URL:   ", DELTA_BASE_URL);
console.log("   API Key:    ", API_KEY ? `${API_KEY.slice(0, 4)}...${API_KEY.slice(-4)}` : "MISSING");
console.log("   Secret Key: ", SECRET_KEY ? "Present (starts with " + SECRET_KEY.slice(0, 3) + ")" : "MISSING");

if (!API_KEY || !SECRET_KEY) {
    console.error("\nERROR: API Key or Secret Key is missing in .env file.");
    process.exit(1);
}

// 2. CHECK PUBLIC IP
async function checkPublicIP() {
    console.log("\n2. CHECKING YOUR PUBLIC IP...");
    try {
        const res = await fetch("https://api.ipify.org?format=json");
        const data = await res.json() as { ip: string };
        console.log("   YOUR PUBLIC IP IS: ", data.ip);
        return data.ip;
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.log("   Could not fetch public IP:", msg);
        return null;
    }
}

// 3. TEST CONNECTION
async function testConnection(publicIp: string | null) {
    console.log("\n3. TESTING CONNECTION TO DELTA EXCHANGE...");
    const method = "GET";
    const path = "/v2/wallet/balances";
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const query = "";
    const body = "";

    const message = method + timestamp + path + query + body;
    const signature = crypto.createHmac("sha256", SECRET_KEY!)
        .update(message)
        .digest("hex");

    const headers = {
        "api-key": API_KEY!,
        "signature": signature,
        "timestamp": timestamp,
        "Content-Type": "application/json"
    };

    try {
        const res = await fetch(DELTA_BASE_URL + path, { method, headers });
        const text = await res.text();

        console.log(`   Response Status: ${res.status} ${res.statusText}`);

        if (res.ok) {
            console.log("\n✅ SUCCESS! Connection established.");
            console.log("   Your API Key and IP Whitelist are CORRECT.");
            fs.writeFileSync('scripts/delta_error.log', "SUCCESS");
        } else {
            console.log("\n❌ FAILED. Error Response:");
            console.log(text);

            // Log to file for AI to read
            fs.writeFileSync('scripts/delta_error.log', text);

            console.log("\n---------------- DIAGNOSIS ----------------");
            if (text.includes("ip_not_whitelisted")) {
                console.log("🔴 ISSUE: IP NOT WHITELISTED");
                console.log(`   You MUST whitelist this IP: ${publicIp || "unknown"}`);
                console.log(`   Go to Delta Exchange -> API Management -> Edit Key (${API_KEY!.slice(0, 4)}...) -> Add ${publicIp}`);
            } else if (text.includes("invalid_api_key")) {
                console.log("🔴 ISSUE: INVALID API KEY");
                console.log("   The API Key in .env is incorrect or does not exist on this platform.");
                console.log(`   Current URL: ${DELTA_BASE_URL}`);
                console.log("   If your account is on Global, change URL in .env to https://api.delta.exchange");
                console.log("   If your account is on India, ensure key was created on india.delta.exchange");
            } else if (text.includes("unauthorized")) {
                console.log("🔴 ISSUE: UNAUTHORIZED");
                console.log("   Check if you have 'Read' permissions enabled on the API key.");
            }
            console.log("-------------------------------------------");
        }

    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log("\n❌ NETWORK ERROR:", msg);
        fs.writeFileSync('scripts/delta_error.log', "NETWORK_ERROR: " + msg);
    }
}

(async () => {
    const ip = await checkPublicIP();
    await testConnection(ip);
})();
