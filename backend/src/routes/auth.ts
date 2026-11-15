import crypto from "crypto";
import { Router } from "express";
import bcrypt from "bcryptjs";
import User, { toPublicUser } from "../models/User";
import { requireAuth, signToken } from "../middleware/auth";
import { authLimiter, loginLimiter, searchLimiter } from "../middleware/rateLimit";
import {
  cleanString,
  isValidEmail,
  isValidPassword,
  isValidUsername,
  LIMITS,
} from "../utils/validate";

const router = Router();

const RESET_TOKEN_TTL_MS = 15 * 60 * 1000;

function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/** POST /api/auth/signup */
router.post("/signup", authLimiter, async (req, res) => {
  try {
    const name = cleanString(req.body?.name, LIMITS.name);
    const normalizedUsername = cleanString(
      req.body?.username,
      LIMITS.username
    ).toLowerCase();
    const normalizedEmail = cleanString(
      req.body?.email,
      LIMITS.email
    ).toLowerCase();
    const password =
      typeof req.body?.password === "string" ? req.body.password : "";

    if (!name || !normalizedUsername || !normalizedEmail || !password) {
      return res
        .status(400)
        .json({ message: "Name, username, email and password are required" });
    }

    if (!isValidUsername(normalizedUsername)) {
      return res.status(400).json({
        message:
          "Username must be 3-24 characters (letters, numbers, dot or underscore)",
      });
    }

    if (!isValidEmail(normalizedEmail)) {
      return res
        .status(400)
        .json({ message: "Please enter a valid email address" });
    }

    if (!isValidPassword(password)) {
      return res
        .status(400)
        .json({ message: "Password must be 6-128 characters" });
    }

    const existing = await User.findOne({
      $or: [{ email: normalizedEmail }, { username: normalizedUsername }],
    });

    if (existing) {
      return res
        .status(409)
        .json({ message: "Email or username already registered" });
    }

    const hashed = await bcrypt.hash(String(password), 10);

    const user = await User.create({
      name,
      username: normalizedUsername,
      email: normalizedEmail,
      password: hashed,
      about: "",
      profilePic: "",
    });

    const token = signToken(user._id.toString());

    return res.status(201).json({
      message: "Signup successful 🎉",
      token,
      user: toPublicUser(user),
    });
  } catch (err) {
    console.error("signup error:", err);
    return res.status(500).json({ message: "Signup failed" });
  }
});

/** POST /api/auth/login */
router.post("/login", loginLimiter, async (req, res) => {
  try {
    const emailOrUsername = cleanString(
      req.body?.emailOrUsername,
      LIMITS.email
    );
    const password =
      typeof req.body?.password === "string" ? req.body.password : "";

    if (!emailOrUsername || !password) {
      return res
        .status(400)
        .json({ message: "Email/username and password are required" });
    }

    const identifier = emailOrUsername.toLowerCase();

    const user = await User.findOne({
      $or: [{ email: identifier }, { username: identifier }],
    });

    if (!user) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const ok = await bcrypt.compare(String(password), user.password);
    if (!ok) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    user.isOnline = true;
    user.lastSeen = new Date();
    await user.save();

    return res.json({
      token: signToken(user._id.toString()),
      user: toPublicUser(user),
    });
  } catch (err) {
    console.error("login error:", err);
    return res.status(500).json({ message: "Login failed" });
  }
});

/** GET /api/auth/search/:query (private) */
router.get("/search/:query", requireAuth, searchLimiter, async (req, res) => {
  try {
    const q = cleanString(req.params.query, LIMITS.search).toLowerCase();
    if (!q) return res.status(400).json({ message: "Search text required" });

    const user = await User.findOne({ username: q });

    if (!user || user._id.toString() === req.userId) {
      return res.status(404).json({ message: "User not found" });
    }

    return res.json({
      user: {
        userId: user._id.toString(),
        name: user.name,
        username: user.username,
        profilePic: user.profilePic || "",
      },
    });
  } catch (err) {
    console.error("search error:", err);
    return res.status(500).json({ message: "Search failed" });
  }
});

/** GET /api/auth/suggest?q=... (private) — live username suggestions */
router.get("/suggest", requireAuth, searchLimiter, async (req, res) => {
  try {
    const raw = cleanString(req.query.q, LIMITS.search).toLowerCase();

    // Too short to be useful (and keeps the query cheap).
    if (raw.length < 2) return res.json({ users: [] });

    const escaped = raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const contains = new RegExp(escaped, "i");

    const matches = await User.find({
      _id: { $ne: req.userId },
      $or: [{ username: contains }, { name: contains }],
    })
      .select("name username profilePic")
      .limit(40)
      .lean();

    // Prefix matches first (like typing "chi" → "chiraj"), then name matches.
    const rank = (u: {
      name?: string;
      username?: string;
    }): number => {
      const username = (u.username || "").toLowerCase();
      const name = (u.name || "").toLowerCase();
      if (username.startsWith(raw)) return 0;
      if (name.startsWith(raw)) return 1;
      if (username.includes(raw)) return 2;
      return 3;
    };

    const users = matches
      .map((u) => ({ u, r: rank(u) }))
      .sort(
        (a, b) =>
          a.r - b.r ||
          (a.u.username || "").localeCompare(b.u.username || "")
      )
      .slice(0, 8)
      .map(({ u }) => ({
        userId: String(u._id),
        name: u.name,
        username: u.username,
        profilePic: u.profilePic || "",
      }));

    return res.json({ users });
  } catch (err) {
    console.error("suggest error:", err);
    return res.status(500).json({ message: "Search failed" });
  }
});

