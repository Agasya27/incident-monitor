import { z } from 'zod';
import type { NormalizedEvent, Severity, PipelineStats, CorruptionDetail, CorruptionType } from '../types/events';
import { sanitizeMetadata, limitString } from './sanitizer';

// ── Zod Schemas for 5 event formats ───────────────────────────────

const baseEventSchema = z.object({
  id: z.string().optional(),
  timestamp: z.number().optional(),
}).passthrough();

// Schema A – canonical format
const schemaA = z.object({
  id: z.string(),
  service: z.string(),
  severity: z.enum(['info', 'warning', 'error', 'critical']),
  timestamp: z.number(),
  message: z.string(),
  source: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

// Schema B – abbreviated keys, text severity
const schemaB = z.object({
  event_id: z.string(),
  svc: z.string(),
  level: z.enum(['debug', 'info', 'warn', 'error', 'fatal']),
  ts: z.number(),
  msg: z.string(),
  origin: z.string().optional(),
  extra: z.record(z.unknown()).optional(),
});

// Schema C – ultra-short keys, numeric severity
const schemaC = z.object({
  i: z.string(),
  s: z.string(),
  v: z.number(),
  t: z.number(),
  m: z.string(),
  src: z.string().optional(),
  meta: z.record(z.unknown()).optional(),
});

// Schema D – CloudWatch-style (camelCase, descriptive severity)
const schemaD = z.object({
  eventId: z.string(),
  serviceName: z.string(),
  eventSeverity: z.enum(['low', 'medium', 'high', 'critical']),
  eventTime: z.number(),
  description: z.string(),
  eventSource: z.string().optional(),
  additionalData: z.record(z.unknown()).optional(),
});

// Schema E – underscore-prefixed, ISO timestamp, numeric level
const schemaE = z.object({
  _id: z.string(),
  _service: z.string(),
  _level: z.number().int().min(0).max(3),
  _ts: z.string(), // ISO 8601 date string
  _msg: z.string(),
  _src: z.string().optional(),
  _meta: z.record(z.unknown()).optional(),
});

// ── Severity maps ─────────────────────────────────────────────────

const severityMapB: Record<string, Severity> = {
  debug: 'info',
  info: 'info',
  warn: 'warning',
  error: 'error',
  fatal: 'critical',
};

const severityMapC: Severity[] = ['info', 'warning', 'error', 'critical'];

const severityMapD: Record<string, Severity> = {
  low: 'info',
  medium: 'warning',
  high: 'error',
  critical: 'critical',
};

const severityMapE: Severity[] = ['info', 'warning', 'error', 'critical'];

// ── Content hash (djb2) ──────────────────────────────────────────

export function djb2Hash(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) & 0xffffffff;
  }
  return (hash >>> 0).toString(36);
}

export function contentHash(event: NormalizedEvent): string {
  return djb2Hash(`${event.service}|${event.severity}|${event.message}|${event.timestamp}`);
}

// ── Corruption classification ─────────────────────────────────────

function classifyError(data: unknown): CorruptionDetail {
  if (data === null || data === undefined) {
    return { type: 'malformed_json', message: 'Null or undefined payload' };
  }
  if (typeof data !== 'object') {
    return { type: 'malformed_json', message: `Expected object, received ${typeof data}`, rawSnippet: String(data).slice(0, 100) };
  }
  const obj = data as Record<string, unknown>;

  // Check for missing required fields across all known schemas
  const hasAnyId = obj.id || obj.event_id || obj.i || obj.eventId || obj._id;
  if (!hasAnyId) {
    return { type: 'missing_required', field: 'id', message: 'No recognizable ID field found' };
  }

  // Check timestamp validity
  const ts = obj.timestamp ?? obj.ts ?? obj.t ?? obj.eventTime;
  const tsStr = obj._ts;
  if (ts !== undefined && typeof ts !== 'number') {
    return { type: 'type_mismatch', field: 'timestamp', message: `Timestamp must be a number, got ${typeof ts}` };
  }
  if (typeof ts === 'number' && (ts < 0 || ts > 1e15)) {
    return { type: 'invalid_timestamp', field: 'timestamp', message: `Timestamp ${ts} is out of valid range` };
  }
  if (tsStr !== undefined && typeof tsStr === 'string') {
    const parsed = Date.parse(tsStr);
    if (isNaN(parsed)) {
      return { type: 'invalid_timestamp', field: '_ts', message: `Invalid ISO timestamp: ${tsStr}` };
    }
  }

  // Check for type mismatches in severity
  const sev = obj.severity ?? obj.level ?? obj.eventSeverity;
  const sevNum = obj.v ?? obj._level;
  if (sev !== undefined && typeof sev !== 'string') {
    return { type: 'type_mismatch', field: 'severity', message: `Severity must be a string, got ${typeof sev}` };
  }
  if (sevNum !== undefined && typeof sevNum !== 'number') {
    return { type: 'type_mismatch', field: 'severity_level', message: `Numeric severity must be a number, got ${typeof sevNum}` };
  }

  return { type: 'unknown', message: 'Payload does not match any known schema' };
}

