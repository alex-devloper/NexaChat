import { Server as HttpServer } from "http";
import { Server, Socket } from "socket.io";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";

import { getJwtSecret } from "../config/env";
import { sendPushToUser } from "../lib/push";
import { cleanString, LIMITS } from "../utils/validate";
import User from "../models/User";
import Conversation from "../models/Conversation";
import Message from "../models/Message";

type OnlineUser = {
  userId: string;
  name: string;
  username: string;
  profilePic: string;
};

const onlineUsers = new Map<string, OnlineUser>();

const userRoom = (userId: string) => `user:${userId}`;

const DELETE_FOR_EVERYONE_WINDOW_MS = 15 * 60 * 1000;
const RING_TIMEOUT_MS = 45_000;

type ActiveCall = {
  callId: string;
  fromUserId: string;
  toUserId: string;
  callType: "audio" | "video";
  offer: unknown;
  callerName: string;
  callerPic: string;
  answered: boolean;
  answeredAt?: number;
  timeout: ReturnType<typeof setTimeout> | null;
};

type CallOutcome = "answered" | "missed" | "declined" | "cancelled";

/** Human readable chat-list text for a `[call]type|outcome|seconds` entry. */
function callLabel(text: string): string {
  const [type, outcome, seconds] = text.slice(6).split("|");
  const kind = type === "video" ? "Video" : "Voice";
  const duration = Number(seconds || 0);

  if (outcome === "answered") {
    const m = Math.floor(duration / 60);
    const s = duration % 60;
    return `📞 ${kind} call · ${m}:${s.toString().padStart(2, "0")}`;
  }

  if (outcome === "declined") return `📞 ${kind} call declined`;

  return `📞 Missed ${kind.toLowerCase()} call`;
}

/** Live calls, so a reconnecting or newly opened app still gets the ring. */
const activeCalls = new Map<string, ActiveCall>();

const MAX_MESSAGE_LENGTH = LIMITS.message;
const MAX_SDP_JSON_LENGTH = 20_000;

