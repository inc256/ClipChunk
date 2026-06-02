import JSZip from "jszip";
import type { ChunkResult } from "@/lib/clipchunk/types";

export function ExportList({ chunks, onDelete, onReset }: {
  chunks: ChunkResult[];
  onDelete: (id: string) => void;
  onReset: () => void;
}) {
  if (chunks.length === 0) return null;

  async function downloadAll() {
    for (const c of chunks) downloadBlob(c.blob, c.name);
  }
  async function downloadZip() {
    const zip = new JSZip();
    for (const c of chunks) zip.file(c.name, c.blob);
    const blob = await zip.generateAsync({ type: "blob" });
    downloadBlob(blob, "clipchunk-export.zip");
  }

  return (
    <section className="rounded-xl border border-border bg-card">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold">Export · {chunks.length} chunks ready</h3>
          <p className="text-xs text-muted-foreground">All chunks processed locally on your device.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={onReset} className="rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-semibold hover:border-primary/40">New project</button>
          <button onClick={downloadAll} className="rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-semibold hover:border-primary/40">Download All</button>
          <button onClick={downloadZip} className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:brightness-110">Export ZIP</button>
        </div>
      </header>
      <ul className="divide-y divide-border">
        {chunks.map((c) => (
          <li key={c.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center">
            <video src={c.url} controls playsInline className="h-32 w-full rounded-md bg-black sm:h-16 sm:w-28" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{c.name}</div>
              <div className="text-xs text-muted-foreground">{formatBytes(c.size)}</div>
            </div>
            <div className="flex gap-2">
              <a href={c.url} download={c.name} className="rounded-lg bg-primary/15 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/25">Download</a>
              <button onClick={() => onDelete(c.id)} className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:text-destructive">Delete</button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}