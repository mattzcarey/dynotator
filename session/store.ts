/** The subset of `ctx.storage.kv` (SQLite-backed, synchronous) the session server uses. */
export interface Store {
  get<T = unknown>(key: string): T | undefined;
  put<T>(key: string, value: T): void;
  delete(key: string): boolean;
  list<T = unknown>(options?: { prefix?: string }): Iterable<[string, T]>;
}

/** An in-memory `Store` with the same semantics, for tests. */
export class MemoryStore implements Store {
  private readonly data = new Map<string, unknown>();

  get<T>(key: string): T | undefined {
    return structuredClone(this.data.get(key)) as T | undefined;
  }

  put<T>(key: string, value: T): void {
    this.data.set(key, structuredClone(value));
  }

  delete(key: string): boolean {
    return this.data.delete(key);
  }

  *list<T>(options?: { prefix?: string }): Iterable<[string, T]> {
    const prefix = options?.prefix ?? "";
    for (const key of [...this.data.keys()].toSorted()) {
      if (key.startsWith(prefix)) yield [key, structuredClone(this.data.get(key)) as T];
    }
  }
}
