import { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import { List } from 'react-window';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import {
  Activity, AlertTriangle, ShieldCheck, Database,
  Play, Square, Zap, TrendingUp, TrendingDown, ChevronDown, ChevronUp, Settings2,
  Radio, Timer, ArrowDownUp, RefreshCw, HeartPulse, Minus, Gauge, Cpu, Circle
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ErrorBoundary } from '@/components/error-boundary';
import { useToast } from '@/hooks/use-toast';
import { useStore } from '../store/use-store';
import { useIncidentStream } from '../hooks/use-incident-stream';
import type { NormalizedEvent, Severity, ChaosConfig, SeverityTrend } from '../types/events';

const SEVERITY_COLORS: Record<Severity, string> = {
  info: 'bg-blue-500/8 text-blue-400 border-blue-500/15',
  warning: 'bg-amber-500/8 text-amber-400 border-amber-500/15',
  error: 'bg-orange-500/8 text-orange-400 border-orange-500/15',
  critical: 'bg-red-500/8 text-red-400 border-red-500/15',
};

const SEVERITY_DOT: Record<Severity, string> = {
  info: 'bg-blue-400',
  warning: 'bg-amber-400',
  error: 'bg-orange-400',
  critical: 'bg-red-400',
};

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatTimeAgo(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 1000) return 'just now';
  if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  return `${Math.floor(diff / 3600000)}h ago`;
}

function formatDuration(ms: number): string {
  if (ms <= 0) return '--';
  const sec = Math.floor(ms / 1000);
  const min = Math.floor(sec / 60);
  if (min > 0) return `${min}m ${sec % 60}s`;
  return `${sec}s`;
}

