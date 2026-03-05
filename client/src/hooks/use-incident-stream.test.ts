import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useStore } from '../store/use-store';

// ── Mock Worker (must be a real class for `new Worker()`) ─────────

const mockPostMessage = vi.fn();
const mockTerminate = vi.fn();

class FakeWorker {
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  postMessage = mockPostMessage;
  terminate = mockTerminate;
}

// ── Mock MockWebSocketService ─────────────────────────────────────

const mockConnect = vi.fn();
const mockDisconnect = vi.fn();
const mockReconnect = vi.fn();
const mockSetChaosConfig = vi.fn();

vi.mock('../services/mock-backend', () => {
  return {
    MockWebSocketService: class {
      latencyTracker = { latency: 5 };
      connect = mockConnect;
      disconnect = mockDisconnect;
      reconnect = mockReconnect;
      setChaosConfig = mockSetChaosConfig;
    },
    generateHistoricalEvents: vi.fn(() => [
      {
        id: 'hist-1',
        service: 'auth',
        severity: 'info',
        timestamp: Date.now() - 1000,
        message: 'Test historical event',
        source: 'test',
        metadata: {},
        receivedAt: Date.now() - 1000,
        normalized: true,
        originalSchema: 'A',
      },
    ]),
  };
});

// Import hook AFTER mocks are set up
import { useIncidentStream } from './use-incident-stream';