/** POST /api/auth/forgot-password */
router.post("/forgot-password", authLimiter, async (req, res) => {
  try {
    const email = cleanString(req.body?.email, LIMITS.email).toLowerCase();
    if (!isValidEmail(email)) {
      return res.status(400).json({ message: "Please enter a valid email" });
    }

    const user = await User.findOne({ email });

    // Same response either way: never reveal whether an email is registered.
    const genericMessage =
      "If that email is registered, a password reset link has been sent.";

    if (!user) {
      return res.json({ message: genericMessage });
    }

    const rawToken = crypto.randomBytes(32).toString("hex");

    user.resetTokenHash = hashToken(rawToken);
    user.resetTokenExpiry = new Date(Date.now() + RESET_TOKEN_TTL_MS);
    await user.save();

    // No mail provider is configured in this project yet. When one is added,
    // send the link from here instead of returning the token.
    const resetUrl = `${
      process.env.APP_URL || "http://localhost:5173"
    }/reset-password?token=${rawToken}`;

    const isProduction = process.env.NODE_ENV === "production";

    // NEVER hand the token to the API caller in production: that would let
    // anyone reset anyone's password from the forgot-password response.
    const expose = !isProduction && process.env.EXPOSE_RESET_TOKEN === "true";

    if (!isProduction) {
      // Local development without a mail provider: the link is printed in the
      // server log only, never in an HTTP response (unless explicitly enabled).
      console.log(`🔐 Password reset link (dev only): ${resetUrl}`);
    }

    if (isProduction) {
      console.warn(
        "No mail provider is configured: a password reset link was generated but not delivered."
      );
    }

    const payload: Record<string, unknown> = { message: genericMessage };

    if (expose) {
      payload.resetToken = rawToken;
      payload.resetUrl = resetUrl;
    }

    return res.json(payload);
  } catch (err) {
    console.error("forgot-password error:", err);
    return res.status(500).json({ message: "Could not process request" });
  }
});

/** POST /api/auth/reset-password */
router.post("/reset-password", authLimiter, async (req, res) => {
  try {
    const token = cleanString(req.body?.token, 200);
    const newPassword =
      typeof req.body?.newPassword === "string" ? req.body.newPassword : "";

    if (!token || !newPassword) {
      return res
        .status(400)
        .json({ message: "Token and new password are required" });
    }

    if (!isValidPassword(newPassword)) {
      return res
        .status(400)
        .json({ message: "Password must be 6-128 characters" });
    }

    const user = await User.findOne({
      resetTokenHash: hashToken(token),
      resetTokenExpiry: { $gt: new Date() },
    });

    if (!user) {
      return res.status(400).json({ message: "Invalid or expired reset link" });
    }

    user.password = await bcrypt.hash(newPassword, 10);
    user.resetTokenHash = null;
    user.resetTokenExpiry = null;
    await user.save();

    return res.json({ message: "Password reset successful ✅" });
  } catch (err) {
    console.error("reset-password error:", err);
    return res.status(500).json({ message: "Could not reset password" });
  }
});

/** POST /api/auth/change-password — logged in users only */
router.post("/change-password", requireAuth, authLimiter, async (req, res) => {
  try {
    const currentPassword =
      typeof req.body?.currentPassword === "string"
        ? req.body.currentPassword
        : "";
    const newPassword =
      typeof req.body?.newPassword === "string" ? req.body.newPassword : "";

    if (!currentPassword || !newPassword) {
      return res
        .status(400)
        .json({ message: "Current and new password are required" });
    }

    if (!isValidPassword(newPassword)) {
      return res
        .status(400)
        .json({ message: "Password must be 6-128 characters" });
    }

    if (currentPassword === newPassword) {
      return res
        .status(400)
        .json({ message: "New password must be different" });
    }

    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    const ok = await bcrypt.compare(currentPassword, user.password);
    if (!ok) {
      return res.status(401).json({ message: "Current password is incorrect" });
    }

    user.password = await bcrypt.hash(newPassword, 10);
    await user.save();

    return res.json({ message: "✅ Password changed successfully" });
  } catch (err) {
    console.error("change-password error:", err);
    return res.status(500).json({ message: "Could not change password" });
  }
});

export default router;
