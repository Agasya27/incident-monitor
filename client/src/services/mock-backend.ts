import type { NormalizedEvent, Severity, ChaosConfig } from '../types/events';
import { contentHash } from '../lib/pipeline';

const SERVICES = ['auth', 'api-gateway', 'database', 'cache', 'payment', 'notification', 'search', 'cdn'];
const SEVERITIES: Severity[] = ['info', 'warning', 'error', 'critical'];
const MESSAGES = [
  'Request timeout after 30s',
  'Connection refused to upstream',
  'Rate limit exceeded for endpoint',
  'Memory usage above 90% threshold',
  'CPU utilization spike detected at 95%',
  'Disk space running low: 8% remaining',
  'SSL certificate expiring in 7 days',
  'Database query slow: execution >500ms',
  'Service health check failed',
  'Authentication token expired',
  'API response time degraded to 2.3s',
  'Cache miss rate increasing: 45%',
  'Payment processing failed: gateway error',
  'Email delivery bounced: invalid recipient',
  'Search index out of sync by 2m',
  'CDN cache purge initiated globally',
  'Load balancer failover triggered',
  'Container restart detected: OOMKilled',
  'Network latency spike: 340ms p99',
  'Deployment rollback initiated: v2.3.1',
  'TLS handshake failure on port 443',
  'Queue backlog growing: 12,500 messages',
  'Replica set election triggered',
  'DNS resolution timeout for service mesh',
];
const SOURCES = ['prometheus', 'grafana', 'datadog', 'cloudwatch', 'pagerduty', 'newrelic'];

let eventCounter = 0;

function randomElement<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function generateId(): string {
  return `evt-${Date.now()}-${++eventCounter}-${Math.random().toString(36).substring(2, 8)}`;
}

function generateSchemaA(): Record<string, unknown> {
  return {
    id: generateId(),
    service: randomElement(SERVICES),
    severity: randomElement(SEVERITIES),
    timestamp: Date.now() + Math.random() * 200 - 100,
    message: randomElement(MESSAGES),
    source: randomElement(SOURCES),
    metadata: {
      host: `server-${Math.floor(Math.random() * 20) + 1}`,
      region: randomElement(['us-east-1', 'us-west-2', 'eu-west-1', 'ap-southeast-1']),
      pod: `pod-${Math.random().toString(36).substring(2, 10)}`,
    },
  };
}

function generateSchemaB(): Record<string, unknown> {
  const levels = ['info', 'info', 'warn', 'error', 'fatal'];
  return {
    event_id: generateId(),
    svc: randomElement(SERVICES),
    level: randomElement(levels),
    ts: Date.now() + Math.random() * 200 - 100,
    msg: randomElement(MESSAGES),
    origin: randomElement(SOURCES),
    extra: {
      host: `server-${Math.floor(Math.random() * 20) + 1}`,
      env: randomElement(['production', 'staging']),
    },
  };
}

function generateSchemaC(): Record<string, unknown> {
  return {
    i: generateId(),
    s: randomElement(SERVICES),
    v: Math.floor(Math.random() * 4),
    t: Date.now() + Math.random() * 200 - 100,
    m: randomElement(MESSAGES),
    src: randomElement(SOURCES),
    meta: {},
  };
}

// Schema D – CloudWatch-style with camelCase keys and descriptive severity
function generateSchemaD(): Record<string, unknown> {
  const cloudSeverities = ['low', 'medium', 'high', 'critical'];
  return {
    eventId: generateId(),
    serviceName: randomElement(SERVICES),
    eventSeverity: randomElement(cloudSeverities),
    eventTime: Date.now() + Math.random() * 200 - 100,
    description: randomElement(MESSAGES),
    eventSource: randomElement(SOURCES),
    additionalData: {
      accountId: `acc-${Math.floor(Math.random() * 1000)}`,
      region: randomElement(['us-east-1', 'us-west-2', 'eu-west-1']),
      resourceArn: `arn:aws:ec2:us-east-1:${Math.floor(Math.random() * 1e12)}:instance/i-${Math.random().toString(36).substring(2, 12)}`,
    },
  };
}

