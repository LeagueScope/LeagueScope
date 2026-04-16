'use client';

import Image from 'next/image';
import { useState, useEffect, useRef } from 'react';
import { teamImg, champImg, DRAGON_ICON, LEAGUE_LOGO, getWinRateClass } from '@/lib/constants';
import { clientFetch } from '@/lib/clientFetch';
import { logger } from '@/lib/logger';
import DragonChart from './DragonChart';
import { useFilters } from '@/context/FilterContext';
import './overview.css';
import './p50.css';

/* ═══════════════════════════════════════════════════════════════════════════
   Overview Client — Interactive filter-based refetching
   ═══════════════════════════════════════════════════════════════════════════ */

// ── Types for the API response ────────────────────────────────────────────
interface OverviewTournament {
  side_stats?: {
    blue?: { win_rate?: number; first_blood_rate?: number; first_dragon_rate?: number; first_herald_rate?: number; first_tower_rate?: number; first_baron_rate?: number };
    red?: { win_rate?: number; first_blood_rate?: number; first_dragon_rate?: number; first_herald_rate?: number; first_tower_rate?: number; first_baron_rate?: number };
  };
  dragons_by_type?: Record<string, number>;
}

interface TopChamp {
  name: string;
  image_url?: string;
  games?: number;
  picks?: number;
  bans?: number;
  win_rate: number;
}

interface PlayerStat {
  name: string;
  image_url?: string;
  team_logo_url?: string;
  team_abbr?: string;
  team?: string;
  top_champion?: string;
  top_champion_image?: string;
  max_kills?: number;
  avg_cspm?: number;
  kda?: number;
  kill_participation?: number;
  avg_damage_share?: number;
  avg_gold_share?: number;
}

interface BanChamp {
  name: string;
  image_url?: string;
  ban_rate_blue?: number;
  ban_rate_red?: number;
}

interface TeamStat {
  abbr: string;
  logo_url?: string;
  avg_kills?: number;
  avg_deaths?: number;
  avg_dragons?: number;
}

export interface OverviewData {
  tournament: OverviewTournament;
  topChamps: TopChamp[];
  topKills: PlayerStat[];
  topCS: PlayerStat[];
  topKDAPlayers: PlayerStat[];
  topKillParticipation: PlayerStat[];
  topDamageShare: PlayerStat[];
  topGoldShare: PlayerStat[];
  topKillsPerGame: TeamStat[];
  topDeathsPerGame: TeamStat[];
  topDragonsPerGame: TeamStat[];
  blueBans: BanChamp[];
  redBans: BanChamp[];
}

interface Props {
  league: string;
  accent: string;
  initialData: OverviewData | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────
function getRankByValue<T>(arr: T[] | undefined, value: unknown, key: keyof T): number {
  if (!arr || !Array.isArray(arr)) return 0;
  const sorted = [...arr].sort((a, b) => ((b[key] as number) || 0) - ((a[key] as number) || 0));
  const uniqueValues = [...new Set(sorted.map(item => item[key]))];
  return uniqueValues.indexOf(value as T[keyof T]) + 1;
}

function getMedal(i: number): string {
  if (i === 0) return 'p50-row-gold';
  if (i === 1) return 'p50-row-silver';
  if (i === 2) return 'p50-row-bronze';
  return '';
}

const PODIUM_CLASS = ['p50-podium-gold', 'p50-podium-silver', 'p50-podium-bronze'];

// ── Animated number counter (ease-out cubic) ──────────────────────────────
function AnimNum({ value, duration = 2000, decimals = 0, suffix = '' }: {
  value: number; duration?: number; decimals?: number; suffix?: string;
}) {
  const [display, setDisplay] = useState(0);
  const rafRef = useRef(0);

  useEffect(() => {
    const start = performance.now();
    const to = typeof value === 'number' ? value : 0;

    function tick(now: number) {
      const t = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
      setDisplay(to * eased);
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    }

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [value, duration]);

  return <>{decimals > 0 ? display.toFixed(decimals) : Math.round(display)}{suffix}</>;
}

export default function OverviewClient({ league, accent, initialData }: Props) {
  const filters = useFilters();
  const [data, setData] = useState<OverviewData | null>(initialData);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const timer = requestAnimationFrame(() => setLoaded(true));
    return () => cancelAnimationFrame(timer);
  }, []);

