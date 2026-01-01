import React, { useEffect, useMemo, useState } from "react";
import type { Camera, Incident, Severity } from "./types";
import { CAMERAS, WEBCAM_CAMERA } from "./mock/streams";
import { newIncident } from "./mock/incidents";
import { severityRank } from "./lib/severity";

import VideoTile from "./components/VideoTile";
import IncidentDrawer from "./components/IncidentDrawer";
import IncidentList from "./components/IncidentList";
import FocusModal from "./components/FocusModal";

import type { StreamHealth } from "./lib/videoProbe";
import type { SceneProbeResult } from "./lib/sceneProbe";

type MobileTab = "monitor" | "alerts";

function globalSafetyState(incidents: Incident[]): Severity {
  return incidents.reduce<Severity>((acc, it) => {
    if (severityRank(it.severity) > severityRank(acc)) return it.severity;
    return acc;
  }, "none");
}

function countBySeverity(incidents: Incident[]) {
  let watch = 0,
    risk = 0,
    critical = 0;
  for (const i of incidents) {
    if (i.severity === "watch") watch++;
    else if (i.severity === "risk") risk++;
    else if (i.severity === "critical") critical++;
  }
  return { watch, risk, critical };
}

function sortInbox(incidents: Incident[]): Incident[] {
  return [...incidents].sort((a, b) => {
    if (a.acked !== b.acked) return a.acked ? 1 : -1;
    const sr = severityRank(b.severity) - severityRank(a.severity);
    if (sr !== 0) return sr;
    return b.createdAt - a.createdAt;
  });
}

function pickDefaultIncident(incidents: Incident[]): string | null {
  return incidents.length ? incidents[0]!.id : null;
}

function useIsMobile(breakpoint = 980) {
  const [isMobile, setIsMobile] = useState<boolean>(() => window.innerWidth <= breakpoint);
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth <= breakpoint);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [breakpoint]);
  return isMobile;
}

function pillDot(sev: Severity) {
  if (sev === "critical") return "red";
  if (sev === "risk") return "amber";
  if (sev === "watch") return "blue";
  return "green";
}

function severityName(sev: Severity) {
  if (sev === "critical") return "Urgent";
  if (sev === "risk") return "Attention";
  if (sev === "watch") return "Monitor";
  return "Calm";
}

