import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const alt = 'LeagueScope — Esports Analytics';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function Image() {
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
        {/* Subtle grid overlay */}
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
            top: '-200px',
            left: '50%',
            width: '600px',
            height: '600px',
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(59,130,246,0.15) 0%, transparent 70%)',
            transform: 'translateX(-50%)',
            display: 'flex',
          }}
        />
        {/* Logo text */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '16px',
            marginBottom: '24px',
          }}
        >
          <span
            style={{
              fontSize: '72px',
              fontWeight: 900,
              color: '#ffffff',
              letterSpacing: '-2px',
            }}
          >
            LeagueScope
          </span>
        </div>
        {/* Tagline */}
        <span
          style={{
            fontSize: '28px',
            color: 'rgba(255,255,255,0.6)',
            letterSpacing: '6px',
            textTransform: 'uppercase',
            fontWeight: 500,
          }}
        >
          Esports Analytics
        </span>
        {/* League badges */}
        <div
          style={{
            display: 'flex',
            gap: '20px',
            marginTop: '40px',
          }}
        >
          {['LEC', 'LCK', 'LPL', 'LCS', 'WORLDS'].map((league) => (
            <span
              key={league}
              style={{
                fontSize: '18px',
                fontWeight: 700,
                color: 'rgba(255,255,255,0.4)',
                border: '1px solid rgba(255,255,255,0.1)',
                padding: '8px 20px',
                borderRadius: '6px',
                letterSpacing: '2px',
              }}
            >
              {league}
            </span>
          ))}
        </div>
      </div>
    ),
    { ...size },
  );
}
