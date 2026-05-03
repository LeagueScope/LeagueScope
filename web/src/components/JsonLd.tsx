/**
 * JSON-LD Structured Data components for SEO rich snippets.
 * Renders <script type="application/ld+json"> in <head> via Next.js metadata.
 */

type JsonLdProps = { data: Record<string, unknown> };

// Escapa caracteres que romperían el <script> tag o el JSON-in-HTML embedding.
// JSON.stringify por defecto NO escapa "</script>" ni los separadores Unicode
// U+2028 / U+2029, así que un nombre de jugador con "</script><script>..." en
// la URL inyectaría HTML.
function safeJsonLd(data: Record<string, unknown>): string {
  // JSON.stringify por defecto NO escapa los separadores de linea/parrafo
  // U+2028 / U+2029, que rompen un <script> tag inline. Tampoco escapa "<",
  // permitiendo "</script>" en los datos. Los blindamos antes de inyectar.
  const LS = String.fromCharCode(0x2028);
  const PS = String.fromCharCode(0x2029);
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .split(LS).join('\\u2028')
    .split(PS).join('\\u2029');
}

export function JsonLd({ data }: JsonLdProps) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: safeJsonLd(data) }}
    />
  );
}

// ── Organization (global, used in layout) ──────────────────────────────

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.leaguescope.com';

export function OrganizationJsonLd() {
  return (
    <JsonLd
      data={{
        '@context': 'https://schema.org',
        '@type': 'Organization',
        name: 'LeagueScope',
        url: BASE_URL,
        logo: `${BASE_URL}/LeagueScope_Logo.png`,
        description:
          'Plataforma de analytics competitivo de League of Legends con estadisticas en tiempo real de todas las ligas profesionales.',
        sameAs: [
          'https://x.com/LeagueScope',
          'https://www.instagram.com/leaguescope',
          'https://discord.gg/zn2NW4E4',
        ],
      }}
    />
  );
}

export function WebSiteJsonLd() {
  return (
    <JsonLd
      data={{
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        name: 'LeagueScope',
        url: BASE_URL,
        description:
          'Analisis competitivo de League of Legends. Estadisticas en tiempo real de LEC, LCK, LPL, LCS y mas ligas.',
        inLanguage: 'es',
      }}
    />
  );
}

// ── SportsTeam (team profile pages) ────────────────────────────────────

interface TeamJsonLdProps {
  name: string;
  abbr: string;
  league: string;
  logoUrl?: string;
  players?: string[];
  url: string;
}

export function SportsTeamJsonLd({ name, abbr, league, logoUrl, players, url }: TeamJsonLdProps) {
  return (
    <JsonLd
      data={{
        '@context': 'https://schema.org',
        '@type': 'SportsTeam',
        name: name || abbr,
        alternateName: abbr,
        sport: 'League of Legends',
        url: `${BASE_URL}${url}`,
        ...(logoUrl ? { logo: logoUrl } : {}),
        memberOf: {
          '@type': 'SportsOrganization',
          name: league.toUpperCase(),
        },
        ...(players && players.length > 0
          ? {
              athlete: players.map((p) => ({
                '@type': 'Person',
                name: p,
              })),
            }
          : {}),
      }}
    />
  );
}

// ── Person (player profile pages) ──────────────────────────────────────

interface PlayerJsonLdProps {
  name: string;
  position?: string;
  teamName?: string;
  teamAbbr?: string;
  imageUrl?: string;
  league: string;
  url: string;
}

export function PlayerJsonLd({ name, position, teamName, teamAbbr, imageUrl, league, url }: PlayerJsonLdProps) {
  return (
    <JsonLd
      data={{
        '@context': 'https://schema.org',
        '@type': 'Person',
        name,
        url: `${BASE_URL}${url}`,
        jobTitle: position ? `Professional League of Legends ${position}` : 'Professional League of Legends Player',
        ...(imageUrl ? { image: imageUrl } : {}),
        affiliation: {
          '@type': 'SportsTeam',
          name: teamName || teamAbbr || 'Unknown',
          memberOf: {
            '@type': 'SportsOrganization',
            name: league.toUpperCase(),
          },
        },
      }}
    />
  );
}

// ── VideoGame (champion profile pages) ─────────────────────────────────

interface ChampionJsonLdProps {
  name: string;
  imageUrl?: string;
  league: string;
  url: string;
  games?: number;
  winRate?: number;
}

export function ChampionJsonLd({ name, imageUrl, league, url, games, winRate }: ChampionJsonLdProps) {
  return (
    <JsonLd
      data={{
        '@context': 'https://schema.org',
        '@type': 'Article',
        headline: `${name} Pro Play Statistics - ${league.toUpperCase()}`,
        url: `${BASE_URL}${url}`,
        ...(imageUrl ? { image: imageUrl } : {}),
        description: `${name} professional play statistics in ${league.toUpperCase()}${games ? ` across ${games} games` : ''}${winRate ? ` with a ${winRate}% win rate` : ''}.`,
        author: {
          '@type': 'Organization',
          name: 'LeagueScope',
        },
        publisher: {
          '@type': 'Organization',
          name: 'LeagueScope',
          logo: {
            '@type': 'ImageObject',
            url: `${BASE_URL}/LeagueScope_Logo.png`,
          },
        },
      }}
    />
  );
}

// ── BreadcrumbList (reusable for any page) ─────────────────────────────

interface BreadcrumbItem {
  name: string;
  href: string;
}

export function BreadcrumbJsonLd({ items }: { items: BreadcrumbItem[] }) {
  return (
    <JsonLd
      data={{
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: items.map((item, i) => ({
          '@type': 'ListItem',
          position: i + 1,
          name: item.name,
          item: `${BASE_URL}${item.href}`,
        })),
      }}
    />
  );
}
