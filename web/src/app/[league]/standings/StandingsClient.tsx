'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useFilters } from '@/context/FilterContext';
import { teamImg, LEAGUE_LOGO, getWinRateClass } from '@/lib/constants';
import { clientFetch } from '@/lib/clientFetch';
import { logger } from '@/lib/logger';
import type { TeamData } from './page';

/* ═══════════════════════════════════════════════════════════════════════════
   StandingsClient — Interactive standings with Pro Vision toggle
   Port of Standings.jsx → Next.js client component
   ═══════════════════════════════════════════════════════════════════════════ */

// ── Column definitions ──────────────────────────────────────────────────────
interface ColDef {
  key: string;
  label: string;
  type: string;
  tip: string;
}

interface GroupDef {
  label: string;
  cols: ColDef[];
}

const GROUPS: GroupDef[] = [
  {
    label: 'BÁSICO',
    cols: [
      { key: 'wins', label: 'W', type: 'int', tip: 'Victorias totales' },
      { key: 'losses', label: 'L', type: 'int', tip: 'Derrotas totales' },
      { key: 'win_rate', label: 'WR%', type: 'pct', tip: 'Win Rate (%)' },
      { key: 'games', label: 'G', type: 'int', tip: 'Partidas jugadas' },
    ],
  },
  {
    label: 'GENERAL',
    cols: [
      { key: 'avg_duration_formatted', label: 'AGT', type: 'str', tip: 'Average Game Time' },
      { key: 'unique_champions', label: 'UC', type: 'int_s', tip: 'Unique Champions jugados' },
      { key: 'first_blood_rate', label: 'FB%', type: 'pct_obj', tip: 'First Blood rate (%)' },
      { key: 'first_tower_rate', label: 'FTW%', type: 'pct_obj', tip: 'First Tower rate (%)' },
      { key: 'first_dragon_rate', label: 'FDR%', type: 'pct_obj', tip: 'First Dragon rate (%)' },
      { key: 'first_baron_rate', label: 'FNA%', type: 'pct_obj', tip: 'First Nashor rate (%)' },
      { key: 'first_herald_rate', label: 'FHR%', type: 'pct_obj', tip: 'First Herald rate (%)' },
      { key: 'first_voidgrub_rate', label: 'FVG%', type: 'pct_obj', tip: 'First Voidgrub rate (%)' },
      { key: 'first_inhibitor_rate', label: 'FIN%', type: 'pct_obj', tip: 'First Inhibitor rate (%)' },
      { key: 'first_atakhan_rate', label: 'FAT%', type: 'pct_obj', tip: 'First Atakhan rate (%)' },
    ],
  },
  {
    label: 'PER MINUTE',
    cols: [
      { key: 'avg_gpm', label: 'GPM', type: 'big_int', tip: 'Gold por minuto' },
      { key: 'delta_gpm', label: 'ΔGPM', type: 'diff_big', tip: 'Diferencial de gold por minuto vs rival' },
      { key: 'avg_cspm', label: 'CSPM', type: 'float1', tip: 'CS por minuto' },
      { key: 'delta_cspm', label: 'ΔCSPM', type: 'diff_f', tip: 'Diferencial de CS por minuto vs rival' },
      { key: 'avg_dpm', label: 'DPM', type: 'big_int', tip: 'Daño infligido por minuto' },
      { key: 'avg_dtaken_per_min', label: 'DTPM', type: 'big_int', tip: 'Daño recibido por minuto' },
      { key: 'avg_wpm', label: 'WPM', type: 'float2', tip: 'Wards colocados por minuto' },
      { key: 'avg_wkpm', label: 'WCPM', type: 'float2', tip: 'Wards destruidos (cleared) por minuto' },
      { key: 'avg_cwpm', label: 'CWPM', type: 'float2', tip: 'Control Wards comprados por minuto' },
    ],
  },
  {
    label: 'AVG / GAME',
    cols: [
      { key: 'avg_kills', label: 'K', type: 'float1', tip: 'Kills medias por partida' },
      { key: 'avg_deaths', label: 'D', type: 'float1', tip: 'Deaths medias por partida' },
      { key: 'avg_assists', label: 'A', type: 'float1', tip: 'Assists medias por partida' },
      { key: 'kda', label: 'KDA', type: 'float2', tip: 'Kill/Death/Assist ratio' },
    ],
  },
  {
    label: 'OBJECTIVES',
    cols: [
      { key: 'avg_towers', label: 'TW+', type: 'float1', tip: 'Torres destruidas por partida' },
      { key: 'avg_towers_lost', label: 'TW-', type: 'float1', tip: 'Torres perdidas por partida' },
      { key: 'avg_dragons', label: 'DR', type: 'float1', tip: 'Dragones por partida' },
      { key: 'avg_barons', label: 'BR', type: 'float1', tip: 'Barones por partida' },
      { key: 'avg_heralds', label: 'HR', type: 'float1', tip: 'Heraldos por partida' },
      { key: 'avg_voidgrubs', label: 'VG', type: 'float1', tip: 'Voidgrubs por partida' },
      { key: 'avg_inhibitors', label: 'INH', type: 'float1', tip: 'Inhibidores por partida' },
      { key: 'avg_atakhans', label: 'ATK', type: 'float1', tip: 'Atakhans por partida' },
    ],
  },
  {
    label: 'DAMAGE',
    cols: [
      { key: 'avg_magic_dpm', label: 'MDPM', type: 'big_int', tip: 'Daño mágico por minuto' },
      { key: 'avg_physical_dpm', label: 'PDPM', type: 'big_int', tip: 'Daño físico por minuto' },
      { key: 'avg_true_dpm', label: 'TDPM', type: 'big_int', tip: 'Daño verdadero por minuto' },
      { key: 'avg_magic_dtaken_pm', label: 'MDTPM', type: 'big_int', tip: 'Daño mágico recibido por minuto' },
      { key: 'avg_physical_dtaken_pm', label: 'PDTPM', type: 'big_int', tip: 'Daño físico recibido por minuto' },
    ],
  },
  {
    label: 'EARLY GAME @13',
    cols: [
      { key: 'avg_gold_diff_13', label: 'GD', type: 'diff_big', tip: 'Gold Diff medio @13 min' },
      { key: 'avg_cs_diff_13', label: 'CSD', type: 'diff_f', tip: 'CS Diff medio @13 min' },
      { key: 'avg_kills_diff_13', label: 'KD', type: 'diff_f', tip: 'Kills Diff medio @13 min' },
      { key: 'avg_tower_diff_13', label: 'TWD', type: 'diff_f', tip: 'Tower Diff medio @13 min' },
    ],
  },
  {
    label: 'MID GAME @20',
    cols: [
      { key: 'avg_gold_diff_20', label: 'GD', type: 'diff_big', tip: 'Gold Diff medio @20 min' },
      { key: 'avg_cs_diff_20', label: 'CSD', type: 'diff_f', tip: 'CS Diff medio @20 min' },
      { key: 'avg_kills_diff_20', label: 'KD', type: 'diff_f', tip: 'Kills Diff medio @20 min' },
      { key: 'avg_tower_diff_20', label: 'TWD', type: 'diff_f', tip: 'Tower Diff medio @20 min' },
    ],
  },
  {
    label: 'LATE GAME @25',
    cols: [
      { key: 'avg_gold_diff_25', label: 'GD', type: 'diff_big', tip: 'Gold Diff medio @25 min' },
      { key: 'avg_cs_diff_25', label: 'CSD', type: 'diff_f', tip: 'CS Diff medio @25 min' },
      { key: 'avg_kills_diff_25', label: 'KD', type: 'diff_f', tip: 'Kills Diff medio @25 min' },
      { key: 'avg_tower_diff_25', label: 'TWD', type: 'diff_f', tip: 'Tower Diff medio @25 min' },
    ],
  },
  {
    label: 'ECONOMY',
    cols: [
      { key: 'avg_gold_spent', label: 'GSPENT', type: 'big_int', tip: 'Gold gastado medio por partida' },
      { key: 'avg_neutral_minions_enemy', label: 'NMENEMY', type: 'float1', tip: 'Neutral minions jungla enemiga / partida' },
      { key: 'avg_neutral_minions_team', label: 'NMTEAM', type: 'float1', tip: 'Neutral minions jungla propia / partida' },
      { key: 'avg_cc_per_min', label: 'CCPM', type: 'float1', tip: 'CC dealt por minuto (segundos)' },
      { key: 'avg_heal_per_min', label: 'HPM', type: 'float1', tip: 'Curación por minuto' },
    ],
  },
  {
    label: 'SIDE',
    cols: [
      { key: 'blue_wr', label: 'BLUE%', type: 'pct_side_b', tip: 'Win Rate en lado azul (%)' },
      { key: 'red_wr', label: 'RED%', type: 'pct_side_r', tip: 'Win Rate en lado rojo (%)' },
    ],
  },
];

