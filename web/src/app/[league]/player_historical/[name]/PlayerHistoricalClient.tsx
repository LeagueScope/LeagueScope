'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { teamImg, ROLE_ICON, FLAG_ICON } from '@/lib/constants';
import { clientFetch } from '@/lib/clientFetch';
import { MatchDetail } from '../../record/RecordClient';

/* ══════════════════════════════════════════════════════════════
   Player Historical — Client Component
   Full client-side data fetching (single endpoint)
   ══════════════════════════════════════════════════════════════ */

/* ── Helpers ──────────────────────────────────────────────── */
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

/* ── Collapsible Section wrapper (smooth animated) ─────── */
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

/* ── Trend Chart (one metric at a time, real Y axis, full labels) ──── */
interface TrendDataset {
  label: string;
  data: number[];
  color: string;
  format?: (v: number) => string;
}

function TrendChart({ labels, datasets }: { labels: string[]; datasets: TrendDataset[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  const ds = datasets[activeIdx];

  const draw = useCallback(() => {
    if (!canvasRef.current || !containerRef.current || !labels.length || !ds) return;
    const container = containerRef.current;
    const canvas = canvasRef.current;
    const rect = container.getBoundingClientRect();
    const W = Math.round(rect.width), H = Math.round(rect.height);
    if (!W || !H) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    const data = ds.data;
    const n = labels.length;
    const maxV = Math.max(...data) * 1.15 || 1;
    const minV = Math.min(0, ...data);
    const range = maxV - minV || 1;

    ctx.font = '9px JetBrains Mono, monospace';
    const maxLabelW = Math.max(...labels.map(l => ctx.measureText(l).width));
    const labelDiag = maxLabelW * Math.sin(Math.PI / 4) + 14;
    const pad = { top: 28, bottom: Math.max(50, Math.ceil(labelDiag)), left: 50, right: 20 };
    const cW = W - pad.left - pad.right, cH = H - pad.top - pad.bottom;
    ctx.clearRect(0, 0, W, H);

    // Y-axis grid + labels
    const niceStep = (r: number): number => {
      const raw = r / 4;
      const mag = Math.pow(10, Math.floor(Math.log10(raw)));
      const norm = raw / mag;
      return (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
    };
    const step = niceStep(range);
    ctx.font = '10px JetBrains Mono, monospace'; ctx.textAlign = 'right';
    for (let v = 0; v <= maxV; v += step) {
      const y = pad.top + cH - ((v - minV) / range) * cH;
      if (y < pad.top - 5 || y > pad.top + cH + 5) continue;
      ctx.strokeStyle = 'rgba(255,255,255,0.05)'; ctx.lineWidth = 0.5;
      ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(W - pad.right, y); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.fillText(ds.format ? ds.format(v) : (v % 1 === 0 ? String(v) : v.toFixed(1)), pad.left - 6, y + 3);
    }

    // X-axis labels (rotated 45°)
    ctx.font = '9px JetBrains Mono, monospace'; ctx.fillStyle = 'rgba(255,255,255,0.55)';
    for (let i = 0; i < n; i++) {
      const x = pad.left + (n > 1 ? (i / (n - 1)) * cW : cW / 2);
      ctx.save();
      ctx.translate(x, pad.top + cH + 12);
      ctx.rotate(-Math.PI / 4);
      ctx.textAlign = 'right';
      ctx.fillText(labels[i], 0, 0);
      ctx.restore();
    }

    // Area fill
    ctx.beginPath();
    ctx.moveTo(pad.left, pad.top + cH);
    for (let i = 0; i < n; i++) {
      const x = pad.left + (n > 1 ? (i / (n - 1)) * cW : cW / 2);
      const y = pad.top + cH - ((data[i] - minV) / range) * cH;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(pad.left + (n > 1 ? cW : cW / 2), pad.top + cH);
    ctx.closePath();
    ctx.globalAlpha = 0.15; ctx.fillStyle = ds.color; ctx.fill(); ctx.globalAlpha = 1;

    // Line
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const x = pad.left + (n > 1 ? (i / (n - 1)) * cW : cW / 2);
      const y = pad.top + cH - ((data[i] - minV) / range) * cH;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.strokeStyle = ds.color; ctx.lineWidth = 2.5; ctx.stroke();

    // Dots + value labels
    ctx.font = '10px JetBrains Mono, monospace'; ctx.textAlign = 'center';
    for (let i = 0; i < n; i++) {
      const x = pad.left + (n > 1 ? (i / (n - 1)) * cW : cW / 2);
      const y = pad.top + cH - ((data[i] - minV) / range) * cH;
      ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#0d1117'; ctx.fill();
      ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fillStyle = ds.color; ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      const valText = ds.format ? ds.format(data[i]) : (data[i] % 1 === 0 ? String(data[i]) : data[i].toFixed(1));
      ctx.fillText(valText, x, y - 10);
    }
  }, [labels, ds]);

  useEffect(() => { const raf = requestAnimationFrame(() => draw()); return () => cancelAnimationFrame(raf); }, [draw]);
  useEffect(() => { const ro = new ResizeObserver(() => draw()); if (containerRef.current) ro.observe(containerRef.current); return () => ro.disconnect(); }, [draw]);

  return (
    <div className="p70-trend">
      <div className="p70-trend-tabs">
        {datasets.map((d, i) => (
          <button key={i} className={`p70-trend-tab ${activeIdx === i ? 'p70-trend-tab-active' : ''}`}
            onClick={() => setActiveIdx(i)} style={activeIdx === i ? { color: d.color, borderBottomColor: d.color } : {}}>
            {d.label}
          </button>
        ))}
      </div>
      <div className="p70-trend-canvas-wrap" ref={containerRef}>
        <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: '100%' }} />
      </div>
    </div>
  );
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

  return (
    <div className="p70-container" style={{ '--nav-accent': accent, '--nav-glow': glow } as React.CSSProperties}>

      {/* ═══════════ HERO ═══════════ */}
      <div className="p70-hero">
        <div className="p70-hero-left">
          <div className="p70-hero-photo">
            {profile.image_url
              ? <Image src={profile.image_url} alt={profile.name} onError={e => (e.target as HTMLImageElement).style.display = 'none'} width={256} height={256} unoptimized />
              : <div style={{ width: '100%', height: '100%', background: '#1a1f2b' }} />
            }
          </div>
          <div className="p70-hero-info">
            <h1 className="p70-hero-name">{profile.name}</h1>
            <div className="p70-hero-meta">
              {profile.role && (
                <span className="p70-badge p70-badge-role">
                  <Image src={ROLE_ICON(profile.role)} alt={profile.role} style={{ width: 12, height: 12, objectFit: 'contain', marginRight: 3 }} width={48} height={48} />
                  {ROLE_LABEL[profile.role?.toLowerCase()] ?? profile.role?.toUpperCase()}
                </span>
              )}
              {profile.current_team_abbr && (
                <span className="p70-badge p70-badge-team">
                  <Image
                    src={teamImg(profile.current_team_logo, profile.current_team_abbr, league)}
                    alt={profile.current_team_abbr}
                    onError={e => (e.target as HTMLImageElement).style.display = 'none'}
                    width={48}
                    height={48}
                  />
                  {profile.current_team ?? profile.current_team_abbr}
                </span>
              )}
              {profile.nationality && (
                <span className="p70-badge p70-badge-nat">
                  <Image src={FLAG_ICON(profile.nationality as string)} alt={profile.nationality} style={{ width: 14, height: 10, objectFit: 'cover', marginRight: 3 }} width={48} height={32} />
                  {profile.nationality as string}
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
        const trophies = career.map(s => {
          const wr = s.win_rate ?? 0;
          return { year: s.year, split: s.split, league: s.league, team: s.team_abbr, team_logo: s.team_logo, games: s.games, wins: s.wins, losses: s.losses, wr, placement: s.placement, is_winner: s.is_winner };
        });
        return (
          <Section title="Palmarés" count={trophies.length}>
            <div className="p70-palmares">
              {trophies.map((t, i) => {
                const medal = (t.placement === 1 || t.is_winner) ? 'gold' : t.placement === 2 ? 'silver' : t.placement === 3 ? 'bronze' : 'none';
                return (
                  <div key={i} className={`p70-trophy p70-trophy-${medal}`}>
                    <div className="p70-trophy-icon">
                      {t.team_logo && <Image src={t.team_logo} alt={t.team} onError={e => (e.target as HTMLImageElement).style.display = 'none'} width={64} height={64} />}
                    </div>
                    <div className="p70-trophy-info">
                      <span className="p70-trophy-title">{t.split}</span>
                      <span className="p70-trophy-league">{t.league} · {t.year}</span>
                    </div>
                    <div className="p70-trophy-stats">
                      <span className="p70-trophy-record">
                        <span className="p70-trophy-w">{t.wins}W</span> <span className="p70-trophy-l">{t.losses}L</span>
                      </span>
                      {t.placement ? (
                        <span className={`p70-trophy-wr ${medal === 'gold' ? 'p70-val-win' : medal === 'silver' ? '' : medal === 'bronze' ? 'p70-val-wr40' : 'p70-val-loss'}`}>
                          {t.placement}°
                        </span>
                      ) : (
                        <span className={`p70-trophy-wr ${wrClass(t.wr)}`}>{pct(t.wr)}</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </Section>
        );
      })()}

      {/* ═══════════ TENDENCIA DE RENDIMIENTO ═══════════ */}
      {career.length >= 2 && (() => {
        const sorted = [...career].sort((a, b) => a.year - b.year || (a.serie_id ?? 0) - (b.serie_id ?? 0));
        const labels = sorted.map(s => {
          const split = (s.split ?? '').replace(/^(Spring|Summer|Split\s*\d?)/i, (m) => m.slice(0, 3));
          return `${s.league} ${s.year} ${split}`.trim();
        });
        const fmtD = (v: number) => v.toFixed(1);
        const fmtP = (v: number) => v.toFixed(1) + '%';
        const fmtI = (v: number) => Math.round(v).toString();
        return (
          <Section title="Tendencia de Rendimiento" defaultOpen={false}>
            <TrendChart labels={labels} datasets={[
              { label: 'KDA', data: sorted.map(s => (s.kda as number) ?? 0), color: '#f0a500', format: fmtD },
              { label: 'Win Rate', data: sorted.map(s => (s.win_rate as number) ?? 0), color: '#34d399', format: fmtP },
              { label: 'CS/M', data: sorted.map(s => (s.avg_cspm as number) ?? 0), color: '#60a5fa', format: fmtD },
              { label: 'DPM', data: sorted.map(s => (s.avg_dpm as number) ?? 0), color: '#e879f9', format: fmtI },
              { label: 'GPM', data: sorted.map(s => (s.avg_gpm as number) ?? 0), color: '#fb923c', format: fmtI },
              { label: 'KP%', data: sorted.map(s => (s.kill_participation as number) ?? 0), color: '#a78bfa', format: fmtP },
            ]} />
          </Section>
        );
      })()}

      {/* ═══════════ MATCHUPS POR EQUIPO ═══════════ */}
      {career.length > 0 && (() => {
        const matchupMap: Record<string, { name: string; abbr: string; logo?: string; wins: number; losses: number }> = {};
        for (const s of career) {
          for (const g of (s.match_log ?? [])) {
            const op = g.opponent;
            const key = typeof op === 'string' ? op : (op as { abbr?: string; name?: string })?.abbr ?? (op as { name?: string })?.name ?? '—';
            if (!matchupMap[key]) {
              const opObj = typeof op === 'object' ? op as { name?: string; logo?: string } : null;
              matchupMap[key] = { name: opObj?.name ?? key, abbr: key, logo: opObj?.logo, wins: 0, losses: 0 };
            }
            if (g.result === 'W' || g.win === true) matchupMap[key].wins++;
            else matchupMap[key].losses++;
          }
        }
        const matchups = Object.values(matchupMap)
          .map(m => ({ ...m, games: m.wins + m.losses, wr: (m.wins + m.losses) > 0 ? (m.wins / (m.wins + m.losses) * 100) : 0 }))
          .filter(m => m.games >= 2)
          .sort((a, b) => b.games - a.games);
        if (!matchups.length) return null;
        return (
          <Section title="Matchups por Equipo" count={matchups.length}>
            <div className="p70-matchups">
              {matchups.map(m => (
                <div key={m.abbr} className="p70-matchup-card" onClick={() => router.push(`/${league}/team_historical/${encodeURIComponent(m.name || m.abbr)}`)} style={{ cursor: 'pointer' }}>
                  <div className="p70-matchup-team">
                    {m.logo && <Image src={m.logo} alt={m.abbr} onError={e => (e.target as HTMLImageElement).style.display = 'none'} width={64} height={64} />}
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
        );
      })()}

      {/* ═══════════ EQUIPOS ═══════════ */}
      {career.length > 0 && (() => {
        const teammateMap: Record<string, { team: string; logo?: string; league: string; year: number; split: string; games: number; wins: number; losses: number; wr?: number }> = {};
        for (const s of career) {
          const teamAbbr = s.team_abbr;
          const teamLogo = s.team_logo;
          const key2 = `${teamAbbr}|${s.league}|${s.year}|${s.split}`;
          if (!teammateMap[key2]) {
            teammateMap[key2] = { team: teamAbbr, logo: teamLogo, league: s.league, year: s.year, split: s.split, games: s.games, wins: s.wins, losses: s.losses, wr: s.win_rate };
          }
        }
        const teamGroups: Record<string, { team: string; logo?: string; seasons: typeof teammateMap[string][]; totalGames: number; totalWins: number }> = {};
        for (const v of Object.values(teammateMap)) {
          if (!teamGroups[v.team]) teamGroups[v.team] = { team: v.team, logo: v.logo, seasons: [], totalGames: 0, totalWins: 0 };
          teamGroups[v.team].seasons.push(v);
          teamGroups[v.team].totalGames += v.games;
          teamGroups[v.team].totalWins += v.wins;
        }
        const teams = Object.values(teamGroups).sort((a, b) => b.totalGames - a.totalGames);
        if (!teams.length) return null;
        return (
          <Section title="Equipos" count={teams.length}>
            <div className="p70-teammates">
              {teams.map(t => {
                const wr = t.totalGames > 0 ? (t.totalWins / t.totalGames * 100) : 0;
                return (
                  <div key={t.team} className="p70-teammate-card">
                    <div className="p70-teammate-header">
                      {t.logo && <Image src={t.logo} alt={t.team} onError={e => (e.target as HTMLImageElement).style.display = 'none'} width={64} height={64} />}
                      <span className="p70-teammate-name">{t.team}</span>
                      <span className={`p70-teammate-wr ${wrClass(wr)}`}>{pct(wr)}</span>
                      <span className="p70-teammate-games">{t.totalGames}G</span>
                    </div>
                    <div className="p70-teammate-seasons">
                      {t.seasons.map((s, i) => (
                        <span key={i} className="p70-teammate-season">{s.league} {s.year} {s.split}</span>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </Section>
        );
      })()}

      {/* ═══════════ ESTADÍSTICAS GENERALES ═══════════ */}
      {career.length > 0 && (() => {
        const totG = career.reduce((s, c) => s + c.games, 0);
        if (totG === 0) return null;
        const avgOf = (field: string) => career.reduce((s, c) => s + (((c[field] as number) ?? 0) * c.games), 0) / totG;
        const stats = [
          { label: 'KDA', value: profile.career_kda ?? 0, max: 8 },
          { label: 'CS/M', value: avgOf('avg_cspm'), max: 12 },
          { label: 'DPM', value: avgOf('avg_dpm'), max: 800 },
          { label: 'GPM', value: avgOf('avg_gpm'), max: 500 },
          { label: 'KP%', value: avgOf('kill_participation'), max: 100 },
          { label: 'DMG%', value: avgOf('avg_damage_share'), max: 40 },
          { label: 'GOLD%', value: avgOf('avg_gold_share'), max: 30 },
        ];
        return (
          <Section title="Estadísticas Generales" defaultOpen={false}>
            <div className="p70-radar-stats">
              {stats.map(s => {
                const pctVal = Math.min((s.value / s.max) * 100, 100);
                return (
                  <div key={s.label} className="p70-radar-row">
                    <span className="p70-radar-label">{s.label}</span>
                    <div className="p70-radar-bar-wrap">
                      <div className="p70-radar-bar" style={{ width: `${pctVal}%` }} />
                    </div>
                    <span className="p70-radar-val">{s.label.includes('%') ? pct(s.value) : fmt(s.value)}</span>
                  </div>
                );
              })}
            </div>
          </Section>
        );
      })()}

      {/* ═══════════ HISTORIAL POR TEMPORADA ═══════════ */}
      <Section title="Historial por Temporada" count={career.length} defaultOpen={false}>
        <div className="p70-table-wrap">
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
      </Section>

      {/* ═══════════ POOL DE CAMPEONES ═══════════ */}
      <Section title="Pool de Campeones" count={allChampions.length}>
        <div className="p70-table-wrap">
          <table className="p70-table">
            <thead>
              <tr>
                <th>Campeón</th>
                <th className="center">Partidas</th>
                <th className="center">Victorias</th>
                <th className="center">WR%</th>
                <th className="center">KDA</th>
                <th className="center">Avg K</th>
                <th className="center">Avg D</th>
                <th className="center">Avg A</th>
              </tr>
            </thead>
            <tbody>
              {allChampions.map(c => (
                <tr key={c.name}>
                  <td>
                    <div className="p70-champ-cell">
                      {c.image_url && (
                        <Image
                          src={c.image_url}
                          alt={c.name}
                          onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                          width={64}
                          height={64}
                        />
                      )}
                      <span style={{ color: 'white', fontFamily: 'Inter, system-ui', fontWeight: 700 }}>{c.name}</span>
                    </div>
                  </td>
                  <td className="center">{c.games}</td>
                  <td className="center p70-val-win">{c.wins}</td>
                  <td className={`center ${wrClass(c.win_rate)}`}>{pct(c.win_rate)}</td>
                  <td className={`center ${kdaClass(c.kda)}`}>{fmt(c.kda)}</td>
                  <td className="center">{fmt(c.avg_kills)}</td>
                  <td className="center">{fmt(c.avg_deaths)}</td>
                  <td className="center">{fmt(c.avg_assists)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

    </div>
  );
}
