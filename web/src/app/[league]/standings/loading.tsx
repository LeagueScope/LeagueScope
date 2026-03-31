/* Standings skeleton — header + large table */
import '../loading.css';

export default function StandingsLoading() {
  return (
    <div className="sk-wrap">
      {/* Header */}
      <div className="sk-header">
        <div className="sk-circle sk-s32" />
        <div className="sk-bone sk-w200 sk-h14" />
        <div className="sk-spacer" />
        <div className="sk-pill sk-w80" />
        <div className="sk-bone sk-w60 sk-h28" />
        <div className="sk-bone sk-w60 sk-h28" />
        <div className="sk-bone sk-w60 sk-h28" />
      </div>

      {/* Table */}
      <div className="sk-table">
        <div className="sk-table-head">
          <div className="sk-bone sk-w60 sk-h10" />
          <div className="sk-bone sk-w120 sk-h10" />
          <div className="sk-bone sk-w60 sk-h10" />
          <div className="sk-bone sk-w60 sk-h10" />
          <div className="sk-bone sk-w60 sk-h10" />
          <div className="sk-bone sk-w80 sk-h10" />
          <div className="sk-bone sk-w60 sk-h10" />
          <div className="sk-bone sk-w60 sk-h10" />
        </div>
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="sk-table-row">
            <div className="sk-bone sk-w60 sk-h10" />
            <div className="sk-circle sk-s24" />
            <div className="sk-bone sk-w120 sk-h10" />
            <div className="sk-bone sk-w60 sk-h10" />
            <div className="sk-bone sk-w60 sk-h10" />
            <div className="sk-bone sk-w60 sk-h10" />
            <div className="sk-bone sk-w80 sk-h10" />
            <div className="sk-bone sk-w60 sk-h10" />
            <div className="sk-bone sk-w60 sk-h10" />
          </div>
        ))}
      </div>
    </div>
  );
}
