import { describe, it, expect, beforeEach } from 'vitest';
import { useStore, computeStateHash } from './use-store';
import type { NormalizedEvent, Rule } from '../types/events';

const makeEvent = (id: string, severity: 'info' | 'warning' | 'error' | 'critical' = 'info', ts?: number): NormalizedEvent => ({
  id,
  service: 'svc',
  severity,
  timestamp: ts || Date.now(),
  message: `msg-${id}`,
  source: 'src',
  metadata: {},
  receivedAt: Date.now(),
  normalized: true,
  originalSchema: 'A',
});

describe('useStore', () => {
  beforeEach(() => {
    // Reset store to initial state
    const state = useStore.getState();
    state.clearEvents();
    state.clearAuditLog();
  });

  // ── Event management ────────────────────────────────────────────

  describe('event management', () => {
    it('adds events to store', () => {
      const events = [makeEvent('e1'), makeEvent('e2')];
      useStore.getState().addEvents(events);
      expect(useStore.getState().events).toHaveLength(2);
    });

    it('caps events at 10000', () => {
      const events = Array.from({ length: 10500 }, (_, i) => makeEvent(`e-${i}`));
      useStore.getState().addEvents(events);
      expect(useStore.getState().events.length).toBeLessThanOrEqual(10000);
    });

    it('clears events', () => {
      useStore.getState().addEvents([makeEvent('e1')]);
      useStore.getState().clearEvents();
      expect(useStore.getState().events).toHaveLength(0);
    });
  });

  // ── Replay system ──────────────────────────────────────────────

  describe('replay system', () => {
    it('adds replay events', () => {
      useStore.getState().addReplayEvent(makeEvent('r1'));
      expect(useStore.getState().replayEvents).toHaveLength(1);
    });

    it('takes snapshots', () => {
      useStore.getState().addEvents([makeEvent('e1'), makeEvent('e2')]);
      useStore.getState().takeSnapshot();
      expect(useStore.getState().replaySnapshots.length).toBeGreaterThanOrEqual(1);
    });

    it('restores snapshots', () => {
      useStore.getState().addEvents([makeEvent('e1'), makeEvent('e2')]);
      useStore.getState().takeSnapshot();
      useStore.getState().addEvents([makeEvent('e3')]);
      useStore.getState().restoreSnapshot(0);
      // After restore, events should match snapshot state (2 events)
      const state = useStore.getState();
      expect(state.events.length).toBe(2);
    });
  });

  // ── Rule management ─────────────────────────────────────────────

  describe('rule management', () => {
    const testRule: Rule = {
      id: 'test-r1',
      name: 'Test Rule',
      enabled: true,
      conditions: [{ field: 'severity', operator: 'equals', value: 'error' }],
      logic: 'AND',
      timeWindowSeconds: 60,
      threshold: 5,
      consecutiveCount: 0,
      escalationSeverity: 'critical',
      action: 'alert',
    };

    it('adds a rule', () => {
      const initialCount = useStore.getState().rules.length;
      useStore.getState().addRule(testRule);
      expect(useStore.getState().rules.length).toBe(initialCount + 1);
    });

    it('removes a rule', () => {
      useStore.getState().addRule(testRule);
      useStore.getState().removeRule('test-r1');
      expect(useStore.getState().rules.find(r => r.id === 'test-r1')).toBeUndefined();
    });

    it('updates a rule', () => {
      useStore.getState().addRule(testRule);
      useStore.getState().updateRule('test-r1', { enabled: false });
      const rule = useStore.getState().rules.find(r => r.id === 'test-r1');
      expect(rule?.enabled).toBe(false);
    });
  });

  // ── Audit log ───────────────────────────────────────────────────

  describe('audit log', () => {
    it('adds audit entries', () => {
      useStore.getState().addAuditEntry({
        action: 'test action',
        details: 'test details',
        category: 'system',
      });
      const log = useStore.getState().auditLog;
      expect(log.length).toBeGreaterThanOrEqual(1);
      expect(log[log.length - 1].action).toBe('test action');
    });

    it('clears audit log', () => {
      useStore.getState().addAuditEntry({
        action: 'test',
        details: '',
        category: 'system',
      });
      useStore.getState().clearAuditLog();
      expect(useStore.getState().auditLog).toHaveLength(0);
    });
  });

  // ── Connection management ───────────────────────────────────────

  describe('connection management', () => {
    it('updates connection state', () => {
      useStore.getState().updateConnection({ state: 'connected' });
      expect(useStore.getState().connection.state).toBe('connected');
    });

    it('sets streaming state', () => {
      useStore.getState().setStreaming(true);
      expect(useStore.getState().isStreaming).toBe(true);
      useStore.getState().setStreaming(false);
      expect(useStore.getState().isStreaming).toBe(false);
    });
  });

  // ── Pipeline stats ──────────────────────────────────────────────

  describe('pipeline stats', () => {
    it('updates pipeline stats', () => {
      useStore.getState().updatePipelineStats({
        totalReceived: 100,
        accepted: 90,
        rejected: 5,
        duplicates: 5,
        reordered: 80,
        corrupted: 3,
        eventsPerSecond: 50,
        corruptionDetails: [],
      });
      const stats = useStore.getState().pipelineStats;
      expect(stats.totalReceived).toBe(100);
      expect(stats.accepted).toBe(90);
    });
  });

  // ── Chaos config ────────────────────────────────────────────────

  describe('chaos config', () => {
    it('updates chaos config partially', () => {
      useStore.getState().setChaosConfig({ duplicateRate: 0.5 });
      expect(useStore.getState().chaosConfig.duplicateRate).toBe(0.5);
      // other fields preserved
      expect(useStore.getState().chaosConfig.enabled).toBe(true);
    });

    it('can disable chaos entirely', () => {
      useStore.getState().setChaosConfig({ enabled: false });
      expect(useStore.getState().chaosConfig.enabled).toBe(false);
    });

    it('updates multiple chaos fields at once', () => {
      useStore.getState().setChaosConfig({
        outOfOrderRate: 0.2,
        corruptionRate: 0.1,
        disconnectionInterval: 60000,
      });
      const config = useStore.getState().chaosConfig;
      expect(config.outOfOrderRate).toBe(0.2);
      expect(config.corruptionRate).toBe(0.1);
      expect(config.disconnectionInterval).toBe(60000);
    });
  });

  // ── Throughput data ─────────────────────────────────────────────

  describe('throughput data', () => {
    it('adds throughput data points', () => {
      const point = {
        time: '12:00:00',
        timestamp: Date.now(),
        accepted: 10,
        rejected: 2,
        duplicates: 1,
        total: 13,
      };
      useStore.getState().addThroughputPoint(point);
      expect(useStore.getState().throughputHistory.length).toBeGreaterThanOrEqual(1);
    });

    it('caps throughput history at MAX_THROUGHPUT_POINTS (60)', () => {
      for (let i = 0; i < 70; i++) {
        useStore.getState().addThroughputPoint({
          time: `${i}`,
          timestamp: Date.now() + i,
          accepted: i,
          rejected: 0,
          duplicates: 0,
          total: i,
        });
      }
      expect(useStore.getState().throughputHistory.length).toBeLessThanOrEqual(60);
    });
  });

  // ── Observability ───────────────────────────────────────────────

  describe('observability', () => {
    it('updates integrity window from pipeline stats', () => {
      useStore.getState().updatePipelineStats({
        totalReceived: 100,
        accepted: 80,
        rejected: 15,
        duplicates: 5,
        reordered: 0,
        corrupted: 5,
        eventsPerSecond: 50,
        corruptionDetails: [],
      });
      useStore.getState().updateIntegrity();
      const integrity = useStore.getState().integrityWindow;
      expect(integrity.accepted).toBe(80);
      expect(integrity.rejected).toBe(15);
      expect(integrity.corrupted).toBe(5);
      // score = 80 / (80+15+5) = 0.8
      expect(integrity.score).toBe(0.8);
    });

    it('integrity score is 1 when no events processed', () => {
      useStore.getState().updatePipelineStats({
        totalReceived: 0,
        accepted: 0,
        rejected: 0,
        duplicates: 0,
        reordered: 0,
        corrupted: 0,
        eventsPerSecond: 0,
        corruptionDetails: [],
      });
      useStore.getState().updateIntegrity();
      expect(useStore.getState().integrityWindow.score).toBe(1);
    });

    it('updates severity rates', () => {
      const now = Date.now();
      const events = [
        makeEvent('e1', 'error', now - 10000),
        makeEvent('e2', 'error', now - 15000),
        makeEvent('e3', 'warning', now - 20000),
        makeEvent('e4', 'info', now - 5000),
      ];
      useStore.getState().addEvents(events);
      useStore.getState().updateSeverityRates();

      const rates = useStore.getState().severityRates;
      expect(rates).toHaveLength(4);
      expect(rates.map(r => r.severity)).toEqual(['info', 'warning', 'error', 'critical']);
      // Each rate should have trend
      for (const rate of rates) {
        expect(['rising', 'falling', 'stable']).toContain(rate.trend);
      }
    });

    it('severity rates detect rising trend', () => {
      const now = Date.now();
      // Many recent events, few older ones
      const recentErrors = Array.from({ length: 10 }, (_, i) =>
        makeEvent(`recent-${i}`, 'error', now - i * 1000),
      );
      const olderErrors = Array.from({ length: 2 }, (_, i) =>
        makeEvent(`older-${i}`, 'error', now - 40000 - i * 1000),
      );
      useStore.getState().addEvents([...recentErrors, ...olderErrors]);
      useStore.getState().updateSeverityRates();

      const errorRate = useStore.getState().severityRates.find(r => r.severity === 'error');
      expect(errorRate).toBeDefined();
      expect(errorRate!.current).toBeGreaterThan(errorRate!.previous);
      expect(errorRate!.trend).toBe('rising');
    });

    it('updates performance metrics partially', () => {
      useStore.getState().updatePerformanceMetrics({ fps: 30 });
      expect(useStore.getState().performanceMetrics.fps).toBe(30);
      // Other fields preserved
      expect(useStore.getState().performanceMetrics.heapUsedMB).toBe(0);
    });

    it('updates performance metrics with heap data', () => {
      useStore.getState().updatePerformanceMetrics({
        heapUsedMB: 42.5,
        heapTotalMB: 128,
      });
      const metrics = useStore.getState().performanceMetrics;
      expect(metrics.heapUsedMB).toBe(42.5);
      expect(metrics.heapTotalMB).toBe(128);
    });
  });

  // ── State hash ──────────────────────────────────────────────────

  describe('state hash', () => {
    it('updates state hash from events', () => {
      useStore.getState().addEvents([makeEvent('e1'), makeEvent('e2')]);
      useStore.getState().updateStateHash();
      expect(useStore.getState().stateHash).not.toBe('0');
    });

    it('state hash is "0" when no events', () => {
      useStore.getState().clearEvents();
      useStore.getState().updateStateHash();
      expect(useStore.getState().stateHash).toBe('0');
    });

    it('state hash is deterministic', () => {
      useStore.getState().addEvents([makeEvent('e1', 'info', 1000), makeEvent('e2', 'error', 2000)]);
      useStore.getState().updateStateHash();
      const hash1 = useStore.getState().stateHash;
      useStore.getState().updateStateHash();
      const hash2 = useStore.getState().stateHash;
      expect(hash1).toBe(hash2);
    });
  });

  // ── Replay state ────────────────────────────────────────────────

  describe('replay state', () => {
    it('sets replay state partially', () => {
      useStore.getState().setReplayState({ isReplaying: true, replaySpeed: 2 });
      const state = useStore.getState();
      expect(state.isReplaying).toBe(true);
      expect(state.replaySpeed).toBe(2);
    });

    it('pauses and resumes replay', () => {
      useStore.getState().setReplayState({ replayPaused: true });
      expect(useStore.getState().replayPaused).toBe(true);
      useStore.getState().setReplayState({ replayPaused: false });
      expect(useStore.getState().replayPaused).toBe(false);
    });

    it('sets replay index', () => {
      useStore.getState().setReplayState({ replayIndex: 42 });
      expect(useStore.getState().replayIndex).toBe(42);
    });

    it('caps replay snapshots at 12', () => {
      useStore.getState().addEvents([makeEvent('e1')]);
      for (let i = 0; i < 15; i++) {
        useStore.getState().takeSnapshot();
      }
      expect(useStore.getState().replaySnapshots.length).toBeLessThanOrEqual(12);
    });

    it('restoreSnapshot returns empty array for invalid index', () => {
      const result = useStore.getState().restoreSnapshot(999);
      expect(result).toEqual([]);
    });

    it('addReplayEvent filters old events beyond 60s', () => {
      const now = Date.now();
      // Add an old event that should be filtered
      useStore.setState({ replayEvents: [makeEvent('old', 'info', now - 120000)] });
      useStore.getState().addReplayEvent(makeEvent('new', 'info', now));
      const replayEvents = useStore.getState().replayEvents;
      // Old event should be filtered out
      expect(replayEvents.find(e => e.id === 'old')).toBeUndefined();
      expect(replayEvents.find(e => e.id === 'new')).toBeDefined();
    });
  });

  // ── Rule results ────────────────────────────────────────────────

  describe('rule results', () => {
    it('sets rule results (prepends, caps at 100)', () => {
      const results = Array.from({ length: 110 }, (_, i) => ({
        ruleId: `r-${i}`,
        ruleName: `Rule ${i}`,
        triggered: true,
        triggeredAt: Date.now(),
        matchedEvents: ['e1'],
        severity: 'critical' as const,
        action: 'alert',
      }));
      useStore.getState().setRuleResults(results);
      expect(useStore.getState().ruleResults.length).toBeLessThanOrEqual(100);
    });

    it('clears rule results', () => {
      useStore.getState().setRuleResults([{
        ruleId: 'r1',
        ruleName: 'Test',
        triggered: true,
        triggeredAt: Date.now(),
        matchedEvents: ['e1'],
        severity: 'error',
        action: 'alert',
      }]);
      useStore.getState().clearRuleResults();
      expect(useStore.getState().ruleResults).toHaveLength(0);
    });
  });

  // ── Audit log cap ──────────────────────────────────────────────

  describe('audit log cap', () => {
    it('caps audit log at MAX_AUDIT_ENTRIES (5000)', () => {
      for (let i = 0; i < 5100; i++) {
        useStore.getState().addAuditEntry({
          action: `action-${i}`,
          details: '',
          category: 'system',
        });
      }
      expect(useStore.getState().auditLog.length).toBeLessThanOrEqual(5000);
    });
  });
});

// ── computeStateHash ────────────────────────────────────────────────

describe('computeStateHash', () => {
  it('returns "0" for empty array', () => {
    expect(computeStateHash([])).toBe('0');
  });

  it('returns deterministic hash for same events', () => {
    const events = [makeEvent('e1', 'info', 1000), makeEvent('e2', 'error', 2000)];
    const hash1 = computeStateHash(events);
    const hash2 = computeStateHash(events);
    expect(hash1).toBe(hash2);
  });

  it('returns different hash for different events', () => {
    const events1 = [makeEvent('e1')];
    const events2 = [makeEvent('e2')];
    expect(computeStateHash(events1)).not.toBe(computeStateHash(events2));
  });
});
