/* Players skeleton — header with role filters + table */
import '../loading.css';

export default function PlayersLoading() {
  return (
    <div className="sk-wrap">
      {/* Header with role filter pills */}
      <div className="sk-header">
        <div className="sk-circle sk-s32" />
        <div className="sk-bone sk-w160 sk-h14" />
        <div className="sk-spacer" />
        <div className="sk-pill sk-w60" />
        <div className="sk-pill sk-w60" />
        <div className="sk-pill sk-w60" />
        <div className="sk-pill sk-w60" />
        <div className="sk-pill sk-w60" />
        <div className="sk-pill sk-w60" />
      </div>

      {/* Table */}
      <div className="sk-table">
        <div className="sk-table-head">
          <div className="sk-bone sk-w60 sk-h10" />
          <div className="sk-bone sk-w60 sk-h10" />
          <div className="sk-bone sk-w120 sk-h10" />
          <div className="sk-bone sk-w60 sk-h10" />
          <div className="sk-bone sk-w60 sk-h10" />
          <div className="sk-bone sk-w60 sk-h10" />
          <div className="sk-bone sk-w80 sk-h10" />
        </div>
        {Array.from({ length: 12 }).map((_, i) => (
          <div key={i} className="sk-table-row">
            <div className="sk-bone sk-w60 sk-h10" />
            <div className="sk-circle sk-s24" />
            <div className="sk-circle sk-s24" />
            <div className="sk-bone sk-w120 sk-h10" />
            <div className="sk-bone sk-w60 sk-h10" />
            <div className="sk-bone sk-w60 sk-h10" />
            <div className="sk-bone sk-w60 sk-h10" />
            <div className="sk-bone sk-w80 sk-h10" />
          </div>
        ))}
      </div>
    </div>
  );
}
