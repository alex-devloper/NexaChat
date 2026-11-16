import { useEffect, useRef, useState } from "react";
import { api, mediaUrl } from "../lib/api";
import Navbar from "../components/Navbar";
import AvatarEditor from "../components/profile/AvatarEditor";

export default function Profile() {
  const userData = JSON.parse(sessionStorage.getItem("user") || "{}");

  const [name, setName] = useState(userData.name || "");
  const [about, setAbout] = useState(userData.about || "");
  const [profilePic, setProfilePic] = useState(userData.profilePic || "");

  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string>("");
  const [editMode, setEditMode] = useState(false);

  const fileRef = useRef<HTMLInputElement | null>(null);
  const cameraRef = useRef<HTMLInputElement | null>(null);

  // Photo picked but not saved yet (shown in the crop editor).
  const [pendingPhoto, setPendingPhoto] = useState<{
    file: File;
    url: string;
  } | null>(null);

  const clearPending = () => {
    setPendingPhoto((prev) => {
      if (prev) URL.revokeObjectURL(prev.url);
      return null;
    });
  };

  const pickPhoto = (file: File | undefined) => {
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setMsg("❌ Please choose an image file");
      return;
    }

    if (file.size > 15 * 1024 * 1024) {
      setMsg("❌ Photo is too large (max 15 MB)");
      return;
    }

    clearPending();
    setMsg("");
    setPendingPhoto({ file, url: URL.createObjectURL(file) });
  };

  useEffect(() => {
    setName(userData.name || "");
    setAbout(userData.about || "");
    setProfilePic(userData.profilePic || "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ✅ Save profile (name + about + profilePic)
  const saveProfile = async (newProfilePic?: string) => {
    if (!userData?.id) return;

    try {
      setSaving(true);
      setMsg("");

      const finalProfilePic =
        typeof newProfilePic === "string" ? newProfilePic : profilePic;

      // ✅ IMPORTANT: tumhara route /api/user/update/:id hai
      const res = await api.put(`/api/user/update/${userData.id}`,
        {
          name,
          about,
          profilePic: finalProfilePic,
        }
      );

      const updatedUser = {
        ...userData,
        name: res.data.user.name,
        about: res.data.user.about,
        profilePic: res.data.user.profilePic,
      };

      // ✅ update storage
      sessionStorage.setItem("user", JSON.stringify(updatedUser));
      localStorage.setItem("user", JSON.stringify(updatedUser));

      // ✅ update UI
      setProfilePic(res.data.user.profilePic || "");
      setMsg("✅ Profile updated!");
    } catch (err) {
      console.log("Save profile error:", err);
      setMsg("❌ Failed to update profile");
    } finally {
      setSaving(false);
    }
  };

  // ✅ Upload DP
  const uploadDp = async (file: File) => {
    try {
      setSaving(true);
      setMsg("");

      const formData = new FormData();
      formData.append("file", file);

      const res = await api.post("/api/upload", formData);

      const url = res.data?.file?.url;
      if (!url) {
        setMsg("❌ Upload failed");
        return;
      }

      // ✅ save uploaded url
      await saveProfile(url);
      setMsg("✅ Profile photo updated!");
    } catch (err) {
      console.log("DP upload error:", err);
      setMsg("❌ Failed to upload photo");
    } finally {
      setSaving(false);
    }
  };

  // ✅ Remove DP
  const removeDp = async () => {
    if (saving) return;
    setProfilePic("");
    await saveProfile("");
    setMsg("✅ Profile photo removed!");
  };

  return (
    <>
      {/* ✅ Navbar */}
      <Navbar />

      <div style={{ padding: 20, maxWidth: 520, margin: "0 auto" }}>
        <h2 style={{ marginBottom: 10 }}>My Profile</h2>

        {/* ✅ Profile Card */}
        <div
          style={{
            marginTop: 10,
            padding: 16,
            border: "1px solid var(--border)",
            borderRadius: 16,
            background: "var(--bg-card)",
            display: "flex",
            gap: 16,
            alignItems: "center",
          }}
        >
          {/* DP */}
          <div
            onClick={() => fileRef.current?.click()}
            title="Click to change photo"
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
              cursor: "pointer",
              border: "2px solid #ddd",
            }}
          >
            {profilePic ? (
              <img
                src={mediaUrl(profilePic)}
                alt="dp"
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
            ) : (
              <span style={{ fontSize: 40 }}>👤</span>
            )}
          </div>

          {/* Info */}
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 900, fontSize: 18 }}>
              {name || "User"}
            </div>

            <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 2 }}>
              @{userData.username || "username"}
            </div>

            <div
              style={{ marginTop: 8, fontSize: 13, color: "var(--text-muted)" }}
            >
              {about ? about : "No bio yet"}
            </div>

            <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
              <button
                onClick={() => setEditMode((p) => !p)}
                style={{
                  padding: "8px 12px",
                  borderRadius: 10,
                  border: "1px solid var(--border)",
                  background: "var(--bg-card)",
                  cursor: "pointer",
                  fontWeight: 700,
                  flex: 1,
                }}
              >
                {editMode ? "Close Edit" : "Edit Profile"}
              </button>

              <button
                onClick={() => fileRef.current?.click()}
                disabled={saving}
                style={{
                  padding: "8px 12px",
                  borderRadius: 10,
                  border: "none",
                  background: saving ? "gray" : "var(--primary)",
                  color: "#04140d",
                  cursor: "pointer",
                  fontWeight: 800,
                  flex: 1,
                }}
              >
                {saving ? "Uploading..." : "Change Photo"}
              </button>
            </div>

            <div style={{ marginTop: 10 }}>
              <button
                onClick={removeDp}
                disabled={saving}
                style={{
                  padding: "8px 12px",
                  borderRadius: 10,
                  border: "1px solid #ff3b30",
                  background: "var(--bg-card)",
                  color: "#ff3b30",
                  cursor: "pointer",
                  fontWeight: 800,
                  width: "100%",
                }}
              >
                Remove Photo
              </button>
            </div>

            <button
              onClick={() => cameraRef.current?.click()}
              disabled={saving}
              style={{
                marginTop: 8,
                padding: "8px 12px",
                borderRadius: 10,
                border: "1px solid var(--border)",
                background: "var(--bg-card)",
                cursor: "pointer",
                fontWeight: 700,
                width: "100%",
              }}
            >
              📷 Take Photo
            </button>

            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              style={{ display: "none" }}
              onChange={(e) => {
                pickPhoto(e.target.files?.[0]);
                e.target.value = "";
              }}
            />

            <input
              ref={cameraRef}
              type="file"
              accept="image/*"
              capture="user"
              style={{ display: "none" }}
              onChange={(e) => {
                pickPhoto(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </div>
        </div>

        {/* ✅ Edit Mode */}
        {editMode && (
          <div
            style={{
              marginTop: 14,
              padding: 16,
              border: "1px solid var(--border)",
              borderRadius: 16,
              background: "var(--bg-card)",
            }}
          >
            <h3 style={{ marginTop: 0, marginBottom: 10 }}>Edit Profile</h3>

            <div style={{ marginTop: 10 }}>
              <label style={{ fontSize: 13, fontWeight: 700 }}>Name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
                style={{
                  width: "100%",
                  marginTop: 6,
                  padding: 10,
                  border: "1px solid var(--border)",
                  borderRadius: 10,
                  outline: "none",
                  background: "var(--surface-2)",
                  color: "var(--text-main)",
                  fontSize: 14,
                }}
              />
            </div>

            <div style={{ marginTop: 14 }}>
              <label style={{ fontSize: 13, fontWeight: 700 }}>About</label>
              <textarea
                value={about}
                onChange={(e) => setAbout(e.target.value)}
                placeholder="Write something about you..."
                style={{
                  width: "100%",
                  marginTop: 6,
                  padding: 10,
                  border: "1px solid var(--border)",
                  borderRadius: 10,
                  outline: "none",
                  resize: "none",
                  minHeight: 80,
                  background: "var(--surface-2)",
                  color: "var(--text-main)",
                  fontSize: 14,
                  fontFamily: "inherit",
                }}
              />
            </div>

            <button
              onClick={() => saveProfile()}
              disabled={saving}
              style={{
                marginTop: 14,
                padding: "10px 14px",
                borderRadius: 12,
                border: "none",
                background: saving ? "gray" : "var(--primary)",
                color: "#04140d",
                cursor: "pointer",
                fontWeight: 900,
                width: "100%",
                fontSize: 14,
              }}
            >
              {saving ? "Saving..." : "Save Changes"}
            </button>
          </div>
        )}

        {pendingPhoto && (
          <AvatarEditor
            src={pendingPhoto.url}
            busy={saving}
            onCancel={clearPending}
            onSave={async (file) => {
              await uploadDp(file);
              clearPending();
            }}
          />
        )}

        {msg && (
          <div
            style={{ marginTop: 14, fontSize: 13, color: "var(--text-main)" }}
          >
            {msg}
          </div>
        )}
      </div>
    </>
  );
}
