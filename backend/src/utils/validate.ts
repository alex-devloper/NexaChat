/**
 * Central place for input limits. Everything the client sends is untrusted,
 * so every string is trimmed, control characters are stripped and the length
 * is capped before it reaches the database.
 */
export const LIMITS = {
  name: 60,
  username: 24,
  email: 120,
  password: 128,
  about: 300,
  message: 4000,
  replyText: 200,
  search: 40,
  profilePic: 500,
} as const;

export const USERNAME_PATTERN = /^[a-z0-9._]{3,24}$/;

/** Trim, drop NUL/control chars and cap the length. */
export function cleanString(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim().slice(0, max);
}

export function isValidEmail(value: string): boolean {
  if (!value || value.length > LIMITS.email) return false;
  return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(value);
}

export function isValidUsername(value: string): boolean {
  return USERNAME_PATTERN.test(value);
}

export function isValidPassword(value: string): boolean {
  return value.length >= 6 && value.length <= LIMITS.password;
}

/** Only real http(s) URLs or site-relative paths may be stored as media URLs. */
export function isSafeMediaUrl(value: string): boolean {
  if (!value) return false;
  if (value.startsWith("/")) return !value.startsWith("//");
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
