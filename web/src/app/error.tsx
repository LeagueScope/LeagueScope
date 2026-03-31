'use client';

/* ═══════════════════════════════════════════════════════════════════════════
   Global Error Boundary — catches runtime errors in route segments
   Next.js App Router convention: error.tsx
   ═══════════════════════════════════════════════════════════════════════════ */

export default function GlobalError({
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
        minHeight: '60vh',
        color: '#e0e0e0',
        textAlign: 'center',
        padding: '2rem',
      }}
    >
      <h2 style={{ fontSize: '1.5rem', marginBottom: '1rem', color: '#ff4444' }}>
        Algo ha fallado
      </h2>
      <p style={{ marginBottom: '1.5rem', color: '#999' }}>
        Ha ocurrido un error inesperado al cargar la página.
      </p>
      <div style={{ display: 'flex', gap: '12px' }}>
        <button
          onClick={reset}
          style={{
            padding: '0.6rem 1.5rem',
            background: 'rgba(240, 165, 0, 0.15)',
            border: '1px solid rgba(240, 165, 0, 0.3)',
            borderRadius: '6px',
            color: '#f0a500',
            cursor: 'pointer',
            fontSize: '0.9rem',
          }}
        >
          Reintentar
        </button>
        <button
          onClick={() => (window.location.href = '/')}
          style={{
            padding: '0.6rem 1.5rem',
            background: 'rgba(255,255,255,0.1)',
            border: '1px solid rgba(255,255,255,0.2)',
            borderRadius: '6px',
            color: '#e0e0e0',
            cursor: 'pointer',
            fontSize: '0.9rem',
          }}
        >
          Volver al inicio
        </button>
      </div>
    </div>
  );
}
