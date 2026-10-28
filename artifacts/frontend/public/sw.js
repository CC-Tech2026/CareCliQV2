/* CareCliQ service worker: shows OS notifications sent by Web Push
 * (backend/app/services/web_push_service.py), so a laptop, desktop or phone
 * browser pops up an alert even when no CareCliQ tab is open.
 * Nothing is cached here; this file only handles push and notification taps. */

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

function samePath(url) {
  // action_url is absolute against the API's idea of the frontend origin;
  // always open it on this origin so dev, preview and prod all work.
  try {
    const parsed = new URL(url || "/", self.location.origin);
    return parsed.pathname + parsed.search;
  } catch {
    return "/";
  }
}

async function handlePush(data) {
  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  const visible = windows.find((client) => client.visibilityState === "visible");

  // Someone is looking at CareCliQ: the page shows its own in-app alert.
  // Urgent alerts and tests always reach the OS so they can't be missed.
  if (visible && !data.urgent && data.event !== "test") {
    visible.postMessage({ type: "carecliq:push", payload: data });
    return;
  }

  // Tags are the in-app notification id, so if the open tab already showed
  // this one, the same tag replaces it silently instead of alerting twice.
  await self.registration.showNotification(data.title || "CareCliQ", {
    body: data.body || "",
    tag: data.tag,
    requireInteraction: Boolean(data.urgent),
    icon: "/favicon.png",
    badge: "/favicon.png",
    data: { url: samePath(data.url) },
  });
}

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "CareCliQ", body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(handlePush(data));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const path = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const existing = windows.find((client) => new URL(client.url).origin === self.location.origin);
      if (existing) {
        await existing.focus();
        existing.postMessage({ type: "carecliq:navigate", url: path });
        return;
      }
      await self.clients.openWindow(path);
    })(),
  );
});