  // Refetch on filter change
  useEffect(() => {
    if (!filters.ready) return;
    const qs = new URLSearchParams();
    qs.set('league', league.toUpperCase());
    if (filters.year) qs.set('year', String(filters.year));
    if (filters.split) qs.set('split', filters.split);
    if (filters.stage && filters.stage !== 'all') qs.set('stage', filters.stage);

    let cancelled = false;
    clientFetch<OverviewData>(`/api/v1/pg/overview?${qs}`)
      .then(d => { if (!cancelled) setData(d); })
      .catch(logger.error);

    return () => { cancelled = true; };
  }, [league, filters.ready, filters.year, filters.split, filters.stage]);

  if (!data || !data.tournament) {
    return (
      <div className="p50-container" style={{ '--p50-accent': accent, '--p2-league-accent': accent } as React.CSSProperties}>
        <div className="p2-league-header">
          <div className="p2-header-info">
            <div className="p2-header-logo-container">
              <Image src={LEAGUE_LOGO(league)} alt={league} width={40} height={40} />
            </div>
            <div className="p2-header-text">
              <div className="p2-header-league-name">{league.toUpperCase()} OVERVIEW</div>
            </div>
          </div>
        </div>
        <div className="p50-card" style={{ gridColumn: 'span 3', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 300 }}>
          <span style={{ color: '#8d9db3', fontSize: 14, fontWeight: 700 }}>No hay datos del torneo</span>
        </div>
      </div>
    );
  }

  const {
    tournament, topChamps, topKills, topCS, topKDAPlayers,
    topKillParticipation, topDamageShare, topGoldShare,
    topKillsPerGame, topDeathsPerGame, topDragonsPerGame,
    blueBans, redBans,
  } = data;

  const blue = tournament.side_stats?.blue || {};
  const red = tournament.side_stats?.red || {};
  const dragons = tournament.dragons_by_type || {};
  const totalDragons = Object.values(dragons).reduce((a, b) => a + b, 0);

  const sideStats: [string, number, number][] = [
    ['Win Rate', blue.win_rate || 0, red.win_rate || 0],
    ['First Blood', blue.first_blood_rate || 0, red.first_blood_rate || 0],
    ['First Dragon', blue.first_dragon_rate || 0, red.first_dragon_rate || 0],
    ['First Herald', blue.first_herald_rate || 0, red.first_herald_rate || 0],
    ['First Tower', blue.first_tower_rate || 0, red.first_tower_rate || 0],
    ['First Baron', blue.first_baron_rate || 0, red.first_baron_rate || 0],
  ];

  // ── Detect "no advanced stats" case: torneo sin telemetría detallada ──
  // Si no hay champions, ni jugadores, ni bans, ni side_stats con valores reales,
  // mostramos un mensaje informativo en lugar de los bloques vacíos.
  const hasChamps = (topChamps || []).length > 0;
  const hasPlayers = (topKills || []).length > 0 || (topCS || []).length > 0 || (topKDAPlayers || []).length > 0;
  const hasTeamStats = (topKillsPerGame || []).length > 0;
  const hasBans = (blueBans || []).length > 0 || (redBans || []).length > 0;
  const hasSideStats = (blue.win_rate || 0) > 0 || (red.win_rate || 0) > 0;
  const hasAdvancedStats = hasChamps || hasPlayers || hasTeamStats || hasBans || hasSideStats;

