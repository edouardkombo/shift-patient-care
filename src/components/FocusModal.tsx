import React, { useEffect, useMemo, useRef, useState } from "react";
import type { Camera, Incident } from "../types";
import type { StreamHealth } from "../lib/videoProbe";
import type { SceneProbeResult } from "../lib/sceneProbe";
import { timeAgo } from "../lib/time";
import { makeFrame } from "../lib/placeholders";
import Sparkline from "./Sparkline";

function safetyName(type: Incident["type"]) {
  return type === "FALL" ? "Fall" : "Stillness";
}

function severityName(sev: Incident["severity"]) {
  if (sev === "critical") return "Urgent";
  if (sev === "risk") return "Attention";
  return "Monitor";
}

function fmtTime(sec: number) {
  const s = Math.max(0, Math.floor(sec));
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${mm}:${String(ss).padStart(2, "0")}`;
}

function canReadPixelsForUrl(url?: string) {
  if (!url) return false;
  if (url.startsWith("/")) return true;
  try {
    return new URL(url, window.location.href).origin === window.location.origin;
  } catch {
    return false;
  }
}

function scenePill(scene: SceneProbeResult | null) {
  if (!scene) return { label: "Scene: unknown", motion: null };
  if (!scene.pixelsOk) return { label: "Scene: pixels blocked (CORS)", motion: null };
  if (scene.peopleBand === "none") return { label: "Scene: 0 people", motion: scene.motion };
  if (scene.peopleBand === "crowd") return { label: "Scene: 4+ people", motion: scene.motion };
  if (scene.peopleBand === "few") return { label: "Scene: 1-3 people", motion: scene.motion };
  return { label: "Scene: unknown", motion: scene.motion };
}

export default function FocusModal({
  camera,
  incident,
  health,
  scene,
  webcamStream,
  onClose,
  onAck,
  onResolve,
}: {
  camera: Camera;
  incident: Incident | null;
  health: StreamHealth | null;
  scene: SceneProbeResult | null;
  webcamStream: MediaStream | null;
  onClose: () => void;
  onAck: (id: string) => void;
  onResolve: (id: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [loopReplay, setLoopReplay] = useState(false);

  const canSeek = useMemo(() => {
    if (!incident?.eventTimeSec) return false;
    // live streams usually have Infinity duration
    const v = videoRef.current;
    if (!v) return false;
    return Number.isFinite(v.duration) && v.duration > 0;
  }, [incident?.eventTimeSec]);

  const replayWindow = useMemo(() => {
    if (!incident?.eventTimeSec) return null;
    const t = incident.eventTimeSec;
    return { start: Math.max(0, t - 6), end: t + 4, t };
  }, [incident?.eventTimeSec]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;

    // Seed srcObject for webcam if needed
    if (webcamStream) {
      if (v.srcObject !== webcamStream) v.srcObject = webcamStream;
    }
  }, [webcamStream]);

  useEffect(() => {
    if (!loopReplay) return;
    const v = videoRef.current;
    if (!v) return;
    if (!replayWindow) return;

    let alive = true;
    const start = replayWindow.start;
    const end = replayWindow.end;

    const kick = async () => {
      try {
        v.currentTime = start;
        await v.play();
      } catch {
        // ignore autoplay errors
      }
    };

    void kick();

    const t = window.setInterval(() => {
      if (!alive) return;
      if (!Number.isFinite(v.currentTime)) return;
      if (v.currentTime >= end - 0.15) {
        try {
          v.currentTime = start;
        } catch {
          // ignore
        }
      }
    }, 250);

    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, [loopReplay, replayWindow]);

  const frames = useMemo(() => {
    if (incident?.frames) return incident.frames;
    if (!incident) return null;
    return {
      before: makeFrame("BEFORE", incident.type, camera.name),
      peak: makeFrame("PEAK", incident.type, camera.name),
      after: makeFrame("AFTER", incident.type, camera.name),
    };
  }, [incident, camera.name]);

  const hr = incident?.hr;
  const hrDelta = hr ? hr.end - hr.start : null;
  const hrSign = hrDelta != null && hrDelta >= 0 ? "+" : "";

  const healthState = health?.state ?? "ok";
  const sceneInfo = scenePill(scene);

  return (
    <div className="focusOverlay" role="dialog" aria-modal="true">
      <div className="focusCard">
        <div className="focusTop">
          <div className="focusTitle">
            <div className="focusName">{camera.name}</div>
            <div className="focusMeta">
              {incident ? (
                <>
                  <span className={`pillTag ${incident.severity === "critical" ? "red" : incident.severity === "risk" ? "amber" : "blue"}`}>
                    {severityName(incident.severity)}: {safetyName(incident.type)}
                  </span>
                  <span className="muted">{timeAgo(incident.createdAt)} · {Math.round(incident.confidence * 100)}%</span>
                </>
              ) : (
                <span className="muted">No active safety alert</span>
              )}
            </div>
          </div>

          <div className="focusActions">
            <button onClick={onClose}>Close</button>
            {incident ? (
              <>
                <button className="primary" onClick={() => onAck(incident.id)} disabled={incident.acked}>
                  Ack
                </button>
                <button className="danger" onClick={() => onResolve(incident.id)}>
                  Resolve
                </button>
              </>
            ) : null}
          </div>
        </div>

        <div className="focusBody">
          <div className="focusVideo">
            {webcamStream ? (
              <video ref={videoRef} autoPlay muted playsInline className="focusVideoEl" />
            ) : camera.streamUrl ? (
              <video
                ref={videoRef}
                src={camera.streamUrl}
                autoPlay
                muted
                playsInline
                loop
                className="focusVideoEl"
                crossOrigin={canReadPixelsForUrl(camera.streamUrl) ? "anonymous" : undefined}
              />
            ) : (
              <div className="noStream" style={{ position: "relative" }}>
                No stream URL set
              </div>
            )}

            <div className="focusBadges" aria-hidden>
              {healthState !== "ok" ? (
                <span className={`pillTag ${healthState === "buffering" ? "amber" : "red"}`}>Health: {healthState}</span>
              ) : (
                <span className="pillTag blue">Health: ok</span>
              )}
              {sceneInfo ? (
                <span className="pillTag blue">{sceneInfo.label}{sceneInfo.motion != null ? ` · motion ${sceneInfo.motion.toFixed(2)}` : ""}</span>
              ) : null}
              {incident?.eventTimeSec != null ? (
                <span className="pillTag blue">Event @ {fmtTime(incident.eventTimeSec)}</span>
              ) : null}
            </div>
          </div>

          <div className="focusInfo">
            <div className="section">
              <div className="sectionTitle">Quick actions</div>
              <div className="mini">
                Tap a tile to focus. Red is patient urgent. Amber is attention. Blue tags are camera health or scene context.
              </div>

              {incident?.eventTimeSec != null ? (
                <div className="row" style={{ marginTop: 10 }}>
                  <button
                    onClick={() => {
                      const v = videoRef.current;
                      if (!v) return;
                      try {
                        v.currentTime = Math.max(0, (incident.eventTimeSec ?? 0) - 2);
                        void v.play();
                      } catch {
                        // ignore
                      }
                    }}
                  >
                    Jump to event
                  </button>
                  <button className={loopReplay ? "primary" : ""} onClick={() => setLoopReplay((x) => !x)} disabled={!canSeek && !loopReplay}>
                    {loopReplay ? "Stop replay loop" : "Loop 10s"}
                  </button>
                  {!canSeek && incident.eventTimeSec != null ? (
                    <span className="mini">Replay loop requires a seekable source (local clip or file).</span>
                  ) : null}
                </div>
              ) : null}
            </div>

            {incident ? (
              <>
                <div className="section">
                  <div className="sectionTitle">Why this triggered</div>
                  <div className="chips">
                    {(incident.reasons?.length ? incident.reasons : ["Safety policy triggered"])
                      .slice(0, 6)
                      .map((r, idx) => (
                        <span key={idx} className="chip">
                          {r}
                        </span>
                      ))}
                  </div>
                </div>

                {frames ? (
                  <div className="section">
                    <div className="sectionTitle">Evidence frames</div>
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
                  </div>
                ) : null}

                {hr ? (
                  <div className="section">
                    <div className="sectionTitle">Relevant vitals</div>
                    <div className="hrRow">
                      <div className="nums">
                        HR: {hr.start} → {hr.end} ({hrSign}{hrDelta})
                        <div className="mini">peak {hr.peak}</div>
                      </div>
                      <Sparkline series={hr.series} />
                    </div>
                  </div>
                ) : null}
              </>
            ) : (
              <div className="section">
                <div className="sectionTitle">Camera health</div>
                <div className="mini">
                  Health issues do not count as patient alerts. They are still important because blind cameras create risk.
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
