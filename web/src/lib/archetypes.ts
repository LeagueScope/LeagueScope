/**
 * Champion Archetypes — classification for meta analysis, team composition
 * evaluation, and role-weighted player scoring.
 *
 * Source: Riot Games official champion classes (updated 2026-03)
 *
 * Each champion maps to 1-2 archetypes ordered by priority.
 * The first archetype is the primary class.
 */

export type Archetype =
  | 'Luchador'
  | 'Mago'
  | 'Asesino'
  | 'Tirador'
  | 'Tanque'
  | 'Asistencia'
  | 'Resistencia';

export const ARCHETYPE_COLORS: Record<Archetype, string> = {
  Luchador:    '#e67e22',  // orange
  Mago:        '#9b59b6',  // purple
  Asesino:     '#e74c3c',  // red
  Tirador:     '#3498db',  // blue
  Tanque:      '#27ae60',  // green
  Asistencia:  '#1abc9c',  // teal
  Resistencia: '#7f8c8d',  // gray
};

export const ARCHETYPE_ICONS: Record<Archetype, string> = {
  Luchador:    '⚔️',
  Mago:        '🔮',
  Asesino:     '🗡️',
  Tirador:     '🎯',
  Tanque:      '🛡️',
  Asistencia:  '💚',
  Resistencia: '🔒',
};

/**
 * Map of champion name → archetype(s).
 * First element is the primary archetype.
 */
