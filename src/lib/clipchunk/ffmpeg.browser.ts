import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile } from "@ffmpeg/util";
import type { Overlay, VideoMeta, ChunkResult } from "./types";
import coreUrl from "@ffmpeg/core?url";
import wasmUrl from "@ffmpeg/core/wasm?url";
import workerUrl from "@ffmpeg/ffmpeg/worker?url";

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

export async function getFFmpeg(onLog?: (m: string) => void, signal?: AbortSignal): Promise<FFmpeg> {
  if (_ffmpeg) return _ffmpeg;

  // ffmpeg.wasm's worker relies on SharedArrayBuffer, which browsers only
  // expose when the page is cross-origin isolated (COOP + COEP headers).
  // Without it, `ff.load()` can hang rather than throwing a clear error —
  // fail fast here instead.
  if (typeof SharedArrayBuffer === "undefined") {
    throw new Error(
      "This browser tab is not cross-origin isolated, so the video engine " +
        "can't load. Make sure the site is served with " +
        "Cross-Origin-Opener-Policy: same-origin and " +
        "Cross-Origin-Embedder-Policy: require-corp, then reload the page.",
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
        await withTimeout(
          ff.load({
            coreURL: coreUrl,
            wasmURL: wasmUrl,
            classWorkerURL: workerUrl,
          }),
          LOAD_TIMEOUT_MS,
          "FFmpeg engine timed out while loading. This usually means the page " +
            "is not cross-origin isolated, or the core/wasm/worker assets " +
            "404'd — check the Network tab for failed requests to *.wasm / " +
            "*worker*.js files.",
        );
      } catch (err) {
        // Reset so the next call can retry instead of permanently reusing a
        // rejected promise.
        _loadPromise = null;
        try { ff.terminate(); } catch { /* ignore */ }
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
    try {
      onProgress({
        current: currentChunk,
        total,
        pct: 0,
        label: message,
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
          label: `Error on chunk ${i + 1}: ${msg}`,
        });
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
        label: `Finished chunk ${i + 1} of ${total}`,
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
    if (!aborted) {
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