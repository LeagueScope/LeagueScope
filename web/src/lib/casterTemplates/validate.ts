/**
 * validate.ts — Strict type validation for caster template params.
 *
 * Each template declares its `params` schema. Before running the SQL we run
 * the user-supplied values through this validator. Anything that doesn't
 * match the declared schema → throws ValidationError → 400 to the client.
 *
 * This is the second line of defense (the first is parametrized SQL).
 */

export type ParamType = 'string' | 'int' | 'enum';

export interface ParamDef {
  name: string;
  type: ParamType;
  label: string;
  /** Para type='enum': lista de valores permitidos */
  values?: readonly string[];
  /** Para type='string': longitud máxima (default 50) */
  maxLength?: number;
  /** Para type='int': mínimo */
  min?: number;
  /** Para type='int': máximo */
  max?: number;
  /** Si false, el param es obligatorio (default true requerido) */
  optional?: boolean;
  /** Texto de ayuda mostrado en la UI */
  hint?: string;
}

export class ValidationError extends Error {
  constructor(public field: string, message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export function validateParams(
  schema: readonly ParamDef[],
  raw: Record<string, unknown>,
): Record<string, string | number> {
  const out: Record<string, string | number> = {};

  for (const def of schema) {
    const v = raw[def.name];
    const isMissing = v == null || v === '';

    if (isMissing) {
      if (def.optional) continue;
      throw new ValidationError(def.name, `Falta el parámetro "${def.label}"`);
    }

    if (def.type === 'string') {
      if (typeof v !== 'string') {
        throw new ValidationError(def.name, `"${def.label}" debe ser texto`);
      }
      const max = def.maxLength ?? 50;
      if (v.length > max) {
        throw new ValidationError(def.name, `"${def.label}" demasiado largo (max ${max})`);
      }
      // Defensa adicional: rechazar caracteres de control y comillas raras
      if (/[\x00-\x1f]/.test(v)) {
        throw new ValidationError(def.name, `"${def.label}" contiene caracteres no permitidos`);
      }
      out[def.name] = v;
    } else if (def.type === 'int') {
      const n = typeof v === 'number' ? v : parseInt(String(v), 10);
      if (!Number.isFinite(n) || !Number.isInteger(n)) {
        throw new ValidationError(def.name, `"${def.label}" debe ser un número entero`);
      }
      if (def.min != null && n < def.min) {
        throw new ValidationError(def.name, `"${def.label}" debe ser >= ${def.min}`);
      }
      if (def.max != null && n > def.max) {
        throw new ValidationError(def.name, `"${def.label}" debe ser <= ${def.max}`);
      }
      out[def.name] = n;
    } else if (def.type === 'enum') {
      if (!def.values || !def.values.includes(String(v))) {
        throw new ValidationError(
          def.name,
          `"${def.label}" debe ser uno de: ${def.values?.join(', ') ?? '(ninguno)'}`,
        );
      }
      out[def.name] = String(v);
    }
  }

  return out;
}
