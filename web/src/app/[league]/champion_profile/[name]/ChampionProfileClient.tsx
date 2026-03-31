'use client';

import Image from 'next/image';
import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { champImg, teamImg } from '@/lib/constants';
import { clientFetch } from '@/lib/clientFetch';
import { useFilters } from '@/context/FilterContext';
import AnimatedNumber from '@/components/AnimatedNumber';

/* ──────────────────────────────────────────────
   TYPES
────────────────────────────────────────────── */
interface MatchupEntry {
  champion: string;
  image_url?: string;
  games: number;
  win_rate?: number;
}

interface PlayerEntry {
  name: string;
  team_abbr?: string;
  team_logo_url?: string;
  games: number;
  kda?: number;
  win_rate?: number;
}

interface ItemEntry {
  id?: string;
  name: string;
  image_url?: string;
  count: number;
  frequency?: number;
  win_rate?: number;
}

interface KeystoneEntry {
  name: string;
  image_url?: string;
  count: number;
  pct?: number;
}

interface PatchEntry {
  patch: string;
  picks: number;
  win_rate?: number;
}

interface MatchLogEntry {
  game_id?: string;
  result: string;
  player?: string;
  team_abbr?: string;
  team_logo?: string;
  opponent_abbr?: string;
  opponent_logo?: string;
  kills?: number;
  deaths?: number;
  assists?: number;
  side?: string;
  duration?: number;
  date?: string;
}

interface ChampionProfileData {
  name: string;
  image_url?: string;
  position?: string;
  position_breakdown?: Record<string, number>;
  games?: number;
  wins?: number;
  win_rate?: number;
  presence?: number;
  kda?: number;
  avg_kills?: number;
  avg_deaths?: number;
  avg_assists?: number;
  kill_participation?: number;
  fb_kills?: number;
  fb_assists?: number;
  fb_rate?: number;
  double_kills?: number;
  triple_kills?: number;
  quadra_kills?: number;
  penta_kills?: number;
  avg_dpm?: number;
  avg_gpm?: number;
  avg_cspm?: number;
  avg_dtaken_per_min?: number;
  avg_physical_dpm?: number;
  avg_magic_dpm?: number;
  avg_true_dpm?: number;
  avg_damage_share?: number;
  avg_gold_share?: number;
  avg_duration_formatted?: string;
  blue_picks?: number;
  red_picks?: number;
  blue_wr?: number;
  red_wr?: number;
  blue_wins?: number;
  red_wins?: number;
  ban_rate?: number;
  ban_rate_blue?: number;
  ban_rate_red?: number;
  bans?: number;
  bans_blue?: number;
  bans_red?: number;
  ban_turn_avg?: number;
  pick_rate?: number;
  players_count?: number;
  avg_wards_placed?: number;
  avg_wards_destroyed?: number;
  avg_ctrl_wards?: number;
  avg_wpm?: number;
  avg_wcpm?: number;
  best_matchups?: MatchupEntry[];
  worst_matchups?: MatchupEntry[];
  played_by?: PlayerEntry[];
  top_items?: ItemEntry[];
  bottom_items?: ItemEntry[];
  keystones?: KeystoneEntry[];
  patch_breakdown?: PatchEntry[];
  match_log?: MatchLogEntry[];
  [key: string]: unknown;
}

/* ──────────────────────────────────────────────
   HELPERS
────────────────────────────────────────────── */
const fmt = (v: number | null | undefined, d = 1): string => (v != null ? Number(v).toFixed(d) : '—');
const pct = (v: number | null | undefined): string => (v != null ? `${Number(v).toFixed(1)}%` : '—');
const getMedal = (i: number): string => ['medal-gold', 'medal-silver', 'medal-bronze'][i] || '';

const wrClass = (wr: number | null | undefined): string => {
  if (wr == null) return '';
  if (wr >= 55) return 'wr-high';
  if (wr >= 45) return 'wr-mid';
  return 'wr-low';
};

const kdaColor = (kda: number | null | undefined): string => {
  if (kda == null) return '';
  if (kda >= 5) return '#fbbf24';
  if (kda >= 4) return '#4ade80';
  if (kda >= 2.5) return '#94a3b8';
  return '#f87171';
};

/* ── SVG KDA Ring ── */
function KDARing({ kda, size = 110, stroke = 8 }: { kda: number; size?: number; stroke?: number }) {
  const radius = (size - stroke) / 2;
  const circ = 2 * Math.PI * radius;
  const maxKda = 8;
  const ratio = Math.min((kda ?? 0) / maxKda, 1);
  const offset = circ * (1 - ratio);
  const color = kdaColor(kda);
  return (
    <svg width={size} height={size} className="p60-kda-ring-svg">
      <circle cx={size / 2} cy={size / 2} r={radius}
        fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={stroke} />
      <circle cx={size / 2} cy={size / 2} r={radius}
        fill="none" stroke={color} strokeWidth={stroke}
        strokeDasharray={circ} strokeDashoffset={offset}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: 'stroke-dashoffset 0.8s ease' }} />
      <text x={size / 2} y={size / 2 - 6} textAnchor="middle" dominantBaseline="central"
        fill={color} fontSize="24" fontWeight="900" fontFamily="'JetBrains Mono', monospace">
        {fmt(kda)}
      </text>
      <text x={size / 2} y={size / 2 + 14} textAnchor="middle" dominantBaseline="central"
        fill="#64748b" fontSize="8" fontWeight="800" letterSpacing="1.5">
        KDA RATIO
      </text>
    </svg>
  );
}

/* ── SVG Damage Donut ── */
function DmgDonut({ physical, magic, trueDmg, size = 120, stroke = 14 }: { physical: number; magic: number; trueDmg: number; size?: number; stroke?: number }) {
  const total = (physical || 0) + (magic || 0) + (trueDmg || 0);
  if (!total) return null;
  const r = (size - stroke) / 2;
  const C = 2 * Math.PI * r;
  const pLen = (physical / total) * C;
  const mLen = (magic / total) * C;
  const tLen = (trueDmg / total) * C;
  return (
    <svg width={size} height={size} className="p60-dmg-donut-svg">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={stroke} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#f87171"
        strokeWidth={stroke} strokeDasharray={`${pLen} ${C - pLen}`}
        strokeDashoffset={0} strokeLinecap="butt" transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#60a5fa"
        strokeWidth={stroke} strokeDasharray={`${mLen} ${C - mLen}`}
        strokeDashoffset={-pLen} strokeLinecap="butt" transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#fbbf24"
        strokeWidth={stroke} strokeDasharray={`${tLen} ${C - tLen}`}
        strokeDashoffset={-(pLen + mLen)} strokeLinecap="butt" transform={`rotate(-90 ${size / 2} ${size / 2})`} />
    </svg>
  );
}

/* ── Rank Bar ── */
function RankBar({ label, value, max, color = '#fbbf24' }: { label: string; value: number; max: number; color?: string }) {
  const pctVal = max ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div className="p60-rankbar">
      <div className="p60-rankbar-info">
        <span className="p60-rankbar-label">{label}</span>
      </div>
      <div className="p60-rankbar-track">
        <div className="p60-rankbar-fill" style={{ width: `${pctVal}%`, background: color }} />
        <div className="p60-rankbar-marker" style={{ left: `${pctVal}%` }} />
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════
   MAIN COMPONENT
══════════════════════════════════════════════ */
interface Props {
  league: string;
  name: string;
  accent: string;
}

export default function ChampionProfileClient({ league, name, accent }: Props) {
  const router = useRouter();

  const [champ, setChamp] = useState<ChampionProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isFirstLoad = useRef(true);

  const filters = useFilters();

  useEffect(() => {
    if (!filters.ready) return;
    let cancelled = false;
    const isRefresh = !isFirstLoad.current;
    if (isRefresh) setRefreshing(true); else setLoading(true);

    (async () => {
      try {
        const fqs = new URLSearchParams();
        fqs.set('league', league.toUpperCase());
        if (filters.year) fqs.set('year', String(filters.year));
        if (filters.split) fqs.set('split', filters.split);
        if (filters.stage && filters.stage !== 'all') fqs.set('stage', filters.stage);

        const data: ChampionProfileData = await clientFetch<ChampionProfileData>(
          `/api/v1/pg/champions/${encodeURIComponent(name)}?${fqs}`
        );
        if (!cancelled) { setChamp(data); isFirstLoad.current = false; }
      } catch (err: unknown) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Error desconocido');
      } finally {
        if (!cancelled) { setLoading(false); setRefreshing(false); }
      }
    })();
    return () => { cancelled = true; };
  }, [name, league, filters.ready, filters.year, filters.split, filters.stage]);

  if (loading && !champ) return <div style={{ color: '#64748b', textAlign: 'center', padding: 80, fontSize: 14 }}>Cargando perfil del campeón…</div>;
  if (error && !champ) return <div style={{ color: '#f87171', textAlign: 'center', padding: 80 }}>{error}</div>;
  if (!champ) return <div style={{ color: '#f87171', textAlign: 'center', padding: 80 }}>Campeón no encontrado</div>;

  /* ── Derived values ── */
  const losses = (champ.games || 0) - (champ.wins || 0);
  const physDpm = champ.avg_physical_dpm || 0;
  const magicDpm = champ.avg_magic_dpm || 0;
  const trueDpm = champ.avg_true_dpm || 0;
  const totalDpm = physDpm + magicDpm + trueDpm;
  const physPct = totalDpm ? ((physDpm / totalDpm) * 100).toFixed(1) : '0';
  const magicPct = totalDpm ? ((magicDpm / totalDpm) * 100).toFixed(1) : '0';
  const truePct = totalDpm ? ((trueDpm / totalDpm) * 100).toFixed(1) : '0';

  const blueTotal = champ.blue_picks || 0;
  const redTotal = champ.red_picks || 0;
  const sideTotal = blueTotal + redTotal;
  const bluePct = sideTotal ? ((blueTotal / sideTotal) * 100) : 50;

  const positions = champ.position_breakdown || {};
  const posEntries = Object.entries(positions).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);

  return (
    <div className="p60-container" style={{ opacity: refreshing ? 0.6 : 1, transition: 'opacity 0.3s ease' }}>

      {/* ══════════════════════════════════════
          HERO
      ══════════════════════════════════════ */}
      <div className="p60-hero">
        <div className="p60-hero-left">
          <div className="p60-hero-icon-wrap">
            <Image src={champImg(champ.image_url) ?? ''} className="p60-hero-icon" alt={champ.name} width={64} height={64}
              onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')} />
          </div>
          <div className="p60-hero-text">
            <h1 className="p60-hero-name">{champ.name}</h1>
            <div className="p60-hero-meta">
              {champ.position && <span className="p60-hero-role">{champ.position.toUpperCase()}</span>}
              <span className="p60-hero-tag">CHAMPION</span>
            </div>
            <div className="p60-hero-wl">
              <span className="w"><AnimatedNumber value={champ.wins || 0} decimals={0} />W</span>{' – '}
              <span className="l"><AnimatedNumber value={losses} decimals={0} />L</span>
              <span className="p60-hero-games"><AnimatedNumber value={champ.games || 0} decimals={0} /> partidas</span>
            </div>
          </div>
        </div>

        <div className="p60-hero-stats">
          <div className="p60-hstat">
            <span className={`p60-hstat-val ${wrClass(champ.win_rate)}`}>
              {champ.win_rate != null ? <><AnimatedNumber value={champ.win_rate} decimals={1} />%</> : '—'}
            </span>
            <span className="p60-hstat-lbl">WIN RATE</span>
          </div>
          <div className="p60-hstat">
            <span className="p60-hstat-val">
              {champ.presence != null ? <><AnimatedNumber value={Number(champ.presence)} decimals={1} />%</> : '—'}
            </span>
            <span className="p60-hstat-lbl">PRESENCIA</span>
          </div>
          <div className="p60-hstat">
            <span className="p60-hstat-val">
              {champ.kda != null ? <AnimatedNumber value={Number(champ.kda)} decimals={1} /> : '—'}
            </span>
            <span className="p60-hstat-lbl">KDA</span>
          </div>
          <div className="p60-hstat">
            <span className="p60-hstat-val">
              {champ.avg_kills != null
                ? <><AnimatedNumber value={Number(champ.avg_kills)} decimals={1} />/<AnimatedNumber value={Number(champ.avg_deaths)} decimals={1} />/<AnimatedNumber value={Number(champ.avg_assists)} decimals={1} /></>
                : '—'}
            </span>
            <span className="p60-hstat-lbl">AVG K / D / A</span>
          </div>
        </div>
      </div>

      {/* ══════════════════════════════════════
          ROW 1 (3 cols): KDA | PER MINUTE | DAMAGE
      ══════════════════════════════════════ */}
      <div className="p60-grid-3">

        {/* ── KDA Card ── */}
        <div className="p60-card">
          <div className="p60-card-hdr">
            <span className="p60-card-title">KDA BREAKDOWN</span>
            <span className="p60-card-sub">KILLS · DEATHS · ASSISTS</span>
          </div>
          <div className="p60-card-body">
            <div className="p60-kda-ring-row">
              <KDARing kda={Number(champ.kda)} />
              <div className="p60-kda-right">
                <div className="p60-kda-pills">
                  <div className="p60-kda-pill kill"><span className="p60-pill-val"><AnimatedNumber value={Number(champ.avg_kills) || 0} decimals={1} /></span><span className="p60-pill-lbl">KILLS</span></div>
                  <div className="p60-kda-pill death"><span className="p60-pill-val"><AnimatedNumber value={Number(champ.avg_deaths) || 0} decimals={1} /></span><span className="p60-pill-lbl">DEATHS</span></div>
                  <div className="p60-kda-pill assist"><span className="p60-pill-val"><AnimatedNumber value={Number(champ.avg_assists) || 0} decimals={1} /></span><span className="p60-pill-lbl">ASSISTS</span></div>
                </div>
                <div className="p60-kp-bar-wrap">
                  <div className="p60-kp-header">
                    <span className="p60-kp-label">KILL PART.</span>
                    <span className="p60-kp-val">{champ.kill_participation != null ? <><AnimatedNumber value={Number(champ.kill_participation)} decimals={1} />%</> : '—'}</span>
                  </div>
                  <div className="p60-kp-track">
                    <div className="p60-kp-fill" style={{ width: `${champ.kill_participation ?? 0}%` }} />
                  </div>
                </div>
              </div>
            </div>
            <div className="p60-kda-bottom">
              <div className="p60-fb-grid">
                <div className="p60-fb-item">
                  <span className="p60-fb-val accent">{champ.fb_kills ?? '—'}</span>
                  <span className="p60-fb-lbl">FB KILLS</span>
                </div>
                <div className="p60-fb-item">
                  <span className="p60-fb-val danger">{champ.fb_assists ?? '—'}</span>
                  <span className="p60-fb-lbl">FB DEATHS</span>
                </div>
                <div className="p60-fb-item">
                  <span className="p60-fb-val">{pct(champ.fb_rate)}</span>
                  <span className="p60-fb-lbl">FB RATE</span>
                </div>
              </div>
              <div className="p60-multikills">
                {([['DBL', champ.double_kills], ['TRP', champ.triple_kills], ['QDR', champ.quadra_kills], ['PNT', champ.penta_kills]] as [string, number | undefined][]).map(([label, val]) => (
                  <div key={label} className="p60-mk-chip">
                    <span className="p60-mk-val">{val ?? 0}</span>
                    <span className="p60-mk-lbl">{label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* ── Per Minute Card ── */}
        <div className="p60-card">
          <div className="p60-card-hdr">
            <span className="p60-card-title">PRODUCCIÓN / MIN</span>
            <span className="p60-card-sub">RENDIMIENTO POR MINUTO</span>
          </div>
          <div className="p60-card-body">
            <div className="p60-pm-rows">
              {[
                { val: champ.avg_dpm, lbl: 'DPM', desc: 'Daño por minuto', max: 800 },
                { val: champ.avg_gpm, lbl: 'GPM', desc: 'Oro por minuto', max: 500 },
                { val: champ.avg_cspm, lbl: 'CSPM', desc: 'CS por minuto', max: 12 },
                { val: champ.avg_dtaken_per_min, lbl: 'DTPM', desc: 'Daño recibido / min', max: 800 },
              ].map((s) => (
                <div className="p60-pm-stat-row" key={s.lbl}>
                  <div className="p60-pm-left">
                    <span className="p60-pm-val">{s.val != null ? <AnimatedNumber value={Number(s.val)} decimals={1} /> : '—'}</span>
                    <span className="p60-pm-lbl">{s.lbl}</span>
                  </div>
                  <div className="p60-pm-right">
                    <span className="p60-pm-desc">{s.desc}</span>
                    <RankBar label="" value={s.val || 0} max={s.max} />
                  </div>
                </div>
              ))}
            </div>
            <div className="p60-share-strip">
              <div className="p60-share-chip">
                <span className="p60-share-val">{champ.avg_damage_share != null ? <><AnimatedNumber value={Number(champ.avg_damage_share)} decimals={1} />%</> : '—'}</span>
                <span className="p60-share-lbl">DMG SHARE</span>
              </div>
              <div className="p60-share-chip">
                <span className="p60-share-val">{champ.avg_gold_share != null ? <><AnimatedNumber value={Number(champ.avg_gold_share)} decimals={1} />%</> : '—'}</span>
                <span className="p60-share-lbl">GOLD SHARE</span>
              </div>
              <div className="p60-share-chip">
                <span className="p60-share-val">{champ.avg_duration_formatted || '—'}</span>
                <span className="p60-share-lbl">AVG DURATION</span>
              </div>
            </div>
          </div>
        </div>

        {/* ── Damage Breakdown ── */}
        <div className="p60-card">
          <div className="p60-card-hdr">
            <span className="p60-card-title">TIPO DE DAÑO</span>
            <span className="p60-card-sub">DISTRIBUCIÓN DPM</span>
          </div>
          <div className="p60-card-body p60-dmg-body">
            <div className="p60-dmg-legend">
              {[
                { label: 'PHYSICAL', val: physDpm, pctV: physPct, color: '#f87171' },
                { label: 'MAGIC', val: magicDpm, pctV: magicPct, color: '#60a5fa' },
                { label: 'TRUE', val: trueDpm, pctV: truePct, color: '#fbbf24' },
              ].map((d) => (
                <div className="p60-dmg-legend-row" key={d.label}>
                  <div className="p60-dmg-dot" style={{ background: d.color }} />
                  <span className="p60-dmg-legend-label">{d.label}</span>
                  <span className="p60-dmg-legend-val" style={{ color: d.color }}>{fmt(d.val, 0)}</span>
                  <span className="p60-dmg-legend-pct">{d.pctV}%</span>
                </div>
              ))}
            </div>
            <div className="p60-dmg-donut-wrap">
              <DmgDonut physical={physDpm} magic={magicDpm} trueDmg={trueDpm} />
            </div>
          </div>
        </div>
      </div>

      {/* ══════════════════════════════════════
          ROW 2 (3 cols): SIDE | BANS | VISION/ECONOMY
      ══════════════════════════════════════ */}
      <div className="p60-grid-3">

        {/* ── Side Performance ── */}
        <div className="p60-card">
          <div className="p60-card-hdr">
            <span className="p60-card-title">WIN RATE POR LADO</span>
            <span className="p60-card-sub">BLUE SIDE VS RED SIDE</span>
          </div>
          <div className="p60-card-body">
            <div className="p60-side-versus">
              <div className="p60-side-col">
                <span className="p60-side-label">BLUE</span>
                <span className="p60-side-wr-big blue">
                  {blueTotal > 0 ? <><AnimatedNumber value={champ.blue_wr ?? 0} decimals={1} />%</> : '—'}
                </span>
                <span className="p60-side-games-sm"><AnimatedNumber value={blueTotal} decimals={0} />G · <AnimatedNumber value={champ.blue_wins ?? 0} decimals={0} />W</span>
              </div>
              <div className="p60-side-vs-center">
                <div className="p60-side-vs-bar">
                  <div className="p60-side-vs-fill blue" style={{ width: `${bluePct}%` }} />
                  <div className="p60-side-vs-fill red" style={{ width: `${100 - bluePct}%` }} />
                </div>
                <span className="p60-side-vs-text">VS</span>
              </div>
              <div className="p60-side-col">
                <span className="p60-side-label">RED</span>
                <span className="p60-side-wr-big red">
                  {redTotal > 0 ? <><AnimatedNumber value={champ.red_wr ?? 0} decimals={1} />%</> : '—'}
                </span>
                <span className="p60-side-games-sm"><AnimatedNumber value={redTotal} decimals={0} />G · <AnimatedNumber value={champ.red_wins ?? 0} decimals={0} />W</span>
              </div>
            </div>

            {posEntries.length > 0 && (
              <div className="p60-side-extras">
                {posEntries.map(([role, val]) => (
                  <div className="p60-side-extra-item" key={role}>
                    <span className="p60-side-extra-val">{val}%</span>
                    <span className="p60-side-extra-lbl">{role.toUpperCase()}</span>
                  </div>
                ))}
              </div>
            )}

            <div className="p60-side-extras" style={{ borderTop: '1px solid var(--p60-border)', paddingTop: 12, justifyContent: 'center' }}>
              <div className="p60-side-extra-item">
                <span className="p60-side-extra-val accent">{champ.players_count ?? '—'}</span>
                <span className="p60-side-extra-lbl">JUGADORES</span>
              </div>
            </div>
          </div>
        </div>

        {/* ── Ban Stats ── */}
        <div className="p60-card">
          <div className="p60-card-hdr">
            <span className="p60-card-title">ESTADÍSTICAS DE BAN</span>
            <span className="p60-card-sub">FRECUENCIA POR LADO</span>
          </div>
          <div className="p60-card-body">
            <div className="p60-ban-rows">
              <div className="p60-ban-stat-row">
                <span className="p60-ban-stat-lbl">Ban Rate Total</span>
                <span className="p60-ban-stat-val">{pct(champ.ban_rate)}</span>
              </div>
              <div className="p60-ban-stat-row">
                <span className="p60-ban-stat-lbl">Blue Side</span>
                <span className="p60-ban-stat-val">{pct(champ.ban_rate_blue)}</span>
              </div>
              <div className="p60-ban-stat-row">
                <span className="p60-ban-stat-lbl">Red Side</span>
                <span className="p60-ban-stat-val">{pct(champ.ban_rate_red)}</span>
              </div>
              <div className="p60-ban-stat-row">
                <span className="p60-ban-stat-lbl">Total Bans</span>
                <span className="p60-ban-stat-val">{champ.bans ?? '—'}</span>
              </div>
              <div className="p60-ban-stat-row">
                <span className="p60-ban-stat-lbl">Bans Blue</span>
                <span className="p60-ban-stat-val">{champ.bans_blue ?? '—'}</span>
              </div>
              <div className="p60-ban-stat-row">
                <span className="p60-ban-stat-lbl">Bans Red</span>
                <span className="p60-ban-stat-val">{champ.bans_red ?? '—'}</span>
              </div>
            </div>
            <div className="p60-ban-context">
              <div className="p60-ban-ctx-item">
                <span className="p60-ban-ctx-val">{fmt(champ.ban_turn_avg, 1)}</span>
                <span className="p60-ban-ctx-lbl">AVG BAN TURN</span>
              </div>
              <div className="p60-ban-ctx-item">
                <span className="p60-ban-ctx-val">{pct(champ.pick_rate)}</span>
                <span className="p60-ban-ctx-lbl">PICK RATE</span>
              </div>
              <div className="p60-ban-ctx-item">
                <span className="p60-ban-ctx-val">{pct(champ.presence)}</span>
                <span className="p60-ban-ctx-lbl">PRESENCIA</span>
              </div>
            </div>
          </div>
        </div>

        {/* ── Vision & Economy ── */}
        <div className="p60-card">
          <div className="p60-card-hdr">
            <span className="p60-card-title">VISIÓN & ECONOMÍA</span>
            <span className="p60-card-sub">PROMEDIOS POR PARTIDA</span>
          </div>
          <div className="p60-card-body">
            <div className="p60-pm-rows">
              {[
                { val: champ.avg_wards_placed, lbl: 'WPG', desc: 'Wards colocados / partida', max: 30 },
                { val: champ.avg_wards_destroyed, lbl: 'WDG', desc: 'Wards destruidos / partida', max: 15 },
                { val: champ.avg_ctrl_wards, lbl: 'CWG', desc: 'Control wards / partida', max: 10 },
                { val: champ.avg_wpm, lbl: 'WPM', desc: 'Wards colocados / minuto', max: 1.5 },
                { val: champ.avg_wcpm, lbl: 'WCPM', desc: 'Wards limpiados / minuto', max: 0.8 },
              ].map((s) => (
                <div className="p60-pm-stat-row" key={s.lbl}>
                  <div className="p60-pm-left">
                    <span className="p60-pm-val">{fmt(s.val, s.max > 5 ? 1 : 2)}</span>
                    <span className="p60-pm-lbl">{s.lbl}</span>
                  </div>
                  <div className="p60-pm-right">
                    <span className="p60-pm-desc">{s.desc}</span>
                    <RankBar label="" value={s.val || 0} max={s.max} color="#60a5fa" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ══════════════════════════════════════
          ROW 3 (2 cols): BEST MATCHUPS | WORST MATCHUPS
      ══════════════════════════════════════ */}
      <div className="p60-grid-2">
        {/* Best Matchups */}
        <div className="p60-card">
          <div className="p60-card-hdr">
            <span className="p60-card-title">MEJORES MATCHUPS</span>
            <span className="p60-card-sub">MAYOR WIN RATE CONTRA</span>
          </div>
          <div className="p60-card-body">
            {(champ.best_matchups?.length ?? 0) > 0 ? (
              <div className="p60-matchup-list">
                {champ.best_matchups!.map((m) => (
                  <div key={m.champion} className="p60-matchup-row"
                    onClick={() => router.push(`/${league}/champion_profile/${encodeURIComponent(m.champion)}`)}>
                    <div className="p60-matchup-icon">
                      <Image src={m.image_url || ''} alt={m.champion} width={32} height={32}
                        onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')} />
                    </div>
                    <span className="p60-matchup-name">{m.champion}</span>
                    <span className="p60-matchup-games">{m.games}G</span>
                    <div className="p60-matchup-bar-wrap">
                      <div className="p60-matchup-bar-fill pos" style={{ width: `${m.win_rate ?? 0}%` }} />
                    </div>
                    <span className="p60-matchup-wr pos">{m.win_rate}%</span>
                  </div>
                ))}
              </div>
            ) : <p className="p60-no-data">Sin datos de matchups</p>}
          </div>
        </div>

        {/* Worst Matchups */}
        <div className="p60-card">
          <div className="p60-card-hdr">
            <span className="p60-card-title">PEORES MATCHUPS</span>
            <span className="p60-card-sub">MENOR WIN RATE CONTRA</span>
          </div>
          <div className="p60-card-body">
            {(champ.worst_matchups?.length ?? 0) > 0 ? (
              <div className="p60-matchup-list">
                {champ.worst_matchups!.map((m) => (
                  <div key={m.champion} className="p60-matchup-row"
                    onClick={() => router.push(`/${league}/champion_profile/${encodeURIComponent(m.champion)}`)}>
                    <div className="p60-matchup-icon">
                      <Image src={m.image_url || ''} alt={m.champion} width={32} height={32}
                        onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')} />
                    </div>
                    <span className="p60-matchup-name">{m.champion}</span>
                    <span className="p60-matchup-games">{m.games}G</span>
                    <div className="p60-matchup-bar-wrap">
                      <div className="p60-matchup-bar-fill neg" style={{ width: `${m.win_rate ?? 0}%` }} />
                    </div>
                    <span className="p60-matchup-wr neg">{m.win_rate}%</span>
                  </div>
                ))}
              </div>
            ) : <p className="p60-no-data">Sin datos de matchups</p>}
          </div>
        </div>
      </div>

      {/* ══════════════════════════════════════
          ROW 4 (3 cols): TOP PLAYERS | ITEMS | KEYSTONES + PATCHES
      ══════════════════════════════════════ */}
      <div className="p60-grid-3">

        {/* ── Top Players ── */}
        <div className="p60-card">
          <div className="p60-card-hdr">
            <span className="p60-card-title">TOP PLAYERS</span>
            <span className="p60-card-sub">MÁS PARTIDAS CON ESTE CAMPEÓN</span>
          </div>
          <div className="p60-card-body p60-players-body">
            <div className="p60-players-hdr">
              <span>#</span>
              <span>JUGADOR</span>
              <span className="p60-players-hdr-c">G</span>
              <span className="p60-players-hdr-c">KDA</span>
              <span className="p60-players-hdr-r">WR</span>
            </div>
            {(champ.played_by?.length ?? 0) > 0
              ? champ.played_by!.slice(0, 7).map((tp, i) => (
                <div key={tp.name} className={`p60-player-row ${getMedal(i)}`}
                  onClick={() => router.push(`/${league}/player_profile/${encodeURIComponent(tp.name)}?team=${encodeURIComponent(tp.team_abbr || '')}`)}>
                  <span className="p60-pr-idx">{i + 1}</span>
                  <div className="p60-pr-info">
                    {tp.team_abbr && (
                      <Image src={teamImg(tp.team_logo_url, tp.team_abbr, league)}
                        className="p60-pr-logo" alt={tp.team_abbr} width={24} height={24}
                        onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')} loading="lazy" />
                    )}
                    <span className="p60-pr-name">{tp.name}</span>
                  </div>
                  <span className="p60-pr-games">{tp.games}</span>
                  <span className="p60-pr-kda">{fmt(tp.kda)}</span>
                  <span className={`p60-pr-wr ${wrClass(tp.win_rate)}`}>
                    {tp.win_rate != null ? `${tp.win_rate}%` : '—'}
                  </span>
                </div>
              ))
              : <p className="p60-no-data">Sin datos de jugadores</p>
            }
          </div>
        </div>

        {/* ── Top Items ── */}
        <div className="p60-card">
          <div className="p60-card-hdr">
            <span className="p60-card-title">ITEMS CORE</span>
            <span className="p60-card-sub">MÁS Y MENOS COMPRADOS</span>
          </div>
          <div className="p60-card-body">
            {(champ.top_items?.length ?? 0) > 0 ? (
              <>
                <div style={{ fontSize: 10, fontWeight: 900, color: 'var(--p60-accent)', letterSpacing: 2, marginBottom: 8 }}>
                  MÁS COMPRADOS
                </div>
                <div className="p60-items-grid">
                  {champ.top_items!.slice(0, 6).map((item) => (
                    <div className="p60-item-cell" key={item.id || item.name}>
                      {item.image_url && (
                        <Image src={item.image_url} className="p60-item-icon" alt={item.name} width={28} height={28}
                          onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')} />
                      )}
                      <div className="p60-item-info">
                        <span className="p60-item-name">{item.name}</span>
                        <div className="p60-item-stats">
                          <span className="p60-item-freq">{item.count}x ({fmt(item.frequency, 0)}%)</span>
                          <span className={`p60-item-wr ${wrClass(item.win_rate)}`}>{item.win_rate}%</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                {(champ.bottom_items?.length ?? 0) > 0 && (
                  <>
                    <div style={{ fontSize: 10, fontWeight: 900, color: '#f87171', letterSpacing: 2, marginTop: 16, marginBottom: 8, paddingTop: 12, borderTop: '1px solid var(--p60-border)' }}>
                      MENOS COMPRADOS
                    </div>
                    <div className="p60-items-grid">
                      {champ.bottom_items!.map((item) => (
                        <div className="p60-item-cell p60-item-least" key={item.id || item.name}>
                          {item.image_url && (
                            <Image src={item.image_url} className="p60-item-icon" alt={item.name} width={28} height={28}
                              onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')} />
                          )}
                          <div className="p60-item-info">
                            <span className="p60-item-name">{item.name}</span>
                            <div className="p60-item-stats">
                              <span className="p60-item-freq">{item.count}x ({fmt(item.frequency, 0)}%)</span>
                              <span className={`p60-item-wr ${wrClass(item.win_rate)}`}>{item.win_rate}%</span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </>
            ) : <p className="p60-no-data">Sin datos de items</p>}
          </div>
        </div>

        {/* ── Keystones + Patch Breakdown ── */}
        <div className="p60-card">
          <div className="p60-card-hdr">
            <span className="p60-card-title">RUNAS & PARCHES</span>
            <span className="p60-card-sub">KEYSTONES Y RENDIMIENTO POR PARCHE</span>
          </div>
          <div className="p60-card-body">
            {(champ.keystones?.length ?? 0) > 0 && (
              <>
                <div style={{ fontSize: 10, fontWeight: 900, color: 'var(--p60-accent)', letterSpacing: 2, marginBottom: 8 }}>
                  KEYSTONES
                </div>
                <div className="p60-keystones-grid" style={{ marginBottom: 16 }}>
                  {champ.keystones!.slice(0, 6).map((k) => (
                    <div className="p60-keystone-chip" key={k.name}>
                      <div className="p60-key-chip-top">
                        {k.image_url && (
                          <Image src={k.image_url} className="p60-key-chip-icon" alt={k.name} width={28} height={28}
                            onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')} />
                        )}
                        <span className="p60-key-chip-name">{k.name}</span>
                      </div>
                      <div className="p60-key-chip-stats">
                        <span className="p60-key-chip-count">{k.count}x</span>
                        <span className="p60-key-chip-pct">{k.pct}%</span>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {(champ.patch_breakdown?.length ?? 0) > 0 && (
              <>
                <div style={{ fontSize: 10, fontWeight: 900, color: 'var(--p60-accent)', letterSpacing: 2, marginBottom: 8, paddingTop: 12, borderTop: '1px solid var(--p60-border)' }}>
                  PARCHES
                </div>
                <div className="p60-patch-rows">
                  {champ.patch_breakdown!.map((p) => (
                    <div className="p60-patch-row" key={p.patch}>
                      <span className="p60-patch-name">{p.patch}</span>
                      <span className="p60-patch-games">{p.picks}G</span>
                      <span className={`p60-patch-wr ${wrClass(p.win_rate)}`}>{p.win_rate}%</span>
                    </div>
                  ))}
                </div>
              </>
            )}

            {!(champ.keystones?.length) && !(champ.patch_breakdown?.length) && (
              <p className="p60-no-data">Sin datos</p>
            )}
          </div>
        </div>
      </div>

      {/* ══════════════════════════════════════
          MATCH HISTORY (full-width)
      ══════════════════════════════════════ */}
      <div className="p60-card p60-history-card">
        <div className="p60-card-hdr">
          <span className="p60-card-title">HISTORIAL COMPLETO</span>
          <span className="p60-card-sub">TODAS LAS PARTIDAS DEL SPLIT</span>
        </div>
        <div className="p60-hm-header">
          <span className="p60-hm-hcol">RESULT</span>
          <span className="p60-hm-hcol-player">JUGADOR</span>
          <span className="p60-hm-hcol">VS</span>
          <span className="p60-hm-hcol">KDA</span>
          <span className="p60-hm-hcol">SIDE</span>
          <span className="p60-hm-hcol">KDA R.</span>
          <span className="p60-hm-hcol">DURACIÓN</span>
          <span className="p60-hm-hcol-date">FECHA</span>
        </div>
        <div className="p60-history-list">
          {(champ.match_log?.length ?? 0) > 0
            ? champ.match_log!.map((m, i) => {
              const d = m.date ? new Date(m.date) : null;
              const day = d ? d.getDate() : '';
              const month = d ? d.toLocaleString('es', { month: 'short' }).toUpperCase() : '';
              const kdaR = m.deaths ? (((m.kills ?? 0) + (m.assists ?? 0)) / m.deaths).toFixed(1) : 'P';
              const dur = m.duration ? `${Math.floor(m.duration)}:${String(Math.round((m.duration % 1) * 60)).padStart(2, '0')}` : '—';
              return (
                <div key={m.game_id ?? i} className={`p60-hm-row ${m.result === 'W' ? 'win' : 'loss'}`}>
                  <div className="p60-hm-result">
                    <div className={`p60-hm-badge ${m.result === 'W' ? 'win' : 'loss'}`}>
                      {m.result === 'W' ? 'W' : 'L'}
                    </div>
                  </div>
                  <div className="p60-hm-player">
                    {m.team_logo && (
                      <Image src={m.team_logo || ''} className="p60-hm-team-logo" alt={m.team_abbr || ''} width={20} height={20}
                        onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')} />
                    )}
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <span className="p60-hm-player-name">{m.player}</span>
                      <span className="p60-hm-player-team">{m.team_abbr ?? ''}</span>
                    </div>
                  </div>
                  <div className="p60-hm-vs">
                    {m.opponent_logo && (
                      <Image src={m.opponent_logo || ''} className="p60-hm-opp-logo" alt={m.opponent_abbr || ''} width={20} height={20}
                        onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')} />
                    )}
                    <span className="p60-hm-opp-name">{m.opponent_abbr ?? '???'}</span>
                  </div>
                  <div className="p60-hm-kda">
                    <span className="p60-hm-kda-line">
                      <span className="p60-hm-k">{m.kills ?? 0}</span>
                      <span className="p60-hm-sep">/</span>
                      <span className="p60-hm-d">{m.deaths ?? 0}</span>
                      <span className="p60-hm-sep">/</span>
                      <span className="p60-hm-a">{m.assists ?? 0}</span>
                    </span>
                  </div>
                  <div className={`p60-hm-side ${m.side === 'blue' ? 'blue' : 'red'}`}>
                    {m.side === 'blue' ? 'BLUE' : 'RED'}
                  </div>
                  <div className="p60-hm-stat">
                    <span className="p60-hm-stat-val">{kdaR}</span>
                  </div>
                  <div className="p60-hm-stat">
                    <span className="p60-hm-stat-val">{dur}</span>
                  </div>
                  <div className="p60-hm-date">
                    <span className="p60-hm-date-day">{day}</span>
                    <span className="p60-hm-date-month">{month}</span>
                  </div>
                </div>
              );
            })
            : <p className="p60-no-data">Sin historial disponible</p>
          }
        </div>
      </div>

    </div>
  );
}
