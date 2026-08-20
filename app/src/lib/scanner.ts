// Scanner code-barres / QR réutilisable (matériels, interventions, IZ/RTR…).
// Deux moteurs, choisis à chaud :
//   1) BarcodeDetector natif (Android Chrome / WebView récente) : rapide, 0 Ko, moteur de l'OS.
//   2) ZXing (@zxing/browser) en repli, chargé À LA DEMANDE (dynamic import) : JS pur, tous formats,
//      précaché par le service worker -> fonctionne hors-ligne.
// Dans les deux cas, c'est NOUS qui ouvrons le flux caméra (getUserMedia) et pilotons
// autofocus / torche / zoom via applyConstraints (best-effort selon les capacités du device).

export type ScanEngine = "native" | "zxing";

export interface ScanController {
  engine: ScanEngine;
  stop(): void;
  hasTorch(): boolean;
  toggleTorch(): Promise<boolean>;
  hasZoom(): boolean;
  zoomRange(): { min: number; max: number; step: number } | null;
  setZoom(v: number): Promise<void>;
}

export interface StartScanOptions {
  scanIntervalMs?: number;       // cadence de détection (défaut 180 ms)
  onError?: (e: Error) => void;  // erreurs non bloquantes pendant le scan
}

type TrackCaps = MediaTrackCapabilities & {
  torch?: boolean;
  focusMode?: string[];
  zoom?: { min: number; max: number; step?: number };
};
type AdvancedConstraint = { torch?: boolean; zoom?: number; focusMode?: string };
function advanced(c: AdvancedConstraint): MediaTrackConstraints {
  return { advanced: [c] } as unknown as MediaTrackConstraints;
}

type NativeDetector = { detect(src: CanvasImageSource): Promise<Array<{ rawValue: string; format: string }>> };
type NativeDetectorCtor = (new (opts?: { formats?: string[] }) => NativeDetector) & {
  getSupportedFormats?: () => Promise<string[]>;
};

export async function startScan(
  video: HTMLVideoElement,
  onResult: (text: string, format: string) => void,
  opts: StartScanOptions = {},
): Promise<ScanController> {
  const intervalMs = opts.scanIntervalMs ?? 180;

  // --- flux caméra (arrière, HD) ---
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: false,
  });
  video.srcObject = stream;
  video.setAttribute("playsinline", "true");
  video.muted = true;
  try { await video.play(); } catch { /* autoplay peut rejeter, on continue */ }

  const track = stream.getVideoTracks()[0];
  const caps: TrackCaps = (track.getCapabilities?.() ?? {}) as TrackCaps;

  // autofocus continu best-effort (Android l'expose souvent ; iOS le fait nativement)
  if (Array.isArray(caps.focusMode) && caps.focusMode.includes("continuous")) {
    try { await track.applyConstraints(advanced({ focusMode: "continuous" })); } catch { /* ignore */ }
  }

  const hasTorch = caps.torch === true;
  const z = caps.zoom;
  const zoomCap =
    z && typeof z === "object" && !Array.isArray(z) && typeof z.min === "number" && typeof z.max === "number"
      ? { min: z.min, max: z.max, step: z.step && z.step > 0 ? z.step : 0.1 }
      : null;
  let torchOn = false;

  // --- moteur ---
  let engine: ScanEngine;
  let detector: NativeDetector | null = null;
  let reader: import("@zxing/browser").BrowserMultiFormatReader | null = null;
  let fmtName: ((f: number) => string) | null = null;
  let canvas: HTMLCanvasElement | null = null;

  const BD = (window as unknown as { BarcodeDetector?: NativeDetectorCtor }).BarcodeDetector;
  if (BD) {
    engine = "native";
    let formats: string[] | undefined;
    try {
      const supported = (await BD.getSupportedFormats?.()) ?? [];
      if (supported.length) formats = supported; // tous les formats supportés par l'OS
    } catch { /* ignore */ }
    detector = new BD(formats ? { formats } : undefined);
  } else {
    engine = "zxing";
    const zx = await import("@zxing/browser"); // chargé uniquement si nécessaire
    reader = new zx.BrowserMultiFormatReader(); // sans hints = tous formats
    fmtName = (f: number) => zx.BarcodeFormat[f] ?? "unknown";
    canvas = document.createElement("canvas");
  }

  // --- boucle de détection ---
  let stopped = false;
  let busy = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  async function tick() {
    if (stopped) return;
    if (!busy && video.readyState >= 2 && video.videoWidth > 0) {
      busy = true;
      try {
        if (engine === "native" && detector) {
          const codes = await detector.detect(video);
          if (codes && codes.length) {
            const txt = String(codes[0].rawValue ?? "").trim();
            if (txt) onResult(txt, codes[0].format ?? "unknown");
          }
        } else if (reader && canvas) {
          const cv = canvas;
          cv.width = video.videoWidth;
          cv.height = video.videoHeight;
          const ctx = cv.getContext("2d");
          if (ctx) {
            ctx.drawImage(video, 0, 0, cv.width, cv.height);
            try {
              const res = reader.decodeFromCanvas(cv);
              const txt = res.getText().trim();
              if (txt) onResult(txt, fmtName ? fmtName(res.getBarcodeFormat()) : "unknown");
            } catch { /* NotFound sur cette frame : normal */ }
          }
        }
      } catch (e) {
        opts.onError?.(e as Error);
      } finally {
        busy = false;
      }
    }
    if (!stopped) timer = setTimeout(tick, intervalMs);
  }
  timer = setTimeout(tick, intervalMs);

  return {
    engine,
    hasTorch: () => hasTorch,
    async toggleTorch() {
      if (!hasTorch) return torchOn;
      torchOn = !torchOn;
      try { await track.applyConstraints(advanced({ torch: torchOn })); } catch { torchOn = !torchOn; }
      return torchOn;
    },
    hasZoom: () => zoomCap != null,
    zoomRange: () => zoomCap,
    async setZoom(v: number) {
      if (!zoomCap) return;
      try { await track.applyConstraints(advanced({ zoom: v })); } catch { /* ignore */ }
    },
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      stream.getTracks().forEach((t) => { try { t.stop(); } catch { /* ignore */ } });
      if (video.srcObject) video.srcObject = null;
    },
  };
}
