/* Team profile skeleton — header + KPI cards + roster + series */
import '../../loading.css';

export default function TeamProfileLoading() {
  return (
    <div className="sk-wrap">
      {/* Team header */}
      <div className="sk-profile-header">
        <div className="sk-circle sk-s64" />
        <div className="sk-profile-info">
          <div className="sk-bone sk-w200 sk-h14" />
          <div className="sk-bone sk-w120 sk-h10" />
          <div className="sk-bone sk-w80 sk-h10" />
        </div>
        <div className="sk-spacer" />
        <div className="sk-bone sk-w80 sk-h28" />
      </div>

      {/* KPI cards */}
      <div className="sk-grid">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="sk-card">
            <div className="sk-card-top">
              <div className="sk-bone sk-w120 sk-h14" />
            </div>
            <div className="sk-card-body">
              <div className="sk-bone sk-full sk-h10" />
              <div className="sk-bone sk-w160 sk-h10" />
            </div>
          </div>
        ))}
      </div>

      {/* Player roster */}
      <div className="sk-card">
        <div className="sk-card-top">
          <div className="sk-bone sk-w120 sk-h14" />
        </div>
        <div className="sk-roster-grid">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="sk-roster-item">
              <div className="sk-circle sk-s32" />
              <div className="sk-bone sk-w80 sk-h10" />
              <div className="sk-bone sk-w60 sk-h10" />
            </div>
          ))}
        </div>
      </div>

      {/* Series history */}
      <div className="sk-card">
        <div className="sk-card-top">
          <div className="sk-bone sk-w160 sk-h14" />
        </div>
        <div className="sk-card-body">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="sk-series-row">
              <div className="sk-circle sk-s24" />
              <div className="sk-bone sk-w80 sk-h10" />
              <div className="sk-bone sk-w60 sk-h14" />
              <div className="sk-bone sk-w80 sk-h10" />
              <div className="sk-circle sk-s24" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
