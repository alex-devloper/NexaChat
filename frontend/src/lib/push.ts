import { api } from "./api";

/** Turns the VAPID base64 key into the byte array PushManager expects. */
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const output = new Uint8Array(new ArrayBuffer(raw.length));

  for (let i = 0; i < raw.length; i += 1) {
    output[i] = raw.charCodeAt(i);
  }

  return output;
}

export function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export type NotificationResult = {
  ok: boolean;
  message: string;
  /** true when background push is registered, false when only in-app works */
  push: boolean;
  /** true when the browser allows OS-level notifications */
  os: boolean;
};

async function getRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!pushSupported()) return null;

  const existing = await navigator.serviceWorker.getRegistration();
  if (existing) return existing;

  await navigator.serviceWorker.register("/sw.js");
  return navigator.serviceWorker.ready;
}

const IN_APP_ONLY = "Notifications on (while app is open)";

/** True when this browser already registered background push. */
export async function pushAlreadyEnabled(): Promise<boolean> {
  if (!pushSupported() || Notification.permission !== "granted") return false;

  try {
    const registration = await getRegistration();
    if (!registration) return false;

    const subscription = await registration.pushManager.getSubscription();
    return !!subscription;
  } catch {
    return false;
  }
}

/** True when the browser already allowed notifications. */
export function notificationsAllowed(): boolean {
  return (
    typeof Notification !== "undefined" && Notification.permission === "granted"
  );
}

/**
 * Asks the browser for permission, then tries to register background push.
 * Must be called from a user gesture (button click).
 *
 * Some browsers have no push service (or block it); there we still enable
 * in-app notifications instead of failing outright.
 */
export async function enablePush(): Promise<NotificationResult> {
  if (!pushSupported()) {
    return {
      ok: false,
      message: "This browser does not support notifications",
      push: false,
      os: false,
    };
  }

  let permission = Notification.permission;

  // A previous "deny" can never be re-prompted; only browser settings help.
  if (permission !== "granted") {
    try {
      permission = await Notification.requestPermission();
    } catch (err) {
      console.error("Notification permission failed:", err);
    }
  }

  if (permission !== "granted") {
    // OS popups are blocked, but in-app alerts (sound + banner) still work.
    return {
      ok: true,
      message: "Alerts on (sound + banner). Allow notifications in browser for popups.",
      push: false,
      os: false,
    };
  }

  try {
    const registration = await getRegistration();
    if (!registration) {
      return { ok: true, message: IN_APP_ONLY, push: false, os: true };
    }

    const { data } = await api.get("/api/push/public-key");
    if (!data?.enabled || !data.publicKey) {
      return { ok: true, message: IN_APP_ONLY, push: false, os: true };
    }

    let subscription = await registration.pushManager.getSubscription();

    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(data.publicKey),
      });
    }

    await api.post("/api/push/subscribe", subscription.toJSON());

    return {
      ok: true,
      message: "Notifications turned on 🔔",
      push: true,
      os: true,
    };
  } catch (err) {
    // Some browsers (and this preview window) have no push service at all.
    console.error("Push registration failed:", err);
    return { ok: true, message: IN_APP_ONLY, push: false, os: true };
  }
}

/** Removes this device's subscription (permission itself stays granted). */
export async function disablePush(): Promise<void> {
  if (!pushSupported()) return;

  try {
    const registration = await getRegistration();
    if (!registration) return;

    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) return;

    await api
      .post("/api/push/unsubscribe", { endpoint: subscription.endpoint })
      .catch(() => {});

    await subscription.unsubscribe().catch(() => {});
  } catch (err) {
    console.error("Push unsubscribe failed:", err);
  }
}
