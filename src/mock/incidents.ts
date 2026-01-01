import type { Incident, IncidentType, Camera } from "../types";
import { makeFrame } from "../lib/placeholders";

function rnd(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function clamp(n: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, n));
}

function makeHrSeries(base: number): { start: number; peak: number; end: number; series: number[] } {
  const len = 18;
  const series: number[] = [];
  let v = base;
  for (let i = 0; i < len; i++) {
    const drift = i < 6 ? rnd(-1, 2) : rnd(-2, 4);
    v = clamp(v + drift, 45, 160);
    series.push(v);
  }
  const start = series[0] ?? base;
  const peak = Math.max(...series);
  const end = series[series.length - 1] ?? base;
  return { start, peak, end, series };
}

export function newIncident(camera: Camera, type: IncidentType, severity: Incident["severity"]): Incident {
  const id = `inc-${Math.random().toString(16).slice(2)}-${Date.now()}`;
  const createdAt = Date.now();
  const confidence = severity === "watch" ? 0.72 : severity === "risk" ? 0.88 : 0.94;

  const frames = {
    before: makeFrame("BEFORE", type, camera.name),
    peak: makeFrame("PEAK", type, camera.name),
    after: makeFrame("AFTER", type, camera.name),
  };

  const hr = makeHrSeries(rnd(70, 95));

  return {
    id,
    cameraId: camera.id,
    cameraName: camera.name,
    type,
    severity,
    confidence,
    createdAt,
    acked: false,
    frames,
    hr,
  };
}
