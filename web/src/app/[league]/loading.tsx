/* Shared skeleton for all /[league]/* pages */
import './loading.css';

export default function LeagueLoading() {
  return (
    <div className="sk-wrap">
      {/* Header bar skeleton */}
      <div className="sk-header">
        <div className="sk-pill sk-w120" />
        <div className="sk-pill sk-w200" />
        <div className="sk-pill sk-w80" />
      </div>

      {/* Season / filter bar */}
      <div className="sk-filter-bar">
        <div className="sk-bone sk-w160 sk-h14" />
        <div className="sk-spacer" />
        <div className="sk-bone sk-w80 sk-h28" />
        <div className="sk-bone sk-w80 sk-h28" />
        <div className="sk-bone sk-w80 sk-h28" />
      </div>

      {/* Main content area — cards grid */}
      <div className="sk-grid">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="sk-card">
            <div className="sk-card-top">
              <div className="sk-circle sk-s32" />
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

      {/* Table skeleton */}
      <div className="sk-table">
        <div className="sk-table-head">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="sk-bone sk-w80 sk-h10" />
          ))}
        </div>
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="sk-table-row">
            <div className="sk-circle sk-s24" />
            <div className="sk-bone sk-w120 sk-h10" />
            <div className="sk-bone sk-w60 sk-h10" />
            <div className="sk-bone sk-w60 sk-h10" />
            <div className="sk-bone sk-w60 sk-h10" />
          </div>
        ))}
      </div>
    </div>
  );
}
