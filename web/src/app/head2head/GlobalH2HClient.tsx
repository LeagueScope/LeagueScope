'use client';

import Image from 'next/image';
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { clientFetch } from '@/lib/clientFetch';
import { LEAGUE_LOGO } from '@/lib/constants';
import './global-h2h.css';

/* ══════════════════════════════════════════════════════════════
   Global Head-to-Head — Client Component
   ══════════════════════════════════════════════════════════════ */

/* ── Interfaces ──────────────────────────────────────────────── */
interface SearchResult {
  id: number;
  name: string;
  image_url?: string | null;
  role?: string | null;
  current_team_abbr?: string | null;
  region?: string | null;
  acronym?: string | null;
}

interface SerieOption {
  id: number;
  year: number;
  season: string;
  full_name: string;
  league_slug: string;
  league_name: string;
  label: string;
}

interface SelectedEntity {
  id: number;
  uid: string; // unique key per slot (allows same player twice)
  name: string;
  image_url?: string | null;
  role?: string | null;
  team_abbr?: string | null;
  region?: string | null;
  acronym?: string | null;
  serie_id?: number | null;   // null = auto (most recent)
  serie_label?: string | null;
  seriesOptions?: SerieOption[] | null; // cached series list for this entity
  loadingSeries?: boolean;
}

/* ── Stat group definitions ─────────────────────────────── */
type StatDef = [string, string, string, boolean, boolean?];

interface StatGroup {
  label: string;
  stats: StatDef[];
}

const TEAM_STAT_GROUPS: StatGroup[] = [
  { label: 'BÁSICO', stats: [
    ['Victorias', 'wins', '', true], ['Derrotas', 'losses', '', false],
    ['Win Rate', 'win_rate', '%', true], ['Partidas', 'games', '', true],
  ]},
  { label: 'GENERAL', stats: [
    ['Duración', 'avg_duration_formatted', '', false, true],
    ['Champs únicos', 'unique_champions', '', true],
    ['FB %', 'first_blood_rate', '%', true], ['FTorre %', 'first_tower_rate', '%', true],
    ['FDragon %', 'first_dragon_rate', '%', true], ['FBaron %', 'first_baron_rate', '%', true],
    ['FHerald %', 'first_herald_rate', '%', true], ['FVoidgrub %', 'first_voidgrub_rate', '%', true],
    ['FInhibidor %', 'first_inhibitor_rate', '%', true], ['FAtakhan %', 'first_atakhan_rate', '%', true],
  ]},
  { label: 'PER MINUTE', stats: [
    ['Gold / Min', 'avg_gpm', '', true], ['Δ Gold / Min', 'delta_gpm', '', true],
    ['CS / Min', 'avg_cspm', '', true], ['Δ CS / Min', 'delta_cspm', '', true],
    ['DMG / Min', 'avg_dpm', '', true], ['DMG recib. / Min', 'avg_dtaken_per_min', '', false],
    ['Wards / Min', 'avg_wpm', '', true], ['Wards destr. / Min', 'avg_wkpm', '', true],
    ['Control Wards / Min', 'avg_cwpm', '', true],
  ]},
  { label: 'AVG / GAME', stats: [
    ['Kills', 'avg_kills', '', true], ['Muertes', 'avg_deaths', '', false],
    ['Assists', 'avg_assists', '', true], ['KDA', 'kda', '', true],
  ]},
  { label: 'OBJETIVOS', stats: [
    ['Torres +', 'avg_towers', '', true], ['Torres -', 'avg_towers_lost', '', false],
    ['Dragons', 'avg_dragons', '', true], ['Barons', 'avg_barons', '', true],
    ['Heraldos', 'avg_heralds', '', true], ['Voidgrubs', 'avg_voidgrubs', '', true],
    ['Inhibidores', 'avg_inhibitors', '', true], ['Atakhans', 'avg_atakhans', '', true],
  ]},
  { label: 'DAMAGE', stats: [
    ['Mágico / Min', 'avg_magic_dpm', '', true], ['Físico / Min', 'avg_physical_dpm', '', true],
    ['Verdadero / Min', 'avg_true_dpm', '', true],
    ['Mágico recib. / Min', 'avg_magic_dtaken_pm', '', false], ['Físico recib. / Min', 'avg_physical_dtaken_pm', '', false],
  ]},
  { label: 'EARLY GAME @13', stats: [
    ['Gold Diff', 'avg_gold_diff_13', '', true], ['CS Diff', 'avg_cs_diff_13', '', true],
    ['Kills Diff', 'avg_kills_diff_13', '', true], ['Tower Diff', 'avg_tower_diff_13', '', true],
  ]},
  { label: 'MID GAME @20', stats: [
    ['Gold Diff', 'avg_gold_diff_20', '', true], ['CS Diff', 'avg_cs_diff_20', '', true],
    ['Kills Diff', 'avg_kills_diff_20', '', true], ['Tower Diff', 'avg_tower_diff_20', '', true],
  ]},
  { label: 'LATE GAME @25', stats: [
    ['Gold Diff', 'avg_gold_diff_25', '', true], ['CS Diff', 'avg_cs_diff_25', '', true],
    ['Kills Diff', 'avg_kills_diff_25', '', true], ['Tower Diff', 'avg_tower_diff_25', '', true],
  ]},
  { label: 'ECONOMY', stats: [
    ['Gold gastado', 'avg_gold_spent', '', true], ['NM enemiga', 'avg_neutral_minions_enemy', '', true],
    ['NM propia', 'avg_neutral_minions_team', '', true], ['CC / Min', 'avg_cc_per_min', '', true],
    ['Heal / Min', 'avg_heal_per_min', '', true],
  ]},
  { label: 'POR LADO', stats: [
    ['Blue WR', 'blue_wr', '%', true], ['Red WR', 'red_wr', '%', true],
  ]},
];

