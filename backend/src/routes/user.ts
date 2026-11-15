import { Router } from "express";
import mongoose from "mongoose";
import User, { toPublicUser } from "../models/User";
import { requireAuth } from "../middleware/auth";
import {
  cleanString,
  isSafeMediaUrl,
  LIMITS,
} from "../utils/validate";

const router = Router();

/** GET /api/user/status/:id — last seen of another user */
router.get("/status/:id", requireAuth, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "Invalid user id" });
    }

    const isSelf = req.userId === req.params.id;

    const user = await User.findById(req.params.id).select(
      "lastSeen isOnline showLastSeen"
    );

    if (!user) return res.status(404).json({ message: "User not found" });

    // Privacy: a user who hid "last seen" never exposes the timestamp.
    const hidden = !isSelf && user.showLastSeen === false;

    return res.json({
      lastSeen: hidden ? null : user.lastSeen,
      // "Hide last seen" also hides presence, like WhatsApp.
      isOnline: hidden ? false : user.isOnline,
      lastSeenHidden: hidden,
    });
  } catch (err) {
    console.error("status error:", err);
    return res.status(500).json({ message: "Could not load status" });
  }
});

/** GET /api/user/:id — public profile (view only) */
router.get("/:id", requireAuth, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "Invalid user id" });
    }

    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: "User not found" });

    const viewer = await User.findById(req.userId).select("blocked");

    // Never expose another account's email address.
    const isSelf = req.userId === req.params.id;
    const { email: _email, ...publicProfile } = toPublicUser(user);

    const profile = {
      ...(isSelf ? toPublicUser(user) : publicProfile),
      isBlockedByMe: (viewer?.blocked || []).some(
        (id) => id.toString() === req.params.id
      ),
      hasBlockedMe: (user.blocked || []).some(
        (id) => id.toString() === req.userId
      ),
    };
    const payload =
      req.userId !== req.params.id && user.showLastSeen === false
        ? { ...profile, lastSeen: null }
        : profile;

    return res.json({ user: payload });
  } catch (err) {
    console.error("get user error:", err);
    return res.status(500).json({ message: "Could not load user" });
  }
});

/** PUT /api/user/update/:id — self only */
router.put("/update/:id", requireAuth, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "Invalid user id" });
    }

    // Ownership: you may only edit your own profile.
    if (req.userId !== req.params.id) {
      return res
        .status(403)
        .json({ message: "You can only update your own profile" });
    }

    const updates: Record<string, string | boolean> = {};

    if (req.body?.name !== undefined) {
      const name = cleanString(req.body.name, LIMITS.name);
      if (!name) {
        return res.status(400).json({ message: "Name cannot be empty" });
      }
      updates.name = name;
    }

    if (req.body?.about !== undefined) {
      updates.about = cleanString(req.body.about, LIMITS.about);
    }

    if (req.body?.profilePic !== undefined) {
      const profilePic = cleanString(req.body.profilePic, LIMITS.profilePic);
      // Only http(s) URLs or site-relative paths: blocks javascript:/data: URLs.
      if (profilePic && !isSafeMediaUrl(profilePic)) {
        return res.status(400).json({ message: "Invalid profile picture URL" });
      }
      updates.profilePic = profilePic;
    }

    if (req.body?.showLastSeen !== undefined) {
      // Privacy setting: only a real boolean is accepted.
      if (typeof req.body.showLastSeen !== "boolean") {
        return res.status(400).json({ message: "showLastSeen must be true or false" });
      }
      updates.showLastSeen = req.body.showLastSeen;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ message: "Nothing to update" });
    }

    const user = await User.findByIdAndUpdate(req.params.id, updates, {
      new: true,
      runValidators: true,
    });

    if (!user) return res.status(404).json({ message: "User not found" });

    return res.json({ user: toPublicUser(user) });
  } catch (err) {
    console.error("update user error:", err);
    return res.status(500).json({ message: "Could not update profile" });
  }
});

/** POST /api/user/block/:id — block or unblock another user */
router.post("/block/:id", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ message: "Invalid user id" });
    }

    if (id === req.userId) {
      return res.status(400).json({ message: "You cannot block yourself" });
    }

    if (typeof req.body?.blocked !== "boolean") {
      return res.status(400).json({ message: "blocked must be true or false" });
    }

    const target = await User.findById(id).select("_id");
    if (!target) return res.status(404).json({ message: "User not found" });

    const update = req.body.blocked
      ? { $addToSet: { blocked: target._id } }
      : { $pull: { blocked: target._id } };

    await User.updateOne({ _id: req.userId }, update);

    return res.json({ blocked: req.body.blocked });
  } catch (err) {
    console.error("block user error:", err);
    return res.status(500).json({ message: "Could not update block status" });
  }
});

/** GET /api/user/ — list all users (kept out: not needed by the app) */
router.get("/", requireAuth, (_req, res) => {
  return res.status(404).json({ message: "Not found" });
});

export default router;
