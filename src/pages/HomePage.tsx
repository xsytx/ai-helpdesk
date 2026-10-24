import { useLocale } from "@/i18n/LocaleContext";
import { AskAnythingSection } from "@/features/chat/components/AskAnythingSection";
import { ForumPreview } from "@/features/forum/components/ForumPreview";
import { FaqPanel } from "@/features/chat/components/FaqPanel";
import { TopHelpers } from "@/features/reputation/components/TopHelpers";
import { hasTourRequest, startTour } from "@/features/onboarding/tour";
import { useEffect } from "react";

export function HomePage() {
  const { t } = useLocale();

  // First visit after sign-up (or "Replay tour" in Settings): show the guide.
  useEffect(() => {
    if (!hasTourRequest()) return;
    // Let the page and its page transition settle before measuring targets.
    const timer = setTimeout(() => void startTour(t), 500);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <AskAnythingSection />
      <div className="grid gap-6 lg:grid-cols-[1fr_minmax(260px,320px)]">
        <ForumPreview />
        <div className="flex flex-col gap-6">
          <TopHelpers />
          <section aria-labelledby="faq-heading">
            <h2 id="faq-heading" className="sr-only">
              {t("faq")}
            </h2>
            <FaqPanel compact={false} />
          </section>
        </div>
      </div>
    </div>
  );
}
