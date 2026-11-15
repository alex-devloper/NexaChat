/* NexaChat service worker: WhatsApp-style web push notifications. */

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {
      title: "NexaChat",
      body: event.data ? event.data.text() : "You have a new message",
    };
  }

  const isCall = String(data.tag || "").startsWith("call-");

  const options = {
    body: data.body || "You have a new message",
    tag: data.tag || "nexachat",
    renotify: true,
    vibrate: isCall
      ? [600, 250, 600, 250, 900, 250, 600]
      : [120, 60, 120],
    icon: data.icon || "/vite.svg",
    badge: data.icon || "/vite.svg",
    timestamp: Date.now(),
    // A ringing call should stay on screen until the user acts on it.
    requireInteraction: isCall,
    data: { url: data.url || "/chat" },
  };

  event.waitUntil(self.registration.showNotification(data.title || "NexaChat", options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const target =
    (event.notification.data && event.notification.data.url) || "/chat";
  const url = new URL(target, self.location.origin).href;

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        // Reuse an open NexaChat tab instead of opening a duplicate window.
        for (const client of clientList) {
          let sameOrigin = false;
          try {
            sameOrigin = new URL(client.url).origin === self.location.origin;
          } catch {
            sameOrigin = false;
          }

          if (!sameOrigin) continue;

          // Navigate to /chat?user=<id> so the right conversation opens.
          return client
            .navigate(url)
            .then((navigated) => (navigated || client).focus())
            .catch(() => client.focus());
        }

        return self.clients.openWindow(url);
      })
  );
});
