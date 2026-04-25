/* ═══════════════════════════════════════════════════════════════════════════
   Client-side fetch helper — AbortController timeout + in-memory cache + retry
   Reintenta automaticamente en errores transitorios (5xx, timeout, network).
   ═══════════════════════════════════════════════════════════════════════════ */

const CACHE_TTL = 5 * 60 * 1000;
const DEFAULT_TIMEOUT = 15_000;
const DEFAULT_RETRIES = 1;
const RETRY_DELAY_BASE = 600;

interface CacheEntry<T> {
  data: T;
  ts: number;
}

const cache = new Map<string, CacheEntry<unknown>>();

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function isRetriable(err: unknown, status: number | null): boolean {
  if (status != null && status >= 500) return true;
  if (status === 408 || status === 429) return true;
  if (err instanceof TypeError) return true;
  if (err instanceof Error && /timeout|aborted|network/i.test(err.message)) return true;
  return false;
}

export async function clientFetch<T = unknown>(
  url: string,
  opts: { timeout?: number; skipCache?: boolean; signal?: AbortSignal; retries?: number } = {},
): Promise<T> {
  const {
    timeout = DEFAULT_TIMEOUT,
    skipCache = false,
    signal: externalSignal,
    retries = DEFAULT_RETRIES,
  } = opts;

  if (!skipCache) {
    const cached = cache.get(url);
    if (cached && Date.now() - cached.ts < CACHE_TTL) {
      return cached.data as T;
    }
  }

  let lastErr: unknown = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (externalSignal?.aborted) {
      throw new DOMException('The operation was aborted.', 'AbortError');
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    const onExternalAbort = () => controller.abort();
    externalSignal?.addEventListener('abort', onExternalAbort);

    let httpStatus: number | null = null;

    try {
      const res = await fetch(url, { signal: controller.signal });
      httpStatus = res.status;
      if (!res.ok) throw new Error(`API ${res.status}: ${res.statusText}`);
      const data = (await res.json()) as T;
      cache.set(url, { data, ts: Date.now() });
      return data;
    } catch (err: unknown) {
      lastErr = err;

      if (externalSignal?.aborted) {
        return new Promise<T>(() => {});
      }

      const isAbort = err instanceof DOMException && err.name === 'AbortError';
      const canRetry = attempt < retries && (isAbort || isRetriable(err, httpStatus));

      if (!canRetry) {
        if (isAbort && !externalSignal?.aborted) {
          return new Promise<T>(() => {});
        }
        throw err;
      }

      const delay = RETRY_DELAY_BASE * Math.pow(2, attempt);
      await sleep(delay);
    } finally {
      clearTimeout(timer);
      externalSignal?.removeEventListener('abort', onExternalAbort);
    }
  }

  throw lastErr instanceof Error ? lastErr : new Error('clientFetch: unknown error');
}

export function buildFilterQs(
  league: string,
  filters: { year?: number | null; split?: string | null; stage?: string | null },
): string {
  const qs = new URLSearchParams();
  qs.set('league', league.toUpperCase());
  if (filters.year) qs.set('year', String(filters.year));
  if (filters.split) qs.set('split', filters.split);
  if (filters.stage && filters.stage !== 'all') qs.set('stage', filters.stage);
  return qs.toString();
}
