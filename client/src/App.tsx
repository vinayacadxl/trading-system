import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { AppShell } from "@/components/layout/AppShell";
import Dashboard from "@/pages/dashboard";
import BotControl from "@/pages/bot-control";
import TradeHistory from "@/pages/trade-history";
import SettingsPage from "@/pages/settings";
import StrategyTester from "@/pages/strategy-tester";
import LiveDataPage from "@/pages/live-data";

function Router() {
  return (
    <AppShell>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/bot" component={BotControl} />
        <Route path="/history" component={TradeHistory} />
        <Route path="/tester" component={StrategyTester} />
        <Route path="/live" component={LiveDataPage} />
        <Route path="/settings" component={SettingsPage} />
        <Route component={NotFound} />
      </Switch>
    </AppShell>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Router />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
