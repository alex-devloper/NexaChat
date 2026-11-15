import axios from "axios";

/**
 * Single place for the backend origin.
 * Set VITE_API_URL in frontend/.env (see .env.example).
 */
export const API_URL = (
  import.meta.env.VITE_API_URL || "http://localhost:5000"
).replace(/\/+$/, "");

export const api = axios.create({ baseURL: API_URL });

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