export const CHAMPION_ARCHETYPES: Record<string, Archetype[]> = {
  'Aatrox':         ['Luchador'],
  'Ahri':           ['Mago', 'Asesino'],
  'Akali':          ['Asesino'],
  'Akshan':         ['Tirador', 'Asesino'],
  'Alistar':        ['Tanque', 'Resistencia'],
  'Ambessa':        ['Luchador', 'Asesino'],
  'Amumu':          ['Tanque', 'Resistencia'],
  'Anivia':         ['Mago'],
  'Annie':          ['Mago', 'Resistencia'],
  'Aphelios':       ['Tirador'],
  'Ashe':           ['Tirador', 'Asistencia'],
  'Aurelion Sol':   ['Mago'],
  'Aurora':         ['Mago', 'Asesino'],
  'Azir':           ['Mago', 'Tirador'],
  'Bardo':          ['Asistencia', 'Mago'],
  "Bel'Veth":       ['Luchador'],
  'Blitzcrank':     ['Tanque', 'Resistencia'],
  'Brand':          ['Mago', 'Resistencia'],
  'Braum':          ['Tanque', 'Resistencia'],
  'Briar':          ['Luchador', 'Asesino'],
  'Caitlyn':        ['Tirador'],
  'Camille':        ['Luchador', 'Asesino'],
  'Cassiopeia':     ['Mago'],
  "Cho'Gath":       ['Tanque', 'Mago'],
  'Corki':          ['Tirador', 'Mago'],
  'Darius':         ['Luchador', 'Tanque'],
  'Diana':          ['Luchador', 'Asesino'],
  'Dr. Mundo':      ['Tanque', 'Luchador'],
  'Draven':         ['Tirador'],
  'Ekko':           ['Asesino', 'Mago'],
  'Elise':          ['Asesino', 'Mago'],
  'Evelynn':        ['Asesino', 'Mago'],
  'Ezreal':         ['Tirador', 'Mago'],
  'Fiddlesticks':   ['Mago', 'Resistencia'],
  'Fiora':          ['Luchador', 'Asesino'],
  'Fizz':           ['Asesino', 'Luchador'],
  'Galio':          ['Tanque', 'Mago'],
  'Gangplank':      ['Luchador'],
  'Garen':          ['Luchador', 'Tanque'],
  'Gnar':           ['Luchador', 'Tanque'],
  'Gragas':         ['Luchador', 'Mago'],
  'Graves':         ['Tirador'],
  'Gwen':           ['Luchador'],
  'Hecarim':        ['Luchador', 'Tanque'],
  'Heimerdinger':   ['Mago', 'Asistencia'],
  'Hwei':           ['Mago', 'Asistencia'],
  'Illaoi':         ['Luchador', 'Tanque'],
  'Irelia':         ['Luchador', 'Asesino'],
  'Ivern':          ['Asistencia', 'Mago'],
  'Janna':          ['Asistencia', 'Mago'],
  'Jarvan IV':      ['Luchador', 'Tanque'],
  'Jax':            ['Luchador'],
  'Jayce':          ['Luchador', 'Tirador'],
  'Jhin':           ['Tirador', 'Mago'],
  'Jinx':           ['Tirador'],
  "K'Sante":        ['Tanque', 'Luchador'],
  "Kai'Sa":         ['Tirador', 'Mago'],
  'Kalista':        ['Tirador'],
  'Karma':          ['Mago', 'Asistencia'],
  'Karthus':        ['Mago'],
  'Kassadin':       ['Asesino', 'Mago'],
  'Katarina':       ['Asesino', 'Mago'],
  'Kayle':          ['Mago', 'Tirador'],
  'Kayn':           ['Luchador', 'Asesino'],
  'Kennen':         ['Mago'],
  "Kha'Zix":        ['Asesino'],
  'Kindred':        ['Tirador'],
  'Kled':           ['Luchador'],
  "Kog'Maw":        ['Tirador', 'Mago'],
  'LeBlanc':        ['Asesino', 'Mago'],
  'Lee Sin':        ['Luchador', 'Asesino'],
  'Leona':          ['Tanque', 'Resistencia'],
  'Lillia':         ['Luchador', 'Mago'],
  'Lissandra':      ['Mago'],
  'Lucian':         ['Tirador', 'Asesino'],
  'Lulu':           ['Asistencia', 'Mago'],
  'Lux':            ['Mago', 'Asistencia'],
  'Maestro Yi':     ['Luchador', 'Asesino'],
  'Malphite':       ['Tanque', 'Mago'],
  'Malzahar':       ['Mago'],
  'Maokai':         ['Tanque', 'Asistencia'],
  'Mel':            ['Mago', 'Asistencia'],
  'Milio':          ['Asistencia', 'Mago'],
  'Miss Fortune':   ['Tirador', 'Mago'],
  'Mordekaiser':    ['Luchador', 'Mago'],
  'Morgana':        ['Asistencia', 'Mago'],
  'Naafiri':        ['Asesino', 'Luchador'],
  'Nami':           ['Asistencia', 'Mago'],
  'Nasus':          ['Luchador', 'Tanque'],
  'Nautilus':       ['Tanque', 'Asistencia'],
  'Neeko':          ['Mago', 'Asistencia'],
  'Nidalee':        ['Asesino', 'Mago'],
  'Nilah':          ['Luchador', 'Asesino'],
  'Nocturne':       ['Luchador', 'Asesino'],
  'Nunu y Willump': ['Tanque', 'Mago'],
  'Olaf':           ['Luchador', 'Tanque'],
  'Orianna':        ['Mago', 'Asistencia'],
  'Ornn':           ['Tanque'],
  'Pantheon':       ['Luchador', 'Asesino'],
  'Poppy':          ['Tanque', 'Luchador'],
  'Pyke':           ['Asistencia', 'Asesino'],
  'Qiyana':         ['Asesino'],
  'Quinn':          ['Tirador', 'Asesino'],
  'Rakan':          ['Asistencia'],
  'Rammus':         ['Tanque'],
  "Rek'Sai":        ['Luchador', 'Tanque'],
  'Rell':           ['Tanque', 'Asistencia'],
  'Renata Glasc':   ['Asistencia', 'Mago'],
  'Renekton':       ['Luchador', 'Tanque'],
  'Rengar':         ['Asesino', 'Luchador'],
  'Riven':          ['Luchador', 'Asesino'],
  'Rumble':         ['Luchador', 'Mago'],
  'Ryze':           ['Mago'],
  'Samira':         ['Tirador', 'Asesino'],
  'Sejuani':        ['Tanque'],
  'Senna':          ['Asistencia', 'Tirador'],
  'Seraphine':      ['Asistencia', 'Mago'],
  'Sett':           ['Luchador', 'Tanque'],
  'Shaco':          ['Asesino'],
  'Shen':           ['Tanque'],
  'Shyvana':        ['Luchador', 'Asesino'],
  'Singed':         ['Tanque', 'Mago'],
  'Sion':           ['Tanque', 'Luchador'],
  'Sivir':          ['Tirador'],
  'Skarner':        ['Tanque', 'Luchador'],
  'Smolder':        ['Tirador', 'Mago'],
  'Sona':           ['Asistencia', 'Mago'],
  'Soraka':         ['Asistencia', 'Mago'],
  'Swain':          ['Mago', 'Asistencia'],
  'Sylas':          ['Mago', 'Asesino'],
  'Syndra':         ['Mago'],
  'Tahm Kench':     ['Tanque', 'Asistencia'],
  'Taliyah':        ['Mago', 'Asistencia'],
  'Talon':          ['Asesino'],
  'Taric':          ['Asistencia', 'Tanque'],
  'Teemo':          ['Tirador', 'Mago'],
  'Thresh':         ['Asistencia', 'Tanque'],
  'Tristana':       ['Tirador', 'Asesino'],
  'Trundle':        ['Luchador', 'Tanque'],
  'Tryndamere':     ['Luchador', 'Asesino'],
  'Twisted Fate':   ['Mago', 'Tirador'],
  'Twitch':         ['Tirador', 'Asesino'],
  'Udyr':           ['Luchador', 'Tanque'],
  'Urgot':          ['Luchador', 'Tanque'],
  'Varus':          ['Tirador', 'Mago'],
  'Vayne':          ['Tirador', 'Asesino'],
  'Veigar':         ['Mago'],
  "Vel'Koz":        ['Mago', 'Asistencia'],
  'Vex':            ['Mago'],
  'Vi':             ['Luchador', 'Asesino'],
  'Viego':          ['Luchador', 'Asesino'],
  'Viktor':         ['Mago'],
  'Vladimir':       ['Mago', 'Luchador'],
  'Volibear':       ['Luchador', 'Tanque'],
  'Warwick':        ['Luchador', 'Tanque'],
  'Wukong':         ['Luchador', 'Tanque'],
  'Xayah':          ['Tirador'],
  'Xerath':         ['Mago', 'Asistencia'],
  'Xin Zhao':       ['Luchador', 'Tanque'],
  'Yasuo':          ['Luchador', 'Asesino'],
  'Yone':           ['Luchador', 'Asesino'],
  'Yorick':         ['Luchador', 'Tanque'],
  'Yunara':         ['Tirador'],
  'Yuumi':          ['Asistencia', 'Mago'],
  'Zaahen':         ['Luchador', 'Asesino'],
  'Zac':            ['Tanque', 'Luchador'],
  'Zed':            ['Asesino'],
  'Zeri':           ['Tirador'],
  'Ziggs':          ['Mago'],
  'Zilean':         ['Asistencia', 'Mago'],
  'Zoe':            ['Mago'],
  'Zyra':           ['Mago', 'Asistencia'],
};

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Get primary archetype for a champion (case-insensitive lookup) */
export function getPrimaryArchetype(name: string): Archetype | null {
  const entry = CHAMPION_ARCHETYPES[name];
  if (entry) return entry[0];
  // Fuzzy: try case-insensitive
  const key = Object.keys(CHAMPION_ARCHETYPES).find(
    k => k.toLowerCase() === name.toLowerCase()
  );
  return key ? CHAMPION_ARCHETYPES[key][0] : null;
}

