import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const alt = 'LeagueScope';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

// Color mapping for leagues
const LEAGUE_COLORS: Record<string, string> = {
  lec: '#1e88e5',
  lck: '#d32f2f',
  lpl: '#ff8f00',
  lcs: '#1565c0',
  worlds: '#c49b3c',
  msi: '#7b1fa2',
  cblol: '#2e7d32',
  lcp: '#00838f',
  vcs: '#c62828',
  pcs: '#6a1b9a',
  ljl: '#e65100',
  lla: '#558b2f',
  tcl: '#ad1457',
  lfl: '#283593',
};

export default async function Image({ params }: { params: { league: string } }) {
  const league = params.league;
  const leagueUpper = league.toUpperCase();
  const accentColor = LEAGUE_COLORS[league.toLowerCase()] || '#3b82f6';

  return new ImageResponse(
    (
      <div
        style={{
          background: 'linear-gradient(135deg, #0a0a0f 0%, #12121a 50%, #0d1117 100%)',
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'Inter, sans-serif',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* Grid overlay */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundImage:
              'linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)',
            backgroundSize: '60px 60px',
            display: 'flex',
          }}
        />
        {/* Accent glow */}
        <div
          style={{
            position: 'absolute',
            top: '-150px',
            left: '50%',
            width: '700px',
            height: '700px',
            borderRadius: '50%',
            background: `radial-gradient(circle, ${accentColor}25 0%, transparent 60%)`,
            transform: 'translateX(-50%)',
            display: 'flex',
          }}
        />
        {/* League name big */}
        <span
          style={{
            fontSize: '120px',
            fontWeight: 900,
            color: '#ffffff',
            letterSpacing: '-4px',
            lineHeight: 1,
          }}
        >
          {leagueUpper}
        </span>
        {/* Subtitle */}
        <span
          style={{
            fontSize: '24px',
            color: 'rgba(255,255,255,0.5)',
            letterSpacing: '8px',
            textTransform: 'uppercase',
            fontWeight: 500,
            marginTop: '20px',
          }}
        >
          Statistics & Analytics
        </span>
        {/* Bottom bar */}
        <div
          style={{
            position: 'absolute',
            bottom: '40px',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
          }}
        >
          <span
            style={{
              fontSize: '20px',
              fontWeight: 700,
              color: 'rgba(255,255,255,0.3)',
              letterSpacing: '1px',
            }}
          >
            LeagueScope
          </span>
          <span
            style={{
              width: '4px',
              height: '4px',
              borderRadius: '50%',
              background: accentColor,
              display: 'flex',
            }}
          />
          <span
            style={{
              fontSize: '16px',
              color: 'rgba(255,255,255,0.2)',
              letterSpacing: '1px',
            }}
          >
            leaguescope.gg
          </span>
        </div>
      </div>
    ),
    { ...size },
  );
}
