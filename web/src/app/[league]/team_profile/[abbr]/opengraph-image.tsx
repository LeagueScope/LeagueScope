import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const alt = 'LeagueScope Team Profile';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function Image({ params }: { params: { league: string; abbr: string } }) {
  const teamAbbr = params.abbr.toUpperCase();
  const leagueUpper = params.league.toUpperCase();

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
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundImage: 'linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)', backgroundSize: '60px 60px', display: 'flex' }} />
        <div style={{ position: 'absolute', top: '-150px', left: '50%', width: '600px', height: '600px', borderRadius: '50%', background: 'radial-gradient(circle, rgba(59,130,246,0.2) 0%, transparent 60%)', transform: 'translateX(-50%)', display: 'flex' }} />
        {/* Label */}
        <span style={{ fontSize: '20px', color: 'rgba(255,255,255,0.4)', letterSpacing: '6px', textTransform: 'uppercase', fontWeight: 600, marginBottom: '12px' }}>
          Team Profile
        </span>
        {/* Team name */}
        <span style={{ fontSize: '120px', fontWeight: 900, color: '#ffffff', letterSpacing: '-4px', lineHeight: 1 }}>
          {teamAbbr}
        </span>
        {/* League badge */}
        <span style={{ fontSize: '28px', fontWeight: 700, color: 'rgba(255,255,255,0.5)', border: '2px solid rgba(255,255,255,0.15)', padding: '10px 30px', borderRadius: '8px', marginTop: '24px', letterSpacing: '4px' }}>
          {leagueUpper}
        </span>
        {/* Bottom */}
        <div style={{ position: 'absolute', bottom: '40px', display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ fontSize: '20px', fontWeight: 700, color: 'rgba(255,255,255,0.3)', letterSpacing: '1px' }}>LeagueScope</span>
          <span style={{ fontSize: '16px', color: 'rgba(255,255,255,0.2)' }}>leaguescope.com</span>
        </div>
      </div>
    ),
    { ...size },
  );
}
