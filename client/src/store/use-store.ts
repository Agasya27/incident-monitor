import { create } from 'zustand';
import type { NormalizedEvent, ConnectionHealth, PipelineStats, RuleResult, Rule, AuditEntry, ChaosConfig, ReplaySnapshot, ThroughputDataPoint, IntegrityWindow, SeverityRateInfo, PerformanceMetrics, Severity, SeverityTrend } from '../types/events';
import { getDefaultRules } from '../lib/rule-engine';
import { djb2Hash } from '../lib/pipeline';

const MAX_EVENTS = 10000;
const MAX_AUDIT_ENTRIES = 5000;
const REPLAY_DURATION = 60000;
const MAX_THROUGHPUT_POINTS = 60;

// ── State hash for determinism proof ──────────────────────────────

export function computeStateHash(events: NormalizedEvent[]): string {
  if (events.length === 0) return '0';
  // Hash from last N events for performance
  const tail = events.slice(-500);
  const str = tail.map(e => `${e.id}:${e.timestamp}:${e.severity}`).join('|');
  return djb2Hash(str);
}

// ── Severity rate-of-change computation ───────────────────────────

function computeSeverityRates(events: NormalizedEvent[]): SeverityRateInfo[] {
  const now = Date.now();
  const severities: Severity[] = ['info', 'warning', 'error', 'critical'];
  const currentWindow = events.filter(e => e.timestamp > now - 30000);
  const previousWindow = events.filter(e => e.timestamp > now - 60000 && e.timestamp <= now - 30000);

  return severities.map(sev => {
    const current = currentWindow.filter(e => e.severity === sev).length;
    const previous = previousWindow.filter(e => e.severity === sev).length;
    let trend: SeverityTrend = 'stable';
    if (current > previous * 1.2) trend = 'rising';
    else if (current < previous * 0.8) trend = 'falling';
    return { severity: sev, current, previous, trend };
  });
}

// ── Integrity window computation ──────────────────────────────────

function computeIntegrityWindow(stats: PipelineStats, windowMs = 30000): IntegrityWindow {
  const total = stats.accepted + stats.rejected + stats.corrupted;
  const score = total > 0 ? stats.accepted / total : 1;
  return {
    windowMs,
    accepted: stats.accepted,
    rejected: stats.rejected,
    corrupted: stats.corrupted,
    score: Math.round(score * 1000) / 1000,
  };
}

interface IncidentStore {
  events: NormalizedEvent[];
  addEvents: (newEvents: NormalizedEvent[]) => void;
  clearEvents: () => void;

  connection: ConnectionHealth;
  updateConnection: (update: Partial<ConnectionHealth>) => void;

  pipelineStats: PipelineStats;
  updatePipelineStats: (stats: PipelineStats) => void;

  rules: Rule[];
  ruleResults: RuleResult[];
  addRule: (rule: Rule) => void;
  updateRule: (id: string, update: Partial<Rule>) => void;
  removeRule: (id: string) => void;
  setRuleResults: (results: RuleResult[]) => void;
  clearRuleResults: () => void;

  replayEvents: NormalizedEvent[];
  replaySnapshots: ReplaySnapshot[];
  isReplaying: boolean;
  replayPaused: boolean;
  replayIndex: number;
  replaySpeed: number;
  addReplayEvent: (event: NormalizedEvent) => void;
  setReplayState: (state: Partial<{
    isReplaying: boolean;
    replayPaused: boolean;
    replayIndex: number;
    replaySpeed: number;
  }>) => void;
  takeSnapshot: () => void;
  restoreSnapshot: (index: number) => NormalizedEvent[];

  auditLog: AuditEntry[];
  addAuditEntry: (entry: Omit<AuditEntry, 'id' | 'timestamp'>) => void;
  clearAuditLog: () => void;

  chaosConfig: ChaosConfig;
  setChaosConfig: (config: Partial<ChaosConfig>) => void;

  isStreaming: boolean;
  setStreaming: (streaming: boolean) => void;

  throughputHistory: ThroughputDataPoint[];
  addThroughputPoint: (point: ThroughputDataPoint) => void;

  // Observability
  integrityWindow: IntegrityWindow;
  severityRates: SeverityRateInfo[];
  performanceMetrics: PerformanceMetrics;
  updateIntegrity: () => void;
  updateSeverityRates: () => void;
  updatePerformanceMetrics: (metrics: Partial<PerformanceMetrics>) => void;

  // State hash for determinism
  stateHash: string;
  updateStateHash: () => void;
}

