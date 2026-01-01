export type StreamHealthState = "ok" | "buffering" | "frozen" | "black" | "error";

export type StreamHealth = {
  state: StreamHealthState;
  sinceMs: number;
  reason: string;
  details?: Record<string, unknown>;
};

export type VideoProbeOptions = {
  frozenSeconds?: number;          // seconds without currentTime progress -> frozen
  enablePixelProbe?: boolean;      // allow black-frame detection (requires pixel access)
  sampleEveryMs?: number;          // pixel sample rate
  blackLumaThreshold?: number;     // 0..255, lower = darker
  blackRatioThreshold?: number;    // 0..1 ratio of pixels below threshold
  blackConsecutive?: number;       // consecutive black samples to confirm
  debug?: boolean;                 // console logs
  tag?: string;                    // label logs with camera id/name
};

function mediaErrorText(code?: number | null) {
  switch (code ?? 0) {
    case 1: return "ABORTED";
    case 2: return "NETWORK";
    case 3: return "DECODE";
    case 4: return "SRC_NOT_SUPPORTED";
    default: return "UNKNOWN";
  }
}

function nowMs() {
  return Date.now();
}

function safeNum(v: unknown) {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * attachVideoProbe
 * - Detects buffering via events (waiting/stalled)
 * - Detects frozen when currentTime stops advancing for frozenSeconds
 * - Optionally detects black frames (pixel probe) when enablePixelProbe is true
 * - Emits detailed logs when debug=true
 */
export function attachVideoProbe(
  video: HTMLVideoElement,
  onHealth: (h: StreamHealth) => void,
  opts: VideoProbeOptions = {}
) {
  const {
    frozenSeconds = 8,
    enablePixelProbe = false,
    sampleEveryMs = 800,
    blackLumaThreshold = 18,
    blackRatioThreshold = 0.92,
    blackConsecutive = 2,
    debug = false,
    tag = "video",
  } = opts;

  let disposed = false;
  let health: StreamHealth = { state: "ok", sinceMs: nowMs(), reason: "init" };

  const log = (...args: any[]) => {
    if (!debug) return;
    // eslint-disable-next-line no-console
    console.debug(`[probe:${tag}]`, ...args);
  };

  const snapshotDetails = () => ({
    src: video.src,
    currentSrc: video.currentSrc,
    networkState: video.networkState, // 0..3
    readyState: video.readyState,     // 0..4
    paused: video.paused,
    ended: video.ended,
    currentTime: safeNum(video.currentTime),
    duration: safeNum(video.duration),
  });

  const emit = (next: StreamHealth) => {
    if (disposed) return;
    if (next.state === health.state && next.reason === health.reason) return;
    health = next;
    log("health ->", next.state, next.reason, next.details ?? "");
    onHealth(next);
  };

  // Events
  const onWaiting = () => emit({ state: "buffering", sinceMs: nowMs(), reason: "waiting", details: snapshotDetails() });
  const onStalled = () => emit({ state: "buffering", sinceMs: nowMs(), reason: "stalled", details: snapshotDetails() });
  const onPlaying = () => emit({ state: "ok", sinceMs: nowMs(), reason: "playing", details: snapshotDetails() });
  const onCanPlay = () => emit({ state: "ok", sinceMs: nowMs(), reason: "canplay", details: snapshotDetails() });

  const onError = () => {
    const code = video.error?.code ?? null;
    emit({
      state: "error",
      sinceMs: nowMs(),
      reason: `media_${mediaErrorText(code)}`,
      details: {
        ...snapshotDetails(),
        mediaErrorCode: code,
        mediaErrorText: mediaErrorText(code),
      },
    });
  };

  video.addEventListener("waiting", onWaiting);
  video.addEventListener("stalled", onStalled);
  video.addEventListener("playing", onPlaying);
  video.addEventListener("canplay", onCanPlay);
  video.addEventListener("error", onError);

  // Frozen detection: currentTime not advancing
  let lastTime = safeNum(video.currentTime) ?? 0;
  let lastProgressAt = nowMs();

  const frozenTick = window.setInterval(() => {
    if (disposed) return;
    if (video.paused || video.ended) return;

    const t = safeNum(video.currentTime);
    if (t == null) return;

    if (t !== lastTime) {
      lastTime = t;
      lastProgressAt = nowMs();
      if (health.state === "frozen") {
        emit({ state: "ok", sinceMs: nowMs(), reason: "time_progress", details: snapshotDetails() });
      }
      return;
    }

    const elapsed = nowMs() - lastProgressAt;
    if (elapsed >= frozenSeconds * 1000) {
      emit({ state: "frozen", sinceMs: nowMs(), reason: `no_time_progress_${frozenSeconds}s`, details: snapshotDetails() });
    }
  }, 400);

  // Black-screen detection (optional)
  let blackStreak = 0;
  let pixelDisabled = false;

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  const pixelTick = window.setInterval(() => {
    if (disposed) return;
    if (!enablePixelProbe) return;
    if (pixelDisabled) return;
    if (!ctx) return;

    // Avoid stacking black on top of buffering/frozen/error
    if (health.state !== "ok") return;

    const w = 96;
    const h = 54;
    canvas.width = w;
    canvas.height = h;

    try {
      ctx.drawImage(video, 0, 0, w, h);
      const img = ctx.getImageData(0, 0, w, h).data;

      let blackCount = 0;
      const total = w * h;

      for (let i = 0; i < img.length; i += 4) {
        const r = img[i];
        const g = img[i + 1];
        const b = img[i + 2];
        const l = r * 0.2126 + g * 0.7152 + b * 0.0722;
        if (l <= blackLumaThreshold) blackCount++;
      }

      const ratio = blackCount / total;

      if (ratio >= blackRatioThreshold) {
        blackStreak++;
      } else {
        blackStreak = 0;
        if (health.state === "black") {
          emit({ state: "ok", sinceMs: nowMs(), reason: "black_recovered", details: { ratio, ...snapshotDetails() } });
        }
      }

      if (blackStreak >= blackConsecutive) {
        emit({ state: "black", sinceMs: nowMs(), reason: `black_ratio_${ratio.toFixed(2)}`, details: { ratio, ...snapshotDetails() } });
      }
    } catch (e: any) {
      pixelDisabled = true;
      log("pixel probe disabled:", e?.message ?? e);
    }
  }, sampleEveryMs);

  emit({ state: "ok", sinceMs: nowMs(), reason: "attached", details: snapshotDetails() });

  return () => {
    disposed = true;

    window.clearInterval(frozenTick);
    window.clearInterval(pixelTick);

    video.removeEventListener("waiting", onWaiting);
    video.removeEventListener("stalled", onStalled);
    video.removeEventListener("playing", onPlaying);
    video.removeEventListener("canplay", onCanPlay);
    video.removeEventListener("error", onError);
  };
}

