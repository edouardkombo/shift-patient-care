import * as tf from "@tensorflow/tfjs";
import "@tensorflow/tfjs-backend-webgl";
import * as cocoSsd from "@tensorflow-models/coco-ssd";

export type AIFallState = "none" | "risk" | "critical";

export type AIProbeResult = {
  personCount: number;
  peopleBoxes: Array<{ x: number; y: number; w: number; h: number; score: number }>;
  fall: { state: AIFallState; confidence: number; reasons: string[] };
  ts: number;
  ready: boolean;
};

export type AIProbeOptions = {
  everyMs?: number;           // inference interval
  minScore?: number;          // detection score threshold
  enableFall?: boolean;
  debug?: boolean;
  tag?: string;
};

// singleton model
let modelPromise: Promise<cocoSsd.ObjectDetection> | null = null;

async function getModel() {
  if (!modelPromise) {
    modelPromise = (async () => {
      await tf.setBackend("webgl");
      await tf.ready();
      return cocoSsd.load({ base: "lite_mobilenet_v2" });
    })();
  }
  return modelPromise;
}

function clamp01(x: number) {
  return Math.max(0, Math.min(1, x));
}

export async function attachAIProbe(
  video: HTMLVideoElement,
  onResult: (r: AIProbeResult) => void,
  opts: AIProbeOptions = {}
) {
  const {
    everyMs = 650,
    minScore = 0.45,
    enableFall = true,
    debug = false,
    tag = "ai",
  } = opts;

  let disposed = false;
  const log = (...args: any[]) => debug && console.debug(`[ai:${tag}]`, ...args);

  const model = await getModel();

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  // Track largest person over time (for fall heuristic)
  let lastCenterY: number | null = null;
  let lastTs: number | null = null;
  let lastAspect: number | null = null; // h/w
  let postDropStillStart: number | null = null;
  let cooldownUntil = 0;

  const tick = async () => {
    if (disposed) return;

    const vw = video.videoWidth;
    const vh = video.videoHeight;

    // not ready
    if (!vw || !vh || !ctx) {
      onResult({
        personCount: 0,
        peopleBoxes: [],
        fall: { state: "none", confidence: 0, reasons: ["video_not_ready"] },
        ts: Date.now(),
        ready: false,
      });
      setTimeout(tick, everyMs);
      return;
    }

    canvas.width = vw;
    canvas.height = vh;

    try {
      ctx.drawImage(video, 0, 0, vw, vh);
      const detections = await model.detect(canvas);

      const people = detections
        .filter((d) => d.class === "person" && (d.score ?? 0) >= minScore)
        .map((d) => {
          const [x, y, w, h] = d.bbox;
          return { x, y, w, h, score: d.score ?? 0 };
        });

      // Sort by area, biggest first
      people.sort((a, b) => b.w * b.h - a.w * a.h);

      const now = Date.now();
      let fallState: AIFallState = "none";
      let fallConf = 0;
      const reasons: string[] = [];

      if (enableFall && people.length > 0 && now >= cooldownUntil) {
        const p = people[0];
        const centerY = p.y + p.h / 2;
        const aspect = p.h / Math.max(1, p.w); // vertical person ~ >1, horizontal ~ <1

        if (lastCenterY != null && lastTs != null) {
          const dt = Math.max(1, now - lastTs);
          const dy = centerY - lastCenterY; // down is positive
          const dyNorm = dy / vh;           // normalize

          // Fall-like if there is a sudden downward movement
          const drop = dyNorm > 0.12 && dt < 1200; // tuneable
          const postureFlip = lastAspect != null && lastAspect > 1.05 && aspect < 0.95;

          if (drop) reasons.push(`drop:${dyNorm.toFixed(2)}`);
          if (postureFlip) reasons.push("posture_flip");

          // Confirm phase: after drop, expect low movement (stillness) for a moment
          const littleMotion = Math.abs(dyNorm) < 0.01;

          if (drop || postureFlip) {
            fallState = "risk";
            fallConf = clamp01(0.65 + dyNorm * 1.8 + (postureFlip ? 0.15 : 0));
            postDropStillStart = now;
          } else if (postDropStillStart != null) {
            const stillAge = now - postDropStillStart;
            if (littleMotion && stillAge > 900) {
              fallState = "critical";
              fallConf = clamp01(0.78 + (stillAge / 3000) * 0.2 + (aspect < 0.9 ? 0.08 : 0));
              reasons.push(`still:${Math.round(stillAge / 1000)}s`);
              cooldownUntil = now + 12_000; // stop spamming
              postDropStillStart = null;
            } else if (stillAge > 4000) {
              postDropStillStart = null; // expire
            }
          }
        }

        lastCenterY = centerY;
        lastAspect = aspect;
        lastTs = now;
      }

      const result: AIProbeResult = {
        personCount: people.length,
        peopleBoxes: people,
        fall: { state: fallState, confidence: fallConf, reasons },
        ts: Date.now(),
        ready: true,
      };

      onResult(result);

      if (debug && (fallState !== "none" || people.length > 0)) log(result);
    } catch (e: any) {
      // Most common issue if pixels are blocked would be a canvas error.
      // With your /wm proxy and webcam/local video, this should be fine.
      onResult({
        personCount: 0,
        peopleBoxes: [],
        fall: { state: "none", confidence: 0, reasons: ["ai_error", String(e?.message ?? e)] },
        ts: Date.now(),
        ready: true,
      });
      if (debug) log("ai_error:", e?.message ?? e);
    }

    setTimeout(tick, everyMs);
  };

  tick();

  return () => {
    disposed = true;
  };
}