interface AllCol extends ColDef {
  group: string;
}

const ALL_COLS: AllCol[] = GROUPS.flatMap(g => g.cols.map(c => ({ ...c, group: g.label })));

// ── Glossary content ──────────────────────────────────────────────────────────
const GLOSSARY = [
  { group: 'BÁSICO', desc: 'Record fundamental del equipo en la temporada actual.', stats: ['W — Victorias', 'L — Derrotas', 'WR% — Win Rate', 'G — Partidas jugadas'] },
  { group: 'GENERAL', desc: 'Métricas globales de estilo de juego y control de objetivos tempranos.', stats: ['AGT — Duración media de partida', 'UC — Campeones únicos jugados', 'FB% — First Blood', 'FTW% — Primera torre', 'FDR% — Primer dragón', 'FNA% — Primer Nashor', 'FHR% — Primer heraldo', 'FVG% — Primer Voidgrub', 'FIN% — Primer Inhibidor', 'FAT% — Primer Atakhan'] },
  { group: 'PER MINUTE', desc: 'Recursos generados o intercambiados por minuto de juego.', stats: ['GPM — Gold por minuto', 'ΔGPM — Diferencial gold/min vs rival', 'CSPM — CS por minuto', 'ΔCSPM — Diferencial CS/min vs rival', 'DPM — Daño infligido/min', 'DTPM — Daño recibido/min', 'WPM — Wards colocados/min', 'WCPM — Wards destruidos/min', 'CWPM — Control Wards comprados/min'] },
  { group: 'AVG / GAME', desc: 'Promedios por partida acumulados a lo largo de la temporada.', stats: ['K / D / A — Kills, Deaths, Assists', 'KDA — Ratio (K+A)/D'] },
  { group: 'OBJECTIVES', desc: 'Control de objetivos neutros y estructuras por partida.', stats: ['TW+ / TW- — Torres destruidas/perdidas', 'DR — Dragones', 'BR — Barones', 'HR — Heraldos', 'VG — Voidgrubs', 'INH — Inhibidores', 'ATK — Atakhans'] },
  { group: 'DAMAGE', desc: 'Desglose del daño infligido y recibido por tipo, normalizado por minuto.', stats: ['MDPM — Daño mágico/min', 'PDPM — Daño físico/min', 'TDPM — Daño verdadero/min', 'MDTPM — Daño mágico recibido/min', 'PDTPM — Daño físico recibido/min'] },
  { group: 'EARLY @13', desc: 'Diferenciales de recursos al minuto 13 (fase de carriles).', stats: ['GD — Gold Diff', 'CSD — CS Diff', 'KD — Kills Diff', 'TWD — Tower Diff'] },
  { group: 'MID @20', desc: 'Diferenciales de recursos al minuto 20 (rotaciones y objetivos).', stats: ['GD — Gold Diff', 'CSD — CS Diff', 'KD — Kills Diff', 'TWD — Tower Diff'] },
  { group: 'LATE @25', desc: 'Diferenciales de recursos al minuto 25 (teamfights y cierre).', stats: ['GD — Gold Diff', 'CSD — CS Diff', 'KD — Kills Diff', 'TWD — Tower Diff'] },
  { group: 'ECONOMY', desc: 'Métricas avanzadas de economía, control de jungla y utilidad del equipo.', stats: ['GSPENT — Gold gastado por partida', 'NMENEMY — Neutral minions jungla enemiga', 'NMTEAM — Neutral minions jungla propia', 'CCPM — CC dealt por minuto', 'HPM — Curación por minuto'] },
  { group: 'SIDE', desc: 'Rendimiento diferenciado según el lado del mapa asignado.', stats: ['BLUE% — Win Rate en lado azul', 'RED% — Win Rate en lado rojo'] },
];

