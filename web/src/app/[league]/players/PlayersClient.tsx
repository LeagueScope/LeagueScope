'use client';

import { useState, useEffect, useMemo } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useFilters } from '@/context/FilterContext';
import { teamImg, LEAGUE_LOGO } from '@/lib/constants';
import { cellHasData, cellVal, cellCls } from '@/lib/formatters';
import { clientFetch } from '@/lib/clientFetch';
import { logger } from '@/lib/logger';
import type { ColDef, AllCol } from '@/lib/formatters';
import type { PlayerData } from './page';

/* ═══════════════════════════════════════════════════════════════════════════
   PlayersClient — Interactive player rankings with Pro Vision toggle
   Port of Players.jsx → Next.js client component
   ═══════════════════════════════════════════════════════════════════════════ */

const POSITIONS = ['All', 'top', 'jng', 'mid', 'bot', 'sup'];
const ROLE_ICON = (pos?: string): string => `/rol/${pos?.toLowerCase() || 'unknown'}.png`;

// ── PRO VISION column definitions ─────────────────────────────────────────────

interface GroupDef {
  label: string;
  cols: ColDef[];
}

const GROUPS: GroupDef[] = [
  {
    label: 'GENERAL',
    cols: [
      { key: 'avg_duration_formatted', label: 'AGT', type: 'str', tip: 'Duración media de partida (MM:SS)' },
      { key: 'unique_champions', label: 'UC', type: 'int_s', tip: 'Campeones únicos jugados en la temporada' },
      { key: 'fb_rate', label: 'FB%', type: 'pct_obj', tip: 'Participación en First Blood (kills + assists) (%)' },
      { key: 'first_tower_rate', label: 'FTW%', type: 'pct_obj', tip: 'Partidas con First Tower Kill (%)' },
    ],
  },
  {
    label: 'KDA',
    cols: [
      { key: 'avg_kills', label: 'K', type: 'float1', tip: 'Kills medias por partida' },
      { key: 'avg_deaths', label: 'D', type: 'float1', tip: 'Deaths medias por partida' },
      { key: 'avg_assists', label: 'A', type: 'float1', tip: 'Assists medias por partida' },
      { key: 'kda', label: 'KDA', type: 'kda_val', tip: 'Kill/Death/Assist ratio — (K+A)/D' },
      { key: 'kill_participation', label: 'KP%', type: 'pct_kp', tip: 'Kill Participation del equipo (%)' },
    ],
  },
  {
    label: 'PER MINUTE',
    cols: [
      { key: 'avg_gpm', label: 'GPM', type: 'gpm', tip: 'Gold generado por minuto' },
      { key: 'avg_cspm', label: 'CSPM', type: 'cspm', tip: 'Minions + Monstruos por minuto' },
      { key: 'avg_dpm', label: 'DPM', type: 'big_int', tip: 'Daño infligido a campeones por minuto' },
      { key: 'avg_dtaken_per_min', label: 'DTPM', type: 'big_int', tip: 'Daño recibido de campeones por minuto' },
      { key: 'avg_wpm', label: 'WPM', type: 'wpm', tip: 'Wards colocados por minuto' },
      { key: 'avg_wkpm', label: 'WCPM', type: 'wpm', tip: 'Wards borrados por minuto' },
      { key: 'avg_cwpm', label: 'CWPM', type: 'wpm', tip: 'Control Wards compradas por minuto' },
    ],
  },
  {
    label: 'SHARES',
    cols: [
      { key: 'avg_damage_share', label: 'DMG%', type: 'pct_share', tip: 'Damage Share dentro del equipo (%)' },
      { key: 'avg_gold_share', label: 'GOLD%', type: 'pct_share', tip: 'Gold Share dentro del equipo (%)' },
    ],
  },
  {
    label: 'DAMAGE',
    cols: [
      { key: 'avg_magic_dpm', label: 'MDPM', type: 'big_int', tip: 'Daño mágico a campeones por minuto' },
      { key: 'avg_physical_dpm', label: 'PDPM', type: 'big_int', tip: 'Daño físico a campeones por minuto' },
      { key: 'avg_true_dpm', label: 'TDPM', type: 'big_int', tip: 'Daño verdadero a campeones por minuto' },
      { key: 'avg_magic_dtaken_pm', label: 'MDTPM', type: 'big_int', tip: 'Daño mágico recibido por minuto' },
      { key: 'avg_physical_dtaken_pm', label: 'PDTPM', type: 'big_int', tip: 'Daño físico recibido por minuto' },
    ],
  },
  {
    label: 'EARLY GAME @13',
    cols: [
      { key: 'avg_cs_diff_13', label: 'CSD', type: 'diff', tip: 'CS Diff medio vs oponente de rol @13 min' },
      { key: 'avg_level_diff_13', label: 'LVLD', type: 'diff', tip: 'Level Diff medio vs oponente de rol @13 min' },
      { key: 'avg_kills_diff_13', label: 'KD', type: 'diff', tip: 'Kills Diff medio vs oponente de rol @13 min' },
    ],
  },
  {
    label: 'MID GAME @20',
    cols: [
      { key: 'avg_cs_diff_20', label: 'CSD', type: 'diff', tip: 'CS Diff medio vs oponente de rol @20 min' },
      { key: 'avg_level_diff_20', label: 'LVLD', type: 'diff', tip: 'Level Diff medio vs oponente de rol @20 min' },
      { key: 'avg_kills_diff_20', label: 'KD', type: 'diff', tip: 'Kills Diff medio vs oponente de rol @20 min' },
    ],
  },
  {
    label: 'LATE GAME @25',
    cols: [
      { key: 'avg_cs_diff_25', label: 'CSD', type: 'diff', tip: 'CS Diff medio vs oponente de rol @25 min' },
      { key: 'avg_level_diff_25', label: 'LVLD', type: 'diff', tip: 'Level Diff medio vs oponente de rol @25 min' },
      { key: 'avg_kills_diff_25', label: 'KD', type: 'diff', tip: 'Kills Diff medio vs oponente de rol @25 min' },
    ],
  },
  {
    label: 'COMBATE',
    cols: [
      { key: 'double_kills', label: 'DBL', type: 'int_s', tip: 'Double Kills totales en la temporada' },
      { key: 'triple_kills', label: 'TRP', type: 'int_s', tip: 'Triple Kills totales en la temporada' },
      { key: 'quadra_kills', label: 'QDR', type: 'int_s', tip: 'Quadra Kills totales en la temporada' },
      { key: 'penta_kills', label: 'PNT', type: 'int_s', tip: 'Penta Kills totales en la temporada' },
    ],
  },
  {
    label: 'ECONOMY',
    cols: [
      { key: 'avg_gold_spent', label: 'GSPENT', type: 'big_int', tip: 'Gold gastado medio por partida' },
      { key: 'avg_cc_per_min', label: 'CCPM', type: 'float1', tip: 'CC infligido por minuto (segundos)' },
      { key: 'avg_heal_per_min', label: 'HPM', type: 'big_int', tip: 'Heal total por minuto' },
    ],
  },
  {
    label: 'SIDE',
    cols: [
      { key: 'blue_wr', label: 'BLUE%', type: 'pct_side_b', tip: 'Win Rate jugando lado azul (%)' },
      { key: 'red_wr', label: 'RED%', type: 'pct_side_r', tip: 'Win Rate jugando lado rojo (%)' },
    ],
  },
];

