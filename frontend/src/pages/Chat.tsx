import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import type { Socket } from "socket.io-client";
import { api, API_URL } from "../lib/api";
import { useSocket } from "../lib/socketContext";

import VoiceHoldRecorder from "../components/chat/VoiceHoldRecorder";
import VoiceMessageBubble from "../components/chat/VoiceMessageBubble";
import CallOverlay from "../components/chat/CallOverlay";
import type { CallMode } from "../components/chat/CallOverlay";
import Navbar from "../components/Navbar";
import { disablePush, enablePush } from "../lib/push";
import { openPhotoViewer } from "../lib/photoViewer";
import SelectedFileChip from "../components/chat/SelectedFileChip";
import AttachMenu from "../components/chat/AttachMenu";
import type { AttachMode } from "../components/chat/AttachMenu";
import { compressImageFile, fileToWallpaper } from "../lib/image";
import ChatSettingsSheet from "../components/chat/ChatSettingsSheet";
import { getChatPrefs, setChatPrefs } from "../lib/chatPrefs";
import { logoutAndRedirect } from "../lib/session";
import ShareContactModal from "../components/chat/ShareContactModal";
import type { SharedContact } from "../components/chat/ShareContactModal";
import { getSettings, saveSettings } from "../lib/settings";

const ALERTS_KEY = "nexachat_alerts";

type ChatItem = {
  conversationId: string;
  userId: string;
  name?: string;
  username?: string;
  lastMessage: string;
  lastMessageTime: string;
  isSeen: boolean;
  unreadCount?: number;
  profilePic?: string;
};

type SelectedUser = {
  conversationId?: string;
  userId: string;
  name: string;
  username?: string;
  profilePic?: string; // ✅ ADDED
};

type MsgStatus = "sending" | "sent" | "delivered" | "seen";

const CALL_MARK = "[call]";
const CONTACT_MARK = "[contact]";
const LOCATION_MARK = "[location]";
const DOC_MARK = "[file-doc]";

/** `[file-doc]mime|name|url` — photo/video/file bheja gaya original quality mein. */
function buildDocumentText(file: File, url: string): string {
  return `${DOC_MARK}${encodeURIComponent(
    file.type || "application/octet-stream"
  )}|${encodeURIComponent(file.name || "Document")}|${url}`;
}

function parseDocument(text: string) {
  const [mime, name, url] = text.slice(DOC_MARK.length).split("|");

  return {
    mime: decodeURIComponent(mime || ""),
    name: decodeURIComponent(name || "Document"),
    url: url || "",
  };
}

/** `[contact]id|name|username|pic` — safe with any characters via encoding. */
function buildContactText(contact: SharedContact): string {
  return `${CONTACT_MARK}${contact.userId}|${encodeURIComponent(
    contact.name || ""
  )}|${encodeURIComponent(contact.username || "")}|${encodeURIComponent(
    contact.profilePic || ""
  )}`;
}

function parseContact(text: string): SharedContact {
  const [userId, name, username, pic] = text
    .slice(CONTACT_MARK.length)
    .split("|");

  return {
    userId: userId || "",
    name: decodeURIComponent(name || ""),
    username: decodeURIComponent(username || ""),
    profilePic: decodeURIComponent(pic || ""),
  };
}

function buildLocationText(lat: number, lng: number): string {
  return `${LOCATION_MARK}${lat}|${lng}`;
}

function parseLocation(text: string): { lat: number; lng: number } {
  const [lat, lng] = text.slice(LOCATION_MARK.length).split("|");
  return { lat: Number(lat), lng: Number(lng) };
}

/** `[call]type|outcome|seconds` → readable call log. */
function parseCallText(text: string) {
  const [type, outcome, seconds] = text.slice(CALL_MARK.length).split("|");
  return {
    video: type === "video",
    outcome: outcome || "",
    duration: Number(seconds || 0),
  };
}