export const useStore = create<IncidentStore>((set, get) => ({
  events: [],
  addEvents: (newEvents) => set((state) => {
    const combined = [...state.events, ...newEvents];
    const trimmed = combined.length > MAX_EVENTS
      ? combined.slice(combined.length - MAX_EVENTS)
      : combined;
    return { events: trimmed };
  }),
  clearEvents: () => set({ events: [] }),

  connection: {
    state: 'disconnected',
    reconnectAttempts: 0,
    lastConnected: 0,
    lastDisconnected: 0,
    eventsPerSecond: 0,
    droppedEvents: 0,
    backoffDelay: 1000,
    latency: 0,
  },
  updateConnection: (update) => set((state) => ({
    connection: { ...state.connection, ...update },
  })),

  pipelineStats: {
    totalReceived: 0,
    accepted: 0,
    rejected: 0,
    duplicates: 0,
    reordered: 0,
    corrupted: 0,
    droppedByGap: 0,
    eventsPerSecond: 0,
    corruptionDetails: [],
  },
  updatePipelineStats: (stats) => set({ pipelineStats: stats }),

  rules: getDefaultRules(),
  ruleResults: [],
  addRule: (rule) => set((state) => ({
    rules: [...state.rules, rule],
  })),
  updateRule: (id, update) => set((state) => ({
    rules: state.rules.map(r => r.id === id ? { ...r, ...update } : r),
  })),
  removeRule: (id) => set((state) => ({
    rules: state.rules.filter(r => r.id !== id),
  })),
  setRuleResults: (results) => set((state) => ({
    ruleResults: [...results, ...state.ruleResults].slice(0, 100),
  })),
  clearRuleResults: () => set({ ruleResults: [] }),

  replayEvents: [],
  replaySnapshots: [],
  isReplaying: false,
  replayPaused: false,
  replayIndex: 0,
  replaySpeed: 1,
  addReplayEvent: (event) => set((state) => {
    const now = Date.now();
    const cutoff = now - REPLAY_DURATION;
    const filtered = state.replayEvents.filter(e => e.timestamp > cutoff);
    return { replayEvents: [...filtered, event] };
  }),
  setReplayState: (update) => set(() => ({
    ...update,
  })),
  takeSnapshot: () => set((state) => {
    const hash = computeStateHash(state.events);
    const snapshot: ReplaySnapshot = {
      timestamp: Date.now(),
      events: [...state.events],
      index: state.replaySnapshots.length,
      stateHash: hash,
    };
    const snapshots = [...state.replaySnapshots, snapshot].slice(-12);
    return { replaySnapshots: snapshots, stateHash: hash };
  }),
  restoreSnapshot: (index: number) => {
    const state = get();
    const snapshot = state.replaySnapshots[index];
    if (!snapshot) return [];
    set({ events: [...snapshot.events] });
    return snapshot.events;
  },

  auditLog: [],
  addAuditEntry: (entry) => set((state) => ({
    auditLog: [
      {
        ...entry,
        id: `audit-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
        timestamp: Date.now(),
      },
      ...state.auditLog,
    ].slice(0, MAX_AUDIT_ENTRIES),
  })),
  clearAuditLog: () => set({ auditLog: [] }),

  chaosConfig: {
    duplicateRate: 0.05,
    outOfOrderRate: 0.1,
    corruptionRate: 0.03,
    schemaVariationRate: 0.3,
    disconnectionInterval: 30000,
    enabled: true,
  },
  setChaosConfig: (config) => set((state) => ({
    chaosConfig: { ...state.chaosConfig, ...config },
  })),

  isStreaming: false,
  setStreaming: (streaming) => set({ isStreaming: streaming }),

  throughputHistory: [],
  addThroughputPoint: (point) => set((state) => ({
    throughputHistory: [...state.throughputHistory, point].slice(-MAX_THROUGHPUT_POINTS),
  })),

  // Observability
  integrityWindow: { windowMs: 30000, accepted: 0, rejected: 0, corrupted: 0, score: 1 },
  severityRates: [],
  performanceMetrics: {
    fps: 60,
    heapUsedMB: 0,
    heapTotalMB: 0,
    pipelineLatencyMs: 0,
    ruleEvalLatencyMs: 0,
    eventsProcessedPerSec: 0,
  },
  updateIntegrity: () => set((state) => ({
    integrityWindow: computeIntegrityWindow(state.pipelineStats),
  })),
  updateSeverityRates: () => set((state) => ({
    severityRates: computeSeverityRates(state.events),
  })),
  updatePerformanceMetrics: (metrics) => set((state) => ({
    performanceMetrics: { ...state.performanceMetrics, ...metrics },
  })),

  // State hash
  stateHash: '0',
  updateStateHash: () => set((state) => ({
    stateHash: computeStateHash(state.events),
  })),
}));
