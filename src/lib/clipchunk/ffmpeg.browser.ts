import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";
import type { Overlay, VideoMeta, ChunkResult } from "./types";

const FFMPEG_CORE_VERSION = "0.12.6";
const CORE_BASE = `https://unpkg.com/@ffmpeg/core@${FFMPEG_CORE_VERSION}/dist/umd`;

let _ffmpeg: FFmpeg | null = null;
let _loadPromise: Promise<FFmpeg> | null = null;
let _logHandler: ((e: { message: string }) => void) | null = null;
let _progressHandler: ((e: { progress: number; time: number }) => void) | null = null;

const LOAD_TIMEOUT_MS = 30_000;

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise
      .then((v) => { clearTimeout(timer); resolve(v); })
      .catch((e) => { clearTimeout(timer); reject(e); });
  });
}

/**
 * Fetches a file and converts it to a blob URL with retry logic
 */
async function fetchWithRetry(url: string, type: string, retries = 3): Promise<string> {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      return await toBlobURL(url, type);
    } catch (err) {
      if (i === retries - 1) throw err;
      console.log(`Retry ${i + 1}/${retries} for ${url}`);
      await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
    }
  }
  throw new Error(`Failed to fetch ${url} after ${retries} retries`);
}

/**
 * Get worker URL - uses local file for production, CDN for development
 */
function getWorkerURL(): string {
  // In production (Vercel), use the local file from public directory
  if (typeof window !== 'undefined' && window.location.hostname !== 'localhost') {
    return '/ffmpeg/ffmpeg-core.worker.js';
  }
  
  // In development, we can try CDN but with fallback
  return `${CORE_BASE}/ffmpeg-core.worker.js`;
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
        onLog?.("📥 Fetching ffmpeg-core.js…");
        const coreURL = await withTimeout(
          fetchWithRetry(`${CORE_BASE}/ffmpeg-core.js`, "text/javascript"),
          LOAD_TIMEOUT_MS,
          `Timed out fetching ffmpeg-core.js`,
        );
        
        onLog?.("📥 Fetching ffmpeg-core.wasm…");
        const wasmURL = await withTimeout(
          fetchWithRetry(`${CORE_BASE}/ffmpeg-core.wasm`, "application/wasm"),
          LOAD_TIMEOUT_MS,
          `Timed out fetching ffmpeg-core.wasm`,
        );
        
        // Use local worker file instead of CDN to avoid CORS
        const workerURL = getWorkerURL();
        onLog?.(`📥 Using worker from: ${workerURL}`);
        
        // Verify worker file exists before attempting to load
        if (workerURL.startsWith('/')) {
          try {
            const response = await fetch(workerURL, { method: 'HEAD' });
            if (!response.ok) {
              throw new Error(`Worker file not found at ${workerURL} (HTTP ${response.status})`);
            }
            onLog?.("✅ Worker file verified");
          } catch (err) {
            onLog?.(`⚠️ Could not verify worker file: ${err instanceof Error ? err.message : 'Unknown error'}`);
            // Continue anyway - let FFmpeg try to load it
          }
        }
        
        onLog?.("🚀 Starting ffmpeg core…");
        await withTimeout(
          ff.load({
            coreURL,
            wasmURL,
            workerURL, // Use local worker file
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
          
          // Provide specific help for worker-related errors
          if (err.message.includes("worker") || err.message.includes("Worker")) {
            onLog?.("💡 Tip: Worker file missing. Make sure you've run 'npm run prebuild' to copy the worker file.");
            onLog?.("💡 Check that /public/ffmpeg/ffmpeg-core.worker.js exists in your build output.");
          }
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
  _ffmpeg = null;
  _loadPromise = null;
  _logHandler = null;
  _progressHandler = null;
}

export interface ProcessOpts {
  video: VideoMeta;
  overlays: Overlay[];
  chunkSeconds: number;
  onProgress: (info: {
    current: number;
    total: number;
    pct: number;
    label: string;
  }) => void;
  signal?: AbortSignal;
}

export async function processVideo(opts: ProcessOpts): Promise<ChunkResult[]> {
  const { video, overlays, chunkSeconds, onProgress, signal } = opts;

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

      if (active.length === 0) {
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
        const W = video.width;
        const H = video.height;
        const filters: string[] = [];

        const sorted = [...active]
          .map((o, idx) => ({ o, idx }))
          .sort((a, b) => a.o.z - b.o.z);

        sorted.forEach(({ o, idx }, n) => {
          const tw = Math.max(2, Math.round(o.w * W));
          const th = Math.max(2, Math.round(o.h * H));
          const alpha = Math.max(0, Math.min(1, o.opacity));
          filters.push(
            `[${idx + 1}:v]scale=${tw}:${th},` +
            `format=rgba,` +
            `lutrgb=a='val*${alpha.toFixed(4)}'` +
            `[ov${n}]`,
          );
        });

        let last = "[0:v]";
        sorted.forEach(({ o }, n) => {
          const x = Math.round(o.x * W);
          const y = Math.round(o.y * H);
          const next = n === sorted.length - 1 ? "[vout]" : `[tmp${n}]`;
          filters.push(`${last}[ov${n}]overlay=${x}:${y}[${next.slice(1, -1)}]`);
          last = next;
        });

        args.push(
          "-filter_complex", filters.join(";"),
          "-map", "[vout]",
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