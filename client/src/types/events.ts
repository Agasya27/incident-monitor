export type Severity = 'info' | 'warning' | 'error' | 'critical';
export type ConnectionState = 'connected' | 'reconnecting' | 'disconnected' | 'degraded';

// Corruption classification
export type CorruptionType = 'malformed_json' | 'missing_required' | 'type_mismatch' | 'invalid_timestamp' | 'unknown';

export interface CorruptionDetail {
  type: CorruptionType;
  field?: string;
  message: string;
  rawSnippet?: string;
}

export interface NormalizedEvent {
  id: string;
  service: string;
  severity: Severity;
  timestamp: number;
  message: string;
  source: string;
  metadata: Record<string, unknown>;
  receivedAt: number;
  normalized: boolean;
  originalSchema: string;
  contentHash?: string;
}

export type RuleOperator = 'equals' | 'not_equals' | 'contains' | 'greater_than' | 'less_than' | 'matches';

export interface RuleCondition {
  field: string;
  operator: RuleOperator;
  value: string | number;
  negate?: boolean;
}

// AST node types for the rule engine
export type ASTNode =
  | { type: 'AND'; children: ASTNode[] }
  | { type: 'OR'; children: ASTNode[] }
  | { type: 'NOT'; child: ASTNode }
  | { type: 'COMPARE'; field: string; operator: RuleOperator; value: string | number; compiledRegex?: RegExp };

export type AggregationType = 'count' | 'sum' | 'avg';

export interface EscalationChain {
  levels: Severity[];
  cooldownMs: number;
}

export interface Rule {
  id: string;
  name: string;
  enabled: boolean;
  conditions: RuleCondition[];
  logic: 'AND' | 'OR';
  timeWindowSeconds: number;
  threshold: number;
  consecutiveCount: number;
  escalationSeverity: Severity;
  action: string;
  aggregation?: AggregationType;
  aggregationField?: string;
  escalationChain?: EscalationChain;
}

export interface RuleResult {
  ruleId: string;
  ruleName: string;
  triggered: boolean;
  triggeredAt: number;
  matchedEvents: string[];
  severity: Severity;
  action: string;
}

export interface PipelineStats {
  totalReceived: number;
  accepted: number;
  rejected: number;
  duplicates: number;
  reordered: number;
  corrupted: number;
  droppedByGap?: number;
  eventsPerSecond: number;
  corruptionDetails: CorruptionDetail[];
}

export interface ReplaySnapshot {
  timestamp: number;
  events: NormalizedEvent[];
  index: number;
  stateHash: string;
}

export interface AuditEntry {
  id: string;
  timestamp: number;
  action: string;
  details: string;
  category: 'system' | 'rule' | 'connection' | 'user';
}

export interface ConnectionHealth {
  state: ConnectionState;
  reconnectAttempts: number;
  lastConnected: number;
  lastDisconnected: number;
  eventsPerSecond: number;
  droppedEvents: number;
  backoffDelay: number;
  latency: number;
}

export interface ChaosConfig {
  duplicateRate: number;
  outOfOrderRate: number;
  corruptionRate: number;
  schemaVariationRate: number;
  disconnectionInterval: number;
  enabled: boolean;
}

export interface ThroughputDataPoint {
  time: string;
  timestamp: number;
  accepted: number;
  rejected: number;
  duplicates: number;
  total: number;
}

// Observability
export type SeverityTrend = 'rising' | 'falling' | 'stable';

export interface SeverityRateInfo {
  severity: Severity;
  current: number;
  previous: number;
  trend: SeverityTrend;
}

export interface IntegrityWindow {
  windowMs: number;
  accepted: number;
  rejected: number;
  corrupted: number;
  score: number;
}

// Performance profiling
export interface PerformanceMetrics {
  fps: number;
  heapUsedMB: number;
  heapTotalMB: number;
  pipelineLatencyMs: number;
  ruleEvalLatencyMs: number;
  eventsProcessedPerSec: number;
}

// Worker message types
export interface WorkerSetRulesMessage {
  type: 'SET_RULES';
  rules: Rule[];
}

export interface WorkerEvaluateMessage {
  type: 'EVALUATE';
  events: NormalizedEvent[];
}

export interface WorkerResultMessage {
  type: 'RESULTS';
  results: RuleResult[];
}

export interface WorkerResetMessage {
  type: 'RESET';
}

export type WorkerIncoming = WorkerSetRulesMessage | WorkerEvaluateMessage | WorkerResetMessage;
export type WorkerOutgoing = WorkerResultMessage;
