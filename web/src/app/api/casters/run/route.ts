/**
 * POST /api/casters/run
 * Body: { templateId, params }
 * Ejecuta una plantilla y devuelve el resultado.
 *
 * Capas de seguridad:
 *  - JWT cookie obligatoria (auth)
 *  - templateId existe en el registry (no SQL libre del cliente)
 *  - Validación estricta de params (tipos, enums, longitudes) antes de tocar BD
 *  - La query usa siempre $1, $2... (parametrizada, sin string concat)
 *  - El pool es streamer_ro (SELECT-only, sin acceso a auth.*, timeout 5s)
 *  - Log en auth.caster_query_log (auditoría con user_id, params, duración)
 */

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { CASTER_COOKIE_NAME, verifyCasterJwt } from '@/lib/casterAuth';
import { getTemplate } from '@/lib/casterTemplates';
import { validateParams, ValidationError } from '@/lib/casterTemplates/validate';
import { adminPool } from '@/lib/casterDb';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  // 1. Auth
  const jar = await cookies();
  const identity = await verifyCasterJwt(jar.get(CASTER_COOKIE_NAME)?.value);
  if (!identity) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  // 2. Parse body
  let body: { templateId?: unknown; params?: unknown };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Cuerpo inválido' }, { status: 400 });
  }
  const templateId = String(body.templateId || '');
  const rawParams = (body.params && typeof body.params === 'object')
    ? (body.params as Record<string, unknown>)
    : {};

  // 3. Lookup template
  const template = getTemplate(templateId);
  if (!template) {
    return NextResponse.json({ error: 'Plantilla no encontrada' }, { status: 404 });
  }

  // 4. Validate params
  let params: Record<string, string | number>;
  try {
    params = validateParams(template.params, rawParams);
  } catch (err) {
    if (err instanceof ValidationError) {
      return NextResponse.json({ error: err.message, field: err.field }, { status: 400 });
    }
    throw err;
  }

  // 5. Run + log (best-effort)
  const t0 = Date.now();
  let result: unknown;
  let errorMsg: string | null = null;
  try {
    result = await template.run(params);
  } catch (err) {
    errorMsg = err instanceof Error ? err.message : 'Error ejecutando query';
    // Log el error igualmente
  }
  const durationMs = Date.now() - t0;

  // Log de auditoría (no bloqueante)
  adminPool
    .query(
      `INSERT INTO auth.caster_query_log
        (user_id, template_id, params, duration_ms, result_count, error)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        identity.id,
        templateId,
        JSON.stringify(params),
        durationMs,
        Array.isArray(result) ? result.length : (result ? 1 : 0),
        errorMsg,
      ],
    )
    .catch(() => undefined);

  if (errorMsg) {
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }

  return NextResponse.json({
    templateId,
    params,
    result,
    duration_ms: durationMs,
  });
}
