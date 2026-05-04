'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';

import {
  LEAGUES,
  TIER1_LEAGUES,
  TIER2_LEAGUES,
  TIER3_LEAGUES,
  INTL_LEAGUES,
  EXTINCT_SECTIONS,
  LEAGUE_LOGO,
  ROLE_ICON,
  type LeagueDef,
} from '@/lib/constants';
import { useFilters } from '@/context/FilterContext';
import './navbar.css';

/* ═══════════════════════════════════════════════════════════════════════════
   Navbar — Global navigation bar
   Port of frontend/src/components/Header.jsx → TypeScript + Next.js
   ═══════════════════════════════════════════════════════════════════════════ */

// ── Tiny SVG chevron ─────────────────────────────────────────────────────────

function Chevron({ size = 8 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
      style={{ display: 'block' }}>
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

// ── FilterDropdown ───────────────────────────────────────────────────────────

interface FilterDropdownProps {
  label: string;
  value: string | number | null;
  options: { value: string | number; label: string }[];
  onChange: (v: string | number) => void;
  headerText?: string;
}

function FilterDropdown({ label, value, options, onChange, headerText }: FilterDropdownProps) {
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) { setOpen(false); setActiveIdx(-1); }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault(); setOpen(true); setActiveIdx(0); return;
    }
    if (!open) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx(i => (i + 1) % options.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx(i => (i <= 0 ? options.length - 1 : i - 1)); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (activeIdx >= 0) { onChange(options[activeIdx].value); setOpen(false); setActiveIdx(-1); } }
    else if (e.key === 'Escape') { e.preventDefault(); setOpen(false); setActiveIdx(-1); }
  };

  return (
    <div className="arcane-dropdown-container standalone" ref={ref}>
      <button
        className="dropdown-trigger"
        onClick={() => { setOpen(o => !o); setActiveIdx(-1); }}
        onKeyDown={handleKeyDown}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={`${headerText ?? label}: ${value ?? 'ninguno'}`}
        style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer',
                 color: 'var(--text-secondary)', fontWeight: 600, fontFamily: 'inherit' }}
      >
        <span>{label}</span>
        <Chevron />
      </button>
      {open && (
        <div className="arcane-dropdown" role="listbox" aria-label={headerText ?? label}>
          {headerText && <div className="arcane-dropdown-header">{headerText}</div>}
          {options.map((opt, i) => (
            <div
              key={opt.value}
              role="option"
              aria-selected={String(opt.value) === String(value)}
              className={`arcane-dropdown-item small ${String(opt.value) === String(value) ? 'filter-active' : ''} ${i === activeIdx ? 'kb-focus' : ''}`}
              onClick={() => { onChange(opt.value); setOpen(false); setActiveIdx(-1); }}
              onMouseEnter={() => setActiveIdx(i)}
            >
              {opt.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── LeagueDropdown ───────────────────────────────────────────────────────────

interface LeagueDropdownProps {
  label: string;
  leagues: LeagueDef[];
  currentLeague: string;
  onNav: (path: string) => void;
}

function LeagueDropdown({ label, leagues, currentLeague, onNav }: LeagueDropdownProps) {
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const ref = useRef<HTMLDivElement>(null);
  const isGroupActive = leagues.some(l => l.id === currentLeague);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) { setOpen(false); setActiveIdx(-1); }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault(); setOpen(true); setActiveIdx(0); return;
    }
    if (!open) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx(i => (i + 1) % leagues.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx(i => (i <= 0 ? leagues.length - 1 : i - 1)); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (activeIdx >= 0) { onNav(`/${leagues[activeIdx].id}/overview`); setOpen(false); setActiveIdx(-1); } }
    else if (e.key === 'Escape') { e.preventDefault(); setOpen(false); setActiveIdx(-1); }
  };

  return (
    <div className="arcane-dropdown-container standalone" ref={ref}>
      <button
        className={`dropdown-trigger ${isGroupActive ? 'group-active' : ''}`}
        onClick={() => { setOpen(o => !o); setActiveIdx(-1); }}
        onKeyDown={handleKeyDown}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={`Ligas ${label}`}
        style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer',
                 color: 'var(--text-secondary)', fontWeight: 600, fontFamily: 'inherit' }}
      >
        {isGroupActive && (
          <Image
            className="trigger-league-logo"
            src={LEAGUE_LOGO(currentLeague)}
            alt={`${currentLeague.toUpperCase()} logo`}
            width={40}
            height={40}
            onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
          />
        )}
        <span>{label}</span>
        <Chevron />
      </button>
      {open && (
        <div className="arcane-dropdown league-dropdown" role="listbox" aria-label={`Ligas ${label}`}>
          {leagues.map((l, i) => (
            <div
              key={l.id}
              role="option"
              aria-selected={currentLeague === l.id}
              className={`arcane-dropdown-item ${currentLeague === l.id ? 'filter-active' : ''} ${i === activeIdx ? 'kb-focus' : ''}`}
              onClick={() => { onNav(`/${l.id}/overview`); setOpen(false); setActiveIdx(-1); }}
              onMouseEnter={() => setActiveIdx(i)}
            >
              <Image
                className="arcane-dropdown-logo"
                src={LEAGUE_LOGO(l.id)}
                alt={`${l.name} logo`}
                width={40}
                height={40}
                onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
              />
              <span>{l.name}</span>
              <span className="arcane-dropdown-region">{l.region}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── ExtinctasDropdown ────────────────────────────────────────────────────────

function ExtinctasDropdown({
  currentLeague,
  onNav,
}: {
  currentLeague: string;
  onNav: (path: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [activeIdx, setActiveIdx] = useState(-1);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) { setOpen(false); setActiveIdx(-1); }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const toggle = (title: string) =>
    setExpanded(prev => ({ ...prev, [title]: !prev[title] }));

  // Build flat list of visible items: section headers + expanded league items
  type FlatItem = { type: 'header'; title: string } | { type: 'league'; id: string; sectionTitle: string };
  const flatItems: FlatItem[] = [];
  for (const section of EXTINCT_SECTIONS) {
    flatItems.push({ type: 'header', title: section.title });
    if (expanded[section.title]) {
      for (const l of section.leagues) {
        flatItems.push({ type: 'league', id: l.id, sectionTitle: section.title });
      }
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault(); setOpen(true); setActiveIdx(0); return;
    }
    if (!open) return;
    const len = flatItems.length;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx(i => (i + 1) % len); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx(i => (i <= 0 ? len - 1 : i - 1)); }
    else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (activeIdx >= 0 && activeIdx < len) {
        const item = flatItems[activeIdx];
        if (item.type === 'header') { toggle(item.title); }
        else { onNav(`/${item.id}/overview`); setOpen(false); setActiveIdx(-1); }
      }
    }
    else if (e.key === 'Escape') { e.preventDefault(); setOpen(false); setActiveIdx(-1); }
  };

  // Track which flat index we're on while rendering
  let flatIdx = -1;

  return (
    <div className="arcane-dropdown-container standalone" ref={ref}>
      <button
        className="dropdown-trigger"
        onClick={() => { setOpen(o => !o); setActiveIdx(-1); }}
        onKeyDown={handleKeyDown}
        aria-expanded={open}
        aria-haspopup="true"
        aria-label="Ligas extintas"
        style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer',
                 color: 'var(--text-secondary)', fontWeight: 600, fontFamily: 'inherit' }}
      >
        <span>Extintas</span>
        <Chevron />
      </button>
      {open && (
        <div className="arcane-dropdown extintas-mega-dropdown" role="listbox" aria-label="Ligas extintas">
          {EXTINCT_SECTIONS.map(section => {
            const isExpanded = !!expanded[section.title];
            const hasActive = section.leagues.some(l => l.id === currentLeague);
            const headerIdx = ++flatIdx;
            return (
              <div className="extintas-section" key={section.title}>
                <div
                  role="option"
                  aria-selected={false}
                  className={`extintas-section-header ${isExpanded ? 'expanded' : ''} ${hasActive ? 'has-active' : ''} ${headerIdx === activeIdx ? 'kb-focus' : ''}`}
                  onClick={() => toggle(section.title)}
                  onMouseEnter={() => setActiveIdx(headerIdx)}
                >
                  <span
                    className={`extintas-chevron ${isExpanded ? 'rotated' : ''}`}
                  >
                    <Chevron />
                  </span>
                  <span>{section.title}</span>
                  <span className="extintas-count">{section.leagues.length}</span>
                </div>
                {isExpanded && (
                  <div className="extintas-section-items">
                    {section.leagues.map(l => {
                      const itemIdx = ++flatIdx;
                      return (
                        <div
                          key={l.id}
                          role="option"
                          aria-selected={currentLeague === l.id}
                          className={`arcane-dropdown-item extintas-league-item ${currentLeague === l.id ? 'filter-active' : ''} ${itemIdx === activeIdx ? 'kb-focus' : ''}`}
                          onClick={() => { onNav(`/${l.id}/overview`); setOpen(false); setActiveIdx(-1); }}
                          onMouseEnter={() => setActiveIdx(itemIdx)}
                        >
                          <Image
                            className="arcane-dropdown-logo"
                            src={LEAGUE_LOGO(l.id)}
                            alt={`${l.name} logo`}
                            width={40}
                            height={40}
                            onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                          />
                          <span>{l.name}</span>
                          {l.note && <span className="extintas-note">{l.note}</span>}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── LeaguesAllDropdown ───────────────────────────────────────────────────────
// Dropdown unificado para tablet (768-1199px): Tier 1/2/3/Internacional/Extintas
// en un único panel con secciones colapsables.

function LeaguesAllDropdown({
  currentLeague,
  onNav,
}: {
  currentLeague: string;
  onNav: (path: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const toggle = (title: string) =>
    setExpanded(prev => ({ ...prev, [title]: !prev[title] }));

  const sections: { title: string; leagues: LeagueDef[] }[] = [
    { title: 'Tier 1', leagues: TIER1_LEAGUES },
    { title: 'Tier 2', leagues: TIER2_LEAGUES },
    { title: 'Tier 3', leagues: TIER3_LEAGUES },
    { title: 'Internacional', leagues: INTL_LEAGUES },
  ];

  // Comprobar si la liga actual está en alguna sección activa
  const isAnyActive = sections.some(s => s.leagues.some(l => l.id === currentLeague))
    || EXTINCT_SECTIONS.some(s => s.leagues.some(l => l.id === currentLeague));

  return (
    <div className="arcane-dropdown-container standalone" ref={ref}>
      <button
        className={`dropdown-trigger ${isAnyActive ? 'group-active' : ''}`}
        onClick={() => setOpen(o => !o)}
        onKeyDown={e => {
          if (e.key === 'Escape') { setOpen(false); }
          else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(o => !o); }
        }}
        aria-expanded={open}
        aria-haspopup="true"
        aria-label="Ligas"
        style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer',
                 color: 'var(--text-secondary)', fontWeight: 600, fontFamily: 'inherit' }}
      >
        <span>Ligas</span>
        <Chevron />
      </button>
      {open && (
        <div className="arcane-dropdown extintas-mega-dropdown" role="listbox" aria-label="Todas las ligas">
          {sections.map(section => {
            const isExpanded = !!expanded[section.title];
            const hasActive = section.leagues.some(l => l.id === currentLeague);
            return (
              <div className="extintas-section" key={section.title}>
                <div
                  role="option"
                  aria-selected={false}
                  className={`extintas-section-header ${isExpanded ? 'expanded' : ''} ${hasActive ? 'has-active' : ''}`}
                  onClick={() => toggle(section.title)}
                >
                  <span className={`extintas-chevron ${isExpanded ? 'rotated' : ''}`}><Chevron /></span>
                  <span>{section.title}</span>
                  <span className="extintas-count">{section.leagues.length}</span>
                </div>
                {isExpanded && (
                  <div className="extintas-section-items">
                    {section.leagues.map(l => (
                      <div
                        key={l.id}
                        role="option"
                        aria-selected={currentLeague === l.id}
                        className={`arcane-dropdown-item extintas-league-item ${currentLeague === l.id ? 'filter-active' : ''}`}
                        onClick={() => { onNav(`/${l.id}/overview`); setOpen(false); }}
                      >
                        <Image
                          className="arcane-dropdown-logo"
                          src={LEAGUE_LOGO(l.id)}
                          alt={`${l.name} logo`}
                          width={40}
                          height={40}
                          onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                        />
                        <span>{l.name}</span>
                        <span className="arcane-dropdown-region">{l.region}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {/* Separador antes de Extintas */}
          <div className="extintas-section">
            <div className="extintas-section-header" style={{ pointerEvents: 'none', opacity: 0.5, fontSize: '9px' }}>
              <span>EXTINTAS</span>
            </div>
            {EXTINCT_SECTIONS.map(section => {
              const key = `ext-${section.title}`;
              const isExpanded = !!expanded[key];
              const hasActive = section.leagues.some(l => l.id === currentLeague);
              return (
                <div className="extintas-section" key={key}>
                  <div
                    role="option"
                    aria-selected={false}
                    className={`extintas-section-header ${isExpanded ? 'expanded' : ''} ${hasActive ? 'has-active' : ''}`}
                    onClick={() => toggle(key)}
                  >
                    <span className={`extintas-chevron ${isExpanded ? 'rotated' : ''}`}><Chevron /></span>
                    <span>{section.title}</span>
                    <span className="extintas-count">{section.leagues.length}</span>
                  </div>
                  {isExpanded && (
                    <div className="extintas-section-items">
                      {section.leagues.map(l => (
                        <div
                          key={l.id}
                          role="option"
                          aria-selected={currentLeague === l.id}
                          className={`arcane-dropdown-item extintas-league-item ${currentLeague === l.id ? 'filter-active' : ''}`}
                          onClick={() => { onNav(`/${l.id}/overview`); setOpen(false); }}
                        >
                          <Image
                            className="arcane-dropdown-logo"
                            src={LEAGUE_LOGO(l.id)}
                            alt={`${l.name} logo`}
                            width={40}
                            height={40}
                            onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                          />
                          <span>{l.name}</span>
                          {l.note && <span className="extintas-note">{l.note}</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── FiltersAllDropdown ───────────────────────────────────────────────────────
// Dropdown unificado para tablet (768-1199px): Year + Split + Stage en un
// único panel con secciones colapsables. Mismo patrón visual que
// LeaguesAllDropdown.

interface FiltersAllDropdownProps {
  year: number | null;
  yearOptions: { value: string | number; label: string }[];
  onYearChange: (v: number) => void;
  split: string | null;
  splitOptions: { value: string | number; label: string }[];
  onSplitChange: (v: string) => void;
  stage: string | null;
  stageOptions: { value: string | number; label: string }[];
  onStageChange: (v: string) => void;
  showStage: boolean;
}

function FiltersAllDropdown({
  year, yearOptions, onYearChange,
  split, splitOptions, onSplitChange,
  stage, stageOptions, onStageChange, showStage,
}: FiltersAllDropdownProps) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const toggle = (k: string) => setExpanded(p => ({ ...p, [k]: !p[k] }));

  const yearLabel = year != null ? String(year) : '—';
  const splitLabel = split ?? '—';
  const stageLabel = stage === 'all' ? 'All' : (stage ?? '—');

  return (
    <div className="arcane-dropdown-container standalone" ref={ref}>
      <button
        className="dropdown-trigger"
        onClick={() => setOpen(o => !o)}
        onKeyDown={e => {
          if (e.key === 'Escape') setOpen(false);
          else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(o => !o); }
        }}
        aria-expanded={open}
        aria-haspopup="true"
        aria-label="Filtros"
        style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer',
                 color: 'var(--text-secondary)', fontWeight: 600, fontFamily: 'inherit' }}
      >
        <span>Filtros</span>
        <Chevron />
      </button>
      {open && (
        <div className="arcane-dropdown extintas-mega-dropdown" role="listbox" aria-label="Filtros">
          {/* Year */}
          {yearOptions.length > 0 && (
            <div className="extintas-section">
              <div
                className={`extintas-section-header ${expanded.year ? 'expanded' : ''}`}
                onClick={() => toggle('year')}
              >
                <span className={`extintas-chevron ${expanded.year ? 'rotated' : ''}`}><Chevron /></span>
                <span>Year</span>
                <span className="extintas-count">{yearLabel}</span>
              </div>
              {expanded.year && (
                <div className="extintas-section-items">
                  {yearOptions.map(opt => (
                    <div
                      key={String(opt.value)}
                      role="option"
                      aria-selected={String(opt.value) === String(year)}
                      className={`arcane-dropdown-item extintas-league-item ${String(opt.value) === String(year) ? 'filter-active' : ''}`}
                      onClick={() => { onYearChange(opt.value as number); setOpen(false); }}
                    >
                      <span>{opt.label}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {/* Split */}
          {splitOptions.length > 0 && (
            <div className="extintas-section">
              <div
                className={`extintas-section-header ${expanded.split ? 'expanded' : ''}`}
                onClick={() => toggle('split')}
              >
                <span className={`extintas-chevron ${expanded.split ? 'rotated' : ''}`}><Chevron /></span>
                <span>Split</span>
                <span className="extintas-count">{splitLabel}</span>
              </div>
              {expanded.split && (
                <div className="extintas-section-items">
                  {splitOptions.map(opt => (
                    <div
                      key={String(opt.value)}
                      role="option"
                      aria-selected={String(opt.value) === String(split)}
                      className={`arcane-dropdown-item extintas-league-item ${String(opt.value) === String(split) ? 'filter-active' : ''}`}
                      onClick={() => { onSplitChange(opt.value as string); setOpen(false); }}
                    >
                      <span>{opt.label}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {/* Stage */}
          {showStage && stageOptions.length > 0 && (
            <div className="extintas-section">
              <div
                className={`extintas-section-header ${expanded.stage ? 'expanded' : ''}`}
                onClick={() => toggle('stage')}
              >
                <span className={`extintas-chevron ${expanded.stage ? 'rotated' : ''}`}><Chevron /></span>
                <span>Stage</span>
                <span className="extintas-count">{stageLabel}</span>
              </div>
              {expanded.stage && (
                <div className="extintas-section-items">
                  {stageOptions.map(opt => (
                    <div
                      key={String(opt.value)}
                      role="option"
                      aria-selected={String(opt.value) === String(stage)}
                      className={`arcane-dropdown-item extintas-league-item ${String(opt.value) === String(stage) ? 'filter-active' : ''}`}
                      onClick={() => { onStageChange(opt.value as string); setOpen(false); }}
                    >
                      <span>{opt.label}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── GlobalSearchBar ──────────────────────────────────────────────────────────

interface SearchResult {
  players: { id: number; name: string; image_url?: string; current_team_abbr?: string; role?: string }[];
  teams: { id: number; name: string; image_url?: string; acronym?: string }[];
  champions: { id: number; name: string; image_url?: string }[];
}

function GlobalSearchBar({
  currentLeague,
  onNav,
}: {
  currentLeague: string;
  onNav: (path: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult>({ players: [], teams: [], champions: [] });
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const doSearch = useCallback(
    async (q: string) => {
      if (q.length < 2) {
        setResults({ players: [], teams: [], champions: [] });
        setOpen(false);
        return;
      }
      setLoading(true);
      try {
        const apiBase = process.env.NEXT_PUBLIC_API_URL || '/api/v1';
        const res = await fetch(`${apiBase}/pg/search?q=${encodeURIComponent(q)}`);
        if (!res.ok) throw new Error(`Search API ${res.status}`);
        const data = await res.json();
        setResults(data);
        setOpen(true);
        setActiveIdx(-1);
      } catch {
        setResults({ players: [], teams: [], champions: [] });
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setQuery(v);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => doSearch(v), 300);
  };

  type FlatItem =
    | { type: 'player'; data: SearchResult['players'][0] }
    | { type: 'team'; data: SearchResult['teams'][0] }
    | { type: 'champion'; data: SearchResult['champions'][0] };

  const flatItems: FlatItem[] = [
    ...results.players.map(p => ({ type: 'player' as const, data: p })),
    ...results.teams.map(t => ({ type: 'team' as const, data: t })),
    ...(results.champions || []).map(c => ({ type: 'champion' as const, data: c })),
  ];

  const handleSelect = (item: FlatItem) => {
    setOpen(false);
    setQuery('');
    setResults({ players: [], teams: [], champions: [] });
    if (item.type === 'player') {
      onNav(`/${currentLeague}/player_historical/${encodeURIComponent(item.data.name)}`);
    } else if (item.type === 'team') {
      const identifier = (item.data as SearchResult['teams'][0]).acronym || item.data.name;
      onNav(`/${currentLeague}/team_historical/${encodeURIComponent(identifier)}`);
    } else {
      onNav(`/${currentLeague}/champion_historical/${encodeURIComponent(item.data.name)}`);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (flatItems.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx(i => (i + 1) % flatItems.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx(i => (i <= 0 ? flatItems.length - 1 : i - 1));
    } else if (e.key === 'Enter' && activeIdx >= 0) {
      e.preventDefault();
      handleSelect(flatItems[activeIdx]);
    } else if (e.key === 'Escape') {
      setOpen(false);
      inputRef.current?.blur();
    }
  };

  const hasResults = flatItems.length > 0;

  return (
    <div className="gs-wrap" ref={wrapRef} role="search" aria-label="Búsqueda global">
      <div className={`gs-input-wrap ${open && hasResults ? 'gs-input-active' : ''}`}>
        <svg className="gs-icon" width="14" height="14" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          aria-hidden="true">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          ref={inputRef}
          className="gs-input"
          type="search"
          role="combobox"
          aria-expanded={open && hasResults}
          aria-autocomplete="list"
          aria-controls="gs-listbox"
          aria-label="Buscar jugador, equipo o campeón"
          placeholder="Buscar jugador, equipo o campeón…"
          value={query}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onFocus={() => { if (flatItems.length > 0) setOpen(true); }}
        />
        {loading && <span className="gs-spinner" />}
        {query && !loading && (
          <span
            className="gs-clear"
            onClick={() => { setQuery(''); setResults({ players: [], teams: [], champions: [] }); setOpen(false); }}
          >
            ×
          </span>
        )}
      </div>

      {open && hasResults && (
        <div className="gs-dropdown" role="listbox" aria-label="Resultados de búsqueda">
          {results.players.length > 0 && (
            <>
              <div className="gs-section-label">Jugadores</div>
              {results.players.map((p, i) => {
                const idx = i;
                return (
                  <div
                    key={`p-${p.id}`}
                    className={`gs-item ${activeIdx === idx ? 'gs-item-active' : ''}`}
                    onMouseEnter={() => setActiveIdx(idx)}
                    onClick={() => handleSelect({ type: 'player', data: p })}
                  >
                    {p.image_url ? (
                      <Image className="gs-avatar" src={p.image_url} alt="" width={32} height={32}
                        onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                    ) : (
                      <div className="gs-avatar gs-avatar-placeholder" />
                    )}
                    <div className="gs-item-info">
                      <span className="gs-item-name">{p.name}</span>
                      {p.current_team_abbr && <span className="gs-item-team">{p.current_team_abbr}</span>}
                    </div>
                    {p.role && (
                      <Image className="gs-role" src={ROLE_ICON(p.role)} alt={p.role} width={20} height={20}
                        onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                    )}
                  </div>
                );
              })}
            </>
          )}
          {results.teams.length > 0 && (
            <>
              <div className="gs-section-label">Equipos</div>
              {results.teams.map((t, j) => {
                const idx = results.players.length + j;
                return (
                  <div
                    key={`t-${t.id}`}
                    className={`gs-item ${activeIdx === idx ? 'gs-item-active' : ''}`}
                    onMouseEnter={() => setActiveIdx(idx)}
                    onClick={() => handleSelect({ type: 'team', data: t })}
                  >
                    {t.image_url ? (
                      <Image className="gs-avatar" src={t.image_url} alt="" width={32} height={32}
                        onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                    ) : (
                      <div className="gs-avatar gs-avatar-placeholder" />
                    )}
                    <div className="gs-item-info">
                      <span className="gs-item-name">{t.name}</span>
                      <span className="gs-item-team">{t.acronym}</span>
                    </div>
                  </div>
                );
              })}
            </>
          )}
          {(results.champions?.length ?? 0) > 0 && (
            <>
              <div className="gs-section-label">Campeones</div>
              {results.champions!.map((c, k) => {
                const idx = results.players.length + results.teams.length + k;
                return (
                  <div
                    key={`c-${c.id}`}
                    className={`gs-item ${activeIdx === idx ? 'gs-item-active' : ''}`}
                    onMouseEnter={() => setActiveIdx(idx)}
                    onClick={() => handleSelect({ type: 'champion', data: c })}
                  >
                    {c.image_url ? (
                      <Image className="gs-avatar" src={c.image_url} alt="" width={32} height={32}
                        onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                    ) : (
                      <div className="gs-avatar gs-avatar-placeholder" />
                    )}
                    <div className="gs-item-info">
                      <span className="gs-item-name">{c.name}</span>
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main Navbar ──────────────────────────────────────────────────────────────

export default function Navbar() {
  const pathname = usePathname();
  const router = useRouter();
  const filters = useFilters();
  const [mobileOpen, setMobileOpen] = useState(false);

  const onNav = useCallback((path: string) => { setMobileOpen(false); router.push(path); }, [router]);

  // Bloquear scroll del body cuando el drawer mobile está abierto
  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [mobileOpen]);

  // Cerrar drawer al pulsar Escape
  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMobileOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mobileOpen]);

  // Cerrar drawer cuando cambia la ruta (Link directo sin pasar por onNav)
  useEffect(() => { setMobileOpen(false); }, [pathname]);

  // ── Current league from URL ──────────────────────────────────────────────
  const pathParts = pathname.split('/').filter(Boolean);
  const currentLeague =
    pathParts.length > 0 && LEAGUES.some(l => l.id === pathParts[0])
      ? pathParts[0]
      : 'lec';

  // ── Sync FilterContext when league changes ──────────────────────────────
  useEffect(() => {
    if (currentLeague && currentLeague !== filters.league) {
      filters.initForLeague(currentLeague);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentLeague]);

  // ── Filter dropdown options ─────────────────────────────────────────────
  const yearOptions = filters.years.map(y => ({ value: y, label: String(y) }));

  const splitOptions = filters.splits.map(s => {
    const name =
      s.name?.trim() && s.name.trim() !== 'null'
        ? s.name.trim()
        : s.full_name?.trim() && s.full_name.trim() !== 'null'
          ? s.full_name.trim()
          : `Serie ${s.id}`;
    return { value: name, label: name };
  });

  const stageOptions = [
    { value: 'all', label: 'All' },
    ...filters.stages.map(s => ({ value: s.name, label: s.name })),
  ];

  const isLeaguePage = pathParts.length > 0 && LEAGUES.some(l => l.id === pathParts[0]);

  // Helper: is current path active?
  const isActive = (href: string) => pathname === href || pathname.startsWith(href + '/');
  const isExactActive = (href: string) => pathname === href;

  return (
    <nav className={`arcane-navbar ${mobileOpen ? 'is-drawer-open' : ''}`} aria-label="Navegación principal">
      {/* Brand / Logo */}
      <Link href="/home" className="arcane-brand" aria-label="LeagueScope — Inicio">
        <Image
          src="/LeagueScope_Logo.png"
          alt="LeagueScope Logo"
          width={32}
          height={32}
          style={{ objectFit: 'contain' }}
        />
        <span className="arcane-brand-text">LeagueScope</span>
      </Link>

      {/* Hamburger toggle (visible only on mobile) */}
      <button
        className="arcane-hamburger"
        onClick={() => setMobileOpen(o => !o)}
        aria-label={mobileOpen ? 'Cerrar menú' : 'Abrir menú'}
        aria-expanded={mobileOpen}
      >
        <span className={`hamburger-line ${mobileOpen ? 'open' : ''}`} />
        <span className={`hamburger-line ${mobileOpen ? 'open' : ''}`} />
        <span className={`hamburger-line ${mobileOpen ? 'open' : ''}`} />
      </button>

      {/* Center Nav — Page links */}
      <div className={`arcane-nav-center ${mobileOpen ? 'mobile-open' : ''}`}>
        <div className="arcane-menu">
          <Link href="/home" className={`arcane-item ${isExactActive('/home') ? 'active' : ''}`}>Home</Link>
          <Link href={`/${currentLeague}/overview`} className={`arcane-item ${isActive(`/${currentLeague}/overview`) ? 'active' : ''}`}>Overview</Link>
          <Link href={`/${currentLeague}/record`} className={`arcane-item ${isActive(`/${currentLeague}/record`) ? 'active' : ''}`}>Record</Link>
          <Link href={`/${currentLeague}/standings`} className={`arcane-item ${isActive(`/${currentLeague}/standings`) ? 'active' : ''}`}>Standings</Link>
          <Link href={`/${currentLeague}/players`} className={`arcane-item ${isActive(`/${currentLeague}/players`) ? 'active' : ''}`}>Players</Link>
          <Link href={`/${currentLeague}/champions`} className={`arcane-item ${isActive(`/${currentLeague}/champions`) ? 'active' : ''}`}>Champions</Link>
          <Link href="/head2head" className={`arcane-item ${isActive('/head2head') ? 'active' : ''}`}>H2H</Link>
        </div>

        {/* Global Search */}
        <GlobalSearchBar currentLeague={currentLeague} onNav={onNav} />
      </div>

      {/* Right section — Leagues + Filters + About */}
      <div className={`arcane-nav-right ${mobileOpen ? 'mobile-open' : ''}`}>
        {/* Tier Dropdowns individuales (visibles >=1200px y dentro del drawer mobile) */}
        <div className="nav-tier-individual">
          <LeagueDropdown label="Tier 1" leagues={TIER1_LEAGUES} currentLeague={currentLeague} onNav={onNav} />
        </div>
        <div className="nav-tier-individual">
          <LeagueDropdown label="Tier 2" leagues={TIER2_LEAGUES} currentLeague={currentLeague} onNav={onNav} />
        </div>
        <div className="nav-tier-individual">
          <LeagueDropdown label="Tier 3" leagues={TIER3_LEAGUES} currentLeague={currentLeague} onNav={onNav} />
        </div>
        <div className="nav-tier-individual">
          <LeagueDropdown label="Internacional" leagues={INTL_LEAGUES} currentLeague={currentLeague} onNav={onNav} />
        </div>

        <div className="nav-tier-individual arcane-nav-separator" />

        {/* Extintas Mega-Dropdown */}
        <div className="nav-tier-individual">
          <ExtinctasDropdown currentLeague={currentLeague} onNav={onNav} />
        </div>

        {/* Dropdown unificado "Ligas" (solo visible en tablet 768-1199px) */}
        <div className="nav-tier-combined">
          <LeaguesAllDropdown currentLeague={currentLeague} onNav={onNav} />
        </div>

        {/* Filter Dropdowns (Year / Split / Stage) */}
        {isLeaguePage && filters.initialized && (
          <>
            <div className="nav-filters-individual arcane-nav-separator" />
            {yearOptions.length > 0 && (
              <div className="nav-filters-individual">
                <FilterDropdown
                  label={filters.year != null ? String(filters.year) : '—'}
                  value={filters.year}
                  options={yearOptions}
                  onChange={v => filters.changeYear(v as number)}
                  headerText="Year"
                />
              </div>
            )}
            {splitOptions.length > 0 && (
              <div className="nav-filters-individual">
                <FilterDropdown
                  label={filters.split ?? '—'}
                  value={filters.split}
                  options={splitOptions}
                  onChange={v => filters.changeSplit(v as string)}
                  headerText="Split"
                />
              </div>
            )}
            {filters.stages.length > 0 && (
              <div className="nav-filters-individual">
                <FilterDropdown
                  label={filters.stage === 'all' ? 'All' : (filters.stage ?? '—')}
                  value={filters.stage}
                  options={stageOptions}
                  onChange={v => filters.changeStage(v as string)}
                  headerText="Stage"
                />
              </div>
            )}

            {/* Dropdown unificado de filtros (solo visible en tablet 768-1199px) */}
            <div className="nav-filters-combined">
              <FiltersAllDropdown
                year={filters.year}
                yearOptions={yearOptions}
                onYearChange={v => filters.changeYear(v)}
                split={filters.split}
                splitOptions={splitOptions}
                onSplitChange={v => filters.changeSplit(v)}
                stage={filters.stage}
                stageOptions={stageOptions}
                onStageChange={v => filters.changeStage(v)}
                showStage={filters.stages.length > 0}
              />
            </div>
          </>
        )}

        <div className="arcane-nav-separator" />

        {/* About */}
        <Link
          href="/about"
          className={`arcane-user-profile ${pathname === '/about' ? 'active' : ''}`}
          aria-label="Acerca de LeagueScope"
          aria-current={pathname === '/about' ? 'page' : undefined}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="16" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
        </Link>
      </div>
    </nav>
  );
}
