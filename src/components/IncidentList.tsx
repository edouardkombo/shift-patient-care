import React from "react";
import type { Incident } from "../types";
import { timeAgo } from "../lib/time";

function labelType(type: Incident["type"]) {
  return type === "FALL" ? "Fall" : "Stillness";
}

function labelSeverity(sev: Incident["severity"]) {
  if (sev === "critical") return { txt: "Urgent", cls: "red" };
  if (sev === "risk") return { txt: "Attention", cls: "amber" };
  return { txt: "Monitor", cls: "blue" };
}

export default function IncidentList({
  incidents,
  selectedId,
  onSelect,
}: {
  incidents: Incident[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="panel" aria-label="Safety alerts">
      <div className="drawerHeader">
        <div className="h">
          <div className="t">Safety inbox</div>
          <div className="m">Unacked first. Tap to open details.</div>
        </div>
      </div>

      <div className="list">
        {incidents.length === 0 ? (
          <div className="drawerBody">
            <div className="mini">No safety alerts right now.</div>
          </div>
        ) : (
          incidents.map((it) => {
            const sev = labelSeverity(it.severity);
            const active = it.id === selectedId;
            const hr = it.hr;
            return (
              <div
                key={it.id}
                className="listItem"
                style={{ background: active ? "rgba(37,99,235,0.06)" : undefined }}
                onClick={() => onSelect(it.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter") onSelect(it.id);
                }}
              >
                <div className="thumb">
                  <img src={it.frames?.peak ?? "data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D'http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg'%20width%3D'320'%20height%3D'200'%3E%3Crect%20width%3D'320'%20height%3D'200'%20fill%3D'%23e9f0fb'%2F%3E%3C%2Fsvg%3E"} alt="Alert thumbnail" />
                </div>
                <div className="liText">
                  <div className="top">
                    <span className={`pillType ${sev.cls}`}>{sev.txt}</span>
                    <span className="pillType blue">{labelType(it.type)}</span>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.cameraName}</span>
                  </div>
                  <div className="bot">
                    {timeAgo(it.createdAt)} · {Math.round(it.confidence * 100)}%
                    {hr ? ` · HR ${hr.start}→${hr.end}` : ""}
                    {it.acked ? " · acked" : " · unacked"}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
