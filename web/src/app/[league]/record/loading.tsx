/* Record skeleton — sidebar + match cards */
import '../loading.css';

export default function RecordLoading() {
  return (
    <div className="sk-wrap">
      {/* Header */}
      <div className="sk-header">
        <div className="sk-circle sk-s32" />
        <div className="sk-bone sk-w200 sk-h14" />
        <div className="sk-spacer" />
        <div className="sk-bone sk-w80 sk-h28" />
      </div>

      <div className="sk-record-layout">
        {/* Sidebar — team list */}
        <div className="sk-sidebar">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="sk-sidebar-item">
              <div className="sk-circle sk-s24" />
              <div className="sk-bone sk-w80 sk-h10" />
              <div className="sk-bone sk-w60 sk-h10" />
            </div>
          ))}
        </div>

        {/* Main — match cards */}
        <div className="sk-record-main">
          <div className="sk-bone sk-w200 sk-h14" />
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="sk-match-card">
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
