import { describe, it, expect, beforeEach } from 'vitest';
import {
  djb2Hash,
  contentHash,
  validatePayload,
  normalizeEvent,
  EventDeduplicator,
  ReorderBuffer,
  EventPipeline,
} from './pipeline';
import type { NormalizedEvent } from '../types/events';

// ── djb2Hash ──────────────────────────────────────────────────────

describe('djb2Hash', () => {
  it('returns a non-empty string', () => {
    expect(djb2Hash('hello')).toBeTruthy();
  });

  it('is deterministic', () => {
    expect(djb2Hash('test-input')).toBe(djb2Hash('test-input'));
  });

  it('produces different hashes for different inputs', () => {
    expect(djb2Hash('alpha')).not.toBe(djb2Hash('beta'));
  });

  it('handles empty string', () => {
    expect(typeof djb2Hash('')).toBe('string');
  });
});

// ── contentHash ────────────────────────────────────────────────────

describe('contentHash', () => {
  const makeEvent = (overrides?: Partial<NormalizedEvent>): NormalizedEvent => ({
    id: 'evt-1',
    service: 'auth',
    severity: 'error',
    timestamp: 1700000000000,
    message: 'failed login',
    source: 'us-east',
    metadata: {},
    receivedAt: Date.now(),
    normalized: true,
    originalSchema: 'A',
    ...overrides,
  });

  it('returns same hash for identical events', () => {
    const a = makeEvent();
    const b = makeEvent();
    expect(contentHash(a)).toBe(contentHash(b));
  });

  it('returns different hash when content differs', () => {
    const a = makeEvent({ message: 'alpha' });
    const b = makeEvent({ message: 'beta' });
    expect(contentHash(a)).not.toBe(contentHash(b));
  });

  it('includes service in hash', () => {
    const a = makeEvent({ service: 'svc-a' });
    const b = makeEvent({ service: 'svc-b' });
    expect(contentHash(a)).not.toBe(contentHash(b));
  });
});

// ── validatePayload ────────────────────────────────────────────────

describe('validatePayload', () => {
  it('rejects null', () => {
    const result = validatePayload(null);
    expect(result.valid).toBe(false);
    expect(result.corruption?.type).toBe('malformed_json');
  });

  it('rejects non-object', () => {
    const result = validatePayload('string-data');
    expect(result.valid).toBe(false);
    expect(result.corruption?.type).toBe('malformed_json');
  });

  it('accepts a valid object', () => {
    const result = validatePayload({ id: 'e1', timestamp: 1700000000000 });
    expect(result.valid).toBe(true);
  });
});

// ── normalizeEvent (5 schemas) ────────────────────────────────────

describe('normalizeEvent', () => {
  it('normalizes Schema A', () => {
    const { event } = normalizeEvent({
      id: 'a1', service: 'auth', severity: 'error',
      timestamp: 1700000000000, message: 'fail', source: 'us-east',
    });
    expect(event).not.toBeNull();
    expect(event!.id).toBe('a1');
    expect(event!.originalSchema).toBe('A');
    expect(event!.contentHash).toBeTruthy();
  });

  it('normalizes Schema B', () => {
    const { event } = normalizeEvent({
      event_id: 'b1', svc: 'api', level: 'warn',
      ts: 1700000000000, msg: 'slow',
    });
    expect(event).not.toBeNull();
    expect(event!.id).toBe('b1');
    expect(event!.severity).toBe('warning');
    expect(event!.originalSchema).toBe('B');
  });

  it('normalizes Schema C', () => {
    const { event } = normalizeEvent({
      i: 'c1', s: 'db', v: 2, t: 1700000000000, m: 'query timeout',
    });
    expect(event).not.toBeNull();
    expect(event!.id).toBe('c1');
    expect(event!.severity).toBe('error');
    expect(event!.originalSchema).toBe('C');
  });

  it('normalizes Schema D (CloudWatch-style)', () => {
    const { event } = normalizeEvent({
      eventId: 'd1', serviceName: 'lambda', eventSeverity: 'high',
      eventTime: 1700000000000, description: 'throttle',
    });
    expect(event).not.toBeNull();
    expect(event!.id).toBe('d1');
    expect(event!.severity).toBe('error');
    expect(event!.originalSchema).toBe('D');
  });

  it('normalizes Schema E (underscore-prefixed ISO timestamp)', () => {
    const { event } = normalizeEvent({
      _id: 'e1', _service: 'cache', _level: 3,
      _ts: '2024-01-15T12:00:00Z', _msg: 'eviction',
    });
    expect(event).not.toBeNull();
    expect(event!.id).toBe('e1');
    expect(event!.severity).toBe('critical');
    expect(event!.originalSchema).toBe('E');
  });

  it('rejects invalid Schema E timestamp', () => {
    const { event, corruption } = normalizeEvent({
      _id: 'e2', _service: 'cache', _level: 1,
      _ts: 'not-a-date', _msg: 'test',
    });
    expect(event).toBeNull();
    expect(corruption?.type).toBe('invalid_timestamp');
  });

  it('returns corruption for unrecognized payload', () => {
    const { event, corruption } = normalizeEvent({
      unknownField: 'value',
    });
    expect(event).toBeNull();
    expect(corruption).toBeDefined();
  });
});

