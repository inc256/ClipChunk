import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile } from "@ffmpeg/util";
import type { Overlay, VideoMeta, ChunkResult, ReframeMode } from "./types";
import { getReframeGeometry } from "./reframe";

const FFMPEG_CORE_VERSION = "0.12.10";
const CORE_BASE = `https://unpkg.com/@ffmpeg/core@${FFMPEG_CORE_VERSION}/dist/umd`;

let _ffmpeg: FFmpeg | null = null;
let _loadPromise: Promise<FFmpeg> | null = null;
let _logHandler: ((e: { message: string }) => void) | null = null;
let _progressHandler: ((e: { progress: number; time: number }) => void) | null = null;
let _runtimeObjectURLs: string[] = [];

const LOAD_TIMEOUT_MS = 60_000;

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise
      .then((v) => { clearTimeout(timer); resolve(v); })
      .catch((e) => { clearTimeout(timer); reject(e); });
  });
}

async function fetchWithRetry(url: string, type: string, retries = 3): Promise<string> {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      const blob = await response.blob();
      const typedBlob = blob.type === type ? blob : new Blob([blob], { type });
      return URL.createObjectURL(typedBlob);
    } catch (err) {
      if (i === retries - 1) throw err;
      console.log(`Retry ${i + 1}/${retries} for ${url}`);
      await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
    }
  }
  throw new Error(`Failed to fetch ${url} after ${retries} retries`);
}

function withBase(path: string): string {
  const base = import.meta.env.BASE_URL || "/";
  const normalizedBase = base.endsWith("/") ? base : `${base}/`;
  return `${normalizedBase}${path}`;
}

async function resolveCoreAssetURL(
  localPath: string,
  kind: "js" | "wasm",
  onLog?: (m: string) => void,
): Promise<string> {
  const localURL = withBase(localPath);

  try {
    const response = await fetch(localURL, { method: "GET" });
    const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
    const looksLikeHtml = contentType.includes("text/html");
    const typeOk = kind === "js"
      ? /javascript|ecmascript|text\/plain/.test(contentType)
      : /wasm|octet-stream/.test(contentType);

    if (response.ok && !looksLikeHtml && typeOk) {
      if (kind === "js") {
        // Module workers in Vite dev cannot import files from /public directly.
        // Serve core JS via blob URL to bypass source import transforms.
        const sourceText = await response.text();
        if (!sourceText.includes("createFFmpegCore")) {
          throw new Error(`ffmpeg-core.js payload is invalid at ${localURL}`);
        }
        const coreBlobURL = URL.createObjectURL(new Blob([sourceText], { type: "text/javascript" }));
        _runtimeObjectURLs.push(coreBlobURL);
        onLog?.(`Using local ffmpeg ${kind} via blob URL.`);
        return coreBlobURL;
      }

      onLog?.(`Using local ffmpeg ${kind}: ${localURL}`);
      return localURL;
    }
    onLog?.(`Local ffmpeg ${kind} unavailable (${response.status}, ${contentType || "unknown"}).`);
  } catch {
    onLog?.(`Local ffmpeg ${kind} check failed.`);
  }

  throw new Error(`Missing or invalid local ffmpeg ${kind} at ${localURL}`);
}

export async function getFFmpeg(onLog?: (m: string) => void, signal?: AbortSignal): Promise<FFmpeg> {
  if (_ffmpeg) return _ffmpeg;

  if (typeof SharedArrayBuffer === "undefined") {
    onLog?.(
      "Note: SharedArrayBuffer is unavailable in this tab. " +
      "This is fine for the single-threaded ffmpeg core.",
    );
  }

  if (!_loadPromise) {
    _loadPromise = (async () => {
      const ff = new FFmpeg();
      
      if (onLog) {
        ff.on("log", ({ message }) => {
          console.debug("[ffmpeg]", message);
          onLog(message);
        });
      }
      
      try {
        const coreURL = await withTimeout(
          resolveCoreAssetURL("ffmpeg/ffmpeg-core.js", "js", onLog),
          LOAD_TIMEOUT_MS,
          "Timed out resolving ffmpeg-core.js",
        );
        
        const wasmURL = await withTimeout(
          resolveCoreAssetURL("ffmpeg/ffmpeg-core.wasm", "wasm", onLog),
          LOAD_TIMEOUT_MS,
          "Timed out resolving ffmpeg-core.wasm",
        );
        
        onLog?.("🚀 Starting ffmpeg core…");
        await withTimeout(
          ff.load({
            coreURL,
            wasmURL,
          }),
          LOAD_TIMEOUT_MS,
          "FFmpeg engine timed out while starting up",
        );
        
        onLog?.("✅ FFmpeg engine started successfully!");
      } catch (err) {
        _loadPromise = null;
        try { ff.terminate(); } catch { /* ignore */ }
        
        if (err instanceof Error) {
          onLog?.(`❌ FFmpeg load failed: ${err.message}`);
          onLog?.("💡 Ensure '/ffmpeg/ffmpeg-core.js' and '/ffmpeg/ffmpeg-core.wasm' are deployed as real files (not HTML fallbacks).");
        }
        throw err;
      }
      
      _ffmpeg = ff;
      return ff;
    })();
  }

  if (signal) {
    return new Promise<FFmpeg>((resolve, reject) => {
      const onAbort = () => {
        terminateFFmpeg();
        reject(new DOMException("Engine load cancelled by user.", "AbortError"));
      };
      if (signal.aborted) return onAbort();
      signal.addEventListener("abort", onAbort, { once: true });
      _loadPromise!.then(
        (ff) => { signal.removeEventListener("abort", onAbort); resolve(ff); },
        (err) => { signal.removeEventListener("abort", onAbort); reject(err); },
      );
    });
  }

  return _loadPromise;
}

