// ── Image helpers ──────────────────────────────────────────────────────────
// Assets fallback — GitHub raw repo
export const ASSETS_URL = 'https://raw.githubusercontent.com/ItsAndroide01/assets/main';

// Champion images from PandaScore CDN via backend image_url field
export const champImg = (image_url?: string | null): string | null => image_url || null;

// Team logos — uses backend-provided URL first, falls back to GitHub assets
export const TEAM_LOGO = (abbr?: string, league = 'lec') =>
  `${ASSETS_URL}/leagues/${league.toUpperCase()}/${abbr?.toLowerCase() || 'unknown'}.png`;

export const teamImg = (logo_url?: string | null, abbr?: string, league = 'lec') =>
  logo_url || TEAM_LOGO(abbr, league);

// Logo de liga
const LOCAL_LOGO_LEAGUES = [
  'lck', 'lpl', 'lec', 'lcs', 'lcp', 'cblol',
  'lcl', 'lco', 'ljl', 'lla', 'lms', 'tcl',
  'lfl', 'les', 'msi', 'worlds',
];
const LOCAL_LOGO_NAMES: Record<string, string> = {
  worlds: 'logo_Worlds',
  firststand: 'logo_FS',
  emeamasters: 'emea_logo',
  ebl: 'ebl_logo',
  lckcl: 'lck_cl_logo',
  nacl: 'na_cl_logo',
  lrn: 'lrn_logo',
  lrs: 'lrs_logo',
  roadoflegends: 'road_logo',
  circuitodesaf: 'circuito_logo',
  vcs: 'vcs_logo',
  prm: 'pr_logo',
  lit: 'lit_logo',
  nlc: 'nlc_logo',
  pcs: 'pcs_logo',
  ldl: 'ldl_logo',
  ltanorth: 'lta_north_logo',
  ltasouth: 'lta_south_logo',
  lvpsl: 'lvp_logo',
  lvpsl2: 'lvp_logo',
  ul: 'ultra_logo',
  gll: 'gll_logo',
  tcldiv2: 'logo_TCL',
  belgianleague: 'belgian_logo',
  dutchleague: 'dutch_logo',
  eslmeister: 'meisterschaft_logo',
  challengefr: 'logo_LFL',
  hm: 'hitpoint_logo',
  allstar: 'lpl_all_logo',
  iem: 'iem_logo',
  intwildcard: 'iwci_logo',
  eumasters: 'eu_logo',
  rrnaeu: 'rift_logo',
  rrlcklpllms: 'rift_logo',
  rrlcklplvcs: 'rift_logo',
  rrlcltcl: 'rift_logo',
  rrlcltclvcs: 'rift_logo',
  rrcbclslln: 'rift_logo',
  rrgplljlopl: 'rift_logo',
  lmf: 'lmf_logo',
};
const LEAGUE_LOGOS_CDN: Record<string, string> = {
  eulcs: 'https://cdn-api.pandascore.co/images/league/image/290/eu-lcs-b29u5nim.png',
  nalcs: 'https://cdn-api.pandascore.co/images/league/image/289/na-lcs-g63ljv52.png',
};

export const LEAGUE_LOGO = (league?: string) => {
  const key = league?.toLowerCase() || '';
  if (LOCAL_LOGO_NAMES[key]) return `/logos/${LOCAL_LOGO_NAMES[key]}.png`;
  if (LOCAL_LOGO_LEAGUES.includes(key)) return `/logos/logo_${key.toUpperCase()}.png`;
  return LEAGUE_LOGOS_CDN[key] || '/logos/no_logo.png';
};

// Role icon helper
const ROLE_MAP: Record<string, string> = { adc: 'bot', jun: 'jng', jungle: 'jng', support: 'sup' };
export const ROLE_ICON = (role?: string): string => {
  const r = role?.toLowerCase() || 'unknown';
  return `/rol/${ROLE_MAP[r] || r}.png`;
};

