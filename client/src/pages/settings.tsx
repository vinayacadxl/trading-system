import { useState, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import { Settings, Key, Server, Zap, Save, RefreshCw, Eye, EyeOff, Copy, Check, ShieldAlert, ExternalLink, Wifi } from "lucide-react";

export default function SettingsPage() {
    const { toast } = useToast();
    const [apiKey, setApiKey] = useState("");
    const [apiSecret, setApiSecret] = useState("");
    const [testnet, setTestnet] = useState(true);
    const [riskPct, setRiskPct] = useState("1.5");
    const [showKey, setShowKey] = useState(false);
    const [showSec, setShowSec] = useState(false);
    const [loading, setLoading] = useState(false);
    const [saved, setSaved] = useState(false);

    // IP Whitelist state
    const [ipInfo, setIpInfo] = useState<{
        serverIp?: string;
        ipWhitelisted?: boolean;
        deltaError?: string;
    } | null>(null);
    const [ipLoading, setIpLoading] = useState(false);
    const [copiedIp, setCopiedIp] = useState<string | null>(null);

    useEffect(() => {
        fetch("/api/settings").then((r) => r.json()).then((d) => {
            if (d?.apiKey) setApiKey(d.apiKey);
            if (d?.apiSecret) setApiSecret(d.apiSecret);
            if (d?.testnet !== undefined) setTestnet(d.testnet);
            if (d?.riskPercent) setRiskPct(String(d.riskPercent));
        }).catch(() => { });

        // Auto-fetch IP info on load
        fetchIpInfo();
    }, []);

    async function fetchIpInfo() {
        setIpLoading(true);
        try {
            const r = await fetch("/api/debug/setup-status");
            const d = await r.json();
            setIpInfo({
                serverIp: d?.serverIp,
                ipWhitelisted: d?.ip_whitelisted,
                deltaError: d?.deltaError,
            });
        } catch {
            setIpInfo({ serverIp: undefined, ipWhitelisted: false });
        }
        setIpLoading(false);
    }

    function copyIp(ip: string) {
        navigator.clipboard.writeText(ip).then(() => {
            setCopiedIp(ip);
            toast({ title: "IP Copied ✅", description: ip });
            setTimeout(() => setCopiedIp(null), 2500);
        });
    }

    async function save() {
        setLoading(true);
        try {
            const r = await fetch("/api/settings", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ apiKey, apiSecret, testnet, riskPercent: parseFloat(riskPct) }),
            });
            if (r.ok) { setSaved(true); toast({ title: "Settings saved ✅" }); setTimeout(() => setSaved(false), 3000); }
            else { toast({ title: "Save failed", variant: "destructive" }); }
        } catch { toast({ title: "Network error", variant: "destructive" }); }
        setLoading(false);
    }

    async function testConnection() {
        try {
            const r = await fetch("/api/delta/balance");
            const d = await r.json();
            if (r.ok && d.success && !d.isFallback) toast({ title: "Connection OK ✅", description: `Live Balance: $${d.portfolioValue}` });
            else if (d.isFallback) toast({ title: "⚠️ IP Not Whitelisted", description: "Connected but balance is estimated. Please whitelist your IP.", variant: "destructive" });
            else toast({ title: "Connection failed", description: d?.error?.message ?? "Check API keys", variant: "destructive" });
            // Refresh IP info after test
            fetchIpInfo();
        } catch { toast({ title: "Network error", variant: "destructive" }); }
    }

    // Parse IPs — serverIp can be IPv4 or IPv6 from error response
    const serverIp = ipInfo?.serverIp;
    // We know from earlier logs both these IPs are needed
    // serverIp from API error is the one that needs to be whitelisted
    const isWhitelisted = ipInfo?.ipWhitelisted === true;

    return (
        <>
            <div className="topbar">
                <div>
                    <div className="topbar-title">Settings</div>
                    <div className="topbar-sub">Configure API keys and bot parameters</div>
                </div>
            </div>

            <div className="page" style={{ maxWidth: 800 }}>

                {/* ── IP Whitelist Card ─────────────────── */}
                <div className="card" style={{
                    border: isWhitelisted
                        ? "1px solid rgba(16,185,129,0.25)"
                        : "1px solid rgba(245,158,11,0.35)",
                    background: isWhitelisted
                        ? "rgba(16,185,129,0.04)"
                        : "rgba(245,158,11,0.04)",
                }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <div style={{
                                width: 32, height: 32, borderRadius: 9,
                                background: isWhitelisted ? "rgba(16,185,129,0.12)" : "rgba(245,158,11,0.12)",
                                display: "flex", alignItems: "center", justifyContent: "center",
                                color: isWhitelisted ? "var(--green)" : "var(--amber)",
                            }}>
                                <ShieldAlert size={15} />
                            </div>
                            <div>
                                <div style={{ fontSize: 13, fontWeight: 700, color: "var(--tx1)" }}>IP Whitelist</div>
                                <div style={{ fontSize: 10, color: "var(--tx3)" }}>
                                    Add these IPs to your Delta Exchange API key
                                </div>
                            </div>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span className={`bd ${isWhitelisted ? "g" : "a"}`}>
                                {isWhitelisted ? "✓ Whitelisted" : "⚠ Not Whitelisted"}
                            </span>
                            <button className="btn btn-dk" onClick={fetchIpInfo} disabled={ipLoading}
                                style={{ padding: "5px 10px", fontSize: 11 }}>
                                <RefreshCw size={11} style={{ animation: ipLoading ? "spin 1s linear infinite" : "none" }} />
                                {ipLoading ? "Checking…" : "Refresh"}
                            </button>
                        </div>
                    </div>

                    {/* Status banner */}
                    {!isWhitelisted && (
                        <div style={{
                            padding: "10px 14px", borderRadius: 10, marginBottom: 14,
                            background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.20)",
                            fontSize: 12, color: "var(--amber)", lineHeight: 1.6,
                        }}>
                            🚨 Your server IP is <strong>not whitelisted</strong> on Delta Exchange. This blocks live balance
                            and order execution. Copy the IP below and add it on{" "}
                            <a href="https://india.delta.exchange" target="_blank" rel="noreferrer"
                                style={{ color: "var(--amber)", textDecoration: "underline", display: "inline-flex", alignItems: "center", gap: 3 }}>
                                india.delta.exchange <ExternalLink size={10} />
                            </a>
                            {" "}→ API Keys → Edit → Whitelist IPs.
                        </div>
                    )}

                    {isWhitelisted && (
                        <div style={{
                            padding: "10px 14px", borderRadius: 10, marginBottom: 14,
                            background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.15)",
                            fontSize: 12, color: "var(--green)",
                        }}>
                            ✅ IP is whitelisted! Live balance and trades are active.
                        </div>
                    )}

                    {/* IP address rows */}
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {serverIp ? (
                            <IpRow ip={serverIp} label="Server IP (from Delta error)" copied={copiedIp === serverIp} onCopy={() => copyIp(serverIp)} />
                        ) : (
                            <div style={{
                                padding: "12px 14px", borderRadius: 10,
                                background: "rgba(0,0,0,0.20)", border: "1px dashed var(--bdr2)",
                                fontSize: 12, color: "var(--tx3)", textAlign: "center",
                            }}>
                                {ipLoading
                                    ? "Fetching IP from Delta Exchange..."
                                    : isWhitelisted
                                        ? "IP is whitelisted — no action needed."
                                        : "Click Refresh or Test Connection to detect your IP address."
                                }
                            </div>
                        )}
                    </div>

                    {/* Instructions */}
                    <div style={{ marginTop: 14, padding: "10px 14px", borderRadius: 10, background: "rgba(0,0,0,0.20)", border: "1px solid var(--bdr)" }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: "var(--tx3)", textTransform: "uppercase", letterSpacing: ".6px", marginBottom: 8 }}>
                            How to whitelist
                        </div>
                        {[
                            "Go to india.delta.exchange → Login",
                            "Click your name → API Keys",
                            "Click Edit on your API key",
                            "Scroll to Whitelisted IPs → Add the IP above",
                            "Save → Wait 1-2 minutes → Click Test Connection",
                        ].map((step, i) => (
                            <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 5 }}>
                                <div style={{
                                    width: 16, height: 16, borderRadius: "50%", flexShrink: 0, marginTop: 1,
                                    background: "var(--indigo-dim)", color: "var(--indigo)",
                                    display: "flex", alignItems: "center", justifyContent: "center",
                                    fontSize: 9, fontWeight: 700,
                                }}>
                                    {i + 1}
                                </div>
                                <span style={{ fontSize: 11, color: "var(--tx2)", lineHeight: 1.5 }}>{step}</span>
                            </div>
                        ))}
                    </div>
                </div>

                {/* ── API Keys ─────────────────────────── */}
                <div className="card">
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 20 }}>
                        <div style={{ width: 32, height: 32, borderRadius: 9, background: "var(--indigo-dim)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--indigo)" }}><Key size={15} /></div>
                        <div>
                            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--tx1)" }}>API Keys</div>
                            <div style={{ fontSize: 10, color: "var(--tx3)" }}>Delta Exchange credentials</div>
                        </div>
                    </div>
                    <div className="form-group" style={{ marginBottom: 14 }}>
                        <label className="form-label">API Key</label>
                        <div style={{ position: "relative" }}>
                            <input type={showKey ? "text" : "password"} className="form-input" value={apiKey}
                                onChange={(e) => setApiKey(e.target.value)} placeholder="Enter API key…" style={{ paddingRight: 40 }} />
                            <button onClick={() => setShowKey(!showKey)}
                                style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "var(--tx3)", padding: 0 }}>
                                {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
                            </button>
                        </div>
                    </div>
                    <div className="form-group" style={{ marginBottom: 14 }}>
                        <label className="form-label">API Secret</label>
                        <div style={{ position: "relative" }}>
                            <input type={showSec ? "text" : "password"} className="form-input" value={apiSecret}
                                onChange={(e) => setApiSecret(e.target.value)} placeholder="Enter API secret…" style={{ paddingRight: 40 }} />
                            <button onClick={() => setShowSec(!showSec)}
                                style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "var(--tx3)", padding: 0 }}>
                                {showSec ? <EyeOff size={14} /> : <Eye size={14} />}
                            </button>
                        </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", borderRadius: 10, background: "rgba(0,0,0,0.20)", border: "1px solid var(--bdr2)", marginBottom: 14 }}>
                        <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--tx1)" }}>Use Testnet</div>
                            <div style={{ fontSize: 11, color: "var(--tx3)" }}>Paper trading — no real funds at risk</div>
                        </div>
                        <button onClick={() => setTestnet(!testnet)} style={{
                            width: 42, height: 24, borderRadius: 99, cursor: "pointer",
                            background: testnet ? "linear-gradient(135deg,var(--indigo),var(--violet))" : "rgba(255,255,255,0.08)",
                            border: `1px solid ${testnet ? "transparent" : "var(--bdr2)"}`,
                            position: "relative", transition: "all .2s",
                            boxShadow: testnet ? "0 2px 10px var(--indigo-glow)" : "none",
                        }}>
                            <div style={{ position: "absolute", top: 3, left: testnet ? 20 : 3, width: 16, height: 16, borderRadius: "50%", background: "#fff", transition: "left .2s", boxShadow: "0 1px 4px rgba(0,0,0,0.4)" }} />
                        </button>
                    </div>
                    <button className="btn btn-dk" onClick={testConnection} style={{ marginBottom: 0 }}>
                        <Wifi size={14} />Test Connection
                    </button>
                </div>

                {/* ── Bot Parameters ────────────────────── */}
                <div className="card">
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 20 }}>
                        <div style={{ width: 32, height: 32, borderRadius: 9, background: "rgba(16,185,129,0.10)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--green)" }}><Zap size={15} /></div>
                        <div>
                            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--tx1)" }}>Bot Parameters</div>
                            <div style={{ fontSize: 10, color: "var(--tx3)" }}>Risk &amp; strategy settings</div>
                        </div>
                    </div>
                    <div className="form-group" style={{ marginBottom: 14 }}>
                        <label className="form-label">Default Risk per Trade (%)</label>
                        <input type="number" className="form-input" value={riskPct}
                            onChange={(e) => setRiskPct(e.target.value)} min={0.1} max={10} step={0.1} />
                    </div>
                </div>

                {/* ── Save ─────────────────────────────── */}
                <div style={{ display: "flex", gap: 12 }}>
                    <button className="btn btn-p" onClick={save} disabled={loading} style={{ flex: 1, justifyContent: "center" }}>
                        <Save size={14} />{loading ? "Saving…" : saved ? "Saved ✅" : "Save Settings"}
                    </button>
                </div>
            </div>
        </>
    );
}

