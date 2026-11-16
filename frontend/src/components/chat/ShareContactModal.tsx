import { useState } from "react";

import { api, mediaUrl } from "../../lib/api";

export type SharedContact = {
  userId: string;
  name: string;
  username: string;
  profilePic: string;
};

type Props = {
  onClose: () => void;
  onShare: (contact: SharedContact) => void;
  /** People from your chat list, for one-tap sharing. */
  suggestions?: SharedContact[];
};

export default function ShareContactModal({
  onClose,
  onShare,
  suggestions = [],
}: Props) {
  const [text, setText] = useState("");
  const [result, setResult] = useState<SharedContact | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [busy, setBusy] = useState(false);

  const search = async () => {
    const query = text.trim().replace(/^@/, "");
    if (!query || busy) return;

    setBusy(true);
    setNotFound(false);

    try {
      const res = await api.get(`/api/auth/search/${encodeURIComponent(query)}`);
      setResult(res.data.user);
    } catch {
      setResult(null);
      setNotFound(true);
    } finally {
      setBusy(false);
    }
  };

  const avatar = mediaUrl(result?.profilePic);

  return (
    <div className="contact-modal-backdrop" onClick={onClose}>
      <div className="contact-modal" onClick={(e) => e.stopPropagation()}>
        <div className="contact-modal-head">
          <strong>Share a contact</strong>
          <button type="button" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <input
            className="contact-modal-input"
            placeholder="Search username…"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setResult(null);
              setNotFound(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") void search();
            }}
            autoFocus
          />

          <button
            type="button"
            className="settings-btn"
            onClick={() => void search()}
            disabled={busy}
          >
            {busy ? "…" : "Search"}
          </button>
        </div>

        {notFound && (
          <div className="contact-modal-note">No user with that username</div>
        )}

        {!result && !notFound && suggestions.length > 0 && (
          <div className="contact-suggest">
            <div className="contact-suggest-label">Your chats</div>

            {suggestions.slice(0, 6).map((person) => (
              <div key={person.userId} className="contact-suggest-row">
                <div className="contact-card-avatar">
                  {person.profilePic ? (
                    <img
                      src={mediaUrl(person.profilePic)}
                      alt=""
                    />
                  ) : (
                    "👤"
                  )}
                </div>

                <div style={{ minWidth: 0, flex: 1 }}>
                  <div
                    className="contact-card-name"
                    style={{ color: "var(--text-main)" }}
                  >
                    {person.name}
                  </div>
                  <div
                    className="contact-card-username"
                    style={{ color: "var(--text-muted)" }}
                  >
                    @{person.username}
                  </div>
                </div>

                <button
                  type="button"
                  className="contact-send-btn"
                  onClick={() => onShare(person)}
                >
                  Send
                </button>
              </div>
            ))}
          </div>
        )}

        {result && (
          <div className="contact-modal-result">
            <div className="contact-card-avatar">
              {avatar ? <img src={avatar} alt="" /> : "👤"}
            </div>

            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="contact-card-name">{result.name}</div>
              <div className="contact-card-username">@{result.username}</div>
            </div>

            <button
              type="button"
              className="settings-btn"
              onClick={() => onShare(result)}
            >
              Share
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
