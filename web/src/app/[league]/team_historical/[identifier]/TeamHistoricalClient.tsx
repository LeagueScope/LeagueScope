'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { ROLE_ICON, FLAG_ICON } from '@/lib/constants';
import { clientFetch } from '@/lib/clientFetch';
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
  [key: string]: unknown;
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

/* ── Chevron for sections ───────────────────────────────── */
function SectionChevron({ open }: { open: boolean }) {
  return (
    <svg className={`p70-section-chevron ${open ? 'open' : ''}`}
      width="12" height="8" viewBox="0 0 12 8" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 1L6 6L11 1" />
    </svg>
  );
}

/* ── Collapsible Section wrapper ─────────────────────────── */
function Section({ title, count, defaultOpen = false, children }: {
  title: string;
  count?: number | null;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [render, setRender] = useState(defaultOpen);
  const [anim, setAnim] = useState(defaultOpen ? 'p70-collapse-open' : '');

  const handleToggle = () => {
    if (!open) {
      setRender(true);
      requestAnimationFrame(() => requestAnimationFrame(() => setAnim('p70-collapse-open')));
      setOpen(true);
    } else {
      setAnim('');
      setOpen(false);
      setTimeout(() => setRender(false), 350);
    }
  };

  return (
    <div className="p70-section">
      <div className="p70-section-header" onClick={handleToggle}>
        <span className={`p70-section-title ${open ? 'open' : ''}`}>
          {title}
        </span>
        <SectionChevron open={open} />
      </div>
      {render && (
        <div className={`p70-collapse ${anim}`}>
          <div className="p70-collapse-inner">{children}</div>
        </div>
      )}
    </div>
  );
}

/* ── Trend Chart ─────────────────────────────────────────── */
interface TrendDataset {
  label: string;
  data: number[];
  color: string;
  format?: (v: number) => string;
}

function TrendChart({ labels, datasets }: { labels: string[]; datasets: TrendDataset[] }) {
  const [activeIdx, setActiveIdx] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ds = datasets[activeIdx];

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !ds) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;

    const draw = () => {
      const W = canvas.clientWidth;
      const H = canvas.clientHeight;
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      ctx.scale(dpr, dpr);

      ctx.font = '9px JetBrains Mono, monospace';
      const maxLabelW = Math.max(...labels.map(l => ctx.measureText(l).width), 30);
      const labelDiag = maxLabelW * Math.sin(Math.PI / 4) + 14;
      const pad = { top: 28, bottom: Math.max(50, Math.ceil(labelDiag)), left: 50, right: 20 };
      const gw = W - pad.left - pad.right;
      const gh = H - pad.top - pad.bottom;

      ctx.clearRect(0, 0, W, H);

      const data = ds.data;
      const minV = Math.min(...data);
      const maxV = Math.max(...data);
      const range = maxV - minV || 1;

      // Y axis
      const ySteps = 5;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      for (let i = 0; i <= ySteps; i++) {
        const v = minV + (range * i / ySteps);
        const y = pad.top + gh - (gh * i / ySteps);
        ctx.fillStyle = 'rgba(255,255,255,0.25)';
        ctx.fillRect(pad.left, y, gw, 0.5);
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.fillText(ds.format ? ds.format(v) : v.toFixed(1), pad.left - 6, y);
      }

      // Plot
      if (data.length < 2) return;
      const step = gw / (data.length - 1);

      ctx.beginPath();
      ctx.strokeStyle = ds.color;
      ctx.lineWidth = 2;
      data.forEach((v, i) => {
        const x = pad.left + i * step;
        const y = pad.top + gh - ((v - minV) / range * gh);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      });
      ctx.stroke();

      // Fill
      ctx.lineTo(pad.left + (data.length - 1) * step, pad.top + gh);
      ctx.lineTo(pad.left, pad.top + gh);
      ctx.closePath();
      ctx.fillStyle = ds.color + '18';
      ctx.fill();

      // Dots
      data.forEach((v, i) => {
        const x = pad.left + i * step;
        const y = pad.top + gh - ((v - minV) / range * gh);
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fillStyle = ds.color;
        ctx.fill();
      });

      // X labels
      ctx.save();
      ctx.textAlign = 'right';
      ctx.textBaseline = 'top';
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.font = '9px JetBrains Mono, monospace';
      labels.forEach((l, i) => {
        const x = pad.left + i * step;
        const y = pad.top + gh + 8;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(-Math.PI / 4);
        ctx.fillText(l, 0, 0);
        ctx.restore();
      });
      ctx.restore();
    };

    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [ds, labels]);

  return (
    <div className="p80-trend-wrap">
      <div className="p80-trend-tabs">
        {datasets.map((d, i) => (
          <button key={d.label}
            className={`p80-trend-tab ${i === activeIdx ? 'active' : ''}`}
            style={i === activeIdx ? { borderBottomColor: d.color, color: d.color } : {}}
            onClick={() => setActiveIdx(i)}
          >{d.label}</button>
        ))}
      </div>
      <canvas ref={canvasRef} className="p80-trend-canvas" />
    </div>
  );
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

  return (
    <div className="p70-container" style={{ '--nav-accent': accent, '--nav-glow': glow } as React.CSSProperties}>

      {/* ═══════════ HERO ═══════════ */}
      <div className="p70-hero">
        <div className="p70-hero-left">
          <div className="p80-hero-logo">
            {(profile.dark_mode_image_url || profile.image_url)
              ? <Image
                  src={(profile.dark_mode_image_url || profile.image_url) as string}
                  alt={profile.name}
                  onError={e => {
                    const img = e.target as HTMLImageElement;
                    if (img.src !== profile.image_url && profile.image_url) img.src = profile.image_url as string;
                    else img.style.display = 'none';
                  }}
                  width={192}
                  height={192}
                />
              : <div style={{ width: '100%', height: '100%', background: '#1a1f2b' }} />
            }
          </div>
          <div className="p70-hero-info">
            <h1 className="p70-hero-name">{profile.name}</h1>
            <div className="p70-hero-meta">
              <span className="p70-badge p70-badge-team">{profile.acronym}</span>
              {profile.location && (
                <span className="p70-badge p70-badge-nat">
                  <Image src={FLAG_ICON(profile.location as string)} alt={profile.location} style={{ width: 14, height: 10, objectFit: 'cover', marginRight: 3 }} width={48} height={32} />
                  {profile.location as string}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="p70-hero-right">
          <div className="p70-hero-stat">
            <span className="p70-hero-stat-val">{profile.career_games ?? 0}</span>
            <span className="p70-hero-stat-lbl">PARTIDAS</span>
          </div>
          <div className="p70-hero-stat">
            <span className="p70-hero-stat-val">
              <span style={{ color: 'var(--p70-win)' }}>{profile.career_wins ?? 0}</span>
              <span style={{ color: 'var(--p70-muted)', margin: '0 2px' }}>/</span>
              <span style={{ color: 'var(--p70-loss)' }}>{profile.career_losses ?? 0}</span>
            </span>
            <span className="p70-hero-stat-lbl">W / L</span>
          </div>
          <div className="p70-hero-stat">
            <span className={`p70-hero-stat-val ${wrClass(profile.career_wr)}`}>
              {pct(profile.career_wr)}
            </span>
            <span className="p70-hero-stat-lbl">WIN RATE</span>
          </div>
          <div className="p70-hero-stat">
            <span className={`p70-hero-stat-val ${kdaClass(profile.career_kda)}`}>
              {fmt(profile.career_kda)}
            </span>
            <span className="p70-hero-stat-lbl">KDA</span>
          </div>
          <div className="p70-hero-stat">
            <span className="p70-hero-stat-val" style={{ color: 'var(--p70-secondary)' }}>
              {fmt(profile.career_avg_kills)}/{fmt(profile.career_avg_deaths)}/{fmt(profile.career_avg_assists)}
            </span>
            <span className="p70-hero-stat-lbl">K / D / A</span>
          </div>
          <div className="p70-hero-stat">
            <span className="p70-hero-stat-val" style={{ color: 'var(--p70-accent)' }}>
              {profile.seasons_played ?? 0}
            </span>
            <span className="p70-hero-stat-lbl">TEMPORADAS</span>
          </div>
        </div>
      </div>

      {/* ═══════════ PALMARÉS ═══════════ */}
      {career.length > 0 && (() => {
        const trophies = career.map(s => ({
          year: s.year, split: s.split, league: s.league,
          games: s.games, wins: s.wins, losses: s.losses, wr: s.win_rate,
          placement: s.placement, is_winner: s.is_winner,
        }));
        return (
          <Section title="Palmarés" count={trophies.length}>
            <div className="p70-palmares">
              {trophies.map((t, i) => {
                const pos = t.placement;
                const medal = (pos === 1 || t.is_winner) ? 'gold' : pos === 2 ? 'silver' : pos === 3 ? 'bronze' : 'none';
                return (
                  <div key={i} className={`p70-trophy p70-trophy-${medal}`}>
                    <div className="p80-trophy-placement">
                      {pos ? (
                        <span className={`p80-placement-num p80-placement-${medal}`}>
                          {PLACEMENT_LABEL[pos] ?? `${pos}°`}
                        </span>
                      ) : (
                        <span className="p80-placement-num p80-placement-none">—</span>
                      )}
                    </div>
                    <div className="p70-trophy-info">
                      <span className="p70-trophy-title">{t.split}</span>
                      <span className="p70-trophy-league">{t.league} · {t.year}</span>
                    </div>
                    <div className="p70-trophy-stats">
                      <span className="p70-trophy-record">
                        <span className="p70-trophy-w">{t.wins}W</span> <span className="p70-trophy-l">{t.losses}L</span>
                      </span>
                      <span className={`p70-trophy-wr ${wrClass(t.wr)}`}>{pct(t.wr)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </Section>
        );
      })()}

      {/* ═══════════ EVOLUCIÓN DEL ROSTER ═══════════ */}
      {rosterTimeline.length > 0 && (
        <Section title="Evolución del Roster" count={rosterTimeline.length}>
          <div className="p80-roster-timeline">
            {rosterTimeline.map((rt, i) => {
              const sorted = [...rt.roster].sort((a, b) =>
                (ROLE_ORDER[a.role?.toLowerCase() ?? ''] ?? 9) - (ROLE_ORDER[b.role?.toLowerCase() ?? ''] ?? 9)
              );
              return (
                <div key={i} className="p80-roster-season">
                  <div className="p80-roster-season-header">
                    <span className="p80-roster-season-label">{rt.league} {rt.year}</span>
                    <span className="p80-roster-season-split">{rt.split}</span>
                  </div>
                  <div className="p80-roster-players">
                    {sorted.map((p, j) => (
                      <div key={j} className="p80-roster-player"
                        onClick={() => router.push(`/${league}/player_historical/${encodeURIComponent(p.name)}`)}
                      >
                        <div className="p80-roster-player-photo">
                          {p.image_url ? (
                            <Image src={p.image_url} alt={p.name} onError={e => (e.target as HTMLImageElement).style.display = 'none'} width={96} height={96} />
                          ) : (
                            <div className="p80-roster-player-placeholder" />
                          )}
                        </div>
                        <div className="p80-roster-player-info">
                          <span className="p80-roster-player-name">{p.name}</span>
                          <span className="p80-roster-player-role">
                            {p.role && <Image src={ROLE_ICON(p.role)} alt={p.role} width={48} height={48} />}
                            {ROLE_LABEL[p.role?.toLowerCase() ?? ''] ?? p.role?.toUpperCase() ?? '?'}
                          </span>
                        </div>
                        {p.nationality && (
                          <Image className="p80-roster-player-flag" src={FLAG_ICON(p.nationality)} alt={p.nationality} width={48} height={32} />
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </Section>
      )}

      {/* ═══════════ RIVALES HISTÓRICOS ═══════════ */}
      {rivals.length > 0 && (
        <Section title="Rivales Históricos" count={rivals.length}>
          <div className="p70-matchups">
            {rivals.map(m => (
              <div key={m.abbr} className="p70-matchup-card" onClick={() => router.push(`/${league}/team_historical/${encodeURIComponent(m.name || m.abbr)}`)} style={{ cursor: 'pointer' }}>
                <div className="p70-matchup-team">
                  {m.logo && <Image src={m.logo} alt={m.abbr} onError={e => (e.target as HTMLImageElement).style.display = 'none'} width={96} height={96} />}
                  <span>{m.abbr}</span>
                </div>
                <div className="p70-matchup-bar-wrap">
                  <div className="p70-matchup-bar-wins" style={{ width: `${m.wr}%` }} />
                </div>
                <div className="p70-matchup-stats">
                  <span className="p70-matchup-record">
                    <span className="p70-trophy-w">{m.wins}W</span> <span className="p70-trophy-l">{m.losses}L</span>
                  </span>
                  <span className={`p70-matchup-wr ${wrClass(m.wr)}`}>{pct(m.wr)}</span>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* ═══════════ ESTADÍSTICAS GENERALES ═══════════ */}
      {career.length > 0 && (() => {
        const totG = career.reduce((s, c) => s + c.games, 0);
        if (totG === 0) return null;
        const avgOf = (field: string) => career.reduce((s, c) => s + (((c[field] as number) ?? 0) * c.games), 0) / totG;
        const stats = [
          { label: 'KDA', value: profile.career_kda ?? 0, max: 8 },
          { label: 'Avg Kills', value: avgOf('avg_kills'), max: 25 },
          { label: 'Avg Deaths', value: avgOf('avg_deaths'), max: 20 },
          { label: 'Avg Towers', value: avgOf('avg_towers'), max: 10 },
          { label: 'Avg Dragons', value: avgOf('avg_dragons'), max: 5 },
          { label: 'Avg Barons', value: avgOf('avg_barons'), max: 2 },
          { label: 'Blue WR', value: avgOf('blue_wr'), max: 100 },
          { label: 'Red WR', value: avgOf('red_wr'), max: 100 },
        ];
        return (
          <Section title="Estadísticas Generales">
            <div className="p70-radar-stats">
              {stats.map(s => {
                const pctVal = Math.min((s.value / s.max) * 100, 100);
                return (
                  <div key={s.label} className="p70-radar-row">
                    <span className="p70-radar-label">{s.label}</span>
                    <div className="p70-radar-bar-wrap">
                      <div className="p70-radar-bar" style={{ width: `${pctVal}%` }} />
                    </div>
                    <span className="p70-radar-val">{s.label.includes('%') || s.label.includes('WR') ? pct(s.value) : fmt(s.value)}</span>
                  </div>
                );
              })}
            </div>
          </Section>
        );
      })()}

      {/* ═══════════ HISTORIAL POR TEMPORADA ═══════════ */}
      <Section title="Historial por Temporada" count={career.length}>
        <div className="p70-table-wrap">
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
      </Section>

    </div>
  );
}
