'use client';

import './footer.css';

/* ═══════════════════════════════════════════════════════════════════════════
   Footer — Global site footer
   Port of frontend/src/components/Footer.jsx
   ═══════════════════════════════════════════════════════════════════════════ */

export default function Footer() {
  return (
    <footer className="global-footer">
      <div className="footer-content">
        <div className="footer-right">
          <span>
            Data strictly powered by <strong>PandaScore</strong>
          </span>
        </div>
      </div>
    </footer>
  );
}
