/**
 * Catch-all API proxy route handler.
 *
 * AWS Amplify WEB_COMPUTE does not reliably proxy Next.js rewrites to
 * external URLs (App Runner). This Route Handler receives every
 * `/api/*` request from the client, fetches the real backend, and
 * streams the response back — all server-side, no CORS needed.
 */

import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL = (() => {
  const raw = process.env.NEXT_PUBLIC_API_URL;
  if (raw) return raw.replace(/\/api\/v1\/?$/, '');
  return 'http://localhost:3001';
})();

const UPSTREAM_TIMEOUT_MS = 10_000;

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function proxy(request: NextRequest, pathSegments: string[]) {
  // Defensa: rechaza segmentos sospechosos (..  /  \\  ?  #) — Next.js normaliza
  // pero no cuesta nada blindar.
  if (pathSegments.some((s) => /[\\?#]|\.\./.test(s))) {
    return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
  }

  const path = pathSegments.join('/');
  const qs = request.nextUrl.searchParams.toString();
  const target = `${BACKEND_URL}/api/${path}${qs ? `?${qs}` : ''}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  try {
    const upstream = await fetch(target, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        ...(request.headers.get('accept-language')
          ? { 'Accept-Language': request.headers.get('accept-language')! }
          : {}),
      },
      cache: 'no-store',
      signal: controller.signal,
    });

    const body = await upstream.text();

    return new NextResponse(body, {
      status: upstream.status,
      headers: {
        'Content-Type': upstream.headers.get('content-type') || 'application/json',
        ...(upstream.headers.get('cache-control')
          ? { 'Cache-Control': upstream.headers.get('cache-control')! }
          : {}),
        ...(process.env.NODE_ENV === 'development'
          ? { 'X-Proxy-Target': target, 'X-Proxy-Status': String(upstream.status) }
          : {}),
      },
    });
  } catch (err: unknown) {
    const isAbort = err instanceof Error && err.name === 'AbortError';
    const message = err instanceof Error ? err.message : 'Unknown error';
    const isDev = process.env.NODE_ENV === 'development';

    // En prod: log SOLO el path, no el target completo (no expongas URL interna)
    if (isDev) {
      console.error(`[API Proxy] Failed: ${target}`, message);
    } else {
      console.error(`[API Proxy] Failed: /api/${path} (${isAbort ? 'timeout' : 'network'})`);
    }

    return NextResponse.json(
      isDev
        ? { error: isAbort ? 'Backend timeout' : 'Backend unreachable', detail: message, target }
        : { error: 'Service temporarily unavailable' },
      { status: isAbort ? 504 : 502 },
    );
  } finally {
    clearTimeout(timer);
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  return proxy(request, path);
}

// Backend público es solo GET. Bloqueamos el resto explícitamente.
export async function POST() {
  return NextResponse.json({ error: 'Method not allowed' }, { status: 405 });
}
