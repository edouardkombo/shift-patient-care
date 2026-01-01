import React, { useEffect, useMemo, useRef, useState } from "react";
import type { Camera, Incident, Severity } from "../types";
import { severityColor } from "../lib/severity";
import { attachVideoProbe, type StreamHealth, type StreamHealthState } from "../lib/videoProbe";
import type { PeopleBand, SceneProbeResult } from "../lib/sceneProbe";

/** ---------------------------
 *  UI helpers
 *  --------------------------*/
function safetyLabel(incident?: Incident): { emoji: string; label: string } | null {
  if (!incident) return null;
  if (incident.type === "FALL") return { emoji: "🧎", label: "Fall" };
  return { emoji: "🧍", label: "Stillness" };
}

function healthChip(state: StreamHealthState): string {
  if (state === "buffering") return "BUFFER";
  if (state === "frozen") return "FROZEN";
  if (state === "black") return "BLACK";
  if (state === "error") return "ERROR";
  return "";
}

function countChip(count: number): string {
  // keep it compact for a wall
  if (count <= 0) return "0👤";
  if (count === 1) return "1👤";
  if (count === 2) return "2👤";
  if (count === 3) return "3👤";
  return `${count}👥`;
}

function countToBand(count: number): PeopleBand {
  if (count <= 0) return "none";
  if (count <= 3) return "few";
  return "crowd";
}

/** ---------------------------
 *  Stream URL proxying
 *  --------------------------*/
/**
 * Rewrite external Wikimedia URLs to your same-origin Nginx proxy paths.
 * Assumes Nginx exposes:
 * - /wm/wiki/Special:FilePath/<filename>
 * - /wm-upload/<...> (redirect target)
 */
function proxify(url?: string) {
  if (!url) return url;

  const commonsPrefix = "https://commons.wikimedia.org/wiki/Special:FilePath/";
  if (url.startsWith(commonsPrefix)) {
    return "/wm/wiki/Special:FilePath/" + url.slice(commonsPrefix.length);
  }

  const uploadPrefix = "https://upload.wikimedia.org/";
  if (url.startsWith(uploadPrefix)) {
    return "/wm-upload/" + url.slice(uploadPrefix.length);
  }

  return url;
}

function isSameOriginOrRelative(url?: string) {
  if (!url) return false;
  if (url.startsWith("/")) return true;
  try {
    return new URL(url, window.location.href).origin === window.location.origin;
  } catch {
    return false;
  }
}

/** ---------------------------
 *  AI: COCO-SSD (person count)
 *  + Fall heuristic (drop + posture + stillness)
 *  --------------------------*/
type AIFallState = "none" | "risk" | "critical";

type AIState = {
  ready: boolean;
  personCount: number;
  band: PeopleBand;
  fall: { state: AIFallState; confidence: number; reasons: string[] };
  motion: number; // rough 0..1
  ts: number;
};

let cocoModelPromise: Promise<any> | null = null;
let aiBusy = false;

async function getCocoModel() {
  if (cocoModelPromise) return cocoModelPromise;

  cocoModelPromise = (async () => {
    const tf = await import("@tensorflow/tfjs");
    await import("@tensorflow/tfjs-backend-webgl");
    const coco = await import("@tensorflow-models/coco-ssd");

    await tf.setBackend("webgl");
    await tf.ready();

    // lite is fastest for a 20-tile wall
    return coco.load({ base: "lite_mobilenet_v2" });
  })();

  return cocoModelPromise;
}

async function withAiLock<T>(fn: () => Promise<T>): Promise<T | null> {
  if (aiBusy) return null;
  aiBusy = true;
  try {
    return await fn();
  } finally {
    aiBusy = false;
  }
}

function clamp01(x: number) {
  return Math.max(0, Math.min(1, x));
}

type TileStatus = {
  health: StreamHealth;
  scene: SceneProbeResult;
};

