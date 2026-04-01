import type { MetadataRoute } from 'next';
import { api } from '@/lib/api';
import {
  TIER1_LEAGUES,
  TIER2_LEAGUES,
  TIER3_LEAGUES,
  INTL_LEAGUES,
  EXTINCT_TIER1,
  EXTINCT_TIER2,
  EXTINCT_TIER3,
  EXTINCT_INTL,
  EXTINCT_RIFT_RIVALS,
  EXTINCT_SHOWMATCHES,
  EXTINCT_LATAM,
} from '@/lib/constants';

/* ═══════════════════════════════════════════════════════════════════════════
   Dynamic Sitemap — /sitemap.xml
   Generates URLs for all league × page combinations, including individual
   profiles for players, teams, and champions
   ═══════════════════════════════════════════════════════════════════════════ */

// Force dynamic — sitemap fetches live data from the backend
export const dynamic = 'force-dynamic';

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.leaguescope.com';

// All leagues that have content pages
const ALL_LEAGUE_IDS = [
  ...TIER1_LEAGUES,
  ...TIER2_LEAGUES,
  ...TIER3_LEAGUES,
  ...INTL_LEAGUES,
  { id: 'firststand' },
  { id: 'riftlegends' },
  { id: 'americascup' },
  ...EXTINCT_TIER1,
  ...EXTINCT_TIER2,
  ...EXTINCT_TIER3,
  ...EXTINCT_INTL,
  ...EXTINCT_RIFT_RIVALS,
  ...EXTINCT_SHOWMATCHES,
  ...EXTINCT_LATAM,
].map(l => l.id);

// Sub-pages available per league
const LEAGUE_PAGES = [
  'overview',
  'record',
  'standings',
  'players',
  'champions',
  'head2head',
];

// Leagues to fetch dynamic profile data from (TIER1 and TIER2 for SEO priority)
const PROFILE_LEAGUES = [
  ...TIER1_LEAGUES,
  ...TIER2_LEAGUES,
].map(l => l.id);

interface PlayerData {
  name: string;
  [key: string]: unknown;
}

interface TeamData {
  abbr: string;
  [key: string]: unknown;
}

interface ChampionData {
  name: string;
  [key: string]: unknown;
}

/**
 * Fetch player list from API with error handling
 * Returns empty array if API is unavailable
 */
async function fetchPlayers(league: string): Promise<PlayerData[]> {
  try {
    return await api<PlayerData[]>(`/pg/players?league=${league}`, { revalidate: 0 });
  } catch (err) {
    console.warn(`Failed to fetch players for ${league}:`, err);
    return [];
  }
}

/**
 * Fetch team list from API with error handling
 * Returns empty array if API is unavailable
 */
async function fetchTeams(league: string): Promise<TeamData[]> {
  try {
    return await api<TeamData[]>(`/pg/teams?league=${league}`, { revalidate: 0 });
  } catch (err) {
    console.warn(`Failed to fetch teams for ${league}:`, err);
    return [];
  }
}

/**
 * Fetch champion list from API with error handling
 * Returns empty array if API is unavailable
 */
async function fetchChampions(league: string): Promise<ChampionData[]> {
  try {
    return await api<ChampionData[]>(`/pg/champions?league=${league}`, { revalidate: 0 });
  } catch (err) {
    console.warn(`Failed to fetch champions for ${league}:`, err);
    return [];
  }
}

/**
 * Fetch all profile data for a league in parallel
 * Uses Promise.allSettled to ensure partial failures don't break the sitemap
 */
async function fetchProfileDataForLeague(league: string) {
  const results = await Promise.allSettled([
    fetchPlayers(league),
    fetchTeams(league),
    fetchChampions(league),
  ]);

  const players = results[0].status === 'fulfilled' ? results[0].value : [];
  const teams = results[1].status === 'fulfilled' ? results[1].value : [];
  const champions = results[2].status === 'fulfilled' ? results[2].value : [];

  return { players, teams, champions };
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date().toISOString();

  // Static pages
  const staticPages: MetadataRoute.Sitemap = [
    {
      url: BASE_URL,
      lastModified: now,
      changeFrequency: 'daily',
      priority: 1.0,
    },
    {
      url: `${BASE_URL}/home`,
      lastModified: now,
      changeFrequency: 'daily',
      priority: 0.9,
    },
    {
      url: `${BASE_URL}/about`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.3,
    },
  ];

  // League × page combinations
  const leaguePages: MetadataRoute.Sitemap = [];

  for (const leagueId of ALL_LEAGUE_IDS) {
    for (const page of LEAGUE_PAGES) {
      // Tier 1 and international leagues get higher priority
      const isTier1 = TIER1_LEAGUES.some(l => l.id === leagueId);
      const isIntl = INTL_LEAGUES.some(l => l.id === leagueId);
      const priority = isTier1 || isIntl ? 0.8 : 0.5;

      leaguePages.push({
        url: `${BASE_URL}/${leagueId}/${page}`,
        lastModified: now,
        changeFrequency: page === 'record' ? 'daily' : 'weekly',
        priority,
      });
    }
  }

  // Fetch dynamic profile data for TIER1 and TIER2 leagues only
  // To extend to more leagues, add them to PROFILE_LEAGUES above
  const profilePages: MetadataRoute.Sitemap = [];

  const leagueProfiles = await Promise.all(
    PROFILE_LEAGUES.map(async (league) => ({
      league,
      data: await fetchProfileDataForLeague(league),
    })),
  );

  for (const { league, data } of leagueProfiles) {
    // Player profile URLs and historical URLs
    for (const player of data.players) {
      const encodedName = encodeURIComponent(player.name);

      profilePages.push({
        url: `${BASE_URL}/${league}/player_profile/${encodedName}`,
        lastModified: now,
        changeFrequency: 'weekly',
        priority: 0.6,
      });

      profilePages.push({
        url: `${BASE_URL}/${league}/player_historical/${encodedName}`,
        lastModified: now,
        changeFrequency: 'monthly',
        priority: 0.4,
      });
    }

    // Team profile URLs and historical URLs
    for (const team of data.teams) {
      const encodedAbbr = encodeURIComponent(team.abbr);

      profilePages.push({
        url: `${BASE_URL}/${league}/team_profile/${encodedAbbr}`,
        lastModified: now,
        changeFrequency: 'weekly',
        priority: 0.6,
      });

      profilePages.push({
        url: `${BASE_URL}/${league}/team_historical/${encodedAbbr}`,
        lastModified: now,
        changeFrequency: 'monthly',
        priority: 0.4,
      });
    }

    // Champion profile URLs and historical URLs
    for (const champion of data.champions) {
      const encodedName = encodeURIComponent(champion.name);

      profilePages.push({
        url: `${BASE_URL}/${league}/champion_profile/${encodedName}`,
        lastModified: now,
        changeFrequency: 'weekly',
        priority: 0.6,
      });

      profilePages.push({
        url: `${BASE_URL}/${league}/champion_historical/${encodedName}`,
        lastModified: now,
        changeFrequency: 'monthly',
        priority: 0.4,
      });
    }
  }

  return [...staticPages, ...leaguePages, ...profilePages];
}
