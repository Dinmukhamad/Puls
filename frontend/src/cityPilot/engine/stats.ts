/** Statistics for a bounded window of presented frame intervals, not a GPU timer. */
export interface CityStatsSnapshot {
  /** 1000 divided by the mean interval in the current sample window. */
  fps: number;
  /** 1000 / p99 frame interval, using the nearest-rank percentile. */
  fpsP1: number;
  /** Mean synchronous CPU time passed by the render loop; excludes asynchronous GPU work. */
  cpuMs: number;
  /** Mean renderer-reported draw calls per sampled frame. */
  drawCalls: number;
  /** Mean renderer-reported triangles per sampled frame. */
  triangles: number;
  /** Number of measured intervals in the bounded window (the initial baseline is excluded). */
  frames: number;
  /** Sum of measured intervals in the window; explicitly suspended time is excluded. */
  elapsedMs: number;
  maxFrameMs: number;
}

/**
 * Feed the unmodified requestAnimationFrame timestamp into record() after rendering.
 * Do not clamp intervals or skip active loading frames: their pauses are visible to users.
 * Call suspend() on document hide and before resuming after an intentional stopped loop.
 * It resets the timestamp baseline without discarding measurements already collected.
 *
 * The default window keeps at most 3,600 intervals (~60 s at 60 Hz). A fixed-duration
 * benchmark should use a larger limit, e.g. 18,000 for 60 s at up to 300 Hz.
 */
export class CityStats {
  private readonly intervals: Float64Array;
  private readonly cpuTimes: Float64Array;
  private readonly calls: Float64Array;
  private readonly triangleCounts: Float64Array;
  private previousTimestamp: number | null = null;
  private cursor = 0;
  private count = 0;
  private intervalSum = 0;
  private cpuSum = 0;
  private callsSum = 0;
  private trianglesSum = 0;

  constructor(private readonly maxSamples = 3600) {
    if (!Number.isSafeInteger(maxSamples) || maxSamples < 1 || maxSamples > 300_000) {
      throw new RangeError('CityStats maxSamples must be an integer between 1 and 300000.');
    }
    this.intervals = new Float64Array(maxSamples);
    this.cpuTimes = new Float64Array(maxSamples);
    this.calls = new Float64Array(maxSamples);
    this.triangleCounts = new Float64Array(maxSamples);
  }

  record(timestampMs: number, cpuMs: number, drawCalls: number, triangles: number): void {
    // Reject out-of-order/invalid callbacks without moving a valid clock baseline.
    if (!Number.isFinite(timestampMs)) return;
    if (this.previousTimestamp === null) {
      this.previousTimestamp = timestampMs;
      return;
    }
    const interval = timestampMs - this.previousTimestamp;
    if (interval <= 0 || !Number.isFinite(interval)) return;
    this.previousTimestamp = timestampMs;

    const cpu = finiteNonNegative(cpuMs);
    const calls = finiteNonNegative(drawCalls);
    const triangleCount = finiteNonNegative(triangles);
    const index = this.cursor;
    if (this.count === this.maxSamples) {
      this.intervalSum -= this.intervals[index];
      this.cpuSum -= this.cpuTimes[index];
      this.callsSum -= this.calls[index];
      this.trianglesSum -= this.triangleCounts[index];
    } else {
      this.count += 1;
    }
    this.intervals[index] = interval;
    this.cpuTimes[index] = cpu;
    this.calls[index] = calls;
    this.triangleCounts[index] = triangleCount;
    this.intervalSum += interval;
    this.cpuSum += cpu;
    this.callsSum += calls;
    this.trianglesSum += triangleCount;
    this.cursor = (index + 1) % this.maxSamples;
  }

  suspend(): void {
    this.previousTimestamp = null;
  }

  reset(): void {
    this.suspend();
    this.cursor = 0;
    this.count = 0;
    this.intervalSum = 0;
    this.cpuSum = 0;
    this.callsSum = 0;
    this.trianglesSum = 0;
    // The next writes replace old slots; count prevents reading stale measurements.
  }

  snapshot(): CityStatsSnapshot {
    if (this.count === 0) {
      return { fps: 0, fpsP1: 0, cpuMs: 0, drawCalls: 0, triangles: 0, frames: 0, elapsedMs: 0, maxFrameMs: 0 };
    }
    const sorted = this.intervals.slice(0, this.count).sort();
    // Nearest rank: p99 is sample ceil(0.99 * N), using one-based indexing.
    // This is an inverse percentile, not the average FPS of the slowest 1%.
    const p99 = sorted[Math.ceil(this.count * .99) - 1];
    return {
      fps: 1000 * this.count / this.intervalSum,
      fpsP1: 1000 / p99,
      cpuMs: this.cpuSum / this.count,
      drawCalls: this.callsSum / this.count,
      triangles: this.trianglesSum / this.count,
      frames: this.count,
      elapsedMs: this.intervalSum,
      maxFrameMs: sorted[this.count - 1],
    };
  }
}

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) && value >= 0 ? value : 0;
}
