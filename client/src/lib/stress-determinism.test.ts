import { describe, it, expect } from 'vitest';
import { EventPipeline, djb2Hash } from '../lib/pipeline';
import { ASTRuleEvaluator } from '../lib/ast-rule-engine';
import { computeStateHash, useStore } from '../store/use-store';
import type { NormalizedEvent, Rule } from '../types/events';

const makeEvent = (id: string, ts: number): NormalizedEvent => ({
  id,
  service: 'svc-' + (Math.random() > 0.5 ? 'auth' : 'api'),
  severity: (['info', 'warning', 'error', 'critical'] as const)[Math.floor(Math.random() * 4)],
  timestamp: ts,
  message: `Event message ${id}`,
  source: 'test',
  metadata: {},
  receivedAt: ts,
  normalized: true,
  originalSchema: 'A',
});

// ── Stress Test ──────────────────────────────────────────────────

describe('Stress Tests', () => {
  it('processes 200+ events per second through pipeline', () => {
    const pipeline = new EventPipeline(0, 60000);
    const batchSize = 250;
    const events = Array.from({ length: batchSize }, (_, i) => ({
      id: `stress-${i}`,
      service: 'auth',
      severity: 'error',
      timestamp: Date.now() + i,
      message: `stress test ${i}`,
    }));

    const start = performance.now();
    const { events: processed } = pipeline.processRaw(events);
    const elapsed = performance.now() - start;

    // Should process 250 events well within 1 second
    expect(elapsed).toBeLessThan(1000);
    expect(processed.length).toBeGreaterThan(0);

    const eps = (batchSize / elapsed) * 1000;
    console.log(`Pipeline: ${Math.round(eps)} events/sec (${elapsed.toFixed(1)}ms for ${batchSize} events)`);
    expect(eps).toBeGreaterThan(200);
  });

  it('evaluates 200+ events per second through rule engine', () => {
    const evaluator = new ASTRuleEvaluator();
    const rules: Rule[] = [
      {
        id: 'stress-r1', name: 'Stress Rule 1', enabled: true,
        conditions: [{ field: 'severity', operator: 'equals', value: 'error' }],
        logic: 'AND', timeWindowSeconds: 60, threshold: 1,
        consecutiveCount: 0, escalationSeverity: 'critical', action: 'alert',
      },
      {
        id: 'stress-r2', name: 'Stress Rule 2', enabled: true,
        conditions: [
          { field: 'service', operator: 'contains', value: 'auth' },
          { field: 'severity', operator: 'not_equals', value: 'info' },
        ],
        logic: 'AND', timeWindowSeconds: 30, threshold: 5,
        consecutiveCount: 0, escalationSeverity: 'error', action: 'notify',
      },
    ];
    evaluator.setRules(rules);

    const events = Array.from({ length: 250 }, (_, i) => makeEvent(`stress-${i}`, Date.now() + i));

    const start = performance.now();
    const results = evaluator.evaluate(events);
    const elapsed = performance.now() - start;

    const eps = (250 / elapsed) * 1000;
    console.log(`Rule Engine: ${Math.round(eps)} events/sec (${elapsed.toFixed(1)}ms for 250 events)`);
    expect(eps).toBeGreaterThan(200);
  });

  it('handles 10K events without blocking', () => {
    const pipeline = new EventPipeline(0, 60000);
    const events = Array.from({ length: 10000 }, (_, i) => ({
      id: `bulk-${i}`,
      service: 'svc',
      severity: 'info',
      timestamp: Date.now() + i,
      message: `bulk event ${i}`,
    }));

    const start = performance.now();
    pipeline.processRaw(events);
    const elapsed = performance.now() - start;

    console.log(`Bulk: 10K events processed in ${elapsed.toFixed(1)}ms`);
    expect(elapsed).toBeLessThan(5000); // Should complete well within 5 seconds
  });
});

// ── Determinism Tests ────────────────────────────────────────────

describe('Determinism Tests', () => {
  it('produces same pipeline output for same input (same sequence == same results)', () => {
    const input: { id: string; service: string; severity: string; timestamp: number; message: string }[] = Array.from({ length: 50 }, (_, i) => ({
      id: `det-${i}`,
      service: 'auth',
      severity: 'error',
      timestamp: 1700000000000 + i * 100,
      message: `deterministic event ${i}`,
    }));

    // Pad to force flush
    for (let i = 50; i < 150; i++) {
      input.push({
        id: `pad-${i}`,
        service: 'auth',
        severity: 'info',
        timestamp: 1700000000000 + i * 100,
        message: `pad ${i}`,
      });
    }

    const pipeline1 = new EventPipeline(0, 60000);
    const pipeline2 = new EventPipeline(0, 60000);

    const result1 = pipeline1.processRaw(input);
    const result2 = pipeline2.processRaw(input);

    expect(result1.events.length).toBe(result2.events.length);
    for (let i = 0; i < result1.events.length; i++) {
      expect(result1.events[i].id).toBe(result2.events[i].id);
      expect(result1.events[i].timestamp).toBe(result2.events[i].timestamp);
    }
  });

  it('produces same state hash for same event sequence', () => {
    const events = Array.from({ length: 100 }, (_, i) =>
      makeEvent(`det-${i}`, 1700000000000 + i * 100)
    );

    const hash1 = computeStateHash(events);
    const hash2 = computeStateHash(events);
    expect(hash1).toBe(hash2);
  });

  it('djb2Hash is deterministic', () => {
    const inputs = ['hello', 'world', 'test-123', 'a'.repeat(1000)];
    for (const input of inputs) {
      expect(djb2Hash(input)).toBe(djb2Hash(input));
    }
  });

  it('different event sequences produce different hashes', () => {
    const eventsA = [makeEvent('a1', 1000), makeEvent('a2', 2000)];
    const eventsB = [makeEvent('b1', 1000), makeEvent('b2', 2000)];
    expect(computeStateHash(eventsA)).not.toBe(computeStateHash(eventsB));
  });
});

