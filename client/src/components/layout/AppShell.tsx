import { Link, useLocation } from "wouter";
import { LayoutDashboard, Settings, Activity, History, Zap, BarChart3, Radio } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePortfolio } from "@/hooks/use-portfolio";
import { useEffect, useState } from "react";

function isIpError(error: string) {
  return error.toLowerCase().includes("ip_not_whitelisted") || error.toLowerCase().includes("ip not whitelisted");
}

function IpWhitelistBanner({ error }: { error: string }) {
  const [myIp, setMyIp] = useState<string | null>(null);

  useEffect(() => {
    if (!isIpError(error)) return;
    fetch("https://api.ipify.org?format=json")
      .then((r) => r.json())
      .then((d: { ip?: string }) => {
        setMyIp(d?.ip ?? null);
      })
      .catch(() => setMyIp(null));
  }, [error]);

  return (
    <div className="mx-6 mt-4 p-4 rounded-lg border border-amber-500/50 bg-amber-500/10 text-amber-200 text-sm space-y-2">
      <div className="font-medium">Delta Exchange: IP not whitelisted</div>
      <p className="text-muted-foreground text-xs">
        Aapka IP Delta Exchange API key ki whitelist me nahi hai. Neeche steps follow karo:
      </p>
      <ol className="list-decimal list-inside text-xs text-muted-foreground space-y-1 ml-0">
        <li>
          <a
            href="https://www.delta.exchange/app/account/manageapikeys"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline hover:no-underline"
          >
            Delta Exchange → API Management
          </a>{" "}
          kholo (login karo).
        </li>
        <li>Jo API key use kar rahe ho uspe click karo → <strong>Edit / Whitelist IP</strong>.</li>
        <li>
          <strong>Ye IP add karo:</strong>{" "}
          {myIp ? (
            <code className="bg-black/30 px-1.5 py-0.5 rounded font-mono text-amber-200">{myIp}</code>
          ) : (
            <span className="text-muted-foreground">loading…</span>
          )}
        </li>
        <li>Save karo, phir yahan page refresh karo.</li>
      </ol>
    </div>
  );
}

