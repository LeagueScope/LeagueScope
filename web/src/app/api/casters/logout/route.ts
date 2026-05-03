/**
 * POST /api/casters/logout
 * Borra la cookie ls_caster (max-age=0). Siempre devuelve 200.
 */

import { NextResponse } from 'next/server';
import { buildClearCasterCookie } from '@/lib/casterAuth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(buildClearCasterCookie());
  return res;
}
