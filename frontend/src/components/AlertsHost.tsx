import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import CallOverlay from "./chat/CallOverlay";
import type { CallMode } from "./chat/CallOverlay";
import { useSocket } from "../lib/socketContext";
import { notificationsAllowed } from "../lib/push";
import { getSettings } from "../lib/settings";
import { getChatPrefs } from "../lib/chatPrefs";
import { API_URL } from "../lib/api";

function fullPic(url?: string) {
  if (!url) return "";
  return url.startsWith("http") ? url : API_URL + url;
}

function timeLabel() {
  return new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Short beep for a new message; works even when OS notifications are blocked. */
function playBeep(frequency = 680) {
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioCtx) return;

    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sine";
    osc.frequency.value = frequency;
    gain.gain.value = 0.06;

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.18);

    window.setTimeout(() => void ctx.close().catch(() => {}), 400);
  } catch {
    /* audio is blocked until the first user gesture */
  }
}

/** Looping two-note ringtone (WhatsApp style) + vibration. */
function startRingtone(): () => void {
  let ctx: AudioContext | null = null;
  let timer = 0;

  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioCtx) return () => {};

    ctx = new AudioCtx();

    const pattern = () => {
      if (!ctx) return;

      [0, 0.3].forEach((offset, i) => {
        const osc = ctx!.createOscillator();
        const gain = ctx!.createGain();
        const start = ctx!.currentTime + offset;

        osc.type = "sine";
        osc.frequency.value = i === 0 ? 720 : 940;
        gain.gain.value = 0.08;

        osc.connect(gain);
        gain.connect(ctx!.destination);
        osc.start(start);
        osc.stop(start + 0.24);
      });
    };

    pattern();
    timer = window.setInterval(pattern, 1700);

    if ("vibrate" in navigator) {
      navigator.vibrate([500, 250, 500, 250, 900]);
    }
  } catch {
    /* ignore */
  }

  return () => {
    window.clearInterval(timer);
    if ("vibrate" in navigator) navigator.vibrate(0);
    void ctx?.close().catch(() => {});
  };
}

function osNotify(
  title: string,
  body: string,
  tag: string,
  icon?: string,
  onClick?: () => void
) {
  if (!document.hidden || !notificationsAllowed()) return;

  try {
    const notification = new Notification(title, { body, tag, icon });

    // Tap on the notification opens that sender's chat directly.
    notification.onclick = () => {
      window.focus();
      notification.close();
      onClick?.();
    };
  } catch {
    /* some browsers only allow this from a service worker */
  }
}

type Toast = {
  id: number;
  name: string;
  text: string;
  avatar: string;
  userId: string;
  time: string;
};

type IncomingCall = {
  callId: string;
  fromUserId: string;
  fromName: string;
  fromProfilePic: string;
  callType: CallMode;
  offer: RTCSessionDescriptionInit;
};

type ActiveCall = {
  callId: string;
  peerId: string;
  peerName: string;
  peerPic: string;
  mode: CallMode;
  offer: RTCSessionDescriptionInit;
};

/**
 * WhatsApp-style alerts that live above the routes:
 * - message cards with avatar (click to open that chat)
 * - full screen incoming call screen with ringtone
 * - unread count in the tab title
 */
