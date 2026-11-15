/**
 * Logging out must never leave one account's data behind for the next user on
 * the same browser: tokens, unread badges and per-chat preferences all go.
 */
export function clearSession(): void {
  sessionStorage.removeItem("token");
  sessionStorage.removeItem("user");
  sessionStorage.clear();

  localStorage.removeItem("token");
  localStorage.removeItem("user");
  localStorage.removeItem("unread_counts");
  localStorage.removeItem("nexachat_chat_prefs");

  // Tell the shared socket to drop its authenticated connection.
  window.dispatchEvent(new Event("nexa:auth"));
}

/** Clears everything and sends the user back to the login screen. */
export function logoutAndRedirect(): void {
  clearSession();
  window.location.href = "/login";
}
