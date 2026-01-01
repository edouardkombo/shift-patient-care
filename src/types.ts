export type Severity = "none" | "watch" | "risk" | "critical";

export type IncidentType = "FALL" | "INACTIVITY";

export type Camera = {
  id: string;
  name: string;
  streamUrl?: string;
};

/**
 * Patient safety incidents only.
 * Stream health (buffering/frozen/black) is tracked separately.
 */
export type Incident = {
  id: string;
  cameraId: string;
  cameraName: string;
  type: IncidentType;
  severity: Exclude<Severity, "none">;
  confidence: number;
  createdAt: number;
  acked: boolean;

  /** best-effort event time for seekable sources (seconds in media timeline) */
  eventTimeSec?: number;

  /** short, nurse-readable reasons (chips) */
  reasons?: string[];

  clipUrl?: string;

  /** evidence frames (optional, may be placeholders) */
  frames?: { before: string; peak: string; after: string };

  /** optional vitals payload */
  hr?: { start: number; peak: number; end: number; series: number[] };
};
