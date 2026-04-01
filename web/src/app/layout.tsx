import type { Metadata } from 'next';
import { FilterProvider } from '@/context/FilterContext';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import WelcomeModal from '@/components/WelcomeModal';
import { OrganizationJsonLd, WebSiteJsonLd } from '@/components/JsonLd';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || 'https://www.leaguescope.com'),
  title: {
    default: 'LeagueScope — Esports Analytics',
    template: '%s | LeagueScope',
  },
  description:
    'Análisis competitivo de League of Legends: estadísticas de jugadores, equipos, campeones y partidos de LEC, LCK, LPL, LCS y más.',
  keywords: [
    'League of Legends', 'esports', 'analytics', 'LEC', 'LCK', 'LPL', 'LCS',
    'estadísticas', 'jugadores', 'equipos', 'campeones',
  ],
  icons: {
    icon: '/LeagueScope_Logo.png',
    apple: '/LeagueScope_Logo.png',
  },
  openGraph: {
    type: 'website',
    locale: 'es_ES',
    siteName: 'LeagueScope',
  },
  twitter: {
    card: 'summary_large_image',
    site: '@LeagueScopeGG',
    creator: '@LeagueScopeGG',
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@700;800;900&display=swap"
          rel="stylesheet"
        />
        <OrganizationJsonLd />
        <WebSiteJsonLd />
      </head>
      <body>
        <FilterProvider>
          <Navbar />
          <main id="app">{children}</main>
          <Footer />
          <WelcomeModal />
        </FilterProvider>
      </body>
    </html>
  );
}