// ── Validation ────────────────────────────────────────────────────

export function validatePayload(data: unknown): { valid: boolean; data?: Record<string, unknown>; error?: string; corruption?: CorruptionDetail } {
  if (data === null || data === undefined) {
    return { valid: false, error: 'null payload', corruption: { type: 'malformed_json', message: 'Null payload' } };
  }
  if (typeof data !== 'object') {
    return { valid: false, error: 'non-object payload', corruption: { type: 'malformed_json', message: `Non-object: ${typeof data}` } };
  }
  const result = baseEventSchema.safeParse(data);
  if (!result.success) {
    return { valid: false, error: result.error.message, corruption: classifyError(data) };
  }
  return { valid: true, data: result.data as Record<string, unknown> };
}

// ── Normalization (5 schemas) ─────────────────────────────────────

export function normalizeEvent(data: Record<string, unknown>): { event: NormalizedEvent | null; corruption?: CorruptionDetail } {
  const now = Date.now();

  const resultA = schemaA.safeParse(data);
  if (resultA.success) {
    const ev: NormalizedEvent = {
      id: resultA.data.id,
      service: limitString(resultA.data.service, 200),
      severity: resultA.data.severity,
      timestamp: resultA.data.timestamp,
      message: limitString(resultA.data.message, 1000),
      source: limitString(resultA.data.source || 'unknown', 200),
      metadata: sanitizeMetadata(resultA.data.metadata || {}),
      receivedAt: now,
      normalized: true,
      originalSchema: 'A',
    };
    ev.contentHash = contentHash(ev);
    return { event: ev };
  }

  const resultB = schemaB.safeParse(data);
  if (resultB.success) {
    const ev: NormalizedEvent = {
      id: resultB.data.event_id,
      service: limitString(resultB.data.svc, 200),
      severity: severityMapB[resultB.data.level] || 'info',
      timestamp: resultB.data.ts,
      message: limitString(resultB.data.msg, 1000),
      source: limitString(resultB.data.origin || 'unknown', 200),
      metadata: sanitizeMetadata(resultB.data.extra || {}),
      receivedAt: now,
      normalized: true,
      originalSchema: 'B',
    };
    ev.contentHash = contentHash(ev);
    return { event: ev };
  }

  const resultC = schemaC.safeParse(data);
  if (resultC.success) {
    const ev: NormalizedEvent = {
      id: resultC.data.i,
      service: limitString(resultC.data.s, 200),
      severity: severityMapC[resultC.data.v] || 'info',
      timestamp: resultC.data.t,
      message: limitString(resultC.data.m, 1000),
      source: limitString(resultC.data.src || 'unknown', 200),
      metadata: sanitizeMetadata(resultC.data.meta || {}),
      receivedAt: now,
      normalized: true,
      originalSchema: 'C',
    };
    ev.contentHash = contentHash(ev);
    return { event: ev };
  }

  const resultD = schemaD.safeParse(data);
  if (resultD.success) {
    const ev: NormalizedEvent = {
      id: resultD.data.eventId,
      service: limitString(resultD.data.serviceName, 200),
      severity: severityMapD[resultD.data.eventSeverity] || 'info',
      timestamp: resultD.data.eventTime,
      message: limitString(resultD.data.description, 1000),
      source: limitString(resultD.data.eventSource || 'unknown', 200),
      metadata: sanitizeMetadata(resultD.data.additionalData || {}),
      receivedAt: now,
      normalized: true,
      originalSchema: 'D',
    };
    ev.contentHash = contentHash(ev);
    return { event: ev };
  }

  const resultE = schemaE.safeParse(data);
  if (resultE.success) {
    const parsedTs = Date.parse(resultE.data._ts);
    if (isNaN(parsedTs)) {
      return { event: null, corruption: { type: 'invalid_timestamp', field: '_ts', message: `Invalid ISO timestamp: ${resultE.data._ts}` } };
    }
    const ev: NormalizedEvent = {
      id: resultE.data._id,
      service: limitString(resultE.data._service, 200),
      severity: severityMapE[resultE.data._level] || 'info',
      timestamp: parsedTs,
      message: limitString(resultE.data._msg, 1000),
      source: limitString(resultE.data._src || 'unknown', 200),
      metadata: sanitizeMetadata(resultE.data._meta || {}),
      receivedAt: now,
      normalized: true,
      originalSchema: 'E',
    };
    ev.contentHash = contentHash(ev);
    return { event: ev };
  }

  return { event: null, corruption: classifyError(data) };
}

