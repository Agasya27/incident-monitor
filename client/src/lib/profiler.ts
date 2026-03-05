/**
 * Performance Profiler
 *
 * Tracks and reports system performance metrics:
 *   - FPS (requestAnimationFrame loop)
 *   - Pipeline processing latency
 *   - Heap memory usage
 *   - Event throughput
 *   - Render cycle duration
 */

export interface ProfileSnapshot {
  timestamp: number;
  fps: number;
  heapUsedMB: number;
  heapTotalMB: number;
  pipelineLatencyMs: number;
  eventThroughput: number;
  renderLatencyMs: number;
}

export class PerformanceProfiler {
  private snapshots: ProfileSnapshot[] = [];
  private maxSnapshots = 300; // 5 minutes at 1/s
  private fps = 60;
  private frameCount = 0;
  private lastFrameTime = 0;
  private rafId: number | null = null;
  private pipelineLatency = 0;
  private eventThroughput = 0;
  private renderLatency = 0;

  start(): void {
    this.lastFrameTime = performance.now();
    this.frameCount = 0;
    this.measureFrame();
  }

  stop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  private measureFrame = (): void => {
    this.frameCount++;
    const now = performance.now();
    const elapsed = now - this.lastFrameTime;

    if (elapsed >= 1000) {
      this.fps = Math.round((this.frameCount * 1000) / elapsed);
      this.frameCount = 0;
      this.lastFrameTime = now;
      this.takeSnapshot();
    }

    this.rafId = requestAnimationFrame(this.measureFrame);
  };

  recordPipelineLatency(ms: number): void {
    this.pipelineLatency = ms;
  }

  recordEventThroughput(eventsPerSecond: number): void {
    this.eventThroughput = eventsPerSecond;
  }

  recordRenderLatency(ms: number): void {
    this.renderLatency = ms;
  }

  private takeSnapshot(): void {
    // performance.memory is Chrome-only (non-standard). Other browsers return 0.
    const memory = (performance as any).memory;
    const snapshot: ProfileSnapshot = {
      timestamp: Date.now(),
      fps: this.fps,
      heapUsedMB: memory ? Math.round(memory.usedJSHeapSize / 1048576) : 0,
      heapTotalMB: memory ? Math.round(memory.totalJSHeapSize / 1048576) : 0,
      pipelineLatencyMs: Math.round(this.pipelineLatency * 100) / 100,
      eventThroughput: this.eventThroughput,
      renderLatencyMs: Math.round(this.renderLatency * 100) / 100,
    };

    this.snapshots.push(snapshot);
    if (this.snapshots.length > this.maxSnapshots) {
      this.snapshots = this.snapshots.slice(-this.maxSnapshots);
    }
  }

  getSnapshots(): ProfileSnapshot[] {
    return [...this.snapshots];
  }

  getLatest(): ProfileSnapshot | null {
    return this.snapshots.length > 0 ? this.snapshots[this.snapshots.length - 1] : null;
  }

  getSummary(): {
    avgFps: number;
    minFps: number;
    maxFps: number;
    avgHeapMB: number;
    peakHeapMB: number;
    avgPipelineMs: number;
    avgThroughput: number;
  } {
    if (this.snapshots.length === 0) {
      return { avgFps: 0, minFps: 0, maxFps: 0, avgHeapMB: 0, peakHeapMB: 0, avgPipelineMs: 0, avgThroughput: 0 };
    }

    const fpsValues = this.snapshots.map(s => s.fps);
    const heapValues = this.snapshots.map(s => s.heapUsedMB);
    const latencyValues = this.snapshots.map(s => s.pipelineLatencyMs);
    const throughputValues = this.snapshots.map(s => s.eventThroughput);

    return {
      avgFps: Math.round(fpsValues.reduce((a, b) => a + b, 0) / fpsValues.length),
      minFps: Math.min(...fpsValues),
      maxFps: Math.max(...fpsValues),
      avgHeapMB: Math.round(heapValues.reduce((a, b) => a + b, 0) / heapValues.length),
      peakHeapMB: Math.max(...heapValues),
      avgPipelineMs: Math.round(latencyValues.reduce((a, b) => a + b, 0) / latencyValues.length * 100) / 100,
      avgThroughput: Math.round(throughputValues.reduce((a, b) => a + b, 0) / throughputValues.length),
    };
  }

  reset(): void {
    this.snapshots = [];
    this.fps = 60;
    this.pipelineLatency = 0;
    this.eventThroughput = 0;
    this.renderLatency = 0;
  }
}

// Singleton instance
export const profiler = new PerformanceProfiler();
