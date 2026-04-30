'use client';

import Image from 'next/image';
import { useState, useEffect, useRef } from 'react';
import { teamImg, champImg, DRAGON_ICON, LEAGUE_LOGO, getWinRateClass } from '@/lib/constants';
import { clientFetch } from '@/lib/clientFetch';
import { logger } from '@/lib/logger';
import DragonChart from './DragonChart';
import { useFilters } from '@/context/FilterContext';
import { ExpandableGrid, ExpandableCard } from './ExpandableCard';
import './overview.css';
import './p50.css';

/* ═══════════════════════════════════════════════════════════════════════════
   Overview Client — Interactive filter-based refetching
   ═══════════════════════════════════════════════════════════════════════════ */

// ── Types for the API response ────────────────────────────────────────────
interface SideStats {
  win_rate?: number;
  first_blood_rate?: number;
  first_dragon_rate?: number;
  first_herald_rate?: number;
  first_tower_rate?: number;
  first_baron_rate?: number;
  games?: number;
  wins?: number;
  fb_count?: number;
  fd_count?: number;
  fh_count?: number;
  ft_count?: number;
  fba_count?: number;
}
interface OverviewTournament {
  side_stats?: { blue?: SideStats; red?: SideStats };
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
  bans_blue?: number;
  bans_red?: number;
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

// ── Editorial header (mirrors p20-ed-hdr / p24-ed-hdr / p25-ed-hdr / tr-ed-hdr)
interface EditorialHeaderProps {
  league: string;
  leagueName: string;
  year?: number | null;
  split?: string | null;
}
function EditorialHeader({ league, leagueName, year, split }: EditorialHeaderProps) {
  return (
    <div className="p50-ed-card">
      <Image
        src={LEAGUE_LOGO(league)}
        alt=""
        className="p50-ed-watermark"
        aria-hidden="true"
        width={280}
        height={280}
      />
      <div className="p50-ed-hdr">
        <div className="p50-ed-hdr-left">
          <Image src={LEAGUE_LOGO(league)} alt={league} className="p50-ed-logo" width={64} height={64} />
          <div className="p50-ed-hdr-text">
            <span className="p50-ed-hero">{leagueName} OVERVIEW</span>
            <span className="p50-ed-subhero">
              SEASON {year || ''} · {(split || '').toUpperCase()}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

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

// ── Search input usado dentro de cards expandidas ────────────────────────────
function CardSearchInput({ value, onChange, placeholder = 'Filtrar...' }: {
  value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  return (
    <input
      className="p50-card-search"
      type="search"
      placeholder={placeholder}
      value={value}
      onChange={e => onChange(e.target.value)}
      onClick={e => e.stopPropagation()}
      onKeyDown={e => e.stopPropagation()}
      aria-label={placeholder}
    />
  );
}

// ── PlayerRankingCard (Peak Kills / Avg Farming / KDA Ratio) ─────────────────
// Card con podium top 3 + lista desde el rank 4. Buscador filtra todo cuando
// se expande (al filtrar se oculta el podium para evitar inconsistencias).
type PlayerRankingCardProps = {
  cardId: string;
  title: string;
  data: PlayerStat[];
  league: string;
  rowIcon: 'champion' | 'team';
  valueOf: (p: PlayerStat) => number;
  decimals?: number;
  suffix?: string;
};

function PlayerRankingCard({
  cardId, title, data, league, rowIcon, valueOf, decimals = 0, suffix = '',
}: PlayerRankingCardProps) {
  const [query, setQuery] = useState('');
  return (
    <ExpandableCard cardId={cardId}>
      {(isExpanded) => {
        const q = query.trim().toLowerCase();
        const filtered = isExpanded && q
          ? (data || []).filter(p => (p.name || '').toLowerCase().includes(q))
          : (data || []);
        const showPodium = !q;
        const restList = q
          ? filtered
          : filtered.slice(3, isExpanded ? undefined : 10);
        return (
          <>
            <div className="p50-card-head">
              <span className="p50-card-title">{title}</span>
              {isExpanded && (
                <CardSearchInput value={query} onChange={setQuery} placeholder="Filtrar jugador..." />
              )}
            </div>
            <div className="p50-card-body">
              {showPodium && (
                <div className="p50-podium">
                  {[1, 0, 2].map(idx => {
                    const p = (data || [])[idx];
                    if (!p) return <div key={idx} className="p50-podium-slot" />;
                    const hasPlayerPhoto = Boolean(p.image_url);
                    const playerImg = p.image_url || teamImg(p.team_logo_url, p.team_abbr, league);
                    const secondaryImg = rowIcon === 'champion'
                      ? (p.top_champion_image || '')
                      : teamImg(p.team_logo_url, p.team_abbr, league);
                    // Si no hay foto y el secundario seria duplicado (rowIcon='team'), usar variante team-only.
                    // Si rowIcon='champion' (Peak Kills), mantener el secundario y solo "contener" el logo arriba.
                    const useFullTeamLogo = !hasPlayerPhoto && (rowIcon === 'team' || !secondaryImg);
                    const slotFallbackClass = useFullTeamLogo ? 'p50-podium-bg-team' : '';
                    const playerFallbackClass = !hasPlayerPhoto && !useFullTeamLogo ? 'is-team-fallback' : '';
                    const showSecondary = Boolean(secondaryImg) && !useFullTeamLogo;
                    return (
                      <div key={p.name} className={`p50-podium-slot p50-podium-bg ${PODIUM_CLASS[idx]} ${slotFallbackClass}`}>
                        <div className="p50-podium-bg-layer">
                          <div className={`p50-podium-bg-player ${playerFallbackClass}`} style={{ backgroundImage: `url(${playerImg})` }} />
                          {showSecondary && <div className="p50-podium-bg-champ" style={{ backgroundImage: `url(${secondaryImg})` }} />}
                        </div>
                        <span className="p50-podium-name">{p.name}</span>
                        <span className="p50-podium-val"><AnimNum value={valueOf(p)} decimals={decimals} suffix={suffix} /></span>
                      </div>
                    );
                  })}
                </div>
              )}
              {restList.map((p, i) => {
                const rank = q ? i + 1 : i + 4;
                const hasPlayerPhoto = Boolean(p.image_url);
                const playerImg = p.image_url || teamImg(p.team_logo_url, p.team_abbr, league);
                const iconImg = rowIcon === 'champion'
                  ? (p.top_champion_image || '')
                  : teamImg(p.team_logo_url, p.team_abbr, league);
                const iconAlt = rowIcon === 'champion' ? (p.top_champion || '') : (p.team_abbr || '');
                return (
                  <div key={`${p.name}-${i}`} className="p50-table-row">
                    <div className="p50-row-info">
                      <span className="p50-row-rank">{rank}</span>
                      <div className={`p50-avatar-rect ${hasPlayerPhoto ? '' : 'is-team-fallback'}`}><Image src={playerImg} alt={p.name} width={72} height={90} /></div>
                      <span className="p50-row-name">{p.name}</span>
                    </div>
                    <div className="p50-row-stat-group">
                      {iconImg && (
                        <div className={rowIcon === 'champion' ? 'p50-row-champ-icon' : 'p50-row-team-icon'}>
                          <Image src={iconImg} alt={iconAlt} width={40} height={40} />
                        </div>
                      )}
                      <span className="p50-row-val accent"><AnimNum value={valueOf(p)} decimals={decimals} suffix={suffix} /></span>
                    </div>
                  </div>
                );
              })}
              {isExpanded && q && filtered.length === 0 && (
                <div className="p50-no-results">Ningun jugador coincide con &quot;{query}&quot;</div>
              )}
            </div>
          </>
        );
      }}
    </ExpandableCard>
  );
}

// ── PlayerPerformanceCard (KP / Damage Share / Gold Share, 3 secciones) ──────
function PlayerPerformanceCard({
  topKillParticipation, topDamageShare, topGoldShare, league,
}: {
  topKillParticipation: PlayerStat[];
  topDamageShare: PlayerStat[];
  topGoldShare: PlayerStat[];
  league: string;
}) {
  const [query, setQuery] = useState('');
  return (
    <ExpandableCard cardId="player-perf" expandedClassName="p50-expanded-split3">
      {(isExpanded) => {
        const q = query.trim().toLowerCase();
        const filterFn = (p: PlayerStat) => !q || (p.name || '').toLowerCase().includes(q);
        const kp = isExpanded ? (topKillParticipation || []).filter(filterFn) : (topKillParticipation || []);
        const ds = isExpanded ? (topDamageShare || []).filter(filterFn) : (topDamageShare || []);
        const gs = isExpanded ? (topGoldShare || []).filter(filterFn) : (topGoldShare || []);
        const kpDisplay = kp.slice(0, isExpanded ? undefined : 3);
        const dsDisplay = ds.slice(0, isExpanded ? undefined : 3);
        const gsDisplay = gs.slice(0, isExpanded ? undefined : 3);
        const renderRow = (p: PlayerStat, i: number, value: number) => (
          <div key={`${p.name}-${i}`} className={`p50-table-row ${q ? '' : getMedal(i)}`}>
            <div className="p50-row-info">
              <span className="p50-row-rank">{i + 1}</span>
              <div className={`p50-avatar ${p.image_url ? '' : 'is-team-fallback'}`}><Image src={p.image_url || teamImg(p.team_logo_url, p.team_abbr, league)} alt={p.name} width={32} height={32} /></div>
              <span className="p50-row-name">{p.name}</span>
            </div>
            <span className="p50-row-val accent"><AnimNum value={value} decimals={1} suffix="%" /></span>
          </div>
        );
        return (
          <>
            <div className="p50-card-head">
              <span className="p50-card-title">PLAYER PERFORMANCE</span>
              {isExpanded && (
                <CardSearchInput value={query} onChange={setQuery} placeholder="Filtrar jugador..." />
              )}
            </div>
            <div className="p50-card-body">
              <div className="p50-sections">
                <div className="p50-section">
                  <div className="p50-section-title">KILL PARTICIPATION</div>
                  {kpDisplay.map((p, i) => renderRow(p, i, p.kill_participation || 0))}
                  {isExpanded && q && kpDisplay.length === 0 && (
                    <div className="p50-no-results">Sin coincidencias</div>
                  )}
                </div>
                <div className="p50-section">
                  <div className="p50-section-title">DAMAGE SHARE %</div>
                  {dsDisplay.map((p, i) => renderRow(p, i, p.avg_damage_share || 0))}
                  {isExpanded && q && dsDisplay.length === 0 && (
                    <div className="p50-no-results">Sin coincidencias</div>
                  )}
                </div>
                <div className="p50-section">
                  <div className="p50-section-title">GOLD SHARE %</div>
                  {gsDisplay.map((p, i) => renderRow(p, i, p.avg_gold_share || 0))}
                  {isExpanded && q && gsDisplay.length === 0 && (
                    <div className="p50-no-results">Sin coincidencias</div>
                  )}
                </div>
              </div>
            </div>
          </>
        );
      }}
    </ExpandableCard>
  );
}

// ── Champions Played card (con buscador en estado expandido) ─────────────────
function ChampionsPlayedCard({ topChamps }: { topChamps: TopChamp[] }) {
  const [query, setQuery] = useState('');
  return (
    <ExpandableCard cardId="champions" className="p50-card-stretch">
      {(isExpanded) => {
        const q = query.trim().toLowerCase();
        const filtered = isExpanded && q
          ? (topChamps || []).filter(c => (c.name || '').toLowerCase().includes(q))
          : (topChamps || []);
        const displayed = filtered.slice(0, isExpanded ? undefined : 10);
        return (
          <>
            <div className="p50-card-head">
              <span className="p50-card-title">CHAMPIONS PLAYED</span>
              {isExpanded && (
                <CardSearchInput value={query} onChange={setQuery} placeholder="Filtrar campeón..." />
              )}
            </div>
            <div className="p50-card-body p50-body-spread">
              <div className="p50-table-hdr">
                <span>CHAMPION</span>
                <span className="p50-hdr-stat">P</span>
                <span className="p50-hdr-stat">B</span>
                <span className="p50-hdr-stat">WR</span>
              </div>
              {displayed.map((c, i) => (
                <div key={`${c.name}-${i}`} className={`p50-table-row ${q ? '' : getMedal(i)}`}>
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
              {isExpanded && q && displayed.length === 0 && (
                <div className="p50-no-results">Ningun campeon coincide con &quot;{query}&quot;</div>
              )}
            </div>
          </>
        );
      }}
    </ExpandableCard>
  );
}

// ── Ban Rate card (con buscador en estado expandido) ─────────────────────────
function BanRateCard({ blueBans, redBans }: { blueBans: BanChamp[]; redBans: BanChamp[] }) {
  const [query, setQuery] = useState('');
  return (
    <ExpandableCard cardId="bans" expandedClassName="p50-expanded-split2">
      {(isExpanded) => {
        const q = query.trim().toLowerCase();
        const filterFn = (c: BanChamp) => !q || (c.name || '').toLowerCase().includes(q);
        const blueFiltered = isExpanded ? (blueBans || []).filter(filterFn) : (blueBans || []);
        const redFiltered = isExpanded ? (redBans || []).filter(filterFn) : (redBans || []);
        const blueDisplayed = blueFiltered.slice(0, isExpanded ? undefined : 5);
        const redDisplayed = redFiltered.slice(0, isExpanded ? undefined : 5);
        return (
          <>
            <div className="p50-card-head">
              <span className="p50-card-title">BAN RATE</span>
              {isExpanded && (
                <CardSearchInput value={query} onChange={setQuery} placeholder="Filtrar campeon..." />
              )}
            </div>
            <div className="p50-card-body">
              <div className="p50-sections">
                <div className="p50-section">
                  <div className="p50-section-title blue">BLUE SIDE BANS</div>
                  {blueDisplayed.map((c, i) => (
                    <div key={c.name} className={`p50-table-row ${q ? '' : getMedal(i)}`}>
                      <div className="p50-row-info">
                        <div className="p50-champ-img"><Image src={champImg(c.image_url) || ''} alt={c.name} width={28} height={28} /></div>
                        <span className="p50-row-name">{c.name}</span>
                      </div>
                      <span className="p50-bans-cell">
                        <span className="p50-bans-main blue"><AnimNum value={c.bans_blue || 0} /></span>
                        <span className="p50-bans-ghost red">(<AnimNum value={c.bans_red || 0} />)</span>
                      </span>
                      <span className="p50-row-val accent"><AnimNum value={c.ban_rate_blue || 0} decimals={1} suffix="%" /></span>
                    </div>
                  ))}
                  {isExpanded && q && blueDisplayed.length === 0 && (
                    <div className="p50-no-results">Sin coincidencias</div>
                  )}
                </div>
                <div className="p50-section">
                  <div className="p50-section-title red">RED SIDE BANS</div>
                  {redDisplayed.map((c, i) => (
                    <div key={c.name} className={`p50-table-row ${q ? '' : getMedal(i)}`}>
                      <div className="p50-row-info">
                        <div className="p50-champ-img"><Image src={champImg(c.image_url) || ''} alt={c.name} width={28} height={28} /></div>
                        <span className="p50-row-name">{c.name}</span>
                      </div>
                      <span className="p50-bans-cell">
                        <span className="p50-bans-main red"><AnimNum value={c.bans_red || 0} /></span>
                        <span className="p50-bans-ghost blue">(<AnimNum value={c.bans_blue || 0} />)</span>
                      </span>
                      <span className="p50-row-val accent"><AnimNum value={c.ban_rate_red || 0} decimals={1} suffix="%" /></span>
                    </div>
                  ))}
                  {isExpanded && q && redDisplayed.length === 0 && (
                    <div className="p50-no-results">Sin coincidencias</div>
                  )}
                </div>
              </div>
            </div>
          </>
        );
      }}
    </ExpandableCard>
  );
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
    qs.set('full', '1');
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
        <EditorialHeader
          league={league}
          leagueName={league.toUpperCase()}
          year={filters.year}
          split={filters.split}
        />
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

  // Total games del split (blue.games == red.games == total games finalizados)
  const totalGames = Math.max(Number(blue.games) || 0, Number(red.games) || 0);
  // Helper: para cada métrica devuelve [blueCount, redCount, neitherCount]
  // neither = games donde nadie consiguió el objetivo (barra amarilla rellenando el hueco)
  const triplet = (b: number, r: number): [number, number, number] => {
    const n = Math.max(0, totalGames - (b + r));
    return [b, r, n];
  };
  const sideStats: [string, number, number, number, number, number][] = [
    ['Win Rate',     blue.win_rate || 0,           red.win_rate || 0,           ...triplet(blue.wins     || 0, red.wins     || 0)],
    ['First Blood',  blue.first_blood_rate  || 0,  red.first_blood_rate  || 0,  ...triplet(blue.fb_count || 0, red.fb_count || 0)],
    ['First Dragon', blue.first_dragon_rate || 0,  red.first_dragon_rate || 0,  ...triplet(blue.fd_count || 0, red.fd_count || 0)],
    ['First Herald', blue.first_herald_rate || 0,  red.first_herald_rate || 0,  ...triplet(blue.fh_count || 0, red.fh_count || 0)],
    ['First Tower',  blue.first_tower_rate  || 0,  red.first_tower_rate  || 0,  ...triplet(blue.ft_count || 0, red.ft_count || 0)],
    ['First Baron',  blue.first_baron_rate  || 0,  red.first_baron_rate  || 0,  ...triplet(blue.fba_count|| 0, red.fba_count|| 0)],
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
        <EditorialHeader
          league={league}
          leagueName={league.toUpperCase()}
          year={filters.year}
          split={filters.split}
        />
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
      <EditorialHeader
        league={league}
        leagueName={league.toUpperCase()}
        year={filters.year}
        split={filters.split}
      />

      <ExpandableGrid>

      {/* ═══════ CHAMPIONS PLAYED ═══════ */}
      <ChampionsPlayedCard topChamps={topChamps || []} />

      {/* ═══════ SIDE COMPARISON ═══════ */}
      <div className="p50-card p50-card-stretch">
        <div className="p50-card-head">
          <span className="p50-card-title">SIDE COMPARISON</span>
        </div>
        <div className="p50-card-body p50-sides">
          {sideStats.map(([label, blueVal, redVal, blueCount, redCount, neitherCount]) => (
            <div className="p50-side-row" key={label}>
              <div className="p50-side-lbl">
                <span className="p50-side-lbl-text">{label}</span>
                <span className="p50-side-lbl-counts">
                  (<span className="p50-side-count blue">{blueCount}</span>
                  <span className="p50-side-count-sep">–</span>
                  {neitherCount > 0 && <>
                    <span className="p50-side-count neutral">{neitherCount}</span>
                    <span className="p50-side-count-sep">–</span>
                  </>}
                  <span className="p50-side-count red">{redCount}</span>)
                </span>
              </div>
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
      <BanRateCard blueBans={blueBans || []} redBans={redBans || []} />

      {/* ═══════ PEAK KILLS ═══════ */}
      <PlayerRankingCard
        cardId="peak-kills"
        title="PEAK KILLS"
        data={topKills || []}
        league={league}
        rowIcon="champion"
        valueOf={(p) => p.max_kills || 0}
      />

      {/* ═══════ AVG FARMING ═══════ */}
      <PlayerRankingCard
        cardId="farming"
        title="AVG FARMING"
        data={topCS || []}
        league={league}
        rowIcon="team"
        valueOf={(p) => p.avg_cspm || 0}
        decimals={1}
      />

      {/* ═══════ KDA RATIO ═══════ */}
      <PlayerRankingCard
        cardId="kda"
        title="KDA RATIO"
        data={topKDAPlayers || []}
        league={league}
        rowIcon="team"
        valueOf={(p) => p.kda || 0}
        decimals={1}
      />

      {/* ═══════ PLAYER PERFORMANCE ═══════ */}
      <PlayerPerformanceCard
        topKillParticipation={topKillParticipation || []}
        topDamageShare={topDamageShare || []}
        topGoldShare={topGoldShare || []}
        league={league}
      />

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
      <ExpandableCard cardId="team-perf" expandedClassName="p50-expanded-split3">
        {(isExpanded) => (<>
          <div className="p50-card-head"><span className="p50-card-title">TEAM PERFORMANCE</span></div>
          <div className="p50-card-body">
            <div className="p50-sections">
              <div className="p50-section">
                <div className="p50-section-title">KILLS / GAME</div>
                {(topKillsPerGame || []).slice(0, isExpanded ? undefined : 3).map((tm, i) => (
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
                {(topDeathsPerGame || []).slice(0, isExpanded ? undefined : 3).map((tm, i) => (
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
                {(topDragonsPerGame || []).slice(0, isExpanded ? undefined : 3).map((tm, i) => (
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
        </>)}
      </ExpandableCard>

      </ExpandableGrid>
    </div>
  );
}
