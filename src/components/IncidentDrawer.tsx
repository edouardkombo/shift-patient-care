import React from "react";
import type { Incident } from "../types";
import { timeAgo } from "../lib/time";
import Sparkline from "./Sparkline";

function typePill(type: Incident["type"], severity: Incident["severity"]) {
  const cls = severity === "watch" ? "blue" : severity === "risk" ? "amber" : "red";
  const label = type === "FALL" ? "Fall" : "Stillness";
  return <span className={`pillType ${cls}`}>{label}</span>;
}

export default function IncidentDrawer({
  incident,
  onAck,
  onResolve,
  onClose,
  isOverlay,
}: {
  incident: Incident | null;
  onAck: (id: string) => void;
  onResolve: (id: string) => void;
  onClose?: () => void;
  isOverlay?: boolean;
}) {
  if (!incident) {
    return (
      <div className="panel">
        <div className="drawerHeader">
          <div className="h">
            <div className="t">Patient alert</div>
            <div className="m">Select an alert from the inbox.</div>
          </div>
        </div>
        <div className="drawerBody">
          <div className="mini">
            This drawer shows details only for patient safety alerts. Camera buffering or frozen feeds are tracked as health, not as patient alerts.
          </div>
        </div>
      </div>
    );
  }

  const conf = Math.round((incident.confidence ?? 0) * 100);
  const frames = incident.frames;
  const hr = incident.hr;
  const hrDelta = hr ? hr.end - hr.start : null;
  const sign = hrDelta != null && hrDelta >= 0 ? "+" : "";

  return (
    <div className="panel" aria-label="Patient alert details">
      <div className="drawerHeader">
        <div className="h">
          <div className="t">
            {typePill(incident.type, incident.severity)} {incident.cameraName}
          </div>
          <div className="m">
            {timeAgo(incident.createdAt)} · confidence {conf}% · {incident.acked ? "acked" : "unacked"}
          </div>
        </div>
        <div className="actions">
          {isOverlay ? <button onClick={onClose}>Close</button> : null}
          <button className="primary" onClick={() => onAck(incident.id)} disabled={incident.acked}>
            Ack
          </button>
          <button className="danger" onClick={() => onResolve(incident.id)}>
            Resolve
          </button>
        </div>
      </div>

      <div className="drawerBody">
        <div>
          <div className="sectionTitle">Why this triggered</div>
          <div className="chips">
            {(incident.reasons?.length ? incident.reasons : ["Safety policy triggered"]).slice(0, 6).map((r, idx) => (
              <span className="chip" key={idx}>
                {r}
              </span>
            ))}
          </div>
          {incident.eventTimeSec != null ? <div className="mini" style={{ marginTop: 6 }}>Event time: ~{Math.round(incident.eventTimeSec)}s into the clip</div> : null}
        </div>

        <div>
          <div className="sectionTitle">Evidence</div>
          {frames ? (
            <div className="frames">
              <div className="frame">
                <img src={frames.before} alt="Before frame" />
                <div className="cap">Before</div>
              </div>
              <div className="frame">
                <img src={frames.peak} alt="Peak frame" />
                <div className="cap">Peak</div>
              </div>
              <div className="frame">
                <img src={frames.after} alt="After frame" />
                <div className="cap">After</div>
              </div>
            </div>
          ) : (
            <div className="mini">No evidence frames yet.</div>
          )}
        </div>

        {hr ? (
          <div>
            <div className="sectionTitle">Relevant vitals</div>
            <div className="hrRow">
              <div className="nums">
                HR: {hr.start} → {hr.end} ({sign}{hrDelta})
                <div className="mini">peak {hr.peak}</div>
              </div>
              <Sparkline series={hr.series} />
            </div>
          </div>
        ) : (
          <div>
            <div className="sectionTitle">Relevant vitals</div>
            <div className="mini">No vitals wired in this demo for this alert.</div>
          </div>
        )}
      </div>
    </div>
  );
}
