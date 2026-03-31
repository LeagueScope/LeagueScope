import Image from 'next/image';
import { api } from '@/lib/api';
import { teamImg, champImg, LEAGUE_LOGO, getWinRateClass } from '@/lib/constants';
import type {
  HomeData, LeagueOverview, MetaSnapshot, MetaChampion,
} from '@/lib/types';
import type { Metadata } from 'next';
import { BreadcrumbJsonLd } from '@/components/JsonLd';
import './home.css';
import InternationalEvents from './components/InternationalEvents';
import Tier3Carousel from './components/Tier3Carousel';
import McCarousel from './components/McCarousel';

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://leaguescope.gg';

export const metadata: Metadata = {
  title: 'LeagueScope — Esports Analytics',
  description:
    'Análisis competitivo de League of Legends. Estadísticas en tiempo real de LEC, LCK, LPL, LCS y más ligas.',
  openGraph: {
    title: 'LeagueScope — Esports Analytics',
    description:
      'Análisis competitivo de League of Legends. Estadísticas en tiempo real de LEC, LCK, LPL, LCS y más ligas.',
    url: BASE_URL,
    siteName: 'LeagueScope',
    type: 'website',
    locale: 'es_ES',
  },
  twitter: {
    card: 'summary',
    title: 'LeagueScope — Esports Analytics',
    description:
      'Análisis competitivo de League of Legends. Estadísticas en tiempo real de LEC, LCK, LPL, LCS y más ligas.',
  },
  alternates: {
    canonical: BASE_URL,
  },
};

// ── Data fetching (runs on server) ──────────────────────────────────────
async function getHomeData(): Promise<HomeData | null> {
  try {
    return await api<HomeData>('/pg/home', { revalidate: 120 });
  } catch {
    return null;
  }
}

// ── Page ─────────────────────────────────────────────────────────────────
export default async function HomePage() {
  const data = await getHomeData();

  if (!data || !data.leagueOverviews) {
    return (
      <div className="home-editorial-container">
        <div style={{ color: 'white', padding: '50px', textAlign: 'center' }}>
          No se pudo conectar con el servidor. Asegúrate de que el backend está corriendo en localhost:3001
        </div>
      </div>
    );
  }

  const majorCards = data.leagueOverviews || [];

  return (
    <>
    <BreadcrumbJsonLd items={[{ name: 'Inicio', href: '/' }]} />
    <div className="home-editorial-container">
      {/* ==== TIER 2: INTERNATIONAL EVENTS ==== */}
      {/* <InternationalEvents /> */}

      {/* ==== MAJOR LEAGUE CARDS (2-col grid) ==== */}
      <div className="p1-league-grid">
        {majorCards.map((league, idx) => (
          <MajorCard key={idx} league={league} />
        ))}
      </div>

      {/* ==== TIER 3: WORLDS-ACCESS MINORS (1 per slide) ==== */}
      {(data.tier3Leagues?.length ?? 0) > 0 ? (
        <Tier3Carousel leagues={data.tier3Leagues} title="Tier 2: Worlds-Access Minor Leagues" />
      ) : null}

      {/* ==== TIER 4: REGIONAL LEAGUES, ACADEMIES ==== */}
      {(data.tier4Leagues?.length ?? 0) > 0 && (
        <McCarousel subleagues={data.tier4Leagues} title="Tier 3: Regional Leagues, Academies and More" />
      )}

      {/* ==== META SNAPSHOT ==== */}
      {data.metaSnapshot && (
        <div className="home-editorial-section">
          <div className="p1-section-header-editorial">
            <span className="p1-section-title-text">
              GLOBAL META SNAPSHOT{data.metaSnapshot.patch ? ` — PATCH ${data.metaSnapshot.patch}` : ''}
              {data.metaSnapshot.totalGames ? ` (${data.metaSnapshot.totalGames} games)` : ''}
            </span>
          </div>
          <P1MetaSnapshot meta={data.metaSnapshot} />
        </div>
      )}

      {/* ==== TEAM HIGHLIGHTS ==== */}
      {!!data.teamHighlights && (
        <div className="home-editorial-section">
          <div className="p1-section-header-editorial">
            <span className="p1-section-title-text">TEAM SNAPSHOTS</span>
          </div>
          <P1TeamHighlights />
        </div>
      )}
    </div>
    </>
  );
}

// ── MAJOR CARD ──────────────────────────────────────────────────────────

