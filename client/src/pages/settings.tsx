import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Key, Lock, CheckCircle2, AlertCircle, Copy } from "lucide-react";
import { useState, useEffect } from "react";

const API_KEYS_STORAGE_KEY = "delta_api_keys";

function maskKey(key: string) {
  if (!key || key.length < 8) return "••••••••";
  return key.slice(0, 4) + "••••••••" + key.slice(-4);
}

export default function SettingsPage() {
  const { toast } = useToast();
  const [apiKey, setApiKey] = useState("");
  const [secretKey, setSecretKey] = useState("");
  const [savedApiKeyMasked, setSavedApiKeyMasked] = useState("");
  const [isConnected, setIsConnected] = useState(false);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [serverIp, setServerIp] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [editingApiKey, setEditingApiKey] = useState(false);

  // Real Delta status: call setup-status so we know if Delta actually accepts keys (not just "keys exist")
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/debug/setup-status");
        const data = await res.json();
        if (cancelled) return;
        if (data.ok) {
          setIsConnected(true);
          setSetupError(null);
          setSavedApiKeyMasked(data.apiKeyPrefix ? data.apiKeyPrefix + "••••••••" : "From .env");
        } else {
          setIsConnected(false);
          setSetupError(data.deltaErrorFriendly || data.deltaError || data.message || "Connection failed");
          setServerIp(data.serverIp ?? null);
          setSavedApiKeyMasked(data.apiKeyPrefix ? data.apiKeyPrefix + "••••••••" : "Configured in .env");
        }
      } catch {
        if (!cancelled) {
          setIsConnected(false);
          setSetupError("Could not reach server. Run: npm run dev");
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleSave = () => {
    toast({
      title: "Manual Key Entry Disabled",
      description: "API keys are now managed securely via the server's .env file to prevent sync issues.",
      variant: "default",
    });
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <h1 className="text-3xl font-bold text-white tracking-tight">System Settings</h1>

      <Card className="glass-card">
        <CardHeader>
          <div className="flex items-center space-x-2">
            <Key className="w-5 h-5 text-primary" />
            <CardTitle>Exchange API Configuration</CardTitle>
          </div>
          <CardDescription>Server-side API key configuration (.env)</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">

          <div className={`p-4 rounded-lg border flex flex-col gap-2 ${isConnected ? 'bg-profit/10 border-profit/20 text-profit' : 'bg-destructive/10 border-destructive/30 text-destructive'}`}>
            <div className="flex items-center gap-3">
              {isConnected ? <CheckCircle2 className="w-5 h-5" /> : <AlertCircle className="w-5 h-5" />}
              <span className="font-mono text-sm font-medium">
                {isConnected ? 'CONNECTED (Delta API OK)' : 'NOT CONNECTED (Delta rejected keys)'}
              </span>
            </div>
            {!isConnected && setupError && (
              <p className="text-xs text-muted-foreground mt-1 pl-8">{setupError}</p>
            )}
            {!isConnected && serverIp && (
              <div className="mt-3 pl-8 space-y-2">
                <p className="text-xs text-muted-foreground font-medium text-foreground">Whitelist ye IP Delta pe (exactly same):</p>
                <div className="flex items-center gap-2 flex-wrap">
                  <code className="bg-black/40 px-3 py-1.5 rounded font-mono text-foreground text-sm border border-border">{serverIp}</code>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs"
                    onClick={() => {
                      navigator.clipboard.writeText(serverIp ?? "");
                      toast({ title: "IP copied", description: "Delta whitelist me paste karo.", duration: 2000 });
                    }}
                  >
                    <Copy className="w-3 h-3 mr-1" /> Copy IP
                  </Button>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Delta pe IP save karne ke baad <strong>1–2 minute wait karo</strong>, phir neeche &quot;Refresh Connection&quot; dabao. Agar aapne pehle koi aur IP add kiya tha (e.g. 103.x.x.x) aur ab yahan alag IP dikh raha hai, to <strong>yahan wala IP hi</strong> Delta pe add karo — ye server ka actual IP hai.
                </p>
              </div>
            )}
          </div>

          <div className="space-y-2 opacity-60 grayscale-[0.5]">
            <Label htmlFor="apiKey">API Key (Read Only)</Label>
            <div className="relative">
              <Key className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                id="apiKey"
                readOnly
                className="pl-9 font-mono bg-black/20"
                value={savedApiKeyMasked || "Configured in server .env"}
              />
            </div>
          </div>

          <p className="text-xs text-muted-foreground flex items-center">
            <Lock className="w-3 h-3 mr-1" /> API Keys are now strictly loaded from the <strong>.env</strong> file on your computer for maximum security.
          </p>
        </CardContent>
        <CardFooter className="flex justify-end border-t border-border pt-6">
          <Button
            size="sm"
            variant="outline"
            onClick={() => window.location.reload()}
            className="border-primary/50 text-primary hover:bg-primary/10"
          >
            Refresh Connection
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
