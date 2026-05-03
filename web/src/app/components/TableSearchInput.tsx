'use client';

import { useId, useRef, type KeyboardEvent } from 'react';

/* ===========================================================================
   TableSearchInput — Buscador inline con multi-token (chips)

   Patrón:
   - El usuario escribe -> el texto actual filtra en vivo (preview).
   - Pulsa Enter (o ',') -> el texto se "ancla" como chip y el input se vacía.
   - El filtro resultante es OR sobre todos los chips + el texto actual.
   - Backspace con input vacío borra el último chip.

   Estilado por familia: el wrapper recibe `${prefix}ed-search` y se asume que
   cada página define sus estilos en su CSS (p20-, p24-, p25-).
   =========================================================================== */

// Rango Unicode de marks combinables (acentos): U+0300..U+036F.
const DIACRITICS_RE = new RegExp('[\\u0300-\\u036f]', 'g');

/**
 * Normaliza una cadena para búsquedas: minúsculas + sin diacríticos.
 */
export function normalizeSearch(s: string | null | undefined): string {
  if (!s) return '';
  return s.normalize('NFD').replace(DIACRITICS_RE, '').toLowerCase().trim();
}

/**
 * Comprueba si `query` matchea alguno de los `fields` (todos los fields se
 * normalizan). Devuelve true si la query está vacía.
 */
export function matchesSearch(query: string, fields: Array<string | null | undefined>): boolean {
  const q = normalizeSearch(query);
  if (!q) return true;
  for (const f of fields) {
    if (f && normalizeSearch(f).includes(q)) return true;
  }
  return false;
}

/**
 * Construye la lista efectiva de claves de búsqueda a partir de los chips
 * comprometidos + el texto activo (sin commit aún). Útil para el filtro OR.
 */
export function buildSearchKeys(tokens: string[], input: string): string[] {
  const t = input.trim();
  if (!t) return tokens;
  const norm = normalizeSearch(t);
  const exists = tokens.some((tok) => normalizeSearch(tok) === norm);
  return exists ? tokens : [...tokens, t];
}

/**
 * Devuelve true si `keys` está vacío o si alguna key matchea cualquier field.
 */
export function matchesAnyKey(keys: string[], fields: Array<string | null | undefined>): boolean {
  if (keys.length === 0) return true;
  for (const k of keys) {
    if (matchesSearch(k, fields)) return true;
  }
  return false;
}

interface Props {
  tokens: string[];
  onTokensChange: (tokens: string[]) => void;
  input: string;
  onInputChange: (v: string) => void;
  prefix: string;
  placeholder?: string;
  ariaLabel?: string;
  maxTokens?: number;
}

export default function TableSearchInput({
  tokens,
  onTokensChange,
  input,
  onInputChange,
  prefix,
  placeholder = 'Buscar... (Enter para anclar)',
  ariaLabel,
  maxTokens = 8,
}: Props) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const cls = (suffix: string) => `${prefix}ed-search-${suffix}`;

  const commitInput = () => {
    const t = input.trim();
    if (!t) return;
    if (tokens.length >= maxTokens) return;
    const norm = normalizeSearch(t);
    if (tokens.some((tok) => normalizeSearch(tok) === norm)) {
      onInputChange('');
      return;
    }
    onTokensChange([...tokens, t]);
    onInputChange('');
  };

  const removeToken = (idx: number) => {
    onTokensChange(tokens.filter((_, i) => i !== idx));
    inputRef.current?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      commitInput();
    } else if (e.key === 'Backspace' && input === '' && tokens.length > 0) {
      e.preventDefault();
      onTokensChange(tokens.slice(0, -1));
    } else if (e.key === 'Escape') {
      onInputChange('');
    }
  };

  const showPlaceholder = tokens.length === 0 && input === '';
  const hasContent = tokens.length > 0 || input !== '';

  return (
    <div
      className={`${prefix}ed-search`}
      role="search"
      onClick={() => inputRef.current?.focus()}
    >
      <svg
        className={cls('icon')}
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <circle cx="11" cy="11" r="7" />
        <path d="m21 21-4.3-4.3" />
      </svg>
      {tokens.map((tok, idx) => (
        <span key={`${tok}-${idx}`} className={cls('chip')}>
          <span className={cls('chip-text')}>{tok}</span>
          <button
            type="button"
            className={cls('chip-remove')}
            onClick={(e) => {
              e.stopPropagation();
              removeToken(idx);
            }}
            aria-label={`Quitar filtro ${tok}`}
          >
            <svg
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </span>
      ))}
      <input
        ref={inputRef}
        id={id}
        className={cls('input')}
        type="text"
        placeholder={showPlaceholder ? placeholder : ''}
        value={input}
        onChange={(e) => onInputChange(e.target.value)}
        onKeyDown={onKeyDown}
        aria-label={ariaLabel || placeholder}
        autoComplete="off"
        spellCheck={false}
      />
      {hasContent && (
        <button
          type="button"
          className={cls('clear')}
          onClick={(e) => {
            e.stopPropagation();
            onTokensChange([]);
            onInputChange('');
            inputRef.current?.focus();
          }}
          aria-label="Borrar todos los filtros"
          title="Borrar todos los filtros"
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  );
}
