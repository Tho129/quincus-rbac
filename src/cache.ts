interface Entry {
  value: string[];
  expiresAt: number;
}

/**
 * Per-process cache of resolved permissions, keyed by tenant + user + groups.
 * Admin changes clear the tenant's entries in this process at once; other
 * processes (serverless instances, pods) see the change within `ttlMs`.
 */
export class PermissionCache {
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries = 10_000,
    private readonly now: () => number = Date.now,
  ) {}

  get enabled(): boolean {
    return this.ttlMs > 0;
  }

  get(tenantId: string, userId: string, groups: readonly string[]): string[] | undefined {
    if (!this.enabled) return undefined;
    const key = cacheKey(tenantId, userId, groups);
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(tenantId: string, userId: string, groups: readonly string[], value: string[]): void {
    if (!this.enabled) return;
    if (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    this.entries.set(cacheKey(tenantId, userId, groups), { value, expiresAt: this.now() + this.ttlMs });
  }

  invalidate(tenantId?: string): void {
    if (tenantId === undefined) {
      this.entries.clear();
      return;
    }
    const prefix = `${tenantId}\u0000`;
    for (const key of this.entries.keys()) {
      if (key.startsWith(prefix)) this.entries.delete(key);
    }
  }
}

function cacheKey(tenantId: string, userId: string, groups: readonly string[]): string {
  return `${tenantId}\u0000${userId}\u0000${[...groups].sort().join("\u0001")}`;
}
