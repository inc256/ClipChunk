import { useMemo } from "react";

export function ChunkSettings({
  duration, unit, chunkValue, onUnitChange, onValueChange,
}: {
  duration: number;
  unit: "s" | "m";
  chunkValue: number;
  onUnitChange: (u: "s" | "m") => void;
  onValueChange: (n: number) => void;
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
    </section>
  );
}