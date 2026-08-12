const globalCache = globalThis as typeof globalThis & { __socraticIdempotency?: Map<string, Promise<unknown>> };
const cache = globalCache.__socraticIdempotency ?? new Map<string, Promise<unknown>>();
globalCache.__socraticIdempotency = cache;

export function withIdempotency<T>(key: string, action: () => Promise<T>): Promise<T> {
  const existing = cache.get(key) as Promise<T> | undefined;
  if (existing) return existing;
  const promise = action().catch((error) => {
    cache.delete(key);
    throw error;
  });
  cache.set(key, promise);
  if (cache.size > 500) cache.delete(cache.keys().next().value as string);
  return promise;
}
