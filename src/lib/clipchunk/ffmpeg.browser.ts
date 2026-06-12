import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";
import type { Overlay, VideoMeta, ChunkResult } from "./types";

// Load the (large, ~25 MB) ffmpeg-core wasm/js from a CDN instead of via
// Vite's `?url` asset pipeline. `@ffmpeg/core` is notoriously fragile to
// bundle correctly — the previous local-asset approach produced URLs that
// either 404'd or hung indefinitely inside `ff.load()` after a production
// build. `toBlobURL` fetches each asset (regular CORS fetch, unaffected by
// COEP) and converts it to a same-origin `blob:` URL, which the worker can
// then load without any cross-origin restrictions.
//
// Pin an exact version for cache stability / reproducibility.
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
      return await toBlobURL(url, type);
    } catch (err) {
      if (i === retries - 1) throw err;
      await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
    }
  }
  throw new Error(`Failed to fetch ${url} after ${retries} retries`);
}

export async function getFFmpeg(onLog?: (m: string) => void, signal?: AbortSignal): Promise<FFmpeg> {
  if (_ffmpeg) return _ffmpeg;

  // `@ffmpeg/core` (single-threaded) does not require SharedArrayBuffer —
  // only the `-mt` (multi-threaded) variant does, which needs COOP/COEP. We
  // use the standard core via CDN below, so this is informational only.
  if (typeof SharedArrayBuffer === "undefined") {
    onLog?.(
      "Note: SharedArrayBuffer is unavailable in this tab (no cross-origin " +
        "isolation). This is fine for the single-threaded ffmpeg core.",
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
          `Timed out fetching ffmpeg-core.js from ${CORE_BASE}. Check your ` +
            "network connection and that unpkg.com is reachable / not " +
            "blocked by an extension or CSP.",
        );
        
        onLog?.("📥 Fetching ffmpeg-core.wasm…");
        const wasmURL = await withTimeout(
          fetchWithRetry(`${CORE_BASE}/ffmpeg-core.wasm`, "application/wasm"),
          LOAD_TIMEOUT_MS,
          `Timed out fetching ffmpeg-core.wasm from ${CORE_BASE}. Check your ` +
            "network connection and that unpkg.com is reachable / not " +
            "blocked by an extension or CSP.",
        );
        
        // Fetch the worker script from the same CDN
        onLog?.("📥 Fetching worker script…");
        let workerURL: string;
        try {
          workerURL = await withTimeout(
            fetchWithRetry(`${CORE_BASE}/ffmpeg-core.worker.js`, "text/javascript"),
            LOAD_TIMEOUT_MS,
            `Timed out fetching worker script from ${CORE_BASE}`,
          );
          onLog?.("✅ Worker script fetched successfully");
        } catch (workerErr) {
          // Fallback: try alternative naming convention
          onLog?.("⚠️ Could not fetch ffmpeg-core.worker.js, trying alternative names…");
          try {
            workerURL = await withTimeout(
              fetchWithRetry(`${CORE_BASE}/worker.js`, "text/javascript"),
              LOAD_TIMEOUT_MS,
              "Timed out fetching alternative worker script",
            );
            onLog?.("✅ Alternative worker script fetched successfully");
          } catch (fallbackErr) {
            // If worker script can't be fetched, try to let FFmpeg handle it
            onLog?.("⚠️ Could not fetch worker script, will let FFmpeg use default");
            workerURL = undefined as any;
          }
        }
        
        onLog?.("🚀 Starting ffmpeg core…");
        const loadOptions: any = {
          coreURL,
          wasmURL,
        };
        
        // Only add workerURL if we successfully fetched it
        if (workerURL) {
          loadOptions.workerURL = workerURL;
        }
        
        await withTimeout(
          ff.load(loadOptions),
          LOAD_TIMEOUT_MS,
          "FFmpeg engine timed out while starting up after the core/wasm " +
            "were fetched successfully. This points at the worker script " +
            "(classWorkerURL) — check the Network tab for a failed/blocked " +
            "request to a *worker*.js file.",
        );
        
        onLog?.("✅ FFmpeg engine started successfully!");
      } catch (err) {
        // Reset so the next call can retry instead of permanently reusing a
        // rejected promise.
        _loadPromise = null;
        try { ff.terminate(); } catch { /* ignore */ }
        
        // Provide more detailed error information
        if (err instanceof Error) {
          onLog?.(`❌ FFmpeg load failed: ${err.message}`);
          if (err.message.includes("worker")) {
            onLog?.("💡 Tip: Check if your browser is blocking workers or if there's a CORS issue");
            onLog?.("💡 Try opening the Network tab and looking for failed requests to *.worker.js files");
          }
        }
        throw err;
      }
      
      _ffmpeg = ff;
      return ff;
    })();
  }

  // Race the in-flight load against the caller's abort signal so a stuck
  // `ff.load()` can be cancelled. Terminating the worker rejects the
  // pending load promise on the ffmpeg.wasm side too.
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

/**
 * Forcefully tears down the current FFmpeg worker (if any) and resets module
 * state so the next `getFFmpeg()` call starts fresh. Use this to implement
 * "Cancel" — `ff.exec()` and `ff.load()` cannot be interrupted any other way.
 */
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

/**
 * Splits the video into chunks of `chunkSeconds`, burning visible overlays in.
 * Returns one ChunkResult per produced chunk.
 *
 * Fixes applied vs original:
 *  1. `-ss` / `-t` moved to output side for frame-accurate cuts.
 *  2. `-shortest` added so FFmpeg doesn't hang on infinite image streams.
 *  3. Log & progress listener leak fixed — old handlers are removed before re-attaching.
 *  4. Alpha compositing uses `lutrgb` instead of `colorchannelmixer` so it works
 *     on PNGs that were saved without an alpha channel.
 *  5. AbortSignal support — callers can cancel mid-run.
 *  6. Parallel chunk writes replaced by sequential writes to avoid WASM OOM on
 *     large videos (WASM heap is limited to ~2 GB).
 *  7. Overlay files are written once before the chunk loop, not per chunk.
 *  8. Enhanced error handling with detailed messages.
 */
