'use client';

export default function PlayerProfileError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '55vh',
        color: '#e0e0e0',
        textAlign: 'center',
        padding: '2rem',
        gap: '8px',
      }}
    >
      <div
        style={{
          width: 56, height: 56, borderRadius: '50%',
          background: 'rgba(248, 113, 113, 0.12)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          marginBottom: '8px',
        }}
      >
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#f87171" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
      </div>
      <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#f8fafc', margin: 0 }}>
        Jugador no disponible
      </h2>
      <p style={{ color: '#7a8ba0', fontSize: '0.9rem', maxWidth: 400, margin: 0 }}>
        No se ha podido cargar el perfil de este jugador. Es posible que no exista en esta liga o que el servidor no responda.
      </p>
      {process.env.NODE_ENV === 'development' && error.message && (
        <code style={{ display: 'block', marginTop: 8, padding: '8px 14px', background: 'rgba(255,255,255,0.05)', borderRadius: 4, fontSize: '0.78rem', color: '#94a3b8', maxWidth: 500, wordBreak: 'break-word' }}>
          {error.message}
        </code>
      )}
      <div style={{ display: 'flex', gap: '12px', marginTop: '12px' }}>
        <button onClick={reset} style={{ padding: '0.55rem 1.4rem', background: 'rgba(240, 165, 0, 0.15)', border: '1px solid rgba(240, 165, 0, 0.3)', borderRadius: 4, color: '#f0a500', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600 }}>
          Reintentar
        </button>
        <button onClick={() => window.history.back()} style={{ padding: '0.55rem 1.4rem', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 4, color: '#94a3b8', cursor: 'pointer', fontSize: '0.85rem' }}>
          Volver atrás
        </button>
      </div>
    </div>
  );
}
