import { useEffect, useState } from "react";
import { api, API_URL } from "../lib/api";
import { useNavigate, useParams } from "react-router-dom";

import { openPhotoViewer } from "../lib/photoViewer";

type UserProfile = {
  id: string;
  name: string;
  username: string;
  about: string;
  profilePic: string;
  isOnline: boolean;
  lastSeen?: string | null;
};

export default function PublicProfile() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const formatLastSeen = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMin = Math.floor(diffMs / (1000 * 60));
    const diffHr = Math.floor(diffMin / 60);

    if (diffMin < 1) return "just now";
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffHr < 24) return `${diffHr}h ago`;

    return date.toLocaleString("en-IN", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  useEffect(() => {
    if (!id) return;

    setLoading(true);

    api
      .get(`/api/user/${id}`)
      .then((res) => setUser(res.data.user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, [id]);

  return (
    <div style={{ padding: 20, maxWidth: 520, margin: "0 auto" }}>
      <button
        onClick={() => navigate(-1)}
        style={{
          padding: "8px 12px",
          borderRadius: 10,
          cursor: "pointer",
          border: "1px solid var(--border)",
          background: "var(--bg-card)",
          marginBottom: 14,
          fontWeight: 700,
        }}
      >
        ⬅ Back
      </button>

      {loading && <p>Loading...</p>}

      {!loading && !user && <p>User not found ❌</p>}

      {!loading && user && (
        <div
          style={{
            border: "1px solid var(--border)",
            borderRadius: 16,
            padding: 16,
            background: "var(--bg-card)",
          }}
        >
          <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
            <div
              onClick={() => {
                if (!user.profilePic) return;
                openPhotoViewer(
                  user.profilePic.startsWith("http")
                    ? user.profilePic
                    : API_URL + user.profilePic,
                  user.name
                );
              }}
              title={user.profilePic ? "View photo" : undefined}
              style={{
                width: 92,
                height: 92,
                borderRadius: "50%",
                background: "var(--surface-3)",
                overflow: "hidden",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                cursor: user.profilePic ? "pointer" : "default",
              }}
            >
              {user.profilePic ? (
                <img
                  src={
                    user.profilePic.startsWith("http")
                      ? user.profilePic
                      : API_URL + user.profilePic
                  }
                  alt="dp"
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                />
              ) : (
                <span style={{ fontSize: 40 }}>👤</span>
              )}
            </div>

            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 900, fontSize: 18 }}>{user.name}</div>
              <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 2 }}>
                @{user.username}
              </div>

              <div style={{ marginTop: 8, fontSize: 12, color: "var(--text-muted)" }}>
                {user.isOnline
                  ? "Online"
                  : user.lastSeen
                  ? `Active ${formatLastSeen(user.lastSeen)}`
                  : ""}
              </div>
            </div>
          </div>

          <div
            style={{ marginTop: 14, fontSize: 13, color: "var(--text-main)" }}
          >
            {user.about ? user.about : "No bio"}
          </div>

          <div
            style={{
              marginTop: 16,
              padding: 12,
              borderRadius: 12,
              background: "var(--surface-2)",
              border: "1px solid var(--border)",
              fontSize: 13,
              color: "var(--text-muted)",
            }}
          >
            ✅ This is a public profile (view only). You cannot edit other user's
            profile.
          </div>
        </div>
      )}
    </div>
  );
}