export default function AlertsHost() {
  const socket = useSocket();
  const location = useLocation();
  const navigate = useNavigate();

  const [toasts, setToasts] = useState<Toast[]>([]);
  const [incoming, setIncoming] = useState<IncomingCall | null>(null);
  const [active, setActive] = useState<ActiveCall | null>(null);

  const pathRef = useRef(location.pathname);
  const unreadRef = useRef(0);

  const [connected, setConnected] = useState(socket?.connected ?? false);

  useEffect(() => {
    if (!socket) return;

    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
    };
  }, [socket]);

  useEffect(() => {
    pathRef.current = location.pathname;
  }, [location.pathname]);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const pushToast = useCallback(
    (toast: Omit<Toast, "id" | "time">) => {
      const id = Date.now() + Math.random();
      setToasts((prev) => [...prev.slice(-2), { ...toast, id, time: timeLabel() }]);
      window.setTimeout(() => dismiss(id), 6000);
    },
    [dismiss]
  );

  // Clear the title badge when the window is focused again.
  useEffect(() => {
    const onFocus = () => {
      unreadRef.current = 0;
      document.title = "AmoraLock";
    };

    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  // ---- New message alerts ----
  useEffect(() => {
    if (!socket) return;

    const onMessage = (data: any) => {
      const senderId = String(data?.sender ?? "");
      const senderName = String(data?.senderName || "New message");
      const raw = String(data?.message || "");
      const preview = raw.startsWith("[file-")
        ? "Sent you an attachment"
        : raw.startsWith("[contact]")
        ? "Shared a contact"
        : raw.startsWith("[location]")
        ? "Shared a location"
        : raw.startsWith("[call]")
        ? "Call"
        : raw.slice(0, 120);
      const avatar = fullPic(data?.senderProfilePic);

      // User preferences from Settings, plus this chat's own mute switch.
      const prefs = getSettings();
      const muted = !!getChatPrefs(senderId).muted;
      const body = prefs.messagePreview ? preview : "New message";

      if (prefs.messageTone && !muted) {
        playBeep();
      }

      if (!muted) {
        osNotify(senderName, body, `chat-${senderId}`, avatar || undefined, () =>
          navigate(`/chat?user=${senderId}`)
        );
      }

      // The chat screen shows its own popup, so no duplicate card there.
      if (pathRef.current !== "/chat") {
        unreadRef.current += 1;
        document.title = `(${unreadRef.current}) AmoraLock`;

        if (prefs.notificationPopups && !muted) {
          pushToast({
            name: senderName,
            text: body,
            avatar,
            userId: senderId,
          });
        }
      }
    };

    socket.on("receivePrivateMessage", onMessage);
    return () => {
      socket.off("receivePrivateMessage", onMessage);
    };
  }, [socket, pushToast]);

  // ---- Incoming call ----
  useEffect(() => {
    if (!socket) return;

    const onIncoming = (data: any) => {
      const from = String(data?.fromUserId || "");
      const callId = String(data?.callId || "");
      if (!from || !callId || !data?.offer) return;

      const callType: CallMode = data.callType === "video" ? "video" : "audio";

      setIncoming((prev) =>
        prev
          ? prev
          : {
              callId,
              fromUserId: from,
              fromName: data.fromName || "User",
              fromProfilePic: data.fromProfilePic || "",
              callType,
              offer: data.offer,
            }
      );

      osNotify(
        `Incoming ${callType} call`,
        `${data.fromName || "Someone"} is calling you`,
        `call-${from}`,
        fullPic(data?.fromProfilePic) || undefined,
        () => navigate(`/chat?user=${from}`)
      );
    };

    const clearIfSame = (data: any) => {
      const endedId = String(data?.callId || "");
      if (!endedId) return;

      setIncoming((prev) =>
        prev && prev.callId === endedId ? null : prev
      );
    };

    socket.on("incomingCall", onIncoming);
    socket.on("callEnded", clearIfSame);
    socket.on("callRejected", clearIfSame);

    return () => {
      socket.off("incomingCall", onIncoming);
      socket.off("callEnded", clearIfSame);
      socket.off("callRejected", clearIfSame);
    };
  }, [socket]);

  // Ringtone while the call screen is open.
  useEffect(() => {
    if (!incoming) return;

    const stop = startRingtone();
    return stop;
  }, [incoming]);

  // Auto-decline if nobody picks up within 45 seconds.
  useEffect(() => {
    if (!incoming || !socket) return;

    const id = window.setTimeout(() => {
      socket.emit("callRejected", {
        callId: incoming.callId,
        reason: "no-answer",
      });
      setIncoming(null);
    }, 45000);

    return () => window.clearTimeout(id);
  }, [incoming, socket]);

  const acceptCall = () => {
    if (!incoming) return;

    setActive({
      callId: incoming.callId,
      peerId: incoming.fromUserId,
      peerName: incoming.fromName,
      peerPic: incoming.fromProfilePic,
      mode: incoming.callType,
      offer: incoming.offer,
    });
    setIncoming(null);
  };

  const declineCall = () => {
    if (!incoming) return;

    socket?.emit("callRejected", {
      callId: incoming.callId,
      reason: "declined",
    });
    setIncoming(null);
  };

  if (!socket) return null;

  const incomingAvatar = incoming ? fullPic(incoming.fromProfilePic) : "";

  return (
    <>
      {!connected && (
        <div className="net-banner">
          <span className="net-dot" /> Reconnecting… calls and messages will
          resume automatically
        </div>
      )}

      {/* Message notifications (WhatsApp desktop style) */}
      <div className="wa-toasts">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="wa-toast"
            onClick={() => {
              dismiss(t.id);
              navigate(`/chat?user=${t.userId}`);
            }}
            role="button"
            tabIndex={0}
          >
            <div className="wa-toast-avatar">
              {t.avatar ? <img src={t.avatar} alt="" /> : "👤"}
            </div>

            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="wa-toast-top">
                <span className="wa-toast-name">{t.name}</span>
                <span className="wa-toast-time">{t.time}</span>
              </div>
              <div className="wa-toast-text">{t.text}</div>
            </div>

            <button
              className="wa-toast-close"
              onClick={(e) => {
                e.stopPropagation();
                dismiss(t.id);
              }}
              title="Dismiss"
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      {/* Incoming call screen */}
      {incoming && !active && (
        <div className="call-screen">
          <div style={{ marginTop: 24 }}>
            <div className="call-avatar-wrap">
              <span className="call-ring" />
              <span className="call-ring" />
              <div className="call-avatar">
                {incomingAvatar ? (
                  <img src={incomingAvatar} alt="" />
                ) : (
                  <span>{incoming.callType === "video" ? "🎥" : "👤"}</span>
                )}
              </div>
            </div>

            <h2 className="call-name">{incoming.fromName}</h2>
            <p className="call-status">
              Incoming {incoming.callType} call…
            </p>
            <p className="call-hint">
              {incoming.callType === "video"
                ? "Camera will turn on when you accept"
                : "Tap Accept to answer"}
            </p>
          </div>

          <div className="call-actions">
            <div>
              <button
                className="call-btn call-btn-decline"
                onClick={declineCall}
                title="Decline"
              >
                ✕
              </button>
              <div className="call-btn-label">Decline</div>
            </div>

            <div>
              <button
                className="call-btn call-btn-accept"
                onClick={acceptCall}
                title="Accept"
              >
                {incoming.callType === "video" ? "🎥" : "📞"}
              </button>
              <div className="call-btn-label">Accept</div>
            </div>
          </div>
        </div>
      )}

      {/* Accepted call */}
      {active && (
        <CallOverlay
          socket={socket}
          callId={active.callId}
          peerId={active.peerId}
          peerName={active.peerName}
          peerProfilePic={fullPic(active.peerPic)}
          mode={active.mode}
          direction="incoming"
          incomingOffer={active.offer}
          onClose={() => setActive(null)}
        />
      )}
    </>
  );
}
