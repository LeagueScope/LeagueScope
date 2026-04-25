'use client';

import Image from 'next/image';
import { getLeagueColors } from '@/lib/leagueColors';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { champImg, ROLE_ICON } from '@/lib/constants';
import { clientFetch } from '@/lib/clientFetch';
import { MatchDetail } from '../../record/RecordClient';

/* ══════════════════════════════════════════════════════════════
   Champion Historical — Client Component
   Full client-side data fetching (single endpoint, no league param)
   ══════════════════════════════════════════════════════════════ */

/* ── Helpers ──────────────────────────────────────────── */
const fmt = (v: number | null | undefined, d = 1): string =>
  v != null ? Number(v).toFixed(d) : '—';
const pct = (v: number | null | undefined): string =>
  v != null ? `${Number(v).toFixed(1)}%` : '—';

const kdaClass = (kda: number | null | undefined): string => {
  if (kda == null) return '';
  if (kda >= 5) return 'ch-kda-gold';
  if (kda >= 4) return 'ch-kda-green';
  if (kda >= 2.5) return 'ch-kda-gray';
  return 'ch-kda-red';
};

const wrClass = (wr: number | null | undefined): string => {
  if (wr == null) return '';
  if (wr >= 50) return 'ch-val-win';
  if (wr >= 40) return 'ch-val-wr40';
  return 'ch-val-loss';
};

const ROLE_LABEL: Record<string, string> = {
  top: 'TOP', jun: 'JNG', jungle: 'JNG', jng: 'JNG',
  mid: 'MID', adc: 'ADC', bot: 'BOT', sup: 'SUP', support: 'SUP',
};

const ROLE_COLORS: Record<string, string> = {
  top: '#ef4444', jun: '#10b981', jungle: '#10b981', jng: '#10b981',
  mid: '#3b82f6', adc: '#f59e0b', bot: '#f59e0b', sup: '#8b5cf6', support: '#8b5cf6',
};

/* ── Interfaces ───────────────────────────────────────── */
interface ChampSplitSummary {
  serie_id?: number;
  league: string;
  year: number;
  split: string;
  games: number;
  wins: number;
  losses: number;
  win_rate: number;
}

interface ChampProfile {
  name: string;
  image_url?: string;
  primary_role?: string;
  career_games?: number;
  career_wins?: number;
  career_losses?: number;
  career_wr?: number;
  career_kda?: number;
  career_avg_kills?: number;
  career_avg_deaths?: number;
  career_avg_assists?: number;
  career_bans?: number;
  patches_played?: number;
  seasons_played?: number;
  unique_players?: number;
  primary_league?: { slug: string; name: string } | null;
  international?: Array<{ league: string; appearances: number; best_wr: number | null; best_year: number | null }>;
  best_split?: ChampSplitSummary | null;
  worst_split?: ChampSplitSummary | null;
  [key: string]: unknown;
}

interface PatchBreakdown {
  patch?: string;
  picks?: number;
  bans?: number;
  wins?: number;
  win_rate?: number;
  total_games?: number;
}

interface CareerSeason {
  serie_id?: number;
  year: number;
  split: string;
  league: string;
  games: number;
  picks?: number;
  bans?: number;
  wins: number;
  losses: number;
  win_rate?: number;
  presence?: number;
  ban_rate?: number;
  kda?: number;
  avg_kills?: number;
  avg_deaths?: number;
  avg_assists?: number;
  avg_cspm?: number;
  avg_dpm?: number;
  avg_gpm?: number;
  kill_participation?: number;
  avg_damage_share?: number;
  fb_rate?: number;
  patch_breakdown?: PatchBreakdown[];
  [key: string]: unknown;
}

interface PlayerEntry {
  name: string;
  image_url?: string;
  team_abbr?: string;
  role?: string;
  games: number;
  win_rate?: number;
  kda?: number;
  avg_kills?: number;
  avg_deaths?: number;
  avg_assists?: number;
  seasons_count?: number;
}

interface RoleEntry {
  role: string;
  games: number;
  percentage: number;
}

interface MatchLogEntry {
  game_id?: number;
  match_id?: number;
  date?: string;
  league?: string;
  player?: string;
  team_abbr?: string;
  opponent_abbr?: string;
  result?: string;
  kills?: number;
  deaths?: number;
  assists?: number;
  kda?: number;
  duration?: number;
  side?: string;
}

interface ChampHistoryData {
  profile: ChampProfile;
  career: CareerSeason[];
  players: PlayerEntry[];
  roleHistory: RoleEntry[];
  matchLog: MatchLogEntry[];
  synergies?: Array<{ name: string; image_url?: string; games: number; wins: number; losses: number; win_rate: number }>;
}

/* ── Chevron ───────────────────────────────────────────── */
function SectionChevron({ open }: { open: boolean }) {
  return (
    <svg className={`ch-section-chevron ${open ? 'open' : ''}`}
      width="12" height="8" viewBox="0 0 12 8" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 1L6 6L11 1" />
    </svg>
  );
}

/* ── Collapsible Section ───────────────────────────────── */
function Section({ title, eyebrow, count, defaultOpen = false, children }: {
  title: string;
  eyebrow?: string;
  count?: number | null;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className="th-section">
      <div className="th-ed-card">
        <div className="th-ed-card-header th-career-toggle" onClick={() => setOpen(o => !o)}>
          <div className="th-card-headline">
            {eyebrow && <span className="th-card-eyebrow">{eyebrow}</span>}
            <h3 className="th-card-title">{title}</h3>
          </div>
          {count != null && (
            <span className="th-career-summary">
              {count} {count === 1 ? 'ENTRY' : 'ENTRIES'}
            </span>
          )}
          <svg
            className={`th-career-chevron ${open ? 'open' : ''}`}
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
        <div className={`th-career-body ${open ? 'open' : ''}`}>
          <div style={{ padding: '20px 24px 24px' }}>{children}</div>
        </div>
      </div>
    </section>
  );
}

