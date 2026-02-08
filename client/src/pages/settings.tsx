import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Key, Lock, CheckCircle2, AlertCircle } from "lucide-react";
import { useState } from "react";

export default function SettingsPage() {
  const { toast } = useToast();
  const [isConnected, setIsConnected] = useState(false);

  const handleSave = () => {
    // Fake connection loading
    setTimeout(() => {
      setIsConnected(true);
      toast({
        title: "API Keys Saved",
        description: "Successfully connected to Delta Exchange API.",
        className: "border-profit text-profit",
      });
    }, 1000);
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
          <CardDescription>Securely store your Delta Exchange keys.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          
          <div className={`p-4 rounded-lg border flex items-center gap-3 ${isConnected ? 'bg-profit/10 border-profit/20 text-profit' : 'bg-secondary border-border text-muted-foreground'}`}>
            {isConnected ? <CheckCircle2 className="w-5 h-5" /> : <AlertCircle className="w-5 h-5" />}
            <span className="font-mono text-sm">
              Status: {isConnected ? 'CONNECTED' : 'NOT CONNECTED'}
            </span>
          </div>

          <div className="space-y-2">
            <Label htmlFor="apiKey">API Key</Label>
            <div className="relative">
              <Key className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input id="apiKey" placeholder="Enter Delta API Key" className="pl-9 font-mono bg-black/20" />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="secretKey">Secret Key</Label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input id="secretKey" type="password" placeholder="Enter Secret Key" className="pl-9 font-mono bg-black/20" />
            </div>
          </div>

          <p className="text-xs text-muted-foreground flex items-center">
            <Lock className="w-3 h-3 mr-1" /> Keys are stored locally and encrypted.
          </p>
        </CardContent>
        <CardFooter className="flex justify-end border-t border-border pt-6">
          <Button onClick={handleSave} className="bg-primary hover:bg-primary/90 text-white shadow-lg shadow-primary/20">
            Save & Connect
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
