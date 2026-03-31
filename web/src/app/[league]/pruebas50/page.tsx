import type { Metadata } from 'next';
import { api } from '@/lib/api';
import { getLeagueColors } from '@/lib/leagueColors';
import Pruebas50Client from './Pruebas50Client';
import type { OverviewData } from '../overview/OverviewClient';
import './pruebas50.css';

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://leaguescope.gg';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ league: string }>;
}): Promise<Metadata> {
  const { league } = await params;
  const leagueUpper = league.toUpperCase();
  const title = `${leagueUpper} Overview — Pruebas50`;
  return { title, description: `Vista experimental de overview para ${leagueUpper}` };
}

async function getOverviewData(league: string): Promise<OverviewData | null> {
  try {
    return await api<OverviewData>(`/pg/overview?league=${league}`, { revalidate: 120 });
  } catch {
    return null;
  }
}

export default async function Pruebas50Page({
  params,
}: {
  params: Promise<{ league: string }>;
}) {
  const { league } = await params;
  const { accent } = getLeagueColors(league);
  const data = await getOverviewData(league);

  return <Pruebas50Client league={league} accent={accent} initialData={data} />;
}
