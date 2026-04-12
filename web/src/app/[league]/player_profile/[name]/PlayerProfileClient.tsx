'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Image from 'next/image';
import { teamImg, champImg, getWinRateClass } from '@/lib/constants';
import { clientFetch } from '@/lib/clientFetch';
import { useFilters } from '@/context/FilterContext';
import React from 'react';
import AnimatedNumber from '@/components/AnimatedNumber';

/* ── Type Definitions ──────────────────────────────────────────────── */
interface Champion {
  name: string;
  image_url?: string;
  games?: number;
  kda?: string | number;
  win_rate?: string | number;
}

interface Keystone {
  name: string;
  image_url?: string;
  count?: number;
  pct?: number;
}

interface Shards {
  offense?: { name: string; image_url?: string };
  flex?: { name: string; image_url?: string };
  defense?: { name: string; image_url?: string };
}

interface Runes {
  keystone?: string;
  keystone_img?: string;
  secondary_path?: string;
  secondary_path_img?: string;
  shards?: Shards;
}

interface Champion2 {
  name?: string;
  image_url?: string;
}

interface Opponent {
  abbr?: string;
  logo?: string;
}

interface Match {
  game_id?: string;
  match_id?: string;
  result?: 'W' | 'L' | boolean | string;
  champion?: Champion2;
  kills?: number;
  deaths?: number;
  assists?: number;
  cspm?: number | string;
  dpm?: number | string;
  gpm?: number | string;
  date?: string;
  runes?: Runes;
  opponent?: Opponent;
}

interface PlayerProfile {
  name: string;
  image_url?: string;
  position?: string;
  team_logo_url?: string;
  team_abbr?: string;
  team_name?: string;
  win_rate?: string | number;
  kda?: string | number;
  avg_cspm?: string | number;
  avg_dpm?: string | number;
  avg_gpm?: string | number;
  games?: string | number;
  wins?: string | number;
  avg_kills?: string | number;
  avg_deaths?: string | number;
  avg_assists?: string | number;
  kill_participation?: string | number;
  first_blood_kills?: number;
  first_blood_victim?: number;
  fb_rate?: string | number;
  double_kills?: number;
  triple_kills?: number;
  quadra_kills?: number;
  penta_kills?: number;
  avg_gold_diff_15?: string | number;
  avg_cs_diff_15?: string | number;
  avg_level_diff_13?: string | number;
  avg_cs_diff_13?: string | number;
  avg_cs_diff_20?: string | number;
  avg_cs_diff_25?: string | number;
  avg_level_diff_20?: string | number;
  avg_level_diff_25?: string | number;
  avg_damage_share?: string | number;
  avg_gold_share?: string | number;
  avg_physical_dpm?: string | number;
  avg_magic_dpm?: string | number;
  avg_true_dpm?: string | number;
  avg_wpm?: string | number;
  avg_wkpm?: string | number;
  avg_cwpm?: string | number;
  wards_placed?: number;
  wards_destroyed?: number;
  vision_wards_bought?: number;
  unique_champions?: number;
  champions_played?: Champion[];
  blue_wr?: string | number;
  blue_games?: number;
  red_wr?: string | number;
  red_games?: number;
  avg_duration_formatted?: string;
  keystones?: Keystone[];
  match_log?: Match[];
  avg_dtaken_per_min?: string | number;
}

interface Props {
  league: string;
  name: string;
  accent: string;
}

/* ── Helpers ─────────────────────────────────────────────────────── */
const fmt = (v: any, d = 1) => v != null ? Number(v).toFixed(d) : '—';
const pct = (v: any) => v != null ? `${Number(v).toFixed(1)}%` : '—';

const kdaColor = (kda: any) => {
  if (kda == null) return '';
  if (kda >= 5) return '#fbbf24';
  if (kda >= 4) return '#4ade80';
  if (kda >= 2.5) return '#94a3b8';
  return '#f87171';
};

const n = (obj: any, ...keys: string[]) => {
  for (const k of keys) {
    if (obj[k] != null && obj[k] !== '') return Number(obj[k]);
  }
  return null;
};

/* ── SVG Ring for KDA ────────────────────────────────────── */
function KDARing({ kda, size = 110, stroke = 8 }: { kda: any; size?: number; stroke?: number }): React.ReactElement {
  const radius = (size - stroke) / 2;
  const circ = 2 * Math.PI * radius;
  const maxKda = 8;
  const ratio = Math.min((kda ?? 0) / maxKda, 1);
  const offset = circ * (1 - ratio);
  const color = kdaColor(kda);
  return (
    <svg width={size} height={size} className="p40-kda-ring-svg">
      <circle cx={size / 2} cy={size / 2} r={radius}
        fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={stroke} />
      <circle cx={size / 2} cy={size / 2} r={radius}
        fill="none" stroke={color} strokeWidth={stroke}
        strokeDasharray={circ} strokeDashoffset={offset}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: 'stroke-dashoffset 0.8s ease' } as React.CSSProperties} />
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

