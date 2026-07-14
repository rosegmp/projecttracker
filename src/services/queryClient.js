function normalizeKey(key) {
  return Array.isArray(key) ? key.map((part) => String(part)) : [String(key)];
}

function serializeKey(key) {
  return JSON.stringify(normalizeKey(key));
}

function keyStartsWith(key, prefix) {
  const normalizedKey = normalizeKey(key);
  const normalizedPrefix = normalizeKey(prefix);
  return normalizedPrefix.every((part, index) => normalizedKey[index] === part);
}

function defaultRetryDelay(attempt) {
  return Math.min(2500, 300 * (2 ** attempt));
}

export function isRetryableQueryError(error) {
  const status = Number(error?.status || error?.cause?.status) || 0;
  if ([400, 401, 403, 404, 409, 422].includes(status)) return false;
  const code = String(error?.code || '').toLowerCase();
  if (code === 'concurrency-conflict') return false;
  return true;
}

export class QueryClient {
  constructor() {
    this.cache = new Map();
    this.mutations = new Map();
    this.listeners = new Set();
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify() {
    this.listeners.forEach((listener) => listener());
  }

  getQueryData(key) {
    return this.cache.get(serializeKey(key))?.data;
  }

  setQueryData(key, data) {
    const parts = normalizeKey(key);
    this.cache.set(serializeKey(parts), { key: parts, data, updatedAt: Date.now(), promise: null, error: null });
    this.notify();
    return data;
  }

  invalidateQueries(prefix) {
    let invalidated = 0;
    this.cache.forEach((entry, serialized) => {
      if (!keyStartsWith(entry.key, prefix)) return;
      this.cache.set(serialized, { ...entry, updatedAt: 0 });
      invalidated += 1;
    });
    if (invalidated) this.notify();
    return invalidated;
  }

  clear() {
    this.cache.clear();
    this.mutations.clear();
    this.notify();
  }

  async query({ key, queryFn, staleTime = 15000, retry = 2, retryDelay = defaultRetryDelay, force = false }) {
    const parts = normalizeKey(key);
    const serialized = serializeKey(parts);
    const cached = this.cache.get(serialized);
    if (cached?.promise) return cached.promise;
    if (!force && cached && Date.now() - cached.updatedAt < staleTime) return cached.data;

    const promise = (async () => {
      let attempt = 0;
      while (true) {
        try {
          const data = await queryFn({ attempt });
          this.cache.set(serialized, { key: parts, data, updatedAt: Date.now(), promise: null, error: null });
          this.notify();
          return data;
        } catch (error) {
          if (attempt >= retry || !isRetryableQueryError(error)) {
            this.cache.set(serialized, { key: parts, data: cached?.data, updatedAt: 0, promise: null, error });
            this.notify();
            throw error;
          }
          const delay = typeof retryDelay === 'function' ? retryDelay(attempt, error) : retryDelay;
          if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
          attempt += 1;
        }
      }
    })();

    this.cache.set(serialized, { key: parts, data: cached?.data, updatedAt: cached?.updatedAt || 0, promise, error: null });
    this.notify();
    return promise;
  }

  getMutationState(prefix = []) {
    const matching = Array.from(this.mutations.values()).filter((entry) => keyStartsWith(entry.key, prefix));
    return {
      pending: matching.some((entry) => entry.pending > 0),
      count: matching.reduce((total, entry) => total + entry.pending, 0),
      error: matching.find((entry) => entry.error)?.error || null,
    };
  }

  async mutate({ key, mutationFn, invalidate = [] }) {
    const parts = normalizeKey(key);
    const serialized = serializeKey(parts);
    const current = this.mutations.get(serialized) || { key: parts, pending: 0, error: null };
    this.mutations.set(serialized, { ...current, pending: current.pending + 1, error: null });
    this.notify();
    try {
      const result = await mutationFn();
      invalidate.forEach((prefix) => this.invalidateQueries(prefix));
      return result;
    } catch (error) {
      const latest = this.mutations.get(serialized) || current;
      this.mutations.set(serialized, { ...latest, error });
      this.notify();
      throw error;
    } finally {
      const latest = this.mutations.get(serialized) || current;
      this.mutations.set(serialized, { ...latest, pending: Math.max(0, latest.pending - 1) });
      this.notify();
    }
  }
}

export const trackerQueryClient = new QueryClient();
