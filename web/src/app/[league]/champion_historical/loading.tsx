/* Champion historical skeleton — profile card + collapsible sections */
import '../loading.css';

export default function ChampionHistoricalLoading() {
  return (
    <div className="sk-wrap">
      {/* Champion header */}
      <div className="sk-profile-header">
        <div className="sk-circle sk-s64" />
        <div className="sk-profile-info">
          <div className="sk-bone sk-w200 sk-h14" />
          <div className="sk-bone sk-w120 sk-h10" />
          <div className="sk-bone sk-w160 sk-h10" />
        </div>
        <div className="sk-spacer" />
        <div className="sk-bone sk-w80 sk-h28" />
      </div>

      {/* Collapsible sections */}
      {['sk-w160', 'sk-w120', 'sk-w160', 'sk-w120'].map((w, i) => (
        <div key={i} className="sk-section">
          <div className="sk-section-head">
            <div className={`sk-bone ${w} sk-h14`} />
            <div className="sk-spacer" />
            <div className="sk-bone sk-w60 sk-h10" />
          </div>
          {i === 0 && (
            <div className="sk-section-body">
              <div className="sk-grid">
                {Array.from({ length: 3 }).map((_, j) => (
                  <div key={j} className="sk-card">
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
            </div>
          )}
          {i === 1 && (
            <div className="sk-section-body">
              <div className="sk-bone sk-full sk-h120" />
            </div>
          )}
          {i === 2 && (
            <div className="sk-section-body">
              <div className="sk-table">
                <div className="sk-table-head">
                  <div className="sk-bone sk-w60 sk-h10" />
                  <div className="sk-bone sk-w120 sk-h10" />
                  <div className="sk-bone sk-w60 sk-h10" />
                  <div className="sk-bone sk-w80 sk-h10" />
                </div>
                {Array.from({ length: 6 }).map((_, j) => (
                  <div key={j} className="sk-table-row">
                    <div className="sk-bone sk-w60 sk-h10" />
                    <div className="sk-circle sk-s24" />
                    <div className="sk-bone sk-w120 sk-h10" />
                    <div className="sk-bone sk-w80 sk-h10" />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
