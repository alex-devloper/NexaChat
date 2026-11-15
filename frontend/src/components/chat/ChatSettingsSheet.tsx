import { useState } from "react";

import { API_URL } from "../../lib/api";

type Props = {
  user: { userId: string; name: string; username?: string; profilePic?: string };
  muted: boolean;
  wallpaper?: string;
  blocked: boolean;
  blockedByThem: boolean;
  onClose: () => void;
  onViewProfile: () => void;
  onToggleMute: (value: boolean) => void;
  onPickWallpaper: (file: File) => Promise<void> | void;
  onResetWallpaper: () => void;
  onClearChat: () => Promise<void> | void;
  onToggleBlock: (blocked: boolean) => Promise<void> | void;
};

/** Per-contact settings, like WhatsApp's chat options. */
export default function ChatSettingsSheet({
  user,
  muted,
  wallpaper,
  blocked,
  blockedByThem,
  onClose,
  onViewProfile,
  onToggleMute,
  onPickWallpaper,
  onResetWallpaper,
  onClearChat,
  onToggleBlock,
}: Props) {
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmBlock, setConfirmBlock] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  const avatar = user.profilePic
    ? user.profilePic.startsWith("http")
      ? user.profilePic
      : API_URL + user.profilePic
    : "";

  const run = async (task: () => Promise<void> | void) => {
    if (busy) return;
    setBusy(true);
    try {
      await task();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grabber" />

        <div className="sheet-head">
          <strong>Chat settings</strong>
          <button type="button" className="sheet-close" onClick={onClose}>
            ✕
          </button>
        </div>

        <button type="button" className="sheet-contact" onClick={onViewProfile}>
          <div className="chat-avatar">
            {avatar ? <img src={avatar} alt="" /> : "👤"}
          </div>
          <div style={{ minWidth: 0, flex: 1, textAlign: "left" }}>
            <div className="chat-name">{user.name}</div>
            <div className="chat-head-status">
              {user.username ? `@${user.username}` : "View profile"}
            </div>
          </div>
          <span className="sheet-chevron">›</span>
        </button>

        <div className="sheet-row">
          <div>
            <div className="sheet-row-title">Mute notifications</div>
            <div className="sheet-row-desc">
              No sound or popup for this chat
            </div>
          </div>
          <button
            type="button"
            className="switch"
            data-on={muted}
            aria-pressed={muted}
            aria-label="Mute notifications"
            onClick={() => onToggleMute(!muted)}
          >
            <span />
          </button>
        </div>

        <div className="sheet-row">
          <div>
            <div className="sheet-row-title">Chat wallpaper</div>
            <div className="sheet-row-desc">
              {wallpaper ? "Custom photo for this chat" : "Using the app wallpaper"}
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {wallpaper && <span className="sheet-wall-thumb" style={{ backgroundImage: `url(${wallpaper})` }} />}

            <label className="sheet-btn">
              {wallpaper ? "Change" : "Choose"}
              <input
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void onPickWallpaper(file);
                  e.target.value = "";
                }}
              />
            </label>

            {wallpaper && (
              <button
                type="button"
                className="sheet-btn sheet-btn-ghost"
                onClick={onResetWallpaper}
              >
                Reset
              </button>
            )}
          </div>
        </div>

        <div className="sheet-row">
          <div>
            <div className="sheet-row-title">Clear chat</div>
            <div className="sheet-row-desc">
              Messages disappear from your side only
            </div>
          </div>

          {confirmClear ? (
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                className="sheet-btn sheet-btn-ghost"
                onClick={() => setConfirmClear(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="sheet-btn sheet-btn-danger"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await onClearChat();
                    setConfirmClear(false);
                    setNote("Chat cleared");
                  })
                }
              >
                Clear
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="sheet-btn sheet-btn-ghost"
              onClick={() => setConfirmClear(true)}
            >
              Clear
            </button>
          )}
        </div>

        <div className="sheet-row sheet-row-last">
          <div>
            <div className="sheet-row-title">
              {blocked ? "Unblock contact" : "Block contact"}
            </div>
            <div className="sheet-row-desc">
              {blocked
                ? "You will be able to message again"
                : "Blocked contacts cannot message or call you"}
            </div>
          </div>

          {confirmBlock ? (
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                className="sheet-btn sheet-btn-ghost"
                onClick={() => setConfirmBlock(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="sheet-btn sheet-btn-danger"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await onToggleBlock(!blocked);
                    setConfirmBlock(false);
                    setNote(blocked ? "Contact unblocked" : "Contact blocked");
                  })
                }
              >
                {blocked ? "Unblock" : "Block"}
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="sheet-btn sheet-btn-ghost"
              onClick={() => setConfirmBlock(true)}
            >
              {blocked ? "Unblock" : "Block"}
            </button>
          )}
        </div>

        {blockedByThem && (
          <div className="sheet-note">This contact has blocked you.</div>
        )}

        {note && <div className="sheet-note">{note}</div>}
      </div>
    </div>
  );
}
