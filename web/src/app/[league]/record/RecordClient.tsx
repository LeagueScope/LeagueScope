'use client';

/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars, @typescript-eslint/no-unused-expressions, react-hooks/exhaustive-deps */
// TODO(refactor): tipar correctamente data y eventos del timeline / charts
// para retirar este file-level disable. Es trabajo grande aparte (~80 callsites).

import Image from 'next/image';
import React, { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { LEAGUE_LOGO, ROLE_ICON } from '@/lib/constants';
import { getLeagueColors } from '@/lib/leagueColors';
import { useFilters } from '@/context/FilterContext';
import { clientFetch } from '@/lib/clientFetch';
import { logger } from '@/lib/logger';
import type { MatchData, TournamentData } from './page';

/* ═══════════════════════════════════════════════════════════════════════════
   Record Client — ported from Record.jsx (Vite SPA)
   Match detail lazy-loaded via /api/v1/pg/matches/{matchId}/detail
   Initial match list and tournament data come from server props
   ═══════════════════════════════════════════════════════════════════════════ */

interface RecordClientProps {
  league: string;
  accent: string;
  initialMatches: MatchData[];
  tournament: TournamentData;
}

// ── Helpers ──────────────────────────────────────────────────────────────

function fmtTime(seconds: number | null | undefined): string {
  if (!seconds && seconds !== 0) return '—';
  const s = Math.round(seconds);
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${rem.toString().padStart(2, '0')}`;
}

function fmtGold(gold: number | null | undefined): string {
  if (gold == null) return '0';
  if (Math.abs(gold) >= 1000) return (gold / 1000).toFixed(1) + 'k';
  return String(gold);
}

function fmtNum(n: number | null | undefined): string {
  if (n == null) return '0';
  return n.toLocaleString('es-ES');
}

function kdaRatio(k: number, d: number, a: number): string {
  if (d === 0) return 'Perfect';
  return ((k + a) / d).toFixed(1);
}

function kdaClass(k: number, d: number, a: number): string {
  const r = d === 0 ? 99 : (k + a) / d;
  if (r >= 5) return 'p21-kda-good';
  if (r >= 2) return 'p21-kda-ok';
  return 'p21-kda-bad';
}

function classifyEvent(type: string | null | undefined): string {
  if (!type) return 'kill';
  if (type.includes('baron') || type.includes('nashor'))    return 'baron';
  if (type.includes('drake') || type.includes('dragon'))    return 'drake';
  if (type.includes('herald'))                               return 'herald';
  if (type.includes('voidgrub'))                             return 'voidgrub';
  if (type.includes('atakhan'))                              return 'atakhan';
  if (type.includes('inhibitor') || type.includes('inhib')) return 'inhib';
  if (type.includes('tower') || type.includes('turret'))    return 'tower';
  return 'kill';
}

function eventLabel(evt: any): string {
  const t = evt.type || '';
  if (t.includes('baron') || t.includes('nashor'))   return 'Baron';
  if (t.includes('drake') || t.includes('dragon'))   return evt.dragon_type || 'Drake';
  if (t.includes('herald'))                           return 'Herald';
  if (t.includes('voidgrub'))                         return 'Voidgrub';
  if (t.includes('atakhan'))                          return 'Atakhan';
  if (t.includes('tower') || t.includes('turret'))   return 'Tower';
  if (t.includes('inhibitor') || t.includes('inhib'))return 'Inhib';
  return evt.killer_name || 'Kill';
}

const _svgPlaceholder = (text: string): string => 'data:image/svg+xml,' + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" rx="2" fill="%23222938"/><text x="20" y="24" text-anchor="middle" fill="%2364748b" font-size="10" font-family="sans-serif">${(text || '?').substring(0, 3)}</text></svg>`
);

function psImg(imageUrl: string | null | undefined, fallbackText: string): string {
  if (imageUrl) return imageUrl;
  return _svgPlaceholder(fallbackText || '?');
}

/**
 * onError handler for champion <img> tags.
 * Fallback chain: local asset (already src) → CDN → SVG placeholder.
 */
function champImgError(e: React.SyntheticEvent<HTMLImageElement>, cdnUrl: string | null | undefined, name: string | null | undefined): void {
  const img = e.currentTarget;
  if (cdnUrl && img.src !== cdnUrl) {
    img.src = cdnUrl;          // try CDN
  } else {
    img.src = _svgPlaceholder(name || '?');  // last resort
  }
}

function hexToRgba(hex: string, alpha: number): string {
  const c = hex.replace('#', '');
  const r = parseInt(c.substring(0, 2), 16);
  const g = parseInt(c.substring(2, 4), 16);
  const b = parseInt(c.substring(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

const ROLE_ORDER: { [key: string]: number } = { top: 0, jun: 1, jungle: 1, mid: 2, adc: 3, bot: 3, sup: 4, support: 4 };
const ROLE_COLORS: { [key: string]: string } = { top: '#4ade80', jun: '#fb923c', jungle: '#fb923c', mid: '#60a5fa', adc: '#f87171', bot: '#f87171', sup: '#c084fc', support: '#c084fc' };

function sortByRole(arr: any[]): any[] {
  return [...arr].sort((a, b) =>
    (ROLE_ORDER[(a.role || '').toLowerCase()] ?? 5) - (ROLE_ORDER[(b.role || '').toLowerCase()] ?? 5)
  );
}

function getTeamPlayers(players: any[], teams: any[]): { blueTeam: any; redTeam: any; bluePlayers: any[]; redPlayers: any[] } {
  const blueTeam = teams.find(t => t.color === 'blue') || teams[0];
  const redTeam = teams.find(t => t.color === 'red') || teams[1];
  const bluePlayers = players.filter(p => (p.team?.id ?? p.team_id) === blueTeam?.id);
  const redPlayers = players.filter(p => (p.team?.id ?? p.team_id) === redTeam?.id);
  return {
    blueTeam, redTeam,
    bluePlayers: sortByRole(bluePlayers.length >= 4 ? bluePlayers : players.slice(0, 5)),
    redPlayers: sortByRole(redPlayers.length >= 4 ? redPlayers : players.slice(5, 10)),
  };
}

const MARKER_COLORS: { [key: string]: string } = {
  baron: '#f0a500', drake: '#60a5fa', herald: '#c084fc',
  voidgrub: '#7c3aed', atakhan: '#e879f9', tower: '#a78bfa',
  inhib: '#fb923c', kill: '#f87171',
};

function objIcon(cls: string, side: string): string | null {
  switch (cls) {
    case 'baron':    return '/objetives/baron.png';
    case 'drake':    return '/objetives/dragon.png';
    case 'herald':   return '/objetives/riftherald.png';
    case 'voidgrub': return '/objetives/grub.png';
    case 'tower':    return `/objetives/turret${side}.png`;
    case 'inhib':    return `/objetives/inhib${side}.png`;
    default:         return null;
  }
}

function dragonTypeIcon(dragonType: string | null | undefined): string | null {
  if (!dragonType) return null;
  return `/dragons/${dragonType.toLowerCase()}.png`;
}

function clusterEvents(eventsForSide: any[], totalSec: number, threshold: number = 0.025): any[] {
  const clusters: any[] = [];
  const sorted = [...eventsForSide].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
  for (const evt of sorted) {
    const pct = (evt.timestamp || 0) / totalSec;
    const last = clusters[clusters.length - 1];
    if (last && Math.abs(pct - last.pct) < threshold) {
      last.events.push(evt);
      last.pct = last.events.reduce((s: number, e: any) => s + ((e.timestamp || 0) / totalSec), 0) / last.events.length;
    } else {
      clusters.push({ pct, events: [evt] });
    }
  }
  return clusters;
}

// ══════════════════════════════════════════════════════════════════════════
// TAB 1: SCOREBOARD
// ══════════════════════════════════════════════════════════════════════════

function BansRow({ game }: { game: any }): React.ReactElement {
  const teams = game.teams || [];
  const blue = teams.find((t: any) => t.color === 'blue') || teams[0];
  const red = teams.find((t: any) => t.color === 'red') || teams[1];
  const renderBans = (team: any): React.ReactElement | React.ReactElement[] => {
    const bans = team?.bans || [];
    if (!bans.length) return <span className="p21-no-bans">Sin bans</span>;
    return bans.map((ban: any, i: number) => {
      const champ = ban?.champion || ban;
      return <Image key={i} className="p21-ban-img" src={psImg(champ?.image_url, champ?.name)} alt={champ?.name || '?'} title={champ?.name || '?'} width={64} height={64} onError={e => champImgError(e, champ?.cdn_image_url, champ?.name)} />;
    });
  };
  return (
    <div className="p21-bans">
      <div className="p21-bans-side p21-blue-bans">
        <span className="p21-bans-label">Bans {blue?.acronym || 'Blue'}</span>
        <div className="p21-bans-list">{renderBans(blue)}</div>
      </div>
      <div className="p21-bans-side p21-red-bans">
        <span className="p21-bans-label">Bans {red?.acronym || 'Red'}</span>
        <div className="p21-bans-list">{renderBans(red)}</div>
      </div>
    </div>
  );
}

function TabScoreboard({ game }: { game: any }): React.ReactElement {
  const { teams = [], players = [], winner } = game;
  const { blueTeam, redTeam, bluePlayers, redPlayers } = getTeamPlayers(players, teams);
  const isWinner = (team: any): boolean => winner && team && winner.id === team.id;

  const renderTeam = (teamData: any, teamPlayers: any[], side: string): React.ReactElement => {
    const acr = teamData?.acronym || teamData?.name || side;
    const logo = teamData?.image_url || teamData?.logo_url;
    const won = isWinner(teamData);
    const totalKills = teamPlayers.reduce((s: number, p: any) => s + (p.kills ?? 0), 0);
    const totalDeaths = teamPlayers.reduce((s: number, p: any) => s + (p.deaths ?? 0), 0);
    const totalAssists = teamPlayers.reduce((s: number, p: any) => s + (p.assists ?? 0), 0);
    const totalGold = teamPlayers.reduce((s: number, p: any) => s + (p.gold_earned ?? 0), 0);

    return (
      <div className={`p21-sb-team p21-${side}-team`}>
        <div className="p21-sb-team-header">
          <div className="p21-sb-team-info">
            <Image className="p21-sb-team-logo" src={psImg(logo, acr)} alt="" width={48} height={48} />
            <span className="p21-sb-team-name">{acr}</span>
            <span className={`p21-sb-result ${won ? 'p21-win' : 'p21-loss'}`}>{won ? 'VICTORIA' : 'DERROTA'}</span>
          </div>
          <div className="p21-sb-team-totals">
            <span>{totalKills}/{totalDeaths}/{totalAssists}</span>
            <span className="p21-sb-team-gold">{fmtGold(totalGold)}</span>
          </div>
        </div>
        <table className="p21-sb-table">
          <thead>
            <tr>
              <th className="p21-sb-th-player">Jugador</th>
              <th>KDA</th>
              <th>CS</th>
              <th>Oro</th>
              <th>Daño</th>
              <th>Items</th>
            </tr>
          </thead>
          <tbody>
            {teamPlayers.map((p: any, pi: number) => {
              const pKey = `${side}-${pi}`;
              const items = p.items || [];
              const totalDmg = (p.physical_damage?.dealt_to_champions ?? 0)
                             + (p.magic_damage?.dealt_to_champions ?? 0)
                             + (p.true_damage?.dealt_to_champions ?? 0);
              return (
                <tr key={pKey} className="p21-sb-row">
                    <td className="p21-sb-td-player">
                      <div className="p21-sb-player-cell">
                        <div className="p21-sb-champ-wrap">
                          <Image className="p21-sb-champ-img" src={psImg(p.champion?.image_url, p.champion?.name)} alt="" width={64} height={64} onError={e => champImgError(e, p.champion?.cdn_image_url, p.champion?.name)} />
                        </div>
                        <Image className="p22-role-icon" src={ROLE_ICON(p.role)} alt={p.role || ''} title={(p.role || '').toUpperCase()} width={48} height={48} />
                        <span className="p21-sb-name">{p.name || '?'}</span>
                      </div>
                    </td>
                    <td>
                      <div className={`p21-sb-kda ${kdaClass(p.kills, p.deaths, p.assists)}`}>
                        {p.kills}<span className="p21-sb-kda-sep">/</span>{p.deaths}<span className="p21-sb-kda-sep">/</span>{p.assists}
                      </div>
                      <div className="p21-sb-kda-ratio">{kdaRatio(p.kills, p.deaths, p.assists)}</div>
                    </td>
                    <td className="p21-sb-mono">{(p.minions_killed ?? 0) + (p.jungle_minions_killed ?? 0)}</td>
                    <td className="p21-sb-mono p21-sb-gold">{fmtGold(p.gold_earned)}</td>
                    <td className="p21-sb-mono">{fmtGold(totalDmg)}</td>
                    <td className="p21-sb-td-items">
                      <div className="p21-sb-items">
                        {items.slice(0, 7).map((item: any, ii: number) => (
                          item?.image_url
                            ? <Image key={ii} className="p21-sb-item" src={item.image_url} alt={item.name || ''} title={item.name || ''} width={48} height={48} />
                            : <span key={ii} className="p21-sb-item-empty" />
                        ))}
                      </div>
                    </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div className="p21-tab-content">
      <BansRow game={game} />
      {renderTeam(blueTeam, bluePlayers, 'blue')}
      {renderTeam(redTeam, redPlayers, 'red')}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// TAB 2: GENERAL (Gold Chart + Objectives + Events Timeline)
// ══════════════════════════════════════════════════════════════════════════

function GoldDiffChart({ frames, gameDuration }: { frames: any[]; gameDuration: number }): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  const diffs = useMemo(() => {
    if (!frames?.length) return [];
    return frames.map((f: any) => {
      const bg = f.blue?.gold ?? f.blue?.gold_earned ?? f.blue?.total_gold ?? 0;
      const rg = f.red?.gold ?? f.red?.gold_earned ?? f.red?.total_gold ?? 0;
      return bg - rg;
    });
  }, [frames]);

  const draw = useCallback(() => {
    if (!diffs.length || !canvasRef.current || !containerRef.current) return;
    const container = containerRef.current;
    const canvas = canvasRef.current;
    const rect = container.getBoundingClientRect();
    const W = Math.round(rect.width);
    const H = Math.round(rect.height);
    if (W === 0 || H === 0) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    const ctx = canvas.getContext('2d')!;
    ctx.scale(dpr, dpr);
    const maxAbsDiff = Math.max(2000, ...diffs.map(d => Math.abs(d)));
    const pad = { top: 20, bottom: 28, left: 50, right: 16 };
    const chartW = W - pad.left - pad.right;
    const chartH = H - pad.top - pad.bottom;
    const midY = pad.top + chartH / 2;
    const n = diffs.length;
    const totalSec = gameDuration || (n > 1 ? (n - 1) * 60 : 1);
    ctx.clearRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(255,255,255,0.05)'; ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.moveTo(pad.left, midY); ctx.lineTo(W - pad.right, midY); ctx.stroke();
    const gridStep = maxAbsDiff > 15000 ? 5000 : maxAbsDiff > 8000 ? 2500 : maxAbsDiff > 3000 ? 1000 : 500;
    ctx.font = '12px JetBrains Mono, monospace'; ctx.textAlign = 'right';
    for (let v = gridStep; v <= maxAbsDiff; v += gridStep) {
      const yUp = midY - (v / maxAbsDiff) * (chartH / 2);
      const yDown = midY + (v / maxAbsDiff) * (chartH / 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.04)';
      ctx.beginPath(); ctx.moveTo(pad.left, yUp); ctx.lineTo(W - pad.right, yUp); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(pad.left, yDown); ctx.lineTo(W - pad.right, yDown); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.fillText('+' + fmtGold(v), pad.left - 6, yUp + 3);
      ctx.fillText('-' + fmtGold(v), pad.left - 6, yDown + 3);
    }
    ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.fillText('0', pad.left - 6, midY + 4);
    ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(255,255,255,0.75)';
    for (let i = 0; i < n; i++) {
      if (i % 5 === 0 || i === n - 1) {
        const x = pad.left + (n > 1 ? (i / (n - 1)) * chartW : 0);
        ctx.fillText(i + 'm', x, H - 8);
      }
    }
    if (n < 2) return;
    const yForDiff = (diff: number): number => midY - (diff / maxAbsDiff) * (chartH / 2);
    ctx.beginPath(); ctx.moveTo(pad.left, midY);
    for (let i = 0; i < n; i++) ctx.lineTo(pad.left + (i / (n - 1)) * chartW, Math.min(yForDiff(diffs[i]), midY));
    ctx.lineTo(pad.left + chartW, midY); ctx.closePath();
    ctx.fillStyle = 'rgba(96,165,250,0.2)'; ctx.fill();
    ctx.beginPath(); ctx.moveTo(pad.left, midY);
    for (let i = 0; i < n; i++) ctx.lineTo(pad.left + (i / (n - 1)) * chartW, Math.max(yForDiff(diffs[i]), midY));
    ctx.lineTo(pad.left + chartW, midY); ctx.closePath();
    ctx.fillStyle = 'rgba(248,113,113,0.2)'; ctx.fill();
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const x = pad.left + (i / (n - 1)) * chartW;
      if (i === 0) ctx.moveTo(x, yForDiff(diffs[i])); else ctx.lineTo(x, yForDiff(diffs[i]));
    }
    ctx.strokeStyle = 'rgba(240,165,0,0.9)'; ctx.lineWidth = 2; ctx.stroke();
  }, [diffs, gameDuration]);

  useEffect(() => { const raf = requestAnimationFrame(() => draw()); return () => cancelAnimationFrame(raf); }, [draw]);
  useEffect(() => { const ro = new ResizeObserver(() => draw()); if (containerRef.current) ro.observe(containerRef.current); return () => ro.disconnect(); }, [draw]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!containerRef.current || !diffs.length) return;
    const rect = containerRef.current.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const pad = { top: 20, bottom: 28, left: 50, right: 16 };
    const chartW = rect.width - pad.left - pad.right;
    const n = diffs.length;
    const totalS = gameDuration || (n > 1 ? (n - 1) * 60 : 1);
    const sec = ((mx - pad.left) / chartW) * totalS;
    if (sec < 0 || sec > totalS) { if (tooltipRef.current) tooltipRef.current.style.display = 'none'; return; }
    const frameIdx = sec / 60;
    const lo = Math.floor(frameIdx); const hi = Math.ceil(frameIdx);
    let diff: number;
    if (lo >= n - 1) diff = diffs[n - 1];
    else if (lo < 0) diff = diffs[0];
    else { const t = frameIdx - lo; diff = diffs[lo] * (1 - t) + (diffs[hi] ?? diffs[lo]) * t; }
    if (tooltipRef.current) {
      const tt = tooltipRef.current;
      tt.style.display = 'block';
      const ttW = tt.offsetWidth || 120;
      let tx = mx - ttW / 2;
      if (tx < 4) tx = 4;
      if (tx + ttW > rect.width - 4) tx = rect.width - ttW - 4;
      tt.style.left = tx + 'px'; tt.style.top = '4px';
      tt.innerHTML = `<span class="p21-tt-time">${fmtTime(Math.round(sec))}</span> <span class="p21-tt-label" style="color:${diff >= 0 ? '#60a5fa' : '#f87171'}">${diff >= 0 ? '+' : ''}${fmtGold(Math.round(diff))}</span>`;
    }
  }, [diffs, gameDuration]);

  return (
    <div className="p21-gold-section">
      <div className="p21-section-title">Diferencia de Oro</div>
      <div className="p21-gold-graph" ref={containerRef} onMouseMove={handleMouseMove} onMouseLeave={() => { if (tooltipRef.current) tooltipRef.current.style.display = 'none'; }}>
        <canvas ref={canvasRef} className="p21-gold-canvas" />
        <div ref={tooltipRef} className="p21-chart-tooltip" style={{ display: 'none' }} />
      </div>
      <div className="p21-gold-legend">
        <span className="p21-legend-item"><span className="p21-legend-dot" style={{ background: '#60a5fa' }} /> Blue por delante</span>
        <span className="p21-legend-item"><span className="p21-legend-dot" style={{ background: '#f87171' }} /> Red por delante</span>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// TEAM GOLD CHART  (absolute gold over time — blue/red lines)
// ══════════════════════════════════════════════════════════════════════════

function TeamGoldChart({ frames, gameDuration }: { frames: any[]; gameDuration: number }): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const tooltipRef   = useRef<HTMLDivElement>(null);

  const series = useMemo(() => {
    if (!frames?.length) return { blue: [], red: [] };
    return {
      blue: frames.map((f: any) => f.blue?.gold ?? f.blue?.gold_earned ?? f.blue?.total_gold ?? 0),
      red:  frames.map((f: any) => f.red?.gold  ?? f.red?.gold_earned  ?? f.red?.total_gold  ?? 0),
    };
  }, [frames]);

  const draw = useCallback(() => {
    if (!series.blue.length || !canvasRef.current || !containerRef.current) return;
    const container = containerRef.current;
    const canvas = canvasRef.current;
    const rect = container.getBoundingClientRect();
    const W = Math.round(rect.width), H = Math.round(rect.height);
    if (!W || !H) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    const ctx = canvas.getContext('2d')!;
    ctx.scale(dpr, dpr);

    const n = series.blue.length;
    const maxVal = Math.max(1, ...series.blue, ...series.red);
    const pad = { top: 20, bottom: 28, left: 55, right: 16 };
    const cW = W - pad.left - pad.right, cH = H - pad.top - pad.bottom;
    ctx.clearRect(0, 0, W, H);

    // Grid
    const gridStep = maxVal > 60000 ? 20000 : maxVal > 30000 ? 10000 : maxVal > 15000 ? 5000 : 2000;
    ctx.font = '12px JetBrains Mono, monospace'; ctx.textAlign = 'right';
    for (let v = 0; v <= maxVal; v += gridStep) {
      const y = pad.top + cH - (v / maxVal) * cH;
      ctx.strokeStyle = 'rgba(255,255,255,0.04)'; ctx.lineWidth = 0.5;
      ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(W - pad.right, y); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.fillText(fmtGold(v), pad.left - 6, y + 4);
    }
    // X-axis labels
    ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(255,255,255,0.6)';
    for (let i = 0; i < n; i++) { if (i % 5 === 0 || i === n - 1) ctx.fillText(i + 'm', pad.left + (n > 1 ? (i / (n - 1)) * cW : 0), H - 8); }

    // Draw lines
    const drawLine = (data: number[], color: string): void => {
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const x = pad.left + (n > 1 ? (i / (n - 1)) * cW : 0);
        const y = pad.top + cH - (data[i] / maxVal) * cH;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.strokeStyle = color; ctx.lineWidth = 2.5; ctx.stroke();
    };
    drawLine(series.blue, 'rgba(96,165,250,0.9)');
    drawLine(series.red,  'rgba(248,113,113,0.9)');
  }, [series]);

  useEffect(() => { const raf = requestAnimationFrame(() => draw()); return () => cancelAnimationFrame(raf); }, [draw]);
  useEffect(() => { const ro = new ResizeObserver(() => draw()); if (containerRef.current) ro.observe(containerRef.current); return () => ro.disconnect(); }, [draw]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!containerRef.current || !series.blue.length) return;
    const rect = containerRef.current.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const pad = { top: 20, bottom: 28, left: 55, right: 16 };
    const cW = rect.width - pad.left - pad.right;
    const n = series.blue.length;
    const pct = (mx - pad.left) / cW;
    if (pct < 0 || pct > 1) { if (tooltipRef.current) tooltipRef.current.style.display = 'none'; return; }
    const idx = Math.min(Math.round(pct * (n - 1)), n - 1);
    if (tooltipRef.current) {
      const tt = tooltipRef.current;
      tt.style.display = 'block';
      const ttW = tt.offsetWidth || 160;
      let tx = mx - ttW / 2; if (tx < 4) tx = 4; if (tx + ttW > rect.width - 4) tx = rect.width - ttW - 4;
      tt.style.left = tx + 'px'; tt.style.top = '4px';
      tt.innerHTML = `<span class="p21-tt-time">${idx}m</span> <span class="p21-tt-label" style="color:#60a5fa">${fmtGold(series.blue[idx])}</span> <span class="p21-tt-label" style="color:#f87171">${fmtGold(series.red[idx])}</span>`;
    }
  }, [series]);

  return (
    <div className="p21-gold-section">
      <div className="p21-gold-graph" ref={containerRef} onMouseMove={handleMouseMove} onMouseLeave={() => { if (tooltipRef.current) tooltipRef.current.style.display = 'none'; }}>
        <canvas ref={canvasRef} className="p21-gold-canvas" />
        <div ref={tooltipRef} className="p21-chart-tooltip" style={{ display: 'none' }} />
      </div>
      <div className="p21-gold-legend">
        <span className="p21-legend-item"><span className="p21-legend-dot" style={{ background: '#60a5fa' }} /> Blue</span>
        <span className="p21-legend-item"><span className="p21-legend-dot" style={{ background: '#f87171' }} /> Red</span>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// CS PER CHAMPION CHART  (10 player lines with toggleable legend)
// ══════════════════════════════════════════════════════════════════════════

const PLAYER_COLORS = [
  '#60a5fa', '#34d399', '#a78bfa', '#f59e0b', '#06b6d4',   // blue side
  '#f87171', '#fb923c', '#e879f9', '#facc15', '#f472b6',   // red side
];

function CsPerChampionChart({ frames, game }: { frames: any[]; game: any }): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const tooltipRef   = useRef<HTMLDivElement>(null);
  const { players = [], teams = [] } = game;
  const { bluePlayers, redPlayers } = getTeamPlayers(players, teams);
  const allPlayers = [...bluePlayers, ...redPlayers];
  const roleOrder = ['top', 'jun', 'jungle', 'mid', 'adc', 'bot', 'sup', 'support'];

  const [hidden, setHidden] = useState(() => new Set<number>());
  const toggle = (idx: number): void => setHidden(prev => { const s = new Set(prev); s.has(idx) ? s.delete(idx) : s.add(idx); return s; });

  // Build per-player CS series from frames
  const playerSeries = useMemo(() => {
    if (!frames?.length || !allPlayers.length) return [];
    return allPlayers.map((p: any) => {
      const pid = p.player_id ?? p.id ?? p.player?.id;
      const role = (p.role || '').toLowerCase();
      const side = bluePlayers.includes(p) ? 'blue' : 'red';
      return {
        name: p.name || '?',
        champion: p.champion?.name || '?',
        champImg: p.champion?.image_url,
        champCdnImg: p.champion?.cdn_image_url,
        side,
        data: frames.map((f: any) => {
          const teamFrame = f[side];
          if (!teamFrame?.players) return 0;
          // Match by role first
          for (const r of [role, ...roleOrder]) {
            const fp = teamFrame.players[r];
            if (fp && fp.id === pid) return fp.cs ?? 0;
          }
          // Fallback: search all roles for matching id
          for (const fp of Object.values(teamFrame.players)) {
            if ((fp as any).id === pid) return (fp as any).cs ?? 0;
          }
          return 0;
        }),
      };
    });
  }, [frames, allPlayers, bluePlayers]);

  const draw = useCallback(() => {
    if (!playerSeries.length || !canvasRef.current || !containerRef.current) return;
    const container = containerRef.current;
    const canvas = canvasRef.current;
    const rect = container.getBoundingClientRect();
    const W = Math.round(rect.width), H = Math.round(rect.height);
    if (!W || !H) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    const ctx = canvas.getContext('2d')!;
    ctx.scale(dpr, dpr);

    const n = playerSeries[0]?.data.length || 0;
    if (n < 2) return;
    const visibleSeries = playerSeries.filter((_, i) => !hidden.has(i));
    const maxVal = Math.max(1, ...visibleSeries.flatMap((s: any) => s.data));
    const pad = { top: 20, bottom: 28, left: 40, right: 16 };
    const cW = W - pad.left - pad.right, cH = H - pad.top - pad.bottom;
    ctx.clearRect(0, 0, W, H);

    // Grid
    const gridStep = maxVal > 250 ? 50 : maxVal > 100 ? 25 : 10;
    ctx.font = '11px JetBrains Mono, monospace'; ctx.textAlign = 'right';
    for (let v = 0; v <= maxVal; v += gridStep) {
      const y = pad.top + cH - (v / maxVal) * cH;
      ctx.strokeStyle = 'rgba(255,255,255,0.04)'; ctx.lineWidth = 0.5;
      ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(W - pad.right, y); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.fillText(String(v), pad.left - 4, y + 4);
    }
    // X-axis
    ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(255,255,255,0.5)';
    for (let i = 0; i < n; i++) { if (i % 5 === 0 || i === n - 1) ctx.fillText(i + 'm', pad.left + (i / (n - 1)) * cW, H - 8); }

    // Lines
    playerSeries.forEach((s: any, idx: number) => {
      if (hidden.has(idx)) return;
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const x = pad.left + (i / (n - 1)) * cW;
        const y = pad.top + cH - (s.data[i] / maxVal) * cH;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.strokeStyle = PLAYER_COLORS[idx % PLAYER_COLORS.length];
      ctx.lineWidth = 2;
      ctx.stroke();
    });
  }, [playerSeries, hidden]);

  useEffect(() => { const raf = requestAnimationFrame(() => draw()); return () => cancelAnimationFrame(raf); }, [draw]);
  useEffect(() => { const ro = new ResizeObserver(() => draw()); if (containerRef.current) ro.observe(containerRef.current); return () => ro.disconnect(); }, [draw]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!containerRef.current || !playerSeries.length) return;
    const rect = containerRef.current.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const pad = { top: 20, bottom: 28, left: 40, right: 16 };
    const cW = rect.width - pad.left - pad.right;
    const n = playerSeries[0]?.data.length || 0;
    const pct = (mx - pad.left) / cW;
    if (pct < 0 || pct > 1) { if (tooltipRef.current) tooltipRef.current.style.display = 'none'; return; }
    const idx = Math.min(Math.round(pct * (n - 1)), n - 1);
    if (tooltipRef.current) {
      const tt = tooltipRef.current;
      tt.style.display = 'block';
      const ttW = tt.offsetWidth || 200;
      let tx = mx - ttW / 2; if (tx < 4) tx = 4; if (tx + ttW > rect.width - 4) tx = rect.width - ttW - 4;
      tt.style.left = tx + 'px'; tt.style.top = '4px';
      const visible = playerSeries.map((s: any, i: number) => hidden.has(i) ? null : s).filter(Boolean);
      const sorted = [...visible].sort((a: any, b: any) => b.data[idx] - a.data[idx]).slice(0, 5);
      tt.innerHTML = `<span class="p21-tt-time">${idx}m</span> ` +
        sorted.map((s: any) => {
          const ci = playerSeries.indexOf(s);
          return `<span style="color:${PLAYER_COLORS[ci]}; margin-left:6px">${s.name} ${s.data[idx]}</span>`;
        }).join('');
    }
  }, [playerSeries, hidden]);

  return (
    <div className="p21-gold-section">
      <div className="p21-gold-graph" ref={containerRef} onMouseMove={handleMouseMove} onMouseLeave={() => { if (tooltipRef.current) tooltipRef.current.style.display = 'none'; }}>
        <canvas ref={canvasRef} className="p21-gold-canvas" />
        <div ref={tooltipRef} className="p21-chart-tooltip" style={{ display: 'none' }} />
      </div>
      <div className="p21-cs-legend">
        {playerSeries.map((s: any, i: number) => (
          <button key={i} className={`p21-cs-legend-btn ${hidden.has(i) ? 'p21-cs-legend-off' : ''}`}
            onClick={() => toggle(i)}
            style={{ borderColor: PLAYER_COLORS[i % PLAYER_COLORS.length] }}>
            {s.champImg && <Image src={s.champImg} alt="" className="p21-cs-legend-champ" width={48} height={48} onError={e => champImgError(e, s.champCdnImg, s.name)} />}
            <span style={{ color: hidden.has(i) ? 'rgba(255,255,255,0.25)' : PLAYER_COLORS[i % PLAYER_COLORS.length] }}>{s.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Events Timeline ─────────────────────────────────────────────────

function TimelineTooltipEvent({ evt }: { evt: any }): React.ReactElement {
  const cls = classifyEvent(evt.type);
  const isKill = cls === 'kill';
  const isDrake = cls === 'drake';
  const sideClass = evt.side === 'blue' ? 'p21-ec-blue' : evt.side === 'red' ? 'p21-ec-red' : '';
  if (isKill) {
    return (
      <div className={`p21-tl-tt-event ${sideClass}`}>
        <span className="p21-ec-time">{fmtTime(evt.timestamp)}</span>
        <div className="p21-ec-kill-flow">
          {evt.killer_champion_image ? (
            <Image className="p21-ec-champ" src={evt.killer_champion_image} alt="" title={evt.killer_name || ''} width={64} height={64} onError={e => champImgError(e, evt.killer_champion_cdn_image, evt.killer_name)} />
          ) : (
            <span className="p21-ec-name">{evt.killer_name || '?'}</span>
          )}
          {evt.assists?.length > 0 && (
            <div className="p21-ec-assists">
              {evt.assists.map((a: any, j: number) => (
                a.champion_image
                  ? <Image key={j} className="p21-ec-assist-champ" src={a.champion_image} alt="" title={a.name || ''} width={48} height={48} onError={e => champImgError(e, a.champion_cdn_image, a.name)} />
                  : <span key={j} className="p21-ec-assist-name" title={a.name}>{(a.name || '?').substring(0, 4)}</span>
              ))}
            </div>
          )}
          <span className="p21-ec-arrow">→</span>
          {evt.victim_champion_image ? (
            <Image className="p21-ec-champ p21-ec-victim" src={evt.victim_champion_image} alt="" title={evt.victim_name || ''} width={64} height={64} onError={e => champImgError(e, evt.victim_champion_cdn_image, evt.victim_name)} />
          ) : (
            <span className="p21-ec-name">{evt.victim_name || '?'}</span>
          )}
        </div>
        {evt.is_first && <span className="p21-ec-first">FIRST BLOOD</span>}
      </div>
    );
  }
  return (
    <div className={`p21-tl-tt-event p21-tl-tt-obj ${sideClass}`}>
      <span className="p21-ec-time">{fmtTime(evt.timestamp)}</span>
      {isDrake && evt.dragon_type
        ? <Image className="p21-tl-tt-obj-icon" src={dragonTypeIcon(evt.dragon_type) || ''} alt={evt.dragon_type} width={48} height={48} />
        : <Image className="p21-tl-tt-obj-icon" src={objIcon(cls, evt.side) || '/objetives/dragon.png'} alt={cls} width={48} height={48} />
      }
      <span className="p21-ec-obj-label">{eventLabel(evt)}</span>
      {evt.is_first && <span className="p21-ec-first">FIRST</span>}
    </div>
  );
}

function EventsTimelineLanes({ events, gameDuration }: { events: any[]; gameDuration: number }): React.ReactElement {
  // Hooks deben ir antes de cualquier return condicional (rules-of-hooks).
  const [hoveredCluster, setHoveredCluster] = useState<string | null>(null);
  const totalSec = gameDuration || 1;
  const sorted = useMemo(() =>
    [...(events || [])].map((evt, i) => ({ ...evt, _idx: i })).sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0)),
    [events]
  );
  const blueClusters = useMemo(() => clusterEvents(sorted.filter(e => e.side === 'blue'), totalSec), [sorted, totalSec]);
  const redClusters = useMemo(() => clusterEvents(sorted.filter(e => e.side === 'red'), totalSec), [sorted, totalSec]);

  if (!events?.length) return <div className="p21-timeline-section"><div className="p21-section-title">Timeline de Eventos</div><div style={{ color: '#64748b', fontSize: 12, padding: '12px 0' }}>Sin datos de eventos para este game</div></div>;

  const renderCluster = (cluster: any, ci: number, side: string): React.ReactElement => {
    const left = cluster.pct * 100;
    const count = cluster.events.length;
    const isSingle = count === 1;
    const evt = cluster.events[0];
    const cls = classifyEvent(evt.type);
    const isKill = cls === 'kill';
    const hasObjIcon = !isKill && objIcon(cls, side);
    const size = isSingle ? 10 : Math.min(10 + count * 4, 28);
    const clusterKey = `${side}-${ci}`;
    const isClusterHovered = hoveredCluster === clusterKey;
    const dotColor = side === 'blue' ? '#60a5fa' : '#f87171';
    let markerContent: React.ReactElement;
    if (!isSingle) {
      markerContent = <span className="p21-tl-dot" style={{ width: size, height: size, fontSize: Math.max(8, size * 0.45), lineHeight: size + 'px', background: dotColor }}>{count}</span>;
    } else if (hasObjIcon) {
      markerContent = <Image src={objIcon(cls, side) || ''} alt={cls} className="p21-tl-obj-icon" width={48} height={48} />;
    } else {
      markerContent = <span className="p21-tl-dot" style={{ background: dotColor }} />;
    }
    return (
      <div key={ci} className={`p21-tl-marker ${isClusterHovered ? 'p21-tl-hovered' : ''}`} style={{ left: `${left}%` }}
        onMouseEnter={() => setHoveredCluster(clusterKey)} onMouseLeave={() => setHoveredCluster(null)}>
        {markerContent}
        {isClusterHovered && (
          <div className={`p21-tl-cluster-tooltip p21-tl-tt-${side}${left > 75 ? ' p21-tl-tt-right' : left < 15 ? ' p21-tl-tt-left' : ''}`}>
            {cluster.events.map((e: any, j: number) => <TimelineTooltipEvent key={j} evt={e} />)}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="p21-timeline-section">
      <div className="p21-section-title">Timeline de Eventos</div>
      <div className="p21-timeline-lanes">
        <div className="p21-timeline-lane p21-lane-blue">
          {blueClusters.map((c, i) => renderCluster(c, i, 'blue'))}
        </div>
        <div className="p21-timeline-axis">
          {Array.from({ length: Math.ceil(totalSec / 300) + 1 }).map((_, i) => {
            const min = i * 5;
            return <span key={i} className="p21-tl-tick" style={{ left: `${(min * 60 / totalSec) * 100}%` }}>{min}m</span>;
          })}
        </div>
        <div className="p21-timeline-lane p21-lane-red">
          {redClusters.map((c, i) => renderCluster(c, i, 'red'))}
        </div>
      </div>
    </div>
  );
}

// ── Objectives Bar (horizontal, visible in all tabs) ─────────────────────
function ObjectivesBar({ game }: { game: any }): React.ReactElement {
  const { teams = [], players = [], events = [] } = game;
  const { blueTeam, redTeam, bluePlayers, redPlayers } = getTeamPlayers(players, teams);
  const blueKills = bluePlayers.reduce((s: number, p: any) => s + (p.kills ?? 0), 0);
  const redKills  = redPlayers.reduce((s: number, p: any) => s + (p.kills ?? 0), 0);
  const blueGold  = bluePlayers.reduce((s: number, p: any) => s + (p.gold_earned ?? 0), 0);
  const redGold   = redPlayers.reduce((s: number, p: any) => s + (p.gold_earned ?? 0), 0);
  const countObj = (side: string, type: string): number => events.filter((e: any) => e.side === side && classifyEvent(e.type) === type).length;

  const objectives = [
    { key: 'towers',  iconBlue: '/objetives/turretblue.png', iconRed: '/objetives/turretred.png', blueVal: countObj('blue', 'tower'),  redVal: countObj('red', 'tower') },
    { key: 'drakes',  iconBlue: '/objetives/dragonblue.png', iconRed: '/objetives/dragonred.png', blueVal: countObj('blue', 'drake'),  redVal: countObj('red', 'drake') },
    { key: 'barons',  iconBlue: '/objetives/baronblue.png',  iconRed: '/objetives/baronred.png',  blueVal: countObj('blue', 'baron'),  redVal: countObj('red', 'baron') },
    { key: 'heralds', iconBlue: '/objetives/riftblue.png',   iconRed: '/objetives/riftred.png',   blueVal: countObj('blue', 'herald'), redVal: countObj('red', 'herald') },
    { key: 'inhibs',  iconBlue: '/objetives/inhibblue.png',  iconRed: '/objetives/inhibred.png',  blueVal: countObj('blue', 'inhib'),  redVal: countObj('red', 'inhib') },
  ];

  return (
    <div className="p21-obj-bar">
      {/* Blue side: team + [val icon] [val icon] ... */}
      <div className="p21-obj-bar-side p21-obj-bar-blue">
        <Image className="p21-obj-bar-team-logo" src={psImg(blueTeam?.image_url || blueTeam?.logo_url, blueTeam?.acronym)} alt={blueTeam?.acronym || 'BLUE'} width={48} height={48} />
        {objectives.map(obj => (
          <div key={obj.key} className="p21-obj-bar-item">
            <span className="p21-obj-bar-val">{obj.blueVal}</span>
            <Image className="p21-obj-bar-icon" src={obj.iconBlue} alt="" width={48} height={48} />
          </div>
        ))}
      </div>

      {/* Center: kills */}
      <div className="p21-obj-bar-center">
        <span className="p21-obj-bar-kill">{blueKills}</span>
        <span className="p21-obj-bar-sep">—</span>
        <span className="p21-obj-bar-kill">{redKills}</span>
      </div>

      {/* Red side (mirror): [icon val] reversed order + gold + team */}
      <div className="p21-obj-bar-side p21-obj-bar-red">
        {[...objectives].reverse().map(obj => (
          <div key={obj.key} className="p21-obj-bar-item">
            <Image className="p21-obj-bar-icon" src={obj.iconRed} alt="" width={48} height={48} />
            <span className="p21-obj-bar-val">{obj.redVal}</span>
          </div>
        ))}
        <Image className="p21-obj-bar-team-logo" src={psImg(redTeam?.image_url || redTeam?.logo_url, redTeam?.acronym)} alt={redTeam?.acronym || 'RED'} width={48} height={48} />
      </div>
    </div>
  );
}

function TabGeneral({ game }: { game: any }): React.ReactElement {
  const { events = [], frames = [] } = game;
  const [chartMode, setChartMode] = useState<'diff' | 'team' | 'cs'>('diff'); // 'diff' | 'team' | 'cs'

  return (
    <div className="p21-tab-content">
      <div className="p21-chart-switcher">
        <button className={`p21-chart-sw-btn ${chartMode === 'diff' ? 'p21-chart-sw-active' : ''}`} onClick={() => setChartMode('diff')}>Diferencia de Oro</button>
        <button className={`p21-chart-sw-btn ${chartMode === 'team' ? 'p21-chart-sw-active' : ''}`} onClick={() => setChartMode('team')}>Oro por Equipos</button>
        <button className={`p21-chart-sw-btn ${chartMode === 'cs' ? 'p21-chart-sw-active' : ''}`} onClick={() => setChartMode('cs')}>CS por Campeón</button>
      </div>
      {chartMode === 'diff' && <GoldDiffChart frames={frames} gameDuration={game.length} />}
      {chartMode === 'team' && <TeamGoldChart frames={frames} gameDuration={game.length} />}
      {chartMode === 'cs'   && <CsPerChampionChart frames={frames} game={game} />}
      <EventsTimelineLanes events={events} gameDuration={game.length} />
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// TAB 3: STATS
// ══════════════════════════════════════════════════════════════════════════

function TabStats({ game }: { game: any }): React.ReactElement {
  const { teams = [], players = [] } = game;
  const { blueTeam, redTeam, bluePlayers, redPlayers } = getTeamPlayers(players, teams);
  const nB = bluePlayers.length || 5;
  const nR = redPlayers.length || 5;

  /* Grid layout: [val bar] × nB  |  label  |  [bar val] × nR
     Each player cell is split into a fixed-width number + flexible bar.
     Using CSS subgrid-like approach: a 11-column grid (5+1+5) where each
     player column has equal width → numbers always line up.              */

  const StatRow = ({ label, getValue, format, highlight, highlightMin }: { label: string; getValue: (p: any) => number; format?: (v: number) => string; highlight?: boolean; highlightMin?: boolean }): React.ReactElement => {
    const blueVals = bluePlayers.map(getValue);
    const redVals  = redPlayers.map(getValue);
    const allVals  = [...blueVals, ...redVals];
    const maxVal   = Math.max(1, ...allVals);
    const bestVal  = highlight ? Math.max(...allVals) : (highlightMin ? Math.min(...allVals) : -Infinity);
    const hasBest  = highlight || highlightMin;
    const fmt      = format || fmtGold;
    return (
      <div className="p21-sg-row">
        {blueVals.map((v, i) => (
          <div key={`b${i}`} className="p21-sg-cell p21-sg-blue">
            <span className={`p21-sg-val ${hasBest && v === bestVal ? 'p21-sg-best' : ''}`}>{fmt(v)}</span>
            <div className="p21-sg-bar-track"><div className="p21-sg-bar p21-sg-bar-b" style={{ width: `${(v / maxVal) * 100}%` }} /></div>
          </div>
        ))}
        <div className="p21-sg-label">{label}</div>
        {redVals.map((v, i) => (
          <div key={`r${i}`} className="p21-sg-cell p21-sg-red">
            <div className="p21-sg-bar-track"><div className="p21-sg-bar p21-sg-bar-r" style={{ width: `${(v / maxVal) * 100}%` }} /></div>
            <span className={`p21-sg-val ${hasBest && v === bestVal ? 'p21-sg-best' : ''}`}>{fmt(v)}</span>
          </div>
        ))}
      </div>
    );
  };

  const Section = ({ title, children }: { title: string; children: React.ReactNode }): React.ReactElement => (
    <div className="p21-stats-section">
      <div className="p21-stats-section-title">{title}</div>
      {/* Champion header row */}
      <div className="p21-sg-row p21-sg-header">
        {bluePlayers.map((p, i) => (
          <div key={`bh${i}`} className="p21-sg-champ-cell">
            <Image className="p21-sg-champ" src={psImg(p.champion?.image_url, p.champion?.name)} alt="" title={p.name || ''} width={64} height={64} onError={e => champImgError(e, p.champion?.cdn_image_url, p.champion?.name)} />
          </div>
        ))}
        <div className="p21-sg-label" />
        {redPlayers.map((p, i) => (
          <div key={`rh${i}`} className="p21-sg-champ-cell">
            <Image className="p21-sg-champ" src={psImg(p.champion?.image_url, p.champion?.name)} alt="" title={p.name || ''} width={64} height={64} onError={e => champImgError(e, p.champion?.cdn_image_url, p.champion?.name)} />
          </div>
        ))}
      </div>
      {children}
    </div>
  );

  return (
    <div className="p21-tab-content p21-stats-tab">
      <Section title="Combate">
        <StatRow label="Kills" getValue={p => p.kills ?? 0} format={v => String(v)} highlight />
        <StatRow label="Muertes" getValue={p => p.deaths ?? 0} format={v => String(v)} highlightMin />
        <StatRow label="Asistencias" getValue={p => p.assists ?? 0} format={v => String(v)} highlight />
        <StatRow label="Mayor racha" getValue={p => p.largest_killing_spree ?? 0} format={v => String(v)} highlight />
        <StatRow label="CC infligido" getValue={p => p.total_time_crowd_control_dealt ?? 0} format={v => v + 's'} highlight />
      </Section>

      <Section title="Daño infligido">
        <StatRow label="Daño a campeones" getValue={p => p.total_damage?.dealt_to_champions ?? 0} highlight />
        <StatRow label="Daño físico" getValue={p => p.physical_damage?.dealt_to_champions ?? 0} highlight />
        <StatRow label="Daño mágico" getValue={p => p.magic_damage?.dealt_to_champions ?? 0} highlight />
        <StatRow label="Daño verdadero" getValue={p => p.true_damage?.dealt_to_champions ?? 0} highlight />
        <StatRow label="Daño total" getValue={p => p.total_damage?.dealt ?? 0} highlight />
      </Section>

      <Section title="Daño recibido y curación">
        <StatRow label="Daño recibido" getValue={p => p.total_damage?.taken ?? 0} highlight />
        <StatRow label="Físico recibido" getValue={p => p.physical_damage?.taken ?? 0} highlight />
        <StatRow label="Mágico recibido" getValue={p => p.magic_damage?.taken ?? 0} highlight />
        <StatRow label="Verdadero recibido" getValue={p => p.true_damage?.taken ?? 0} highlight />
        <StatRow label="Curación total" getValue={p => p.total_heal ?? 0} highlight />
      </Section>

      <Section title="Visión">
        <StatRow label="Guardianes puestos" getValue={p => p.wards?.placed ?? 0} format={v => String(v)} highlight />
        <StatRow label="Guardianes destruidos" getValue={p => p.kills_counters?.wards ?? 0} format={v => String(v)} highlight />
        <StatRow label="Control comprados" getValue={p => p.wards?.vision_wards_bought_in_game ?? 0} format={v => String(v)} highlight />
      </Section>

      <Section title="Economía">
        <StatRow label="Oro ganado" getValue={p => p.gold_earned ?? 0} highlight />
        <StatRow label="Oro gastado" getValue={p => p.gold_spent ?? 0} highlight />
        <StatRow label="Súbditos (CS)" getValue={p => (p.minions_killed ?? 0) + (p.jungle_minions_killed ?? 0)} format={v => String(v)} highlight />
        <StatRow label="Monstruos neutrales" getValue={p => p.kills_counters?.neutral_minions ?? 0} format={v => String(v)} highlight />
        <StatRow label="Jungla aliada" getValue={p => p.kills_counters?.neutral_minions_team_jungle ?? 0} format={v => String(v)} highlight />
        <StatRow label="Jungla enemiga" getValue={p => p.kills_counters?.neutral_minions_enemy_jungle ?? 0} format={v => String(v)} highlight />
      </Section>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// TAB 4: GRAPHS
// ══════════════════════════════════════════════════════════════════════════

function TabGraphs({ game }: { game: any }): React.ReactElement {
  const { teams = [], players = [] } = game;
  const { blueTeam, redTeam, bluePlayers, redPlayers } = getTeamPlayers(players, teams);
  const allPlayers = [...bluePlayers, ...redPlayers];
  const [openSections, setOpenSections] = useState<Set<string>>(new Set());  // Todos los gráficos cerrados por defecto
  const toggleSection = (id: string): void => { setOpenSections(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; }); };

  const getDmg = (p: any, category: string): { phys: number; magic: number; tru: number; total: number } => {
    const phys = p.physical_damage?.[category] ?? 0;
    const magic = p.magic_damage?.[category] ?? 0;
    const tru = p.true_damage?.[category] ?? 0;
    return { phys, magic, tru, total: phys + magic + tru };
  };

  // Animated collapsible wrapper for graph sections
  const GraphCollapse = ({ isOpen, children }: { isOpen: boolean; children: React.ReactNode }): React.ReactElement | null => {
    const [render, setRender] = useState(isOpen);
    const [anim, setAnim] = useState(isOpen ? 'p21-gc-open' : '');
    useEffect(() => {
      if (isOpen) {
        setRender(true);
        requestAnimationFrame(() => requestAnimationFrame(() => setAnim('p21-gc-open')));
      } else {
        setAnim('');
        const t = setTimeout(() => setRender(false), 350);
        return () => clearTimeout(t);
      }
    }, [isOpen]);
    if (!render) return null;
    return (
      <div className={`p21-gc-collapse ${anim}`}>
        <div className="p21-gc-collapse-inner">{children}</div>
      </div>
    );
  };

  const BarChart = ({ id, title, getValue, color, format }: { id: string; title: string; getValue: (p: any) => number; color?: string; format?: (v: number) => string }): React.ReactElement => {
    const isOpen = openSections.has(id);
    const maxVal = Math.max(1, ...allPlayers.map(getValue));
    const fmt = format || fmtGold;
    const renderBar = (teamPlayers: any[], side: string): React.ReactElement => (
      <div className="p21-gc-team">
        {teamPlayers.map((p: any, i: number) => (
          <div key={i} className="p21-gc-row">
            <Image className="p21-gc-champ" src={psImg(p.champion?.image_url, p.champion?.name)} alt="" title={p.name || ''} width={64} height={64} onError={e => champImgError(e, p.champion?.cdn_image_url, p.champion?.name)} />
            <span className="p21-gc-name">{p.name || '?'}</span>
            <div className="p21-gc-bar-wrap">
              <div className="p21-gc-bar" style={{ width: `${(getValue(p) / maxVal) * 100}%`, background: color || (side === 'blue' ? '#60a5fa' : '#f87171') }} />
            </div>
            <span className="p21-gc-val">{fmt(getValue(p))}</span>
          </div>
        ))}
      </div>
    );
    return (
      <div className="p21-gc-section">
        <div className="p21-gc-title p21-gc-toggle" onClick={() => toggleSection(id)}>
          <svg className={`p21-gc-chevron-icon ${isOpen ? 'p21-gc-chevron-open' : ''}`} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
          {title}
        </div>
        <GraphCollapse isOpen={isOpen}>
          <div className="p21-gc-label" style={{ color: '#60a5fa' }}>{blueTeam?.acronym || 'BLUE'}</div>
          {renderBar(bluePlayers, 'blue')}
          <div className="p21-gc-label" style={{ color: '#f87171' }}>{redTeam?.acronym || 'RED'}</div>
          {renderBar(redPlayers, 'red')}
        </GraphCollapse>
      </div>
    );
  };

  const ttRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = document.createElement('div');
    el.className = 'p21-dmg-tooltip';
    el.style.cssText = 'position:fixed;transform:translate(-50%,-100%);pointer-events:none;z-index:9999;display:none;';
    document.body.appendChild(el);
    ttRef.current = el;
    return () => { document.body.removeChild(el); ttRef.current = null; };
  }, []);

  const showTooltip = (e: React.MouseEvent<HTMLDivElement>, dmg: any): void => {
    const el = ttRef.current;
    if (!el) return;
    el.style.left = `${e.clientX}px`;
    el.style.top = `${e.clientY - 12}px`;
    el.style.display = 'block';
    const fmt = fmtGold;
    const pct = (v: number): number => dmg.total > 0 ? Math.round(v / dmg.total * 100) : 0;
    el.innerHTML = `
      <div class="p21-dmg-tt-row"><span class="p21-legend-dot" style="background:#f0a500"></span> Físico: <strong>${fmt(dmg.phys)}</strong> <span class="p21-dmg-tt-pct">(${pct(dmg.phys)}%)</span></div>
      <div class="p21-dmg-tt-row"><span class="p21-legend-dot" style="background:#60a5fa"></span> Mágico: <strong>${fmt(dmg.magic)}</strong> <span class="p21-dmg-tt-pct">(${pct(dmg.magic)}%)</span></div>
      <div class="p21-dmg-tt-row"><span class="p21-legend-dot" style="background:#e2e8f0"></span> Verdadero: <strong>${fmt(dmg.tru)}</strong> <span class="p21-dmg-tt-pct">(${pct(dmg.tru)}%)</span></div>
    `;
  };
  const moveTooltip = (e: React.MouseEvent<HTMLDivElement>): void => {
    const el = ttRef.current;
    if (!el || el.style.display === 'none') return;
    el.style.left = `${e.clientX}px`;
    el.style.top = `${e.clientY - 12}px`;
  };
  const hideTooltip = (): void => { if (ttRef.current) ttRef.current.style.display = 'none'; };

  const DmgStackedChart = ({ id, title, category }: { id: string; title: string; category: string }): React.ReactElement => {
    const isOpen = openSections.has(id);
    const maxVal = Math.max(1, ...allPlayers.map(p => getDmg(p, category).total));
    const renderBar = (teamPlayers: any[]): React.ReactElement => (
      <div className="p21-gc-team">
        {teamPlayers.map((p: any, i: number) => {
          const dmg = getDmg(p, category);
          const pct = dmg.total / maxVal * 100;
          const physPct = dmg.total > 0 ? dmg.phys / dmg.total * 100 : 0;
          const magicPct = dmg.total > 0 ? dmg.magic / dmg.total * 100 : 0;
          return (
            <div key={i} className="p21-gc-row">
              <Image className="p21-gc-champ" src={psImg(p.champion?.image_url, p.champion?.name)} alt="" title={p.name || ''} width={64} height={64} onError={e => champImgError(e, p.champion?.cdn_image_url, p.champion?.name)} />
              <span className="p21-gc-name">{p.name || '?'}</span>
              <div className="p21-gc-bar-wrap" onMouseEnter={e => showTooltip(e, dmg)} onMouseMove={moveTooltip} onMouseLeave={hideTooltip}>
                <div className="p21-gc-bar-stacked" style={{ width: `${pct}%` }}>
                  <div className="p21-gc-phys" style={{ width: `${physPct}%` }} />
                  <div className="p21-gc-magic" style={{ width: `${magicPct}%` }} />
                  <div className="p21-gc-true" style={{ width: `${100 - physPct - magicPct}%` }} />
                </div>
              </div>
              <span className="p21-gc-val">{fmtGold(dmg.total)}</span>
            </div>
          );
        })}
      </div>
    );
    return (
      <div className="p21-gc-section">
        <div className="p21-gc-title p21-gc-toggle" onClick={() => toggleSection(id)}>
          <svg className={`p21-gc-chevron-icon ${isOpen ? 'p21-gc-chevron-open' : ''}`} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
          {title}
        </div>
        <GraphCollapse isOpen={isOpen}>
          <div className="p21-gc-dmg-legend">
            <span><span className="p21-legend-dot" style={{ background: '#f0a500' }} /> Físico</span>
            <span><span className="p21-legend-dot" style={{ background: '#60a5fa' }} /> Mágico</span>
            <span><span className="p21-legend-dot" style={{ background: '#e2e8f0' }} /> Verdadero</span>
          </div>
          <div className="p21-gc-label" style={{ color: '#60a5fa' }}>{blueTeam?.acronym || 'BLUE'}</div>
          {renderBar(bluePlayers)}
          <div className="p21-gc-label" style={{ color: '#f87171' }}>{redTeam?.acronym || 'RED'}</div>
          {renderBar(redPlayers)}
        </GraphCollapse>
      </div>
    );
  };

  return (
    <div className="p21-tab-content">
      <DmgStackedChart id="dmg_dealt_to_champions" title="Daño a Campeones" category="dealt_to_champions" />
      <DmgStackedChart id="dmg_taken" title="Daño Recibido" category="taken" />
      <BarChart id="gold" title="Oro Ganado" getValue={p => p.gold_earned ?? 0} color="#f0a500" />
      <BarChart id="cs" title="CS Total" getValue={p => (p.minions_killed ?? 0) + (p.jungle_minions_killed ?? 0)} />
      <BarChart id="heal" title="Curación Total" getValue={p => p.total_heal ?? 0} color="#4ade80" />
      <BarChart id="wards" title="Guardianes Puestos" getValue={p => p.wards?.placed ?? 0} color="#c084fc" format={v => String(v)} />
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// TAB 5: RUNES
// ══════════════════════════════════════════════════════════════════════════

function TabRunes({ game }: { game: any }): React.ReactElement {
  const { teams = [], players = [] } = game;
  const { blueTeam, redTeam, bluePlayers, redPlayers } = getTeamPlayers(players, teams);

  const Ico = ({ rune, cls = 'p21-ri' }: { rune: any; cls?: string }): React.ReactElement => {
    if (!rune) return <span className={`${cls} p21-ri-empty`} />;
    return rune.image_url
      ? <Image className={cls} src={rune.image_url} alt="" title={rune.name || ''} width={48} height={48} />
      : <span className={`${cls} p21-ri-fb`} title={rune.name}>{(rune.name || '?')[0]}</span>;
  };

  const RuneRow = ({ p, side }: { p: any; side: string }): React.ReactElement => {
    const runes = p.runes_reforged;
    const primary = runes?.primary_path;
    const secondary = runes?.secondary_path;
    const shards = runes?.shards;
    const primaryPerks = primary?.lesser_runes || primary?.perks || [];
    const secondaryPerks = secondary?.lesser_runes || secondary?.perks || [];
    const sideColor = side === 'blue' ? '#60a5fa' : '#f87171';

    return (
      <div className="p21-rr">
        {/* Champion */}
        <Image className="p21-rr-champ" src={psImg(p.champion?.image_url, p.champion?.name)} alt="" width={64} height={64}
          onError={e => champImgError(e, p.champion?.cdn_image_url, p.champion?.name)} />
        <span className="p21-rr-name" style={{ color: sideColor }}>{p.name || '?'}</span>

        {/* Divider */}
        <span className="p21-rr-sep" />

        {/* Primary: path icon + keystone (big) + 3 lesser */}
        {primary?.image_url && <Ico rune={primary} cls="p21-ri p21-ri-path" />}
        <Ico rune={primary?.keystone} cls="p21-ri p21-ri-ks" />
        {primaryPerks.map((r: any, j: number) => <Ico key={`p${j}`} rune={r} />)}

        {/* Divider */}
        <span className="p21-rr-sep" />

        {/* Secondary: path icon + 2 perks */}
        {secondary?.image_url && <Ico rune={secondary} cls="p21-ri p21-ri-path" />}
        {secondaryPerks.map((r: any, j: number) => <Ico key={`s${j}`} rune={r} />)}

        {/* Divider + Shards (always show 3 slots) */}
        <span className="p21-rr-sep" />
        {['offense', 'flex', 'defense'].map((k: string) => {
          const s = shards?.[k];
          return <Ico key={k} rune={s || null} cls="p21-ri p21-ri-sh" />;
        })}
      </div>
    );
  };

  const TeamBlock = ({ label, color, playerList, side }: { label: string; color: string; playerList: any[]; side: string }): React.ReactElement => (
    <div className="p21-rr-block">
      <div className="p21-rr-team-label" style={{ color }}>{label}</div>
      {playerList.map((p, i) => <RuneRow key={i} p={p} side={side} />)}
    </div>
  );

  return (
    <div className="p21-tab-content p21-runes-tab">
      <TeamBlock label={blueTeam?.acronym || 'BLUE'} color="#60a5fa" playerList={bluePlayers} side="blue" />
      <TeamBlock label={redTeam?.acronym || 'RED'} color="#f87171" playerList={redPlayers} side="red" />
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// MATCH DETAIL VIEW (inline expanded, Pruebas21-style)
// ══════════════════════════════════════════════════════════════════════════

const CONTENT_TABS = [
  { id: 'scoreboard', label: 'Tabla de Puntuaciones' },
  { id: 'general',    label: 'General' },
  { id: 'stats',      label: 'Estadísticas' },
  { id: 'graphs',     label: 'Gráficos' },
  { id: 'runes',      label: 'Runas' },
];

export function MatchDetail({ matchId }: { matchId: number }): React.ReactElement {
  const [detail, setDetail] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeGame, setActiveGame] = useState(0);
  const [activeTab, setActiveTab] = useState('scoreboard');
  const [tabAnim, setTabAnim] = useState('p21-tab-fade-in');

  useEffect(() => {
    if (!matchId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setActiveGame(0);
    setActiveTab('scoreboard');
    setTabAnim('p21-tab-fade-in');
    clientFetch<any>(`/api/v1/pg/matches/${matchId}/detail`)
      .then(data => { if (!cancelled) { setDetail(data); setLoading(false); } })
      .catch(err => { if (!cancelled) { setError(err.message || 'Error cargando detalle'); setLoading(false); } });
    return () => { cancelled = true; };
  }, [matchId]);

  if (loading) return <div className="p22-detail-loading">Cargando datos del match...</div>;
  if (error) return <div className="p22-detail-error">{error}</div>;
  if (!detail) return <div className="p22-detail-error">Sin datos</div>;

  const games = detail.games || [];
  const currentGame = games[activeGame];
  const hasAdvancedStats = !!(currentGame && Array.isArray(currentGame.players) && currentGame.players.length > 0);

  const tabKey = `${activeTab}-${activeGame}`;

  const handleTabChange = (newTab: string): void => {
    if (newTab === activeTab) return;
    setTabAnim('p21-tab-fade-out');
    setTimeout(() => {
      setActiveTab(newTab);
      setTabAnim('p21-tab-fade-in');
    }, 180);
  };

  const renderTabContent = (): React.ReactElement => {
    if (!currentGame) return <div className="p21-error">Sin datos de juego</div>;
    switch (activeTab) {
      case 'scoreboard': return <TabScoreboard game={currentGame} />;
      case 'general':    return <TabGeneral game={currentGame} />;
      case 'stats':      return <TabStats game={currentGame} />;
      case 'graphs':     return <TabGraphs game={currentGame} />;
      case 'runes':      return <TabRunes game={currentGame} />;
      default: return <></>;
    }
  };

  return (
    <div className="p22-match-detail">
      {/* Game Tabs */}
      <div className="p21-game-tabs">
        {games.map((g: any, i: number) => {
          const gWinner = g.winner?.acronym || g.winner?.name || '';
          return (
            <button key={i} className={`p21-game-tab ${activeGame === i ? 'p21-active' : ''}`} onClick={() => setActiveGame(i)}>
              Game {g.position || i + 1}
              {gWinner && <span className="p21-tab-winner">{gWinner}</span>}
            </button>
          );
        })}
      </div>

      {/* Game Header */}
      {currentGame && (
        <div className="p21-game-header">
          <span>Duración: {fmtTime(currentGame.length)}</span>
          {currentGame.winner && (
            <span className="p21-game-winner-tag">Victoria: {currentGame.winner.acronym || currentGame.winner.name}</span>
          )}
          <span>Game {currentGame.position || activeGame + 1} / {games.length}</span>
        </div>
      )}

      {/* Objectives Bar — horizontal, visible in all tabs */}
      {currentGame && hasAdvancedStats && <ObjectivesBar game={currentGame} key={`obj-${activeGame}`} />}

      {hasAdvancedStats ? (
        <>
          {/* Content Tabs */}
          <div className="p21-content-tabs">
            {CONTENT_TABS.map(tab => (
              <button key={tab.id} className={`p21-ctab ${activeTab === tab.id ? 'p21-ctab-active' : ''}`} onClick={() => handleTabChange(tab.id)}>
                {tab.label}
              </button>
            ))}
          </div>

          <div className={`p21-tab-anim ${tabAnim}`} key={tabKey}>
            {renderTabContent()}
          </div>
        </>
      ) : (
        <div className="p22-no-stats">
          Lo sentimos, no disponemos actualmente de estadísticas avanzadas.
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// ANIMATED COLLAPSE WRAPPER
// ══════════════════════════════════════════════════════════════════════════

export function DetailCollapse({ isOpen, matchId }: { isOpen: boolean; matchId: number }): React.ReactElement | null {
  const [shouldRender, setShouldRender] = useState(false);
  const [animClass, setAnimClass] = useState('');

  useEffect(() => {
    if (isOpen) {
      setShouldRender(true);
      // Double rAF: first ensures DOM is painted, second triggers transition
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setAnimClass('p22-detail-open'));
      });
    } else {
      setAnimClass('');
      // Keep rendered during close animation, then unmount
      const timer = setTimeout(() => setShouldRender(false), 450);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  if (!shouldRender) return null;

  return (
    <div className={`p22-detail-collapse ${animClass}`}>
      <div className="p22-detail-inner">
        <MatchDetail matchId={matchId} />
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT (editorial shell — ported from /test-record)
// ══════════════════════════════════════════════════════════════════════════

function trPsImg(imageUrl: string | null | undefined, fallbackText: string | undefined): string {
  if (imageUrl) return imageUrl;
  return 'data:image/svg+xml,' + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" rx="2" fill="%23222938"/><text x="20" y="24" text-anchor="middle" fill="%2364748b" font-size="10" font-family="sans-serif">${(fallbackText || '?').substring(0, 3)}</text></svg>`
  );
}

function trFormatDate(dateValue: unknown): string {
  if (!dateValue) return '';
  if (typeof dateValue === 'string') return dateValue.split(' ')[0].split('T')[0];
  if (dateValue instanceof Date) return dateValue.toISOString().split('T')[0];
  if (typeof dateValue === 'object' && dateValue !== null && '$date' in dateValue) {
    return new Date((dateValue as { $date: string }).$date).toISOString().split('T')[0];
  }
  return String(dateValue).split(' ')[0].split('T')[0];
}

interface TrFormEntry {
  status: 'win' | 'loss' | 'pending';
  opp_acronym?: string;
  opp_logo?: string;
}

function TrFormPip({ entry }: { entry: TrFormEntry }): React.ReactElement {
  const cls =
    entry.status === 'win' ? 'tr-form-win' :
    entry.status === 'loss' ? 'tr-form-loss' :
    'tr-form-pending';
  const title = `${entry.status === 'win' ? 'W' : entry.status === 'loss' ? 'L' : '?'} vs ${entry.opp_acronym || '?'}`;
  return (
    <div className={`tr-form-pip ${cls}`} title={title}>
      {entry.opp_logo ? (
        <Image src={entry.opp_logo} alt={entry.opp_acronym || ''} width={20} height={20} className="tr-form-opp-logo" />
      ) : (
        <span className="tr-form-opp-text">{(entry.opp_acronym || '?').substring(0, 3)}</span>
      )}
    </div>
  );
}

export default function RecordClient(props: RecordClientProps): React.ReactElement {
  const { league, accent, initialMatches, tournament } = props;
  const leagueName = league.toUpperCase();
  const filters = useFilters();

  const [matches, setMatches] = useState<MatchData[]>(initialMatches);
  const [tournamentData, setTournamentData] = useState<TournamentData>(tournament);
  const [selectedMatchId, setSelectedMatchId] = useState<number | null>(null);
  const [scheduledOpen, setScheduledOpen] = useState(false);

  // Detectar viewport mobile (<=600px) para bloquear la expansion del detail
  // y mostrar mensaje "no disponible" en su lugar
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(max-width: 600px)');
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
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

    Promise.all([
      clientFetch<MatchData[]>(`/api/v1/pg/matches?${qs}`),
      clientFetch<TournamentData>(`/api/v1/pg/tournament?${qs}`),
    ]).then(([matchesData, tData]) => {
      if (!cancelled) {
        setMatches(matchesData);
        setTournamentData(tData);
      }
    }).catch(logger.error);

    return () => { cancelled = true; };
  }, [league, filters.ready, filters.year, filters.split, filters.stage]);

  // Live polling: refetch every 30s when any match is running
  useEffect(() => {
    const hasLive = matches.some(m => m.status === 'running');
    if (!hasLive || !filters.ready) return;

    const interval = setInterval(() => {
      const qs = new URLSearchParams();
      qs.set('league', league.toUpperCase());
      if (filters.year) qs.set('year', String(filters.year));
      if (filters.split) qs.set('split', filters.split);
      if (filters.stage && filters.stage !== 'all') qs.set('stage', filters.stage);

      clientFetch<MatchData[]>(`/api/v1/pg/matches?${qs}`)
        .then(setMatches)
        .catch(logger.error);
    }, 30_000);

    return () => clearInterval(interval);
  }, [matches, league, filters.ready, filters.year, filters.split, filters.stage]);

  // Split into sections
  const liveMatches = useMemo(() => matches.filter(m => m.status === 'running'), [matches]);
  const scheduledMatches = useMemo(() =>
    matches.filter(m => m.status === 'not_started').sort((a, b) =>
      new Date(a.begin_at || a.scheduled_at || 0).getTime() -
      new Date(b.begin_at || b.scheduled_at || 0).getTime()
    ), [matches]);
  const finishedMatches = useMemo(() =>
    matches.filter(m => m.status === 'finished'), [matches]);

  const totalGames = finishedMatches.reduce((acc, m) => acc + (m.games?.length || 0), 0);

  // ── Scheduled card ─────────────────────────────────────────────────────
  const ScheduledCard = ({ m }: { m: MatchData }) => {
    const dateObj = new Date(m.begin_at || m.scheduled_at || '');
    const timeStr = dateObj.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    const formA = ((m.teamA as unknown) as { form?: TrFormEntry[] })?.form || [];
    const formB = ((m.teamB as unknown) as { form?: TrFormEntry[] })?.form || [];
    const matchLabel = m.match_label || null;

    return (
      <div className="tr-match-wrapper">
        <div className="tr-match-card tr-scheduled-card">
          {matchLabel && <span className="tr-match-label">{matchLabel}</span>}
          {m.best_of > 1 && <span className="tr-bo-badge">BO{m.best_of}</span>}

          <div className="tr-scheduled-content">
            <div className="tr-form-group tr-form-left">
              {formA.slice().reverse().map((f, i) => <TrFormPip key={i} entry={f} />)}
            </div>
            <span className="tr-team-name tr-team-left">{m.teamA?.abbr || '?'}</span>
            <div className="tr-team-logo-wrap">
              <Image src={m.teamA?.logo_url || trPsImg(null, m.teamA?.abbr)} alt="" className="tr-team-logo" width={48} height={48} />
            </div>
            <div className="tr-sched-center">
              <span className="tr-sched-hour">{timeStr}</span>
            </div>
            <div className="tr-team-logo-wrap">
              <Image src={m.teamB?.logo_url || trPsImg(null, m.teamB?.abbr)} alt="" className="tr-team-logo" width={48} height={48} />
            </div>
            <span className="tr-team-name tr-team-right">{m.teamB?.abbr || '?'}</span>
            <div className="tr-form-group tr-form-right">
              {formB.map((f, i) => <TrFormPip key={i} entry={f} />)}
            </div>
          </div>
        </div>
      </div>
    );
  };

  // ── Finished / Live match card ─────────────────────────────────────────
  const MatchCard = ({ m, isSelected }: { m: MatchData; isSelected: boolean }) => {
    const isLive = m.status === 'running';
    const aWins = !isLive && m.winner_id === m.teamA?.id;
    const bWins = !isLive && m.winner_id === m.teamB?.id;
    const matchLabel = m.match_label || null;

    const scoreAClass = isLive
      ? 'tr-score-live'
      : aWins ? 'tr-score-winner-left' : 'tr-score-loser-left';
    const scoreBClass = isLive
      ? 'tr-score-live'
      : bWins ? 'tr-score-winner-right' : 'tr-score-loser-right';

    return (
      <div className="tr-match-wrapper">
        <div
          className={`tr-match-card ${isSelected ? 'tr-match-active' : ''} ${isLive ? 'tr-match-live' : ''}`}
          onClick={() => !isLive && setSelectedMatchId(isSelected ? null : m.matchid)}
          style={isLive ? { cursor: 'default' } : undefined}
        >
          {matchLabel && <span className="tr-match-label">{matchLabel}</span>}
          {m.best_of > 1 && <span className="tr-bo-badge">BO{m.best_of}</span>}

          <div className="tr-match-content">
            <div className={`tr-team-name tr-team-left ${aWins ? 'tr-team-winner' : ''}`}>
              {m.teamA?.abbr || m.teamA?.name || '?'}
            </div>
            <div className="tr-team-logo-wrap">
              <Image src={m.teamA?.logo_url || trPsImg(null, m.teamA?.abbr)} alt="" className="tr-team-logo" width={48} height={48} />
            </div>
            <div className="tr-score-center">
              <div className="tr-score">
                <span className={`tr-score-num ${scoreAClass}`}>{m.teamA?.score ?? 0}</span>
                <span className="tr-score-sep">—</span>
                <span className={`tr-score-num ${scoreBClass}`}>{m.teamB?.score ?? 0}</span>
              </div>
            </div>
            <div className="tr-team-logo-wrap">
              <Image src={m.teamB?.logo_url || trPsImg(null, m.teamB?.abbr)} alt="" className="tr-team-logo" width={48} height={48} />
            </div>
            <div className={`tr-team-name tr-team-right ${bWins ? 'tr-team-winner' : ''}`}>
              {m.teamB?.abbr || m.teamB?.name || '?'}
            </div>
            {!isLive && (
              <div className="tr-expand-icon">
                <svg className={isSelected ? 'tr-chevron-up-icon' : ''} width="18" height="18" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </div>
            )}
          </div>

          {!isLive && (aWins
            ? <div className="tr-winner-bar tr-bar-left" />
            : bWins
              ? <div className="tr-winner-bar tr-bar-right" />
              : null
          )}
        </div>
        {!isLive && (
          <div className="tr-detail-wrap">
            {isMobile ? (
              isSelected && (
                <div className="tr-mobile-unavailable">
                  Lo sentimos, este contenido no esta disponible en esta resolucion.
                </div>
              )
            ) : (
              <DetailCollapse isOpen={isSelected} matchId={m.matchid} />
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="tr-page" style={{ '--tr-accent': accent } as React.CSSProperties}>
      {/* ════════ EDITORIAL HEADER CARD ════════ */}
      <div className="tr-ed-card">
        <Image
          src={LEAGUE_LOGO(league)}
          alt=""
          className="tr-ed-watermark"
          aria-hidden="true"
          width={280}
          height={280}
        />

        <div className="tr-ed-hdr">
          <div className="tr-ed-hdr-left">
            <Image src={LEAGUE_LOGO(league)} alt={league} className="tr-ed-logo" width={64} height={64} />
            <div className="tr-ed-hdr-text">
              <span className="tr-ed-hero">{leagueName} RECORD</span>
              <span className="tr-ed-subhero">
                SEASON {filters.year || ''} · {(filters.split || '').toUpperCase()}
                {filters.stage && filters.stage !== 'all' && !/regular[_ ]?season/i.test(filters.stage) ? ` · ${filters.stage.toUpperCase()}` : ''}
              </span>
            </div>
          </div>
          <div className="tr-ed-hdr-right">
            <div className="tr-ed-teamstat">
              <span className="tr-ed-teamcount">{finishedMatches.length}</span>
              <span className="tr-ed-teamlbl">Series</span>
            </div>
            <div className="tr-ed-teamstat">
              <span className="tr-ed-teamcount">{totalGames}</span>
              <span className="tr-ed-teamlbl">Mapas</span>
            </div>
            <div className="tr-ed-teamstat">
              <span className="tr-ed-teamcount">{tournamentData.avg_duration_formatted || '0:00'}</span>
              <span className="tr-ed-teamlbl">Duración</span>
            </div>
          </div>
        </div>

        {/* Live strip — sits inside the header card, only renders when there's a real live match */}
        {liveMatches.length > 0 && (
          <div className="tr-ed-live-strip">
            <div className="tr-ed-live-head">
              <span className="tr-ed-live-dot" />
              <span className="tr-ed-live-tag">EN VIVO</span>
              <span className="tr-ed-live-count">· {liveMatches.length}</span>
              <span className="tr-ed-live-dash" />
            </div>
            <div className="tr-ed-live-list">
              {liveMatches.map(m => (
                <div key={m.matchid} className="tr-ed-live-row">
                  {m.match_label && <span className="tr-ed-live-label">{m.match_label}</span>}
                  <div className="tr-ed-live-matchup">
                    <span className="tr-ed-live-team tr-ed-live-team-left">{m.teamA?.abbr || '?'}</span>
                    <Image
                      src={m.teamA?.logo_url || trPsImg(null, m.teamA?.abbr)}
                      alt=""
                      className="tr-ed-live-logo"
                      width={32}
                      height={32}
                    />
                    <div className="tr-ed-live-score">
                      <span className="tr-ed-live-score-num tr-ed-live-score-left">{m.teamA?.score ?? 0}</span>
                      <span className="tr-ed-live-score-sep">—</span>
                      <span className="tr-ed-live-score-num tr-ed-live-score-right">{m.teamB?.score ?? 0}</span>
                    </div>
                    <Image
                      src={m.teamB?.logo_url || trPsImg(null, m.teamB?.abbr)}
                      alt=""
                      className="tr-ed-live-logo"
                      width={32}
                      height={32}
                    />
                    <span className="tr-ed-live-team tr-ed-live-team-right">{m.teamB?.abbr || '?'}</span>
                  </div>
                  {m.best_of > 1 && <span className="tr-ed-live-bo">BO{m.best_of}</span>}
                </div>
              ))}
            </div>
          </div>
        )}

      </div>

      {/* ════════ FEED SECTIONS ════════ */}

      {/* PROGRAMADAS (collapsible) */}
      {scheduledMatches.length > 0 && (
        <div className="tr-section">
          <div
            className={`tr-section-header tr-section-clickable ${scheduledOpen ? 'tr-section-open' : ''}`}
            onClick={() => setScheduledOpen(o => !o)}
          >
            <span className="tr-section-title">PROGRAMADAS</span>
            <span className="tr-section-count">· {scheduledMatches.length}</span>
            <span className="tr-section-dash" />
            <svg
              className={`tr-section-chevron ${scheduledOpen ? 'tr-chevron-up' : ''}`}
              width="16" height="16" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
            >
              <path d="M6 9l6 6 6-6" />
            </svg>
          </div>
          {scheduledOpen && (
            <div className="tr-matches">
              {scheduledMatches.map((m, i) => {
                const dateObj = new Date(m.begin_at || m.scheduled_at || '');
                const currentDate = dateObj.toISOString().split('T')[0];
                const prevDate = i > 0
                  ? new Date(scheduledMatches[i - 1].begin_at || scheduledMatches[i - 1].scheduled_at || '').toISOString().split('T')[0]
                  : null;
                const isNewDate = currentDate !== prevDate;

                return (
                  <React.Fragment key={m.matchid}>
                    {isNewDate && (
                      <div className="tr-date-header">
                        <span className="tr-date-label">{currentDate}</span>
                      </div>
                    )}
                    <ScheduledCard m={m} />
                  </React.Fragment>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* JUGADAS */}
      {finishedMatches.length > 0 ? (
        <div className="tr-section">
          <div className="tr-section-header">
            <span className="tr-section-title">JUGADAS</span>
            <span className="tr-section-count">· {finishedMatches.length}</span>
            <span className="tr-section-dash" />
          </div>
          <div className="tr-matches">
            {finishedMatches.map((m, i) => {
              const currentDate = m.date_str || trFormatDate(m.date);
              const prevDate = i > 0

                ? (finishedMatches[i - 1].date_str || trFormatDate(finishedMatches[i - 1].date))
                : null;
              const isNewDate = currentDate !== prevDate;

              return (
                <React.Fragment key={m.matchid}>
                  {isNewDate && currentDate && (
                    <div className="tr-date-header">
                      <span className="tr-date-label">{currentDate}</span>
                    </div>
                  )}
                  <MatchCard m={m} isSelected={selectedMatchId === m.matchid} />
                </React.Fragment>
              );
            })}
          </div>
        </div>
      ) : liveMatches.length === 0 && scheduledMatches.length === 0 ? (
        <div className="tr-empty">Sin partidas para los filtros seleccionados</div>
      ) : null}
    </div>
  );
}
