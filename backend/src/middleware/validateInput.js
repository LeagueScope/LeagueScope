const MAX_STRING_LEN   = 100;   // max length for any string param
const MAX_SEARCH_LEN   = 50;    // max length for search query
const MIN_YEAR         = 2011;  // League of Legends esports started
const MAX_YEAR         = 2100;  // generous upper bound — future-proof
const VALID_ROLES      = new Set(['top', 'jng', 'jun', 'mid', 'adc', 'bot', 'sup', 'support']);

// Allowed characters: alphanumeric, spaces, hyphens, underscores, dots, accented chars
const SAFE_STRING_RE = /^[\w\s\-.'áéíóúàèìòùäëïöüâêîôûñçÁÉÍÓÚÀÈÌÒÙÄËÏÖÜÂÊÎÔÛÑÇ&]+$/u;

// Helpers 

function sanitizeString(val, maxLen = MAX_STRING_LEN) {
  if (val == null) return undefined;
  const s = String(val).trim().slice(0, maxLen);
  return s || undefined;
}

function isCleanString(val) {
  return !val || SAFE_STRING_RE.test(val);
}

// Middleware

/**
 * Validates common query params used across most /pg/ endpoints.
 * Attaches sanitized values to req.clean = { league, year, split, stage }.
 */
export function validateCommonParams(req, res, next) {
  const { league, year, split, stage } = req.query;

  // League: alphanumeric only, max 30 chars
  const cleanLeague = sanitizeString(league, 30);
  if (cleanLeague && !/^[a-zA-Z0-9]+$/.test(cleanLeague)) {
    return res.status(400).json({ error: 'Invalid league parameter' });
  }

  // Year: must be a valid integer in range
  let cleanYear;
  if (year != null && year !== '') {
    cleanYear = parseInt(year, 10);
    if (isNaN(cleanYear) || cleanYear < MIN_YEAR || cleanYear > MAX_YEAR) {
      return res.status(400).json({ error: `Year must be between ${MIN_YEAR} and ${MAX_YEAR}` });
    }
  }

  // Split: free text but sanitized
  const cleanSplit = sanitizeString(split, 30);
  if (cleanSplit && !isCleanString(cleanSplit)) {
    return res.status(400).json({ error: 'Invalid split parameter' });
  }

  // Stage: free text but sanitized
  const cleanStage = sanitizeString(stage, 50);
  if (cleanStage && !isCleanString(cleanStage)) {
    return res.status(400).json({ error: 'Invalid stage parameter' });
  }

  // Attach cleaned values (controllers still read from req.query but this catches bad input early)
  req.cleanParams = { league: cleanLeague, year: cleanYear, split: cleanSplit, stage: cleanStage };
  next();
}

/**
 * Validates URL params like :name, :abbr, :identifier
 */
export function validateUrlParams(req, res, next) {
  for (const [key, val] of Object.entries(req.params)) {
    if (!val) continue;
    const clean = sanitizeString(val);
    if (!isCleanString(clean)) {
      return res.status(400).json({ error: `Invalid ${key} parameter` });
    }
    if (key === 'id') {
      const id = parseInt(val, 10);
      if (isNaN(id) || id < 1) {
        return res.status(400).json({ error: 'Invalid id parameter' });
      }
    }
  }
  next();
}

/**
 * Validates search-specific params (q)
 */
export function validateSearch(req, res, next) {
  const { q } = req.query;
  if (q != null) {
    const clean = sanitizeString(q, MAX_SEARCH_LEN);
    if (clean && !isCleanString(clean)) {
      return res.status(400).json({ error: 'Invalid search query' });
    }
    // Overwrite with sanitized value
    req.query.q = clean || '';
  }
  next();
}

/**
 * Validates HeadToHead-specific params (teamA, teamB)
 */
export function validateH2H(req, res, next) {
  const { teamA, teamB } = req.query;

  if (!teamA || !teamB) {
    return res.status(400).json({ error: 'teamA and teamB are required' });
  }

  const cleanA = sanitizeString(teamA, 20);
  const cleanB = sanitizeString(teamB, 20);

  if (!cleanA || !cleanB || !/^[a-zA-Z0-9]+$/.test(cleanA) || !/^[a-zA-Z0-9]+$/.test(cleanB)) {
    return res.status(400).json({ error: 'Invalid team abbreviation' });
  }

  next();
}

/**
 * Validates pagination params (page, perPage)
 */
export function validatePagination(req, res, next) {
  const { page, perPage } = req.query;

  if (page != null) {
    const p = parseInt(page, 10);
    if (isNaN(p) || p < 1 || p > 500) {
      return res.status(400).json({ error: 'Page must be between 1 and 500' });
    }
  }

  if (perPage != null) {
    const pp = parseInt(perPage, 10);
    if (isNaN(pp) || pp < 1 || pp > 100) {
      return res.status(400).json({ error: 'perPage must be between 1 and 100' });
    }
  }

  next();
}

/**
 * Validates position/role param
 */
export function validatePosition(req, res, next) {
  const { position } = req.query;
  if (position && !VALID_ROLES.has(position.toLowerCase())) {
    return res.status(400).json({ error: 'Invalid position parameter' });
  }
  next();
}
