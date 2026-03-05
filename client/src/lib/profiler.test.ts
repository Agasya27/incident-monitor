import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { PerformanceProfiler } from './profiler';

describe('PerformanceProfiler', () => {
  let profiler: PerformanceProfiler;

  beforeEach(() => {
    profiler = new PerformanceProfiler();
    vi.useFakeTimers();
  });

  afterEach(() => {
    profiler.stop();
    vi.useRealTimers();
  });

  // ── Basic state ─────────────────────────────────────────────────

  it('starts with empty snapshots', () => {
    expect(profiler.getSnapshots()).toEqual([]);
    expect(profiler.getLatest()).toBeNull();
  });

  // ── Record metrics ──────────────────────────────────────────────

  it('records pipeline latency', () => {
    profiler.recordPipelineLatency(12.345);
    // latency is stored internally; we trigger a snapshot to verify
    expect(() => profiler.recordPipelineLatency(0)).not.toThrow();
  });

  it('records event throughput', () => {
    profiler.recordEventThroughput(500);
    expect(() => profiler.recordEventThroughput(0)).not.toThrow();
  });

  it('records render latency', () => {
    profiler.recordRenderLatency(8.22);
    expect(() => profiler.recordRenderLatency(0)).not.toThrow();
  });

  // ── Snapshot via start/measureFrame ─────────────────────────────

  it('takes snapshots after 1 second of frames', () => {
    const raf: { cb: ((time: number) => void) | null } = { cb: null };
    const mockRaf = vi.fn((cb: (time: number) => void) => {
      raf.cb = cb;
      return 1;
    });
    vi.stubGlobal('requestAnimationFrame', mockRaf);
    vi.stubGlobal('cancelAnimationFrame', vi.fn());

    // Stub performance.now to advance with fake timers
    let perfNowBase = 0;
    const origPerfNow = performance.now.bind(performance);
    const perfSpy = vi.spyOn(performance, 'now').mockImplementation(() => perfNowBase);

    profiler.recordPipelineLatency(5.5);
    profiler.recordEventThroughput(100);
    profiler.recordRenderLatency(2.1);

    profiler.start();

    // Simulate frames over >1 second
    for (let i = 0; i < 65; i++) {
      perfNowBase += 16; // ~60fps
      vi.advanceTimersByTime(16);
      if (raf.cb) {
        raf.cb(perfNowBase);
      }
    }

    const snapshots = profiler.getSnapshots();
    expect(snapshots.length).toBeGreaterThanOrEqual(1);

    const latest = profiler.getLatest();
    expect(latest).not.toBeNull();
    expect(latest!.fps).toBeGreaterThan(0);
    expect(latest!.pipelineLatencyMs).toBe(5.5);
    expect(latest!.eventThroughput).toBe(100);
    expect(latest!.renderLatencyMs).toBe(2.1);

    perfSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  // ── getSummary ──────────────────────────────────────────────────

  it('returns zero summary when no snapshots exist', () => {
    const summary = profiler.getSummary();
    expect(summary).toEqual({
      avgFps: 0,
      minFps: 0,
      maxFps: 0,
      avgHeapMB: 0,
      peakHeapMB: 0,
      avgPipelineMs: 0,
      avgThroughput: 0,
    });
  });

  it('computes summary from snapshots', () => {
    const raf: { cb: ((time: number) => void) | null } = { cb: null };
    vi.stubGlobal('requestAnimationFrame', vi.fn((cb: (time: number) => void) => {
      raf.cb = cb;
      return 1;
    }));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());

    // Stub performance.now to advance with fake timers
    let perfNowBase = 0;
    const perfSpy = vi.spyOn(performance, 'now').mockImplementation(() => perfNowBase);

    profiler.recordPipelineLatency(10);
    profiler.recordEventThroughput(200);
    profiler.start();

    // Generate 2 snapshots (2 seconds of frames)
    for (let i = 0; i < 130; i++) {
      perfNowBase += 16;
      vi.advanceTimersByTime(16);
      if (raf.cb) raf.cb(perfNowBase);
    }

    const summary = profiler.getSummary();
    expect(summary.avgFps).toBeGreaterThan(0);
    expect(summary.minFps).toBeGreaterThan(0);
    expect(summary.maxFps).toBeGreaterThanOrEqual(summary.minFps);
    expect(summary.avgPipelineMs).toBe(10);
    expect(summary.avgThroughput).toBe(200);

    perfSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  // ── reset ───────────────────────────────────────────────────────

  it('resets all state', () => {
    profiler.recordPipelineLatency(10);
    profiler.recordEventThroughput(500);
    profiler.recordRenderLatency(3);
    profiler.reset();

    expect(profiler.getSnapshots()).toEqual([]);
    expect(profiler.getLatest()).toBeNull();
    const summary = profiler.getSummary();
    expect(summary.avgFps).toBe(0);
  });

  // ── stop ────────────────────────────────────────────────────────

  it('stops the rAF loop', () => {
    const mockCancel = vi.fn();
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 42));
    vi.stubGlobal('cancelAnimationFrame', mockCancel);

    profiler.start();
    profiler.stop();

    expect(mockCancel).toHaveBeenCalledWith(42);

    vi.unstubAllGlobals();
  });

  it('stop is safe to call when not started', () => {
    expect(() => profiler.stop()).not.toThrow();
  });

  // ── Snapshot bounding ───────────────────────────────────────────

  it('caps snapshots at maxSnapshots (300)', () => {
    const raf: { cb: ((time: number) => void) | null } = { cb: null };
    vi.stubGlobal('requestAnimationFrame', vi.fn((cb: (time: number) => void) => {
      raf.cb = cb;
      return 1;
    }));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());

    profiler.start();

    const start = performance.now();
    // Simulate 350 seconds worth of frames (350 snapshots)
    for (let sec = 0; sec < 350; sec++) {
      for (let frame = 0; frame < 62; frame++) {
        const time = sec * 1000 + frame * 16;
        vi.advanceTimersByTime(16);
        if (raf.cb) raf.cb(start + time);
      }
    }

    expect(profiler.getSnapshots().length).toBeLessThanOrEqual(300);

    vi.unstubAllGlobals();
  });
});
