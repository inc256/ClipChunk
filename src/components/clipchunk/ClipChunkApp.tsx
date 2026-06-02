import { useCallback, useEffect, useMemo, useState } from "react";
import { UploadZone } from "./UploadZone";
import { PreviewCanvas } from "./PreviewCanvas";
import { ChunkSettings } from "./ChunkSettings";
import { OverlayPanel } from "./OverlayPanel";
import { PropertiesPanel } from "./PropertiesPanel";
import { ExportList } from "./ExportList";
import type { ChunkResult, Overlay, VideoMeta } from "@/lib/clipchunk/types";
import { processVideo } from "@/lib/clipchunk/ffmpeg.client";
import { registerServiceWorker, type InstallPromptEvent } from "@/lib/clipchunk/pwa.client";

export function ClipChunkApp() {
  const [video, setVideo] = useState<VideoMeta | null>(null);
  const [overlays, setOverlays] = useState<Overlay[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [unit, setUnit] = useState<"s" | "m">("s");
  const [chunkValue, setChunkValue] = useState(30);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState<{ pct: number; label: string } | null>(null);
  const [chunks, setChunks] = useState<ChunkResult[]>([]);
  const [error, setError] = useState<string | null>(null);

  // PWA install / offline
  const [installEvent, setInstallEvent] = useState<InstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [offlineReady, setOfflineReady] = useState(false);

  useEffect(() => {
    function onBip(e: Event) { e.preventDefault(); setInstallEvent(e as InstallPromptEvent); }
    function onInstalled() { setInstalled(true); setInstallEvent(null); }
    window.addEventListener("beforeinstallprompt", onBip);
    window.addEventListener("appinstalled", onInstalled);
    registerServiceWorker(() => setOfflineReady(true));
    return () => {
      window.removeEventListener("beforeinstallprompt", onBip);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const selected = useMemo(() => overlays.find((o) => o.id === selectedId) ?? null, [overlays, selectedId]);
  const chunkSeconds = unit === "m" ? chunkValue * 60 : chunkValue;

  const patchOverlay = useCallback((id: string, patch: Partial<Overlay>) => {
    setOverlays((prev) => prev.map((o) => (o.id === id ? { ...o, ...patch } : o)));
  }, []);

  async function addOverlays(files: FileList) {
    const arr = Array.from(files);
    const next: Overlay[] = [];
    for (const f of arr) {
      if (!/^image\/(png|jpe?g|webp)$/.test(f.type)) continue;
      const src = URL.createObjectURL(f);
      const dims = await new Promise<{ w: number; h: number }>((resolve) => {
        const img = new Image();
        img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
        img.onerror = () => resolve({ w: 100, h: 100 });
        img.src = src;
      });
      // Fit nicely: ~25% width, preserve aspect
      const w = 0.25;
      const h = clamp((dims.h / dims.w) * w * (video ? video.width / video.height : 1), 0.05, 0.6);
      next.push({
        id: crypto.randomUUID(),
        name: f.name,
        src,
        file: f,
        visible: true,
        x: 0.05, y: 0.05, w, h,
        rotation: 0, opacity: 1,
        z: overlays.length + next.length,
        naturalW: dims.w, naturalH: dims.h,
      });
    }
    setOverlays((prev) => [...prev, ...next]);
    if (next.length) setSelectedId(next[next.length - 1].id);
  }

  function duplicate(id: string) {
    const o = overlays.find((x) => x.id === id);
    if (!o) return;
    const copy: Overlay = { ...o, id: crypto.randomUUID(), x: clamp(o.x + 0.03, 0, 1 - o.w), y: clamp(o.y + 0.03, 0, 1 - o.h), z: overlays.length };
    setOverlays((prev) => [...prev, copy]);
    setSelectedId(copy.id);
  }
  function remove(id: string) {
    setOverlays((prev) => prev.filter((o) => o.id !== id));
    if (selectedId === id) setSelectedId(null);
  }
  function reorder(id: string, dir: 1 | -1) {
    setOverlays((prev) => {
      const sorted = [...prev].sort((a, b) => a.z - b.z);
      const i = sorted.findIndex((o) => o.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= sorted.length) return prev;
      [sorted[i].z, sorted[j].z] = [sorted[j].z, sorted[i].z];
      return [...sorted];
    });
  }

  async function startProcessing() {
    if (!video) return;
    setError(null);
    setChunks([]);
    setProcessing(true);
    setProgress({ pct: 0, label: "Loading engine…" });
    try {
      const out = await processVideo({
        video,
        overlays,
        chunkSeconds,
        onProgress: (p) => setProgress({ pct: p.pct, label: p.label }),
      });
      setChunks(out);
      setProgress({ pct: 100, label: "Done" });
    } catch (e) {
      console.error(e);
      setError("Failed to process chunk. Try a smaller video or different settings.");
    } finally {
      setProcessing(false);
    }
  }

  function resetProject() {
    chunks.forEach((c) => URL.revokeObjectURL(c.url));
    overlays.forEach((o) => URL.revokeObjectURL(o.src));
    if (video) URL.revokeObjectURL(video.url);
    setVideo(null); setOverlays([]); setChunks([]); setSelectedId(null); setProgress(null); setError(null);
  }

  async function install() {
    if (!installEvent) return;
    await installEvent.prompt();
    const res = await installEvent.userChoice;
    if (res.outcome === "accepted") setInstalled(true);
    setInstallEvent(null);
  }

  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      {/* Header */}
      <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-border bg-background/80 px-4 py-3 backdrop-blur sm:px-6">
        <div className="flex items-center gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-primary/15 text-primary">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" y1="4" x2="8.12" y2="15.88"/><line x1="14.47" y1="14.48" x2="20" y2="20"/><line x1="8.12" y1="8.12" x2="12" y2="12"/></svg>
          </div>
          <div>
            <div className="text-sm font-semibold leading-none">ClipChunk</div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">Split. Brand. Export.</div>
          </div>
          {video && (
            <span className="ml-3 hidden truncate rounded-md bg-surface px-2 py-1 text-xs text-muted-foreground sm:inline-block max-w-[220px]">
              {video.name}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {offlineReady && (
            <span className="hidden items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-medium text-primary sm:inline-flex">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" /> Ready for Offline Use
            </span>
          )}
          {installEvent && !installed && (
            <button onClick={install} className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:brightness-110">Install ClipChunk</button>
          )}
        </div>
      </header>

      {/* Body */}
      {!video ? (
        <main className="flex flex-1 items-center justify-center px-4 py-10">
          <div className="w-full">
            <div className="mb-8 text-center">
              <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">A lightweight studio for splitting & branding video.</h1>
              <p className="mx-auto mt-3 max-w-xl text-sm text-muted-foreground">Import a video, slice it into chunks, drop your logo or CTA on top, and export — entirely in your browser, no upload required.</p>
            </div>
            <UploadZone onLoaded={setVideo} onError={setError} />
            {error && <p className="mx-auto mt-4 max-w-3xl rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-2 text-center text-sm text-destructive">{error}</p>}
          </div>
        </main>
      ) : (
        <main className="grid flex-1 grid-cols-1 lg:grid-cols-[320px_1fr_320px]">
          {/* Left */}
          <aside className="order-2 space-y-4 border-border bg-secondary/40 p-4 lg:order-1 lg:border-r">
            <FileInfo video={video} />
            <ChunkSettings duration={video.duration} unit={unit} chunkValue={chunkValue} onUnitChange={setUnit} onValueChange={setChunkValue} />
            <OverlayPanel
              overlays={overlays}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onAdd={(fl) => void addOverlays(fl)}
              onPatch={patchOverlay}
              onDelete={remove}
              onDuplicate={duplicate}
            />
            <button
              onClick={startProcessing}
              disabled={processing}
              className="w-full rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground shadow-sm transition hover:brightness-110 active:scale-[.99] disabled:opacity-60"
            >
              {processing ? "Processing…" : "Generate Chunks"}
            </button>
            {error && <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>}
          </aside>

          {/* Center */}
          <section className="order-1 min-h-[40vh] border-border bg-background lg:order-2">
            <PreviewCanvas
              video={video}
              overlays={overlays}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onChange={patchOverlay}
            />
          </section>

          {/* Right */}
          <aside className="order-3 space-y-4 border-border bg-secondary/40 p-4 lg:border-l">
            <PropertiesPanel
              overlay={selected}
              onPatch={(p) => selected && patchOverlay(selected.id, p)}
              onBringForward={() => selected && reorder(selected.id, 1)}
              onSendBackward={() => selected && reorder(selected.id, -1)}
            />
          </aside>

          {/* Bottom row: processing + export */}
          {(processing || progress || chunks.length > 0) && (
            <div className="order-4 col-span-full space-y-4 border-t border-border bg-secondary/30 p-4">
              {(processing || (progress && chunks.length === 0)) && progress && (
                <div className="rounded-xl border border-border bg-card p-4">
                  <div className="mb-2 flex items-center justify-between text-sm">
                    <span className="font-medium">{progress.label}</span>
                    <span className="text-muted-foreground">{progress.pct}%</span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-surface">
                    <div className="h-full bg-primary transition-all duration-300" style={{ width: `${progress.pct}%` }} />
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">All processing runs locally with FFmpeg.wasm — your video never leaves the device.</p>
                </div>
              )}
              <ExportList chunks={chunks} onDelete={(id) => setChunks((prev) => prev.filter((c) => c.id !== id))} onReset={resetProject} />
            </div>
          )}
        </main>
      )}
    </div>
  );
}

function FileInfo({ video }: { video: VideoMeta }) {
  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Source</h3>
      <div className="space-y-1.5 text-sm">
        <Row k="Name" v={video.name} />
        <Row k="Resolution" v={`${video.width} × ${video.height}`} />
        <Row k="Orientation" v={video.orientation} />
        <Row k="Duration" v={formatDuration(video.duration)} />
        <Row k="Size" v={formatBytes(video.size)} />
      </div>
    </section>
  );
}
function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-xs text-muted-foreground">{k}</span>
      <span className="min-w-0 truncate font-medium" title={v}>{v}</span>
    </div>
  );
}
function formatDuration(s: number) {
  const m = Math.floor(s / 60), r = Math.floor(s % 60);
  return `${m}m ${r}s`;
}
function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }