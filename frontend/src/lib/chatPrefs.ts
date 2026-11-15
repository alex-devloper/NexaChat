export type ChatPrefs = {
  /** Notifications for this chat only. */
  muted?: boolean;
  /** Per-chat wallpaper (compressed data URL). */
  wallpaper?: string;
};

const KEY = "nexachat_chat_prefs";

function readAll(): Record<string, ChatPrefs> {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function getChatPrefs(userId: string): ChatPrefs {
  if (!userId) return {};
  return readAll()[userId] || {};
}

export function setChatPrefs(
  userId: string,
  patch: Partial<ChatPrefs>
): ChatPrefs {
  const all = readAll();
  const next = { ...(all[userId] || {}), ...patch };
  all[userId] = next;

  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* storage may be full because of a wallpaper; drop it and retry */
    delete next.wallpaper;
    all[userId] = next;
    try {
      localStorage.setItem(KEY, JSON.stringify(all));
    } catch {
      /* ignore */
    }
  }

  return next;
}

export function clearChatPrefs(userId: string): void {
  const all = readAll();
  delete all[userId];

  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* ignore */
  }
}