export default function VideoTile({
  camera,
  incident,
  onOpen,
  isWebcam,
  onEnableWebcam,
  webcamEnabled,
  webcamStream,
  onStatus,
  onAutoIncident,
}: {
  camera: Camera;
  incident?: Incident;
  onOpen: () => void;
  isWebcam?: boolean;
  onEnableWebcam?: () => void;
  webcamEnabled?: boolean;
  webcamStream?: MediaStream | null;
  /** reports stream health + scene probes to parent for header counts */
  onStatus?: (cameraId: string, status: TileStatus) => void;
  /** optional hook to report detected safety incidents */
  onAutoIncident?: (payload: {
    camera: Camera;
    type: "FALL" | "INACTIVITY";
    severity: "watch" | "risk" | "critical";
    confidence: number;
    eventTimeSec?: number;
    reasons: string[];
  }) => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // IMPORTANT: build the actual video src first (after proxy rewrite)
  const src = useMemo(() => {
    if (isWebcam) return undefined;
    return proxify(camera.streamUrl);
  }, [isWebcam, camera.streamUrl]);

  // IMPORTANT: pixel eligibility must be based on the REAL src we load
  const canReadPixels = useMemo(() => {
    if (isWebcam) return true;
    return isSameOriginOrRelative(src);
  }, [isWebcam, src]);

  const [health, setHealth] = useState<StreamHealth>({ state: "ok", sinceMs: 0, reason: "init" });

  // We keep a "scene" object for parent counts.
  // Here it's driven by AI: peopleBand + rough motion + pixelsOk.
  const [scene, setScene] = useState<SceneProbeResult>({ peopleBand: "unknown", motion: 0, pixelsOk: false });

  // AI output: true count + fall state
  const [ai, setAi] = useState<AIState>({
    ready: false,
    personCount: 0,
    band: "unknown",
    fall: { state: "none", confidence: 0, reasons: [] },
    motion: 0,
    ts: 0,
  });

  const lastAiEmitRef = useRef<{ riskMs: number; criticalMs: number }>({ riskMs: 0, criticalMs: 0 });

  const icon = safetyLabel(incident);

  // Use incident severity if present, else use AI fall as a fallback highlight
  const aiDerivedSev: Severity =
    !incident && (ai.fall.state === "critical" || ai.fall.state === "risk")
      ? (ai.fall.state === "critical" ? "critical" : "risk")
      : (incident?.severity ?? "none");

  const sev: Severity = incident?.severity ?? aiDerivedSev;

  const safetyColor = severityColor(sev);
  const safetyThick = sev === "risk" || sev === "critical";
  const safetyPulse = sev === "critical" && !(incident?.acked ?? false);

  const healthThick =
    (health.state === "buffering" || health.state === "frozen" || health.state === "black" || health.state === "error") && !safetyThick;

  const healthColor = health.state === "buffering" ? "amber" : health.state === "ok" ? "" : "red";

  // Highlight if NO people or CROWD (>=4)
  const peopleBand = ai.ready ? ai.band : scene.peopleBand;
  const peopleFlag = peopleBand === "none" || peopleBand === "crowd";
  const peopleThick = peopleFlag && !safetyThick && !healthThick;

  const tileClass = useMemo(() => {
    const cls = ["tile"];
    if (safetyThick) cls.push("thick", safetyColor);
    else if (healthThick) cls.push("thick", healthColor);
    else if (peopleThick) cls.push("thick", "blue");
    if (safetyPulse) cls.push("pulse");
    return cls.join(" ");
  }, [safetyThick, safetyColor, healthThick, healthColor, peopleThick, safetyPulse]);

  /** ---------------------------
   *  Probe: buffering/frozen/black/error
   *  --------------------------*/
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const detach = attachVideoProbe(video, (h) => setHealth(h), {
      frozenSeconds: 8,
      enablePixelProbe: canReadPixels,
      debug: false,
      tag: camera.id,
    });

    return () => detach?.();
  }, [camera.id, src, isWebcam, canReadPixels]);

  /** ---------------------------
   *  Probe: AI person count + fall detection
   *  Runs for ALL live streams (and webcam) when pixels are readable.
   *  Uses global lock so only one tile infers at a time.
   *  --------------------------*/
  useEffect(() => {
    let stopped = false;

    const video = videoRef.current;
    if (!video) return;

    // If we cannot read pixels, AI cannot run
    if (!canReadPixels) {
      setAi((p) => ({ ...p, ready: false }));
      setScene({ peopleBand: "unknown", motion: 0, pixelsOk: false });
      return;
    }

    const srcText = String(src ?? camera.streamUrl ?? "");
    const looksLikePatient = /patient|bed|fall|ward|room/i.test(srcText + " " + camera.name);

    // Speed policy:
    // - patient fall: faster
    // - webcam: medium
    // - live streams wall: slower (but still active)
    const everyMs = looksLikePatient ? 550 : isWebcam ? 850 : 1800;
    const minScore = looksLikePatient || isWebcam ? 0.38 : 0.45;

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });

    // Fall heuristic tracking (largest person)
    let lastCenterY: number | null = null;
    let lastAspect: number | null = null; // h/w
    let lastTs: number | null = null;
    let postDropStillStart: number | null = null;
    let cooldownUntil = 0;
    let emaMotion = 0.02;

    const tick = async () => {
      if (stopped) return;

      // wait until video is actually producing frames
      const vw = video.videoWidth;
      const vh = video.videoHeight;

      if (!ctx || !vw || !vh || video.readyState < 2) {
        setAi((p) => ({ ...p, ready: false, ts: Date.now() }));
        setScene({ peopleBand: "unknown", motion: 0, pixelsOk: true });
        window.setTimeout(tick, Math.min(900, everyMs));
        return;
      }

      // Avoid AI during unhealthy stream states
      if (health.state !== "ok") {
        setAi((p) => ({ ...p, ready: true, personCount: 0, band: "unknown", fall: { state: "none", confidence: 0, reasons: ["stream_not_ok"] }, motion: 0, ts: Date.now() }));
        setScene({ peopleBand: "unknown", motion: 0, pixelsOk: true });
        window.setTimeout(tick, everyMs);
        return;
      }

      if (Date.now() < cooldownUntil) {
        window.setTimeout(tick, everyMs);
        return;
      }

      // downscale for speed
      const outW = Math.min(360, vw);
      const outH = Math.max(160, Math.round((outW * vh) / Math.max(1, vw)));
      canvas.width = outW;
      canvas.height = outH;

      const model = await getCocoModel();

      const detections = await withAiLock(async () => {
        ctx.drawImage(video, 0, 0, outW, outH);
        return model.detect(canvas);
      });

      // If another tile was running inference, just try again later
      if (!detections) {
        window.setTimeout(tick, everyMs);
        return;
      }

      const people = (detections as any[])
        .filter((d) => d?.class === "person" && (d?.score ?? 0) >= minScore)
        .map((d) => {
          const [x, y, w, h] = d.bbox as [number, number, number, number];
          return { x, y, w, h, score: d.score as number };
        });

      people.sort((a, b) => b.w * b.h - a.w * a.h);

      const now = Date.now();
      const count = people.length;
      const band = countToBand(count);

      // rough motion: track biggest person's center Y changes (EMA)
      let motion = 0;

      // fall inference
      let fallState: AIFallState = "none";
      let fallConf = 0;
      const reasons: string[] = [];

      if (count > 0) {
        const p = people[0];
        const centerY = p.y + p.h / 2;
        const aspect = p.h / Math.max(1, p.w);

        if (lastCenterY != null && lastTs != null) {
          const dt = Math.max(1, now - lastTs);
          const dy = centerY - lastCenterY; // down positive
          const dyNorm = dy / Math.max(1, outH);

          motion = Math.min(1, Math.abs(dyNorm) * 3);
          emaMotion = Math.max(0.004, Math.min(0.25, emaMotion * 0.92 + motion * 0.08));

          const drop = dyNorm > 0.12 && dt < 1400;
          const postureFlip = lastAspect != null && lastAspect > 1.05 && aspect < 0.95;

          if (drop) reasons.push(`drop:${dyNorm.toFixed(2)}`);
          if (postureFlip) reasons.push("posture_flip");

          const littleMotion = Math.abs(dyNorm) < Math.min(0.012, emaMotion * 0.9);

          if (drop || postureFlip) {
            fallState = "risk";
            fallConf = clamp01(0.62 + dyNorm * 1.8 + (postureFlip ? 0.18 : 0));
            postDropStillStart = now;
          } else if (postDropStillStart != null) {
            const stillAge = now - postDropStillStart;
            if (littleMotion && stillAge > 900) {
              fallState = "critical";
              fallConf = clamp01(0.78 + (stillAge / 3200) * 0.18 + (aspect < 0.9 ? 0.08 : 0));
              reasons.push(`still:${Math.round(stillAge / 1000)}s`);
              cooldownUntil = now + 12_000;
              postDropStillStart = null;
            } else if (stillAge > 4500) {
              postDropStillStart = null;
            }
          }
        }

        lastCenterY = centerY;
        lastAspect = aspect;
        lastTs = now;
      } else {
        // no one visible resets fall tracking
        lastCenterY = null;
        lastAspect = null;
        lastTs = null;
        postDropStillStart = null;
        motion = 0;
        emaMotion = Math.max(0.006, emaMotion * 0.95);
      }

      const nextAi: AIState = {
        ready: true,
        personCount: count,
        band,
        fall: { state: fallState, confidence: fallConf, reasons },
        motion,
        ts: now,
      };

      setAi(nextAi);

      // Keep scene in sync for parent counters and existing UI logic
      setScene({
        peopleBand: band,
        motion,
        pixelsOk: true,
      });

      window.setTimeout(tick, everyMs);
    };

    tick();

    return () => {
      stopped = true;
    };
  }, [camera.id, camera.name, camera.streamUrl, src, isWebcam, canReadPixels, health.state]);

  /** ---------------------------
   *  Auto-emit incidents from AI fall (works for webcam + patient + live streams)
   *  --------------------------*/
  useEffect(() => {
    if (!onAutoIncident) return;
    if (!ai.ready) return;
    if (ai.fall.state === "none") return;

    const now = Date.now();
    const cooldownRiskMs = 30_000;
    const cooldownCriticalMs = 12_000;

    if (ai.fall.state === "risk" && now - lastAiEmitRef.current.riskMs > cooldownRiskMs) {
      onAutoIncident({
        camera,
        type: "FALL",
        severity: "risk",
        confidence: ai.fall.confidence,
        reasons: ai.fall.reasons.length ? ai.fall.reasons : ["ai_fall_risk"],
      });
      lastAiEmitRef.current = { ...lastAiEmitRef.current, riskMs: now };
    }

    if (ai.fall.state === "critical" && now - lastAiEmitRef.current.criticalMs > cooldownCriticalMs) {
      onAutoIncident({
        camera,
        type: "FALL",
        severity: "critical",
        confidence: ai.fall.confidence,
        reasons: ai.fall.reasons.length ? ai.fall.reasons : ["ai_fall_critical"],
      });
      lastAiEmitRef.current = { ...lastAiEmitRef.current, criticalMs: now };
    }
  }, [ai.ready, ai.fall.state, ai.fall.confidence, ai.fall.reasons, camera, onAutoIncident]);

  /** ---------------------------
   *  Report status to parent
   *  --------------------------*/
  useEffect(() => {
    onStatus?.(camera.id, { health, scene });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera.id, health.state, scene.peopleBand, scene.pixelsOk]);

  const triangle = useMemo(() => {
    if (sev === "watch") return "amber";
    if (sev === "risk" || sev === "critical") return "red";
    return null;
  }, [sev]);

  const healthLabel = healthChip(health.state);

  // Always show people count when AI is ready. If not, show nothing.
  const peopleLabel = ai.ready ? countChip(ai.personCount) : "";

  return (
    <div
      className={tileClass}
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter") onOpen();
      }}
      aria-label={`Open ${camera.name}`}
    >
      {isWebcam ? (
        webcamEnabled && webcamStream ? (
          <video
            className="tileVideo"
            autoPlay
            muted
            playsInline
            ref={(el) => {
              videoRef.current = el;
              if (el && el.srcObject !== webcamStream) el.srcObject = webcamStream;
            }}
          />
        ) : (
          <div className="noStream">
            Operator Webcam
            <small>Tap Enable to allow camera</small>
            <div className="tileActions">
              <button
                className="primary"
                onClick={(e) => {
                  e.stopPropagation();
                  onEnableWebcam?.();
                }}
              >
                Enable webcam
              </button>
            </div>
          </div>
        )
      ) : src ? (
        <video
          className="tileVideo"
          src={src}
          autoPlay
          muted
          playsInline
          loop
          // safe: when same-origin it is fine; when not, it does not grant pixel access anyway
          //crossOrigin={canReadPixels ? "anonymous" : undefined}
          ref={(el) => {
            videoRef.current = el;
          }}
        />
      ) : (
        <div className="noStream">
          {camera.name}
          <small>No stream URL set</small>
        </div>
      )}

      <div className="tileOverlay">
        <div className="label">{camera.name}</div>

        <div className="statusRow" aria-hidden>
          {healthLabel ? <div className={`chip ${health.state === "buffering" ? "amber" : "red"}`}>{healthLabel}</div> : null}
          {peopleLabel ? <div className="chip blue">{peopleLabel}</div> : null}
        </div>

        {triangle ? <div className={`triangle ${triangle}`}>{sev === "critical" ? <div className="mark">!</div> : null}</div> : null}

        {icon ? (
          <div className="icon">
            <div className="badge">{icon.emoji}</div>
            <div>
              <div style={{ fontWeight: 750 }}>{icon.label}</div>
              <div style={{ fontSize: 12, color: "rgba(155,176,198,0.9)" }}>
                {Math.round((incident!.confidence ?? 0) * 100)}% {incident!.acked ? "acked" : "unacked"}
              </div>
            </div>
          </div>
        ) : null}

        {/* AI fall hint even before parent creates an Incident */}
        {!incident && ai.ready && ai.fall.state !== "none" ? (
          <div className="icon" style={{ right: 10, bottom: 10, left: "auto" }}>
            <div className="badge">{ai.fall.state === "critical" ? "❗" : "⚠️"}</div>
            <div>
              <div style={{ fontWeight: 750 }}>Fall {ai.fall.state}</div>
              <div style={{ fontSize: 12, color: "rgba(155,176,198,0.9)" }}>
                {Math.round(ai.fall.confidence * 100)}%
              </div>
            </div>
          </div>
        ) : null}

        {isWebcam && webcamEnabled && webcamStream ? (
          <div className="tileActions">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onEnableWebcam?.();
              }}
            >
              Disable
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

