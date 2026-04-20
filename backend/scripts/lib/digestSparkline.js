/**
 * digestSparkline.js — Generador de mini-gráficos SVG inline para email.
 *
 * Requisitos del entorno de correo:
 *   - Gmail y Outlook soportan SVG inline (no <img src="data:">)
 *   - Sin clases CSS externas, todo inline
 *   - Sin JS, sin animaciones
 *   - Fondo transparente, color configurable
 *
 * Input: array de números (uno por punto).
 * Output: string con <svg>…</svg> listo para pegar en un td.
 */

/**
 * @param {number[]} values - serie de puntos (0..n), el más antiguo primero.
 * @param {object} opts
 * @param {number} [opts.width=120]
 * @param {number} [opts.height=24]
 * @param {string} [opts.stroke='#2563eb']
 * @param {string} [opts.fill='none']
 * @param {boolean} [opts.area=true] — rellena bajo la curva con stroke a 10% opacity
 * @param {boolean} [opts.showLast=true] — muestra punto gordo en el último valor
 * @param {string} [opts.emptyLabel='—'] — se devuelve si values está vacío
 * @returns {string} SVG inline
 */
export function sparkline(values, opts = {}) {
  const width = opts.width ?? 120;
  const height = opts.height ?? 24;
  const stroke = opts.stroke ?? '#2563eb';
  const area = opts.area ?? true;
  const showLast = opts.showLast ?? true;
  const emptyLabel = opts.emptyLabel ?? '—';

  const clean = Array.isArray(values) ? values.filter((v) => typeof v === 'number' && Number.isFinite(v)) : [];
  if (clean.length === 0) {
    return `<span style="color:#94a3b8;font-size:11px;font-variant-numeric:tabular-nums;">${emptyLabel}</span>`;
  }
  if (clean.length === 1) {
    // Un solo punto → mostramos una línea plana
    const y = height / 2;
    return renderSvg(width, height, [[0, y], [width, y]], stroke, area, showLast ? [width, y] : null);
  }

  const min = Math.min(...clean);
  const max = Math.max(...clean);
  const range = max - min || 1;
  // Padding vertical para que la línea no toque el borde
  const padY = 2;
  const innerH = height - padY * 2;

  const step = clean.length > 1 ? width / (clean.length - 1) : 0;
  const points = clean.map((v, i) => {
    const x = Math.round(i * step);
    const y = Math.round(padY + (1 - (v - min) / range) * innerH);
    return [x, y];
  });

  const lastPoint = showLast ? points[points.length - 1] : null;
  return renderSvg(width, height, points, stroke, area, lastPoint);
}

function renderSvg(width, height, points, stroke, area, lastPoint) {
  const path = points.map((p, i) => (i === 0 ? `M${p[0]},${p[1]}` : `L${p[0]},${p[1]}`)).join(' ');
  const areaPath = area
    ? `${path} L${points[points.length - 1][0]},${height} L${points[0][0]},${height} Z`
    : null;

  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" style="display:inline-block;vertical-align:middle;" aria-hidden="true">`,
  ];

  if (areaPath) {
    parts.push(`<path d="${areaPath}" fill="${stroke}" fill-opacity="0.1" stroke="none"/>`);
  }
  parts.push(`<path d="${path}" fill="none" stroke="${stroke}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>`);

  if (lastPoint) {
    parts.push(`<circle cx="${lastPoint[0]}" cy="${lastPoint[1]}" r="2.2" fill="${stroke}"/>`);
  }

  parts.push('</svg>');
  return parts.join('');
}

/**
 * Helper para decidir color según tendencia.
 * Si el último valor es mayor que la media, verde; menor, rojo; igual, azul.
 */
export function trendColor(values, { up = '#16a34a', down = '#dc2626', flat = '#2563eb' } = {}) {
  if (!Array.isArray(values) || values.length < 2) return flat;
  const clean = values.filter((v) => typeof v === 'number' && Number.isFinite(v));
  if (clean.length < 2) return flat;
  const last = clean[clean.length - 1];
  const prev = clean.slice(0, -1);
  const avg = prev.reduce((s, v) => s + v, 0) / prev.length;
  if (last > avg * 1.05) return up;
  if (last < avg * 0.95) return down;
  return flat;
}
