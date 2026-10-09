// Keys left in users' browsers by earlier versions of the app.
const LEGACY_KEYS = [
  // The old demo login kept accounts here, passwords included, in plain text.
  "ai_helpdesk_accounts",
];

/** Removes data older app versions stored in the browser and no longer use. */
export function cleanupLegacyStorage() {
  try {
    for (const key of LEGACY_KEYS) localStorage.removeItem(key);
  } catch {
    // Storage can be unavailable (private mode, blocked site data) — nothing to clean.
  }
}
