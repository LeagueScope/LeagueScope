'use client';

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  useMemo,
  type ReactNode,
} from 'react';
import { logger } from '@/lib/logger';

/* ═══════════════════════════════════════════════════════════════════════════
   FilterContext — Global Year / Split / Stage filters
   Port of frontend/src/context/FilterContext.jsx → TypeScript
   ═══════════════════════════════════════════════════════════════════════════ */

interface SerieDef {
  id: number;
  name?: string | null;
  full_name?: string | null;
}

interface StageDef {
  id: number;
  name: string;
  type?: string;
  begin_at?: string | null;
  end_at?: string | null;
}

interface FilterState {
  year: number | null;
  split: string | null;
  stage: string | null;
  league: string | null;
  years: number[];
  splits: SerieDef[];
  stages: StageDef[];
  changeYear: (y: number) => void;
  changeSplit: (s: string) => void;
  changeStage: (s: string) => void;
  initForLeague: (slug: string) => void;
  filterParams: Record<string, string | number>;
  ready: boolean;
  initialized: boolean;
  loading: boolean;
}

const FilterContext = createContext<FilterState | null>(null);

// ── Helpers ──────────────────────────────────────────────────────────────────

// In production, NEXT_PUBLIC_API_URL is inlined at build time (e.g. https://…apprunner.com/api/v1).
// In development, falls back to relative path which uses the Next.js rewrite proxy.
const API_BASE = process.env.NEXT_PUBLIC_API_URL || '/api/v1';

async function fetchJson<T>(path: string, retries = 3): Promise<T> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(`${API_BASE}${path}`);
      if (!res.ok) throw new Error(`Filter API ${res.status}`);
      return (await res.json()) as T;
    } catch (err) {
      if (attempt === retries) throw err;
      await new Promise(r => setTimeout(r, attempt * 1000));
    }
  }
  throw new Error('unreachable');
}

function getSerieName(serie?: SerieDef | null): string | null {
  if (!serie) return null;
  const name = serie.name?.trim();
  if (name && name !== 'null') return name;
  const full = serie.full_name?.trim();
  if (full && full !== 'null') return full;
  return `Serie ${serie.id}`;
}

function detectDefaultStage(stages: StageDef[]): string {
  if (!stages || stages.length === 0) return 'all';
  const now = new Date();
  const allFinished = stages.every(s => s.end_at && new Date(s.end_at) < now);
  if (allFinished) return 'all';

  const sorted = [...stages].sort(
    (a, b) => new Date(a.begin_at || 0).getTime() - new Date(b.begin_at || 0).getTime(),
  );

  for (let i = sorted.length - 1; i >= 0; i--) {
    const s = sorted[i];
    const begin = s.begin_at ? new Date(s.begin_at) : null;
    const end = s.end_at ? new Date(s.end_at) : null;
    if (begin && begin <= now && (!end || end >= now)) return s.name;
  }
  return 'all';
}

// ── Provider ─────────────────────────────────────────────────────────────────