/** Get all archetypes for a champion */
export function getArchetypes(name: string): Archetype[] {
  const entry = CHAMPION_ARCHETYPES[name];
  if (entry) return entry;
  const key = Object.keys(CHAMPION_ARCHETYPES).find(
    k => k.toLowerCase() === name.toLowerCase()
  );
  return key ? CHAMPION_ARCHETYPES[key] : [];
}

/** Classify a team composition (array of champion names) into archetype counts */
export function classifyComposition(champions: string[]): Record<Archetype, number> {
  const counts: Record<Archetype, number> = {
    Luchador: 0, Mago: 0, Asesino: 0, Tirador: 0,
    Tanque: 0, Asistencia: 0, Resistencia: 0,
  };
  for (const name of champions) {
    const primary = getPrimaryArchetype(name);
    if (primary) counts[primary]++;
  }
  return counts;
}

/**
 * Stat weights per archetype for player evaluation.
 * Higher weight = more important for that archetype's performance score.
 * All weights sum to ~1.0 per archetype.
 */
export const ARCHETYPE_EVAL_WEIGHTS: Record<Archetype, Record<string, number>> = {
  Tanque: {
    damage_taken:      0.25,   // más daño recibido = mejor
    cc_score:          0.20,   // CC aplicado
    kill_participation: 0.20,  // participación en kills del equipo
    deaths_low:        0.15,   // pocas muertes relativas
    vision_score:      0.10,
    assists:           0.10,
  },
  Luchador: {
    damage_dealt:      0.25,
    kill_participation: 0.20,
    kda:               0.20,
    cs_per_min:        0.15,
    damage_taken:      0.10,   // luchadores aguantan algo
    gold_efficiency:   0.10,
  },
  Asesino: {
    damage_dealt:      0.25,
    kills:             0.20,
    kda:               0.20,
    gold_efficiency:   0.15,   // daño por oro
    solo_kills:        0.10,
    deaths_low:        0.10,
  },
  Mago: {
    damage_dealt:      0.30,
    kill_participation: 0.20,
    kda:               0.15,
    cc_score:          0.15,
    cs_per_min:        0.10,
    deaths_low:        0.10,
  },
  Tirador: {
    damage_dealt:      0.30,   // DPS es lo que importa
    cs_per_min:        0.20,
    kda:               0.15,
    kill_participation: 0.15,
    gold_efficiency:   0.10,
    deaths_low:        0.10,
  },
  Asistencia: {
    assists:           0.25,
    vision_score:      0.25,
    kill_participation: 0.20,
    cc_score:          0.15,
    deaths_low:        0.15,
  },
  Resistencia: {
    damage_taken:      0.25,
    cc_score:          0.20,
    vision_score:      0.15,
    kill_participation: 0.15,
    assists:           0.15,
    deaths_low:        0.10,
  },
};
