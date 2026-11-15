import { Router } from "express";
import mongoose from "mongoose";

import PushSubscription from "../models/PushSubscription";
import { requireAuth } from "../middleware/auth";
import { pushLimiter } from "../middleware/rateLimit";
import { getVapidPublicKey, pushIsConfigured } from "../lib/push";
import { cleanString } from "../utils/validate";

const router = Router();

const MAX_SUBSCRIPTIONS_PER_USER = 10;

/** GET /api/push/public-key — the key the browser needs to subscribe. */
router.get("/public-key", requireAuth, (_req, res) => {
  return res.json({
    enabled: pushIsConfigured(),
    publicKey: getVapidPublicKey(),
  });
});

/** POST /api/push/subscribe — store this browser's push endpoint. */
router.post("/subscribe", requireAuth, pushLimiter, async (req, res) => {
  try {
    if (!pushIsConfigured()) {
      return res
        .status(503)
        .json({ message: "Push notifications are not configured on the server" });
    }

    const endpoint = cleanString(req.body?.endpoint, 500);
    const p256dh = cleanString(req.body?.keys?.p256dh, 200);
    const auth = cleanString(req.body?.keys?.auth, 200);

    if (!endpoint || !p256dh || !auth) {
      return res.status(400).json({ message: "Invalid push subscription" });
    }

    if (!/^https:\/\//i.test(endpoint)) {
      return res.status(400).json({ message: "Invalid push endpoint" });
    }

    // Keep a hard cap per account so a single user cannot hoard endpoints.
    const count = await PushSubscription.countDocuments({ user: req.userId });
    const existing = await PushSubscription.findOne({ endpoint });

    if (!existing && count >= MAX_SUBSCRIPTIONS_PER_USER) {
      return res.status(429).json({
        message: "Too many notification devices for this account",
      });
    }

    await PushSubscription.findOneAndUpdate(
      { endpoint },
      {
        endpoint,
        p256dh,
        auth,
        user: new mongoose.Types.ObjectId(req.userId),
        userAgent: cleanString(req.headers["user-agent"] || "", 200),
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    return res.status(201).json({ ok: true });
  } catch (err) {
    console.error("push subscribe error:", err);
    return res.status(500).json({ message: "Could not save subscription" });
  }
});

/** POST /api/push/unsubscribe — remove this browser's subscription. */
router.post("/unsubscribe", requireAuth, pushLimiter, async (req, res) => {
  try {
    const endpoint = cleanString(req.body?.endpoint, 500);
    if (!endpoint) {
      return res.status(400).json({ message: "Endpoint required" });
    }

    // Scope by user: you can only remove your own subscriptions.
    await PushSubscription.deleteOne({ endpoint, user: req.userId });

    return res.json({ ok: true });
  } catch (err) {
    console.error("push unsubscribe error:", err);
    return res.status(500).json({ message: "Could not remove subscription" });
  }
});

export default router;
