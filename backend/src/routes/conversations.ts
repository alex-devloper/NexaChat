import { Router } from "express";
import mongoose from "mongoose";
import Conversation from "../models/Conversation";
import { requireAuth } from "../middleware/auth";

const router = Router();

/**
 * GET /api/conversations/:userId
 * Ownership enforced: the path userId must be the authenticated user.
 * Only conversations that belong to the caller are returned.
 */
router.get("/:userId", requireAuth, async (req, res) => {
  try {
    const { userId } = req.params;

    if (!mongoose.isValidObjectId(userId)) {
      return res.status(400).json({ message: "Invalid user id" });
    }

    if (req.userId !== userId) {
      return res
        .status(403)
        .json({ message: "You can only read your own conversations" });
    }

    const conversations = await Conversation.find({
      participants: new mongoose.Types.ObjectId(userId),
    })
      .sort({ lastMessageTime: -1 })
      .populate("participants", "name username profilePic");

    const chats = conversations
      .map((conv) => {
        const participants = conv.participants as unknown as Array<{
          _id: mongoose.Types.ObjectId;
          name?: string;
          username?: string;
          profilePic?: string;
        }>;

        const other = participants.find((p) => p._id.toString() !== userId);
        if (!other) return null;

        // A chat the user cleared shows an empty preview only for them.
        const clearedAt = conv.clearedFor?.get(userId);
        const cleared =
          !!clearedAt && conv.lastMessageTime <= new Date(clearedAt);

        return {
          conversationId: conv._id.toString(),
          userId: other._id.toString(),
          name: other.name || other.username || "User",
          username: other.username || "",
          profilePic: other.profilePic || "",
          lastMessage: cleared ? "" : conv.lastMessage || "",
          lastMessageTime: conv.lastMessageTime,
          isSeen: true,
        };
      })
      .filter(Boolean);

    return res.json({ chats });
  } catch (err) {
    console.error("conversations error:", err);
    return res.status(500).json({ message: "Could not load conversations" });
  }
});

export default router;
