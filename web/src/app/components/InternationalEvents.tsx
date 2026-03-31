// InternationalEvents — First Stand 2026 Spotlight (Server Component, mock data)
import Image from 'next/image';
import { teamImg } from '@/lib/constants';

const FS_EVENT = {
  name: 'First Stand 2026',
  phase: 'Ronda 1 — Doble Eliminación',
  status: 'UPCOMING',
  description: 'Los mejores equipos del Split 1 de cada región. La región ganadora avanza directamente a la fase de cuadros del MSI.',
  groups: [
    {
      name: 'GRUPO A',
      matches: [
        { id: 'P1', round: 'upper', label: 'Partido 1', teamA: { abbr: 'TBD', region: 'lck' }, teamB: { abbr: 'TBD', region: 'lec' }, scoreA: null as number | null, scoreB: null as number | null, status: 'upcoming' },
        { id: 'P2', round: 'upper', label: 'Partido 2', teamA: { abbr: 'TBD', region: 'lpl' }, teamB: { abbr: 'TBD', region: 'lta' }, scoreA: null as number | null, scoreB: null as number | null, status: 'upcoming' },
        { id: 'P3', round: 'upper-final', label: 'Final Cuadro Superior', teamA: { abbr: 'Win P1', region: null as string | null }, teamB: { abbr: 'Win P2', region: null as string | null }, scoreA: null as number | null, scoreB: null as number | null, status: 'upcoming' },
        { id: 'P4', round: 'lower-sf', label: 'Semifinal Cuadro Inferior', teamA: { abbr: 'Los P1', region: null as string | null }, teamB: { abbr: 'Los P2', region: null as string | null }, scoreA: null as number | null, scoreB: null as number | null, status: 'upcoming' },
        { id: 'P5', round: 'lower-final', label: 'Final Cuadro Inferior', teamA: { abbr: 'Los P3', region: null as string | null }, teamB: { abbr: 'Win P4', region: null as string | null }, scoreA: null as number | null, scoreB: null as number | null, status: 'upcoming' },
      ],
    },
    {
      name: 'GRUPO B',
      matches: [
        { id: 'P1', round: 'upper', label: 'Partido 1', teamA: { abbr: 'TBD', region: 'lck' }, teamB: { abbr: 'TBD', region: 'lec' }, scoreA: null as number | null, scoreB: null as number | null, status: 'upcoming' },
        { id: 'P2', round: 'upper', label: 'Partido 2', teamA: { abbr: 'TBD', region: 'lpl' }, teamB: { abbr: 'TBD', region: 'lta' }, scoreA: null as number | null, scoreB: null as number | null, status: 'upcoming' },
        { id: 'P3', round: 'upper-final', label: 'Final Cuadro Superior', teamA: { abbr: 'Win P1', region: null as string | null }, teamB: { abbr: 'Win P2', region: null as string | null }, scoreA: null as number | null, scoreB: null as number | null, status: 'upcoming' },
        { id: 'P4', round: 'lower-sf', label: 'Semifinal Cuadro Inferior', teamA: { abbr: 'Los P1', region: null as string | null }, teamB: { abbr: 'Los P2', region: null as string | null }, scoreA: null as number | null, scoreB: null as number | null, status: 'upcoming' },
        { id: 'P5', round: 'lower-final', label: 'Final Cuadro Inferior', teamA: { abbr: 'Los P3', region: null as string | null }, teamB: { abbr: 'Win P4', region: null as string | null }, scoreA: null as number | null, scoreB: null as number | null, status: 'upcoming' },
      ],
    },
  ],
  participants: [
    { abbr: 'GEN', region: 'lck', league: 'LCK', regionLabel: 'Korea', confirmed: true },
    { abbr: 'TBD', region: null as string | null, league: 'LCK', regionLabel: 'Korea', confirmed: false },
    { abbr: 'TBD', region: null as string | null, league: 'LPL', regionLabel: 'China', confirmed: false },
    { abbr: 'TBD', region: null as string | null, league: 'LPL', regionLabel: 'China', confirmed: false },
    { abbr: 'TBD', region: null as string | null, league: 'LEC', regionLabel: 'EMEA', confirmed: false },
    { abbr: 'TBD', region: null as string | null, league: 'LCO/PCS', regionLabel: 'Asia-Pacific', confirmed: false },
    { abbr: 'TBD', region: null as string | null, league: 'LCS', regionLabel: 'North America', confirmed: false },
    { abbr: 'TBD', region: null as string | null, league: 'CBLoL', regionLabel: 'Brazil', confirmed: false },
  ],
};

const FS_REGION_STYLES: Record<string, { color: string; bg?: string }> = {
  Korea: { color: '#60a5fa', bg: 'rgba(96,165,250,0.12)' },
  China: { color: '#f97316', bg: 'rgba(249,115,22,0.12)' },
  EMEA: { color: '#a78bfa', bg: 'rgba(167,139,250,0.12)' },
  'Asia-Pacific': { color: '#34d399', bg: 'rgba(52,211,153,0.12)' },
  'North America': { color: '#facc15', bg: 'rgba(250,204,21,0.12)' },
  Brazil: { color: '#22d3ee', bg: 'rgba(34,211,238,0.12)' },
};

type FSMatch = (typeof FS_EVENT.groups)[0]['matches'][0];

