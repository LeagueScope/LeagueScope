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
