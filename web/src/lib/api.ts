/**
 * Server-side API utility for fetching data from the Express backend.
 * Used in Server Components and Route Handlers.
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';

interface FetchOptions {
  revalidate?: number; // ISR: seconds before revalidation (0 = no cache)
  tags?: string[];     // Cache tags for on-demand revalidation
}

export async function api<T = unknown>(
  endpoint: string,
  options: FetchOptions = {},
): Promise<T> {
  const url = `${API_BASE}${endpoint}`;
  const { revalidate = 300, tags } = options; // Default: revalidate every 5 min

  const res = await fetch(url, {
    next: {
      revalidate,
      ...(tags ? { tags } : {}),
    },
  });

  if (!res.ok) {
    throw new Error(`API error ${res.status}: ${url}`);
  }

  return res.json() as Promise<T>;
}

/**
 * Build query string from league + filters.
 * Mirrors the frontend buildQuery() utility.
 */
export function buildQuery(
  league: string,
  filters?: { year?: string; split?: string; stage?: string },
  extra?: Record<string, string>,
): string {
  const params = new URLSearchParams({ league });
  if (filters?.year)  params.set('year', filters.year);
  if (filters?.split) params.set('split', filters.split);
  if (filters?.stage) params.set('stage', filters.stage);
  if (extra) {
    Object.entries(extra).forEach(([k, v]) => params.set(k, v));
  }
  return `?${params.toString()}`;
}