// Schema E – underscore-prefixed keys, ISO timestamp, numeric severity level
function generateSchemaE(): Record<string, unknown> {
  const ts = new Date(Date.now() + Math.random() * 200 - 100);
  return {
    _id: generateId(),
    _service: randomElement(SERVICES),
    _level: Math.floor(Math.random() * 4), // 0=info, 1=warning, 2=error, 3=critical
    _ts: ts.toISOString(),
    _msg: randomElement(MESSAGES),
    _src: randomElement(SOURCES),
    _meta: {
      container: `ctr-${Math.random().toString(36).substring(2, 10)}`,
      namespace: randomElement(['default', 'monitoring', 'production', 'staging']),
    },
  };
}

function generateEvent(chaosConfig: ChaosConfig): unknown {
  const schemaRoll = Math.random();
  let event: Record<string, unknown>;

  if (chaosConfig.enabled && Math.random() < chaosConfig.schemaVariationRate) {
    // Use all 5 schemas
    if (schemaRoll < 0.2) event = generateSchemaA();
    else if (schemaRoll < 0.4) event = generateSchemaB();
    else if (schemaRoll < 0.6) event = generateSchemaC();
    else if (schemaRoll < 0.8) event = generateSchemaD();
    else event = generateSchemaE();
  } else {
    event = generateSchemaA();
  }

  if (chaosConfig.enabled && Math.random() < chaosConfig.corruptionRate) {
    const corruptions = [
      () => { delete event.id; delete event.event_id; delete event.i; delete event.eventId; delete event._id; return event; },
      () => { event.timestamp = 'not-a-number' as unknown; return event; },
      () => 'corrupted-string-payload',
      () => { event.severity = 12345 as unknown; return event; },
      () => null,
      () => { event._ts = 'invalid-iso-date'; return event; },
      () => { event.eventSeverity = {} as unknown; return event; },
    ];
    return randomElement(corruptions)();
  }

  return event;
}

// ── Ping/Pong latency simulation ──────────────────────────────────

export class LatencyTracker {
  private _latency = 0;
  private _pingInterval: number | null = null;
  private _lastPingTime = 0;
  private _jitterMs: number;

  constructor(jitterMs = 50) {
    this._jitterMs = jitterMs;
  }

  start(): void {
    // Simulate ping/pong every 2s
    this._pingInterval = window.setInterval(() => {
      this._lastPingTime = performance.now();
      // Simulate server response time (20–150ms base + jitter)
      const simulatedRtt = 20 + Math.random() * 130 + (Math.random() * this._jitterMs);
      setTimeout(() => {
        this._latency = Math.round(simulatedRtt);
      }, Math.min(simulatedRtt, 200));
    }, 2000);
  }

  stop(): void {
    if (this._pingInterval) {
      clearInterval(this._pingInterval);
      this._pingInterval = null;
    }
  }

  get latency(): number {
    return this._latency;
  }
}

// ── Mock WebSocket Service ────────────────────────────────────────

export class MockWebSocketService {
  private intervalId: number | null = null;
  private chaosConfig: ChaosConfig;
  private onMessage: ((events: unknown[]) => void) | null = null;
  private onDisconnect: (() => void) | null = null;
  private onConnect: (() => void) | null = null;
  private isConnected = false;
  private disconnectTimeoutId: number | null = null;
  private batchSize = 10;
  private intervalMs = 50;
  public latencyTracker: LatencyTracker;

  constructor() {
    this.chaosConfig = {
      duplicateRate: 0.05,
      outOfOrderRate: 0.1,
      corruptionRate: 0.03,
      schemaVariationRate: 0.3,
      disconnectionInterval: 30000,
      enabled: true,
    };
    this.latencyTracker = new LatencyTracker();
  }

  setChaosConfig(config: Partial<ChaosConfig>): void {
    this.chaosConfig = { ...this.chaosConfig, ...config };
  }

