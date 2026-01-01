import React from "react";

export default function Sparkline({ series }: { series: number[] }) {
  const w = 120;
  const h = 32;
  if (!series.length) return null;

  const min = Math.min(...series);
  const max = Math.max(...series);
  const span = Math.max(1e-6, max - min);

  const pts = series.map((v, i) => {
    const x = (i / (series.length - 1)) * w;
    const y = h - ((v - min) / span) * (h - 6) - 3;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");

  return (
    <svg className="spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}
