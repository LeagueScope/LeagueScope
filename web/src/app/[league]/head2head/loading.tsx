/* Head2Head skeleton — header + selection grid + comparison table */
import '../loading.css';

export default function Head2HeadLoading() {
  return (
    <div className="sk-wrap">
      {/* Header */}
      <div className="sk-header">
        <div className="sk-circle sk-s32" />
        <div className="sk-bone sk-w200 sk-h14" />
        <div className="sk-spacer" />
        <div className="sk-pill sk-w80" />
        <div className="sk-pill sk-w80" />
      </div>

      {/* Selection grid */}
      <div className="sk-h2h-select">
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="sk-h2h-item">
            <div className="sk-circle sk-s32" />
            <div className="sk-bone sk-w80 sk-h10" />
          </div>
        ))}
      </div>

      {/* Comparison table */}
      <div className="sk-card">
        <div className="sk-card-top">
          <div className="sk-bone sk-w160 sk-h14" />
        </div>
        <div className="sk-card-body">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="sk-h2h-row">
              <div className="sk-bone sk-w80 sk-h10" />
              <div className="sk-bone sk-w60 sk-h14" />
              <div className="sk-bone sk-w60 sk-h10" />
              <div className="sk-bone sk-w60 sk-h14" />
              <div className="sk-bone sk-w80 sk-h10" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
