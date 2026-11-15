import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import Navbar from "../components/Navbar";
import { api, API_URL } from "../lib/api";
import { fileToWallpaper } from "../lib/image";
import { disablePush, enablePush, pushAlreadyEnabled } from "../lib/push";
import { resetSettings, useSettings } from "../lib/settings";
import { clearSession } from "../lib/session";
import type { Wallpaper } from "../lib/settings";

const WALLPAPERS: { id: Wallpaper; label: string; color: string }[] = [
  { id: "default", label: "Default", color: "#ffffff" },
  { id: "mint", label: "Mint", color: "#e7f6ee" },
  { id: "sand", label: "Sand", color: "#fbf4e7" },
  { id: "sky", label: "Sky", color: "#e9f1fd" },
];

function Toggle({
  on,
  onChange,
  label,
  description,
}: {
  on: boolean;
  onChange: (value: boolean) => void;
  label: string;
  description?: string;
}) {
  return (
    <div className="settings-row">
      <div>
        <div className="settings-row-title">{label}</div>
        {description && <div className="settings-row-desc">{description}</div>}
      </div>

      <button
        type="button"
        className="switch"
        data-on={on}
        aria-pressed={on}
        aria-label={label}
        onClick={() => onChange(!on)}
      >
        <span />
      </button>
    </div>
  );
}

