import React from "react";
import type { Camera, Incident } from "../types";

function dotColor(inc?: Incident): string {
  if (!inc) return "var(--green)";
  if (inc.severity === "watch") return "var(--amber)";
  return "var(--red)";
}

export default function Radar({
  cameras,
  incidentsByCamera,
  onJump,
}: {
  cameras: Camera[];
  incidentsByCamera: Record<string, Incident | undefined>;
  onJump: (cameraId: string) => void;
}) {
  const cols = 5;
  return (
    <div className="panel" style={{ padding: 12 }} aria-label="Risk radar">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <div style={{ fontWeight: 700 }}>Radar</div>
        <div className="mini">Tap dot to jump</div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 10 }}>
        {cameras.map((c) => {
          const inc = incidentsByCamera[c.id];
          const pulse = inc && inc.severity === "critical" && !inc.acked;
          return (
            <button
              key={c.id}
              onClick={() => onJump(c.id)}
              aria-label={`Jump to ${c.name}`}
              style={{
                height: 18,
                borderRadius: 999,
                border: "1px solid rgba(255,255,255,0.12)",
                background: "rgba(255,255,255,0.03)",
                padding: 0,
              }}
              title={inc ? `${c.name} - ${inc.type} (${inc.severity})` : c.name}
            >
              <span
                style={{
                  display: "block",
                  width: "100%",
                  height: "100%",
                  borderRadius: 999,
                  background: dotColor(inc),
                  opacity: inc ? 0.95 : 0.30,
                  animation: pulse ? "pulse 1.4s ease-in-out infinite" : undefined,
                }}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}
