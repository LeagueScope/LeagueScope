'use client';

import { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { AnimatePresence, motion, LayoutGroup } from 'motion/react';

/* ═══════════════════════════════════════════════════════════════════════════
   ExpandableCard — shared-layout card expansion for Overview rankings
   • <ExpandableGrid>: provides state + backdrop + ESC handler
   • <ExpandableCard cardId="...">: card wrapper, becomes the focused view
   • children is a function: (isExpanded) => ReactNode, so callers can
     conditionally render top-N vs full list.
   ═══════════════════════════════════════════════════════════════════════════ */

interface Ctx {
  expandedId: string | null;
  setExpandedId: (id: string | null) => void;
}
const ExpandCtx = createContext<Ctx>({ expandedId: null, setExpandedId: () => {} });

export function ExpandableGrid({ children }: { children: React.ReactNode }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // ESC to close
  useEffect(() => {
    if (!expandedId) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setExpandedId(null); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [expandedId]);

  // Lock body scroll while a card is expanded
  useEffect(() => {
    if (!expandedId) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [expandedId]);

  return (
    <ExpandCtx.Provider value={{ expandedId, setExpandedId }}>
      <LayoutGroup>
        {children}
        <AnimatePresence>
          {expandedId && (
            <motion.div
              key="p50-backdrop"
              className="p50-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25 }}
              onClick={() => setExpandedId(null)}
            />
          )}
        </AnimatePresence>
      </LayoutGroup>
    </ExpandCtx.Provider>
  );
}

interface CardProps {
  cardId: string;
  className?: string;
  expandedClassName?: string;
  children: (isExpanded: boolean) => React.ReactNode;
}

export function ExpandableCard({ cardId, className = '', expandedClassName = '', children }: CardProps) {
  const { expandedId, setExpandedId } = useContext(ExpandCtx);
  const isExpanded = expandedId === cardId;
  const isDimmed = expandedId !== null && !isExpanded;
  const cardRef = useRef<HTMLDivElement | null>(null);

  const onClick = useCallback((e: React.MouseEvent) => {
    if (isExpanded) return;
    // Ignore clicks that bubbled up from interactive descendants (links, buttons)
    const target = e.target as HTMLElement;
    if (target.closest('a,button')) return;
    setExpandedId(cardId);
  }, [cardId, isExpanded, setExpandedId]);

  const classes = [
    'p50-card',
    'p50-card-interactive',
    className,
    isExpanded ? 'p50-card-expanded' : '',
    isExpanded ? expandedClassName : '',
    isDimmed ? 'p50-card-dimmed' : '',
  ].filter(Boolean).join(' ');

  return (
    <motion.div
      ref={cardRef}
      layout
      layoutId={`p50-card-${cardId}`}
      className={classes}
      onClick={onClick}
      role="button"
      tabIndex={isExpanded ? -1 : 0}
      onKeyDown={(e) => {
        if (isExpanded) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          setExpandedId(cardId);
        }
      }}
      transition={{ layout: { duration: 0.4, ease: [0.22, 0.9, 0.3, 1] } }}
    >
      {isExpanded && (
        <button
          className="p50-expanded-close"
          aria-label="Cerrar"
          onClick={(e) => { e.stopPropagation(); setExpandedId(null); }}
        >
          ×
        </button>
      )}
      {children(isExpanded)}
    </motion.div>
  );
}