/* ──────────── Severity Breakdown Bar ──────────── */
function SeverityBar({ counts, total }: { counts: Record<Severity, number>; total: number }) {
  if (total === 0) return null;
  const items: { severity: Severity; count: number; pct: number; color: string }[] = [
    { severity: 'critical', count: counts.critical, pct: (counts.critical / total) * 100, color: 'bg-red-500' },
    { severity: 'error', count: counts.error, pct: (counts.error / total) * 100, color: 'bg-orange-500' },
    { severity: 'warning', count: counts.warning, pct: (counts.warning / total) * 100, color: 'bg-amber-500' },
    { severity: 'info', count: counts.info, pct: (counts.info / total) * 100, color: 'bg-blue-500' },
  ];

  return (
    <div className="space-y-2" role="group" aria-label="Severity breakdown">
      <div className="flex h-1 rounded-full overflow-hidden bg-muted/30">
        {items.map(item => item.pct > 0 && (
          <div
            key={item.severity}
            className={`${item.color} bar-fill`}
            style={{ width: `${item.pct}%` }}
            title={`${item.severity}: ${item.count} (${Math.round(item.pct)}%)`}
          />
        ))}
      </div>
      <div className="flex items-center gap-4 flex-wrap">
        {items.map(item => (
          <div key={item.severity} className="flex items-center gap-1.5">
            <div className={`w-1.5 h-1.5 rounded-full ${item.color}`} aria-hidden="true" />
            <span className="text-[11px] text-muted-foreground capitalize">{item.severity}</span>
            <span className="text-[11px] font-medium tabular-nums">{item.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ──────────── Severity Rate-of-Change ──────────── */
const TREND_ICON: Record<SeverityTrend, typeof TrendingUp> = {
  rising: TrendingUp,
  falling: TrendingDown,
  stable: Minus,
};
const TREND_COLOR: Record<SeverityTrend, string> = {
  rising: 'text-red-400',
  falling: 'text-emerald-500',
  stable: 'text-muted-foreground',
};

function SeverityTrends() {
  const severityRates = useStore((s) => s.severityRates);
  if (severityRates.length === 0) return null;
  return (
    <div className="grid grid-cols-4 gap-2" role="group" aria-label="Severity trends">
      {severityRates.map((r) => {
        const TIcon = TREND_ICON[r.trend];
        return (
          <div key={r.severity} className="flex items-center gap-1.5 text-[11px]" aria-label={`${r.severity}: ${r.trend}`}>
            <div className={`w-1.5 h-1.5 rounded-full ${SEVERITY_DOT[r.severity]}`} aria-hidden="true" />
            <span className="capitalize text-muted-foreground">{r.severity}</span>
            <TIcon className={`w-3 h-3 ${TREND_COLOR[r.trend]}`} aria-hidden="true" />
            <span className={`tabular-nums font-medium ${TREND_COLOR[r.trend]}`}>{r.current}</span>
          </div>
        );
      })}
    </div>
  );
}

/* ──────────── Integrity Score ──────────── */
function IntegrityScore() {
  const integrity = useStore((s) => s.integrityWindow);
  const pct = Math.round(integrity.score * 100);
  return (
    <div className="flex items-center gap-3" aria-label={`Data integrity: ${pct}%`}>
      <Gauge className="w-3.5 h-3.5 text-muted-foreground/50" aria-hidden="true" />
      <div className="flex-1">
        <div className="flex justify-between text-[11px] mb-1">
          <span className="text-muted-foreground">Integrity</span>
          <span className={`font-medium tabular-nums ${
            pct >= 90 ? 'text-emerald-400' : pct >= 70 ? 'text-amber-400' : 'text-red-400'
          }`}>{pct}%</span>
        </div>
        <Progress value={pct} className="h-1" />
      </div>
    </div>
  );
}

/* ──────────── Performance Metrics ──────────── */
function PerfMetrics() {
  const perf = useStore((s) => s.performanceMetrics);
  return (
    <div className="grid grid-cols-3 gap-3 text-[11px]" role="group" aria-label="Performance metrics">
      <div>
        <span className="text-muted-foreground block mb-0.5">FPS</span>
        <p className={`font-medium tabular-nums ${perf.fps >= 55 ? 'text-emerald-400' : perf.fps >= 30 ? 'text-amber-400' : 'text-red-400'}`}>{perf.fps}</p>
      </div>
      <div>
        <span className="text-muted-foreground block mb-0.5">Latency</span>
        <p className="font-medium tabular-nums">{perf.pipelineLatencyMs}ms</p>
      </div>
      <div>
        <span className="text-muted-foreground block mb-0.5">Heap</span>
        <p className="font-medium tabular-nums">{perf.heapUsedMB}MB</p>
      </div>
    </div>
  );
}

/* ──────────── Live Feed ──────────── */
function EventRow({ event, style }: { event: NormalizedEvent; style: React.CSSProperties }) {
  return (
    <div
      style={style}
      className="flex items-center gap-2 sm:gap-3 px-3 border-b border-border/40 text-[12px] hover:bg-muted/30 transition-colors"
      data-testid={`row-event-${event.id}`}
      role="row"
    >
      <Circle className={`w-[6px] h-[6px] flex-shrink-0 fill-current ${
        event.severity === 'critical' ? 'text-red-400' :
        event.severity === 'error' ? 'text-orange-400' :
        event.severity === 'warning' ? 'text-amber-400' : 'text-blue-400'
      }`} />
      <span className="text-muted-foreground/50 w-14 sm:w-16 flex-shrink-0 tabular-nums font-mono text-[11px]">
        {formatTime(event.timestamp)}
      </span>
      <Badge variant="secondary" className="text-[10px] px-1.5 py-0 font-mono flex-shrink-0 hidden sm:inline-flex rounded-[3px]">
        {event.service}
      </Badge>
      <span className={`px-1.5 py-0 rounded-[3px] text-[10px] font-medium flex-shrink-0 border ${SEVERITY_COLORS[event.severity]}`}>
        {event.severity}
      </span>
      <span className="truncate text-foreground/70 flex-1 min-w-0">{event.message}</span>
      <span className="text-muted-foreground/30 text-[10px] flex-shrink-0 hidden md:block font-mono">
        {event.source}
      </span>
    </div>
  );
}

function LiveFeedRow({ index, style, events: rowEvents }: { index: number; style: React.CSSProperties; events: NormalizedEvent[] }) {
  const event = rowEvents[index];
  if (!event) return null;
  return <EventRow event={event} style={style} />;
}

function LiveFeed() {
  const events = useStore((s) => s.events);
  const [autoScroll, setAutoScroll] = useState(true);
  const liveRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<any>(null);
  const prevCountRef = useRef(events.length);

  const reversedEvents = useMemo(() => [...events].reverse(), [events]);
  const rowProps = useMemo(() => ({ events: reversedEvents }), [reversedEvents]);

  // Announce new events to screen reader
  useEffect(() => {
    const newCount = events.length - prevCountRef.current;
    if (newCount > 0 && liveRef.current) {
      liveRef.current.textContent = `${newCount} new event${newCount > 1 ? 's' : ''} received`;
    }
    // Auto-scroll to top (newest events) when new events arrive
    if (newCount > 0 && autoScroll && listRef.current) {
      listRef.current.scrollTo(0);
    }
    prevCountRef.current = events.length;
  }, [events.length, autoScroll]);

  // When autoScroll is toggled ON, immediately scroll to top
  useEffect(() => {
    if (autoScroll && listRef.current) {
      listRef.current.scrollTo(0);
    }
  }, [autoScroll]);

  return (
    <div className="flex flex-col h-full" role="region" aria-label="Live incident feed">
      <div ref={liveRef} className="sr-only" aria-live="polite" aria-atomic="true" />
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-border/60">
        <div className="flex items-center gap-2">
          {events.length > 0 && <span className="pulse-live" aria-hidden="true" />}
          <h3 className="text-sm font-semibold">Live Feed</h3>
          <span className="text-xs text-muted-foreground tabular-nums font-medium">
            {events.length.toLocaleString()} events
          </span>
          {events.length > 0 && (
            <span className="rounded bg-emerald-500/10 px-1.5 py-0 text-[10px] font-medium text-emerald-400/90">Live</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Label className="text-[11px] text-muted-foreground hidden sm:block" htmlFor="auto-scroll">Scroll</Label>
          <Switch
            id="auto-scroll"
            checked={autoScroll}
            onCheckedChange={setAutoScroll}
            data-testid="switch-autoscroll"
            aria-label="Toggle auto-scroll"
          />
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden" data-testid="container-live-feed" role="table" aria-label="Live events list">
        {reversedEvents.length > 0 ? (
          <List
            ref={listRef}
            defaultHeight={360}
            rowCount={reversedEvents.length}
            rowHeight={32}
            overscanCount={20}
            className="scrollbar-thin"
            rowComponent={LiveFeedRow}
            rowProps={rowProps as any}
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-4 p-6">
            <div className="rounded-2xl bg-muted/50 p-4">
              <Activity className="w-10 h-10 text-muted-foreground/50" aria-hidden="true" />
            </div>
            <div className="text-center">
              <p className="text-sm font-semibold text-foreground/80">No events yet</p>
              <p className="text-xs text-muted-foreground mt-1">Click <strong className="text-primary">Start stream</strong> to see live incidents</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ──────────── Alerts Panel ──────────── */
function AlertsPanel() {
  const ruleResults = useStore((s) => s.ruleResults);
  const recentAlerts = useMemo(() => ruleResults.slice(0, 20), [ruleResults]);
  const alertLiveRef = useRef<HTMLDivElement>(null);
  const prevAlertCountRef = useRef(ruleResults.length);

  useEffect(() => {
    if (ruleResults.length > prevAlertCountRef.current && alertLiveRef.current) {
      const newest = ruleResults[0];
      if (newest) { alertLiveRef.current.textContent = `Alert: ${newest.ruleName} – ${newest.severity}`; }
    }
    prevAlertCountRef.current = ruleResults.length;
  }, [ruleResults]);

  return (
    <div className="flex flex-col h-full" role="region" aria-label="Active alerts">
      <div ref={alertLiveRef} className="sr-only" aria-live="assertive" aria-atomic="true" />
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border/60">
        <AlertTriangle className="w-4 h-4 text-amber-400" aria-hidden="true" />
        <h3 className="text-sm font-semibold">Alerts</h3>
        {recentAlerts.length > 0 && (
          <Badge variant="destructive" className="text-[10px] px-2 py-0.5 ml-auto tabular-nums rounded-full font-bold">
            {recentAlerts.length}
          </Badge>
        )}
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-1 scrollbar-thin">
        {recentAlerts.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
            <ShieldCheck className="w-6 h-6 opacity-15" aria-hidden="true" />
            <p className="text-[11px] text-muted-foreground">No active alerts</p>
          </div>
        ) : (
          recentAlerts.map((alert, i) => (
            <div
              key={`${alert.ruleId}-${alert.triggeredAt}-${i}`}
              className={`p-2 rounded-[5px] border transition-colors hover:bg-muted/30 ${
                alert.severity === 'critical' ? 'border-red-500/20' :
                alert.severity === 'error' ? 'border-orange-500/15' : 'border-border/60'
              }`}
              data-testid={`alert-${alert.ruleId}`}
              role="alert"
            >
              <div className="flex items-center gap-2 mb-0.5">
                <span className={`px-1.5 py-0 rounded-[3px] text-[10px] font-medium border ${SEVERITY_COLORS[alert.severity]}`}>
                  {alert.severity}
                </span>
                <span className="text-[12px] font-medium truncate">{alert.ruleName}</span>
              </div>
              <p className="text-[10px] text-muted-foreground/50 line-clamp-1">{alert.action}</p>
              <p className="text-[10px] text-muted-foreground/30 mt-0.5 tabular-nums">
                {formatTimeAgo(alert.triggeredAt)}
              </p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/* ──────────── Connection Health Panel ──────────── */
function ConnectionHealthPanel() {
  const connection = useStore((s) => s.connection);
  const pipelineStats = useStore((s) => s.pipelineStats);

  const uptime = connection.lastConnected > 0
    ? Date.now() - connection.lastConnected
    : 0;

  return (
    <div className="flex flex-col h-full" role="region" aria-label="Connection health details">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border/60">
        <HeartPulse className="w-4 h-4 text-emerald-400" aria-hidden="true" />
        <h3 className="text-sm font-semibold">Health</h3>
      </div>
      <div className="p-3 space-y-3 flex-1 text-[11px]">
        <div className="grid grid-cols-2 gap-2">
          {[
            { label: 'state', value: connection.state,
              color: connection.state === 'connected' ? 'text-emerald-400' : connection.state === 'reconnecting' ? 'text-amber-400' : 'text-red-400',
              capitalize: true },
            { label: 'uptime', value: connection.state === 'connected' ? formatDuration(uptime) : '--' },
            { label: 'reconnects', value: String(connection.reconnectAttempts) },
            { label: 'backoff', value: formatDuration(connection.backoffDelay) },
          ].map(item => (
            <div key={item.label} className="p-2 rounded-[5px] bg-muted/20 border border-border/50">
              <span className="text-muted-foreground text-[10px] block mb-0.5">{item.label}</span>
              <p className={`font-medium tabular-nums ${item.capitalize ? item.color : ''} ${item.capitalize ? 'capitalize' : ''}`}>
                {item.value}
              </p>
            </div>
          ))}
        </div>

        <div className="border-t border-border/50 pt-2 space-y-1.5">
          {[
            { label: 'Last connected', value: connection.lastConnected ? formatTime(connection.lastConnected) : '--' },
            { label: 'Last disconnected', value: connection.lastDisconnected ? formatTime(connection.lastDisconnected) : '--' },
            { label: 'Latency (RTT)', value: `${connection.latency}ms`, color: connection.latency > 100 ? 'text-amber-400' : 'text-emerald-400' },
            { label: 'Dropped', value: String(connection.droppedEvents), color: 'text-red-400' },
            { label: 'Reordered', value: pipelineStats.reordered.toLocaleString(), color: 'text-amber-400' },
          ].map(item => (
            <div key={item.label} className="flex justify-between">
              <span className="text-muted-foreground">{item.label}</span>
              <span className={`font-medium tabular-nums ${item.color || ''}`}>{item.value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ──────────── Throughput Chart ──────────── */
function ThroughputChart() {
  const throughputHistory = useStore((s) => s.throughputHistory);

  return (
    <div className="h-full" role="region" aria-label="Event throughput chart">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border/60">
        <TrendingUp className="w-4 h-4 text-primary/80" aria-hidden="true" />
        <h3 className="text-sm font-semibold">Throughput</h3>
        {throughputHistory.length > 0 && (
          <span className="text-[11px] text-muted-foreground ml-auto tabular-nums">
            {throughputHistory[throughputHistory.length - 1]?.total || 0} evt/s
          </span>
        )}
      </div>
      <div className="p-2 sm:p-3 h-[180px] sm:h-[200px]" data-testid="chart-throughput">
        {throughputHistory.length > 1 ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={throughputHistory} margin={{ top: 5, right: 5, left: -15, bottom: 5 }}>
              <defs>
                <linearGradient id="acceptedGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(173, 80%, 40%)" stopOpacity={0.35} />
                  <stop offset="95%" stopColor="hsl(173, 80%, 40%)" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="rejectedGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(0, 72%, 52%)" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="hsl(0, 72%, 52%)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.5} />
              <XAxis
                dataKey="time"
                tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))', fontFamily: 'var(--font-mono)' }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))', fontFamily: 'var(--font-mono)' }}
                tickLine={false}
                axisLine={false}
                width={32}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'hsl(var(--card))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: '10px',
                  fontSize: '12px',
                  fontFamily: 'var(--font-sans)',
                  padding: '10px 14px',
                  boxShadow: '0 10px 40px -10px rgba(0,0,0,0.4)',
                }}
                labelStyle={{ color: 'hsl(var(--muted-foreground))' }}
              />
              <Area
                type="monotone"
                dataKey="accepted"
                stroke="hsl(173, 80%, 45%)"
                fill="url(#acceptedGrad)"
                strokeWidth={2}
                name="Accepted"
                dot={false}
                activeDot={{ r: 4, fill: 'hsl(173, 80%, 45%)' }}
              />
              <Area
                type="monotone"
                dataKey="rejected"
                stroke="hsl(0, 72%, 52%)"
                fill="url(#rejectedGrad)"
                strokeWidth={2}
                name="Rejected"
                dot={false}
                activeDot={{ r: 4, fill: 'hsl(0, 72%, 52%)' }}
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex flex-col items-center justify-center h-full gap-2">
            <div className="rounded-xl bg-muted/40 p-3">
              <TrendingUp className="w-6 h-6 text-muted-foreground/50" aria-hidden="true" />
            </div>
            <p className="text-xs font-medium text-muted-foreground">Collecting data...</p>
            <p className="text-[11px] text-muted-foreground/70">Start stream to see throughput</p>
          </div>
        )}
      </div>
    </div>
  );
}

/* ──────────── Chaos Controls ──────────── */
function ChaosControls({ updateChaosConfig }: { updateChaosConfig: (config: Partial<ChaosConfig>) => void }) {
  const chaosConfig = useStore((s) => s.chaosConfig);
  const [isOpen, setIsOpen] = useState(false);

  const sliders = [
    { label: 'Duplicate Rate', key: 'duplicateRate' as const, max: 50, testId: 'slider-duplicate-rate' },
    { label: 'Out-of-Order Rate', key: 'outOfOrderRate' as const, max: 50, testId: 'slider-ooo-rate' },
    { label: 'Corruption Rate', key: 'corruptionRate' as const, max: 30, testId: 'slider-corruption-rate' },
    { label: 'Schema Variation', key: 'schemaVariationRate' as const, max: 80, testId: 'slider-schema-variation' },
  ];

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleTrigger asChild>
        <Button variant="ghost" className="w-full justify-between px-4 py-3 h-auto hover:bg-muted/30 rounded-xl" data-testid="button-chaos-toggle">
          <div className="flex items-center gap-2">
            <Settings2 className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
            <span className="text-sm font-semibold">Chaos Controls</span>
            <span className={`text-[10px] font-medium px-1.5 py-0 rounded-[3px] border ${
              chaosConfig.enabled ? 'text-primary border-primary/25 bg-primary/8' : 'text-muted-foreground border-border/60'
            }`}>
              {chaosConfig.enabled ? 'ON' : 'OFF'}
            </span>
          </div>
          {isOpen ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground/30" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/30" />}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="p-3 space-y-3 border-t border-border/50">
          <div className="flex items-center justify-between gap-2">
            <Label className="text-[12px] font-medium">Enable Chaos</Label>
            <Switch
              checked={chaosConfig.enabled}
              onCheckedChange={(enabled) => updateChaosConfig({ enabled })}
              data-testid="switch-chaos-enabled"
              aria-label="Toggle chaos mode"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {sliders.map(s => (
              <div key={s.key}>
                <div className="flex justify-between gap-1 mb-1.5">
                  <Label className="text-[11px] text-muted-foreground">{s.label}</Label>
                  <span className="text-[11px] font-mono font-medium tabular-nums">{Math.round(chaosConfig[s.key] * 100)}%</span>
                </div>
                <Slider
                  value={[chaosConfig[s.key] * 100]}
                  max={s.max}
                  step={1}
                  onValueChange={([v]) => updateChaosConfig({ [s.key]: v / 100 })}
                  disabled={!chaosConfig.enabled}
                  data-testid={s.testId}
                  aria-label={s.label}
                />
              </div>
            ))}
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

/* ──────────── Main Dashboard ──────────── */
export default function DashboardPage() {
  const { toast } = useToast();
  const { start, stop, updateChaosConfig } = useIncidentStream();
  const isStreaming = useStore((s) => s.isStreaming);

  const handleStreamToggle = useCallback(() => {
    if (isStreaming) {
      stop();
      toast({ title: 'Stream stopped', description: 'Event pipeline paused. Start again when ready.' });
    } else {
      start();
      toast({ title: 'Stream started', description: 'Live events are now flowing into the dashboard.' });
    }
  }, [isStreaming, start, stop, toast]);
  const connection = useStore((s) => s.connection);
  const pipelineStats = useStore((s) => s.pipelineStats);
  const events = useStore((s) => s.events);
  const ruleResults = useStore((s) => s.ruleResults);

  const integrityPercent = useMemo(() => {
    if (pipelineStats.totalReceived === 0) return 100;
    return Math.round((pipelineStats.accepted / pipelineStats.totalReceived) * 100);
  }, [pipelineStats]);

  const severityCounts = useMemo(() => {
    const counts = { info: 0, warning: 0, error: 0, critical: 0 };
    const recent = events.slice(-500);
    for (const e of recent) counts[e.severity]++;
    return counts;
  }, [events]);

  const totalSeverity = Object.values(severityCounts).reduce((a, b) => a + b, 0);
  const alertCount = ruleResults.filter(r => r.triggered).length;

  return (
    <div className="app-page" role="region" aria-label="Monitoring dashboard">
      <div className="page-container space-y-5 sm:space-y-6">
        {/* ── Hero header with Start/Stop ── */}
        <div className="animate-in flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 pb-2 border-b border-border/50">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-primary/90 mb-1">Live operations</p>
            <h2 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Incident Dashboard</h2>
            <p className="text-sm text-muted-foreground mt-1.5 max-w-xl">
              Real-time event stream, rule-based alerts, and pipeline health · <span className="font-medium text-foreground/80 tabular-nums">{events.length.toLocaleString()}</span> events buffered
            </p>
            {connection.state === 'connected' && (
              <p className="flex items-center gap-1.5 mt-2 text-xs font-medium text-emerald-400/90">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_hsl(142_76%_36%)]" aria-hidden />
                All systems operational
              </p>
            )}
          </div>
          <Button
            onClick={handleStreamToggle}
            size="lg"
            variant={isStreaming ? 'destructive' : 'default'}
            className={`gap-2 shrink-0 rounded-xl px-6 font-semibold shadow-lg transition-all hover:scale-[1.02] ${!isStreaming ? 'btn-cta-primary' : ''}`}
            data-testid="button-stream-toggle"
          >
            {isStreaming ? (
              <>
                <Square className="w-4 h-4" aria-hidden="true" />
                Stop stream
              </>
            ) : (
              <>
                <Play className="w-4 h-4" aria-hidden="true" />
                Start stream
              </>
            )}
          </Button>
        </div>

        {/* ── Metric Cards ── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Events/sec */}
          <Card className="metric-card animate-in animate-in-delay-1 p-5" data-testid="card-events-sec">
            <div className="flex items-start justify-between">
              <div className="rounded-xl bg-primary/15 p-2.5">
                <Zap className="w-5 h-5 text-primary" aria-hidden="true" />
              </div>
            </div>
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mt-3">Events / sec</p>
            <p className="text-3xl font-bold tabular-nums leading-none mt-1 text-foreground" data-testid="card-events-sec-value">
              {connection.eventsPerSecond}
            </p>
            <p className="text-xs text-muted-foreground mt-2 tabular-nums">{pipelineStats.totalReceived.toLocaleString()} total received</p>
          </Card>

          {/* Alert count */}
          <Card className="metric-card animate-in animate-in-delay-2 p-5" data-testid="card-active-alerts">
            <div className="flex items-start justify-between">
              <div className="rounded-xl bg-amber-500/15 p-2.5">
                <AlertTriangle className="w-5 h-5 text-amber-400" aria-hidden="true" />
              </div>
              {alertCount > 0 && (
                <Badge variant="destructive" className="text-[10px] h-5 min-w-[1.25rem] rounded-full px-1.5 font-bold">
                  {alertCount}
                </Badge>
              )}
            </div>
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mt-3">Active alerts</p>
            <p className="text-3xl font-bold tabular-nums leading-none mt-1" data-testid="card-active-alerts-value">{alertCount}</p>
            <p className="text-xs text-muted-foreground mt-2 tabular-nums">{severityCounts.critical} critical</p>
          </Card>

          {/* Pipeline health */}
          <Card className="metric-card animate-in animate-in-delay-3 p-5" data-testid="card-pipeline-health">
            <div className="flex items-start justify-between">
              <div className={`rounded-xl p-2.5 ${
                integrityPercent > 90 ? 'bg-emerald-500/15' : integrityPercent > 70 ? 'bg-amber-500/15' : 'bg-red-500/15'
              }`}>
                <ShieldCheck className={`w-5 h-5 ${
                  integrityPercent > 90 ? 'text-emerald-400' : integrityPercent > 70 ? 'text-amber-400' : 'text-red-400'
                }`} aria-hidden="true" />
              </div>
            </div>
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mt-3">Pipeline health</p>
            <p className={`text-3xl font-bold tabular-nums leading-none mt-1 ${
              integrityPercent > 90 ? 'text-emerald-400' : integrityPercent > 70 ? 'text-amber-400' : 'text-red-400'
            }`} data-testid="card-pipeline-health-value">{integrityPercent}%</p>
            <p className="text-xs text-muted-foreground mt-2 tabular-nums">{pipelineStats.rejected} rejected</p>
          </Card>

          {/* Buffer */}
          <Card className="metric-card animate-in animate-in-delay-4 p-5" data-testid="card-live-events">
            <div className="flex items-start justify-between">
              <div className="rounded-xl bg-muted p-2.5">
                <Database className="w-5 h-5 text-muted-foreground" aria-hidden="true" />
              </div>
            </div>
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mt-3">Event buffer</p>
            <p className="text-3xl font-bold tabular-nums leading-none mt-1 text-foreground" data-testid="card-live-events-value">{events.length.toLocaleString()}</p>
            <p className="text-xs text-muted-foreground mt-2">cap: 10,000</p>
          </Card>
        </div>

        {/* ── Severity + Integrity + Perf ── */}
        <Card className="panel-section animate-in animate-in-delay-5 p-4 space-y-3">
          <SeverityBar counts={severityCounts} total={totalSeverity} />
          <SeverityTrends />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 border-t border-border/50 pt-3">
            <IntegrityScore />
            <PerfMetrics />
          </div>
        </Card>

        {/* ── Main Panels: Live Feed + Alerts/Health ── */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
          <div className="lg:col-span-8 h-[360px] sm:h-[400px] lg:h-[420px] animate-in animate-in-delay-6">
            <Card className="panel-section h-full overflow-hidden flex flex-col">
              <ErrorBoundary section="Live Feed">
                <LiveFeed />
              </ErrorBoundary>
            </Card>
          </div>

          <div className="lg:col-span-4 h-[360px] sm:h-[400px] lg:h-[420px] animate-in animate-in-delay-6">
            <Card className="panel-section h-full overflow-hidden flex flex-col">
              <Tabs defaultValue="alerts" className="flex flex-col h-full">
                <TabsList className="mx-3 mt-3 h-9 shrink-0 rounded-lg p-1">
                  <TabsTrigger value="alerts" className="text-xs font-medium gap-1.5 rounded-md">
                    <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" />
                    Alerts
                  </TabsTrigger>
                  <TabsTrigger value="health" className="text-xs font-medium gap-1.5 rounded-md">
                    <HeartPulse className="w-3.5 h-3.5" aria-hidden="true" />
                    Health
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="alerts" className="flex-1 min-h-0 mt-0">
                  <ErrorBoundary section="Alerts">
                    <AlertsPanel />
                  </ErrorBoundary>
                </TabsContent>
                <TabsContent value="health" className="flex-1 min-h-0 mt-0">
                  <ErrorBoundary section="Connection Health">
                    <ConnectionHealthPanel />
                  </ErrorBoundary>
                </TabsContent>
              </Tabs>
            </Card>
          </div>
        </div>

        {/* ── Throughput Chart ── */}
        <Card className="panel-section animate-in animate-in-delay-7">
          <ErrorBoundary section="Throughput Chart">
            <ThroughputChart />
          </ErrorBoundary>
        </Card>

        {/* ── Chaos Controls ── */}
        <Card className="panel-section animate-in animate-in-delay-8">
          <ChaosControls updateChaosConfig={updateChaosConfig} />
        </Card>
      </div>
    </div>
  );
}