/* ── SVG Donut for Damage Breakdown ──────────────────────── */
function DmgDonut({ physical, magic, trueDmg, size = 120 }: { physical: number; magic: number; trueDmg: number; size?: number }): React.ReactElement | null {
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
    <svg width={size} height={size} className="p40-dmg-donut-svg">
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
            style={{ transition: 'stroke-dasharray 0.8s ease' } as React.CSSProperties} />
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

/* ── Percentile Rank Bar ─────────────────────────────────── */
function RankBar({ value, pool, stat, invert = false, label }: { value: any; pool: any[]; stat: string; invert?: boolean; label: string }): React.ReactElement | null {
  const vals = pool.map(p => Number(p[stat]) || 0).filter(v => v != null);
  if (vals.length < 2) return null;
  const sorted = invert
    ? [...vals].sort((a, b) => a - b)
    : [...vals].sort((a, b) => b - a);
  const rank = sorted.findIndex(v => v <= (Number(value) || 0)) + 1;
  const percentile = ((pool.length - rank) / (pool.length - 1)) * 100;
  const pctClamped = Math.max(0, Math.min(100, percentile));
  const barColor = pctClamped >= 75 ? '#fbbf24' : pctClamped >= 50 ? '#4ade80' : pctClamped >= 25 ? '#94a3b8' : '#f87171';
  return (
    <div className="p40-rankbar">
      <div className="p40-rankbar-info">
        <span className="p40-rankbar-label">{label}</span>
        <span className="p40-rankbar-rank" style={{ color: barColor }}>Top {Math.max(1, Math.round(100 - pctClamped))}%</span>
      </div>
      <div className="p40-rankbar-track">
        <div className="p40-rankbar-fill" style={{ width: `${pctClamped}%`, background: barColor }} />
        <div className="p40-rankbar-marker" style={{ left: `${pctClamped}%` }} />
      </div>
    </div>
  );
}

/* ── BEG / BMG / BLG (0-100, normalized within same-position pool) ── */
function calcScores(player: PlayerProfile, pool: PlayerProfile[]): { beg: number | null; bmg: number | null; blg: number | null } {
  const minmax = (arr: number[]) => [Math.min(...arr), Math.max(...arr)];
  const norm = (val: number, min: number, max: number) =>
    max === min ? 50 : Math.min(100, Math.max(0, (val - min) / (max - min) * 100));
  const weighted = (parts: Array<[number, number]>) => {
    const totalW = parts.reduce((s, [, w]) => s + w, 0);
    return parts.reduce((s, [score, w]) => s + score * (w / totalW), 0);
  };

  const gd15v = pool.map(p => n(p, 'avg_gold_diff_15')).filter(v => v != null) as number[];
  const csd15v = pool.map(p => n(p, 'avg_cs_diff_15')).filter(v => v != null) as number[];
  const expd15v = pool.map(p => n(p, 'avg_level_diff_13')).filter(v => v != null) as number[];
  const kdav = pool.map(p => n(p, 'kda')).filter(v => v != null) as number[];
  const dpmv = pool.map(p => n(p, 'avg_dpm')).filter(v => v != null) as number[];
  const cspmv = pool.map(p => n(p, 'avg_cspm')).filter(v => v != null) as number[];
  const wrv = pool.map(p => n(p, 'win_rate')).filter(v => v != null) as number[];

  const mkRate = (p: PlayerProfile) => {
    const g = n(p, 'games');
    if (!g) return 0;
    return ((n(p, 'double_kills') || 0) +
      (n(p, 'triple_kills') || 0) * 2 +
      (n(p, 'quadra_kills') || 0) * 3 +
      (n(p, 'penta_kills') || 0) * 5) / g;
  };
  const mkv = pool.map(mkRate);

  const pGd15 = n(player, 'avg_gold_diff_15');
  const pCsd15 = n(player, 'avg_cs_diff_15');
  const pExpd15 = n(player, 'avg_level_diff_13');
  const pKda = n(player, 'kda');
  const pDpm = n(player, 'avg_dpm');
  const pCspm = n(player, 'avg_cspm');
  const pWr = n(player, 'win_rate');
  const pMk = mkRate(player);

  const begParts: Array<[number, number]> = [];
  if (pGd15 != null && gd15v.length > 1) { const [mn, mx] = minmax(gd15v); begParts.push([norm(pGd15, mn, mx), 0.40]); }
  if (pCsd15 != null && csd15v.length > 1) { const [mn, mx] = minmax(csd15v); begParts.push([norm(pCsd15, mn, mx), 0.35]); }
  if (pExpd15 != null && expd15v.length > 1) { const [mn, mx] = minmax(expd15v); begParts.push([norm(pExpd15, mn, mx), 0.25]); }
  const beg = begParts.length > 0 ? weighted(begParts) : null;

  const bmgParts: Array<[number, number]> = [];
  if (pKda != null && kdav.length > 1) { const [mn, mx] = minmax(kdav); bmgParts.push([norm(pKda, mn, mx), 0.30]); }
  if (pDpm != null && dpmv.length > 1) { const [mn, mx] = minmax(dpmv); bmgParts.push([norm(pDpm, mn, mx), 0.35]); }
  if (pCspm != null && cspmv.length > 1) { const [mn, mx] = minmax(cspmv); bmgParts.push([norm(pCspm, mn, mx), 0.35]); }
  const bmg = bmgParts.length > 0 ? weighted(bmgParts) : null;

  const blgParts: Array<[number, number]> = [];
  if (pWr != null && wrv.length > 1) { const [mn, mx] = minmax(wrv); blgParts.push([norm(pWr, mn, mx), 0.40]); }
  if (pKda != null && kdav.length > 1) { const [mn, mx] = minmax(kdav); blgParts.push([norm(pKda, mn, mx), 0.35]); }
  if (mkv.length > 1) { const [mn, mx] = minmax(mkv); blgParts.push([norm(pMk, mn, mx), 0.25]); }
  const blg = blgParts.length > 0 ? weighted(blgParts) : null;

  return { beg, bmg, blg };
}

function scoreColor(v: number | null | undefined): string {
  if (v == null) return '#64748b';
  if (v >= 75) return '#fbbf24';
  if (v >= 55) return '#4ade80';
  if (v >= 40) return '#94a3b8';
  return '#f87171';
}

function diffGroupMax(values: (number | string | null | undefined)[]): number {
  const abs = values.filter(v => v != null).map(v => Math.abs(Number(v)));
  return abs.length > 0 ? Math.max(...abs) : 1;
}

function DiffBar({ label, value, groupMax }: { label: string; value: any; groupMax: number }): React.ReactElement {
  const v = value != null ? Number(value) : null;
  const max = groupMax || 1;
  const absPct = v != null ? Math.min((Math.abs(v) / max) * 50, 50) : 0;
  const isPos = v != null ? v >= 0 : true;
  const fillStyle: React.CSSProperties = v != null
    ? isPos
      ? { left: '50%', width: `${absPct}%` }
      : { left: `calc(50% - ${absPct}%)`, width: `${absPct}%` }
    : {};

  return (
    <div className="p40-diff-row">
      <div className="p40-diff-info">
        <span className="p40-diff-time">{label}</span>
        <span className={`p40-diff-val ${v != null ? (v >= 0 ? 'pos' : 'neg') : ''}`}>
          {v != null ? `${v > 0 ? '+' : ''}${v}` : '—'}
        </span>
      </div>
      <div className="p40-diff-track">
        {v != null && <div className={`p40-diff-fill ${isPos ? 'pos' : 'neg'}`} style={fillStyle} />}
      </div>
    </div>
  );
}

/* ── MAIN COMPONENT ──────────────────────────────────────────── */
export default function PlayerProfileClient({ league, name, accent }: Props): React.ReactElement {
  const router = useRouter();
  const searchParams = useSearchParams();
  const team = searchParams.get('team');

  const [player, setPlayer] = useState<PlayerProfile | null>(null);
  const [allPlayers, setAllPlayers] = useState<PlayerProfile[]>([]);
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

        const playersData = await clientFetch<PlayerProfile[]>(`/api/v1/pg/players?${fqs}`);
        if (!cancelled) setAllPlayers(playersData || []);

        let targetTeam = team;
        if (!targetTeam && playersData) {
          const found = playersData.find(p => p.name === decodeURIComponent(name));
          if (found) targetTeam = found.team_abbr ?? null;
        }

        const playerData = await clientFetch<PlayerProfile>(
          `/api/v1/pg/players/${encodeURIComponent(name)}?${fqs}&team=${targetTeam}`
        );
        if (!cancelled) {
          setPlayer(playerData);
          isFirstLoad.current = false;
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'An error occurred');
      } finally {
        if (!cancelled) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    }
    loadData();
    return () => { cancelled = true; };
  }, [name, team, league, filters.ready, filters.year, filters.split, filters.stage]);

  if (loading && !player) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '400px', fontSize: '18px', color: '#94a3b8' }}>
        Cargando...
      </div>
    );
  }
  if (error) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '400px', fontSize: '18px', color: '#f87171' }}>
        Error: {error}
      </div>
    );
  }
  if (!player) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '400px', fontSize: '18px', color: '#f87171' }}>
        Jugador no encontrado
      </div>
    );
  }

  /* ── Derived ── */
  const posPool = allPlayers.filter(p => p.position === player.position);

  const getRank = (stat: string, desc = true) => {
    const sorted = [...posPool].sort((a, b) =>
      desc ? (Number(b[stat as keyof PlayerProfile]) || 0) - (Number(a[stat as keyof PlayerProfile]) || 0)
           : (Number(a[stat as keyof PlayerProfile]) || 0) - (Number(b[stat as keyof PlayerProfile]) || 0)
    );
    const idx = sorted.findIndex(p => p.name === player.name);
    return idx >= 0 ? idx + 1 : null;
  };

  const totalGames = Number(player.games) || 0;
  const wins = player.wins != null ? Number(player.wins) : Math.round((Number(player.win_rate) / 100) * totalGames);
  const losses = totalGames - wins;
  const sampleTag = `SPLIT COMPLETO · ${totalGames}G`;

  const { beg, bmg, blg } = calcScores(player, posPool);

  const roleStandings = [...posPool]
    .sort((a, b) => (Number(b.win_rate) || 0) - (Number(a.win_rate) || 0))
    .slice(0, 10);

  /* Damage type breakdown for radar-like display */
  const totalDpm = (Number(player.avg_magic_dpm) || 0) + (Number(player.avg_physical_dpm) || 0) + (Number(player.avg_true_dpm) || 0);
  const magicPct = totalDpm > 0 ? ((Number(player.avg_magic_dpm) || 0) / totalDpm * 100) : 0;
  const physicalPct = totalDpm > 0 ? ((Number(player.avg_physical_dpm) || 0) / totalDpm * 100) : 0;
  const truePct = totalDpm > 0 ? ((Number(player.avg_true_dpm) || 0) / totalDpm * 100) : 0;

  return (
    <div className="p40-container" style={{ opacity: refreshing ? 0.6 : 1, transition: 'opacity 0.3s ease' }}>
      {/* ═══════════ HERO ═══════════ */}
      <div className="p40-hero">
        <div className="p40-hero-left">
          {player.image_url && (
            <div className="p40-hero-photo-wrap">
              <Image src={player.image_url} className="p40-hero-photo" alt={player.name} width={80} height={80} />
            </div>
          )}
          <div className="p40-hero-text">
            <h1 className="p40-hero-name">{player.name}</h1>
            <div className="p40-hero-meta">
              <span className="p40-hero-role">
                <Image src={`/rol/${player.position?.toLowerCase()}.png` || ''} alt={player.position || ''} className="p40-role-icon" width={20} height={20} />
                {player.position?.toUpperCase()}
              </span>
              <span className="p40-hero-team">
                <Image src={teamImg(player.team_logo_url, player.team_abbr, league) || ''} className="p40-hero-team-logo" alt={player.team_abbr || ''} onError={(e) => (e.target as HTMLImageElement).style.display = 'none'} width={64} height={64} />
                {player.team_name ?? player.team_abbr}
              </span>
              <span className="p40-hero-league">{league.toUpperCase()}</span>
            </div>
            <div className="p40-hero-wl">
              <span className="w"><AnimatedNumber value={wins} decimals={0} /></span>W{' – '}<span className="l"><AnimatedNumber value={losses} decimals={0} /></span>L
              <span className="p40-hero-games"><AnimatedNumber value={totalGames} decimals={0} /> GAMES</span>
            </div>
          </div>
        </div>
        <div className="p40-hero-stats">
          {[
            { val: player.win_rate, lbl: 'WIN RATE', rank: getRank('win_rate'), cls: getWinRateClass(player.win_rate as any), decimals: 1, suffix: '%' },
            { val: player.kda, lbl: 'KDA', rank: getRank('kda'), style: { color: kdaColor(player.kda) }, decimals: 2 },
            { val: player.avg_cspm, lbl: 'CS/MIN', rank: getRank('avg_cspm'), decimals: 1 },
            { val: player.avg_dpm, lbl: 'DMG/MIN', rank: getRank('avg_dpm'), decimals: 0 },
            { val: player.avg_gpm, lbl: 'GOLD/MIN', rank: getRank('avg_gpm'), decimals: 0 },
          ].map(s => (
            <div key={s.lbl} className="p40-hstat">
              <span className={`p40-hstat-val ${s.cls || ''}`} style={s.style}>
                {s.val != null ? <AnimatedNumber value={Number(s.val)} decimals={s.decimals} suffix={s.suffix || ''} /> : '—'}
              </span>
              <span className="p40-hstat-lbl">{s.lbl}</span>
              {s.rank && <span className="p40-hstat-rank">#{s.rank}</span>}
            </div>
          ))}
        </div>
      </div>

      {/* ═══════════ ROW 1: KDA Breakdown + Per Minute + Laning Diffs ═══════════ */}
      <div className="p40-grid-3">
        {/* KDA Breakdown */}
        <div className="p40-card">
          <div className="p40-card-hdr">
            <span className="p40-card-title">KDA DESGLOSE</span>
            <span className="p40-card-sub">PROMEDIOS · {sampleTag}</span>
          </div>
          <div className="p40-card-body">
            <div className="p40-kda-ring-row">
              <KDARing kda={Number(player.kda)} />
              <div className="p40-kda-right">
                <div className="p40-kda-pills">
                  <div className="p40-kda-pill kill"><span className="p40-pill-val">{player.avg_kills != null ? <AnimatedNumber value={Number(player.avg_kills)} decimals={1} /> : '—'}</span><span className="p40-pill-lbl">KILLS</span></div>
                  <div className="p40-kda-pill death"><span className="p40-pill-val">{player.avg_deaths != null ? <AnimatedNumber value={Number(player.avg_deaths)} decimals={1} /> : '—'}</span><span className="p40-pill-lbl">DEATHS</span></div>
                  <div className="p40-kda-pill assist"><span className="p40-pill-val">{player.avg_assists != null ? <AnimatedNumber value={Number(player.avg_assists)} decimals={1} /> : '—'}</span><span className="p40-pill-lbl">ASSISTS</span></div>
                </div>
                <div className="p40-kp-bar-wrap">
                  <div className="p40-kp-header">
                    <span className="p40-kp-label">KILL PART.</span>
                    <span className="p40-kp-val">{player.kill_participation != null ? <><AnimatedNumber value={Number(player.kill_participation)} decimals={1} />%</> : '—'}</span>
                  </div>
                  <div className="p40-kp-track">
                    <div className="p40-kp-fill" style={{ width: `${player.kill_participation ?? 0}%` }} />
                  </div>
                </div>
              </div>
            </div>
            <div className="p40-kda-bottom">
              <div className="p40-fb-grid">
                <div className="p40-fb-item">
                  <span className="p40-fb-val accent"><AnimatedNumber value={player.first_blood_kills ?? 0} decimals={0} /></span>
                  <span className="p40-fb-lbl">FB KILLS</span>
                </div>
                <div className="p40-fb-item">
                  <span className="p40-fb-val danger"><AnimatedNumber value={player.first_blood_victim ?? 0} decimals={0} /></span>
                  <span className="p40-fb-lbl">FB DEATHS</span>
                </div>
                <div className="p40-fb-item">
                  <span className="p40-fb-val">{player.fb_rate != null ? <><AnimatedNumber value={Number(player.fb_rate)} decimals={1} />%</> : '—'}</span>
                  <span className="p40-fb-lbl">FB RATE</span>
                </div>
              </div>
              <div className="p40-multikills">
                {[
                  ['DBL', player.double_kills],
                  ['TRP', player.triple_kills],
                  ['QDR', player.quadra_kills],
                  ['PNT', player.penta_kills],
                ].map(([label, val]) => (
                  <div key={label} className="p40-mk-chip">
                    <span className="p40-mk-val"><AnimatedNumber value={Number(val ?? 0)} decimals={0} /></span>
                    <span className="p40-mk-lbl">{label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Per Minute Production */}
        <div className="p40-card">
          <div className="p40-card-hdr">
            <span className="p40-card-title">PRODUCCIÓN POR MINUTO</span>
            <span className="p40-card-sub">RANKING EN ROL · {sampleTag}</span>
          </div>
          <div className="p40-card-body">
            <div className="p40-pm-rows">
              {[
                { val: player.avg_dpm, lbl: 'DPM', sub: 'Daño por minuto', stat: 'avg_dpm', rank: getRank('avg_dpm'), decimals: 0 },
                { val: player.avg_gpm, lbl: 'GPM', sub: 'Oro por minuto', stat: 'avg_gpm', rank: getRank('avg_gpm'), decimals: 0 },
                { val: player.avg_cspm, lbl: 'CSPM', sub: 'CS por minuto', stat: 'avg_cspm', rank: getRank('avg_cspm'), decimals: 1 },
                { val: player.avg_dtaken_per_min, lbl: 'DTPM', sub: 'Daño recibido/min', stat: 'avg_dtaken_per_min', rank: getRank('avg_dtaken_per_min', false), invert: true, decimals: 0 },
              ].map(s => (
                <div key={s.lbl} className="p40-pm-stat-row">
                  <div className="p40-pm-left">
                    <span className="p40-pm-val">{s.val != null ? <AnimatedNumber value={Number(s.val)} decimals={s.decimals} /> : '—'}</span>
                    <span className="p40-pm-lbl">{s.lbl}</span>
                  </div>
                  <div className="p40-pm-right">
                    <div className="p40-pm-desc">{s.sub}</div>
                    <RankBar value={player[s.stat as keyof PlayerProfile]} pool={posPool} stat={s.stat} invert={s.invert} label={`#${s.rank ?? '—'} en rol`} />
                  </div>
                </div>
              ))}
            </div>
            <div className="p40-share-strip">
              <div className="p40-share-chip">
                <span className="p40-share-val">{player.avg_damage_share != null ? <><AnimatedNumber value={Number(player.avg_damage_share)} decimals={1} />%</> : '—'}</span>
                <span className="p40-share-lbl">DMG SHARE</span>
              </div>
              <div className="p40-share-divider" />
              <div className="p40-share-chip">
                <span className="p40-share-val">{player.avg_gold_share != null ? <><AnimatedNumber value={Number(player.avg_gold_share)} decimals={1} />%</> : '—'}</span>
                <span className="p40-share-lbl">GOLD SHARE</span>
              </div>
            </div>
          </div>
        </div>

        {/* Laning Phase Diffs */}
        <div className="p40-card">
          <div className="p40-card-hdr">
            <span className="p40-card-title">FASE DE LÍNEAS</span>
            <span className="p40-card-sub">CS Y NIVEL DIFF · {sampleTag}</span>
          </div>
          <div className="p40-card-body">
            {(() => {
              const csVals = [player.avg_cs_diff_13, player.avg_cs_diff_20, player.avg_cs_diff_25];
              const lvlVals = [player.avg_level_diff_13, player.avg_level_diff_20, player.avg_level_diff_25];
              const csMax = diffGroupMax(csVals);
              const lvlMax = diffGroupMax(lvlVals);
              return (
                <>
                  <div className="p40-diff-section">
                    <div className="p40-diff-label">CS DIFF</div>
                    {([['@13', csVals[0]], ['@20', csVals[1]], ['@25', csVals[2]]] as [string, number | undefined][]).map(([label, value]) => (
                      <DiffBar key={`cs${label}`} label={label} value={value} groupMax={csMax} />
                    ))}
                  </div>
                  <div className="p40-diff-section">
                    <div className="p40-diff-label">LEVEL DIFF</div>
                    {([['@13', lvlVals[0]], ['@20', lvlVals[1]], ['@25', lvlVals[2]]] as [string, number | undefined][]).map(([label, value]) => (
                      <DiffBar key={`lvl${label}`} label={label} value={value} groupMax={lvlMax} />
                    ))}
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      </div>

      {/* ═══════════ ROW 2: BEG/BMG/BLG + Damage Breakdown + Vision ═══════════ */}
      <div className="p40-grid-3">
        {/* BEG / BMG / BLG */}
        <div className="p40-card">
          <div className="p40-card-hdr">
            <span className="p40-card-title">RENDIMIENTO POR FASE</span>
            <span className="p40-card-sub">SCORE 0–100 VS ROL · {sampleTag}</span>
          </div>
          <div className="p40-card-body">
            {[
              { label: 'BEG', desc: 'Best Early Game', value: beg, tags: ['GD@15 40%', 'CSD@15 35%', 'LVL 25%'] },
              { label: 'BMG', desc: 'Best Mid Game', value: bmg, tags: ['KDA 30%', 'DPM 35%', 'CSPM 35%'] },
              { label: 'BLG', desc: 'Best Late Game', value: blg, tags: ['WR 40%', 'KDA 35%', 'MK 25%'] },
            ].map(s => (
              <div key={s.label} className="p40-score-row">
                <div className="p40-score-header">
                  <div>
                    <span className="p40-score-name">{s.label}</span>
                    <span className="p40-score-desc">{s.desc}</span>
                  </div>
                  <span className="p40-score-num" style={{ color: scoreColor(s.value) }}>
                    {s.value != null ? <AnimatedNumber value={s.value} decimals={1} /> : '—'}
                  </span>
                </div>
                <div className="p40-score-track">
                  <div
                    className="p40-score-fill"
                    style={{ width: `${s.value ?? 0}%`, background: scoreColor(s.value) }}
                  />
                </div>
                <div className="p40-score-tags">
                  {s.tags.map(t => <span key={t} className="p40-tag">{t}</span>)}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Damage Type Breakdown */}
        <div className="p40-card">
          <div className="p40-card-hdr">
            <span className="p40-card-title">TIPO DE DAÑO</span>
            <span className="p40-card-sub">DPM POR TIPO · {sampleTag}</span>
          </div>
          <div className="p40-card-body p40-dmg-body">
            <div className="p40-dmg-legend">
              {[
                { label: 'FÍSICO', val: player.avg_physical_dpm, pctVal: physicalPct, color: '#f87171' },
                { label: 'MÁGICO', val: player.avg_magic_dpm, pctVal: magicPct, color: '#60a5fa' },
                { label: 'VERDADERO', val: player.avg_true_dpm, pctVal: truePct, color: '#fbbf24' },
              ].map(d => (
                <div key={d.label} className="p40-dmg-legend-row">
                  <span className="p40-dmg-dot" style={{ background: d.color }} />
                  <span className="p40-dmg-legend-label">{d.label}</span>
                  <span className="p40-dmg-legend-val" style={{ color: d.color }}>{d.val != null ? <AnimatedNumber value={Number(d.val)} decimals={0} /> : '—'}</span>
                  <span className="p40-dmg-legend-pct"><AnimatedNumber value={d.pctVal} decimals={1} />%</span>
                </div>
              ))}
            </div>
            <div className="p40-dmg-donut-wrap">
              <DmgDonut
                physical={Number(player.avg_physical_dpm) || 0}
                magic={Number(player.avg_magic_dpm) || 0}
                trueDmg={Number(player.avg_true_dpm) || 0}
                size={140}
              />
            </div>
          </div>
        </div>

        {/* Vision & Wards */}
        <div className="p40-card">
          <div className="p40-card-hdr">
            <span className="p40-card-title">VISIÓN</span>
            <span className="p40-card-sub">RANKING EN ROL · {sampleTag}</span>
          </div>
          <div className="p40-card-body">
            <div className="p40-vis-rows">
              {[
                { val: player.avg_wpm, lbl: 'WPM', sub: 'Wards puestos/min', stat: 'avg_wpm', rank: getRank('avg_wpm'), decimals: 2 },
                { val: player.avg_wkpm, lbl: 'WKPM', sub: 'Wards eliminados/min', stat: 'avg_wkpm', rank: getRank('avg_wkpm'), decimals: 2 },
                { val: player.avg_cwpm, lbl: 'CWPM', sub: 'Control wards/min', stat: 'avg_cwpm', rank: getRank('avg_cwpm'), decimals: 2 },
              ].map(s => (
                <div key={s.lbl} className="p40-vis-stat-row">
                  <div className="p40-vis-left">
                    <span className="p40-vis-val">{s.val != null ? <AnimatedNumber value={Number(s.val)} decimals={s.decimals} /> : '—'}</span>
                    <span className="p40-vis-lbl">{s.lbl}</span>
                  </div>
                  <div className="p40-vis-right">
                    <div className="p40-vis-desc">{s.sub}</div>
                    <RankBar value={player[s.stat as keyof PlayerProfile]} pool={posPool} stat={s.stat} label={`#${s.rank ?? '—'} en rol`} />
                  </div>
                </div>
              ))}
            </div>
            <div className="p40-vision-totals">
              <div className="p40-vt-chip">
                <span className="p40-vt-val"><AnimatedNumber value={player.wards_placed ?? 0} decimals={0} /></span>
                <span className="p40-vt-lbl">PUESTOS</span>
              </div>
              <div className="p40-vt-chip">
                <span className="p40-vt-val"><AnimatedNumber value={player.wards_destroyed ?? 0} decimals={0} /></span>
                <span className="p40-vt-lbl">ELIMINADOS</span>
              </div>
              <div className="p40-vt-chip">
                <span className="p40-vt-val"><AnimatedNumber value={player.vision_wards_bought ?? 0} decimals={0} /></span>
                <span className="p40-vt-lbl">CONTROL</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ═══════════ ROW 3: Champions + Side Performance + Role Standings ═══════════ */}
      <div className="p40-grid-3">
        {/* Champions Pool */}
        <div className="p40-card">
          <div className="p40-card-hdr">
            <span className="p40-card-title">CHAMPION POOL</span>
            <span className="p40-card-sub">{player.unique_champions ?? 0} ÚNICOS · {sampleTag}</span>
          </div>
          <div className="p40-card-body p40-champ-body">
            <div className="p40-champ-hdr">
              <span>CAMPEÓN</span>
              <span className="p40-champ-hdr-c">G</span>
              <span className="p40-champ-hdr-c">KDA</span>
              <span className="p40-champ-hdr-r">WR</span>
            </div>
            {player.champions_played?.slice(0, 8).map((c, i) => (
              <div
                key={c.name}
                className="p40-champ-row"
                onClick={() => router.push(`/${league}/champion_profile/${encodeURIComponent(c.name)}`)}
                style={{ cursor: 'pointer' }}
              >
                <div className="p40-champ-info">
                  <span className="p40-champ-idx">{i + 1}</span>
                  <Image src={champImg(c.image_url) || ''} className="p40-champ-icon" alt={c.name} width={32} height={32} />
                  <span className="p40-champ-name">{c.name}</span>
                </div>
                <span className="p40-champ-games"><AnimatedNumber value={c.games ?? 0} decimals={0} /></span>
                <span className="p40-champ-kda">{c.kda != null ? <AnimatedNumber value={Number(c.kda)} decimals={2} /> : '—'}</span>
                <span className={`p40-champ-wr ${getWinRateClass(c.win_rate as any)}`}>{c.win_rate != null ? <><AnimatedNumber value={Number(c.win_rate)} decimals={1} />%</> : '—'}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Side Performance */}
        <div className="p40-card">
          <div className="p40-card-hdr">
            <span className="p40-card-title">RENDIMIENTO POR LADO</span>
            <span className="p40-card-sub">BLUE VS RED · {sampleTag}</span>
          </div>
          <div className="p40-card-body">
            <div className="p40-side-versus">
              <div className="p40-side-col blue">
                <span className="p40-side-side-label">BLUE</span>
                <span className="p40-side-wr-big blue">{player.blue_wr != null ? <><AnimatedNumber value={Number(player.blue_wr)} decimals={1} />%</> : '—'}</span>
                <span className="p40-side-games-sm"><AnimatedNumber value={player.blue_games ?? 0} decimals={0} /> games</span>
              </div>
              <div className="p40-side-vs-center">
                <div className="p40-side-vs-bar">
                  <div className="p40-side-vs-fill blue" style={{ width: `${player.blue_wr ?? 50}%` }} />
                  <div className="p40-side-vs-fill red" style={{ width: `${player.red_wr ?? 50}%` }} />
                </div>
                <span className="p40-side-vs-text">VS</span>
              </div>
              <div className="p40-side-col red">
                <span className="p40-side-side-label">RED</span>
                <span className="p40-side-wr-big red">{player.red_wr != null ? <><AnimatedNumber value={Number(player.red_wr)} decimals={1} />%</> : '—'}</span>
                <span className="p40-side-games-sm"><AnimatedNumber value={player.red_games ?? 0} decimals={0} /> games</span>
              </div>
            </div>
            <div className="p40-side-extras">
              {player.avg_duration_formatted && (
                <div className="p40-side-extra-item">
                  <span className="p40-side-extra-val">{player.avg_duration_formatted}</span>
                  <span className="p40-side-extra-lbl">DURACIÓN MEDIA</span>
                </div>
              )}
            </div>
            {(player.keystones?.length ?? 0) > 0 && (() => {
              const primary = player.keystones![0];
              const secondary = player.keystones!.slice(1, 6);
              return (
                <div className="p40-keystones-section">
                  {primary && (
                    <div className="p40-keystone-chip p40-keystone-primary">
                      {primary.image_url && <Image src={primary.image_url} className="p40-key-chip-icon" alt={primary.name} width={28} height={28} />}
                      <span className="p40-key-chip-name">{primary.name}</span>
                      <div className="p40-key-chip-stats">
                        <span className="p40-key-chip-count"><AnimatedNumber value={primary.count ?? 0} decimals={0} />G</span>
                        <span className="p40-key-chip-pct"><AnimatedNumber value={primary.pct ?? 0} decimals={1} />%</span>
                      </div>
                    </div>
                  )}
                  {secondary.length > 0 && (
                    <div className="p40-keystones-grid">
                      {secondary.map(k => (
                        <div key={k.name} className="p40-keystone-chip">
                          {k.image_url && <Image src={k.image_url} className="p40-key-chip-icon" alt={k.name} width={28} height={28} />}
                          <span className="p40-key-chip-name">{k.name}</span>
                          <div className="p40-key-chip-stats">
                            <span className="p40-key-chip-count"><AnimatedNumber value={k.count ?? 0} decimals={0} />G</span>
                            <span className="p40-key-chip-pct"><AnimatedNumber value={k.pct ?? 0} decimals={1} />%</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        </div>

        {/* Role Standings */}
        <div className="p40-card">
          <div className="p40-card-hdr">
            <span className="p40-card-title">RANKING EN EL ROL</span>
            <span className="p40-card-sub">{player.position?.toUpperCase()} · {league.toUpperCase()} · SPLIT COMPLETO</span>
          </div>
          <div className="p40-card-body p40-standings-body">
            <div className="p40-std-hdr">
              <span>#</span>
              <span>JUGADOR</span>
              <span className="p40-std-hdr-c">G</span>
              <span className="p40-std-hdr-r">WR</span>
            </div>
            {roleStandings.map((p, i) => (
              <div
                key={p.name}
                className={`p40-std-row${p.name === player.name ? ' p40-active' : ''}`}
                onClick={() => router.push(`/${league}/player_profile/${encodeURIComponent(p.name)}?team=${encodeURIComponent(p.team_abbr || '')}`)}
                style={{ cursor: 'pointer' }}
              >
                <span className="p40-std-idx">{i + 1}</span>
                <div className="p40-std-player">
                  <Image src={teamImg(p.team_logo_url, p.team_abbr, league) || ''} className="p40-std-logo" alt={p.team_abbr || ''} width={24} height={24} />
                  <span className="p40-std-name">{p.name}</span>
                </div>
                <span className="p40-std-games"><AnimatedNumber value={Number(p.games ?? 0)} decimals={0} />G</span>
                <span className={`p40-std-wr ${getWinRateClass(p.win_rate as any)}`}>{p.win_rate != null ? <><AnimatedNumber value={Number(p.win_rate)} decimals={1} />%</> : '—'}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ═══════════ ROW 4: Match History (full width) ═══════════ */}
      <div className="p40-card p40-history-card">
        <div className="p40-card-hdr">
          <span className="p40-card-title">HISTORIAL DE PARTIDAS</span>
          <span className="p40-card-sub">{sampleTag}</span>
        </div>
        {/* Column header */}
        <div className="p40-hm-header">
          <span className="p40-hm-hcol p40-hm-hcol-result"></span>
          <span className="p40-hm-hcol p40-hm-hcol-champ">CAMPEÓN</span>
          <span className="p40-hm-hcol p40-hm-hcol-runes">RUNAS</span>
          <span className="p40-hm-hcol p40-hm-hcol-shards">SHARDS</span>
          <span className="p40-hm-hcol p40-hm-hcol-vs">VS</span>
          <span className="p40-hm-hcol p40-hm-hcol-kda">KDA</span>
          <span className="p40-hm-hcol p40-hm-hcol-stat">CS/M</span>
          <span className="p40-hm-hcol p40-hm-hcol-stat">DPM</span>
          <span className="p40-hm-hcol p40-hm-hcol-stat">GPM</span>
          <span className="p40-hm-hcol p40-hm-hcol-date">FECHA</span>
        </div>
        <div className="p40-history-list">
          {(player.match_log?.length ?? 0) > 0
            ? player.match_log!.map((m) => {
              const isWin = m.result === 'W' || m.result === true;
              const mKda = m.deaths && m.deaths > 0 ? ((m.kills || 0) + (m.assists || 0)) / m.deaths : ((m.kills || 0) + (m.assists || 0));
              const runes = m.runes;
              const shards = runes?.shards;
              return (
                <div key={m.game_id ?? m.match_id} className={`p40-hm-row ${isWin ? 'win' : 'loss'}`}>
                  {/* WIN / LOSE */}
                  <div className="p40-hm-result">
                    <span className={`p40-hm-badge ${isWin ? 'win' : 'loss'}`}>{isWin ? 'W' : 'L'}</span>
                  </div>

                  {/* Campeón: icono + nombre */}
                  <div className="p40-hm-champ">
                    <Image src={champImg(m.champion?.image_url) || ''} className="p40-hm-champ-icon" alt={m.champion?.name || ''} width={32} height={32} />
                    <span className="p40-hm-champ-name">{m.champion?.name || '—'}</span>
                  </div>

                  {/* Runas: keystone + secondary path */}
                  <div className="p40-hm-runes">
                    {runes?.keystone_img
                      ? <Image src={runes.keystone_img || ''} className="p40-hm-rune-img" alt={runes.keystone || ''} title={runes.keystone} width={28} height={28} />
                      : <span className="p40-hm-rune-txt" title={runes?.keystone}>{runes?.keystone ? runes.keystone.substring(0, 4) : '—'}</span>
                    }
                    {runes?.secondary_path_img
                      ? <Image src={runes.secondary_path_img || ''} className="p40-hm-rune-img sec" alt={runes.secondary_path || ''} title={runes.secondary_path} width={28} height={28} />
                      : <span className="p40-hm-rune-txt sec" title={runes?.secondary_path}>{runes?.secondary_path ? runes.secondary_path.substring(0, 4) : '—'}</span>
                    }
                  </div>

                  {/* Shards */}
                  <div className="p40-hm-shards">
                    {shards ? ['offense', 'flex', 'defense'].map(key => {
                      const s = shards[key as keyof Shards];
                      if (!s) return <span key={key} className="p40-hm-shard-dot" />;
                      return s.image_url
                        ? <Image key={key} src={s.image_url} className="p40-hm-shard-img" alt={s.name} title={s.name} width={28} height={28} />
                        : <span key={key} className="p40-hm-shard-dot" title={s.name} />;
                    }) : <span className="p40-hm-rune-txt">—</span>}
                  </div>

                  {/* VS equipo enemigo */}
                  <div className="p40-hm-vs">
                    {m.opponent?.logo && <Image src={m.opponent.logo || ''} className="p40-hm-opp-logo" alt={m.opponent.abbr || ''} width={24} height={24} />}
                    <span className="p40-hm-opp-name">{m.opponent?.abbr || '???'}</span>
                  </div>

                  {/* KDA */}
                  <div className="p40-hm-kda">
                    <div className="p40-hm-kda-line">
                      <span className="p40-hm-k"><AnimatedNumber value={m.kills ?? 0} decimals={0} /></span>
                      <span className="p40-hm-sep">/</span>
                      <span className="p40-hm-d"><AnimatedNumber value={m.deaths ?? 0} decimals={0} /></span>
                      <span className="p40-hm-sep">/</span>
                      <span className="p40-hm-a"><AnimatedNumber value={m.assists ?? 0} decimals={0} /></span>
                    </div>
                    <span className="p40-hm-kda-val" style={{ color: kdaColor(mKda) }}>{mKda != null ? <AnimatedNumber value={mKda} decimals={2} /> : '—'}</span>
                  </div>

                  {/* CS/M */}
                  <div className="p40-hm-stat">
                    <span className="p40-hm-stat-val">{m.cspm != null ? <AnimatedNumber value={Number(m.cspm)} decimals={1} /> : '—'}</span>
                  </div>

                  {/* DPM */}
                  <div className="p40-hm-stat">
                    <span className="p40-hm-stat-val">{m.dpm != null ? <AnimatedNumber value={Number(m.dpm)} decimals={0} /> : '—'}</span>
                  </div>

                  {/* GPM */}
                  <div className="p40-hm-stat">
                    <span className="p40-hm-stat-val">{m.gpm != null ? <AnimatedNumber value={Number(m.gpm)} decimals={0} /> : '—'}</span>
                  </div>

                  {/* Fecha */}
                  <div className="p40-hm-date">
                    {m.date ? (
                      <>
                        <span className="p40-hm-date-day">{new Date(m.date).toLocaleDateString('es-ES', { day: '2-digit' })}</span>
                        <span className="p40-hm-date-month">{new Date(m.date).toLocaleDateString('es-ES', { month: 'short' }).toUpperCase()}</span>
                      </>
                    ) : '—'}
                  </div>
                </div>
              );
            })
            : <p className="p40-no-data">Sin historial disponible</p>
          }
        </div>
      </div>
    </div>
  );
}