// ── Deduplicator (ID + content hash) ─────────────────────────────

export class EventDeduplicator {
  private seenById: Set<string>;
  private seenByContent: Set<string>;
  private maxSize: number;

  constructor(maxSize = 10000) {
    this.seenById = new Set();
    this.seenByContent = new Set();
    this.maxSize = maxSize;
  }

  isDuplicate(event: NormalizedEvent): boolean {
    // Primary: ID + timestamp key
    const idKey = `${event.id}:${event.timestamp}`;
    if (this.seenById.has(idKey)) return true;

    // Secondary: content hash (catches duplicates with different IDs but same data)
    if (event.contentHash && this.seenByContent.has(event.contentHash)) return true;

    this.seenById.add(idKey);
    if (event.contentHash) this.seenByContent.add(event.contentHash);

    // Evict old entries
    this._evict(this.seenById);
    this._evict(this.seenByContent);
    return false;
  }

  private _evict(set: Set<string>): void {
    if (set.size > this.maxSize) {
      const iterator = set.values();
      const toDelete = set.size - this.maxSize + 1000;
      for (let i = 0; i < toDelete; i++) {
        const val = iterator.next().value;
        if (val) set.delete(val);
      }
    }
  }

  reset(): void {
    this.seenById.clear();
    this.seenByContent.clear();
  }
}

// ── Reorder Buffer (configurable gap tolerance) ───────────────────

export class ReorderBuffer {
  private buffer: NormalizedEvent[];
  private windowMs: number;
  private gapToleranceMs: number;
  private lastFlush: number;
  private droppedInLastFlush: number;

  constructor(windowMs = 500, gapToleranceMs = 2000) {
    this.buffer = [];
    this.windowMs = windowMs;
    this.gapToleranceMs = gapToleranceMs;
    this.lastFlush = Date.now();
    this.droppedInLastFlush = 0;
  }

  setGapTolerance(ms: number): void {
    this.gapToleranceMs = Math.max(0, Math.min(ms, 30000));
  }

  setWindowMs(ms: number): void {
    this.windowMs = Math.max(50, Math.min(ms, 5000));
  }

  add(event: NormalizedEvent): void {
    this.buffer.push(event);
  }

  flush(): NormalizedEvent[] {
    const now = Date.now();
    if (now - this.lastFlush < this.windowMs && this.buffer.length < 100) return [];
    this.lastFlush = now;

    // Filter out events that exceed gap tolerance (too old)
    const cutoff = now - this.gapToleranceMs;
    const valid = this.buffer.filter(e => e.timestamp >= cutoff || e.receivedAt >= cutoff);
    const dropped = this.buffer.length - valid.length;
    this.droppedInLastFlush = dropped;

    const sorted = valid.sort((a, b) => a.timestamp - b.timestamp);
    this.buffer = [];
    return sorted;
  }