// Flag icon helper
export const FLAG_ICON = (code?: string): string =>
  `https://flagcdn.com/w40/${code?.toLowerCase() || 'xx'}.png`;

// Objective icon helper
export const OBJECTIVE_ICON = (type?: string): string =>
  `/objetives/${type?.toLowerCase() || 'unknown'}.png`;

// Dragon icon helper
export const DRAGON_ICON = (type?: string): string =>
  `/dragons/${type?.toLowerCase() || 'unknown'}.png`;

export const DRAGON_COLORS: Record<string, string> = {
  infernal: '#FF6B4A',
  mountain: '#C4A35A',
  cloud: '#7EC8E3',
  ocean: '#4A90D9',
  chemtech: '#7CB342',
  hextech: '#9C7CFF',
  elder: '#FFD700',
};

// Win rate CSS class helper
export const getWinRateClass = (wr: number | string): string => {
  const n = typeof wr === 'string' ? parseFloat(wr) : wr;
  if (n >= 55) return 'wr-high';
  if (n >= 45) return 'wr-mid';
  return 'wr-low';
};

// ── League definitions ────────────────────────────────────────────────────────

export interface LeagueDef {
  id: string;
  name: string;
  color: string;
  region: string;
  note?: string;
}

export const TIER1_LEAGUES: LeagueDef[] = [
  { id: 'lck', name: 'LCK', color: '#ff4655', region: 'Korea' },
  { id: 'lpl', name: 'LPL', color: '#ff9900', region: 'China' },
  { id: 'lec', name: 'LEC', color: '#01e4be', region: 'Europe' },
  { id: 'lcs', name: 'LCS', color: '#007bff', region: 'Americas' },
  { id: 'cblol', name: 'CBLOL', color: '#00c853', region: 'Brazil' },
  { id: 'lcp', name: 'LCP', color: '#6c5ce7', region: 'Pacific' },
  { id: 'vcs', name: 'VCS', color: '#e74c3c', region: 'Vietnam' },
  { id: 'ljl', name: 'LJL', color: '#e84393', region: 'Japan' },
  { id: 'tcl', name: 'TCL', color: '#e74c3c', region: 'Turkey' },
];

export const TIER2_LEAGUES: LeagueDef[] = [
  { id: 'lckcl', name: 'LCK CL', color: '#ff4655', region: 'Korea' },
  { id: 'nacl', name: 'NA CL', color: '#007bff', region: 'Americas' },
  { id: 'emeamasters', name: 'EMEA Masters', color: '#01e4be', region: 'EMEA' },
  { id: 'circuitodesaf', name: 'Circuito Desafiante', color: '#00c853', region: 'Brazil' },
  { id: 'lrn', name: 'LRN', color: '#007bff', region: 'Americas' },
  { id: 'lrs', name: 'LRS', color: '#00c853', region: 'Americas' },
];

export const TIER3_LEAGUES: LeagueDef[] = [
  { id: 'lfl', name: 'LFL', color: '#0055a4', region: 'France' },
  { id: 'prm', name: 'PRM', color: '#dd0000', region: 'Germany' },
  { id: 'les', name: 'LES', color: '#e74c3c', region: 'Spain' },
  { id: 'nlc', name: 'NLC', color: '#00b4d8', region: 'Nordic' },
  { id: 'lit', name: 'LIT', color: '#2ecc71', region: 'Italy' },
  { id: 'ebl', name: 'EBL', color: '#3498db', region: 'Balkans' },
  { id: 'roadoflegends', name: 'Road of Legends', color: '#01e4be', region: 'EMEA' },
];

export const INTL_LEAGUES: LeagueDef[] = [
  { id: 'msi', name: 'MSI', color: '#c0c0c0', region: 'International' },
  { id: 'worlds', name: 'Worlds', color: '#ffd700', region: 'International' },
];