export default function App() {
  const isMobile = useIsMobile(980);

  const [cameras] = useState<Camera[]>(() => [WEBCAM_CAMERA, ...CAMERAS]);

  // Safety incidents only. Stream health is tracked separately.
  const [incidents, setIncidents] = useState<Incident[]>(() => []);
  const incidentsSorted = useMemo(() => sortInbox(incidents), [incidents]);

  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(() => pickDefaultIncident(incidentsSorted));
  const [mobileTab, setMobileTab] = useState<MobileTab>("monitor");

  // Webcam
  const [webcamStream, setWebcamStream] = useState<MediaStream | null>(null);
  const webcamEnabled = !!webcamStream;

  // Tile probes for glanceable headers
  const [healthByCam, setHealthByCam] = useState<Record<string, StreamHealth>>({});
  const [sceneByCam, setSceneByCam] = useState<Record<string, SceneProbeResult>>({});

  // Focus (tap any tile)
  const [focusedCameraId, setFocusedCameraId] = useState<string | null>(null);

  useEffect(() => {
    // keep selection valid
    if (selectedIncidentId && incidents.some((i: Incident) => i.id === selectedIncidentId)) return;
    setSelectedIncidentId(pickDefaultIncident(incidentsSorted));
  }, [incidents, incidentsSorted, selectedIncidentId]);

  const selectedIncident = useMemo(
    () => incidents.find((i: Incident) => i.id === selectedIncidentId) ?? null,
    [incidents, selectedIncidentId]
  );

  const incidentsByCamera = useMemo(() => {
    const map: Record<string, Incident | undefined> = {};
    for (const i of incidentsSorted) {
      const existing = map[i.cameraId];
      if (!existing || severityRank(i.severity) > severityRank(existing.severity)) {
        map[i.cameraId] = i;
      }
    }
    return map;
  }, [incidentsSorted]);

  const safetyCounts = useMemo(() => countBySeverity(incidents), [incidents]);
  const safetyState = useMemo(() => globalSafetyState(incidents), [incidents]);

  const healthCounts = useMemo(() => {
    let buffering = 0,
      frozen = 0,
      black = 0,
      error = 0;
    const values = Object.values(healthByCam) as StreamHealth[];
    for (const h of values) {
      if (h.state === "buffering") buffering++;
      else if (h.state === "frozen") frozen++;
      else if (h.state === "black") black++;
      else if (h.state === "error") error++;
    }
    return { buffering, frozen, black, error };
  }, [healthByCam]);

  const sceneCounts = useMemo(() => {
    let empty = 0,
      crowd = 0;
    const values = Object.values(sceneByCam) as SceneProbeResult[];
    for (const s of values) {
      if (s.peopleBand === "none") empty++;
      if (s.peopleBand === "crowd") crowd++;
    }
    return { empty, crowd };
  }, [sceneByCam]);

  async function toggleWebcam() {
    if (webcamStream) {
      webcamStream.getTracks().forEach((t: MediaStreamTrack) => t.stop());
      setWebcamStream(null);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      setWebcamStream(stream);
    } catch {
      // silently ignore (permissions)
    }
  }

  function openIncident(id: string) {
    setSelectedIncidentId(id);
    if (isMobile) setMobileTab("alerts");
  }

  function openCamera(cameraId: string) {
    setFocusedCameraId(cameraId);
    const inc = incidentsByCamera[cameraId];
    if (inc) setSelectedIncidentId(inc.id);
  }

  function ack(id: string) {
    setIncidents((prev: Incident[]) => prev.map((p: Incident) => (p.id === id ? { ...p, acked: true } : p)));
  }

  function resolve(id: string) {
    setIncidents((prev: Incident[]) => prev.filter((p: Incident) => p.id !== id));
  }

  function upsertIncident(next: Incident) {
    setIncidents((prev: Incident[]) => {
      const idx = prev.findIndex((p: Incident) => p.cameraId === next.cameraId && p.type === next.type);
      if (idx >= 0) {
        const copy = [...prev];
        const existing = copy[idx]!;
        copy[idx] = {
          ...existing,
          ...next,
          // keep the highest severity if something re-triggers
          severity: severityRank(next.severity) > severityRank(existing.severity) ? next.severity : existing.severity,
          acked: false,
          createdAt: Date.now(),
        };
        return copy;
      }
      return [next, ...prev];
    });
  }

  const focusedCamera = useMemo(
    () => cameras.find((c: Camera) => c.id === focusedCameraId) ?? null,
    [cameras, focusedCameraId]
  );
  const focusedIncident = useMemo(() => {
    if (!focusedCamera) return null;
    return incidentsByCamera[focusedCamera.id] ?? null;
  }, [focusedCamera, incidentsByCamera]);

  const focusedHealth = focusedCamera ? healthByCam[focusedCamera.id] ?? null : null;
  const focusedScene = focusedCamera ? sceneByCam[focusedCamera.id] ?? null : null;

  const unackedCount = incidentsSorted.filter((i: Incident) => !i.acked).length;

  return (
    <div className="app">
      <div className="topbar">
        <div className="brand">
          <span className="dot" />
          Shift Patient Care
        </div>

        <div className="pill">
          <span className={`s ${pillDot(safetyState)}`} />
          Safety: {severityName(safetyState)}
          <span className="muted">({safetyCounts.watch + safetyCounts.risk + safetyCounts.critical})</span>
        </div>

        <div className="pill">
          <span className={`s ${healthCounts.error || healthCounts.black || healthCounts.frozen ? "red" : healthCounts.buffering ? "amber" : "green"}`} />
          Cameras: {healthCounts.error + healthCounts.black + healthCounts.frozen + healthCounts.buffering ? "issues" : "ok"}
          <span className="muted">
            (buf {healthCounts.buffering}, frz {healthCounts.frozen}, blk {healthCounts.black}, err {healthCounts.error})
          </span>
        </div>

        <div className="pill">
          <span className={`s ${sceneCounts.empty || sceneCounts.crowd ? "blue" : "green"}`} />
          Scene:
          <span className="muted">empty {sceneCounts.empty}, crowd {sceneCounts.crowd}</span>
        </div>

        <div className="spacer" />

        {isMobile ? (
          <button className="primary" onClick={() => setMobileTab((t: MobileTab) => (t === "monitor" ? "alerts" : "monitor"))}>
            Alerts {unackedCount ? `(${unackedCount})` : ""}
          </button>
        ) : null}
      </div>

      <div className="main">
        <div className="panel">
          <div className="wallHeader">
            <div>
              <div className="title">Patient wall</div>
              <div className="sub">Tap any feed to focus. Safety is separate from camera health.</div>
            </div>

            <div className="legend">
              <span className="pillTag red">Urgent</span>
              <span className="pillTag amber">Attention</span>
              <span className="pillTag blue">Monitor</span>
              <span className="pillTag">Health: buffering/frozen/black</span>
            </div>
          </div>

          <div className="wall">
            <div className="grid">
              {cameras.map((cam: Camera) => (
                <VideoTile
                  key={cam.id}
                  camera={cam}
                  incident={incidentsByCamera[cam.id]}
                  onOpen={() => openCamera(cam.id)}
                  isWebcam={cam.id === WEBCAM_CAMERA.id}
                  onEnableWebcam={toggleWebcam}
                  webcamEnabled={webcamEnabled}
                  webcamStream={webcamStream}
                  onStatus={(cameraId, status) => {
                    if (status.health) {
                      setHealthByCam((prev: Record<string, StreamHealth>) => {
                        const existing = prev[cameraId];
                        if (existing && existing.state === status.health!.state) return prev;
                        return { ...prev, [cameraId]: status.health! };
                      });
                    }
                    if (status.scene) {
                      setSceneByCam((prev: Record<string, SceneProbeResult>) => {
                        const existing = prev[cameraId];
                        if (existing && existing.peopleBand === status.scene!.peopleBand) return prev;
                        return { ...prev, [cameraId]: status.scene! };
                      });
                    }
                  }}
                  onAutoIncident={(payload) => {
                    const camera = payload.camera;

                    const existing = incidents.find(
                      (i: Incident) => i.cameraId === camera.id && i.type === payload.type
                    );

                    if (existing) {
                      upsertIncident({
                        ...existing,
                        severity: payload.severity,
                        confidence: payload.confidence,
                        reasons: payload.reasons,
                        eventTimeSec: payload.eventTimeSec,
                      });
                      return;
                    }

                    const created = newIncident(camera, payload.type, payload.severity);
                    upsertIncident({
                      ...created,
                      confidence: payload.confidence,
                      reasons: payload.reasons,
                      eventTimeSec: payload.eventTimeSec,
                    });
                  }}
                />
              ))}
            </div>
          </div>
        </div>

        {!isMobile ? (
          <div className="panel">
            <div className="wallHeader">
              <div>
                <div className="title">Safety inbox</div>
                <div className="sub">Only patient safety alerts. Camera health is handled on the wall.</div>
              </div>
            </div>
            <IncidentList incidents={incidentsSorted} selectedId={selectedIncidentId} onSelect={openIncident} />

            <IncidentDrawer
              incident={selectedIncident}
              onAck={ack}
              onResolve={resolve}
            />
          </div>
        ) : mobileTab === "alerts" ? (
          <div className="panel">
            <div className="wallHeader">
              <div>
                <div className="title">Safety inbox</div>
                <div className="sub">Tap an alert, then open the related feed.</div>
              </div>
            </div>
            <IncidentList incidents={incidentsSorted} selectedId={selectedIncidentId} onSelect={openIncident} />
            <IncidentDrawer incident={selectedIncident} onAck={ack} onResolve={resolve} />
          </div>
        ) : null}

        {focusedCamera ? (
          <FocusModal
            camera={focusedCamera}
            incident={focusedIncident}
            health={focusedHealth}
            scene={focusedScene}
            webcamStream={focusedCamera.id === WEBCAM_CAMERA.id ? webcamStream : null}
            onClose={() => setFocusedCameraId(null)}
            onAck={ack}
            onResolve={resolve}
          />
        ) : null}
      </div>
    </div>
  );
}
