import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ClipChunkApp } from "@/components/clipchunk/ClipChunkApp";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "ClipChunk — Split. Brand. Export." },
      { name: "description", content: "Local-first video utility PWA: split videos into chunks, add image overlays, and export — all in your browser." },
      { property: "og:title", content: "ClipChunk — Split. Brand. Export." },
      { property: "og:description", content: "Local-first video utility PWA: split videos into chunks, add image overlays, and export — all in your browser." },
    ],
  }),
  component: Index,
});

function Index() {
  // FFmpeg.wasm and DOM-heavy editing UI run client-only.
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  if (!ready) {
    return (
      <div className="grid min-h-dvh place-items-center bg-background text-muted-foreground">
        <div className="text-sm">Loading ClipChunk…</div>
      </div>
    );
  }
  return <ClipChunkApp />;
}
