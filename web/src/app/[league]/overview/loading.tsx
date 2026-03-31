/* Overview skeleton — cards grid layout */
import '../loading.css';

export default function OverviewLoading() {
  return (
    <div className="sk-wrap">
      {/* Header */}
      <div className="sk-header">
        <div className="sk-circle sk-s32" />
        <div className="sk-bone sk-w200 sk-h14" />
        <div className="sk-spacer" />
        <div className="sk-bone sk-w80 sk-h28" />
        <div className="sk-bone sk-w80 sk-h28" />
      </div>

      {/* Cards grid — 6 stat cards */}
      <div className="sk-grid">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="sk-card">
            <div className="sk-card-top">
              <div className="sk-bone sk-w160 sk-h14" />
            </div>
            <div className="sk-card-body">
              <div className="sk-bone sk-full sk-h10" />
              <div className="sk-bone sk-full sk-h10" />
              <div className="sk-bone sk-w200 sk-h10" />
              <div className="sk-bone sk-w160 sk-h10" />
              <div className="sk-bone sk-full sk-h10" />
              <div className="sk-bone sk-w120 sk-h10" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