// ── IP Row Component ────────────────────────────────────
function IpRow({ ip, label, copied, onCopy }: { ip: string; label: string; copied: boolean; onCopy: () => void }) {
    return (
        <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "10px 14px", borderRadius: 10,
            background: "rgba(0,0,0,0.25)", border: "1px solid var(--bdr2)",
            gap: 10,
        }}>
            <div>
                <div style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".6px", color: "var(--tx3)", marginBottom: 3 }}>
                    {label}
                </div>
                <div style={{ fontFamily: "var(--mono)", fontSize: 13, fontWeight: 700, color: "var(--tx1)", wordBreak: "break-all" }}>
                    {ip}
                </div>
            </div>
            <button
                onClick={onCopy}
                title="Copy IP"
                style={{
                    flexShrink: 0, width: 34, height: 34, borderRadius: 9, cursor: "pointer",
                    border: `1px solid ${copied ? "rgba(16,185,129,0.40)" : "var(--bdr2)"}`,
                    background: copied ? "rgba(16,185,129,0.12)" : "rgba(255,255,255,0.04)",
                    color: copied ? "var(--green)" : "var(--tx2)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    transition: "all .2s",
                }}
            >
                {copied ? <Check size={13} /> : <Copy size={13} />}
            </button>
        </div>
    );
}
