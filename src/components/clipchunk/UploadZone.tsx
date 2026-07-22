import { useRef, useState } from "react";
import type { VideoMeta } from "@/lib/clipchunk/types";

const SUPPORTED = ["video/mp4", "video/quicktime", "video/x-matroska", "video/webm"];
const SUPPORTED_EXT = /\.(mp4|mov|mkv|webm)$/i;

export function UploadZone({ onLoaded, onError }: { onLoaded: (m: VideoMeta) => void; onError: (msg: string) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleFile(file: File) {
    if (!SUPPORTED.includes(file.type) && !SUPPORTED_EXT.test(file.name)) {
      onError("Unsupported format. Use MP4, MOV, MKV, or WEBM.");
      return;
    }
    if (file.size > 1024 * 1024 * 1024) {
      onError("Video too large. Keep it under 1 GB for in-browser processing.");
      return;
    }
    setLoading(true);
    const url = URL.createObjectURL(file);
    const v = document.createElement("video");
    v.preload = "metadata";
    v.src = url;
    v.muted = true;
    await new Promise<void>((resolve, reject) => {
      v.onloadedmetadata = () => resolve();
      v.onerror = () => reject(new Error("Could not read video metadata."));
    }).catch((e) => {
      onError(e.message);
      setLoading(false);
    });
    const width = v.videoWidth, height = v.videoHeight, duration = v.duration;
    const orientation = width > height ? "Landscape" : width < height ? "Portrait" : "Square";
    setLoading(false);
    onLoaded({ file, url, name: file.name, size: file.size, duration, width, height, orientation });
  }

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        const f = e.dataTransfer.files?.[0];
        if (f) void handleFile(f);
      }}
      className={`mx-auto max-w-3xl rounded-2xl border-2 border-dashed transition-all p-10 sm:p-16 text-center cc-glass ${drag ? "border-primary bg-primary/5" : "border-border hover:border-primary/60"}`}
    >
      <div className="mx-auto mb-6 grid h-16 w-16 place-items-center rounded-2xl bg-primary/15 text-primary">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12"/><path d="m7 8 5-5 5 5"/><path d="M5 21h14"/></svg>
      </div>
      <h2 className="text-2xl font-semibold tracking-tight">Drag & Drop Video</h2>
      <p className="mt-1 text-sm text-muted-foreground">or</p>
      <button
        onClick={() => inputRef.current?.click()}
        disabled={loading}
        className="mt-4 inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground shadow-sm transition hover:brightness-110 active:scale-[.98] disabled:opacity-60"
      >
        {loading ? "Reading video…" : "Choose Video"}
      </button>
      <p className="mt-6 text-xs text-muted-foreground">Supporting: MP4 · MOV · MKV · WEBM</p>
      <input
        ref={inputRef}
        type="file"
        accept="video/mp4,video/quicktime,video/x-matroska,video/webm,.mp4,.mov,.mkv,.webm"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleFile(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}