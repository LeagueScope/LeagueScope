'use client';

import { useState, useEffect, useRef } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { teamImg, champImg, getWinRateClass } from '@/lib/constants';
import { clientFetch } from '@/lib/clientFetch';
import { useFilters } from '@/context/FilterContext';
import AnimatedNumber from '@/components/AnimatedNumber';

/* ═══════════════════════════════════════════════════════════════════════════
   TeamProfileClient — Full port of TeamProfile.jsx
   Client Component: data fetching stays client-side due to chained fallback
   ═══════════════════════════════════════════════════════════════════════════ */

// ── Types ────────────────────────────────────────────────────────────────────

interface FallbackInfo {
  year: string;
  split: string;
  serie_name: string;
}

interface SeriesEntry {
  match_id: number;
  opponent: string;
  opponent_logo?: string;
  best_of: number;
  result: boolean;
  score_team: number;
  score_opponent: number;
}

interface TeamDataType {
  team: string;
  abbr: string;
  real_acronym?: string;
  slug?: string;
  logo_url?: string;
  wins: number;
  losses: number;
  win_rate: number;
  kda?: number;
  avg_kills?: number;
  avg_deaths?: number;
  avg_duration_formatted?: string;
  unique_champions?: number;
  players?: string[];
  fallback?: FallbackInfo;
  // Gold/CS diffs
  avg_gold_diff_13?: number;
  avg_gold_diff_20?: number;
  avg_gold_diff_25?: number;
  avg_cs_diff_13?: number;
  avg_cs_diff_20?: number;
  avg_cs_diff_25?: number;
  // Objectives
  first_blood_rate?: number;
  first_dragon_rate?: number;
  first_herald_rate?: number;
  first_tower_rate?: number;
  first_baron_rate?: number;
  first_voidgrub_rate?: number;
  first_atakhan_rate?: number;
  // Side performance
  blue_wr?: number;
  red_wr?: number;
  blue_wins?: number;
  blue_games?: number;
  red_wins?: number;
  red_games?: number;
  avg_win_duration?: string;
  avg_loss_duration?: string;
  // Objectives averages
  avg_towers?: number;
  avg_dragons?: number;
  avg_barons?: number;
  avg_heralds?: number;
  avg_voidgrubs?: number;
  avg_drakes?: Record<string, number>;
  // Damage
  avg_magic_dpm?: number;
  avg_physical_dpm?: number;
  avg_true_dpm?: number;
  // Per minute
  avg_dpm?: number;
  avg_gpm?: number;
  avg_cspm?: number;
  avg_wpm?: number;
  avg_wkpm?: number;
  avg_dtaken_per_min?: number;
  // Series
  series_history?: SeriesEntry[];
  [key: string]: unknown;
}

interface PlayerData {
  name: string;
  position: string;
  team_abbr: string;
  image_url?: string;
  kda?: number;
  avg_cspm?: number;
  avg_dpm?: number;
  avg_gpm?: number;
  avg_wpm?: number;
  champions_played?: { name: string; image_url?: string; games: number }[];
  [key: string]: unknown;
}

interface ChampionData {
  name: string;
  image_url?: string;
  bans_blue: number;
  bans_red: number;
  ban_rate_blue: number;
  ban_rate_red: number;
  blue_picks: number;
  red_picks: number;
  played_by?: { name: string; team_abbr?: string; games: number; wins: number }[];
  [key: string]: unknown;
}