export async function processVideo(opts: ProcessOpts): Promise<ChunkResult[]> {
  const { video, overlays, chunkSeconds, onProgress, signal } = opts;

  if (signal?.aborted) {
    throw new DOMException("Processing cancelled by user.", "AbortError");
  }

  // Surface load-time log lines (e.g. asset fetch errors) in the UI instead
  // of swallowing them — this is the only window into *why* load() might hang.
  const ff = await getFFmpeg(
    (message) => onProgress({ current: 0, total: 1, pct: 0, label: message }),
    signal,
  );

  // `ff.exec()` cannot be cancelled cooperatively — the only way to stop it
  // mid-run is to terminate the worker. Register that here so Cancel works
  // even while a chunk is actively encoding.
  let aborted = false;
  const onAbortDuringExec = () => {
    aborted = true;
    terminateFFmpeg();
  };
  signal?.addEventListener("abort", onAbortDuringExec);

  // ── Listener management ────────────────────────────────────────────────────
  // Remove any leftover handlers from a previous run to prevent accumulation.
  if (_logHandler) {
    try { ff.off("log", _logHandler); } catch { /* ignore */ }
  }
  if (_progressHandler) {
    try { ff.off("progress", _progressHandler); } catch { /* ignore */ }
  }

  const total = Math.max(1, Math.ceil(video.duration / chunkSeconds));
  let currentChunk = 0;

  _progressHandler = ({ progress }) => {
    // `progress` from FFmpeg is 0..1 for the current exec call.
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
    // Surface ffmpeg stderr lines without clobbering the percentage counter.
    // Filter out noisy or expected warning messages
    const ignorePatterns = [
      /frame=.*fps=.*q=/i,  // FFmpeg progress output
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

  try { ff.on("progress", _progressHandler); } catch { /* setProgress may not exist */ }
  try { ff.on("log", _logHandler); } catch { /* ignore */ }

  try {
    // ── Write source video ───────────────────────────────────────────────────
    onProgress({ current: 0, total, pct: 0, label: "Preparing video…" });
    await ff.writeFile("input.mp4", await fetchFile(video.file));

    // ── Write overlay images (only visible ones, once, before chunk loop) ────
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

    // ── Chunk loop ───────────────────────────────────────────────────────────
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

      // ── Build ffmpeg args ────────────────────────────────────────────────────
      //
      // FIX 1: `-ss` and `-t` are placed AFTER all `-i` flags (output-side
      // seeking). This is slower than input-side but produces frame-accurate
      // cuts. For pre-split social content, accuracy matters more than speed.
      //
      const args: string[] = ["-i", "input.mp4"];
      for (let k = 0; k < active.length; k++) args.push("-i", `ov${k}.png`);

      // Output-side time range
      args.push("-ss", start.toFixed(3), "-t", dur.toFixed(3));

      if (active.length === 0) {
        // No overlays — straight remux/transcode.
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
        // ── Build filtergraph ──────────────────────────────────────────────────
        const W = video.width;
        const H = video.height;
        const filters: string[] = [];

        // Sort by z so lower z (further back) is composited first.
        const sorted = [...active]
          .map((o, idx) => ({ o, idx }))
          .sort((a, b) => a.o.z - b.o.z);

        // Scale + alpha each overlay.
        // FIX 3: Use `lutrgb=a='val*X'` instead of `colorchannelmixer=aa=X`.
        // `colorchannelmixer` only scales pre-existing alpha; if the PNG was
        // saved without an alpha channel the filter has no effect.
        // `format=rgba` + `lutrgb` forces an alpha channel then scales it.
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

        // Chain overlay filters.
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
          // FIX 2: `-shortest` prevents FFmpeg hanging because image inputs are
          // treated as infinite-duration streams. Without this the encoder waits
          // forever for the image stream to end.
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

      // ── Execute ──────────────────────────────────────────────────────────────
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
        
        // Provide helpful tips based on common errors
        if (msg.includes("memory") || msg.includes("alloc")) {
          onProgress({
            current: i + 1,
            total,
            pct: Math.round((i / total) * 100),
            label: "💡 Tip: Try reducing chunk size or video resolution to avoid memory issues",
          });
        } else if (msg.includes("codec") || msg.includes("encoder")) {
          onProgress({
            current: i + 1,
            total,
            pct: Math.round((i / total) * 100),
            label: "💡 Tip: Video codec may not be supported. Try using H.264 encoded videos.",
          });
        }
        
        throw err;
      }

      // ── Collect output ───────────────────────────────────────────────────────
      const data = await ff.readFile(outName);
      const bytes = data as Uint8Array;
      // Detach from the WASM heap before creating the Blob so GC can free it.
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

      // Free WASM FS space immediately so large videos don't exhaust the heap.
      try { await ff.deleteFile(outName); } catch { /* ignore */ }

      onProgress({
        current: i + 1,
        total,
        pct: Math.round(((i + 1) / total) * 100),
        label: `✅ Finished chunk ${i + 1} of ${total}`,
      });
    } // end for (chunk loop)

    // ── Cleanup ──────────────────────────────────────────────────────────────
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
    // Detach live handlers so they don't fire during idle time. Skip if the
    // worker was terminated (terminateFFmpeg already cleared these globals
    // and `ff` is now a dead reference).
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