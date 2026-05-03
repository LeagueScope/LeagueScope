/**
 * Registry de plantillas de casters.
 *
 * Cada plantilla expone:
 *  - id (string)        — identificador único, lo que viaja en la API
 *  - label (string)     — nombre legible para la UI
 *  - description        — explicación corta
 *  - category           — agrupación en el sidebar (ej: "Equipos", "Jugadores")
 *  - params (ParamDef[])— esquema de parámetros (validados antes de ejecutar)
 *  - run (params)       — función async que ejecuta la query y devuelve el resultado
 *
 * Para añadir una plantilla nueva:
 *  1. Crea un fichero en `templates/`
 *  2. Impórtalo aquí y añádelo al array TEMPLATES.
 */

import type { ParamDef } from './validate';
import { teamWinsInSplit } from './templates/teamWinsInSplit';

export interface CasterTemplate {
  id: string;
  label: string;
  description: string;
  category: string;
  params: readonly ParamDef[];
  run: (params: Record<string, string | number>) => Promise<unknown>;
}

const TEMPLATES_LIST: readonly CasterTemplate[] = [
  teamWinsInSplit,
] as const;

const TEMPLATES_BY_ID: Record<string, CasterTemplate> = Object.fromEntries(
  TEMPLATES_LIST.map((t) => [t.id, t]),
);

export function listTemplates(): CasterTemplate[] {
  return [...TEMPLATES_LIST];
}

export function getTemplate(id: string): CasterTemplate | undefined {
  return TEMPLATES_BY_ID[id];
}