interface StandingsTeam {
  team: string;
  abbr: string;
  slug?: string;
  logo_url?: string;
  wins: number;
  losses: number;
  win_rate: number;
  [key: string]: unknown;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const fmt = (v: unknown, d = 1): string =>
  v != null ? Number(v).toFixed(d) : '—';

const pct = (v: unknown): string =>
  v != null ? `${Number(v).toFixed(1)}%` : '—';

// Suppress unused pct warning (used in some tooltip contexts)
void pct;

// ── SVG Donut for Damage Breakdown ──────────────────────────────────────────

interface DmgDonutProps {
  physical: number;
  magic: number;
  trueDmg: number;
  size?: number;
}

function DmgDonut({ physical, magic, trueDmg, size = 120 }: DmgDonutProps) {
  const total = physical + magic + trueDmg;
  if (total === 0) return null;
  const stroke = 14;
  const radius = (size - stroke) / 2;
  const circ = 2 * Math.PI * radius;
  const segments = [
    { pct: physical / total, color: '#f87171' },
    { pct: magic / total, color: '#60a5fa' },
    { pct: trueDmg / total, color: '#fbbf24' },
  ];
  let cumulative = 0;
  return (
    <svg width={size} height={size} className="p50-dmg-donut-svg">
      <circle cx={size / 2} cy={size / 2} r={radius}
        fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={stroke} />
      {segments.map((seg, i) => {
        const dashLen = circ * seg.pct;
        const dashGap = circ - dashLen;
        const rotation = -90 + cumulative * 360;
        cumulative += seg.pct;
        return (
          <circle key={i} cx={size / 2} cy={size / 2} r={radius}
            fill="none" stroke={seg.color} strokeWidth={stroke}
            strokeDasharray={`${dashLen} ${dashGap}`}
            transform={`rotate(${rotation} ${size / 2} ${size / 2})`}
            style={{ transition: 'stroke-dasharray 0.8s ease' }} />
        );
      })}
      <text x={size / 2} y={size / 2 - 4} textAnchor="middle" dominantBaseline="central"
        fill="white" fontSize="18" fontWeight="900" fontFamily="'JetBrains Mono', monospace">
        {fmt(total, 0)}
      </text>
      <text x={size / 2} y={size / 2 + 12} textAnchor="middle" dominantBaseline="central"
        fill="#64748b" fontSize="7" fontWeight="800" letterSpacing="1.5">
        DPM TOTAL
      </text>
    </svg>
  );
}

// ── Bidirectional diff bar ──────────────────────────────────────────────────

interface DiffBarProps {
  label: string;
  value: number | null | undefined;
  groupMax: number;
}

function DiffBar({ label, value, groupMax }: DiffBarProps) {
  const v = value != null ? Number(value) : null;
  const absPct = v != null && groupMax > 0 ? Math.min((Math.abs(v) / groupMax) * 50, 50) : 0;
  const isPos = v != null ? v >= 0 : true;
  const fillStyle = v != null
    ? isPos
      ? { left: '50%', width: `${absPct}%` }
      : { left: `calc(50% - ${absPct}%)`, width: `${absPct}%` }
    : {};

  return (
    <div className="p50-diff-row">
      <div className="p50-diff-info">
        <span className="p50-diff-time">{label}</span>
        <span className={`p50-diff-val ${v != null ? (v >= 0 ? 'pos' : 'neg') : ''}`}>
          {v != null ? `${v > 0 ? '+' : ''}${v}` : '—'}
        </span>
      </div>
      <div className="p50-diff-track">
        {v != null && <div className={`p50-diff-fill ${isPos ? 'pos' : 'neg'}`} style={fillStyle} />}
      </div>
    </div>
  );
}

/** Compute the adaptive max for a group of diff values (largest absolute value) */
function diffGroupMax(values: (number | null | undefined)[]): number {
  const abs = values.filter((v): v is number => v != null).map(v => Math.abs(Number(v)));
  return abs.length > 0 ? Math.max(...abs) : 1;
}

// ═════════════════════════════════════════════════════════════════════════════

interface TeamProfileClientProps {
  league: string;
  abbr: string;
  accent: string;
}

export default function TeamProfileClient({ league, abbr, accent }: TeamProfileClientProps) {
  const router = useRouter();

  const [team, setTeam] = useState<TeamDataType | null>(null);
  const [allPlayers, setAllPlayers] = useState<PlayerData[]>([]);
  const [champions, setChampions] = useState<ChampionData[]>([]);
  const [allTeams, setAllTeams] = useState<StandingsTeam[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isFirstLoad = useRef(true);

  const filters = useFilters();

  useEffect(() => {
    if (!filters.ready) return;
    let cancelled = false;
    async function loadData() {
      const isRefresh = !isFirstLoad.current;
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      try {
        // Build filter query string
        const fqs = new URLSearchParams();
        fqs.set('league', league.toUpperCase());
        if (filters.year) fqs.set('year', String(filters.year));
        if (filters.split) fqs.set('split', filters.split);
        if (filters.stage && filters.stage !== 'all') fqs.set('stage', filters.stage);

        // Fetch team profile with filters
        const teamData: TeamDataType = await clientFetch<TeamDataType>(
          `/api/v1/pg/teams/${encodeURIComponent(abbr)}?${fqs}`
        );

        // Build query for supplementary calls (use fallback if available, otherwise current filters)
        const suppQs = teamData.fallback
          ? `&year=${teamData.fallback.year}&split=${teamData.fallback.split}`
          : `&year=${filters.year}&split=${filters.split}${filters.stage && filters.stage !== 'all' ? `&stage=${filters.stage}` : ''}`;

        const [playersData, champsData, teamsData] = await Promise.all([
          clientFetch<PlayerData[]>(`/api/v1/pg/players?league=${encodeURIComponent(league)}${suppQs}`).catch(() => []),
          clientFetch<ChampionData[]>(`/api/v1/pg/champions?league=${encodeURIComponent(league)}${suppQs}`).catch(() => []),
          clientFetch<StandingsTeam[]>(`/api/v1/pg/teams?league=${encodeURIComponent(league)}${suppQs}`).catch(() => []),
        ]);

        if (!cancelled) {
          setTeam(teamData);
          setAllPlayers(playersData || []);
          setChampions(champsData || []);
          setAllTeams(teamsData || []);
          isFirstLoad.current = false;
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Error desconocido');
      } finally {
        if (!cancelled) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    }
    loadData();
    return () => { cancelled = true; };
  }, [abbr, league, filters.ready, filters.year, filters.split, filters.stage]);

  if (loading && !team) {
    return (
      <div className="p50-container" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
        <div style={{ color: '#64748b', fontSize: 14 }}>Cargando perfil del equipo…</div>
      </div>
    );
  }
  if (error) {
    return (
      <div className="p50-container" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
        <div style={{ color: '#f87171', fontSize: 14 }}>{error}</div>
      </div>
    );
  }
  if (!team) {
    return (
      <div className="p50-container" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
        <div style={{ color: '#f87171', fontSize: 14 }}>Equipo no encontrado</div>
      </div>
    );
  }

  /* ── Derived data ── */
  const totalGames = team.wins + team.losses;
  const sampleTag = `SPLIT COMPLETO · ${totalGames}G`;

  const posOrder = ['top', 'jng', 'mid', 'bot', 'sup'];
  const playersRaw = Array.from(new Map(
    allPlayers
      .filter(p => team.players?.includes(p.name))
      .map(p => [p.name, p] as const)
  ).values()).sort((a, b) => posOrder.indexOf(a.position) - posOrder.indexOf(b.position));

  type ChampPlayed = { name: string; image_url?: string; games: number };
  const players: PlayerData[] = playersRaw.map(p => {
    const pChamps: ChampPlayed[] = (champions || [])
      .reduce<ChampPlayed[]>((acc, c) => {
        const pStat = c.played_by?.find(pb => pb.name === p.name);
        if (pStat) acc.push({ name: c.name, image_url: c.image_url, games: pStat.games });
        return acc;
      }, [])
      .sort((a, b) => b.games - a.games);
    return { ...p, champions_played: pChamps };
  });

  const blueBans = champions.filter(c => c.bans_blue > 0).sort((a, b) => b.ban_rate_blue - a.ban_rate_blue).slice(0, 5);
  const redBans = champions.filter(c => c.bans_red > 0).sort((a, b) => b.ban_rate_red - a.ban_rate_red).slice(0, 5);
  const bluePicks = champions.filter(c => c.blue_picks > 0).sort((a, b) => b.blue_picks - a.blue_picks).slice(0, 5);
  const redPicks = champions.filter(c => c.red_picks > 0).sort((a, b) => b.red_picks - a.red_picks).slice(0, 5);

  // Match by both branded abbr and real acronym (for branded teams like MRS/MDK)
  const teamAbbrs = new Set([team.abbr, team.real_acronym].filter((a): a is string => !!a).map(a => a.toUpperCase()));
  type TeamChamp = { name: string; image_url?: string; games: number; wins: number };
  const topTeamChamps: TeamChamp[] = (champions || [])
    .reduce<TeamChamp[]>((acc, c) => {
      const teamStat = c.played_by?.find(p => teamAbbrs.has((p.team_abbr || '').toUpperCase()));
      if (teamStat) acc.push({ name: c.name, image_url: c.image_url, games: teamStat.games, wins: teamStat.wins });
      return acc;
    }, [])
    .sort((a, b) => b.games - a.games)
    .slice(0, 10);

  const standings = [...allTeams].sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins;
    return b.win_rate - a.win_rate;
  }).slice(0, 10);

  /* Damage breakdown */
  const totalDpm = (Number(team.avg_magic_dpm) || 0) + (Number(team.avg_physical_dpm) || 0) + (Number(team.avg_true_dpm) || 0);
  const magicPct = totalDpm > 0 ? ((Number(team.avg_magic_dpm) || 0) / totalDpm * 100) : 0;
  const physicalPct = totalDpm > 0 ? ((Number(team.avg_physical_dpm) || 0) / totalDpm * 100) : 0;
  const truePct = totalDpm > 0 ? ((Number(team.avg_true_dpm) || 0) / totalDpm * 100) : 0;

  return (
    <div className="p50-container" style={{ opacity: refreshing ? 0.6 : 1, transition: 'opacity 0.3s ease' }}>
      {/* Fallback notice */}
      {team.fallback && (
        <div className="p50-fallback-notice" style={{
          background: 'rgba(255,170,0,0.12)', border: '1px solid rgba(255,170,0,0.35)',
          borderRadius: 8, padding: '10px 16px', margin: '0 0 16px', color: '#ffaa00', fontSize: 13
        }}>
          Este equipo no participó en la serie seleccionada. Mostrando datos de <strong>{team.fallback.serie_name}</strong>.
        </div>
      )}

      {/* ═══════════ HERO ═══════════ */}
      <div className="p50-hero">
        <div className="p50-hero-left">
          <div className="p50-hero-logo-wrap">
            <Image src={teamImg(team.logo_url, team.abbr, league)} className="p50-hero-logo" alt={team.abbr} width={64} height={64} />
          </div>
          <div className="p50-hero-text">
            <h1 className="p50-hero-name">{team.team}</h1>
            <div className="p50-hero-meta">
              <span className="p50-hero-league">{league.toUpperCase()}</span>
            </div>
            <div className="p50-hero-wl">
              <span className="w"><AnimatedNumber value={team.wins} decimals={0} />W</span>{' – '}<span className="l"><AnimatedNumber value={team.losses} decimals={0} />L</span>
              <span className="p50-hero-games"><AnimatedNumber value={totalGames} decimals={0} /> GAMES</span>
            </div>
          </div>
        </div>
        <div className="p50-hero-stats">
          {[
            { val: team.win_rate != null ? <><AnimatedNumber value={team.win_rate} decimals={1} />%</> : '—', lbl: 'WIN RATE', cls: getWinRateClass(team.win_rate) },
            { val: team.kda != null ? <AnimatedNumber value={team.kda} decimals={2} /> : '—', lbl: 'KDA', cls: '' },
            { val: team.avg_kills != null ? <AnimatedNumber value={team.avg_kills} decimals={1} /> : '—', lbl: 'KILLS/GAME', cls: '' },
            { val: team.avg_deaths != null ? <AnimatedNumber value={team.avg_deaths} decimals={1} /> : '—', lbl: 'DEATHS/GAME', cls: '' },
            { val: team.avg_duration_formatted ?? '—', lbl: 'DURACIÓN', cls: '' },
            { val: team.unique_champions != null ? <AnimatedNumber value={team.unique_champions} decimals={0} /> : '—', lbl: 'CAMPEONES', cls: '' },
          ].map(s => (
            <div key={s.lbl} className="p50-hstat">
              <span className={`p50-hstat-val ${s.cls}`}>{s.val}</span>
              <span className="p50-hstat-lbl">{s.lbl}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ═══════════ ROW 1: Gold Diff + Objectives + Side Performance ═══════════ */}
      <div className="p50-grid-3">
        {/* Gold Differential Timeline */}
        <div className="p50-card">
          <div className="p50-card-hdr">
            <span className="p50-card-title">DIFERENCIAL DE ORO</span>
            <span className="p50-card-sub">MEDIA POR TIMESTAMP · {sampleTag}</span>
          </div>
          <div className="p50-card-body">
            {(() => {
              const goldVals = [team.avg_gold_diff_13, team.avg_gold_diff_20, team.avg_gold_diff_25];
              const csVals = [team.avg_cs_diff_13, team.avg_cs_diff_20, team.avg_cs_diff_25];
              const goldMax = diffGroupMax(goldVals);
              const csMax = diffGroupMax(csVals);
              return (<>
                <div className="p50-diff-section">
                  <div className="p50-diff-label">GOLD DIFF</div>
                  {(['@13', '@20', '@25'] as const).map((label, idx) => (
                    <DiffBar key={`gd${label}`} label={label} value={goldVals[idx]} groupMax={goldMax} />
                  ))}
                </div>
                <div className="p50-diff-section">
                  <div className="p50-diff-label">CS DIFF</div>
                  {(['@13', '@20', '@25'] as const).map((label, idx) => (
                    <DiffBar key={`cs${label}`} label={label} value={csVals[idx]} groupMax={csMax} />
                  ))}
                </div>
              </>);
            })()}
          </div>
        </div>

        {/* First Objectives */}
        <div className="p50-card">
          <div className="p50-card-hdr">
            <span className="p50-card-title">CONTROL DE OBJETIVOS</span>
            <span className="p50-card-sub">% PRIMER OBJETIVO · {sampleTag}</span>
          </div>
          <div className="p50-card-body">
            <div className="p50-obj-rows">
              {([
                ['FIRST BLOOD', team.first_blood_rate],
                ['FIRST DRAGON', team.first_dragon_rate],
                ['FIRST HERALD', team.first_herald_rate],
                ['FIRST TOWER', team.first_tower_rate],
                ['FIRST BARON', team.first_baron_rate],
                ['FIRST VOIDGRUB', team.first_voidgrub_rate],
                ['FIRST ATAKHAN', team.first_atakhan_rate],
              ] as const).filter(([, v]) => v != null).map(([label, value]) => (
                <div key={label} className="p50-obj-row">
                  <div className="p50-obj-info">
                    <span className="p50-obj-label">{label}</span>
                    <span className="p50-obj-val">{value != null ? <><AnimatedNumber value={value} decimals={1} />%</> : '—'}</span>
                  </div>
                  <div className="p50-obj-track">
                    <div className="p50-obj-fill" style={{ width: `${value}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Side Performance */}
        <div className="p50-card">
          <div className="p50-card-hdr">
            <span className="p50-card-title">RENDIMIENTO POR LADO</span>
            <span className="p50-card-sub">BLUE VS RED · {sampleTag}</span>
          </div>
          <div className="p50-card-body">
            <div className="p50-side-versus">
              <div className="p50-side-col blue">
                <span className="p50-side-label">BLUE</span>
                <span className="p50-side-wr-big blue">{team.blue_wr != null ? <><AnimatedNumber value={team.blue_wr} decimals={1} />%</> : '—'}</span>
                <span className="p50-side-games-sm"><AnimatedNumber value={team.blue_wins ?? 0} decimals={0} />W - <AnimatedNumber value={(team.blue_games ?? 0) - (team.blue_wins ?? 0)} decimals={0} />L</span>
              </div>
              <div className="p50-side-vs-center">
                <div className="p50-side-vs-bar">
                  <div className="p50-side-vs-fill blue" style={{ width: `${team.blue_wr ?? 50}%` }} />
                  <div className="p50-side-vs-fill red" style={{ width: `${team.red_wr ?? 50}%` }} />
                </div>
                <span className="p50-side-vs-text">VS</span>
              </div>
              <div className="p50-side-col red">
                <span className="p50-side-label">RED</span>
                <span className="p50-side-wr-big red">{team.red_wr != null ? <><AnimatedNumber value={team.red_wr} decimals={1} />%</> : '—'}</span>
                <span className="p50-side-games-sm"><AnimatedNumber value={team.red_wins ?? 0} decimals={0} />W - <AnimatedNumber value={(team.red_games ?? 0) - (team.red_wins ?? 0)} decimals={0} />L</span>
              </div>
            </div>
            <div className="p50-side-durations">
              <div className="p50-dur-item">
                <span className="p50-dur-val win">{team.avg_win_duration}</span>
                <span className="p50-dur-lbl">DURACIÓN MEDIA VICTORIA</span>
              </div>
              <div className="p50-dur-item">
                <span className="p50-dur-val loss">{team.avg_loss_duration}</span>
                <span className="p50-dur-lbl">DURACIÓN MEDIA DERROTA</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ═══════════ ROW 2: Per Game Averages + Damage + Per Minute ═══════════ */}
      <div className="p50-grid-3">
        {/* Per Game Averages */}
        <div className="p50-card">
          <div className="p50-card-hdr">
            <span className="p50-card-title">PROMEDIOS POR PARTIDA</span>
            <span className="p50-card-sub">OBJETIVOS · {sampleTag}</span>
          </div>
          <div className="p50-card-body">
            <div className="p50-avg-rows">
              {[
                { val: team.avg_towers != null ? <AnimatedNumber value={team.avg_towers} decimals={1} /> : '—', lbl: 'TORRES', desc: 'Torres destruidas/game' },
                { val: team.avg_dragons != null ? <AnimatedNumber value={team.avg_dragons} decimals={1} /> : '—', lbl: 'DRAKES', desc: 'Dragones por partida' },
                { val: team.avg_barons != null ? <AnimatedNumber value={team.avg_barons} decimals={1} /> : '—', lbl: 'BARON', desc: 'Barones por partida' },
                { val: team.avg_heralds != null ? <AnimatedNumber value={team.avg_heralds} decimals={1} /> : '—', lbl: 'HERALD', desc: 'Heraldos por partida' },
                { val: team.avg_voidgrubs != null ? <AnimatedNumber value={team.avg_voidgrubs} decimals={1} /> : '—', lbl: 'VGRUBS', desc: 'Voidgrubs por partida' },
              ].map(s => (
                <div key={s.lbl} className="p50-avg-row">
                  <div className="p50-avg-left">
                    <span className="p50-avg-val">{s.val}</span>
                    <span className="p50-avg-lbl">{s.lbl}</span>
                  </div>
                  <span className="p50-avg-desc">{s.desc}</span>
                </div>
              ))}
            </div>
            {team.avg_drakes && (
              <div className="p50-drake-grid">
                {Object.entries(team.avg_drakes).filter(([k]) => k !== 'elder').slice(0, 6).map(([name, val]) => (
                  <div key={name} className="p50-drake-item">
                    <span className="p50-drake-val">{val != null ? <AnimatedNumber value={val} decimals={1} /> : '—'}</span>
                    <span className="p50-drake-lbl">{name.toUpperCase()}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Damage Type Breakdown */}
        <div className="p50-card">
          <div className="p50-card-hdr">
            <span className="p50-card-title">TIPO DE DAÑO</span>
            <span className="p50-card-sub">DPM POR TIPO · {sampleTag}</span>
          </div>
          <div className="p50-card-body p50-dmg-body">
            <div className="p50-dmg-legend">
              {[
                { label: 'FÍSICO', val: team.avg_physical_dpm, pctVal: physicalPct, color: '#f87171' },
                { label: 'MÁGICO', val: team.avg_magic_dpm, pctVal: magicPct, color: '#60a5fa' },
                { label: 'VERDADERO', val: team.avg_true_dpm, pctVal: truePct, color: '#fbbf24' },
              ].map(d => (
                <div key={d.label} className="p50-dmg-legend-row">
                  <span className="p50-dmg-dot" style={{ background: d.color }} />
                  <span className="p50-dmg-legend-label">{d.label}</span>
                  <span className="p50-dmg-legend-val" style={{ color: d.color }}>{d.val != null ? <AnimatedNumber value={d.val} decimals={0} /> : '—'}</span>
                  <span className="p50-dmg-legend-pct"><AnimatedNumber value={d.pctVal} decimals={1} />%</span>
                </div>
              ))}
            </div>
            <div className="p50-dmg-donut-wrap">
              <DmgDonut
                physical={Number(team.avg_physical_dpm) || 0}
                magic={Number(team.avg_magic_dpm) || 0}
                trueDmg={Number(team.avg_true_dpm) || 0}
                size={140}
              />
            </div>
          </div>
        </div>

        {/* Per Minute Production */}
        <div className="p50-card">
          <div className="p50-card-hdr">
            <span className="p50-card-title">PRODUCCIÓN POR MINUTO</span>
            <span className="p50-card-sub">RITMO DE EQUIPO · {sampleTag}</span>
          </div>
          <div className="p50-card-body">
            <div className="p50-avg-rows">
              {[
                { val: team.avg_dpm != null ? <AnimatedNumber value={team.avg_dpm} decimals={0} /> : '—', lbl: 'DPM', desc: 'Daño por minuto' },
                { val: team.avg_gpm != null ? <AnimatedNumber value={team.avg_gpm} decimals={0} /> : '—', lbl: 'GPM', desc: 'Oro por minuto' },
                { val: team.avg_cspm != null ? <AnimatedNumber value={team.avg_cspm} decimals={1} /> : '—', lbl: 'CSPM', desc: 'CS por minuto' },
                { val: team.avg_wpm != null ? <AnimatedNumber value={team.avg_wpm} decimals={2} /> : '—', lbl: 'WPM', desc: 'Wards puestos/min' },
                { val: team.avg_wkpm != null ? <AnimatedNumber value={team.avg_wkpm} decimals={2} /> : '—', lbl: 'WKPM', desc: 'Wards destruidos/min' },
                { val: team.avg_dtaken_per_min != null ? <AnimatedNumber value={team.avg_dtaken_per_min} decimals={0} /> : '—', lbl: 'DTPM', desc: 'Daño recibido/min' },
              ].map(s => (
                <div key={s.lbl} className="p50-avg-row">
                  <div className="p50-avg-left">
                    <span className="p50-avg-val">{s.val}</span>
                    <span className="p50-avg-lbl">{s.lbl}</span>
                  </div>
                  <span className="p50-avg-desc">{s.desc}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ═══════════ ROW 3: Bans + Picks ═══════════ */}
      <div className="p50-grid-2">
        {/* Ban Priority */}
        <div className="p50-card">
          <div className="p50-card-hdr">
            <span className="p50-card-title">PRIORIDAD DE BANS</span>
            <span className="p50-card-sub">CAMPEONES MÁS BANEADOS POR LADO</span>
          </div>
          <div className="p50-card-body p50-bans-body">
            <div className="p50-bans-side">
              <div className="p50-bans-label blue">BLUE BANS</div>
              {blueBans.map((c, i) => (
                <div key={c.name} className="p50-ban-row" onClick={() => router.push(`/${league}/champion_profile/${encodeURIComponent(c.name)}`)}>
                  <span className="p50-ban-rank">{i + 1}</span>
                  <div className="p50-ban-icon">
                    <Image src={champImg(c.image_url) || ''} alt={c.name} width={32} height={32} />
                  </div>
                  <span className="p50-ban-name">{c.name}</span>
                  <span className="p50-ban-rate"><AnimatedNumber value={c.ban_rate_blue} decimals={1} />%</span>
                </div>
              ))}
            </div>
            <div className="p50-bans-side">
              <div className="p50-bans-label red">RED BANS</div>
              {redBans.map((c, i) => (
                <div key={c.name} className="p50-ban-row" onClick={() => router.push(`/${league}/champion_profile/${encodeURIComponent(c.name)}`)}>
                  <span className="p50-ban-rank">{i + 1}</span>
                  <div className="p50-ban-icon">
                    <Image src={champImg(c.image_url) || ''} alt={c.name} width={32} height={32} />
                  </div>
                  <span className="p50-ban-name">{c.name}</span>
                  <span className="p50-ban-rate"><AnimatedNumber value={c.ban_rate_red} decimals={1} />%</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Pick Priority */}
        <div className="p50-card">
          <div className="p50-card-hdr">
            <span className="p50-card-title">PRIORIDAD DE PICKS</span>
            <span className="p50-card-sub">CAMPEONES MÁS PICKEADOS POR LADO</span>
          </div>
          <div className="p50-card-body p50-bans-body">
            <div className="p50-bans-side">
              <div className="p50-bans-label blue">BLUE PICKS</div>
              {bluePicks.map((c, i) => (
                <div key={c.name} className="p50-ban-row" onClick={() => router.push(`/${league}/champion_profile/${encodeURIComponent(c.name)}`)}>
                  <span className="p50-ban-rank">{i + 1}</span>
                  <div className="p50-ban-icon">
                    <Image src={champImg(c.image_url) || ''} alt={c.name} width={32} height={32} />
                  </div>
                  <span className="p50-ban-name">{c.name}</span>
                  <span className="p50-ban-rate"><AnimatedNumber value={c.blue_picks} decimals={0} />G</span>
                </div>
              ))}
            </div>
            <div className="p50-bans-side">
              <div className="p50-bans-label red">RED PICKS</div>
              {redPicks.map((c, i) => (
                <div key={c.name} className="p50-ban-row" onClick={() => router.push(`/${league}/champion_profile/${encodeURIComponent(c.name)}`)}>
                  <span className="p50-ban-rank">{i + 1}</span>
                  <div className="p50-ban-icon">
                    <Image src={champImg(c.image_url) || ''} alt={c.name} width={32} height={32} />
                  </div>
                  <span className="p50-ban-name">{c.name}</span>
                  <span className="p50-ban-rate"><AnimatedNumber value={c.red_picks} decimals={0} />G</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ═══════════ ROW 4: Series History + Top Champs + Standings ═══════════ */}
      <div className="p50-grid-3">
        {/* Series History */}
        <div className="p50-card">
          <div className="p50-card-hdr">
            <span className="p50-card-title">HISTORIAL DE SERIES</span>
            <span className="p50-card-sub">ÚLTIMAS 10 SERIES</span>
          </div>
          <div className="p50-card-body" style={{ padding: '0 24px 16px' }}>
            <div className="p50-table-hdr p50-table-hdr-series">
              <span>OPONENTE</span>
              <span className="p50-hdr-c">TIPO</span>
              <span className="p50-hdr-r">RESULTADO</span>
            </div>
            {team.series_history?.slice(0, 10).map(s => (
              <div key={s.match_id} className="p50-table-row p50-row-series">
                <div className="p50-row-info">
                  <Image src={teamImg(s.opponent_logo, s.opponent, league)} className="p50-row-icon" alt={s.opponent} onError={e => (e.target as HTMLImageElement).style.display = 'none'} width={24} height={24} />
                  <span className="p50-row-name">{s.opponent}</span>
                </div>
                <span className="p50-row-type">Bo{s.best_of}</span>
                <span className={`p50-row-result ${s.result ? 'win' : 'loss'}`}>
                  {s.result ? 'WIN' : 'LOSS'} {s.score_team}–{s.score_opponent}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Top Champions */}
        <div className="p50-card">
          <div className="p50-card-hdr">
            <span className="p50-card-title">TOP CAMPEONES</span>
            <span className="p50-card-sub">MÁS JUGADOS · {sampleTag}</span>
          </div>
          <div className="p50-card-body" style={{ padding: '0 24px 16px' }}>
            <div className="p50-table-hdr p50-table-hdr-champs">
              <span>#</span>
              <span>CAMPEÓN</span>
              <span className="p50-hdr-c">G</span>
              <span className="p50-hdr-r">WR</span>
            </div>
            {topTeamChamps.map((c, i) => (
              <div key={c.name} className="p50-table-row p50-row-champs" onClick={() => router.push(`/${league}/champion_profile/${encodeURIComponent(c.name)}`)}>
                <span className="p50-row-idx">{i + 1}</span>
                <div className="p50-row-info">
                  <Image src={champImg(c.image_url) || ''} className="p50-row-icon" alt={c.name} width={24} height={24} />
                  <span className="p50-row-name">{c.name}</span>
                </div>
                <span className="p50-row-games"><AnimatedNumber value={c.games} decimals={0} /></span>
                <span className={`p50-row-val ${getWinRateClass(Math.round(c.wins / c.games * 100))}`}>
                  <AnimatedNumber value={Math.round(c.wins / c.games * 100)} decimals={0} />%
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* League Standings */}
        <div className="p50-card">
          <div className="p50-card-hdr">
            <span className="p50-card-title">CLASIFICACIÓN</span>
            <span className="p50-card-sub">{league.toUpperCase()} · SPLIT COMPLETO</span>
          </div>
          <div className="p50-card-body" style={{ padding: '0 24px 16px' }}>
            <div className="p50-table-hdr p50-table-hdr-standings">
              <span>#</span>
              <span>EQUIPO</span>
              <span className="p50-hdr-c">RECORD</span>
              <span className="p50-hdr-r">WR</span>
            </div>
            {standings.map((t, i) => (
              <div
                key={t.abbr}
                className={`p50-table-row p50-row-standings ${t.abbr === team.abbr ? 'p50-active-row' : ''}`}
                onClick={() => router.push(`/${league}/team_profile/${t.slug || t.abbr}`)}
              >
                <span className="p50-row-idx">{i + 1}</span>
                <div className="p50-row-info">
                  <Image src={teamImg(t.logo_url, t.abbr, league)} className="p50-row-icon" alt={t.abbr} width={24} height={24} />
                  <span className="p50-row-name">{t.abbr}</span>
                </div>
                <span className="p50-row-games"><AnimatedNumber value={t.wins} decimals={0} />W-<AnimatedNumber value={t.losses} decimals={0} />L</span>
                <span className={`p50-row-val ${getWinRateClass(t.win_rate)}`}><AnimatedNumber value={t.win_rate} decimals={1} />%</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ═══════════ ROW 5: Roster (full width) ═══════════ */}
      <div className="p50-card p50-roster-card">
        <div className="p50-card-hdr">
          <span className="p50-card-title">PLANTILLA</span>
          <span className="p50-card-sub">{players.length} JUGADORES · {sampleTag}</span>
        </div>
        <div className="p50-roster-hdr">
          <span className="p50-r-hdr-c">ROL</span>
          <span>JUGADOR</span>
          <span className="p50-r-hdr-c">KDA</span>
          <span className="p50-r-hdr-c">CS/M</span>
          <span className="p50-r-hdr-c">DPM</span>
          <span className="p50-r-hdr-c">GPM</span>
          <span className="p50-r-hdr-c">WPM</span>
          <span className="p50-r-hdr-r">CAMPEONES</span>
        </div>
        <div className="p50-roster-list">
          {players.map(p => (
            <div
              key={p.name}
              className="p50-roster-row"
              onClick={() => router.push(`/${league}/player_profile/${encodeURIComponent(p.name)}?team=${encodeURIComponent(p.team_abbr)}`)}
            >
              <div className="p50-r-pos">
                <Image src={`/rol/${p.position?.toLowerCase()}.png`} alt={p.position} className="p50-r-pos-icon" width={20} height={20} />
              </div>
              <div className="p50-r-player">
                {p.image_url && <Image src={p.image_url} className="p50-r-photo" alt={p.name} width={88} height={88} />}
                <span className="p50-r-name">{p.name}</span>
              </div>
              <span className="p50-r-stat">{p.kda != null ? <AnimatedNumber value={p.kda} decimals={2} /> : '—'}</span>
              <span className="p50-r-stat">{p.avg_cspm != null ? <AnimatedNumber value={p.avg_cspm} decimals={1} /> : '—'}</span>
              <span className="p50-r-stat">{p.avg_dpm != null ? <AnimatedNumber value={p.avg_dpm} decimals={0} /> : '—'}</span>
              <span className="p50-r-stat">{p.avg_gpm != null ? <AnimatedNumber value={p.avg_gpm} decimals={0} /> : '—'}</span>
              <span className="p50-r-stat">{p.avg_wpm != null ? <AnimatedNumber value={p.avg_wpm} decimals={2} /> : '—'}</span>
              <div className="p50-r-champs">
                {p.champions_played?.map(c => (
                  <div key={c.name} className="p50-r-champ-wrap">
                    <Image src={champImg(c.image_url) || ''} className="p50-r-champ-icon" alt={c.name} title={c.name} width={32} height={32} />
                    <span className="p50-r-champ-count"><AnimatedNumber value={c.games} decimals={0} /></span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
