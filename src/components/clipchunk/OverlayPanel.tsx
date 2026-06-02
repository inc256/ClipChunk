import { useRef } from "react";
import type { Overlay } from "@/lib/clipchunk/types";

export function OverlayPanel({
  overlays, selectedId, onSelect, onAdd, onPatch, onDelete, onDuplicate,
}: {
  overlays: Overlay[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAdd: (files: FileList) => void;
  onPatch: (id: string, patch: Partial<Overlay>) => void;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Overlays</h3>
        <button
          onClick={() => inputRef.current?.click()}
          className="rounded-lg bg-primary/15 px-3 py-1.5 text-xs font-semibold text-primary transition hover:bg-primary/25"
        >+ Add</button>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(e) => { if (e.target.files?.length) onAdd(e.target.files); e.target.value = ""; }}
        />
      </div>

      {overlays.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border bg-surface/50 px-3 py-6 text-center text-xs text-muted-foreground">
          No overlays yet. Add a logo, banner, or CTA image.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {overlays.map((o) => (
            <li
              key={o.id}
              onClick={() => onSelect(o.id)}
              className={`group flex items-center gap-2 rounded-lg border px-2 py-1.5 transition cursor-pointer ${selectedId === o.id ? "border-primary/60 bg-primary/10" : "border-border bg-surface hover:border-border/80"}`}
            >
              <img src={o.src} alt="" className="h-9 w-9 rounded object-cover ring-1 ring-border" />
              <input
                value={o.name}
                onChange={(e) => onPatch(o.id, { name: e.target.value })}
                onClick={(e) => e.stopPropagation()}
                className="min-w-0 flex-1 truncate bg-transparent text-sm outline-none focus:underline"
              />
              <button
                title={o.visible ? "Hide" : "Show"}
                onClick={(e) => { e.stopPropagation(); onPatch(o.id, { visible: !o.visible }); }}
                className={`rounded p-1 text-xs ${o.visible ? "text-primary" : "text-muted-foreground"}`}
              >
                {o.visible ? "●" : "○"}
              </button>
              <button
                title="Duplicate"
                onClick={(e) => { e.stopPropagation(); onDuplicate(o.id); }}
                className="rounded p-1 text-xs text-muted-foreground hover:text-foreground"
              >⎘</button>
              <button
                title="Delete"
                onClick={(e) => { e.stopPropagation(); onDelete(o.id); }}
                className="rounded p-1 text-xs text-muted-foreground hover:text-destructive"
              >✕</button>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
        Overlays apply to <span className="text-foreground">all chunks</span>. Drag in the preview to position.
      </p>
    </section>
  );
}