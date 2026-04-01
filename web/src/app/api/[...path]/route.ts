/**
 * Catch-all API proxy route handler.
 *
 * AWS Amplify WEB_COMPUTE does not reliably proxy Next.js rewrites to
 * external URLs (App Runner).  This Route Handler receives every
 * `/api/*` request from the client, fetches the real backend, and
 * streams the response back — all server-side, no CORS needed.
 */

import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL = (() => {
  const raw = process.env.NEXT_PUBLIC_API_URL; // e.g. https://…apprunner.com/api/v1
  if (raw) return raw.replace(/\/api\/v1\/?$/, '');  // strip /api/v1 → base
  return 'http://localhost:3001';
})();

export const dynamic = 'force-dynamic';   // never cache proxy responses at edge
export const runtime = 'nodejs';           // needs node fetch, not edge

async function proxy(request: NextRequest, pathSegments: string[]) {
  const path = pathSegments.join('/');
  const qs = request.nextUrl.searchParams.toString();
  const target = `${BACKEND_URL}/api/${path}${qs ? `?${qs}` : ''}`;

  try {
    const upstream = await fetch(target, {
      method: request.method,
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        // Forward useful headers
        ...(request.headers.get('accept-language')
          ? { 'Accept-Language': request.headers.get('accept-language')! }
          : {}),
      },
      // Don't cache at the Node.js level either
      cache: 'no-store',
    });

    const body = await upstream.text();

    return new NextResponse(body, {
      status: upstream.status,
      headers: {
        'Content-Type': upstream.headers.get('content-type') || 'application/json',
        // Forward cache headers from backend
        ...(upstream.headers.get('cache-control')
          ? { 'Cache-Control': upstream.headers.get('cache-control')! }
          : {}),
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error(`[API Proxy] Failed to reach backend: ${target}`, message);
    return NextResponse.json(
      { error: 'Backend unreachable', detail: message },
      { status: 502 },
    );
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  return proxy(request, path);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  return proxy(request, path);
}
