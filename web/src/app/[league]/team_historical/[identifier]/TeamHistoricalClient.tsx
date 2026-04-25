'use client';

import React, { useState, useEffect } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { ROLE_ICON, FLAG_ICON } from '@/lib/constants';
import { clientFetch } from '@/lib/clientFetch';
import { getLeagueColors } from '@/lib/leagueColors';
import { MatchDetail } from '../../record/RecordClient';

/* ══════════════════════════════════════════════════════════════
   Team Historical — Client Component
   Full client-side data fetching (single endpoint)
   ══════════════════════════════════════════════════════════════ */

/* ── Helpers ──────────────────────────────────────────────── */
const fmt = (v: number | null | undefined, d = 1): string =>
  v != null ? Number(v).toFixed(d) : '—';
const pct = (v: number | null | undefined): string =>
  v != null ? `${Number(v).toFixed(1)}%` : '—';
const fmtDur = (s: number | null | undefined): string => {
  if (!s) return '—';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
};

const wrClass = (wr: number | null | undefined): string => {
  if (wr == null) return '';
  if (wr >= 50) return 'p70-val-win';
  if (wr >= 40) return 'p70-val-wr40';
  return 'p70-val-loss';
};

const kdaClass = (kda: number | null | undefined): string => {
  if (kda == null) return '';
  if (kda >= 5) return 'p70-kda-gold';
  if (kda >= 4) return 'p70-kda-green';
  if (kda >= 2.5) return 'p70-kda-gray';
  return 'p70-kda-red';
};

const ROLE_ORDER: Record<string, number> = { top: 0, jun: 1, jungle: 1, jng: 1, mid: 2, adc: 3, bot: 3, sup: 4, support: 4 };
const ROLE_LABEL: Record<string, string> = { top: 'TOP', jun: 'JNG', jungle: 'JNG', jng: 'JNG', mid: 'MID', adc: 'ADC', bot: 'BOT', sup: 'SUP', support: 'SUP' };
const PLACEMENT_LABEL: Record<number, string> = { 1: '1°', 2: '2°', 3: '3°', 4: '4°', 5: '5°', 6: '6°' };

/* ── Interfaces ───────────────────────────────────────────── */
interface TeamProfile {
  name: string;
  acronym?: string;
  image_url?: string;
  dark_mode_image_url?: string;
  location?: string;
  career_games?: number;
  career_wins?: number;
  career_losses?: number;
  career_wr?: number;
  career_kda?: number;
  career_avg_kills?: number;
  career_avg_deaths?: number;
  career_avg_assists?: number;
  seasons_played?: number;
  leagues_played?: string[];
  primary_league?: { slug: string; name: string } | null;
  international?: Array<{ league: string; appearances: number; best_placement: number | null; best_year: number | null }>;
  iconic_lineup?: {
    players: Array<{ role: string; id?: number; name?: string; image_url?: string; nationality?: string }>;
    games: number;
    wins: number;
    win_rate: number;
    first_game?: string;
    last_game?: string;
  } | null;
  best_split?: SplitSummary | null;
  worst_split?: SplitSummary | null;
  [key: string]: unknown;
}

interface SplitSummary {
  serie_id?: number;
  league: string;
  year: number;
  split: string;
  games: number;
  wins: number;
  losses: number;
  win_rate: number;
  placement?: number | null;
}

interface MatchLogEntry {
  result?: string;
  opponent?: { name?: string; abbr?: string; logo?: string };
  score?: string;
  best_of?: number;
  match_name?: string;
  match_id?: number;
  has_detail?: boolean;
  date?: string;
  [key: string]: unknown;
}

interface CareerSeason {
  serie_id?: number;
  year: number;
  split: string;
  league: string;
  games: number;
  wins: number;
  losses: number;
  win_rate?: number;
  kda?: number;
  avg_kills?: number;
  avg_deaths?: number;
  avg_assists?: number;
  avg_towers?: number;
  avg_dragons?: number;
  avg_barons?: number;
  avg_game_length?: number;
  blue_wr?: number;
  red_wr?: number;
  blue_games?: number;
  red_games?: number;
  placement?: number;
  is_winner?: boolean;
  match_log?: MatchLogEntry[];
  [key: string]: unknown;
}

interface RosterPlayer {
  name: string;
  image_url?: string;
  role?: string;
  nationality?: string;
  games?: number;
}