export const EXTINCT_TIER1: LeagueDef[] = [
  { id: 'eulcs', name: 'EU LCS', color: '#01e4be', region: 'Europe', note: '→ LEC (2019)' },
  { id: 'nalcs', name: 'NA LCS', color: '#007bff', region: 'Americas', note: '→ LCS (2018)' },
];

export const EXTINCT_TIER2: LeagueDef[] = [
  { id: 'lms', name: 'LMS', color: '#6c5ce7', region: 'Pacific', note: '→ PCS (2020)' },
  { id: 'pcs', name: 'PCS', color: '#9b59b6', region: 'Pacific', note: '→ LCP (2025)' },
  { id: 'lla', name: 'LLA', color: '#e67e22', region: 'Latin America', note: '→ LTA (2025)' },
  { id: 'lcl', name: 'LCL', color: '#00b894', region: 'CIS', note: 'Suspendida (2022)' },
  { id: 'lco', name: 'LCO', color: '#0984e3', region: 'Oceania', note: '→ LCP (2025)' },
  { id: 'ltanorth', name: 'LTA North', color: '#007bff', region: 'Americas', note: '→ LCS (2026)' },
  { id: 'ltasouth', name: 'LTA South', color: '#00c853', region: 'Americas', note: '→ CBLOL (2026)' },
  { id: 'ldl', name: 'LDL', color: '#ff9900', region: 'China', note: 'Liga de desarrollo' },
];

export const EXTINCT_TIER3: LeagueDef[] = [
  { id: 'lvpsl', name: 'LVP SL', color: '#e74c3c', region: 'Spain', note: '→ LES (2025)' },
  { id: 'lvpsl2', name: 'LVP SL 2', color: '#e74c3c', region: 'Spain', note: 'Extinta' },
  { id: 'ul', name: 'Ultraliga', color: '#2ecc71', region: 'Italy/Spain', note: 'Extinta' },
  { id: 'gll', name: 'GLL', color: '#f39c12', region: 'DACH', note: 'Extinta' },
  { id: 'tcldiv2', name: 'TCL Div 2', color: '#e74c3c', region: 'Turkey', note: 'Extinta' },
  { id: 'polskaliga', name: 'Polska Liga', color: '#dc143c', region: 'Poland', note: 'Extinta' },
  { id: 'belgianleague', name: 'Belgian League', color: '#f39c12', region: 'Belgium', note: 'Extinta' },
  { id: 'dutchleague', name: 'Dutch League', color: '#ff6600', region: 'Netherlands', note: 'Extinta' },
  { id: 'eslmeister', name: 'ESL Meisterschaft', color: '#dd0000', region: 'Germany', note: '→ PRM' },
  { id: 'challengefr', name: 'Challenge France', color: '#0055a4', region: 'France', note: '→ LFL' },
  { id: 'hm', name: 'Hitpoint Masters', color: '#e74c3c', region: 'Czech/Slovak', note: 'Extinta' },
];

export const EXTINCT_INTL: LeagueDef[] = [
  { id: 'allstar', name: 'All-Star', color: '#ffd700', region: 'International', note: 'Sin edición' },
  { id: 'ewc', name: 'EWC', color: '#00bcd4', region: 'International', note: 'Esports World Cup' },
  { id: 'iem', name: 'IEM', color: '#00bcd4', region: 'International', note: 'Intel Extreme Masters' },
  { id: 'intwildcard', name: 'IWCI', color: '#9c27b0', region: 'International', note: 'Wildcard Invitational' },
  { id: 'seasonkickoff', name: 'Season Kickoff', color: '#ff5722', region: 'International', note: '→ First Stand' },
  { id: 'eumasters', name: 'EU Masters', color: '#01e4be', region: 'Europe', note: '→ EMEA Masters' },
];