const ALL_COLS: AllCol[] = GROUPS.flatMap(g => g.cols.map(c => ({ ...c, group: g.label })));

// ── Glossary ──────────────────────────────────────────────────────────────────
const GLOSSARY = [
  { group: 'GENERAL', desc: 'Métricas globales del jugador en la temporada.' },
  { group: 'KDA', desc: 'Métricas de rendimiento en combate. KDA ≥4 = verde, ≥2.5 = amarillo.' },
  { group: 'PER MINUTE', desc: 'Recursos generados o recibidos por minuto de juego. Visión incluida.' },
  { group: 'SHARES', desc: 'Participación en daño y gold dentro del equipo.' },
  { group: 'DAMAGE', desc: 'Desglose de daño infligido y recibido por tipo, por minuto.' },
  { group: 'EARLY GAME @13', desc: 'Diffs medios vs oponente de rol @13 min.' },
  { group: 'MID GAME @20', desc: 'Diffs medios vs oponente de rol @20 min.' },
  { group: 'LATE GAME @25', desc: 'Diffs medios vs oponente de rol @25 min.' },
  { group: 'COMBATE', desc: 'Actuaciones especiales en combate acumuladas en la temporada.' },
  { group: 'ECONOMY', desc: 'Economía, CC y curación.' },
  { group: 'SIDE', desc: 'Win Rate según el lado del mapa jugado.' },
];
const GLOSS_DESC: Record<string, string> = Object.fromEntries(GLOSSARY.map(g => [g.group, g.desc]));

