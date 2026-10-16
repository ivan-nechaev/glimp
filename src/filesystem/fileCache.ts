export class FileCache {
  private readonly entries = new Map<string, Uint8Array>();
  private size = 0;

  constructor(private readonly limit = 32 * 1024 * 1024) {}

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

    if (value.byteLength > this.limit) {
      return;
    }

    this.entries.set(key, value);
    this.size += value.byteLength;

    for (const [oldestKey, oldestValue] of this.entries) {
      if (this.size <= this.limit) {
        break;
      }

      this.entries.delete(oldestKey);
      this.size -= oldestValue.byteLength;
    }
  }
}