/** Push notification icons must be absolute URLs. */
function absoluteMediaUrl(path?: string): string | undefined {
  if (!path) return undefined;
  if (/^https?:\/\//i.test(path)) return path;

  const base = (process.env.PUBLIC_BASE_URL || "").replace(/\/+$/, "");
  return base ? `${base}${path}` : undefined;
}

/**
 * Tiny per-socket rate limiter. Protects the server from one client spamming
 * messages, typing events or call signals.
 */
function createLimiter(limit: number, windowMs: number) {
  let windowStart = Date.now();
  let count = 0;

  return () => {
    const now = Date.now();
    if (now - windowStart > windowMs) {
      windowStart = now;
      count = 0;
    }
    count += 1;
    return count <= limit;
  };
}

function isSdpPayload(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  try {
    return JSON.stringify(value).length < MAX_SDP_JSON_LENGTH;
  } catch {
    return false;
  }
}

function extractToken(socket: Socket): string | null {
  const fromAuth = socket.handshake.auth?.token;
  if (typeof fromAuth === "string" && fromAuth.trim()) {
    return fromAuth.replace(/^Bearer\s+/i, "").trim();
  }

  const header = socket.handshake.headers.authorization;
  if (typeof header === "string") {
    const [scheme, token] = header.split(" ");
    if (scheme?.toLowerCase() === "bearer" && token) return token.trim();
  }

  return null;
}

const conversationKey = (a: string, b: string) => [a, b].sort().join("_");

async function findOrCreateConversation(a: string, b: string) {
  const pairKey = conversationKey(a, b);

  const byKey = await Conversation.findOne({ pairKey });
  if (byKey) return byKey;

  // Older conversations may predate pairKey: adopt one instead of duplicating.
  const legacy = await Conversation.findOne({
    participants: {
      $all: [
        new mongoose.Types.ObjectId(a),
        new mongoose.Types.ObjectId(b),
      ],
      $size: 2,
    },
  });

  if (legacy) {
    if (!legacy.pairKey) {
      legacy.pairKey = pairKey;
      await legacy.save().catch(() => {});
    }
    return legacy;
  }

  try {
    return await Conversation.create({
      participants: [
        new mongoose.Types.ObjectId(a),
        new mongoose.Types.ObjectId(b),
      ],
      pairKey,
      lastMessage: "",
      lastMessageTime: new Date(),
    });
  } catch (err) {
    // Two first messages at the same instant: the unique index picks one.
    if ((err as { code?: number }).code === 11000) {
      const found = await Conversation.findOne({ pairKey });
      if (found) return found;
    }
    throw err;
  }
}

export function initSocket(server: HttpServer) {
  const io = new Server(server, {
    cors: {
      origin: process.env.CORS_ORIGIN
        ? process.env.CORS_ORIGIN.split(",")
        : true,
      credentials: true,
    },
  });

  // ---- Handshake authentication ----
  io.use((socket, next) => {
    const token = extractToken(socket);

    if (!token) {
      return next(new Error("Authentication required"));
    }

    try {
      const payload = jwt.verify(token, getJwtSecret()) as {
        userId?: string;
      };

      if (!payload?.userId) {
        return next(new Error("Invalid token"));
      }

      // Identity comes from the verified token only.
      socket.data.userId = String(payload.userId);
      return next();
    } catch {
      return next(new Error("Invalid or expired token"));
    }
  });

  io.on("connection", (socket) => {
    const userId: string = socket.data.userId;

    socket.join(userRoom(userId));

    console.log(`🔌 socket connected user=${userId} id=${socket.id}`);

    const broadcastOnline = () => {
      io.emit("onlineUsers", Array.from(onlineUsers.values()));
    };

    // Abuse protection per connection.
    const messageLimiter = createLimiter(30, 10_000);
    const typingLimiter = createLimiter(25, 10_000);
    const callLimiter = createLimiter(40, 60_000);

    socket.on("joinUser", async (payload: unknown) => {
      try {
        // Any client-sent userId is ignored; only cosmetic data is read.
        void payload;

        const user = await User.findById(userId).select(
          "name username profilePic"
        );

        if (!user) return;

        onlineUsers.set(userId, {
          userId,
          name: user.name,
          username: user.username,
          profilePic: user.profilePic || "",
        });

        user.isOnline = true;
        user.lastSeen = new Date();
        await user.save();

        broadcastOnline();

        // Re-deliver a ring that started while this client was connecting.
        for (const call of activeCalls.values()) {
          if (call.toUserId === userId && !call.answered) {
            socket.emit("incomingCall", {
              callId: call.callId,
              fromUserId: call.fromUserId,
              fromName: call.callerName,
              fromProfilePic: call.callerPic,
              callType: call.callType,
              offer: call.offer,
            });
          }
        }
      } catch (err) {
        console.error("joinUser error:", err);
      }
    });

    socket.on(
      "privateMessage",
      async (payload: {
        receiverId?: string;
        message?: string;
        tempId?: string;
        replyToId?: string | null;
        replyText?: string | null;
        replyToSelf?: boolean;
      }) => {
        try {
          if (!messageLimiter()) return;

          const senderId = userId; // never trust payload.senderId
          const receiverId = String(payload?.receiverId || "");
          const rawText =
            typeof payload?.message === "string" ? payload.message : "";

          if (
            !mongoose.isValidObjectId(receiverId) ||
            receiverId === senderId ||
            !rawText.trim() ||
            rawText.length > MAX_MESSAGE_LENGTH
          ) {
            return;
          }

          const text = cleanString(rawText, MAX_MESSAGE_LENGTH);
          if (!text) return;

          // Never create conversations with user ids that do not exist.
          const receiverUser = await User.findById(receiverId).select(
            "_id blocked"
          );
          if (!receiverUser) return;

          // Blocking: nothing is delivered in either direction.
          const senderDoc = await User.findById(senderId).select("blocked");
          const blocked = (list?: unknown[]) =>
            (list || []).some((id) => String(id) === receiverId);
          const iBlockedThem = blocked(senderDoc?.blocked);
          const theyBlockedMe = (receiverUser.blocked || []).some(
            (id) => String(id) === senderId
          );

          if (iBlockedThem || theyBlockedMe) {
            socket.emit("messageBlocked", {
              tempId: payload?.tempId || null,
              reason: iBlockedThem
                ? "You blocked this user. Unblock to send messages."
                : "This message could not be delivered.",
            });
            return;
          }

          const conversation = await findOrCreateConversation(
            senderId,
            receiverId
          );

          const receiverOnline = onlineUsers.has(receiverId);

          const message = await Message.create({
            conversation: conversation._id,
            sender: new mongoose.Types.ObjectId(senderId),
            receiver: new mongoose.Types.ObjectId(receiverId),
            message: text,
            deliveredAt: receiverOnline ? new Date() : null,
            replyToId:
              payload?.replyToId &&
              mongoose.isValidObjectId(payload.replyToId)
                ? new mongoose.Types.ObjectId(payload.replyToId)
                : null,
            replyText: cleanString(payload?.replyText, LIMITS.replyText) || null,
            replyToSelf: !!payload?.replyToSelf,
          });

          conversation.lastMessage = text;
          conversation.lastMessageTime = message.createdAt;
          await conversation.save();

          io.to(userRoom(senderId)).emit("messageSent", {
            tempId: payload?.tempId,
            messageId: message._id.toString(),
            conversationId: conversation._id.toString(),
            createdAt: message.createdAt,
          });

          const sender = await User.findById(senderId).select(
            "name username profilePic"
          );

          io.to(userRoom(receiverId)).emit("receivePrivateMessage", {
            _id: message._id.toString(),
            conversationId: conversation._id.toString(),
            sender: senderId,
            senderName: sender?.name || "User",
            senderProfilePic: sender?.profilePic || "",
            receiver: receiverId,
            message: text,
            createdAt: message.createdAt,
            seenAt: message.seenAt,
            deliveredAt: message.deliveredAt,
            replyText: message.replyText,
            replyToSelf: message.replyToSelf,
          });

          if (receiverOnline) {
            io.to(userRoom(senderId)).emit("messageDelivered", {
              messageId: message._id.toString(),
            });
          } else {
            // Receiver has no open socket: send a browser push notification.
            void sendPushToUser(receiverId, {
              title: sender?.name || "New message",
              body: text.startsWith("[file-")
                ? "Sent you an attachment"
                : text.startsWith("[contact]")
                ? "Shared a contact"
                : text.startsWith("[location]")
                ? "Shared a location"
                : text.slice(0, 120),
              url: `/chat?user=${senderId}`,
              tag: `chat-${senderId}`,
              icon: absoluteMediaUrl(sender?.profilePic),
            }).catch(() => {});
          }
        } catch (err) {
          console.error("privateMessage error:", err);
        }
      }
    );

    socket.on(
      "markSeen",
      async (payload: { senderId?: string; receiverId?: string }) => {
        try {
          // The viewer is always the authenticated socket user.
          const receiverId = userId;
          const senderId = String(payload?.senderId || "");

          if (!mongoose.isValidObjectId(senderId)) return;

          const seenAt = new Date();

          await Message.updateMany(
            {
              sender: new mongoose.Types.ObjectId(senderId),
              receiver: new mongoose.Types.ObjectId(receiverId),
              seenAt: null,
            },
            { $set: { seenAt, deliveredAt: seenAt } }
          );

          io.to(userRoom(senderId)).emit("messagesSeen", {
            senderId,
            receiverId,
            seenAt,
          });
        } catch (err) {
          console.error("markSeen error:", err);
        }
      }
    );

    socket.on(
      "chatOpen",
      async (payload: { otherId?: string }) => {
        try {
          const viewerId = userId;
          const otherId = String(payload?.otherId || "");

          if (!mongoose.isValidObjectId(otherId)) return;

          const seenAt = new Date();

          await Message.updateMany(
            {
              sender: new mongoose.Types.ObjectId(otherId),
              receiver: new mongoose.Types.ObjectId(viewerId),
              seenAt: null,
            },
            { $set: { seenAt, deliveredAt: seenAt } }
          );

          io.to(userRoom(otherId)).emit("messagesSeen", {
            senderId: otherId,
            receiverId: viewerId,
            seenAt,
          });
        } catch (err) {
          console.error("chatOpen error:", err);
        }
      }
    );

    socket.on("chatClose", () => {
      // Nothing to clean up server-side; kept for client compatibility.
    });

    socket.on(
      "typing",
      (payload: { toUserId?: string }) => {
        if (!typingLimiter()) return;

        const toUserId = String(payload?.toUserId || "");
        if (!mongoose.isValidObjectId(toUserId)) return;

        io.to(userRoom(toUserId)).emit("typing", {
          fromUserId: userId, // never trust payload.fromUserId
        });
      }
    );

    socket.on(
      "stopTyping",
      (payload: { toUserId?: string }) => {
        const toUserId = String(payload?.toUserId || "");
        if (!mongoose.isValidObjectId(toUserId)) return;

        io.to(userRoom(toUserId)).emit("stopTyping", {
          fromUserId: userId,
        });
      }
    );

    socket.on(
      "deleteMessage",
      async (payload: {
        messageId?: string;
        otherUserId?: string;
        deleteForEveryone?: boolean;
      }) => {
        try {
          const messageId = String(payload?.messageId || "");
          if (!mongoose.isValidObjectId(messageId)) return;

          const message = await Message.findById(messageId);
          if (!message) return;

          // Only the two people in this chat may touch the message.
          if (
            message.sender.toString() !== userId &&
            message.receiver.toString() !== userId
          ) {
            return;
          }

          const isSender = message.sender.toString() === userId;

          if (payload?.deleteForEveryone) {
            // Only the sender may delete for everyone.
            if (!isSender) {
              socket.emit("messageDeleteError", {
                messageId,
                message: "Only the sender can delete this message for everyone",
              });
              return;
            }

            // 15-minute window is enforced on the server, not just the UI.
            const ageMs = Date.now() - message.createdAt.getTime();
            if (ageMs > DELETE_FOR_EVERYONE_WINDOW_MS) {
              socket.emit("messageDeleteError", {
                messageId,
                message:
                  "Delete for everyone is only possible within 15 minutes",
              });
              return;
            }

            message.isDeletedForEveryone = true;
            await message.save();

            const participants = [message.sender, message.receiver];
            participants.forEach((participantId) => {
              io.to(userRoom(participantId.toString())).emit(
                "messageDeleted",
                {
                  messageId: message._id.toString(),
                  deleteForEveryone: true,
                }
              );
            });
            return;
          }

          // "Delete for me" is always allowed, but only for yourself.
          if (
            message.deletedFor.some((id) => id.toString() === userId)
          ) {
            return;
          }

          message.deletedFor.push(new mongoose.Types.ObjectId(userId));
          await message.save();

          io.to(userRoom(userId)).emit("messageDeleted", {
            messageId: message._id.toString(),
            deleteForEveryone: false,
          });
        } catch (err) {
          console.error("deleteMessage error:", err);
        }
      }
    );

    // ---- Audio / video call signaling (WebRTC) ----
    // The server keeps a small registry of live calls. It relays SDP/ICE,
    // re-delivers the ring to a reconnecting client, always sends a push so a
    // backgrounded app still notifies, and cleans up after a timeout.
    // Media itself stays peer-to-peer.
    const callTypeOf = (value: unknown): "audio" | "video" =>
      value === "video" ? "video" : "audio";

    const otherSideOf = (call: ActiveCall, sideUserId: string) =>
      call.fromUserId === sideUserId ? call.toUserId : call.fromUserId;

    const ringPayload = (call: ActiveCall) => ({
      callId: call.callId,
      fromUserId: call.fromUserId,
      fromName: call.callerName,
      fromProfilePic: call.callerPic,
      callType: call.callType,
      offer: call.offer,
    });

    /** Saves a WhatsApp-style call entry in the conversation history. */
    const saveCallLog = async (call: ActiveCall, outcome: CallOutcome) => {
      try {
        const duration = call.answeredAt
          ? Math.max(0, Math.round((Date.now() - call.answeredAt) / 1000))
          : 0;

        const conversation = await findOrCreateConversation(
          call.fromUserId,
          call.toUserId
        );

        const text = `[call]${call.callType}|${outcome}|${duration}`;

        const message = await Message.create({
          conversation: conversation._id,
          sender: new mongoose.Types.ObjectId(call.fromUserId),
          receiver: new mongoose.Types.ObjectId(call.toUserId),
          message: text,
          deliveredAt: new Date(),
          seenAt: new Date(),
        });

        conversation.lastMessage = callLabel(text);
        conversation.lastMessageTime = message.createdAt;
        await conversation.save();

        const payload = {
          _id: message._id.toString(),
          conversationId: conversation._id.toString(),
          sender: call.fromUserId,
          receiver: call.toUserId,
          message: text,
          createdAt: message.createdAt,
        };

        io.to(userRoom(call.fromUserId)).emit("callLogged", payload);
        io.to(userRoom(call.toUserId)).emit("callLogged", payload);
      } catch (err) {
        console.error("call log error:", err);
      }
    };

    const endActiveCall = (call: ActiveCall, reason: string) => {
      if (call.timeout) clearTimeout(call.timeout);
      activeCalls.delete(call.callId);

      const outcome: CallOutcome = call.answered
        ? "answered"
        : reason === "declined"
        ? "declined"
        : reason === "no-answer" || reason === "disconnected"
        ? "missed"
        : "cancelled";

      void saveCallLog(call, outcome);

      io.to(userRoom(call.fromUserId)).emit("callEnded", {
        callId: call.callId,
        reason,
      });
      io.to(userRoom(call.toUserId)).emit("callEnded", {
        callId: call.callId,
        reason,
      });
    };

    socket.on(
      "callUser",
      async (payload: {
        callId?: string;
        toUserId?: string;
        callType?: string;
        offer?: unknown;
      }) => {
        const callId = String(payload?.callId || "").trim();

        console.log(
          `📨 callUser received from=${userId} to=${payload?.toUserId} callId=${callId} offer=${!!payload?.offer}`
        );

        try {
          if (!callLimiter()) {
            console.warn("callUser blocked by rate limiter");
            return;
          }

          const toUserId = String(payload?.toUserId || "");
          if (!callId || callId.length > 64) return;
          if (!mongoose.isValidObjectId(toUserId) || toUserId === userId) {
            return;
          }
          if (!isSdpPayload(payload?.offer)) return;
          if (activeCalls.has(callId)) return;

          // Busy check: don't let a third person overwrite a live call.
          for (const call of activeCalls.values()) {
            if (
              call.toUserId === toUserId ||
              (call.fromUserId === toUserId && call.answered) ||
              call.fromUserId === userId
            ) {
              socket.emit("callBusy", { callId });
              return;
            }
          }

          const receiver = await User.findById(toUserId).select("_id blocked");
          if (!receiver) {
            socket.emit("callFailed", { callId, reason: "User not found" });
            return;
          }

          const callerDoc = await User.findById(userId).select("blocked");
          const callBlocked =
            (callerDoc?.blocked || []).some(
              (id) => String(id) === toUserId
            ) ||
            (receiver.blocked || []).some((id) => String(id) === userId);

          if (callBlocked) {
            socket.emit("callFailed", {
              callId,
              reason: "This contact is unavailable",
            });
            return;
          }

          const caller = await User.findById(userId).select(
            "name username profilePic"
          );

          const call: ActiveCall = {
            callId,
            fromUserId: userId,
            toUserId,
            callType: callTypeOf(payload?.callType),
            offer: payload.offer,
            callerName: caller?.name || caller?.username || "User",
            callerPic: caller?.profilePic || "",
            answered: false,
            timeout: null,
          };

          activeCalls.set(callId, call);

          call.timeout = setTimeout(() => {
            const live = activeCalls.get(callId);
            if (!live || live.answered) return;

            socket.emit("callRejected", {
              callId,
              fromUserId: toUserId,
              reason: "no-answer",
            });

            endActiveCall(live, "no-answer");
          }, RING_TIMEOUT_MS);

          socket.emit("callRinging", { callId });
          io.to(userRoom(toUserId)).emit("incomingCall", ringPayload(call));

          console.log(
            `📞 call ${callId} ${userId} -> ${toUserId} (online: ${onlineUsers.has(
              toUserId
            )})`
          );

          // Always push: the receiver may be backgrounded, on another page,
          // or on a device whose socket dropped.
          void sendPushToUser(toUserId, {
            title: `Incoming ${call.callType} call`,
            body: `${call.callerName} is calling you`,
            url: `/chat?user=${userId}`,
            tag: `call-${callId}`,
            icon: absoluteMediaUrl(call.callerPic),
          }).catch(() => {});
        } catch (err) {
          console.error("callUser error:", err);
          socket.emit("callFailed", {
            callId,
            reason: "Could not start the call",
          });
        }
      }
    );

    socket.on(
      "callAnswer",
      (payload: { callId?: string; answer?: unknown }) => {
        const call = activeCalls.get(String(payload?.callId || ""));
        if (!call || call.toUserId !== userId) return;
        if (!isSdpPayload(payload?.answer)) return;

        call.answered = true;
        call.answeredAt = Date.now();
        if (call.timeout) clearTimeout(call.timeout);
        call.timeout = null;

        io.to(userRoom(call.fromUserId)).emit("callAnswered", {
          callId: call.callId,
          fromUserId: userId,
          answer: payload.answer,
        });

        console.log(`✅ call ${call.callId} answered`);
      }
    );

    socket.on(
      "iceCandidate",
      (payload: { callId?: string; candidate?: unknown }) => {
        if (!callLimiter()) return;

        const call = activeCalls.get(String(payload?.callId || ""));
        if (!call || !payload?.candidate) return;
        if (userId !== call.fromUserId && userId !== call.toUserId) return;

        io.to(userRoom(otherSideOf(call, userId))).emit("iceCandidate", {
          callId: call.callId,
          fromUserId: userId,
          candidate: payload.candidate,
        });
      }
    );

    socket.on(
      "callRejected",
      (payload: { callId?: string; reason?: string }) => {
        const call = activeCalls.get(String(payload?.callId || ""));
        if (!call || call.toUserId !== userId) return;

        io.to(userRoom(call.fromUserId)).emit("callRejected", {
          callId: call.callId,
          fromUserId: userId,
          reason: cleanString(payload?.reason, 80) || "declined",
        });

        endActiveCall(call, "declined");
      }
    );

    socket.on("callEnded", (payload: { callId?: string }) => {
      const call = activeCalls.get(String(payload?.callId || ""));
      if (!call) return;
      if (userId !== call.fromUserId && userId !== call.toUserId) return;

      endActiveCall(call, call.answered ? "ended" : "cancelled");
    });

    socket.on("disconnect", async () => {
      try {
        // Multiple tabs/devices share one user room: only clean up when the
        // last connection is gone, otherwise a background tab would kill a
        // live call.
        const remaining = await io.in(userRoom(userId)).fetchSockets();
        if (remaining.length > 0) return;

        for (const call of Array.from(activeCalls.values())) {
          if (call.fromUserId === userId || call.toUserId === userId) {
            endActiveCall(call, "disconnected");
          }
        }

        onlineUsers.delete(userId);

        await User.findByIdAndUpdate(userId, {
          isOnline: false,
          lastSeen: new Date(),
        });

        broadcastOnline();
      } catch (err) {
        console.error("disconnect error:", err);
      }
    });
  });

  return io;
}
