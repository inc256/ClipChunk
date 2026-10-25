import { useRef } from "react";
import type { Overlay } from "@/lib/clipchunk/types";

export function OverlayPanel({
  overlays, selectedId, onSelect, onAdd, onPatch, onDelete, onDuplicate, onBringForward, onSendBackward,
}: {
  overlays: Overlay[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAdd: (files: FileList) => void;
  onPatch: (id: string, patch: Partial<Overlay>) => void;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
  onBringForward: () => void;
  onSendBackward: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const selected = overlays.find((overlay) => overlay.id === selectedId) ?? null;

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

      <div className="mt-4 border-t border-border pt-4">
        {selected ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Transform</h4>
              <span className="max-w-[150px] truncate text-xs text-foreground" title={selected.name}>{selected.name}</span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <FieldGroup label="Position">
                <NumberField label="X" value={selected.x * 100} onChange={(value) => onPatch(selected.id, { x: clamp(value / 100, 0, 1 - selected.w) })} />
                <NumberField label="Y" value={selected.y * 100} onChange={(value) => onPatch(selected.id, { y: clamp(value / 100, 0, 1 - selected.h) })} />
              </FieldGroup>
              <FieldGroup label="Size">
                <NumberField label="W" value={selected.w * 100} onChange={(value) => onPatch(selected.id, { w: clamp(value / 100, 0.02, 1 - selected.x) })} />
                <NumberField label="H" value={selected.h * 100} onChange={(value) => onPatch(selected.id, { h: clamp(value / 100, 0.02, 1 - selected.y) })} />
              </FieldGroup>
            </div>

            <SliderField
              label={`Rotation · ${selected.rotation}°`}
              min={-180}
              max={180}
              value={selected.rotation}
              onChange={(value) => onPatch(selected.id, { rotation: value })}
            />
            <SliderField
              label={`Opacity · ${Math.round(selected.opacity * 100)}%`}
              min={0}
              max={100}
              value={Math.round(selected.opacity * 100)}
              onChange={(value) => onPatch(selected.id, { opacity: value / 100 })}
            />
            <div>
              <div className="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Layer order</div>
              <div className="grid grid-cols-2 gap-2">
                <button onClick={onBringForward} className="rounded-lg border border-border bg-surface px-2 py-2 text-xs font-semibold hover:border-primary/40">Bring Forward</button>
                <button onClick={onSendBackward} className="rounded-lg border border-border bg-surface px-2 py-2 text-xs font-semibold hover:border-primary/40">Send Backward</button>
              </div>
            </div>
          </div>
        ) : (
          <p className="text-xs leading-relaxed text-muted-foreground">
            Select an overlay to adjust its position, size, rotation, opacity, and layer order.
          </p>
        )}
      </div>
    </section>
  );
}

function FieldGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <label className="flex items-center gap-2 rounded-lg border border-input bg-surface px-2 py-1.5 text-sm focus-within:border-primary">
      <span className="text-xs text-muted-foreground">{label}</span>
      <input
        type="number"
        value={Math.round(value)}
        onChange={(event) => {
          const next = Number(event.target.value);
          if (Number.isFinite(next)) onChange(next);
        }}
        className="min-w-0 flex-1 bg-transparent outline-none"
      />
      <span className="text-xs text-muted-foreground">%</span>
    </label>
  );
}

function SliderField({
  label, min, max, value, onChange,
}: {
  label: string;
  min: number;
  max: number;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block">
      <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="mt-1 w-full accent-[--color-primary]"
      />
    </label>
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}