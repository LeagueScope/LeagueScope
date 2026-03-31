/**
 * leagueColors.ts
 * Brand accent colors per league, used to inject CSS custom properties
 * dynamically into each page container.
 *
 * Usage:
 *   const { accent, glow } = getLeagueColors(league);
 *   <div style={{ '--p2-league-accent': accent }}>
 */

export const LEAGUE_COLORS: Record<string, { accent: string; glow: string }> = {
  // ── Main leagues ────────────────────────────────────────────────────────────
  lec:              { accent: '#01e4be', glow: 'rgba(1, 228, 190, 0.35)' },
  lcs:              { accent: '#a5a1ff', glow: 'rgba(165, 161, 255, 0.35)' },
  lck:              { accent: '#1a56ff', glow: 'rgba(26, 86, 255, 0.35)' },
  lpl:              { accent: '#e52420', glow: 'rgba(229, 36, 32, 0.35)' },
  lcp:              { accent: '#ffba6b', glow: 'rgba(255, 186, 107, 0.35)' },
  cblol:            { accent: '#00c853', glow: 'rgba(0, 200, 83, 0.35)' },
  vcs:              { accent: '#e1efaf', glow: 'rgba(225, 239, 175, 0.35)' },
  pcs:              { accent: '#9b59b6', glow: 'rgba(155, 89, 182, 0.35)' },
  lla:              { accent: '#e67e22', glow: 'rgba(230, 126, 34, 0.35)' },
  tcl:              { accent: '#ffff00', glow: 'rgba(255, 255, 0, 0.35)' },
  ljl:              { accent: '#ff0042', glow: 'rgba(255, 0, 66, 0.35)' },
  lco:              { accent: '#ff8b82', glow: 'rgba(255, 139, 130, 0.35)' },

  // ── International ───────────────────────────────────────────────────────────
  worlds:           { accent: '#ffd700', glow: 'rgba(255, 215, 0, 0.35)' },
  msi:              { accent: '#c0c0c0', glow: 'rgba(192, 192, 192, 0.35)' },

  // ── LTA ─────────────────────────────────────────────────────────────────────
  ltanorth:         { accent: '#007bff', glow: 'rgba(0, 123, 255, 0.35)' },
  ltasouth:         { accent: '#ff894b', glow: 'rgba(255, 137, 75, 0.35)' },

  // ── Academy / Challenger ────────────────────────────────────────────────────
  lckcl:            { accent: '#1a56ff', glow: 'rgba(26, 86, 255, 0.35)' },
  nacl:             { accent: '#ab9fff', glow: 'rgba(171, 159, 255, 0.35)' },
  circuitodesafiante: { accent: '#ffab27', glow: 'rgba(255, 171, 39, 0.35)' },
  tcldiv2:          { accent: '#ffff00', glow: 'rgba(255, 255, 0, 0.35)' },

  // ── Regional / ERL ──────────────────────────────────────────────────────────
  lfl:              { accent: '#0055a4', glow: 'rgba(0, 85, 164, 0.35)' },
  challengefrance:  { accent: '#0055a4', glow: 'rgba(0, 85, 164, 0.35)' },
  prm:              { accent: '#dd0000', glow: 'rgba(221, 0, 0, 0.35)' },
  nlc:              { accent: '#00b4d8', glow: 'rgba(0, 180, 216, 0.35)' },
  les:              { accent: '#e74c3c', glow: 'rgba(231, 76, 60, 0.35)' },
  ul:               { accent: '#2ecc71', glow: 'rgba(46, 204, 113, 0.35)' },
  ultraliga:        { accent: '#00ffff', glow: 'rgba(0, 255, 255, 0.35)' },
  lplol:            { accent: '#1e90ff', glow: 'rgba(30, 144, 255, 0.35)' },
  gll:              { accent: '#ffff00', glow: 'rgba(255, 255, 0, 0.35)' },
  al:               { accent: '#27ae60', glow: 'rgba(39, 174, 96, 0.35)' },
  hll:              { accent: '#8e44ad', glow: 'rgba(142, 68, 173, 0.35)' },
  lit:              { accent: '#ff3c84', glow: 'rgba(255, 60, 132, 0.35)' },
  ebl:              { accent: '#1a56ff', glow: 'rgba(26, 86, 255, 0.35)' },
  lrn:              { accent: '#ff385c', glow: 'rgba(255, 56, 92, 0.35)' },
  lrs:              { accent: '#ff56b0', glow: 'rgba(255, 86, 176, 0.35)' },
  roadoflegends:    { accent: '#1adfff', glow: 'rgba(26, 223, 255, 0.35)' },
  ldl:              { accent: '#ffa33d', glow: 'rgba(255, 163, 61, 0.35)' },
  lvpsl:            { accent: '#85898d', glow: 'rgba(133, 137, 141, 0.35)' },
  lvpsl2:           { accent: '#85898d', glow: 'rgba(133, 137, 141, 0.35)' },
  belgianleague:    { accent: '#ff3642', glow: 'rgba(255, 54, 66, 0.35)' },
  dutchleague:      { accent: '#ff993b', glow: 'rgba(255, 153, 59, 0.35)' },
  eslmeisterschaft: { accent: '#ff2136', glow: 'rgba(255, 33, 54, 0.35)' },
  hitpointmasters:  { accent: '#32ffae', glow: 'rgba(50, 255, 174, 0.35)' },
  allstarchina:     { accent: '#e7bf94', glow: 'rgba(231, 191, 148, 0.35)' },

  // ── Legacy ──────────────────────────────────────────────────────────────────
  eulcs:            { accent: '#ffe008', glow: 'rgba(255, 224, 8, 0.35)' },
  nalcs:            { accent: '#ffe008', glow: 'rgba(255, 224, 8, 0.35)' },
  lms:              { accent: '#71faef', glow: 'rgba(113, 250, 239, 0.35)' },
  lcl:              { accent: '#00b894', glow: 'rgba(0, 184, 148, 0.35)' },
};

const FALLBACK = { accent: '#01e4be', glow: 'rgba(1, 228, 190, 0.35)' };

/**
 * Returns { accent, glow } for the given league slug.
 * Falls back to LEC colors if the league is unknown.
 */
export function getLeagueColors(league?: string): { accent: string; glow: string } {
  return LEAGUE_COLORS[league?.toLowerCase() ?? ''] ?? FALLBACK;
}
