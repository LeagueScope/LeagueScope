'use client';

import { useState } from 'react';

const PG_DRAGON_COLORS: Record<string, string> = {
  cloud: '#a9dfff',
  ocean: '#46afa0',
  mountain: '#86694d',
  infernal: '#ff8642',
  hextech: '#4283a6',
  chemtech: '#7dd327',
  elder: '#dbc5ff',
};

interface DragonChartProps {
  dragons: Record<string, number>;
  totalDragons: number;
}

export default function DragonChart({ dragons, totalDragons }: DragonChartProps) {
  const [hoveredDragon, setHoveredDragon] = useState<{
    type: string;
    count: number;
    percent: number;
  } | null>(null);

  return (
    <div className="p2-dragons-chart-centered">
      <svg className="p2-dragons-donut" viewBox="0 0 100 100">
        {(() => {
          let offset = 0;
          const circumference = 2 * Math.PI * 40;
          return Object.entries(dragons).map(([type, count]) => {
            const percent = totalDragons > 0 ? count / totalDragons : 0;
            const dash = percent * circumference;
            const circle = (
              <circle
                key={type}
                cx="50"
                cy="50"
                r="40"
                fill="none"
                stroke={PG_DRAGON_COLORS[type] || '#666'}
                strokeWidth="12"
                strokeDasharray={`${dash} ${circumference}`}
                strokeDashoffset={-offset}
                transform="rotate(-90 50 50)"
                style={{ cursor: 'pointer', transition: 'stroke-width 0.2s' }}
                onMouseEnter={() => setHoveredDragon({ type, count, percent })}
                onMouseLeave={() => setHoveredDragon(null)}
              />
            );
            offset += dash;
            return circle;
          });
        })()}
        <circle cx="50" cy="50" r="28" fill="#12141c" pointerEvents="none" />
        {hoveredDragon ? (
          <>
            <text x="50" y="43" textAnchor="middle" fill={PG_DRAGON_COLORS[hoveredDragon.type] || '#fff'} fontSize="8" fontWeight="800" style={{ textTransform: 'uppercase' }}>{hoveredDragon.type}</text>
            <text x="50" y="53" textAnchor="middle" fill="white" fontSize="11" fontWeight="700">{hoveredDragon.count}</text>
            <text x="50" y="61" textAnchor="middle" fill="rgba(255,255,255,0.5)" fontSize="5.5">{(hoveredDragon.percent * 100).toFixed(1)}%</text>
          </>
        ) : (
          <>
            <text x="50" y="47" textAnchor="middle" fill="white" fontSize="11" fontWeight="700">{totalDragons}</text>
            <text x="50" y="57" textAnchor="middle" fill="rgba(255,255,255,0.5)" fontSize="6">TOTAL</text>
          </>
        )}
      </svg>
    </div>
  );
}
