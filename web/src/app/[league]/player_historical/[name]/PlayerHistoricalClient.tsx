'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { teamImg, ROLE_ICON, FLAG_ICON } from '@/lib/constants';
import { clientFetch } from '@/lib/clientFetch';
import { getLeagueColors } from '@/lib/leagueColors';
import { MatchDetail } from '../../record/RecordClient';

/* ══════════════════════════════════════════════════════════════
   Player Historical — Client Component
   Full client-side data fetching (single endpoint)
   ══════════════════════════════════════════════════════════════ */

/* ── Helpers ──────────────────────────────────────────────── */
const rnd = (v: number, d = 1): number => Math.round(v * 10 ** d) / 10 ** d;
const fmt = (v: number | null | undefined, d = 1): string =>
  v != null ? Number(v).toFixed(d) : '—';
const pct = (v: number | null | undefined): string =>
  v != null ? `${Number(v).toFixed(1)}%` : '—';

const kdaClass = (kda: number | null | undefined): string => {
  if (kda == null) return '';
  if (kda >= 5) return 'p70-kda-gold';
  if (kda >= 4) return 'p70-kda-green';
  if (kda >= 2.5) return 'p70-kda-gray';
  return 'p70-kda-red';
};

const wrClass = (wr: number | null | undefined): string => {
  if (wr == null) return '';
  if (wr >= 50) return 'p70-val-win';
  if (wr >= 40) return 'p70-val-wr40';
  return 'p70-val-loss';
};

const ROLE_LABEL: Record<string, string> = {
  top: 'TOP', jun: 'JNG', jungle: 'JNG', jng: 'JNG',
  mid: 'MID', adc: 'ADC', bot: 'BOT', sup: 'SUP', support: 'SUP',
};

/* ── Interfaces ───────────────────────────────────────────── */
interface PlayerSplitSummary {
  serie_id?: number;
  league: string;
  year: number;
  split: string;
  games: number;
  wins: number;
  losses: number;
  win_rate: number;
  placement?: number | null;
  team?: string;
  team_abbr?: string;
  team_logo?: string;
}

interface ProfileData {
  name: string;
  image_url?: string;
  role?: string;
  current_team_abbr?: string;
  current_team_logo?: string;
  current_team?: string;
  nationality?: string;
  career_games?: number;
  career_wins?: number;
  career_losses?: number;
  career_wr?: number;
  career_kda?: number;
  career_avg_kills?: number;
  career_avg_deaths?: number;
  career_avg_assists?: number;
  seasons_played?: number;
  unique_champions?: number;
  primary_league?: { slug: string; name: string } | null;
  international?: Array<{ league: string; appearances: number; best_placement: number | null; best_year: number | null }>;
  best_split?: PlayerSplitSummary | null;
  worst_split?: PlayerSplitSummary | null;
  [key: string]: unknown;
}

interface MatchLogEntry {
  result?: string;
  win?: boolean;
  champion?: string | { name?: string; image_url?: string };
  opponent?: string | { name?: string; abbr?: string; logo?: string };
  kills?: number;
  deaths?: number;
  assists?: number;
  kda?: number;
  cspm?: number;
  dpm?: number;
  gpm?: number;
  side?: string;
  match_id?: number;
  game_id?: number | string;
  date?: string;
  runes?: { keystone?: string; keystone_img?: string; secondary_path?: string; secondary_path_img?: string };
  spells?: { name?: string; image_url?: string }[];
  items?: { name?: string; image_url?: string; is_trinket?: boolean }[];
  [key: string]: unknown;
}

interface CareerSeason {
  serie_id?: number;
  year: number;
  split: string;
  league: string;
  team_abbr: string;
  team_logo?: string;
  games: number;
  wins: number;
  losses: number;
  win_rate?: number;
  kda?: number;
  avg_kills?: number;
  avg_deaths?: number;
  avg_assists?: number;
  avg_cspm?: number;
  avg_dpm?: number;
  avg_gpm?: number;
  kill_participation?: number;
  avg_damage_share?: number;
  avg_gold_share?: number;
  unique_champions?: number;
  placement?: number;
  is_winner?: boolean;
  match_log?: MatchLogEntry[];
  [key: string]: unknown;
}

interface ChampionPoolEntry {
  name: string;
  image_url?: string;
  games: number;
  wins: number;
  win_rate?: number;
  kda?: number;
  avg_kills?: number;
  avg_deaths?: number;
  avg_assists?: number;
}

interface PlayerHistoryData {
  profile: ProfileData;
  career: CareerSeason[];
  allChampions: ChampionPoolEntry[];
  recentGames?: unknown[];
}

/* ══════════════════════════════════════════════════════════════
   MAIN COMPONENT
   ══════════════════════════════════════════════════════════════ */

interface Props {
  league: string;
  name: string;
  accent: string;
  glow: string;
}

