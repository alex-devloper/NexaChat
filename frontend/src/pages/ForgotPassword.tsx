import { useState } from "react";
import { Link } from "react-router-dom";

import { api } from "../lib/api";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState("");
  const [isError, setIsError] = useState(false);
  const [loading, setLoading] = useState(false);

  // Set only after a successful request, so we can show the "check your inbox" screen.
  const [sentTo, setSentTo] = useState("");
  const [resetUrl, setResetUrl] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;

    if (!email.trim()) {
      setMsg("Please enter your email address");
      setIsError(true);
      return;
    }

    setLoading(true);
    setMsg("");
    setIsError(false);

    try {
      const res = await api.post("/api/auth/forgot-password", {
        email: email.trim(),
      });

      setMsg(res.data?.message || "");
      // Only present while the project has no mail provider (dev mode).
      setResetUrl(res.data?.resetUrl || "");
      setSentTo(email.trim());
    } catch (err: unknown) {
      const text =
        (err as { response?: { data?: { message?: string } } })?.response?.data
          ?.message || "Could not send the link. Please try again.";
      setMsg(text);
      setIsError(true);
    } finally {
      setLoading(false);
    }
  };

  const sent = !!sentTo;

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

        {sent ? (
          <>
            <div className="auth-icon">
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
                <rect x="3" y="5" width="18" height="14" rx="2.5" />
                <path d="m3.5 7 8.5 6 8.5-6" />
              </svg>
            </div>

            <h1 className="auth-title">Check your email</h1>
            <p className="auth-sub">
              We sent a password reset link to <strong>{sentTo}</strong>. The
              link expires in 15 minutes.
            </p>

            {resetUrl && (
              <a className="auth-submit auth-submit-link" href={resetUrl}>
                Open reset link
              </a>
            )}

            <div className="auth-links">
              <button
                type="button"
                className="auth-link-btn"
                onClick={() => {
                  setSentTo("");
                  setResetUrl("");
                  setMsg("");
                }}
              >
                Use a different email
              </button>

              <span>
                Remembered it? <Link to="/login">Sign in</Link>
              </span>
            </div>
          </>
        ) : (
          <>
            <h1 className="auth-title">Trouble logging in?</h1>
            <p className="auth-sub">
              Enter your email and we&apos;ll send you a link to get back into
              your account.
            </p>

            <form className="auth-form" onSubmit={handleSubmit}>
              <label className="auth-label" htmlFor="forgot-email">
                Email address
              </label>
              <input
                id="forgot-email"
                className="auth-input"
                type="email"
                placeholder="you@example.com"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />

              <button
                type="submit"
                className="auth-submit"
                disabled={loading || !email.trim()}
              >
                {loading ? "Sending link…" : "Send login link"}
              </button>
            </form>

            {msg && (
              <div className={isError ? "auth-error" : "auth-success"}>
                {msg}
              </div>
            )}

            <div className="auth-links">
              <span>
                New here?{" "}
                <Link to="/signup" className="auth-link-btn">
                  Create an account
                </Link>
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