const PLAYER_STAT_GROUPS: StatGroup[] = [
  { label: 'GENERAL', stats: [
    ['Duración', 'avg_duration_formatted', '', false, true],
    ['Champs únicos', 'unique_champions', '', true],
    ['FB %', 'fb_rate', '%', true], ['FTorre %', 'first_tower_rate', '%', true],
  ]},
  { label: 'KDA', stats: [
    ['Kills', 'avg_kills', '', true], ['Muertes', 'avg_deaths', '', false],
    ['Assists', 'avg_assists', '', true], ['KDA', 'kda', '', true],
    ['Kill Participation', 'kill_participation', '%', true],
  ]},
  { label: 'PER MINUTE', stats: [
    ['Gold / Min', 'avg_gpm', '', true], ['CS / Min', 'avg_cspm', '', true],
    ['DMG / Min', 'avg_dpm', '', true], ['DMG recib. / Min', 'avg_dtaken_per_min', '', false],
    ['Wards / Min', 'avg_wpm', '', true], ['Wards destr. / Min', 'avg_wkpm', '', true],
    ['Control Wards / Min', 'avg_cwpm', '', true],
  ]},
  { label: 'SHARES', stats: [
    ['DMG Share', 'avg_damage_share', '%', true], ['Gold Share', 'avg_gold_share', '%', true],
  ]},
  { label: 'DAMAGE', stats: [
    ['Mágico / Min', 'avg_magic_dpm', '', true], ['Físico / Min', 'avg_physical_dpm', '', true],
    ['Verdadero / Min', 'avg_true_dpm', '', true],
    ['Mágico recib. / Min', 'avg_magic_dtaken_pm', '', false], ['Físico recib. / Min', 'avg_physical_dtaken_pm', '', false],
  ]},
  { label: 'EARLY GAME @13', stats: [
    ['CS Diff', 'avg_cs_diff_13', '', true], ['Level Diff', 'avg_level_diff_13', '', true],
    ['Kills Diff', 'avg_kills_diff_13', '', true],
  ]},
  { label: 'MID GAME @20', stats: [
    ['CS Diff', 'avg_cs_diff_20', '', true], ['Level Diff', 'avg_level_diff_20', '', true],
    ['Kills Diff', 'avg_kills_diff_20', '', true],
  ]},
  { label: 'LATE GAME @25', stats: [
    ['CS Diff', 'avg_cs_diff_25', '', true], ['Level Diff', 'avg_level_diff_25', '', true],
    ['Kills Diff', 'avg_kills_diff_25', '', true],
  ]},
  { label: 'COMBATE', stats: [
    ['Double Kills', 'double_kills', '', true], ['Triple Kills', 'triple_kills', '', true],
    ['Quadra Kills', 'quadra_kills', '', true], ['Penta Kills', 'penta_kills', '', true],
  ]},
  { label: 'ECONOMY', stats: [
    ['Gold gastado', 'avg_gold_spent', '', true], ['CC / Min', 'avg_cc_per_min', '', true],
    ['Heal / Min', 'avg_heal_per_min', '', true],
  ]},
  { label: 'POR LADO', stats: [
    ['Blue WR', 'blue_wr', '%', true], ['Red WR', 'red_wr', '%', true],
  ]},
];

/* ── Helpers ─────────────────────────────────────────────── */
const fmtVal = (v: unknown, suffix: string, isStr?: boolean): string => {
  if (v == null || v === '') return '—';
  if (isStr) return String(v);
  const n = Number(v);
  if (isNaN(n)) return String(v);
  return `${n % 1 === 0 ? n : n.toFixed(1)}${suffix}`;
};

const rankCls = (rank: number): string => {
  if (rank === 1) return 'best';
  if (rank === 2) return 'rank-2';
  if (rank === 3) return 'rank-3';
  return 'rank-4';
};

