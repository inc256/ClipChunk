import React from "react";
import { createRoot } from "react-dom/client";
import { ClipChunkApp } from "@/components/clipchunk/ClipChunkApp";
import "./styles.css";

// If a deploy ships new hashed chunk names while a tab is still open on the
// old bundle, a dynamic import() (e.g. the lazy ffmpeg/pwa modules) can 404
// against the new server. Vite fires `vite:preloadError` in that case —
// reload once to pick up the fresh index.html and matching chunk map.
window.addEventListener("vite:preloadError", (event) => {
  event.preventDefault();
  const KEY = "clipchunk:reload-on-preload-error";
  // Avoid an infinite reload loop if the error is persistent (e.g. offline).
  if (sessionStorage.getItem(KEY)) {
    console.error("Repeated chunk load failure — not reloading again.", event);
    return;
  }
  sessionStorage.setItem(KEY, "1");
  window.location.reload();
});

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element not found");
}

// Clear the reload guard once the app has mounted successfully.
sessionStorage.removeItem("clipchunk:reload-on-preload-error");

createRoot(rootElement).render(<ClipChunkApp />);