// ── EventDeduplicator ──────────────────────────────────────────────

describe('EventDeduplicator', () => {
  let dedup: EventDeduplicator;

  const makeEvent = (id: string, ts = 1700000000000, hash?: string): NormalizedEvent => ({
    id,
    service: 'svc',
    severity: 'info',
    timestamp: ts,
    message: 'test',
    source: 'src',
    metadata: {},
    receivedAt: Date.now(),
    normalized: true,
    originalSchema: 'A',
    contentHash: hash,
  });

  beforeEach(() => {
    dedup = new EventDeduplicator(100);
  });

  it('does not flag first occurrence as duplicate', () => {
    expect(dedup.isDuplicate(makeEvent('e1'))).toBe(false);
  });

  it('flags second occurrence with same ID+ts as duplicate', () => {
    dedup.isDuplicate(makeEvent('e1', 1000));
    expect(dedup.isDuplicate(makeEvent('e1', 1000))).toBe(true);
  });

  it('allows same ID with different timestamp', () => {
    dedup.isDuplicate(makeEvent('e1', 1000));
    expect(dedup.isDuplicate(makeEvent('e1', 2000))).toBe(false);
  });

  it('deduplicates by content hash', () => {
    dedup.isDuplicate(makeEvent('e1', 1000, 'hash-abc'));
    expect(dedup.isDuplicate(makeEvent('e2', 2000, 'hash-abc'))).toBe(true);
  });

  it('resets seen entries', () => {
    dedup.isDuplicate(makeEvent('e1'));
    dedup.reset();
    expect(dedup.isDuplicate(makeEvent('e1'))).toBe(false);
  });

  it('evicts old entries when exceeding maxSize', () => {
    for (let i = 0; i < 150; i++) {
      dedup.isDuplicate(makeEvent(`e-${i}`, i));
    }
    // The first entries should have been evicted
    expect(dedup.isDuplicate(makeEvent('e-0', 0))).toBe(false);
  });
});

// ── ReorderBuffer ──────────────────────────────────────────────────

