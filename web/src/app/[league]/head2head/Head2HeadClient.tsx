'use client';

import Image from 'next/image';
import React, { useState, useEffect } from 'react';
import { teamImg, LEAGUE_LOGO } from '@/lib/constants';
import { useFilters } from '@/context/FilterContext';
import { clientFetch } from '@/lib/clientFetch';

/* ══════════════════════════════════════════════════════════════
   HeadToHead — Client Component
   Comparador de equipos y jugadores (PostgreSQL)
   ══════════════════════════════════════════════════════════════ */

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

const ROLES = [
  { key: 'all', label: 'TODOS' },
  { key: 'top', label: 'TOP' },
  { key: 'jng', label: 'JGL' },
  { key: 'mid', label: 'MID' },
  { key: 'bot', label: 'BOT' },
  { key: 'sup', label: 'SUP' },
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

/* ── Interfaces ──────────────────────────────────────────── */
interface TeamData {
  abbr: string;
  name?: string;
  logo_url?: string;
  wins?: number;
  losses?: number;
  games?: number;
  [key: string]: unknown;
}

interface PlayerData {
  name: string;
  team_abbr?: string;
  team_logo_url?: string;
  position?: string;
  [key: string]: unknown;
}

interface H2HGame {
  gameid?: string | number;
  team_a_win?: boolean;
  team_b_win?: boolean;
  team_a_kills?: number;
  team_b_kills?: number;
  team_a_side?: string;
  team_b_side?: string;
  date?: string;
  duration?: number;
}

interface H2HData {
  summary?: { team_a_wins: number; team_b_wins: number };
  matchupHistory?: H2HGame[];
}

/* ── CmpTable sub-component ──────────────────────────────── */
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
          {selected.map(item => (
            <div key={getNameFn(item)} className="p11-stats-hdr-item">
              <Image
                src={getLogoFn(item)}
                className="p11-stats-hdr-logo"
                alt={getNameFn(item)}
                width={48}
                height={48}
                onError={e => (e.target as HTMLImageElement).style.display = 'none'}
              />
              <span className="p11-stats-hdr-name">{getNameFn(item)}</span>
            </div>
          ))}
        </div>

        {statGroups.map(group => (
          <div key={group.label}>
            <div className="p11-stat-row" style={{ gridTemplateColumns: 'gridCols' }}>
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
                      <div key={getNameFn(item)} className="p11-col-val">
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

interface Props {
  league: string;
  accent: string;
  glow: string;
}

export default function Head2HeadClient({ league, accent, glow }: Props) {
  const filters = useFilters();
  const filterYear = filters.year ? String(filters.year) : '';
  const filterSplit = filters.split || '';

  const [mode, setMode] = useState<'teams' | 'players'>('teams');
  const [selTeams, setSelTeams] = useState<string[]>([]);
  const [selPlayers, setSelPlayers] = useState<string[]>([]);
  const [roleFilter, setRoleFilter] = useState('all');

  const [teams, setTeams] = useState<TeamData[]>([]);
  const [players, setPlayers] = useState<PlayerData[]>([]);
  const [loading, setLoading] = useState(true);

  const [h2hData, setH2hData] = useState<H2HData | null>(null);
  const [h2hLoading, setH2hLoading] = useState(false);

  /* ── Load data ── */
  useEffect(() => {
    let cancelled = false;
    async function loadData() {
      setLoading(true);
      try {
        const params = new URLSearchParams({ league: league.toUpperCase() });
        if (filterYear) params.set('year', filterYear);
        if (filterSplit) params.set('split', filterSplit);
        const qs = params.toString();

        const [td, pd] = await Promise.all([
          clientFetch<TeamData[]>(`/api/v1/pg/teams?${qs}`),
          clientFetch<PlayerData[]>(`/api/v1/pg/players?${qs}`),
        ]);
        if (!cancelled) {
          const uniqueTeams: TeamData[] = td ? [...new Map((td as TeamData[]).map(t => [t.abbr, t])).values()] : [];
          setTeams(uniqueTeams);
          setPlayers(pd || []);
          setSelTeams([]);
          setSelPlayers([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    loadData();
    return () => { cancelled = true; };
  }, [league, filterYear, filterSplit]);

  /* ── Fetch H2H match history when exactly 2 teams selected ── */
  useEffect(() => {
    let active = true;
    if (mode === 'teams' && selTeams.length === 2) {
      setH2hLoading(true);
      const params = new URLSearchParams({ league: league.toUpperCase(), teamA: selTeams[0], teamB: selTeams[1] });
      if (filterYear) params.set('year', filterYear);
      if (filterSplit) params.set('split', filterSplit);
      clientFetch<H2HData>(`/api/v1/pg/headtohead?${params.toString()}`)
        .then(data => { if (active) { setH2hData(data); setH2hLoading(false); } })
        .catch(() => { if (active) setH2hLoading(false); });
    } else {
      setH2hData(null);
    }
    return () => { active = false; };
  }, [selTeams, mode, league, filterYear, filterSplit]);

  /* ── Handlers ── */
  const toggleTeam = (abbr: string) => {
    let newTeams = [...selTeams];
    if (selTeams.includes(abbr)) {
      newTeams = selTeams.filter(a => a !== abbr);
    } else if (selTeams.length < 4) {
      newTeams.push(abbr);
    }
    setSelTeams(newTeams);
  };

  const togglePlayer = (name: string) => {
    if (selPlayers.includes(name)) {
      setSelPlayers(selPlayers.filter(n => n !== name));
    } else if (selPlayers.length < 4) {
      setSelPlayers([...selPlayers, name]);
    }
  };

  /* ── Derived ── */
  const filteredPlayers = roleFilter === 'all'
    ? players
    : players.filter(p => p.position === roleFilter);

  const selectedTeamObjs = selTeams.map(a => teams.find(t => t.abbr === a)).filter(Boolean) as TeamData[];
  const selectedPlayerObjs = selPlayers.map(n => players.find(p => p.name === n)).filter(Boolean) as PlayerData[];

  if (loading) {
    return (
      <div className="p11-container" style={{ '--p11-accent': accent, '--p11-accent-glow': glow } as React.CSSProperties}>
        <div style={{ padding: '80px', textAlign: 'center', color: 'rgba(255,255,255,0.4)' }}>
          <div className="p70-spinner" />
          <span>CARGANDO...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="p11-container" style={{ '--p11-accent': accent, '--p11-accent-glow': glow } as React.CSSProperties}>

      {/* League Header Banner */}
      <div className="p11-league-header">
        <div className="p11-header-info">
          <div className="p11-header-logo-container">
            <Image src={LEAGUE_LOGO(league)} alt={league} width={40} height={40} />
          </div>
          <div className="p11-header-text">
            <div className="p11-header-league-name">{league.toUpperCase()} COMPARAR</div>
            <div className="p11-header-season">SEASON {filterYear} // {filterSplit.toUpperCase()}</div>
          </div>
        </div>
        <div className="p11-header-filters">
          <button
            className={`p11-filter-btn ${mode === 'teams' ? 'p11-filter-active' : ''}`}
            onClick={() => { setMode('teams'); setSelPlayers([]); setRoleFilter('all'); }}
          >
            Equipos
          </button>
          <button
            className={`p11-filter-btn ${mode === 'players' ? 'p11-filter-active' : ''}`}
            onClick={() => { setMode('players'); setSelTeams([]); }}
          >
            Jugadores
          </button>
        </div>
        <div className="p11-header-right">
          <div className="p11-header-stat">
            <div className="p11-hstat-val">{teams.length}</div>
            <div className="p11-hstat-lbl">Equipos</div>
          </div>
          <div className="p11-header-stat">
            <div className="p11-hstat-val">{players.length}</div>
            <div className="p11-hstat-lbl">Jugadores</div>
          </div>
        </div>
      </div>

      {/* ═══════════ TEAMS MODE ═══════════ */}
      {mode === 'teams' && (
        <>
          <div className="p11-card">
            <div className="p11-card-hdr">
              <div>
                <div className="p11-card-title">SELECCIONA EQUIPOS</div>
                <div className="p11-card-subtitle">MÁX. 4 · {selTeams.length} SELECCIONADOS</div>
              </div>
            </div>
            <div className="p11-card-body">
              <p className="p11-instruction">
                Selecciona entre 2 y 4 equipos para ver una comparativa detallada de sus estadísticas.
              </p>
              <div className="p11-team-grid">
                {teams.map(t => {
                  const isSel = selTeams.includes(t.abbr);
                  const isDis = !isSel && selTeams.length >= 4;
                  return (
                    <button
                      key={t.abbr}
                      className={`p11-team-card ${isSel ? 'selected' : ''} ${isDis ? 'disabled' : ''}`}
                      onClick={() => toggleTeam(t.abbr)}
                    >
                      <Image
                        src={teamImg(t.logo_url, t.abbr, league)}
                        className="p11-team-logo"
                        alt={t.abbr}
                        width={24}
                        height={24}
                        onError={e => (e.target as HTMLImageElement).style.display = 'none'}
                      />
                      <span className="p11-team-abbr">{t.abbr}</span>
                    </button>
                  );
                })}
              </div>

              {selTeams.length > 0 && (
                <div className="p11-selected-bar">
                  <span className="p11-sel-label">Seleccionados:</span>
                  {selectedTeamObjs.map(t => (
                    <div key={t.abbr} className="p11-chip">
                      <Image
                        src={teamImg(t.logo_url, t.abbr, league)}
                        className="p11-chip-logo"
                        alt={t.abbr}
                        width={20}
                        height={20}
                        onError={e => (e.target as HTMLImageElement).style.display = 'none'}
                      />
                      {t.abbr}
                      <button className="p11-chip-remove" onClick={() => toggleTeam(t.abbr)}>×</button>
                    </div>
                  ))}
                  <button className="p11-clear-btn" onClick={() => setSelTeams([])}>Limpiar</button>
                </div>
              )}
            </div>
          </div>

          {/* Comparison table */}
          {selectedTeamObjs.length >= 2
            ? <CmpTable
              selected={selectedTeamObjs}
              statGroups={TEAM_STAT_GROUPS}
              getLogoFn={t => teamImg(t.logo_url, t.abbr, league)}
              getNameFn={t => t.abbr}
            />
            : (
              <div className="p11-empty-state">
                <div className="p11-empty-state-icon">⚔️</div>
                <div className="p11-empty-state-txt">Selecciona al menos 2 equipos para ver la comparativa</div>
              </div>
            )
          }

          {/* H2H Matchups (only when exactly 2 teams selected) */}
          {selTeams.length === 2 && (
            <div className="p11-card" style={{ marginTop: '24px' }}>
              <div className="p11-card-hdr">
                <div>
                  <div className="p11-card-title">HISTORIAL DIRECTO</div>
                  <div className="p11-card-subtitle">
                    Últimos enfrentamientos
                  </div>
                </div>
              </div>

              {/* VS Header */}
              <div className="p11-h2h-vs-section">
                <div className="p11-h2h-team">
                  <Image
                    src={teamImg(selectedTeamObjs[0]?.logo_url, selTeams[0], league)}
                    className="p11-h2h-team-logo"
                    alt={selTeams[0]}
                    width={64}
                    height={64}
                    onError={e => (e.target as HTMLImageElement).style.display = 'none'}
                  />
                  <div className="p11-h2h-team-name">{selTeams[0]}</div>
                </div>

                <div className="p11-h2h-score">
                  <div className="p11-h2h-score-val">
                    {h2hData?.summary ? `${h2hData.summary.team_a_wins} - ${h2hData.summary.team_b_wins}` : '— —'}
                  </div>
                  <div className="p11-h2h-score-lbl">HISTORIAL</div>
                </div>

                <div className="p11-h2h-team">
                  <Image
                    src={teamImg(selectedTeamObjs[1]?.logo_url, selTeams[1], league)}
                    className="p11-h2h-team-logo"
                    alt={selTeams[1]}
                    width={64}
                    height={64}
                    onError={e => (e.target as HTMLImageElement).style.display = 'none'}
                  />
                  <div className="p11-h2h-team-name">{selTeams[1]}</div>
                </div>
              </div>

              {/* Games List */}
              <div className="p11-card-body" style={{ padding: '0' }}>
                {h2hLoading ? (
                  <div style={{ padding: '32px 24px', textAlign: 'center', color: 'rgba(255,255,255,0.4)' }}>
                    <div className="p70-spinner" style={{ margin: '0 auto 12px' }} />
                    Cargando partidas...
                  </div>
                ) : (h2hData?.matchupHistory?.length ?? 0) > 0 ? (
                  <div className="p11-h2h-history-list">
                    {h2hData!.matchupHistory!.map((game, gi) => {
                      const teamAWon = game.team_a_win;
                      return (
                        <div key={game.gameid ?? gi} className={`p11-h2h-game-row ${teamAWon ? 'win-a' : 'win-b'}`}>
                          {/* Team A (Left) */}
                          <div className={`p11-h2h-team-a p11-h2h-team-result ${teamAWon ? 'win' : 'loss'}`}>
                            <Image
                              src={teamImg(selectedTeamObjs[0]?.logo_url, selTeams[0], league)}
                              className="p11-h2h-team-logo-small"
                              alt={selTeams[0]}
                              width={48}
                              height={48}
                              onError={e => (e.target as HTMLImageElement).style.display = 'none'}
                            />
                            <div className="p11-h2h-team-result">
                              <div className="p11-h2h-team-result-text">
                                {teamAWon ? 'VICTORIA' : 'DERROTA'}
                              </div>
                              <div className="p11-h2h-kills">{game.team_a_kills ?? '?'} kills</div>
                            </div>
                          </div>

                          {/* Center Info */}
                          <div className="p11-h2h-center-info">
                            <div className="p11-h2h-side-badges">
                              <div className={`p11-h2h-side-badge ${game.team_a_side?.toLowerCase()}`}>
                                {game.team_a_side?.toUpperCase()}
                              </div>
                              <span className="p11-h2h-vs-text">vs</span>
                              <div className={`p11-h2h-side-badge ${game.team_b_side?.toLowerCase()}`}>
                                {game.team_b_side?.toUpperCase()}
                              </div>
                            </div>
                            <div className="p11-h2h-datetime">
                              <span>{game.date ? new Date(game.date).toLocaleDateString('es-ES') : 'Sin Fecha'}</span>
                              {game.duration && <span>{game.duration} min</span>}
                            </div>
                          </div>

                          {/* Team B (Right) */}
                          <div className={`p11-h2h-team-b p11-h2h-team-result ${!teamAWon ? 'win' : 'loss'}`}>
                            <div className="p11-h2h-kills">{game.team_b_kills ?? '?'} kills</div>
                            <div className="p11-h2h-team-result">
                              <div className="p11-h2h-team-result-text">
                                {!teamAWon ? 'VICTORIA' : 'DERROTA'}
                              </div>
                            </div>
                            <Image
                              src={teamImg(selectedTeamObjs[1]?.logo_url, selTeams[1], league)}
                              className="p11-h2h-team-logo-small"
                              alt={selTeams[1]}
                              width={48}
                              height={48}
                              onError={e => (e.target as HTMLImageElement).style.display = 'none'}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div style={{ padding: '48px 24px', textAlign: 'center', color: 'rgba(255,255,255,0.4)' }}>
                    No hay enfrentamientos directos registrados.
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {/* ═══════════ PLAYERS MODE ═══════════ */}
      {mode === 'players' && (
        <>
          <div className="p11-card">
            <div className="p11-card-hdr">
              <div>
                <div className="p11-card-title">SELECCIONA JUGADORES</div>
                <div className="p11-card-subtitle">MÁX. 4 · {selPlayers.length} SELECCIONADOS</div>
              </div>
            </div>
            <div className="p11-card-body">
              <p className="p11-instruction">
                Selecciona entre 2 y 4 jugadores para comparar. Filtra por rol con las pestañas para encontrarlos más rápido.
              </p>
              <div className="p11-role-tabs">
                {ROLES.map(r => (
                  <button
                    key={r.key}
                    className={`p11-role-tab ${roleFilter === r.key ? 'active' : ''}`}
                    onClick={() => setRoleFilter(r.key)}
                  >
                    {r.label}
                  </button>
                ))}
              </div>

              <div className="p11-player-grid">
                {filteredPlayers.map(p => {
                  const isSel = selPlayers.includes(p.name);
                  const isDis = !isSel && selPlayers.length >= 4;
                  return (
                    <button
                      key={p.name}
                      className={`p11-player-card ${isSel ? 'selected' : ''} ${isDis ? 'disabled' : ''}`}
                      onClick={() => togglePlayer(p.name)}
                    >
                      <Image
                        src={teamImg(p.team_logo_url, p.team_abbr, league) || ''}
                        className="p11-pc-logo"
                        alt={p.team_abbr || ''}
                        width={24}
                        height={24}
                        onError={e => (e.target as HTMLImageElement).style.display = 'none'}
                      />
                      <div className="p11-pc-info">
                        <span className="p11-pc-name">{p.name}</span>
                        <span className="p11-pc-team">
                          {p.team_abbr} · {p.position?.toUpperCase()}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>

              {selPlayers.length > 0 && (
                <div className="p11-selected-bar">
                  <span className="p11-sel-label">Seleccionados:</span>
                  {selectedPlayerObjs.map(p => (
                    <div key={p.name} className="p11-chip">
                      <Image
                        src={teamImg(p.team_logo_url, p.team_abbr, league) || ''}
                        className="p11-chip-logo"
                        alt={p.team_abbr || ''}
                        width={20}
                        height={20}
                        onError={e => (e.target as HTMLImageElement).style.display = 'none'}
                      />
                      {p.name}
                      <button className="p11-chip-remove" onClick={() => togglePlayer(p.name)}>×</button>
                    </div>
                  ))}
                  <button className="p11-clear-btn" onClick={() => setSelPlayers([])}>Limpiar</button>
                </div>
              )}
            </div>
          </div>

          {selectedPlayerObjs.length >= 2
            ? <CmpTable
              selected={selectedPlayerObjs}
              statGroups={PLAYER_STAT_GROUPS}
              getLogoFn={p => teamImg(p.team_logo_url, p.team_abbr, league)}
              getNameFn={p => p.name}
            />
            : (
              <div className="p11-empty-state">
                <div className="p11-empty-state-icon">👥</div>
                <div className="p11-empty-state-txt">Selecciona al menos 2 jugadores para ver la comparativa</div>
              </div>
            )
          }
        </>
      )}

    </div>
  );
}