export default function Settings() {
  const navigate = useNavigate();
  const userData = JSON.parse(sessionStorage.getItem("user") || "{}");
  const [settings, updateSettings] = useSettings();

  const [showLastSeen, setShowLastSeen] = useState(true);
  const [privacyBusy, setPrivacyBusy] = useState(false);
  const [privacyNote, setPrivacyNote] = useState("");

  const [pushOn, setPushOn] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushNote, setPushNote] = useState("");

  const [pwd, setPwd] = useState({ current: "", next: "", confirm: "" });
  const [pwdBusy, setPwdBusy] = useState(false);
  const [pwdNote, setPwdNote] = useState("");

  const [dataNote, setDataNote] = useState("");

  const [wallpaperBusy, setWallpaperBusy] = useState(false);
  const [wallpaperNote, setWallpaperNote] = useState("");

  const avatar = userData.profilePic
    ? userData.profilePic.startsWith("http")
      ? userData.profilePic
      : API_URL + userData.profilePic
    : "";

  useEffect(() => {
    if (!userData?.id) return;

    api
      .get(`/api/user/${userData.id}`)
      .then((res) => setShowLastSeen(res.data?.user?.showLastSeen !== false))
      .catch(() => setShowLastSeen(true));

    pushAlreadyEnabled()
      .then(setPushOn)
      .catch(() => setPushOn(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleLastSeen = async (value: boolean) => {
    if (privacyBusy) return;

    const previous = showLastSeen;
    setShowLastSeen(value);
    setPrivacyBusy(true);
    setPrivacyNote("");

    try {
      await api.put(`/api/user/update/${userData.id}`, { showLastSeen: value });
      setPrivacyNote(value ? "Last seen is visible to others" : "Last seen is hidden");
    } catch {
      setShowLastSeen(previous);
      setPrivacyNote("❌ Could not save this setting");
    } finally {
      setPrivacyBusy(false);
    }
  };

  const togglePush = async () => {
    if (pushBusy) return;

    setPushBusy(true);
    setPushNote("");

    try {
      if (pushOn) {
        await disablePush();
        setPushOn(false);
        setPushNote("Notifications turned off");
      } else {
        const result = await enablePush();
        setPushOn(result.push);
        setPushNote(result.message);
        localStorage.setItem("nexachat_alerts", "1");
      }
    } catch {
      setPushNote("❌ Could not change notification settings");
    } finally {
      setPushBusy(false);
    }
  };

  const changePassword = async () => {
    if (pwdBusy) return;

    setPwdNote("");

    if (!pwd.current || !pwd.next) {
      setPwdNote("❌ Enter your current and new password");
      return;
    }

    if (pwd.next.length < 6) {
      setPwdNote("❌ New password must be at least 6 characters");
      return;
    }

    if (pwd.next !== pwd.confirm) {
      setPwdNote("❌ New passwords do not match");
      return;
    }

    setPwdBusy(true);

    try {
      const res = await api.post("/api/auth/change-password", {
        currentPassword: pwd.current,
        newPassword: pwd.next,
      });

      setPwd({ current: "", next: "", confirm: "" });
      setPwdNote(res.data?.message || "✅ Password changed");
    } catch (err) {
      const message =
        (err as { response?: { data?: { message?: string } } })?.response?.data
          ?.message || "❌ Could not change password";
      setPwdNote(message);
    } finally {
      setPwdBusy(false);
    }
  };

  const pickWallpaper = async (file?: File) => {
    if (!file || wallpaperBusy) return;

    if (!file.type.startsWith("image/")) {
      setWallpaperNote("❌ Please choose an image file");
      return;
    }

    if (file.size > 15 * 1024 * 1024) {
      setWallpaperNote("❌ Photo is too large (max 15 MB)");
      return;
    }

    setWallpaperBusy(true);
    setWallpaperNote("");

    try {
      const dataUrl = await fileToWallpaper(file);
      updateSettings({ wallpaper: "custom", customWallpaper: dataUrl });
      setWallpaperNote("✅ Wallpaper updated");
    } catch {
      setWallpaperNote("❌ Could not use this photo, try another one");
    } finally {
      setWallpaperBusy(false);
    }
  };

  const removeWallpaper = () => {
    updateSettings({ wallpaper: "default", customWallpaper: "" });
    setWallpaperNote("Custom wallpaper removed");
  };

  const clearLocalData = () => {
    resetSettings();
    localStorage.removeItem("nexachat_alerts");
    setDataNote("✅ Local app settings cleared");
  };

  const logout = () => {
    clearSession();
    navigate("/login");
  };

  return (
    <>
      <Navbar />

      <div className="settings-wrap">
        <h2 style={{ margin: "4px 0 2px" }}>Settings</h2>
        <p className="settings-sub">Manage your account, chats and notifications</p>

        {/* Account */}
        <section className="settings-card">
          <h3>Account</h3>

          <div className="settings-profile">
            <div className="settings-avatar">
              {avatar ? <img src={avatar} alt="dp" /> : <span>👤</span>}
            </div>

            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 800, fontSize: 16 }}>
                {userData.name || "User"}
              </div>
              <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
                @{userData.username || "username"}
              </div>
              {userData.email && (
                <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                  {userData.email}
                </div>
              )}
            </div>

            <button className="settings-btn" onClick={() => navigate("/profile")}>
              Edit profile
            </button>
          </div>
        </section>

        {/* Privacy */}
        <section className="settings-card">
          <h3>Privacy</h3>

          <Toggle
            on={showLastSeen}
            onChange={toggleLastSeen}
            label="Show last seen"
            description={
              showLastSeen
                ? "Others can see when you were last active"
                : "Nobody can see your last seen time"
            }
          />

          {privacyNote && <div className="settings-note">{privacyNote}</div>}
        </section>

        {/* Chats */}
        <section className="settings-card">
          <h3>Chats</h3>

          <Toggle
            on={settings.enterToSend}
            onChange={(value) => updateSettings({ enterToSend: value })}
            label="Send with Enter"
            description="Off: use the Send button (Shift+Enter always adds a new line)"
          />

          <div className="settings-row">
            <div>
              <div className="settings-row-title">Chat wallpaper</div>
              <div className="settings-row-desc">Background of the message area</div>
            </div>

            <div style={{ display: "flex", gap: 8 }}>
              {WALLPAPERS.map((wall) => (
                <button
                  key={wall.id}
                  type="button"
                  title={wall.label}
                  aria-label={wall.label}
                  className="wallpaper-swatch"
                  data-active={settings.wallpaper === wall.id}
                  style={{ background: wall.color }}
                  onClick={() => updateSettings({ wallpaper: wall.id })}
                />
              ))}
            </div>
          </div>

          <div className="settings-row">
            <div>
              <div className="settings-row-title">Custom wallpaper</div>
              <div className="settings-row-desc">
                Apni photo upload karo (device par save hoti hai)
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {settings.wallpaper === "custom" && settings.customWallpaper && (
                <img
                  src={settings.customWallpaper}
                  alt="Custom wallpaper"
                  className="wallpaper-thumb"
                />
              )}

              <label className="settings-btn" data-busy={wallpaperBusy}>
                {wallpaperBusy
                  ? "Please wait…"
                  : settings.customWallpaper
                  ? "Change"
                  : "Upload"}
                <input
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={(e) => {
                    pickWallpaper(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
              </label>

              {!!settings.customWallpaper && (
                <button
                  type="button"
                  className="settings-btn settings-btn-ghost"
                  onClick={removeWallpaper}
                >
                  Remove
                </button>
              )}
            </div>
          </div>

          {wallpaperNote && <div className="settings-note">{wallpaperNote}</div>}
        </section>

        {/* Notifications */}
        <section className="settings-card">
          <h3>Notifications</h3>

          <Toggle
            on={settings.messageTone}
            onChange={(value) => updateSettings({ messageTone: value })}
            label="Message tone"
            description="Short beep when a new message arrives"
          />

          <Toggle
            on={settings.notificationPopups}
            onChange={(value) => updateSettings({ notificationPopups: value })}
            label="In-app notifications"
            description="Popup card when a message arrives on another screen"
          />

          <Toggle
            on={settings.messagePreview}
            onChange={(value) => updateSettings({ messagePreview: value })}
            label="Message preview"
            description={
              settings.messagePreview
                ? "Notification shows the message text"
                : "Notification only shows the sender name"
            }
          />

          <div className="settings-row">
            <div>
              <div className="settings-row-title">Browser notifications</div>
              <div className="settings-row-desc">
                {pushOn
                  ? "On — you get alerts even when the tab is closed"
                  : "Off — alerts only while NexaChat is open"}
              </div>
            </div>

            <button
              type="button"
              className="settings-btn"
              onClick={togglePush}
              disabled={pushBusy}
              style={{ background: pushOn ? "#ef4444" : "#0f9d58" }}
            >
              {pushBusy ? "Please wait…" : pushOn ? "Turn off" : "Turn on"}
            </button>
          </div>

          {pushNote && <div className="settings-note">{pushNote}</div>}
        </section>

        {/* Security */}
        <section className="settings-card">
          <h3>Security</h3>

          <div style={{ padding: "10px 0 14px" }}>
            <label className="settings-label">Current password</label>
            <input
              type="password"
              className="settings-input"
              value={pwd.current}
              autoComplete="current-password"
              onChange={(e) => setPwd({ ...pwd, current: e.target.value })}
            />

            <label className="settings-label">New password</label>
            <input
              type="password"
              className="settings-input"
              value={pwd.next}
              autoComplete="new-password"
              onChange={(e) => setPwd({ ...pwd, next: e.target.value })}
            />

            <label className="settings-label">Confirm new password</label>
            <input
              type="password"
              className="settings-input"
              value={pwd.confirm}
              autoComplete="new-password"
              onChange={(e) => setPwd({ ...pwd, confirm: e.target.value })}
            />

            <button
              type="button"
              className="settings-btn"
              onClick={changePassword}
              disabled={pwdBusy}
              style={{ marginTop: 12, width: "100%" }}
            >
              {pwdBusy ? "Updating…" : "Change password"}
            </button>

            {pwdNote && <div className="settings-note">{pwdNote}</div>}
          </div>
        </section>

        {/* Storage */}
        <section className="settings-card">
          <h3>Storage &amp; data</h3>

          <div className="settings-row">
            <div>
              <div className="settings-row-title">Reset app settings</div>
              <div className="settings-row-desc">
                Restores default tones, wallpaper and notification options
              </div>
            </div>

            <button
              type="button"
              className="settings-btn settings-btn-ghost"
              onClick={clearLocalData}
            >
              Reset
            </button>
          </div>

          {dataNote && <div className="settings-note">{dataNote}</div>}
        </section>

        {/* About */}
        <section className="settings-card">
          <h3>About</h3>

          <div className="settings-row">
            <div>
              <div className="settings-row-title">NexaChat</div>
              <div className="settings-row-desc">Version 1.0.0 · Secure messaging &amp; calls</div>
            </div>
          </div>

          <div className="settings-row">
            <div>
              <div className="settings-row-title">Log out of this device</div>
              <div className="settings-row-desc">You can log back in anytime</div>
            </div>

            <button
              type="button"
              className="settings-btn settings-btn-danger"
              onClick={logout}
            >
              Log out
            </button>
          </div>
        </section>
      </div>
    </>
  );
}
