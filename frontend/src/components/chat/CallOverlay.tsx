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

type Status = "ringing" | "connecting" | "active" | "ended";

// STUN alone only works on simple networks. A TURN relay (set the
// VITE_TURN_* env vars) is required for mobile data and strict NATs.
const TURN_URL = (import.meta.env.VITE_TURN_URL || "").trim();

/** One env value may list several URLs (UDP, TLS/443, TCP) comma separated. */
const TURN_URLS: string[] = TURN_URL.split(",")
  .map((url: string) => url.trim())
  .filter(Boolean);

const TURN_USERNAME = (import.meta.env.VITE_TURN_USERNAME || "").trim();
const TURN_CREDENTIAL = (import.meta.env.VITE_TURN_CREDENTIAL || "").trim();

// Chrome throws while building the RTCPeerConnection when a turn:/turns: URL
// has no username/credential. A half-configured TURN (URL set, credentials
// missing) must therefore be ignored instead of breaking every call.
const TURN_ENABLED = Boolean(
  TURN_URLS.length && TURN_USERNAME && TURN_CREDENTIAL
);

const ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun2.l.google.com:19302" },
  ...(TURN_ENABLED
    ? [
        {
          urls: TURN_URLS,
          username: TURN_USERNAME,
          credential: TURN_CREDENTIAL,
        },
      ]
    : []),
];

const MEDIA_TIMEOUT_MS = 20_000;

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