export function terminateFFmpeg() {
  if (_ffmpeg) {
    try { _ffmpeg.terminate(); } catch { /* ignore */ }
  }
  for (const url of _runtimeObjectURLs) {
    try { URL.revokeObjectURL(url); } catch { /* ignore */ }
  }
  _runtimeObjectURLs = [];
  _ffmpeg = null;
  _loadPromise = null;
  _logHandler = null;
  _progressHandler = null;
}

export interface ProcessOpts {
  video: VideoMeta;
  overlays: Overlay[];
  chunkSeconds: number;
  reframeMode: ReframeMode;
  onProgress: (info: {
    current: number;
    total: number;
    pct: number;
    label: string;
  }) => void;
  signal?: AbortSignal;
}

export async function processVideo(opts: ProcessOpts): Promise<ChunkResult[]> {
  const { video, overlays, chunkSeconds, reframeMode, onProgress, signal } = opts;

  if (signal?.aborted) {
    throw new DOMException("Processing cancelled by user.", "AbortError");
  }

  const ff = await getFFmpeg(
    (message) => onProgress({ current: 0, total: 1, pct: 0, label: message }),
    signal,
  );

  let aborted = false;
  const onAbortDuringExec = () => {
    aborted = true;
    terminateFFmpeg();
  };
  signal?.addEventListener("abort", onAbortDuringExec);

  if (_logHandler) {
    try { ff.off("log", _logHandler); } catch { /* ignore */ }
  }
  if (_progressHandler) {
    try { ff.off("progress", _progressHandler); } catch { /* ignore */ }
  }

  const total = Math.max(1, Math.ceil(video.duration / chunkSeconds));
  let currentChunk = 0;

  _progressHandler = ({ progress }) => {
    const ratio = Math.max(0, Math.min(1, progress));
    const overallPct = Math.round(((currentChunk + ratio) / total) * 100);
    onProgress({
      current: currentChunk + ratio,
      total,
      pct: overallPct,
      label: `Processing chunk ${currentChunk + 1} of ${total} (${Math.round(ratio * 100)}%)`,
    });
  };

  _logHandler = ({ message }) => {
    const ignorePatterns = [
      /frame=.*fps=.*q=/i,
      /Past duration.*too large/i,
      /buffer is too small/i,
    ];
    
    const shouldIgnore = ignorePatterns.some(pattern => pattern.test(message));
    if (shouldIgnore && !message.includes("error") && !message.includes("Error")) {
      return;
    }
    
    try {
      onProgress({
        current: currentChunk,
        total,
        pct: 0,
        label: message.length > 100 ? message.substring(0, 100) + "..." : message,
      });
    } catch { /* ignore */ }
  };

  try { ff.on("progress", _progressHandler); } catch { /* ignore */ }
  try { ff.on("log", _logHandler); } catch { /* ignore */ }

  try {
    onProgress({ current: 0, total, pct: 0, label: "Preparing video…" });
    await ff.writeFile("input.mp4", await fetchFile(video.file));

    const active = overlays.filter((o) => o.visible);
    for (let i = 0; i < active.length; i++) {
      const o = active[i];
      onProgress({ 
        current: 0, 
        total, 
        pct: 0, 
        label: `Loading overlay ${i + 1}/${active.length}: ${o.file.name}` 
      });
      await ff.writeFile(`ov${i}.png`, await fetchFile(o.file));
    }

    const results: ChunkResult[] = [];

    for (let i = 0; i < total; i++) {
      if (aborted || signal?.aborted) {
        throw new DOMException("Processing cancelled by user.", "AbortError");
      }

      currentChunk = i;
      const start = i * chunkSeconds;
      const dur = Math.min(chunkSeconds, video.duration - start);
      const outName = `chunk_${String(i + 1).padStart(3, "0")}.mp4`;

      onProgress({
        current: i,
        total,
        pct: Math.round((i / total) * 100),
        label: `Processing chunk ${i + 1} of ${total}…`,
      });

      const args: string[] = ["-i", "input.mp4"];
      for (let k = 0; k < active.length; k++) args.push("-i", `ov${k}.png`);
      args.push("-ss", start.toFixed(3), "-t", dur.toFixed(3));

      const output = getReframeGeometry(video.width, video.height, reframeMode);
      const needsReframe = reframeMode === "short";

      if (active.length === 0 && !needsReframe) {
        args.push(
          "-c:v", "libx264",
          "-preset", "ultrafast",
          "-crf", "23",
          "-pix_fmt", "yuv420p",
          "-c:a", "aac",
          "-b:a", "128k",
          "-movflags", "+faststart",
          outName,
        );
      } else {
        const W = output.outputWidth;
        const H = output.outputHeight;
        const filters: string[] = [];
        let last = "[0:v]";

        if (needsReframe) {
          filters.push(
            `[0:v]crop=${output.cropWidth}:${output.cropHeight}:${output.cropX}:${output.cropY},` +
            `scale=${output.outputWidth}:${output.outputHeight}[base]`,
          );
          last = "[base]";
        }

        const sorted = [...active]
          .map((o, idx) => ({ o, idx }))
          .sort((a, b) => a.o.z - b.o.z);

        sorted.forEach(({ o, idx }, n) => {
          const tw = Math.max(2, Math.round(o.w * W));
          const th = Math.max(2, Math.round(o.h * H));
          const alpha = Math.max(0, Math.min(1, o.opacity));
          filters.push(
            `[${idx + 1}:v]scale=${tw}:${th}:force_original_aspect_ratio=decrease,` +
            `pad=${tw}:${th}:(ow-iw)/2:(oh-ih)/2:color=black@0,` +
            `format=rgba,` +
            `lutrgb=a='val*${alpha.toFixed(4)}'` +
            `[ov${n}]`,
          );
        });

        sorted.forEach(({ o }, n) => {
          const x = Math.round(o.x * W);
          const y = Math.round(o.y * H);
          const nextLabel = n === sorted.length - 1 ? "vout" : `tmp${n}`;
          filters.push(`${last}[ov${n}]overlay=${x}:${y}[${nextLabel}]`);
          last = `[${nextLabel}]`;
        });

        const finalVideoLabel = active.length ? "[vout]" : last;

        args.push(
          "-filter_complex", filters.join(";"),
          "-map", finalVideoLabel,
          "-map", "0:a?",
          "-shortest",
          "-c:v", "libx264",
          "-preset", "ultrafast",
          "-crf", "23",
          "-pix_fmt", "yuv420p",
          "-c:a", "aac",
          "-b:a", "128k",
          "-movflags", "+faststart",
          outName,
        );
      }

      try {
        await ff.exec(args);
      } catch (err: unknown) {
        if (aborted || signal?.aborted) {
          throw new DOMException("Processing cancelled by user.", "AbortError");
        }
        const msg = err instanceof Error ? err.message : String(err);
        onProgress({
          current: i + 1,
          total,
          pct: Math.round((i / total) * 100),
          label: `❌ Error on chunk ${i + 1}: ${msg.substring(0, 150)}`,
        });
        throw err;
      }

      const data = await ff.readFile(outName);
      const bytes = data as Uint8Array;
      const ab = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer;
      const blob = new Blob([ab], { type: "video/mp4" });

      results.push({
        id: crypto.randomUUID(),
        name: outName,
        blob,
        url: URL.createObjectURL(blob),
        size: blob.size,
      });

      try { await ff.deleteFile(outName); } catch { /* ignore */ }

      onProgress({
        current: i + 1,
        total,
        pct: Math.round(((i + 1) / total) * 100),
        label: `✅ Finished chunk ${i + 1} of ${total}`,
      });
    }

    try { await ff.deleteFile("input.mp4"); } catch { /* ignore */ }
    for (let k = 0; k < active.length; k++) {
      try { await ff.deleteFile(`ov${k}.png`); } catch { /* ignore */ }
    }

    return results;
  } catch (err) {
    if (aborted || signal?.aborted) {
      throw new DOMException("Processing cancelled by user.", "AbortError");
    }
    throw err;
  } finally {
    signal?.removeEventListener("abort", onAbortDuringExec);
    if (!aborted && _ffmpeg === ff) {
      if (_logHandler) {
        try { ff.off("log", _logHandler); } catch { /* ignore */ }
        _logHandler = null;
      }
      if (_progressHandler) {
        try { ff.off("progress", _progressHandler); } catch { /* ignore */ }
        _progressHandler = null;
      }
    }
  }
}