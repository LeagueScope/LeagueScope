'use client';

import Image from 'next/image';
import { useRef, useEffect } from 'react';
import { teamImg, LEAGUE_LOGO } from '@/lib/constants';
import type { LeagueOverview } from '@/lib/types';

export default function McCarousel({ subleagues, title }: { subleagues: LeagueOverview[]; title: string }) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const getScrollStep = () => {
    const el = scrollRef.current;
    if (!el) return 800;
    return el.clientWidth;
  };

  useEffect(() => {
    if (!scrollRef.current || subleagues.length === 0) return;
    const interval = setInterval(() => {
      const el = scrollRef.current;
      if (!el) return;
      const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 10;
      if (atEnd) {
        el.scrollTo({ left: 0, behavior: 'smooth' });
      } else {
        el.scrollBy({ left: getScrollStep(), behavior: 'smooth' });
      }
    }, 45000);
    return () => clearInterval(interval);
  }, [subleagues]);

  const scrollLeft = () => {
    const el = scrollRef.current;
    if (!el) return;
    if (el.scrollLeft <= 0) {
      el.scrollTo({ left: el.scrollWidth, behavior: 'smooth' });
    } else {
      el.scrollBy({ left: -getScrollStep(), behavior: 'smooth' });
    }
  };

  const scrollRight = () => {
    const el = scrollRef.current;
    if (!el) return;
    const atEnd = Math.ceil(el.scrollLeft + el.clientWidth) >= el.scrollWidth - 10;
    if (atEnd) {
      el.scrollTo({ left: 0, behavior: 'smooth' });
    } else {
      el.scrollBy({ left: getScrollStep(), behavior: 'smooth' });
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
          {league.isPlayoffs && <span className="p1-playoffs-tag">PLAYOFFS</span>}
        </div>
      </div>

      {league.isPlayoffs ? (
        /* PLAYOFFS: BRACKET (left, full height) | SIDE PERF + UPCOMING (right, stacked) */
        <div className="mc-playoffs-grid">
          <div className="mc-grid-column mc-playoffs-bracket">
            <div className="p1-section-header-editorial compact">
              <div className="p1-section-title-row">
                <span className="p1-section-title-text">BRACKET</span>
                <span className="p1-bo-tag">Bo{league.bestOf || 1}</span>
              </div>
            </div>
            <div className="p1-data-table slim">
              {(league.recentMatches || []).slice(0, 8).map((m) => (
                <div key={m.matchid} className="p1-table-row">
                  <div className="p1-table-cell-team-editorial" style={{ flex: 1 }}>
                    {m.blue.logo_url && <Image src={m.blue.logo_url} alt={m.blue.abbr} className="p1-team-mini" width={24} height={24} />}
                    <span className={`p1-abbr ${m.winner === 'blue' ? 'p1-winner-text' : 'p1-loser-text'}`}>{m.blue.abbr}</span>
                    <span className="p1-vs-divider">VS</span>
                    <span className={`p1-abbr p1-abbr-right ${m.winner === 'red' ? 'p1-winner-text' : 'p1-loser-text'}`}>{m.red.abbr}</span>
                    {m.red.logo_url && <Image src={m.red.logo_url} alt={m.red.abbr} className="p1-team-mini" width={24} height={24} />}
                  </div>
                  <div className="p1-table-cell-score">
                    <span className={m.winner === 'blue' ? 'blue-text' : ''}>{m.blue.score}</span>
                    <span style={{ opacity: 0.3 }}>-</span>
                    <span className={m.winner === 'red' ? 'red-text' : ''}>{m.red.score}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="mc-playoffs-right">
            <div className="mc-grid-column">
              <div className="p1-section-header-editorial compact">
                <span className="p1-section-title-text">SIDE PERFORMANCE</span>
              </div>
              <div className="p1-hairline-stats slim">
                {(league.blueVsRed || []).map((stat) => (
                  <div className="p1-hairline-row" key={stat.label}>
                    <div className="p1-hairline-label">{stat.label}</div>
                    <div className="p1-hairline-data">
                      <span className="p1-val-mono blue">{stat.blue}%</span>
                      <div className="p1-hairline-track">
                        <div className="p1-hairline-fill blue" style={{ width: `${stat.blue}%` }}></div>
                        <div className="p1-hairline-fill red" style={{ width: `${stat.red}%` }}></div>
                      </div>
                      <span className="p1-val-mono red">{stat.red}%</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="mc-grid-column">
              <div className="p1-section-header-editorial compact">
                <span className="p1-section-title-text">UPCOMING</span>
              </div>
              <div className="p1-data-table slim">
                {(!league.upcoming || league.upcoming.length === 0) ? (
                  <div className="p1-table-row compact">
                    <span className="p1-table-cell-val" style={{ width: '100%', textAlign: 'center' }}>NO DATA</span>
                  </div>
                ) : (
                  league.upcoming.slice(0, 3).map((m) => {
                    const date = new Date(m.begin_at);
                    const dateStr = date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
                    const opp1 = m.opponents?.[0]?.opponent;
                    const opp2 = m.opponents?.[1]?.opponent;
                    const t1 = opp1?.acronym ?? 'TBD';
                    const t2 = opp2?.acronym ?? 'TBD';
                    const logo1 = opp1?.dark_mode_image_url ?? opp1?.image_url ?? null;
                    const logo2 = opp2?.dark_mode_image_url ?? opp2?.image_url ?? null;

                    return (
                      <div key={m.id} className="p1-table-row compact">
                        <div className="p1-table-cell-val" style={{ textAlign: 'left', width: '45px', opacity: 0.6, fontSize: '10px' }}>
                          {dateStr}
                        </div>
                        <div className="p1-table-cell-team" style={{ fontSize: '11px', flex: 1 }}>
                          {logo1 && (
                            <Image src={logo1} alt={t1} className="p1-team-mini" width={24} height={24} />
                          )}
                          <span className="p1-abbr">{t1}</span>
                          <span style={{ opacity: 0.2 }}>VS</span>
                          <span className="p1-abbr p1-abbr-right">{t2}</span>
                          {logo2 && (
                            <Image src={logo2} alt={t2} className="p1-team-mini" width={24} height={24} />
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <>
          {/* ROW 1: RANKING | SIDE PERFORMANCE */}
          <div className="mc-grid-row mc-grid-top">
            <div className="mc-grid-column">
              <div className="p1-section-header-editorial compact">
                <div className="p1-section-title-row">
                  <span className="p1-section-title-text">RANKING</span>
                  <span className="p1-bo-tag">Bo{league.bestOf || 1}</span>
                </div>
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
                      <Image src={teamImg(t.logo_url, t.abbr, regionLower)} alt={t.abbr || 'Team'} className="p1-team-mini" width={24} height={24} />
                      <span className="p1-abbr">{t.abbr}</span>
                    </div>
                    <span className="p1-table-cell-win">{t.wins}{t.gameWins != null && <span className="p1-game-wl"> ({t.gameWins})</span>}</span>
                    <span className="p1-table-cell-loss">{t.losses}{t.gameLosses != null && <span className="p1-game-wl"> ({t.gameLosses})</span>}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="mc-grid-column">
              <div className="p1-section-header-editorial compact">
                <span className="p1-section-title-text">SIDE PERFORMANCE</span>
              </div>
              <div className="p1-hairline-stats slim">
                {(league.blueVsRed || []).map((stat) => (
                  <div className="p1-hairline-row" key={stat.label}>
                    <div className="p1-hairline-label">{stat.label}</div>
                    <div className="p1-hairline-data">
                      <span className="p1-val-mono blue">{stat.blue}%</span>
                      <div className="p1-hairline-track">
                        <div className="p1-hairline-fill blue" style={{ width: `${stat.blue}%` }}></div>
                        <div className="p1-hairline-fill red" style={{ width: `${stat.red}%` }}></div>
                      </div>
                      <span className="p1-val-mono red">{stat.red}%</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ROW 2: RESULTS & UPCOMING */}
          <div className="mc-grid-row mc-grid-bottom">
            <div className="mc-grid-column">
              <div className="p1-section-header-editorial compact">
                <span className="p1-section-title-text">LATEST RESULTS</span>
              </div>
              <div className="p1-data-table slim">
                {(league.recentMatches || []).slice(0, 3).map((m, i) => (
                  <div key={i} className="p1-table-row compact">
                    <div className="p1-table-cell-team-editorial">
                      {m.blue.logo_url && (
                        <Image src={m.blue.logo_url} alt={m.blue.abbr || 'Blue'} className="p1-team-mini" width={24} height={24} />
                      )}
                      <span className={`p1-abbr ${m.winner === 'blue' ? 'blue-text' : ''}`}>{m.blue.abbr}</span>
                      <span className="p1-vs-divider">VS</span>
                      <span className={`p1-abbr p1-abbr-right ${m.winner === 'red' ? 'red-text' : ''}`}>{m.red.abbr}</span>
                      {m.red.logo_url && (
                        <Image src={m.red.logo_url} alt={m.red.abbr || 'Red'} className="p1-team-mini" width={24} height={24} />
                      )}
                    </div>
                    <div className="p1-table-cell-score">
                      {m.isSeries
                        ? <><span className={m.winner === 'blue' ? 'blue-text' : ''}>{m.blue.score}</span><span style={{ opacity: 0.4 }}>-</span><span className={m.winner === 'red' ? 'red-text' : ''}>{m.red.score}</span></>
                        : (m.blue.kills || m.red.kills)
                          ? <><span className={m.winner === 'blue' ? 'blue-text' : ''}>{m.blue.kills}</span><span style={{ opacity: 0.4 }}>:</span><span className={m.winner === 'red' ? 'red-text' : ''}>{m.red.kills}</span></>
                          : <span className={m.winner === 'blue' ? 'blue-text' : m.winner === 'red' ? 'red-text' : ''}>WIN</span>
                      }
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="mc-grid-column">
              <div className="p1-section-header-editorial compact">
                <span className="p1-section-title-text">UPCOMING</span>
              </div>
              <div className="p1-data-table slim">
                {(!league.upcoming || league.upcoming.length === 0) ? (
                  <div className="p1-table-row compact">
                    <span className="p1-table-cell-val" style={{ width: '100%', textAlign: 'center' }}>NO DATA</span>
                  </div>
                ) : (
                  league.upcoming.slice(0, 3).map((m) => {
                    const date = new Date(m.begin_at);
                    const dateStr = date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
                    const opp1 = m.opponents?.[0]?.opponent;
                    const opp2 = m.opponents?.[1]?.opponent;
                    const t1 = opp1?.acronym ?? 'TBD';
                    const t2 = opp2?.acronym ?? 'TBD';
                    const logo1 = opp1?.dark_mode_image_url ?? opp1?.image_url ?? null;
                    const logo2 = opp2?.dark_mode_image_url ?? opp2?.image_url ?? null;

                    return (
                      <div key={m.id} className="p1-table-row compact">
                        <div className="p1-table-cell-val" style={{ textAlign: 'left', width: '45px', opacity: 0.6, fontSize: '10px' }}>
                          {dateStr}
                        </div>
                        <div className="p1-table-cell-team" style={{ fontSize: '11px', flex: 1 }}>
                          {logo1 && (
                            <Image src={logo1} alt={t1} className="p1-team-mini" width={24} height={24} />
                          )}
                          <span className="p1-abbr">{t1}</span>
                          <span style={{ opacity: 0.2 }}>VS</span>
                          <span className="p1-abbr p1-abbr-right">{t2}</span>
                          {logo2 && (
                            <Image src={logo2} alt={t2} className="p1-team-mini" width={24} height={24} />
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </>
      )}

      {/* LIVE MATCHES */}
      <div
        className="p1-live-section"
        role="region"
        aria-label="Partidos en directo"
        aria-live="polite"
        aria-atomic="true"
      >
        <div className="p1-live-header">
          <span className={`p1-live-dot ${league.liveMatches?.length ? '' : 'inactive'}`} aria-hidden="true" />
          <span className={`p1-live-title ${league.liveMatches?.length ? '' : 'inactive'}`}>LIVE</span>
        </div>
        {league.liveMatches && league.liveMatches.length > 0 ? (
          <div className="p1-live-matches">
            {league.liveMatches.map((m) => (
              <div
                key={m.id}
                className="p1-live-card"
                aria-label={`${m.blue.abbr} ${m.blue.score} a ${m.red.score} ${m.red.abbr}, en directo`}
              >
                <div className="p1-live-team">
                  {m.blue.logo_url && <Image src={m.blue.logo_url} alt={m.blue.abbr} className="p1-live-logo" width={32} height={32} />}
                  <span className="p1-live-abbr">{m.blue.abbr}</span>
                </div>
                <div className="p1-live-score" aria-hidden="true">
                  <span className="p1-live-score-num">{m.blue.score}</span>
                  <span className="p1-live-score-sep">-</span>
                  <span className="p1-live-score-num">{m.red.score}</span>
                </div>
                <div className="p1-live-team">
                  <span className="p1-live-abbr">{m.red.abbr}</span>
                  {m.red.logo_url && <Image src={m.red.logo_url} alt={m.red.abbr} className="p1-live-logo" width={32} height={32} />}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="p1-live-empty">No hay partidos activos en este momento</div>
        )}
      </div>

      <div className="mc-editorial-footer">
        <button className="mc-editorial-link" onClick={() => window.location.href = `/${regionLower}/standings`}>
          VIEW FULL STANDINGS →
        </button>
      </div>
    </div>
  );
}
