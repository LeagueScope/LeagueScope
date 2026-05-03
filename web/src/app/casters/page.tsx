import type { Metadata } from 'next';
import dynamic from 'next/dynamic';
import './casters.css';

const CastersClient = dynamic(() => import('./CastersClient'));

export const metadata: Metadata = {
  title: 'Casters — LeagueScope',
  description: 'Herramienta privada para casters y streamers de LoL esports.',
  robots: { index: false, follow: false }, // No indexar
};

export default function CastersPage() {
  return <CastersClient />;
}
