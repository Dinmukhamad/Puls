/** Pace rendering independently of the display's requestAnimationFrame rate. */
export class FramePacer {
  private readonly interval: number;
  private nextDeadline: number | null = null;
  private readonly tolerance = .5;

  constructor(fps: number) {
    if (!Number.isFinite(fps) || fps <= 0) {
      throw new RangeError('FramePacer requires a finite positive frame rate');
    }
    this.interval = 1000 / fps;
  }

  shouldRender(now: number): boolean {
    if (!Number.isFinite(now)) return false;
    if (this.nextDeadline === null) {
      this.nextDeadline = now + this.interval;
      return true;
    }
    if (now + this.tolerance < this.nextDeadline) return false;

    const lateness = now - this.nextDeadline;
    // Early acceptance must advance the PREVIOUS deadline. Basing it on now
    // lets sub-millisecond RAF jitter accumulate until frames are skipped.
    // A stalled/tab-suspended renderer starts a new interval without trying
    // to deliver missed frames in a burst when RAF resumes.
    this.nextDeadline = lateness >= this.interval
      ? now + this.interval
      : this.nextDeadline + this.interval;
    return true;
  }

  reset(): void {
    this.nextDeadline = null;
  }
}
