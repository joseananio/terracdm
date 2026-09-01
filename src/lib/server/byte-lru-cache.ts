type CacheEntry<Value> = { value: Value; bytes: number };

export class ByteLruCache<Key, Value> {
  private readonly entries = new Map<Key, CacheEntry<Value>>();
  private usedBytes = 0;

  constructor(
    readonly maxBytes: number,
    private readonly sizeOf: (value: Value, key: Key) => number,
  ) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new RangeError("Cache byte budget must be a positive safe integer");
  }

  get size() {
    return this.entries.size;
  }

  get byteSize() {
    return this.usedBytes;
  }

  get(key: Key) {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: Key, value: Value) {
    const bytes = Math.ceil(this.sizeOf(value, key));
    if (!Number.isSafeInteger(bytes) || bytes < 0) throw new RangeError("Cached value size must be a non-negative safe integer");

    this.delete(key);
    if (bytes > this.maxBytes) return false;

    this.entries.set(key, { value, bytes });
    this.usedBytes += bytes;
    while (this.usedBytes > this.maxBytes) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.delete(oldest.value);
    }
    return true;
  }

  delete(key: Key) {
    const entry = this.entries.get(key);
    if (!entry) return false;
    this.entries.delete(key);
    this.usedBytes -= entry.bytes;
    return true;
  }

  clear() {
    this.entries.clear();
    this.usedBytes = 0;
  }
}
