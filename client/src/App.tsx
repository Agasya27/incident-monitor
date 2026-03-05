import { Switch, Route, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { ThemeProvider } from "@/components/theme-provider";
import { ErrorBoundary } from "@/components/error-boundary";
import { useStore } from "@/store/use-store";
import { Database } from "lucide-react";
import DashboardPage from "@/pages/dashboard";
import RulesPage from "@/pages/rules";
import HistoryPage from "@/pages/history";
import ReplayPage from "@/pages/replay-page";
import AuditPage from "@/pages/audit";
import ArchitecturePage from "@/pages/architecture";
import NotFound from "@/pages/not-found";
import { useMemo } from "react";

const PAGE_PATHS: Record<string, string> = {
  '/': 'dashboard',
  '/rules': 'rules',
  '/history': 'history',
  '/replay': 'replay',
  '/audit': 'audit',
  '/architecture': 'arch',
};

function Router() {
  return (
    <Switch>
      <Route path="/" component={DashboardPage} />
      <Route path="/rules" component={RulesPage} />
      <Route path="/history" component={HistoryPage} />
      <Route path="/replay" component={ReplayPage} />
      <Route path="/audit" component={AuditPage} />
      <Route path="/architecture" component={ArchitecturePage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function StatusBar() {
  const [location] = useLocation();
  const connection = useStore((s) => s.connection);
  const pipelineStats = useStore((s) => s.pipelineStats);
  const isStreaming = useStore((s) => s.isStreaming);

  const integrityPercent = useMemo(() => {
    if (pipelineStats.totalReceived === 0) return 100;
    return Math.round((pipelineStats.accepted / pipelineStats.totalReceived) * 100);
  }, [pipelineStats]);

  const pagePath = PAGE_PATHS[location] || '404';

  return (
    <header
      className={`flex h-14 flex-shrink-0 items-center gap-4 border-b bg-background/90 px-4 backdrop-blur-xl transition-shadow ${isStreaming ? 'header-live border-border/60' : 'border-border/60'}`}
      role="banner"
    >
      <SidebarTrigger
        data-testid="button-sidebar-toggle"
        aria-label="Toggle sidebar navigation"
        className="h-9 w-9 rounded-lg text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
      />

      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold tracking-tight text-foreground capitalize">{pagePath}</span>
        {isStreaming && (
          <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-400 ring-1 ring-emerald-500/30">
            Live
          </span>
        )}
      </div>

      <div className="ml-auto flex items-center gap-3 text-xs">
        {isStreaming && (
          <div
            className="flex items-center gap-2 rounded-full border border-primary/25 bg-primary/12 px-3 py-1.5"
            aria-label="Live event throughput"
          >
            <span className="pulse-live" aria-hidden="true" />
            <span className="tabular-nums font-bold text-primary">{connection.eventsPerSecond}</span>
            <span className="text-muted-foreground">evt/s</span>
          </div>
        )}

        <div
          className="flex items-center gap-2 rounded-full border border-border/60 bg-muted/30 px-3 py-1.5"
          aria-label={`Connection: ${connection.state}`}
        >
          <div
            className={`h-2 w-2 rounded-full ${
              connection.state === 'connected'
                ? 'bg-emerald-500 shadow-[0_0_8px_hsl(142_76%_36%)]'
                : connection.state === 'reconnecting' || connection.state === 'degraded'
                  ? 'bg-amber-500 animate-pulse'
                  : 'bg-red-500'
            }`}
          />
          <span className="font-medium capitalize text-foreground/90">{connection.state}</span>
        </div>

        <div
          className="flex items-center gap-2 rounded-full border border-border/60 bg-muted/30 px-3 py-1.5"
          data-testid="badge-integrity"
        >
          <Database className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
          <span
            className={`tabular-nums font-semibold ${
              integrityPercent > 90
                ? 'text-emerald-400'
                : integrityPercent > 70
                  ? 'text-amber-400'
                  : 'text-red-400'
            }`}
          >
            {integrityPercent}%
          </span>
        </div>
      </div>
    </header>
  );
}

const sidebarStyle = {
  "--sidebar-width": "15rem",
  "--sidebar-width-icon": "3rem",
};

function AppFooter() {
  return (
    <footer
      className="flex flex-shrink-0 items-center justify-center gap-2 border-t border-border/40 bg-background/50 px-4 py-2.5 text-[11px] text-muted-foreground backdrop-blur-sm"
      role="contentinfo"
    >
      <span className="font-semibold text-foreground/60">Incident Monitor</span>
      <span aria-hidden="true">·</span>
      <span>Crafted for reliability</span>
      <span aria-hidden="true">·</span>
      <span className="font-mono text-[10px] opacity-75">React, TypeScript, Vite, Zustand</span>
    </footer>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <ThemeProvider>
          <a href="#main-content" className="skip-nav">
            Skip to main content
          </a>
          <SidebarProvider style={sidebarStyle as React.CSSProperties}>
            <div className="app-shell flex h-screen w-full overflow-hidden">
              <AppSidebar />
              <div className="flex flex-col flex-1 min-w-0">
                <StatusBar />
                <main id="main-content" className="flex-1 overflow-hidden" role="main" aria-label="Main content area">
                  <ErrorBoundary section="Main Content">
                    <Router />
                  </ErrorBoundary>
                </main>
                <AppFooter />
              </div>
            </div>
          </SidebarProvider>
          <Toaster />
        </ThemeProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