function callDurationLabel(total: number) {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function callMessageLabel(text: string) {
  const { video, outcome, duration } = parseCallText(text);
  const kind = video ? "Video" : "Voice";

  if (outcome === "answered") {
    return `${kind} call · ${callDurationLabel(duration)}`;
  }

  if (outcome === "declined") return `${kind} call declined`;

  return `Missed ${kind.toLowerCase()} call`;
}

type Msg = {
  _id?: string;
  tempId?: string;
  text: string;
  self: boolean;
  timestamp?: string;

  status?: MsgStatus;

  isDelivered?: boolean;
  isSeen: boolean;
  seenAt?: string | null;

  // ✅ reply UI info
  replyToText?: string | null;
  replyToSelf?: boolean;

  // ✅ DELETE SYSTEM
  isDeletedForEveryone?: boolean;
  deletedFor?: string[];
};

export default function Chat() {
  const userData = JSON.parse(sessionStorage.getItem("user") || "{}");
  const BASE_URL = API_URL;

const getFullDP = (dp: string) => {
  if (!dp) return "";
  return dp.startsWith("http") ? dp : BASE_URL + dp;
};
  const socketRef = useRef<Socket | null>(null);
  const sharedSocket = useSocket();

  const navigate = useNavigate();

  const [onlineUsers, setOnlineUsers] = useState<any[]>([]);
  const [chatList, setChatList] = useState<ChatItem[]>([]);
  const UNREAD_KEY = "unread_counts";
  const [selectedUser, setSelectedUser] = useState<SelectedUser | null>(null);

  const [message, setMessage] = useState("");
  const [chatMessages, setChatMessages] = useState<Msg[]>([]);
  const [notifications, setNotifications] = useState<
  { id: number; text: string }[]
>([]);

  // ✅ ONLINE / LAST SEEN STATES
  const [lastSeen, setLastSeen] = useState<string | null>(null);

  // ✅ TYPING INDICATOR STATES
  const [typingUserId, setTypingUserId] = useState<string | null>(null);
  const typingTimeoutRef = useRef<any>(null);

  // ✅ TEXTAREA AUTO GROW REF
  const textAreaRef = useRef<HTMLTextAreaElement | null>(null);

  // ✅ FILE UPLOAD STATES
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  // ✅ SEARCH STATES
  const [searchText, setSearchText] = useState("");
  const [searchResult, setSearchResult] = useState<SelectedUser | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [suggestions, setSuggestions] = useState<SelectedUser[]>([]);
  const [suggestLoading, setSuggestLoading] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const selectedUserRef = useRef<SelectedUser | null>(null);

  // Older-page loading (long chats) and typing throttle.
  const [hasOlderMessages, setHasOlderMessages] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const skipScrollRef = useRef(false);
  const lastTypingEmitRef = useRef(0);

  // ✅✅✅ force rerender so "Seen X minutes ago" updates realtime
  const [, forceSeenRender] = useState(0);

  /**
   * =============================================
   * ✅ REPLY SYSTEM (Swipe + Desktop Button)
   * =============================================
   */
  const [replyingTo, setReplyingTo] = useState<Msg | null>(null);

  // ✅ delete menu popup state
  const [deleteMenuMsg, setDeleteMenuMsg] = useState<Msg | null>(null);

  // ✅ confirm modal state
  const [deleteConfirm, setDeleteConfirm] = useState<{
    open: boolean;
    msg: Msg | null;
    // Which action the user picked in the menu, so the modal cannot run
    // the other (more destructive) delete by mistake.
    mode: "me" | "everyone" | null;
  }>({
    open: false,
    msg: null,
    mode: null,
  });

  // ✅ CALL STATE (incoming rings are shown globally by AlertsHost)
  const [activeCall, setActiveCall] = useState<{
    callId: string;
    peerId: string;
    peerName: string;
    peerPic?: string;
    mode: CallMode;
    direction: "outgoing" | "incoming";
    offer?: RTCSessionDescriptionInit | null;
  } | null>(null);

  // ✅ BROWSER NOTIFICATIONS
  const [notifEnabled, setNotifEnabled] = useState(
    () => localStorage.getItem(ALERTS_KEY) === "1"
  );

  const [showContactPicker, setShowContactPicker] = useState(false);
  const [contactSuggestions, setContactSuggestions] = useState<SharedContact[]>(
    []
  );
  // "document" sends the original file (high quality), "media" compresses photos.
  const [selectedFileMode, setSelectedFileMode] = useState<AttachMode>("media");

  // Per-chat settings (mute, wallpaper, block).
  const [chatSettingsOpen, setChatSettingsOpen] = useState(false);
  const [chatMuted, setChatMuted] = useState(false);
  const [chatWallpaper, setChatWallpaper] = useState<string | undefined>();
  const [iBlockedThem, setIBlockedThem] = useState(false);
  const [theyBlockedMe, setTheyBlockedMe] = useState(false);

  const swipeStartXRef = useRef<number | null>(null);
  const swipeLastXRef = useRef<number | null>(null);
  const SWIPE_THRESHOLD = 65;

  const openDeleteConfirm = (msg: Msg, mode: "me" | "everyone") => {
    setDeleteConfirm({ open: true, msg, mode });
  };

  const closeDeleteConfirm = () => {
    setDeleteConfirm({ open: false, msg: null, mode: null });
  };

  // ✅ 15 minutes rule
  const isDeleteForEveryoneAllowed = (createdAt: string) => {
    const created = new Date(createdAt).getTime();
    const now = Date.now();
    return now - created <= 15 * 60 * 1000;
  };

  const onMsgTouchStart = (e: React.TouchEvent) => {
    swipeStartXRef.current = e.touches[0].clientX;
    swipeLastXRef.current = e.touches[0].clientX;
  };

  const onMsgTouchMove = (e: React.TouchEvent) => {
    swipeLastXRef.current = e.touches[0].clientX;
  };

  const onMsgTouchEnd = (msg: Msg) => {
    const startX = swipeStartXRef.current;
    const endX = swipeLastXRef.current;

    swipeStartXRef.current = null;
    swipeLastXRef.current = null;

    if (startX === null || endX === null) return;

    const diff = endX - startX;

    if (diff > SWIPE_THRESHOLD) {
      setReplyingTo(msg);
      setTimeout(() => textAreaRef.current?.focus(), 50);
    }
  };

  const cancelReply = () => setReplyingTo(null);

  const setReplyFromDesktop = (msg: Msg) => {
    setReplyingTo(msg);
    setTimeout(() => textAreaRef.current?.focus(), 50);
  };

  const getReplyPreview = (text: string) => {
    if (text.startsWith(CALL_MARK)) return callMessageLabel(text);
    if (text.startsWith(CONTACT_MARK)) return "👤 Contact";
    if (text.startsWith(LOCATION_MARK)) return "📍 Location";
    if (text.startsWith("[file-image]")) return "📷 Photo";
    if (text.startsWith("[file-video]")) return "🎥 Video";
    if (text.startsWith("[file-pdf]")) return "📄 Document";
    if (text.startsWith("[file-audio]")) return "🎤 Voice Note";
    if (text.startsWith(DOC_MARK)) return "📄 Document";
    if (text.startsWith("[file]")) return "📎 File";
    return text.length > 70 ? text.slice(0, 70) + "..." : text;
  };

  useEffect(() => {
    selectedUserRef.current = selectedUser;
  }, [selectedUser]);

  useEffect(() => {
    // Loading an older page must not yank the view to the bottom.
    if (skipScrollRef.current) {
      skipScrollRef.current = false;
      return;
    }

    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  // ✅ realtime update every 30 sec
  useEffect(() => {
    const t = setInterval(() => {
      forceSeenRender((x) => x + 1);
    }, 30000);
    return () => clearInterval(t);
  }, []);

  const INPUT_HEIGHT = 38;
  const INPUT_MAX_HEIGHT = 110;

  const autoResizeTextarea = () => {
    const el = textAreaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, INPUT_MAX_HEIGHT) + "px";
  };

  const resetTextareaHeight = () => {
    if (textAreaRef.current) {
      textAreaRef.current.style.height = INPUT_HEIGHT + "px";
    }
  };

  const formatTime = (iso?: string) => {
    if (!iso) return "";
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  const formatSeenAgo = (seenISO?: string) => {
    if (!seenISO) return "";
    const now = Date.now();
    const seenTime = new Date(seenISO).getTime();
    let diffSec = Math.floor((now - seenTime) / 1000);
    if (diffSec < 0) diffSec = 0;
    if (diffSec < 60) return "Seen just now";
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60)
      return `Seen ${diffMin} minute${diffMin === 1 ? "" : "s"} ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24)
      return `Seen ${diffHr} hour${diffHr === 1 ? "" : "s"} ago`;
    const diffDay = Math.floor(diffHr / 24);
    return `Seen ${diffDay} day${diffDay === 1 ? "" : "s"} ago`;
  };

  const formatLastSeen = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMin = Math.floor(diffMs / (1000 * 60));
    const diffHr = Math.floor(diffMin / 60);

    if (diffMin < 1) return "just now";
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffHr < 24) return `${diffHr}h ago`;

    return date.toLocaleString("en-IN", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const getLastMessageLabel = (text: string) => {
    if (text.startsWith(CALL_MARK)) return `📞 ${callMessageLabel(text)}`;
    if (text.startsWith(CONTACT_MARK)) return "👤 Contact";
    if (text.startsWith(LOCATION_MARK)) return "📍 Location";
    if (text.startsWith("[file-image]")) return "📷 Photo";
    if (text.startsWith("[file-video]")) return "🎥 Video";
    if (text.startsWith("[file-pdf]")) return "📄 Document";
    if (text.startsWith("[file-audio]")) return "🎤 Voice Note";
    if (text.startsWith(DOC_MARK)) return "📄 Document";
    if (text.startsWith("[file]")) return "📎 File";
    return text;
  };

  const bumpChatToTop = (
    otherUserId: string,
    text: string,
    meta?: {
      conversationId?: string;
      name?: string;
      username?: string;
      profilePic?: string;
    }
  ) => {
    if (!otherUserId) return;

    setChatList((prev) => {
      const nowISO = new Date().toISOString();
      const idx = prev.findIndex((c) => c.userId === otherUserId);
      const label = getLastMessageLabel(text);

      if (idx !== -1) {
        const updatedChat: ChatItem = {
          ...prev[idx],
          lastMessage: label,
          lastMessageTime: nowISO,
        };

        // A chat opened from search has no id until the first message.
        if (meta?.conversationId) {
          updatedChat.conversationId = meta.conversationId;
        }

        const newList = [...prev];
        newList.splice(idx, 1);
        return [updatedChat, ...newList];
      }

      // First message with this person: add the chat instead of dropping it.
      const open = selectedUserRef.current;
      const same = open && String(open.userId) === String(otherUserId) ? open : null;

      const created: ChatItem = {
        conversationId: meta?.conversationId || same?.conversationId || "",
        userId: otherUserId,
        name: meta?.name || same?.name || "User",
        username: meta?.username || same?.username || "",
        profilePic: meta?.profilePic || same?.profilePic || "",
        lastMessage: label,
        lastMessageTime: nowISO,
        unreadCount: 0,
        isSeen: true,
      };

      return [created, ...prev];
    });
  };

  const loadChatList = async () => {
    try {
      const res = await api.get(`/api/conversations/${userData.id}`);
      const savedUnread = JSON.parse(localStorage.getItem(UNREAD_KEY) || "{}");
      const chats = (res.data.chats || []).map((chat: any) => ({
  ...chat,
  unreadCount: savedUnread[chat.userId] || 0,
}));

      setChatList(chats);
    } catch (err) {
      // A network blip must not wipe the visible chat list.
      console.log("Chat list load error:", err);
    }
  };

  const loadMessages = async (conversationId: string, before?: string) => {
    try {
      if (before) setLoadingOlder(true);

      const res = await api.get(
        `/api/messages/conversation/${conversationId}`,
        { params: before ? { before, limit: 50 } : { limit: 50 } }
      );

      const formatted: Msg[] = (res.data.messages || []).map((m: any) => {
        const sender = m.sender?.toString?.() ?? m.sender ?? "";
        const isSelf = sender === userData.id;

        const delivered = m.deliveredAt ? true : false;
        const seen = m.seenAt ? true : false;

        let status: MsgStatus = "sent";
        if (seen) status = "seen";
        else if (delivered) status = "delivered";

        const textToShow = m.isDeletedForEveryone
          ? "🚫 This message was deleted"
          : m.message;

        return {
          _id: m._id,
          text: textToShow,
          self: isSelf,
          timestamp: m.createdAt,
          isDelivered: delivered,
          isSeen: seen,
          seenAt: m.seenAt || null,
          status,

          replyToText: m.replyText || null,
          replyToSelf: m.replyToSelf || false,

          isDeletedForEveryone: m.isDeletedForEveryone || false,
          deletedFor: m.deletedFor || [],
        };
      });

      const filtered = formatted.filter(
        (m) => !(m.deletedFor || []).includes(userData.id)
      );

      setHasOlderMessages(!!res.data?.hasMore);

      if (before) {
        skipScrollRef.current = true;

        setChatMessages((prev) => {
          const known = new Set(prev.map((m) => String(m._id)));
          const older = filtered.filter((m) => !known.has(String(m._id)));
          return [...older, ...prev];
        });
      } else {
        setChatMessages(filtered);
      }
    } catch (err) {
      console.log("Load messages error:", err);

      // Keep whatever is already on screen when an older page fails.
      if (!before) setChatMessages([]);
    } finally {
      if (before) setLoadingOlder(false);
    }
  };

  const loadOlderMessages = () => {
    if (!selectedUser?.conversationId || loadingOlder || !hasOlderMessages) {
      return;
    }

    const first = chatMessages[0]?.timestamp;
    if (!first) return;

    void loadMessages(selectedUser.conversationId, first);
  };

  const closeChat = () => {
    const socket = socketRef.current;
    socket?.emit("chatClose", { viewerId: userData.id });

    setSelectedUser(null);
    selectedUserRef.current = null;
    setChatMessages([]);

    setSearchResult(null);
    setSearchText("");
    setNotFound(false);

    setSelectedFile(null);

    setTypingUserId(null);
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);

    setLastSeen(null);
    setReplyingTo(null);
    setDeleteMenuMsg(null);
    closeDeleteConfirm();

    setHasOlderMessages(false);
    setLoadingOlder(false);
    skipScrollRef.current = false;

    resetTextareaHeight();
   
  };

  const handleTyping = () => {
    if (!selectedUser) return;
    const socket = socketRef.current;
    if (!socket) return;

    // The server rate-limits typing events; send at most one per 1.2s.
    const now = Date.now();
    if (now - lastTypingEmitRef.current > 1200) {
      lastTypingEmitRef.current = now;
      socket.emit("typing", {
        fromUserId: userData.id,
        toUserId: selectedUser.userId,
      });
    }

    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);

    typingTimeoutRef.current = setTimeout(() => {
      socket.emit("stopTyping", {
        fromUserId: userData.id,
        toUserId: selectedUser.userId,
      });
    }, 1600);
  };

  const forceStopTyping = () => {
    if (!selectedUser) return;
    const socket = socketRef.current;
    if (!socket) return;

    socket.emit("stopTyping", {
      fromUserId: userData.id,
      toUserId: selectedUser.userId,
    });
  };

  useEffect(() => {
    if (!userData?.id) return;

    loadChatList();

    if (!sharedSocket) return;

    socketRef.current = sharedSocket;
    const socket = sharedSocket;
    socket.off("onlineUsers");
    socket.off("receivePrivateMessage");
    socket.off("messageSent");
    socket.off("messageDelivered");
    socket.off("messagesSeen");
    socket.off("typing");
    socket.off("stopTyping");
    socket.off("messageDeleted");
    socket.off("callLogged");

    const handleOnlineUsers = (users: any[]) => {
      const unique = Array.from(
        new Map(users.map((u: any) => [u.userId, u])).values()
      );
      setOnlineUsers(unique);
    };

    const handleReceiveMessage = (data: any) => {
      const current = selectedUserRef.current;
      const senderId = data.sender?.toString?.() ?? data.sender ?? "";
      const isCurrentChat = current?.userId === senderId;

      bumpChatToTop(senderId, data.message, {
        conversationId: data.conversationId,
        name: data.senderName,
        profilePic: data.senderProfilePic,
      });

if (!isCurrentChat) {
  setChatList((prev) => {
    const updated = prev.map((chat) => {
      if (chat.userId === senderId) {
        const newCount = (chat.unreadCount || 0) + 1;

        // 💾 save in localStorage
        const saved = JSON.parse(localStorage.getItem(UNREAD_KEY) || "{}");
        saved[senderId] = newCount;
        localStorage.setItem(UNREAD_KEY, JSON.stringify(saved));

        return { ...chat, unreadCount: newCount };
      }
      return chat;
    });

    return updated;
  });
  setNotifications((prev) => [
  ...prev,
  {
    id: Date.now(),
    text: `New message from ${data.senderName || "User"}`,
  },
]);
}

      if (isCurrentChat) {
        setChatMessages((prev) => [
          ...prev,
          {
            _id: data._id,
            text: data.message,
            self: false,
            timestamp: data.createdAt,
            isDelivered: true,
            isSeen: data.seenAt ? true : false,
            seenAt: data.seenAt || null,
            status: "delivered",

            replyToText: data.replyText || null,
            replyToSelf: data.replyToSelf || false,
          },
        ]);

        socket.emit("markSeen", {
          senderId,
          receiverId: userData.id,
        });
      }

    };

    const handleMessageSent = ({
      tempId,
      messageId,
      createdAt,
      conversationId,
    }: any) => {
      setChatMessages((prev) =>
        prev.map((m) =>
          m.tempId === tempId
            ? {
                ...m,
                _id: messageId,
                timestamp: createdAt || m.timestamp,
                status: "sent",
              }
            : m
        )
      );

      if (!conversationId) return;

      const current = selectedUserRef.current;

      // A chat started from search learns its conversation id here.
      if (current) {
        setSelectedUser((prev) =>
          prev && String(prev.userId) === String(current.userId) && !prev.conversationId
            ? { ...prev, conversationId }
            : prev
        );
      }

      setChatList((prev) =>
        prev.map((chat) =>
          chat.conversationId === conversationId ||
          (current && String(chat.userId) === String(current.userId))
            ? { ...chat, conversationId }
            : chat
        )
      );
    };

    const handleDelivered = ({ messageId }: any) => {
      setChatMessages((prev) =>
        prev.map((m) =>
          m._id === messageId
            ? { ...m, isDelivered: true, status: "delivered" }
            : m
        )
      );
    };

    const handleMessagesSeen = ({ senderId, receiverId, seenAt }: any) => {
      if (senderId !== userData.id) return;

      const current = selectedUserRef.current;
      if (!current || current.userId !== receiverId) return;

      const t = seenAt || new Date().toISOString();

      setChatMessages((prev) =>
        prev.map((m) =>
          m.self ? { ...m, isSeen: true, seenAt: t, status: "seen" } : m
        )
      );

    };

    const handleTypingEvent = ({ fromUserId }: any) => {
      const current = selectedUserRef.current;
      if (!current) return;
      if (String(current.userId) === String(fromUserId)) {
        setTypingUserId(String(fromUserId));
      }
    };

    const handleStopTypingEvent = ({ fromUserId }: any) => {
      const current = selectedUserRef.current;
      if (!current) return;
      if (String(current.userId) === String(fromUserId)) {
        setTypingUserId(null);
      }
    };

    const handleMessageDeleted = ({ messageId, deleteForEveryone }: any) => {
      if (!messageId) return;

      if (deleteForEveryone) {
        setChatMessages((prev) =>
          prev.map((m) =>
            String(m._id) === String(messageId)
              ? {
                  ...m,
                  text: "🚫 This message was deleted",
                  isDeletedForEveryone: true,
                }
              : m
          )
        );
      } else {
        setChatMessages((prev) =>
          prev.filter((m) => String(m._id) !== String(messageId))
        );
      }
    };

    socket.on("onlineUsers", handleOnlineUsers);
    socket.on("receivePrivateMessage", handleReceiveMessage);

    socket.on("messageSent", handleMessageSent);
    socket.on("messageDelivered", handleDelivered);
    socket.on("messagesSeen", handleMessagesSeen);

    socket.on("typing", handleTypingEvent);
    socket.on("stopTyping", handleStopTypingEvent);

    socket.on("messageDeleted", handleMessageDeleted);

    // WhatsApp-style call entries saved by the server.
    const handleCallLogged = (data: any) => {
      const senderId = String(data?.sender ?? "");
      const otherId =
        senderId === String(userData.id)
          ? String(data?.receiver ?? "")
          : senderId;

      bumpChatToTop(otherId, data.message);

      const current = selectedUserRef.current;
      // Chats opened from search have no conversationId yet, so match on the
      // other participant and adopt the id the server just gave us.
      if (!current || String(current.userId) !== String(otherId)) return;

      if (!current.conversationId && data.conversationId) {
        setSelectedUser((prev) =>
          prev && !prev.conversationId
            ? { ...prev, conversationId: data.conversationId }
            : prev
        );
      }

      setChatMessages((prev) => {
        if (data._id && prev.some((m) => m._id === data._id)) return prev;

        return [
          ...prev,
          {
            _id: data._id,
            text: data.message,
            self: senderId === String(userData.id),
            timestamp: data.createdAt,
            isDelivered: true,
            isSeen: true,
            status: "seen",
          },
        ];
      });
    };

    const handleMessageBlocked = (data: any) => {
      pushToast(data?.reason || "Message not delivered");

      if (data?.tempId) {
        setChatMessages((prev) =>
          prev.map((m) =>
            String(m._id) === String(data.tempId)
              ? { ...m, status: "failed" as MsgStatus }
              : m
          )
        );
      }
    };

    socket.on("messageBlocked", handleMessageBlocked);
    socket.on("callLogged", handleCallLogged);

  }, [userData?.id, sharedSocket]);

  const selectedIsOnline =
    !!selectedUser &&
    onlineUsers.some((u) => String(u.userId) === String(selectedUser.userId));

  useEffect(() => {
    if (!selectedUser?.userId) return;

    if (selectedIsOnline) {
      setLastSeen(null);
      return;
    }

    api
      .get(`/api/user/status/${selectedUser.userId}`)
      .then((res) => setLastSeen(res.data.lastSeen || null))
      .catch(() => setLastSeen(null));
  }, [selectedUser?.userId, selectedIsOnline]);

  const openChatByUser = async (user: SelectedUser) => {
    const socket = socketRef.current;

    // The chat still opens while the socket is (re)connecting; sends are
    // guarded separately, so nothing is lost silently.
    socket?.emit("chatClose", { viewerId: userData.id });

    // Opening someone from search has no conversationId: look the existing
    // conversation up so the history loads instead of showing an empty chat.
    let conversationId = user.conversationId;

    if (!conversationId) {
      const known = chatList.find((c) => String(c.userId) === String(user.userId));
      if (known?.conversationId) conversationId = known.conversationId;
    }

    if (!conversationId) {
      try {
        const res = await api.get(`/api/conversations/${userData.id}`);
        const chats = (res.data.chats || []) as ChatItem[];
        const match = chats.find(
          (c) => String(c.userId) === String(user.userId)
        );

        if (match) {
          conversationId = match.conversationId;
          setChatList((prev) =>
            prev.some((c) => String(c.userId) === String(user.userId))
              ? prev
              : [{ ...match, unreadCount: 0 }, ...prev]
          );
        }
      } catch {
        /* the chat still opens; the first message will create it */
      }
    }

    setSelectedUser({
      ...user,
      conversationId,
      profilePic: user.profilePic || "",
    });
    // 🔥 RESET UNREAD (UI + LOCAL)
setChatList((prev) =>
  prev.map((chat) =>
    chat.userId === user.userId
      ? { ...chat, unreadCount: 0 }
      : chat
  )
);

// 💾 remove from localStorage
const saved = JSON.parse(localStorage.getItem(UNREAD_KEY) || "{}");
delete saved[user.userId];
localStorage.setItem(UNREAD_KEY, JSON.stringify(saved));

    setTypingUserId(null);
    setLastSeen(null);
    setReplyingTo(null);
    setDeleteMenuMsg(null);
    closeDeleteConfirm();

    setHasOlderMessages(false);
    setLoadingOlder(false);
    skipScrollRef.current = false;

    if (conversationId) await loadMessages(conversationId);
    else setChatMessages([]);

    socket?.emit("chatOpen", { viewerId: userData.id, otherId: user.userId });

    socket?.emit("markSeen", {
      senderId: user.userId,
      receiverId: userData.id,
    });

    

    setSearchResult(null);
    setSearchText("");
    setNotFound(false);
    setSelectedFile(null);

    resetTextareaHeight();
  };

  // Notification / push deep link: /chat?user=<id> opens that conversation.
  const [searchParams, setSearchParams] = useSearchParams();

  useEffect(() => {
    const targetId = searchParams.get("user");
    if (!targetId || !userData?.id) return;

    let cancelled = false;

    const open = async () => {
      const existing = chatList.find((c) => c.userId === targetId);

      if (existing) {
        await openChatByUser({
          conversationId: existing.conversationId,
          userId: existing.userId,
          name: existing.name || existing.username || "User",
          username: existing.username,
          profilePic: existing.profilePic || "",
        });
      } else {
        try {
          const res = await api.get(`/api/user/${targetId}`);
          if (cancelled) return;

          await openChatByUser({
            userId: targetId,
            name: res.data.user.name,
            username: res.data.user.username,
            profilePic: res.data.user.profilePic || "",
          });
        } catch {
          /* the user may no longer exist */
        }
      }

      if (!cancelled) setSearchParams({}, { replace: true });
    };

    void open();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, chatList.length]);

  // Load this contact's per-chat settings whenever the chat changes.
  useEffect(() => {
    const otherId = selectedUser?.userId;

    if (!otherId) {
      setChatMuted(false);
      setChatWallpaper(undefined);
      setIBlockedThem(false);
      setTheyBlockedMe(false);
      return;
    }

    const prefs = getChatPrefs(otherId);
    setChatMuted(!!prefs.muted);
    setChatWallpaper(prefs.wallpaper);
    setIBlockedThem(false);
    setTheyBlockedMe(false);

    api
      .get(`/api/user/${otherId}`)
      .then((res) => {
        setIBlockedThem(!!res.data?.user?.isBlockedByMe);
        setTheyBlockedMe(!!res.data?.user?.hasBlockedMe);
      })
      .catch(() => {
        /* block state is best-effort */
      });
  }, [selectedUser?.userId]);

  // Live username suggestions while typing (debounced).
  useEffect(() => {
    const q = searchText.trim();

    if (q.length < 2) {
      setSuggestions([]);
      setSuggestLoading(false);
      return;
    }

    let cancelled = false;
    setSuggestLoading(true);

    const timer = window.setTimeout(() => {
      api
        .get("/api/auth/suggest", { params: { q } })
        .then((res) => {
          if (cancelled) return;
          setSuggestions(res.data?.users || []);
        })
        .catch(() => {
          if (!cancelled) setSuggestions([]);
        })
        .finally(() => {
          if (!cancelled) setSuggestLoading(false);
        });
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [searchText]);

  const clearSearch = () => {
    setSearchText("");
    setSuggestions([]);
    setSearchResult(null);
    setNotFound(false);
  };

  const pickSuggestion = (picked: SelectedUser) => {
    clearSearch();
    void openChatByUser(picked);
  };

  const searchUser = async () => {
    if (!searchText.trim()) return;

    try {
      const res = await api.get(`/api/auth/search/${searchText}`);

      setSearchResult({
        userId: res.data.user.userId,
        name: res.data.user.name,
        username: res.data.user.username,
        profilePic: res.data.user.profilePic || "",
      });

      setNotFound(false);
    } catch {
      setSearchResult(null);
      setNotFound(true);
    }
  };

  const uploadFile = async (file: File): Promise<string | null> => {
    try {
      setUploading(true);
      const formData = new FormData();
      formData.append("file", file);

      const res = await api.post("/api/upload", formData);

      return res.data?.file?.url || null;
    } catch (err) {
      console.log("Upload failed:", err);
      return null;
    } finally {
      setUploading(false);
    }
  };

  const getFileTag = (file: File) => {
    if (file.type.startsWith("image/")) return "[file-image]";
    if (file.type.startsWith("video/")) return "[file-video]";
    if (file.type === "application/pdf") return "[file-pdf]";
    if (file.type.startsWith("audio/")) return "[file-audio]";
    return "[file]";
  };

  const sendMessage = async () => {
    const socket = socketRef.current;
    if (!selectedUser) return;

    if (!socket) {
      pushToast("Not connected — try again in a moment");
      return;
    }

    forceStopTyping();

    const tempId = `temp-${Date.now()}-${Math.random().toString(16).slice(2)}`;

    if (selectedFile) {
      const asDocument = selectedFileMode === "document";

      // WhatsApp style: normal quality for photos, original file for documents.
      let outgoing = selectedFile;
      if (!asDocument) {
        try {
          outgoing = await compressImageFile(selectedFile);
        } catch {
          outgoing = selectedFile;
        }
      }

      const fileUrl = await uploadFile(outgoing);
      if (!fileUrl) return;

      const fileMsg = asDocument
        ? buildDocumentText(selectedFile, fileUrl)
        : `${getFileTag(outgoing)}${fileUrl}`;

      socket.emit("privateMessage", {
        senderId: userData.id,
        receiverId: selectedUser.userId,
        message: fileMsg,
        tempId,
        replyToId: replyingTo?._id || null,
        replyText: replyingTo?.text || null,
        replyToSelf: replyingTo?.self || false,
      });

      bumpChatToTop(selectedUser.userId, fileMsg);

      setChatMessages((prev) => [
        ...prev,
        {
          tempId,
          _id: tempId,
          text: fileMsg,
          self: true,
          isSeen: false,
          isDelivered: false,
          seenAt: null,
          timestamp: new Date().toISOString(),
          status: "sending",

          replyToText: replyingTo?.text || null,
          replyToSelf: replyingTo?.self || false,
        },
      ]);

      setSelectedFile(null);
      setSelectedFileMode("media");
      setReplyingTo(null);

      return;
    }

    if (!message.trim()) return;

    socket.emit("privateMessage", {
      senderId: userData.id,
      receiverId: selectedUser.userId,
      message,
      tempId,
      replyToId: replyingTo?._id || null,
      replyText: replyingTo?.text || null,
      replyToSelf: replyingTo?.self || false,
    });

    bumpChatToTop(selectedUser.userId, message);

    setChatMessages((prev) => [
      ...prev,
      {
        tempId,
        _id: tempId,
        text: message,
        self: true,
        isSeen: false,
        isDelivered: false,
        seenAt: null,
        timestamp: new Date().toISOString(),
        status: "sending",

        replyToText: replyingTo?.text || null,
        replyToSelf: replyingTo?.self || false,
      },
    ]);

    setMessage("");
    setReplyingTo(null);

    setTimeout(() => resetTextareaHeight(), 0);
  };

  /** Sends a card message (contact / location) through the same socket flow. */
  const sendMarker = (text: string) => {
    if (!selectedUser) return;

    const socket = socketRef.current;
    if (!socket) {
      pushToast("Not connected — try again in a moment");
      return;
    }

    const tempId = `temp-${Date.now()}-${Math.random()
      .toString(16)
      .slice(2)}`;

    socket.emit("privateMessage", {
      senderId: userData.id,
      receiverId: selectedUser.userId,
      message: text,
      tempId,
      replyToId: replyingTo?._id || null,
      replyText: replyingTo?.text || null,
      replyToSelf: replyingTo?.self || false,
    });

    bumpChatToTop(selectedUser.userId, text);

    setChatMessages((prev) => [
      ...prev,
      {
        tempId,
        _id: tempId,
        text,
        self: true,
        isSeen: false,
        isDelivered: false,
        seenAt: null,
        timestamp: new Date().toISOString(),
        status: "sending",

        replyToText: replyingTo?.text || null,
        replyToSelf: replyingTo?.self || false,
      },
    ]);

    setReplyingTo(null);
  };

  const shareLocation = () => {
    if (!selectedUser) return;

    if (!("geolocation" in navigator)) {
      pushToast("This browser cannot share location");
      return;
    }

    pushToast("Getting your location…");

    navigator.geolocation.getCurrentPosition(
      (position) =>
        sendMarker(
          buildLocationText(
            position.coords.latitude,
            position.coords.longitude
          )
        ),
      () => pushToast("Location permission denied"),
      { enableHighAccuracy: true, timeout: 12000 }
    );
  };

  const shareContact = (contact: SharedContact) => {
    sendMarker(buildContactText(contact));
    setShowContactPicker(false);
  };

  // ---- Per-chat settings actions ----
  const toggleChatMute = (value: boolean) => {
    if (!selectedUser) return;
    const next = setChatPrefs(selectedUser.userId, { muted: value });
    setChatMuted(!!next.muted);
  };

  const pickChatWallpaper = async (file: File) => {
    if (!selectedUser) return;

    if (!file.type.startsWith("image/")) {
      pushToast("Please choose an image");
      return;
    }

    try {
      const dataUrl = await fileToWallpaper(file);
      const next = setChatPrefs(selectedUser.userId, { wallpaper: dataUrl });
      setChatWallpaper(next.wallpaper);
      pushToast("Chat wallpaper updated");
    } catch {
      pushToast("Could not use this photo");
    }
  };

  const resetChatWallpaper = () => {
    if (!selectedUser) return;
    setChatPrefs(selectedUser.userId, { wallpaper: undefined });
    setChatWallpaper(undefined);
  };

  const clearThisChat = async () => {
    if (!selectedUser) return;

    try {
      await api.post(`/api/messages/clear/${selectedUser.userId}`);
      setChatMessages([]);
      setChatList((prev) =>
        prev.map((chat) =>
          chat.userId === selectedUser.userId
            ? { ...chat, lastMessage: "" }
            : chat
        )
      );
      pushToast("Chat cleared");
    } catch {
      pushToast("Could not clear this chat");
    }
  };

  const toggleBlockContact = async (blocked: boolean) => {
    if (!selectedUser) return;

    try {
      await api.post(`/api/user/block/${selectedUser.userId}`, { blocked });
      setIBlockedThem(blocked);
      pushToast(blocked ? "Contact blocked" : "Contact unblocked");
    } catch {
      pushToast("Could not update block status");
    }
  };

  /** Opens the picker with "Your chats" so a contact can be sent in one tap. */
  const openContactPicker = async () => {
    setShowContactPicker(true);

    try {
      const res = await api.get(`/api/conversations/${userData.id}`);
      const chats = Array.isArray(res.data?.chats) ? res.data.chats : [];

      setContactSuggestions(
        chats.map((chat: any) => ({
          userId: String(chat.userId),
          name: chat.name || chat.username || "User",
          username: chat.username || "",
          profilePic: chat.profilePic || "",
        }))
      );
    } catch {
      /* suggestions are a convenience only */
    }
  };

  const deleteForMe = (msg: Msg) => {
    if (!msg._id || !selectedUser) return;

    socketRef.current?.emit("deleteMessage", {
      messageId: msg._id,
      userId: userData.id,
      otherUserId: selectedUser.userId,
      deleteForEveryone: false,
    });

    setChatMessages((prev) =>
      prev.filter((m) => String(m._id) !== String(msg._id))
    );
  };

  const deleteForEveryone = (msg: Msg) => {
    if (!msg._id || !selectedUser) return;

    socketRef.current?.emit("deleteMessage", {
      messageId: msg._id,
      userId: userData.id,
      otherUserId: selectedUser.userId,
      deleteForEveryone: true,
    });

    setChatMessages((prev) =>
      prev.map((m) =>
        String(m._id) === String(msg._id)
          ? {
              ...m,
              text: "🚫 This message was deleted",
              isDeletedForEveryone: true,
            }
          : m
      )
    );
  };

  const renderMessage = (m: Msg) => {
    if (m.text.startsWith(CALL_MARK)) {
      const { video, outcome } = parseCallText(m.text);
      const missed = outcome !== "answered";

      return (
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span
            style={{
              width: 28,
              height: 28,
              borderRadius: "50%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: missed ? "rgba(255,59,48,0.18)" : "rgba(37,211,102,0.18)",
              fontSize: 14,
              flexShrink: 0,
            }}
          >
            {outcome === "answered" ? (video ? "🎥" : "📞") : "📵"}
          </span>

          <span
            style={{
              fontSize: 13,
              fontWeight: 500,
              color: missed ? "#ff8a80" : "#e9edef",
            }}
          >
            {callMessageLabel(m.text)}
          </span>
        </div>
      );
    }

    if (m.text.startsWith("[file-image]")) {
      const url = m.text.replace("[file-image]", "");
      return (
        <img
          src={url}
          alt="img"
          style={{ maxWidth: 230, borderRadius: 10, cursor: "pointer" }}
          onClick={() => window.open(url, "_blank")}
        />
      );
    }

    if (m.text.startsWith("[file-video]")) {
      const url = m.text.replace("[file-video]", "");
      return (
        <video src={url} controls style={{ maxWidth: 260, borderRadius: 10 }} />
      );
    }

    if (m.text.startsWith(DOC_MARK)) {
      const doc = parseDocument(m.text);

      return (
        <a
          className="doc-card"
          href={doc.url}
          target="_blank"
          rel="noreferrer"
        >
          <span className="doc-card-icon">📄</span>

          <span className="doc-card-info">
            <span className="doc-card-name">{doc.name}</span>
            <span className="doc-card-hint">Original quality · Tap to open</span>
          </span>

          <span className="doc-card-dl">⬇</span>
        </a>
      );
    }

    if (m.text.startsWith("[file-pdf]")) {
      const url = m.text.replace("[file-pdf]", "");
      return (
        <a href={url} target="_blank" rel="noreferrer">
          📄 Open Document
        </a>
      );
    }

    if (m.text.startsWith("[file-audio]")) {
      const url = m.text.replace("[file-audio]", "");
      return <VoiceMessageBubble url={url} self={m.self} />;
    }

    if (m.text.startsWith("[file]")) {
      const url = m.text.replace("[file]", "");
      return (
        <a href={url} target="_blank" rel="noreferrer">
          📎 Download File
        </a>
      );
    }

    if (m.text.startsWith(CONTACT_MARK)) {
      const contact = parseContact(m.text);
      const pic = contact.profilePic
        ? contact.profilePic.startsWith("http")
          ? contact.profilePic
          : API_URL + contact.profilePic
        : "";

      return (
        <div className="contact-card">
          <div className="contact-card-avatar">
            {pic ? <img src={pic} alt="" /> : "👤"}
          </div>

          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="contact-card-name">
              {contact.name || "Contact"}
            </div>
            <div className="contact-card-username">@{contact.username}</div>
          </div>

          <button
            type="button"
            className="contact-card-btn"
            onClick={() => navigate(`/chat?user=${contact.userId}`)}
          >
            Message
          </button>
        </div>
      );
    }

    if (m.text.startsWith(LOCATION_MARK)) {
      const { lat, lng } = parseLocation(m.text);
      const mapsUrl = `https://www.google.com/maps?q=${lat},${lng}`;

      return (
        <div className="location-card">
          <div className="location-card-head">
            <span className="location-pin">📍</span>
            <div>
              <div className="location-card-title">Location</div>
              <div className="location-card-coords">
                {lat.toFixed(5)}, {lng.toFixed(5)}
              </div>
            </div>
          </div>

          <a
            className="location-card-btn"
            href={mapsUrl}
            target="_blank"
            rel="noreferrer"
          >
            Open in Maps
          </a>
        </div>
      );
    }

    return <div>{m.text}</div>;
  };

  const getStatusLabel = (m: Msg) => {
    if (!m.self) return "";
    if (m.status === "sending") return "Sending…";
    if (m.status === "sent") return "Sent";
    if (m.status === "delivered") return "Delivered";
    if (m.status === "seen") return "";
    return "";
  };

  const pushToast = (text: string) => {
    const id = Date.now() + Math.random();
    setNotifications((prev) => [...prev, { id, text }]);
    window.setTimeout(() => {
      setNotifications((prev) => prev.filter((n) => n.id !== id));
    }, 4000);
  };

  const toggleNotifications = async () => {
    if (notifEnabled) {
      await disablePush();
      setNotifEnabled(false);
      localStorage.removeItem(ALERTS_KEY);
      saveSettings({ messageTone: false });
      pushToast("Notifications turned off");
      return;
    }

    const res = await enablePush();
    setNotifEnabled(res.ok);
    if (res.ok) localStorage.setItem(ALERTS_KEY, "1");
    saveSettings({ messageTone: true });
    pushToast(res.message);
  };

  const startCall = (callMode: CallMode) => {
    if (!selectedUser) return;

    // Without a live socket the ring can never reach the other user.
    if (!socketRef.current?.connected) {
      pushToast("Server se connection nahi hai — thoda wait karke try karo");
      return;
    }

    if (!selectedIsOnline) {
      pushToast(`${selectedUser.name} is offline right now`);
      return;
    }

    const callId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `call-${Date.now()}-${Math.random().toString(16).slice(2)}`;

    setActiveCall({
      callId,
      peerId: selectedUser.userId,
      peerName: selectedUser.name,
      peerPic: selectedUser.profilePic,
      mode: callMode,
      direction: "outgoing",
    });
  };

  return (
    <>
    {/* 🔔 NOTIFICATION POPUP */}
<div
  style={{
    position: "fixed",
    top: 20,
    right: 20,
    zIndex: 9999,
    display: "flex",
    flexDirection: "column",
    gap: 10,
  }}
>
  {notifications.map((n) => (
    <div
      key={n.id}
      style={{
        background: "#222",
        color: "#fff",
        padding: "10px 14px",
        borderRadius: 10,
      }}
    >
      {n.text}
    </div>
  ))}
</div>
      {/* ✅✅✅ NAVBAR ADDED (only change) */}
     <Navbar
  onLogout={() => {
    socketRef.current?.disconnect();
    socketRef.current = null;

    // ✅ logout = clear session + this account's local data
    logoutAndRedirect();
  }}
/>
      <div
        className={`chat-layout${selectedUser ? " chat-open" : ""}`}
        onClick={() => setDeleteMenuMsg(null)}
      >
        {/* LEFT */}
        <div className="chat-list">
          <div className="side-head">
            <h3 className="side-title">Chats</h3>

            <button
              type="button"
              onClick={toggleNotifications}
              className="bell"
              data-on={notifEnabled}
              title={
                notifEnabled
                  ? "Turn off browser notifications"
                  : "Turn on browser notifications"
              }
            >
              {notifEnabled ? "🔔 On" : "🔕 Off"}
            </button>
          </div>

          {/* SEARCH */}
          <div className="search-row">
            <input
              className="search-input"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  clearSearch();
                  return;
                }

                if (e.key === "Enter") {
                  if (suggestions.length > 0) pickSuggestion(suggestions[0]);
                  else void searchUser();
                }
              }}
              placeholder="Search name or username…"
              autoComplete="off"
            />

            <button type="button" className="btn-search" onClick={searchUser}>
              Search
            </button>
          </div>

          {searchText.trim().length >= 2 &&
            (suggestions.length > 0 || suggestLoading) && (
              <div className="suggest-list">
                {suggestions.length === 0 && suggestLoading && (
                  <div className="suggest-empty">Searching…</div>
                )}

                {suggestions.map((sug) => (
                  <button
                    key={sug.userId}
                    type="button"
                    className="suggest-item"
                    onClick={() => pickSuggestion(sug)}
                  >
                    <div className="chat-avatar suggest-avatar">
                      {sug.profilePic ? (
                        <img
                          src={
                            sug.profilePic.startsWith("http")
                              ? sug.profilePic
                              : API_URL + sug.profilePic
                          }
                          alt=""
                        />
                      ) : (
                        <span style={{ fontSize: 14 }}>👤</span>
                      )}
                    </div>

                    <div style={{ minWidth: 0, textAlign: "left" }}>
                      <div className="chat-name">{sug.name}</div>
                      <div className="chat-head-status">
                        {sug.username ? `@${sug.username}` : ""}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}

          {/* ✅✅✅ ONLY CHANGE: SEARCH RESULT DP ADDED */}
          {searchResult && (
            <div
              onClick={() => openChatByUser(searchResult)}
              className="search-card"
            >
              <div
                onClick={(e) => {
                  e.stopPropagation();
                  if (!searchResult.profilePic) return;
                  openPhotoViewer(
                    searchResult.profilePic.startsWith("http")
                      ? searchResult.profilePic
                      : API_URL + searchResult.profilePic,
                    searchResult.name
                  );
                }}
                title={searchResult.profilePic ? "View photo" : undefined}
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: "50%",
                  background: "#ddd",
                  overflow: "hidden",
                  flexShrink: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
               {searchResult.profilePic ? (
  <img
    src={
      searchResult.profilePic.startsWith("http")
        ? searchResult.profilePic
        : API_URL + searchResult.profilePic
    }
    alt="dp"
    style={{
      width: "100%",
      height: "100%",
      objectFit: "cover",
    }}
  />
) : (
  <span style={{ fontSize: 16 }}>👤</span>
)}
              </div>

              <div>
                <div className="chat-name">{searchResult.name}</div>
                <div className="chat-head-status">
                  {searchResult.username ? `@${searchResult.username}` : ""}
                </div>
              </div>
            </div>
          )}

          {notFound && (
            <p style={{ color: "var(--danger)", marginTop: 10, fontSize: 13 }}>
              ❌ User not found
            </p>
          )}

          <div className="chat-list-scroll">
            {chatList.length === 0 && (
              <p style={{ color: "var(--text-muted)" }}>No chats yet...</p>
            )}

            {chatList.map((chat) => {
              const isOnline = onlineUsers.some((u) => u.userId === chat.userId);

              return (
                <div
                  key={chat.conversationId}
                  onClick={() =>
                    openChatByUser({
                      conversationId: chat.conversationId,
                      userId: chat.userId,
                      name: chat.name || chat.username || "User",
                      username: chat.username,
                      profilePic: chat.profilePic || "",
                    })
                  }
                  className="chat-item"
                  data-active={selectedUser?.userId === chat.userId}
                >
                  <div className="chat-item-top">
                    {/* ✅✅✅ PROFILE CLICK ADDED HERE */}
                    <div className="chat-item-main">
                      <div
                        onClick={(e) => {
                          e.stopPropagation();
                          if (chat.profilePic) {
                            openPhotoViewer(
                              chat.profilePic.startsWith("http")
                                ? chat.profilePic
                                : API_URL + chat.profilePic,
                              chat.name || chat.username || "User"
                            );
                          } else {
                            navigate(`/user/${chat.userId}`);
                          }
                        }}
                        title={chat.profilePic ? "View photo" : "View Profile"}
                        className="chat-avatar"
                      >
                        {chat.profilePic ? (
                          <img
  src={
    chat.profilePic.startsWith("http")
      ? chat.profilePic
      : API_URL + chat.profilePic
  }
  alt="dp"
  style={{
    width: "100%",
    height: "100%",
    objectFit: "cover",
  }}
/>
                        ) : (
                          <span style={{ fontSize: 16 }}>👤</span>
                        )}
                      </div>

                      <div
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate(`/user/${chat.userId}`);
                        }}
                        title="View Profile"
                        className="chat-name"
                      >
                        {chat.name || chat.username || "User"}
                        {isOnline && <span className="online-dot" />}
                      </div>
                    </div>

                    <div className="chat-time">
                      {formatTime(chat.lastMessageTime)}
                    </div>
                  </div>

                  <div className="chat-preview">
                    <div className="chat-preview-text">
                      {chat.lastMessage
                        ? getLastMessageLabel(chat.lastMessage)
                        : "No messages yet"}
                    </div>

                    {!!chat.unreadCount && chat.unreadCount > 0 && (
                                            <span className="unread-badge">
                        {chat.unreadCount}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* RIGHT */}
        <div className="chat-panel">
          {!selectedUser && <h2>Select a chat</h2>}

          {selectedUser && (
            <>
              {/* Header */}
              <div className="chat-header">
                <button
                  type="button"
                  onClick={closeChat}
                  className="chat-head-btn"
                  title="Back to chats"
                  aria-label="Back to chats"
                >
                  ←
                </button>

                {/* ✅✅✅ DP ADDED IN HEADER (ONLY CHANGE) */}
                <div
                  onClick={() => {
                    if (selectedUser.profilePic) {
                      openPhotoViewer(
                        selectedUser.profilePic.startsWith("http")
                          ? selectedUser.profilePic
                          : API_URL + selectedUser.profilePic,
                        selectedUser.name
                      );
                    } else {
                      navigate(`/user/${selectedUser.userId}`);
                    }
                  }}
                  title={
                    selectedUser.profilePic ? "View photo" : "View Profile"
                  }
                  className="chat-avatar"
                >
                 {selectedUser.profilePic ? (
  <img
    src={
      selectedUser.profilePic.startsWith("http")
        ? selectedUser.profilePic
        : API_URL + selectedUser.profilePic
    }
                      alt="dp"
                      style={{
                        width: "100%",
                        height: "100%",
                        objectFit: "cover",
                      }}
                    />
                  ) : (
                    <span style={{ fontSize: 18 }}>👤</span>
                  )}
                </div>

                <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                  <h2
                    className="chat-head-name"
                    title="View Profile"
                    onClick={() => navigate(`/user/${selectedUser.userId}`)}
                  >
                    {selectedUser.name}
                  </h2>

                  {typingUserId === selectedUser.userId ? (
                    <span className="chat-head-status" data-typing="true">
                      typing…
                    </span>
                  ) : (
                    <span className="chat-head-status">
                      {selectedIsOnline
                        ? "Online"
                        : lastSeen
                        ? `Active ${formatLastSeen(lastSeen)}`
                        : ""}
                    </span>
                  )}
                </div>

                <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
                  <button
                    type="button"
                    onClick={() => startCall("audio")}
                    title="Audio call"
                    className="chat-head-btn"
                  >
                    📞
                  </button>

                  <button
                    type="button"
                    onClick={() => startCall("video")}
                    title="Video call"
                    className="chat-head-btn"
                  >
                    🎥
                  </button>

                  <button
                    type="button"
                    onClick={() => setChatSettingsOpen(true)}
                    title="Chat settings"
                    className="chat-head-btn"
                  >
                    ⋮
                  </button>
                </div>
              </div>

              {iBlockedThem && (
                <div className="blocked-banner">
                  <span>
                    You blocked this contact. Unblock to send messages or call.
                  </span>

                  <button
                    type="button"
                    className="sheet-btn"
                    onClick={() => void toggleBlockContact(false)}
                  >
                    Unblock
                  </button>
                </div>
              )}

              {/* Messages */}
              <div
                className="chat-messages"
                style={
                  chatWallpaper
                    ? {
                        backgroundImage: `url(${chatWallpaper})`,
                        backgroundSize: "cover",
                        backgroundPosition: "center",
                      }
                    : undefined
                }
              >
                {hasOlderMessages && (
                  <button
                    type="button"
                    className="load-older"
                    onClick={loadOlderMessages}
                    disabled={loadingOlder}
                  >
                    {loadingOlder ? "Loading…" : "Load earlier messages"}
                  </button>
                )}

                {chatMessages.map((m, i) => {
                  const isLast = i === chatMessages.length - 1;

                  return (
                    <div
                      key={m._id || i}
                      onTouchStart={(e) => onMsgTouchStart(e)}
                      onTouchMove={(e) => onMsgTouchMove(e)}
                      onTouchEnd={() => onMsgTouchEnd(m)}
                     className={`msg${m.self ? " msg-self" : ""}`}
                     style={{ alignSelf: m.self ? "flex-end" : "flex-start", maxWidth: "75%" }}
                    >
                      {/* ✅ Desktop Reply Button */}
                      <button
                        onClick={() => setReplyFromDesktop(m)}
                        style={{
                          position: "absolute",
                          top: 4,
                          right: 6,
                          fontSize: 11,
                          border: "none",
                          background: "transparent",
                          cursor: "pointer",
                          color: "var(--primary)",
                        }}
                        title="Reply"
                      >
                        ↩
                      </button>

                      {/* ✅ Delete Button */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleteMenuMsg(m);
                        }}
                        style={{
                          position: "absolute",
                          top: 4,
                          right: 28,
                          fontSize: 11,
                          border: "none",
                          background: "transparent",
                          cursor: "pointer",
                          color: "red",
                        }}
                        title="Delete"
                      >
                        🗑
                      </button>

                      {/* ✅ Reply bubble shown inside message */}
                      {m.replyToText && (
                        <div
                          style={{
                            background: "#ffffffaa",
                            borderLeft: "4px solid var(--primary)",
                            padding: "6px 8px",
                            borderRadius: 8,
                            marginBottom: 6,
                            fontSize: 12,
                            color: "#333",
                            maxWidth: 240,
                          }}
                        >
                          <div
                            style={{
                              fontSize: 11,
                              fontWeight: "bold",
                              color: "var(--primary)",
                            }}
                          >
                            {m.replyToSelf ? "You" : selectedUser?.name}
                          </div>
                          <div
                            style={{
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {getReplyPreview(m.replyToText)}
                          </div>
                        </div>
                      )}

                      {renderMessage(m)}

                      {/* ✅ Delete menu popup */}
                      {deleteMenuMsg?._id === m._id && (
                        <div
                          onClick={(e) => e.stopPropagation()}
                          style={{
                            position: "absolute",
                            top: 22,
                            right: 5,
                            background: "var(--bg-card)",
                            border: "1px solid var(--border)",
                            borderRadius: 10,
                            padding: 8,
                            boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
                            zIndex: 50,
                            minWidth: 180,
                          }}
                        >
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              openDeleteConfirm(m, "me");
                              setDeleteMenuMsg(null);
                            }}
                            style={{
                              width: "100%",
                              textAlign: "left",
                              border: "none",
                              background: "transparent",
                              padding: "6px 8px",
                              cursor: "pointer",
                            }}
                          >
                            🗑 Delete for me
                          </button>

                          {m.self &&
                            m.timestamp &&
                            isDeleteForEveryoneAllowed(m.timestamp) && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openDeleteConfirm(m, "everyone");
                                  setDeleteMenuMsg(null);
                                }}
                                style={{
                                  width: "100%",
                                  textAlign: "left",
                                  border: "none",
                                  background: "transparent",
                                  padding: "6px 8px",
                                  cursor: "pointer",
                                  color: "red",
                                }}
                              >
                                🚫 Delete for everyone
                              </button>
                            )}

                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeleteMenuMsg(null);
                            }}
                            style={{
                              width: "100%",
                              textAlign: "left",
                              border: "none",
                              background: "transparent",
                              padding: "6px 8px",
                              cursor: "pointer",
                              color: "var(--text-muted)",
                            }}
                          >
                            ❌ Cancel
                          </button>
                        </div>
                      )}

                      <div
                        style={{
                          fontSize: 10,
                          marginTop: 3,
                          color: "var(--text-muted)",
                          display: "flex",
                          justifyContent: "flex-end",
                          gap: 6,
                        }}
                      >
                        <span>{formatTime(m.timestamp)}</span>

                        {m.self && !m.isSeen && (
                          <span style={{ fontSize: 10, color: "#888" }}>
                            {getStatusLabel(m)}
                          </span>
                        )}
                      </div>

                      {isLast &&
                        m.self &&
                        m.isSeen &&
                        !m.text.startsWith(CALL_MARK) && (
                        <div
                          style={{
                            fontSize: 11,
                            color: "var(--text-muted)",
                            marginTop: 4,
                            textAlign: "right",
                          }}
                        >
                          {formatSeenAgo(m.seenAt || m.timestamp)}
                        </div>
                      )}
                    </div>
                  );
                })}
                <div ref={messagesEndRef} />
              </div>

              {/* Reply Preview */}
              {replyingTo && (
                <div
                  style={{
                    marginTop: 10,
                    padding: "10px 12px",
                    borderRadius: 12,
                    border: "1px solid var(--border)",
                    background: "var(--surface-2)",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 10,
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, color: "var(--primary)" }}>
                      Replying to {replyingTo.self ? "You" : selectedUser?.name}
                    </div>
                    <div
                      style={{
                        fontSize: 12,
                        color: "var(--text-muted)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {getReplyPreview(replyingTo.text)}
                    </div>
                  </div>

                  <button
                    onClick={cancelReply}
                    style={{
                      border: "none",
                      background: "transparent",
                      fontSize: 18,
                      cursor: "pointer",
                      color: "var(--text-muted)",
                    }}
                  >
                    ❌
                  </button>
                </div>
              )}

             {/* Input Row */}
<div
  className="chat-input-row"
  style={{
    display: "flex",
    gap: 10,
    marginTop: 12,
    alignItems: "flex-end",
    position: "sticky",
    bottom: 0,
  
    paddingTop: 10,
  }}
>
                <AttachMenu
                  disabled={uploading || iBlockedThem}
                  onFile={(file, mode) => {
                    setSelectedFile(file);
                    setSelectedFileMode(mode);
                  }}
                  onContact={() => void openContactPicker()}
                  onLocation={shareLocation}
                />

                <textarea
                  ref={textAreaRef}
                  value={message}
                  onChange={(e) => {
                    setMessage(e.target.value);
                    autoResizeTextarea();
                    handleTyping();
                  }}
                  onBlur={() => forceStopTyping()}
                  placeholder="Type a message…"
                  className="composer-input"
                  style={{
                    minHeight: INPUT_HEIGHT,
                    maxHeight: INPUT_MAX_HEIGHT,
                    lineHeight: "18px",
                    overflow: "hidden",
                  }}
                  rows={1}
                  disabled={uploading || iBlockedThem}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter" || e.shiftKey) return;

                    // Settings → "Send with Enter" (off = only the button sends).
                    if (!getSettings().enterToSend) return;

                    e.preventDefault();
                    sendMessage();
                  }}
                />

                <button
                  type="button"
                  onClick={sendMessage}
                  disabled={uploading || iBlockedThem}
                  className="send-btn"
                  style={{ height: INPUT_HEIGHT, alignSelf: "flex-end" }}
                >
                  {uploading ? "Sending…" : "Send"}
                </button>
              </div>

              {/* Voice */}
              <VoiceHoldRecorder
                onSendUrl={(url: string) => {
                  if (!selectedUser) return;

                  const tempId = `temp-${Date.now()}-${Math.random()
                    .toString(16)
                    .slice(2)}`;
                  const audioMsg = `[file-audio]${url}`;

                  socketRef.current?.emit("privateMessage", {
                    senderId: userData.id,
                    receiverId: selectedUser.userId,
                    message: audioMsg,
                    tempId,
                    replyToId: replyingTo?._id || null,
                    replyText: replyingTo?.text || null,
                    replyToSelf: replyingTo?.self || false,
                  });

                  bumpChatToTop(selectedUser.userId, audioMsg);

                  setChatMessages((prev) => [
                    ...prev,
                    {
                      tempId,
                      _id: tempId,
                      text: audioMsg,
                      self: true,
                      isSeen: false,
                      isDelivered: false,
                      seenAt: null,
                      timestamp: new Date().toISOString(),
                      status: "sending",

                      replyToText: replyingTo?.text || null,
                      replyToSelf: replyingTo?.self || false,
                    },
                  ]);

                  setReplyingTo(null);
                }}
              />

              {selectedFile && (
                <SelectedFileChip
                  file={selectedFile}
                  as={selectedFileMode}
                  onRemove={() => {
                    setSelectedFile(null);
                    setSelectedFileMode("media");
                  }}
                />
              )}
            </>
          )}
        </div>

        {chatSettingsOpen && selectedUser && (
          <ChatSettingsSheet
            user={selectedUser}
            muted={chatMuted}
            wallpaper={chatWallpaper}
            blocked={iBlockedThem}
            blockedByThem={theyBlockedMe}
            onClose={() => setChatSettingsOpen(false)}
            onViewProfile={() => navigate(`/user/${selectedUser.userId}`)}
            onToggleMute={toggleChatMute}
            onPickWallpaper={pickChatWallpaper}
            onResetWallpaper={resetChatWallpaper}
            onClearChat={clearThisChat}
            onToggleBlock={toggleBlockContact}
          />
        )}

        {showContactPicker && (
          <ShareContactModal
            suggestions={
              contactSuggestions.length
                ? contactSuggestions
                : chatList.map((chat) => ({
                    userId: chat.userId,
                    name: chat.name || chat.username || "User",
                    username: chat.username || "",
                    profilePic: chat.profilePic || "",
                  }))
            }
            onClose={() => setShowContactPicker(false)}
            onShare={shareContact}
          />
        )}

        {/* ✅ DELETE CONFIRM MODAL (Final) */}
        {deleteConfirm.open && deleteConfirm.msg && (
          <div
            onClick={closeDeleteConfirm}
            style={{
              position: "fixed",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: "rgba(0,0,0,0.4)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 9999,
            }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                width: 320,
                
                borderRadius: 12,
                padding: 16,
                boxShadow: "0 10px 30px rgba(0,0,0,0.2)",
              }}
            >
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>
                Delete message?
              </h3>

              <p style={{ margin: "10px 0 14px", fontSize: 13, color: "#444" }}>
                Are you sure you want to delete this message?
              </p>

              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {deleteConfirm.mode === "everyone"
                  ? deleteConfirm.msg.self &&
                    deleteConfirm.msg.timestamp &&
                    isDeleteForEveryoneAllowed(deleteConfirm.msg.timestamp) && (
                      <button
                        style={{
                          padding: "10px 12px",
                          borderRadius: 10,
                          border: "none",
                          background: "#ff3b30",
                          color: "#fff",
                          cursor: "pointer",
                          fontWeight: 700,
                        }}
                        onClick={() => {
                          const msgObj = deleteConfirm.msg;
                          if (!msgObj) return;
                          deleteForEveryone(msgObj);
                          closeDeleteConfirm();
                        }}
                      >
                        Delete for everyone
                      </button>
                    )
                  : (
                      <button
                        style={{
                          padding: "10px 12px",
                          borderRadius: 10,
                          border: "1px solid var(--border)",
                          background: "var(--bg-card)",
                          cursor: "pointer",
                          fontWeight: 600,
                        }}
                        onClick={() => {
                          const msgObj = deleteConfirm.msg;
                          if (!msgObj) return;
                          deleteForMe(msgObj);
                          closeDeleteConfirm();
                        }}
                      >
                        Delete for me
                      </button>
                    )}

                <button
                  style={{
                    padding: "10px 12px",
                    borderRadius: 10,
                    border: "1px solid var(--border)",
                    background: "#f7f7f7",
                    cursor: "pointer",
                    fontWeight: 600,
                  }}
                  onClick={closeDeleteConfirm}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Active call */}
      {activeCall && socketRef.current && (
        <CallOverlay
          socket={socketRef.current}
          callId={activeCall.callId}
          peerId={activeCall.peerId}
          peerName={activeCall.peerName}
          peerProfilePic={
            activeCall.peerPic ? getFullDP(activeCall.peerPic) : ""
          }
          mode={activeCall.mode}
          direction={activeCall.direction}
          incomingOffer={activeCall.offer ?? null}
          onClose={() => setActiveCall(null)}
        />
      )}
    </>
  );
}