  getChaosConfig(): ChaosConfig {
    return { ...this.chaosConfig };
  }

  connect(handlers: {
    onMessage: (events: unknown[]) => void;
    onDisconnect: () => void;
    onConnect: () => void;
  }): void {
    this.onMessage = handlers.onMessage;
    this.onDisconnect = handlers.onDisconnect;
    this.onConnect = handlers.onConnect;

    setTimeout(() => {
      this.isConnected = true;
      this.onConnect?.();
      this.startGenerating();
      this.latencyTracker.start();
      this.scheduleDisconnection();
    }, 300 + Math.random() * 400);
  }

  private startGenerating(): void {
    if (this.intervalId) return;

    this.intervalId = window.setInterval(() => {
      if (!this.isConnected) return;

      const events: unknown[] = [];
      let lastEvent: unknown = null;

      for (let i = 0; i < this.batchSize; i++) {
        const event = generateEvent(this.chaosConfig);
        if (event !== null) {
          events.push(event);
          lastEvent = event;

          if (this.chaosConfig.enabled && Math.random() < this.chaosConfig.duplicateRate && lastEvent && typeof lastEvent === 'object') {
            events.push({ ...(lastEvent as Record<string, unknown>) });
          }
        }
      }

      if (this.chaosConfig.enabled && Math.random() < this.chaosConfig.outOfOrderRate && events.length > 2) {
        const i = Math.floor(Math.random() * events.length);
        const j = Math.floor(Math.random() * events.length);
        [events[i], events[j]] = [events[j], events[i]];
      }

      this.onMessage?.(events);
    }, this.intervalMs);
  }

  private scheduleDisconnection(): void {
    if (!this.chaosConfig.enabled || this.chaosConfig.disconnectionInterval <= 0) return;

    this.disconnectTimeoutId = window.setTimeout(() => {
      if (this.isConnected) {
        this.simulateDisconnect();
      }
    }, this.chaosConfig.disconnectionInterval + Math.random() * 10000);
  }

  private simulateDisconnect(): void {
    this.isConnected = false;
    this.latencyTracker.stop();
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.onDisconnect?.();
  }

  reconnect(): void {
    if (this.isConnected) return;
    setTimeout(() => {
      this.isConnected = true;
      this.onConnect?.();
      this.startGenerating();
      this.latencyTracker.start();
      this.scheduleDisconnection();
    }, 300 + Math.random() * 700);
  }

  disconnect(): void {
    this.isConnected = false;
    this.latencyTracker.stop();
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    if (this.disconnectTimeoutId) {
      clearTimeout(this.disconnectTimeoutId);
      this.disconnectTimeoutId = null;
    }
  }

  getConnectionState(): boolean {
    return this.isConnected;
  }
}

// ── Historical event generation ───────────────────────────────────

export function generateHistoricalEvents(count: number): NormalizedEvent[] {
  const events: NormalizedEvent[] = [];
  const now = Date.now();
  const schemas = ['A', 'B', 'C', 'D', 'E'];

  for (let i = 0; i < count; i++) {
    const timestamp = now - (count - i) * 1000 - Math.random() * 500;
    const ev: NormalizedEvent = {
      id: `hist-${i}-${Math.random().toString(36).substring(2, 8)}`,
      service: randomElement(SERVICES),
      severity: randomElement(SEVERITIES),
      timestamp,
      message: randomElement(MESSAGES),
      source: randomElement(SOURCES),
      metadata: {
        host: `server-${Math.floor(Math.random() * 20) + 1}`,
        region: randomElement(['us-east-1', 'us-west-2', 'eu-west-1', 'ap-southeast-1']),
      },
      receivedAt: timestamp + Math.random() * 100,
      normalized: true,
      originalSchema: randomElement(schemas),
    };
    ev.contentHash = contentHash(ev);
    events.push(ev);
  }

  return events.sort((a, b) => a.timestamp - b.timestamp);
}
