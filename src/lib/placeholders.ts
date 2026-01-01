import type { IncidentType } from "../types";

function svgDataUrl(svg: string): string {
  const encoded = encodeURIComponent(svg).replace(/'/g, "%27").replace(/"/g, "%22");
  return `data:image/svg+xml;charset=utf-8,${encoded}`;
}

export function makeFrame(label: "BEFORE" | "PEAK" | "AFTER", type: IncidentType, cameraName: string): string {
  const bg = label === "PEAK" ? "#1a0b0b" : "#0b1017";
  const accent = type === "FALL" ? "#ff4d4f" : "#f6c343";
  const t = type === "FALL" ? "FALL" : "INACTIVITY";
  const svg = `
  <svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="${bg}" />
        <stop offset="1" stop-color="#05080c" />
      </linearGradient>
      <filter id="n" x="-20%" y="-20%" width="140%" height="140%">
        <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch"/>
        <feColorMatrix type="matrix" values="0 0 0 0 0.10  0 0 0 0 0.12  0 0 0 0 0.16  0 0 0 0.45 0"/>
      </filter>
    </defs>
    <rect width="640" height="360" fill="url(#g)"/>
    <rect width="640" height="360" filter="url(#n)" opacity="0.55"/>
    <circle cx="560" cy="80" r="64" fill="${accent}" opacity="0.10"/>
    <circle cx="560" cy="80" r="36" fill="${accent}" opacity="0.16"/>
    <text x="24" y="46" fill="#e6eef8" font-size="22" font-family="ui-sans-serif,system-ui" font-weight="700">${cameraName}</text>
    <text x="24" y="78" fill="#9bb0c6" font-size="16" font-family="ui-sans-serif,system-ui">Incident evidence frame</text>
    <text x="24" y="152" fill="${accent}" font-size="44" font-family="ui-sans-serif,system-ui" font-weight="800">${t}</text>
    <text x="24" y="206" fill="#e6eef8" font-size="26" font-family="ui-sans-serif,system-ui" font-weight="750">${label}</text>
    <text x="24" y="246" fill="#9bb0c6" font-size="14" font-family="ui-sans-serif,system-ui">Replace with captured frames when streams are wired</text>
  </svg>`;
  return svgDataUrl(svg);
}
