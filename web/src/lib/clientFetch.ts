/* ═══════════════════════════════════════════════════════════════════════════
   Client-side fetch helper — AbortController timeout + in-memory cache
   Mirrors frontend/src/utils/api.js caching & timeout behaviour
   ═══════════════════════════════════════════════════════════════════════════ */

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const DEFAULT_TIMEOUT = 15_000;   // 15 seconds

interface CacheEntry<T> {
  data: T;
  ts: number;
}

const cache = new Map<string, CacheEntry<unknown>>();

/**
 * Fetch JSON from a client-side API endpoint with:
 * - AbortController timeout (default 15s)
 * - In-memory cache with 5-minute TTL
 * - Automatic JSON parsing
 *
 * @param url  Full URL or path (e.g. `/api/v1/pg/overview?league=LEC`)
 * @param opts.timeout  Timeout in ms (default 15000)
 * @param opts.skipCache  Bypass cache for this request
 * @param opts.signal  External AbortSignal (e.g. from useEffect cleanup)
 */
export async function clientFetch<T = unknown>(
  url: string,
  opts: { timeout?: number; skipCache?: boolean; signal?: AbortSignal } = {},
): Promise<T> {
  const { timeout = DEFAULT_TIMEOUT, skipCache = false, signal: externalSignal } = opts;

  // ── Check cache ────────────────────────────────────────────────────────
  if (!skipCache) {
    const cached = cache.get(url);
    if (cached && Date.now() - cached.ts < CACHE_TTL) {
      return cached.data as T;
    }
  }

  // ── Fetch with timeout ─────────────────────────────────────────────────
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  // Combine external signal (useEffect cleanup) with our timeout signal
  if (externalSignal?.aborted) {
    clearTimeout(timer);
    controller.abort();
    throw new DOMException('The operation was aborted.', 'AbortError');
  }
  const onExternalAbort = () => controller.abort();
  externalSignal?.addEventListener('abort', onExternalAbort);

  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`API ${res.status}: ${res.statusText}`);
    const data = (await res.json()) as T;

    // ── Store in cache ─────────────────────────────────────────────────
    cache.set(url, { data, ts: Date.now() });

    return data;
  } catch (err: unknown) {
    // Silently swallow AbortError — normal during React StrictMode remounts / useEffect cleanup
    if (err instanceof DOMException && err.name === 'AbortError') {
      return new Promise<T>(() => {}); // never resolves — component is unmounting
    }
    throw err;
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener('abort', onExternalAbort);
  }
}

/** Build query string from filter params + league */
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