// ── Streak helper ─────────────────────────────────────────────────────────────
function computeStreak(player: PlayerData): { type: string; count: number } | null {
  const log = player.match_log ?? [];
  if (!log.length) return null;
  const first = log[0].result;
  let count = 0;
  for (const entry of log) {
    if (entry.result === first) count++;
    else break;
  }
  // result can be boolean (true=win) or string ("W"/"L"/"win"/"loss")
  const isWin = first === true || first === 'W' || first === 'win';
  return { type: isWin ? 'W' : 'L', count };
}

// ═════════════════════════════════════════════════════════════════════════════

interface PlayersClientProps {
  league: string;
  accent: string;
  initialPlayers: PlayerData[];
}

export default function PlayersClient({ league, accent, initialPlayers }: PlayersClientProps) {
  const router = useRouter();
  const filters = useFilters();

  const [posFilter, setPosFilter] = useState('All');
  const [proVision, setProVision] = useState(false);
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [players, setPlayers] = useState(initialPlayers);

  useEffect(() => {
    if (!filters.ready) return;
    const qs = new URLSearchParams();
    qs.set('league', league.toUpperCase());
    if (filters.year) qs.set('year', String(filters.year));
    if (filters.split) qs.set('split', filters.split);
    if (filters.stage && filters.stage !== 'all') qs.set('stage', filters.stage);

    let cancelled = false;
    clientFetch<PlayerData[]>(`/api/v1/pg/players?${qs}`)
      .then(data => { if (!cancelled) setPlayers(data); })
      .catch(logger.error);

    return () => { cancelled = true; };
  }, [league, filters.ready, filters.year, filters.split, filters.stage]);

  const leagueName = league.toUpperCase();

  const filtered = useMemo(() =>
    posFilter === 'All'
      ? players
      : players.filter(p => p.position === posFilter),
    [players, posFilter]
  );

  const sorted = useMemo(() =>
    sortKey
      ? [...filtered].sort((a, b) => {
          const va = (a[sortKey] as number | string) ?? -Infinity;
          const vb = (b[sortKey] as number | string) ?? -Infinity;
          if (typeof va === 'string' && typeof vb === 'string')
            return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
          return sortDir === 'asc' ? (va as number) - (vb as number) : (vb as number) - (va as number);
        })
      : filtered,
    [filtered, sortKey, sortDir]
  );

  const handleSort = (key: string) => {
    if (sortKey === key) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortKey(key); setSortDir('desc'); }
  };

  return (
    <div className="p24-page" style={{ '--p24-accent': accent } as React.CSSProperties}>

      {/* ── HEADER ── */}
      <div className="p24-header">
        <div className="p24-header-info">
          <div className="p24-header-logo">
            <Image src={LEAGUE_LOGO(league)} alt={league} width={40} height={40} />
          </div>
          <div>
            <div className="p24-header-title">{leagueName} JUGADORES</div>
            <div className="p24-header-sub">SEASON {filters.year || ''} // {(filters.split || '').toUpperCase()}</div>
          </div>
        </div>
        <div className="p24-header-filters">
          {POSITIONS.map(pos => (
            <button
              key={pos}
              className={`p24-filter-btn ${pos === posFilter ? 'p24-filter-active' : ''}`}
              onClick={() => setPosFilter(pos)}
            >
              {pos === 'All' ? 'Todos' : pos.toUpperCase()}
            </button>
          ))}
        </div>
        <div className="p24-header-right">
          <button
            className={`p24-btn p24-btn-pv ${proVision ? 'p24-btn-active' : ''}`}
            onClick={() => setProVision(v => !v)}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
            PRO VISION
            {proVision && <span className="p24-pv-dot" />}
          </button>
          <div className="p24-header-stat">
            <span className="p24-hstat-val">{filtered.length}</span>
            <span className="p24-hstat-lbl">Jugadores</span>
          </div>
        </div>
      </div>

      {/* ── NORMAL TABLE ── */}
      {!proVision && (
        <div className="p24-table-card">
          <div className="p24-table-hdr">
            <span className="p24-col-pos">#</span>
            <span className="p24-col-role">ROL</span>
            <span className="p24-col-player">Jugador</span>
            <span className="p24-col-stat">Victorias</span>
            <span className="p24-col-stat">Derrotas</span>
            <span className="p24-col-stat">Partidas</span>
            <span className="p24-col-stat">Win Rate %</span>
            <span className="p24-col-streak">Racha</span>
          </div>
          <div className="p24-table-body">
            {filtered.map((p, i) => {
              const streak = computeStreak(p);
              const medal = i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : null;
              return (
                <div
                  key={`${p.name}-${p.team_abbr}`}
                  className={`p24-row ${medal ? `p24-row-${medal}` : ''}`}
                  onClick={() => router.push(`/${league}/player_profile/${encodeURIComponent(p.name)}?team=${encodeURIComponent(p.team_abbr)}`)}
                >
                  <span className={`p24-pos ${medal ? `p24-pos-${medal}` : ''}`}>{i + 1}</span>
                  <span className="p24-role-cell"><Image src={ROLE_ICON(p.position)} alt={p.position} className="p24-role-icon" width={20} height={20} /></span>
                  <div className="p24-player-cell">
                    <Image src={teamImg(p.team_logo_url, p.team_abbr, league)} className="p24-player-logo" alt={p.team_abbr} width={24} height={24} />
                    <div className="p24-player-text">
                      <span className={`p24-player-name ${medal ? `p24-name-${medal}` : ''}`}>{p.name}</span>
                      <span className="p24-player-team">{p.team_abbr}</span>
                    </div>
                  </div>
                  <span className="p24-stat p24-stat-w">{p.wins ?? '—'}</span>
                  <span className="p24-stat p24-stat-l">{p.losses ?? '—'}</span>
                  <span className="p24-stat">{p.games ?? '—'}</span>
                  <span className={`p24-stat p24-wr ${p.win_rate != null ? (p.win_rate >= 60 ? 'p24-wr-high' : p.win_rate >= 50 ? 'p24-wr-mid' : 'p24-wr-low') : ''}`}>
                    {p.win_rate != null ? p.win_rate.toFixed(0) + '%' : '—'}
                  </span>
                  <span className={`p24-streak ${streak ? (streak.type === 'W' ? 'p24-streak-w' : 'p24-streak-l') : ''}`}>
                    {streak ? streak.count : '—'}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── PRO VISION TABLE ── */}
      {proVision && (
        <div className="p24-pro-wrap">
          <table className="p24-pro-table">
            <thead>
              <tr className="p24-pro-groups">
                <th className="p24-th p24-th-pos p24-sticky-pos" rowSpan={2}>#</th>
                <th className="p24-th p24-th-role p24-sticky-role" rowSpan={2}>ROL</th>
                <th className="p24-th p24-th-player p24-sticky-player" rowSpan={2}>JUGADOR</th>
                {GROUPS.map(g => (
                  <th key={g.label} colSpan={g.cols.length} className="p24-th-group" title={GLOSS_DESC[g.label] || g.label}>{g.label}</th>
                ))}
              </tr>
              <tr className="p24-pro-stats">
                {ALL_COLS.map((c, i) => (
                  <th
                    key={i}
                    className={`p24-th-stat ${sortKey === c.key ? 'p24-th-sorted' : ''}`}
                    title={`[${c.group}] ${c.tip}`}
                    onClick={() => handleSort(c.key)}
                  >
                    {c.label}
                    {sortKey === c.key && <span className="p24-sort-arrow">{sortDir === 'desc' ? '▼' : '▲'}</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((p, i) => (
                <tr
                  key={`${p.name}-${p.team_abbr}`}
                  className={`p24-pro-row ${i % 2 === 1 ? 'p24-pro-alt' : ''}`}
                  onClick={() => router.push(`/${league}/player_profile/${encodeURIComponent(p.name)}?team=${encodeURIComponent(p.team_abbr)}`)}
                >
                  <td className="p24-td p24-td-pos p24-sticky-pos">
                    <span>{i + 1}</span>
                  </td>
                  <td className="p24-td p24-td-role p24-sticky-role">
                    <Image src={ROLE_ICON(p.position)} alt={p.position} className="p24-pro-role-icon" width={20} height={20} />
                  </td>
                  <td className="p24-td p24-td-player p24-sticky-player">
                    <div className="p24-pro-player-cell">
                      <Image src={teamImg(p.team_logo_url, p.team_abbr, league)} className="p24-pro-team-logo" alt={p.team_abbr} width={24} height={24} />
                      <span className="p24-pro-player-name">{p.name}</span>
                    </div>
                  </td>
                  {ALL_COLS.map((c, j) => {
                    const hasData = cellHasData(p as unknown as Record<string, unknown>, c);
                    const val = cellVal(p as unknown as Record<string, unknown>, c);
                    const cls = cellCls(val, c, hasData, 'p24-');
                    return <td key={j} className={`p24-td-stat ${cls}`}>{val}</td>;
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
