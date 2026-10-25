import { useMemo } from "react";
import type { ReframeMode } from "@/lib/clipchunk/types";

export function ChunkSettings({
  duration, unit, chunkValue, chunkMode, selectedChunk, reframeMode,
  onUnitChange, onValueChange, onChunkModeChange, onSelectedChunkChange, onReframeModeChange,
}: {
  duration: number;
  unit: "s" | "m";
  chunkValue: number;
  chunkMode: "all" | "single";
  selectedChunk: number;
  reframeMode: ReframeMode;
  onUnitChange: (u: "s" | "m") => void;
  onValueChange: (n: number) => void;
  onChunkModeChange: (mode: "all" | "single") => void;
  onSelectedChunkChange: (n: number) => void;
  onReframeModeChange: (mode: ReframeMode) => void;
}) {
  const seconds = unit === "m" ? chunkValue * 60 : chunkValue;
  const estimated = useMemo(() => Math.max(1, Math.ceil(duration / Math.max(1, seconds))), [duration, seconds]);

  const presets = unit === "s" ? [15, 30, 60, 90] : [1, 2, 3, 5];

  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Split Settings</h3>
      <label className="block text-sm font-medium">Chunk Duration</label>
      <div className="mt-2 flex gap-2">
        <input
          type="number"
          min={1}
          value={chunkValue}
          onChange={(e) => onValueChange(Math.max(1, Number(e.target.value) || 1))}
          className="w-full rounded-lg border border-input bg-surface px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
        />
        <div className="inline-flex overflow-hidden rounded-lg border border-input">
          {(["s", "m"] as const).map((u) => (
            <button
              key={u}
              onClick={() => onUnitChange(u)}
              className={`px-3 py-2 text-xs font-semibold transition ${unit === u ? "bg-primary text-primary-foreground" : "bg-surface text-muted-foreground hover:text-foreground"}`}
            >
              {u === "s" ? "Seconds" : "Minutes"}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {presets.map((p) => (
          <button
            key={p}
            onClick={() => onValueChange(p)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition ${chunkValue === p ? "bg-primary/15 text-primary ring-1 ring-primary/40" : "bg-surface text-muted-foreground hover:text-foreground"}`}
          >{p}{unit}</button>
        ))}
      </div>
      <p className="mt-4 text-xs text-muted-foreground">
        Estimated Chunks: <span className="font-semibold text-foreground">{estimated}</span>
      </p>
      <div className="mt-3">
        <label className="block text-sm font-medium">Chunks to export</label>
        <div className="mt-2 inline-flex overflow-hidden rounded-lg border border-input">
          {(["all", "single"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => onChunkModeChange(mode)}
              className={`px-3 py-2 text-xs font-semibold transition ${chunkMode === mode ? "bg-primary text-primary-foreground" : "bg-surface text-muted-foreground hover:text-foreground"}`}
            >
              {mode === "all" ? "All chunks" : "One chunk"}
            </button>
          ))}
        </div>
        {chunkMode === "single" && (
          <label className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
            Chunk number
            <input
              type="number"
              min={1}
              max={estimated}
              value={selectedChunk}
              onChange={(e) => onSelectedChunkChange(Math.max(1, Math.min(estimated, Number(e.target.value) || 1)))}
              className="w-20 rounded-lg border border-input bg-surface px-2 py-1.5 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
            />
            <span>of {estimated}</span>
          </label>
        )}
      </div>

      <div className="mt-5 border-t border-border pt-4">
        <label className="block text-sm font-medium">Short-Form Reframe</label>
        <p className="mt-1 text-xs text-muted-foreground">
          One click to auto-center and format for vertical short content.
        </p>
        <div className="mt-2 inline-flex overflow-hidden rounded-lg border border-input">
          <button
            onClick={() => onReframeModeChange("source")}
            className={`px-3 py-2 text-xs font-semibold transition ${reframeMode === "source" ? "bg-primary text-primary-foreground" : "bg-surface text-muted-foreground hover:text-foreground"}`}
          >
            Original Frame
          </button>
          <button
            onClick={() => onReframeModeChange("short")}
            className={`px-3 py-2 text-xs font-semibold transition ${reframeMode === "short" ? "bg-primary text-primary-foreground" : "bg-surface text-muted-foreground hover:text-foreground"}`}
          >
            Auto 9:16
          </button>
        </div>
      </div>
    </section>
  );
}