export function FilterProvider({ children }: { children: ReactNode }) {
  const [year, setYear] = useState<number | null>(null);
  const [split, setSplit] = useState<string | null>(null);
  const [stage, setStage] = useState<string | null>(null);

  const [years, setYears] = useState<number[]>([]);
  const [splits, setSplits] = useState<SerieDef[]>([]);
  const [stages, setStages] = useState<StageDef[]>([]);

  const [loading, setLoading] = useState(false);
  const leagueRef = useRef<string | null>(null);
  const [league, setLeague] = useState<string | null>(null);
  const seqRef = useRef(0);

  const initForLeague = useCallback(async (leagueSlug: string) => {
    if (!leagueSlug) return;
    if (leagueRef.current === leagueSlug) return;
    leagueRef.current = leagueSlug;

    const seq = ++seqRef.current;
    setYear(null);
    setSplit(null);
    setStage(null);
    setLoading(true);
    setLeague(leagueSlug);

    try {
      // Single round-trip: returns years + series + stages
      const data = await fetchJson<{
        years: number[];
        series: SerieDef[];
        stages: StageDef[];
        year: number | null;
        split?: string | null;
      }>(`/pg/filters/init?league=${leagueSlug.toUpperCase()}`);
      if (seq !== seqRef.current) return;

      setYears(data.years);

      if (!data.years.length || !data.year) {
        setYear(null);
        setSplit(null);
        setStage('all');
        setSplits([]);
        setStages([]);
        setLoading(false);
        return;
      }

      setSplits(data.series);
      setStages(data.stages);

      const splitName = data.split || getSerieName(data.series[0]);
      const defaultStage = detectDefaultStage(data.stages);

      setYear(data.year);
      setSplit(splitName);
      setStage(defaultStage);
    } catch (err) {
      logger.error('[FilterContext] init error:', err);
      if (seq === seqRef.current) {
        setYear(null);
        setSplit('unknown');
        setStage('all');
      }
    } finally {
      if (seq === seqRef.current) setLoading(false);
    }
  }, []);

  const changeYear = useCallback(
    async (newYear: number) => {
      if (!league || String(newYear) === String(year)) return;
      const seq = ++seqRef.current;
      setLoading(true);

      try {
        // Single round-trip with year hint
        const data = await fetchJson<{
          years: number[];
          series: SerieDef[];
          stages: StageDef[];
          year: number | null;
          split?: string | null;
        }>(`/pg/filters/init?league=${league.toUpperCase()}&year=${newYear}`);
        if (seq !== seqRef.current) return;

        setSplits(data.series);

        const splitName = data.split || getSerieName(data.series[0]);
        if (!splitName) {
          setYear(newYear);
          setSplit('unknown');
          setStages([]);
          setStage('all');
          setLoading(false);
          return;
        }

        setStages(data.stages);
        setYear(newYear);
        setSplit(splitName);
        setStage(detectDefaultStage(data.stages));
      } catch (err) {
        logger.error('[FilterContext] changeYear error:', err);
        if (seq === seqRef.current) {
          setYear(newYear);
          setSplits([]);
          setSplit('unknown');
          setStages([]);
          setStage('all');
        }
      } finally {
        if (seq === seqRef.current) setLoading(false);
      }
    },
    [league, year],
  );

  const changeSplit = useCallback(
    async (newSplitName: string) => {
      if (!league || !year || newSplitName === split) return;
      const seq = ++seqRef.current;
      setSplit(newSplitName);
      setLoading(true);

      try {
        const stData = await fetchJson<StageDef[]>(
          `/pg/filters/stages?league=${league.toUpperCase()}&year=${year}&split=${encodeURIComponent(newSplitName)}`,
        );
        if (seq !== seqRef.current) return;
        setStages(stData);
        setStage(detectDefaultStage(stData));
      } catch (err) {
        logger.error('[FilterContext] changeSplit error:', err);
      } finally {
        if (seq === seqRef.current) setLoading(false);
      }
    },
    [league, year, split],
  );

  const changeStage = useCallback((newStage: string) => {
    setStage(newStage);
  }, []);

  const filterParams = useMemo(() => {
    const p: Record<string, string | number> = {};
    if (year) p.year = year;
    if (split) p.split = split;
    if (stage && stage !== 'all') p.stage = stage;
    return p;
  }, [year, split, stage]);

  const initialized = year != null && split != null && stage != null;
  const ready = initialized && !loading;

  return (
    <FilterContext.Provider
      value={{
        year,
        split,
        stage,
        league,
        years,
        splits,
        stages,
        changeYear,
        changeSplit,
        changeStage,
        initForLeague,
        filterParams,
        ready,
        initialized,
        loading,
      }}
    >
      {children}
    </FilterContext.Provider>
  );
}

export function useFilters(): FilterState {
  const ctx = useContext(FilterContext);
  if (!ctx) throw new Error('useFilters must be used within FilterProvider');
  return ctx;
}

export default FilterContext;
