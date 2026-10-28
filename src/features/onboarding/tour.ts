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

  const animate = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let moving = false;
  const tour = driver({
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
    animate,
    // We scroll ourselves (goTo): driver.js would scroll while it also moves
    // the spotlight and redraws the tip, and the two together stutter.
    smoothScroll: false,
    // Clicking the highlighted element mid-tour would navigate away.
    disableActiveInteraction: true,
    onNextClick: () => goTo((tour.getActiveIndex() ?? 0) + 1),
    onPrevClick: () => goTo((tour.getActiveIndex() ?? 0) - 1),
  });

  /** Scroll the next target into view first, then move the spotlight once the page is still. */
  async function goTo(index: number) {
    if (moving || index < 0) return;
    if (index >= steps.length) return tour.destroy();
    const element = steps[index].element;
    if (element instanceof Element && !inView(element)) {
      moving = true;
      // Fade the current tip out first: driver.js drags it along while the page scrolls.
      document.querySelector(".driver-popover")?.classList.add("sdu-tour-hidden");
      if (animate) await new Promise((r) => setTimeout(r, 120));
      await scrollIntoCenter(element, animate);
      moving = false;
    }
    tour.moveTo(index);
  }

  tour.drive();
}

function inView(element: Element) {
  const rect = element.getBoundingClientRect();
  return rect.top >= 0 && rect.bottom <= window.innerHeight;
}

function scrollIntoCenter(element: Element, smooth: boolean): Promise<void> {
  const rect = element.getBoundingClientRect();
  const offset = rect.height > window.innerHeight ? rect.top - 16 : rect.top - (window.innerHeight - rect.height) / 2;
  const top = Math.max(0, window.scrollY + offset);
  return new Promise((resolve) => {
    if (!smooth) {
      window.scrollTo({ top });
      return resolve();
    }
    // scrollend isn't in every browser yet: fall back to a timer.
    const done = () => {
      window.removeEventListener("scrollend", done);
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(done, 700);
    window.addEventListener("scrollend", done);
    window.scrollTo({ top, behavior: "smooth" });
  });
}
