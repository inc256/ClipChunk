export type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export function isInIframe(): boolean {
  try { return window.self !== window.top; } catch { return true; }
}

export function isPreviewHost(): boolean {
  const h = window.location.hostname;
  return h.includes("id-preview--") || h.includes("lovableproject.com") || h.includes("lovable.app");
}

export function registerServiceWorker(onReady: () => void) {
  if (typeof window === "undefined") return;
  if (!("serviceWorker" in navigator)) return;
  // Avoid SW in iframes/preview hosts
  if (isInIframe() || isPreviewHost()) {
    navigator.serviceWorker.getRegistrations?.().then((rs) => rs.forEach((r) => r.unregister()));
    return;
  }
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").then(() => {
      onReady();
    }).catch(() => {/* noop */});
  });
}