interface RosterTimeline {
  league: string;
  year: number;
  split: string;
  roster: RosterPlayer[];
}

interface RivalEntry {
  name: string;
  abbr: string;
  logo?: string;
  games?: number;
  wins: number;
  losses: number;
  wr: number;
}

interface TeamHistoryData {
  profile: TeamProfile;
  career: CareerSeason[];
  rosterTimeline: RosterTimeline[];
  rivals: RivalEntry[];
}


/* ══════════════════════════════════════════════════════════════
   MAIN COMPONENT
   ══════════════════════════════════════════════════════════════ */

interface Props {
  league: string;
  identifier: string;
  accent: string;
  glow: string;
}

export default function TeamHistoricalClient({ league, identifier, accent, glow }: Props) {
  const router = useRouter();

  const [data, setData] = useState<TeamHistoryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [careerOpen, setCareerOpen] = useState(false);
  const [trophyOpen, setTrophyOpen] = useState(false);
  const [rosterOpen, setRosterOpen] = useState(false);
  const [rivalsOpen, setRivalsOpen] = useState(false);
  const [h2hSortKey, setH2hSortKey] = useState<'games' | 'wins' | 'losses' | 'wr' | 'name'>('wr');
  const [h2hSortDir, setH2hSortDir] = useState<'asc' | 'desc'>('desc');
  const toggleH2hSort = (key: 'games' | 'wins' | 'losses' | 'wr' | 'name') => {
    if (h2hSortKey === key) {
      setH2hSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setH2hSortKey(key);
      setH2hSortDir(key === 'name' ? 'asc' : 'desc');
    }
  };
  const [error, setError] = useState<string | null>(null);
  const [expandedSeasons, setExpandedSeasons] = useState<Set<string>>(new Set());
  const [expandedMatchId, setExpandedMatchId] = useState<number | null>(null);

  const toggleSeason = (key: string) => {
    setExpandedSeasons(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
    setExpandedMatchId(null);
  };

  const toggleMatch = (matchId: number) => {
    setExpandedMatchId(prev => prev === matchId ? null : matchId);
  };

  useEffect(() => {
    if (!identifier) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const d = await clientFetch<TeamHistoryData>(`/api/v1/pg/team-history/${encodeURIComponent(identifier)}`);
        if (!cancelled) { setData(d); setLoading(false); }
      } catch (e) {
        if (!cancelled) { setError(e instanceof Error ? e.message : 'Error'); setLoading(false); }
      }
    })();
    return () => { cancelled = true; };
  }, [identifier]);

  if (loading) {
    return (
      <div className="p70-container">
        <div className="p70-loading">
          <div className="p70-spinner" />
          <span className="p70-loading-text">CARGANDO HISTORIAL DEL EQUIPO...</span>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p70-container">
        <div className="p70-error">
          <p>No se encontró el historial del equipo.</p>
          {error && <p style={{ fontSize: '11px', color: '#f87171', marginTop: 8 }}>{error}</p>}
        </div>
      </div>
    );
  }

  const { profile, career, rosterTimeline, rivals } = data;

  // Accent dinámico: usa primary_league del backend si está disponible,
  // si no cae al accent que llegó por la URL.
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
          {/* Watermark del logo */}
          {(profile.dark_mode_image_url || profile.image_url) && (
            <Image
              src={(profile.dark_mode_image_url || profile.image_url) as string}
              alt=""
              aria-hidden
              className="th-ed-watermark"
              width={240}
              height={240}
            />
          )}

          {/* Header editorial: logo grande + nombre + acronym + meta */}
          <div className="th-ed-card-header">
            <div className="th-hero-layout">
              <div>
                {(profile.dark_mode_image_url || profile.image_url) && (
                  <Image
                    src={(profile.dark_mode_image_url || profile.image_url) as string}
                    alt={profile.name}
                    className="th-hero-logo"
                    width={192}
                    height={192}
                    onError={e => {
                      const img = e.target as HTMLImageElement;
                      if (img.src !== profile.image_url && profile.image_url) img.src = profile.image_url as string;
                      else img.style.display = 'none';
                    }}
                  />
                )}
              </div>

              <div>
                <span className="th-ed-eyebrow">Team History</span>
                <h1 className="th-ed-hero-name">{profile.name}</h1>
                <span className="th-ed-acronym-mono">{profile.acronym || '—'}</span>
              </div>

              <div className="th-hero-meta">
                {profile.location && (
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                    <Image
                      src={FLAG_ICON(profile.location as string)}
                      alt={profile.location as string}
                      width={24}
                      height={16}
                      style={{ objectFit: 'cover' }}
                    />
                    <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1.5, color: 'var(--text-muted)' }}>
                      {profile.location as string}
                    </span>
                  </div>
                )}
                <div className="th-ed-meta">
                  {(profile.leagues_played?.length ?? 0) > 0 && (
                    <>
                      <span>{profile.leagues_played?.length} {profile.leagues_played?.length === 1 ? 'LEAGUE' : 'LEAGUES'}</span>
                      <span className="pipe">·</span>
                    </>
                  )}
                  <span>{profile.seasons_played ?? 0} {profile.seasons_played === 1 ? 'SEASON' : 'SEASONS'}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Strip inferior: 4 KPIs editoriales */}
          <div className="th-hero-kpi-strip">
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
          </div>
        </div>
      </section>

      {/* ═══════════ FILA DE 3 CARDS COMPACTAS (v2) ═══════════ */}
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
                const totDragons  = career.reduce((s, c) => s + (Number(c.avg_dragons  || 0) * c.games), 0);
                const totBarons   = career.reduce((s, c) => s + (Number(c.avg_barons   || 0) * c.games), 0);
                const totDuration = career.reduce((s, c) => s + (Number(c.avg_game_length || 0) * c.games), 0);
                const stats = [
                  { label: 'WIN RATE',   value: pct(profile.career_wr),                 bar: profile.career_wr || 0 },
                  { label: 'KDA',        value: fmt(profile.career_kda),                bar: Math.min((profile.career_kda || 0) * 20, 100) },
                  { label: 'AVG KILLS',  value: fmt(profile.career_avg_kills),          bar: Math.min((profile.career_avg_kills || 0) * 5, 100) },
                  { label: 'AVG DEATHS', value: fmt(profile.career_avg_deaths),         bar: Math.min((profile.career_avg_deaths || 0) * 5, 100) },
                  { label: 'AVG ASSISTS',value: fmt(profile.career_avg_assists),        bar: Math.min((profile.career_avg_assists || 0) * 4, 100) },
                  { label: 'DRAGONS/G',  value: totG > 0 ? fmt(totDragons / totG, 2) : '—',  bar: totG > 0 ? Math.min((totDragons / totG) * 25, 100) : 0 },
                  { label: 'BARONS/G',   value: totG > 0 ? fmt(totBarons / totG, 2) : '—',   bar: totG > 0 ? Math.min((totBarons / totG) * 50, 100) : 0 },
                  { label: 'AVG TIME',   value: totG > 0 ? fmtDur(totDuration / totG) : '—', bar: totG > 0 ? Math.min(((totDuration / totG) / 60 - 20) * 5, 100) : 0 },
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
                            BEST <strong>{PLACEMENT_LABEL[intl.best_placement] ?? `${intl.best_placement}TH`}</strong>{intl.best_year && ` · ${intl.best_year}`}
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
                      {profile.best_split.league} · {profile.best_split.year}
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
                          {profile.worst_split.league} · {profile.worst_split.year}
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


      {/* ═══════════ MOST ICONIC LINEUP (full-width) ═══════════ */}
      {profile.iconic_lineup && profile.iconic_lineup.players.length === 5 && (
        <section className="th-section">
          <div className="th-ed-card">
            <div className="th-ed-card-header">
              <span className="th-ed-eyebrow">Most Iconic Lineup</span>
              <h3 className="th-ed-section-title" style={{ marginTop: 4 }}>El roster más jugado de la historia</h3>
            </div>

            <div className="th-iconic-grid">
              {profile.iconic_lineup.players.map((p, i) => (
                <div className="th-iconic-player" key={`${p.id ?? i}-${i}`}>
                  <span className="th-iconic-role">{p.role}</span>
                  {p.image_url ? (
                    <Image
                      src={p.image_url}
                      alt={p.name || ''}
                      className="th-iconic-photo"
                      width={128}
                      height={128}
                    />
                  ) : (
                    <div className="th-iconic-photo" />
                  )}
                  <span className="th-iconic-name">{p.name || '—'}</span>
                  {p.nationality && (
                    <Image
                      src={FLAG_ICON(p.nationality)}
                      alt={p.nationality}
                      className="th-iconic-flag"
                      width={36}
                      height={24}
                    />
                  )}
                </div>
              ))}
            </div>

            <div className="th-iconic-summary">
              <div className="th-iconic-summary-cell">
                <span className="th-iconic-summary-label">Games Together</span>
                <span className="th-iconic-summary-value">{profile.iconic_lineup.games}</span>
              </div>
              <div className="th-iconic-summary-cell">
                <span className="th-iconic-summary-label">Win Rate</span>
                <span className={`th-iconic-summary-value ${wrClass(profile.iconic_lineup.win_rate)}`}>
                  {pct(profile.iconic_lineup.win_rate)}
                </span>
              </div>
              <div className="th-iconic-summary-cell">
                <span className="th-iconic-summary-label">Wins</span>
                <span className="th-iconic-summary-value" style={{ color: 'var(--clr-win)' }}>
                  {profile.iconic_lineup.wins}
                </span>
              </div>
              <div className="th-iconic-summary-cell">
                <span className="th-iconic-summary-label">Period</span>
                <span className="th-iconic-summary-value" style={{ fontSize: 13 }}>
                  {profile.iconic_lineup.first_game ? new Date(profile.iconic_lineup.first_game).getFullYear() : '—'}
                  {' – '}
                  {profile.iconic_lineup.last_game ? new Date(profile.iconic_lineup.last_game).getFullYear() : '—'}
                </span>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* ═══════════ ROSTER EVOLUTION (tablero 5×N con continuidad) ═══════════ */}
      {rosterTimeline.length > 0 && (() => {
        const ROLE_KEYS: Array<'TOP' | 'JNG' | 'MID' | 'ADC' | 'SUP'> = ['TOP', 'JNG', 'MID', 'ADC', 'SUP'];
        const normalizeRole = (r?: string): string => {
          const k = (r || '').toLowerCase();
          if (k === 'top') return 'TOP';
          if (k === 'jun' || k === 'jungle' || k === 'jng') return 'JNG';
          if (k === 'mid') return 'MID';
          if (k === 'adc' || k === 'bot') return 'ADC';
          if (k === 'sup' || k === 'support') return 'SUP';
          return '';
        };
        // Para cada split, reducir el roster a 1 jugador por rol (el de más games)
        const boardRows = rosterTimeline.map(rt => {
          // Agrupar TODOS los jugadores por rol; mantenemos el array para mostrar
          // suplentes debajo del titular (orden por games desc).
          const byRole: Record<string, RosterPlayer[]> = { TOP: [], JNG: [], MID: [], ADC: [], SUP: [] };
          for (const p of rt.roster) {
            const role = normalizeRole(p.role);
            if (!role) continue;
            byRole[role].push(p);
          }
          for (const role of Object.keys(byRole) as Array<keyof typeof byRole>) {
            byRole[role].sort((a, b) => (b.games ?? 0) - (a.games ?? 0));
          }
          return { ...rt, byRole };
        });

        return (
          <section className="th-section">
            <div className="th-ed-card">
              <div className="th-ed-card-header th-career-toggle" onClick={() => setRosterOpen(o => !o)}>
                <div className="th-card-headline">
                  <span className="th-card-eyebrow">Roster Evolution</span>
                  <h3 className="th-card-title">Lineups por temporada</h3>
                </div>
                <span className="th-career-summary">
                  {rosterTimeline.length} {rosterTimeline.length === 1 ? 'SPLIT' : 'SPLITS'}
                </span>
                <svg
                  className={`th-career-chevron ${rosterOpen ? 'open' : ''}`}
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
              <div className={`th-career-body ${rosterOpen ? 'open' : ''}`}>
                <div className="th-roster-wrap">
                <div className="th-roster-board">
                  {/* Header row con iconos de rol */}
                  <div className="th-roster-cell role-header" />
                  {ROLE_KEYS.map(role => (
                    <div key={role} className="th-roster-cell role-header">
                      <Image src={ROLE_ICON(role.toLowerCase())} alt={role} width={44} height={44} className="th-roster-role-icon" />
                      <span className="th-roster-role-label">{role}</span>
                    </div>
                  ))}

                  {/* Filas: una por split */}
                  {boardRows.map((row, idx) => {
                    const prevRow = idx > 0 ? boardRows[idx - 1] : null;
                    return (
                      <React.Fragment key={`${row.year}-${row.split}-${idx}`}>
                        <div className="th-roster-cell split-label">
                          <span className="th-roster-split-name">{row.year} {row.split}</span>
                          <span className="th-roster-split-meta">{row.league}</span>
                        </div>
                        {ROLE_KEYS.map(role => {
                          const players = row.byRole[role] || [];
                          if (players.length === 0) {
                            return <div key={role} className="th-roster-cell empty" />;
                          }
                          const main = players[0];
                          const subs = players.slice(1);
                          const prevPlayers = prevRow ? prevRow.byRole[role] : [];
                          const prevMain = prevPlayers && prevPlayers.length > 0 ? prevPlayers[0] : null;
                          const continuity = prevMain && prevMain.name === main.name;
                          return (
                            <div
                              key={role}
                              className={`th-roster-cell ${continuity ? 'continuity' : ''} ${subs.length > 0 ? 'has-subs' : ''}`}
                            >
                              <div
                                className="th-roster-main-row"
                                onClick={() => router.push(`/${league}/player_historical/${encodeURIComponent(main.name)}`)}
                                style={{ cursor: 'pointer' }}
                              >
                                {main.image_url ? (
                                  <Image
                                    src={main.image_url}
                                    alt={main.name}
                                    className="th-roster-photo"
                                    width={76}
                                    height={76}
                                    onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                                  />
                                ) : (
                                  <div className="th-roster-photo" />
                                )}
                                <div className="th-roster-info">
                                  <span className="th-roster-name">{main.name}</span>
                                </div>
                                {main.nationality && (
                                  <Image
                                    src={FLAG_ICON(main.nationality)}
                                    alt={main.nationality}
                                    className="th-roster-flag"
                                    width={32}
                                    height={22}
                                  />
                                )}
                              </div>
                              {subs.length > 0 && (
                                <div className="th-roster-subs">
                                  {subs.map(sub => (
                                    <div
                                      key={sub.name}
                                      className="th-roster-sub"
                                      title={`${sub.name} · ${sub.games ?? 0} games`}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        router.push(`/${league}/player_historical/${encodeURIComponent(sub.name)}`);
                                      }}
                                    >
                                      {sub.image_url && (
                                        <Image
                                          src={sub.image_url}
                                          alt={sub.name}
                                          className="th-roster-sub-photo"
                                          width={32}
                                          height={32}
                                        />
                                      )}
                                      <span className="th-roster-sub-name">{sub.name}</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </React.Fragment>
                    );
                  })}
                </div>
                </div>
              </div>
            </div>
          </section>
        );
      })()}
      {/* ═══════════ HEAD-TO-HEAD DASHBOARD ═══════════ */}
      {rivals.length > 0 && (() => {
        type RivalRow = typeof rivals[number];
        const sorted = [...rivals].sort((a: RivalRow, b: RivalRow) => {
          const dir = h2hSortDir === 'asc' ? 1 : -1;
          if (h2hSortKey === 'name') return (a.abbr || '').localeCompare(b.abbr || '') * dir;
          const av = (a as RivalRow & Record<string, number>)[h2hSortKey] ?? 0;
          const bv = (b as RivalRow & Record<string, number>)[h2hSortKey] ?? 0;
          if (av !== bv) return (av - bv) * dir;
          return (b.wins ?? 0) - (a.wins ?? 0);
        });
        const sortClass = (key: typeof h2hSortKey) => h2hSortKey === key ? `sort-${h2hSortDir}` : '';
        return (
          <section className="th-section">
            <div className="th-ed-card">
              <div className="th-ed-card-header th-career-toggle" onClick={() => setRivalsOpen(o => !o)}>
                <div className="th-card-headline">
                  <span className="th-card-eyebrow">Rivalries</span>
                  <h3 className="th-card-title">Historial vs. Rivales</h3>
                </div>
                <span className="th-career-summary">
                  {rivals.length} {rivals.length === 1 ? 'OPPONENT' : 'OPPONENTS'}
                </span>
                <svg
                  className={`th-career-chevron ${rivalsOpen ? 'open' : ''}`}
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
              <div className={`th-career-body ${rivalsOpen ? 'open' : ''}`}>
                <div style={{ overflowX: 'auto' }}>
                <table className="th-h2h-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th onClick={() => toggleH2hSort('name')} className={sortClass('name')}>Team</th>
                      <th className="numeric"></th>
                      <th onClick={() => toggleH2hSort('games')} className={`numeric ${sortClass('games')}`}>G</th>
                      <th onClick={() => toggleH2hSort('wins')} className={`numeric ${sortClass('wins')}`}>W</th>
                      <th onClick={() => toggleH2hSort('losses')} className={`numeric ${sortClass('losses')}`}>L</th>
                      <th onClick={() => toggleH2hSort('wr')} className={`numeric ${sortClass('wr')}`}>WR%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map((m, i) => (
                      <tr
                        key={m.abbr || i}
                        onClick={() => router.push(`/${league}/team_historical/${encodeURIComponent(m.name || m.abbr || '')}`)}
                      >
                        <td className="th-h2h-rank">{String(i + 1).padStart(2, '0')}</td>
                        <td>
                          <div className="th-h2h-team-cell">
                            {m.logo && (
                              <Image
                                src={m.logo}
                                alt={m.abbr || ''}
                                className="th-h2h-team-logo"
                                width={56}
                                height={56}
                                onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                              />
                            )}
                            <div className="th-h2h-team-name">
                              <span className="th-h2h-abbr">{m.abbr || '—'}</span>
                              {m.name && m.name !== m.abbr && <span className="th-h2h-fullname">{m.name}</span>}
                            </div>
                          </div>
                        </td>
                        <td className="th-h2h-bar-cell">
                          <div className="th-h2h-bar">
                            <div className="th-h2h-bar-wins" style={{ width: `${m.wr ?? 0}%` }} />
                          </div>
                        </td>
                        <td className="numeric">{m.games ?? ((m.wins ?? 0) + (m.losses ?? 0))}</td>
                        <td className="numeric" style={{ color: 'var(--clr-win)' }}>{m.wins ?? 0}</td>
                        <td className="numeric" style={{ color: 'var(--clr-loss)' }}>{m.losses ?? 0}</td>
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


      {/* ═══════════ TROPHY CASE (full-width, colapsable, todos los splits) ═══════════ */}
      {career.length > 0 && (() => {
        const allTrophies = [...career].sort((a, b) =>
          (b.year - a.year) || ((a.placement || 99) - (b.placement || 99))
        );
        const titles = career.filter(c => c.placement === 1 || c.is_winner).length;
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
                          <div className="th-trophy-meta-v3">{t.league} · {t.year}</div>
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

      {/* ═══════════ CAREER TIMELINE (colapsado por defecto) ═══════════ */}
      {career.length > 0 && (() => {
        const maxGames = Math.max(...career.map(c => c.games || 0), 1);
        const sortedAsc = [...career].sort((a, b) => (a.year - b.year) || a.split.localeCompare(b.split));
        const totalGames = career.reduce((s, c) => s + (c.games || 0), 0);
        const podiumCount = career.filter(c => [1,2,3].includes(c.placement || 0)).length;
        return (
          <section className="th-section">
            <div className="th-ed-card">
              <div className="th-ed-card-header th-career-toggle" onClick={() => setCareerOpen(o => !o)}>
                <div>
                  <span className="th-ed-eyebrow">Career</span>
                  <h3 className="th-ed-section-title" style={{ marginTop: 4 }}>Trayectoria Competitiva</h3>
                </div>
                <span className="th-career-summary">
                  {career.length} SPLITS · {totalGames} GAMES · {podiumCount} PODIUM{podiumCount === 1 ? '' : 'S'}
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

                {/* Tabla detallada (preservada del diseño anterior) */}
                <div className="p70-table-wrap" style={{ borderRadius: 0 }}>
          <table className="p70-table">
            <thead>
              <tr>
                <th style={{ width: 20 }}></th>
                <th>Temporada</th>
                <th>Liga</th>
                <th className="center">Pos</th>
                <th className="center">G</th>
                <th className="center">W</th>
                <th className="center">L</th>
                <th className="center">WR%</th>
                <th className="center">KDA</th>
                <th className="center">K</th>
                <th className="center">D</th>
                <th className="center">A</th>
                <th className="center">Torres</th>
                <th className="center">Dragones</th>
                <th className="center">Barones</th>
                <th className="center">Duración</th>
                <th className="center">Blue WR</th>
                <th className="center">Red WR</th>
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
                      <td className="center">
                        {s.placement ? (
                          <span className={`p80-placement-num p80-placement-${s.placement === 1 || s.is_winner ? 'gold' : s.placement === 2 ? 'silver' : s.placement === 3 ? 'bronze' : 'none'}`} style={{ fontSize: '11px' }}>
                            {s.placement}°
                          </span>
                        ) : '—'}
                      </td>
                      <td className="center">{s.games}</td>
                      <td className="center p70-val-win">{s.wins}</td>
                      <td className="center p70-val-loss">{s.losses}</td>
                      <td className={`center ${wrClass(s.win_rate)}`}>{pct(s.win_rate)}</td>
                      <td className={`center ${kdaClass(s.kda)}`}>{fmt(s.kda)}</td>
                      <td className="center">{fmt(s.avg_kills)}</td>
                      <td className="center">{fmt(s.avg_deaths)}</td>
                      <td className="center">{fmt(s.avg_assists)}</td>
                      <td className="center">{fmt(s.avg_towers)}</td>
                      <td className="center">{fmt(s.avg_dragons)}</td>
                      <td className="center">{fmt(s.avg_barons)}</td>
                      <td className="center">{fmtDur(s.avg_game_length)}</td>
                      <td className={`center ${wrClass(s.blue_wr)}`}>{(s.blue_games ?? 0) > 0 ? pct(s.blue_wr) : '—'}</td>
                      <td className={`center ${wrClass(s.red_wr)}`}>{(s.red_games ?? 0) > 0 ? pct(s.red_wr) : '—'}</td>
                    </tr>
                    {isExpanded && matchLog.length > 0 && (
                      <tr className="p70-match-detail-row">
                        <td colSpan={18}>
                          <div className="p70-match-detail-container">
                            <table className="p70-match-detail-table">
                              <thead>
                                <tr>
                                  <th className="center">Res</th>
                                  <th>VS</th>
                                  <th className="center">Score</th>
                                  <th className="center">BO</th>
                                  <th>Nombre</th>
                                  <th className="center">Fecha</th>
                                </tr>
                              </thead>
                              <tbody>
                                {matchLog.map((m, mi) => {
                                  const isWin = m.result === 'W';
                                  const date = m.date ? new Date(m.date).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
                                  const mId = m.match_id;
                                  const hasDetail = m.has_detail !== false && mId != null;
                                  const isMatchOpen = expandedMatchId === mId && hasDetail;
                                  const matchName = m.match_name ?? '';

                                  return (
                                    <React.Fragment key={mId ?? `m-${mi}`}>
                                      <tr
                                        className={`${isWin ? 'p70-detail-win' : 'p70-detail-loss'} ${hasDetail ? 'p70-game-row-clickable' : ''} ${isMatchOpen ? 'p70-game-row-active' : ''}`}
                                        onClick={() => hasDetail && mId != null && toggleMatch(mId)}
                                      >
                                        <td className="center">
                                          <span className={`p70-match-result ${isWin ? 'win' : 'loss'}`}>
                                            {isWin ? 'W' : 'L'}
                                          </span>
                                        </td>
                                        <td>
                                          <div className="p70-opponent-cell">
                                            {m.opponent?.logo && (
                                              <Image src={m.opponent.logo || ''} alt={m.opponent.abbr || ''} onError={e => (e.target as HTMLImageElement).style.display = 'none'} width={48} height={48} />
                                            )}
                                            <span style={{ fontWeight: 600, color: 'white', fontSize: '11px' }}>{m.opponent?.abbr ?? '?'}</span>
                                          </div>
                                        </td>
                                        <td className="center" style={{ fontWeight: 700, fontSize: '12px' }}>
                                          <span style={{ color: isWin ? 'var(--p70-win)' : 'var(--p70-loss)' }}>{m.score}</span>
                                        </td>
                                        <td className="center" style={{ color: 'var(--p70-muted)', fontSize: '10px' }}>Bo{m.best_of}</td>
                                        <td style={{ fontSize: '10px', color: 'var(--p70-muted)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                          {matchName}
                                        </td>
                                        <td className="center" style={{ fontSize: '10px', color: 'var(--p70-muted)' }}>{date}</td>
                                      </tr>
                                      {isMatchOpen && mId != null && (
                                        <tr className="p70-full-match-row">
                                          <td colSpan={6}>
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

    </div>
  );
}