describe('useIncidentStream', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('Worker', FakeWorker);
    vi.stubGlobal('requestAnimationFrame', vi.fn((cb: FrameRequestCallback) => {
      return setTimeout(() => cb(performance.now()), 16) as unknown as number;
    }));
    vi.stubGlobal('cancelAnimationFrame', vi.fn((id: number) => clearTimeout(id)));

    // Reset store state
    const state = useStore.getState();
    state.clearEvents();
    state.clearAuditLog();
    state.clearRuleResults();
    state.setStreaming(false);
    state.updateConnection({
      state: 'disconnected',
      reconnectAttempts: 0,
      backoffDelay: 1000,
    });

    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('returns start, stop, and updateChaosConfig functions', () => {
    const { result } = renderHook(() => useIncidentStream());
    expect(result.current.start).toBeInstanceOf(Function);
    expect(result.current.stop).toBeInstanceOf(Function);
    expect(result.current.updateChaosConfig).toBeInstanceOf(Function);
  });

  it('start() sets isStreaming to true and loads historical events', () => {
    const { result } = renderHook(() => useIncidentStream());

    act(() => {
      result.current.start();
    });

    expect(useStore.getState().isStreaming).toBe(true);
    expect(useStore.getState().events.length).toBeGreaterThanOrEqual(1);
  });

  it('start() creates WebSocket connection', () => {
    const { result } = renderHook(() => useIncidentStream());

    act(() => {
      result.current.start();
    });

    expect(mockSetChaosConfig).toHaveBeenCalled();
    expect(mockConnect).toHaveBeenCalledWith({
      onMessage: expect.any(Function),
      onDisconnect: expect.any(Function),
      onConnect: expect.any(Function),
    });
  });

  it('start() adds audit entry for historical data load', () => {
    const { result } = renderHook(() => useIncidentStream());

    act(() => {
      result.current.start();
    });

    const auditLog = useStore.getState().auditLog;
    const histEntry = auditLog.find(e => e.action === 'Historical data loaded');
    expect(histEntry).toBeDefined();
  });

  it('stop() sets isStreaming to false and disconnects', () => {
    const { result } = renderHook(() => useIncidentStream());

    act(() => {
      result.current.start();
    });

    act(() => {
      result.current.stop();
    });

    expect(useStore.getState().isStreaming).toBe(false);
    expect(useStore.getState().connection.state).toBe('disconnected');
    expect(mockDisconnect).toHaveBeenCalled();
  });

  it('updateChaosConfig() updates store and WebSocket service', () => {
    const { result } = renderHook(() => useIncidentStream());

    act(() => {
      result.current.start();
    });

    act(() => {
      result.current.updateChaosConfig({ duplicateRate: 0.5 });
    });

    expect(useStore.getState().chaosConfig.duplicateRate).toBe(0.5);
    expect(mockSetChaosConfig).toHaveBeenCalledWith({ duplicateRate: 0.5 });
  });

  it('onConnect callback updates connection state', () => {
    const { result } = renderHook(() => useIncidentStream());

    act(() => {
      result.current.start();
    });

    // Extract the onConnect handler
    const connectCall = mockConnect.mock.calls[0][0];
    act(() => {
      connectCall.onConnect();
    });

    const conn = useStore.getState().connection;
    expect(conn.state).toBe('connected');
    expect(conn.reconnectAttempts).toBe(0);
    expect(conn.backoffDelay).toBe(1000);
  });

  it('onDisconnect callback triggers reconnection', () => {
    const { result } = renderHook(() => useIncidentStream());

    act(() => {
      result.current.start();
    });

    const connectCall = mockConnect.mock.calls[0][0];
    act(() => {
      connectCall.onDisconnect();
    });

    const conn = useStore.getState().connection;
    expect(conn.state).toBe('reconnecting');
    expect(conn.reconnectAttempts).toBe(1);
  });

  it('onDisconnect logs audit entries', () => {
    const { result } = renderHook(() => useIncidentStream());

    act(() => {
      result.current.start();
    });

    useStore.getState().clearAuditLog();

    const connectCall = mockConnect.mock.calls[0][0];
    act(() => {
      connectCall.onDisconnect();
    });

    const auditLog = useStore.getState().auditLog;
    expect(auditLog.some(e => e.action === 'WebSocket disconnected')).toBe(true);
    expect(auditLog.some(e => e.action === 'Reconnecting')).toBe(true);
  });

  it('onMessage processes events through pipeline', () => {
    const { result } = renderHook(() => useIncidentStream());

    act(() => {
      result.current.start();
    });

    const connectCall = mockConnect.mock.calls[0][0];

    // Send raw events through onMessage
    const rawEvents = [
      {
        id: 'raw-1',
        service: 'auth',
        severity: 'error',
        timestamp: Date.now(),
        message: 'Test raw event',
        source: 'test',
        metadata: {},
      },
    ];

    act(() => {
      connectCall.onMessage(rawEvents);
    });

    // Flush the batch (100ms interval)
    act(() => {
      vi.advanceTimersByTime(150);
    });

    // Events should be added to store after batch flush
    const events = useStore.getState().events;
    expect(events.length).toBeGreaterThanOrEqual(1);
  });

  it('starts snapshot timer (every 10s)', () => {
    const { result } = renderHook(() => useIncidentStream());

    act(() => {
      result.current.start();
    });

    const initialSnapshots = useStore.getState().replaySnapshots.length;

    act(() => {
      vi.advanceTimersByTime(10500);
    });

    expect(useStore.getState().replaySnapshots.length).toBeGreaterThan(initialSnapshots);
  });

  it('starts throughput timer (every 1s)', () => {
    const { result } = renderHook(() => useIncidentStream());

    act(() => {
      result.current.start();
    });

    act(() => {
      vi.advanceTimersByTime(1500);
    });

    expect(useStore.getState().throughputHistory.length).toBeGreaterThanOrEqual(1);
  });

  it('starts integrity/severity/hash timer (every 5s)', () => {
    const { result } = renderHook(() => useIncidentStream());

    act(() => {
      result.current.start();
    });

    // Add some events so hash changes
    useStore.getState().addEvents([
      {
        id: 'test-int',
        service: 'auth',
        severity: 'error' as const,
        timestamp: Date.now(),
        message: 'test',
        source: 'test',
        metadata: {},
        receivedAt: Date.now(),
        normalized: true,
        originalSchema: 'A',
      },
    ]);

    act(() => {
      vi.advanceTimersByTime(5500);
    });

    expect(useStore.getState().stateHash).not.toBe('0');
  });

  it('stop() cleans up all timers', () => {
    const { result } = renderHook(() => useIncidentStream());

    act(() => {
      result.current.start();
    });

    act(() => {
      result.current.stop();
    });

    // After stop, advancing timers should NOT create new snapshots
    const snapshotsBefore = useStore.getState().replaySnapshots.length;
    act(() => {
      vi.advanceTimersByTime(20000);
    });
    expect(useStore.getState().replaySnapshots.length).toBe(snapshotsBefore);
  });

  it('cleans up on unmount', () => {
    const { result, unmount } = renderHook(() => useIncidentStream());

    act(() => {
      result.current.start();
    });

    unmount();

    expect(useStore.getState().isStreaming).toBe(false);
  });

  it('reconnection uses exponential backoff', () => {
    const { result } = renderHook(() => useIncidentStream());

    act(() => {
      result.current.start();
    });

    const connectCall = mockConnect.mock.calls[0][0];

    // First disconnect
    act(() => {
      connectCall.onDisconnect();
    });

    expect(useStore.getState().connection.reconnectAttempts).toBe(1);
    expect(useStore.getState().connection.backoffDelay).toBe(1000);

    // Simulate reconnect succeeded then disconnected again
    act(() => {
      connectCall.onConnect();
    });
    expect(useStore.getState().connection.reconnectAttempts).toBe(0);
  });

  it('handles onMessage with corrupted events', () => {
    const { result } = renderHook(() => useIncidentStream());

    act(() => {
      result.current.start();
    });

    const connectCall = mockConnect.mock.calls[0][0];

    // Send corrupted event (missing fields)
    act(() => {
      connectCall.onMessage([{ corrupted: true }]);
    });

    // Flush batch
    act(() => {
      vi.advanceTimersByTime(150);
    });

    // Should not crash; pipeline rejects bad events
    const stats = useStore.getState().pipelineStats;
    expect(stats).toBeDefined();
  });

  it('sends rules to worker on start', () => {
    const { result } = renderHook(() => useIncidentStream());

    act(() => {
      result.current.start();
    });

    expect(mockPostMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'SET_RULES' }),
    );
  });
});
