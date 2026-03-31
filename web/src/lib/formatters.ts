/**
 * formatters.ts
 * ═════════════════════════════════════════════════════════════════════════════
 * Unified cell formatting logic for Pro Vision tables (Players, Champions, etc.)
 * ═════════════════════════════════════════════════════════════════════════════
 */

export interface ColDef {
  key: string;
  label: string;
  type: string;
  tip: string;
}

export interface AllCol extends ColDef {
  group: string;
}

/** Check if a cell has data (not undefined or null) */
export function cellHasData(item: Record<string, unknown>, col: ColDef): boolean {
  const v = item[col.key];
  return v !== undefined && v !== null;
}

/** Format a cell value based on its type */
export function cellVal(item: Record<string, unknown>, col: ColDef): string {
  const v = item[col.key];
  if (v !== undefined && v !== null) {
    switch (col.type) {
      case 'str':
        return String(v);

      case 'pct':
      case 'pct_kp':
      case 'pct_obj':
      case 'pct_share':
      case 'pct_side_b':
      case 'pct_side_r':
        return typeof v === 'number' ? v.toFixed(1) + '%' : String(v);

      case 'float1':
        return typeof v === 'number' ? v.toFixed(1) : String(v);

      case 'kda_val':
        return typeof v === 'number' ? v.toFixed(2) : String(v);

      case 'gpm':
      case 'big_int':
        return typeof v === 'number' ? Math.round(v).toLocaleString() : String(v);

      case 'cspm':
      case 'wpm':
      case 'vspm':
        return typeof v === 'number' ? v.toFixed(1) : String(v);

      case 'int':
      case 'int_s':
        return typeof v === 'number' ? String(Math.round(v)) : String(v);

      case 'diff':
        return typeof v === 'number' ? (v >= 0 ? '+' : '') + v.toFixed(1) : String(v);

      case 'diff_big':
      case 'diff_sm':
        return typeof v === 'number' ? (v >= 0 ? '+' : '') + v.toFixed(0) : String(v);

      default:
        return String(v);
    }
  }
  return '—';
}

/** Get CSS class for a cell based on its value and type */
export function cellCls(val: string, col: ColDef, hasData: boolean, prefix = ''): string {
  if (!hasData) return `${prefix}cv-na`;

  const { type } = col;

  if (['diff', 'diff_big', 'diff_sm'].includes(type)) {
    const n = parseFloat(String(val).replace('+', ''));
    if (n > 0) return `${prefix}cv-pos`;
    if (n < 0) return `${prefix}cv-neg`;
    return `${prefix}cv-zero`;
  }

  if (type === 'kda_val') {
    const n = parseFloat(val);
    if (n >= 4) return `${prefix}cv-pos`;
    if (n >= 2.5) return `${prefix}cv-mid`;
    return `${prefix}cv-neg`;
  }

  if (type === 'pct_kp') {
    const n = parseFloat(val);
    if (n > 60) return `${prefix}cv-pos`;
    if (n < 40) return `${prefix}cv-neg`;
    return '';
  }

  if (type === 'pct_obj') {
    const n = parseFloat(val);
    if (n > 55) return `${prefix}cv-pos`;
    if (n < 30) return `${prefix}cv-neg`;
    return '';
  }

  if (type === 'pct_side_b') return `${prefix}cv-blue`;
  if (type === 'pct_side_r') return `${prefix}cv-red`;

  return '';
}
