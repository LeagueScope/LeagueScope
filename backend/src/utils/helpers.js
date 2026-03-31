/**
 * Backend Helpers - Funciones utilitarias con validacion
 * 
 * Incluye funciones de seguridad para evitar NaN, division por cero,
 * y validacion de datos en los aggregators.
 */

import { log } from './logger.js';

// ============================================
// FUNCIONES DE SEGURIDAD MATEMATICA
// ============================================

/**
 * Parsear numero de forma segura
 * @param {any} value - Valor a parsear
 * @param {number} decimals - Decimales a redondear (default: 0)
 * @returns {number} Numero parseado o 0 si invalido
 */
export function parseNum(value, decimals = 0) {
  const num = parseFloat(value);
  if (isNaN(num) || !isFinite(num)) return 0;
  if (decimals === 0) return Math.round(num);
  const factor = Math.pow(10, decimals);
  return Math.round(num * factor) / factor;
}

/**
 * Division segura - evita NaN e Infinity
 * @param {number} numerator - Numerador
 * @param {number} denominator - Denominador
 * @param {number} decimals - Decimales (default: 2)
 * @returns {number} Resultado o 0 si denominador es 0
 */
export function safeDiv(numerator, denominator, decimals = 2) {
  if (!denominator || denominator === 0) return 0;
  const result = numerator / denominator;
  if (isNaN(result) || !isFinite(result)) return 0;
  return parseNum(result, decimals);
}

/**
 * Calcular porcentaje de forma segura
 * @param {number} numerator - Numerador
 * @param {number} denominator - Denominador (total)
 * @param {number} decimals - Decimales (default: 1)
 * @returns {number} Porcentaje (0-100) o 0 si error
 */
export function safeRate(numerator, denominator, decimals = 1) {
  if (!denominator || denominator === 0) return 0;
  const value = (numerator / denominator) * 100;
  if (isNaN(value) || !isFinite(value)) return 0;
  return parseNum(value, decimals);
}

// ============================================
// FUNCIONES DE FORMATO
// ============================================

/**
 * Formatear duracion en segundos a MM:SS
 */
