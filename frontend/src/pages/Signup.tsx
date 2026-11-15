import { useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";

import { api } from "../lib/api";

export default function Signup() {
  const navigate = useNavigate();

  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);
  const [loading, setLoading] = useState(false);

  // Already signed in? No need to show the signup form.
  if (sessionStorage.getItem("token")) {
    return <Navigate to="/chat" replace />;
  }

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;

    const cleanName = name.trim();
    const cleanUsername = username.trim().toLowerCase();
    const cleanEmail = email.trim().toLowerCase();

    if (!cleanName || !cleanUsername || !cleanEmail || !password) {
      setMessage("Please fill in every field");
      setIsError(true);
      return;
    }

    if (!/^[a-z0-9._]{3,24}$/.test(cleanUsername)) {
      setMessage(
        "Username must be 3-24 characters (letters, numbers, dot or underscore)"
      );
      setIsError(true);
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(cleanEmail)) {
      setMessage("Please enter a valid email address");
      setIsError(true);
      return;
    }

    if (password.length < 6) {
      setMessage("Password must be at least 6 characters");
      setIsError(true);
      return;
    }

    setLoading(true);
    setMessage("");
    setIsError(false);

    try {
      const res = await api.post("/api/auth/signup", {
        name: cleanName,
        username: cleanUsername,
        email: cleanEmail,
        password,
      });

      sessionStorage.setItem("token", res.data.token);
      sessionStorage.setItem("user", JSON.stringify(res.data.user));
      window.dispatchEvent(new Event("nexa:auth"));

      navigate("/chat");
    } catch (err: unknown) {
      const text =
        (err as { response?: { data?: { message?: string } } })?.response?.data
          ?.message || "Signup failed. Please try again.";
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

        <h1 className="auth-title">Create your account</h1>
        <p className="auth-sub">
          Join AmoraLock and start private conversations in seconds.
        </p>

        <form className="auth-form" onSubmit={handleSignup}>
          <label className="auth-label" htmlFor="signup-name">
            Name
          </label>
          <input
            id="signup-name"
            className="auth-input"
            type="text"
            placeholder="Your full name"
            autoComplete="name"
            maxLength={60}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />

          <label className="auth-label" htmlFor="signup-username">
            Username
          </label>
          <input
            id="signup-username"
            className="auth-input"
            type="text"
            placeholder="letters, numbers, dot or _"
            autoComplete="username"
            maxLength={24}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />

          <label className="auth-label" htmlFor="signup-email">
            Email
          </label>
          <input
            id="signup-email"
            className="auth-input"
            type="email"
            placeholder="you@example.com"
            autoComplete="email"
            maxLength={120}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />

          <label className="auth-label" htmlFor="signup-pass">
            Password
          </label>
          <div className="auth-pass-wrap">
            <input
              id="signup-pass"
              className="auth-input"
              type={showPassword ? "text" : "password"}
              placeholder="At least 6 characters"
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

          <button type="submit" className="auth-submit" disabled={loading}>
            {loading ? "Creating account…" : "Create account"}
          </button>
        </form>

        {message && (
          <div className={isError ? "auth-error" : "auth-success"}>{message}</div>
        )}

        <div className="auth-links">
          <span>
            Already have an account? <Link to="/login">Log in</Link>
          </span>
        </div>
      </div>
    </div>
  );
}