// Map group label → glossary description (for group header tooltips)
const GLOSS_DESC: Record<string, string> = Object.fromEntries(GLOSSARY.map(g => [g.group, g.desc]));

// ── Cell formatters ──────────────────────────────────────────────────────────
function cellVal(team: TeamData, col: ColDef): string {
  const v = team[col.key];
  if (v !== undefined && v !== null) {
    switch (col.type) {
      case 'pct': case 'pct_obj': case 'pct_side_b': case 'pct_side_r':
        return typeof v === 'number' ? v.toFixed(0) + '%' : String(v);
      case 'float1': return typeof v === 'number' ? v.toFixed(1) : String(v);
      case 'float2': return typeof v === 'number' ? v.toFixed(2) : String(v);
      case 'int': case 'int_s': return typeof v === 'number' ? String(Math.round(v)) : String(v);
      case 'big_int': return typeof v === 'number' ? Math.round(v).toLocaleString() : String(v);
      case 'diff_big': case 'diff_sm': return typeof v === 'number' ? (v >= 0 ? '+' : '') + Math.round(v) : String(v);
      case 'diff_xs': case 'diff_f': return typeof v === 'number' ? (v >= 0 ? '+' : '') + v.toFixed(1) : String(v);
      case 'str': return String(v);
      default: return String(v ?? '—');
    }
  }
  return '—';
}

