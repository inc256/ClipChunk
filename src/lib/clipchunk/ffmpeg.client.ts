import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";
import type { Overlay, VideoMeta, ChunkResult } from "./types";

let _ffmpeg: FFmpeg | null = null;
let _loadPromise: Promise<FFmpeg> | null = null;

const CORE_BASE = "https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd";

export async function getFFmpeg(onLog?: (m: string) => void): Promise<FFmpeg> {
  if (_ffmpeg) return _ffmpeg;
  if (_loadPromise) return _loadPromise;
  _loadPromise = (async () => {
    const ff = new FFmpeg();
    if (onLog) ff.on("log", ({ message }) => onLog(message));
    await ff.load({
      coreURL: await toBlobURL(`${CORE_BASE}/ffmpeg-core.js`, "text/javascript"),
      wasmURL: await toBlobURL(`${CORE_BASE}/ffmpeg-core.wasm`, "application/wasm"),
    });
    _ffmpeg = ff;
    return ff;
  })();
  return _loadPromise;
}

export interface ProcessOpts {
  video: VideoMeta;
  overlays: Overlay[];
  chunkSeconds: number;
  onProgress: (info: { current: number; total: number; pct: number; label: string }) => void;
}

/**
 * Splits the video into chunks of `chunkSeconds`, burning visible overlays in.
 * Returns one ChunkResult per produced chunk.
 */
export async function processVideo(opts: ProcessOpts): Promise<ChunkResult[]> {
  const { video, overlays, chunkSeconds, onProgress } = opts;
  const ff = await getFFmpeg();

  // Write video
  onProgress({ current: 0, total: 1, pct: 0, label: "Preparing video…" });
  await ff.writeFile("input.mp4", await fetchFile(video.file));

  // Write overlay files (only visible)
  const active = overlays.filter((o) => o.visible);
  for (let i = 0; i < active.length; i++) {
    const o = active[i];
    await ff.writeFile(`ov${i}.png`, await fetchFile(o.file));
  }

  const total = Math.max(1, Math.ceil(video.duration / chunkSeconds));
  const results: ChunkResult[] = [];

  for (let i = 0; i < total; i++) {
    const start = i * chunkSeconds;
    const dur = Math.min(chunkSeconds, video.duration - start);
    const outName = `chunk_${String(i + 1).padStart(3, "0")}.mp4`;
    onProgress({ current: i + 1, total, pct: Math.round((i / total) * 100), label: `Processing chunk ${i + 1} of ${total}` });

    const args: string[] = ["-ss", start.toFixed(3), "-t", dur.toFixed(3), "-i", "input.mp4"];
    for (let k = 0; k < active.length; k++) args.push("-i", `ov${k}.png`);

    if (active.length === 0) {
      args.push("-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+faststart", outName);
    } else {
      // Build filtergraph: for each overlay scale to target size, then overlay sequentially.
      const W = video.width, H = video.height;
      const filters: string[] = [];
      // Sort by z so lower z gets drawn first
      const sorted = [...active].map((o, idx) => ({ o, idx })).sort((a, b) => a.o.z - b.o.z);
      sorted.forEach(({ o, idx }, n) => {
        const tw = Math.max(2, Math.round(o.w * W));
        const th = Math.max(2, Math.round(o.h * H));
        const alpha = Math.max(0, Math.min(1, o.opacity));
        // scale + alpha
        filters.push(`[${idx + 1}:v]scale=${tw}:${th},format=rgba,colorchannelmixer=aa=${alpha.toFixed(3)}[ov${n}]`);
      });
      let last = "[0:v]";
      sorted.forEach(({ o }, n) => {
        const x = Math.round(o.x * W);
        const y = Math.round(o.y * H);
        const next = n === sorted.length - 1 ? "[vout]" : `[tmp${n}]`;
        filters.push(`${last}[ov${n}]overlay=${x}:${y}${next}`);
        last = next;
      });
      args.push(
        "-filter_complex", filters.join(";"),
        "-map", "[vout]", "-map", "0:a?",
        "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-movflags", "+faststart", outName
      );
    }

    await ff.exec(args);
    const data = await ff.readFile(outName);
    const bytes = data as Uint8Array;
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const blob = new Blob([ab], { type: "video/mp4" });
    results.push({
      id: crypto.randomUUID(),
      name: outName,
      blob,
      url: URL.createObjectURL(blob),
      size: blob.size,
    });
    try { await ff.deleteFile(outName); } catch { /* ignore */ }
    onProgress({ current: i + 1, total, pct: Math.round(((i + 1) / total) * 100), label: `Finished chunk ${i + 1} of ${total}` });
  }

  // cleanup
  try { await ff.deleteFile("input.mp4"); } catch { /* ignore */ }
  for (let k = 0; k < active.length; k++) {
    try { await ff.deleteFile(`ov${k}.png`); } catch { /* ignore */ }
  }
  return results;
}