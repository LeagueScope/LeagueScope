'use client';

import Image from 'next/image';
import { useRef, useEffect } from 'react';
import { LEAGUE_LOGO } from '@/lib/constants';
import type { LeagueOverview } from '@/lib/types';

export default function McCarousel({ subleagues, title }: { subleagues: LeagueOverview[]; title: string }) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!scrollRef.current || subleagues.length === 0) return;
    const interval = setInterval(() => {
      const el = scrollRef.current;
      if (!el) return;
      const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 10;
      if (atEnd) {
        el.scrollTo({ left: 0, behavior: 'smooth' });
      } else {
        const cardW = (el.querySelector('.mc-editorial-card') as HTMLElement)?.offsetWidth || 480;
        el.scrollBy({ left: cardW + 24, behavior: 'smooth' });
      }
    }, 45000);
    return () => clearInterval(interval);
  }, [subleagues]);

  const scrollLeft = () => {
    if (!scrollRef.current) return;
    const el = scrollRef.current;
    const cardW = (el.querySelector('.mc-editorial-card') as HTMLElement)?.offsetWidth || 480;
    if (el.scrollLeft <= 0) {
      el.scrollTo({ left: el.scrollWidth, behavior: 'smooth' });
    } else {
      el.scrollBy({ left: -(cardW + 24), behavior: 'smooth' });
    }
  };

  const scrollRight = () => {
    if (!scrollRef.current) return;
    const el = scrollRef.current;
    const cardW = (el.querySelector('.mc-editorial-card') as HTMLElement)?.offsetWidth || 480;
    const atEnd = Math.ceil(el.scrollLeft + el.clientWidth) >= el.scrollWidth - 10;
    if (atEnd) {
      el.scrollTo({ left: 0, behavior: 'smooth' });
    } else {
      el.scrollBy({ left: cardW + 24, behavior: 'smooth' });
    }
  };

  return (
    <div className="home-editorial-section">
      <div className="p1-carousel-header">
        <h2 className="home-editorial-section-title">{title}</h2>
        <div className="p1-carousel-nav">
          <button className="p1-nav-btn" onClick={scrollLeft}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6" /></svg>
          </button>
          <button className="p1-nav-btn" onClick={scrollRight}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18l6-6-6-6" /></svg>
          </button>
        </div>
      </div>
      <div className="mc-carousel-wrapper" ref={scrollRef}>
        {subleagues.map((sub) => (
          <div key={sub.region} className="mc-carousel-item">
            <McCard league={sub} />
          </div>
        ))}
      </div>
    </div>
  );
}

function McCard({ league }: { league: LeagueOverview }) {
  const region = league.region;
  const regionLower = region.toLowerCase();

  return (
    <div className="mc-editorial-card" data-league={regionLower}>
      <Image src={LEAGUE_LOGO(region)} alt="" className="mc-editorial-watermark" aria-hidden="true" width={200} height={200} />

      <div className="mc-editorial-header">
        <div className="mc-header-left">
          <Image src={LEAGUE_LOGO(region)} alt={region} className="mc-logo-small" width={40} height={40} />
          <span className="mc-region-label">{region}</span>
          <span className="mc-split-label">{league.split || 'SEASON 2026'}</span>
        </div>
        <div className="mc-header-right">
          <span className="mc-tag">MINOR</span>
        </div>
      </div>

      <div className="mc-editorial-grid">
        {/* Standings */}
        <div className="mc-editorial-column">
          <div className="p1-section-header-editorial compact">
            <span className="p1-section-title-text">STANDINGS</span>
          </div>
          <div className="p1-data-table slim">
            <div className="p1-table-head">
              <span className="p1-pos-fixed">#</span>
              <span className="p1-table-cell-team">TEAM</span>
              <span className="p1-table-cell-win">W</span>
              <span className="p1-table-cell-loss">L</span>
            </div>
            {league.miniStandings?.slice(0, 4).map((t, i) => (
              <div key={t.abbr} className="p1-table-row">
                <span className="p1-pos-fixed">{(i + 1).toString().padStart(2, '0')}</span>
                <div className="p1-table-cell-team">
                  {t.logo_url && (
                    <Image src={t.logo_url} alt={t.abbr} className="p1-team-mini" width={24} height={24} />
                  )}
                  <span className="p1-abbr">{t.abbr}</span>
                </div>
                <span className="p1-table-cell-win">{t.wins}</span>
                <span className="p1-table-cell-loss">{t.losses}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Best Players / MVPs */}
        <div className="mc-editorial-column">
          <div className="p1-section-header-editorial compact">
            <span className="p1-section-title-text">MVPS</span>
          </div>
          <div className="p1-data-table slim">
            {(league.bestPlayers || []).slice(0, 4).map((p, i) => (
              <div key={i} className="p1-table-row">
                <span className="p1-pos-fixed">{(i + 1).toString().padStart(2, '0')}</span>
                <div className="p1-table-cell-champ">
                  {p.team_logo_url && (
                    <Image src={p.team_logo_url || ''} alt={p.team || 'Team'} className="p1-team-mini" width={24} height={24} />
                  )}
                  <span>{p.playerName}</span>
                </div>
                <span className="p1-table-cell-val-mono">{p.kda}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mc-editorial-footer">
        <div className="mc-footer-stat">
          <span className="lbl">GAMES</span>
          <span className="val">{league.miniStandings?.reduce((acc, t) => acc + t.wins + t.losses, 0) || 0}</span>
        </div>
        <button className="mc-editorial-link" onClick={() => window.location.href = `/${regionLower}/record`}>
          FULL INDEX →
        </button>
      </div>
    </div>
  );
}
