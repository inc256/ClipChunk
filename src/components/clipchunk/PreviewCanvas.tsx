import { useEffect, useMemo, useRef, useState } from "react";
import type { Overlay, ReframeMode, VideoMeta } from "@/lib/clipchunk/types";
import { getReframeGeometry } from "@/lib/clipchunk/reframe";

interface Props {
  video: VideoMeta;
  overlays: Overlay[];
  selectedId: string | null;
  reframeMode: ReframeMode;
  onSelect: (id: string | null) => void;
  onChange: (id: string, patch: Partial<Overlay>) => void;
}

type DragMode = "move" | "resize-br" | "rotate";

export function PreviewCanvas({ video, overlays, selectedId, reframeMode, onSelect, onChange }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  const output = useMemo(
    () => getReframeGeometry(video.width, video.height, reframeMode),
    [video.height, video.width, reframeMode],
  );
  const aspect = output.outputWidth / output.outputHeight;
  const frameStyle: React.CSSProperties =
    reframeMode === "short"
      ? {
          aspectRatio: `${output.outputWidth} / ${output.outputHeight}`,
          width: "min(100%, calc(70vh * 9 / 16))",
          maxHeight: "70vh",
        }
      : {
          aspectRatio: `${output.outputWidth} / ${output.outputHeight}`,
          width: "100%",
          maxHeight: "70vh",
        };

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const rect = el.getBoundingClientRect();
      setSize({ w: rect.width, h: rect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const sortedOverlays = useMemo(() => [...overlays].sort((a, b) => a.z - b.z), [overlays]);

  return (
    <div className="flex h-full w-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-4 py-2 text-xs text-muted-foreground">
        <span>
          Preview · {output.outputWidth}×{output.outputHeight}
          {reframeMode === "short" ? " · 9:16 auto-center" : ` · ${video.orientation}`}
        </span>
        <span>{formatTime(video.duration)}</span>
      </div>
      <div className="flex flex-1 items-center justify-center p-3 sm:p-6">
        <div
          ref={wrapRef}
          className="relative overflow-hidden rounded-xl bg-black shadow-[0_30px_80px_-30px_rgba(0,0,0,0.7)] ring-1 ring-border"
          style={frameStyle}
          onMouseDown={(e) => { if (e.target === e.currentTarget) onSelect(null); }}
        >
          <video
            ref={videoRef}
            src={video.url}
            className={`h-full w-full ${reframeMode === "short" ? "object-cover object-center" : "object-contain"}`}
            controls
            playsInline
          />
          {/* Overlays */}
          {sortedOverlays.map((o) => (
            <OverlayBox
              key={o.id}
              overlay={o}
              canvasSize={size}
              selected={o.id === selectedId}
              onSelect={() => onSelect(o.id)}
              onChange={(patch) => onChange(o.id, patch)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function OverlayBox({
  overlay, canvasSize, selected, onSelect, onChange,
}: {
  overlay: Overlay; canvasSize: { w: number; h: number }; selected: boolean;
  onSelect: () => void; onChange: (patch: Partial<Overlay>) => void;
}) {
  const [drag, setDrag] = useState<{ mode: DragMode; sx: number; sy: number; init: Overlay } | null>(null);

  useEffect(() => {
    if (!drag) return;
    function onMove(e: PointerEvent) {
      if (!drag) return;
      const dx = (e.clientX - drag.sx) / Math.max(1, canvasSize.w);
      const dy = (e.clientY - drag.sy) / Math.max(1, canvasSize.h);
      if (drag.mode === "move") {
        onChange({
          x: clamp(drag.init.x + dx, 0, Math.max(0, 1 - drag.init.w)),
          y: clamp(drag.init.y + dy, 0, Math.max(0, 1 - drag.init.h)),
        });
      } else if (drag.mode === "resize-br") {
        onChange({
          w: clamp(drag.init.w + dx, 0.02, 1 - drag.init.x),
          h: clamp(drag.init.h + dy, 0.02, 1 - drag.init.y),
        });
      } else if (drag.mode === "rotate") {
        const cx = (drag.init.x + drag.init.w / 2) * canvasSize.w;
        const cy = (drag.init.y + drag.init.h / 2) * canvasSize.h;
        const rect = (document.querySelector("[data-cc-canvas]") as HTMLElement | null)?.getBoundingClientRect();
        const px = e.clientX - (rect?.left ?? 0);
        const py = e.clientY - (rect?.top ?? 0);
        const ang = Math.atan2(py - cy, px - cx) * 180 / Math.PI + 90;
        onChange({ rotation: Math.round(ang) });
      }
    }
    function onUp() { setDrag(null); }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [drag, canvasSize.w, canvasSize.h, onChange]);

  if (!overlay.visible) return null;

  const style: React.CSSProperties = {
    position: "absolute",
    left: `${overlay.x * 100}%`,
    top: `${overlay.y * 100}%`,
    width: `${overlay.w * 100}%`,
    height: `${overlay.h * 100}%`,
    opacity: overlay.opacity,
    transform: `rotate(${overlay.rotation}deg)`,
    transformOrigin: "center center",
    touchAction: "none",
    zIndex: overlay.z + 1,
  };

  return (
    <div
      data-cc-canvas
      style={style}
      onPointerDown={(e) => {
        e.stopPropagation();
        onSelect();
        setDrag({ mode: "move", sx: e.clientX, sy: e.clientY, init: overlay });
      }}
      className={`group cursor-move select-none ${selected ? "outline outline-2 outline-primary" : "outline outline-1 outline-white/0 hover:outline-white/30"}`}
    >
      <img src={overlay.src} alt={overlay.name} draggable={false} className="pointer-events-none h-full w-full object-contain" />
      {selected && (
        <>
          <Handle pos="br" onDown={(e) => { e.stopPropagation(); setDrag({ mode: "resize-br", sx: e.clientX, sy: e.clientY, init: overlay }); }} />
          <Handle pos="rot" onDown={(e) => { e.stopPropagation(); setDrag({ mode: "rotate", sx: e.clientX, sy: e.clientY, init: overlay }); }} />
        </>
      )}
    </div>
  );
}

function Handle({ pos, onDown }: { pos: "br" | "rot"; onDown: (e: React.PointerEvent) => void }) {
  const base = "absolute h-3.5 w-3.5 rounded-full border-2 border-background bg-primary shadow";
  const map: Record<typeof pos, string> = {
    br: `${base} -right-1.5 -bottom-1.5 cursor-se-resize`,
    rot: `${base} left-1/2 -translate-x-1/2 -top-6 cursor-grab`,
  };
  return <div className={map[pos]} onPointerDown={onDown} role="button" aria-label={pos === "br" ? "Resize" : "Rotate"} />;
}

function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }
function formatTime(s: number) {
  if (!isFinite(s)) return "—";
  const m = Math.floor(s / 60), r = Math.floor(s % 60);
  return `${m}:${String(r).padStart(2, "0")}`;
}