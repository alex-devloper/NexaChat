import { useEffect, useRef, useState } from "react";
import type { Socket } from "socket.io-client";

export type CallMode = "audio" | "video";

type Props = {
  socket: Socket;
  callId: string;
  peerId: string;
  peerName: string;
  peerProfilePic?: string;
  mode: CallMode;
  direction: "outgoing" | "incoming";
  incomingOffer?: RTCSessionDescriptionInit | null;
  onClose: () => void;
};

type Status = "preparing" | "ringing" | "connecting" | "active" | "ended";

const MEDIA_TIMEOUT_MS = 25_000;
const ACK_TIMEOUT_MS = 8_000;
const RING_TIMEOUT_MS = 55_000;

/* ------------------------------------------------------------------ */
/* ICE servers                                                         */
/* ------------------------------------------------------------------ */

const TURN_URLS = String(import.meta.env.VITE_TURN_URL || "")
  .split(",")
  .map((url: string) => url.trim())
  .filter(Boolean);

const TURN_USERNAME = String(import.meta.env.VITE_TURN_USERNAME || "").trim();
const TURN_CREDENTIAL = String(
  import.meta.env.VITE_TURN_CREDENTIAL || ""
).trim();

// A turn:/turns: server without credentials makes RTCPeerConnection throw, so
// a half-configured relay is ignored instead of breaking every call.
const TURN_READY = Boolean(
  TURN_URLS.length && TURN_USERNAME && TURN_CREDENTIAL
);

const ICE_SERVERS: RTCIceServer[] = [
  { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
  ...(TURN_READY
    ? [
        {
          urls: TURN_URLS,
          username: TURN_USERNAME,
          credential: TURN_CREDENTIAL,
        },
      ]
    : []),
];

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** getUserMedia can hang on an unanswered permission prompt. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_resolve, reject) =>
      window.setTimeout(() => reject(new Error("media-timeout")), ms)
    ),
  ]);
}

const formatDuration = (total: number) => {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
};

const reasonText = (reason?: string) => {
  switch (reason) {
    case "declined":
      return "Call declined";
    case "no-answer":
      return "No answer";
    case "busy":
      return "User is on another call";
    case "disconnected":
      return "Call dropped";
    default:
      return "Call ended";
  }
};

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export default function CallOverlay({
  socket,
  callId,
  peerId,
  peerName,
  peerProfilePic,
  mode,
  direction,
  incomingOffer,
  onClose,
}: Props) {
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const pendingIceRef = useRef<RTCIceCandidateInit[]>([]);
  const endedRef = useRef(false);

  const [status, setStatus] = useState<Status>("preparing");
  const [message, setMessage] = useState("");
  // Shown under the status when a call fails, so a screenshot says what the
  // network actually offered instead of us guessing.
  const [diagnostic, setDiagnostic] = useState("");
  const localTypesRef = useRef<Set<string>>(new Set());
  const remoteTypesRef = useRef<Set<string>>(new Set());
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(mode !== "video");
  const [seconds, setSeconds] = useState(0);

  /** Show a final line, then close the overlay. Runs at most once. */
  const finish = (text: string) => {
    if (endedRef.current) return;
    endedRef.current = true;
    setMessage(text);
    setStatus("ended");
    window.setTimeout(() => onClose(), 2200);
  };

  useEffect(() => {
    let cancelled = false;

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    pcRef.current = pc;

    // One stream for everything the peer sends: audio and video arrive as
    // separate tracks, and a <video> only renders tracks present in the
    // stream it is bound to.
    const remoteStream = new MediaStream();
    remoteStreamRef.current = remoteStream;

    const matches = (data: any) => String(data?.callId || "") === callId;

    const playRemote = () => {
      void remoteVideoRef.current?.play().catch(() => {});
      void remoteAudioRef.current?.play().catch(() => {});
    };

    const attachRemoteTrack = (track: MediaStreamTrack) => {
      if (!remoteStream.getTracks().some((t) => t.id === track.id)) {
        remoteStream.addTrack(track);
      }

      const video = remoteVideoRef.current;
      if (video && (track.kind === "video" || video.srcObject !== remoteStream)) {
        // Rebinding makes the element pick up a video track that arrived
        // after it already started playing the audio track.
        video.srcObject = null;
        video.srcObject = remoteStream;
      }

      const audio = remoteAudioRef.current;
      if (audio && audio.srcObject !== remoteStream) {
        audio.srcObject = remoteStream;
      }

      playRemote();
    };

    pc.ontrack = (event) => attachRemoteTrack(event.track);

    const summarize = () =>
      `turn:${TURN_READY ? "on" : "off"} local:[${
        [...localTypesRef.current].join(",") || "-"
      }] remote:[${[...remoteTypesRef.current].join(",") || "-"}]`;

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        const type = event.candidate.type || "host";
        localTypesRef.current.add(type);
        socket.emit("iceCandidate", { callId, candidate: event.candidate });
      } else {
        localTypesRef.current.add("done");
      }
    };

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;

      if (state === "connected") {
        setStatus((current) => (current === "ended" ? current : "active"));
        playRemote();
        return;
      }

      if (state === "failed") {
        console.error("call media path failed", {
          ice: pc.iceConnectionState,
          gathering: pc.iceGatheringState,
          turn: TURN_READY,
          urls: TURN_URLS,
        });
        socket.emit("callEnded", { callId });
        setDiagnostic(summarize());
        finish(
          TURN_READY
            ? `Call dropped (ICE ${pc.iceConnectionState}). Please try again.`
            : "Call dropped: this network needs a TURN relay."
        );
      }
    };

    const flushIce = async () => {
      const pending = pendingIceRef.current;
      pendingIceRef.current = [];

      for (const candidate of pending) {
        try {
          await pc.addIceCandidate(candidate);
        } catch {
          /* a stale candidate is harmless */
        }
      }
    };

    const onRinging = (data: any) => {
      if (!matches(data)) return;
      setStatus((current) => (current === "preparing" ? "ringing" : current));
    };

    const onAnswered = async (data: any) => {
      if (direction !== "outgoing" || !matches(data) || !data?.answer) return;

      try {
        await pc.setRemoteDescription(data.answer);
        await flushIce();
        setStatus((current) => (current === "ended" ? current : "connecting"));
      } catch (err) {
        console.error("could not apply the answer", err);
        socket.emit("callEnded", { callId });
        finish("Call could not connect. Please try again.");
      }
    };

    const onIce = (data: any) => {
      if (!matches(data) || !data?.candidate) return;

      remoteTypesRef.current.add(data.candidate.type || "host");

      if (!pc.remoteDescription) {
        pendingIceRef.current.push(data.candidate);
        return;
      }

      void pc.addIceCandidate(data.candidate).catch(() => {});
    };

    const onRejected = (data: any) => {
      if (!matches(data)) return;
      finish(
        data?.reason === "no-answer"
          ? `${peerName} did not answer`
          : reasonText(data?.reason).toLowerCase().startsWith("call")
          ? `${peerName} ${reasonText(data?.reason).toLowerCase()}`
          : reasonText(data?.reason)
      );
    };

    const onEnded = (data: any) => {
      if (!matches(data)) return;
      finish(reasonText(data?.reason));
    };

    const onBusy = (data: any) => {
      if (matches(data)) finish("User is on another call");
    };

    const onFailed = (data: any) => {
      if (matches(data)) finish(data?.reason || "Call failed");
    };

    socket.on("callRinging", onRinging);
    socket.on("callAnswered", onAnswered);
    socket.on("iceCandidate", onIce);
    socket.on("callRejected", onRejected);
    socket.on("callEnded", onEnded);
    socket.on("callBusy", onBusy);
    socket.on("callFailed", onFailed);

    const start = async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new DOMException("Media API missing", "NotSupportedError");
        }

        // Media first, negotiation second: both sides already own their
        // tracks when the offer/answer is built, so the SDP advertises the
        // real audio/video from the start (no renegotiation, no black sides).
        const stream = await withTimeout(
          navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true },
            video:
              mode === "video"
                ? {
                    width: { ideal: 1280 },
                    height: { ideal: 720 },
                    facingMode: "user",
                  }
                : false,
          }),
          MEDIA_TIMEOUT_MS
        );

        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        localStreamRef.current = stream;

        if (localVideoRef.current && mode === "video") {
          localVideoRef.current.srcObject = stream;
          void localVideoRef.current.play().catch(() => {});
        }

        for (const track of stream.getTracks()) {
          pc.addTrack(track, stream);
        }

        if (direction === "outgoing") {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);

          socket.emit("callUser", {
            callId,
            toUserId: peerId,
            callType: mode,
            offer,
          });
        } else {
          if (!incomingOffer) throw new Error("Missing offer");

          await pc.setRemoteDescription(incomingOffer);
          await flushIce();

          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);

          socket.emit("callAnswer", { callId, answer });
          setStatus("connecting");
        }
      } catch (err) {
        const error = err as DOMException;
        console.error("call could not start", err);

        if (direction === "outgoing") {
          socket.emit("callEnded", { callId });
        } else {
          socket.emit("callRejected", { callId, reason: "failed" });
        }

        finish(
          error?.name === "NotAllowedError"
            ? "Camera and microphone permission is required"
            : error?.name === "NotFoundError"
            ? "No camera or microphone found"
            : error?.message === "media-timeout"
            ? "Camera permission was not answered"
            : "Could not start the call"
        );
      }
    };

    // React StrictMode mounts twice in development: the throwaway mount is
    // cancelled before this microtask runs, so only the live call is placed.
    void Promise.resolve().then(() => {
      if (!cancelled) void start();
    });

    return () => {
      cancelled = true;

      socket.off("callRinging", onRinging);
      socket.off("callAnswered", onAnswered);
      socket.off("iceCandidate", onIce);
      socket.off("callRejected", onRejected);
      socket.off("callEnded", onEnded);
      socket.off("callBusy", onBusy);
      socket.off("callFailed", onFailed);

      // Never leave a ghost call behind: the server keeps the ring alive until
      // it is told otherwise.
      if (!endedRef.current) socket.emit("callEnded", { callId });

      localStreamRef.current?.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
      remoteStream.getTracks().forEach((track) => track.stop());

      pc.ontrack = null;
      pc.onicecandidate = null;
      pc.onconnectionstatechange = null;
      pc.close();

      if (pcRef.current === pc) pcRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callId]);

  /* Call duration */
  useEffect(() => {
    if (status !== "active") return;
    const id = window.setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => window.clearInterval(id);
  }, [status]);

  /* Safety nets */
  useEffect(() => {
    if (status === "ended") return;

    if (direction === "incoming") return;

    if (status === "preparing" || status === "ringing") {
      // The caller must hear something back from the server, otherwise the
      // call never left this device (offline, expired session, …).
      const id = window.setTimeout(() => {
        if (endedRef.current || status !== "preparing") return;
        socket.emit("callEnded", { callId });
        finish("Could not reach the server. Check your connection.");
      }, ACK_TIMEOUT_MS);
      return () => window.clearTimeout(id);
    }
  }, [direction, status, socket, callId]);

  useEffect(() => {
    if (direction !== "outgoing" || status === "active" || status === "ended") {
      return;
    }

    const id = window.setTimeout(() => {
      if (endedRef.current) return;
      socket.emit("callEnded", { callId });
      finish("No answer");
    }, RING_TIMEOUT_MS);

    return () => window.clearTimeout(id);
  }, [direction, status, socket, callId]);

  /* Some browsers keep a remote <video> black until playback is retried. */
  useEffect(() => {
    if (mode !== "video" || status !== "active") return;

    const id = window.setInterval(() => {
      const video = remoteVideoRef.current;
      const stream = remoteStreamRef.current;
      if (!video || !stream || video.videoWidth > 0) return;
      if (!stream.getVideoTracks().some((t) => t.readyState === "live")) return;

      video.srcObject = null;
      video.srcObject = stream;
      void video.play().catch(() => {});
    }, 2000);

    return () => window.clearInterval(id);
  }, [mode, status]);

  /* Controls */
  const hangUp = () => {
    if (!endedRef.current) socket.emit("callEnded", { callId });
    endedRef.current = true;
    onClose();
  };

  const toggleMute = () => {
    const next = !muted;
    localStreamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = !next;
    });
    setMuted(next);
  };

  const toggleCamera = () => {
    const next = !cameraOff;
    localStreamRef.current?.getVideoTracks().forEach((track) => {
      track.enabled = !next;
    });
    setCameraOff(next);
  };

  const statusText =
    status === "preparing"
      ? direction === "outgoing"
        ? "Calling…"
        : "Starting camera…"
      : status === "ringing"
      ? "Calling…"
      : status === "connecting"
      ? "Connecting…"
      : status === "active"
      ? formatDuration(seconds)
      : message || "Call ended";

  return (
    <div
      className="call-screen"
      style={{ justifyContent: "space-between" }}
      onPointerDown={() => {
        // Remote playback can stay blocked until the page gets a gesture.
        void remoteAudioRef.current?.play().catch(() => {});
        void remoteVideoRef.current?.play().catch(() => {});
      }}
    >
      {mode === "video" ? (
        <video
          ref={remoteVideoRef}
          autoPlay
          playsInline
          muted
          style={{
            width: "100%",
            maxWidth: 900,
            maxHeight: "68vh",
            background: "#000",
            borderRadius: 16,
            objectFit: "cover",
          }}
        />
      ) : (
        <div className="call-avatar-wrap" style={{ marginTop: 40 }}>
          <span className="call-ring" />
          <div className="call-avatar">
            {peerProfilePic ? (
              <img src={peerProfilePic} alt="" />
            ) : (
              <span>👤</span>
            )}
          </div>
        </div>
      )}

      {mode === "video" && (
        <video
          ref={localVideoRef}
          autoPlay
          playsInline
          muted
          style={{
            position: "fixed",
            right: 16,
            top: 16,
            width: 120,
            height: 160,
            background: "#000",
            borderRadius: 12,
            objectFit: "cover",
            border: "2px solid #2a3942",
            display: cameraOff ? "none" : "block",
          }}
        />
      )}

      <audio ref={remoteAudioRef} autoPlay style={{ display: "none" }} />

      <div>
        <h2 className="call-name">{peerName}</h2>
        <p className="call-status">{statusText}</p>
        {diagnostic && (
          <p className="call-hint" style={{ fontSize: 11, opacity: 0.75 }}>
            {diagnostic}
          </p>
        )}
        <p className="call-hint">{mode === "video" ? "Video call" : "Voice call"}</p>
      </div>

      <div className="call-actions">
        <div>
          <button
            className="call-btn"
            onClick={toggleMute}
            title={muted ? "Unmute" : "Mute"}
            style={{ background: muted ? "#ff3b30" : "#2a3942" }}
          >
            {muted ? "🔇" : "🎙"}
          </button>
          <div className="call-btn-label">{muted ? "Unmute" : "Mute"}</div>
        </div>

        {mode === "video" && (
          <div>
            <button
              className="call-btn"
              onClick={toggleCamera}
              title={cameraOff ? "Camera on" : "Camera off"}
              style={{ background: cameraOff ? "#ff3b30" : "#2a3942" }}
            >
              {cameraOff ? "📵" : "📹"}
            </button>
            <div className="call-btn-label">
              {cameraOff ? "Camera on" : "Camera off"}
            </div>
          </div>
        )}

        <div>
          <button
            className="call-btn"
            onClick={hangUp}
            title="End call"
            style={{ background: "#ff3b30" }}
          >
            📴
          </button>
          <div className="call-btn-label">End</div>
        </div>
      </div>
    </div>
  );
}
