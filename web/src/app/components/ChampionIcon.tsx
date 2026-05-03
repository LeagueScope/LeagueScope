'use client';

import Image from 'next/image';
import { useState, useEffect } from 'react';
import { champLocalFallback } from '@/lib/constants';

/* ═══════════════════════════════════════════════════════════════════════════
   ChampionIcon — Imagen de campeón con fallback automático.

   Cadena de carga:
     1. imageUrl de PandaScore (si viene del backend)
     2. /public/champions/<slug>.png   (set local de 172 PNGs)
     3. nada (oculta vía display:none)

   Cuando la carga 1 falla (onError), el componente cambia el src al fallback
   local automáticamente. Si el local también falla, oculta la imagen.

   Uso típico en /overview:
     <ChampionIcon name="Lux" imageUrl={c.image_url} size={28} />
   ═══════════════════════════════════════════════════════════════════════════ */

interface Props {
  name: string;
  imageUrl?: string | null;
  size?: number;
  className?: string;
}

export default function ChampionIcon({ name, imageUrl, size = 28, className }: Props) {
  const localFallback = champLocalFallback(name);
  // Si no hay imageUrl, arrancamos directamente desde el local
  const initialSrc = imageUrl || localFallback;
  const [src, setSrc] = useState(initialSrc);
  const [stage, setStage] = useState<'remote' | 'local' | 'gone'>(imageUrl ? 'remote' : 'local');

  // Reset cuando cambia el campeón (lista de top champs reordenada, filtros, etc.)
  useEffect(() => {
    setSrc(imageUrl || localFallback);
    setStage(imageUrl ? 'remote' : 'local');
  }, [imageUrl, localFallback]);

  if (stage === 'gone' || !src) return null;

  return (
    <Image
      src={src}
      alt={name}
      width={size}
      height={size}
      className={className}
      onError={() => {
        if (stage === 'remote' && localFallback) {
          setSrc(localFallback);
          setStage('local');
        } else {
          setStage('gone');
        }
      }}
      unoptimized={stage === 'local'}
    />
  );
}