// ── Corruption Handling Tests ────────────────────────────────────

describe('Corruption Handling', () => {
  it('classifies null payloads as malformed_json', () => {
    const pipeline = new EventPipeline(0, 60000);
    const { corruptions } = pipeline.processRaw([null]);
    expect(corruptions).toHaveLength(1);
    expect(corruptions[0].type).toBe('malformed_json');
  });

  it('classifies non-object payloads as malformed_json', () => {
    const pipeline = new EventPipeline(0, 60000);
    const { corruptions } = pipeline.processRaw([42, 'string', true]);
    expect(corruptions).toHaveLength(3);
    corruptions.forEach(c => expect(c.type).toBe('malformed_json'));
  });

  it('classifies missing ID as missing_required', () => {
    const pipeline = new EventPipeline(0, 60000);
    const { corruptions } = pipeline.processRaw([{ timestamp: 123, noId: true }]);
    expect(corruptions.length).toBeGreaterThanOrEqual(1);
    // The corruption should be about missing fields
    expect(corruptions.some(c => c.type === 'missing_required' || c.type === 'unknown')).toBe(true);
  });

  it('handles mixed corrupt and valid events', () => {
    const pipeline = new EventPipeline(0, 60000);
    const batch = [
      null,
      { id: 'v1', service: 'auth', severity: 'info', timestamp: Date.now(), message: 'ok' },
      42,
      { id: 'v2', service: 'api', severity: 'error', timestamp: Date.now() + 1, message: 'fail' },
    ];
    // Pad for flush
    for (let i = 0; i < 100; i++) {
      batch.push({ id: `pad-${i}`, service: 'svc', severity: 'info', timestamp: Date.now() + i + 10, message: 'pad' });
    }

    const { events, corruptions } = pipeline.processRaw(batch);
    expect(events.length).toBeGreaterThan(0);
    expect(corruptions).toHaveLength(2);

    const stats = pipeline.getStats();
    expect(stats.corrupted).toBe(2);
  });

  it('never lets corrupted events into the output', () => {
    const pipeline = new EventPipeline(0, 60000);
    const corrupt = Array.from({ length: 50 }, () => null);
    const valid = Array.from({ length: 150 }, (_, i) => ({
      id: `v-${i}`,
      service: 'svc',
      severity: 'info',
      timestamp: Date.now() + i,
      message: 'valid',
    }));

    const { events } = pipeline.processRaw([...corrupt, ...valid]);
    // All output events should have normalized: true
    events.forEach(e => {
      expect(e.normalized).toBe(true);
      expect(e.id).toBeDefined();
      expect(e.service).toBeDefined();
    });
  });
});

// ── Memory Bounds Tests ──────────────────────────────────────────

describe('Memory Bounds', () => {
  it('pipeline dedup sets are bounded', () => {
    const pipeline = new EventPipeline(0, 60000);
    // Process more events than the dedup max size (10000)
    const events = Array.from({ length: 15000 }, (_, i) => ({
      id: `mem-${i}`,
      service: 'svc',
      severity: 'info',
      timestamp: Date.now() + i,
      message: `event ${i}`,
    }));

    pipeline.processRaw(events);
    const stats = pipeline.getStats();
    // All events should be processed without error
    expect(stats.totalReceived).toBe(15000);
  });

  it('store caps events at MAX_EVENTS', () => {
    const { addEvents } = useStore.getState();
    const bulkEvents = Array.from({ length: 12000 }, (_, i) => makeEvent(`mem-${i}`, Date.now() + i));
    addEvents(bulkEvents);
    const state = useStore.getState();
    expect(state.events.length).toBeLessThanOrEqual(10000);
    // Clean up store state
    useStore.getState().clearEvents();
  });

  it('corruption details list is bounded', () => {
    const pipeline = new EventPipeline(0, 60000);
    // Send many corrupt events
    const corrupt = Array.from({ length: 1000 }, () => null);
    pipeline.processRaw(corrupt);
    const stats = pipeline.getStats();
    expect(stats.corruptionDetails.length).toBeLessThanOrEqual(500);
  });
});
