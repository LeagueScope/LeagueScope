/* Player profile skeleton — header + KDA ring + stats cards + champion grid */
import '../../loading.css';

export default function PlayerProfileLoading() {
  return (
    <div className="sk-wrap">
      {/* Profile header */}
      <div className="sk-profile-header">
        <div className="sk-circle sk-s64" />
        <div className="sk-profile-info">
          <div className="sk-bone sk-w200 sk-h14" />
          <div className="sk-bone sk-w120 sk-h10" />
          <div className="sk-bone sk-w160 sk-h10" />
        </div>
        <div className="sk-spacer" />
        <div className="sk-circle sk-s80" /> {/* KDA ring placeholder */}
      </div>

      {/* Stats cards grid */}
      <div className="sk-grid">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="sk-card">
            <div className="sk-card-top">
              <div className="sk-bone sk-w120 sk-h14" />
            </div>
            <div className="sk-card-body">
              <div className="sk-bone sk-full sk-h10" />
              <div className="sk-bone sk-w200 sk-h10" />
              <div className="sk-bone sk-w160 sk-h10" />
            </div>
          </div>
        ))}
      </div>

      {/* Champion pool */}
      <div className="sk-card">
        <div className="sk-card-top">
          <div className="sk-bone sk-w160 sk-h14" />
        </div>
        <div className="sk-champ-grid">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="sk-champ-item">
              <div className="sk-circle sk-s32" />
              <div className="sk-bone sk-w60 sk-h10" />
            </div>
          ))}
        </div>
      </div>

      {/* Match log table */}
      <div className="sk-table">
        <div className="sk-table-head">
          <div className="sk-bone sk-w80 sk-h10" />
          <div className="sk-bone sk-w60 sk-h10" />
          <div className="sk-bone sk-w120 sk-h10" />
          <div className="sk-bone sk-w60 sk-h10" />
          <div className="sk-bone sk-w80 sk-h10" />
        </div>
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="sk-table-row">
            <div className="sk-bone sk-w80 sk-h10" />
            <div className="sk-circle sk-s24" />
            <div className="sk-bone sk-w120 sk-h10" />
            <div className="sk-bone sk-w60 sk-h10" />
            <div className="sk-bone sk-w80 sk-h10" />
          </div>
        ))}
      </div>
    </div>
  );
}
