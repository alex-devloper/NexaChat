import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import io, { Socket } from "socket.io-client";

import { API_URL, getAuthToken } from "./api";

/**
 * One socket per browser tab, shared by every page.
 * It re-reads the token when auth changes, so logging in on /login connects
 * immediately instead of waiting for a page reload.
 */
const SocketContext = createContext<Socket | null>(null);

function readUser(): {
  id?: string;
  name?: string;
  username?: string;
  profilePic?: string;
} {
  try {
    const raw =
      sessionStorage.getItem("user") || localStorage.getItem("user") || "{}";
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export function SocketProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string>(() => getAuthToken());
  const [socket, setSocket] = useState<Socket | null>(null);

  // Keep the token in sync with login/logout (and with other tabs).
  useEffect(() => {
    const refresh = () => setToken(getAuthToken());

    window.addEventListener("nexa:auth", refresh);
    window.addEventListener("storage", refresh);

    return () => {
      window.removeEventListener("nexa:auth", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  useEffect(() => {
    if (!token) {
      setSocket(null);
      return;
    }

    const s = io(API_URL, {
      transports: ["websocket"],
      auth: { token },
    });

    const announce = () => {
      const user = readUser();
      if (!user?.id) return;

      s.emit("joinUser", {
        userId: user.id,
        name: user.name,
        username: user.username,
        profilePic: user.profilePic,
      });
    };

    // Re-announce on every reconnect so the user does not stay "offline".
    s.on("connect", announce);
    if (s.connected) announce();

    if (import.meta.env.DEV) {
      // Handy for debugging a bad connection from the console.
      (window as unknown as { __nexaSocket?: Socket }).__nexaSocket = s;
      s.on("connect_error", (err) =>
        console.error("Socket connection error:", err.message)
      );
    }

    setSocket(s);

    return () => {
      s.off("connect", announce);
      setSocket(null);
      s.disconnect();
    };
  }, [token]);

  return (
    <SocketContext.Provider value={socket}>{children}</SocketContext.Provider>
  );
}

export function useSocket(): Socket | null {
  return useContext(SocketContext);
}