const navigation = [
  { name: "Dashboard", href: "/", icon: LayoutDashboard },
  { name: "Bot Control", href: "/bot", icon: Zap },
  { name: "Strategy Tester", href: "/tester", icon: BarChart3 },
  { name: "Trade History", href: "/history", icon: History },
  { name: "Live Data", href: "/live", icon: Radio },
  { name: "Settings", href: "/settings", icon: Settings },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { data: portfolio, loading, error: portfolioError, refresh } = usePortfolio(60_000);
  const systemOnline = !loading && !portfolioError;
  const [syncingKeys, setSyncingKeys] = useState(false);

  // API keys are now handled exclusively on the server via .env
  // Removed localStorage sync to prevent overwriting server keys with old browser data.
  useEffect(() => {
    refresh();
  }, [refresh]);

  const portfolioDisplay =
    loading || !portfolio
      ? "—"
      : `${portfolio.currency === "USD" || portfolio.currency === "USDT" ? "$" : ""}${Number(portfolio.portfolioValue).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <div className="flex h-screen w-full bg-background overflow-hidden">
      {/* Sidebar */}
      <aside className="w-64 border-r border-border bg-sidebar hidden md:flex flex-col">
        <div className="h-16 flex items-center px-6 border-b border-border">
          <Activity className="w-6 h-6 text-primary mr-2" />
          <span className="text-xl font-bold tracking-tighter text-white font-sans">
            DELTA<span className="text-primary">ALGO</span>
          </span>
        </div>

        <nav className="flex-1 px-4 py-6 space-y-2">
          {navigation.map((item) => {
            const isActive = location === item.href;
            return (
              <Link key={item.name} href={item.href}>
                <div
                  className={cn(
                    "flex items-center px-4 py-3 rounded-lg text-sm font-medium transition-all duration-200 cursor-pointer group",
                    isActive
                      ? "bg-sidebar-accent text-primary border border-primary/20 shadow-[0_0_15px_-3px_rgba(249,115,22,0.3)]"
                      : "text-muted-foreground hover:text-white hover:bg-white/5"
                  )}
                >
                  <item.icon
                    className={cn(
                      "w-5 h-5 mr-3 transition-colors",
                      isActive ? "text-primary" : "text-muted-foreground group-hover:text-white"
                    )}
                  />
                  {item.name}
                </div>
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-border">
          <div className="bg-card/50 rounded-lg p-3 border border-border">
            <div className="text-xs text-muted-foreground mb-1">Status</div>
            <div className="flex items-center space-x-2">
              {systemOnline ? (
                <>
                  <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                  <span className="text-sm text-white font-mono">System Online</span>
                </>
              ) : loading ? (
                <>
                  <div className="w-2 h-2 rounded-full bg-muted-foreground" />
                  <span className="text-sm text-muted-foreground font-mono">Checking...</span>
                </>
              ) : (
                <>
                  <div className="w-2 h-2 rounded-full bg-destructive" />
                  <span className="text-sm text-destructive font-mono">System Offline</span>
                </>
              )}
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col h-full relative">
        {/* Header */}
        <header className="h-16 border-b border-border bg-background/50 backdrop-blur-sm flex items-center justify-between px-6 sticky top-0 z-10">
          <div className="flex items-center md:hidden">
            <Activity className="w-6 h-6 text-primary" />
          </div>

          <div className="flex items-center ml-auto space-x-6">
            <div className="hidden md:block">
              <div className="text-xs text-muted-foreground text-right">Portfolio Value</div>
              <div className="text-lg font-mono font-bold text-white">{portfolioDisplay}</div>
            </div>
            <div className="w-px h-8 bg-border hidden md:block" />
            <div className="flex items-center space-x-3">
              <div className="w-8 h-8 rounded-full bg-primary/20 border border-primary/50 flex items-center justify-center text-primary font-bold">
                DA
              </div>
            </div>
          </div>
        </header>

        {/* Page Content */}
        <div className="flex-1 overflow-auto flex flex-col">
          {portfolioError && portfolioError.includes("Backend not running") && (
            <div className="mx-6 mt-4 p-3 rounded-lg border border-amber-500/50 bg-amber-500/10 text-amber-200 text-sm flex items-center gap-2">
              <span>Backend nahi chal raha.</span>
              <span>Terminal me: <code className="bg-black/30 px-1.5 rounded font-mono">npm run dev</code> chalao, phir <code className="bg-black/30 px-1.5 rounded font-mono">http://127.0.0.1:5000</code> kholo.</span>
            </div>
          )}
          {portfolioError && !portfolioError.includes("Backend not running") && (
            isIpError(portfolioError) ? (
              <IpWhitelistBanner error={portfolioError} />
            ) : (
              <div className="mx-6 mt-4 p-4 rounded-lg border border-destructive/50 bg-destructive/10 text-destructive text-sm space-y-3">
                <div><span className="font-medium">Delta Exchange: </span><span>{portfolioError}</span></div>
                <p className="text-xs text-muted-foreground">
                  <Link href="/settings" className="text-primary font-medium underline hover:no-underline">Settings</Link> page pe jao — wahan server ka <strong>exact IP</strong> dikhega; wahi IP Delta pe whitelist karo (exactly same). Delta pe save ke baad <strong>1–2 minute wait</strong> karo, phir yahan &quot;Retry&quot; dabao. API key me Read + Trading dono enable hone chahiye.
                </p>
                <button
                  type="button"
                  disabled={syncingKeys}
                  onClick={async () => {
                    setSyncingKeys(true);
                    try {
                      await refresh();
                    } finally {
                      setSyncingKeys(false);
                    }
                  }}
                  className="px-3 py-1.5 rounded border border-border bg-background text-foreground text-xs font-medium hover:bg-white/10 disabled:opacity-50"
                >
                  {syncingKeys ? "Retrying…" : "Retry"}
                </button>
              </div>
            )
          )}
          <div className="flex-1 p-6 scroll-smooth">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}