describe('ReorderBuffer', () => {
  it('sorts events by timestamp on flush', () => {
    const buf = new ReorderBuffer(0, 30000); // 0ms window so flush always works
    const now = Date.now();
    buf.add({ id: '3', timestamp: now + 300, receivedAt: now } as NormalizedEvent);
    buf.add({ id: '1', timestamp: now + 100, receivedAt: now } as NormalizedEvent);
    buf.add({ id: '2', timestamp: now + 200, receivedAt: now } as NormalizedEvent);

    // Need >100 events or enough time for flush
    for (let i = 0; i < 100; i++) {
      buf.add({ id: `pad-${i}`, timestamp: now + 400 + i, receivedAt: now } as NormalizedEvent);
    }

    const flushed = buf.flush();
    expect(flushed.length).toBeGreaterThan(0);
    for (let i = 1; i < flushed.length; i++) {
      expect(flushed[i].timestamp).toBeGreaterThanOrEqual(flushed[i - 1].timestamp);
    }
  });

  it('allows gap tolerance configuration', () => {
    const buf = new ReorderBuffer(0, 5000);
    buf.setGapTolerance(10000);
    // Just verify no error
    expect(buf.size).toBe(0);
  });

  it('allows window configuration', () => {
    const buf = new ReorderBuffer(500);
    buf.setWindowMs(200);
    expect(buf.size).toBe(0);
  });

  it('force flushes all events', () => {
    const buf = new ReorderBuffer(100000); // very large window
    const now = Date.now();
    buf.add({ id: '1', timestamp: now, receivedAt: now } as NormalizedEvent);
    buf.add({ id: '2', timestamp: now + 1, receivedAt: now } as NormalizedEvent);

    const flushed = buf.forceFlush();
    expect(flushed).toHaveLength(2);
    expect(buf.size).toBe(0);
  });
});

// ── EventPipeline (integration) ───────────────────────────────────

describe('EventPipeline', () => {
  let pipeline: EventPipeline;

  beforeEach(() => {
    pipeline = new EventPipeline(0, 30000);
  });

  it('processes valid Schema A events end-to-end', () => {
    const raw = Array.from({ length: 105 }, (_, i) => ({
      id: `e-${i}`, service: 'auth', severity: 'error',
      timestamp: Date.now() + i, message: `msg-${i}`,
    }));

    const { events, corruptions } = pipeline.processRaw(raw);
    expect(events.length).toBeGreaterThan(0);
    expect(corruptions).toHaveLength(0);

    const stats = pipeline.getStats();
    expect(stats.totalReceived).toBe(105);
    expect(stats.corrupted).toBe(0);
  });

  it('classifies corrupted payloads', () => {
    const raw = [null, 42, 'string', { unknownField: 'x' }];
    const { corruptions } = pipeline.processRaw(raw);
    expect(corruptions.length).toBeGreaterThan(0);

    const stats = pipeline.getStats();
    expect(stats.corrupted).toBeGreaterThan(0);
  });

  it('deduplicates repeated events', () => {
    const evt = {
      id: 'dup-1', service: 'auth', severity: 'info',
      timestamp: Date.now(), message: 'test',
    };
    // Add enough to force flush
    const batch = [evt, evt, ...Array.from({ length: 100 }, (_, i) => ({
      id: `e-${i}`, service: 'auth', severity: 'info',
      timestamp: Date.now() + i + 1, message: `msg-${i}`,
    }))];

    pipeline.processRaw(batch);
    const stats = pipeline.getStats();
    expect(stats.duplicates).toBeGreaterThanOrEqual(1);
  });

  it('handles mixed valid and corrupt events', () => {
    const raw = [
      { id: 'valid-1', service: 'api', severity: 'info', timestamp: Date.now(), message: 'ok' },
      null,
      { event_id: 'valid-2', svc: 'db', level: 'warn', ts: Date.now() + 1, msg: 'slow' },
      42,
    ];
    // Pad to force flush
    for (let i = 0; i < 100; i++) {
      raw.push({ id: `pad-${i}`, service: 'api', severity: 'info', timestamp: Date.now() + i + 10, message: 'pad' });
    }

    const { events, corruptions } = pipeline.processRaw(raw);
    const stats = pipeline.getStats();
    expect(stats.accepted).toBeGreaterThan(0);
    expect(stats.corrupted).toBe(2);
    expect(corruptions).toHaveLength(2);
  });

  it('resets pipeline state', () => {
    pipeline.processRaw([
      { id: 'e1', service: 'svc', severity: 'info', timestamp: Date.now(), message: 'm' },
    ]);
    pipeline.reset();
    const stats = pipeline.getStats();
    expect(stats.totalReceived).toBe(0);
  });

  it('supports gap tolerance configuration', () => {
    pipeline.setGapTolerance(10000);
    pipeline.setWindowMs(200);
    // Verify no error
    const stats = pipeline.getStats();
    expect(stats.totalReceived).toBe(0);
  });
});
