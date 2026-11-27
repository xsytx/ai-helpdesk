import type { Locale } from "@/i18n/translations";
import { useEffect, useRef } from "react";

// The AI's daily questions are counted per Almaty date (UTC+5, no daylight
// saving), the same as the backend's chat_limit.go.
const ALMATY_OFFSET_MS = 5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The next Almaty midnight, when the used-up questions come back. */
export function nextDailyReset(now = Date.now()): Date {
  const almatyDay = Math.floor((now + ALMATY_OFFSET_MS) / DAY_MS);
  return new Date((almatyDay + 1) * DAY_MS - ALMATY_OFFSET_MS);
}

/** "00:00" in Almaty; the same moment in the device's own time elsewhere. */
export function dailyResetTime(locale: Locale, now = Date.now()): string {
  return nextDailyReset(now).toLocaleTimeString(locale === "kz" ? "kk" : locale, {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
}

/**
 * While today's questions are used up, asks the server again just after
 * midnight and whenever the tab is shown again (timers sleep in background
 * tabs and closed laptops), so the chat opens without a reload.
 */
export function useDailyResetRefresh(usedUp: boolean, refresh: () => void) {
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  useEffect(() => {
    if (!usedUp) return;
    // A few seconds after midnight, so the server's date has moved on too.
    const wait = Math.min(nextDailyReset().getTime() - Date.now() + 5000, 2 ** 31 - 1);
    const timer = window.setTimeout(() => refreshRef.current(), Math.max(wait, 1000));
    const onVisible = () => {
      if (document.visibilityState === "visible") refreshRef.current();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [usedUp]);
}
