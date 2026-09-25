type CacheEntry<T> = {
  hasValue: boolean;
  value?: T;
  updatedAt: number;
  promise?: Promise<T>;
};

type CacheOptions = {
  maxAge?: number;
  force?: boolean;
};

const dashboardCache = new Map<string, CacheEntry<unknown>>();

export function peekDashboardCache<T>(key: string): T | undefined {
  const entry = dashboardCache.get(key) as CacheEntry<T> | undefined;
  return entry?.hasValue ? entry.value : undefined;
}

export function setDashboardCache<T>(key: string, value: T): T {
  dashboardCache.set(key, { hasValue: true, value, updatedAt: Date.now() });
  return value;
}

export function invalidateDashboardCache(key: string) {
  dashboardCache.delete(key);
}

export function clearDashboardCache() {
  dashboardCache.clear();
}

export async function dashboardRequest<T>(key: string, loader: () => Promise<T>, options: CacheOptions = {}): Promise<T> {
  const maxAge = options.maxAge ?? 60_000;
  const existing = dashboardCache.get(key) as CacheEntry<T> | undefined;
  if (!options.force && existing?.hasValue && Date.now() - existing.updatedAt < maxAge) return existing.value as T;
  if (existing?.promise) return existing.promise;

  const entry: CacheEntry<T> = existing || { hasValue: false, updatedAt: 0 };
  const promise = loader().then((value) => {
    dashboardCache.set(key, { hasValue: true, value, updatedAt: Date.now() });
    return value;
  }).finally(() => {
    const current = dashboardCache.get(key) as CacheEntry<T> | undefined;
    if (current?.promise === promise) {
      const { promise: _promise, ...settled } = current;
      dashboardCache.set(key, settled);
    }
  });
  dashboardCache.set(key, { ...entry, promise });
  return promise;
}