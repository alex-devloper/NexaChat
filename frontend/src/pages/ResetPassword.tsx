import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { api } from "../lib/api";

export default function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get("token") || "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [msg, setMsg] = useState("");
  const [isError, setIsError] = useState(false);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;

    if (password.length < 6) {
      setMsg("Password must be at least 6 characters");
      setIsError(true);
      return;
    }

    if (password !== confirm) {
      setMsg("Both passwords must match");
      setIsError(true);
      return;
    }

    setLoading(true);
    setMsg("");
    setIsError(false);

    try {
      const res = await api.post("/api/auth/reset-password", {
        token,
        newPassword: password,
      });

      setMsg(res.data?.message || "Password reset successful");
      setDone(true);
    } catch (err: unknown) {
      const text =
        (err as { response?: { data?: { message?: string } } })?.response?.data
          ?.message || "Could not reset your password. Please try again.";
      setMsg(text);
      setIsError(true);
    } finally {
      setLoading(false);
    }
  };

  // No link token at all: the user opened this page directly.
  if (!token) {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <div className="auth-brand">
            <span className="brand-mark">N</span>
            <span>AmoraLock</span>
          </div>

          <div className="auth-icon auth-icon-danger">
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 9v5" />
              <circle cx="12" cy="17" r="0.9" fill="currentColor" />
              <path d="M10.3 3.9 2.6 17.2A2 2 0 0 0 4.3 20h15.4a2 2 0 0 0 1.7-2.8L13.7 3.9a2 2 0 0 0-3.4 0Z" />
            </svg>
          </div>

          <h1 className="auth-title">Link is invalid</h1>
          <p className="auth-sub">
            This password reset link is missing or has already been used.
            Request a fresh one and try again.
          </p>

          <Link to="/forgot-password" className="auth-submit auth-submit-link">
            Request a new link
          </Link>

          <div className="auth-links">
            <span>
              <Link to="/login">Back to login</Link>
            </span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <Link to="/login" className="auth-back">
          ← Back to login
        </Link>

        <div className="auth-brand">
          <span className="brand-mark">N</span>
          <span>AmoraLock</span>
        </div>

        {done ? (
          <>
            <div className="auth-icon">
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="m4 12.5 5 5L20 6.5" />
              </svg>
            </div>

            <h1 className="auth-title">Password updated</h1>
            <p className="auth-sub">
              Your new password is ready. Sign in to get back to your chats.
            </p>

            <Link to="/login" className="auth-submit auth-submit-link">
              Continue to login
            </Link>
          </>
        ) : (
          <>
            <h1 className="auth-title">Choose a new password</h1>
            <p className="auth-sub">
              Your reset link is verified. Pick a strong password you have not
              used before.
            </p>

            <form className="auth-form" onSubmit={handleReset}>
              <label className="auth-label" htmlFor="reset-pass">
                New password
              </label>
              <div className="auth-pass-wrap">
                <input
                  id="reset-pass"
                  className="auth-input"
                  type={showPassword ? "text" : "password"}
                  placeholder="••••••••"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  style={{ paddingRight: 64 }}
                />

                <button
                  type="button"
                  className="auth-pass-toggle"
                  onClick={() => setShowPassword((prev) => !prev)}
                >
                  {showPassword ? "Hide" : "Show"}
                </button>
              </div>

              <label className="auth-label" htmlFor="reset-confirm">
                Confirm password
              </label>
              <input
                id="reset-confirm"
                className="auth-input"
                type={showPassword ? "text" : "password"}
                placeholder="••••••••"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />

              <p className="auth-hint">At least 6 characters.</p>

              <button
                type="submit"
                className="auth-submit"
                disabled={loading || !password || !confirm}
              >
                {loading ? "Updating…" : "Reset password"}
              </button>
            </form>

            {msg && (
              <div className={isError ? "auth-error" : "auth-success"}>
                {msg}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
