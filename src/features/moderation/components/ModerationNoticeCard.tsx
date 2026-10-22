import { useLocale } from "@/i18n/LocaleContext";
import type { TranslationKey } from "@/i18n/translations";
import type { ModerationNotice } from "@/features/moderation/notice";
import { cn } from "@/shared/lib/cn";

const CATEGORY_KEYS: Record<string, TranslationKey> = {
  profanity: "modCategoryProfanity",
  harassment: "modCategoryHarassment",
  hate: "modCategoryHate",
  threat: "modCategoryThreat",
  sexual_harassment: "modCategorySexualHarassment",
};

export function useCategoryLabel() {
  const { t } = useLocale();
  return (category: string) => (CATEGORY_KEYS[category] ? t(CATEGORY_KEYS[category]) : category);
}

/** Shown to the author instead of the new post when it was not published right away. */
export function ModerationNoticeCard({ notice, className }: { notice: ModerationNotice; className?: string }) {
  const { t } = useLocale();
  const label = useCategoryLabel();
  const blocked = notice.decision === "block";
  return (
    <div
      role="status"
      className={cn(
        "rounded-xl border px-4 py-3 text-sm",
        blocked ? "border-red-200 bg-red-50 text-red-900" : "border-amber-200 bg-amber-50 text-amber-900",
        className,
      )}
    >
      <p className="font-semibold">{blocked ? t("moderationBlockTitle") : t("moderationReviewTitle")}</p>
      <p className="mt-1">{blocked ? t("moderationBlockBody") : t("moderationReviewBody")}</p>
      {blocked && notice.categories.length > 0 ? (
        <p className="mt-1 text-xs opacity-80">
          {t("moderationReasonLabel")}: {notice.categories.map(label).join(", ")}
        </p>
      ) : null}
    </div>
  );
}
