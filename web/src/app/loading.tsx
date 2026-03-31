/* Root loading skeleton for the home page */
import './[league]/loading.css';

export default function HomeLoading() {
  return (
    <div className="sk-wrap">
      {/* Hero section */}
      <div className="sk-card" style={{ padding: '40px 24px', alignItems: 'center' }}>
        <div className="sk-circle sk-s32" />
        <div className="sk-bone sk-w200 sk-h14" />
        <div className="sk-bone sk-w160 sk-h10" />
      </div>

      {/* League cards grid */}
      <div className="sk-grid">
        {Array.from({ length: 9 }).map((_, i) => (
          <div key={i} className="sk-card">
            <div className="sk-card-top">
              <div className="sk-circle sk-s32" />
              <div className="sk-bone sk-w120 sk-h14" />
            </div>
            <div className="sk-card-body">
              <div className="sk-bone sk-full sk-h10" />
              <div className="sk-bone sk-w200 sk-h10" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