/** getUserMedia can hang on a pending permission prompt; never wait forever. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_resolve, reject) =>
      window.setTimeout(() => reject(new Error("media-timeout")), ms)
    ),
  ]);
}

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
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const pendingIceRef = useRef<RTCIceCandidateInit[]>([]);
  const finishedRef = useRef(false);

  const [status, setStatus] = useState<Status>(
    direction === "outgoing" ? "ringing" : "connecting"
  );
  // True once the server confirmed the call actually left this device.
  const [serverAck, setServerAck] = useState(direction === "incoming");
  const [message, setMessage] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(mode !== "video");
  const [seconds, setSeconds] = useState(0);

  const finish = (text: string) => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    setMessage(text);
    setStatus("ended");
    window.setTimeout(() => onClose(), 1800);
  };

  useEffect(() => {
    let cancelled = false;

    const matches = (data: any) => String(data?.callId || "") === callId;

    const flushIce = async () => {
      const pc = pcRef.current;
      if (!pc) return;

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

    const handleAnswered = async (data: any) => {
      if (direction !== "outgoing" || !matches(data)) return;

      const pc = pcRef.current;
      if (!pc) return;

      try {
        await pc.setRemoteDescription(
          data.answer as RTCSessionDescriptionInit
        );
        await flushIce();
        // The answer arrived, so the ring is over: show the real state instead
        // of leaving "Ringing…" on screen while the media path connects.
        setStatus((current) => (current === "ringing" ? "connecting" : current));
      } catch {
        finish("Could not connect the call");
      }
    };

    const handleIce = async (data: any) => {
      if (!matches(data)) return;

      const pc = pcRef.current;
      if (!pc || !pc.remoteDescription) {
        pendingIceRef.current.push(data.candidate);
        return;
      }

      try {
        await pc.addIceCandidate(data.candidate);
      } catch {
        /* ignore */
      }
    };

    const handleRejected = (data: any) => {
      if (!matches(data)) return;
      finish(
        data?.reason === "no-answer"
          ? `${peerName} did not answer`
          : `${peerName} ${reasonText(data?.reason).toLowerCase()}`
      );
    };

    const handleEnded = (data: any) => {
      if (!matches(data)) return;
      finish(reasonText(data?.reason));
    };

    const handleRinging = (data: any) => {
      if (!matches(data)) return;
      setServerAck(true);
    };

    const handleBusy = (data: any) => {
      if (!matches(data)) return;
      finish("User is on another call");
    };

    const handleFailed = (data: any) => {
      if (!matches(data)) return;
      finish(data?.reason || "Could not start the call");
    };

    socket.on("callAnswered", handleAnswered);
    socket.on("iceCandidate", handleIce);
    socket.on("callRejected", handleRejected);
    socket.on("callEnded", handleEnded);
    socket.on("callRinging", handleRinging);
    socket.on("callBusy", handleBusy);
    socket.on("callFailed", handleFailed);

    /** Ask for the mic/camera and swap the tracks into the live call. */
    const attachLocalMedia = async (pc: RTCPeerConnection) => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error("no-media-api");
        }

        const stream = await withTimeout(
          navigator.mediaDevices.getUserMedia({
            audio: true,
            video:
              mode === "video"
                ? { width: { ideal: 1280 }, height: { ideal: 720 } }
                : false,
          }),
          MEDIA_TIMEOUT_MS
        );

        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        streamRef.current = stream;

        if (localVideoRef.current && mode === "video") {
          localVideoRef.current.srcObject = stream;
        }

        // The offer already carried sendrecv transceivers, so swapping the
        // tracks in needs no new negotiation.
        for (const transceiver of pc.getTransceivers()) {
          const kind = transceiver.receiver.track.kind;
          const track = stream.getTracks().find((t) => t.kind === kind);
          if (track) {
            await transceiver.sender.replaceTrack(track).catch(() => {});
          }
        }
      } catch (err) {
        const reason = (err as Error)?.message;

        socket.emit("callEnded", { callId });

        finish(
          reason === "media-timeout"
            ? "Mic/camera permission pending — allow it and call again"
            : reason === "no-media-api"
            ? "This browser cannot access mic/camera"
            : "Mic/camera permission is required for calls"
        );
      }
    };

    const start = async () => {
      try {
        const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
        pcRef.current = pc;

        // Transceivers exist before any permission prompt, so the ring can go
        // out immediately (this was the reason calls never reached the other
        // person when the mic prompt was slow or blocked).
        pc.addTransceiver("audio", { direction: "sendrecv" });
        if (mode === "video") {
          pc.addTransceiver("video", { direction: "sendrecv" });
        }

        pc.ontrack = (event) => {
          // Audio and video may arrive as separate streams. Merging every track
          // into one stream keeps the video element from ending up with only
          // the audio track (that showed up as a black remote video).
          const stream = remoteStreamRef.current ?? new MediaStream();
          remoteStreamRef.current = stream;

          if (!stream.getTracks().some((track) => track.id === event.track.id)) {
            stream.addTrack(event.track);
          }

          const video = remoteVideoRef.current;
          if (video && (event.track.kind === "video" || video.srcObject !== stream)) {
            // A <video> binds to whatever srcObject it had when it started
            // playing: when audio arrives first, the video track that lands
            // later is never rendered and the remote window stays black
            // while the sound keeps flowing. Rebinding forces it to pick the
            // picture up.
            video.srcObject = null;
            video.srcObject = stream;
            void video.play().catch(() => {});
          }

          const audio = remoteAudioRef.current;
          if (audio && audio.srcObject !== stream) {
            audio.srcObject = stream;
            void audio.play().catch(() => {});
          }

          // Tracks arrive before the network path is verified; the call only
          // counts as active once ICE actually connects (see below), otherwise
          // both sides saw an "active" call with no audio flowing.
        };

        pc.onicecandidate = (event) => {
          if (event.candidate) {
            socket.emit("iceCandidate", {
              callId,
              candidate: event.candidate,
            });
          }
        };

        pc.onconnectionstatechange = () => {
          if (pc.connectionState === "connected") {
            setStatus("active");
            // Audio may still be blocked by the browser's autoplay policy.
            void remoteAudioRef.current?.play().catch(() => {});
            void remoteVideoRef.current?.play().catch(() => {});
          }

          if (pc.connectionState === "failed") {
            socket.emit("callEnded", { callId });
            finish(
              TURN_URL
                ? "Connection failed. Please try again."
                : "No audio path: this network needs a TURN relay for calls."
            );
          }
        };

        if (direction === "outgoing") {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);

          socket.emit("callUser", {
            callId,
            toUserId: peerId,
            callType: mode,
            offer,
          });

          // Ring is away: permission can be granted in the background.
          void attachLocalMedia(pc);
        } else {
          if (!incomingOffer) throw new Error("Missing offer");

          await pc.setRemoteDescription(incomingOffer);
          await flushIce();

          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);

          socket.emit("callAnswer", { callId, answer });
          setStatus("connecting");

          void attachLocalMedia(pc);
        }
      } catch (err) {
        const name = (err as DOMException)?.name;

        if (direction === "outgoing") {
          socket.emit("callEnded", { callId });
        } else {
          socket.emit("callRejected", { callId, reason: "failed" });
        }

        finish(
          name === "NotAllowedError"
            ? "Camera/microphone permission denied"
            : name === "NotFoundError"
            ? "No camera or microphone found"
            : "Could not start the call"
        );
      }
    };

    // React StrictMode runs setup → cleanup → setup in development. Starting
    // on a microtask means only the surviving setup places the call, so the
    // throwaway first mount cannot cancel it.
    void Promise.resolve().then(() => {
      if (!cancelled) void start();
    });

    return () => {
      cancelled = true;
      socket.off("callAnswered", handleAnswered);
      socket.off("iceCandidate", handleIce);
      socket.off("callRejected", handleRejected);
      socket.off("callEnded", handleEnded);
      socket.off("callRinging", handleRinging);
      socket.off("callBusy", handleBusy);
      socket.off("callFailed", handleFailed);

      // Navigating away or reloading mid-call must not leave a ghost call on
      // the server: it would make the next call report "user is on another
      // call". Only do this once a peer connection actually existed, so the
      // StrictMode throwaway mount cannot cancel a real ring.
      if (pcRef.current && !finishedRef.current) {
        socket.emit("callEnded", { callId });
      }

      streamRef.current?.getTracks().forEach((track) => track.stop());
      pcRef.current?.close();
      pcRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Call duration timer.
  useEffect(() => {
    if (status !== "active") return;
    const id = window.setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => window.clearInterval(id);
  }, [status]);

  // No server acknowledgement: the call never actually left this device.
  useEffect(() => {
    if (direction !== "outgoing" || serverAck || status === "ended") return;

    const id = window.setTimeout(() => {
      if (finishedRef.current) return;
      socket.emit("callEnded", { callId });
      finish(
        "Server se connect nahi ho paya. Internet check karke dobara try karo."
      );
    }, 8000);

    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [direction, serverAck, status]);

  // Safety net: never leave the caller stuck if the ring is lost.
  useEffect(() => {
    if (direction !== "outgoing" || status === "ended") return;

    const id = window.setTimeout(() => {
      if (finishedRef.current || status === "active") return;

      socket.emit("callEnded", { callId });
      finish("No answer");
    }, 55_000);

    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  // Safety net: if the picture still never renders once the call is active
  // (video track arrived after the element started playing), re-bind it.
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
    }, 1500);

    return () => window.clearInterval(id);
  }, [mode, status]);

  const hangUp = () => {
    if (!finishedRef.current) {
      socket.emit("callEnded", { callId });
    }
    finishedRef.current = true;

    streamRef.current?.getTracks().forEach((track) => track.stop());
    pcRef.current?.close();
    pcRef.current = null;

    onClose();
  };

  const toggleMute = () => {
    const stream = streamRef.current;
    if (!stream) return;
    const next = !muted;
    stream.getAudioTracks().forEach((track) => {
      track.enabled = !next;
    });
    setMuted(next);
  };

  const toggleCamera = () => {
    const stream = streamRef.current;
    if (!stream) return;
    const next = !cameraOff;
    stream.getVideoTracks().forEach((track) => {
      track.enabled = !next;
    });
    setCameraOff(next);
  };

  const statusText =
    status === "ringing"
      ? serverAck
        ? "Ringing…"
        : "Calling…"
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
        // Some browsers block remote audio until the page gets a gesture.
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
        <p className="call-hint">
          {mode === "video" ? "Video call" : "Voice call"}
        </p>
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
              {cameraOff ? "📷" : "🎥"}
            </button>
            <div className="call-btn-label">
              {cameraOff ? "Camera on" : "Camera off"}
            </div>
          </div>
        )}

        <div>
          <button
            className="call-btn call-btn-decline"
            onClick={hangUp}
            title="End call"
          >
            📴
          </button>
          <div className="call-btn-label">End</div>
        </div>
      </div>
    </div>
  );
}