export const EXTINCT_RIFT_RIVALS: LeagueDef[] = [
  { id: 'rrnaeu', name: 'RR NA vs EU', color: '#ffd700', region: 'NA/EU' },
  { id: 'rrlcklpllms', name: 'RR LCK/LPL/LMS', color: '#ffd700', region: 'Asia' },
  { id: 'rrlcklplvcs', name: 'RR LCK/LPL/VCS', color: '#ffd700', region: 'Asia' },
  { id: 'rrlcltcl', name: 'RR LCL/TCL', color: '#ffd700', region: 'CIS/Turkey' },
  { id: 'rrlcltclvcs', name: 'RR LCL/TCL/VCS', color: '#ffd700', region: 'CIS/Turkey/VN' },
  { id: 'rrcbclslln', name: 'RR CB/CLS/LLN', color: '#ffd700', region: 'LATAM' },
  { id: 'rrgplljlopl', name: 'RR GPL/LJL/OPL', color: '#ffd700', region: 'SEA/JP/OCE' },
];

export const EXTINCT_SHOWMATCHES: LeagueDef[] = [
  { id: 'comedycentral', name: 'Comedy Central', color: '#ff6b6b', region: 'Showmatch' },
  { id: 'kcvsibai', name: 'KC vs Ibai', color: '#ff6b6b', region: 'Showmatch' },
  { id: 'kcx3', name: 'KCx3', color: '#ff6b6b', region: 'Showmatch' },
  { id: 'gameonrevival', name: 'Game On Revival', color: '#ff6b6b', region: 'Showmatch' },
  { id: 'pulsefirecup', name: 'Pulsefire Cup', color: '#ff6b6b', region: 'Showmatch' },
  { id: 'redbullloio', name: 'Red Bull LoIO', color: '#ff6b6b', region: 'Showmatch' },
];

export const EXTINCT_LATAM: LeagueDef[] = [
  { id: 'copanorte', name: 'Copa Norte', color: '#e67e22', region: 'LATAM' },
  { id: 'copasur', name: 'Copa Sur', color: '#e67e22', region: 'LATAM' },
  { id: 'cdln', name: 'CDL Norte', color: '#e67e22', region: 'LATAM' },
  { id: 'cdls', name: 'CDL Sur', color: '#e67e22', region: 'LATAM' },
  { id: 'liganorte', name: 'Liga Norte', color: '#e67e22', region: 'LATAM' },
  { id: 'lmf', name: 'LMF', color: '#e67e22', region: 'Mexico', note: 'Liga Mexicana' },
];

const ALL_EXTINCT: LeagueDef[] = [
  ...EXTINCT_TIER1, ...EXTINCT_TIER2, ...EXTINCT_TIER3,
  ...EXTINCT_INTL, ...EXTINCT_RIFT_RIVALS, ...EXTINCT_SHOWMATCHES, ...EXTINCT_LATAM,
];

export const LEAGUES: LeagueDef[] = [
  ...TIER1_LEAGUES,
  ...TIER2_LEAGUES,
  ...TIER3_LEAGUES,
  ...INTL_LEAGUES,
  { id: 'firststand', name: 'First Stand', color: '#ff5722', region: 'International' },
  { id: 'riftlegends', name: 'Rift Legends', color: '#01e4be', region: 'EMEA' },
  { id: 'americascup', name: 'Americas Cup', color: '#007bff', region: 'Americas' },
  ...ALL_EXTINCT,
];

export const EXTINCT_SECTIONS = [
  { title: 'Tier 1', leagues: EXTINCT_TIER1 },
  { title: 'Tier 2', leagues: EXTINCT_TIER2 },
  { title: 'Tier 3 / Regional', leagues: EXTINCT_TIER3 },
  { title: 'Eventos Internacionales', leagues: EXTINCT_INTL },
  { title: 'Rift Rivals', leagues: EXTINCT_RIFT_RIVALS },
  { title: 'Showmatches', leagues: EXTINCT_SHOWMATCHES },
  { title: 'LATAM Regional', leagues: EXTINCT_LATAM },
];