function FSMatchRow({ match }: { match: FSMatch }) {
  return (
    <div className={`fs-match-row-editorial ${match.status}`}>
      <div className="fs-match-meta-editorial">
        <span className="fs-match-round-lbl">{match.round.replace('-', ' ').toUpperCase()}</span>
        {match.status === 'live' && <span className="fs-live-dot-editorial">LIVE</span>}
      </div>
      <div className="fs-match-content-editorial">
        <div className="fs-team-cell">
          <span className="fs-team-name-editorial">{match.teamA.abbr}</span>
        </div>
        <div className="fs-score-cell">
          {match.status === 'finished' ? (
            <div className="fs-score-mono">
              <span className={(match.scoreA ?? 0) > (match.scoreB ?? 0) ? 'win' : ''}>{match.scoreA}</span>
              <span className="sep">:</span>
              <span className={(match.scoreB ?? 0) > (match.scoreA ?? 0) ? 'win' : ''}>{match.scoreB}</span>
            </div>
          ) : (
            <span className="fs-vs-editorial">VS</span>
          )}
        </div>
        <div className="fs-team-cell text-right">
          <span className="fs-team-name-editorial">{match.teamB.abbr}</span>
        </div>
      </div>
    </div>
  );
}

export default function InternationalEvents() {
  return (
    <div className="ie-slate-editorial">
      <Image src="/logos/logo_FS.png" alt="" className="ie-slate-watermark" aria-hidden="true" width={200} height={200} />

      <div className="ie-slate-header">
        <div className="ie-header-main">
          <div className="ie-logo-container">
            <Image src="/logos/logo_FS.png" alt="First Stand" className="ie-event-logo" width={100} height={100} />
            <div className="ie-event-year-box">2026</div>
          </div>
          <div className="ie-event-info-block">
            <h1 className="ie-event-title-hero">{FS_EVENT.name}</h1>
            <div className="ie-event-sub-line">
              <span className="ie-phase-tag">{FS_EVENT.phase.toUpperCase()}</span>
              <span className="ie-status-tag">{FS_EVENT.status.toUpperCase()}</span>
            </div>
          </div>
        </div>
        <div className="ie-header-desc">
          {FS_EVENT.description}
        </div>
      </div>

      <div className="ie-slate-layout">
        <div className="ie-participants-column">
          <div className="ie-column-header-editorial">
            <span className="ie-col-title-text">PARTICIPANTS</span>
            <span className="ie-col-count">8 TEAMS</span>
          </div>
          <div className="ie-participants-list">
            {FS_EVENT.participants.map((p, i) => {
              const st = FS_REGION_STYLES[p.regionLabel] || { color: '#94a3b8' };
              return (
                <div key={i} className={`ie-participant-row-editorial ${p.confirmed ? 'confirmed' : ''}`}>
                  <span className="ie-part-idx">{(i + 1).toString().padStart(2, '0')}</span>
                  {p.confirmed ? (
                    <Image src={teamImg(null, p.abbr, p.region ?? undefined)} className="ie-part-logo" alt={p.abbr} width={48} height={48} />
                  ) : (
                    <div className="ie-part-placeholder" style={{ borderColor: st.color }} />
                  )}
                  <div className="ie-part-meta">
                    <span className="ie-part-abbr">{p.confirmed ? p.abbr : 'TBD'}</span>
                    <span className="ie-part-region-lbl" style={{ color: st.color }}>
                      {p.regionLabel} · {p.league}
                    </span>
                  </div>
                  {p.confirmed && <span className="ie-check-mark">✓</span>}
                </div>
              );
            })}
          </div>
        </div>

        <div className="ie-brackets-grid">
          {FS_EVENT.groups.map((group) => (
            <div key={group.name} className="ie-bracket-group">
              <div className="ie-column-header-editorial">
                <span className="ie-col-title-text">{group.name.toUpperCase()}</span>
                <span className="ie-col-count">DOUBLE ELIMINATION</span>
              </div>

              <div className="ie-bracket-sub-section">
                <div className="ie-sub-hdr">UPPER BRACKET</div>
                {group.matches
                  .filter(m => ['upper', 'upper-final'].includes(m.round))
                  .map(m => <FSMatchRow key={m.id + group.name} match={m} />)
                }
              </div>

              <div className="ie-bracket-sub-section">
                <div className="ie-sub-hdr">LOWER BRACKET</div>
                {group.matches
                  .filter(m => ['lower-sf', 'lower-final'].includes(m.round))
                  .map(m => <FSMatchRow key={m.id + group.name + 'l'} match={m} />)
                }
              </div>
            </div>
          ))}

          <div className="ie-bracket-group">
            <div className="ie-column-header-editorial">
              <span className="ie-col-title-text">QUALIFIED</span>
              <span className="ie-col-count">TO ROUND 2</span>
            </div>
            <div className="ie-classified-container">
              {[1, 2, 3, 4].map(idx => (
                <div key={idx} className="ie-classified-slot">
                  <span className="slot-idx">SLOT {idx}</span>
                  <span className="slot-value">TBD</span>
                </div>
              ))}
            </div>

            <a href="/firststand" className="ie-firststand-link">Ver First Stand 2026</a>

            <div className="ie-prize-box-editorial">
              <div className="ie-prize-info">
                <div className="ie-prize-title">REWARD</div>
                <div className="ie-prize-desc">Winner advances directly to MSI 2026 Main Stage.</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
