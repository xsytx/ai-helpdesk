import { createContext, createElement, useContext, useEffect, useState, type ReactNode } from "react";
import { safeStorage } from "./storage";

// Light/dark theme. The choice is kept in the browser; "system" follows the
// phone/computer setting and changes with it. The theme is set as
// <html data-theme="light|dark">; the colours live in styles/globals.css.
// index.html runs the same logic before the page draws (no white flash), so
// keep THEME_KEY in sync with it.

export type ThemeChoice = "system" | "light" | "dark";

const THEME_KEY = "ai_helpdesk_theme";
const darkQuery = () => window.matchMedia("(prefers-color-scheme: dark)");

function savedChoice(): ThemeChoice {
  const saved = safeStorage.get(THEME_KEY);
  return saved === "light" || saved === "dark" ? saved : "system";
}

function apply(choice: ThemeChoice) {
  const dark = choice === "dark" || (choice === "system" && darkQuery().matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}

const ThemeContext = createContext<[ThemeChoice, (choice: ThemeChoice) => void]>(["system", () => {}]);

/** Applies the theme for the whole app and follows the system and other tabs. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [choice, setChoice] = useState<ThemeChoice>(savedChoice);

  useEffect(() => {
    apply(choice);
    if (choice !== "system") return;
    const query = darkQuery();
    const onChange = () => apply("system");
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [choice]);

  // Changed in another tab.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === THEME_KEY) setChoice(savedChoice());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const update = (next: ThemeChoice) => {
    if (next === "system") safeStorage.remove(THEME_KEY);
    else safeStorage.set(THEME_KEY, next);
    setChoice(next);
  };
  return createElement(ThemeContext.Provider, { value: [choice, update] }, children);
}

/** The current choice and a setter. */
export function useTheme() {
  return useContext(ThemeContext);
}
