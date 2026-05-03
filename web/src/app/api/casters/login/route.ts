/**
 * POST /api/casters/login
 * Body: { username, password }
 * Set cookie ls_caster on success, returns { ok: true, user: {...} }.
 *
 * 401 si credenciales inválidas.
 * Constant-time comparison vía bcrypt para evitar timing attacks.
 */

import { NextResponse } from 'next/server';
import { verifyCasterCredentials, signCasterJwt, buildCasterCookie } from '@/lib/casterAuth';

export const runtime = 'nodejs'; // bcryptjs y pg necesitan Node runtime
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  let body: { username?: unknown; password?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Cuerpo inválido' }, { status: 400 });
  }

  const username = String(body.username || '').toLowerCase().trim();
  const password = String(body.password || '');

  if (!username || !password) {
    return NextResponse.json({ error: 'Faltan credenciales' }, { status: 400 });
  }

  const identity = await verifyCasterCredentials(username, password);
  if (!identity) {
    return NextResponse.json({ error: 'Credenciales incorrectas' }, { status: 401 });
  }

  const token = await signCasterJwt(identity);
  const res = NextResponse.json({
    ok: true,
    user: {
      id: identity.id,
      username: identity.username,
      display_name: identity.display_name,
    },
  });
  res.cookies.set(buildCasterCookie(token));
  return res;
}
