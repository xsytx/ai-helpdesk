// Browser storage that never throws. localStorage/sessionStorage can be
// unavailable (some private modes, blocked site data, storage full): reads
// then return null and writes are skipped, so the app keeps working instead
// of crashing at startup.

function wrap(area: () => Storage) {
  return {
    get(key: string): string | null {
      try {
        return area().getItem(key);
      } catch {
        return null;
      }
    },
    set(key: string, value: string): void {
      try {
        area().setItem(key, value);
      } catch {
        // Not saved; it just won't be remembered.
      }
    },
    remove(key: string): void {
      try {
        area().removeItem(key);
      } catch {
        // Nothing to do.
      }
    },
  };
}

/** localStorage: kept across visits. */
export const safeStorage = wrap(() => window.localStorage);
/** sessionStorage: this tab only. */
export const safeSession = wrap(() => window.sessionStorage);
