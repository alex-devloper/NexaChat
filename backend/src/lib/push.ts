import * as webpush from "web-push";
import PushSubscription from "../models/PushSubscription";

let configured = false;

function ensureConfigured(): boolean {
  if (configured) return true;

  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;

  if (!publicKey || !privateKey) return false;

  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || "mailto:admin@nexachat.app",
    publicKey,
    privateKey
  );

  configured = true;
  return true;
}

export function pushIsConfigured(): boolean {
  return ensureConfigured();
}

export function getVapidPublicKey(): string {
  return process.env.VAPID_PUBLIC_KEY || "";
}

export type PushPayload = {
  title: string;
  body: string;
  url?: string;
  tag?: string;
  /** Absolute avatar URL shown as the notification icon. */
  icon?: string;
};

/** Sends a notification to every browser the user subscribed. */
export async function sendPushToUser(
  userId: string,
  payload: PushPayload
): Promise<void> {
  if (!ensureConfigured()) return;

  const subscriptions = await PushSubscription.find({ user: userId });
  if (subscriptions.length === 0) return;

  const body = JSON.stringify(payload);

  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          body,
          { TTL: 60 * 60 }
        );
      } catch (err) {
        const statusCode = (err as { statusCode?: number }).statusCode;
        // 404/410 means the subscription is gone for good.
        if (statusCode === 404 || statusCode === 410) {
          await PushSubscription.deleteOne({ _id: sub._id }).catch(() => {});
        }
      }
    })
  );
}