export default function PlayerHistoricalClient({ league, name, accent, glow }: Props) {
  const router = useRouter();

  const [data, setData] = useState<PlayerHistoryData | null>(null);
  const [champOpen, setChampOpen] = useState(false);
  const [trophyOpen, setTrophyOpen] = useState(false);
  const [careerOpen, setCareerOpen] = useState(false);
  const [matchupsOpen, setMatchupsOpen] = useState(false);
  const [matchupsSortKey, setMatchupsSortKey] = useState<'games' | 'wins' | 'losses' | 'wr' | 'name'>('wr');
  const [matchupsSortDir, setMatchupsSortDir] = useState<'asc' | 'desc'>('desc');
  const toggleMatchupsSort = (key: 'games' | 'wins' | 'losses' | 'wr' | 'name') => {
    if (matchupsSortKey === key) {
      setMatchupsSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setMatchupsSortKey(key);
      setMatchupsSortDir(key === 'name' ? 'asc' : 'desc');
    }
  };
  const [champSortKey, setChampSortKey] = useState<'games' | 'wins' | 'win_rate' | 'kda' | 'name'>('games');
  const [champSortDir, setChampSortDir] = useState<'asc' | 'desc'>('desc');
  const toggleChampSort = (key: 'games' | 'wins' | 'win_rate' | 'kda' | 'name') => {
    if (champSortKey === key) {
      setChampSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setChampSortKey(key);
      setChampSortDir(key === 'name' ? 'asc' : 'desc');
    }
  };
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedSeasons, setExpandedSeasons] = useState<Set<string>>(new Set());
  const [expandedMatchId, setExpandedMatchId] = useState<string | number | null>(null);

  const toggleSeason = (key: string) => {
    setExpandedSeasons(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
    setExpandedMatchId(null);
  };

  const toggleMatch = (matchId: string | number) => {
    setExpandedMatchId(prev => prev === matchId ? null : matchId);
  };

  useEffect(() => {
    if (!name || !league) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const d = await clientFetch<PlayerHistoryData>(`/api/v1/pg/player-history/${encodeURIComponent(name)}?league=${league.toUpperCase()}`);
        if (!d) throw new Error('Player not found');
        if (!cancelled) setData(d);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Error');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [name, league]);

  if (loading) {
    return (
      <div className="p70-container" style={{ '--nav-accent': accent } as React.CSSProperties}>
        <div className="p70-loading">
          <div className="p70-spinner" />
          <span className="p70-loading-text">CARGANDO HISTORIAL...</span>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p70-container">
        <div className="p70-error">
          <p>No se encontró el historial del jugador.</p>
          {error && <p style={{ fontSize: '11px', color: '#f87171', marginTop: 8 }}>{error}</p>}
        </div>
      </div>
    );
  }

  const { profile, career, allChampions } = data;

  // Accent dinámico desde primary_league del backend
  const primarySlug = profile.primary_league?.slug;
  const dyn = primarySlug ? getLeagueColors(primarySlug) : { accent, glow };

  return (
    <div
      className="p70-container th-page"
      style={{
        '--nav-accent': dyn.accent,
        '--nav-glow': dyn.glow,
        '--p2-league-accent': dyn.accent,
      } as React.CSSProperties}
    >

      {/* ═══════════ HERO IDENTITY (editorial, siempre visible) ═══════════ */}
      <section className="th-section">
        <div className="th-ed-card">
          {/* Watermark del logo del equipo actual */}
          {profile.current_team_logo && (
            <Image
              src={profile.current_team_logo}
              alt=""
              aria-hidden
              className="th-ed-watermark"
              width={240}
              height={240}
            />
          )}

          <div className="th-ed-card-header">
            <div className="th-hero-layout">
              <div>
                {profile.image_url ? (
                  <Image
                    src={profile.image_url}
                    alt={profile.name}
                    className="th-hero-logo"
                    width={192}
                    height={192}
                    style={{ borderRadius: '50%', border: '2px solid var(--border-card)', objectFit: 'cover' }}
                    unoptimized
                  />
                ) : (
                  <div className="th-hero-logo" style={{ borderRadius: '50%', background: 'var(--surface-inset)' }} />
                )}
              </div>

              <div>
                <span className="th-ed-eyebrow">Player History</span>
                <h1 className="th-ed-hero-name">{profile.name}</h1>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                  {profile.role && (
                    <span className="ph-hero-role-badge">
                      <Image src={ROLE_ICON(profile.role)} alt={profile.role} width={48} height={48} />
                      {ROLE_LABEL[profile.role?.toLowerCase()] ?? profile.role?.toUpperCase()}
                    </span>
                  )}
                  {profile.nationality && (
                    <span className="ph-hero-role-badge">
                      <Image src={FLAG_ICON(profile.nationality as string)} alt={profile.nationality} width={48} height={32} style={{ width: 18, height: 12, objectFit: 'cover' }} />
                      {profile.nationality as string}
                    </span>
                  )}
                </div>
              </div>

              <div className="th-hero-meta">
                {profile.current_team_abbr && (
                  <div className="ph-hero-current-team">
                    <Image
                      src={teamImg(profile.current_team_logo, profile.current_team_abbr, league)}
                      alt={profile.current_team_abbr}
                      width={56}
                      height={56}
                    />
                    <span>{profile.current_team_abbr}</span>
                  </div>
                )}
                <div className="th-ed-meta">
                  <span>{profile.seasons_played ?? 0} {profile.seasons_played === 1 ? 'SEASON' : 'SEASONS'}</span>
                  <span className="pipe">·</span>
                  <span>{profile.unique_champions ?? 0} CHAMPIONS</span>
                </div>
              </div>
            </div>
          </div>

          <div className="th-hero-kpi-strip ph-hero-kpi-5">
            <div className="th-hero-kpi">
              <span className="th-hero-kpi-label">Career Games</span>
              <span className="th-hero-kpi-value">{profile.career_games ?? 0}</span>
            </div>
            <div className="th-hero-kpi">
              <span className="th-hero-kpi-label">Win Rate</span>
              <span className={`th-hero-kpi-value ${wrClass(profile.career_wr)}`}>{pct(profile.career_wr)}</span>
            </div>
            <div className="th-hero-kpi">
              <span className="th-hero-kpi-label">KDA</span>
              <span className={`th-hero-kpi-value ${kdaClass(profile.career_kda)}`}>{fmt(profile.career_kda)}</span>
            </div>
            <div className="th-hero-kpi">
              <span className="th-hero-kpi-label">Record</span>
              <span className="th-hero-kpi-value">
                <span style={{ color: 'var(--clr-win)' }}>{profile.career_wins ?? 0}</span>
                <span style={{ color: 'var(--text-muted)', margin: '0 4px' }}>/</span>
                <span style={{ color: 'var(--clr-loss)' }}>{profile.career_losses ?? 0}</span>
              </span>
            </div>
            <div className="th-hero-kpi">
              <span className="th-hero-kpi-label">Champion Pool</span>
              <span className="th-hero-kpi-value">{profile.unique_champions ?? allChampions.length ?? 0}</span>
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════ FILA DE 3 CARDS COMPACTAS ═══════════ */}
      <section className="th-section">
        <div className="th-grid-3">

          {/* CAREER STATS */}
          <div className="th-ed-card compact">
            <div className="th-ed-card-header">
              <div className="th-card-headline">
                <span className="th-card-eyebrow">Metrics</span>
                <h3 className="th-card-title">Career Stats</h3>
              </div>
            </div>
            <div className="th-ed-column">
              {(() => {
                const totG = profile.career_games || 0;
                const wAvg = (key: keyof CareerSeason) => totG > 0
                  ? career.reduce((s, c) => s + ((Number(c[key] as number) || 0) * c.games), 0) / totG
                  : 0;
                const stats = [
                  { label: 'WIN RATE',     value: pct(profile.career_wr),                 bar: profile.career_wr || 0 },
                  { label: 'KDA',          value: fmt(profile.career_kda),                bar: Math.min((profile.career_kda || 0) * 20, 100) },
                  { label: 'AVG KILLS',    value: fmt(profile.career_avg_kills),          bar: Math.min((profile.career_avg_kills || 0) * 12, 100) },
                  { label: 'AVG DEATHS',   value: fmt(profile.career_avg_deaths),         bar: Math.min((profile.career_avg_deaths || 0) * 12, 100) },
                  { label: 'AVG ASSISTS',  value: fmt(profile.career_avg_assists),        bar: Math.min((profile.career_avg_assists || 0) * 7, 100) },
                  { label: 'CS / MIN',     value: fmt(wAvg('avg_cspm'), 2),               bar: Math.min(wAvg('avg_cspm') * 10, 100) },
                  { label: 'DPM',          value: fmt(wAvg('avg_dpm'), 0),                bar: Math.min(wAvg('avg_dpm') / 8, 100) },
                  { label: 'KP%',          value: pct(wAvg('kill_participation') * 100),  bar: Math.min(wAvg('kill_participation') * 100, 100) },
                ];
                return (
                  <div className="th-stats-grid-v2">
                    {stats.map(s => (
                      <div className="th-stat-row-v2" key={s.label}>
                        <span className="th-stat-label-v2">{s.label}</span>
                        <span className="th-stat-value-v2">{s.value}</span>
                        <div className="th-stat-bar-v2"><span style={{ width: `${s.bar}%` }} /></div>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>
          </div>

          {/* INTERNATIONAL */}
          <div className="th-ed-card compact">
            <div className="th-ed-card-header">
              <div className="th-card-headline">
                <span className="th-card-eyebrow">International</span>
                <h3 className="th-card-title">Mundiales y MSI</h3>
              </div>
            </div>
            <div className="th-ed-column">
              {(profile.international && profile.international.length > 0) ? (
                <div className="th-intl-list-v2">
                  {profile.international.map((intl) => (
                    <div key={intl.league} className="th-intl-row-v2">
                      <span className="th-intl-count-v2">{intl.appearances}</span>
                      <div className="th-intl-info-v2">
                        <span className="th-intl-name-v2">{intl.league}</span>
                        {intl.best_placement != null ? (
                          <span className="th-intl-best-v2">
                            BEST <strong>{intl.best_placement}°</strong>{intl.best_year && ` · ${intl.best_year}`}
                          </span>
                        ) : (
                          <span className="th-intl-best-v2">{intl.appearances === 1 ? 'APPEARANCE' : 'APPEARANCES'}</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="th-intl-empty-v2">No international appearances yet</div>
              )}
            </div>
          </div>

          {/* BEST & WORST SPLIT */}
          <div className="th-ed-card compact">
            <div className="th-ed-card-header">
              <div className="th-card-headline">
                <span className="th-card-eyebrow">Extremes</span>
                <h3 className="th-card-title">Best & Worst Split</h3>
              </div>
            </div>
            <div className="th-ed-column">
              {profile.best_split ? (
                <div className="th-bwsplit-grid">
                  <div className="th-bwsplit-cell">
                    <span className="th-bwsplit-label best">BEST</span>
                    <span className="th-bwsplit-wr best">{pct(profile.best_split.win_rate)}</span>
                    <span className="th-bwsplit-context">
                      {profile.best_split.team_abbr || profile.best_split.team || profile.best_split.league} · {profile.best_split.year}
                    </span>
                    <span className="th-bwsplit-context">
                      {profile.best_split.wins}W – {profile.best_split.losses}L
                    </span>
                  </div>
                  {profile.worst_split && (
                    <>
                      <div className="th-bwsplit-divider" />
                      <div className="th-bwsplit-cell">
                        <span className="th-bwsplit-label worst">WORST</span>
                        <span className="th-bwsplit-wr worst">{pct(profile.worst_split.win_rate)}</span>
                        <span className="th-bwsplit-context">
                          {profile.worst_split.team_abbr || profile.worst_split.team || profile.worst_split.league} · {profile.worst_split.year}
                        </span>
                        <span className="th-bwsplit-context">
                          {profile.worst_split.wins}W – {profile.worst_split.losses}L
                        </span>
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <div className="th-intl-empty-v2">Not enough data</div>
              )}
            </div>
          </div>

        </div>
      </section>

      {/* ═══════════ SIGNATURE CHAMPIONS (top 5, full-width) ═══════════ */}
      {allChampions.length > 0 && (() => {
        const top5 = [...allChampions]
          .sort((a, b) => (b.games || 0) - (a.games || 0))
          .slice(0, 5);
        return (
          <section className="th-section">
            <div className="th-ed-card">
              <div className="th-ed-card-header">
                <div className="th-card-headline">
                  <span className="th-card-eyebrow">Signature Champions</span>
                  <h3 className="th-card-title">Top 5 Más Jugados</h3>
                </div>
              </div>

              <div className="ph-champ-grid">
                {top5.map((c, i) => (
                  <div key={`${c.name}-${i}`} className="ph-champ-card"
                    onClick={() => router.push(`/${league}/champion_historical/${encodeURIComponent(c.name)}`)}
                  >
                    {c.image_url ? (
                      <Image
                        src={c.image_url}
                        alt={c.name}
                        className="ph-champ-photo"
                        width={128}
                        height={128}
                      />
                    ) : (
                      <div className="ph-champ-photo" />
                    )}
                    <span className="ph-champ-name">{c.name}</span>
                    <div className="ph-champ-stats">
                      <span className={`ph-champ-wr ${wrClass(c.win_rate)}`}>{pct(c.win_rate)}</span>
                      <div className="ph-champ-record">
                        <span className="w">{c.wins}W</span>
                        <span className="l">{(c.games ?? 0) - (c.wins ?? 0)}L</span>
                      </div>
                      <span>KDA {fmt(c.kda)}</span>
                    </div>
                  </div>
                ))}
              </div>

            </div>
          </section>
        );
      })()}



      {/* ═══════════ TEAMS TIMELINE (cronológico) ═══════════ */}
      {career.length > 0 && (() => {
        // Agrupar career por equipo consecutivo (stints): si el jugador volvió,
        // se generan chips separados por stint cronológico.
        const sortedAsc = [...career].sort(
          (a, b) => (a.year - b.year) || (a.serie_id ?? 0) - (b.serie_id ?? 0)
        );
        type Stint = {
          team: string; logo?: string; first: { year: number; split: string };
          last: { year: number; split: string }; games: number; wins: number; losses: number;
        };
        const stints: Stint[] = [];
        for (const s of sortedAsc) {
          // Saltar splits sin equipo (datos huérfanos en BD)
          // Saltar splits sin equipo válido (datos huérfanos: null, vacío, "—", solo símbolos)
          const ta = (s.team_abbr || '').trim();
          if (!ta || ta === '—' || ta === '-' || !/[a-z0-9]/i.test(ta)) continue;
          const last = stints[stints.length - 1];
          const sameTeam = last && last.team === s.team_abbr;
          if (sameTeam) {
            last.last = { year: s.year, split: s.split };
            last.games += s.games || 0;
            last.wins  += s.wins  || 0;
            last.losses += s.losses || 0;
          } else {
            stints.push({
              team: s.team_abbr,
              logo: s.team_logo,
              first: { year: s.year, split: s.split },
              last:  { year: s.year, split: s.split },
              games: s.games || 0,
              wins:  s.wins  || 0,
              losses: s.losses || 0,
            });
          }
        }
        // Cronológico izquierda→derecha (más antiguo primero)

        return (
          <section className="th-section">
            <div className="th-ed-card">
              <div className="th-ed-card-header">
                <div className="th-card-headline">
                  <span className="th-card-eyebrow">Teams Timeline</span>
                  <h3 className="th-card-title">Trayectoria por Equipos</h3>
                </div>
                <span className="th-career-summary">
                  {stints.length} {stints.length === 1 ? 'STINT' : 'STINTS'}
                </span>
              </div>
              <div className="ph-teams-wrap">
                <div className="ph-teams-line">
                  {stints.map((st, i) => {
                    const periodSame = st.first.year === st.last.year && st.first.split === st.last.split;
                    const period = periodSame
                      ? `${st.first.year} ${st.first.split}`
                      : `${st.first.year} ${st.first.split} – ${st.last.year} ${st.last.split}`;
                    return (
                      <React.Fragment key={`${st.team}-${i}`}>
                        <div
                          className="ph-team-chip"
                          onClick={() => router.push(`/${league}/team_historical/${encodeURIComponent(st.team)}`)}
                        >
                          {st.logo && (
                            <Image
                              src={st.logo}
                              alt={st.team}
                              className="ph-team-chip-logo"
                              width={64}
                              height={64}
                              onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                            />
                          )}
                          <div className="ph-team-chip-info">
                            <span className="ph-team-chip-abbr">{st.team}</span>
                            <span className="ph-team-chip-period">{period}</span>
                          </div>
                        </div>
                        {i < stints.length - 1 && <span className="ph-team-arrow">›</span>}
                      </React.Fragment>
                    );
                  })}
                </div>
              </div>
            </div>
          </section>
        );
      })()}



      {/* ═══════════ MATCHUPS POR EQUIPO (colapsable, sortable) ═══════════ */}
      {career.length > 0 && (() => {
        // Agregar todos los matches por oponente (BO match-level)
        const oppMap: Record<string, { abbr: string; name?: string; logo?: string; games: number; wins: number; losses: number; wr: number }> = {};
        for (const s of career) {
          for (const m of (s.match_log || [])) {
            const op = m.opponent;
            const abbr = typeof op === 'string'
              ? op
              : (op as { abbr?: string; name?: string })?.abbr || (op as { name?: string })?.name || '—';
            if (!abbr || abbr === '—') continue;
            const opObj = typeof op === 'object' ? op as { name?: string; logo?: string } : null;
            if (!oppMap[abbr]) {
              oppMap[abbr] = { abbr, name: opObj?.name, logo: opObj?.logo, games: 0, wins: 0, losses: 0, wr: 0 };
            }
            oppMap[abbr].games++;
            if (m.result === 'W') oppMap[abbr].wins++;
            else oppMap[abbr].losses++;
          }
        }
        const matchups = Object.values(oppMap).map(o => ({
          ...o,
          wr: o.games > 0 ? rnd(o.wins / o.games * 100, 1) : 0,
        }));
        if (matchups.length === 0) return null;

        type MatchupRow = typeof matchups[number];
        const sorted = [...matchups].sort((a: MatchupRow, b: MatchupRow) => {
          const dir = matchupsSortDir === 'asc' ? 1 : -1;
          if (matchupsSortKey === 'name') return (a.abbr || '').localeCompare(b.abbr || '') * dir;
          const av = (a as MatchupRow & Record<string, number>)[matchupsSortKey] ?? 0;
          const bv = (b as MatchupRow & Record<string, number>)[matchupsSortKey] ?? 0;
          if (av !== bv) return (av - bv) * dir;
          return (b.wins ?? 0) - (a.wins ?? 0);
        });
        const sortClass = (key: typeof matchupsSortKey) => matchupsSortKey === key ? `sort-${matchupsSortDir}` : '';

        return (
          <section className="th-section">
            <div className="th-ed-card">
              <div className="th-ed-card-header th-career-toggle" onClick={() => setMatchupsOpen(o => !o)}>
                <div className="th-card-headline">
                  <span className="th-card-eyebrow">Matchups</span>
                  <h3 className="th-card-title">Matchups por Equipo</h3>
                </div>
                <span className="th-career-summary">
                  {matchups.length} {matchups.length === 1 ? 'OPPONENT' : 'OPPONENTS'}
                </span>
                <svg
                  className={`th-career-chevron ${matchupsOpen ? 'open' : ''}`}
                  viewBox="0 0 12 12"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <path d="M4 2l4 4-4 4" />
                </svg>
              </div>
              <div className={`th-career-body ${matchupsOpen ? 'open' : ''}`}>
                <div style={{ overflowX: 'auto' }}>
                  <table className="th-h2h-table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th onClick={() => toggleMatchupsSort('name')} className={sortClass('name')}>Team</th>
                        <th className="numeric"></th>
                        <th onClick={() => toggleMatchupsSort('games')} className={`numeric ${sortClass('games')}`}>G</th>
                        <th onClick={() => toggleMatchupsSort('wins')} className={`numeric ${sortClass('wins')}`}>W</th>
                        <th onClick={() => toggleMatchupsSort('losses')} className={`numeric ${sortClass('losses')}`}>L</th>
                        <th onClick={() => toggleMatchupsSort('wr')} className={`numeric ${sortClass('wr')}`}>WR%</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sorted.map((m, i) => (
                        <tr
                          key={m.abbr}
                          onClick={() => router.push(`/${league}/team_historical/${encodeURIComponent(m.name || m.abbr)}`)}
                        >
                          <td className="th-h2h-rank">{String(i + 1).padStart(2, '0')}</td>
                          <td>
                            <div className="th-h2h-team-cell">
                              {m.logo && (
                                <Image
                                  src={m.logo}
                                  alt={m.abbr}
                                  className="th-h2h-team-logo"
                                  width={56}
                                  height={56}
                                  onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                                />
                              )}
                              <div className="th-h2h-team-name">
                                <span className="th-h2h-abbr">{m.abbr}</span>
                                {m.name && m.name !== m.abbr && <span className="th-h2h-fullname">{m.name}</span>}
                              </div>
                            </div>
                          </td>
                          <td className="th-h2h-bar-cell">
                            <div className="th-h2h-bar">
                              <div className="th-h2h-bar-wins" style={{ width: `${m.wr ?? 0}%` }} />
                            </div>
                          </td>
                          <td className="numeric">{m.games}</td>
                          <td className="numeric" style={{ color: 'var(--clr-win)' }}>{m.wins}</td>
                          <td className="numeric" style={{ color: 'var(--clr-loss)' }}>{m.losses}</td>
                          <td className={`numeric ${wrClass(m.wr)}`}>{pct(m.wr)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </section>
        );
      })()}

            {/* ═══════════ CAREER TIMELINE (colapsable) ═══════════ */}
      {career.length > 0 && (() => {
        const totalGames = career.reduce((s, c) => s + (c.games || 0), 0);
        const podiums = career.filter(c => [1, 2, 3].includes(c.placement || 0)).length;
        return (
          <section className="th-section">
            <div className="th-ed-card">
              <div className="th-ed-card-header th-career-toggle" onClick={() => setCareerOpen(o => !o)}>
                <div className="th-card-headline">
                  <span className="th-card-eyebrow">Career</span>
                  <h3 className="th-card-title">Trayectoria por Temporada</h3>
                </div>
                <span className="th-career-summary">
                  {career.length} SPLITS · {totalGames} GAMES · {podiums} PODIUM{podiums === 1 ? '' : 'S'}
                </span>
                <svg
                  className={`th-career-chevron ${careerOpen ? 'open' : ''}`}
                  viewBox="0 0 12 12"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <path d="M4 2l4 4-4 4" />
                </svg>
              </div>
              <div className={`th-career-body ${careerOpen ? 'open' : ''}`}>
                <div className="p70-table-wrap" style={{ borderRadius: 0 }}>
          <table className="p70-table">
            <thead>
              <tr>
                <th style={{ width: 20 }}></th>
                <th>Temporada</th>
                <th>Liga</th>
                <th>Equipo</th>
                <th className="center">G</th>
                <th className="center">W</th>
                <th className="center">L</th>
                <th className="center">WR%</th>
                <th className="center">KDA</th>
                <th className="center">K</th>
                <th className="center">D</th>
                <th className="center">A</th>
                <th className="center">CS/M</th>
                <th className="center">DPM</th>
                <th className="center">GPM</th>
                <th className="center">KP%</th>
                <th className="center">DMG%</th>
                <th className="center">GOLD%</th>
                <th className="center">CHAMPS</th>
              </tr>
            </thead>
            <tbody>
              {career.map((s, i) => {
                const seasonKey = `${s.serie_id}-${i}`;
                const isExpanded = expandedSeasons.has(seasonKey);
                const matchLog = s.match_log ?? [];
                return (
                  <React.Fragment key={seasonKey}>
                    <tr
                      className={`p70-season-row ${isExpanded ? 'expanded' : ''} ${matchLog.length ? 'clickable' : ''}`}
                      onClick={() => matchLog.length > 0 && toggleSeason(seasonKey)}
                    >
                      <td className="center p70-expand-chevron-cell">
                        {matchLog.length > 0 && (
                          <svg className={`p70-expand-chevron ${isExpanded ? 'open' : ''}`}
                            width="10" height="6" viewBox="0 0 10 6" fill="none" stroke="currentColor"
                            strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M1 1L5 5L9 1" />
                          </svg>
                        )}
                      </td>
                      <td style={{ color: 'white', fontFamily: 'Inter, system-ui', fontWeight: 700 }}>
                        {s.year} · {s.split}
                      </td>
                      <td style={{ fontFamily: 'Inter, system-ui', fontWeight: 600, color: 'var(--p70-accent)', fontSize: '10px', letterSpacing: '0.5px' }}>
                        {s.league}
                      </td>
                      <td>
                        <div className="p70-team-cell">
                          {s.team_logo && (
                            <Image src={s.team_logo} alt={s.team_abbr} onError={e => (e.target as HTMLImageElement).style.display = 'none'} width={48} height={48} />
                          )}
                          {s.team_abbr}
                        </div>
                      </td>
                      <td className="center">{s.games}</td>
                      <td className="center p70-val-win">{s.wins}</td>
                      <td className="center p70-val-loss">{s.losses}</td>
                      <td className={`center ${wrClass(s.win_rate)}`}>{pct(s.win_rate)}</td>
                      <td className={`center ${kdaClass(s.kda)}`}>{fmt(s.kda)}</td>
                      <td className="center">{fmt(s.avg_kills)}</td>
                      <td className="center">{fmt(s.avg_deaths)}</td>
                      <td className="center">{fmt(s.avg_assists)}</td>
                      <td className="center">{fmt(s.avg_cspm)}</td>
                      <td className="center">{fmt(s.avg_dpm, 0)}</td>
                      <td className="center">{fmt(s.avg_gpm, 0)}</td>
                      <td className="center">{pct(s.kill_participation)}</td>
                      <td className="center">{pct(s.avg_damage_share)}</td>
                      <td className="center">{pct(s.avg_gold_share)}</td>
                      <td className="center" style={{ color: 'var(--p70-accent)' }}>{s.unique_champions}</td>
                    </tr>
                    {isExpanded && matchLog.length > 0 && (
                      <tr className="p70-match-detail-row">
                        <td colSpan={19}>
                          <div className="p70-match-detail-container">
                            <table className="p70-match-detail-table">
                              <thead>
                                <tr>
                                  <th className="center">Res</th>
                                  <th>Campeón</th>
                                  <th className="center">Lado</th>
                                  <th>VS</th>
                                  <th className="center">K/D/A</th>
                                  <th className="center">KDA</th>
                                  <th className="center">CS/M</th>
                                  <th className="center">DPM</th>
                                  <th className="center">GPM</th>
                                  <th className="center">Runas</th>
                                  <th className="center">Spells</th>
                                  <th>Items</th>
                                  <th className="center">Fecha</th>
                                </tr>
                              </thead>
                              <tbody>
                                {matchLog.map((g, gi) => {
                                  const isWin = g.result === 'W' || g.result === 'win' || g.win === true;
                                  const champ = g.champion;
                                  const champName = typeof champ === 'string' ? champ : (champ as { name?: string })?.name ?? '—';
                                  const champImgUrl = typeof champ === 'object' ? (champ as { image_url?: string })?.image_url : null;
                                  const kda = g.kda ?? ((g.deaths ?? 0) > 0 ? (((g.kills ?? 0) + (g.assists ?? 0)) / (g.deaths ?? 1)) : ((g.kills ?? 0) + (g.assists ?? 0)));
                                  const opponent = g.opponent;
                                  const opName = typeof opponent === 'string' ? opponent : (opponent as { name?: string; abbr?: string })?.name ?? (opponent as { abbr?: string })?.abbr ?? '—';
                                  const opLogo = typeof opponent === 'object' ? (opponent as { logo?: string })?.logo : null;
                                  const date = g.date ? new Date(g.date).toLocaleDateString('es-ES', { day: '2-digit', month: 'short' }) : '—';
                                  const side = g.side;
                                  const mId = g.match_id;
                                  const rowKey = g.game_id ?? `gd-${gi}`;
                                  const isMatchOpen = expandedMatchId === rowKey;

                                  return (
                                    <React.Fragment key={rowKey}>
                                      <tr
                                        className={`${isWin ? 'p70-detail-win' : 'p70-detail-loss'} ${mId ? 'p70-game-row-clickable' : ''} ${isMatchOpen ? 'p70-game-row-active' : ''}`}
                                        onClick={() => mId && toggleMatch(rowKey)}
                                      >
                                        <td className="center">
                                          <span className={`p70-match-result ${isWin ? 'win' : 'loss'}`}>
                                            {isWin ? 'W' : 'L'}
                                          </span>
                                        </td>
                                        <td>
                                          <div className="p70-champ-cell">
                                            {champImgUrl && (
                                              <Image
                                                src={champImgUrl}
                                                alt={champName}
                                                onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                                                width={64}
                                                height={64}
                                              />
                                            )}
                                            <span style={{ color: 'white', fontFamily: 'Inter, system-ui', fontWeight: 600, fontSize: '11px' }}>{champName}</span>
                                          </div>
                                        </td>
                                        <td className="center">
                                          {side && (
                                            <span className={`p70-side-badge ${side}`}>
                                              {side === 'blue' ? 'B' : 'R'}
                                            </span>
                                          )}
                                        </td>
                                        <td>
                                          <div className="p70-opponent-cell">
                                            {opLogo && (
                                              <Image src={opLogo} alt={opName} onError={e => (e.target as HTMLImageElement).style.display = 'none'} width={48} height={48} />
                                            )}
                                            <span>{opName}</span>
                                          </div>
                                        </td>
                                        <td className="center" style={{ fontWeight: 600, fontSize: '11px' }}>
                                          {g.kills ?? 0}/{g.deaths ?? 0}/{g.assists ?? 0}
                                        </td>
                                        <td className={`center ${kdaClass(kda)}`} style={{ fontWeight: 700 }}>{fmt(kda)}</td>
                                        <td className="center">{fmt(g.cspm)}</td>
                                        <td className="center">{fmt(g.dpm, 0)}</td>
                                        <td className="center">{fmt(g.gpm, 0)}</td>
                                        <td className="center">
                                          <div className="p70-detail-runes">
                                            {g.runes?.keystone_img && (
                                              <Image src={g.runes.keystone_img} alt={g.runes?.keystone ?? ''} className="p70-detail-rune-icon" title={g.runes?.keystone ?? ''} width={48} height={48} />
                                            )}
                                            {g.runes?.secondary_path_img && (
                                              <Image src={g.runes.secondary_path_img} alt={g.runes?.secondary_path ?? ''} className="p70-detail-rune-secondary" title={g.runes?.secondary_path ?? ''} width={48} height={48} />
                                            )}
                                          </div>
                                        </td>
                                        <td className="center">
                                          <div className="p70-detail-spells">
                                            {(g.spells ?? []).slice(0, 2).map((sp, j) => (
                                              <Image key={j} src={sp.image_url ?? ''} alt={sp.name ?? ''} className="p70-detail-spell-icon" width={48} height={48}
                                                title={sp.name ?? ''} onError={e => (e.target as HTMLImageElement).style.display = 'none'} />
                                            ))}
                                          </div>
                                        </td>
                                        <td>
                                          <div className="p70-detail-items">
                                            {(g.items ?? []).filter(it => !it.is_trinket).slice(0, 6).map((it, j) => (
                                              <Image key={j} src={it.image_url ?? ''} alt={it.name ?? ''} className="p70-detail-item-icon" width={48} height={48}
                                                title={it.name ?? ''} onError={e => (e.target as HTMLImageElement).style.display = 'none'} />
                                            ))}
                                          </div>
                                        </td>
                                        <td className="center" style={{ fontSize: '10px', color: 'var(--p70-muted)' }}>{date}</td>
                                      </tr>
                                      {isMatchOpen && mId && (
                                        <tr className="p70-full-match-row">
                                          <td colSpan={13}>
                                            <div className="p70-full-match-container">
                                              <MatchDetail matchId={mId} />
                                            </div>
                                          </td>
                                        </tr>
                                      )}
                                    </React.Fragment>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
              </div>
            </div>
          </section>
        );
      })()}

      {/* ═══════════ CHAMPION MASTERY (colapsable, sortable) ═══════════ */}
      {allChampions.length > 0 && (() => {
        type ChampRow = typeof allChampions[number];
        const sorted = [...allChampions].sort((a, b) => {
          const dir = champSortDir === 'asc' ? 1 : -1;
          if (champSortKey === 'name') return (a.name || '').localeCompare(b.name || '') * dir;
          const av = (a as ChampRow & Record<string, number>)[champSortKey] ?? 0;
          const bv = (b as ChampRow & Record<string, number>)[champSortKey] ?? 0;
          if (av !== bv) return (av - bv) * dir;
          return (b.games ?? 0) - (a.games ?? 0);
        });
        const sortClass = (key: typeof champSortKey) => champSortKey === key ? `sort-${champSortDir}` : '';
        return (
          <section className="th-section">
            <div className="th-ed-card">
              <div className="th-ed-card-header th-career-toggle" onClick={() => setChampOpen(o => !o)}>
                <div className="th-card-headline">
                  <span className="th-card-eyebrow">Champion Mastery</span>
                  <h3 className="th-card-title">Pool Completo de Campeones</h3>
                </div>
                <span className="th-career-summary">
                  {allChampions.length} {allChampions.length === 1 ? 'CHAMPION' : 'CHAMPIONS'}
                </span>
                <svg
                  className={`th-career-chevron ${champOpen ? 'open' : ''}`}
                  viewBox="0 0 12 12"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <path d="M4 2l4 4-4 4" />
                </svg>
              </div>
              <div className={`th-career-body ${champOpen ? 'open' : ''}`}>
                <div style={{ overflowX: 'auto' }}>
                  <table className="th-h2h-table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th onClick={() => toggleChampSort('name')} className={sortClass('name')}>Champion</th>
                        <th onClick={() => toggleChampSort('games')} className={`numeric ${sortClass('games')}`}>G</th>
                        <th onClick={() => toggleChampSort('wins')} className={`numeric ${sortClass('wins')}`}>W</th>
                        <th className="numeric">L</th>
                        <th onClick={() => toggleChampSort('win_rate')} className={`numeric ${sortClass('win_rate')}`}>WR%</th>
                        <th onClick={() => toggleChampSort('kda')} className={`numeric ${sortClass('kda')}`}>KDA</th>
                        <th className="numeric">K / D / A</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sorted.map((c, i) => (
                        <tr
                          key={c.name}
                          onClick={() => router.push(`/${league}/champion_historical/${encodeURIComponent(c.name)}`)}
                        >
                          <td className="th-h2h-rank">{String(i + 1).padStart(2, '0')}</td>
                          <td>
                            <div className="th-h2h-team-cell">
                              {c.image_url && (
                                <Image
                                  src={c.image_url}
                                  alt={c.name}
                                  className="th-h2h-team-logo"
                                  width={56}
                                  height={56}
                                  onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                                />
                              )}
                              <span className="th-h2h-abbr">{c.name}</span>
                            </div>
                          </td>
                          <td className="numeric">{c.games}</td>
                          <td className="numeric" style={{ color: 'var(--clr-win)' }}>{c.wins}</td>
                          <td className="numeric" style={{ color: 'var(--clr-loss)' }}>{(c.games ?? 0) - (c.wins ?? 0)}</td>
                          <td className={`numeric ${wrClass(c.win_rate)}`}>{pct(c.win_rate)}</td>
                          <td className={`numeric ${kdaClass(c.kda)}`}>{fmt(c.kda)}</td>
                          <td className="numeric" style={{ color: 'var(--text-muted)' }}>
                            {fmt(c.avg_kills)} / {fmt(c.avg_deaths)} / {fmt(c.avg_assists)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </section>
        );
      })()}


      {/* ═══════════ TROPHY CASE (colapsable, todos los splits) ═══════════ */}
      {career.length > 0 && (() => {
        const allTrophies = [...career].sort((a, b) =>
          (b.year - a.year) || ((a.placement || 99) - (b.placement || 99))
        );
        const titles  = career.filter(c => c.placement === 1 || c.is_winner).length;
        const podiums = career.filter(c => [1, 2, 3].includes(c.placement || 0)).length;
        return (
          <section className="th-section">
            <div className="th-ed-card">
              <div className="th-ed-card-header th-career-toggle" onClick={() => setTrophyOpen(o => !o)}>
                <div className="th-card-headline">
                  <span className="th-card-eyebrow">Trophy Case</span>
                  <h3 className="th-card-title">Palmarés</h3>
                </div>
                <span className="th-career-summary">
                  {allTrophies.length} SPLITS · {podiums} PODIUMS · {titles} TITLES
                </span>
                <svg
                  className={`th-career-chevron ${trophyOpen ? 'open' : ''}`}
                  viewBox="0 0 12 12"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <path d="M4 2l4 4-4 4" />
                </svg>
              </div>

              <div className={`th-career-body ${trophyOpen ? 'open' : ''}`}>
                <div className="th-trophy-grid-v3">
                  {allTrophies.map((t, i) => {
                    const cls = t.placement === 1 || t.is_winner ? 'gold'
                              : t.placement === 2 ? 'silver'
                              : t.placement === 3 ? 'bronze'
                              : 'none';
                    return (
                      <div key={`${t.serie_id ?? i}-${i}`} className={`th-trophy-card-v3 ${cls}`}>
                        <div className="th-trophy-placement">
                          {t.placement ? `${t.placement}°` : '—'}
                        </div>
                        <div className="th-trophy-content">
                          <div className="th-trophy-title-v3">{t.split}</div>
                          <div className="th-trophy-meta-v3">{t.team_abbr || t.league} · {t.year}</div>
                        </div>
                        <div className="th-trophy-stats-v3">
                          <div className="th-trophy-wl">
                            <span className="w">{t.wins}W</span>
                            <span className="l">{t.losses}L</span>
                          </div>
                          <div className={`th-trophy-wr-v3 ${wrClass(t.win_rate)}`}>{pct(t.win_rate)}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </section>
        );
      })()}

    </div>
  );
}