function cellHasData(team: TeamData, col: ColDef): boolean {
  const v = team[col.key];
  return v !== undefined && v !== null;
}

function cellCls(val: string, col: ColDef, hasData: boolean): string {
  if (!hasData || val === '—') return 'p20-cv-na';
  const { type } = col;
  if (['diff_big', 'diff_sm', 'diff_xs', 'diff_f'].includes(type)) {
    const n = parseFloat(String(val).replace('+', ''));
    if (n > 0) return 'p20-cv-pos';
    if (n < 0) return 'p20-cv-neg';
    return 'p20-cv-zero';
  }
  if (type === 'pct_obj') {
    const n = parseFloat(val);
    if (n > 55) return 'p20-cv-pos';
    if (n < 45) return 'p20-cv-neg';
    return '';
  }
  if (type === 'pct_side_b') return 'p20-cv-blue';
  if (type === 'pct_side_r') return 'p20-cv-red';
  return '';
}

// ═════════════════════════════════════════════════════════════════════════════

interface StandingsClientProps {
  league: string;
  accent: string;
  initialTeams: TeamData[];
}

export default function StandingsClient({ league, accent, initialTeams }: StandingsClientProps) {
  const router = useRouter();
  const filters = useFilters();

  const [proVision, setProVision] = useState(false);
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [teams, setTeams] = useState(initialTeams);

  useEffect(() => {
    if (!filters.ready) return;
    const qs = new URLSearchParams();
    qs.set('league', league.toUpperCase());
    if (filters.year) qs.set('year', String(filters.year));
    if (filters.split) qs.set('split', filters.split);
    if (filters.stage && filters.stage !== 'all') qs.set('stage', filters.stage);

    const controller = new AbortController();
    clientFetch<TeamData[]>(`/api/v1/pg/teams?${qs}`, { signal: controller.signal })
      .then(data => setTeams(data))
      .catch(logger.error);

    return () => { controller.abort(); };
  }, [league, filters.ready, filters.year, filters.split, filters.stage]);

  const handleSort = (key: string) => {
    if (sortKey === key) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortKey(key); setSortDir('desc'); }
  };

  const defaultSorted = [...teams].sort((a, b) =>
    b.wins !== a.wins ? b.wins - a.wins : b.win_rate - a.win_rate
  );

  const sorted = sortKey
    ? [...defaultSorted].sort((a, b) => {
        const va = (a[sortKey] as number | string) ?? -Infinity;
        const vb = (b[sortKey] as number | string) ?? -Infinity;
        if (typeof va === 'string' && typeof vb === 'string')
          return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
        return sortDir === 'asc' ? (va as number) - (vb as number) : (vb as number) - (va as number);
      })
    : defaultSorted;

  const getStreak = (team: TeamData): { type: string; count: number } => {
    if (!team.match_history?.length) return { type: 'W', count: 0 };
    const first = team.match_history[0]?.result;
    let count = 0;
    for (const m of team.match_history) {
      if (m.result === first) count++; else break;
    }
    return { type: first ? 'W' : 'L', count };
  };

  const leagueName = league.toUpperCase();

  return (
    <div className="p20-page" style={{ '--p20-accent': accent } as React.CSSProperties}>

      {/* ── HEADER (p22-style) ── */}
      <div className="p20-header">
        <div className="p20-header-info">
          <div className="p20-header-logo">
            <Image src={LEAGUE_LOGO(league)} alt={league} width={40} height={40} />
          </div>
          <div>
            <div className="p20-header-title">{leagueName} STANDINGS</div>
            <div className="p20-header-sub">SEASON {filters.year || ''} // {(filters.split || '').toUpperCase()}</div>
          </div>
        </div>
        <div className="p20-header-actions">
          <button
            className={`p20-btn p20-btn-pv ${proVision ? 'p20-btn-active' : ''}`}
            onClick={() => setProVision(v => !v)}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
            PRO VISION
            {proVision && <span className="p20-pv-dot" />}
          </button>
          <div className="p20-header-stat">
            <span className="p20-hstat-val">{teams.length}</span>
            <span className="p20-hstat-lbl">Equipos</span>
          </div>
        </div>
      </div>

      {/* ── NORMAL TABLE ── */}
      {!proVision && (
        <div className="p20-table-card">
          <div className="p20-table-hdr">
            <span className="p20-col-pos">#</span>
            <span className="p20-col-team">Equipo</span>
            <span className="p20-col-stat">Victorias</span>
            <span className="p20-col-stat">Derrotas</span>
            <span className="p20-col-stat">Partidas</span>
            <span className="p20-col-stat">Win Rate %</span>
            <span className="p20-col-streak">Racha</span>
          </div>
          <div className="p20-table-body">
            {sorted.map((t, i) => {
              const streak = getStreak(t);
              const medal = i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : null;
              return (
                <div
                  key={t.abbr}
                  className={`p20-row ${medal ? `p20-row-${medal}` : ''}`}
                  onClick={() => router.push(`/${league}/team_profile/${t.slug || t.abbr}`)}
                >
                  <span className={`p20-pos ${medal ? `p20-pos-${medal}` : ''}`}>{i + 1}</span>
                  <div className="p20-team-cell">
                    <Image src={teamImg(t.logo_url, t.abbr, league)} className="p20-team-logo" alt={t.abbr} width={24} height={24} />
                    <div className="p20-team-text">
                      <span className={`p20-team-name ${medal ? `p20-name-${medal}` : ''}`}>{t.team}</span>
                      <span className="p20-team-abbr">{t.abbr}</span>
                    </div>
                  </div>
                  <span className="p20-stat p20-stat-w">{t.wins}</span>
                  <span className="p20-stat p20-stat-l">{t.losses}</span>
                  <span className="p20-stat">{t.games}</span>
                  <span className={`p20-stat p20-wr ${getWinRateClass(t.win_rate)}`}>{t.win_rate}%</span>
                  <span className={`p20-streak p20-streak-${streak.type.toLowerCase()}`}>{streak.count}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── PRO VISION TABLE ── */}
      {proVision && (
        <div className="p20-pro-wrap">
          <table className="p20-pro-table">
            <thead>
              <tr className="p20-pro-groups">
                <th className="p20-th p20-th-pos p20-sticky-pos" rowSpan={2}>#</th>
                <th className="p20-th p20-th-team p20-sticky-team" rowSpan={2}>EQUIPO</th>
                {GROUPS.map(g => (
                  <th key={g.label} colSpan={g.cols.length} className="p20-th-group" title={GLOSS_DESC[g.label] || g.label}>{g.label}</th>
                ))}
              </tr>
              <tr className="p20-pro-stats">
                {ALL_COLS.map((c, i) => (
                  <th
                    key={i}
                    className={`p20-th-stat ${sortKey === c.key ? 'p20-th-sorted' : ''}`}
                    title={`[${c.group}] ${c.tip}`}
                    onClick={() => handleSort(c.key)}
                  >
                    {c.label}
                    {sortKey === c.key && <span className="p20-sort-arrow">{sortDir === 'desc' ? '▼' : '▲'}</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((t, i) => (
                  <tr
                    key={t.abbr}
                    className={`p20-pro-row ${i % 2 === 1 ? 'p20-pro-alt' : ''}`}
                    onClick={() => router.push(`/${league}/team_profile/${t.slug || t.abbr}`)}
                  >
                    <td className="p20-td p20-td-pos p20-sticky-pos">
                      <span>{i + 1}</span>
                    </td>
                    <td className="p20-td p20-td-team p20-sticky-team">
                      <div className="p20-pro-team-cell">
                        <Image src={teamImg(t.logo_url, t.abbr, league)} className="p20-pro-logo" alt={t.abbr} width={24} height={24} />
                        <span className="p20-pro-abbr">{t.abbr}</span>
                      </div>
                    </td>
                    {ALL_COLS.map((c, j) => {
                      const hasData = cellHasData(t, c);
                      const val = cellVal(t, c);
                      const cls = cellCls(val, c, hasData);
                      return <td key={j} className={`p20-td-stat ${cls}`}>{val}</td>;
                    })}
                  </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
