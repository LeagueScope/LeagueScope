/**
 * JSON-LD Structured Data components for SEO rich snippets.
 * Renders <script type="application/ld+json"> in <head> via Next.js metadata.
 */

type JsonLdProps = { data: Record<string, unknown> };

export function JsonLd({ data }: JsonLdProps) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
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
          'https://twitter.com/LeagueScopeGG',
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