/* ── PDF Export ──────────────────────────────────────────── */
function exportToPDF(
  comparisonData: Record<string, unknown>[],
  statGroups: StatGroup[],
  mode: 'teams' | 'players',
  getNameFn: (item: Record<string, unknown>) => string,
) {
  const names = comparisonData.map(getNameFn);
  const n = names.length;

  const getRanks = (key: string, higherIsBetter: boolean): number[] => {
    const vals = comparisonData.map(item => Number(item[key]) || 0);
    const sorted = [...vals].sort((a, b) => higherIsBetter ? b - a : a - b);
    return vals.map(v => sorted.indexOf(v) + 1);
  };

  // Build HTML for PDF
  let rows = '';
  for (const group of statGroups) {
    rows += `<tr class="group-row"><td colspan="${n + 1}">${group.label}</td></tr>`;
    for (const [label, key, suffix, higherIsBetter, isStr] of group.stats) {
      const ranks = getRanks(key, higherIsBetter);
      let cells = `<td class="stat-label">${label}</td>`;
      comparisonData.forEach((item, idx) => {
        const v = item[key];
        const val = fmtVal(v, suffix, isStr);
        const cls = ranks[idx] === 1 ? 'best' : '';
        cells += `<td class="stat-val ${cls}">${val}</td>`;
      });
      rows += `<tr>${cells}</tr>`;
    }
  }

  const headerCells = names.map(name => `<th>${name}</th>`).join('');
  const title = mode === 'teams' ? 'Team Comparison' : 'Player Comparison';
  const subtitle = names.join(' vs ');

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${title}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Segoe UI', system-ui, sans-serif; background: #0e1117; color: #f8fafc; padding: 40px; }
  .header { text-align: center; margin-bottom: 32px; padding-bottom: 24px; border-bottom: 2px solid rgba(240,165,0,0.3); }
  .header h1 { font-size: 28px; font-weight: 900; letter-spacing: 2px; color: #f0a500; margin-bottom: 8px; }
  .header p { font-size: 14px; color: #8d9db3; }
  .header .date { font-size: 11px; color: #64748b; margin-top: 4px; }
  table { width: 100%; border-collapse: collapse; background: #141820; border-radius: 4px; overflow: hidden; }
  th { background: #1a1f2b; padding: 14px 16px; font-size: 13px; font-weight: 700; text-align: center; color: #f8fafc; border-bottom: 2px solid rgba(240,165,0,0.2); }
  th:first-child { text-align: left; color: #8d9db3; }
  td { padding: 10px 16px; border-bottom: 1px solid rgba(255,255,255,0.04); font-size: 13px; text-align: center; }
  .stat-label { text-align: left; color: rgba(255,255,255,0.7); font-weight: 500; }
  .stat-val { font-family: 'JetBrains Mono', monospace; font-weight: 700; color: rgba(255,255,255,0.5); }
  .stat-val.best { color: #f0a500; font-weight: 800; }
  .group-row td { padding: 16px 16px 8px; font-size: 11px; font-weight: 700; color: rgba(255,255,255,0.25); letter-spacing: 2px; text-transform: uppercase; border-bottom: 1px solid rgba(255,255,255,0.06); text-align: left; }
  .footer { text-align: center; margin-top: 24px; font-size: 10px; color: #64748b; letter-spacing: 1px; }
  @media print { body { background: #0e1117; -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style></head>
<body>
  <div class="header">
    <h1>HEAD TO HEAD</h1>
    <p>${subtitle}</p>
    <div class="date">LeagueScope — ${new Date().toLocaleDateString('es-ES', { year: 'numeric', month: 'long', day: 'numeric' })}</div>
  </div>
  <table>
    <thead><tr><th>ESTADÍSTICA</th>${headerCells}</tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="footer">LEAGUESCOPE.GG — GLOBAL HEAD TO HEAD</div>
</body></html>`;

  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const win = window.open(url, '_blank');
  if (win) {
    win.onload = () => {
      setTimeout(() => { win.print(); }, 500);
    };
  }
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/* ── Helper: clean PandaScore league slug → short slug for LEAGUE_LOGO ── */
const cleanLeagueSlug = (slug: string): string =>
  slug.replace(/^league-of-legends-/i, '')
      .replace(/-champions-korea$/i, '')
      .replace(/-china$/i, '')
      .replace(/-/g, '');

/* ── PlayerRadarChart — comparativa visual SVG (2-4 jugadores + media rol/region)
   Hover sobre un eje muestra los valores exactos de todos los jugadores y baseline.
   Solo se renderiza en desktop (oculto en mobile/tablet via CSS).
   ────────────────────────────────────────────────────────────── */

interface RadarAxis { key: string; label: string; max: number | null; suffix?: string; decimals?: number }
// 12 ejes para JUGADORES (360/12 = 30° entre cada uno).
// Cubre combate, economia, vision y control. Todos "higher is better".
const PLAYER_RADAR_AXES: RadarAxis[] = [
  { key: 'kda',                  label: 'KDA',     max: null, decimals: 2 },
  { key: 'kill_participation',   label: 'KP',      max: 100,  suffix: '%', decimals: 0 },
  { key: 'avg_gpm',              label: 'GPM',     max: null, decimals: 0 },
  { key: 'avg_dpm',              label: 'DMG/m',   max: null, decimals: 0 },
  { key: 'avg_cspm',             label: 'CS/m',    max: null, decimals: 1 },
  { key: 'avg_damage_share',     label: 'DMG%',    max: 100,  suffix: '%', decimals: 1 },
  { key: 'avg_gold_share',       label: 'GOLD%',   max: 100,  suffix: '%', decimals: 1 },
  { key: 'fb_rate',              label: 'FB%',     max: 100,  suffix: '%', decimals: 0 },
  { key: 'avg_wpm',              label: 'WARDS/m', max: null, decimals: 1 },
  { key: 'avg_wkpm',             label: 'WK/m',    max: null, decimals: 1 },
  { key: 'avg_cwpm',             label: 'CW/m',    max: null, decimals: 1 },
  { key: 'avg_cc_per_min',       label: 'CC/m',    max: null, decimals: 1 },
];

// 12 ejes para EQUIPOS — combate (WR/KDA/FB) + economia (GPM/CS/m/DMG/m) +
// objetivos (FT/FDrag/Torres/Dragons/Barons/Heralds).
const TEAM_RADAR_AXES: RadarAxis[] = [
  { key: 'win_rate',             label: 'WR%',     max: 100,  suffix: '%', decimals: 1 },
  { key: 'kda',                  label: 'KDA',     max: null, decimals: 2 },
  { key: 'avg_gpm',              label: 'GPM',     max: null, decimals: 0 },
  { key: 'avg_cspm',             label: 'CS/m',    max: null, decimals: 1 },
  { key: 'avg_dpm',              label: 'DMG/m',   max: null, decimals: 0 },
  { key: 'first_blood_rate',     label: 'FB%',     max: 100,  suffix: '%', decimals: 0 },
  { key: 'first_tower_rate',     label: 'FT%',     max: 100,  suffix: '%', decimals: 0 },
  { key: 'first_dragon_rate',    label: 'FD%',     max: 100,  suffix: '%', decimals: 0 },
  { key: 'avg_towers',           label: 'TORRES',  max: null, decimals: 1 },
  { key: 'avg_dragons',          label: 'DRAGONS', max: null, decimals: 1 },
  { key: 'avg_barons',           label: 'BARONS',  max: null, decimals: 1 },
  { key: 'avg_heralds',          label: 'HERALDS', max: null, decimals: 1 },
];

// Paleta de colores por jugador (max 4)
const PLAYER_COLORS = [
  { stroke: '#f0a500', fill: 'rgba(240, 165, 0, 0.18)', swatch: 'a' },  // gold
  { stroke: '#60a5fa', fill: 'rgba(96, 165, 250, 0.18)', swatch: 'b' }, // blue
  { stroke: '#f87171', fill: 'rgba(248, 113, 113, 0.18)', swatch: 'c' }, // red
  { stroke: '#4ade80', fill: 'rgba(74, 222, 128, 0.18)', swatch: 'd' }, // green
];

function fmtRadarVal(v: number, decimals = 1, suffix = ''): string {
  if (!isFinite(v)) return '—';
  const fixed = decimals > 0 ? v.toFixed(decimals) : Math.round(v).toString();
  return `${fixed}${suffix}`;
}

function RadarChart({
  axes, players, baseline, regionLabel, sectionTitle,
}: {
  axes: RadarAxis[];
  players: { data: Record<string, unknown>; name: string; subtitle?: string }[];
  baseline: Record<string, unknown> | null;
  regionLabel: string;
  sectionTitle: string;
}) {
  const [hoveredAxis, setHoveredAxis] = useState<number | null>(null);

  // Baseline solo se muestra con 3+ entidades — con 2 estorba mas que ayuda
  const showBaseline = !!baseline && players.length >= 3;

  const SIZE = 440;
  const C = SIZE / 2;
  const R = 150;

  // Por cada eje calcular max entre todos los datasets
  const axisData = axes.map((ax, i) => {
    const angle = (i / axes.length) * Math.PI * 2 - Math.PI / 2;
    const playerVals = players.map(p => Number(p.data[ax.key]) || 0);
    const valBase = showBaseline && baseline ? (Number(baseline[ax.key]) || 0) : 0;
    const allVals = showBaseline ? [...playerVals, valBase] : playerVals;
    const max = ax.max ?? Math.max(...allVals, 1) * 1.15;
    return { ...ax, angle, playerVals, valBase, max };
  });

  const point = (val: number, max: number, angle: number): [number, number] => {
    const r = (val / max) * R;
    return [C + r * Math.cos(angle), C + r * Math.sin(angle)];
  };

  // Path por jugador
  const playerPaths = players.map((_, pIdx) => {
    return axisData.map((a, i) => {
      const [x, y] = point(a.playerVals[pIdx], a.max, a.angle);
      return `${i === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
    }).join(' ') + ' Z';
  });

  const pathBase = showBaseline ? axisData.map((a, i) => {
    const [x, y] = point(a.valBase, a.max, a.angle);
    return `${i === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
  }).join(' ') + ' Z' : '';

  // Hit areas — wedges semitransparentes para capturar hover por eje
  const N = axes.length;
  const halfStep = Math.PI / N;
  const hitR = R + 40;  // extender hit area mas alla del label
  const buildWedge = (angle: number) => {
    const a1 = angle - halfStep;
    const a2 = angle + halfStep;
    const x1 = C + hitR * Math.cos(a1);
    const y1 = C + hitR * Math.sin(a1);
    const x2 = C + hitR * Math.cos(a2);
    const y2 = C + hitR * Math.sin(a2);
    return `M ${C} ${C} L ${x1.toFixed(2)} ${y1.toFixed(2)} A ${hitR} ${hitR} 0 0 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z`;
  };

  // Tooltip position
  // Posicion del tooltip: en el lado DIAMETRALMENTE OPUESTO al eje hovered, asi
  // el cursor (que esta sobre el wedge del axis hovered) nunca tapa el tooltip.
  let tipX = 0, tipY = 0, tipAlign: 'start' | 'middle' | 'end' = 'middle';
  if (hoveredAxis !== null) {
    const a = axisData[hoveredAxis];
    const oppAngle = a.angle + Math.PI;
    tipX = C + (R + 38) * Math.cos(oppAngle);
    tipY = C + (R + 38) * Math.sin(oppAngle);
    const cosOpp = Math.cos(oppAngle);
    if (cosOpp < -0.3) tipAlign = 'end';
    else if (cosOpp > 0.3) tipAlign = 'start';
    else tipAlign = 'middle';
  }

  return (
    <div className="gh2h-radar-section">
      <div className="gh2h-radar-title">{sectionTitle}</div>
      <div className="gh2h-radar-wrap">
        <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="gh2h-radar-svg" aria-label="Radar comparativo">
          {/* Grid concéntrico */}
          {[25, 50, 75, 100].map(p => (
            <circle key={p} cx={C} cy={C} r={(R * p) / 100}
              fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
          ))}
          {/* Ejes radiales + labels */}
          {axisData.map((a, i) => {
            const [x, y] = [C + R * Math.cos(a.angle), C + R * Math.sin(a.angle)];
            const [lx, ly] = [C + (R + 22) * Math.cos(a.angle), C + (R + 22) * Math.sin(a.angle)];
            const isHovered = hoveredAxis === i;
            return (
              <g key={i}>
                <line x1={C} y1={C} x2={x} y2={y}
                  stroke={isHovered ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.06)'}
                  strokeWidth={isHovered ? 1.5 : 1} />
                <text x={lx} y={ly} textAnchor="middle" dominantBaseline="middle"
                  className={`gh2h-radar-axis-label ${isHovered ? 'is-hovered' : ''}`}>{a.label}</text>
              </g>
            );
          })}
          {/* Baseline (dashed) — solo con 3+ jugadores */}
          {showBaseline && (
            <path d={pathBase} fill="rgba(255,255,255,0.04)"
              stroke="rgba(220,220,220,0.5)" strokeWidth="1.5" strokeDasharray="5 4"
              pointerEvents="none" />
          )}
          {/* Polígonos de jugadores */}
          {players.map((_, pIdx) => {
            const c = PLAYER_COLORS[pIdx % PLAYER_COLORS.length];
            return (
              <path key={`poly-${pIdx}`} d={playerPaths[pIdx]}
                fill={c.fill} stroke={c.stroke} strokeWidth="2" pointerEvents="none" />
            );
          })}
          {/* Vertices — resaltar los del eje hovered */}
          {axisData.map((a, i) => (
            <g key={`pts-${i}`} pointerEvents="none">
              {showBaseline && hoveredAxis === i && (
                <circle {...(() => {
                  const [bx, by] = point(a.valBase, a.max, a.angle);
                  return { cx: bx, cy: by };
                })()} r="4" fill="rgba(220,220,220,0.7)" stroke="#0e1117" strokeWidth="1.5" />
              )}
              {players.map((_, pIdx) => {
                const c = PLAYER_COLORS[pIdx % PLAYER_COLORS.length];
                const [px, py] = point(a.playerVals[pIdx], a.max, a.angle);
                const r = hoveredAxis === i ? 5 : 3;
                return <circle key={`v-${pIdx}-${i}`} cx={px} cy={py} r={r}
                  fill={c.stroke} stroke={hoveredAxis === i ? '#0e1117' : 'transparent'} strokeWidth="1.5" />;
              })}
            </g>
          ))}
          {/* Hit areas (wedges) — capturan hover por sector */}
          {axisData.map((a, i) => (
            <path key={`hit-${i}`} d={buildWedge(a.angle)}
              fill="transparent"
              style={{ cursor: 'pointer' }}
              onMouseEnter={() => setHoveredAxis(i)}
              onMouseLeave={() => setHoveredAxis(null)} />
          ))}
          {/* Tooltip */}
          {hoveredAxis !== null && (() => {
            const a = axisData[hoveredAxis];
            // Detectar duplicados de nombre — si los hay, mostrar tambien el subtitle
            // para evitar ambigedad en el tooltip ("MKOI" vs "MKOI" → "MKOI 2026" vs "MKOI 2025")
            const nameCounts = players.reduce<Record<string, number>>((acc, p) => {
              acc[p.name] = (acc[p.name] || 0) + 1;
              return acc;
            }, {});
            const lines = [
              ...players.map((p, pIdx) => {
                const isDup = (nameCounts[p.name] || 0) > 1;
                const label = isDup && p.subtitle ? `${p.name} · ${p.subtitle}` : p.name;
                return {
                  color: PLAYER_COLORS[pIdx % PLAYER_COLORS.length].stroke,
                  label,
                  value: fmtRadarVal(a.playerVals[pIdx], a.decimals ?? 1, a.suffix ?? ''),
                };
              }),
              ...(showBaseline && baseline ? [{
                color: 'rgba(220,220,220,0.7)',
                label: `Media ${String(baseline.role || '').toUpperCase()}`,
                value: fmtRadarVal(a.valBase, a.decimals ?? 1, a.suffix ?? ''),
              }] : []),
            ];
            const lineH = 16;
            const padX = 10, padY = 10;
            // Si hay duplicados, ampliamos el tooltip para que quepa "Nombre · Split YYYY"
            const hasDup = Object.values(nameCounts).some(c => c > 1);
            const tipW = hasDup ? 260 : 180;
            const tipH = padY * 2 + 18 + lines.length * lineH;
            // Position tooltip near hovered axis label
            let bx = tipX;
            let by = tipY;
            if (tipAlign === 'middle') bx -= tipW / 2;
            else if (tipAlign === 'end') bx -= tipW;
            // Clamp dentro del viewBox
            bx = Math.max(4, Math.min(bx, SIZE - tipW - 4));
            by = Math.max(4, Math.min(by - tipH / 2, SIZE - tipH - 4));
            return (
              <g pointerEvents="none">
                <rect x={bx} y={by} width={tipW} height={tipH} rx="4"
                  fill="#141820" stroke="rgba(255,255,255,0.18)" strokeWidth="1" />
                <text x={bx + padX} y={by + padY + 12} className="gh2h-radar-tip-title">{a.label}</text>
                {lines.map((ln, li) => (
                  <g key={li}>
                    <circle cx={bx + padX + 4} cy={by + padY + 22 + li * lineH + 4} r="3.5" fill={ln.color} />
                    <text x={bx + padX + 14} y={by + padY + 26 + li * lineH + 4} className="gh2h-radar-tip-name">{ln.label}</text>
                    <text x={bx + tipW - padX} y={by + padY + 26 + li * lineH + 4} textAnchor="end" className="gh2h-radar-tip-val">{ln.value}</text>
                  </g>
                ))}
              </g>
            );
          })()}
        </svg>
        <div className="gh2h-radar-legend">
          {players.map((p, pIdx) => {
            const c = PLAYER_COLORS[pIdx % PLAYER_COLORS.length];
            return (
              <span key={pIdx} className="gh2h-radar-legend-item">
                <span className="gh2h-radar-swatch" style={{ background: c.fill, borderColor: c.stroke }} />
                <span className="gh2h-radar-name-block">
                  <span className="gh2h-radar-name">{p.name}</span>
                  {p.subtitle && <span className="gh2h-radar-subtitle">{p.subtitle}</span>}
                </span>
              </span>
            );
          })}
          {showBaseline && baseline && (
            <span className="gh2h-radar-legend-item">
              <span className="gh2h-radar-swatch gh2h-radar-swatch-base" />
              <span className="gh2h-radar-name">Media {String(baseline.role || '').toUpperCase()} en {regionLabel}</span>
            </span>
          )}
          <span className="gh2h-radar-hint">Pasa el cursor por encima de un eje para ver los valores exactos</span>
        </div>
      </div>
    </div>
  );
}

/* ── VsComparison sub-component (2-way comparison) ────────────── */
function VsComparison<T extends Record<string, unknown>>({ selected, statGroups, getLogoFn, getNameFn }: {
  selected: T[];
  statGroups: StatGroup[];
  getLogoFn: (item: T) => string;
  getNameFn: (item: T) => string;
}) {
  if (selected.length !== 2) return null;

  const left = selected[0];
  const right = selected[1];
  const leftName = getNameFn(left);
  const rightName = getNameFn(right);

  return (
    <div className="gh2h-vs-container">
      {/* VS Header */}
      <div className="gh2h-vs-header">
        {/* Left entity */}
        <div className="gh2h-vs-entity">
          <Image
            src={getLogoFn(left)}
            alt={leftName}
            width={64}
            height={64}
            onError={e => (e.target as HTMLImageElement).style.display = 'none'}
          />
          <span className="gh2h-vs-entity-name">{leftName}</span>
          {(left.region as string) && (
            <Image
              src={LEAGUE_LOGO(cleanLeagueSlug(String(left.region)))}
              alt={String(left.region)}
              width={20}
              height={20}
              className="gh2h-vs-league-icon"
              onError={e => (e.target as HTMLImageElement).style.display = 'none'}
            />
          )}
        </div>

        {/* Center VS badge */}
        <div className="gh2h-vs-badge">VS</div>

        {/* Right entity */}
        <div className="gh2h-vs-entity">
          <Image
            src={getLogoFn(right)}
            alt={rightName}
            width={64}
            height={64}
            onError={e => (e.target as HTMLImageElement).style.display = 'none'}
          />
          <span className="gh2h-vs-entity-name">{rightName}</span>
          {(right.region as string) && (
            <Image
              src={LEAGUE_LOGO(cleanLeagueSlug(String(right.region)))}
              alt={String(right.region)}
              width={20}
              height={20}
              className="gh2h-vs-league-icon"
              onError={e => (e.target as HTMLImageElement).style.display = 'none'}
            />
          )}
        </div>
      </div>

      {/* Stats sections */}
      <div className="gh2h-vs-stats">
        {statGroups.map(group => (
          <div key={group.label}>
            <div className="gh2h-vs-group-label">{group.label}</div>
            {group.stats.map(([label, key, suffix, higherIsBetter, isStr]) => {
              const val1 = Number(left[key]) || 0;
              const val2 = Number(right[key]) || 0;

              const winner = higherIsBetter
                ? (val1 > val2 ? 1 : val2 > val1 ? 2 : 0)
                : (val1 < val2 ? 1 : val2 < val1 ? 2 : 0);

              const total = Math.abs(val1) + Math.abs(val2) || 1;
              const pct1 = (Math.abs(val1) / total) * 100;
              const pct2 = (Math.abs(val2) / total) * 100;

              return (
                <div key={key} className="gh2h-vs-row">
                  <span className={`gh2h-vs-val gh2h-vs-val-left ${winner === 1 ? 'winner' : ''}`}>
                    {fmtVal(left[key], suffix, isStr)}
                  </span>

                  <div className="gh2h-vs-center">
                    <div className="gh2h-vs-row-label">{label}</div>
                    <div className="gh2h-vs-bar">
                      <div
                        className={`gh2h-vs-bar-seg ${winner === 1 ? 'winner' : ''}`}
                        style={{ width: `${pct1}%` }}
                      />
                      <div
                        className={`gh2h-vs-bar-seg ${winner === 2 ? 'winner' : ''}`}
                        style={{ width: `${pct2}%` }}
                      />
                    </div>
                  </div>

                  <span className={`gh2h-vs-val gh2h-vs-val-right ${winner === 2 ? 'winner' : ''}`}>
                    {fmtVal(right[key], suffix, isStr)}
                  </span>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   H2HSeriesList — Últimas N series entre 2 equipos
   Estilo inspirado en /record (tr-match-card)
   ══════════════════════════════════════════════════════════════ */

interface H2HSeriesItem {
  match_id: number;
  best_of: number;
  date: string | null;
  match_name?: string | null;
  league_slug: string;
  league_name: string;
  serie_label: string;
  year: number;
  season: string;
  teamA: { id: number; name: string; abbr: string; logo_url: string; score: number; winner: boolean } | null;
  teamB: { id: number; name: string; abbr: string; logo_url: string; score: number; winner: boolean } | null;
}

function H2HSeriesList({ teamAId, teamBId, fallbackA, fallbackB }: {
  teamAId: number; teamBId: number;
  fallbackA?: { abbr?: string | null; logo?: string | null };
  fallbackB?: { abbr?: string | null; logo?: string | null };
}) {
  const sameTeam = teamAId === teamBId;
  const [series, setSeries] = useState<H2HSeriesItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (sameTeam) {
      setSeries([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    clientFetch<H2HSeriesItem[]>(`/api/v1/pg/compare/teams-h2h?ids=${teamAId},${teamBId}&limit=5`)
      .then(d => { if (!cancelled) setSeries(d || []); })
      .catch(() => { if (!cancelled) setSeries([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [teamAId, teamBId, sameTeam]);

  // Caso: mismo equipo contra sí mismo (no tiene sentido un H2H)
  if (sameTeam) {
    return (
      <div className="gh2h-h2h-section">
        <div className="gh2h-h2h-header">
          <span className="gh2h-h2h-title">HISTORIAL DIRECTO</span>
        </div>
        <div className="gh2h-h2h-empty">Selecciona dos equipos distintos para ver su historial.</div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="gh2h-h2h-section">
        <div className="gh2h-h2h-loading">Cargando historial…</div>
      </div>
    );
  }
  if (!series.length) {
    return (
      <div className="gh2h-h2h-section">
        <div className="gh2h-h2h-header">
          <span className="gh2h-h2h-title">HISTORIAL DIRECTO</span>
        </div>
        <div className="gh2h-h2h-empty">No hay enfrentamientos directos registrados.</div>
      </div>
    );
  }

  // Tally W-L desde la perspectiva del primero seleccionado
  const aWins = series.filter(s => s.teamA?.winner).length;
  const bWins = series.filter(s => s.teamB?.winner).length;
  const abbrA = series[0].teamA?.abbr || fallbackA?.abbr || 'A';
  const abbrB = series[0].teamB?.abbr || fallbackB?.abbr || 'B';

  return (
    <div className="gh2h-h2h-section">
      <div className="gh2h-h2h-header">
        <span className="gh2h-h2h-title">ÚLTIMAS {series.length} SERIES</span>
        <span className="gh2h-h2h-tally">
          <strong>{abbrA}</strong>
          <span className="gh2h-h2h-tally-num">{aWins}</span>
          <span className="gh2h-h2h-tally-sep">—</span>
          <span className="gh2h-h2h-tally-num">{bWins}</span>
          <strong>{abbrB}</strong>
        </span>
      </div>
      <div className="gh2h-h2h-list">
        {series.map(s => {
          const aWon = !!s.teamA?.winner;
          const bWon = !!s.teamB?.winner;
          const dateLabel = s.date
            ? new Date(s.date).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' }).replace('.', '')
            : '';
          // Limpia "league-of-legends-lec" -> "LEC" / "league-of-legends-world-championship" -> "WORLDS"
          const leagueLabel = (() => {
            const raw = (s.league_slug || s.league_name || '').replace(/^league-of-legends-?/i, '');
            if (/world.*championship|worlds/i.test(raw)) return 'WORLDS';
            return (raw || s.league_name || '').toUpperCase();
          })();
          // Etiqueta izquierda: liga + año + season + (a veces fecha)
          const leftLabel = [leagueLabel, s.year, s.season ? s.season.toUpperCase() : '']
            .filter(Boolean).join(' · ');
          return (
            <div key={s.match_id} className="gh2h-h2h-card">
              {/* Match label (absoluta, mitad izquierda) — estilo /record */}
              <span className="gh2h-h2h-label">{leftLabel}{dateLabel ? ` · ${dateLabel}` : ''}</span>
              {/* BO badge (absoluta, mitad derecha) */}
              {s.best_of > 1 && <span className="gh2h-h2h-bo">BO{s.best_of}</span>}

              <div className="gh2h-h2h-content">
                <div className={`gh2h-h2h-team gh2h-h2h-left ${aWon ? 'gh2h-h2h-winner' : ''}`}>
                  {s.teamA?.abbr || abbrA}
                </div>
                <div className="gh2h-h2h-logo-wrap">
                  {(s.teamA?.logo_url || fallbackA?.logo) && (
                    <Image src={s.teamA?.logo_url || fallbackA?.logo || ''} alt="" width={32} height={32} className="gh2h-h2h-logo" />
                  )}
                </div>
                <div className="gh2h-h2h-score">
                  <span className={`gh2h-h2h-score-num ${aWon ? 'gh2h-h2h-score-winner-left' : 'gh2h-h2h-score-loser-left'}`}>{s.teamA?.score ?? 0}</span>
                  <span className="gh2h-h2h-score-sep">—</span>
                  <span className={`gh2h-h2h-score-num ${bWon ? 'gh2h-h2h-score-winner-right' : 'gh2h-h2h-score-loser-right'}`}>{s.teamB?.score ?? 0}</span>
                </div>
                <div className="gh2h-h2h-logo-wrap">
                  {(s.teamB?.logo_url || fallbackB?.logo) && (
                    <Image src={s.teamB?.logo_url || fallbackB?.logo || ''} alt="" width={32} height={32} className="gh2h-h2h-logo" />
                  )}
                </div>
                <div className={`gh2h-h2h-team gh2h-h2h-right ${bWon ? 'gh2h-h2h-winner' : ''}`}>
                  {s.teamB?.abbr || abbrB}
                </div>
              </div>

              {/* Winner accent bar — vertical 3px en el lado del ganador */}
              {aWon
                ? <div className="gh2h-h2h-bar gh2h-h2h-bar-left" />
                : bWon
                  ? <div className="gh2h-h2h-bar gh2h-h2h-bar-right" />
                  : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── CmpTable sub-component (3-4 way comparison) ─────────────── */
function CmpTable<T extends Record<string, unknown>>({ selected, statGroups, getLogoFn, getNameFn }: {
  selected: T[];
  statGroups: StatGroup[];
  getLogoFn: (item: T) => string;
  getNameFn: (item: T) => string;
}) {
  const n = selected.length;
  const gridCols = `180px repeat(${n}, 1fr)`;

  const getRanks = (key: string, higherIsBetter: boolean): number[] => {
    const vals = selected.map(item => Number(item[key]) || 0);
    const sorted = [...vals].sort((a, b) => higherIsBetter ? b - a : a - b);
    return vals.map(v => sorted.indexOf(v) + 1);
  };

  return (
    <div className="p11-cmp-card">
      <div className="p11-stats-table">
        <div className="p11-stats-hdr" style={{ gridTemplateColumns: gridCols }}>
          <span className="p11-col-lbl">ESTADÍSTICA</span>
          {selected.map((item, idx) => (
            <div key={idx} className="p11-stats-hdr-item">
              <Image
                src={getLogoFn(item)}
                className="p11-stats-hdr-logo"
                alt={getNameFn(item)}
                width={24}
                height={24}
                onError={e => (e.target as HTMLImageElement).style.display = 'none'}
              />
              <div className="p11-stats-hdr-text">
                <span className="p11-stats-hdr-name">{getNameFn(item)}</span>
                {item.serie_label ? <span className="p11-stats-hdr-serie">{String(item.serie_label)}</span> : null}
              </div>
            </div>
          ))}
        </div>

        {statGroups.map(group => (
          <div key={group.label}>
            <div className="p11-stat-row" style={{ gridTemplateColumns: '1fr', padding: '0 32px' }}>
              <div className="p11-group-sep">{group.label}</div>
            </div>

            {group.stats.map(([label, key, suffix, higherIsBetter, isStr]) => {
              const ranks = getRanks(key, higherIsBetter);
              const vals = selected.map(item => Number(item[key]) || 0);
              const maxV = Math.max(...vals);
              const minV = Math.min(...vals);
              const range = maxV - minV || 1;

              return (
                <div key={key} className="p11-stat-row" style={{ gridTemplateColumns: gridCols }}>
                  <span className="p11-col-lbl">{label}</span>
                  {selected.map((item, idx) => {
                    const v = item[key];
                    const num = Number(v) || 0;
                    const rank = ranks[idx];
                    const cls = rankCls(rank);
                    const barPct = higherIsBetter
                      ? ((num - minV) / range) * 100
                      : ((maxV - num) / range) * 100;

                    return (
                      <div key={idx} className="p11-col-val">
                        <span className={`p11-val-num ${cls}`}>{fmtVal(v, suffix, isStr)}</span>
                        {!isStr && (
                          <div className="p11-val-bar-wrap">
                            <div
                              className={`p11-val-bar-fill ${cls}`}
                              style={{ width: `${Math.max(barPct, 0)}%` }}
                            />
                          </div>
                        )}
                        {!isStr && <span className={`p11-val-rank ${cls}`}>#{rank}</span>}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   MAIN COMPONENT
   ══════════════════════════════════════════════════════════════ */

export default function GlobalH2HClient() {
  const [mode, setMode] = useState<'teams' | 'players' | null>(null); // null = not locked yet
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<{ players: SearchResult[]; teams: SearchResult[] }>({ players: [], teams: [] });
  const [searching, setSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [selected, setSelected] = useState<SelectedEntity[]>([]);
  const [comparisonData, setComparisonData] = useState<Record<string, unknown>[]>([]);
  const [loadingComparison, setLoadingComparison] = useState(false);

  // Role baseline para el radar chart (solo en mode='players' con 2 jugadores)
  const [roleBaseline, setRoleBaseline] = useState<Record<string, unknown> | null>(null);
  useEffect(() => {
    if (mode !== 'players' || comparisonData.length !== 2) {
      setRoleBaseline(null);
      return;
    }
    const p1 = comparisonData[0];
    const role = (p1.role as string) || '';
    const serieId = p1.serie_id as number | undefined;
    if (!role || !serieId) { setRoleBaseline(null); return; }
    let cancelled = false;
    clientFetch<Record<string, unknown> | null>(`/api/v1/pg/compare/player-role-baseline?role=${encodeURIComponent(role)}&serieId=${serieId}`)
      .then(d => { if (!cancelled) setRoleBaseline(d); })
      .catch(() => { if (!cancelled) setRoleBaseline(null); });
    return () => { cancelled = true; };
  }, [mode, comparisonData]);

  const [highlightIdx, setHighlightIdx] = useState(-1);

  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchWrapperRef = useRef<HTMLDivElement>(null);

  // Debounced search
  useEffect(() => {
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);

    if (!query.trim()) {
      setSearchResults({ players: [], teams: [] });
      setShowDropdown(false);
      return;
    }

    setSearching(true);
    searchTimeoutRef.current = setTimeout(async () => {
      try {
        const res = await clientFetch<{ players: SearchResult[]; teams: SearchResult[] }>(`/api/v1/pg/search?q=${encodeURIComponent(query)}`);
        setSearchResults(res || { players: [], teams: [] });
        setHighlightIdx(-1);
        setShowDropdown(true);
      } catch (err) {
        console.error('Search error:', err);
        setSearchResults({ players: [], teams: [] });
      } finally {
        setSearching(false);
      }
    }, 300);

    return () => {
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    };
  }, [query]);

  // Click outside to close dropdown
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (searchWrapperRef.current && !searchWrapperRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Auto-scroll highlighted dropdown item into view
  useEffect(() => {
    if (highlightIdx < 0 || !dropdownRef.current) return;
    const items = dropdownRef.current.querySelectorAll('.gh2h-dd-item');
    if (items[highlightIdx]) {
      (items[highlightIdx] as HTMLElement).scrollIntoView({ block: 'nearest' });
    }
  }, [highlightIdx]);

  // Fetch comparison data when 2+ selected and all have resolved series
  useEffect(() => {
    if (selected.length < 2) {
      setComparisonData([]);
      return;
    }

    // Wait until all entities have loaded their series
    if (selected.some(s => s.loadingSeries)) return;

    setLoadingComparison(true);
    const ids = selected.map(s => s.serie_id ? `${s.id}:${s.serie_id}` : `${s.id}`).join(',');
    const m = mode || 'players';
    const endpoint = m === 'teams' ? `/api/v1/pg/compare/teams?ids=${ids}` : `/api/v1/pg/compare/players?ids=${ids}`;

    clientFetch<Record<string, unknown>[]>(endpoint)
      .then(data => {
        setComparisonData(data || []);
        // Sync chip display names/logos from branded backend response
        if (data && data.length === selected.length) {
          setSelected(prev => prev.map((s, i) => {
            const d = data[i];
            if (!d) return s;
            const brandedName = m === 'teams'
              ? String(d.brand_name || d.name || s.name)
              : String(d.name || s.name);
            const brandedImg = m === 'teams'
              ? String(d.logo_url || d.image_url || s.image_url)
              : String(d.image_url || d.team_logo_url || s.image_url);
            const brandedAbbr = m === 'teams'
              ? String(d.brand_acronym || d.abbr || s.acronym || '')
              : String(d.team_abbr || s.team_abbr || '');
            return { ...s, name: brandedName, image_url: brandedImg, team_abbr: brandedAbbr, acronym: brandedAbbr };
          }));
        }
      })
      .catch(err => {
        console.error('Comparison error:', err);
        setComparisonData([]);
      })
      .finally(() => setLoadingComparison(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected.map(s => `${s.id}:${s.serie_id}`).join(','), mode]);

  // Handlers — auto-detect mode from first selection
  const selectEntity = (entity: SearchResult, type: 'player' | 'team') => {
    const newMode = type === 'player' ? 'players' : 'teams';

    // If mode is locked to opposite type, ignore
    if (mode && mode !== newMode) return;

    if (selected.length >= 4) return;

    // Lock mode on first selection
    if (!mode) setMode(newMode);

    const uid = `${entity.id}_${Date.now()}`;
    const selectedEntity: SelectedEntity = {
      id: entity.id,
      uid,
      name: entity.name,
      image_url: entity.image_url,
      role: entity.role,
      team_abbr: entity.current_team_abbr,
      region: entity.region,
      acronym: entity.acronym,
      serie_id: null,
      serie_label: null,
      seriesOptions: null,
      loadingSeries: true,
    };

    const newSelected = [...selected, selectedEntity];
    setSelected(newSelected);
    setQuery('');
    setShowDropdown(false);

    // Fetch series history for this entity
    const seriesEndpoint = newMode === 'players'
      ? `/api/v1/pg/compare/player-series?id=${entity.id}`
      : `/api/v1/pg/compare/team-series?id=${entity.id}`;

    clientFetch<SerieOption[]>(seriesEndpoint)
      .then(series => {
        setSelected(prev => prev.map(s =>
          s.uid === uid
            ? { ...s, seriesOptions: series || [], loadingSeries: false, serie_id: series?.[0]?.id || null, serie_label: series?.[0]?.label || null }
            : s
        ));
      })
      .catch(() => {
        setSelected(prev => prev.map(s =>
          s.uid === uid ? { ...s, seriesOptions: [], loadingSeries: false } : s
        ));
      });
  };

  const removeEntity = (uid: string) => {
    const newSelected = selected.filter(s => s.uid !== uid);
    setSelected(newSelected);
    // Unlock mode when all removed
    if (newSelected.length === 0) setMode(null);
  };

  const changeEntitySerie = (uid: string, serieId: number) => {
    setSelected(prev => prev.map(s => {
      if (s.uid !== uid) return s;
      const opt = s.seriesOptions?.find(o => o.id === serieId);
      return { ...s, serie_id: serieId, serie_label: opt?.label || null };
    }));
  };

  const handleExportPDF = useCallback(() => {
    if (comparisonData.length < 2) return;
    const m = mode || 'players';
    const getNameFn = (item: Record<string, unknown>) =>
      m === 'teams' ? String(item.abbr || item.name) : String(item.name);
    exportToPDF(comparisonData, m === 'teams' ? TEAM_STAT_GROUPS : PLAYER_STAT_GROUPS, m, getNameFn);
  }, [comparisonData, mode]);

  // In dropdown, only show the matching type once mode is locked
  const showPlayers = !mode || mode === 'players';
  const showTeams = !mode || mode === 'teams';

  // Build flat list of dropdown items for keyboard navigation
  const flatItems = useMemo(() => {
    const items: { entity: SearchResult; type: 'player' | 'team' }[] = [];
    if (showPlayers) {
      for (const p of searchResults.players) items.push({ entity: p, type: 'player' });
    }
    if (showTeams) {
      for (const t of searchResults.teams) items.push({ entity: t, type: 'team' });
    }
    return items;
  }, [searchResults, showPlayers, showTeams]);

  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (!showDropdown || flatItems.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightIdx(prev => (prev + 1) % flatItems.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIdx(prev => (prev <= 0 ? flatItems.length - 1 : prev - 1));
    } else if (e.key === 'Enter' && highlightIdx >= 0 && highlightIdx < flatItems.length) {
      e.preventDefault();
      const item = flatItems[highlightIdx];
      selectEntity(item.entity, item.type);
      setHighlightIdx(-1);
    } else if (e.key === 'Escape') {
      setShowDropdown(false);
      setHighlightIdx(-1);
    }
  };

  const effectiveMode = mode || 'players';
  const placeholder = !mode
    ? 'Buscar jugador o equipo...'
    : mode === 'players'
      ? 'Buscar jugador...'
      : 'Buscar equipo...';

  return (
    <div className="gh2h-page">
      <div className="gh2h-container">

        {/* ═══════ SEARCH AREA ═══════ */}
        <div className="gh2h-search-card">
          <div ref={searchWrapperRef} className="gh2h-search-wrapper">
            <div className="gh2h-search-bar">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.35-4.35" />
              </svg>
              <input
                type="text"
                placeholder={placeholder}
                value={query}
                onChange={e => setQuery(e.target.value)}
                onFocus={() => query && setShowDropdown(true)}
                onKeyDown={handleSearchKeyDown}
              />
              {mode && (
                <span className="gh2h-mode-badge">{mode === 'players' ? 'JUGADORES' : 'EQUIPOS'}</span>
              )}
              {query && (
                <button className="gh2h-clear" aria-label="Clear search" onClick={() => setQuery('')}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
                </button>
              )}
            </div>

            {/* Dropdown */}
            {showDropdown && (() => {
              let runIdx = 0;
              return (
              <div className="gh2h-dropdown" ref={dropdownRef}>
                {showPlayers && searchResults.players.length > 0 && (
                  <>
                    <div className="gh2h-dd-label">JUGADORES</div>
                    {searchResults.players.map(p => {
                      const idx = runIdx++;
                      return (
                      <div key={p.id} className={`gh2h-dd-item${idx === highlightIdx ? ' gh2h-dd-highlight' : ''}`} onClick={() => selectEntity(p, 'player')} onMouseEnter={() => setHighlightIdx(idx)}>
                        <Image
                          src={p.image_url || '/default-player.png'}
                          alt={p.name}
                          width={32}
                          height={32}
                          onError={e => (e.target as HTMLImageElement).style.display = 'none'}
                        />
                        <div className="gh2h-dd-info">
                          <span className="gh2h-dd-name">{p.name}</span>
                          <span className="gh2h-dd-meta">
                            {p.current_team_abbr && <span className="gh2h-dd-team">{p.current_team_abbr}</span>}
                            {p.role && <span className="gh2h-dd-role">{p.role.toUpperCase()}</span>}
                          </span>
                        </div>
                        {p.region && <span className="gh2h-dd-region">{p.region.toUpperCase()}</span>}
                      </div>
                      );
                    })}
                  </>
                )}

                {showTeams && searchResults.teams.length > 0 && (
                  <>
                    <div className="gh2h-dd-label">EQUIPOS</div>
                    {searchResults.teams.map(t => {
                      const idx = runIdx++;
                      return (
                      <div key={t.id} className={`gh2h-dd-item${idx === highlightIdx ? ' gh2h-dd-highlight' : ''}`} onClick={() => selectEntity(t, 'team')} onMouseEnter={() => setHighlightIdx(idx)}>
                        <Image
                          src={t.image_url || '/default-team.png'}
                          alt={t.name}
                          width={32}
                          height={32}
                          onError={e => (e.target as HTMLImageElement).style.display = 'none'}
                        />
                        <div className="gh2h-dd-info">
                          <span className="gh2h-dd-name">{t.name}</span>
                          <span className="gh2h-dd-meta">
                            {t.acronym && <span className="gh2h-dd-team">{t.acronym}</span>}
                          </span>
                        </div>
                        {t.region && <span className="gh2h-dd-region">{t.region.toUpperCase()}</span>}
                      </div>
                      );
                    })}
                  </>
                )}

                {searchResults.players.length === 0 && searchResults.teams.length === 0 && query.length >= 2 && !searching && (
                  <div className="gh2h-dd-empty">Sin resultados para &ldquo;{query}&rdquo;</div>
                )}
              </div>
              );
            })()}
          </div>

          {/* Selected chips */}
          {selected.length > 0 && (
            <div className="gh2h-chips-row">
              <div className="gh2h-chips">
                {selected.map(s => (
                  <div key={s.uid} className="gh2h-chip">
                    <Image
                      src={s.image_url || '/default.png'}
                      alt={s.name}
                      width={28}
                      height={28}
                      onError={e => (e.target as HTMLImageElement).style.display = 'none'}
                    />
                    <span className="gh2h-chip-name">{s.name}</span>
                    {s.loadingSeries ? (
                      <span className="gh2h-chip-loading">...</span>
                    ) : s.seriesOptions && s.seriesOptions.length > 0 ? (
                      <select
                        className="gh2h-chip-split"
                        value={s.serie_id || ''}
                        onChange={e => changeEntitySerie(s.uid, Number(e.target.value))}
                      >
                        {s.seriesOptions.map(opt => (
                          <option key={opt.id} value={opt.id}>{opt.label}</option>
                        ))}
                      </select>
                    ) : null}
                    <button className="gh2h-chip-x" aria-label={`Remove ${s.name}`} onClick={() => removeEntity(s.uid)}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
                    </button>
                  </div>
                ))}
              </div>
              <button className="gh2h-clear-all" onClick={() => { setSelected([]); setMode(null); setComparisonData([]); }}>
                Limpiar
              </button>
            </div>
          )}
        </div>

        {/* ═══════ WELCOME / INTRO ═══════ */}
        {selected.length === 0 && !loadingComparison && (
          <div className="gh2h-empty-state gh2h-welcome">
            <p className="gh2h-empty-title">Compara a tus jugadores y equipos favoritos</p>
            <p className="gh2h-empty-sub">
              Enfréntalos contra otros rivales ( o incluso consigo mismos ) para ver cómo rinden en diferentes splits.
            </p>
          </div>
        )}

        {/* ═══════ COMPARISON ═══════ */}
        {loadingComparison && (
          <div className="gh2h-loading">
            <div className="gh2h-spinner" />
            <span>Cargando comparativa...</span>
          </div>
        )}

        {comparisonData.length >= 2 && !loadingComparison && (
          <>
            <div className="gh2h-export-bar">
              <span className="gh2h-export-label">
                {effectiveMode === 'teams' ? 'COMPARATIVA DE EQUIPOS' : 'COMPARATIVA DE JUGADORES'}
              </span>
              <button className="gh2h-export-btn" onClick={handleExportPDF}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /><polyline points="10 9 9 9 8 9" /></svg>
                Exportar PDF
              </button>
            </div>

            {/* Radar chart comparativo — 2-4 entidades en desktop, hover interactivo */}
            {comparisonData.length >= 2 && comparisonData.length <= 4 && (
              <RadarChart
                axes={effectiveMode === 'teams' ? TEAM_RADAR_AXES : PLAYER_RADAR_AXES}
                players={comparisonData.map(p => ({
                  data: p,
                  name: String(effectiveMode === 'teams' ? (p.abbr || p.name) : p.name) || '?',
                  subtitle: p.serie_label ? String(p.serie_label) : undefined,
                }))}
                baseline={effectiveMode === 'players' ? roleBaseline : null}
                regionLabel={String(comparisonData[0].region || '').toUpperCase() || 'la liga'}
                sectionTitle={effectiveMode === 'teams' ? 'PERFIL DE EQUIPO' : 'PERFIL POR ROL'}
              />
            )}

            {/* Historial directo — solo para 2 equipos */}
            {effectiveMode === 'teams' && selected.length === 2 && (
              <H2HSeriesList
                teamAId={selected[0].id}
                teamBId={selected[1].id}
                fallbackA={{ abbr: selected[0].acronym || selected[0].name, logo: selected[0].image_url || undefined }}
                fallbackB={{ abbr: selected[1].acronym || selected[1].name, logo: selected[1].image_url || undefined }}
              />
            )}

            <CmpTable
              selected={comparisonData}
              statGroups={effectiveMode === 'teams' ? TEAM_STAT_GROUPS : PLAYER_STAT_GROUPS}
              getLogoFn={item => effectiveMode === 'teams' ? String(item.logo_url || '/default.png') : String(item.image_url || item.team_logo_url || '/default.png')}
              getNameFn={item => effectiveMode === 'teams' ? String(item.abbr || item.name) : String(item.name)}
            />
          </>
        )}

               {/* Empty state — only when user selected 2+ but API returned nothing */}
        {selected.length >= 2 && !loadingComparison && !selected.some(s => s.loadingSeries) && comparisonData.length === 0 && (
          <div className="gh2h-empty-state">
            <p className="gh2h-empty-title">No se encontraron datos para esta comparación</p>
            <p className="gh2h-empty-sub">Prueba con otros jugadores o equipos</p>
          </div>
        )}
      </div>
    </div>
  );
}
