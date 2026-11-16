import { useNavigate } from "react-router-dom";

import { mediaUrl } from "../lib/api";
import { clearSession } from "../lib/session";

type Props = {
  onLogout?: () => void;
};

export default function Navbar({ onLogout }: Props) {
  const navigate = useNavigate();

  const userData = JSON.parse(sessionStorage.getItem("user") || "{}");
  const avatar = mediaUrl(userData.profilePic);

  const handleLogout = () => {
    onLogout?.();

    clearSession();

    navigate("/login");
  };

  return (
    <header className="topbar">
      <div
        className="topbar-brand"
        onClick={() => navigate("/chat")}
        title="Go to chats"
      >
        <span className="brand-mark">N</span>
        AmoraLock
      </div>

      <div className="topbar-actions">
        <button
          type="button"
          className="icon-btn"
          onClick={() => navigate("/chat")}
          title="Chats"
          aria-label="Chats"
        >
          💬
        </button>

        <button
          type="button"
          className="icon-btn"
          onClick={() => navigate("/settings")}
          title="Settings"
          aria-label="Settings"
        >
          ⚙️
        </button>

        <div
          className="nav-avatar"
          onClick={() => navigate("/profile")}
          title={userData.name ? `${userData.name} · profile` : "Profile"}
        >
          {avatar ? <img src={avatar} alt="" /> : "👤"}
        </div>

        <button type="button" className="nav-logout" onClick={handleLogout}>
          Log out
        </button>
      </div>
    </header>
  );
}
