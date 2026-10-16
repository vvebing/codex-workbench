/** One request at a time. Restarting changes the next delay without overlapping work. */
export class Polling {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running = false;
  private task: (() => Promise<boolean | void>) | undefined;
  private delay: (() => number) | undefined;

  start(task: () => Promise<boolean | void>, delay: () => number): void {
    this.task = task;
    this.delay = delay;
    this.schedule();
  }

  restart(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.schedule();
  }

  stop(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.task = undefined;
    this.delay = undefined;
  }

  private schedule(): void {
    if (this.timer || this.running || !this.task || !this.delay) return;
    this.timer = setTimeout(async () => {
      this.timer = undefined;
      this.running = true;
      const task = this.task;
      try {
        const keepRunning = await task?.();
        if (this.task === task && keepRunning === false) this.stop();
      } finally {
        this.running = false;
        this.schedule();
      }
    }, this.delay());
    this.timer.unref?.();
  }
}
