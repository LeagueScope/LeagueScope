/**
 * roles.js — Single source of truth for role normalization.
 *
 * PandaScore uses: top, jun, mid, adc, sup
 * LeagueScope uses: top, jng, mid, bot, sup
 */

export const ROLE_MAP = {
  top: 'top',
  jun: 'jng',
  jungle: 'jng',
  mid: 'mid',
  adc: 'bot',
  bot: 'bot',
  sup: 'sup',
  support: 'sup',
};

export const normRole = (r) => ROLE_MAP[r] ?? r ?? null;

export const ROLES = ['top', 'jng', 'mid', 'bot', 'sup'];