  if (!hasAdvancedStats) {
    return (
      <div className="p50-container" style={{ '--p50-accent': accent, '--p2-league-accent': accent } as React.CSSProperties}>
        <div className="p2-league-header">
          <div className="p2-header-info">
            <div className="p2-header-logo-container">
              <Image src={LEAGUE_LOGO(league)} alt={league} width={40} height={40} />
            </div>
            <div className="p2-header-text">
              <div className="p2-header-league-name">{league.toUpperCase()} OVERVIEW</div>
              <div className="p2-header-season">SEASON {filters.year || ''} // {(filters.split || '').toUpperCase()}</div>
            </div>
          </div>
        </div>
        <div
          className="p50-card"
          style={{
            gridColumn: 'span 3',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: 360,
            padding: '48px 24px',
            textAlign: 'center',
          }}
        >
          <div style={{ color: '#e6edf3', fontSize: 16, fontWeight: 700, letterSpacing: 0.3, maxWidth: 520, lineHeight: 1.5 }}>
            Lo sentimos, actualmente no disponemos de información detallada de este torneo.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p50-container" style={{ '--p50-accent': accent, '--p2-league-accent': accent } as React.CSSProperties}>

      {/* ═══════ HEADER ═══════ */}
      <div className="p2-league-header">
        <div className="p2-header-info">
          <div className="p2-header-logo-container">
            <Image src={LEAGUE_LOGO(league)} alt={league} width={40} height={40} />
          </div>
          <div className="p2-header-text">
            <div className="p2-header-league-name">{league.toUpperCase()} OVERVIEW</div>
            <div className="p2-header-season">SEASON {filters.year || ''} // {(filters.split || '').toUpperCase()}</div>
          </div>
        </div>
      </div>

      {/* ═══════ CHAMPIONS PLAYED ═══════ */}
      <div className="p50-card p50-card-stretch">
        <div className="p50-card-head">
          <span className="p50-card-title">CHAMPIONS PLAYED</span>
        </div>
        <div className="p50-card-body p50-body-spread">
          <div className="p50-table-hdr">
            <span>CHAMPION</span>
            <span className="p50-hdr-stat">P</span>
            <span className="p50-hdr-stat">B</span>
            <span className="p50-hdr-stat">WR</span>
          </div>
          {(topChamps || []).slice(0, 10).map((c, i) => (
            <div key={i} className={`p50-table-row ${getMedal(i)}`}>
              <div className="p50-row-info">
                <div className="p50-champ-img"><Image src={champImg(c.image_url) || ''} alt={c.name} width={28} height={28} /></div>
                <span className="p50-row-name">{c.name}</span>
              </div>
              <div className="p50-row-stats">
                <span className="p50-row-val"><AnimNum value={c.games || c.picks || 0} /></span>
                <span className="p50-row-val"><AnimNum value={c.bans ?? 0} /></span>
                <span className={`p50-row-val p50-wr ${getWinRateClass(c.win_rate)}`}><AnimNum value={c.win_rate || 0} decimals={1} suffix="%" /></span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ═══════ SIDE COMPARISON ═══════ */}
      <div className="p50-card p50-card-stretch">
        <div className="p50-card-head">
          <span className="p50-card-title">SIDE COMPARISON</span>
        </div>
        <div className="p50-card-body p50-sides">
          {sideStats.map(([label, blueVal, redVal]) => (
            <div className="p50-side-row" key={label}>
              <div className="p50-side-lbl">{label}</div>
              <div className="p50-side-bar-wrap">
                <span className="p50-side-val blue"><AnimNum value={blueVal} decimals={1} suffix="%" /></span>
                <div className="p50-side-bar">
                  <div className="p50-side-fill blue" style={{ width: loaded ? `${blueVal}%` : '0%' }} />
                  <div className="p50-side-fill red" style={{ width: loaded ? `${redVal}%` : '0%' }} />
                </div>
                <span className="p50-side-val red"><AnimNum value={redVal} decimals={1} suffix="%" /></span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ═══════ BAN RATE ═══════ */}
      <div className="p50-card">
        <div className="p50-card-head">
          <span className="p50-card-title">BAN RATE</span>
        </div>
        <div className="p50-card-body">
          <div className="p50-sections">
            <div className="p50-section">
              <div className="p50-section-title blue">BLUE SIDE BANS</div>
              {(blueBans || []).map((c, i) => (
                <div key={c.name} className={`p50-table-row ${getMedal(i)}`}>
                  <div className="p50-row-info">
                    <div className="p50-champ-img"><Image src={champImg(c.image_url) || ''} alt={c.name} width={28} height={28} /></div>
                    <span className="p50-row-name">{c.name}</span>
                  </div>
                  <span className="p50-row-val accent"><AnimNum value={c.ban_rate_blue || 0} decimals={1} suffix="%" /></span>
                </div>
              ))}
            </div>
            <div className="p50-section">
              <div className="p50-section-title red">RED SIDE BANS</div>
              {(redBans || []).map((c, i) => (
                <div key={c.name} className={`p50-table-row ${getMedal(i)}`}>
                  <div className="p50-row-info">
                    <div className="p50-champ-img"><Image src={champImg(c.image_url) || ''} alt={c.name} width={28} height={28} /></div>
                    <span className="p50-row-name">{c.name}</span>
                  </div>
                  <span className="p50-row-val accent"><AnimNum value={c.ban_rate_red || 0} decimals={1} suffix="%" /></span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ═══════ PEAK KILLS ═══════ */}
      <div className="p50-card">
        <div className="p50-card-head"><span className="p50-card-title">PEAK KILLS</span></div>
        <div className="p50-card-body">
          {/* Podium top 3 — order: 2nd | 1st | 3rd */}
          <div className="p50-podium">
            {[1, 0, 2].map(idx => {
              const p = (topKills || [])[idx];
              if (!p) return <div key={idx} className="p50-podium-slot" />;
              const playerImg = p.image_url || teamImg(p.team_logo_url, p.team_abbr, league);
              const champImg2 = p.top_champion_image || '';
              return (
                <div key={p.name} className={`p50-podium-slot p50-podium-bg ${PODIUM_CLASS[idx]}`}>
                  {/* Background: player 55% + champion 45% */}
                  <div className="p50-podium-bg-layer">
                    <div className="p50-podium-bg-player" style={{ backgroundImage: `url(${playerImg})` }} />
                    {champImg2 && <div className="p50-podium-bg-champ" style={{ backgroundImage: `url(${champImg2})` }} />}
                  </div>
                  <span className="p50-podium-name">{p.name}</span>
                  <span className="p50-podium-val"><AnimNum value={p.max_kills || 0} /></span>
                </div>
              );
            })}
          </div>
          {/* Rest of the list */}
          {(topKills || []).slice(3, 10).map((p, i) => (
            <div key={`${p.name}-${i}`} className="p50-table-row">
              <div className="p50-row-info">
                <span className="p50-row-rank">{i + 4}</span>
                <div className="p50-avatar-rect"><Image src={p.image_url || teamImg(p.team_logo_url, p.team_abbr, league)} alt={p.name} width={72} height={90} /></div>
                <span className="p50-row-name">{p.name}</span>
              </div>
              <div className="p50-row-stat-group">
                {p.top_champion_image && <div className="p50-row-champ-icon"><Image src={p.top_champion_image} alt={p.top_champion || ''} width={40} height={40} /></div>}
                <span className="p50-row-val accent"><AnimNum value={p.max_kills || 0} /></span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ═══════ AVG FARMING ═══════ */}
      <div className="p50-card">
        <div className="p50-card-head"><span className="p50-card-title">AVG FARMING</span></div>
        <div className="p50-card-body">
          <div className="p50-podium">
            {[1, 0, 2].map(idx => {
              const p = (topCS || [])[idx];
              if (!p) return <div key={idx} className="p50-podium-slot" />;
              const playerImg = p.image_url || teamImg(p.team_logo_url, p.team_abbr, league);
              const teamLogo = teamImg(p.team_logo_url, p.team_abbr, league);
              return (
                <div key={p.name} className={`p50-podium-slot p50-podium-bg ${PODIUM_CLASS[idx]}`}>
                  <div className="p50-podium-bg-layer">
                    <div className="p50-podium-bg-player" style={{ backgroundImage: `url(${playerImg})` }} />
                    <div className="p50-podium-bg-champ" style={{ backgroundImage: `url(${teamLogo})` }} />
                  </div>
                  <span className="p50-podium-name">{p.name}</span>
                  <span className="p50-podium-val"><AnimNum value={p.avg_cspm || 0} decimals={1} /></span>
                </div>
              );
            })}
          </div>
          {(topCS || []).slice(3, 10).map((p, i) => (
            <div key={`${p.name}-${i}`} className="p50-table-row">
              <div className="p50-row-info">
                <span className="p50-row-rank">{i + 4}</span>
                <div className="p50-avatar-rect"><Image src={p.image_url || teamImg(p.team_logo_url, p.team_abbr, league)} alt={p.name} width={72} height={90} /></div>
                <span className="p50-row-name">{p.name}</span>
              </div>
              <div className="p50-row-stat-group">
                <div className="p50-row-team-icon"><Image src={teamImg(p.team_logo_url, p.team_abbr, league)} alt={p.team_abbr || ''} width={40} height={40} /></div>
                <span className="p50-row-val accent"><AnimNum value={p.avg_cspm || 0} decimals={1} /></span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ═══════ KDA RATIO ═══════ */}
      <div className="p50-card">
        <div className="p50-card-head"><span className="p50-card-title">KDA RATIO</span></div>
        <div className="p50-card-body">
          <div className="p50-podium">
            {[1, 0, 2].map(idx => {
              const p = (topKDAPlayers || [])[idx];
              if (!p) return <div key={idx} className="p50-podium-slot" />;
              const playerImg = p.image_url || teamImg(p.team_logo_url, p.team_abbr, league);
              const teamLogo = teamImg(p.team_logo_url, p.team_abbr, league);
              return (
                <div key={p.name} className={`p50-podium-slot p50-podium-bg ${PODIUM_CLASS[idx]}`}>
                  <div className="p50-podium-bg-layer">
                    <div className="p50-podium-bg-player" style={{ backgroundImage: `url(${playerImg})` }} />
                    <div className="p50-podium-bg-champ" style={{ backgroundImage: `url(${teamLogo})` }} />
                  </div>
                  <span className="p50-podium-name">{p.name}</span>
                  <span className="p50-podium-val"><AnimNum value={p.kda || 0} decimals={1} /></span>
                </div>
              );
            })}
          </div>
          {(topKDAPlayers || []).slice(3, 10).map((p, i) => (
            <div key={`${p.name}-${i}`} className="p50-table-row">
              <div className="p50-row-info">
                <span className="p50-row-rank">{i + 4}</span>
                <div className="p50-avatar-rect"><Image src={p.image_url || teamImg(p.team_logo_url, p.team_abbr, league)} alt={p.name} width={72} height={90} /></div>
                <span className="p50-row-name">{p.name}</span>
              </div>
              <div className="p50-row-stat-group">
                <div className="p50-row-team-icon"><Image src={teamImg(p.team_logo_url, p.team_abbr, league)} alt={p.team_abbr || ''} width={40} height={40} /></div>
                <span className="p50-row-val accent"><AnimNum value={p.kda || 0} decimals={1} /></span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ═══════ PLAYER PERFORMANCE ═══════ */}
      <div className="p50-card">
        <div className="p50-card-head"><span className="p50-card-title">PLAYER PERFORMANCE</span></div>
        <div className="p50-card-body">
          <div className="p50-sections">
            <div className="p50-section">
              <div className="p50-section-title">KILL PARTICIPATION</div>
              {(topKillParticipation || []).map((p, i) => (
                <div key={p.name} className={`p50-table-row ${getMedal(i)}`}>
                  <div className="p50-row-info">
                    <span className="p50-row-rank">{i + 1}</span>
                    <div className="p50-avatar"><Image src={p.image_url || teamImg(p.team_logo_url, p.team_abbr, league)} alt={p.name} width={32} height={32} /></div>
                    <span className="p50-row-name">{p.name}</span>
                  </div>
                  <span className="p50-row-val accent"><AnimNum value={p.kill_participation || 0} decimals={1} suffix="%" /></span>
                </div>
              ))}
            </div>
            <div className="p50-section">
              <div className="p50-section-title">DAMAGE SHARE %</div>
              {(topDamageShare || []).map((p, i) => (
                <div key={p.name} className={`p50-table-row ${getMedal(i)}`}>
                  <div className="p50-row-info">
                    <span className="p50-row-rank">{i + 1}</span>
                    <div className="p50-avatar"><Image src={p.image_url || teamImg(p.team_logo_url, p.team_abbr, league)} alt={p.name} width={32} height={32} /></div>
                    <span className="p50-row-name">{p.name}</span>
                  </div>
                  <span className="p50-row-val accent"><AnimNum value={p.avg_damage_share || 0} decimals={1} suffix="%" /></span>
                </div>
              ))}
            </div>
            <div className="p50-section">
              <div className="p50-section-title">GOLD SHARE %</div>
              {(topGoldShare || []).map((p, i) => (
                <div key={p.name} className={`p50-table-row ${getMedal(i)}`}>
                  <div className="p50-row-info">
                    <span className="p50-row-rank">{i + 1}</span>
                    <div className="p50-avatar"><Image src={p.image_url || teamImg(p.team_logo_url, p.team_abbr, league)} alt={p.name} width={32} height={32} /></div>
                    <span className="p50-row-name">{p.name}</span>
                  </div>
                  <span className="p50-row-val accent"><AnimNum value={p.avg_gold_share || 0} decimals={1} suffix="%" /></span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ═══════ ELEMENTAL DRAGONS ═══════ */}
      <div className="p50-card">
        <div className="p50-card-head"><span className="p50-card-title">ELEMENTAL DRAGONS</span></div>
        <div className="p50-card-body">
          <div className="p50-dragons-vertical">
            <div className="p50-dragons-list">
              {Object.entries(dragons).map(([type, count]) => (
                <div key={type} className="p50-dragon-item">
                  <Image src={DRAGON_ICON(type)} alt={type} width={24} height={24} />
                  <span className="p50-dragon-name">{type}</span>
                  <span className="p50-dragon-count"><AnimNum value={count} /></span>
                </div>
              ))}
            </div>
            <div className="p50-dragons-chart">
              <DragonChart dragons={dragons} totalDragons={totalDragons} />
            </div>
          </div>
        </div>
      </div>

      {/* ═══════ TEAM PERFORMANCE ═══════ */}
      <div className="p50-card">
        <div className="p50-card-head"><span className="p50-card-title">TEAM PERFORMANCE</span></div>
        <div className="p50-card-body">
          <div className="p50-sections">
            <div className="p50-section">
              <div className="p50-section-title">KILLS / GAME</div>
              {(topKillsPerGame || []).map((tm, i) => (
                <div key={tm.abbr} className={`p50-table-row ${getMedal(i)}`}>
                  <div className="p50-row-info">
                    <span className="p50-row-rank">{i + 1}</span>
                    <div className="p50-team-logo"><Image src={teamImg(tm.logo_url, tm.abbr, league)} alt={tm.abbr} width={24} height={24} /></div>
                    <span className="p50-row-name">{tm.abbr}</span>
                  </div>
                  <span className="p50-row-val accent"><AnimNum value={tm.avg_kills || 0} decimals={1} /></span>
                </div>
              ))}
            </div>
            <div className="p50-section">
              <div className="p50-section-title">DEATHS / GAME</div>
              {(topDeathsPerGame || []).map((tm, i) => (
                <div key={tm.abbr} className={`p50-table-row ${getMedal(i)}`}>
                  <div className="p50-row-info">
                    <span className="p50-row-rank">{i + 1}</span>
                    <div className="p50-team-logo"><Image src={teamImg(tm.logo_url, tm.abbr, league)} alt={tm.abbr} width={24} height={24} /></div>
                    <span className="p50-row-name">{tm.abbr}</span>
                  </div>
                  <span className="p50-row-val accent"><AnimNum value={tm.avg_deaths || 0} decimals={1} /></span>
                </div>
              ))}
            </div>
            <div className="p50-section">
              <div className="p50-section-title">DRAGONS / GAME</div>
              {(topDragonsPerGame || []).map((tm, i) => (
                <div key={tm.abbr} className={`p50-table-row ${getMedal(i)}`}>
                  <div className="p50-row-info">
                    <span className="p50-row-rank">{i + 1}</span>
                    <div className="p50-team-logo"><Image src={teamImg(tm.logo_url, tm.abbr, league)} alt={tm.abbr} width={24} height={24} /></div>
                    <span className="p50-row-name">{tm.abbr}</span>
                  </div>
                  <span className="p50-row-val accent"><AnimNum value={tm.avg_dragons || 0} decimals={1} /></span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
