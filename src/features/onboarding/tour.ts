// First-run guided tour (driver.js): a spotlight on key parts of the home
// page with a short tip for each. Targets are marked with data-tour="...".
import type { TranslationKey } from "@/i18n/translations";
import type { DriveStep } from "driver.js";

const START_KEY = "ai_helpdesk_start_tour";

/** Ask the home page to start the tour on its next visit (after sign-up, or "Replay tour"). */
export function requestTour() {
  try {
    localStorage.setItem(START_KEY, "1");
  } catch {
    // Storage blocked — the tour just won't start.
  }
}

export function hasTourRequest(): boolean {
  try {
    return localStorage.getItem(START_KEY) === "1";
  } catch {
    return false;
  }
}

function clearTourRequest() {
  try {
    localStorage.removeItem(START_KEY);
  } catch {
    // Storage blocked — nothing to clear.
  }
}

/**
 * The visible element for a tour target. Desktop and mobile layouts both mark
 * their version (e.g. sidebar vs bottom-bar "New chat"); only one is shown.
 */
function visibleTarget(name: string): Element | undefined {
  return [...document.querySelectorAll<HTMLElement>(`[data-tour="${name}"]`)].find(
    (el) => el.offsetParent !== null,
  );
}

const STEPS: { target?: string; title: TranslationKey; body: TranslationKey }[] = [
  { title: "tourWelcomeTitle", body: "tourWelcomeBody" },
  { target: "ask", title: "tourAskTitle", body: "tourAskBody" },
  { target: "new-chat", title: "tourChatTitle", body: "tourChatBody" },
  { target: "forum", title: "tourForumTitle", body: "tourForumBody" },
  { target: "language", title: "tourLanguageTitle", body: "tourLanguageBody" },
  { target: "settings", title: "tourSettingsTitle", body: "tourSettingsBody" },
  { title: "tourDoneTitle", body: "tourDoneBody" },
];

export async function startTour(t: (key: TranslationKey) => string) {
  // Cleared only once the tour really starts (an effect may run twice in dev).
  clearTourRequest();
  // Loaded only when a tour runs, to keep it out of the main bundle.
  const [{ driver }] = await Promise.all([import("driver.js"), import("driver.js/dist/driver.css")]);

  const steps: DriveStep[] = STEPS.flatMap(({ target, title, body }) => {
    const element = target ? visibleTarget(target) : undefined;
    // Skip a step whose target isn't on screen rather than pointing at nothing.
    if (target && !element) return [];
    return [{ element, popover: { title: t(title), description: t(body) } }];
  });

  driver({
    steps,
    showProgress: true,
    progressText: t("tourProgress"),
    nextBtnText: t("tourNext"),
    prevBtnText: t("tourBack"),
    doneBtnText: t("tourDone"),
    popoverClass: "sdu-tour",
    stagePadding: 6,
    stageRadius: 16,
    overlayOpacity: 0.55,
    smoothScroll: true,
    // Clicking the highlighted element mid-tour would navigate away.
    disableActiveInteraction: true,
  }).drive();
}