export function formatDuration(seconds) {
  if (!seconds || isNaN(seconds)) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Calcular KDA de forma segura
 */
export function calculateKDA(kills, deaths, assists) {
  const k = parseNum(kills);
  const d = parseNum(deaths);
  const a = parseNum(assists);
  if (d === 0) return parseNum(k + a, 2);
  return parseNum((k + a) / d, 2);
}

/**
 * Calcular racha desde historial de partidos
 * @param {Array} history - Array de resultados (true/false o 1/0)
 * @returns {number} Racha positiva (victorias) o negativa (derrotas)
 */
export function calculateStreak(history) {
  if (!history || history.length === 0) return 0;

  const first = history[0];
  let count = 0;

  for (const result of history) {
    if (result === first || result === (first ? 1 : 0)) {
      count++;
    } else {
      break;
    }
  }

  return first ? count : -count;
}

// ============================================
// FUNCIONES DE NORMALIZACION
// ============================================

/**
 * Normalizar posicion de jugador
 */
export function normalizePosition(pos) {
  const map = {
    'top': 'top',
    'jng': 'jng',
    'jungle': 'jng',
    'mid': 'mid',
    'bot': 'bot',
    'adc': 'bot',
    'sup': 'sup',
    'support': 'sup'
  };
  return map[pos?.toLowerCase()] || pos;
}

/**
 * Obtener abreviatura de equipo
 */
export function getTeamAbbr(teamName) {
  const abbrs = {
    // LEC Teams
    'G2 Esports': 'G2',
    'Fnatic': 'FNC',
    'Team Vitality': 'VIT',
    'Movistar KOI': 'MKOI',
    'Karmine Corp': 'KC',
    'Team Heretics': 'TH',
    'Shifters': 'SHFT',
    'SK Gaming': 'SK',
    'Natus Vincere': 'NAVI',
    'GiantX': 'GX',
    'Karmine Corp Blue': 'KCB',
    'Los Ratones': 'LR',

    // LCK Teams
    'Hanwha Life Esports': 'HLE',
    'Gen.G Esports': 'GEN',
    'T1': 'T1',
    'kt Rolster': 'KT',
    'Dplus KIA': 'DK',
    'DRX': 'DRX',
    'DN SOOPers': 'DNS',
    'Nongshim RedForce Force': 'NS',
    'BRION': 'BRO',
    'BNK Fearx': 'BFX',

    // LPL Teams
    'BILIBILI GAMING DREAMSMART': 'BLG',
    'TOPESPORTS': 'TES',
    'Beijing JDG Intel Esports': 'JDG',
    'LNG Esports': 'LNG',
    'WeiboGaming Faw Audi': 'WBG',
    'FunPlus Phoenix': 'FPX',
    'Invictus Gaming': 'IG',
    'Shanghai Edward Gaming': 'EDG',
    'Royal Never Give Up': 'RNG',
    'Anyone\'s Legend': 'AL',
    'Oh My God': 'OMG',
    'ThunderTalk Gaming': 'TT',
    'Shenzhen Ninjas in Pyjamas': 'NIP',
    'Ultra Prime': 'UP',
    'Hangzhou LGD Gaming': 'LGD',
    'Suzhou NLG Ninebot Esports': 'NLG',
    'Xi\'an Team WE': 'WE',

    // LCS Teams
    'Cloud9 Kia': 'C9',
    'Team Liquid Alienware': 'TLAW',
    'FlyQuest': 'FLY',
    'Shopify Rebellion': 'SR',
    'LYON': 'LYON',
    'Disguised': 'DG',
    'Immortals': 'IMT',
    'Dignitas': 'DIG',
    'Sentinels': 'SEN',
  };
  return abbrs[teamName] || teamName?.substring(0, 3).toUpperCase() || 'UNK';
}

/**
 * Agrupar array por key
 */
export function groupBy(array, key) {
  return array.reduce((result, item) => {
    const keyValue = item[key];
    if (!result[keyValue]) {
      result[keyValue] = [];
    }
    result[keyValue].push(item);
    return result;
  }, {});
}

// ============================================
// FUNCIONES DE VALIDACION
// ============================================

/**
 * Validar datos de torneo antes de guardar
 * @param {Object} t - Objeto torneo
 * @throws {Error} Si los datos son invalidos
 */
export function validateTournamentData(t) {
  if (!t) {
    throw new Error('Tournament object is undefined');
  }

  if (typeof t.total_games !== 'number' || t.total_games < 0) {
    throw new Error(`Invalid total_games: ${t.total_games}`);
  }

  const requiredNumericFields = [
    'total_dragons',
    'infernals',
    'mountains',
    'clouds',
    'oceans',
    'chemtechs',
    'hextechs',
    'elders'
  ];

  for (const field of requiredNumericFields) {
    if (typeof t[field] !== 'number' || isNaN(t[field])) {
      throw new Error(`Invalid numeric field: ${field} = ${t[field]}`);
    }
  }

  if (!t.side_stats || !t.side_stats.blue || !t.side_stats.red) {
    throw new Error('Missing side_stats structure');
  }

  return true;
}

/**
 * Verificar consistencia de porcentajes por lado
 * Los porcentajes de blue + red deben sumar ~100%
 * @param {number} blueRate - Porcentaje blue side
 * @param {number} redRate - Porcentaje red side
 * @param {string} label - Nombre de la estadistica
 * @param {Object} context - Contexto para logging
 */
export function verifySideRates(blueRate, redRate, label, context = {}) {
  const sum = (blueRate || 0) + (redRate || 0);

  // Tolerancia de 1% por redondeo
  if (Math.abs(sum - 100) > 1 && sum !== 0) {
    log.warn({
      stage: 'RATE_MISMATCH',
      label,
      blueRate,
      redRate,
      sum,
      expected: 100,
      ...context
    });
    return false;
  }
  return true;
}

/**
 * Verificar consistencia de dragones
 * La suma de tipos debe ser <= total_dragons
 * @param {Object} t - Objeto torneo
 */
export function verifyDragonConsistency(t) {
  const sumTypes =
    (t.infernals || 0) +
    (t.mountains || 0) +
    (t.clouds || 0) +
    (t.oceans || 0) +
    (t.chemtechs || 0) +
    (t.hextechs || 0);

  // Nota: elders no cuentan en el total de dragones elementales
  if (sumTypes > t.total_dragons) {
    log.warn({
      stage: 'DRAGON_INCONSISTENCY',
      total_dragons: t.total_dragons,
      sumTypes,
      breakdown: {
        infernals: t.infernals,
        mountains: t.mountains,
        clouds: t.clouds,
        oceans: t.oceans,
        chemtechs: t.chemtechs,
        hextechs: t.hextechs,
        elders: t.elders
      }
    });
    return false;
  }
  return true;
}

/**
 * Verificar que un valor no es NaN ni undefined
 */
export function isValidNumber(value) {
  return typeof value === 'number' && !isNaN(value) && isFinite(value);
}

/**
 * Limpiar objeto de valores NaN/undefined
 */
export function cleanNumericFields(obj, fields) {
  const cleaned = { ...obj };
  for (const field of fields) {
    if (!isValidNumber(cleaned[field])) {
      cleaned[field] = 0;
    }
  }
  return cleaned;
}

export default {
  parseNum,
  safeDiv,
  safeRate,
  formatDuration,
  calculateKDA,
  calculateStreak,
  normalizePosition,
  getTeamAbbr,
  groupBy,
  validateTournamentData,
  verifySideRates,
  verifyDragonConsistency,
  isValidNumber,
  cleanNumericFields,
};
