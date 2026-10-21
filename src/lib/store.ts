export class Store<T> {
  private listeners = new Set<() => void>();
  private publicationPending = false;
  private publicationFrame?: number;
  private publicationTimer?: ReturnType<typeof setTimeout>;
  constructor(protected state: T) {}
  getSnapshot = (): T => this.state;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
      if (!this.listeners.size) this.cancelPublication();
    };
  };
  private cancelPublication() {
    if (this.publicationFrame !== undefined)
      cancelAnimationFrame(this.publicationFrame);
    if (this.publicationTimer !== undefined)
      clearTimeout(this.publicationTimer);
    this.publicationFrame = undefined;
    this.publicationTimer = undefined;
    this.publicationPending = false;
  }
  private flush = () => {
    if (!this.publicationPending) return;
    this.cancelPublication();
    for (const listener of this.listeners) listener();
  };
  /** State always advances synchronously; only streaming notifications may wait a frame. */
  protected update(state: T, deferred = false): void {
    const changed = !Object.is(this.state, state);
    this.state = state;
    if (!deferred) {
      if (!changed && !this.publicationPending) return;
      this.cancelPublication();
      for (const listener of this.listeners) listener();
      return;
    }
    if (!changed || this.publicationPending || !this.listeners.size) return;
    if (
      typeof window === "undefined" ||
      typeof requestAnimationFrame !== "function" ||
      typeof cancelAnimationFrame !== "function"
    ) {
      for (const listener of this.listeners) listener();
      return;
    }
    this.publicationPending = true;
    // Hidden tabs can suspend animation frames; keep publication bounded.
    this.publicationTimer = setTimeout(this.flush, 50);
    this.publicationFrame = requestAnimationFrame(this.flush);
  }
}
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
