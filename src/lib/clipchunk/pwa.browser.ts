export type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const ENABLE_SERVICE_WORKER = false;

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

  if (!ENABLE_SERVICE_WORKER) {
    navigator.serviceWorker.getRegistrations?.().then((registrations) => {
      registrations.forEach((registration) => registration.unregister());
    });
    return;
  }

  // Avoid SW in iframes/preview hosts
  if (isInIframe() || isPreviewHost()) {
    navigator.serviceWorker.getRegistrations?.().then((rs) => rs.forEach((r) => r.unregister()));
    return;
  }
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").then((reg) => {
      try {
        // Listen for messages from the service worker (OFFLINE_READY, SW_ACTIVATED)
        navigator.serviceWorker.addEventListener("message", (ev) => {
          try {
            const data = ev.data;
            if (!data) return;
            if (data.type === "OFFLINE_READY" || data.type === "SW_ACTIVATED") {
              onReady();
            }
          } catch (e) { /* noop */ }
        });
      } catch (e) { /* noop */ }

      // Fallback: if registration succeeded but we didn't get an explicit message,
      // call onReady so UI can mark offline support enabled.
      onReady();
    }).catch(() => {/* noop */});
  });
}