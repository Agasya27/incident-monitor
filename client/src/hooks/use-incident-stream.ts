import { useEffect, useRef, useCallback } from 'react';
import { useStore } from '../store/use-store';
import { MockWebSocketService, generateHistoricalEvents } from '../services/mock-backend';
import { EventPipeline } from '../lib/pipeline';
import { profiler } from '../lib/profiler';
import type { NormalizedEvent, ThroughputDataPoint, RuleResult } from '../types/events';

export function useIncidentStream() {
  const wsRef = useRef<MockWebSocketService | null>(null);
  const pipelineRef = useRef<EventPipeline>(new EventPipeline());
  const workerRef = useRef<Worker | null>(null);
  const batchBufferRef = useRef<NormalizedEvent[]>([]);
  const batchTimerRef = useRef<number | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const snapshotTimerRef = useRef<number | null>(null);
  const throughputTimerRef = useRef<number | null>(null);
  const latencyTimerRef = useRef<number | null>(null);
  const integrityTimerRef = useRef<number | null>(null);
  const perfTimerRef = useRef<number | null>(null);
  const eventRateRef = useRef({ count: 0, lastCheck: Date.now() });
  const prevStatsRef = useRef({ accepted: 0, rejected: 0, duplicates: 0 });
  const prevDroppedByGapRef = useRef(0);
  const fpsFramesRef = useRef({ count: 0, lastCheck: performance.now() });
  const workerEvalStartedAtRef = useRef<number[]>([]);

  const rules = useStore((s) => s.rules);

  // ── Web Worker setup ────────────────────────────────────────────
  const initWorker = useCallback(() => {
    try {
      const worker = new Worker(
        new URL('../workers/rule-engine.worker.ts', import.meta.url),
        { type: 'module' }
      );
      worker.onmessage = (e: MessageEvent<{ type: string; results?: RuleResult[] }>) => {
        if (e.data.type === 'RESULTS') {
          const startedAt = workerEvalStartedAtRef.current.shift();
          if (startedAt) {
            const latency = Math.round((performance.now() - startedAt) * 100) / 100;
            useStore.getState().updatePerformanceMetrics({ ruleEvalLatencyMs: latency });
          }
        }
        if (e.data.type === 'RESULTS' && e.data.results && e.data.results.length > 0) {
          const state = useStore.getState();
          state.setRuleResults(e.data.results);
          for (const result of e.data.results) {
            state.addAuditEntry({
              action: `Rule triggered: ${result.ruleName}`,
              details: `Severity: ${result.severity}. Action: ${result.action}. Matched ${result.matchedEvents.length} events`,
              category: 'rule',
            });
          }
        }
      };
      worker.onerror = (err) => {
        console.error('[Worker error]', err);
        // Fallback: worker errors are non-fatal, rules just won't evaluate
      };
      workerRef.current = worker;
      // Send initial rules
      worker.postMessage({ type: 'SET_RULES', rules: useStore.getState().rules });
    } catch (err) {
      console.warn('[Worker init failed, rule engine disabled]', err);
    }
  }, []);

  // ── FPS tracking ────────────────────────────────────────────────
  const trackFps = useCallback(() => {
    fpsFramesRef.current.count++;
    const now = performance.now();
    if (now - fpsFramesRef.current.lastCheck >= 1000) {
      const fps = Math.round(fpsFramesRef.current.count * 1000 / (now - fpsFramesRef.current.lastCheck));
      useStore.getState().updatePerformanceMetrics({ fps });
      fpsFramesRef.current = { count: 0, lastCheck: now };
    }
    if (useStore.getState().isStreaming) {
      requestAnimationFrame(trackFps);
    }
  }, []);

  const flushBatch = useCallback(() => {
    const batch = batchBufferRef.current;
    if (batch.length === 0) return;
    batchBufferRef.current = [];

    const state = useStore.getState();
    state.addEvents(batch);

    for (const event of batch) {
      state.addReplayEvent(event);
    }

    // Evaluate rules via Web Worker (off main thread)
    if (workerRef.current) {
      workerEvalStartedAtRef.current.push(performance.now());
      workerRef.current.postMessage({ type: 'EVALUATE', events: batch });
    }

    state.updatePipelineStats(pipelineRef.current.getStats());

    eventRateRef.current.count += batch.length;
    const now = Date.now();
    if (now - eventRateRef.current.lastCheck >= 1000) {
      state.updateConnection({
        eventsPerSecond: eventRateRef.current.count,
      });
      state.updatePerformanceMetrics({
        eventsProcessedPerSec: eventRateRef.current.count,
      });
      eventRateRef.current = { count: 0, lastCheck: now };
    }
  }, []);

  const handleMessage = useCallback((rawEvents: unknown[]) => {
    const pipelineStart = performance.now();
    const { events: processed, corruptions } = pipelineRef.current.processRaw(rawEvents);
    const pipelineLatency = performance.now() - pipelineStart;

    useStore.getState().updatePerformanceMetrics({ pipelineLatencyMs: Math.round(pipelineLatency * 100) / 100 });
    profiler.recordPipelineLatency(pipelineLatency);
    const stats = pipelineRef.current.getStats();
    const droppedByGap = stats.droppedByGap || 0;
    const droppedDelta = droppedByGap - prevDroppedByGapRef.current;
    if (droppedDelta > 0) {
      const state = useStore.getState();
      state.updateConnection({
        droppedEvents: state.connection.droppedEvents + droppedDelta,
      });
    }
    prevDroppedByGapRef.current = droppedByGap;

    // Log corruption details to audit trail
    if (corruptions.length > 0) {
      const state = useStore.getState();
      for (const corruption of corruptions.slice(0, 5)) { // Limit audit log rate
        state.addAuditEntry({
          action: `Corruption detected: ${corruption.type}`,
          details: `${corruption.message}${corruption.field ? ` (field: ${corruption.field})` : ''}`,
          category: 'system',
        });
      }
    }

    if (processed.length > 0) {
      batchBufferRef.current.push(...processed);
    }
  }, []);

  const reconnectWithBackoff = useCallback(() => {
    const state = useStore.getState();
    const { reconnectAttempts, backoffDelay } = state.connection;

    // Max 20 retries before giving up
    const MAX_RECONNECT_ATTEMPTS = 20;
    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      state.updateConnection({ state: 'disconnected' });
      state.addAuditEntry({
        action: 'Reconnection abandoned',
        details: `Max retries (${MAX_RECONNECT_ATTEMPTS}) exhausted. Manual restart required.`,
        category: 'connection',
      });
      return;
    }

    const delay = Math.min(backoffDelay * Math.pow(2, reconnectAttempts), 30000);
    const jitter = delay * (0.5 + Math.random() * 0.5);

    state.updateConnection({
      state: 'reconnecting',
      reconnectAttempts: reconnectAttempts + 1,
      backoffDelay: delay,
    });

    state.addAuditEntry({
      action: 'Reconnecting',
      details: `Attempt ${reconnectAttempts + 1}, delay: ${Math.round(jitter)}ms`,
      category: 'connection',
    });

    reconnectTimerRef.current = window.setTimeout(() => {
      wsRef.current?.reconnect();
    }, jitter);
  }, []);

  const start = useCallback(() => {
    // Initialize Web Worker
    initWorker();
    profiler.start();

    const historical = generateHistoricalEvents(10000);
    prevDroppedByGapRef.current = 0;
    workerEvalStartedAtRef.current = [];
    useStore.getState().addEvents(historical);
    useStore.getState().addAuditEntry({
      action: 'Historical data loaded',
      details: `Loaded ${historical.length} historical events`,
      category: 'system',
    });

    batchTimerRef.current = window.setInterval(flushBatch, 100);

    // Snapshot every 10 seconds (for replay determinism)
    snapshotTimerRef.current = window.setInterval(() => {
      useStore.getState().takeSnapshot();
    }, 10000);

    throughputTimerRef.current = window.setInterval(() => {
      const stats = pipelineRef.current.getStats();
      const prev = prevStatsRef.current;
      const point: ThroughputDataPoint = {
        time: new Date().toLocaleTimeString(),
        timestamp: Date.now(),
        accepted: stats.accepted - prev.accepted,
        rejected: stats.rejected - prev.rejected,
        duplicates: stats.duplicates - prev.duplicates,
        total: (stats.accepted - prev.accepted) + (stats.rejected - prev.rejected) + (stats.duplicates - prev.duplicates),
      };
      prevStatsRef.current = { accepted: stats.accepted, rejected: stats.rejected, duplicates: stats.duplicates };
      useStore.getState().addThroughputPoint(point);
    }, 1000);

    // Integrity and severity rate updates every 5s
    integrityTimerRef.current = window.setInterval(() => {
      const state = useStore.getState();
      state.updateIntegrity();
      state.updateSeverityRates();
      state.updateStateHash();
    }, 5000);

    // Performance metrics: heap tracking every 2s
    perfTimerRef.current = window.setInterval(() => {
      const perf = (performance as unknown as { memory?: { usedJSHeapSize: number; totalJSHeapSize: number } }).memory;
      if (perf) {
        useStore.getState().updatePerformanceMetrics({
          heapUsedMB: Math.round(perf.usedJSHeapSize / 1048576 * 10) / 10,
          heapTotalMB: Math.round(perf.totalJSHeapSize / 1048576 * 10) / 10,
        });
      }
    }, 2000);

    const ws = new MockWebSocketService();
    wsRef.current = ws;
    ws.setChaosConfig(useStore.getState().chaosConfig);

    // Latency tracking from ping/pong simulation
    latencyTimerRef.current = window.setInterval(() => {
      if (wsRef.current) {
        const state = useStore.getState();
        const latency = wsRef.current.latencyTracker.latency;
        const currentState = state.connection.state;
        const nextState =
          currentState === 'connected' && latency >= 180
            ? 'degraded'
            : currentState === 'degraded' && latency < 140
              ? 'connected'
              : currentState;
        state.updateConnection({
          latency,
          state: nextState,
        });
      }
    }, 2000);

    ws.connect({
      onMessage: handleMessage,
      onDisconnect: () => {
        const state = useStore.getState();
        state.updateConnection({
          state: 'disconnected',
          lastDisconnected: Date.now(),
        });
        state.addAuditEntry({
          action: 'WebSocket disconnected',
          details: 'Connection lost, initiating reconnection',
          category: 'connection',
        });
        const remaining = pipelineRef.current.forceFlush();
        if (remaining.length > 0) {
          batchBufferRef.current.push(...remaining);
          flushBatch();
        }
        reconnectWithBackoff();
      },
      onConnect: () => {
        const state = useStore.getState();
        state.updateConnection({
          state: 'connected',
          lastConnected: Date.now(),
          reconnectAttempts: 0,
          backoffDelay: 1000,
        });
        state.addAuditEntry({
          action: 'WebSocket connected',
          details: 'Connection established successfully',
          category: 'connection',
        });
      },
    });

    useStore.getState().setStreaming(true);

    // Start FPS tracking
    requestAnimationFrame(trackFps);
  }, [flushBatch, handleMessage, reconnectWithBackoff, initWorker, trackFps]);

  const stop = useCallback(() => {
    wsRef.current?.disconnect();
    workerRef.current?.terminate();
    workerRef.current = null;
    profiler.stop();
    if (batchTimerRef.current) clearInterval(batchTimerRef.current);
    if (snapshotTimerRef.current) clearInterval(snapshotTimerRef.current);
    if (throughputTimerRef.current) clearInterval(throughputTimerRef.current);
    if (latencyTimerRef.current) clearInterval(latencyTimerRef.current);
    if (integrityTimerRef.current) clearInterval(integrityTimerRef.current);
    if (perfTimerRef.current) clearInterval(perfTimerRef.current);
    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    useStore.getState().setStreaming(false);
    useStore.getState().updateConnection({ state: 'disconnected' });
  }, []);

  const updateChaosConfig = useCallback((config: Partial<ReturnType<typeof useStore.getState>['chaosConfig']>) => {
    useStore.getState().setChaosConfig(config);
    wsRef.current?.setChaosConfig(config);
  }, []);

  useEffect(() => {
    return () => {
      stop();
    };
  }, [stop]);

  // Send updated rules to worker when they change
  useEffect(() => {
    if (workerRef.current) {
      workerRef.current.postMessage({ type: 'SET_RULES', rules });
    }
  }, [rules]);

  return { start, stop, updateChaosConfig };
}
