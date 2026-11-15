import { useCallback, useEffect, useState } from "react";

export type Wallpaper = "default" | "mint" | "sand" | "sky" | "custom";

export type AppSettings = {
  /** Enter bhejta hai, Shift+Enter nayi line (WhatsApp default). */
  enterToSend: boolean;
  /** Naya message aane par beep. */
  messageTone: boolean;
  /** In-app notification cards (chat ke bahar). */
  notificationPopups: boolean;
  /** Notification card mein message text dikhe ya na dikhe. */
  messagePreview: boolean;
  wallpaper: Wallpaper;
  /** User uploaded photo (data URL) used when wallpaper is "custom". */
  customWallpaper: string;
};

const KEY = "nexachat_settings";
const EVENT = "nexa:settings-updated";

const DEFAULTS: AppSettings = {
  enterToSend: true,
  messageTone: true,
  notificationPopups: true,
  messagePreview: true,
  wallpaper: "default",
  customWallpaper: "",
};

export function getSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return DEFAULTS;

    return { ...DEFAULTS, ...parsed };
  } catch {
    return DEFAULTS;
  }
}

/** Applies DOM-level settings (chat wallpaper). */
export function applySettings(settings: AppSettings = getSettings()): void {
  if (typeof document === "undefined") return;

  const root = document.documentElement;
  const useCustom =
    settings.wallpaper === "custom" && !!settings.customWallpaper;

  root.dataset.wallpaper = useCustom
    ? "custom"
    : settings.wallpaper === "custom"
    ? "default"
    : settings.wallpaper;

  if (useCustom) {
    root.style.setProperty(
      "--chat-wallpaper",
      `url("${settings.customWallpaper}")`
    );
  } else {
    root.style.removeProperty("--chat-wallpaper");
  }
}

export function saveSettings(patch: Partial<AppSettings>): AppSettings {
  const next = { ...getSettings(), ...patch };

  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage can be blocked; settings still apply for this session */
  }

  applySettings(next);
  window.dispatchEvent(new CustomEvent<AppSettings>(EVENT, { detail: next }));

  return next;
}

/** Only local preferences are cleared — messages and account stay untouched. */
export function resetSettings(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }

  applySettings(DEFAULTS);
  window.dispatchEvent(
    new CustomEvent<AppSettings>(EVENT, { detail: { ...DEFAULTS } })
  );
}

export function useSettings(): [
  AppSettings,
  (patch: Partial<AppSettings>) => void,
] {
  const [settings, setSettings] = useState<AppSettings>(() => getSettings());

  useEffect(() => {
    applySettings();

    const listener = (event: Event) => {
      const detail = (event as CustomEvent<AppSettings>).detail;
      if (detail) setSettings(detail);
    };

    window.addEventListener(EVENT, listener);
    return () => window.removeEventListener(EVENT, listener);
  }, []);

  const update = useCallback((patch: Partial<AppSettings>) => {
    saveSettings(patch);
  }, []);

  return [settings, update];
}
