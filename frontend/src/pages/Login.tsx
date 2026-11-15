import { useState } from "react";
import { api } from "../lib/api";
import { useNavigate, Link } from "react-router-dom";

export default function Login() {
  const [emailOrUsername, setEmailOrUsername] = useState("");
  const [password, setPassword] = useState("");

  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);
  const [loading, setLoading] = useState(false);

  const [showPassword, setShowPassword] = useState(false);

  const navigate = useNavigate();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();

    if (loading) return;

    setMessage("");
    setIsError(false);
    setLoading(true);

    try {
      const res = await api.post("/api/auth/login", {
        emailOrUsername,
        password,
      });

      sessionStorage.setItem("token", res.data.token);
      sessionStorage.setItem("user", JSON.stringify(res.data.user));

      // Let the shared socket connect before the chat page mounts.
      window.dispatchEvent(new Event("nexa:auth"));

      navigate("/chat");
    } catch (err: unknown) {
      const text =
        (err as { response?: { data?: { message?: string } } })?.response?.data
          ?.message || "Login failed. Please try again.";
      setMessage(text);
      setIsError(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-brand">
          <span className="brand-mark">N</span>
          <span>AmoraLock</span>
        </div>

        <h1 className="auth-title">Welcome back</h1>
        <p className="auth-sub">Sign in to continue your conversations</p>

        <form onSubmit={handleLogin} className="auth-form">
          <label className="auth-label" htmlFor="login-id">
            Email or username
          </label>
          <input
            id="login-id"
            className="auth-input"
            type="text"
            placeholder="you@example.com"
            autoComplete="username"
            value={emailOrUsername}
            onChange={(e) => setEmailOrUsername(e.target.value)}
          />

          <label className="auth-label" htmlFor="login-pass">
            Password
          </label>
          <div className="auth-pass-wrap">
            <input
              id="login-pass"
              className="auth-input"
              type={showPassword ? "text" : "password"}
              placeholder="••••••••"
              autoComplete="current-password"
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

          <button
            type="submit"
            className="auth-submit"
            disabled={loading}
          >
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>

        {message && (
          <div className={isError ? "auth-error" : "auth-success"}>{message}</div>
        )}

        <div className="auth-links">
          <Link to="/forgot-password">Forgot password?</Link>

          <span>
            New here?{" "}
            <button
              type="button"
              className="auth-link-btn"
              onClick={() => navigate("/signup")}
            >
              Create an account
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}