function MajorCard({ league }: { league: LeagueOverview }) {
  const region = league.region;
  const regionLower = region.toLowerCase();

  const getMedal = (i: number) => {
    if (i === 0) return 'p1-major-row-gold';
    if (i === 1) return 'p1-major-row-silver';
    if (i === 2) return 'p1-major-row-bronze';
    return '';
  };

  return (
    <div className="p1-major-card" data-league={regionLower}>
      {/* Watermark Logo */}
      <Image
        src={LEAGUE_LOGO(region)}
        alt=""
        className="p1-major-watermark"
        aria-hidden="true"
        width={200}
        height={200}
      />

      {/* Editorial Header */}
      <div className="p1-major-card-header">
        <div className="p1-major-header-left">
          <Image src={LEAGUE_LOGO(region)} alt={region} className="p1-major-logo-small" width={40} height={40} />
          <div className="p1-major-header-text">
            <span className="p1-major-name-hero">{region}</span>
            {league.split && <span className="p1-major-split-editorial">{league.split}</span>}
          </div>
        </div>
      </div>

      {/* ROW 1: CORE STATS (3 Columns) */}
      <div className="p1-major-top-grid">
        {/* Column 1: RANKING */}
        <div className="p1-major-column">
          <div className="p1-section-header-editorial">
            <span className="p1-section-title-text">RANKING</span>
            <span className="p1-section-subtitle">REGULAR SEASON</span>
          </div>
          <div className="p1-data-table">
            <div className="p1-table-head">
              <span className="p1-pos-fixed">#</span>
              <span className="p1-table-cell-team">TEAM</span>
              <span className="p1-table-cell-win">W</span>
              <span className="p1-table-cell-loss">L</span>
            </div>
            {(league.miniStandings || []).slice(0, 5).map((t, i) => (
              <div key={t.abbr} className={`p1-table-row ${getMedal(i)}`}>
                <span className="p1-pos-fixed">{(i + 1).toString().padStart(2, '0')}</span>
                <div className="p1-table-cell-team">
                  <Image src={teamImg(t.logo_url, t.abbr, regionLower)} alt={t.abbr} className="p1-team-mini" width={24} height={24} />
                  <span className="p1-abbr">{t.abbr}</span>
                </div>
                <span className="p1-table-cell-win">{t.wins}</span>
                <span className="p1-table-cell-loss">{t.losses}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Column 2: SIDE PERFORMANCE */}
        <div className="p1-major-column">
          <div className="p1-section-header-editorial">
            <span className="p1-section-title-text">SIDE PERFORMANCE</span>
            <span className="p1-section-subtitle">BLUE / RED</span>
          </div>
          <div className="p1-hairline-stats">
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

        {/* Column 3: CHAMPIONS PLAYED */}
        <div className="p1-major-column">
          <div className="p1-section-header-editorial">
            <span className="p1-section-title-text">CHAMPIONS PLAYED</span>
            <span className="p1-section-subtitle">TOP 5</span>
          </div>
          <div className="p1-data-table">
            <div className="p1-table-head">
              <span className="p1-table-cell-champ">CHAMPION</span>
              <span className="p1-table-cell-val">G</span>
              <span className="p1-table-cell-val">B</span>
              <span className="p1-table-cell-val">WR</span>
            </div>
            {(league.championsPlayed || []).slice(0, 5).map((c, i) => (
              <div key={i} className={`p1-table-row ${getMedal(i)}`}>
                <div className="p1-table-cell-champ">
                  <Image src={champImg(c.image_url) || ''} alt={c.name} className="p1-champ-mini" width={28} height={28} />
                  <span>{c.name}</span>
                </div>
                <span className="p1-table-cell-val">{c.games}</span>
                <span className="p1-table-cell-val">{c.bans || 0}</span>
                <span className={`p1-table-cell-val ${getWinRateClass(c.winRate)}`}>{c.winRate}%</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ROW 2: RESULTS & FIXTURES (2 Columns) */}
      <div className="p1-major-bottom-grid">
        {/* Column 4: LATEST RESULTS */}
        <div className="p1-major-column">
          <div className="p1-section-header-editorial">
            <span className="p1-section-title-text">LATEST RESULTS</span>
            <span className="p1-section-subtitle">LAST 4</span>
          </div>
          <div className="p1-data-table">
            {(!league.recentMatches || league.recentMatches.length === 0) ? (
              <div className="p1-table-row compact">
                <span className="p1-table-cell-val" style={{ width: '100%', textAlign: 'center' }}>NO DATA</span>
              </div>
            ) : (
              league.recentMatches.slice(0, 4).map((m, i) => (
                <div key={i} className="p1-table-row compact">
                  <div className="p1-table-cell-team-editorial">
                    {m.blue.logo_url && (
                      <Image src={m.blue.logo_url} alt={m.blue.abbr} className="p1-team-mini" width={24} height={24} />
                    )}
                    <span className={`p1-abbr ${m.winner === 'blue' ? 'blue-text' : ''}`}>{m.blue.abbr}</span>
                    <span className="p1-vs-divider">VS</span>
                    <span className={`p1-abbr p1-abbr-right ${m.winner === 'red' ? 'red-text' : ''}`}>{m.red.abbr}</span>
                    {m.red.logo_url && (
                      <Image src={m.red.logo_url} alt={m.red.abbr} className="p1-team-mini" width={24} height={24} />
                    )}
                  </div>
                  <div className="p1-table-cell-score">
                    {m.isSeries ? (
                      <>
                        <span className={m.winner === 'blue' ? 'blue-text' : ''}>{m.blue.score}</span>
                        <span style={{ opacity: 0.4 }}>-</span>
                        <span className={m.winner === 'red' ? 'red-text' : ''}>{m.red.score}</span>
                      </>
                    ) : (
                      <>{m.blue.kills} : {m.red.kills}</>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Column 5: UPCOMING MATCHES */}
        <div className="p1-major-column">
          <div className="p1-section-header-editorial">
            <span className="p1-section-title-text">UPCOMING MATCHES</span>
            <span className="p1-section-subtitle">NEXT 4</span>
          </div>
          <div className="p1-data-table">
            {(!league.upcoming || league.upcoming.length === 0) ? (
              <div className="p1-table-row compact">
                <span className="p1-table-cell-val" style={{ width: '100%', textAlign: 'center' }}>NO DATA</span>
              </div>
            ) : (
              league.upcoming.slice(0, 4).map((m) => {
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
                    <div className="p1-table-cell-val" style={{ textAlign: 'left', width: '60px', opacity: 0.6 }}>
                      {dateStr}
                    </div>
                    <div className="p1-table-cell-team">
                      {logo1 && (
                        <Image src={logo1} alt={t1} className="p1-team-mini" width={24} height={24} />
                      )}
                      <span className="p1-abbr">{t1}</span>
                      <span style={{ opacity: 0.3 }}>VS</span>
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
  );
}

// ── META SNAPSHOT ────────────────────────────────────────────────────────

function P1MetaSnapshot({ meta }: { meta: MetaSnapshot }) {
  const sections: Array<{ title: string; data: MetaChampion[]; key: keyof MetaChampion; unit: string }> = [
    { title: 'MOST PICKED', data: meta.mostPickedChampions, key: 'picks', unit: 'P' },
    { title: 'MOST BANNED', data: meta.mostBannedChampions, key: 'bans', unit: 'B' },
    { title: 'HIGHEST WIN RATE (>5)', data: meta.highestWinRateChampions, key: 'winRate', unit: '%' },
    { title: 'BLUE PRIORITY', data: meta.priorityChampionsBlue, key: 'earlyPickRate', unit: '%' },
    { title: 'RED PRIORITY', data: meta.priorityChampionsRed, key: 'earlyPickRate', unit: '%' },
  ];

  return (
    <div className="p1-meta-editorial-grid">
      {sections.map((sec, idx) => (
        <div key={idx} className="p1-meta-editorial-col">
          <div className="p1-section-header-editorial compact accent">
            <span className="p1-section-title-text">{sec.title}</span>
          </div>
          <div className="p1-data-table slim">
            {sec.data?.slice(0, 5).map((ch, i) => (
              <div key={i} className="p1-table-row">
                <div className="p1-table-cell-champ">
                  <Image src={champImg(ch.image_url) || ''} alt={ch.championName} className="p1-champ-mini" width={28} height={28} />
                  <span>{ch.championName}</span>
                </div>
                <span className="p1-table-cell-val-mono accent">
                  {String(ch[sec.key])} {sec.unit}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── TEAM HIGHLIGHTS ─────────────────────────────────────────────────────

function P1TeamHighlights() {
  const sections = [
    { title: 'EARLY GAME' },
    { title: 'MID GAME' },
    { title: 'LATE GAME' },
  ];

  return (
    <div className="p1-hl-editorial-container" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
      {sections.map((sec, idx) => (
        <div key={idx} className="p1-hl-editorial-block">
          <div className="p1-hl-hdr">
            <span className="p1-hl-title">{sec.title}</span>
          </div>
          <div className="p1-hl-list">
            <div className="p1-hl-row-empty" style={{ opacity: 0.5, fontStyle: 'italic', fontSize: '12px', letterSpacing: '1px' }}>
              Pending Calculation
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
