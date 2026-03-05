import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Reconnection logic tests.
 *
 * The backoff formula lives inside `useIncidentStream` hook:
 *   delay = Math.min(backoffDelay * Math.pow(2, reconnectAttempts), 30000)
 *   jitter = delay * (0.5 + Math.random() * 0.5)
 *
 * We extract and test the pure math here, plus verify state transitions
 * through the Zustand store which is what the hook mutates.
 */

// ── Pure backoff computation (extracted from use-incident-stream.ts) ──

function computeBackoffDelay(
  backoffDelay: number,
  reconnectAttempts: number,
  maxDelay = 30000,
): number {
  return Math.min(backoffDelay * Math.pow(2, reconnectAttempts), maxDelay);
}

function computeJitter(delay: number, rand: number): number {
  return delay * (0.5 + rand * 0.5);
}

describe('Reconnection backoff logic', () => {
  // ── Exponential backoff ─────────────────────────────────────────

  describe('computeBackoffDelay', () => {
    it('doubles delay on each attempt', () => {
      expect(computeBackoffDelay(1000, 0)).toBe(1000);
      expect(computeBackoffDelay(1000, 1)).toBe(2000);
      expect(computeBackoffDelay(1000, 2)).toBe(4000);
      expect(computeBackoffDelay(1000, 3)).toBe(8000);
      expect(computeBackoffDelay(1000, 4)).toBe(16000);
    });

    it('caps at 30000ms', () => {
      expect(computeBackoffDelay(1000, 5)).toBe(30000);
      expect(computeBackoffDelay(1000, 10)).toBe(30000);
      expect(computeBackoffDelay(1000, 50)).toBe(30000);
    });

    it('works with different base delays', () => {
      expect(computeBackoffDelay(500, 0)).toBe(500);
      expect(computeBackoffDelay(500, 1)).toBe(1000);
      expect(computeBackoffDelay(2000, 3)).toBe(16000);
    });

    it('respects custom max delay', () => {
      expect(computeBackoffDelay(1000, 5, 10000)).toBe(10000);
    });
  });

  // ── Jitter ──────────────────────────────────────────────────────

  describe('computeJitter', () => {
    it('returns delay * 0.5 when rand=0 (minimum jitter)', () => {
      expect(computeJitter(4000, 0)).toBe(2000);
    });

    it('returns full delay when rand=1 (maximum jitter)', () => {
      expect(computeJitter(4000, 1)).toBe(4000);
    });

    it('returns value in [delay*0.5, delay] for random values', () => {
      for (let i = 0; i <= 10; i++) {
        const rand = i / 10;
        const result = computeJitter(10000, rand);
        expect(result).toBeGreaterThanOrEqual(5000);
        expect(result).toBeLessThanOrEqual(10000);
      }
    });

    it('handles zero delay', () => {
      expect(computeJitter(0, 0.5)).toBe(0);
    });
  });

  // ── State transitions via store ─────────────────────────────────

  describe('reconnection state transitions', () => {
    let useStore: typeof import('../store/use-store').useStore;

    beforeEach(async () => {
      // Dynamic import to get fresh store state
      const mod = await import('../store/use-store');
      useStore = mod.useStore;
      // Reset connection state
      useStore.getState().updateConnection({
        state: 'disconnected',
        reconnectAttempts: 0,
        backoffDelay: 1000,
        lastConnected: 0,
        lastDisconnected: 0,
      });
    });

    it('transitions to reconnecting state', () => {
      const state = useStore.getState();
      const { reconnectAttempts, backoffDelay } = state.connection;
      const delay = computeBackoffDelay(backoffDelay, reconnectAttempts);

      state.updateConnection({
        state: 'reconnecting',
        reconnectAttempts: reconnectAttempts + 1,
        backoffDelay: delay,
      });

      const updated = useStore.getState().connection;
      expect(updated.state).toBe('reconnecting');
      expect(updated.reconnectAttempts).toBe(1);
      expect(updated.backoffDelay).toBe(1000);
    });

    it('increments reconnect attempts on each attempt', () => {
      const state = useStore.getState();

      // Simulate 3 reconnection attempts
      for (let i = 0; i < 3; i++) {
        const conn = useStore.getState().connection;
        const delay = computeBackoffDelay(conn.backoffDelay, conn.reconnectAttempts);
        useStore.getState().updateConnection({
          state: 'reconnecting',
          reconnectAttempts: conn.reconnectAttempts + 1,
          backoffDelay: delay,
        });
      }

      expect(useStore.getState().connection.reconnectAttempts).toBe(3);
    });

    it('resets state on successful reconnection', () => {
      // Simulate some failed attempts
      useStore.getState().updateConnection({
        state: 'reconnecting',
        reconnectAttempts: 5,
        backoffDelay: 16000,
      });

      // Simulate successful reconnect (mirrors onConnect callback)
      useStore.getState().updateConnection({
        state: 'connected',
        lastConnected: Date.now(),
        reconnectAttempts: 0,
        backoffDelay: 1000,
      });

      const conn = useStore.getState().connection;
      expect(conn.state).toBe('connected');
      expect(conn.reconnectAttempts).toBe(0);
      expect(conn.backoffDelay).toBe(1000);
    });

    it('records disconnection timestamp', () => {
      const now = Date.now();
      useStore.getState().updateConnection({
        state: 'disconnected',
        lastDisconnected: now,
      });

      expect(useStore.getState().connection.lastDisconnected).toBe(now);
    });

    it('logs reconnection audit entry', () => {
      useStore.getState().clearAuditLog();
      const conn = useStore.getState().connection;
      const delay = computeBackoffDelay(conn.backoffDelay, conn.reconnectAttempts);
      const jitter = computeJitter(delay, 0.75);

      useStore.getState().addAuditEntry({
        action: 'Reconnecting',
        details: `Attempt ${conn.reconnectAttempts + 1}, delay: ${Math.round(jitter)}ms`,
        category: 'connection',
      });

      const log = useStore.getState().auditLog;
      expect(log.length).toBe(1);
      expect(log[0].action).toBe('Reconnecting');
      expect(log[0].category).toBe('connection');
      expect(log[0].details).toContain('Attempt 1');
    });

    it('handles rapid disconnect/reconnect cycles', () => {
      // Simulate 10 rapid disconnect-reconnect cycles
      for (let cycle = 0; cycle < 10; cycle++) {
        const conn = useStore.getState().connection;
        const delay = computeBackoffDelay(1000, conn.reconnectAttempts);

        useStore.getState().updateConnection({
          state: 'reconnecting',
          reconnectAttempts: conn.reconnectAttempts + 1,
          backoffDelay: delay,
        });
      }

      const finalConn = useStore.getState().connection;
      expect(finalConn.reconnectAttempts).toBe(10);
      // Backoff should be capped at 30s
      expect(finalConn.backoffDelay).toBeLessThanOrEqual(30000);
    });
  });

  // ── Full backoff sequence ───────────────────────────────────────

  describe('full exponential backoff sequence', () => {
    it('produces correct delay sequence from base 1000ms', () => {
      const expected = [1000, 2000, 4000, 8000, 16000, 30000, 30000];
      const actual = expected.map((_, i) => computeBackoffDelay(1000, i));
      expect(actual).toEqual(expected);
    });

    it('jittered delays never exceed the computed delay', () => {
      vi.spyOn(Math, 'random').mockReturnValue(1); // worst case
      for (let attempt = 0; attempt < 10; attempt++) {
        const delay = computeBackoffDelay(1000, attempt);
        const jittered = computeJitter(delay, Math.random());
        expect(jittered).toBeLessThanOrEqual(delay);
        expect(jittered).toBeGreaterThanOrEqual(delay * 0.5);
      }
      vi.restoreAllMocks();
    });

    it('jittered delays are at least 50% of computed delay', () => {
      vi.spyOn(Math, 'random').mockReturnValue(0); // best case (minimum jitter)
      for (let attempt = 0; attempt < 10; attempt++) {
        const delay = computeBackoffDelay(1000, attempt);
        const jittered = computeJitter(delay, Math.random());
        expect(jittered).toBe(delay * 0.5);
      }
      vi.restoreAllMocks();
    });
  });
});
