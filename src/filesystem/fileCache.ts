export class FileCache {
  private readonly entries = new Map<string, Uint8Array>();
  private size = 0;

  constructor(private limit = 32 * 1024 * 1024) {}

  resize(limit: number): void {
    this.limit = limit;
    this.evict();
  }

  get(key: string): Uint8Array | undefined {
    const value = this.entries.get(key);

    if (value) {
      this.entries.delete(key);
      this.entries.set(key, value);
    }

    return value;
  }

  set(key: string, value: Uint8Array): void {
    const previous = this.entries.get(key);

    if (previous) {
      this.size -= previous.byteLength;
      this.entries.delete(key);
    }

    if (this.limit === 0 || value.byteLength > this.limit) {
      return;
    }

    this.entries.set(key, value);
    this.size += value.byteLength;

    this.evict();
  }

  private evict(): void {
    if (this.limit === 0) {
      this.entries.clear();
      this.size = 0;
      return;
    }

    for (const [oldestKey, oldestValue] of this.entries) {
      if (this.size <= this.limit) {
        break;
      }

      this.entries.delete(oldestKey);
      this.size -= oldestValue.byteLength;
    }
  }
}