  forceFlush(): NormalizedEvent[] {
    const sorted = [...this.buffer].sort((a, b) => a.timestamp - b.timestamp);
    this.buffer = [];
    this.lastFlush = Date.now();
    this.droppedInLastFlush = 0;
    return sorted;
  }

  consumeDroppedInLastFlush(): number {
    const dropped = this.droppedInLastFlush;
    this.droppedInLastFlush = 0;
    return dropped;
  }

  get size(): number {
    return this.buffer.length;
  }
}

// ── Event Pipeline ────────────────────────────────────────────────

export class EventPipeline {
  private deduplicator: EventDeduplicator;
  private reorderBuffer: ReorderBuffer;
  private stats: PipelineStats;
  private _lastCorruptions: CorruptionDetail[] = [];

  constructor(windowMs = 500, gapToleranceMs = 2000) {
    this.deduplicator = new EventDeduplicator();
    this.reorderBuffer = new ReorderBuffer(windowMs, gapToleranceMs);
    this.stats = {
      totalReceived: 0,
      accepted: 0,
      rejected: 0,
      duplicates: 0,
      reordered: 0,
      corrupted: 0,
      droppedByGap: 0,
      eventsPerSecond: 0,
      corruptionDetails: [],
    };
  }

  processRaw(rawEvents: unknown[]): { events: NormalizedEvent[]; corruptions: CorruptionDetail[] } {
    const startTime = performance.now();
    const batchCorruptions: CorruptionDetail[] = [];

    for (const raw of rawEvents) {
      this.stats.totalReceived++;

      const validation = validatePayload(raw);
      if (!validation.valid || !validation.data) {
        this.stats.corrupted++;
        this.stats.rejected++;
        if (validation.corruption) {
          batchCorruptions.push(validation.corruption);
          this.stats.corruptionDetails.push(validation.corruption);
          // Keep corruption details bounded
          if (this.stats.corruptionDetails.length > 500) {
            this.stats.corruptionDetails = this.stats.corruptionDetails.slice(-250);
          }
        }
        continue;
      }

      const { event: normalized, corruption } = normalizeEvent(validation.data);
      if (!normalized) {
        this.stats.rejected++;
        if (corruption) {
          batchCorruptions.push(corruption);
          this.stats.corruptionDetails.push(corruption);
        }
        continue;
      }

      if (this.deduplicator.isDuplicate(normalized)) {
        this.stats.duplicates++;
        continue;
      }

      this.reorderBuffer.add(normalized);
      this.stats.accepted++;
    }

    const ordered = this.reorderBuffer.flush();
    const droppedByGap = this.reorderBuffer.consumeDroppedInLastFlush();
    if (droppedByGap > 0) {
      this.stats.droppedByGap = (this.stats.droppedByGap || 0) + droppedByGap;
    }
    if (ordered.length > 0) {
      this.stats.reordered += ordered.length;
    }

    const elapsed = (performance.now() - startTime) / 1000;
    if (elapsed > 0) {
      this.stats.eventsPerSecond = Math.round(rawEvents.length / elapsed);
    }

    this._lastCorruptions = batchCorruptions;
    return { events: ordered, corruptions: batchCorruptions };
  }

  forceFlush(): NormalizedEvent[] {
    return this.reorderBuffer.forceFlush();
  }

  getStats(): PipelineStats {
    return { ...this.stats };
  }

  getLastCorruptions(): CorruptionDetail[] {
    return this._lastCorruptions;
  }

  setGapTolerance(ms: number): void {
    this.reorderBuffer.setGapTolerance(ms);
  }

  setWindowMs(ms: number): void {
    this.reorderBuffer.setWindowMs(ms);
  }

  reset(): void {
    this.deduplicator.reset();
    this.stats = {
      totalReceived: 0,
      accepted: 0,
      rejected: 0,
      duplicates: 0,
      reordered: 0,
      corrupted: 0,
      droppedByGap: 0,
      eventsPerSecond: 0,
      corruptionDetails: [],
    };
  }
}
