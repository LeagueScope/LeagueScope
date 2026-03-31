import Link from 'next/link';

/* ═══════════════════════════════════════════════════════════════════════════
   404 — Page Not Found
   Next.js App Router convention: not-found.tsx
   ═══════════════════════════════════════════════════════════════════════════ */

export default function NotFound() {
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
      <h2
        style={{
          fontSize: '3rem',
          fontWeight: 900,
          marginBottom: '0.5rem',
          color: '#f0a500',
          fontFamily: "'JetBrains Mono', monospace",
        }}
      >
        404
      </h2>
      <p style={{ fontSize: '1.1rem', marginBottom: '0.5rem', color: '#f8fafc' }}>
        Página no encontrada
      </p>
      <p style={{ marginBottom: '1.5rem', color: '#64748b', fontSize: '0.9rem' }}>
        La ruta que buscas no existe o fue movida.
      </p>
      <Link
        href="/"
        style={{
          padding: '0.6rem 1.5rem',
          background: 'rgba(240, 165, 0, 0.15)',
          border: '1px solid rgba(240, 165, 0, 0.3)',
          borderRadius: '6px',
          color: '#f0a500',
          fontSize: '0.9rem',
          textDecoration: 'none',
        }}
      >
        Volver al inicio
      </Link>
    </div>
  );
}
