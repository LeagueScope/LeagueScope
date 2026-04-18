'use client';

import Image from 'next/image';
import { useState, useMemo, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { champImg, LEAGUE_LOGO, getWinRateClass } from '@/lib/constants';
import { cellHasData, cellVal, cellCls } from '@/lib/formatters';
import type { AllCol } from '@/lib/formatters';
import type { ChampionData } from './page';
import { useFilters } from '@/context/FilterContext';
import { clientFetch } from '@/lib/clientFetch';
import { logger } from '@/lib/logger';

/* ═══════════════════════════════════════════════════════════════════════════
   Champions Client — PRO VISION + Normal Table
   ═══════════════════════════════════════════════════════════════════════════ */

interface Props {
  league: string;
  accent: string;
  initialChampions: ChampionData[];
}

// ── PRO VISION column definitions ──────────────────────────────────────────────
const GROUPS = [
  {
    label: 'BÁSICO',
    cols: [
      { key: 'wins', label: 'W', type: 'int', tip: 'Victorias totales' },
      { key: 'losses', label: 'L', type: 'int', tip: 'Derrotas totales' },
      { key: 'win_rate', label: 'WR%', type: 'pct', tip: 'Win Rate (%)' },
    ],
  },
  {
    label: 'PRESENCIA',
    cols: [
      { key: 'games', label: 'PICKS', type: 'int', tip: 'Veces seleccionado en draft' },
      { key: 'pick_rate', label: 'PICK%', type: 'pct', tip: 'Pick Rate — porcentaje de partidas seleccionado' },
      { key: 'bans', label: 'BANS', type: 'int', tip: 'Veces baneado en draft' },
      { key: 'ban_rate', label: 'BAN%', type: 'pct', tip: 'Ban Rate — porcentaje de partidas baneado' },
      { key: 'presence', label: 'PRES%', type: 'pct', tip: 'Presencia total = Pick% + Ban%' },
    ],
  },
  {
    label: 'KDA',
    cols: [
      { key: 'avg_kills', label: 'K', type: 'float1', tip: 'Kills medias por partida' },
      { key: 'avg_deaths', label: 'D', type: 'float1', tip: 'Deaths medias por partida' },
      { key: 'avg_assists', label: 'A', type: 'float1', tip: 'Assists medias por partida' },
      { key: 'kda', label: 'KDA', type: 'kda_val', tip: 'Kill/Death/Assist ratio — (K+A)/D' },
      { key: 'kill_participation', label: 'KP%', type: 'pct_kp', tip: 'Kill Participation media del equipo (%)' },
    ],
  },
  {
    label: 'PER MINUTE',
    cols: [
      { key: 'avg_gpm', label: 'GOLD', type: 'gpm', tip: 'Gold generado por minuto' },
      { key: 'avg_cspm', label: 'CS', type: 'cspm', tip: 'CS (Minions + Monstruos) por minuto' },
      { key: 'avg_dpm', label: 'DMG', type: 'big_int', tip: 'Daño a campeones por minuto' },
      { key: 'avg_dtaken_per_min', label: 'DTAKEN', type: 'big_int', tip: 'Daño recibido por minuto' },
    ],
  },
  {
    label: 'COMBATE',
    cols: [
      { key: 'fb_rate', label: 'FB%', type: 'pct_obj', tip: 'Participación en First Blood (%)' },
    ],
  },
  {
    label: 'SIDE',
    cols: [
      { key: 'blue_wr', label: 'BLUE%', type: 'pct_side_b', tip: 'Win Rate en lado azul (%)' },
      { key: 'red_wr', label: 'RED%', type: 'pct_side_r', tip: 'Win Rate en lado rojo (%)' },
    ],
  },
  {
    label: 'META',
    cols: [
      { key: 'avg_duration_formatted', label: 'AGT', type: 'str', tip: 'Duración media de partida con este campeón' },
      { key: 'players_count', label: 'PLAYERS', type: 'int_s', tip: 'Jugadores únicos que lo han jugado' },
    ],
  },
];

const ALL_COLS: AllCol[] = GROUPS.flatMap(g => g.cols.map(c => ({ ...c, group: g.label })));

const GLOSSARY = [
  { group: 'BÁSICO', desc: 'Record del campeón en partidas competitivas durante la temporada.' },
  { group: 'PRESENCIA', desc: 'Relevancia del campeón en la fase de draft.' },
  { group: 'KDA', desc: 'Rendimiento individual en combate. KDA ≥4 = verde, ≥2.5 = amarillo.' },
  { group: 'PER MINUTE', desc: 'Recursos generados o recibidos por minuto de juego.' },
  { group: 'COMBATE', desc: 'Actuaciones destacadas en combate durante la temporada.' },
  { group: 'SIDE', desc: 'Rendimiento del campeón según el lado del mapa.' },
  { group: 'META', desc: 'Datos de contexto meta del campeón en la temporada.' },
];
const GLOSS_DESC: Record<string, string> = Object.fromEntries(GLOSSARY.map(g => [g.group, g.desc]));

const POSITIONS = ['All', 'top', 'jng', 'mid', 'bot', 'sup'];

export default function ChampionsClient({ league, accent, initialChampions }: Props) {
  const router = useRouter();
  const leagueUpper = league.toUpperCase();
  const filters = useFilters();

  const [posFilter, setPosFilter] = useState('All');
  const [proVision, setProVision] = useState(false);
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [champions, setChampions] = useState(initialChampions);

  useEffect(() => {
    if (!filters.ready) return;
    const qs = new URLSearchParams();
    qs.set('league', league.toUpperCase());
    if (filters.year) qs.set('year', String(filters.year));
    if (filters.split) qs.set('split', filters.split);
    if (filters.stage && filters.stage !== 'all') qs.set('stage', filters.stage);

    let cancelled = false;
    clientFetch<ChampionData[]>(`/api/v1/pg/champions?${qs}`)
      .then(data => { if (!cancelled) setChampions(data); })
      .catch(logger.error);

    return () => { cancelled = true; };
  }, [league, filters.ready, filters.year, filters.split, filters.stage]);

  const filtered = useMemo(() =>
    posFilter === 'All'
      ? champions
      : champions.filter(c => {
          if (c.position_breakdown && c.position_breakdown[posFilter] > 0) return true;
          if (c.position === posFilter) return true;
          return false;
        }),
    [champions, posFilter]
  );

  const sorted = useMemo(() =>
    sortKey
      ? [...filtered].sort((a, b) => {
          const va = (a as Record<string, unknown>)[sortKey] ?? -Infinity;
          const vb = (b as Record<string, unknown>)[sortKey] ?? -Infinity;
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

  const playedCount = useMemo(
    () => filtered.filter(c => ((c.games ?? c.picks) ?? 0) > 0).length,
    [filtered]
  );

  return (
    <div className="p25-page" style={{ '--p25-accent': accent } as React.CSSProperties}>

      {/* ── Editorial card: header unificado + filtros + body según modo ── */}
      <div className={`p25-ed-card ${proVision ? 'p25-ed-card-pro' : ''}`} data-league={league.toLowerCase()}>
        <Image
          src={LEAGUE_LOGO(league)}
          alt=""
          className="p25-ed-watermark"
          aria-hidden="true"
          width={280}
          height={280}
        />

        <div className="p25-ed-hdr">
          <div className="p25-ed-hdr-left">
            <Image src={LEAGUE_LOGO(league)} alt={league} className="p25-ed-logo" width={64} height={64} />
            <div className="p25-ed-hdr-text">
              <span className="p25-ed-hero">{leagueUpper} CAMPEONES</span>
              <span className="p25-ed-subhero">
                SEASON {filters.year || ''} · {(filters.split || '').toUpperCase()}
              </span>
            </div>
          </div>
          <div className="p25-ed-hdr-right">
            <button
              className={`p25-btn p25-btn-pv ${proVision ? 'p25-btn-active' : ''}`}
              onClick={() => setProVision(v => !v)}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
              PRO VISION
              {proVision && <span className="p25-pv-dot" />}
            </button>
            {posFilter === 'All' ? (
              <>
                <div className="p25-ed-teamstat">
                  <span className="p25-ed-teamcount">{playedCount}</span>
                  <span className="p25-ed-teamlbl">Jugados</span>
                </div>
                <div className="p25-ed-teamstat">
                  <span className="p25-ed-teamcount">{filtered.length}</span>
                  <span className="p25-ed-teamlbl">Presentes</span>
                </div>
              </>
            ) : (
              <div className="p25-ed-teamstat">
                <span className="p25-ed-teamcount">{filtered.length}</span>
                <span className="p25-ed-teamlbl">Campeones</span>
              </div>
            )}
          </div>
        </div>

        {/* ── Filtros de rol (segunda franja del header editorial) ── */}
        <div className="p25-ed-filters">
          <span className="p25-ed-filters-lbl">Rol</span>
          <div className="p25-ed-filters-group">
            {POSITIONS.map(pos => (
              <button
                key={pos}
                className={`p25-filter-btn ${pos === posFilter ? 'p25-filter-active' : ''}`}
                onClick={() => setPosFilter(pos)}
              >
                {pos === 'All' ? 'Todos' : pos.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        {/* ── BODY: NORMAL ── */}
        {!proVision && (
          <div className="p25-ed-table">
            <div className="p25-ed-thead">
              <span className="p25-ed-col-pos">#</span>
              <span className="p25-ed-col-champ">Campeón</span>
              <span className="p25-ed-col-num">PICKS</span>
              <span className="p25-ed-col-num">WR%</span>
              <span className="p25-ed-col-num">PICK%</span>
              <span className="p25-ed-col-num">BANS</span>
              <span className="p25-ed-col-num">BAN%</span>
              <span className="p25-ed-col-num">KDA</span>
            </div>
            <div className="p25-ed-tbody">
              {filtered.map((c, i) => {
                const medal = i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : null;
                const wrCls = c.win_rate != null ? getWinRateClass(c.win_rate) : '';
                return (
                  <div
                    key={c.name}
                    className="p25-ed-row"
                    onClick={() => router.push(`/${league}/champion_profile/${encodeURIComponent(c.name)}`)}
                  >
                    <span className="p25-ed-pos">
                      {medal && <span className={`p25-ed-medal p25-ed-medal-${medal}`} />}
                      <span className="p25-ed-pos-num">{String(i + 1).padStart(2, '0')}</span>
                    </span>
                    <div className="p25-ed-champ">
                      <div className="p25-ed-champ-img">
                        <Image src={champImg(c.image_url) ?? ''} alt={c.name} width={32} height={32} onError={e => (e.target as HTMLImageElement).style.display = 'none'} />
                      </div>
                      <span className="p25-ed-champ-name">{c.name}</span>
                    </div>
                    <span className="p25-ed-num">{c.games ?? '—'}</span>
                    <span className={`p25-ed-num p25-ed-wr ${wrCls}`}>
                      {c.win_rate != null ? Number(c.win_rate).toFixed(0) + '%' : '—'}
                    </span>
                    <span className="p25-ed-num">{c.pick_rate != null ? c.pick_rate + '%' : '—'}</span>
                    <span className="p25-ed-num">{c.bans ?? '—'}</span>
                    <span className="p25-ed-num">{c.ban_rate != null ? c.ban_rate + '%' : '—'}</span>
                    <span className="p25-ed-num">{c.kda != null ? Number(c.kda).toFixed(2) : '—'}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── BODY: PRO VISION (tabla densa, misma card editorial) ── */}
        {proVision && (
          <div className="p25-pro-wrap">
          <table className="p25-pro-table">
            <thead>
              <tr className="p25-pro-groups">
                <th className="p25-th p25-th-pos p25-sticky-pos" rowSpan={2}>#</th>
                <th className="p25-th p25-th-champ p25-sticky-champ" rowSpan={2}>CAMPEÓN</th>
                {GROUPS.map(g => (
                  <th key={g.label} colSpan={g.cols.length} className="p25-th-group" title={GLOSS_DESC[g.label] || g.label}>{g.label}</th>
                ))}
              </tr>
              <tr className="p25-pro-stats">
                {ALL_COLS.map((c, i) => (
                  <th
                    key={i}
                    className={`p25-th-stat ${sortKey === c.key ? 'p25-th-sorted' : ''}`}
                    title={`[${c.group}] ${c.tip}`}
                    onClick={() => handleSort(c.key)}
                  >
                    {c.label}
                    {sortKey === c.key && <span className="p25-sort-arrow">{sortDir === 'desc' ? '▼' : '▲'}</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((c, i) => (
                <tr
                  key={c.name}
                  className={`p25-pro-row ${i % 2 === 1 ? 'p25-pro-alt' : ''}`}
                  onClick={() => router.push(`/${league}/champion_profile/${encodeURIComponent(c.name)}`)}
                >
                  <td className="p25-td p25-td-pos p25-sticky-pos">
                    <span>{i + 1}</span>
                  </td>
                  <td className="p25-td p25-td-champ p25-sticky-champ">
                    <div className="p25-pro-champ-cell">
                      <Image
                        src={champImg(c.image_url) ?? ''}
                        className="p25-pro-champ-icon"
                        alt={c.name}
                        width={28}
                        height={28}
                        onError={e => (e.target as HTMLImageElement).style.display = 'none'}
                      />
                      <span className="p25-pro-champ-name">{c.name}</span>
                    </div>
                  </td>
                  {ALL_COLS.map((col, j) => {
                    const hasData = cellHasData(c as unknown as Record<string, unknown>, col);
                    const val = cellVal(c as unknown as Record<string, unknown>, col);
                    const cls = cellCls(val, col, hasData, 'p25-');
                    return <td key={j} className={`p25-td-stat ${cls}`}>{val}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      </div>
    </div>
  );
}
