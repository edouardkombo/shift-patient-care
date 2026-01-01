export type PeopleBand = "unknown" | "none" | "few" | "crowd";

export type SceneProbeResult = {
  peopleBand: PeopleBand;
  /** 0..1 approximate motion energy */
  motion: number;
  /** true when pixel reads are available (CORS not tainted) */
  pixelsOk: boolean;
};

export type SceneProbeOptions = {
  sampleEveryMs?: number;
  /** sensitivity for motion detection (0..255), lower is more sensitive */
  motionThreshold?: number;
  /** grid size for rough "how many things" estimation */
  gridX?: number;
  gridY?: number;
  /** fraction of changed pixels that counts as "someone present" */
  presenceMin?: number;
  /** fraction of changed cells that counts as "crowd" */
  crowdMinCells?: number;
};

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

/**
 * Very lightweight scene probe:
 * - estimates motion by frame differencing
 * - estimates presence/crowd by counting "active" cells in a grid
 *
 * It is not a person detector. It is a demo-friendly proxy.
 * Fails quietly if pixels cannot be read (CORS).
 */
export function attachSceneProbe(
  video: HTMLVideoElement,
  onChange: (res: SceneProbeResult) => void,
  opts: SceneProbeOptions = {}
) {
  const sampleEveryMs = opts.sampleEveryMs ?? 900;
  const motionThreshold = opts.motionThreshold ?? 28;
  const gridX = opts.gridX ?? 6;
  const gridY = opts.gridY ?? 4;
  const presenceMin = opts.presenceMin ?? 0.004;
  const crowdMinCells = opts.crowdMinCells ?? 7;

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  let last: Uint8ClampedArray | null = null;
  let pixelsOk = true;

  function emitUnknown(motion: number) {
    onChange({ peopleBand: "unknown", motion, pixelsOk: false });
  }

  const timer = window.setInterval(() => {
    if (!ctx) return;
    if (video.readyState < 2) return;
    if (video.videoWidth === 0 || video.videoHeight === 0) return;

    try {
      const w = 96;
      const h = 54;
      canvas.width = w;
      canvas.height = h;
      ctx.drawImage(video, 0, 0, w, h);
      const data = ctx.getImageData(0, 0, w, h).data;

      // Greyscale into a small buffer
      const gray = new Uint8ClampedArray(w * h);
      for (let i = 0, j = 0; i < data.length; i += 4, j++) {
        const r = data[i]!;
        const g = data[i + 1]!;
        const b = data[i + 2]!;
        gray[j] = (0.2126 * r + 0.7152 * g + 0.0722 * b) as unknown as number;
      }

      if (!last) {
        last = gray;
        onChange({ peopleBand: "unknown", motion: 0, pixelsOk: true });
        return;
      }

      let changed = 0;
      let sumDiff = 0;

      // grid occupancy
      const cells = new Array(gridX * gridY).fill(0);
      const cellW = Math.floor(w / gridX);
      const cellH = Math.floor(h / gridY);

      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const idx = y * w + x;
          const d = Math.abs(gray[idx]! - last[idx]!);
          if (d > motionThreshold) {
            changed++;
            sumDiff += d;
            const cx = Math.min(gridX - 1, Math.floor(x / cellW));
            const cy = Math.min(gridY - 1, Math.floor(y / cellH));
            cells[cy * gridX + cx]++;
          }
        }
      }

      last = gray;

      const total = w * h;
      const motion = clamp(sumDiff / (total * 255), 0, 1);
      const presence = changed / total;

      // Count "active" cells
      const cellThreshold = Math.max(5, Math.floor((cellW * cellH) * 0.02));
      const activeCells = cells.filter((c) => c > cellThreshold).length;

      let peopleBand: PeopleBand = "unknown";
      if (presence < presenceMin) peopleBand = "none";
      else if (activeCells >= crowdMinCells) peopleBand = "crowd";
      else peopleBand = "few";

      onChange({ peopleBand, motion, pixelsOk: true });
    } catch {
      pixelsOk = false;
      emitUnknown(0);
      // If tainted, stop spamming
      window.clearInterval(timer);
    }
  }, sampleEveryMs);

  return () => {
    window.clearInterval(timer);
  };
}
