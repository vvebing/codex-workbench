interface HistoryJob {
  key: string;
  task: () => Promise<void>;
  owners: Set<symbol>;
  running: boolean;
}

/** Share summary traversals while limiting work across visible environments. */
export class HistoryLoadingScheduler {
  private jobs = new Map<string, HistoryJob>();
  private pending: HistoryJob[] = [];
  private active = 0;

  /** Cancel only this caller's interest; started requests keep their slot until settled. */
  enqueue(key: string, task: () => Promise<void>): () => void {
    const owner = Symbol(key);
    let job = this.jobs.get(key);
    if (!job) {
      job = { key, task, owners: new Set(), running: false };
      this.jobs.set(key, job);
      this.pending.push(job);
    }
    job.owners.add(owner);
    this.drain();
    return () => {
      if (!job.owners.delete(owner) || job.running || job.owners.size) return;
      if (this.jobs.get(key) === job) this.jobs.delete(key);
      const index = this.pending.indexOf(job);
      if (index !== -1) this.pending.splice(index, 1);
    };
  }

  private drain(): void {
    while (this.active < 2 && this.pending.length) {
      const job = this.pending.shift()!;
      if (!job.owners.size || this.jobs.get(job.key) !== job) continue;
      job.running = true;
      this.active++;
      void Promise.resolve()
        .then(job.task)
        // SessionsStore owns the inline error and explicit retry state. A
        // failed environment must still release its slot for other histories.
        .catch(() => {})
        .then(() => {
          this.active--;
          if (this.jobs.get(job.key) === job) this.jobs.delete(job.key);
          this.drain();
        });
    }
  }
}

export const historyLoading = new HistoryLoadingScheduler();