/* ── Trend Chart (canvas, multi-tab, scrollable, toggle %/Nº) ── */
const MIN_POINT_SPACING = 120;

interface TrendDataset {
  label: string;
  data: number[];
  color: string;
  format?: (v: number) => string;
  dataAlt?: number[];
  formatAlt?: (v: number) => string;
}

function TrendChart({ labels, datasets }: { labels: string[]; datasets: TrendDataset[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  const [showRaw, setShowRaw] = useState(false);
  const ds = datasets[activeIdx];

  const activeData = showRaw && ds.dataAlt ? ds.dataAlt : ds.data;
  const activeFormat = showRaw && ds.formatAlt ? ds.formatAlt : ds.format;

  const draw = useCallback(() => {
    if (!canvasRef.current || !scrollRef.current || !labels.length || !ds) return;
    const scroll = scrollRef.current;
    const canvas = canvasRef.current;
    const n = labels.length;
    const data = activeData;
    const viewW = Math.round(scroll.getBoundingClientRect().width);

    const measCtx = canvas.getContext('2d');
    if (!measCtx) return;
    measCtx.font = '10px JetBrains Mono, monospace';
    const maxLabelW = Math.max(...labels.map(l => measCtx.measureText(l).width));
    const labelBottom = Math.ceil(maxLabelW * Math.sin(Math.PI / 4)) + 24;

    const padBottom = Math.max(60, labelBottom);
    const H = 220 + padBottom;
    const neededW = 70 + (n - 1) * MIN_POINT_SPACING + 30;
    const W = Math.max(viewW, neededW);

    const dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    const maxV = Math.max(...data) * 1.15 || 1;
    const minV = Math.min(0, ...data);
    const range = maxV - minV || 1;

    const pad = { top: 32, bottom: padBottom, left: 56, right: 24 };
    const cW = W - pad.left - pad.right, cH = H - pad.top - pad.bottom;
    ctx.clearRect(0, 0, W, H);

    const xFor = (i: number) => pad.left + (n > 1 ? (i / (n - 1)) * cW : cW / 2);
    const yFor = (v: number) => pad.top + cH - ((v - minV) / range) * cH;

    // Y-axis gridlines
    const niceStep = (r: number): number => {
      const raw = r / 4;
      const mag = Math.pow(10, Math.floor(Math.log10(raw)));
      const norm = raw / mag;
      return (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
    };
    const step = niceStep(range);
    ctx.font = '10px JetBrains Mono, monospace'; ctx.textAlign = 'right';
    for (let v = 0; v <= maxV; v += step) {
      const y = yFor(v);
      if (y < pad.top - 5 || y > pad.top + cH + 5) continue;
      ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 0.5;
      ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(W - pad.right, y); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.fillText(activeFormat ? activeFormat(v) : (v % 1 === 0 ? String(v) : v.toFixed(1)), pad.left - 8, y + 3);
    }

    // X-axis baseline
    ctx.strokeStyle = 'rgba(255,255,255,0.1)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(pad.left, pad.top + cH); ctx.lineTo(W - pad.right, pad.top + cH); ctx.stroke();

    // X-axis labels (rotated 45°) + vertical ticks
    ctx.font = '10px JetBrains Mono, monospace'; ctx.fillStyle = 'rgba(255,255,255,0.6)';
    for (let i = 0; i < n; i++) {
      const x = xFor(i);
      ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, pad.top + cH); ctx.lineTo(x, pad.top + cH + 6); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.03)'; ctx.lineWidth = 0.5;
      ctx.beginPath(); ctx.moveTo(x, pad.top); ctx.lineTo(x, pad.top + cH); ctx.stroke();
      ctx.save();
      ctx.translate(x, pad.top + cH + 14);
      ctx.rotate(-Math.PI / 4);
      ctx.textAlign = 'right';
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.fillText(labels[i], 0, 0);
      ctx.restore();
    }

    // Area fill
    ctx.beginPath();
    ctx.moveTo(xFor(0), pad.top + cH);
    for (let i = 0; i < n; i++) ctx.lineTo(xFor(i), yFor(data[i]));
    ctx.lineTo(xFor(n - 1), pad.top + cH);
    ctx.closePath();
    ctx.globalAlpha = 0.12; ctx.fillStyle = ds.color; ctx.fill(); ctx.globalAlpha = 1;

    // Line
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const x = xFor(i), y = yFor(data[i]);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.strokeStyle = ds.color; ctx.lineWidth = 2.5; ctx.stroke();

    // Dots + value labels
    ctx.font = '11px JetBrains Mono, monospace'; ctx.textAlign = 'center';
    for (let i = 0; i < n; i++) {
      const x = xFor(i), y = yFor(data[i]);
      ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fillStyle = '#0d1117'; ctx.fill();
      ctx.beginPath(); ctx.arc(x, y, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = ds.color; ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      const valText = activeFormat ? activeFormat(data[i]) : (data[i] % 1 === 0 ? String(data[i]) : data[i].toFixed(1));
      ctx.fillText(valText, x, y - 12);
    }
  }, [labels, ds, activeData, activeFormat]);

  useEffect(() => { const raf = requestAnimationFrame(() => draw()); return () => cancelAnimationFrame(raf); }, [draw]);
  useEffect(() => {
    const ro = new ResizeObserver(() => draw());
    if (scrollRef.current) ro.observe(scrollRef.current);
    return () => ro.disconnect();
  }, [draw]);

  return (
    <div className="ch-trend">
      <div className="ch-trend-header">
        <div className="ch-trend-tabs">
          {datasets.map((d, i) => (
            <button key={i} className={`ch-trend-tab ${activeIdx === i ? 'ch-trend-tab-active' : ''}`}
              onClick={() => setActiveIdx(i)} style={activeIdx === i ? { color: d.color, borderBottomColor: d.color } : {}}>
              {d.label}
            </button>
          ))}
        </div>
        {ds.dataAlt && (
          <button className="ch-trend-toggle" onClick={() => setShowRaw(p => !p)}
            title={showRaw ? 'Ver porcentajes' : 'Ver números'}>
            {showRaw ? 'Nº' : '%'}
          </button>
        )}
      </div>
      <div className="ch-trend-scroll" ref={scrollRef}>
        <canvas ref={canvasRef} style={{ display: 'block' }} />
      </div>
    </div>
  );
}

/* ── Presence Chart (multi-line: picks / bans / presence) ── */
const PRESENCE_COLORS: Record<string, string> = { picks: '#10b981', bans: '#ef4444', presence: '#8b5cf6' };
const PRESENCE_MIN_SPACING = 80;

interface PatchData {
  patch: string;
  picks: number;
  bans: number;
  total_games: number;
}

function PresenceChart({ patches }: { patches: PatchData[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [hidden, setHidden] = useState<Record<string, boolean>>({});
  const layoutRef = useRef<{ n: number; xFor: (i: number) => number; pad: { top: number; left: number; right: number; bottom: number }; W: number; H: number } | null>(null);

  const toggleLine = (key: string) => setHidden(p => ({ ...p, [key]: !p[key] }));

  const draw = useCallback(() => {
    if (!canvasRef.current || !scrollRef.current || !patches.length) return;
    const scroll = scrollRef.current;
    const canvas = canvasRef.current;
    const n = patches.length;
    const viewW = Math.round(scroll.getBoundingClientRect().width);

    const series = [
      { key: 'picks', label: 'Picks', color: PRESENCE_COLORS.picks,
        data: patches.map(p => p.total_games > 0 ? p.picks / p.total_games * 100 : 0) },
      { key: 'bans', label: 'Bans', color: PRESENCE_COLORS.bans,
        data: patches.map(p => p.total_games > 0 ? p.bans / p.total_games * 100 : 0) },
      { key: 'presence', label: 'Presencia', color: PRESENCE_COLORS.presence,
        data: patches.map(p => p.total_games > 0 ? (p.picks + p.bans) / p.total_games * 100 : 0) },
    ].filter(s => !hidden[s.key]);

    const measCtx = canvas.getContext('2d');
    if (!measCtx) return;
    measCtx.font = '10px JetBrains Mono, monospace';
    const labels = patches.map(p => p.patch);
    const maxLabelW = Math.max(...labels.map(l => measCtx.measureText(l).width));
    const labelBottom = Math.ceil(maxLabelW * Math.sin(Math.PI / 4)) + 24;

    const padBottom = Math.max(50, labelBottom);
    const H = 240 + padBottom;
    const neededW = 70 + (n - 1) * PRESENCE_MIN_SPACING + 30;
    const W = Math.max(viewW, neededW);

    const dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    const allVals = series.flatMap(s => s.data);
    const maxV = (Math.max(...allVals) || 1) * 1.15;
    const range = maxV || 1;

    const pad = { top: 28, bottom: padBottom, left: 56, right: 24 };
    const cW = W - pad.left - pad.right, cH = H - pad.top - pad.bottom;
    ctx.clearRect(0, 0, W, H);

    const xFor = (i: number) => pad.left + (n > 1 ? (i / (n - 1)) * cW : cW / 2);
    const yFor = (v: number) => pad.top + cH - (v / range) * cH;

    // Store layout for tooltip
    layoutRef.current = { n, xFor, pad, W, H };

    // Y gridlines
    const niceStep = (r: number): number => { const raw = r / 5; const mag = Math.pow(10, Math.floor(Math.log10(raw))); const norm = raw / mag; return (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag; };
    const step = niceStep(maxV);
    ctx.font = '10px JetBrains Mono, monospace'; ctx.textAlign = 'right';
    for (let v = 0; v <= maxV; v += step) {
      const y = yFor(v);
      if (y < pad.top - 5 || y > pad.top + cH + 5) continue;
      ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 0.5;
      ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(W - pad.right, y); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.fillText(v.toFixed(0) + '%', pad.left - 8, y + 3);
    }

    // X baseline
    ctx.strokeStyle = 'rgba(255,255,255,0.1)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(pad.left, pad.top + cH); ctx.lineTo(W - pad.right, pad.top + cH); ctx.stroke();

    // X labels
    ctx.font = '10px JetBrains Mono, monospace'; ctx.fillStyle = 'rgba(255,255,255,0.55)';
    for (let i = 0; i < n; i++) {
      const x = xFor(i);
      ctx.strokeStyle = 'rgba(255,255,255,0.03)'; ctx.lineWidth = 0.5;
      ctx.beginPath(); ctx.moveTo(x, pad.top); ctx.lineTo(x, pad.top + cH); ctx.stroke();
      ctx.save(); ctx.translate(x, pad.top + cH + 12); ctx.rotate(-Math.PI / 4);
      ctx.textAlign = 'right'; ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.fillText(labels[i], 0, 0); ctx.restore();
    }

    // Draw each line
    for (const s of series) {
      ctx.beginPath(); ctx.moveTo(xFor(0), pad.top + cH);
      for (let i = 0; i < n; i++) ctx.lineTo(xFor(i), yFor(s.data[i]));
      ctx.lineTo(xFor(n - 1), pad.top + cH); ctx.closePath();
      ctx.globalAlpha = 0.07; ctx.fillStyle = s.color; ctx.fill(); ctx.globalAlpha = 1;

      ctx.beginPath();
      for (let i = 0; i < n; i++) { const x = xFor(i), y = yFor(s.data[i]); i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); }
      ctx.strokeStyle = s.color; ctx.lineWidth = 2; ctx.stroke();

      if (n <= 60) {
        for (let i = 0; i < n; i++) {
          const x = xFor(i), y = yFor(s.data[i]);
          ctx.beginPath(); ctx.arc(x, y, 3.5, 0, Math.PI * 2);
          ctx.fillStyle = '#0d1117'; ctx.fill();
          ctx.beginPath(); ctx.arc(x, y, 2.5, 0, Math.PI * 2);
          ctx.fillStyle = s.color; ctx.fill();
        }
      }
    }
  }, [patches, hidden]);

  useEffect(() => { const raf = requestAnimationFrame(() => draw()); return () => cancelAnimationFrame(raf); }, [draw]);
  useEffect(() => {
    const ro = new ResizeObserver(() => draw());
    if (scrollRef.current) ro.observe(scrollRef.current);
    return () => ro.disconnect();
  }, [draw]);

  // Tooltip on hover
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const layout = layoutRef.current;
    const tip = tooltipRef.current;
    const scroll = scrollRef.current;
    if (!layout || !tip || !scroll || !patches.length) { if (tip) tip.style.opacity = '0'; return; }

    const rect = scroll.getBoundingClientRect();
    const mx = e.clientX - rect.left + scroll.scrollLeft;
    const my = e.clientY - rect.top;

    // Find closest patch index
    let closest = 0;
    let closestDist = Infinity;
    for (let i = 0; i < layout.n; i++) {
      const dist = Math.abs(mx - layout.xFor(i));
      if (dist < closestDist) { closestDist = dist; closest = i; }
    }

    if (closestDist > 40 || my < layout.pad.top - 10 || my > layout.H - layout.pad.bottom + 10) {
      tip.style.opacity = '0';
      return;
    }

    const p = patches[closest];
    const presence = p.picks + p.bans;
    const picksPct = p.total_games > 0 ? (p.picks / p.total_games * 100).toFixed(1) : '0.0';
    const bansPct = p.total_games > 0 ? (p.bans / p.total_games * 100).toFixed(1) : '0.0';
    const presPct = p.total_games > 0 ? (presence / p.total_games * 100).toFixed(1) : '0.0';

    tip.innerHTML = `
      <div class="ch-tooltip-title">${p.patch}</div>
      <div class="ch-tooltip-row"><span class="ch-tooltip-dot" style="background:${PRESENCE_COLORS.picks}"></span>Picks: <b>${p.picks}</b> <span class="ch-tooltip-pct">(${picksPct}%)</span></div>
      <div class="ch-tooltip-row"><span class="ch-tooltip-dot" style="background:${PRESENCE_COLORS.bans}"></span>Bans: <b>${p.bans}</b> <span class="ch-tooltip-pct">(${bansPct}%)</span></div>
      <div class="ch-tooltip-row"><span class="ch-tooltip-dot" style="background:${PRESENCE_COLORS.presence}"></span>Presencia: <b>${presence}</b> <span class="ch-tooltip-pct">(${presPct}%)</span></div>
      <div class="ch-tooltip-games">${p.total_games} partidas totales</div>
    `;

    // Position tooltip relative to the visible scroll area
    const visibleX = e.clientX - rect.left;
    const tipW = 190;
    let left = visibleX + 16;
    if (left + tipW > rect.width) left = visibleX - tipW - 16;
    if (left < 4) left = 4;
    tip.style.left = left + 'px';
    tip.style.top = Math.max(8, my - 60) + 'px';
    tip.style.opacity = '1';
  }, [patches]);

  const handleMouseLeave = () => {
    if (tooltipRef.current) tooltipRef.current.style.opacity = '0';
  };

  return (
    <div className="ch-trend">
      <div className="ch-trend-header">
        {[
          { key: 'picks', label: 'Picks', color: PRESENCE_COLORS.picks },
          { key: 'bans', label: 'Bans', color: PRESENCE_COLORS.bans },
          { key: 'presence', label: 'Presencia', color: PRESENCE_COLORS.presence },
        ].map(s => (
          <button key={s.key}
            className={`ch-trend-tab ${hidden[s.key] ? 'ch-trend-tab-off' : 'ch-trend-tab-active'}`}
            onClick={() => toggleLine(s.key)}>
            <span className="ch-trend-tab-dot" style={{ background: hidden[s.key] ? 'rgba(255,255,255,0.2)' : s.color }} />
            {s.label}
          </button>
        ))}
      </div>
      <div className="ch-trend-chart-wrap" onMouseMove={handleMouseMove} onMouseLeave={handleMouseLeave} style={{ position: 'relative' }}>
        <div className="ch-trend-scroll" ref={scrollRef}>
          <canvas ref={canvasRef} style={{ display: 'block' }} />
        </div>
        <div ref={tooltipRef} className="ch-chart-tooltip" style={{ opacity: 0 }} />
      </div>
    </div>
  );
}

/* ── Role Distribution Donut (estilo overview/dragons) ──────────────────── */
function RoleDonut({ roleHistory, totalGames }: { roleHistory: RoleEntry[]; totalGames: number }) {
  const [hovered, setHovered] = useState<{ role: string; games: number; percentage: number } | null>(null);
  const filtered = roleHistory.filter(r => r.games > 0);
  return (
    <svg className="ch-role-donut" viewBox="0 0 100 100" width={210} height={210}>
      {(() => {
        let offset = 0;
        const circumference = 2 * Math.PI * 40;
        return filtered.map(r => {
          const percent = totalGames > 0 ? r.games / totalGames : 0;
          const dash = percent * circumference;
          const color = ROLE_COLORS[r.role?.toLowerCase()] ?? '#666';
          const circle = (
            <circle
              key={r.role}
              cx="50" cy="50" r="40"
              fill="none"
              stroke={color}
              strokeWidth="12"
              strokeDasharray={`${dash} ${circumference}`}
              strokeDashoffset={-offset}
              transform="rotate(-90 50 50)"
              style={{ cursor: 'pointer', transition: 'stroke-width 0.2s' }}
              onMouseEnter={() => setHovered({ role: r.role, games: r.games, percentage: r.percentage })}
              onMouseLeave={() => setHovered(null)}
            />
          );
          offset += dash;
          return circle;
        });
      })()}
      <circle cx="50" cy="50" r="28" fill="var(--surface-card)" pointerEvents="none" />
      {hovered ? (
        <>
          <text x="50" y="43" textAnchor="middle" fill={ROLE_COLORS[hovered.role?.toLowerCase()] ?? '#fff'} fontSize="8" fontWeight="800" style={{ textTransform: 'uppercase' }}>
            {ROLE_LABEL[hovered.role?.toLowerCase()] ?? hovered.role}
          </text>
          <text x="50" y="53" textAnchor="middle" fill="white" fontSize="11" fontWeight="700">{hovered.games}</text>
          <text x="50" y="61" textAnchor="middle" fill="rgba(255,255,255,0.5)" fontSize="5.5">{hovered.percentage.toFixed(1)}%</text>
        </>
      ) : (
        <>
          <text x="50" y="47" textAnchor="middle" fill="white" fontSize="11" fontWeight="700">{totalGames}</text>
          <text x="50" y="57" textAnchor="middle" fill="rgba(255,255,255,0.5)" fontSize="6">TOTAL</text>
        </>
      )}
    </svg>
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

export default function ChampionHistoricalClient({ league, name, accent, glow }: Props) {
  const router = useRouter();

  const [data, setData] = useState<ChampHistoryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedSeasons, setExpandedSeasons] = useState<Set<string>>(new Set());
  const [expandedMatchId, setExpandedMatchId] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(null);
    (async () => {
      try {
        const d = await clientFetch<ChampHistoryData>(`/api/v1/pg/champion-history/${encodeURIComponent(name)}`);
        if (!cancelled) setData(d);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Error');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [name]);

  if (loading) return (
    <div className="ch-container" style={{ '--nav-accent': accent, '--nav-glow': glow } as React.CSSProperties}>
      <div className="ch-loading"><div className="ch-spinner" /><span>CARGANDO HISTORIAL...</span></div>
    </div>
  );
  if (error || !data) return (
    <div className="ch-container" style={{ '--nav-accent': accent, '--nav-glow': glow } as React.CSSProperties}>
      <div className="ch-error">No se encontró el historial del campeón.</div>
    </div>
  );

  const { profile, career, players, roleHistory, matchLog, synergies } = data;

  const toggleSeason = (sId: string) => {
    setExpandedSeasons(prev => {
      const next = new Set(prev);
      if (next.has(sId)) { next.delete(sId); setExpandedMatchId(null); }
      else next.add(sId);
      return next;
    });
  };

  /* ── Trend data (aggregated by PATCH across all seasons) ── */
  const trendData = (() => {
    const patchMap: Record<string, { patch: string; picks: number; wins: number; bans: number; total_games: number; kda_sum: number; presence_sum: number; ban_rate_sum: number; seasons: number }> = {};
    for (const s of career) {
      const pbs = s.patch_breakdown ?? [];
      for (const pb of pbs) {
        const p = pb.patch;
        if (!p) continue;
        const picks = pb.picks ?? 0;
        const wins = pb.wins ?? 0;
        if (!patchMap[p]) patchMap[p] = { patch: p, picks: 0, wins: 0, bans: 0, total_games: 0, kda_sum: 0, presence_sum: 0, ban_rate_sum: 0, seasons: 0 };
        patchMap[p].picks += picks;
        patchMap[p].wins += wins;
        patchMap[p].bans += (pb.bans ?? 0);
        patchMap[p].total_games = Math.max(patchMap[p].total_games, pb.total_games ?? 0);
        if (picks > 0) {
          patchMap[p].kda_sum += ((s.kda as number) ?? 0) * picks;
          patchMap[p].presence_sum += ((s.presence as number) ?? 0) * picks;
          patchMap[p].ban_rate_sum += ((s.ban_rate as number) ?? 0) * picks;
          patchMap[p].seasons++;
        }
      }
    }

    const parsePatch = (p: string): number => {
      const parts = p.split('.').map(Number);
      return (parts[0] || 0) * 1000 + (parts[1] || 0);
    };
    const patches = Object.values(patchMap).sort((a, b) => parsePatch(a.patch) - parsePatch(b.patch));
    if (patches.length < 2) return null;

    const patchToDate = (p: string): string => {
      const parts = p.split('.').map(Number);
      const major = parts[0] || 0;
      const minor = parts[1] || 1;
      const year = 2010 + major;
      const quarter = minor <= 6 ? 1 : minor <= 12 ? 2 : minor <= 18 ? 3 : 4;
      return `Q${quarter},${year}`;
    };

    const labels = patches.map(p => `${p.patch} (${patchToDate(p.patch)})`);
    return {
      labels,
      patches: patches as PatchData[],
      datasets: [
        { label: 'Win Rate', data: patches.map(p => p.picks > 0 ? (p.wins / p.picks * 100) : 0), color: '#3b82f6', format: (v: number) => v.toFixed(1) + '%', dataAlt: patches.map(p => p.wins), formatAlt: (v: number) => Math.round(v) + 'W' },
        { label: 'Picks', data: patches.map(p => p.picks), color: '#10b981', format: (v: number) => String(Math.round(v)) },
        { label: 'KDA', data: patches.map(p => p.picks > 0 ? (p.kda_sum / p.picks) : 0), color: '#f59e0b', format: (v: number) => v.toFixed(2) },
        { label: 'Presence', data: patches.map(p => p.picks > 0 ? (p.presence_sum / p.picks) : 0), color: '#8b5cf6', format: (v: number) => v.toFixed(1) + '%', dataAlt: patches.map(p => p.picks + p.bans), formatAlt: (v: number) => Math.round(v) + ' P+B' },
        { label: 'Ban Rate', data: patches.map(p => p.picks > 0 ? (p.ban_rate_sum / p.picks) : 0), color: '#ef4444', format: (v: number) => v.toFixed(1) + '%', dataAlt: patches.map(p => p.bans), formatAlt: (v: number) => Math.round(v) + ' bans' },
      ] as TrendDataset[],
    };
  })();

  /* ── Stats bars ─────────────────────────────────────── */
  const statsData = (() => {
    if (!career.length) return [];
    const totalGames = career.reduce((s, c) => s + c.games, 0);
    if (!totalGames) return [];
    const weightedAvg = (key: string) => career.reduce((s, c) => s + (((c[key] as number) ?? 0) * c.games), 0) / totalGames;
    return [
      { label: 'KDA', value: weightedAvg('kda'), max: 6, format: (v: number) => v.toFixed(2) },
      { label: 'Win Rate', value: weightedAvg('win_rate'), max: 100, format: (v: number) => v.toFixed(1) + '%' },
      { label: 'CS/M', value: weightedAvg('avg_cspm'), max: 10, format: (v: number) => v.toFixed(1) },
      { label: 'DPM', value: weightedAvg('avg_dpm'), max: 800, format: (v: number) => Math.round(v).toString() },
      { label: 'GPM', value: weightedAvg('avg_gpm'), max: 500, format: (v: number) => Math.round(v).toString() },
      { label: 'KP%', value: weightedAvg('kill_participation'), max: 100, format: (v: number) => v.toFixed(1) + '%' },
      { label: 'DMG%', value: weightedAvg('avg_damage_share'), max: 40, format: (v: number) => v.toFixed(1) + '%' },
    ];
  })();

  /* ── Per-league stats (top 4 regions) ─────────────── */
  const MAJOR_LEAGUES = [
    { slugs: ['LEAGUE-OF-LEGENDS-LEC', 'LEAGUE-OF-LEGENDS-EU-LCS'], label: 'LEC', color: '#01e4be' },
    { slugs: ['LEAGUE-OF-LEGENDS-LCS', 'LEAGUE-OF-LEGENDS-NA-LCS'], label: 'LCS', color: '#a5a1ff' },
    { slugs: ['LEAGUE-OF-LEGENDS-LCK-CHAMPIONS-KOREA'], label: 'LCK', color: '#1a56ff' },
    { slugs: ['LEAGUE-OF-LEGENDS-LPL-CHINA'], label: 'LPL', color: '#e52420' },
  ];

  const leagueMarkers = MAJOR_LEAGUES.map(lg => {
    const rows = career.filter(c => lg.slugs.includes(c.league));
    const games = rows.reduce((s, c) => s + c.games, 0);
    if (!games) return null;
    const wAvg = (key: string) => rows.reduce((s, c) => s + (((c[key] as number) ?? 0) * c.games), 0) / games;
    return {
      label: lg.label, color: lg.color, games,
      values: {
        'KDA': wAvg('kda'),
        'Win Rate': wAvg('win_rate'),
        'CS/M': wAvg('avg_cspm'),
        'DPM': wAvg('avg_dpm'),
        'GPM': wAvg('avg_gpm'),
        'KP%': wAvg('kill_participation'),
        'DMG%': wAvg('avg_damage_share'),
      } as Record<string, number>,
    };
  }).filter(Boolean) as { label: string; color: string; games: number; values: Record<string, number> }[];

  return (
    <div
      className="ch-container th-page"
      style={{
        '--nav-accent': getLeagueColors(league).accent,
        '--nav-glow': getLeagueColors(league).glow,
        '--p2-league-accent': getLeagueColors(league).accent,
      } as React.CSSProperties}
    >

      {/* ═══════════ HERO IDENTITY (editorial) ═══════════ */}
      <section className="th-section">
        <div className="th-ed-card">
          <div className="th-ed-card-header">
            <div className="th-hero-layout">
              <div>
                {profile.image_url ? (
                  <Image
                    src={champImg(profile.image_url) ?? ''}
                    alt={profile.name}
                    className="th-hero-logo"
                    width={256}
                    height={256}
                    style={{ borderRadius: '50%', border: '2px solid var(--border-card)', objectFit: 'cover' }}
                    onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                    unoptimized
                  />
                ) : (
                  <div className="th-hero-logo" style={{ borderRadius: '50%', background: 'var(--surface-inset)' }} />
                )}
              </div>

              <div>
                <span className="th-ed-eyebrow">Champion History</span>
                <h1 className="th-ed-hero-name">{profile.name}</h1>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                  {profile.primary_role && (
                    <span className="ph-hero-role-badge">
                      <Image src={ROLE_ICON(profile.primary_role as string)} alt={profile.primary_role as string} width={48} height={48} />
                      {ROLE_LABEL[(profile.primary_role as string)?.toLowerCase()] ?? (profile.primary_role as string)}
                    </span>
                  )}
                  {roleHistory && roleHistory.filter(r => r.percentage >= 15).length >= 2 && (
                    <span className="ph-hero-role-badge" style={{ color: 'var(--th-accent)' }}>FLEX PICK</span>
                  )}
                </div>
              </div>

              <div className="th-hero-meta">
                <div className="th-ed-meta">
                  <span>{profile.seasons_played ?? 0} {profile.seasons_played === 1 ? 'SEASON' : 'SEASONS'}</span>
                  <span className="pipe">·</span>
                  <span>{profile.patches_played ?? 0} PATCHES</span>
                  <span className="pipe">·</span>
                  <span>{profile.unique_players ?? 0} PLAYERS</span>
                </div>
              </div>
            </div>
          </div>

          <div className="th-hero-kpi-strip" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
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
              <span className={`th-hero-kpi-value ${kdaClass(profile.career_kda)}`}>{fmt(profile.career_kda, 2)}</span>
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
              <span className="th-hero-kpi-label">Bans</span>
              <span className="th-hero-kpi-value">{profile.career_bans ?? 0}</span>
            </div>
          </div>
        </div>
      </section>

      {/* ═══════ SINERGIAS (full-width, siempre visible) ═══════ */}
      {synergies && synergies.length > 0 && (
        <section className="th-section">
          <div className="th-ed-card">
            <div className="th-ed-card-header">
              <div className="th-card-headline">
                <span className="th-card-eyebrow">Synergies</span>
                <h3 className="th-card-title">Campeones con Más Sinergia</h3>
              </div>
            </div>
            <div className="ch-synergy-grid">
              {synergies.map((s, i) => (
                <div key={`${s.name}-${i}`} className="ch-synergy-card"
                  onClick={() => router.push(`/${league}/champion_historical/${encodeURIComponent(s.name)}`)}
                >
                  {s.image_url ? (
                    <Image
                      src={champImg(s.image_url) ?? ''}
                      alt={s.name}
                      className="ch-synergy-photo"
                      width={128}
                      height={128}
                      onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')}
                    />
                  ) : (
                    <div className="ch-synergy-photo" />
                  )}
                  <span className="ch-synergy-name">{s.name}</span>
                  <div className="ch-synergy-stats">
                    <span className={`ch-synergy-wr ${wrClass(s.win_rate)}`}>{pct(s.win_rate)}</span>
                    <div className="ch-synergy-record">
                      <span className="w">{s.wins}W</span>
                      <span className="l">{s.losses}L</span>
                    </div>
                    <span>{s.games} juntos</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ═══════ PRESENCIA POR PARCHE ═══════ */}
      {trendData?.patches && (
        <Section eyebrow="Presence" title="Presencia por Parche" defaultOpen={false}>
          <PresenceChart patches={trendData.patches} />
        </Section>
      )}

      {/* ═══════ DISTRIBUCIÓN DE ROLES ═══════ */}
      {roleHistory && roleHistory.length > 1 && (
        <Section eyebrow="Roles" title="Distribución de Roles" count={roleHistory.length} defaultOpen={false}>
          <div className="ch-role-donut-layout">
            <div className="ch-role-donut-list">
              {roleHistory.map((r, i) => {
                const color = ROLE_COLORS[r.role?.toLowerCase()] ?? '#666';
                const label = ROLE_LABEL[r.role?.toLowerCase()] ?? r.role;
                return (
                  <div key={i} className="ch-role-donut-item">
                    <span className="ch-role-donut-dot" style={{ background: color }} />
                    <Image src={ROLE_ICON(r.role)} alt={r.role} width={20} height={20} />
                    <span className="ch-role-donut-name">{label}</span>
                    <span className="ch-role-donut-count">{r.games}</span>
                    <span className="ch-role-donut-pct" style={{ color }}>{r.percentage.toFixed(1)}%</span>
                  </div>
                );
              })}
            </div>
            <div className="ch-role-donut-chart">
              <RoleDonut roleHistory={roleHistory} totalGames={profile.career_games ?? 0} />
            </div>
          </div>
        </Section>
      )}


            {/* ═══════ MEJORES JUGADORES ═══════ */}
      {players && players.length > 0 && (
        <Section eyebrow="Signature Players" title="Mejores Jugadores" count={players.length} defaultOpen={false}>
          <div className="ch-table-wrap">
            <table className="ch-table">
              <thead>
                <tr>
                  <th></th>
                  <th>Jugador</th>
                  <th>Equipo</th>
                  <th>Rol</th>
                  <th>Partidas</th>
                  <th>Win Rate</th>
                  <th>KDA</th>
                  <th>K / D / A</th>
                  <th>Temporadas</th>
                </tr>
              </thead>
              <tbody>
                {players.slice(0, 30).map((p, i) => (
                  <tr key={i} className="ch-player-row"
                    onClick={() => router.push(`/${league}/player_historical/${encodeURIComponent(p.name)}`)}>
                    <td>
                      <Image className="ch-player-img"
                        src={p.image_url || ''}
                        alt={p.name} width={96} height={96} onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                    </td>
                    <td className="ch-player-name">{p.name}</td>
                    <td>{p.team_abbr}</td>
                    <td>
                      {p.role && <Image src={ROLE_ICON(p.role)} alt={p.role} width={48} height={48} className="ch-role-icon-sm" />}
                      {ROLE_LABEL[p.role?.toLowerCase() ?? ''] ?? p.role}
                    </td>
                    <td>{p.games}</td>
                    <td className={wrClass(p.win_rate)}>{pct(p.win_rate)}</td>
                    <td className={kdaClass(p.kda)}>{fmt(p.kda, 2)}</td>
                    <td>{fmt(p.avg_kills)} / {fmt(p.avg_deaths)} / {fmt(p.avg_assists)}</td>
                    <td>{p.seasons_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {/* ═══════ ESTADÍSTICAS GENERALES ═══════ */}
      {statsData.length > 0 && (
        <Section eyebrow="Career" title="Estadísticas Generales" defaultOpen={false}>
          {leagueMarkers.length > 0 && (
            <div className="ch-stat-legend">
              <span className="ch-stat-legend-item"><span className="ch-stat-legend-dot" style={{ background: 'var(--ch-accent)' }} />Global</span>
              {leagueMarkers.map(lg => (
                <span key={lg.label} className="ch-stat-legend-item">
                  <span className="ch-stat-legend-dot" style={{ background: lg.color }} />
                  {lg.label}
                </span>
              ))}
            </div>
          )}
          <div className="ch-stats-grid" onMouseLeave={() => {
            const tip = document.getElementById('ch-stats-tip');
            if (tip) tip.style.opacity = '0';
          }}>
            {statsData.map((s, i) => (
              <div key={i} className="ch-stat-row"
                onMouseMove={(e) => {
                  const tip = document.getElementById('ch-stats-tip');
                  if (!tip) return;
                  let html = `<div class="ch-tooltip-title">${s.label}</div>`;
                  html += `<div class="ch-tooltip-row"><span class="ch-tooltip-dot" style="background:var(--ch-accent)"></span>Global: <b>${s.format(s.value)}</b></div>`;
                  leagueMarkers.forEach(lg => {
                    html += `<div class="ch-tooltip-row"><span class="ch-tooltip-dot" style="background:${lg.color}"></span>${lg.label}: <b>${s.format(lg.values[s.label])}</b> <span class="ch-tooltip-pct">(${lg.games} games)</span></div>`;
                  });
                  tip.innerHTML = html;
                  tip.style.opacity = '1';
                  const grid = e.currentTarget.closest('.ch-stats-grid') as HTMLElement;
                  if (!grid) return;
                  const rect = grid.getBoundingClientRect();
                  let x = e.clientX - rect.left + 14;
                  let y = e.clientY - rect.top - 10;
                  const tipW = tip.offsetWidth;
                  if (x + tipW > rect.width) x = e.clientX - rect.left - tipW - 14;
                  tip.style.left = x + 'px';
                  tip.style.top = y + 'px';
                }}
                onMouseLeave={() => {
                  const tip = document.getElementById('ch-stats-tip');
                  if (tip) tip.style.opacity = '0';
                }}>
                <span className="ch-stat-label">{s.label}</span>
                <div className="ch-stat-bar-wrap">
                  <div className="ch-stat-bar" style={{ width: `${Math.min(100, (s.value / s.max) * 100)}%` }} />
                  {leagueMarkers.map(lg => {
                    const v = lg.values[s.label];
                    if (v == null) return null;
                    const pct = Math.min(100, (v / s.max) * 100);
                    return (
                      <div key={lg.label} className="ch-stat-marker" style={{ left: `${pct}%`, background: lg.color }} />
                    );
                  })}
                </div>
                <span className="ch-stat-value">{s.format(s.value)}</span>
              </div>
            ))}
            <div id="ch-stats-tip" className="ch-chart-tooltip" style={{ opacity: 0 }} />
          </div>
        </Section>
      )}

      {/* ═══════ HISTORIAL POR TEMPORADA ═══════ */}
      {career.length > 0 && (
        <Section eyebrow="Career Timeline" title="Historial por Temporada" count={career.length} defaultOpen={false}>
          <div className="ch-table-wrap">
            <table className="ch-table ch-season-table">
              <thead>
                <tr>
                  <th>Liga</th>
                  <th>Temporada</th>
                  <th>Picks</th>
                  <th>Bans</th>
                  <th>Presence</th>
                  <th>W</th>
                  <th>L</th>
                  <th>Win Rate</th>
                  <th>KDA</th>
                  <th>K / D / A</th>
                  <th>CS/M</th>
                  <th>DPM</th>
                </tr>
              </thead>
              <tbody>
                {career.map((s, i) => (
                  <tr key={i} className="ch-season-row">
                    <td className="ch-league-cell">{s.league.replace(/^LEAGUE-OF-LEGENDS-/i, '')}</td>
                    <td>{s.year} {s.split}</td>
                    <td>{s.picks ?? s.games}</td>
                    <td>{s.bans}</td>
                    <td>{pct(s.presence)}</td>
                    <td className="ch-val-win">{s.wins}</td>
                    <td className="ch-val-loss">{s.losses}</td>
                    <td className={wrClass(s.win_rate)}>{pct(s.win_rate)}</td>
                    <td className={kdaClass(s.kda)}>{fmt(s.kda, 2)}</td>
                    <td>{fmt(s.avg_kills)} / {fmt(s.avg_deaths)} / {fmt(s.avg_assists)}</td>
                    <td>{fmt(s.avg_cspm)}</td>
                    <td>{fmt(s.avg_dpm, 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {/* ═══════ PARTIDAS RECIENTES ═══════ */}
      {matchLog && matchLog.length > 0 && (
        <Section eyebrow="Match Log" title="Partidas Recientes" count={matchLog.length}>
          <div className="ch-table-wrap">
            <table className="ch-table ch-matchlog-table">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Liga</th>
                  <th>Jugador</th>
                  <th>Equipo</th>
                  <th>vs</th>
                  <th>Resultado</th>
                  <th>K/D/A</th>
                  <th>KDA</th>
                  <th>Duración</th>
                  <th>Lado</th>
                </tr>
              </thead>
              <tbody>
                {matchLog.map((m, i) => {
                  const mId = m.match_id ?? m.game_id;
                  const isDetailOpen = expandedMatchId === mId;
                  return (
                    <React.Fragment key={i}>
                      <tr className={`ch-game-row-clickable ${isDetailOpen ? 'ch-game-row-active' : ''} ${m.result === 'W' ? 'ch-detail-win' : 'ch-detail-loss'}`}
                        onClick={() => setExpandedMatchId(isDetailOpen ? null : (mId ?? null))}>
                        <td>{m.date ? new Date(m.date).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: '2-digit' }) : '—'}</td>
                        <td>{(m.league ?? '—').replace(/^LEAGUE-OF-LEGENDS-/i, '')}</td>
                        <td className="ch-player-name">{m.player ?? '—'}</td>
                        <td>{m.team_abbr ?? '—'}</td>
                        <td>{m.opponent_abbr ?? '—'}</td>
                        <td className={m.result === 'W' ? 'ch-val-win' : 'ch-val-loss'}>{m.result ?? '—'}</td>
                        <td>{m.kills ?? 0}/{m.deaths ?? 0}/{m.assists ?? 0}</td>
                        <td className={kdaClass(m.kda)}>{fmt(m.kda, 2)}</td>
                        <td>{m.duration ? `${Math.floor(m.duration / 60)}:${String(Math.floor(m.duration % 60)).padStart(2, '0')}` : '—'}</td>
                        <td className={m.side === 'blue' ? 'ch-side-blue' : 'ch-side-red'}>{m.side ?? '—'}</td>
                      </tr>
                      {isDetailOpen && mId && (
                        <tr className="ch-full-match-row">
                          <td colSpan={10}>
                            <div className="ch-full-match-container">
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
        </Section>
      )}

    </div>
  );
}
