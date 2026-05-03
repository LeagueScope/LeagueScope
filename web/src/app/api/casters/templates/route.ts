/**
 * GET /api/casters/templates
 * Devuelve la lista de plantillas disponibles (id, label, params, etc.)
 * Solo accesible si estás autenticado.
 */

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { CASTER_COOKIE_NAME, verifyCasterJwt } from '@/lib/casterAuth';
import { listTemplates } from '@/lib/casterTemplates';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const jar = await cookies();
  const identity = await verifyCasterJwt(jar.get(CASTER_COOKIE_NAME)?.value);
  if (!identity) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const templates = listTemplates().map((t) => ({
    id: t.id,
    label: t.label,
    description: t.description,
    category: t.category,
    params: t.params,
  }));
  return NextResponse.json({ templates });
}
