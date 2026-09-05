export class CompletionBatcher<T> {
  readonly #flushCallback: (items: T[]) => void;
  readonly #debounceMs: number;
  readonly #maxWaitMs: number;
  #items: T[] = [];
  #debounceTimer?: ReturnType<typeof setTimeout>;
  #maxWaitTimer?: ReturnType<typeof setTimeout>;
  #disposed = false;

  constructor(flushCallback: (items: T[]) => void, debounceMs = 100, maxWaitMs = 500) {
    this.#flushCallback = flushCallback;
    this.#debounceMs = debounceMs;
    this.#maxWaitMs = maxWaitMs;
  }

  add(item: T): void {
    if (this.#disposed) return;
    this.#items.push(item);
    if (this.#debounceTimer) clearTimeout(this.#debounceTimer);
    this.#debounceTimer = setTimeout(() => this.flush(), this.#debounceMs);
    this.#maxWaitTimer ??= setTimeout(() => this.flush(), this.#maxWaitMs);
  }

  flush(): void {
    if (this.#debounceTimer) clearTimeout(this.#debounceTimer);
    if (this.#maxWaitTimer) clearTimeout(this.#maxWaitTimer);
    this.#debounceTimer = undefined;
    this.#maxWaitTimer = undefined;
    if (this.#items.length === 0) return;
    const items = this.#items;
    this.#items = [];
    try {
      this.#flushCallback(items);
    } catch (error) {
      console.error("Completion batch callback failed:", error);
    }
  }

  dispose(): void {
    this.#disposed = true;
    if (this.#debounceTimer) clearTimeout(this.#debounceTimer);
    if (this.#maxWaitTimer) clearTimeout(this.#maxWaitTimer);
    this.#debounceTimer = undefined;
    this.#maxWaitTimer = undefined;
    this.#items = [];
  }
}
