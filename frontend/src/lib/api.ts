import axios from "axios";

/**
 * Single place for the backend origin.
 * Set VITE_API_URL in frontend/.env (see .env.example).
 */
export const API_URL = (
  import.meta.env.VITE_API_URL || "http://localhost:5000"
).replace(/\/+$/, "");

export const api = axios.create({ baseURL: API_URL });

/**
 * Turns any stored media path into a URL the browser can actually load.
 * Older records may hold an absolute URL pointing at a dev box or a LAN IP
 * (e.g. http://192.168.31.188:5000/uploads/a.jpg); those hosts are unreachable
 * from the deployed site, so the file path is re-pointed at API_URL.
 */
export function mediaUrl(value?: string | null): string {
  if (!value) return "";

  if (!/^https?:\/\//i.test(value)) {
    return `${API_URL}${value.startsWith("/") ? "" : "/"}${value}`;
  }

  try {
    const parsed = new URL(value);
    const host = parsed.hostname;

    const isDevHost =
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "0.0.0.0" ||
      /^192\.168\./.test(host) ||
      /^10\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host);

    if (isDevHost) {
      return `${API_URL}${parsed.pathname}${parsed.search}`;
    }

    return value;
  } catch {
    return value;
  }
}

/** Attach the Bearer token to every request. */
api.interceptors.request.use((config) => {
  const token =
    sessionStorage.getItem("token") || localStorage.getItem("token");

  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  return config;
});

/**
 * An expired or invalid session should land on /login instead of leaving
 * every page silently broken.
 */
api.interceptors.response.use(
  (response) => response,
  (error: unknown) => {
    const axiosError = error as {
      response?: { status?: number };
      config?: { url?: string };
    };

    const status = axiosError.response?.status;
    const url = axiosError.config?.url || "";
    const isAuthAttempt = /\/api\/auth\/(login|signup|forgot-password|reset-password)/.test(
      url
    );

    if (status === 401 && !isAuthAttempt) {
      sessionStorage.removeItem("token");
      sessionStorage.removeItem("user");
      localStorage.removeItem("token");
      localStorage.removeItem("user");
      window.dispatchEvent(new Event("nexa:auth"));

      if (window.location.pathname !== "/login") {
        window.location.href = "/login";
      }
    }

    return Promise.reject(error);
  }
);

/** Read the token for the socket handshake. */
export function getAuthToken(): string {
  return sessionStorage.getItem("token") || localStorage.getItem("token") || "";
}

export default api;
