import type { Overlay } from "@/lib/clipchunk/types";

export function PropertiesPanel({
  overlay, onPatch, onBringForward, onSendBackward,
}: {
  overlay: Overlay | null;
  onPatch: (patch: Partial<Overlay>) => void;
  onBringForward: () => void;
  onSendBackward: () => void;
}) {
  if (!overlay) {
    return (
      <section className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider">Properties</h3>
        Select an overlay to edit its properties.
      </section>
    );
  }

  return (
    <section className="space-y-4 rounded-xl border border-border bg-card p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Properties · {overlay.name}</h3>

      <Group label="Position">
        <NumberField label="X" value={pct(overlay.x)} suffix="%" onChange={(v) => onPatch({ x: clamp(v / 100, 0, 1 - overlay.w) })} />
        <NumberField label="Y" value={pct(overlay.y)} suffix="%" onChange={(v) => onPatch({ y: clamp(v / 100, 0, 1 - overlay.h) })} />
      </Group>

      <Group label="Size">
        <NumberField label="W" value={pct(overlay.w)} suffix="%" onChange={(v) => onPatch({ w: clamp(v / 100, 0.02, 1 - overlay.x) })} />
        <NumberField label="H" value={pct(overlay.h)} suffix="%" onChange={(v) => onPatch({ h: clamp(v / 100, 0.02, 1 - overlay.y) })} />
      </Group>

      <div>
        <Label>Rotation · {overlay.rotation}°</Label>
        <input type="range" min={-180} max={180} value={overlay.rotation}
          onChange={(e) => onPatch({ rotation: Number(e.target.value) })}
          className="w-full accent-[--color-primary]" />
      </div>

      <div>
        <Label>Opacity · {Math.round(overlay.opacity * 100)}%</Label>
        <input type="range" min={0} max={100} value={Math.round(overlay.opacity * 100)}
          onChange={(e) => onPatch({ opacity: Number(e.target.value) / 100 })}
          className="w-full accent-[--color-primary]" />
      </div>

      <div>
        <Label>Layer Order</Label>
        <div className="mt-1 grid grid-cols-2 gap-2">
          <button onClick={onBringForward} className="rounded-lg border border-border bg-surface px-3 py-2 text-xs font-semibold hover:border-primary/40">Bring Forward</button>
          <button onClick={onSendBackward} className="rounded-lg border border-border bg-surface px-3 py-2 text-xs font-semibold hover:border-primary/40">Send Backward</button>
        </div>
      </div>
    </section>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label>{label}</Label>
      <div className="mt-1 grid grid-cols-2 gap-2">{children}</div>
    </div>
  );
}
function Label({ children }: { children: React.ReactNode }) {
  return <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{children}</div>;
}
function NumberField({ label, value, suffix, onChange }: { label: string; value: number; suffix?: string; onChange: (n: number) => void }) {
  return (
    <label className="flex items-center gap-2 rounded-lg border border-input bg-surface px-2 py-1.5 text-sm focus-within:border-primary">
      <span className="text-xs text-muted-foreground">{label}</span>
      <input
        type="number"
        value={Math.round(value)}
        onChange={(e) => onChange(Number(e.target.value))}
        className="min-w-0 flex-1 bg-transparent outline-none"
      />
      {suffix && <span className="text-xs text-muted-foreground">{suffix}</span>}
    </label>
  );
}
function pct(v: number) { return v * 100; }
function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }