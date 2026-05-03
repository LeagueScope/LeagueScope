/**
 * GET /api/casters/me
 * Devuelve { user: {id, username, display_name} } si la cookie es válida.
 * 401 si no.
 */

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { CASTER_COOKIE_NAME, verifyCasterJwt } from '@/lib/casterAuth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const jar = await cookies();
  const token = jar.get(CASTER_COOKIE_NAME)?.value;
  const identity = await verifyCasterJwt(token);
  if (!identity) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  }
  return NextResponse.json({
    user: {
      id: identity.id,
      username: identity.username,
      display_name: identity.display_name,
    },
  });
}
