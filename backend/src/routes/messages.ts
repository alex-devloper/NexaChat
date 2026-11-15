import { Router } from "express";
import mongoose from "mongoose";
import Conversation from "../models/Conversation";
import Message from "../models/Message";
import { requireAuth } from "../middleware/auth";

const router = Router();

const PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

/**
 * GET /api/messages/conversation/:id
 * Ownership enforced: the caller must be a participant of the conversation.
 * Messages the caller deleted "for me" are hidden server-side as well.
 */
router.get("/conversation/:id", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ message: "Invalid conversation id" });
    }

    const conversation = await Conversation.findById(id);
    if (!conversation) {
      return res.status(404).json({ message: "Conversation not found" });
    }

    const isParticipant = conversation.participants.some(
      (p) => p.toString() === req.userId
    );

    if (!isParticipant) {
      return res
        .status(403)
        .json({ message: "You are not part of this conversation" });
    }

    // Paginated: long chats must not send thousands of messages at once.
    const limitRaw = Number(req.query.limit);
    const limit =
      Number.isFinite(limitRaw) && limitRaw > 0
        ? Math.min(Math.floor(limitRaw), MAX_PAGE_SIZE)
        : PAGE_SIZE;

    const beforeRaw =
      typeof req.query.before === "string"
        ? new Date(req.query.before)
        : null;
    const before =
      beforeRaw && !Number.isNaN(beforeRaw.getTime()) ? beforeRaw : null;

    const filter: Record<string, unknown> = {
      conversation: conversation._id,
      deletedFor: { $ne: new mongoose.Types.ObjectId(req.userId) },
    };

    if (before) filter.createdAt = { $lt: before };

    // Newest first for the page, then restored to chronological order.
    const batch = await Message.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit + 1);

    const hasMore = batch.length > limit;
    const messages = batch.slice(0, limit).reverse();

    return res.json({ messages, hasMore });
  } catch (err) {
    console.error("messages error:", err);
    return res.status(500).json({ message: "Could not load messages" });
  }
});

/**
 * POST /api/messages/clear/:otherUserId
 * "Clear chat" for me only: messages stay for the other person.
 */
router.post("/clear/:otherUserId", requireAuth, async (req, res) => {
  try {
    const { otherUserId } = req.params;

    if (!mongoose.isValidObjectId(otherUserId)) {
      return res.status(400).json({ message: "Invalid user id" });
    }

    const me = new mongoose.Types.ObjectId(req.userId);
    const other = new mongoose.Types.ObjectId(otherUserId);

    const result = await Message.updateMany(
      {
        $or: [
          { sender: me, receiver: other },
          { sender: other, receiver: me },
        ],
      },
      { $addToSet: { deletedFor: me } }
    );

    // Only this user's chat list preview is emptied; the other side is untouched.
    await Conversation.updateOne(
      { participants: { $all: [me, other] } },
      { $set: { [`clearedFor.${req.userId}`]: new Date() } }
    );

    return res.json({ cleared: result.modifiedCount });
  } catch (err) {
    console.error("clear chat error:", err);
    return res.status(500).json({ message: "Could not clear this chat" });
  }
});

export default router;
